-- =============================================================================
-- 0006 — Exportação (portabilidade/backup) e restauração dos dados da conta
-- * export_my_data(): JSON completo da profissional autenticada (RLS).
-- * import_my_data(): restaura um export numa conta VAZIA (ex.: após perda do
--   banco ou migração de servidor). Preserva ids; owner_id é sempre forçado
--   para o usuário autenticado. Tudo ou nada (uma transação).
-- Arquivos do storage são exportados/restaurados pelo aplicativo (ZIP).
-- =============================================================================

create or replace function public.log_event(p_action text, p_table text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if p_action not in ('EXPORT', 'IMPORT', 'DOWNLOAD_ANEXO', 'VISUALIZAR_PRONTUARIO', 'GERAR_DOCUMENTO') then
    raise exception 'Evento inválido' using errcode = '22023';
  end if;
  insert into public.audit_log (owner_id, actor, action, table_name)
  values (auth.uid(), 'profissional', p_action, coalesce(left(p_table, 60), '-'));
end $$;

revoke execute on function public.log_event(text, text) from public, anon;
grant execute on function public.log_event(text, text) to authenticated;

create or replace function public.export_my_data()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _out jsonb;
begin
  if _uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'format', 'psi-consultorio-export',
    'format_version', 1,
    'exported_at', now(),
    'profile', (select to_jsonb(p) - 'id' from public.profiles p where p.id = _uid),
    'patients', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.patients t), '[]'),
    'appointment_series', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.appointment_series t), '[]'),
    'appointments', coalesce((select jsonb_agg(to_jsonb(t) order by t.starts_at) from public.appointments t), '[]'),
    'record_entries', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.record_entries t), '[]'),
    'record_entry_versions', coalesce((select jsonb_agg(to_jsonb(t) order by t.replaced_at) from public.record_entry_versions t), '[]'),
    'attachments', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.attachments t), '[]'),
    'documents', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.documents t), '[]'),
    'charges', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.charges t), '[]'),
    'payments', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.payments t), '[]'),
    'expenses', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.expenses t), '[]'),
    'invoices', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.invoices t), '[]')
  ) into _out;

  perform public.log_event('EXPORT', 'all');
  return _out;
end $$;

revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- Reescreve owner_id (e, para attachments, o prefixo do caminho) de cada item
create or replace function public._with_owner(p_items jsonb, p_uid uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    case
      when e ? 'storage_path' then
        e || jsonb_build_object(
          'owner_id', p_uid,
          'storage_path', p_uid::text || substr(e ->> 'storage_path', position('/' in e ->> 'storage_path')))
      else e || jsonb_build_object('owner_id', p_uid)
    end), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
$$;

revoke execute on function public._with_owner(jsonb, uuid) from public, anon, authenticated;

create or replace function public.import_my_data(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _counts jsonb := '{}'::jsonb;
  _n int;
begin
  if _uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if coalesce(p_data ->> 'format', '') <> 'psi-consultorio-export' or (p_data ->> 'format_version')::int <> 1 then
    raise exception 'Arquivo de backup inválido ou de versão não suportada.' using errcode = '22023';
  end if;
  if exists (select 1 from public.patients where owner_id = _uid)
     or exists (select 1 from public.expenses where owner_id = _uid) then
    raise exception 'A restauração só pode ser feita em uma conta sem dados.' using errcode = 'P0001';
  end if;

  perform set_config('app.importing', 'on', true);
  perform set_config('app.actor', 'sistema', true);

  -- Preferências do perfil (nunca o id)
  update public.profiles pr set
    full_name = coalesce(p_data -> 'profile' ->> 'full_name', pr.full_name),
    crp = coalesce(p_data -> 'profile' ->> 'crp', pr.crp),
    cpf = coalesce(p_data -> 'profile' ->> 'cpf', pr.cpf),
    cnpj = coalesce(p_data -> 'profile' ->> 'cnpj', pr.cnpj),
    fiscal_type = coalesce((p_data -> 'profile' ->> 'fiscal_type')::public.fiscal_type, pr.fiscal_type),
    phone = coalesce(p_data -> 'profile' ->> 'phone', pr.phone),
    city = coalesce(p_data -> 'profile' ->> 'city', pr.city),
    uf = coalesce(p_data -> 'profile' ->> 'uf', pr.uf),
    timezone = coalesce(p_data -> 'profile' ->> 'timezone', pr.timezone),
    session_minutes = coalesce((p_data -> 'profile' ->> 'session_minutes')::int, pr.session_minutes),
    buffer_minutes = coalesce((p_data -> 'profile' ->> 'buffer_minutes')::int, pr.buffer_minutes),
    default_price = coalesce((p_data -> 'profile' ->> 'default_price')::numeric, pr.default_price),
    cancellation_hours = coalesce((p_data -> 'profile' ->> 'cancellation_hours')::int, pr.cancellation_hours),
    retention_years = coalesce((p_data -> 'profile' ->> 'retention_years')::int, pr.retention_years),
    onboarded_at = coalesce(pr.onboarded_at, now())
  where pr.id = _uid;

  insert into public.patients select * from jsonb_populate_recordset(null::public.patients, public._with_owner(p_data -> 'patients', _uid));
  get diagnostics _n = row_count; _counts := _counts || jsonb_build_object('patients', _n);

  insert into public.appointment_series select * from jsonb_populate_recordset(null::public.appointment_series, public._with_owner(p_data -> 'appointment_series', _uid));
  get diagnostics _n = row_count; _counts := _counts || jsonb_build_object('appointment_series', _n);

  -- Gatilho de regras exige que atendido/faltou estejam no passado: dados exportados já respeitam isso.
  insert into public.appointments select * from jsonb_populate_recordset(null::public.appointments, public._with_owner(p_data -> 'appointments', _uid));
  get diagnostics _n = row_count; _counts := _counts || jsonb_build_object('appointments', _n);

  insert into public.record_entries select * from jsonb_populate_recordset(null::public.record_entries, public._with_owner(p_data -> 'record_entries', _uid));
  get diagnostics _n = row_count; _counts := _counts || jsonb_build_object('record_entries', _n);

  insert into public.record_entry_versions select * from jsonb_populate_recordset(null::public.record_entry_versions, public._with_owner(p_data -> 'record_entry_versions', _uid));
  get diagnostics _n = row_count; _counts := _counts || jsonb_build_object('record_entry_versions', _n);

  insert into public.attachments select * from jsonb_populate_recordset(null::public.attachments, public._with_owner(p_data -> 'attachments', _uid));
  get diagnostics _n = row_count; _counts := _counts || jsonb_build_object('attachments', _n);

  insert into public.documents select * from jsonb_populate_recordset(null::public.documents, public._with_owner(p_data -> 'documents', _uid));
  get diagnostics _n = row_count; _counts := _counts || jsonb_build_object('documents', _n);

  insert into public.charges select * from jsonb_populate_recordset(null::public.charges, public._with_owner(p_data -> 'charges', _uid));
  get diagnostics _n = row_count; _counts := _counts || jsonb_build_object('charges', _n);

  insert into public.payments select * from jsonb_populate_recordset(null::public.payments, public._with_owner(p_data -> 'payments', _uid));
  get diagnostics _n = row_count; _counts := _counts || jsonb_build_object('payments', _n);

  insert into public.expenses select * from jsonb_populate_recordset(null::public.expenses, public._with_owner(p_data -> 'expenses', _uid));
  get diagnostics _n = row_count; _counts := _counts || jsonb_build_object('expenses', _n);

  insert into public.invoices select * from jsonb_populate_recordset(null::public.invoices, public._with_owner(p_data -> 'invoices', _uid));
  get diagnostics _n = row_count; _counts := _counts || jsonb_build_object('invoices', _n);

  insert into public.audit_log (owner_id, actor, action, table_name)
  values (_uid, 'profissional', 'IMPORT', 'all');

  return _counts;
end $$;

revoke execute on function public.import_my_data(jsonb) from public, anon;
grant execute on function public.import_my_data(jsonb) to authenticated;

-- Durante a importação, cobranças vêm do backup (não gerar automaticamente)
create or replace function public.tg_appointments_charge()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _patient public.patients;
  _should boolean;
  _charge public.charges;
  _paid numeric;
  _tz text;
  _label text;
begin
  if current_setting('app.importing', true) = 'on' then
    return new;
  end if;

  select * into _patient from public.patients where id = new.patient_id;
  _should := _patient.billing_mode = 'por_sessao'
             and coalesce(new.price, 0) > 0
             and (new.status = 'atendido' or (new.status = 'faltou' and new.charge_no_show));

  select * into _charge from public.charges where appointment_id = new.id;

  if _should and not found then
    select timezone into _tz from public.profiles where id = new.owner_id;
    _label := case when new.status = 'faltou' then 'Falta' else 'Sessão' end
              || ' de ' || to_char(new.starts_at at time zone _tz, 'DD/MM/YYYY HH24:MI');
    insert into public.charges (owner_id, patient_id, appointment_id, description, amount, due_date)
    values (new.owner_id, new.patient_id, new.id, _label, new.price,
            (new.starts_at at time zone _tz)::date);
  elsif _should and found then
    update public.charges
       set canceled_at = null,
           amount = new.price,
           description = case when new.status = 'faltou' then replace(description, 'Sessão', 'Falta')
                              else replace(description, 'Falta', 'Sessão') end
     where id = _charge.id;
  elsif not _should and found and _charge.canceled_at is null then
    select coalesce(sum(amount), 0) into _paid from public.payments where charge_id = _charge.id;
    if _paid > 0 then
      raise exception 'Esta sessão já tem pagamento registrado. Exclua o pagamento antes de alterar o status.'
        using errcode = 'P0001';
    end if;
    update public.charges set canceled_at = now() where id = _charge.id;
  end if;
  return new;
end $$;

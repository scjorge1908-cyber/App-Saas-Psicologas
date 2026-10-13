-- =============================================================================
-- 0008 — Endurecimento após auditoria independente (docs/SEGURANCA.md)
-- H1  TRUNCATE revogado (ignora RLS e apagaria todas as contas)
-- H2  Sessões passadas/registradas não podem ser excluídas; anexos protegidos
--     não podem ser desvinculados nem trocados de paciente
-- M1  Datas de criação e versões não podem ser forjadas; entrega de documento
--     é registrada uma única vez; restaurações ficam marcadas
-- M2  Link de confirmação invalidado ao trocar o paciente ou reativar sessão
-- L1  Arquivo vinculado a documento/nota não pode ser apagado do storage
-- L2  anon só executa as duas RPCs de confirmação
-- +   Resposta do paciente só pode ser gravada pelo link
-- =============================================================================

-- H1 ---------------------------------------------------------------------------
revoke truncate on all tables in schema public from public, anon, authenticated;
alter default privileges in schema public revoke truncate on tables from public, anon, authenticated;

-- L2 ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
grant execute on function public.get_confirmation(text) to anon;
grant execute on function public.respond_confirmation(text, text) to anon;
-- Funções de gatilho não precisam ser chamáveis por clientes
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from authenticated', f.sig);
  end loop;
end $$;

-- Marca de restauração (transparência sobre dados vindos de backup) -------------
alter table public.record_entries add column restored_from_backup boolean not null default false;
alter table public.record_entry_versions add column restored_from_backup boolean not null default false;
alter table public.documents add column restored_from_backup boolean not null default false;

create or replace function public._importing() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.importing', true), '') = 'on'
$$;
revoke execute on function public._importing() from public, anon;
grant execute on function public._importing() to authenticated; -- usado por gatilhos que rodam como o usuário

-- H2: exclusão de sessões --------------------------------------------------------
create or replace function public.tg_appointments_protect_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('atendido', 'faltou') or old.starts_at <= now() then
    raise exception 'Sessões passadas ou registradas fazem parte do histórico e não podem ser excluídas. Cancele ou corrija o status.'
      using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke execute on function public.tg_appointments_protect_delete() from public, anon, authenticated;

create trigger appointments_protect_delete before delete on public.appointments
  for each row execute function public.tg_appointments_protect_delete();

-- Correção de registro (atendido/faltou -> agendado) só sem registro clínico vinculado
create or replace function public.tg_appointments_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('atendido', 'faltou')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and new.starts_at > now() then
    raise exception 'Não é possível marcar como % uma sessão que ainda não começou.', new.status
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if not public._importing() then
      new.created_at := now();
      new.patient_response := null;
      new.responded_at := null;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;

    if new.patient_id is distinct from old.patient_id and old.status in ('atendido', 'faltou') then
      raise exception 'Não é possível trocar o paciente de uma sessão já registrada.' using errcode = 'P0001';
    end if;

    if old.status in ('atendido', 'faltou') and new.status in ('agendado', 'confirmado', 'cancelado')
       and exists (select 1 from public.record_entries r where r.appointment_id = old.id) then
      raise exception 'Esta sessão tem registro no prontuário vinculado; o status não pode ser desfeito.'
        using errcode = 'P0001';
    end if;

    -- Resposta do paciente só pelo link de confirmação
    if (new.patient_response, new.responded_at) is distinct from (old.patient_response, old.responded_at)
       and coalesce(current_setting('app.actor', true), '') <> 'paciente-link'
       and not (new.patient_response is null and new.responded_at is null) then
      new.patient_response := old.patient_response;
      new.responded_at := old.responded_at;
    end if;

    if (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at) then
      if old.status in ('atendido', 'faltou') then
        raise exception 'Sessões já registradas como atendidas/faltas não podem ser remarcadas.'
          using errcode = 'P0001';
      end if;
      if new.status = old.status and old.status = 'confirmado' then
        new.status := 'agendado';
      end if;
      new.confirmed_at := null;
      new.patient_response := null;
      new.responded_at := null;
    end if;

    if new.status = 'confirmado' and old.status is distinct from 'confirmado' and new.confirmed_at is null then
      new.confirmed_at := now();
    end if;

    if old.status = 'cancelado' and new.status <> 'cancelado' then
      new.canceled_by := null;
      new.cancel_reason := null;
      new.late_cancellation := false;
      new.patient_response := null;
      new.responded_at := null;
    end if;
  end if;

  if new.status <> 'faltou' then
    new.charge_no_show := false;
  end if;

  return new;
end $$;
revoke execute on function public.tg_appointments_rules() from public, anon, authenticated;

-- M2: invalidação de link ------------------------------------------------------------
create or replace function public.tg_appointments_invalidate_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at)
     or new.patient_id is distinct from old.patient_id
     or new.status in ('atendido', 'faltou')
     or (new.status = 'cancelado' and new.canceled_by = 'profissional')
     or (old.status = 'cancelado' and new.status <> 'cancelado') then
    delete from public.confirmation_tokens where appointment_id = new.id;
  end if;
  return new;
end $$;
revoke execute on function public.tg_appointments_invalidate_token() from public, anon, authenticated;

-- M1: prontuário ------------------------------------------------------------------
create or replace function public.tg_record_entries_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public._importing() then
    new.restored_from_backup := true;
  else
    new.created_at := now();
    new.updated_at := now();
    new.version := 1;
    new.restored_from_backup := false;
  end if;
  return new;
end $$;
revoke execute on function public.tg_record_entries_insert() from public, anon, authenticated;

create trigger record_entries_insert before insert on public.record_entries
  for each row execute function public.tg_record_entries_insert();

create or replace function public.tg_record_entries_versioning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Registros de prontuário não podem ser excluídos (Res. CFP 001/2009 — guarda obrigatória). Faça uma retificação.'
      using errcode = 'P0001';
  end if;

  if new.owner_id <> old.owner_id or new.patient_id <> old.patient_id then
    raise exception 'Não é permitido transferir registros de prontuário.' using errcode = 'P0001';
  end if;
  if new.appointment_id is distinct from old.appointment_id then
    raise exception 'Não é permitido alterar a sessão vinculada a um registro.' using errcode = 'P0001';
  end if;
  new.created_at := old.created_at;
  new.restored_from_backup := old.restored_from_backup;

  if (new.content, new.kind, new.entry_date, new.title)
     is distinct from (old.content, old.kind, old.entry_date, old.title) then
    insert into public.record_entry_versions
      (entry_id, owner_id, version, kind, entry_date, title, content, valid_from)
    values
      (old.id, old.owner_id, old.version, old.kind, old.entry_date, old.title, old.content, old.updated_at);
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end $$;
revoke execute on function public.tg_record_entries_versioning() from public, anon, authenticated;

create or replace function public.tg_record_versions_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.restored_from_backup := public._importing();
  if not public._importing() then
    new.replaced_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.tg_record_versions_insert() from public, anon, authenticated;

create trigger record_versions_insert before insert on public.record_entry_versions
  for each row execute function public.tg_record_versions_insert();

-- M1: documentos ------------------------------------------------------------------
create or replace function public.tg_documents_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public._importing() then
    new.restored_from_backup := true;
  else
    new.created_at := now();
    new.restored_from_backup := false;
    new.delivered_at := null;
    new.delivered_to := null;
    if new.attachment_id is not null and not exists (
      select 1 from public.attachments a where a.id = new.attachment_id and a.category = 'documento_emitido') then
      raise exception 'O PDF de um documento emitido deve ser anexado como "documento emitido".' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_documents_insert() from public, anon, authenticated;

create trigger documents_insert before insert on public.documents
  for each row execute function public.tg_documents_insert();

create or replace function public.tg_documents_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Documentos emitidos não podem ser excluídos (guarda mínima de 5 anos).' using errcode = 'P0001';
  end if;
  if (new.owner_id, new.patient_id, new.doc_type, new.title, new.purpose, new.recipient,
      new.issued_on, new.fields, new.created_at, new.restored_from_backup)
     is distinct from
     (old.owner_id, old.patient_id, old.doc_type, old.title, old.purpose, old.recipient,
      old.issued_on, old.fields, old.created_at, old.restored_from_backup) then
    raise exception 'Documentos emitidos são imutáveis. Emita um novo documento se necessário.' using errcode = 'P0001';
  end if;
  if old.attachment_id is not null and new.attachment_id is distinct from old.attachment_id then
    raise exception 'O PDF de um documento emitido não pode ser substituído.' using errcode = 'P0001';
  end if;
  if old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256 then
    raise exception 'O hash do PDF emitido não pode ser alterado.' using errcode = 'P0001';
  end if;
  if old.delivered_at is not null
     and (new.delivered_at, new.delivered_to) is distinct from (old.delivered_at, old.delivered_to) then
    raise exception 'A entrega deste documento já foi registrada e não pode ser alterada.' using errcode = 'P0001';
  end if;
  if new.delivered_at is not null and old.delivered_at is null then
    new.delivered_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.tg_documents_immutable() from public, anon, authenticated;

-- H2: anexos protegidos -------------------------------------------------------------
create or replace function public.tg_attachments_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.category in ('avaliacao', 'documento_emitido') then
      raise exception 'Anexos de avaliação e documentos emitidos fazem parte do prontuário e não podem ser excluídos.'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.documents d where d.attachment_id = old.id)
       or exists (select 1 from public.invoices i where old.id in (i.pdf_attachment_id, i.xml_attachment_id)) then
      raise exception 'Este arquivo está vinculado a um documento ou nota fiscal e não pode ser excluído.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if not public._importing() then new.created_at := now(); end if;
    return new;
  end if;
  new.created_at := old.created_at;
  if new.storage_path <> old.storage_path or new.sha256 is distinct from old.sha256
     or new.owner_id <> old.owner_id or new.size_bytes <> old.size_bytes then
    raise exception 'O arquivo de um anexo não pode ser alterado.' using errcode = 'P0001';
  end if;
  if old.category in ('avaliacao', 'documento_emitido')
     and (new.category, new.patient_id, new.record_entry_id, new.file_name, new.mime_type)
         is distinct from (old.category, old.patient_id, old.record_entry_id, old.file_name, old.mime_type) then
    raise exception 'Este anexo faz parte do prontuário e não pode ser alterado.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.tg_attachments_protect() from public, anon, authenticated;

drop trigger attachments_protect on public.attachments;
create trigger attachments_protect before insert or update or delete on public.attachments
  for each row execute function public.tg_attachments_protect();

-- L1: storage --------------------------------------------------------------------------
drop policy "prontuario_delete_own_unprotected" on storage.objects;
create policy "prontuario_delete_own_unprotected" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'prontuario'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.attachments a
      where a.storage_path = storage.objects.name
        and (
          a.category in ('avaliacao', 'documento_emitido')
          or exists (select 1 from public.documents d where d.attachment_id = a.id)
          or exists (select 1 from public.invoices i where a.id in (i.pdf_attachment_id, i.xml_attachment_id))
        )
    )
  );

-- Exclusão de paciente: mensagens alinhadas às novas regras --------------------------
create or replace function public.tg_patients_protect_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.record_entries where patient_id = old.id)
     or exists (select 1 from public.documents where patient_id = old.id)
     or exists (select 1 from public.attachments where patient_id = old.id)
     or exists (select 1 from public.appointments where patient_id = old.id and (status in ('atendido', 'faltou') or starts_at <= now()))
     or exists (select 1 from public.charges where patient_id = old.id)
     or exists (select 1 from public.payments where patient_id = old.id)
     or exists (select 1 from public.invoices where patient_id = old.id) then
    raise exception 'Paciente com histórico (sessões passadas, prontuário, anexos ou lançamentos financeiros) não pode ser excluído. Use "Dar alta" ou "Inativar".'
      using errcode = 'P0001';
  end if;
  delete from public.appointments where patient_id = old.id;
  delete from public.appointment_series where patient_id = old.id;
  return old;
end $$;
revoke execute on function public.tg_patients_protect_delete() from public, anon, authenticated;

-- Encerrar série: remove apenas ocorrências futuras (as passadas são histórico)
create or replace function public.end_appointment_series(p_series_id uuid, p_from_date date)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  _s public.appointment_series;
  _tz text;
  _deleted int;
begin
  select * into _s from public.appointment_series where id = p_series_id;
  if not found then
    raise exception 'Série não encontrada.' using errcode = 'P0002';
  end if;
  select timezone into _tz from public.profiles where id = _s.owner_id;

  delete from public.appointments a
  where a.series_id = p_series_id
    and a.status in ('agendado', 'confirmado', 'cancelado')
    and a.starts_at > now()
    and a.starts_at >= (p_from_date::timestamp at time zone _tz);
  get diagnostics _deleted = row_count;

  update public.appointment_series
     set until_date = greatest(start_date, p_from_date - 1),
         ended_at = now()
   where id = p_series_id;

  return _deleted;
end $$;
revoke execute on function public.end_appointment_series(uuid, date) from public, anon;
grant execute on function public.end_appointment_series(uuid, date) to authenticated;

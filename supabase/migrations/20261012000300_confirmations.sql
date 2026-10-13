-- =============================================================================
-- 0003 — Confirmação de presença por link seguro
-- * O token (192 bits aleatórios) é mostrado UMA vez à profissional; o banco
--   guarda apenas o SHA-256 numa tabela inacessível aos clientes.
-- * O paciente (anônimo) só consegue: ver data/hora, nome e CRP da profissional
--   e o primeiro nome dele; confirmar ou cancelar. Nenhum dado clínico.
-- * O link expira no horário de início da sessão e é invalidado na remarcação.
-- =============================================================================

create table public.confirmation_tokens (
  appointment_id uuid primary key,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (appointment_id, owner_id) references public.appointments (id, owner_id) on delete cascade
);

alter table public.confirmation_tokens enable row level security;
-- Sem políticas: nenhum cliente lê ou escreve diretamente.
revoke all on public.confirmation_tokens from anon, authenticated;

-- Invalida o link quando a sessão é remarcada ou cancelada pela profissional
create or replace function public.tg_appointments_invalidate_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at)
     or new.status in ('atendido', 'faltou')
     or (new.status = 'cancelado' and new.canceled_by = 'profissional') then
    delete from public.confirmation_tokens where appointment_id = new.id;
  end if;
  return new;
end $$;

revoke execute on function public.tg_appointments_invalidate_token() from public, anon, authenticated;

create trigger appointments_invalidate_token after update on public.appointments
  for each row execute function public.tg_appointments_invalidate_token();

-- ----------------------------------------------------------------------------
-- Profissional gera o link (somente para as próprias sessões futuras)
-- ----------------------------------------------------------------------------
create or replace function public.create_confirmation_link(p_appointment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _a public.appointments;
  _token text;
begin
  if _uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  select * into _a from public.appointments where id = p_appointment_id and owner_id = _uid;
  if not found then
    raise exception 'Sessão não encontrada.' using errcode = 'P0002';
  end if;
  if _a.status not in ('agendado', 'confirmado') then
    raise exception 'Só é possível gerar link para sessões agendadas.' using errcode = 'P0001';
  end if;
  if _a.starts_at <= now() then
    raise exception 'A sessão já começou ou já passou.' using errcode = 'P0001';
  end if;

  _token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');

  insert into public.confirmation_tokens (appointment_id, owner_id, token_hash, expires_at)
  values (_a.id, _uid, extensions.digest(_token, 'sha256'), _a.starts_at)
  on conflict (appointment_id) do update
    set token_hash = excluded.token_hash,
        expires_at = excluded.expires_at,
        created_at = now();

  return _token;
end $$;

revoke execute on function public.create_confirmation_link(uuid) from public, anon;
grant execute on function public.create_confirmation_link(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Paciente consulta o link (anônimo)
-- ----------------------------------------------------------------------------
create or replace function public.get_confirmation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _t public.confirmation_tokens;
  _a public.appointments;
  _p public.profiles;
  _patient_first text;
  _state text;
begin
  if p_token is null or char_length(p_token) <> 32 then
    return jsonb_build_object('state', 'invalido');
  end if;

  select * into _t from public.confirmation_tokens
   where token_hash = extensions.digest(p_token, 'sha256');
  if not found then
    return jsonb_build_object('state', 'invalido');
  end if;

  select * into _a from public.appointments where id = _t.appointment_id;
  select * into _p from public.profiles where id = _a.owner_id;
  select split_part(btrim(coalesce(nullif(social_name, ''), full_name)), ' ', 1)
    into _patient_first from public.patients where id = _a.patient_id;

  _state := case
    when _a.status = 'cancelado' then 'cancelado'
    when _a.status = 'confirmado' then 'confirmado'
    when now() >= _t.expires_at then 'expirado'
    else 'pendente'
  end;

  return jsonb_build_object(
    'state', _state,
    'patient_first_name', _patient_first,
    'professional_name', _p.full_name,
    'professional_crp', _p.crp,
    'starts_at', _a.starts_at,
    'ends_at', _a.ends_at,
    'timezone', _p.timezone,
    'modality', _a.modality,
    'cancellation_hours', _p.cancellation_hours
  );
end $$;

-- ----------------------------------------------------------------------------
-- Paciente responde (confirmar | cancelar)
-- ----------------------------------------------------------------------------
create or replace function public.respond_confirmation(p_token text, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _t public.confirmation_tokens;
  _a public.appointments;
  _hours int;
begin
  if p_action not in ('confirmar', 'cancelar') then
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
  if p_token is null or char_length(p_token) <> 32 then
    return jsonb_build_object('ok', false, 'state', 'invalido');
  end if;

  select * into _t from public.confirmation_tokens
   where token_hash = extensions.digest(p_token, 'sha256')
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'state', 'invalido');
  end if;
  if now() >= _t.expires_at then
    return jsonb_build_object('ok', false, 'state', 'expirado');
  end if;

  select * into _a from public.appointments where id = _t.appointment_id for update;
  if _a.status not in ('agendado', 'confirmado') then
    return jsonb_build_object('ok', false, 'state', _a.status::text);
  end if;

  perform set_config('app.actor', 'paciente-link', true);

  if p_action = 'confirmar' then
    update public.appointments
       set status = 'confirmado', confirmed_at = now(),
           patient_response = 'confirmou', responded_at = now()
     where id = _a.id;
    return jsonb_build_object('ok', true, 'state', 'confirmado');
  else
    select cancellation_hours into _hours from public.profiles where id = _a.owner_id;
    update public.appointments
       set status = 'cancelado', canceled_by = 'paciente',
           cancel_reason = 'Cancelado pelo paciente pelo link de confirmação',
           late_cancellation = (_a.starts_at - now()) < make_interval(hours => _hours),
           patient_response = 'cancelou', responded_at = now()
     where id = _a.id;
    return jsonb_build_object('ok', true, 'state', 'cancelado');
  end if;
end $$;

revoke execute on function public.get_confirmation(text) from public;
revoke execute on function public.respond_confirmation(text, text) from public;
grant execute on function public.get_confirmation(text) to anon, authenticated;
grant execute on function public.respond_confirmation(text, text) to anon, authenticated;

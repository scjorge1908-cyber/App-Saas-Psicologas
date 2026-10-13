-- =============================================================================
-- 0002 — Pacientes e agenda
-- * Pacientes isolados por profissional (RLS).
-- * Agendamentos com prevenção de conflito garantida no banco (EXCLUDE gist).
-- * Séries recorrentes materializadas em ocorrências (semanal, quinzenal,
--   a cada 4 semanas), com relatório de conflitos.
-- =============================================================================

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 200),
  social_name text check (social_name is null or char_length(social_name) <= 200),
  birth_date date check (birth_date is null or birth_date between '1900-01-01' and current_date),
  cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  phone text check (phone is null or phone ~ '^[0-9]{10,13}$'),
  email text check (email is null or char_length(email) <= 200),
  address text check (address is null or char_length(address) <= 300),
  emergency_contact_name text check (emergency_contact_name is null or char_length(emergency_contact_name) <= 200),
  emergency_contact_phone text check (emergency_contact_phone is null or emergency_contact_phone ~ '^[0-9]{10,13}$'),
  -- Responsável legal (obrigatório para atendimento não eventual de menores — CEP art. 8º)
  guardian_name text check (guardian_name is null or char_length(guardian_name) <= 200),
  guardian_cpf text check (guardian_cpf is null or guardian_cpf ~ '^[0-9]{11}$'),
  guardian_relationship text check (guardian_relationship is null or char_length(guardian_relationship) <= 60),
  guardian_phone text check (guardian_phone is null or guardian_phone ~ '^[0-9]{10,13}$'),
  guardian_authorization_date date,
  -- Responsável financeiro (pagador), quando diferente do paciente
  payer_name text check (payer_name is null or char_length(payer_name) <= 200),
  payer_cpf text check (payer_cpf is null or payer_cpf ~ '^[0-9]{11}$'),
  billing_mode public.billing_mode not null default 'por_sessao',
  session_price numeric(10,2) check (session_price is null or session_price >= 0),
  session_minutes int check (session_minutes is null or session_minutes between 10 and 300),
  modality public.modality not null default 'presencial',
  meeting_url text check (meeting_url is null or meeting_url ~* '^https://'),
  status public.patient_status not null default 'ativo',
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

comment on column public.patients.admin_notes is 'Observações ADMINISTRATIVAS (ex.: preferência de horário). Conteúdo clínico vai no prontuário.';

create index patients_owner_name_idx on public.patients (owner_id, lower(full_name));
create index patients_owner_status_idx on public.patients (owner_id, status);

create trigger patients_updated_at before update on public.patients
  for each row execute function public.tg_set_updated_at();
create trigger patients_audit after insert or update or delete on public.patients
  for each row execute function public.tg_audit();

alter table public.patients enable row level security;
create policy patients_all_own on public.patients
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Séries recorrentes ----------------------------------------------------------
create table public.appointment_series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  patient_id uuid not null,
  frequency public.series_frequency not null,
  start_date date not null,
  start_time time not null,
  duration_minutes int not null check (duration_minutes between 10 and 300),
  until_date date,
  price numeric(10,2) check (price is null or price >= 0),
  modality public.modality not null default 'presencial',
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (id, owner_id),
  foreign key (patient_id, owner_id) references public.patients (id, owner_id) on delete restrict,
  check (until_date is null or until_date >= start_date)
);

create index appointment_series_owner_idx on public.appointment_series (owner_id, patient_id);

create trigger appointment_series_audit after insert or update or delete on public.appointment_series
  for each row execute function public.tg_audit();

alter table public.appointment_series enable row level security;
create policy appointment_series_all_own on public.appointment_series
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Agendamentos ---------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  patient_id uuid not null,
  series_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'agendado',
  canceled_by public.cancel_party,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  late_cancellation boolean not null default false,
  charge_no_show boolean not null default false,
  price numeric(10,2) check (price is null or price >= 0),
  modality public.modality not null default 'presencial',
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 1000),
  confirmed_at timestamptz,
  patient_response text check (patient_response is null or patient_response in ('confirmou', 'cancelou')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (patient_id, owner_id) references public.patients (id, owner_id) on delete restrict,
  foreign key (series_id, owner_id) references public.appointment_series (id, owner_id) on delete set null (series_id),
  constraint appointments_time_order check (ends_at > starts_at),
  constraint appointments_max_duration check (ends_at - starts_at <= interval '5 hours'),
  constraint appointments_cancel_consistency check (
    (status = 'cancelado' and canceled_by is not null)
    or (status <> 'cancelado' and canceled_by is null)
  ),
  -- Prevenção de conflitos: duas sessões ativas da mesma profissional não se sobrepõem.
  constraint appointments_no_overlap exclude using gist (
    owner_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelado')
);

create index appointments_owner_start_idx on public.appointments (owner_id, starts_at);
create index appointments_patient_idx on public.appointments (patient_id, starts_at);
create index appointments_series_idx on public.appointments (series_id);

comment on constraint appointments_no_overlap on public.appointments is 'Conflito de agenda: horário já ocupado por outra sessão não cancelada.';

-- Regras de transição de status
create or replace function public.tg_appointments_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Atendido/faltou só depois do início da sessão
  if new.status in ('atendido', 'faltou')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and new.starts_at > now() then
    raise exception 'Não é possível marcar como % uma sessão que ainda não começou.', new.status
      using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    -- Remarcação: horário mudou -> volta a "agendado" e invalida o link de confirmação
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

    -- Reativar sessão cancelada limpa os campos de cancelamento
    if old.status = 'cancelado' and new.status <> 'cancelado' then
      new.canceled_by := null;
      new.cancel_reason := null;
      new.late_cancellation := false;
    end if;
  end if;

  if new.status <> 'faltou' then
    new.charge_no_show := false;
  end if;

  return new;
end $$;

create trigger appointments_rules before insert or update on public.appointments
  for each row execute function public.tg_appointments_rules();
create trigger appointments_updated_at before update on public.appointments
  for each row execute function public.tg_set_updated_at();
create trigger appointments_audit after insert or update or delete on public.appointments
  for each row execute function public.tg_audit();

alter table public.appointments enable row level security;
create policy appointments_all_own on public.appointments
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.patients, public.appointment_series, public.appointments from anon;

-- ----------------------------------------------------------------------------
-- RPC: criar série recorrente
-- Retorna {series_id, created:[{id,starts_at}], conflicts:[{starts_at}]}
-- ----------------------------------------------------------------------------
create or replace function public.create_appointment_series(
  p_patient_id uuid,
  p_frequency public.series_frequency,
  p_start_date date,
  p_start_time time,
  p_duration_minutes int,
  p_until_date date default null,
  p_occurrences int default null,
  p_price numeric default null,
  p_modality public.modality default 'presencial'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _tz text;
  _series_id uuid;
  _step int;
  _date date;
  _max_date date;
  _count int := 0;
  _limit int;
  _start timestamptz;
  _id uuid;
  _created jsonb := '[]'::jsonb;
  _conflicts jsonb := '[]'::jsonb;
begin
  if _uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if p_occurrences is not null and (p_occurrences < 1 or p_occurrences > 104) then
    raise exception 'Número de ocorrências deve estar entre 1 e 104.' using errcode = '22023';
  end if;
  if p_until_date is not null and p_until_date < p_start_date then
    raise exception 'A data final deve ser posterior à data inicial.' using errcode = '22023';
  end if;

  select timezone into _tz from public.profiles where id = _uid;
  _step := case p_frequency when 'semanal' then 7 when 'quinzenal' then 14 else 28 end;
  -- Sem data final: materializa 26 semanas à frente (pode ser estendida depois)
  _max_date := coalesce(p_until_date, p_start_date + 182);
  _limit := coalesce(p_occurrences, 104);

  insert into public.appointment_series
    (owner_id, patient_id, frequency, start_date, start_time, duration_minutes, until_date, price, modality)
  values
    (_uid, p_patient_id, p_frequency, p_start_date, p_start_time, p_duration_minutes, p_until_date,
     p_price, p_modality)
  returning id into _series_id;

  _date := p_start_date;
  while _date <= _max_date and _count < _limit loop
    _start := (_date + p_start_time) at time zone _tz;
    begin
      insert into public.appointments
        (owner_id, patient_id, series_id, starts_at, ends_at, price, modality)
      values
        (_uid, p_patient_id, _series_id, _start,
         _start + make_interval(mins => p_duration_minutes), p_price, p_modality)
      returning id into _id;
      _created := _created || jsonb_build_object('id', _id, 'starts_at', _start);
    exception when exclusion_violation then
      _conflicts := _conflicts || jsonb_build_object('starts_at', _start);
    end;
    _count := _count + 1;
    _date := _date + _step;
  end loop;

  return jsonb_build_object('series_id', _series_id, 'created', _created, 'conflicts', _conflicts);
end $$;

-- ----------------------------------------------------------------------------
-- RPC: estender série sem data final (gera ocorrências até p_until_date)
-- ----------------------------------------------------------------------------
create or replace function public.extend_appointment_series(p_series_id uuid, p_until_date date)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  _s public.appointment_series;
  _tz text;
  _step int;
  _date date;
  _start timestamptz;
  _id uuid;
  _created jsonb := '[]'::jsonb;
  _conflicts jsonb := '[]'::jsonb;
  _last timestamptz;
begin
  select * into _s from public.appointment_series where id = p_series_id;
  if not found then
    raise exception 'Série não encontrada.' using errcode = 'P0002';
  end if;
  if _s.ended_at is not null then
    raise exception 'Série encerrada não pode ser estendida.' using errcode = 'P0001';
  end if;
  if p_until_date > greatest(current_date, _s.start_date) + 730 then
    raise exception 'Limite de extensão: 2 anos a partir do início da série.' using errcode = '22023';
  end if;

  select timezone into _tz from public.profiles where id = _s.owner_id;
  _step := case _s.frequency when 'semanal' then 7 when 'quinzenal' then 14 else 28 end;
  select max(starts_at) into _last from public.appointments where series_id = p_series_id;

  _date := _s.start_date;
  if _last is not null then
    while (_date + _s.start_time) at time zone _tz <= _last loop
      _date := _date + _step;
    end loop;
  end if;

  while _date <= p_until_date loop
    _start := (_date + _s.start_time) at time zone _tz;
    begin
      insert into public.appointments
        (owner_id, patient_id, series_id, starts_at, ends_at, price, modality)
      values
        (_s.owner_id, _s.patient_id, _s.id, _start,
         _start + make_interval(mins => _s.duration_minutes), _s.price, _s.modality)
      returning id into _id;
      _created := _created || jsonb_build_object('id', _id, 'starts_at', _start);
    exception when exclusion_violation then
      _conflicts := _conflicts || jsonb_build_object('starts_at', _start);
    end;
    _date := _date + _step;
  end loop;

  update public.appointment_series set until_date = p_until_date where id = p_series_id;
  return jsonb_build_object('series_id', p_series_id, 'created', _created, 'conflicts', _conflicts);
end $$;

-- ----------------------------------------------------------------------------
-- RPC: encerrar série a partir de uma data (alta, interrupção, mudança)
-- Ocorrências futuras ainda não realizadas e sem cobrança são removidas;
-- o histórico (atendidas, faltas, canceladas) permanece.
-- ----------------------------------------------------------------------------
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
    and a.status in ('agendado', 'confirmado')
    and a.starts_at >= (p_from_date::timestamp at time zone _tz);
  get diagnostics _deleted = row_count;

  update public.appointment_series
     set until_date = greatest(start_date, p_from_date - 1),
         ended_at = now()
   where id = p_series_id;

  return _deleted;
end $$;

-- ----------------------------------------------------------------------------
-- RPC: alterar série a partir de uma data (novo dia/horário/valor)
-- Implementado como: encerra a série atual na data e cria uma nova.
-- ----------------------------------------------------------------------------
create or replace function public.change_appointment_series(
  p_series_id uuid,
  p_from_date date,
  p_new_start_date date,
  p_new_time time,
  p_new_duration_minutes int default null,
  p_new_price numeric default null,
  p_new_frequency public.series_frequency default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  _s public.appointment_series;
begin
  select * into _s from public.appointment_series where id = p_series_id;
  if not found then
    raise exception 'Série não encontrada.' using errcode = 'P0002';
  end if;
  if p_new_start_date < p_from_date then
    raise exception 'A nova data inicial deve ser igual ou posterior à data da alteração.' using errcode = '22023';
  end if;

  perform public.end_appointment_series(p_series_id, p_from_date);

  return public.create_appointment_series(
    _s.patient_id,
    coalesce(p_new_frequency, _s.frequency),
    p_new_start_date,
    p_new_time,
    coalesce(p_new_duration_minutes, _s.duration_minutes),
    case when _s.until_date >= p_new_start_date then _s.until_date end,
    null,
    coalesce(p_new_price, _s.price),
    _s.modality
  );
end $$;

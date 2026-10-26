-- =============================================================================
-- 0010 — Locais e horários de atendimento
-- A psicóloga cadastra onde atende (salas, consultórios, "on-line") e em que dias e
-- faixas de horário atende. A agenda usa isso para mostrar os horários livres.
-- Isolamento: tudo por owner_id com RLS, como nas demais tabelas.
-- =============================================================================

-- Locais ------------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  modality public.modality not null default 'presencial',
  address text check (address is null or char_length(address) <= 300),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, name)
);

comment on table public.locations is 'Locais de atendimento da psicóloga (sala, consultório ou on-line).';

create trigger locations_updated_at before update on public.locations
  for each row execute function public.tg_set_updated_at();
create trigger locations_audit after insert or update or delete on public.locations
  for each row execute function public.tg_audit();

alter table public.locations enable row level security;
create policy locations_all_own on public.locations
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
revoke all on public.locations from anon;

-- Horários de atendimento (faixas semanais) --------------------------------------
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  location_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = domingo
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- faixa em minutos do dia, usada para impedir sobreposição no mesmo dia
  -- (greatest evita erro técnico quando o fim vem antes do início: aí vale a regra working_hours_order)
  minutes int4range generated always as (
    int4range((extract(hour from start_time) * 60 + extract(minute from start_time))::int,
              greatest((extract(hour from start_time) * 60 + extract(minute from start_time))::int,
                       (extract(hour from end_time) * 60 + extract(minute from end_time))::int), '[)')
  ) stored,
  unique (id, owner_id),
  foreign key (location_id, owner_id) references public.locations (id, owner_id) on delete cascade,
  constraint working_hours_order check (end_time > start_time),
  constraint working_hours_no_overlap exclude using gist (
    owner_id with =,
    weekday with =,
    minutes with &&
  )
);

comment on table public.working_hours is 'Dias e faixas de horário em que a psicóloga atende, em cada local.';
comment on constraint working_hours_no_overlap on public.working_hours is 'Duas faixas de atendimento no mesmo dia não podem se sobrepor.';

create index working_hours_owner_idx on public.working_hours (owner_id, weekday, start_time);

create trigger working_hours_updated_at before update on public.working_hours
  for each row execute function public.tg_set_updated_at();
create trigger working_hours_audit after insert or update or delete on public.working_hours
  for each row execute function public.tg_audit();

alter table public.working_hours enable row level security;
create policy working_hours_all_own on public.working_hours
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
revoke all on public.working_hours from anon;

-- Local da sessão e da série -------------------------------------------------------
alter table public.appointment_series add column location_id uuid;
alter table public.appointment_series
  add constraint appointment_series_location_fk foreign key (location_id, owner_id)
  references public.locations (id, owner_id) on delete set null (location_id);

alter table public.appointments add column location_id uuid;
alter table public.appointments
  add constraint appointments_location_fk foreign key (location_id, owner_id)
  references public.locations (id, owner_id) on delete set null (location_id);

create index appointments_location_idx on public.appointments (location_id);

-- A visão da agenda passa a trazer o local (colunas novas sempre no fim)
create or replace view public.agenda_items
with (security_invoker = true)
as
select
  a.id, a.owner_id, a.patient_id, a.series_id, a.starts_at, a.ends_at, a.status,
  a.canceled_by, a.cancel_reason, a.late_cancellation, a.charge_no_show, a.price,
  a.modality, a.admin_notes, a.confirmed_at, a.patient_response, a.responded_at,
  p.full_name as patient_name,
  p.social_name as patient_social_name,
  p.phone as patient_phone,
  p.meeting_url as patient_meeting_url,
  p.billing_mode as patient_billing_mode,
  s.frequency as series_frequency,
  a.location_id,
  l.name as location_name,
  l.color as location_color
from public.appointments a
join public.patients p on p.id = a.patient_id
left join public.appointment_series s on s.id = a.series_id
left join public.locations l on l.id = a.location_id;

revoke all on public.agenda_items from anon;
grant select on public.agenda_items to authenticated;

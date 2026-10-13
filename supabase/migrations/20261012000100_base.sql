-- =============================================================================
-- 0001 — Base: extensões, tipos, perfil profissional e trilha de auditoria
-- Princípio: cada linha de dado pertence a UMA profissional (owner_id) e o
-- isolamento é garantido no banco por RLS + chaves estrangeiras compostas.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Tipos -----------------------------------------------------------------------
create type public.fiscal_type as enum ('pf', 'pj');
create type public.patient_status as enum ('ativo', 'inativo', 'alta');
create type public.billing_mode as enum ('por_sessao', 'mensal');
create type public.modality as enum ('presencial', 'online');
create type public.appointment_status as enum ('agendado', 'confirmado', 'atendido', 'faltou', 'cancelado');
create type public.cancel_party as enum ('paciente', 'profissional');
create type public.series_frequency as enum ('semanal', 'quinzenal', 'mensal');

-- Utilitário: updated_at -------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Perfil profissional ---------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null default '' check (char_length(full_name) <= 200),
  crp text check (crp is null or crp ~ '^[0-9]{2}/[0-9]{3,7}$'),
  cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  cnpj text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  fiscal_type public.fiscal_type not null default 'pf',
  contact_email text check (contact_email is null or char_length(contact_email) <= 200),
  phone text check (phone is null or phone ~ '^[0-9]{10,13}$'),
  address text check (address is null or char_length(address) <= 300),
  city text check (city is null or char_length(city) <= 120),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  timezone text not null default 'America/Sao_Paulo',
  session_minutes int not null default 50 check (session_minutes between 10 and 300),
  buffer_minutes int not null default 10 check (buffer_minutes between 0 and 120),
  default_price numeric(10,2) check (default_price is null or default_price >= 0),
  cancellation_hours int not null default 24 check (cancellation_hours between 0 and 168),
  agenda_start time not null default '07:00',
  agenda_end time not null default '21:00',
  retention_years int not null default 5 check (retention_years between 5 and 30),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_agenda_window check (agenda_end > agenda_start)
);

comment on table public.profiles is 'Perfil da psicóloga (1:1 com auth.users). Nome e CRP aparecem em documentos e na página de confirmação.';

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Sem INSERT/DELETE para clientes: a linha é criada pelo gatilho abaixo e
-- nunca é apagada pela aplicação (retenção obrigatória de prontuários).

-- Cria o perfil automaticamente quando a conta é criada no Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, contact_email)
  values (
    new.id,
    coalesce(left(new.raw_user_meta_data ->> 'full_name', 200), ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Trilha de auditoria (sem conteúdo clínico) ------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  actor text not null,                 -- 'profissional' | 'paciente-link' | 'sistema'
  action text not null,                -- INSERT | UPDATE | DELETE | EXPORT | IMPORT | ...
  table_name text not null,
  record_id uuid,
  changed_fields text[],               -- apenas nomes de colunas, nunca valores
  at timestamptz not null default now()
);

create index audit_log_owner_at_idx on public.audit_log (owner_id, at desc);

alter table public.audit_log enable row level security;
create policy audit_log_select_own on public.audit_log
  for select to authenticated using (owner_id = (select auth.uid()));
-- Nenhuma política de escrita: inserções apenas por funções SECURITY DEFINER.

comment on table public.audit_log is 'Registro de operações. Guarda somente tabela, id, ação e NOMES de colunas alteradas — nunca o conteúdo.';

create or replace function public.tg_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _row jsonb;
  _old jsonb;
  _owner uuid;
  _fields text[];
  _actor text;
begin
  if tg_op = 'DELETE' then
    _row := to_jsonb(old);
  else
    _row := to_jsonb(new);
  end if;

  _owner := coalesce((_row ->> 'owner_id')::uuid, (_row ->> 'id')::uuid);

  if tg_op = 'UPDATE' then
    _old := to_jsonb(old);
    select array_agg(k order by k) into _fields
    from jsonb_object_keys(_row) as k
    where k not in ('updated_at') and (_row -> k) is distinct from (_old -> k);
    if _fields is null then
      return new; -- nada mudou de fato
    end if;
  end if;

  _actor := coalesce(nullif(current_setting('app.actor', true), ''),
                     case when auth.uid() is null then 'sistema' else 'profissional' end);

  insert into public.audit_log (owner_id, actor, action, table_name, record_id, changed_fields)
  values (_owner, _actor, tg_op, tg_table_name, (_row ->> 'id')::uuid, _fields);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

revoke execute on function public.tg_audit() from public, anon, authenticated;

create trigger profiles_audit after insert or update on public.profiles
  for each row execute function public.tg_audit();

-- Anônimos nunca acessam tabelas diretamente (só RPCs específicas)
revoke all on public.profiles, public.audit_log from anon;
revoke insert, delete, truncate on public.profiles from authenticated;
revoke insert, update, delete, truncate on public.audit_log from authenticated;

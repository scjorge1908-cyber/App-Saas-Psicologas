-- =============================================================================
-- Agendamento pelo paciente (pedido do Jorge, 28/10/2026)
-- * A psicóloga escolhe horários livres e a frequência e gera um link para UMA pessoa.
-- * O paciente (anônimo) vê só os horários escolhidos que ainda estão livres, escolhe um
--   e preenche o cadastro (nascimento, e-mail, CPF, endereço, nota fiscal).
-- * O pedido fica "pendente" e reserva o horário; só quando a psicóloga APROVA o paciente
--   e as sessões entram na agenda (o app cria). Recusado, o horário volta a ficar livre.
-- * Como na confirmação: o token (192 bits) aparece uma vez; o banco guarda só o SHA-256.
-- =============================================================================

create table public.booking_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  token_hash bytea not null unique,
  label text check (label is null or char_length(label) <= 80),
  frequency text not null check (frequency in ('nao', 'semanal', 'quinzenal')),
  occurrences int check (occurrences is null or occurrences between 1 and 104),
  session_minutes int not null check (session_minutes between 10 and 300),
  price numeric(10,2) check (price is null or price >= 0),
  expires_at timestamptz not null,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
comment on table public.booking_links is 'Link de agendamento para um paciente: horários oferecidos, frequência, duração e valor.';

create table public.booking_link_slots (
  link_id uuid not null,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location_id uuid,
  primary key (link_id, starts_at),
  foreign key (link_id, owner_id) references public.booking_links (id, owner_id) on delete cascade,
  foreign key (location_id, owner_id) references public.locations (id, owner_id) on delete set null (location_id),
  check (ends_at > starts_at)
);

create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  link_id uuid not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location_id uuid,
  patient_data jsonb not null check (jsonb_typeof(patient_data) = 'object' and octet_length(patient_data::text) <= 8000),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado')),
  patient_id uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (link_id, owner_id) references public.booking_links (id, owner_id) on delete cascade,
  foreign key (location_id, owner_id) references public.locations (id, owner_id) on delete set null (location_id),
  foreign key (patient_id, owner_id) references public.patients (id, owner_id) on delete set null (patient_id),
  check (ends_at > starts_at)
);
comment on table public.booking_requests is 'Pedido feito pelo paciente no link: horário escolhido e cadastro; a psicóloga aprova ou recusa.';

create index booking_links_owner_idx on public.booking_links (owner_id, created_at desc);
create index booking_requests_owner_idx on public.booking_requests (owner_id, status, starts_at);

create trigger booking_links_audit after insert or update or delete on public.booking_links
  for each row execute function public.tg_audit();
create trigger booking_requests_audit after insert or update or delete on public.booking_requests
  for each row execute function public.tg_audit();

alter table public.booking_links enable row level security;
alter table public.booking_link_slots enable row level security;
alter table public.booking_requests enable row level security;

-- A psicóloga vê os próprios links e pedidos. Criar link: só pela função (guarda o hash).
create policy booking_links_select_own on public.booking_links for select to authenticated using (owner_id = (select auth.uid()));
create policy booking_links_update_own on public.booking_links for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy booking_link_slots_select_own on public.booking_link_slots for select to authenticated using (owner_id = (select auth.uid()));
create policy booking_requests_select_own on public.booking_requests for select to authenticated using (owner_id = (select auth.uid()));
create policy booking_requests_update_own on public.booking_requests for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.booking_links, public.booking_link_slots, public.booking_requests from anon, authenticated;
grant select on public.booking_links, public.booking_link_slots, public.booking_requests to authenticated;
grant update (canceled_at) on public.booking_links to authenticated;           -- cancelar o link
grant update (status, patient_id, decided_at) on public.booking_requests to authenticated; -- aprovar ou recusar

-- ----------------------------------------------------------------------------
-- O horário está livre para a profissional? (sem sessão ativa, sem outro pedido
-- pendente, sem bloqueio de agenda e no futuro)
-- ----------------------------------------------------------------------------
create or replace function public._horario_livre(p_owner uuid, p_ini timestamptz, p_fim timestamptz, p_ignorar_link uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with tz as (select coalesce(timezone, 'America/Sao_Paulo') as z from public.profiles where id = p_owner)
  select p_ini > now()
    and not exists (select 1 from public.appointments a
                     where a.owner_id = p_owner and a.status <> 'cancelado'
                       and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_ini, p_fim, '[)'))
    and not exists (select 1 from public.booking_requests r
                     where r.owner_id = p_owner and r.status = 'pendente'
                       and r.link_id is distinct from p_ignorar_link
                       and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(p_ini, p_fim, '[)'))
    and not exists (select 1 from public.schedule_blocks b, tz
                     where b.owner_id = p_owner
                       and (p_ini at time zone tz.z)::date between b.starts_on and b.ends_on
                       and (b.start_time is null
                            or (b.start_time < (p_fim at time zone tz.z)::time and b.end_time > (p_ini at time zone tz.z)::time)));
$$;
revoke execute on function public._horario_livre(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Psicóloga gera o link
-- ----------------------------------------------------------------------------
create or replace function public.create_booking_link(
  p_slots jsonb, p_frequency text, p_occurrences int, p_minutes int, p_price numeric, p_label text, p_days int default 7)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _token text;
  _id uuid;
  _s jsonb;
  _ini timestamptz;
  _fim timestamptz;
  _loc uuid;
  _n int := 0;
begin
  if _uid is null then raise exception 'Não autenticado' using errcode = '42501'; end if;
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    raise exception 'Escolha pelo menos um horário.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_slots) > 60 then
    raise exception 'No máximo 60 horários por link.' using errcode = '22023';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'O link vale de 1 a 30 dias.' using errcode = '22023';
  end if;

  _token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');
  insert into public.booking_links (owner_id, token_hash, label, frequency, occurrences, session_minutes, price, expires_at)
  values (_uid, extensions.digest(_token, 'sha256'), nullif(btrim(coalesce(p_label, '')), ''), p_frequency,
          case when p_frequency = 'nao' then null else p_occurrences end, p_minutes, p_price, now() + make_interval(days => p_days))
  returning id into _id;

  for _s in select * from jsonb_array_elements(p_slots) loop
    _ini := (_s->>'starts_at')::timestamptz;
    _fim := (_s->>'ends_at')::timestamptz;
    _loc := nullif(_s->>'location_id', '')::uuid;
    if _ini <= now() then raise exception 'Há horário que já passou.' using errcode = '22023'; end if;
    if _loc is not null and not exists (select 1 from public.locations where id = _loc and owner_id = _uid) then
      raise exception 'Sala não encontrada.' using errcode = 'P0002';
    end if;
    insert into public.booking_link_slots (link_id, owner_id, starts_at, ends_at, location_id)
    values (_id, _uid, _ini, _fim, _loc) on conflict do nothing;
    _n := _n + 1;
  end loop;

  return _token;
end $$;
revoke execute on function public.create_booking_link(jsonb, text, int, int, numeric, text, int) from public, anon;
grant execute on function public.create_booking_link(jsonb, text, int, int, numeric, text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- Paciente abre o link (anônimo): só os horários escolhidos que ainda estão livres
-- ----------------------------------------------------------------------------
create or replace function public.get_booking(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _l public.booking_links;
  _p public.profiles;
  _r public.booking_requests;
  _slots jsonb;
begin
  if p_token is null or char_length(p_token) <> 32 then return jsonb_build_object('state', 'invalido'); end if;
  select * into _l from public.booking_links where token_hash = extensions.digest(p_token, 'sha256');
  if not found then return jsonb_build_object('state', 'invalido'); end if;
  select * into _p from public.profiles where id = _l.owner_id;

  select * into _r from public.booking_requests where link_id = _l.id;
  if found then
    return jsonb_build_object('state', 'usado', 'status', _r.status, 'starts_at', _r.starts_at,
      'professional_name', _p.full_name, 'timezone', _p.timezone);
  end if;
  if _l.canceled_at is not null then return jsonb_build_object('state', 'cancelado', 'professional_name', _p.full_name); end if;
  if now() >= _l.expires_at then return jsonb_build_object('state', 'expirado', 'professional_name', _p.full_name); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'starts_at', s.starts_at, 'ends_at', s.ends_at,
           'location_name', loc.name, 'modality', coalesce(loc.modality::text, 'presencial'))
         order by s.starts_at), '[]'::jsonb)
    into _slots
    from public.booking_link_slots s
    left join public.locations loc on loc.id = s.location_id
   where s.link_id = _l.id and public._horario_livre(_l.owner_id, s.starts_at, s.ends_at);

  return jsonb_build_object(
    'state', 'aberto',
    'professional_name', _p.full_name,
    'professional_crp', _p.crp,
    'timezone', _p.timezone,
    'frequency', _l.frequency,
    'session_minutes', _l.session_minutes,
    'expires_at', _l.expires_at,
    'slots', _slots);
end $$;

-- ----------------------------------------------------------------------------
-- Paciente pede o horário e manda o cadastro (anônimo)
-- ----------------------------------------------------------------------------
create or replace function public.request_booking(p_token text, p_starts_at timestamptz, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _l public.booking_links;
  _s public.booking_link_slots;
  _d jsonb := '{}'::jsonb;
  _k text;
  _v text;
  _permitidos text[] := array['full_name', 'phone', 'cpf', 'birth_date', 'email', 'cep', 'street', 'address_number',
    'address_complement', 'neighborhood', 'city', 'uf', 'nf_tomador', 'payer_tipo', 'payer_name', 'payer_cpf', 'payer_cnpj',
    'payer_im', 'payer_email', 'payer_phone', 'payer_cep', 'payer_street', 'payer_number', 'payer_complement',
    'payer_neighborhood', 'payer_city', 'payer_uf'];
begin
  if p_token is null or char_length(p_token) <> 32 then return jsonb_build_object('ok', false, 'state', 'invalido'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Cadastro inválido.' using errcode = '22023'; end if;

  select * into _l from public.booking_links where token_hash = extensions.digest(p_token, 'sha256') for update;
  if not found then return jsonb_build_object('ok', false, 'state', 'invalido'); end if;
  if exists (select 1 from public.booking_requests where link_id = _l.id) then return jsonb_build_object('ok', false, 'state', 'usado'); end if;
  if _l.canceled_at is not null then return jsonb_build_object('ok', false, 'state', 'cancelado'); end if;
  if now() >= _l.expires_at then return jsonb_build_object('ok', false, 'state', 'expirado'); end if;

  select * into _s from public.booking_link_slots where link_id = _l.id and starts_at = p_starts_at;
  if not found then return jsonb_build_object('ok', false, 'state', 'horario_invalido'); end if;

  -- Só os campos do cadastro, texto curto
  for _k, _v in select key, value #>> '{}' from jsonb_each(p_data) loop
    if _k = any(_permitidos) and _v is not null and btrim(_v) <> '' then
      _d := _d || jsonb_build_object(_k, left(btrim(_v), 200));
    end if;
  end loop;

  -- Obrigatórios: nome, celular, nascimento, e-mail, CPF e endereço (só o complemento é opcional)
  if char_length(coalesce(_d->>'full_name', '')) < 3
     or coalesce(_d->>'phone', '') !~ '^[0-9]{10,11}$'
     or coalesce(_d->>'cpf', '') !~ '^[0-9]{11}$'
     or coalesce(_d->>'email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or coalesce(_d->>'birth_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or coalesce(_d->>'cep', '') !~ '^[0-9]{8}$'
     or _d->>'street' is null or _d->>'address_number' is null or _d->>'neighborhood' is null or _d->>'city' is null
     or coalesce(_d->>'uf', '') !~ '^[A-Z]{2}$' then
    return jsonb_build_object('ok', false, 'state', 'dados_incompletos');
  end if;
  if (_d->>'birth_date')::date > current_date or (_d->>'birth_date')::date < date '1900-01-01' then
    return jsonb_build_object('ok', false, 'state', 'dados_incompletos');
  end if;

  -- Trava a agenda da profissional enquanto confere (dois pedidos ao mesmo tempo)
  perform pg_advisory_xact_lock(hashtext(_l.owner_id::text));
  if not public._horario_livre(_l.owner_id, _s.starts_at, _s.ends_at, _l.id) then
    return jsonb_build_object('ok', false, 'state', 'ocupado');
  end if;

  perform set_config('app.actor', 'paciente-link', true);
  insert into public.booking_requests (owner_id, link_id, starts_at, ends_at, location_id, patient_data)
  values (_l.owner_id, _l.id, _s.starts_at, _s.ends_at, _s.location_id, _d);
  return jsonb_build_object('ok', true, 'state', 'pendente', 'starts_at', _s.starts_at);
end $$;

revoke execute on function public.get_booking(text) from public;
revoke execute on function public.request_booking(text, timestamptz, jsonb) from public;
grant execute on function public.get_booking(text) to anon, authenticated;
grant execute on function public.request_booking(text, timestamptz, jsonb) to anon, authenticated;

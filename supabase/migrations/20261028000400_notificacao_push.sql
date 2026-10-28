-- =============================================================================
-- Notificação no celular (pedido do Jorge, 28/10/2026)
-- * Cada celular da psicóloga guarda aqui o seu token do Firebase (FCM).
-- * Quando chega um pedido pelo link, o banco chama a função "notificar-pedido",
--   que manda o aviso ao celular. Sem nome do paciente (só dia e horário).
-- * O aviso sai uma vez por pedido (booking_notifications) e nunca impede o pedido:
--   se algo falhar aqui, o pedido continua salvo.
-- =============================================================================

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  token text not null unique check (char_length(token) between 20 and 4096),
  platform text not null default 'android' check (platform in ('android', 'ios', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.device_tokens is 'Celulares da psicóloga que recebem notificação (token do Firebase).';

create trigger device_tokens_updated_at before update on public.device_tokens
  for each row execute function public.tg_set_updated_at();

alter table public.device_tokens enable row level security;
create policy device_tokens_all_own on public.device_tokens for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.device_tokens from anon;

-- Um aviso por pedido (a função confere aqui antes de mandar)
create table public.booking_notifications (
  request_id uuid primary key references public.booking_requests (id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table public.booking_notifications enable row level security;
revoke all on public.booking_notifications from anon, authenticated;

-- Endereço das funções do servidor (só o banco lê)
create table public._config (k text primary key, v text not null);
alter table public._config enable row level security;
revoke all on public._config from anon, authenticated;
insert into public._config (k, v) values ('functions_url', 'https://sstuqkxatcbusxkqpfvx.supabase.co/functions/v1')
  on conflict (k) do nothing;

-- pg_net faz a chamada HTTP sem esperar a resposta. Em bancos de teste sem pg_net, nada acontece.
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net indisponível: notificações desligadas neste banco';
end $$;

create or replace function public.tg_booking_requests_notificar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _url text;
begin
  if to_regnamespace('net') is null then return new; end if;
  select v into _url from public._config where k = 'functions_url';
  if _url is null then return new; end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using _url || '/notificar-pedido', jsonb_build_object('request_id', new.id), '{"Content-Type": "application/json"}'::jsonb;
  exception when others then
    raise warning 'notificação não enviada: %', sqlerrm; -- nunca impede o pedido
  end;
  return new;
end $$;
revoke execute on function public.tg_booking_requests_notificar() from public, anon, authenticated;

create trigger booking_requests_notificar after insert on public.booking_requests
  for each row execute function public.tg_booking_requests_notificar();

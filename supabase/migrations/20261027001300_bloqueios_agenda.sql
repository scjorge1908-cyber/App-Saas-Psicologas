-- Bloqueio de agenda (pedido do Jorge, 27/10/2026): férias, feriados, folgas e outros.
-- Um bloqueio vale de starts_on a ends_on; sem horário = dia inteiro; com horário = só aquela faixa em cada dia.
-- Nos dias/horários bloqueados a agenda não oferece horários LIVRES e não deixa marcar sessão nova.
-- Sessões já marcadas no período não são apagadas: a agenda avisa para mover ou cancelar.
create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  kind text not null check (kind in ('ferias', 'feriado', 'folga', 'outro')),
  starts_on date not null,
  ends_on date not null,
  start_time time,
  end_time time,
  reason text check (reason is null or char_length(reason) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_blocks_order check (ends_on >= starts_on),
  constraint schedule_blocks_period check (ends_on - starts_on <= 366),
  constraint schedule_blocks_hours check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and end_time > start_time)
  )
);

comment on table public.schedule_blocks is 'Bloqueios de agenda da psicóloga: férias, feriados, folgas. Sem horário = dia inteiro.';

create index schedule_blocks_owner_idx on public.schedule_blocks (owner_id, starts_on);

create trigger schedule_blocks_updated_at before update on public.schedule_blocks
  for each row execute function public.tg_set_updated_at();
create trigger schedule_blocks_audit after insert or update or delete on public.schedule_blocks
  for each row execute function public.tg_audit();

alter table public.schedule_blocks enable row level security;
create policy schedule_blocks_all_own on public.schedule_blocks
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
revoke all on public.schedule_blocks from anon;

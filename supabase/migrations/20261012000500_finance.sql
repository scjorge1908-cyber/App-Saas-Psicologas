-- =============================================================================
-- 0005 — Financeiro (controle, não processamento de pagamentos) e NFS-e
-- * charges   = valores a receber (gerados automaticamente por sessão atendida
--               ou falta cobrada, ou lançados manualmente: mensalidade, pacote)
-- * payments  = recebimentos (Pix, dinheiro, cartão...) registrados pela
--               profissional; campos para o Receita Saúde (PF)
-- * expenses  = despesas do consultório
-- * invoices  = acompanhamento de NFS-e emitidas FORA do sistema (status +
--               anexos PDF/XML). Este módulo NÃO emite notas.
-- =============================================================================

create type public.payment_method as enum ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'transferencia', 'boleto', 'outro');
create type public.receita_saude_status as enum ('pendente', 'emitido', 'nao_aplicavel');
create type public.invoice_status as enum ('a_emitir', 'emitida', 'cancelada');

-- Valores a receber ----------------------------------------------------------------
create table public.charges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  patient_id uuid not null,
  appointment_id uuid,
  description text not null check (char_length(description) between 1 and 200),
  amount numeric(10,2) not null check (amount > 0),
  due_date date not null default current_date,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (patient_id, owner_id) references public.patients (id, owner_id) on delete restrict,
  foreign key (appointment_id, owner_id) references public.appointments (id, owner_id) on delete restrict
);

create unique index charges_appointment_uniq on public.charges (appointment_id) where appointment_id is not null;
create index charges_owner_due_idx on public.charges (owner_id, due_date);
create index charges_patient_idx on public.charges (patient_id);

create trigger charges_updated_at before update on public.charges
  for each row execute function public.tg_set_updated_at();
create trigger charges_audit after insert or update or delete on public.charges
  for each row execute function public.tg_audit();

alter table public.charges enable row level security;
create policy charges_all_own on public.charges
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Recebimentos -----------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  patient_id uuid not null,
  charge_id uuid,
  amount numeric(10,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method public.payment_method not null default 'pix',
  payer_name text check (payer_name is null or char_length(payer_name) <= 200),
  payer_cpf text check (payer_cpf is null or payer_cpf ~ '^[0-9]{11}$'),
  receita_saude_status public.receita_saude_status not null default 'pendente',
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (patient_id, owner_id) references public.patients (id, owner_id) on delete restrict,
  foreign key (charge_id, owner_id) references public.charges (id, owner_id) on delete restrict
);

create index payments_owner_paid_idx on public.payments (owner_id, paid_on);
create index payments_charge_idx on public.payments (charge_id);

-- Pagamento não pode exceder o saldo da cobrança, nem ir para cobrança cancelada
create or replace function public.tg_payments_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _charge public.charges;
  _paid numeric;
begin
  if new.charge_id is not null then
    select * into _charge from public.charges where id = new.charge_id for update;
    if _charge.canceled_at is not null then
      raise exception 'Cobrança cancelada não aceita pagamentos.' using errcode = 'P0001';
    end if;
    if _charge.patient_id <> new.patient_id then
      raise exception 'O pagamento deve ser do mesmo paciente da cobrança.' using errcode = 'P0001';
    end if;
    select coalesce(sum(amount), 0) into _paid from public.payments
     where charge_id = new.charge_id and id <> new.id;
    if _paid + new.amount > _charge.amount then
      raise exception 'Pagamento (R$ %) excede o saldo da cobrança (R$ %).',
        to_char(new.amount, 'FM999G990D00'), to_char(_charge.amount - _paid, 'FM999G990D00')
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger payments_validate before insert or update on public.payments
  for each row execute function public.tg_payments_validate();
create trigger payments_updated_at before update on public.payments
  for each row execute function public.tg_set_updated_at();
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function public.tg_audit();

alter table public.payments enable row level security;
create policy payments_all_own on public.payments
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Cobrança com pagamento não pode ser cancelada/reduzida abaixo do pago
create or replace function public.tg_charges_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _paid numeric;
begin
  select coalesce(sum(amount), 0) into _paid from public.payments where charge_id = old.id;
  if tg_op = 'DELETE' then
    if _paid > 0 then
      raise exception 'Cobrança com pagamento registrado não pode ser excluída. Exclua o pagamento antes.'
        using errcode = 'P0001';
    end if;
    return old;
  end if;
  if new.canceled_at is not null and old.canceled_at is null and _paid > 0 then
    raise exception 'Cobrança com pagamento registrado não pode ser cancelada.' using errcode = 'P0001';
  end if;
  if new.amount < _paid then
    raise exception 'O valor não pode ser menor que o já recebido (R$ %).', to_char(_paid, 'FM999G990D00')
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger charges_validate before update or delete on public.charges
  for each row execute function public.tg_charges_validate();

-- Despesas -------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  description text not null check (char_length(description) between 1 and 200),
  category text not null default 'outros' check (char_length(category) between 1 and 60),
  amount numeric(10,2) not null check (amount > 0),
  expense_date date not null default current_date,
  paid boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expenses_owner_date_idx on public.expenses (owner_id, expense_date);

create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.tg_set_updated_at();
create trigger expenses_audit after insert or update or delete on public.expenses
  for each row execute function public.tg_audit();

alter table public.expenses enable row level security;
create policy expenses_all_own on public.expenses
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- NFS-e (acompanhamento) ----------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  patient_id uuid not null,
  charge_id uuid,
  payment_id uuid,
  competence date not null default current_date,
  amount numeric(10,2) not null check (amount > 0),
  status public.invoice_status not null default 'a_emitir',
  number text check (number is null or char_length(number) <= 30),
  access_key text check (access_key is null or access_key ~ '^[0-9]{44,50}$'),
  issued_on date,
  pdf_attachment_id uuid,
  xml_attachment_id uuid,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (patient_id, owner_id) references public.patients (id, owner_id) on delete restrict,
  foreign key (charge_id, owner_id) references public.charges (id, owner_id) on delete restrict,
  foreign key (payment_id, owner_id) references public.payments (id, owner_id) on delete restrict,
  foreign key (pdf_attachment_id, owner_id) references public.attachments (id, owner_id) on delete restrict,
  foreign key (xml_attachment_id, owner_id) references public.attachments (id, owner_id) on delete restrict,
  constraint invoices_emitted_has_number check (status = 'a_emitir' or (number is not null and issued_on is not null))
);

comment on table public.invoices is 'Controle de NFS-e emitidas externamente (portal municipal ou Emissor Nacional). O sistema não emite nem simula notas.';

create index invoices_owner_status_idx on public.invoices (owner_id, status, competence);

create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.tg_set_updated_at();
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function public.tg_audit();

alter table public.invoices enable row level security;
create policy invoices_all_own on public.invoices
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.charges, public.payments, public.expenses, public.invoices from anon;

-- Geração automática de cobrança a partir do status da sessão ----------------------------
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
    -- reativa cobrança cancelada / ajusta valor
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

create trigger appointments_charge after insert or update of status, charge_no_show, price on public.appointments
  for each row execute function public.tg_appointments_charge();

-- Exclusão de paciente: considerar também dados financeiros ------------------------------
create or replace function public.tg_patients_protect_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.record_entries where patient_id = old.id)
     or exists (select 1 from public.documents where patient_id = old.id)
     or exists (select 1 from public.attachments where patient_id = old.id)
     or exists (select 1 from public.appointments where patient_id = old.id and status in ('atendido', 'faltou'))
     or exists (select 1 from public.charges where patient_id = old.id)
     or exists (select 1 from public.payments where patient_id = old.id)
     or exists (select 1 from public.invoices where patient_id = old.id) then
    raise exception 'Paciente com prontuário, atendimentos ou lançamentos financeiros não pode ser excluído. Use "Dar alta" ou "Inativar".'
      using errcode = 'P0001';
  end if;
  delete from public.appointments where patient_id = old.id;
  delete from public.appointment_series where patient_id = old.id;
  return old;
end $$;

-- Saldos (view com RLS do usuário) ----------------------------------------------------
create view public.charge_balances
with (security_invoker = true)
as
select
  c.id,
  c.owner_id,
  c.patient_id,
  c.appointment_id,
  c.description,
  c.amount,
  c.due_date,
  c.canceled_at,
  c.created_at,
  coalesce(p.paid, 0)::numeric(10,2) as paid,
  case when c.canceled_at is not null then 0 else c.amount - coalesce(p.paid, 0) end::numeric(10,2) as balance,
  case
    when c.canceled_at is not null then 'cancelada'
    when coalesce(p.paid, 0) >= c.amount then 'paga'
    when coalesce(p.paid, 0) > 0 then 'parcial'
    else 'aberta'
  end as status,
  (c.canceled_at is null and coalesce(p.paid, 0) < c.amount and c.due_date < current_date) as overdue
from public.charges c
left join (
  select charge_id, sum(amount) as paid from public.payments where charge_id is not null group by charge_id
) p on p.charge_id = c.id;

revoke all on public.charge_balances from anon;
grant select on public.charge_balances to authenticated;

-- Relatório financeiro mensal ------------------------------------------------------------
create or replace function public.financial_report(p_from date, p_to date)
returns table (
  month date,
  billed numeric,
  received numeric,
  expenses numeric,
  net numeric,
  sessions_attended bigint,
  no_shows bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as m
  ),
  tz as (
    select timezone from public.profiles where id = auth.uid()
  )
  select
    m.m,
    coalesce((select sum(c.amount) from public.charges c
               where c.canceled_at is null and date_trunc('month', c.due_date) = m.m), 0)::numeric(12,2),
    coalesce((select sum(p.amount) from public.payments p
               where date_trunc('month', p.paid_on) = m.m), 0)::numeric(12,2),
    coalesce((select sum(e.amount) from public.expenses e
               where date_trunc('month', e.expense_date) = m.m), 0)::numeric(12,2),
    (coalesce((select sum(p.amount) from public.payments p
               where date_trunc('month', p.paid_on) = m.m), 0)
     - coalesce((select sum(e.amount) from public.expenses e
               where date_trunc('month', e.expense_date) = m.m), 0))::numeric(12,2),
    (select count(*) from public.appointments a, tz
      where a.status = 'atendido'
        and date_trunc('month', (a.starts_at at time zone tz.timezone)) = m.m),
    (select count(*) from public.appointments a, tz
      where a.status = 'faltou'
        and date_trunc('month', (a.starts_at at time zone tz.timezone)) = m.m)
  from months m
  order by m.m
$$;

-- Painel ----------------------------------------------------------------------------------
create or replace function public.dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with tz as (select timezone from public.profiles where id = auth.uid()),
  today as (select (now() at time zone tz.timezone)::date as d from tz)
  select jsonb_build_object(
    'today', (select d from today),
    'sessions_today', (select count(*) from public.appointments a, tz, today
                        where a.status <> 'cancelado'
                          and (a.starts_at at time zone tz.timezone)::date = today.d),
    'to_confirm_48h', (select count(*) from public.appointments a
                        where a.status = 'agendado'
                          and a.starts_at between now() and now() + interval '48 hours'),
    'to_register', (select count(*) from public.appointments a
                     where a.status in ('agendado', 'confirmado') and a.ends_at < now()),
    'receivable', (select coalesce(sum(balance), 0) from public.charge_balances where status in ('aberta', 'parcial')),
    'overdue', (select coalesce(sum(balance), 0) from public.charge_balances where overdue),
    'received_month', (select coalesce(sum(p.amount), 0) from public.payments p, today
                        where date_trunc('month', p.paid_on) = date_trunc('month', today.d)),
    'active_patients', (select count(*) from public.patients where status = 'ativo'),
    'invoices_pending', (select count(*) from public.invoices where status = 'a_emitir'),
    'receita_saude_pending', (select count(*) from public.payments p, public.profiles pr
                               where pr.id = auth.uid() and pr.fiscal_type = 'pf'
                                 and p.receita_saude_status = 'pendente')
  )
$$;

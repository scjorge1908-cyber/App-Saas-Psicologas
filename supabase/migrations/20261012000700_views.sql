-- =============================================================================
-- 0007 — Visões para listas (com RLS do usuário via security_invoker)
-- =============================================================================

create view public.agenda_items
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
  s.frequency as series_frequency
from public.appointments a
join public.patients p on p.id = a.patient_id
left join public.appointment_series s on s.id = a.series_id;

revoke all on public.agenda_items from anon;
grant select on public.agenda_items to authenticated;

create or replace view public.charge_balances
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
  (c.canceled_at is null and coalesce(p.paid, 0) < c.amount and c.due_date < current_date) as overdue,
  pt.full_name as patient_name,
  pt.phone as patient_phone
from public.charges c
join public.patients pt on pt.id = c.patient_id
left join (
  select charge_id, sum(amount) as paid from public.payments where charge_id is not null group by charge_id
) p on p.charge_id = c.id;

create view public.payment_items
with (security_invoker = true)
as
select pm.*, pt.full_name as patient_name, pt.cpf as patient_cpf,
       c.description as charge_description
from public.payments pm
join public.patients pt on pt.id = pm.patient_id
left join public.charges c on c.id = pm.charge_id;

revoke all on public.payment_items from anon;
grant select on public.payment_items to authenticated;

create view public.invoice_items
with (security_invoker = true)
as
select i.*, pt.full_name as patient_name
from public.invoices i
join public.patients pt on pt.id = i.patient_id;

revoke all on public.invoice_items from anon;
grant select on public.invoice_items to authenticated;

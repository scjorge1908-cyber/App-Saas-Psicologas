-- Agenda mostra idade e aniversário do paciente no card da sessão (layout Stitch aprovado por Jorge).
-- Só acrescenta a coluna patient_birth_date ao final da visão; o resto fica igual.
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
  l.color as location_color,
  p.birth_date as patient_birth_date
from public.appointments a
join public.patients p on p.id = a.patient_id
left join public.appointment_series s on s.id = a.series_id
left join public.locations l on l.id = a.location_id;

revoke all on public.agenda_items from anon;
grant select on public.agenda_items to authenticated;

-- Situação da confirmação na tela "Confirmar agenda" (pedido do Jorge, 27/10/2026, v27):
-- em vez de "Agendada", mostrar "Confirmado", "Aguardando confirmação" (link já gerado e enviado pelo WhatsApp)
-- ou "Falta enviar link". O link vive em confirmation_tokens, que o app não lê diretamente (RLS sem acesso);
-- esta função devolve só a data em que o link válido foi gerado, e só para a dona da sessão.
create or replace function public._link_confirmacao_em(p_appointment_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select ct.created_at
  from public.confirmation_tokens ct
  where ct.appointment_id = p_appointment_id
    and ct.owner_id = auth.uid()
    and ct.expires_at > now()
$$;
revoke execute on function public._link_confirmacao_em(uuid) from public, anon;
grant execute on function public._link_confirmacao_em(uuid) to authenticated;

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
  p.birth_date as patient_birth_date,
  public._link_confirmacao_em(a.id) as confirmation_link_at
from public.appointments a
join public.patients p on p.id = a.patient_id
left join public.appointment_series s on s.id = a.series_id
left join public.locations l on l.id = a.location_id;

revoke all on public.agenda_items from anon;
grant select on public.agenda_items to authenticated;

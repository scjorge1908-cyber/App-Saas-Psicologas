import { publicOrigin } from '../../lib/supabase';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { AgendaItem } from '../../lib/types';
import * as api from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { formatLongDate, formatPhone, formatTime, minutesBetween, money, zonedParts, zonedToUtc } from '../../lib/format';
import { confirmationUrl, reminderText, whatsappLink } from '../../lib/messages';
import { useProfile } from '../../auth/AuthProvider';
import { Button, Dialog, Field, Input, Select, StatusBadge, TextField, Textarea, useConfirm, useToast } from '../ui';
import { IconWhats } from '../icons';

const FREQ_LABEL = { semanal: 'semanal', quinzenal: 'quinzenal', mensal: 'a cada 4 semanas' } as const;

export function useInvalidateAgenda() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ['agenda'] }),
    qc.invalidateQueries({ queryKey: ['dashboard'] }),
    qc.invalidateQueries({ queryKey: ['to-register'] }),
    qc.invalidateQueries({ queryKey: ['patient-agenda'] }),
    qc.invalidateQueries({ queryKey: ['charges'] }),
  ]);
}

/** Abre o WhatsApp com lembrete + link de confirmação (gera o link na hora). */
export async function openReminder(item: AgendaItem, tz: string, professional: string) {
  const token = await api.createConfirmationLink(item.id);
  const link = confirmationUrl(publicOrigin(), token);
  const text = reminderText({ patientName: item.patient_social_name || item.patient_name, startsAt: item.starts_at, tz, professionalName: professional, link, modality: item.modality });
  return { link, text, wa: whatsappLink(item.patient_phone, text) };
}

type Mode = 'view' | 'cancel' | 'reschedule' | 'noshow';

export function AppointmentSheet({ item, onClose }: { item: AgendaItem | null; onClose: () => void }) {
  const { profile, tz } = useProfile();
  const invalidate = useInvalidateAgenda();
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [cancelBy, setCancelBy] = useState<'paciente' | 'profissional'>('paciente');
  const [reason, setReason] = useState('');
  const [chargeNoShow, setChargeNoShow] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [reminder, setReminder] = useState<{ link: string; text: string; wa: string | null } | null>(null);

  if (!item) return null;
  const started = new Date(item.starts_at).getTime() <= Date.now();
  const active = item.status === 'agendado' || item.status === 'confirmado';
  const local = zonedParts(item.starts_at, tz);
  const duration = minutesBetween(item.starts_at, item.ends_at);
  const proLine = `${profile?.full_name ?? ''}${profile?.crp ? `, CRP ${profile.crp}` : ''}`;

  const close = () => { setMode('view'); setReminder(null); setReason(''); onClose(); };

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      await invalidate();
      toast(ok);
      close();
    } catch (e) {
      toast(errorMessage(e), 'erro');
    } finally {
      setBusy(false);
    }
  }

  async function prepareReminder() {
    setBusy(true);
    try { setReminder(await openReminder(item!, tz, proLine)); } catch (e) { toast(errorMessage(e), 'erro'); } finally { setBusy(false); }
  }

  const footer = (() => {
    if (mode === 'cancel') return <>
      <Button variant="secondary" onClick={() => setMode('view')}>Voltar</Button>
      <Button variant="danger" busy={busy} onClick={() => run(() => api.setStatus(item.id, 'cancelado', { canceled_by: cancelBy, cancel_reason: reason || null }), 'Sessão cancelada')}>Cancelar sessão</Button>
    </>;
    if (mode === 'noshow') return <>
      <Button variant="secondary" onClick={() => setMode('view')}>Voltar</Button>
      <Button busy={busy} onClick={() => run(() => api.setStatus(item.id, 'faltou', { charge_no_show: chargeNoShow }), 'Falta registrada')}>Registrar falta</Button>
    </>;
    if (mode === 'reschedule') return <>
      <Button variant="secondary" onClick={() => setMode('view')}>Voltar</Button>
      <Button busy={busy} disabled={!newDate || !newTime} onClick={() => {
        const s = zonedToUtc(newDate, newTime, tz);
        const e = new Date(new Date(s).getTime() + duration * 60000).toISOString();
        void run(() => api.updateAppointment(item.id, { starts_at: s, ends_at: e }), 'Sessão remarcada');
      }}>Remarcar</Button>
    </>;
    return null;
  })();

  return (
    <Dialog open onClose={close} title={item.patient_social_name || item.patient_name} footer={footer}>
      {mode === 'view' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={item.status} />
            {item.late_cancellation && <span className="text-sm font-bold text-ocre">Cancelada com pouca antecedência</span>}
            {item.patient_response === 'confirmou' && <span className="text-sm text-tinta-2">Confirmada pelo paciente</span>}
          </div>
          <div>
            <p className="text-lg font-bold">{formatLongDate(local.date)}</p>
            <p className="num text-tinta-2">{formatTime(item.starts_at, tz)} às {formatTime(item.ends_at, tz)} ({duration} min), {item.modality}</p>
            {item.series_frequency && <p className="text-sm text-tinta-3">Sessão recorrente, {FREQ_LABEL[item.series_frequency]}</p>}
            {item.price != null && <p className="num text-sm text-tinta-3">Valor: {money(item.price)}{item.patient_billing_mode === 'mensal' ? ' (paciente mensalista)' : ''}</p>}
            {item.patient_phone && <p className="text-sm text-tinta-3">Telefone: {formatPhone(item.patient_phone)}</p>}
            {item.cancel_reason && <p className="mt-1 text-sm text-tinta-2">Motivo: {item.cancel_reason}</p>}
          </div>

          {active && started && (
            <div className="grid grid-cols-2 gap-2">
              <Button busy={busy} onClick={() => run(() => api.setStatus(item.id, 'atendido'), 'Sessão registrada como atendida')}>Atendida</Button>
              <Button variant="secondary" onClick={() => { setChargeNoShow(false); setMode('noshow'); }}>Falta</Button>
            </div>
          )}

          {active && !started && (
            <div className="flex flex-col gap-2">
              {!reminder ? (
                <Button variant="secondary" busy={busy} onClick={prepareReminder}><IconWhats /> Preparar lembrete com link de confirmação</Button>
              ) : (
                <div className="flex flex-col gap-2 rounded-lg border border-linha p-3">
                  <p className="text-sm text-tinta-2">Mensagem pronta. O WhatsApp abre com o texto; você confirma o envio.</p>
                  <pre className="whitespace-pre-wrap rounded bg-cinza-fundo p-3 font-sans text-[15px]">{reminder.text}</pre>
                  <div className="flex flex-wrap gap-2">
                    {reminder.wa ? (
                      <a href={reminder.wa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-campo)] bg-verde px-4 font-bold text-white"><IconWhats /> Abrir no WhatsApp</a>
                    ) : <p className="text-sm text-ocre">Paciente sem telefone cadastrado. Copie a mensagem.</p>}
                    <Button variant="secondary" onClick={async () => { await navigator.clipboard.writeText(reminder.text); toast('Mensagem copiada'); }}>Copiar mensagem</Button>
                  </div>
                </div>
              )}
              {item.status === 'agendado' && (
                <Button variant="ghost" busy={busy} onClick={() => run(() => api.setStatus(item.id, 'confirmado'), 'Sessão confirmada')}>Marcar como confirmada</Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-linha pt-4">
            <Link to={`/pacientes/${item.patient_id}?aba=prontuario&sessao=${item.id}`} className="inline-flex min-h-11 items-center rounded-[var(--radius-campo)] px-3 font-bold text-anil hover:bg-anil-claro">Registrar no prontuário</Link>
            <Link to={`/pacientes/${item.patient_id}`} className="inline-flex min-h-11 items-center rounded-[var(--radius-campo)] px-3 font-bold text-anil hover:bg-anil-claro">Ver paciente</Link>
            {active && <Button variant="ghost" onClick={() => { setNewDate(local.date); setNewTime(local.time); setMode('reschedule'); }}>Remarcar</Button>}
            {active && <Button variant="ghost" onClick={() => { setCancelBy('paciente'); setMode('cancel'); }}>Cancelar</Button>}
            {item.status === 'cancelado' && (
              <Button variant="ghost" busy={busy} onClick={() => run(() => api.setStatus(item.id, 'agendado'), 'Sessão reativada')}>Reativar</Button>
            )}
            {(item.status === 'atendido' || item.status === 'faltou') && (
              <Button variant="ghost" busy={busy} onClick={async () => {
                if (await confirm({ title: 'Desfazer registro?', body: 'A sessão volta para "agendada". Se houver cobrança sem pagamento, ela será cancelada.', confirmLabel: 'Desfazer' })) {
                  await run(() => api.setStatus(item.id, 'agendado'), 'Registro desfeito');
                }
              }}>Desfazer registro</Button>
            )}
            {item.series_id && active && (
              <Button variant="ghost" busy={busy} onClick={async () => {
                if (await confirm({ title: 'Encerrar recorrência?', body: `As sessões futuras desta série a partir de ${formatLongDate(local.date)} serão removidas. Sessões passadas e registros são mantidos.`, confirmLabel: 'Encerrar a partir desta', danger: true })) {
                  await run(() => api.endSeries(item.series_id!, local.date), 'Recorrência encerrada');
                }
              }}>Encerrar recorrência daqui em diante</Button>
            )}
          </div>
        </div>
      )}

      {mode === 'cancel' && (
        <div className="flex flex-col gap-4">
          <Field label="Quem cancelou?">
            {(id) => (
              <Select id={id} value={cancelBy} onChange={(e) => setCancelBy(e.target.value as 'paciente' | 'profissional')}>
                <option value="paciente">Paciente</option>
                <option value="profissional">Eu (profissional)</option>
              </Select>
            )}
          </Field>
          <Field label="Motivo (opcional, sem dados clínicos)">
            {(id) => <Textarea id={id} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <p className="text-sm text-tinta-3">O horário fica livre na agenda. Para cobrar um cancelamento tardio, registre a falta em vez de cancelar.</p>
        </div>
      )}

      {mode === 'noshow' && (
        <div className="flex flex-col gap-3">
          <p>Registrar que {item.patient_social_name || item.patient_name} faltou à sessão.</p>
          {item.patient_billing_mode === 'por_sessao' && (item.price ?? 0) > 0 && (
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-anil" checked={chargeNoShow} onChange={(e) => setChargeNoShow(e.target.checked)} />
              <span>Cobrar a falta ({money(item.price)}), conforme combinado em contrato</span>
            </label>
          )}
        </div>
      )}

      {mode === 'reschedule' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nova data">{(id) => <Input id={id} type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />}</Field>
          <TextField label="Novo horário" type="time" step={300} value={newTime} onChange={(e) => setNewTime(e.target.value)} />
          <p className="col-span-2 text-sm text-tinta-3">A sessão mantém a duração de {duration} minutos. Se estava confirmada, precisará de nova confirmação.</p>
        </div>
      )}
    </Dialog>
  );
}

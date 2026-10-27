import { publicOrigin } from '../../lib/supabase';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { AgendaItem } from '../../lib/types';
import * as api from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { addDays, formatLongDate, formatPhone, formatTime, minutesBetween, money, todayIn, zonedParts, zonedToUtc } from '../../lib/format';
import { confirmationUrl, reminderText, whatsappLink } from '../../lib/messages';
import { useProfile } from '../../auth/AuthProvider';
import { Button, Dialog, Field, Input, Select, StatusBadge, TextField, Textarea, useConfirm, useToast } from '../ui';
import { IconWhats } from '../icons';
import { FLAG_WHATS_ENVIADO, gravarFlag } from '../../lib/ajuda';
import { EscolherDataInicio, EscolherHorario, type Escolha, type FreqMover } from './EscolherHorario';
import { PatientForm } from '../patients/PatientForm';

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

export function AppointmentSheet({ item, onClose, mover }: { item: AgendaItem | null; onClose: () => void; mover?: boolean }) {
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
  const [newLocation, setNewLocation] = useState('');
  const [escolha, setEscolha] = useState<Escolha | null>(null); // horário livre tocado no Mover
  const [manual, setManual] = useState(false); // Mover para dia/horário fora da grade (digitado)
  const [etapa, setEtapa] = useState<'horario' | 'data'>('horario'); // Mover: 1) horário 2) data de início
  const [dataInicio, setDataInicio] = useState<string | null>(null);
  const [freqMover, setFreqMover] = useState<FreqMover>('nao'); // modalidade escolhida no Mover (vem a atual)
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations, enabled: !!item });
  // Cadastro do paciente: dá para corrigir e salvar de novo sem sair da agenda
  const pacientes = useQuery({ queryKey: ['patients'], queryFn: api.listPatients, enabled: !!item });
  const paciente = pacientes.data?.find((p) => p.id === item?.patient_id) ?? null;
  const [editandoCadastro, setEditandoCadastro] = useState(false);

  // Aberto pelo botão "Mover": já entra no modo de mudar dia, horário e sala
  useEffect(() => {
    if (!item) return;
    const l = zonedParts(item.starts_at, tz);
    setNewDate(l.date); setNewTime(l.time); setNewLocation(item.location_id ?? '');
    setEscolha(null); setManual(false); setEtapa('horario'); setDataInicio(null);
    setFreqMover(item.series_id && item.series_frequency ? item.series_frequency : 'nao');
    setMode(mover ? 'reschedule' : 'view');
  }, [item, mover, tz]);

  if (!item) return null;
  const started = new Date(item.starts_at).getTime() <= Date.now();
  const active = item.status === 'agendado' || item.status === 'confirmado';
  const local = zonedParts(item.starts_at, tz);
  const duration = minutesBetween(item.starts_at, item.ends_at);
  const proLine = `${profile?.full_name ?? ''}${profile?.crp ? `, CRP ${profile.crp}` : ''}`;

  const close = () => { setMode('view'); setReminder(null); setReason(''); setEscolha(null); setManual(false); setEtapa('horario'); setDataInicio(null); onClose(); };

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
    if (mode === 'reschedule') {
      const voltar = () => { setEscolha(null); setDataInicio(null); setEtapa('horario'); setManual(false); if (mover) close(); else setMode('view'); };
      // Uma sessão só (avulsa ou digitada fora da grade): muda dia, horário e sala desta sessão
      const moverUma = (date: string, time: string, locId: string | null) => {
        const s = zonedToUtc(date, time, tz);
        const e = new Date(new Date(s).getTime() + duration * 60000).toISOString();
        const loc = locais.data?.find((x) => x.id === locId);
        const patch: Record<string, unknown> = { starts_at: s, ends_at: e, location_id: locId };
        if (loc) patch.modality = loc.modality;
        void run(() => api.updateAppointment(item.id, patch), 'Sessão movida');
      };
      if (manual) return <>
        <Button variant="secondary" onClick={voltar}>Voltar</Button>
        <Button busy={busy} disabled={!newDate || !newTime} onClick={() => moverUma(newDate, newTime, newLocation || null)}>Mover sessão</Button>
      </>;
      // Etapa 1: escolher o horário (dia da semana + sala)
      if (etapa === 'horario') return <>
        <Button variant="secondary" onClick={voltar}>Voltar</Button>
        <Button disabled={!escolha} onClick={() => { setDataInicio(null); setEtapa('data'); }}>Mover</Button>
      </>;
      // Etapa 2: data de início → série (semanal/quinzenal) muda daqui em diante; sessão avulsa muda só ela
      return <>
        <Button variant="secondary" onClick={() => { setDataInicio(null); setEtapa('horario'); }}>Outro horário</Button>
        <Button busy={busy} disabled={!escolha || !dataInicio} onClick={async () => {
          if (!escolha || !dataInicio) return;
          const locId = escolha.location?.id ?? null;
          const modality = escolha.location?.modality ?? item.modality;
          const ehSerie = !!(item.series_id && item.series_frequency);
          // Avulso → avulso: só esta sessão muda
          if (!ehSerie && freqMover === 'nao') return moverUma(dataInicio, escolha.time, locId);
          const hojeTz = todayIn(tz);
          const desde = local.date < hojeTz ? hojeTz : local.date;
          const fromDate = dataInicio < desde ? dataInicio : desde;
          const ddmm = `${dataInicio.slice(8, 10)}/${dataInicio.slice(5, 7)}`;
          const aviso = (n: number, base: string) => (n ? `${base} ${n} ${n === 1 ? 'data ficou' : 'datas ficaram'} de fora por já ter outro paciente nesse horário.` : base);
          setBusy(true);
          try {
            if (ehSerie && freqMover !== 'nao') {
              // Série → série (pode mudar de semanal para quinzenal e vice-versa) a partir da data de início
              const r = await api.changeSeries({ seriesId: item.series_id!, fromDate, newStartDate: dataInicio, newTime: escolha.time, frequency: freqMover, locationId: locId, modality });
              await invalidate(); toast(aviso(r.conflicts.length, `Sessões movidas a partir de ${ddmm}.`));
            } else if (ehSerie) {
              // Série → avulso: encerra a repetição a partir da data e deixa uma sessão só na nova data
              await api.endSeries(item.series_id!, fromDate);
              const s = zonedToUtc(dataInicio, escolha.time, tz);
              await api.createAppointment({ patient_id: item.patient_id, starts_at: s, ends_at: new Date(new Date(s).getTime() + duration * 60000).toISOString(), price: item.price, modality, location_id: locId });
              await invalidate(); toast(`Repetição encerrada. Sessão avulsa em ${ddmm} às ${escolha.time}.`);
            } else {
              // Avulso → semanal/quinzenal: esta sessão vai para a data de início e a repetição começa a partir dela
              const s = zonedToUtc(dataInicio, escolha.time, tz);
              const patch: Record<string, unknown> = { starts_at: s, ends_at: new Date(new Date(s).getTime() + duration * 60000).toISOString(), location_id: locId, modality };
              await api.updateAppointment(item.id, patch);
              const passo = freqMover === 'quinzenal' ? 14 : freqMover === 'mensal' ? 28 : 7;
              const r = await api.createSeries({ patientId: item.patient_id, frequency: freqMover as Exclude<FreqMover, 'nao'>, startDate: addDays(dataInicio, passo), startTime: escolha.time, duration,
                untilDate: null, occurrences: null, price: item.price, modality, locationId: locId });
              await invalidate(); toast(aviso(r.conflicts.length, `Agora ${freqMover === 'quinzenal' ? 'quinzenal' : 'semanal'} a partir de ${ddmm}.`));
            }
            close();
          } catch (e) { toast(errorMessage(e), 'erro'); } finally { setBusy(false); }
        }}>Confirmar mudança</Button>
      </>;
    }
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
                  <pre className="whitespace-pre-wrap rounded bg-cinza-fundo p-3 font-sans text-[0.9375rem]">{reminder.text}</pre>
                  <div className="flex flex-wrap gap-2">
                    {reminder.wa ? (
                      <a href={reminder.wa} target="_blank" rel="noopener noreferrer" onClick={() => gravarFlag(FLAG_WHATS_ENVIADO)} className="inline-flex min-h-11 items-center gap-2 rounded-botao bg-verde-forte px-4 font-bold text-sobre-status"><IconWhats /> Abrir no WhatsApp</a>
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
            {paciente && <Button variant="ghost" onClick={() => setEditandoCadastro(true)}>Editar cadastro</Button>}
            {active && <Button variant="ghost" onClick={() => { setNewDate(local.date); setNewTime(local.time); setNewLocation(item.location_id ?? ''); setMode('reschedule'); }}>Mover (dia, horário ou sala)</Button>}
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
        <div className="flex flex-col gap-4">
          <p className="rounded-campo bg-afundado px-3 py-2 text-[0.9375rem]">
            Horário atual: <b>{formatLongDate(local.date).replace('-feira', '')} às {formatTime(item.starts_at, tz)}</b>{item.location_name ? ` · ${item.location_name}` : ''}
          </p>
          {!manual ? (
            <>
              {etapa === 'horario' || !escolha
                ? <EscolherHorario item={item} escolhido={escolha} onEscolher={setEscolha} />
                : <EscolherDataInicio item={item} escolha={escolha} data={dataInicio} onData={setDataInicio} freq={freqMover} onFreq={setFreqMover} />}
              {etapa === 'horario' && <button type="button" onClick={() => { setEscolha(null); setManual(true); }} className="min-h-11 self-start px-1 text-sm font-bold text-tinta-2 underline">Outro dia ou horário (fora da grade, só esta sessão)</button>}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nova data">{(id) => <Input id={id} type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />}</Field>
              <TextField label="Novo horário" type="time" step={300} value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              {(locais.data?.length ?? 0) > 0 && (
                <Field label="Sala / local" className="col-span-2">{(id) => (
                  <Select id={id} value={newLocation} onChange={(e) => setNewLocation(e.target.value)}>
                    <option value="">Sem local</option>
                    {locais.data!.filter((l) => l.active || l.id === newLocation).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                )}</Field>
              )}
              <button type="button" onClick={() => setManual(false)} className="col-span-2 min-h-11 justify-self-start px-1 text-sm font-bold text-anil-escuro underline">Voltar aos horários livres</button>
            </div>
          )}
        </div>
      )}
      {paciente && <PatientForm open={editandoCadastro} onClose={() => setEditandoCadastro(false)} patient={paciente} />}
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { AgendaItem } from '../lib/types';
import { addDays, formatDate, formatLongDate, formatTime, minutesBetween, money, todayIn, zonedParts, zonedToUtc } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useProfile } from '../auth/AuthProvider';
import { AppointmentSheet, useInvalidateAgenda } from '../components/appointments/AppointmentSheet';
import { NewAppointmentDialog } from '../components/appointments/NewAppointmentDialog';
import { Button, ErrorBox, Loading, STATUS_BAR, StatusBadge, cx, useToast } from '../components/ui';
import { IconEye, IconEyeOff, IconPlus } from '../components/icons';
import { VALOR_OCULTO, useValoresVisiveis } from '../lib/privacidade';

function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

export function TodayPage() {
  const [valoresVisiveis, alternarValores] = useValoresVisiveis();
  const valor = (n: number) => (valoresVisiveis ? money(n) : VALOR_OCULTO);
  const { profile, tz } = useProfile();
  const now = useNow();
  const today = todayIn(tz);
  const from = zonedToUtc(today, '00:00', tz);
  const to = zonedToUtc(addDays(today, 1), '00:00', tz);
  const [open, setOpen] = useState<AgendaItem | null>(null);
  const [creating, setCreating] = useState(false);
  const invalidate = useInvalidateAgenda();
  const toast = useToast();

  const day = useQuery({ queryKey: ['agenda', from, to], queryFn: () => api.listAgenda(from, to) });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const pending = useQuery({ queryKey: ['to-register', from], queryFn: () => api.listToRegister(from) });

  async function quick(item: AgendaItem, status: 'atendido') {
    try {
      await api.setStatus(item.id, status);
      await invalidate();
      toast('Sessão registrada como atendida');
    } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  const items = day.data ?? [];
  const visible = items.filter((i) => i.status !== 'cancelado');
  const canceled = items.filter((i) => i.status === 'cancelado');
  const nowIdx = visible.findIndex((i) => new Date(i.ends_at).getTime() > now);
  const d = dash.data;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-bold leading-none">Hoje</h1>
          <p className="mt-2 text-lg text-tinta-2">{formatLongDate(today)}</p>
        </div>
        <Button onClick={() => setCreating(true)}><IconPlus /> Nova sessão</Button>
      </header>

      {/* O que precisa de atenção: frases, não painéis */}
      {d && (
        <ul className="mb-7 flex flex-col gap-1.5 text-[15px]">
          {d.to_register > 0 && <Attention to="#registrar">{d.to_register} {d.to_register === 1 ? 'sessão passada aguarda' : 'sessões passadas aguardam'} registro de presença</Attention>}
          {d.to_confirm_48h > 0 && <Attention to="/agenda">{d.to_confirm_48h} {d.to_confirm_48h === 1 ? 'sessão' : 'sessões'} nas próximas 48 horas sem confirmação</Attention>}
          {d.overdue > 0 && <Attention to="/financeiro">{valor(d.overdue)} em cobranças vencidas</Attention>}
          {d.receita_saude_pending > 0 && <Attention to="/financeiro?aba=receita">{d.receita_saude_pending} {d.receita_saude_pending === 1 ? 'recebimento' : 'recebimentos'} sem recibo no Receita Saúde</Attention>}
          {d.invoices_pending > 0 && <Attention to="/notas-fiscais">{d.invoices_pending} {d.invoices_pending === 1 ? 'nota fiscal' : 'notas fiscais'} a emitir</Attention>}
        </ul>
      )}

      {day.isLoading && <Loading />}
      {day.error && <ErrorBox>{errorMessage(day.error)}</ErrorBox>}

      {day.data && visible.length === 0 && (
        <div className="rounded-lg border border-dashed border-linha-forte bg-papel/70 p-6">
          <p className="font-bold">Nenhuma sessão hoje.</p>
          <p className="mt-1 text-tinta-2">Agende uma sessão ou veja a semana na agenda.</p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={() => setCreating(true)}>Agendar sessão</Button>
            <Link to="/agenda" className="inline-flex min-h-11 items-center px-3 font-bold text-anil">Abrir agenda</Link>
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <ol className="relative flex flex-col" aria-label="Sessões de hoje">
          {visible.map((it, idx) => {
            const started = new Date(it.starts_at).getTime() <= now;
            const ended = new Date(it.ends_at).getTime() <= now;
            const canRegister = started && (it.status === 'agendado' || it.status === 'confirmado');
            return (
              <li key={it.id}>
                {idx === nowIdx && <NowLine tz={tz} now={now} />}
                <div className={cx('flex gap-4 border-b border-linha py-4', ended && it.status !== 'agendado' && it.status !== 'confirmado' && 'opacity-75')}>
                  <div className="w-16 shrink-0 pt-0.5 text-right">
                    <p className="num text-xl font-bold leading-none">{formatTime(it.starts_at, tz)}</p>
                    <p className="num mt-1 text-sm text-tinta-3">{minutesBetween(it.starts_at, it.ends_at)} min</p>
                  </div>
                  <div className={cx('flex min-w-0 flex-1 flex-col gap-2 border-l-4 pl-4', STATUS_BAR[it.status])}>
                    <button onClick={() => setOpen(it)} className="text-left">
                      <span className="block truncate text-lg font-bold hover:text-anil">{it.patient_social_name || it.patient_name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-tinta-2">
                        <StatusBadge status={it.status} />
                        {it.modality === 'online' && <span>Online</span>}
                        {it.series_frequency && <span>Recorrente</span>}
                      </span>
                    </button>
                    {canRegister && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => quick(it, 'atendido')}>Atendida</Button>
                        <Button size="sm" variant="secondary" onClick={() => setOpen(it)}>Falta ou outro</Button>
                      </div>
                    )}
                    {!started && it.status === 'agendado' && (
                      <div><Button size="sm" variant="secondary" onClick={() => setOpen(it)}>Lembrar e confirmar</Button></div>
                    )}
                    {it.modality === 'online' && it.patient_meeting_url && !ended && (
                      <a href={it.patient_meeting_url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-anil underline-offset-4 hover:underline">Abrir sala online</a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {nowIdx === -1 && visible.length > 0 && <li><NowLine tz={tz} now={now} done /></li>}
        </ol>
      )}

      {canceled.length > 0 && (
        <p className="mt-3 text-sm text-tinta-3">
          Canceladas hoje: {canceled.map((c) => `${formatTime(c.starts_at, tz)} ${c.patient_social_name || c.patient_name}`).join('; ')}
        </p>
      )}

      {pending.data && pending.data.length > 0 && (
        <section id="registrar" className="mt-10">
          <h2 className="mb-1 text-xl font-bold">Aguardando registro</h2>
          <p className="mb-3 text-tinta-2">Sessões de dias anteriores ainda marcadas como agendadas ou confirmadas.</p>
          <ul className="divide-y divide-linha rounded-lg border border-linha bg-papel">
            {pending.data.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <button onClick={() => setOpen(it)} className="text-left">
                  <span className="block font-bold">{it.patient_social_name || it.patient_name}</span>
                  <span className="num text-sm text-tinta-2">{formatDate(zonedParts(it.starts_at, tz).date)} às {formatTime(it.starts_at, tz)}</span>
                </button>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => quick(it, 'atendido')}>Atendida</Button>
                  <Button size="sm" variant="secondary" onClick={() => setOpen(it)}>Falta ou outro</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d && (
        <p className="num mt-10 flex flex-wrap items-center gap-x-1 text-tinta-2">
          <span>
            Recebido neste mês: <strong className="text-tinta">{valor(d.received_month)}</strong>. A receber: <strong className="text-tinta">{valor(d.receivable)}</strong>. Pacientes ativos: <strong className="text-tinta">{d.active_patients}</strong>.
          </span>
          <button type="button" onClick={alternarValores} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-tinta-2 hover:text-tinta"
            aria-label={valoresVisiveis ? 'Ocultar valores' : 'Mostrar valores'} aria-pressed={valoresVisiveis}>
            {valoresVisiveis ? <IconEyeOff /> : <IconEye />}
          </button>
        </p>
      )}
      {!profile?.crp && <p className="mt-4 text-ocre">Complete seu CRP em Configurações para emitir documentos.</p>}

      <AppointmentSheet item={open} onClose={() => setOpen(null)} />
      <NewAppointmentDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function Attention({ to, children }: { to: string; children: React.ReactNode }) {
  const cls = 'inline-flex items-center gap-2 font-bold text-ocre underline-offset-4 hover:underline';
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-ocre" />
      {to.startsWith('#') ? <a href={to} className={cls}>{children}</a> : <Link to={to} className={cls}>{children}</Link>}
    </li>
  );
}

function NowLine({ tz, now, done }: { tz: string; now: number; done?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-1.5" aria-label={`Agora, ${formatTime(new Date(now).toISOString(), tz)}`}>
      <span className="num w-16 shrink-0 text-right text-sm font-bold text-anil">{formatTime(new Date(now).toISOString(), tz)}</span>
      <span className="h-0.5 flex-1 bg-anil" />
      {done && <span className="text-sm text-tinta-3">fim das sessões do dia</span>}
    </div>
  );
}

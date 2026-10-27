import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { AgendaItem, DashboardSummary } from '../lib/types';
import { addDays, formatDate, formatLongDate, formatTime, minutesBetween, money, todayIn, zonedParts, zonedToUtc } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useProfile } from '../auth/AuthProvider';
import { AppointmentSheet, useInvalidateAgenda } from '../components/appointments/AppointmentSheet';
import { NewAppointmentDialog } from '../components/appointments/NewAppointmentDialog';
import { Button, ErrorBox, Loading, Notice, STATUS_BAR, StatusBadge, cx, useToast } from '../components/ui';
import { IconCalendar, IconCheck, IconClock, IconDoc, IconEye, IconEyeOff, IconMoney, IconPeople, IconPin, IconReceipt, IconVideo } from '../components/icons';
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

  const primeiroNome = (profile?.full_name ?? '').trim().split(/\s+/)[0] ?? '';
  const saudacao = (() => { const h = Number(formatTime(new Date(now).toISOString(), tz).slice(0, 2)); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; })();

  return (
    <div className="flex flex-col gap-6">
      {/* Boas-vindas — faixa em degradê no topo do cartão */}
      <section className="cartao cartao-boas-vindas flex flex-wrap items-end justify-between gap-4 px-5 pb-5 pt-6">
        <div>
          <p className="rotulo">{formatLongDate(today)}</p>
          <h1 className="titulo-display mt-1 text-[1.875rem] leading-tight">{saudacao}{primeiroNome ? `, ${primeiroNome}` : ''}</h1>
          {d && <p className="mt-1 text-tinta-2">{d.sessions_today === 0 ? 'Nenhuma sessão hoje.' : `${d.sessions_today} ${d.sessions_today === 1 ? 'sessão' : 'sessões'} hoje.`}</p>}
        </div>
      </section>

      {/* Atalhos — as pendências aparecem como bolinha com o número no atalho de cada área
          (detalhes no sininho do cabeçalho). Agenda: aguardando registro + sem confirmação;
          Financeiro: cobranças vencidas + recibos do Receita Saúde; Notas fiscais: notas a emitir. */}
      <nav aria-label="Atalhos" className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {ATALHOS.map((a) => {
          const n = d ? pendenciasDoAtalho(a.to, d) : 0;
          return (
            <Link key={a.to} to={a.to} aria-label={n ? `${a.label}: ${n} ${n === 1 ? 'pendência' : 'pendências'}` : a.label}
              className="cartao pressionar relative flex aspect-square flex-col items-center justify-center gap-2 p-2 text-center text-[0.8125rem] font-bold leading-tight">
              <span className={cx('atalho-icone grid size-12 place-items-center', a.cor)}><a.icon /></span>
              {a.label}
              {n > 0 && <span aria-hidden className="absolute right-2 top-2 grid min-w-6 place-items-center rounded-full bg-vermelho-forte px-1.5 text-[0.75rem] font-extrabold leading-6 text-white">{n}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Sessões de hoje */}
      <section aria-labelledby="t-hoje">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="t-hoje" className="text-[1.125rem] font-bold">Sessões de hoje</h2>
          <Link to="/" className="inline-flex min-h-11 items-center px-2 text-[0.9375rem] font-bold text-anil-escuro">Ver agenda</Link>
        </div>

        {day.isLoading && <Loading />}
        {day.error && <ErrorBox>{errorMessage(day.error)}</ErrorBox>}

        {day.data && visible.length === 0 && (
          <div className="cartao p-5">
            <p className="font-bold">Nenhuma sessão hoje.</p>
            <p className="mt-1 text-tinta-2">Agende uma sessão ou veja a semana na agenda.</p>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => setCreating(true)}>Agendar sessão</Button>
            </div>
          </div>
        )}

        {visible.length > 0 && (
          <ol className="flex flex-col gap-2" aria-label="Sessões de hoje">
            {visible.map((it, idx) => {
              const started = new Date(it.starts_at).getTime() <= now;
              const ended = new Date(it.ends_at).getTime() <= now;
              const canRegister = started && (it.status === 'agendado' || it.status === 'confirmado');
              return (
                <li key={it.id}>
                  {idx === nowIdx && <NowLine tz={tz} now={now} />}
                  <div className={cx('cartao flex gap-3 border-l-4 py-3 pl-4 pr-3', STATUS_BAR[it.status], ended && !canRegister && 'opacity-80')}>
                    <div className="w-14 shrink-0 pt-0.5">
                      <p className="num text-[1.0625rem] font-bold leading-none">{formatTime(it.starts_at, tz)}</p>
                      <p className="num mt-1 text-[0.75rem] text-tinta-3">{minutesBetween(it.starts_at, it.ends_at)} min</p>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <button onClick={() => setOpen(it)} className="text-left">
                        <span className="block truncate text-[1rem] font-bold hover:text-anil-escuro">{it.patient_social_name || it.patient_name}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-tinta-2">
                          <StatusBadge status={it.status} />
                          {it.modality === 'online' ? <span className="inline-flex items-center gap-1"><IconVideo className="size-4" /> On-line</span>
                            : it.location_name ? <span className="inline-flex items-center gap-1"><IconPin className="size-4" /> {it.location_name}</span> : null}
                          {it.series_frequency && <span>Recorrente</span>}
                        </span>
                      </button>
                      {canRegister && (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => quick(it, 'atendido')}><IconCheck className="size-4" /> Atendida</Button>
                          <Button size="sm" variant="secondary" onClick={() => setOpen(it)}>Falta ou outro</Button>
                        </div>
                      )}
                      {!started && it.status === 'agendado' && (
                        <div><Button size="sm" variant="secondary" onClick={() => setOpen(it)}>Lembrar e confirmar</Button></div>
                      )}
                      {it.modality === 'online' && it.patient_meeting_url && !ended && (
                        <a href={it.patient_meeting_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-bold text-anil-escuro underline-offset-4 hover:underline">Abrir sala on-line</a>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
            {nowIdx === -1 && <li><NowLine tz={tz} now={now} done /></li>}
          </ol>
        )}

        {canceled.length > 0 && (
          <p className="mt-3 text-sm text-tinta-3">
            Canceladas hoje: {canceled.map((c) => `${formatTime(c.starts_at, tz)} ${c.patient_social_name || c.patient_name}`).join('; ')}
          </p>
        )}
      </section>

      {pending.data && pending.data.length > 0 && (
        <section id="registrar" aria-labelledby="t-reg">
          <h2 id="t-reg" className="text-[1.125rem] font-bold">Aguardando registro</h2>
          <p className="mb-2 text-tinta-2">Sessões de dias anteriores ainda marcadas como agendadas ou confirmadas.</p>
          <ul className="cartao divide-y divide-linha/70 overflow-hidden">
            {pending.data.map((it) => (
              <li key={it.id} className={cx('flex flex-wrap items-center justify-between gap-3 border-l-4 px-4 py-3', STATUS_BAR[it.status])}>
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

      {/* Carteira escura — valores ocultos até tocar no olho */}
      {d && (
        <section aria-label="Resumo financeiro do mês" className="carteira p-5">
          <div className="flex items-center justify-between">
            <p className="rotulo">Recebido neste mês</p>
            <button type="button" onClick={alternarValores} className="-mr-2 grid size-12 place-items-center rounded-full hover:bg-white/10"
              aria-label={valoresVisiveis ? 'Ocultar valores' : 'Mostrar valores'} aria-pressed={valoresVisiveis}>
              {valoresVisiveis ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>
          <p className="num text-[2rem] font-extrabold leading-tight tracking-tight">{valor(d.received_month)}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="carteira-bloco p-3"><p className="rotulo">A receber</p><p className="num mt-0.5 text-[1.125rem] font-extrabold">{valor(d.receivable)}</p></div>
            <div className="carteira-bloco p-3"><p className="rotulo">Vencido</p><p className="num mt-0.5 text-[1.125rem] font-extrabold">{valor(d.overdue)}</p></div>
          </div>
          <Link to="/financeiro" className="mt-3 inline-flex min-h-11 items-center text-[0.9375rem] font-bold underline-offset-4 hover:underline">Abrir financeiro</Link>
        </section>
      )}

      {/* Mini-indicadores */}
      {d && (
        <section aria-label="Indicadores" className="grid grid-cols-3 gap-2">
          <Kpi valor={d.sessions_today} rotulo="Sessões hoje" />
          <Kpi valor={d.to_confirm_48h} rotulo="A confirmar" alerta={d.to_confirm_48h > 0} />
          <Kpi valor={d.active_patients} rotulo="Pacientes ativos" />
        </section>
      )}

      {!profile?.crp && <Notice tone="ocre">Complete seu CRP em <Link to="/configuracoes" className="font-bold underline">Configurações</Link> para emitir documentos.</Notice>}

      <AppointmentSheet item={open} onClose={() => setOpen(null)} />
      <NewAppointmentDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

const ATALHOS = [
  { to: '/', label: 'Agenda', icon: IconCalendar, cor: 'bg-anil-claro text-sobre-anil-claro' },
  { to: '/pacientes', label: 'Pacientes', icon: IconPeople, cor: 'bg-acento-claro text-sobre-acento-claro' },
  { to: '/prontuario', label: 'Prontuário', icon: IconDoc, cor: 'bg-azul-fundo text-azul' },
  { to: '/financeiro', label: 'Financeiro', icon: IconMoney, cor: 'bg-verde-fundo text-verde' },
  { to: '/notas-fiscais', label: 'Notas fiscais', icon: IconReceipt, cor: 'bg-anil-claro text-sobre-anil-claro' },
  { to: '/agenda/horarios', label: 'Horários', icon: IconClock, cor: 'bg-acento-claro text-sobre-acento-claro' },
];

/** Número de pendências que aparece na bolinha de cada atalho. */
function pendenciasDoAtalho(to: string, d: DashboardSummary): number {
  if (to === '/') return d.to_register + d.to_confirm_48h;
  if (to === '/financeiro') return (d.overdue > 0 ? 1 : 0) + d.receita_saude_pending;
  if (to === '/notas-fiscais') return d.invoices_pending;
  return 0;
}

function Kpi({ valor, rotulo, alerta }: { valor: number; rotulo: string; alerta?: boolean }) {
  return (
    <div className="cartao p-3">
      <p className={cx('num text-[1.375rem] font-extrabold leading-tight', alerta ? 'text-ocre' : 'text-tinta')}>{valor}</p>
      <p className="rotulo mt-1">{rotulo}</p>
    </div>
  );
}

function NowLine({ tz, now, done }: { tz: string; now: number; done?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-1.5" aria-label={`Agora, ${formatTime(new Date(now).toISOString(), tz)}`}>
      <span className="num w-14 shrink-0 text-sm font-bold text-anil-escuro">{formatTime(new Date(now).toISOString(), tz)}</span>
      <span className="h-0.5 flex-1 bg-anil" />
      {done && <span className="text-sm text-tinta-3">fim das sessões do dia</span>}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { AgendaItem, Location, WorkingHour } from '../lib/types';
import { periodoDe } from '../lib/periodos';
import { horariosLivres, type HorarioLivre } from '../lib/horarios';
import {
  addDays, daysInMonth, formatLongDate, formatTime, monthName, startOfMonth, startOfWeek, todayIn,
  weekday, weekdayShort, zonedParts, zonedToUtc,
} from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useProfile } from '../auth/AuthProvider';
import { AppointmentSheet } from '../components/appointments/AppointmentSheet';
import { NewAppointmentDialog } from '../components/appointments/NewAppointmentDialog';
import { ErrorBox, Loading, STATUS_BAR, StatusBadge, cx } from '../components/ui';
import { IconAlert, IconChevronLeft, IconChevronRight, IconClock, IconPlus } from '../components/icons';

type View = 'dia' | 'semana' | 'mes';

export function AgendaPage() {
  const { profile, tz } = useProfile();
  const [params, setParams] = useSearchParams();
  const view = (params.get('v') as View) || 'dia';
  const date = params.get('d') || todayIn(tz);
  const [open, setOpen] = useState<AgendaItem | null>(null);
  const [newAt, setNewAt] = useState<{ date: string; time?: string; locationId?: string | null; minutes?: number } | null>(null);
  const [showCanceled, setShowCanceled] = useState(false);

  const set = (v: View, d: string) => setParams({ v, d }, { replace: true });

  const range = useMemo(() => {
    if (view === 'dia') return { start: date, days: 1 };
    if (view === 'semana') return { start: startOfWeek(date), days: 7 };
    const s = startOfMonth(date);
    const gridStart = startOfWeek(s);
    const end = addDays(s, daysInMonth(s));
    let days = 0; while (addDays(gridStart, days) < end || days % 7 !== 0) days++;
    return { start: gridStart, days };
  }, [view, date]);

  const fromIso = zonedToUtc(range.start, '00:00', tz);
  const toIso = zonedToUtc(addDays(range.start, range.days), '00:00', tz);
  const q = useQuery({ queryKey: ['agenda', fromIso, toIso], queryFn: () => api.listAgenda(fromIso, toIso) });
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations });
  const horas = useQuery({ queryKey: ['working-hours'], queryFn: api.listWorkingHours });
  const semHorarios = horas.data !== undefined && horas.data.length === 0;
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const hoje = todayIn(tz);
  const livresDo = (d: string): HorarioLivre[] => !horas.data || !profile ? [] : horariosLivres({
    date: d, hours: horas.data, locations: locais.data ?? [], items: (q.data ?? []).filter((i) => zonedParts(i.starts_at, tz).date === d),
    sessionMinutes: profile.session_minutes, bufferMinutes: profile.buffer_minutes, tz,
  });

  const byDay = useMemo(() => {
    const m = new Map<string, AgendaItem[]>();
    for (const it of q.data ?? []) {
      if (!showCanceled && it.status === 'cancelado') continue;
      const d = zonedParts(it.starts_at, tz).date;
      m.set(d, [...(m.get(d) ?? []), it]);
    }
    return m;
  }, [q.data, tz, showCanceled]);

  const step = view === 'dia' ? 1 : view === 'semana' ? 7 : 0;
  const move = (dir: 1 | -1) => {
    if (view === 'mes') {
      const [y, m] = date.split('-').map(Number);
      const nm = new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
      return set(view, nm);
    }
    set(view, addDays(date, dir * step));
  };

  const title = view === 'dia'
    ? formatLongDate(date, date.slice(0, 4) !== todayIn(tz).slice(0, 4))
    : view === 'semana'
      ? `Semana de ${Number(range.start.slice(8))} de ${monthName(Number(range.start.slice(5, 7)))}`
      : `${monthName(Number(date.slice(5, 7)))[0].toUpperCase()}${monthName(Number(date.slice(5, 7))).slice(1)} de ${date.slice(0, 4)}`;

  return (
    <div className="pb-24">
      {/* Cabeçalho limpo: data em destaque, setas e atalhos discretos */}
      <header className="mb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="rotulo">{view === 'dia' && date === hoje ? 'Minha agenda · hoje' : 'Minha agenda'}</p>
            <h1 className="titulo-display mt-0.5 text-[26px] leading-tight first-letter:uppercase">{title}</h1>
          </div>
          <Link to="/agenda/horarios" aria-label="Horários de atendimento" title="Horários de atendimento"
            className="grid size-12 shrink-0 place-items-center rounded-full text-tinta-2 hover:bg-cinza-fundo"><IconClock /></Link>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div role="tablist" aria-label="Visualização" className="inline-flex gap-1 rounded-campo bg-afundado p-1">
            {([['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']] as Array<[View, string]>).map(([v, rot]) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => set(v, date)}
                className={cx('min-h-10 rounded-[calc(var(--r-field)-4px)] px-3.5 text-sm font-bold', view === v ? 'bg-papel text-anil-escuro shadow-cartao' : 'text-tinta-2')}>{rot}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center">
            {date !== hoje && <button onClick={() => set(view, hoje)} className="min-h-11 rounded-full px-3 text-sm font-bold text-anil-escuro hover:bg-anil-claro/60">Hoje</button>}
            <button onClick={() => move(-1)} aria-label="Anterior" className="grid size-11 place-items-center rounded-full text-tinta-2 hover:bg-cinza-fundo"><IconChevronLeft /></button>
            <button onClick={() => move(1)} aria-label="Próximo" className="grid size-11 place-items-center rounded-full text-tinta-2 hover:bg-cinza-fundo"><IconChevronRight /></button>
          </div>
        </div>
      </header>

      {semHorarios && (
        <section className="cartao cartao-boas-vindas mb-4 flex flex-col gap-3 px-4 pb-4 pt-5">
          <div>
            <strong className="block text-[17px]">Monte sua agenda</strong>
            <span className="text-[15px] text-tinta-2">Escolha a sala, os dias e o período (manhã, tarde ou noite). O app cria os horários e mostra aqui os disponíveis para agendar.</span>
          </div>
          <Link to="/agenda/horarios?novo=1" className="btn-degrade pressionar inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-botao px-5 font-bold"><IconClock /> Criar meus horários</Link>
        </section>
      )}

      {dash.data && dash.data.to_register > 0 && (
        <Link to="/resumo#registrar" className="mb-4 flex min-h-12 items-center gap-2 rounded-campo bg-ocre-fundo px-4 py-2 text-[15px] font-bold text-ocre">
          <IconAlert className="size-5 shrink-0" />
          <span className="flex-1">{dash.data.to_register} {dash.data.to_register === 1 ? 'sessão aguarda' : 'sessões aguardam'} registro</span>
          <IconChevronRight className="size-5 shrink-0" />
        </Link>
      )}

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox>{errorMessage(q.error)}</ErrorBox>}

      {q.data && view === 'dia' && (
        <DiaPorBlocos date={date} items={byDay.get(date) ?? []} tz={tz} onOpen={setOpen} onNew={() => setNewAt({ date })}
          faixas={(horas.data ?? []).filter((h) => h.weekday === weekday(date))} locais={locais.data ?? []}
          livres={livresDo(date)} onLivre={(h) => setNewAt({ date, time: h.time, locationId: h.location?.id ?? null, minutes: h.minutes })} />
      )}

      {q.data && view === 'semana' && (
        <>
          <div className="hidden lg:block">
            <WeekGrid start={range.start} byDay={byDay} tz={tz} from={profile?.agenda_start ?? '07:00'} to={profile?.agenda_end ?? '21:00'}
              onOpen={setOpen} onNew={(d, t) => setNewAt({ date: d, time: t })} />
          </div>
          <div className="flex flex-col gap-6 lg:hidden">
            {Array.from({ length: 7 }, (_, i) => addDays(range.start, i)).map((d) => (
              <DayList key={d} date={d} items={byDay.get(d) ?? []} tz={tz} onOpen={setOpen} onNew={() => setNewAt({ date: d })} compact
                livres={livresDo(d)} onLivre={(h) => setNewAt({ date: d, time: h.time, locationId: h.location?.id ?? null })} />
            ))}
          </div>
        </>
      )}

      {q.data && view === 'mes' && (
        <MonthGrid start={range.start} days={range.days} month={date.slice(0, 7)} byDay={byDay} today={todayIn(tz)} onPick={(d) => set('dia', d)} />
      )}

      <label className="mt-6 flex items-center justify-center gap-2 text-sm text-tinta-3">
        <input type="checkbox" className="h-4 w-4 accent-anil" checked={showCanceled} onChange={(e) => setShowCanceled(e.target.checked)} />
        Mostrar canceladas
      </label>

      {/* Botão flutuante: novo agendamento (no dia com blocos, cada horário livre já tem o seu) */}
      {!(view === 'dia' && (horas.data ?? []).some((h) => h.weekday === weekday(date))) && <button onClick={() => setNewAt({ date: view === 'dia' ? date : hoje })}
        className="btn-degrade pressionar fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-30 inline-flex min-h-14 items-center gap-2 rounded-cartao pl-4 pr-5 text-[15px] font-bold shadow-flutuante lg:bottom-8 lg:right-8">
        <IconPlus /> Novo agendamento
      </button>}

      <AppointmentSheet item={open} onClose={() => setOpen(null)} />
      <NewAppointmentDialog open={!!newAt} onClose={() => setNewAt(null)} initialDate={newAt?.date} initialTime={newAt?.time} initialLocationId={newAt?.locationId ?? null} initialMinutes={newAt?.minutes} />
    </div>
  );
}

type Linha = { tipo: 'sessao'; hora: string; item: AgendaItem } | { tipo: 'livre'; hora: string; livre: HorarioLivre };

function DayList({ date, items, tz, onOpen, onNew, compact, livres = [], onLivre, mostrarLocal }: {
  date: string; items: AgendaItem[]; tz: string; onOpen: (i: AgendaItem) => void; onNew: () => void; compact?: boolean;
  livres?: HorarioLivre[]; onLivre?: (h: HorarioLivre) => void; mostrarLocal?: boolean;
}) {
  const variosLocais = mostrarLocal && new Set(livres.map((h) => h.location?.id ?? '')).size > 1;
  // Sessões e horários disponíveis numa única linha do tempo, por hora (na semana, só a contagem de livres).
  const linhas: Linha[] = [
    ...items.map((item) => ({ tipo: 'sessao' as const, hora: formatTime(item.starts_at, tz), item })),
    ...(compact ? [] : livres.map((livre) => ({ tipo: 'livre' as const, hora: livre.time, livre }))),
  ].sort((x, y) => x.hora.localeCompare(y.hora));

  return (
    <section aria-label={formatLongDate(date)}>
      {compact && (
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="font-bold first-letter:uppercase">{formatLongDate(date)}</h3>
          {livres.length > 0 && <button onClick={() => onLivre?.(livres[0])} className="text-sm font-bold text-anil-escuro">{livres.length} {livres.length === 1 ? 'horário disponível' : 'horários disponíveis'}</button>}
        </div>
      )}
      {linhas.length === 0 ? (
        <button onClick={onNew} className="w-full rounded-cartao border border-dashed border-linha-forte px-4 py-4 text-left text-tinta-2 hover:border-anil hover:text-anil-escuro">
          {compact ? 'Sem sessões.' : 'Nenhuma sessão neste dia.'} <span className="font-bold text-anil-escuro">Agendar</span>
        </button>
      ) : (
        <ol className="flex flex-col gap-2">
          {linhas.map((l) => (
            <li key={l.tipo === 'sessao' ? l.item.id : `livre-${l.hora}-${l.livre.location?.id ?? ''}`} className="flex items-stretch gap-3">
              <span className={cx('num w-12 shrink-0 text-[15px] font-bold', l.tipo === 'sessao' ? 'pt-3.5 text-tinta' : 'pt-3 text-tinta-3')}>{l.hora}</span>
              {l.tipo === 'sessao' ? (
                <button onClick={() => onOpen(l.item)}
                  className={cx('cartao pressionar flex min-h-16 min-w-0 flex-1 items-center gap-3 border-l-4 py-2.5 pl-3.5 pr-3 text-left', STATUS_BAR[l.item.status])}>
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate font-bold', l.item.status === 'cancelado' && 'text-tinta-3 line-through')}>{l.item.patient_social_name || l.item.patient_name}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-tinta-2">
                      {l.item.modality === 'online' ? 'On-line' : l.item.location_name ?? 'Presencial'} · até {formatTime(l.item.ends_at, tz)}
                    </span>
                  </span>
                  <StatusBadge status={l.item.status} />
                </button>
              ) : (
                <button onClick={() => onLivre?.(l.livre)}
                  className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-cartao border border-dashed border-linha px-3.5 text-left text-tinta-3 hover:border-anil hover:bg-anil-claro/40 hover:text-anil-escuro">
                  <span className="flex-1">Horário disponível{variosLocais && l.livre.location && <span className="text-tinta-3"> · {l.livre.location.name}</span>}</span>
                  <IconPlus className="size-5 shrink-0 text-anil-escuro" />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Dia em cards: um por bloco de atendimento (sala + período), com as sessões e os horários disponíveis. */
function DiaPorBlocos({ date, items, tz, onOpen, onNew, faixas, locais, livres, onLivre }: {
  date: string; items: AgendaItem[]; tz: string; onOpen: (i: AgendaItem) => void; onNew: () => void;
  faixas: WorkingHour[]; locais: Location[]; livres: HorarioLivre[]; onLivre: (h: HorarioLivre) => void;
}) {
  const blocos = faixas
    .map((f) => ({ f, local: locais.find((l) => l.id === f.location_id) ?? null }))
    .filter((b) => b.local?.active !== false)
    .sort((a, b) => a.f.start_time.localeCompare(b.f.start_time));
  if (blocos.length === 0) return <DayList date={date} items={items} tz={tz} onOpen={onOpen} onNew={onNew} livres={livres} onLivre={onLivre} />;

  const usados = new Set<string>();
  const doBloco = blocos.map(({ f, local }) => {
    const ini = f.start_time.slice(0, 5); const fim = f.end_time.slice(0, 5);
    const sessoes = items.filter((it) => {
      const h = formatTime(it.starts_at, tz);
      const ok = !usados.has(it.id) && h >= ini && h < fim && (!it.location_id || it.location_id === f.location_id);
      if (ok) usados.add(it.id);
      return ok;
    });
    const linhas: Linha[] = [
      ...sessoes.map((item) => ({ tipo: 'sessao' as const, hora: formatTime(item.starts_at, tz), item })),
      ...livres.filter((l) => l.faixaId === f.id).map((livre) => ({ tipo: 'livre' as const, hora: livre.time, livre })),
    ].sort((x, y) => x.hora.localeCompare(y.hora));
    return { f, local, ini, fim, linhas };
  });
  const fora = items.filter((it) => !usados.has(it.id));

  return (
    <div className="flex flex-col gap-4">
      {fora.length > 0 && (
        <section aria-label="Outras sessões do dia">
          <p className="rotulo mb-2">Fora dos horários cadastrados</p>
          <DayList date={date} items={fora} tz={tz} onOpen={onOpen} onNew={onNew} />
        </section>
      )}
      {doBloco.map(({ f, local, ini, fim, linhas }) => (
        <section key={f.id} className="cartao overflow-hidden" aria-label={`${local?.name ?? 'Local'}, ${periodoDe(ini).nome}`}>
          <header className="flex items-center gap-2 border-b border-linha/70 px-4 py-3">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: local?.color ?? 'var(--color-anil)' }} aria-hidden />
            <h3 className="flex-1 font-bold">{local?.name ?? 'Local'} · {periodoDe(ini).nome}</h3>
            <span className="num text-sm text-tinta-3">{ini}–{fim}</span>
          </header>
          {linhas.length === 0 ? (
            <p className="px-4 py-3 text-sm text-tinta-3">Período encerrado, sem sessões.</p>
          ) : (
            <ol className="divide-y divide-linha/60">
              {linhas.map((l) => l.tipo === 'sessao' ? (
                <li key={l.item.id}>
                  <button onClick={() => onOpen(l.item)} className={cx('flex min-h-14 w-full items-center gap-3 border-l-4 py-2 pl-3 pr-3 text-left hover:bg-afundado', STATUS_BAR[l.item.status])}>
                    <span className="num w-12 shrink-0 font-bold">{l.hora}</span>
                    <span className={cx('min-w-0 flex-1 truncate font-bold', l.item.status === 'cancelado' && 'text-tinta-3 line-through')}>{l.item.patient_social_name || l.item.patient_name}</span>
                    <StatusBadge status={l.item.status} />
                  </button>
                </li>
              ) : (
                <li key={`livre-${l.hora}`} className="flex min-h-14 items-center gap-3 border-l-4 border-l-transparent py-2 pl-3 pr-2">
                  <span className="num w-12 shrink-0 font-bold text-tinta-3">{l.hora}</span>
                  <span className="flex-1 text-tinta-3">Disponível</span>
                  <button onClick={() => onLivre(l.livre)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-anil-claro px-3.5 text-sm font-bold text-sobre-anil-claro hover:brightness-95">
                    <IconPlus className="size-4" /> Novo agendamento
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}

function WeekGrid({ start, byDay, tz, from, to, onOpen, onNew }: {
  start: string; byDay: Map<string, AgendaItem[]>; tz: string; from: string; to: string;
  onOpen: (i: AgendaItem) => void; onNew: (date: string, time: string) => void;
}) {
  const h0 = Number(from.slice(0, 2)); const h1 = Math.max(h0 + 1, Number(to.slice(0, 2)) + (to.slice(3, 5) !== '00' ? 1 : 0));
  const PX = 56; // px por hora
  const hours = Array.from({ length: h1 - h0 }, (_, i) => h0 + i);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = todayIn(tz);
  return (
    <div className="overflow-hidden rounded-lg border border-linha bg-papel">
      <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-linha">
        <div />
        {days.map((d) => (
          <div key={d} className={cx('px-2 py-2 text-center', d === today && 'text-anil')}>
            <span className="block text-sm text-tinta-3">{weekdayShort(d)}</span>
            <span className="num text-lg font-bold">{Number(d.slice(8))}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[3.5rem_repeat(7,1fr)]">
        <div>
          {hours.map((h) => <div key={h} style={{ height: PX }} className="num pr-2 pt-1 text-right text-sm text-tinta-3">{String(h).padStart(2, '0')}:00</div>)}
        </div>
        {days.map((d) => (
          <div key={d} className="relative border-l border-linha" style={{ height: PX * hours.length }}>
            {hours.map((h) => (
              <button key={h} aria-label={`Agendar em ${formatLongDate(d)} às ${h}:00`} onClick={() => onNew(d, `${String(h).padStart(2, '0')}:00`)}
                className="block w-full border-b border-linha/70 hover:bg-anil-claro/50" style={{ height: PX }} />
            ))}
            {(byDay.get(d) ?? []).map((it) => {
              const s = zonedParts(it.starts_at, tz); const e = zonedParts(it.ends_at, tz);
              const top = ((s.hour - h0) * 60 + s.minute) / 60 * PX;
              const height = Math.max(22, ((e.hour - s.hour) * 60 + (e.minute - s.minute)) / 60 * PX - 2);
              if (top < 0 || top > PX * hours.length) return null;
              return (
                <button key={it.id} onClick={() => onOpen(it)} style={{ top, height }}
                  className={cx('absolute inset-x-1 overflow-hidden rounded border-l-4 bg-papel px-1.5 py-0.5 text-left text-sm shadow-cartao ring-1 ring-linha hover:ring-anil', STATUS_BAR[it.status], it.status === 'cancelado' && 'opacity-60')}>
                  <span className="num block font-bold">{s.time}</span>
                  <span className="block truncate">{it.patient_social_name || it.patient_name}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthGrid({ start, days, month, byDay, today, onPick }: { start: string; days: number; month: string; byDay: Map<string, AgendaItem[]>; today: string; onPick: (d: string) => void }) {
  const cells = Array.from({ length: days }, (_, i) => addDays(start, i));
  return (
    <div className="overflow-hidden rounded-lg border border-linha bg-papel">
      <div className="grid grid-cols-7 border-b border-linha text-center text-sm text-tinta-3">
        {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((w) => <div key={w} className="py-2">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d) => {
          const list = byDay.get(d) ?? [];
          const inMonth = d.startsWith(month);
          const pend = list.filter((i) => i.status === 'agendado').length;
          return (
            <button key={d} onClick={() => onPick(d)} aria-label={`${formatLongDate(d)}: ${list.length} sessões`}
              className={cx('min-h-16 border-b border-r border-linha p-1.5 text-left align-top hover:bg-anil-claro/50 sm:min-h-24', !inMonth && 'bg-gesso/60 text-tinta-3', weekday(d) === 0 && 'border-r-0')}>
              <span className={cx('num inline-flex h-7 w-7 items-center justify-center rounded-full font-bold', d === today && 'bg-anil text-sobre-anil')}>{Number(d.slice(8))}</span>
              {list.length > 0 && (
                <span className="mt-1 block text-sm">
                  <span className="num font-bold">{list.length}</span><span className="hidden sm:inline"> {list.length === 1 ? 'sessão' : 'sessões'}</span>
                  {pend > 0 && <span className="num block text-ocre">{pend}<span className="hidden sm:inline"> a confirmar</span></span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

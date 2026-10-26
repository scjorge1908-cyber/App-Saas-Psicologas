import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { AgendaItem, Location } from '../lib/types';
import { horariosLivres, type HorarioLivre } from '../lib/horarios';
import {
  addDays, daysInMonth, formatLongDate, formatTime, monthName, startOfMonth, startOfWeek, todayIn,
  weekday, weekdayShort, zonedParts, zonedToUtc,
} from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useProfile } from '../auth/AuthProvider';
import { AppointmentSheet } from '../components/appointments/AppointmentSheet';
import { NewAppointmentDialog } from '../components/appointments/NewAppointmentDialog';
import { Button, ErrorBox, Loading, STATUS_BAR, StatusBadge, Tabs, cx } from '../components/ui';
import { IconChevronLeft, IconChevronRight, IconPlus, IconToday } from '../components/icons';

type View = 'dia' | 'semana' | 'mes';

export function AgendaPage() {
  const { profile, tz } = useProfile();
  const [params, setParams] = useSearchParams();
  const view = (params.get('v') as View) || 'semana';
  const date = params.get('d') || todayIn(tz);
  const [open, setOpen] = useState<AgendaItem | null>(null);
  const [newAt, setNewAt] = useState<{ date: string; time?: string; locationId?: string | null } | null>(null);
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
    ? formatLongDate(date, true)
    : view === 'semana'
      ? `Semana de ${Number(range.start.slice(8))} de ${monthName(Number(range.start.slice(5, 7)))}`
      : `${monthName(Number(date.slice(5, 7)))[0].toUpperCase()}${monthName(Number(date.slice(5, 7))).slice(1)} de ${date.slice(0, 4)}`;

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-bold">Agenda</h1>
        <div className="flex items-center gap-1">
          <Link to="/agenda/horarios" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-[15px] font-bold text-tinta-2 hover:bg-cinza-fundo hover:text-anil">
            <IconToday /> Horários
          </Link>
          <Button onClick={() => setNewAt({ date: view === 'dia' ? date : todayIn(tz) })}><IconPlus /> Nova sessão</Button>
        </div>
      </header>

      {semHorarios && (
        <Link to="/agenda/horarios" className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-anil/30 bg-anil-claro px-4 py-3 text-anil-escuro">
          <span><strong className="block">Cadastre seus horários de atendimento</strong>
            <span className="text-[15px]">Locais e dias em que você atende. A agenda passa a mostrar os horários livres.</span></span>
          <IconChevronRight />
        </Link>
      )}

      <Tabs label="Visualização" value={view} onChange={(v) => set(v, date)} items={[
        { value: 'dia', label: 'Dia' }, { value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mês' },
      ]} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => move(-1)} aria-label="Anterior"><IconChevronLeft /></Button>
        <Button variant="secondary" size="sm" onClick={() => move(1)} aria-label="Próximo"><IconChevronRight /></Button>
        <Button variant="ghost" size="sm" onClick={() => set(view, todayIn(tz))}>Hoje</Button>
        <h2 className="ml-1 text-lg font-bold first-letter:uppercase">{title}</h2>
        <label className="ml-auto flex items-center gap-2 text-sm text-tinta-2">
          <input type="checkbox" className="h-4 w-4 accent-anil" checked={showCanceled} onChange={(e) => setShowCanceled(e.target.checked)} />
          Mostrar canceladas
        </label>
      </div>

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox>{errorMessage(q.error)}</ErrorBox>}

      {q.data && view === 'dia' && (
        <DayList date={date} items={byDay.get(date) ?? []} tz={tz} onOpen={setOpen} onNew={() => setNewAt({ date })}
          livres={livresDo(date)} onLivre={(h) => setNewAt({ date, time: h.time, locationId: h.location?.id ?? null })} />
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

      <AppointmentSheet item={open} onClose={() => setOpen(null)} />
      <NewAppointmentDialog open={!!newAt} onClose={() => setNewAt(null)} initialDate={newAt?.date} initialTime={newAt?.time} initialLocationId={newAt?.locationId ?? null} />
    </div>
  );
}

function DayList({ date, items, tz, onOpen, onNew, compact, livres = [], onLivre }: {
  date: string; items: AgendaItem[]; tz: string; onOpen: (i: AgendaItem) => void; onNew: () => void; compact?: boolean;
  livres?: HorarioLivre[]; onLivre?: (h: HorarioLivre) => void;
}) {
  return (
    <section aria-label={formatLongDate(date)}>
      {compact && <h3 className="mb-2 font-bold first-letter:uppercase">{formatLongDate(date)}</h3>}
      {livres.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1" aria-label="Horários livres">
          {livres.map((h) => (
            <button key={`${h.time}-${h.location?.id}`} type="button" onClick={() => onLivre?.(h)}
              className="num inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-anil/40 bg-papel px-3 text-[14px] font-bold text-anil hover:bg-anil-claro">
              <IconPlus className="size-4" /> {h.time}{h.location && <LocalPonto local={h.location} />}
            </button>
          ))}
        </div>
      )}
      {items.length === 0 && livres.length > 0 ? null : items.length === 0 ? (
        <button onClick={onNew} className="w-full rounded-lg border border-dashed border-linha-forte px-4 py-3 text-left text-tinta-3 hover:border-anil hover:text-anil">
          Livre. Toque para agendar.
        </button>
      ) : (
        <ul className="divide-y divide-linha rounded-lg border border-linha bg-papel">
          {items.map((it) => (
            <li key={it.id}>
              <button onClick={() => onOpen(it)} className={cx('flex w-full items-center gap-4 border-l-4 px-4 py-3 text-left hover:bg-gesso', STATUS_BAR[it.status])}>
                <span className="num w-24 shrink-0 font-bold">{formatTime(it.starts_at, tz)}–{formatTime(it.ends_at, tz)}</span>
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate font-bold', it.status === 'cancelado' && 'text-tinta-3 line-through')}>{it.patient_social_name || it.patient_name}</span>
                  {it.location_name && <span className="flex items-center gap-1.5 truncate text-sm text-tinta-3"><span className="size-2 shrink-0 rounded-full" style={{ background: it.location_color ?? 'var(--color-anil)' }} aria-hidden />{it.location_name}</span>}
                </span>
                <StatusBadge status={it.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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

function LocalPonto({ local }: { local: Location }) {
  return <span className="size-2 rounded-full" style={{ background: local.color ?? 'var(--color-anil)' }} title={local.name} aria-label={local.name} />;
}

// Horários livres da agenda, calculados a partir das faixas de atendimento cadastradas.
// Regra pura (sem rede): usada pela agenda real e pela demonstração, e coberta por testes.
import type { AgendaItem, Location, ScheduleBlock, WorkingHour } from './types';
import { bloqueioNoHorario } from './bloqueios';
import { weekday, zonedToUtc } from './format';

export interface HorarioLivre {
  time: string;          // HH:MM de início
  location: Location | null;
  minutes?: number;      // duração da sessão nesta faixa
  faixaId?: string;      // faixa (bloco sala + período) de onde saiu
}

const hm = (t: string) => t.slice(0, 5);
const minutos = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const texto = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Sugere os inícios de sessão livres num dia: dentro de cada faixa de atendimento daquele dia da semana,
 * de (duração + intervalo) em (duração + intervalo), sem bater em sessão não cancelada e sem horário que já passou.
 */
export function horariosLivres(args: {
  date: string;
  hours: WorkingHour[];
  locations: Location[];
  items: AgendaItem[];
  sessionMinutes: number;
  bufferMinutes: number;
  tz: string;
  agora?: Date;
  /** Férias, feriados e folgas: horário bloqueado não aparece como livre. */
  bloqueios?: ScheduleBlock[];
}): HorarioLivre[] {
  const { date, hours, locations, items, sessionMinutes, bufferMinutes, tz } = args;
  const agoraMs = (args.agora ?? new Date()).getTime();
  const dia = weekday(date);
  const ocupadas = items.filter((i) => i.status !== 'cancelado').map((i) => [new Date(i.starts_at).getTime(), new Date(i.ends_at).getTime()] as const);
  const livres: HorarioLivre[] = [];
  const faixas = hours.filter((h) => h.weekday === dia).sort((a, b) => minutos(a.start_time) - minutos(b.start_time));
  for (const f of faixas) {
    const local = locations.find((l) => l.id === f.location_id) ?? null;
    if (local && !local.active) continue;
    const dur = f.session_minutes ?? sessionMinutes;               // duração própria da faixa, se houver
    const passo = Math.max(10, dur + (f.buffer_minutes ?? bufferMinutes));
    for (let m = minutos(f.start_time); m + dur <= minutos(f.end_time); m += passo) {
      const ini = new Date(zonedToUtc(date, texto(m), tz)).getTime();
      const fim = ini + dur * 60000;
      if (ini < agoraMs) continue;
      if (ocupadas.some(([a, b]) => a < fim && b > ini)) continue;
      if (bloqueioNoHorario(args.bloqueios, date, m, m + dur)) continue;
      livres.push({ time: texto(m), location: local, minutes: dur, faixaId: f.id });
    }
  }
  return livres;
}

/** "Seg 08:00–12:00 · Sala 1" — resumo de uma faixa para listas. */
export function faixaTexto(h: WorkingHour): string {
  return `${hm(h.start_time)}–${hm(h.end_time)}`;
}

export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

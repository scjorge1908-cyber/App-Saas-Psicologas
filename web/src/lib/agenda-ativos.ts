// Todo paciente ativo aparece na agenda (regra do Jorge, 27/10/2026):
//  • começa no futuro (ex.: 1ª sessão em 30/12) → aparece desde já, toda semana, no mesmo dia e horário: "Começa 30/12";
//    o horário fica "Livre até 29/12" (dá para encaixar outro paciente só antes do início);
//  • avulso que não tem mais horário → continua no dia e horário da última sessão, com alerta para dar alta ou
//    marcar novo horário, até a psicóloga ajustar;
//  • quinzenal → já tratado na agenda (semana da sessão + semana alternada).
// Só calcula a partir das sessões; não grava nada.
import type { AgendaItem } from './types';
import { addDays, formatTime, weekday, zonedParts } from './format';

export type Referencia =
  | { tipo: 'futuro'; item: AgendaItem; inicio: string }
  | { tipo: 'semHorario'; item: AgendaItem };

const ativa = (a: AgendaItem) => a.status === 'agendado' || a.status === 'confirmado';

/** Para cada paciente ativo: a primeira sessão futura (se houver) ou a última sessão (se não tiver mais horário). */
export function referenciasDosAtivos(ativos: string[], itens: AgendaItem[], agora: number, tz: string): Map<string, Referencia> {
  const out = new Map<string, Referencia>();
  const ids = new Set(ativos);
  const porPaciente = new Map<string, AgendaItem[]>();
  for (const a of itens) {
    if (!ids.has(a.patient_id) || a.status === 'cancelado') continue;
    (porPaciente.get(a.patient_id) ?? porPaciente.set(a.patient_id, []).get(a.patient_id)!).push(a);
  }
  for (const [pid, lista] of porPaciente) {
    lista.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const futura = lista.find((a) => ativa(a) && new Date(a.starts_at).getTime() > agora);
    if (futura) { out.set(pid, { tipo: 'futuro', item: futura, inicio: zonedParts(futura.starts_at, tz).date }); continue; }
    const ultima = [...lista].reverse().find((a) => new Date(a.starts_at).getTime() <= agora);
    if (ultima) out.set(pid, { tipo: 'semHorario', item: ultima });
  }
  return out;
}

export type LinhaVirtual =
  | { tipo: 'futuro'; hora: string; item: AgendaItem; inicio: string; livreAte: string }
  | { tipo: 'semHorario'; hora: string; item: AgendaItem };

/** Linha que o paciente ocupa no dia `d` (ou nada). "Começa": só antes do início; "sem horário": a partir da última sessão. */
export function linhaDoDia(d: string, ref: Referencia, tz: string): LinhaVirtual | null {
  const dataRef = ref.tipo === 'futuro' ? ref.inicio : zonedParts(ref.item.starts_at, tz).date;
  if (weekday(d) !== weekday(dataRef)) return null;
  const hora = formatTime(ref.item.starts_at, tz);
  if (ref.tipo === 'futuro') return d < ref.inicio ? { tipo: 'futuro', hora, item: ref.item, inicio: ref.inicio, livreAte: addDays(ref.inicio, -1) } : null;
  return d >= dataRef ? { tipo: 'semHorario', hora, item: ref.item } : null;
}

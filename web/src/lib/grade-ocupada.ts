// Turno da grade com paciente não pode ser mudado nem excluído inteiro (regra do Jorge, 27/10/2026):
// antes, criar outra sala e passar os pacientes para ela (Mover), ou dar alta. Regra pura: só calcula.
// Conta como "paciente no turno": sessão futura agendada/confirmada naquele dia da semana, sala e faixa,
// e o paciente ativo sem próximo horário que continua aparecendo no horário da última sessão.
import type { AgendaItem, WorkingHour } from './types';
import type { Referencia } from './agenda-ativos';
import { weekday, zonedParts } from './format';

export interface PacienteNoTurno { patient_id: string; nome: string; hora: string; item: AgendaItem; semHorario: boolean }

const minutos = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const ativa = (a: AgendaItem) => a.status === 'agendado' || a.status === 'confirmado';

type Faixa = Pick<WorkingHour, 'weekday' | 'location_id' | 'start_time' | 'end_time'>;

/** Pacientes (um por pessoa, o horário mais cedo) com sessão dentro de [ini, fim) minutos da faixa. */
function pacientesNaFaixa(f: Faixa, ini: number, fim: number, itens: AgendaItem[], refs: Map<string, Referencia>, agora: number, tz: string): PacienteNoTurno[] {
  const candidatos: Array<{ item: AgendaItem; semHorario: boolean }> = [
    ...itens.filter((a) => ativa(a) && new Date(a.starts_at).getTime() >= agora).map((item) => ({ item, semHorario: false })),
    ...[...refs.values()].filter((r) => r.tipo === 'semHorario').map((r) => ({ item: r.item, semHorario: true })),
  ];
  const porPaciente = new Map<string, PacienteNoTurno>();
  for (const { item, semHorario } of candidatos) {
    if (item.location_id && item.location_id !== f.location_id) continue;
    const p = zonedParts(item.starts_at, tz);
    if (weekday(p.date) !== f.weekday) continue;
    const ii = p.hour * 60 + p.minute;
    const ff = ii + Math.max(1, Math.round((new Date(item.ends_at).getTime() - new Date(item.starts_at).getTime()) / 60000));
    if (!(ii < fim && ff > ini)) continue;
    const atual = porPaciente.get(item.patient_id);
    if (atual && atual.hora <= p.time) continue;
    porPaciente.set(item.patient_id, { patient_id: item.patient_id, nome: item.patient_social_name || item.patient_name, hora: p.time, item, semHorario });
  }
  return [...porPaciente.values()].sort((a, b) => a.hora.localeCompare(b.hora) || a.nome.localeCompare(b.nome));
}

/** Pacientes que caem no turno inteiro. */
export function pacientesNoTurno(f: Faixa, itens: AgendaItem[], refs: Map<string, Referencia>, agora: number, tz: string): PacienteNoTurno[] {
  return pacientesNaFaixa(f, minutos(f.start_time), minutos(f.end_time), itens, refs, agora, tz);
}

/** Pacientes que caem em um horário do turno (t, com a duração da sessão). */
export function pacientesNoHorario(f: Faixa, t: string, dur: number, itens: AgendaItem[], refs: Map<string, Referencia>, agora: number, tz: string): PacienteNoTurno[] {
  return pacientesNaFaixa(f, minutos(t), minutos(t) + dur, itens, refs, agora, tz);
}

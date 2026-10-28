// Bloqueio de agenda (pedido do Jorge, 27/10/2026): férias, feriados, folgas.
// Regra pura (sem rede): diz se um dia/horário está bloqueado e lista os feriados nacionais do ano.
import type { BlockKind, ScheduleBlock } from './types';

export const TIPO_BLOQUEIO: Record<BlockKind, string> = { ferias: 'Férias', feriado: 'Feriado', folga: 'Folga', outro: 'Bloqueio' };

const minutos = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Bloqueios que valem no dia (AAAA-MM-DD). */
export function bloqueiosDoDia(bloqueios: ScheduleBlock[] | undefined, dia: string): ScheduleBlock[] {
  return (bloqueios ?? []).filter((b) => b.starts_on <= dia && dia <= b.ends_on);
}

/** Bloqueio que cobre o intervalo [inicio, fim) em minutos do dia, ou null. Sem horário = dia inteiro. */
export function bloqueioNoHorario(bloqueios: ScheduleBlock[] | undefined, dia: string, inicio: number, fim: number): ScheduleBlock | null {
  for (const b of bloqueiosDoDia(bloqueios, dia)) {
    if (!b.start_time || !b.end_time) return b;
    if (minutos(b.start_time) < fim && minutos(b.end_time) > inicio) return b;
  }
  return null;
}

/** Texto curto do bloqueio: "Férias (dia inteiro)" ou "Folga 14:00–18:00", com o motivo se houver. */
export function textoBloqueio(b: ScheduleBlock): string {
  const quando = b.start_time && b.end_time ? `${b.start_time.slice(0, 5)}–${b.end_time.slice(0, 5)}` : 'dia inteiro';
  return `${TIPO_BLOQUEIO[b.kind]} · ${quando}${b.reason ? ` · ${b.reason}` : ''}`;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** Feriados nacionais do Brasil no ano (fixos + Sexta-feira Santa). Estaduais e municipais a psicóloga adiciona. */
export function feriadosNacionais(ano: number): Array<{ data: string; nome: string }> {
  const fixos: Array<[string, string]> = [
    ['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'], ['10-12', 'Nossa Senhora Aparecida'], ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'], ['11-20', 'Dia Nacional de Zumbi e da Consciência Negra'], ['12-25', 'Natal'],
  ];
  const sexta = new Date(pascoa(ano).getTime() - 2 * 86400000).toISOString().slice(0, 10);
  return [...fixos.map(([md, nome]) => ({ data: `${ano}-${md}`, nome })), { data: sexta, nome: 'Sexta-feira Santa' }]
    .sort((x, y) => x.data.localeCompare(y.data));
}

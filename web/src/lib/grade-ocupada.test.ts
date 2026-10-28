import { describe, expect, it } from 'vitest';
import { pacientesNoHorario, pacientesNoTurno } from './grade-ocupada';
import { referenciasDosAtivos } from './agenda-ativos';
import type { AgendaItem } from './types';

const tz = 'America/Sao_Paulo';
const agora = new Date('2026-10-27T18:00:00-03:00').getTime();
const s = (id: string, pid: string, ini: string, loc: string | null = 'sala1', status: AgendaItem['status'] = 'agendado') => ({
  id, patient_id: pid, patient_name: `Paciente ${pid}`, patient_social_name: null, location_id: loc, status,
  starts_at: ini, ends_at: new Date(new Date(ini).getTime() + 50 * 60000).toISOString(),
} as AgendaItem);
const turno = { weekday: 1, location_id: 'sala1', start_time: '08:00', end_time: '12:00' }; // segunda de manhã

describe('turno da grade com paciente', () => {
  it('conta só sessões futuras ativas no mesmo dia, sala e faixa (um por paciente)', () => {
    const itens = [
      s('a', 'p1', '2026-11-02T09:00:00-03:00'), s('b', 'p1', '2026-11-09T09:00:00-03:00'), // segunda 9h, 2x
      s('c', 'p2', '2026-11-02T14:00:00-03:00'), // fora da faixa
      s('d', 'p3', '2026-11-03T09:00:00-03:00'), // terça
      s('e', 'p4', '2026-11-02T10:00:00-03:00', 'sala2'), // outra sala
      s('f', 'p5', '2026-11-02T11:00:00-03:00', 'sala1', 'cancelado'),
      s('g', 'p6', '2026-10-26T08:00:00-03:00', 'sala1', 'atendido'), // passado
    ];
    const r = pacientesNoTurno(turno, itens, new Map(), agora, tz);
    expect(r.map((x) => [x.patient_id, x.hora])).toEqual([['p1', '09:00']]);
  });

  it('paciente ativo sem próximo horário continua ocupando o horário da última sessão', () => {
    const itens = [s('h', 'p7', '2026-10-26T10:00:00-03:00', 'sala1', 'atendido')];
    const refs = referenciasDosAtivos(['p7'], itens, agora, tz);
    const r = pacientesNoTurno(turno, itens, refs, agora, tz);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ patient_id: 'p7', hora: '10:00', semHorario: true });
  });

  it('por horário: só quem cai naquele horário', () => {
    const itens = [s('a', 'p1', '2026-11-02T09:00:00-03:00')];
    expect(pacientesNoHorario(turno, '09:00', 50, itens, new Map(), agora, tz)).toHaveLength(1);
    expect(pacientesNoHorario(turno, '08:00', 50, itens, new Map(), agora, tz)).toHaveLength(0);
    expect(pacientesNoHorario(turno, '10:00', 50, itens, new Map(), agora, tz)).toHaveLength(0);
  });
});

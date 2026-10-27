import { describe, expect, it } from 'vitest';
import { linhaDoDia, referenciasDosAtivos } from './agenda-ativos';
import type { AgendaItem } from './types';

const tz = 'America/Sao_Paulo';
const s = (id: string, pid: string, iso: string, status: AgendaItem['status'] = 'agendado') =>
  ({ id, patient_id: pid, starts_at: iso, ends_at: iso, status } as AgendaItem);
const agora = new Date('2026-10-27T18:00:00-03:00').getTime();

describe('pacientes ativos sempre na agenda', () => {
  it('começa no futuro: aparece desde já no mesmo dia da semana, com livre até a véspera', () => {
    const refs = referenciasDosAtivos(['p'], [s('a', 'p', '2026-12-29T09:00:00-03:00')], agora, tz);
    const ref = refs.get('p')!;
    expect(ref.tipo).toBe('futuro');
    expect(linhaDoDia('2026-11-03', ref, tz)).toMatchObject({ tipo: 'futuro', hora: '09:00', inicio: '2026-12-29', livreAte: '2026-12-28' });
    expect(linhaDoDia('2026-11-04', ref, tz)).toBeNull(); // outro dia da semana
    expect(linhaDoDia('2026-12-29', ref, tz)).toBeNull(); // no início a sessão de verdade aparece
  });

  it('avulso sem próximo horário: fica no dia e horário da última sessão (mesmo com falta)', () => {
    const refs = referenciasDosAtivos(['j'], [s('f', 'j', '2026-10-27T07:00:00-03:00', 'faltou')], agora, tz);
    const ref = refs.get('j')!;
    expect(ref.tipo).toBe('semHorario');
    expect(linhaDoDia('2026-10-27', ref, tz)).toMatchObject({ tipo: 'semHorario', hora: '07:00' });
    expect(linhaDoDia('2026-11-03', ref, tz)).toMatchObject({ tipo: 'semHorario' });
    expect(linhaDoDia('2026-10-20', ref, tz)).toBeNull(); // antes da última sessão, não
  });

  it('paciente inativo, sessões canceladas e quem já tem sessão futura no lugar certo', () => {
    const itens = [s('c', 'x', '2026-11-03T10:00:00-03:00', 'cancelado'), s('n', 'y', '2026-10-28T10:00:00-03:00')];
    const refs = referenciasDosAtivos(['y'], itens, agora, tz);
    expect(refs.has('x')).toBe(false);
    expect(refs.get('y')).toMatchObject({ tipo: 'futuro', inicio: '2026-10-28' });
  });
});

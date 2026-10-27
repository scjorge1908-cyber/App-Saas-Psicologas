import { describe, expect, it } from 'vitest';
import { bloqueioNoHorario, feriadosNacionais, textoBloqueio } from './bloqueios';
import { horariosLivres } from './horarios';
import type { ScheduleBlock, WorkingHour } from './types';

const ferias: ScheduleBlock = { id: 'f', kind: 'ferias', starts_on: '2027-01-04', ends_on: '2027-01-15', start_time: null, end_time: null, reason: null };
const folga: ScheduleBlock = { id: 'g', kind: 'folga', starts_on: '2026-11-06', ends_on: '2026-11-06', start_time: '14:00', end_time: '18:00', reason: 'Médico' };

describe('bloqueio de agenda', () => {
  it('dia inteiro e faixa de horário', () => {
    expect(bloqueioNoHorario([ferias], '2027-01-10', 600, 650)?.id).toBe('f');
    expect(bloqueioNoHorario([ferias], '2027-01-16', 600, 650)).toBeNull();
    expect(bloqueioNoHorario([folga], '2026-11-06', 15 * 60, 15 * 60 + 50)?.id).toBe('g');
    expect(bloqueioNoHorario([folga], '2026-11-06', 9 * 60, 9 * 60 + 50)).toBeNull();
    expect(textoBloqueio(folga)).toBe('Folga · 14:00–18:00 · Médico');
  });

  it('horário bloqueado não aparece como LIVRE', () => {
    const faixa: WorkingHour = { id: 'w', location_id: 'l', weekday: 5, start_time: '13:00', end_time: '19:00' };
    const livres = horariosLivres({ date: '2026-11-06', hours: [faixa], locations: [], items: [], sessionMinutes: 50, bufferMinutes: 10,
      tz: 'America/Sao_Paulo', agora: new Date('2026-11-01T00:00:00-03:00'), bloqueios: [folga] });
    expect(livres.map((l) => l.time)).toEqual(['13:00', '18:00']);
  });

  it('feriados nacionais com Sexta-feira Santa', () => {
    const f2027 = feriadosNacionais(2027);
    expect(f2027.find((f) => f.nome === 'Sexta-feira Santa')?.data).toBe('2027-03-26');
    expect(f2027.some((f) => f.data === '2027-11-20')).toBe(true);
    expect(f2027).toHaveLength(10);
  });
});

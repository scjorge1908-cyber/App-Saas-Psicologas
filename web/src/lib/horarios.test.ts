import { describe, expect, it } from 'vitest';
import { horariosLivres } from './horarios';
import { zonedToUtc } from './format';
import type { AgendaItem, Location, WorkingHour } from './types';

const sala: Location = { id: 'L1', name: 'Sala 1', modality: 'presencial', address: null, color: null, active: true };
const segunda = '2030-05-06'; // segunda-feira
const faixa: WorkingHour = { id: 'H1', location_id: 'L1', weekday: 1, start_time: '08:00:00', end_time: '12:00:00' };
const sessao = (ini: string, fim: string, status: AgendaItem['status'] = 'agendado') =>
  ({ status, starts_at: zonedToUtc(segunda, ini, 'America/Sao_Paulo'), ends_at: zonedToUtc(segunda, fim, 'America/Sao_Paulo') }) as AgendaItem;
const base = { date: segunda, hours: [faixa], locations: [sala], sessionMinutes: 50, bufferMinutes: 10, tz: 'America/Sao_Paulo', agora: new Date('2030-01-01T00:00:00Z') };

describe('horariosLivres', () => {
  it('divide a faixa em sessões de 50 min com 10 de intervalo', () => {
    expect(horariosLivres({ ...base, items: [] }).map((h) => h.time)).toEqual(['08:00', '09:00', '10:00', '11:00']);
  });
  it('tira os horários ocupados, mas não os cancelados', () => {
    const r = horariosLivres({ ...base, items: [sessao('09:00', '09:50'), sessao('10:00', '10:50', 'cancelado')] });
    expect(r.map((h) => h.time)).toEqual(['08:00', '10:00', '11:00']);
  });
  it('não sugere nada em dia sem faixa nem horário que já passou', () => {
    expect(horariosLivres({ ...base, date: '2030-05-07', items: [] })).toEqual([]);
    expect(horariosLivres({ ...base, items: [], agora: new Date(zonedToUtc(segunda, '10:30', 'America/Sao_Paulo')) }).map((h) => h.time)).toEqual(['11:00']);
  });
  it('ignora local desativado e informa o local de cada horário', () => {
    expect(horariosLivres({ ...base, items: [] })[0].location?.name).toBe('Sala 1');
    expect(horariosLivres({ ...base, locations: [{ ...sala, active: false }], items: [] })).toEqual([]);
  });
});

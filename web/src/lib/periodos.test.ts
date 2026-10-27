import { describe, expect, it } from 'vitest';
import { PERIODOS, gerarInicios, periodoDe } from './periodos';

describe('períodos de atendimento', () => {
  it('manhã 07–12, tarde 13–17, noite 18–22', () => {
    expect(PERIODOS.map((p) => `${p.inicio}-${p.fim}`)).toEqual(['07:00-12:00', '13:00-17:00', '18:00-22:00']);
  });
  it('1 hora com 10 min de intervalo na manhã', () => {
    expect(gerarInicios('07:00', '12:00', 60, 10)).toEqual(['07:00', '08:10', '09:20', '10:30']);
  });
  it('1 hora sem intervalo na tarde e 50 + 10 na noite', () => {
    expect(gerarInicios('13:00', '17:00', 60, 0)).toEqual(['13:00', '14:00', '15:00', '16:00']);
    expect(gerarInicios('18:00', '22:00', 50, 10)).toEqual(['18:00', '19:00', '20:00', '21:00']);
  });
  it('identifica o período pelo início', () => {
    expect(periodoDe('08:10').nome).toBe('Manhã');
    expect(periodoDe('13:00:00').nome).toBe('Tarde');
    expect(periodoDe('19:00').nome).toBe('Noite');
  });
});

import { describe, expect, it } from 'vitest';
import { agruparColunas, contar, type Bloco, type Linha } from './agenda-colunas';
import type { AgendaItem, Location } from './types';

const sala = (id: string, name: string) => ({ id, name } as Location);
const livre = (hora: string): Linha => ({ tipo: 'livre', hora, livre: { time: hora, location: null } });
const sessao = (hora: string, id = hora): Linha => ({ tipo: 'sessao', hora, item: { id } as AgendaItem });
const bloco = (date: string, titulo: string, s: Location | null, faixa: string | null, linhas: Linha[]): Bloco =>
  ({ chave: `${date}-${titulo}-${s?.id}-${faixa}`, date, titulo, sala: s, faixa, linhas });

describe('agruparColunas', () => {
  const s1 = sala('s1', 'Sala 1');
  const s2 = sala('s2', 'Sala 2');

  it('um cartão por dia + sala, com os períodos em ordem', () => {
    const cols = agruparColunas([
      bloco('2026-10-27', 'Tarde', s1, '13:00–17:00', [livre('13:00')]),
      bloco('2026-10-27', 'Manhã', s1, '08:00–12:00', [sessao('08:00')]),
      bloco('2026-10-26', 'Manhã', s2, '08:00–12:00', [livre('09:00')]),
    ]);
    expect(cols.map((c) => `${c.date} ${c.sala?.name}`)).toEqual(['2026-10-26 Sala 2', '2026-10-27 Sala 1']);
    expect(cols[1].periodos.map((p) => p.titulo)).toEqual(['Manhã', 'Tarde']);
  });

  it('salas diferentes no mesmo dia ficam em cartões separados', () => {
    const cols = agruparColunas([
      bloco('2026-10-27', 'Manhã', s2, '08:00–12:00', [livre('08:00')]),
      bloco('2026-10-27', 'Manhã', s1, '08:00–12:00', [livre('08:00')]),
    ]);
    expect(cols.map((c) => c.sala?.name)).toEqual(['Sala 1', 'Sala 2']);
  });

  it('faixas do mesmo período e sala viram um período só, em ordem de horário', () => {
    const [c] = agruparColunas([
      bloco('2026-10-27', 'Manhã', s1, '10:00–12:00', [livre('10:00'), sessao('11:00')]),
      bloco('2026-10-27', 'Manhã', s1, '07:00–09:00', [livre('07:00')]),
    ]);
    expect(c.periodos).toHaveLength(1);
    expect(c.periodos[0].faixa).toBe('07:00–12:00');
    expect(c.periodos[0].linhas.map((l) => l.hora)).toEqual(['07:00', '10:00', '11:00']);
  });

  it('"Outros horários" entra no cartão do mesmo dia, depois dos períodos', () => {
    const cols = agruparColunas([
      bloco('2026-10-27', 'Outros horários', null, null, [sessao('20:30')]),
      bloco('2026-10-27', 'Manhã', s1, '08:00–12:00', [livre('08:00')]),
    ]);
    expect(cols).toHaveLength(1);
    expect(cols[0].periodos.map((p) => p.titulo)).toEqual(['Manhã', 'Outros horários']);
  });

  it('dia só com sessões fora da grade ganha cartão próprio, sem sala', () => {
    const cols = agruparColunas([bloco('2026-10-28', 'Outros horários', null, null, [sessao('10:00')])]);
    expect(cols).toHaveLength(1);
    expect(cols[0].sala).toBeNull();
  });

  it('nenhuma linha se perde no agrupamento', () => {
    const blocos = [
      bloco('2026-10-27', 'Manhã', s1, '08:00–12:00', [livre('08:00'), sessao('09:00')]),
      bloco('2026-10-27', 'Manhã', s2, '08:00–12:00', [sessao('08:00', 'x')]),
      bloco('2026-10-27', 'Outros horários', null, null, [sessao('21:00', 'y')]),
    ];
    expect(contar(agruparColunas(blocos))).toEqual({ agendados: 3, livres: 1 });
  });
});

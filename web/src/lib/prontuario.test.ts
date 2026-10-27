import { describe, expect, it } from 'vitest';
import { cpfMascarado, lerEvolucao, montarEvolucao, resumirProntuarios } from './prontuario';
import type { Patient } from './types';

describe('evolução estruturada', () => {
  const e = { formato: 'online' as const, humor: ['Ansioso', 'Reativo'], queixa: 'Retorno ao trabalho.\nTaquicardia em reuniões.', abordagens: ['TCC'], intervencoes: 'Psicoeducação e respiração 4-4-6.', tarefas: ['Diário de emoções', 'Pausa de 5 min'] };
  it('monta texto legível e lê de volta igual', () => {
    const txt = montarEvolucao(e);
    expect(txt).toContain('## Queixa / tema central');
    expect(txt).toContain('- Diário de emoções');
    expect(lerEvolucao(txt)).toEqual(e);
  });
  it('registro antigo em texto livre não é tratado como estruturado', () => {
    expect(lerEvolucao('Paciente relatou melhora.')).toBeNull();
  });
});

describe('resumo da lista de prontuários', () => {
  const p = (id: string): Patient => ({ id, full_name: `Paciente ${id}`, created_at: '2026-01-01T00:00:00Z' }) as Patient;
  const agora = new Date('2026-10-27T12:00:00Z');
  it('marca evolução pendente, conta a sessão e acha a próxima', () => {
    const r = resumirProntuarios([p('A'), p('B')], [
      { patient_id: 'A', kind: 'identificacao_demanda', appointment_id: null, entry_date: '2026-09-01', created_at: '2026-09-01', content: 'Ansiedade   generalizada' },
      { patient_id: 'B', kind: 'evolucao', appointment_id: 's3', entry_date: '2026-10-20', created_at: '2026-10-20' },
    ], [
      { id: 's1', patient_id: 'A', starts_at: '2026-10-13T12:00:00Z', status: 'atendido' },
      { id: 's2', patient_id: 'A', starts_at: '2026-10-20T12:00:00Z', status: 'atendido' },
      { id: 's4', patient_id: 'A', starts_at: '2026-10-28T12:00:00Z', status: 'agendado' },
      { id: 's3', patient_id: 'B', starts_at: '2026-10-20T15:00:00Z', status: 'atendido' },
    ], agora);
    expect(r[0].patient.id).toBe('A');
    expect(r[0]).toMatchObject({ demanda: 'Ansiedade generalizada', evolucaoPendente: true, proxima: '2026-10-28T12:00:00Z' });
    expect(r[0].ultima?.numero).toBe(2);
    expect(r[1]).toMatchObject({ evolucaoPendente: false, evolucoes: 1 });
  });
  it('mascara o CPF', () => { expect(cpfMascarado('12382410899')).toBe('***.824.108-**'); });
});

import { describe, expect, it } from 'vitest';
import { linkAgendamentoUrl, pacienteDoPedido, pedidosComoOcupados, textoConviteLink } from './agendamento-link';
import type { BookingRequest } from './types';

const pedido: BookingRequest = {
  id: 'r1', link_id: 'l1', starts_at: '2026-11-03T12:00:00.000Z', ends_at: '2026-11-03T12:50:00.000Z', location_id: 'sala', status: 'pendente',
  patient_id: null, decided_at: null, created_at: '2026-10-28T12:00:00.000Z',
  patient_data: { full_name: 'Maria Fictícia', phone: '48999990001', cpf: '52998224725', email: 'maria@exemplo.invalid', birth_date: '1990-03-25',
    cep: '88132150', street: 'Rua Fictícia', address_number: '10', neighborhood: 'Centro', city: 'Palhoça', uf: 'SC', status: 'inativo', owner_id: 'x' },
};

describe('agendamento pelo paciente', () => {
  it('link e texto do convite', () => {
    const url = linkAgendamentoUrl('https://app.exemplo/', 'abc');
    expect(url).toBe('https://app.exemplo/a/abc');
    expect(textoConviteLink(url, 'Ana Fictícia')).toContain(url);
  });
  it('cadastro do pedido: só campos permitidos, com valor, duração e modalidade do link', () => {
    const p = pacienteDoPedido(pedido, { price: 180, modality: 'presencial' });
    expect(p).toMatchObject({ full_name: 'Maria Fictícia', cpf: '52998224725', session_price: 180, session_minutes: 50, modality: 'presencial' });
    expect(p).not.toHaveProperty('status');
    expect(p).not.toHaveProperty('owner_id');
  });
  it('pedido pendente ocupa o horário; recusado não', () => {
    expect(pedidosComoOcupados([pedido])).toHaveLength(1);
    expect(pedidosComoOcupados([{ ...pedido, status: 'recusado' }])).toHaveLength(0);
  });
});

// Garante que a demonstração abre com um consultório coerente e que os fluxos principais funcionam em memória.
import { beforeEach, describe, expect, it } from 'vitest';
import * as demo from './api-demo';
import { addDays, todayIn, zonedToUtc } from '../format';

const hoje = todayIn();

describe('demonstração', () => {
  beforeEach(() => demo.limparDemo());

  it('abre com pacientes, agenda da semana e números no painel', async () => {
    const pacientes = await demo.listPatients();
    expect(pacientes.length).toBeGreaterThanOrEqual(5);
    expect(pacientes.every((p) => p.full_name.includes('Fictíci'))).toBe(true);
    const semana = await demo.listAgenda(zonedToUtc(hoje, '00:00'), zonedToUtc(addDays(hoje, 7), '00:00'));
    expect(semana.length).toBeGreaterThanOrEqual(5);
    const d = await demo.dashboard();
    expect(d.active_patients).toBe(5);
    expect(d.to_register).toBeGreaterThan(0);
    expect(d.overdue).toBeGreaterThan(0);
    expect(d.received_month + d.receivable).toBeGreaterThan(0);
  });

  it('registrar presença gera cobrança e o recebimento quita', async () => {
    const [pendente] = await demo.listToRegister(new Date().toISOString());
    expect(pendente).toBeTruthy();
    await demo.setStatus(pendente.id, 'atendido');
    const cobrancas = await demo.listCharges({ patientId: pendente.patient_id, open: true });
    const nova = cobrancas.find((c) => c.appointment_id === pendente.id);
    if (pendente.patient_billing_mode === 'por_sessao' && pendente.price) {
      expect(nova?.balance).toBe(pendente.price);
      await demo.createPayment({ patient_id: pendente.patient_id, charge_id: nova!.id, amount: nova!.amount, paid_on: hoje, method: 'pix', receita_saude_status: 'pendente' });
      const depois = await demo.listCharges({ patientId: pendente.patient_id });
      expect(depois.find((c) => c.id === nova!.id)?.status).toBe('paga');
    }
  });

  it('bloqueia conflito de horário e guarda versão ao retificar o prontuário', async () => {
    const [primeira] = await demo.listAgenda(zonedToUtc(hoje, '00:00'), zonedToUtc(addDays(hoje, 7), '00:00'));
    const [p] = await demo.listPatients();
    await expect(demo.createAppointment({ patient_id: p.id, starts_at: primeira.starts_at, ends_at: primeira.ends_at, price: 100, modality: 'presencial' }))
      .rejects.toThrow(/horário/);
    const reg = await demo.saveRecord({ patient_id: p.id, content: 'Texto original fictício' });
    await demo.saveRecord({ id: reg.id, patient_id: p.id, content: 'Texto retificado fictício' });
    const versoes = await demo.listRecordVersions(reg.id);
    expect(versoes).toHaveLength(1);
    expect(versoes[0].content).toBe('Texto original fictício');
  });

  it('cria série semanal e informa conflitos', async () => {
    const [p] = await demo.listPatients();
    const r = await demo.createSeries({ patientId: p.id, frequency: 'semanal', startDate: addDays(hoje, 1), startTime: '07:00', duration: 50, occurrences: 4, modality: 'online' });
    expect(r.created.length + r.conflicts.length).toBe(4);
  });
});

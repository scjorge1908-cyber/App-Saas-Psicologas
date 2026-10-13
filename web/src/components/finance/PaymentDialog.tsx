import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { ChargeBalance, Patient, PaymentMethod } from '../../lib/types';
import { errorMessage } from '../../lib/errors';
import { isValidCpf, money, onlyDigits, parseMoney, todayIn } from '../../lib/format';
import { useProfile } from '../../auth/AuthProvider';
import { Button, Dialog, ErrorBox, Field, Input, Select, TextField, useToast } from '../ui';

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix', dinheiro: 'Dinheiro', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito',
  transferencia: 'Transferência', boleto: 'Boleto', outro: 'Outro',
};

export function useInvalidateFinance() {
  const qc = useQueryClient();
  return () => Promise.all(['charges', 'payments', 'dashboard', 'report', 'expenses', 'invoices'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

/** Registrar recebimento (de uma cobrança específica ou avulso para um paciente). */
export function PaymentDialog({ open, onClose, charge, patient }: { open: boolean; onClose: () => void; charge?: ChargeBalance | null; patient?: Patient | null }) {
  const { profile, tz } = useProfile();
  const invalidate = useInvalidateFinance();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIn(tz));
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [payerName, setPayerName] = useState('');
  const [payerCpf, setPayerCpf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(charge ? String(charge.balance).replace('.', ',') : '');
    setDate(todayIn(tz)); setMethod('pix'); setError(null);
    setPayerName(patient?.payer_name ?? '');
    setPayerCpf(patient?.payer_cpf ?? '');
  }, [open, charge, patient, tz]);

  const patientId = charge?.patient_id ?? patient?.id;
  const isPf = profile?.fiscal_type === 'pf';

  async function submit() {
    setError(null);
    const v = parseMoney(amount);
    if (!v || v <= 0) return setError('Informe o valor recebido.');
    if (charge && v > charge.balance) return setError(`O valor não pode passar do saldo em aberto (${money(charge.balance)}).`);
    if (payerCpf && !isValidCpf(payerCpf)) return setError('CPF do pagador inválido.');
    if (!patientId) return setError('Paciente não identificado.');
    setBusy(true);
    try {
      await api.createPayment({
        patient_id: patientId, charge_id: charge?.id ?? null, amount: v, paid_on: date, method,
        payer_name: payerName.trim() || null, payer_cpf: onlyDigits(payerCpf) || null,
        receita_saude_status: isPf ? 'pendente' : 'nao_aplicavel',
      });
      await invalidate();
      toast('Recebimento registrado');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Registrar recebimento" footer={<>
      <Button variant="secondary" onClick={onClose}>Voltar</Button>
      <Button busy={busy} onClick={submit}>Registrar recebimento</Button>
    </>}>
      <div className="flex flex-col gap-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        {charge && <p className="text-tinta-2">{charge.patient_name}: {charge.description}. Saldo em aberto <strong className="num text-tinta">{money(charge.balance)}</strong>.</p>}
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Valor (R$)" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Field label="Data do pagamento" required>{(id) => <Input id={id} type="date" value={date} max={todayIn(tz)} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <Field label="Forma de pagamento">{(id) => (
          <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        )}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Pagador (se não for o paciente)" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
          <TextField label="CPF do pagador" inputMode="numeric" value={payerCpf} onChange={(e) => setPayerCpf(e.target.value)} />
        </div>
        <p className="text-sm text-tinta-3">
          Este registro é um controle interno; o sistema não processa pagamentos.
          {isPf && ' Lembre de emitir o recibo no Receita Saúde: o recebimento fica como pendente até você marcar.'}
        </p>
      </div>
    </Dialog>
  );
}

/** Lançar cobrança manual (mensalidade, pacote, avaliação…). */
export function ChargeDialog({ open, onClose, patients, patientId }: { open: boolean; onClose: () => void; patients: Patient[]; patientId?: string }) {
  const { tz } = useProfile();
  const invalidate = useInvalidateFinance();
  const toast = useToast();
  const [pid, setPid] = useState(patientId ?? '');
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState(todayIn(tz));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setPid(patientId ?? ''); setDesc(''); setAmount(''); setDue(todayIn(tz)); setError(null); } }, [open, patientId, tz]);

  async function submit() {
    setError(null);
    const v = parseMoney(amount);
    if (!pid) return setError('Escolha o paciente.');
    if (!desc.trim()) return setError('Descreva a cobrança. Exemplo: Mensalidade de outubro.');
    if (!v) return setError('Informe o valor.');
    setBusy(true);
    try {
      await api.createCharge({ patient_id: pid, description: desc.trim(), amount: v, due_date: due });
      await invalidate();
      toast('Cobrança lançada');
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Nova cobrança" footer={<>
      <Button variant="secondary" onClick={onClose}>Voltar</Button>
      <Button busy={busy} onClick={submit}>Lançar cobrança</Button>
    </>}>
      <div className="flex flex-col gap-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Paciente" required>{(id) => (
          <Select id={id} value={pid} onChange={(e) => setPid(e.target.value)} disabled={!!patientId}>
            <option value="">Escolha o paciente</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.social_name || p.full_name}</option>)}
          </Select>
        )}</Field>
        <TextField label="Descrição" required placeholder="Mensalidade de outubro" maxLength={200} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Valor (R$)" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Field label="Vencimento" required>{(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
        </div>
        <p className="text-sm text-tinta-3">Sessões de pacientes cobrados por sessão geram cobrança automaticamente quando marcadas como atendidas.</p>
      </div>
    </Dialog>
  );
}

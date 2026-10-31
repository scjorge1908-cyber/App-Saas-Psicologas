import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { Expense, PaymentItem } from '../lib/types';
import { errorMessage } from '../lib/errors';
import { addDays, daysInMonth, formatCpf, formatDate, money, monthName, parseMoney, startOfMonth, sumMoney, todayIn } from '../lib/format';
import { useProfile } from '../auth/AuthProvider';
import { Badge, Button, Dialog, Empty, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, Tabs, TextField, useConfirm, useToast } from '../components/ui';
import { ChargesList } from '../components/finance/ChargesList';
import { ChargeDialog, METHOD_LABEL, PaymentDialog, useInvalidateFinance } from '../components/finance/PaymentDialog';
import { saveBlob } from '../components/patients/DocumentsTab';
import { ReciboAssistido } from '../components/finance/ReciboAssistido';
import { ArquivoCarneLeao, ArquivoUmRecibo } from '../components/finance/ArquivoCarneLeao';
import { abrirExterno } from '../lib/abrir-externo';
import { URL_ECAC } from '../lib/receita-saude';

type Tab = 'receber' | 'recebimentos' | 'despesas' | 'relatorio' | 'receita';

export function FinancePage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('aba') as Tab) || 'receber';
  const { profile } = useProfile();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  return (
    <div>
      <PageHeader title="Financeiro" subtitle="Controle de valores a receber, recebimentos e despesas. O sistema não processa pagamentos." />
      {dash.data && (
        <p className="num mb-5 text-tinta-2">
          A receber <strong className="text-tinta">{money(dash.data.receivable)}</strong>, dos quais <strong className={dash.data.overdue > 0 ? 'text-vermelho' : 'text-tinta'}>{money(dash.data.overdue)}</strong> vencidos. Recebido neste mês: <strong className="text-tinta">{money(dash.data.received_month)}</strong>.
        </p>
      )}
      <Tabs label="Seções do financeiro" value={tab} onChange={(v) => setParams({ aba: v }, { replace: true })} items={[
        { value: 'receber', label: 'A receber' }, { value: 'recebimentos', label: 'Recebimentos' }, { value: 'despesas', label: 'Despesas' },
        { value: 'relatorio', label: 'Relatório' },
        ...(profile?.fiscal_type === 'pf' ? [{ value: 'receita' as Tab, label: 'Receita Saúde', count: dash.data?.receita_saude_pending }] : []),
      ]} />
      {tab === 'receber' && <ReceivablesTab />}
      {tab === 'recebimentos' && <PaymentsTab />}
      {tab === 'despesas' && <ExpensesTab />}
      {tab === 'relatorio' && <ReportTab />}
      {tab === 'receita' && <ReceitaSaudeTab />}
    </div>
  );
}

function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y, m] = value.split('-').map(Number);
  const shift = (d: number) => { const t = new Date(Date.UTC(y, m - 1 + d, 1)); onChange(t.toISOString().slice(0, 10)); };
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => shift(-1)} aria-label="Mês anterior">‹</Button>
      <span className="min-w-36 text-center font-bold">{monthName(m)} de {y}</span>
      <Button size="sm" variant="secondary" onClick={() => shift(1)} aria-label="Próximo mês">›</Button>
    </div>
  );
}

function ReceivablesTab() {
  const charges = useQuery({ queryKey: ['charges', 'open'], queryFn: () => api.listCharges({ open: true }) });
  const patients = useQuery({ queryKey: ['patients'], queryFn: api.listPatients });
  const [creating, setCreating] = useState(false);
  const sorted = useMemo(() => [...(charges.data ?? [])].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.due_date.localeCompare(b.due_date)), [charges.data]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end"><Button variant="secondary" onClick={() => setCreating(true)}>Nova cobrança</Button></div>
      {charges.isLoading && <Loading />}
      {charges.error && <ErrorBox>{errorMessage(charges.error)}</ErrorBox>}
      {charges.data?.length === 0 && <Empty title="Nada a receber.">Sessões atendidas de pacientes cobrados por sessão aparecem aqui automaticamente.</Empty>}
      <ChargesList charges={sorted} patients={patients.data} />
      <ChargeDialog open={creating} onClose={() => setCreating(false)} patients={(patients.data ?? []).filter((p) => p.status === 'ativo')} />
    </div>
  );
}

function PaymentsTab() {
  const { tz } = useProfile();
  const [month, setMonth] = useState(startOfMonth(todayIn(tz)));
  const to = addDays(month, daysInMonth(month) - 1);
  const q = useQuery({ queryKey: ['payments', month], queryFn: () => api.listPayments({ from: month, to }) });
  const patients = useQuery({ queryKey: ['patients'], queryFn: api.listPatients });
  const [avulso, setAvulso] = useState(false);
  const [pid, setPid] = useState('');
  const invalidate = useInvalidateFinance();
  const confirm = useConfirm();
  const toast = useToast();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker value={month} onChange={setMonth} />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => exportPaymentsCsv(q.data ?? [], month)} disabled={!q.data?.length}>Exportar CSV</Button>
          <Button variant="secondary" onClick={() => setAvulso(true)}>Recebimento avulso</Button>
        </div>
      </div>
      {q.isLoading && <Loading />}
      {q.data?.length === 0 && <p className="text-tinta-2">Nenhum recebimento neste mês.</p>}
      {q.data && q.data.length > 0 && (
        <>
          <ul className="divide-y divide-linha rounded-lg border border-linha bg-papel">
            {q.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-bold">{p.patient_name}</p>
                  <p className="text-sm text-tinta-2"><span className="num">{formatDate(p.paid_on)}</span>, {METHOD_LABEL[p.method]}{p.charge_description ? `, ${p.charge_description}` : ''}{p.payer_name ? `, pago por ${p.payer_name}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="num font-bold">{money(p.amount)}</span>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!(await confirm({ title: 'Excluir recebimento?', body: `${money(p.amount)} de ${p.patient_name} em ${formatDate(p.paid_on)}. A cobrança volta a ficar em aberto.`, confirmLabel: 'Excluir', danger: true }))) return;
                    try { await api.deletePayment(p.id); await invalidate(); toast('Recebimento excluído'); } catch (e) { toast(errorMessage(e), 'erro'); }
                  }}>Excluir</Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="num text-right text-lg">Total do mês: <strong>{money(sumMoney(q.data.map((p) => p.amount)))}</strong></p>
        </>
      )}
      <Dialog open={avulso && !pid} onClose={() => setAvulso(false)} title="Recebimento avulso">
        <Field label="Paciente">{(id) => (
          <Select id={id} value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">Escolha o paciente</option>
            {patients.data?.map((p) => <option key={p.id} value={p.id}>{p.social_name || p.full_name}</option>)}
          </Select>
        )}</Field>
      </Dialog>
      <PaymentDialog open={avulso && !!pid} onClose={() => { setAvulso(false); setPid(''); }} patient={patients.data?.find((p) => p.id === pid)} />
    </div>
  );
}

function csv(rows: Array<Array<string | number | null>>): Blob {
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // ; e BOM para abrir corretamente no Excel em português
  return new Blob(['﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
}
const brNum = (n: number) => n.toFixed(2).replace('.', ',');

function exportPaymentsCsv(items: PaymentItem[], month: string) {
  saveBlob(csv([
    ['data_pagamento', 'paciente', 'cpf_paciente', 'pagador', 'cpf_pagador', 'valor', 'forma', 'referente', 'receita_saude'],
    ...items.map((p) => [formatDate(p.paid_on), p.patient_name, p.patient_cpf ?? '', p.payer_name ?? '', p.payer_cpf ?? '', brNum(p.amount), METHOD_LABEL[p.method], p.charge_description ?? '', p.receita_saude_status]),
  ]), `recebimentos-${month.slice(0, 7)}.csv`);
}

function ExpensesTab() {
  const { tz } = useProfile();
  const [month, setMonth] = useState(startOfMonth(todayIn(tz)));
  const to = addDays(month, daysInMonth(month) - 1);
  const q = useQuery({ queryKey: ['expenses', month], queryFn: () => api.listExpenses(month, to) });
  const [editing, setEditing] = useState<Partial<Expense> | null>(null);
  const invalidate = useInvalidateFinance();
  const confirm = useConfirm();
  const toast = useToast();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker value={month} onChange={setMonth} />
        <Button variant="secondary" onClick={() => setEditing({ expense_date: todayIn(tz), category: 'aluguel', paid: true })}>Nova despesa</Button>
      </div>
      {q.isLoading && <Loading />}
      {q.data?.length === 0 && <p className="text-tinta-2">Nenhuma despesa neste mês.</p>}
      {q.data && q.data.length > 0 && (
        <>
          <ul className="divide-y divide-linha rounded-lg border border-linha bg-papel">
            {q.data.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <button className="text-left" onClick={() => setEditing(e)}>
                  <p className="font-bold">{e.description}</p>
                  <p className="text-sm text-tinta-2"><span className="num">{formatDate(e.expense_date)}</span>, {e.category}{!e.paid && <> <Badge tone="atencao">A pagar</Badge></>}</p>
                </button>
                <div className="flex items-center gap-2">
                  <span className="num font-bold">{money(e.amount)}</span>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!(await confirm({ title: 'Excluir despesa?', body: `${e.description}, ${money(e.amount)}.`, confirmLabel: 'Excluir', danger: true }))) return;
                    try { await api.deleteExpense(e.id); await invalidate(); toast('Despesa excluída'); } catch (err) { toast(errorMessage(err), 'erro'); }
                  }}>Excluir</Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="num text-right text-lg">Total do mês: <strong>{money(sumMoney(q.data.map((e) => e.amount)))}</strong></p>
        </>
      )}
      <ExpenseDialog expense={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

const CATEGORIES = ['aluguel', 'supervisão', 'formação', 'conselho (anuidade CRP)', 'impostos', 'sistemas e internet', 'material', 'transporte', 'outros'];

function ExpenseDialog({ expense, onClose }: { expense: Partial<Expense> | null; onClose: () => void }) {
  const invalidate = useInvalidateFinance();
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const [paid, setPaid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!expense) return;
    setF({ description: expense.description ?? '', category: expense.category ?? 'outros', amount: expense.amount != null ? String(expense.amount).replace('.', ',') : '', expense_date: expense.expense_date ?? '' });
    setPaid(expense.paid ?? true); setError(null);
  }, [expense]);
  if (!expense) return null;

  async function save() {
    const amount = parseMoney(f.amount ?? '');
    if (!f.description?.trim()) return setError('Descreva a despesa.');
    if (!amount) return setError('Informe o valor.');
    setBusy(true);
    try {
      await api.saveExpense({ id: expense!.id, description: f.description.trim(), category: f.category, amount, expense_date: f.expense_date, paid });
      await invalidate(); toast('Despesa salva'); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={expense.id ? 'Editar despesa' : 'Nova despesa'} footer={<>
      <Button variant="secondary" onClick={onClose}>Voltar</Button><Button busy={busy} onClick={save}>Salvar despesa</Button>
    </>}>
      <div className="flex flex-col gap-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <TextField label="Descrição" required value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Valor (R$)" inputMode="decimal" required value={f.amount ?? ''} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <Field label="Data">{(id) => <Input id={id} type="date" value={f.expense_date ?? ''} onChange={(e) => setF({ ...f, expense_date: e.target.value })} />}</Field>
        </div>
        <Field label="Categoria">{(id) => (
          <Select id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}</Field>
        <label className="flex items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-anil" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Já paga</label>
      </div>
    </Dialog>
  );
}

function ReportTab() {
  const { tz } = useProfile();
  const [year, setYear] = useState(Number(todayIn(tz).slice(0, 4)));
  const q = useQuery({ queryKey: ['report', year], queryFn: () => api.financialReport(`${year}-01-01`, `${year}-12-01`) });
  const totals = useMemo(() => {
    const r = q.data ?? [];
    return {
      billed: sumMoney(r.map((x) => x.billed)), received: sumMoney(r.map((x) => x.received)),
      expenses: sumMoney(r.map((x) => x.expenses)), net: sumMoney(r.map((x) => x.net)),
      sessions: r.reduce((a, x) => a + Number(x.sessions_attended), 0), noShows: r.reduce((a, x) => a + Number(x.no_shows), 0),
    };
  }, [q.data]);
  const max = Math.max(1, ...(q.data ?? []).map((r) => Math.max(r.received, r.expenses)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setYear(year - 1)} aria-label="Ano anterior">‹</Button>
          <span className="num font-bold">{year}</span>
          <Button size="sm" variant="secondary" onClick={() => setYear(year + 1)} aria-label="Próximo ano">›</Button>
        </div>
        <Button variant="secondary" disabled={!q.data} onClick={() => saveBlob(csv([
          ['mes', 'faturado', 'recebido', 'despesas', 'resultado', 'sessoes_atendidas', 'faltas'],
          ...(q.data ?? []).map((r) => [r.month.slice(0, 7), brNum(r.billed), brNum(r.received), brNum(r.expenses), brNum(r.net), r.sessions_attended, r.no_shows]),
        ]), `relatorio-financeiro-${year}.csv`)}>Exportar CSV</Button>
      </div>
      {q.isLoading && <Loading />}
      {q.data && (
        <div className="overflow-x-auto rounded-lg border border-linha bg-papel">
          <table className="num w-full min-w-[640px] text-right">
            <caption className="sr-only">Relatório financeiro mensal de {year}</caption>
            <thead className="border-b border-linha text-sm text-tinta-3">
              <tr><th className="px-3 py-2 text-left font-normal">Mês</th><th className="px-3 py-2 font-normal">Faturado</th><th className="px-3 py-2 font-normal">Recebido</th><th className="px-3 py-2 font-normal">Despesas</th><th className="px-3 py-2 font-normal">Resultado</th><th className="px-3 py-2 font-normal">Sessões</th><th className="px-3 py-2 font-normal">Faltas</th><th className="w-32 px-3 py-2 font-normal"><span className="sr-only">Gráfico</span></th></tr>
            </thead>
            <tbody className="divide-y divide-linha">
              {q.data.map((r) => (
                <tr key={r.month}>
                  <td className="px-3 py-2 text-left">{monthName(Number(r.month.slice(5, 7)))}</td>
                  <td className="px-3 py-2">{money(r.billed)}</td>
                  <td className="px-3 py-2 font-bold">{money(r.received)}</td>
                  <td className="px-3 py-2">{money(r.expenses)}</td>
                  <td className={`px-3 py-2 font-bold ${r.net < 0 ? 'text-vermelho' : ''}`}>{money(r.net)}</td>
                  <td className="px-3 py-2">{r.sessions_attended}</td>
                  <td className="px-3 py-2">{r.no_shows}</td>
                  <td className="px-3 py-2" aria-hidden>
                    <div className="h-1.5 rounded bg-verde" style={{ width: `${(r.received / max) * 100}%` }} />
                    <div className="mt-1 h-1.5 rounded bg-ocre" style={{ width: `${(r.expenses / max) * 100}%` }} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-linha-forte font-bold">
              <tr><td className="px-3 py-2 text-left">Total</td><td className="px-3 py-2">{money(totals.billed)}</td><td className="px-3 py-2">{money(totals.received)}</td><td className="px-3 py-2">{money(totals.expenses)}</td><td className="px-3 py-2">{money(totals.net)}</td><td className="px-3 py-2">{totals.sessions}</td><td className="px-3 py-2">{totals.noShows}</td><td /></tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-sm text-tinta-3">Faturado: cobranças não canceladas pelo vencimento. Recebido: pagamentos pela data do pagamento (base do Carnê-Leão para pessoa física). Barras: verde recebido, ocre despesas.</p>
    </div>
  );
}

function ReceitaSaudeTab() {
  const q = useQuery({ queryKey: ['payments', 'all'], queryFn: () => api.listPayments({}) });
  const invalidate = useInvalidateFinance();
  const toast = useToast();
  const pending = (q.data ?? []).filter((p) => p.receita_saude_status === 'pendente');
  const desde = addDays(todayIn(), -30);
  const emitidos = (q.data ?? []).filter((p) => p.receita_saude_status === 'emitido' && p.paid_on >= desde).sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  return (
    <div className="flex flex-col gap-4">
      <Notice>
        Desde 2025, psicólogas que atendem como pessoa física emitem o recibo oficial no Receita Saúde (app da Receita, Carnê-Leão Web ou lote no e-CAC), na data de cada pagamento.
        O sistema não envia dados à Receita: use esta lista para conferir e marque cada recebimento depois de emitir o recibo.
      </Notice>
      {pending.length > 0 && <ArquivoCarneLeao pendentes={pending} />}
      <section aria-label="Como emitir o recibo" className="rounded-lg border border-linha bg-papel p-4">
        <p className="font-bold">Como emitir, em 3 passos</p>
        <ol className="mt-2 list-decimal pl-5 text-sm text-tinta-2">
          <li>Toque em <strong>Ver dados para o recibo</strong> no recebimento e copie cada campo.</li>
          <li>No celular, abra o app <strong>Receita Federal</strong> → Receita Saúde → Novo recibo. No computador, entre no e-CAC → Carnê-Leão Web.</li>
          <li>Depois de emitir, volte aqui e toque em <strong>Recibo emitido</strong>.</li>
        </ol>
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => abrirExterno(URL_ECAC)}>Abrir e-CAC (computador)</Button>
      </section>
      {q.isLoading && <Loading />}
      {q.data && pending.length === 0 && <p className="text-tinta-2">Nenhum recibo pendente.</p>}
      {pending.length > 0 && (
        <>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => saveBlob(csv([
              ['data_pagamento', 'valor', 'cpf_pagador', 'nome_pagador', 'cpf_beneficiario', 'nome_beneficiario'],
              ...pending.map((p) => [formatDate(p.paid_on), brNum(p.amount), p.payer_cpf ?? p.patient_cpf ?? '', p.payer_name ?? p.patient_name, p.patient_cpf ?? '', p.patient_name]),
            ]), 'receita-saude-pendentes.csv')}>Exportar planilha de apoio</Button>
          </div>
          <ul className="divide-y divide-linha rounded-lg border border-linha bg-papel">
            {pending.map((p) => {
              const missingCpf = !(p.payer_cpf ?? p.patient_cpf);
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-bold">{p.payer_name ?? p.patient_name}{p.payer_name ? <span className="font-normal text-tinta-2"> (pagador de {p.patient_name})</span> : null}</p>
                    <p className="num text-sm text-tinta-2">{formatDate(p.paid_on)}, {money(p.amount)}, CPF {formatCpf(p.payer_cpf ?? p.patient_cpf) || <span className="text-vermelho">não cadastrado</span>}</p>
                    {missingCpf && <p className="text-sm text-vermelho">O recibo exige o CPF de quem pagou. Complete no cadastro do paciente.</p>}
                  </div>
                  <div className="order-last w-full"><ReciboAssistido pagamento={p} /></div>
                  <div className="flex flex-wrap gap-2">
                    <ArquivoUmRecibo pagamento={p} />
                    <Button size="sm" onClick={async () => { try { await api.updatePayment(p.id, { receita_saude_status: 'emitido' }); await invalidate(); toast('Marcado como emitido'); } catch (e) { toast(errorMessage(e), 'erro'); } }}>Recibo emitido</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { try { await api.updatePayment(p.id, { receita_saude_status: 'nao_aplicavel' }); await invalidate(); } catch (e) { toast(errorMessage(e), 'erro'); } }}>Não se aplica</Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-tinta-3">A planilha de apoio não segue o leiaute oficial do lote do e-CAC; confira o modelo no portal da Receita antes de importar.</p>
        </>
      )}
      {emitidos.length > 0 && (
        <section aria-label="Recibos emitidos recentemente">
          <p className="mb-2 font-bold">Emitidos nos últimos 30 dias</p>
          <ul className="divide-y divide-linha rounded-lg border border-linha bg-papel">
            {emitidos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="num text-sm text-tinta-2"><span className="font-bold text-tinta">{p.payer_name ?? p.patient_name}</span> · {formatDate(p.paid_on)} · {money(p.amount)}</p>
                <Button size="sm" variant="ghost" onClick={async () => { try { await api.updatePayment(p.id, { receita_saude_status: 'pendente' }); await invalidate(); toast('Voltou para pendente'); } catch (e) { toast(errorMessage(e), 'erro'); } }}>Desfazer</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

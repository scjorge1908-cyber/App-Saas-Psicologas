import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { AgendaItem } from '../lib/types';
import { errorMessage } from '../lib/errors';
import { ageOn, formatCpf, formatDate, formatPhone, formatTime, money, sumMoney, todayIn, zonedParts } from '../lib/format';
import { whatsappLink } from '../lib/messages';
import { useProfile } from '../auth/AuthProvider';
import { Badge, Button, DescList, Empty, ErrorBox, Loading, Panel, StatusBadge, Tabs, useConfirm, useToast } from '../components/ui';
import { IconChevronLeft, IconWhats } from '../components/icons';
import { PatientForm } from '../components/patients/PatientForm';
import { RecordTab } from '../components/patients/RecordTab';
import { DocumentsTab } from '../components/patients/DocumentsTab';
import { AttachmentsTab } from '../components/patients/AttachmentsTab';
import { AppointmentSheet } from '../components/appointments/AppointmentSheet';
import { NewAppointmentDialog } from '../components/appointments/NewAppointmentDialog';
import { ChargesList } from '../components/finance/ChargesList';
import { abrirExterno } from '../lib/abrir-externo';
import { ChargeDialog, METHOD_LABEL, PaymentDialog } from '../components/finance/PaymentDialog';

type Tab = 'resumo' | 'sessoes' | 'prontuario' | 'documentos' | 'financeiro' | 'anexos';

export function PatientDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('aba') as Tab) || 'resumo';
  const { tz } = useProfile();
  const nav = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [openAppt, setOpenAppt] = useState<AgendaItem | null>(null);

  const p = useQuery({ queryKey: ['patient', id], queryFn: () => api.getPatient(id) });
  const sessions = useQuery({ queryKey: ['patient-agenda', id], queryFn: () => api.listPatientAgenda(id) });

  if (p.isLoading) return <Loading />;
  if (p.error || !p.data) return <ErrorBox>{errorMessage(p.error, 'Paciente não encontrado.')}</ErrorBox>;
  const pt = p.data;
  const today = todayIn(tz);
  const wa = whatsappLink(pt.phone, `Olá, ${(pt.social_name || pt.full_name).split(' ')[0]}!`);

  async function remove() {
    if (!(await confirm({ title: 'Excluir paciente?', body: 'Só é possível excluir cadastros sem prontuário, atendimentos ou lançamentos financeiros (por exemplo, cadastrado por engano). Sessões futuras serão removidas.', confirmLabel: 'Excluir paciente', danger: true }))) return;
    try { await api.deletePatient(pt.id); toast('Paciente excluído'); nav('/pacientes'); } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <div>
      <Link to="/pacientes" className="mb-3 inline-flex items-center gap-1 font-bold text-anil"><IconChevronLeft width={18} height={18} /> Pacientes</Link>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full bg-anil-claro text-[1.125rem] font-bold text-sobre-anil-claro">{(pt.social_name || pt.full_name).split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()}</span>
          <div>
          <h1 className="titulo-display text-[1.625rem] leading-tight">{pt.social_name || pt.full_name}</h1>
          {pt.status === 'ativo' && <span className="mt-1 inline-flex h-6 items-center rounded-full bg-livre-fundo px-2.5 text-[0.75rem] font-bold text-livre">Em acompanhamento</span>}
          {pt.social_name && <p className="text-tinta-2">Nome civil: {pt.full_name}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-2 text-tinta-2">
            {pt.status !== 'ativo' && <Badge>{pt.status === 'alta' ? 'Alta' : 'Inativo'}</Badge>}
            {pt.birth_date && <span>{ageOn(pt.birth_date, today)} anos</span>}
            {pt.phone && <span className="num">{formatPhone(pt.phone)}</span>}
            <span>Desde {formatDate(pt.created_at.slice(0, 10)).slice(3)}</span>
          </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); abrirExterno(wa); }} className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-campo)] border border-linha-forte bg-papel px-3 font-bold text-verde"><IconWhats /> WhatsApp</a>}
          <Button variant="secondary" onClick={() => setEditing(true)}>Editar cadastro</Button>
          {pt.status === 'ativo' && <Button onClick={() => setScheduling(true)}>Agendar</Button>}
        </div>
      </header>

      <Tabs label="Seções do paciente" value={tab} onChange={(v) => setParams({ aba: v }, { replace: true })} items={[
        { value: 'resumo', label: 'Resumo' }, { value: 'sessoes', label: 'Sessões' }, { value: 'prontuario', label: 'Prontuário' },
        { value: 'documentos', label: 'Documentos' }, { value: 'financeiro', label: 'Financeiro' }, { value: 'anexos', label: 'Anexos' },
      ]} />

      {tab === 'resumo' && (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Panel title="Cadastro">
            <DescList items={[
              ['Nascimento', pt.birth_date ? formatDate(pt.birth_date) : ''], ['CPF', pt.cpf ? formatCpf(pt.cpf) : ''],
              ['E-mail', pt.email], ['Endereço', enderecoTexto(pt.street, pt.address_number, pt.address_complement, pt.neighborhood, pt.city, pt.uf, pt.cep) || pt.address],
              ['Emergência', [pt.emergency_contact_name, pt.emergency_contact_phone && formatPhone(pt.emergency_contact_phone)].filter(Boolean).join(', ')],
              ['Responsável legal', [pt.guardian_name, pt.guardian_relationship].filter(Boolean).join(', ')],
              ['Autorização do responsável', pt.guardian_authorization_date ? formatDate(pt.guardian_authorization_date) : pt.guardian_name ? 'não registrada' : ''],
              ['Pagador', pt.payer_name ? `${pt.payer_name}${pt.payer_cpf ? `, CPF ${formatCpf(pt.payer_cpf)}` : ''}` : ''],
              ['Nota fiscal', pt.nf_tomador === 'outro' ? `no nome de ${pt.payer_name ?? 'quem paga'}${pt.payer_email ? `, ${pt.payer_email}` : ''}${pt.payer_city ? `, ${pt.payer_city}/${pt.payer_uf ?? ''}` : ''}` : pt.nf_tomador === 'paciente' ? 'no nome do paciente' : ''],
              ['Atendimento', `${pt.modality === 'online' ? 'Online' : 'Presencial'}${pt.session_minutes ? `, ${pt.session_minutes} min` : ''}`],
              ['Valor', pt.session_price != null ? `${money(pt.session_price)} ${pt.billing_mode === 'mensal' ? '(mensalidade/pacote)' : 'por sessão'}` : ''],
              ['Observações', pt.admin_notes],
            ]} />
            <div className="mt-4 border-t border-linha pt-3"><Button size="sm" variant="ghost" onClick={remove}>Excluir cadastro</Button></div>
          </Panel>
          <UpcomingPanel sessions={sessions.data ?? []} tz={tz} onOpen={setOpenAppt} />
        </div>
      )}

      {tab === 'sessoes' && (
        sessions.data && sessions.data.length === 0 ? <Empty title="Nenhuma sessão agendada." action={<Button variant="secondary" onClick={() => setScheduling(true)}>Agendar sessão</Button>} /> : (
          <ul className="divide-y divide-linha rounded-lg border border-linha bg-papel">
            {sessions.data?.map((s) => (
              <li key={s.id}>
                <button onClick={() => setOpenAppt(s)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gesso">
                  <span className="num">{formatDate(zonedParts(s.starts_at, tz).date)} às {formatTime(s.starts_at, tz)}</span>
                  <StatusBadge status={s.status} />
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'prontuario' && <RecordTab patientId={pt.id} patient={pt} sessionId={params.get('sessao')} sessions={sessions.data ?? []} />}
      {tab === 'documentos' && <DocumentsTab patient={pt} />}
      {tab === 'financeiro' && <PatientFinance patientId={pt.id} />}
      {tab === 'anexos' && <AttachmentsTab patientId={pt.id} />}

      <PatientForm open={editing} onClose={() => setEditing(false)} patient={pt} />
      <NewAppointmentDialog open={scheduling} onClose={() => setScheduling(false)} patientId={pt.id} />
      <AppointmentSheet item={openAppt} onClose={() => setOpenAppt(null)} />
    </div>
  );
}

function UpcomingPanel({ sessions, tz, onOpen }: { sessions: AgendaItem[]; tz: string; onOpen: (s: AgendaItem) => void }) {
  const now = Date.now();
  const next = sessions.filter((s) => new Date(s.starts_at).getTime() >= now && s.status !== 'cancelado').reverse().slice(0, 5);
  const attended = sessions.filter((s) => s.status === 'atendido').length;
  const missed = sessions.filter((s) => s.status === 'faltou').length;
  return (
    <Panel title="Próximas sessões">
      {next.length === 0 ? <p className="text-tinta-2">Nenhuma sessão futura.</p> : (
        <ul className="flex flex-col gap-2">
          {next.map((s) => (
            <li key={s.id}>
              <button onClick={() => onOpen(s)} className="flex w-full items-center justify-between gap-2 text-left">
                <span className="num">{formatDate(zonedParts(s.starts_at, tz).date)} às {formatTime(s.starts_at, tz)}</span>
                <StatusBadge status={s.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="num mt-4 text-sm text-tinta-2">{attended} atendidas, {missed} faltas no histórico.</p>
    </Panel>
  );
}

function PatientFinance({ patientId }: { patientId: string }) {
  const charges = useQuery({ queryKey: ['charges', 'patient', patientId], queryFn: () => api.listCharges({ patientId }) });
  const payments = useQuery({ queryKey: ['payments', 'patient', patientId], queryFn: () => api.listPayments({ patientId }) });
  const patient = useQuery({ queryKey: ['patient', patientId], queryFn: () => api.getPatient(patientId) });
  const [newCharge, setNewCharge] = useState(false);
  const [newPayment, setNewPayment] = useState(false);
  const open = (charges.data ?? []).filter((c) => c.status === 'aberta' || c.status === 'parcial');
  const closed = (charges.data ?? []).filter((c) => !(c.status === 'aberta' || c.status === 'parcial'));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="num text-lg">Em aberto: <strong>{money(sumMoney(open.map((c) => c.balance)))}</strong></p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setNewCharge(true)}>Nova cobrança</Button>
          <Button variant="secondary" onClick={() => setNewPayment(true)}>Recebimento avulso</Button>
        </div>
      </div>
      {charges.isLoading && <Loading />}
      {open.length > 0 && <section><h3 className="mb-2 font-bold">A receber</h3><ChargesList charges={open} patients={patient.data ? [patient.data] : []} showPatient={false} /></section>}
      {charges.data && charges.data.length === 0 && <Empty title="Nenhuma cobrança.">Sessões atendidas geram cobrança automaticamente quando o paciente é cobrado por sessão.</Empty>}
      {payments.data && payments.data.length > 0 && (
        <section>
          <h3 className="mb-2 font-bold">Recebimentos</h3>
          <ul className="divide-y divide-linha rounded-lg border border-linha bg-papel">
            {payments.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span><span className="num">{formatDate(p.paid_on)}</span>, {METHOD_LABEL[p.method]}{p.charge_description ? `: ${p.charge_description}` : ''}</span>
                <span className="num font-bold">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {closed.length > 0 && <section><h3 className="mb-2 font-bold">Pagas e canceladas</h3><ChargesList charges={closed} showPatient={false} /></section>}
      <ChargeDialog open={newCharge} onClose={() => setNewCharge(false)} patients={patient.data ? [patient.data] : []} patientId={patientId} />
      <PaymentDialog open={newPayment} onClose={() => setNewPayment(false)} patient={patient.data} />
    </div>
  );
}

/** "Rua X, 10, ap 2 · Centro · Palhoça/SC · CEP 88132-150" (vazio se não houver endereço em campos). */
function enderecoTexto(rua?: string | null, num?: string | null, compl?: string | null, bairro?: string | null, cidade?: string | null, uf?: string | null, cep?: string | null) {
  const linha = [rua, num, compl].filter(Boolean).join(', ');
  return [linha, bairro, cidade && `${cidade}${uf ? `/${uf}` : ''}`, cep && `CEP ${cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}`].filter(Boolean).join(' · ');
}

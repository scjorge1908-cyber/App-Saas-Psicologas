// Versão em memória do módulo de dados, usada só no modo demonstração.
// Mesmas funções e formatos de lib/api-real.ts, com um consultório FICTÍCIO montado a partir da data de hoje.
// Nada sai do aparelho; ao sair da demonstração (ou fechar o app) tudo é descartado.
import type {
  AgendaItem, AppointmentStatus, Attachment, AttachmentCategory, ChargeBalance, DashboardSummary, DocumentRow,
  Expense, FinancialReportRow, InvoiceItem, Modality, Patient, PaymentItem, Profile, RecordEntry, RecordEntryVersion,
  SeriesFrequency,
} from '../types';
import { DEFAULT_TZ, addDays, todayIn, zonedParts, zonedToUtc } from '../format';
import { sha256Hex } from '../hash';
import { DEMO_USER_ID } from './modo';
import type { SeriesResult } from '../api-real';

// ----------------------------------------------------------------- tipos ---
type Appointment = Omit<AgendaItem, 'patient_name' | 'patient_social_name' | 'patient_phone' | 'patient_meeting_url' | 'patient_billing_mode' | 'series_frequency'>;
type Series = { id: string; patient_id: string; frequency: SeriesFrequency; time: string; duration: number; price: number | null; modality: Modality };
type Charge = { id: string; patient_id: string; appointment_id: string | null; description: string; amount: number; due_date: string; canceled_at: string | null; created_at: string };
type Payment = Omit<PaymentItem, 'patient_name' | 'patient_cpf' | 'charge_description'>;
type Invoice = Omit<InvoiceItem, 'patient_name'>;

interface Store {
  profile: Profile;
  patients: Patient[];
  series: Series[];
  appointments: Appointment[];
  records: RecordEntry[];
  versions: RecordEntryVersion[];
  attachments: Attachment[];
  blobs: Map<string, Blob>;
  documents: DocumentRow[];
  charges: Charge[];
  payments: Payment[];
  expenses: Expense[];
  invoices: Invoice[];
}

const uid = () => crypto.randomUUID();
const agora = () => new Date().toISOString();
const tz = DEFAULT_TZ;
const dataLocal = (iso: string) => {
  const p = zonedParts(iso, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};
const somaMin = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60000).toISOString();
const atraso = () => new Promise((r) => setTimeout(r, 120)); // dá a sensação real de carregamento

// ------------------------------------------------------------ dados base ---
function montarStore(): Store {
  const hoje = todayIn(tz);
  const perfil: Profile = {
    id: DEMO_USER_ID, full_name: 'Ana Ribeiro (demonstração)', crp: '12/34567', cpf: null, cnpj: null, fiscal_type: 'pf',
    contact_email: 'ana.demo@exemplo.com', phone: '48999990000', address: null, city: 'Florianópolis', uf: 'SC',
    timezone: tz, session_minutes: 50, buffer_minutes: 10, default_price: 180, cancellation_hours: 24,
    agenda_start: '07:00', agenda_end: '21:00', retention_years: 5, onboarded_at: agora(),
  };
  const base = { owner_id: DEMO_USER_ID, social_name: null, cpf: null, email: null, address: null, emergency_contact_name: null, emergency_contact_phone: null,
    guardian_name: null, guardian_cpf: null, guardian_relationship: null, guardian_phone: null, guardian_authorization_date: null,
    payer_name: null, payer_cpf: null, meeting_url: null, admin_notes: null, created_at: agora() } as const;
  const pac = (full_name: string, extra: Partial<Patient>): Patient => ({
    ...base, id: uid(), full_name, birth_date: '1990-05-10', phone: '48988880000', billing_mode: 'por_sessao',
    session_price: 180, session_minutes: null, modality: 'presencial', status: 'ativo', ...extra,
  });
  const patients = [
    pac('Mariana Costa Fictícia', { birth_date: '1992-03-14' }),
    pac('Rafael Souza Fictício', { birth_date: '1987-11-02', modality: 'online', meeting_url: 'https://meet.exemplo.com/rafael' }),
    pac('Beatriz Lima Fictícia', { birth_date: '2011-07-21', guardian_name: 'Cláudia Lima Fictícia', guardian_relationship: 'mãe', session_minutes: 40, session_price: 150 }),
    pac('Lucas Almeida Fictício', { birth_date: '1999-01-30', billing_mode: 'mensal', session_price: 640 }),
    pac('Juliana Rocha Fictícia', { birth_date: '1984-09-12', modality: 'online' }),
    pac('Pedro Martins Fictício', { birth_date: '1978-06-05', status: 'alta' }),
  ];
  const [mariana, rafael, beatriz, lucas, juliana, pedro] = patients;

  const s: Store = { profile: perfil, patients, series: [], appointments: [], records: [], versions: [], attachments: [],
    blobs: new Map(), documents: [], charges: [], payments: [], expenses: [], invoices: [] };

  // séries semanais: cada paciente ativo no mesmo dia/horário, de 4 semanas atrás até 8 à frente
  const plano: Array<[Patient, number, string]> = [
    [mariana, 0, '09:00'], [rafael, 0, '14:00'], [beatriz, 1, '16:00'], [lucas, 2, '10:00'], [juliana, 3, '19:00'],
  ];
  const diaSemanaHoje = new Date(`${hoje}T12:00:00Z`).getUTCDay();
  for (const [p, desloc, hora] of plano) {
    const serie: Series = { id: uid(), patient_id: p.id, frequency: 'semanal', time: hora, duration: p.session_minutes ?? 50,
      price: p.billing_mode === 'mensal' ? null : p.session_price, modality: p.modality };
    s.series.push(serie);
    const primeiro = addDays(hoje, desloc - 28);
    for (let i = 0; i < 12; i++) {
      const dia = addDays(primeiro, i * 7);
      const ini = zonedToUtc(dia, hora, tz);
      const passou = new Date(somaMin(ini, serie.duration)).getTime() < Date.now();
      // as sessões da semana passada ficam "aguardando registro" para mostrar o fluxo; as anteriores já registradas
      const semanaPassada = dia >= addDays(hoje, -7);
      const status: AppointmentStatus = !passou ? (dia <= addDays(hoje, 2) ? 'confirmado' : 'agendado')
        : semanaPassada ? 'confirmado' : (i === 1 && p === rafael ? 'faltou' : 'atendido');
      s.appointments.push(novaSessao(p, ini, serie.duration, serie.price, p.modality, serie.id, status));
    }
  }
  // uma sessão avulsa hoje, ainda não confirmada
  s.appointments.push(novaSessao(pedro, zonedToUtc(hoje, '18:00', tz), 50, 180, 'presencial', null, 'agendado'));
  void diaSemanaHoje;

  // cobranças das sessões já atendidas e alguns pagamentos (um paciente em atraso)
  for (const a of s.appointments) {
    if ((a.status === 'atendido' || (a.status === 'faltou' && a.charge_no_show)) && a.price) {
      s.charges.push({ id: uid(), patient_id: a.patient_id, appointment_id: a.id, description: `Sessão ${dataBR(dataLocal(a.starts_at))}`,
        amount: a.price, due_date: dataLocal(a.starts_at), canceled_at: null, created_at: a.starts_at });
    }
  }
  const mesInicio = `${hoje.slice(0, 7)}-01`;
  s.charges.push({ id: uid(), patient_id: lucas.id, appointment_id: null, description: `Mensalidade ${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`,
    amount: 640, due_date: addDays(mesInicio, 9), canceled_at: null, created_at: agora() });
  for (const c of s.charges) {
    if (c.patient_id === juliana.id) continue; // Juliana fica devendo, para mostrar a inadimplência
    if (c.due_date > addDays(hoje, -10)) continue; // as mais recentes ainda a receber
    s.payments.push({ id: uid(), patient_id: c.patient_id, charge_id: c.id, amount: c.amount, paid_on: c.due_date,
      method: c.patient_id === rafael.id ? 'cartao_credito' : 'pix', payer_name: null, payer_cpf: null,
      receita_saude_status: c.patient_id === mariana.id ? 'pendente' : 'emitido', notes: null, created_at: c.due_date });
  }
  s.expenses.push(
    { id: uid(), description: 'Aluguel da sala', category: 'Aluguel', amount: 900, expense_date: addDays(mesInicio, 4), paid: true, notes: null },
    { id: uid(), description: 'Supervisão clínica', category: 'Formação', amount: 250, expense_date: addDays(mesInicio, 11), paid: true, notes: null },
  );

  // prontuário
  const reg = (p: Patient, kind: RecordEntry['kind'], dias: number, title: string, content: string) => s.records.push({
    id: uid(), patient_id: p.id, appointment_id: null, kind, entry_date: addDays(hoje, dias), title, content,
    version: 1, created_at: agora(), updated_at: agora() });
  reg(mariana, 'identificacao_demanda', -60, 'Demanda inicial', 'Paciente fictícia relata ansiedade relacionada ao trabalho e dificuldade para dormir. Busca estratégias para lidar com a sobrecarga.');
  reg(mariana, 'objetivos', -55, 'Objetivos do acompanhamento', 'Reduzir sintomas de ansiedade, organizar a rotina de sono e fortalecer a comunicação no trabalho.');
  reg(mariana, 'evolucao', -21, 'Sessão', 'Relatou melhora no sono após aplicar a rotina combinada. Trabalhamos registro de pensamentos automáticos.');
  reg(mariana, 'evolucao', -14, 'Sessão', 'Trouxe situação de conflito com a liderança. Ensaiamos uma conversa assertiva.');
  reg(rafael, 'identificacao_demanda', -40, 'Demanda inicial', 'Atendimento on-line. Paciente fictício em processo de luto, com queixa de desânimo e isolamento.');
  reg(beatriz, 'identificacao_demanda', -30, 'Demanda inicial', 'Atendimento infantojuvenil com autorização da responsável. Dificuldades de adaptação na escola nova.');
  reg(pedro, 'encerramento', -10, 'Encerramento', 'Objetivos alcançados. Alta combinada com o paciente, com orientação de retorno se necessário.');

  // documento emitido e notas
  s.documents.push({ id: uid(), patient_id: mariana.id, doc_type: 'declaracao', title: 'Declaração de comparecimento',
    purpose: 'Apresentar ao empregador', recipient: 'Empresa Fictícia Ltda.', issued_on: addDays(hoje, -14),
    fields: {}, attachment_id: null, pdf_sha256: null, delivered_at: null, delivered_to: null, created_at: agora() });
  const pago = s.payments[0];
  s.invoices.push(
    { id: uid(), patient_id: rafael.id, charge_id: null, payment_id: null, competence: mesInicio, amount: 720, status: 'a_emitir',
      number: null, access_key: null, issued_on: null, pdf_attachment_id: null, xml_attachment_id: null, notes: null },
    { id: uid(), patient_id: pago?.patient_id ?? mariana.id, charge_id: null, payment_id: pago?.id ?? null, competence: addDays(mesInicio, -20).slice(0, 7) + '-01',
      amount: 540, status: 'emitida', number: '2026000123', access_key: null, issued_on: addDays(mesInicio, -2), pdf_attachment_id: null, xml_attachment_id: null, notes: null },
  );
  return s;
}

function dataBR(d: string) {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

function novaSessao(p: Patient, ini: string, dur: number, price: number | null, modality: Modality, seriesId: string | null, status: AppointmentStatus): Appointment {
  const confirmado = status === 'confirmado';
  return {
    id: uid(), patient_id: p.id, series_id: seriesId, starts_at: ini, ends_at: somaMin(ini, dur), status,
    canceled_by: null, cancel_reason: null, late_cancellation: false, charge_no_show: status === 'faltou', price, modality,
    admin_notes: null, confirmed_at: confirmado ? agora() : null, patient_response: confirmado ? 'confirmou' : null,
    responded_at: confirmado ? agora() : null,
  };
}

let store: Store | null = null;
function db(): Store {
  if (!store) store = montarStore();
  return store;
}
/** Descarta tudo (ao sair da demonstração). */
export function limparDemo() {
  store = null;
}
export function perfilDemo(): Profile {
  return db().profile;
}
export function atualizarPerfilDemo(patch: Partial<Profile>) {
  Object.assign(db().profile, patch);
}

// ------------------------------------------------------------- projeções ---
const pacienteDe = (id: string) => db().patients.find((p) => p.id === id)!;
function agendaItem(a: Appointment): AgendaItem {
  const p = pacienteDe(a.patient_id);
  const s = a.series_id ? db().series.find((x) => x.id === a.series_id) : null;
  return { ...a, patient_name: p.full_name, patient_social_name: p.social_name, patient_phone: p.phone,
    patient_meeting_url: p.meeting_url, patient_billing_mode: p.billing_mode, series_frequency: s?.frequency ?? null };
}
function saldo(c: Charge): ChargeBalance {
  const p = pacienteDe(c.patient_id);
  const paid = db().payments.filter((x) => x.charge_id === c.id).reduce((t, x) => t + x.amount, 0);
  const status: ChargeBalance['status'] = c.canceled_at ? 'cancelada' : paid >= c.amount ? 'paga' : paid > 0 ? 'parcial' : 'aberta';
  return { ...c, paid, balance: c.canceled_at ? 0 : c.amount - paid, status,
    overdue: !c.canceled_at && paid < c.amount && c.due_date < todayIn(tz), patient_name: p.full_name, patient_phone: p.phone };
}
function pagamento(x: Payment): PaymentItem {
  const p = pacienteDe(x.patient_id);
  const c = x.charge_id ? db().charges.find((y) => y.id === x.charge_id) : null;
  return { ...x, patient_name: p.full_name, patient_cpf: p.cpf, charge_description: c?.description ?? null };
}
function conflito(ini: string, fim: string, ignorar?: string) {
  return db().appointments.some((a) => a.id !== ignorar && a.status !== 'cancelado' && a.starts_at < fim && a.ends_at > ini);
}
function cobrarSeNecessario(a: Appointment) {
  const p = pacienteDe(a.patient_id);
  const deve = (a.status === 'atendido' || (a.status === 'faltou' && a.charge_no_show)) && a.price && p.billing_mode === 'por_sessao';
  const existente = db().charges.find((c) => c.appointment_id === a.id && !c.canceled_at);
  if (deve && !existente) {
    db().charges.push({ id: uid(), patient_id: a.patient_id, appointment_id: a.id, description: `Sessão ${dataBR(dataLocal(a.starts_at))}`,
      amount: a.price!, due_date: dataLocal(a.starts_at), canceled_at: null, created_at: agora() });
  }
  if (!deve && existente && !db().payments.some((x) => x.charge_id === existente.id)) existente.canceled_at = agora();
}

// ------------------------------------------------------------- pacientes ---
export async function listPatients(): Promise<Patient[]> {
  await atraso();
  return [...db().patients].sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'));
}
export async function getPatient(id: string): Promise<Patient> {
  await atraso();
  const p = db().patients.find((x) => x.id === id);
  if (!p) throw new Error('Paciente não encontrado.');
  return p;
}
export async function savePatient(p: Partial<Patient> & { id?: string }): Promise<Patient> {
  await atraso();
  if (p.id) {
    const atual = await getPatient(p.id);
    Object.assign(atual, p);
    return atual;
  }
  const novo: Patient = {
    owner_id: DEMO_USER_ID, social_name: null, birth_date: null, cpf: null, phone: null, email: null, address: null,
    emergency_contact_name: null, emergency_contact_phone: null, guardian_name: null, guardian_cpf: null, guardian_relationship: null,
    guardian_phone: null, guardian_authorization_date: null, payer_name: null, payer_cpf: null, billing_mode: 'por_sessao',
    session_price: null, session_minutes: null, modality: 'presencial', meeting_url: null, status: 'ativo', admin_notes: null,
    full_name: '', ...p, id: uid(), created_at: agora(),
  };
  db().patients.push(novo);
  return novo;
}
export async function deletePatient(id: string) {
  await atraso();
  const s = db();
  if (s.records.some((r) => r.patient_id === id) || s.appointments.some((a) => a.patient_id === id && ['atendido', 'faltou'].includes(a.status))) {
    throw new Error('Paciente com prontuário ou atendimentos registrados não pode ser excluído. Use "Dar alta" ou "Inativar".');
  }
  s.appointments = s.appointments.filter((a) => a.patient_id !== id);
  s.patients = s.patients.filter((p) => p.id !== id);
}

// ---------------------------------------------------------------- agenda ---
export async function listAgenda(fromIso: string, toIso: string): Promise<AgendaItem[]> {
  await atraso();
  return db().appointments.filter((a) => a.starts_at >= fromIso && a.starts_at < toIso)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map(agendaItem);
}
export async function listPatientAgenda(patientId: string): Promise<AgendaItem[]> {
  await atraso();
  return db().appointments.filter((a) => a.patient_id === patientId)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at)).map(agendaItem);
}
export async function listToRegister(beforeIso: string): Promise<AgendaItem[]> {
  await atraso();
  return db().appointments.filter((a) => ['agendado', 'confirmado'].includes(a.status) && a.ends_at < beforeIso)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 50).map(agendaItem);
}
export async function createAppointment(a: { patient_id: string; starts_at: string; ends_at: string; price: number | null; modality: Modality; admin_notes?: string | null }) {
  await atraso();
  if (conflito(a.starts_at, a.ends_at)) throw new Error('Já existe uma sessão nesse horário.');
  const nova: Appointment = { ...novaSessao(pacienteDe(a.patient_id), a.starts_at, 0, a.price, a.modality, null, 'agendado'),
    ends_at: a.ends_at, admin_notes: a.admin_notes ?? null };
  db().appointments.push(nova);
  return nova;
}
export async function updateAppointment(id: string, patch: Record<string, unknown>) {
  await atraso();
  const a = db().appointments.find((x) => x.id === id);
  if (!a) throw new Error('Sessão não encontrada.');
  const prox = { ...a, ...patch } as Appointment;
  if ((patch.starts_at || patch.ends_at) && conflito(prox.starts_at, prox.ends_at, id)) throw new Error('Já existe uma sessão nesse horário.');
  Object.assign(a, patch);
  if (patch.status === 'confirmado' && !a.confirmed_at) a.confirmed_at = agora();
  cobrarSeNecessario(a);
  return a;
}
export async function setStatus(id: string, status: AppointmentStatus, extra: Record<string, unknown> = {}) {
  return updateAppointment(id, { status, ...extra });
}
export async function deleteAppointment(id: string) {
  await atraso();
  db().appointments = db().appointments.filter((a) => a.id !== id);
}
const passo: Record<SeriesFrequency, number> = { semanal: 7, quinzenal: 14, mensal: 28 };
function gerarOcorrencias(serie: Series, inicio: string, ate: string | null, quantidade: number | null): SeriesResult {
  const created: SeriesResult['created'] = [];
  const conflicts: SeriesResult['conflicts'] = [];
  const limite = ate ?? addDays(inicio, 182);
  const max = quantidade ?? 104;
  for (let i = 0, dia = inicio; i < max && dia <= limite; i++, dia = addDays(dia, passo[serie.frequency])) {
    const ini = zonedToUtc(dia, serie.time, tz);
    const fim = somaMin(ini, serie.duration);
    if (conflito(ini, fim)) { conflicts.push({ starts_at: ini }); continue; }
    const a = novaSessao(pacienteDe(serie.patient_id), ini, serie.duration, serie.price, serie.modality, serie.id, 'agendado');
    db().appointments.push(a);
    created.push({ id: a.id, starts_at: a.starts_at });
  }
  return { series_id: serie.id, created, conflicts };
}
export async function createSeries(args: {
  patientId: string; frequency: SeriesFrequency; startDate: string; startTime: string; duration: number;
  untilDate?: string | null; occurrences?: number | null; price?: number | null; modality: Modality;
}): Promise<SeriesResult> {
  await atraso();
  const serie: Series = { id: uid(), patient_id: args.patientId, frequency: args.frequency, time: args.startTime,
    duration: args.duration, price: args.price ?? null, modality: args.modality };
  db().series.push(serie);
  return gerarOcorrencias(serie, args.startDate, args.untilDate ?? null, args.occurrences ?? null);
}
export async function endSeries(seriesId: string, fromDate: string): Promise<number> {
  await atraso();
  const desde = zonedToUtc(fromDate, '00:00', tz);
  const antes = db().appointments.length;
  db().appointments = db().appointments.filter((a) => !(a.series_id === seriesId && a.starts_at >= desde && ['agendado', 'confirmado'].includes(a.status)));
  return antes - db().appointments.length;
}
export async function changeSeries(args: { seriesId: string; fromDate: string; newStartDate: string; newTime: string; duration?: number | null; price?: number | null; frequency?: SeriesFrequency | null }): Promise<SeriesResult> {
  const serie = db().series.find((s) => s.id === args.seriesId);
  if (!serie) throw new Error('Série não encontrada.');
  await endSeries(args.seriesId, args.fromDate);
  serie.time = args.newTime;
  if (args.duration) serie.duration = args.duration;
  if (args.price !== undefined && args.price !== null) serie.price = args.price;
  if (args.frequency) serie.frequency = args.frequency;
  return gerarOcorrencias(serie, args.newStartDate, null, null);
}
export async function extendSeries(seriesId: string, until: string): Promise<SeriesResult> {
  await atraso();
  const serie = db().series.find((s) => s.id === seriesId);
  if (!serie) throw new Error('Série não encontrada.');
  const ultima = db().appointments.filter((a) => a.series_id === seriesId).map((a) => dataLocal(a.starts_at)).sort().pop() ?? todayIn(tz);
  return gerarOcorrencias(serie, addDays(ultima, passo[serie.frequency]), until, null);
}
export async function createConfirmationLink(appointmentId: string): Promise<string> {
  await atraso();
  void appointmentId;
  return 'demonstracao'; // na demonstração o link não é enviado a ninguém
}

// ------------------------------------------------------------ prontuário ---
export async function listRecords(patientId: string): Promise<RecordEntry[]> {
  await atraso();
  return db().records.filter((r) => r.patient_id === patientId)
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at));
}
export async function saveRecord(r: Partial<RecordEntry> & { patient_id: string }) {
  await atraso();
  if (r.id) {
    const atual = db().records.find((x) => x.id === r.id);
    if (!atual) throw new Error('Registro não encontrado.');
    db().versions.push({ id: uid(), entry_id: atual.id, version: atual.version, kind: atual.kind, entry_date: atual.entry_date,
      title: atual.title, content: atual.content, valid_from: atual.updated_at, replaced_at: agora() });
    Object.assign(atual, { kind: r.kind ?? atual.kind, entry_date: r.entry_date ?? atual.entry_date, title: r.title ?? atual.title,
      content: r.content ?? atual.content, version: atual.version + 1, updated_at: agora() });
    return atual;
  }
  const novo: RecordEntry = { id: uid(), appointment_id: null, kind: 'evolucao', entry_date: todayIn(tz), title: null, content: '',
    ...r, version: 1, created_at: agora(), updated_at: agora() } as RecordEntry;
  db().records.push(novo);
  return novo;
}
export async function listRecordVersions(entryId: string): Promise<RecordEntryVersion[]> {
  await atraso();
  return db().versions.filter((v) => v.entry_id === entryId).sort((a, b) => b.version - a.version);
}

// ----------------------------------------------------------------- anexos ---
export async function listAttachments(patientId: string): Promise<Attachment[]> {
  await atraso();
  return db().attachments.filter((a) => a.patient_id === patientId).sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export async function uploadAttachment(opts: { ownerId: string; patientId: string; bytes: Uint8Array; fileName: string; mime: string; category: AttachmentCategory; recordEntryId?: string | null }): Promise<Attachment> {
  await atraso();
  if (opts.bytes.length > 10 * 1024 * 1024) throw new Error('Arquivo maior que 10 MB.');
  const path = `${DEMO_USER_ID}/${opts.patientId}/${uid()}-${opts.fileName}`;
  db().blobs.set(path, new Blob([opts.bytes as BlobPart], { type: opts.mime }));
  const a: Attachment = { id: uid(), patient_id: opts.patientId, record_entry_id: opts.recordEntryId ?? null, category: opts.category,
    storage_path: path, file_name: opts.fileName.slice(0, 255), mime_type: opts.mime, size_bytes: opts.bytes.length,
    sha256: await sha256Hex(opts.bytes), created_at: agora() };
  db().attachments.push(a);
  return a;
}
export async function downloadAttachment(a: Pick<Attachment, 'storage_path'>): Promise<Blob> {
  await atraso();
  const b = db().blobs.get(a.storage_path);
  if (!b) throw new Error('Arquivo não encontrado.');
  return b;
}
export async function deleteAttachment(a: Attachment) {
  await atraso();
  if (a.category === 'avaliacao' || a.category === 'documento_emitido') {
    throw new Error('Anexos de avaliação e documentos emitidos fazem parte do prontuário e não podem ser excluídos.');
  }
  db().attachments = db().attachments.filter((x) => x.id !== a.id);
  db().blobs.delete(a.storage_path);
}

// ------------------------------------------------------------ documentos ---
export async function listDocuments(patientId: string): Promise<DocumentRow[]> {
  await atraso();
  return db().documents.filter((d) => d.patient_id === patientId).sort((a, b) => b.issued_on.localeCompare(a.issued_on));
}
export async function createDocument(d: Omit<DocumentRow, 'id' | 'created_at' | 'delivered_at' | 'delivered_to'>) {
  await atraso();
  const novo: DocumentRow = { ...d, id: uid(), created_at: agora(), delivered_at: null, delivered_to: null };
  db().documents.push(novo);
  return novo;
}
export async function markDelivered(id: string, to: string) {
  await atraso();
  const d = db().documents.find((x) => x.id === id);
  if (!d) throw new Error('Documento não encontrado.');
  Object.assign(d, { delivered_at: agora(), delivered_to: to });
  return d;
}

// ------------------------------------------------------------ financeiro ---
export async function listCharges(filter: { patientId?: string; open?: boolean } = {}): Promise<ChargeBalance[]> {
  await atraso();
  return db().charges.map(saldo)
    .filter((c) => (!filter.patientId || c.patient_id === filter.patientId) && (!filter.open || c.status === 'aberta' || c.status === 'parcial'))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}
export async function createCharge(c: { patient_id: string; description: string; amount: number; due_date: string }) {
  await atraso();
  const nova: Charge = { ...c, id: uid(), appointment_id: null, canceled_at: null, created_at: agora() };
  db().charges.push(nova);
  return nova;
}
export async function cancelCharge(id: string) {
  await atraso();
  const c = db().charges.find((x) => x.id === id);
  if (!c) throw new Error('Cobrança não encontrada.');
  c.canceled_at = agora();
  return c;
}
export async function listPayments(filter: { from?: string; to?: string; patientId?: string } = {}): Promise<PaymentItem[]> {
  await atraso();
  return db().payments
    .filter((x) => (!filter.from || x.paid_on >= filter.from) && (!filter.to || x.paid_on <= filter.to) && (!filter.patientId || x.patient_id === filter.patientId))
    .sort((a, b) => b.paid_on.localeCompare(a.paid_on)).map(pagamento);
}
export async function createPayment(p: { patient_id: string; charge_id: string | null; amount: number; paid_on: string; method: string; payer_name?: string | null; payer_cpf?: string | null; receita_saude_status: string; notes?: string | null }) {
  await atraso();
  const novo = { payer_name: null, payer_cpf: null, notes: null, ...p, id: uid(), created_at: agora() } as Payment;
  db().payments.push(novo);
  return novo;
}
export async function updatePayment(id: string, patch: Record<string, unknown>) {
  await atraso();
  const x = db().payments.find((y) => y.id === id);
  if (!x) throw new Error('Recebimento não encontrado.');
  Object.assign(x, patch);
  return x;
}
export async function deletePayment(id: string) {
  await atraso();
  db().payments = db().payments.filter((x) => x.id !== id);
}
export async function listExpenses(from: string, to: string): Promise<Expense[]> {
  await atraso();
  return db().expenses.filter((e) => e.expense_date >= from && e.expense_date <= to).sort((a, b) => b.expense_date.localeCompare(a.expense_date));
}
export async function saveExpense(e: Partial<Expense>) {
  await atraso();
  if (e.id) {
    const atual = db().expenses.find((x) => x.id === e.id);
    if (!atual) throw new Error('Despesa não encontrada.');
    Object.assign(atual, e);
    return atual;
  }
  const nova = { description: '', category: 'Outros', amount: 0, expense_date: todayIn(tz), paid: true, notes: null, ...e, id: uid() } as Expense;
  db().expenses.push(nova);
  return nova;
}
export async function deleteExpense(id: string) {
  await atraso();
  db().expenses = db().expenses.filter((x) => x.id !== id);
}
export async function financialReport(from: string, to: string): Promise<FinancialReportRow[]> {
  await atraso();
  const linhas: FinancialReportRow[] = [];
  for (let m = `${from.slice(0, 7)}-01`; m <= to; m = addDays(m, 32).slice(0, 7) + '-01') {
    const mes = m.slice(0, 7);
    const billed = db().charges.filter((c) => !c.canceled_at && c.due_date.startsWith(mes)).reduce((t, c) => t + c.amount, 0);
    const received = db().payments.filter((x) => x.paid_on.startsWith(mes)).reduce((t, x) => t + x.amount, 0);
    const expenses = db().expenses.filter((e) => e.expense_date.startsWith(mes)).reduce((t, e) => t + e.amount, 0);
    const doMes = db().appointments.filter((a) => dataLocal(a.starts_at).startsWith(mes));
    linhas.push({ month: m, billed, received, expenses, net: received - expenses,
      sessions_attended: doMes.filter((a) => a.status === 'atendido').length, no_shows: doMes.filter((a) => a.status === 'faltou').length });
  }
  return linhas;
}
export async function dashboard(): Promise<DashboardSummary> {
  await atraso();
  const hoje = todayIn(tz);
  const agoraMs = Date.now();
  const s = db();
  const saldos = s.charges.map(saldo);
  return {
    today: hoje,
    sessions_today: s.appointments.filter((a) => a.status !== 'cancelado' && dataLocal(a.starts_at) === hoje).length,
    to_confirm_48h: s.appointments.filter((a) => a.status === 'agendado' && new Date(a.starts_at).getTime() >= agoraMs && new Date(a.starts_at).getTime() <= agoraMs + 48 * 3600000).length,
    to_register: s.appointments.filter((a) => ['agendado', 'confirmado'].includes(a.status) && new Date(a.ends_at).getTime() < agoraMs).length,
    receivable: saldos.filter((c) => c.status === 'aberta' || c.status === 'parcial').reduce((t, c) => t + c.balance, 0),
    overdue: saldos.filter((c) => c.overdue).reduce((t, c) => t + c.balance, 0),
    received_month: s.payments.filter((x) => x.paid_on.startsWith(hoje.slice(0, 7))).reduce((t, x) => t + x.amount, 0),
    active_patients: s.patients.filter((p) => p.status === 'ativo').length,
    invoices_pending: s.invoices.filter((i) => i.status === 'a_emitir').length,
    receita_saude_pending: s.profile.fiscal_type === 'pf' ? s.payments.filter((x) => x.receita_saude_status === 'pendente').length : 0,
  };
}

// ------------------------------------------------------------------ NFS-e ---
export async function listInvoices(): Promise<InvoiceItem[]> {
  await atraso();
  return db().invoices.map((i) => ({ ...i, patient_name: pacienteDe(i.patient_id).full_name }))
    .sort((a, b) => b.competence.localeCompare(a.competence));
}
export async function saveInvoice(i: Partial<InvoiceItem>) {
  await atraso();
  const { patient_name: _n, ...rest } = i;
  void _n;
  if (rest.id) {
    const atual = db().invoices.find((x) => x.id === rest.id);
    if (!atual) throw new Error('Nota não encontrada.');
    Object.assign(atual, rest);
    return atual;
  }
  const nova = { charge_id: null, payment_id: null, status: 'a_emitir', number: null, access_key: null, issued_on: null,
    pdf_attachment_id: null, xml_attachment_id: null, notes: null, amount: 0, competence: todayIn(tz).slice(0, 7) + '-01',
    patient_id: '', ...rest, id: uid() } as Invoice;
  db().invoices.push(nova);
  return nova;
}

// ------------------------------------------------------ exportação/backup ---
export async function exportAll(): Promise<Record<string, unknown>> {
  throw new Error('Na demonstração não há dados para exportar. Crie sua conta para usar o backup.');
}
export async function importAll(data: unknown): Promise<Record<string, number>> {
  void data;
  throw new Error('Na demonstração não é possível importar dados. Crie sua conta para usar a restauração.');
}

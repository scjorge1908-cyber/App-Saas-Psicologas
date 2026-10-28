// Tipos espelhando o schema (supabase/migrations). Manter em sincronia.

export type FiscalType = 'pf' | 'pj';
export type PatientStatus = 'ativo' | 'inativo' | 'alta';
export type BillingMode = 'por_sessao' | 'mensal';
export type Modality = 'presencial' | 'online';
export type AppointmentStatus = 'agendado' | 'confirmado' | 'atendido' | 'faltou' | 'cancelado';
export type CancelParty = 'paciente' | 'profissional';
export type SeriesFrequency = 'semanal' | 'quinzenal' | 'mensal';
export type RecordKind = 'identificacao_demanda' | 'objetivos' | 'evolucao' | 'procedimento' | 'encaminhamento' | 'encerramento' | 'observacao';
export type AttachmentCategory = 'avaliacao' | 'documento_emitido' | 'autorizacao_responsavel' | 'nota_fiscal' | 'outro'
  | 'laudo' | 'encaminhamento' | 'documento_identidade' | 'exame'; // as duas últimas existem no banco, mas o app não usa
export type DocumentType = 'declaracao' | 'atestado' | 'relatorio' | 'laudo' | 'parecer' | 'recibo' | 'contrato';
export type PaymentMethod = 'pix' | 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'transferencia' | 'boleto' | 'outro';
export type ReceitaSaudeStatus = 'pendente' | 'emitido' | 'nao_aplicavel';
export type InvoiceStatus = 'a_emitir' | 'emitida' | 'cancelada';

export interface Profile {
  id: string;
  full_name: string;
  crp: string | null;
  cpf: string | null;
  cnpj: string | null;
  fiscal_type: FiscalType;
  contact_email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  uf: string | null;
  timezone: string;
  session_minutes: number;
  buffer_minutes: number;
  default_price: number | null;
  cancellation_hours: number;
  agenda_start: string;
  agenda_end: string;
  retention_years: number;
  onboarded_at: string | null;
}

export interface Patient {
  id: string;
  owner_id: string;
  full_name: string;
  social_name: string | null;
  birth_date: string | null;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  address: string | null; // endereço antigo em texto livre (cadastros anteriores)
  rg?: string | null;
  cep?: string | null;
  street?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  uf?: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  guardian_name: string | null;
  guardian_cpf: string | null;
  guardian_relationship: string | null;
  guardian_phone: string | null;
  guardian_authorization_date: string | null;
  payer_name: string | null;
  payer_cpf: string | null;
  /** Nota fiscal no nome de: o próprio paciente ou outra pessoa (payer_*). Vazio = não emite / não definido. */
  nf_tomador?: 'paciente' | 'outro' | null;
  /** Quem paga: pf (CPF) ou pj (empresa, CNPJ). Vazio = o próprio paciente. */
  payer_tipo?: 'pf' | 'pj' | null;
  payer_cnpj?: string | null;
  payer_im?: string | null;
  payer_email?: string | null;
  payer_phone?: string | null;
  payer_cep?: string | null;
  payer_street?: string | null;
  payer_number?: string | null;
  payer_complement?: string | null;
  payer_neighborhood?: string | null;
  payer_city?: string | null;
  payer_uf?: string | null;
  billing_mode: BillingMode;
  session_price: number | null;
  session_minutes: number | null;
  modality: Modality;
  meeting_url: string | null;
  status: PatientStatus;
  admin_notes: string | null;
  created_at: string;
}

export interface AgendaItem {
  id: string;
  patient_id: string;
  series_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  canceled_by: CancelParty | null;
  cancel_reason: string | null;
  late_cancellation: boolean;
  charge_no_show: boolean;
  price: number | null;
  modality: Modality;
  admin_notes: string | null;
  confirmed_at: string | null;
  patient_response: 'confirmou' | 'cancelou' | null;
  responded_at: string | null;
  patient_name: string;
  patient_social_name: string | null;
  patient_phone: string | null;
  patient_meeting_url: string | null;
  patient_billing_mode: BillingMode;
  series_frequency: SeriesFrequency | null;
  location_id: string | null;
  location_name: string | null;
  location_color: string | null;
  patient_birth_date?: string | null;
  /** Quando o link de confirmação válido foi gerado (enviado pelo WhatsApp); vazio = falta enviar. */
  confirmation_link_at?: string | null;
}

/** Local de atendimento (sala, consultório ou on-line). */
export interface Location {
  id: string;
  name: string;
  modality: Modality;
  address: string | null;
  color: string | null;
  active: boolean;
}

/** Faixa semanal de atendimento: dia da semana (0 = domingo) e horário, em um local. */
export interface WorkingHour {
  id: string;
  location_id: string;
  weekday: number;
  start_time: string; // HH:MM ou HH:MM:SS
  end_time: string;
  session_minutes?: number | null; // vazio = padrão do perfil
  buffer_minutes?: number | null;
}

/** Bloqueio de agenda (férias, feriado, folga). Sem horário = dia inteiro. */
export type BlockKind = 'ferias' | 'feriado' | 'folga' | 'outro';
export interface ScheduleBlock {
  id: string;
  kind: BlockKind;
  starts_on: string; // AAAA-MM-DD
  ends_on: string;
  start_time: string | null; // HH:MM[:SS] ou vazio (dia inteiro)
  end_time: string | null;
  reason: string | null;
}

export interface RecordEntry {
  id: string;
  patient_id: string;
  appointment_id: string | null;
  kind: RecordKind;
  entry_date: string;
  title: string | null;
  content: string;
  private_notes?: string | null; // anotações pessoais (uso restrito, fora dos documentos)
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RecordEntryVersion {
  id: string;
  entry_id: string;
  version: number;
  kind: RecordKind;
  entry_date: string;
  title: string | null;
  content: string;
  private_notes?: string | null;
  valid_from: string;
  replaced_at: string;
}

export interface Attachment {
  id: string;
  patient_id: string | null;
  record_entry_id: string | null;
  category: AttachmentCategory;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  patient_id: string;
  doc_type: DocumentType;
  title: string;
  purpose: string | null;
  recipient: string | null;
  issued_on: string;
  fields: Record<string, unknown>;
  attachment_id: string | null;
  pdf_sha256: string | null;
  delivered_at: string | null;
  delivered_to: string | null;
  created_at: string;
}

export interface ChargeBalance {
  id: string;
  patient_id: string;
  appointment_id: string | null;
  description: string;
  amount: number;
  due_date: string;
  canceled_at: string | null;
  created_at: string;
  paid: number;
  balance: number;
  status: 'aberta' | 'parcial' | 'paga' | 'cancelada';
  overdue: boolean;
  patient_name: string;
  patient_phone: string | null;
}

export interface PaymentItem {
  id: string;
  patient_id: string;
  charge_id: string | null;
  amount: number;
  paid_on: string;
  method: PaymentMethod;
  payer_name: string | null;
  payer_cpf: string | null;
  receita_saude_status: ReceitaSaudeStatus;
  notes: string | null;
  created_at: string;
  patient_name: string;
  patient_cpf: string | null;
  charge_description: string | null;
}

export interface Expense {
  id: string;
  description: string;
  category: string;
  amount: number;
  expense_date: string;
  paid: boolean;
  notes: string | null;
}

export interface InvoiceItem {
  id: string;
  patient_id: string;
  charge_id: string | null;
  payment_id: string | null;
  competence: string;
  amount: number;
  status: InvoiceStatus;
  number: string | null;
  access_key: string | null;
  issued_on: string | null;
  pdf_attachment_id: string | null;
  xml_attachment_id: string | null;
  notes: string | null;
  patient_name: string;
}

export interface DashboardSummary {
  today: string;
  sessions_today: number;
  to_confirm_48h: number;
  to_register: number;
  receivable: number;
  overdue: number;
  received_month: number;
  active_patients: number;
  invoices_pending: number;
  receita_saude_pending: number;
}

export interface FinancialReportRow {
  month: string;
  billed: number;
  received: number;
  expenses: number;
  net: number;
  sessions_attended: number;
  no_shows: number;
}

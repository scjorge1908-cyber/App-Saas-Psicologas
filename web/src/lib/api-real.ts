// Acesso a dados. Toda chamada passa pelo RLS do usuário autenticado.
import { supabase, STORAGE_BUCKET } from './supabase';
import type {
  AgendaItem, AppointmentStatus, Attachment, AttachmentCategory, ChargeBalance, DashboardSummary, DocumentRow,
  Expense, FinancialReportRow, InvoiceItem, Location, Patient, PaymentItem, RecordEntry, RecordEntryVersion, SeriesFrequency, Modality, WorkingHour,
} from './types';
import { sha256Hex } from './hash';

function check<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

// ------------------------------------------------------------- pacientes ---
export async function listPatients(): Promise<Patient[]> {
  return check(await supabase.from('patients').select('*').order('full_name'));
}
export async function getPatient(id: string): Promise<Patient> {
  return check(await supabase.from('patients').select('*').eq('id', id).single());
}
export async function savePatient(p: Partial<Patient> & { id?: string }): Promise<Patient> {
  const { id, ...rest } = p;
  if (id) return check(await supabase.from('patients').update(rest).eq('id', id).select().single());
  return check(await supabase.from('patients').insert(rest).select().single());
}
export async function deletePatient(id: string) {
  check(await supabase.from('patients').delete().eq('id', id));
}

// ---------------------------------------------------------------- agenda ---
export async function listAgenda(fromIso: string, toIso: string): Promise<AgendaItem[]> {
  return check(await supabase.from('agenda_items').select('*').gte('starts_at', fromIso).lt('starts_at', toIso).order('starts_at'));
}
export async function listPatientAgenda(patientId: string): Promise<AgendaItem[]> {
  return check(await supabase.from('agenda_items').select('*').eq('patient_id', patientId).order('starts_at', { ascending: false }));
}
export async function listToRegister(beforeIso: string): Promise<AgendaItem[]> {
  return check(await supabase.from('agenda_items').select('*').in('status', ['agendado', 'confirmado']).lt('ends_at', beforeIso).order('starts_at').limit(50));
}
export async function createAppointment(a: { patient_id: string; starts_at: string; ends_at: string; price: number | null; modality: Modality; admin_notes?: string | null; location_id?: string | null }) {
  return check(await supabase.from('appointments').insert(a).select().single());
}
export async function updateAppointment(id: string, patch: Record<string, unknown>) {
  return check(await supabase.from('appointments').update(patch).eq('id', id).select().single());
}
export async function setStatus(id: string, status: AppointmentStatus, extra: Record<string, unknown> = {}) {
  return updateAppointment(id, { status, ...extra });
}
export async function deleteAppointment(id: string) {
  check(await supabase.from('appointments').delete().eq('id', id));
}
export interface SeriesResult { series_id: string; created: Array<{ id: string; starts_at: string }>; conflicts: Array<{ starts_at: string }> }
export async function createSeries(args: {
  patientId: string; frequency: SeriesFrequency; startDate: string; startTime: string; duration: number;
  untilDate?: string | null; occurrences?: number | null; price?: number | null; modality: Modality; locationId?: string | null;
}): Promise<SeriesResult> {
  const r: SeriesResult = check(await supabase.rpc('create_appointment_series', {
    p_patient_id: args.patientId, p_frequency: args.frequency, p_start_date: args.startDate, p_start_time: args.startTime,
    p_duration_minutes: args.duration, p_until_date: args.untilDate ?? null, p_occurrences: args.occurrences ?? null,
    p_price: args.price ?? null, p_modality: args.modality,
  }));
  if (args.locationId) {
    // o local vale para a série e para todas as sessões geradas por ela
    check(await supabase.from('appointment_series').update({ location_id: args.locationId }).eq('id', r.series_id));
    check(await supabase.from('appointments').update({ location_id: args.locationId }).eq('series_id', r.series_id));
  }
  return r;
}
export async function endSeries(seriesId: string, fromDate: string): Promise<number> {
  return check(await supabase.rpc('end_appointment_series', { p_series_id: seriesId, p_from_date: fromDate }));
}
export async function changeSeries(args: { seriesId: string; fromDate: string; newStartDate: string; newTime: string; duration?: number | null; price?: number | null; frequency?: SeriesFrequency | null }): Promise<SeriesResult> {
  return check(await supabase.rpc('change_appointment_series', {
    p_series_id: args.seriesId, p_from_date: args.fromDate, p_new_start_date: args.newStartDate, p_new_time: args.newTime,
    p_new_duration_minutes: args.duration ?? null, p_new_price: args.price ?? null, p_new_frequency: args.frequency ?? null,
  }));
}
export async function extendSeries(seriesId: string, until: string): Promise<SeriesResult> {
  return check(await supabase.rpc('extend_appointment_series', { p_series_id: seriesId, p_until_date: until }));
}
export async function createConfirmationLink(appointmentId: string): Promise<string> {
  return check(await supabase.rpc('create_confirmation_link', { p_appointment_id: appointmentId }));
}

// ------------------------------------------------------------ prontuário ---
export async function listRecords(patientId: string): Promise<RecordEntry[]> {
  return check(await supabase.from('record_entries').select('*').eq('patient_id', patientId).order('entry_date', { ascending: false }).order('created_at', { ascending: false }));
}
export async function saveRecord(r: Partial<RecordEntry> & { patient_id: string }) {
  const { id, ...rest } = r;
  if (id) return check(await supabase.from('record_entries').update({ kind: rest.kind, entry_date: rest.entry_date, title: rest.title, content: rest.content }).eq('id', id).select().single());
  return check(await supabase.from('record_entries').insert(rest).select().single());
}
export async function listRecordVersions(entryId: string): Promise<RecordEntryVersion[]> {
  return check(await supabase.from('record_entry_versions').select('*').eq('entry_id', entryId).order('version', { ascending: false }));
}

// ------------------------------------------------------- anexos/storage ---
export async function listAttachments(patientId: string): Promise<Attachment[]> {
  return check(await supabase.from('attachments').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }));
}
export async function uploadAttachment(opts: { ownerId: string; patientId: string; bytes: Uint8Array; fileName: string; mime: string; category: AttachmentCategory; recordEntryId?: string | null }): Promise<Attachment> {
  const safe = opts.fileName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const path = `${opts.ownerId}/${opts.patientId}/${crypto.randomUUID()}-${safe}`;
  const sha = await sha256Hex(opts.bytes);
  const up = await supabase.storage.from(STORAGE_BUCKET).upload(path, opts.bytes, { contentType: opts.mime, upsert: false });
  if (up.error) throw up.error;
  const row = await supabase.from('attachments').insert({
    patient_id: opts.patientId, record_entry_id: opts.recordEntryId ?? null, category: opts.category,
    storage_path: path, file_name: opts.fileName.slice(0, 255), mime_type: opts.mime, size_bytes: opts.bytes.length, sha256: sha,
  }).select().single();
  if (row.error) {
    await supabase.storage.from(STORAGE_BUCKET).remove([path]); // desfaz upload órfão
    throw row.error;
  }
  return row.data as Attachment;
}
export async function downloadAttachment(a: Pick<Attachment, 'storage_path'>): Promise<Blob> {
  const r = await supabase.storage.from(STORAGE_BUCKET).download(a.storage_path);
  if (r.error) throw r.error;
  await supabase.rpc('log_event', { p_action: 'DOWNLOAD_ANEXO', p_table: 'attachments' });
  return r.data;
}
export async function deleteAttachment(a: Attachment) {
  check(await supabase.from('attachments').delete().eq('id', a.id));
  await supabase.storage.from(STORAGE_BUCKET).remove([a.storage_path]);
}

// ------------------------------------------------------------ documentos ---
export async function listDocuments(patientId: string): Promise<DocumentRow[]> {
  return check(await supabase.from('documents').select('*').eq('patient_id', patientId).order('issued_on', { ascending: false }).order('created_at', { ascending: false }));
}
export async function createDocument(d: Omit<DocumentRow, 'id' | 'created_at' | 'delivered_at' | 'delivered_to'>) {
  return check(await supabase.from('documents').insert(d).select().single());
}
export async function markDelivered(id: string, to: string) {
  return check(await supabase.from('documents').update({ delivered_at: new Date().toISOString(), delivered_to: to }).eq('id', id).select().single());
}

// ------------------------------------------------------------ financeiro ---
export async function listCharges(filter: { patientId?: string; open?: boolean } = {}): Promise<ChargeBalance[]> {
  let q = supabase.from('charge_balances').select('*');
  if (filter.patientId) q = q.eq('patient_id', filter.patientId);
  if (filter.open) q = q.in('status', ['aberta', 'parcial']);
  return check(await q.order('due_date', { ascending: true }));
}
export async function createCharge(c: { patient_id: string; description: string; amount: number; due_date: string }) {
  return check(await supabase.from('charges').insert(c).select().single());
}
export async function cancelCharge(id: string) {
  return check(await supabase.from('charges').update({ canceled_at: new Date().toISOString() }).eq('id', id).select().single());
}
export async function listPayments(filter: { from?: string; to?: string; patientId?: string } = {}): Promise<PaymentItem[]> {
  let q = supabase.from('payment_items').select('*');
  if (filter.from) q = q.gte('paid_on', filter.from);
  if (filter.to) q = q.lte('paid_on', filter.to);
  if (filter.patientId) q = q.eq('patient_id', filter.patientId);
  return check(await q.order('paid_on', { ascending: false }));
}
export async function createPayment(p: { patient_id: string; charge_id: string | null; amount: number; paid_on: string; method: string; payer_name?: string | null; payer_cpf?: string | null; receita_saude_status: string; notes?: string | null }) {
  return check(await supabase.from('payments').insert(p).select().single());
}
export async function updatePayment(id: string, patch: Record<string, unknown>) {
  return check(await supabase.from('payments').update(patch).eq('id', id).select().single());
}
export async function deletePayment(id: string) {
  check(await supabase.from('payments').delete().eq('id', id));
}
export async function listExpenses(from: string, to: string): Promise<Expense[]> {
  return check(await supabase.from('expenses').select('*').gte('expense_date', from).lte('expense_date', to).order('expense_date', { ascending: false }));
}
export async function saveExpense(e: Partial<Expense>) {
  const { id, ...rest } = e;
  if (id) return check(await supabase.from('expenses').update(rest).eq('id', id).select().single());
  return check(await supabase.from('expenses').insert(rest).select().single());
}
export async function deleteExpense(id: string) {
  check(await supabase.from('expenses').delete().eq('id', id));
}
export async function financialReport(from: string, to: string): Promise<FinancialReportRow[]> {
  return check(await supabase.rpc('financial_report', { p_from: from, p_to: to }));
}
export async function dashboard(): Promise<DashboardSummary> {
  return check(await supabase.rpc('dashboard_summary'));
}

// ------------------------------------------------------------------ NFS-e ---
export async function listInvoices(): Promise<InvoiceItem[]> {
  return check(await supabase.from('invoice_items').select('*').order('competence', { ascending: false }));
}
export async function saveInvoice(i: Partial<InvoiceItem>) {
  const { id, patient_name: _n, ...rest } = i;
  void _n;
  if (id) return check(await supabase.from('invoices').update(rest).eq('id', id).select().single());
  return check(await supabase.from('invoices').insert(rest).select().single());
}

// ------------------------------------------------------ exportação/backup ---
export async function exportAll(): Promise<Record<string, unknown>> {
  return check(await supabase.rpc('export_my_data'));
}
export async function importAll(data: unknown): Promise<Record<string, number>> {
  return check(await supabase.rpc('import_my_data', { p_data: data }));
}

// ------------------------------------------------------ locais e horários ---
export async function listLocations(): Promise<Location[]> {
  return check(await supabase.from('locations').select('id, name, modality, address, color, active').order('name'));
}
export async function saveLocation(l: Partial<Location> & { name: string }): Promise<Location> {
  const { id, ...rest } = l;
  if (id) return check(await supabase.from('locations').update(rest).eq('id', id).select('id, name, modality, address, color, active').single());
  return check(await supabase.from('locations').insert(rest).select('id, name, modality, address, color, active').single());
}
export async function deleteLocation(id: string) {
  check(await supabase.from('locations').delete().eq('id', id));
}
export async function listWorkingHours(): Promise<WorkingHour[]> {
  return check(await supabase.from('working_hours').select('id, location_id, weekday, start_time, end_time, session_minutes, buffer_minutes').order('weekday').order('start_time'));
}
export async function saveWorkingHour(h: Partial<WorkingHour> & Omit<WorkingHour, 'id'>): Promise<WorkingHour> {
  const { id, ...rest } = h;
  if (id) return check(await supabase.from('working_hours').update(rest).eq('id', id).select('id, location_id, weekday, start_time, end_time, session_minutes, buffer_minutes').single());
  return check(await supabase.from('working_hours').insert(rest).select('id, location_id, weekday, start_time, end_time, session_minutes, buffer_minutes').single());
}
export async function deleteWorkingHour(id: string) {
  check(await supabase.from('working_hours').delete().eq('id', id));
}

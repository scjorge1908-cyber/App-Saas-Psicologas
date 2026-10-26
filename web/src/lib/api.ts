// Ponto único de acesso a dados das telas.
// Conta real: lib/api-real.ts (Supabase, protegido por RLS). Demonstração: lib/demo/api-demo.ts (em memória, dados fictícios).
// A escolha é feita a cada chamada, então entrar ou sair da demonstração não exige recarregar o app.
import * as real from './api-real';
import * as demo from './demo/api-demo';
import { isDemo } from './demo/modo';

export type { SeriesResult } from './api-real';

const fonte = () => (isDemo() ? demo : real);

export const listPatients: typeof real.listPatients = (...a) => (fonte().listPatients as typeof real.listPatients)(...a);
export const getPatient: typeof real.getPatient = (...a) => (fonte().getPatient as typeof real.getPatient)(...a);
export const savePatient: typeof real.savePatient = (...a) => (fonte().savePatient as typeof real.savePatient)(...a);
export const deletePatient: typeof real.deletePatient = (...a) => (fonte().deletePatient as typeof real.deletePatient)(...a);
export const listAgenda: typeof real.listAgenda = (...a) => (fonte().listAgenda as typeof real.listAgenda)(...a);
export const listPatientAgenda: typeof real.listPatientAgenda = (...a) => (fonte().listPatientAgenda as typeof real.listPatientAgenda)(...a);
export const listToRegister: typeof real.listToRegister = (...a) => (fonte().listToRegister as typeof real.listToRegister)(...a);
export const createAppointment: typeof real.createAppointment = (...a) => (fonte().createAppointment as typeof real.createAppointment)(...a);
export const updateAppointment: typeof real.updateAppointment = (...a) => (fonte().updateAppointment as typeof real.updateAppointment)(...a);
export const setStatus: typeof real.setStatus = (...a) => (fonte().setStatus as typeof real.setStatus)(...a);
export const deleteAppointment: typeof real.deleteAppointment = (...a) => (fonte().deleteAppointment as typeof real.deleteAppointment)(...a);
export const createSeries: typeof real.createSeries = (...a) => (fonte().createSeries as typeof real.createSeries)(...a);
export const endSeries: typeof real.endSeries = (...a) => (fonte().endSeries as typeof real.endSeries)(...a);
export const changeSeries: typeof real.changeSeries = (...a) => (fonte().changeSeries as typeof real.changeSeries)(...a);
export const extendSeries: typeof real.extendSeries = (...a) => (fonte().extendSeries as typeof real.extendSeries)(...a);
export const createConfirmationLink: typeof real.createConfirmationLink = (...a) => (fonte().createConfirmationLink as typeof real.createConfirmationLink)(...a);
export const listRecords: typeof real.listRecords = (...a) => (fonte().listRecords as typeof real.listRecords)(...a);
export const saveRecord: typeof real.saveRecord = (...a) => (fonte().saveRecord as typeof real.saveRecord)(...a);
export const listRecordVersions: typeof real.listRecordVersions = (...a) => (fonte().listRecordVersions as typeof real.listRecordVersions)(...a);
export const listAttachments: typeof real.listAttachments = (...a) => (fonte().listAttachments as typeof real.listAttachments)(...a);
export const uploadAttachment: typeof real.uploadAttachment = (...a) => (fonte().uploadAttachment as typeof real.uploadAttachment)(...a);
export const downloadAttachment: typeof real.downloadAttachment = (...a) => (fonte().downloadAttachment as typeof real.downloadAttachment)(...a);
export const deleteAttachment: typeof real.deleteAttachment = (...a) => (fonte().deleteAttachment as typeof real.deleteAttachment)(...a);
export const listDocuments: typeof real.listDocuments = (...a) => (fonte().listDocuments as typeof real.listDocuments)(...a);
export const createDocument: typeof real.createDocument = (...a) => (fonte().createDocument as typeof real.createDocument)(...a);
export const markDelivered: typeof real.markDelivered = (...a) => (fonte().markDelivered as typeof real.markDelivered)(...a);
export const listCharges: typeof real.listCharges = (...a) => (fonte().listCharges as typeof real.listCharges)(...a);
export const createCharge: typeof real.createCharge = (...a) => (fonte().createCharge as typeof real.createCharge)(...a);
export const cancelCharge: typeof real.cancelCharge = (...a) => (fonte().cancelCharge as typeof real.cancelCharge)(...a);
export const listPayments: typeof real.listPayments = (...a) => (fonte().listPayments as typeof real.listPayments)(...a);
export const createPayment: typeof real.createPayment = (...a) => (fonte().createPayment as typeof real.createPayment)(...a);
export const updatePayment: typeof real.updatePayment = (...a) => (fonte().updatePayment as typeof real.updatePayment)(...a);
export const deletePayment: typeof real.deletePayment = (...a) => (fonte().deletePayment as typeof real.deletePayment)(...a);
export const listExpenses: typeof real.listExpenses = (...a) => (fonte().listExpenses as typeof real.listExpenses)(...a);
export const saveExpense: typeof real.saveExpense = (...a) => (fonte().saveExpense as typeof real.saveExpense)(...a);
export const deleteExpense: typeof real.deleteExpense = (...a) => (fonte().deleteExpense as typeof real.deleteExpense)(...a);
export const financialReport: typeof real.financialReport = (...a) => (fonte().financialReport as typeof real.financialReport)(...a);
export const dashboard: typeof real.dashboard = (...a) => (fonte().dashboard as typeof real.dashboard)(...a);
export const listInvoices: typeof real.listInvoices = (...a) => (fonte().listInvoices as typeof real.listInvoices)(...a);
export const saveInvoice: typeof real.saveInvoice = (...a) => (fonte().saveInvoice as typeof real.saveInvoice)(...a);
export const exportAll: typeof real.exportAll = (...a) => (fonte().exportAll as typeof real.exportAll)(...a);
export const importAll: typeof real.importAll = (...a) => (fonte().importAll as typeof real.importAll)(...a);

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { InvoiceItem, InvoiceStatus } from '../lib/types';
import { errorMessage } from '../lib/errors';
import { formatDate, money, onlyDigits, parseMoney, startOfMonth, todayIn } from '../lib/format';
import { useAuth, useProfile } from '../auth/AuthProvider';
import { Badge, Button, Dialog, Empty, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, Tabs, TextField, useToast } from '../components/ui';
import { saveBlob } from '../components/patients/DocumentsTab';

const STATUS: Record<InvoiceStatus, { label: string; tone: 'atencao' | 'ok' | 'neutro' }> = {
  a_emitir: { label: 'A emitir', tone: 'atencao' }, emitida: { label: 'Emitida', tone: 'ok' }, cancelada: { label: 'Cancelada', tone: 'neutro' },
};

export function InvoicesPage() {
  const q = useQuery({ queryKey: ['invoices'], queryFn: api.listInvoices });
  const [filter, setFilter] = useState<InvoiceStatus | 'todas'>('a_emitir');
  const [editing, setEditing] = useState<Partial<InvoiceItem> | null>(null);
  const { tz } = useProfile();
  const list = (q.data ?? []).filter((i) => filter === 'todas' || i.status === filter);

  return (
    <div>
      <PageHeader title="Notas fiscais" subtitle="Acompanhe as NFS-e dos seus atendimentos." actions={<Button onClick={() => setEditing({ status: 'a_emitir', competence: startOfMonth(todayIn(tz)) })}>Registrar nota</Button>} />
      <Notice>
        <p>O sistema <strong>não emite</strong> notas fiscais. Emita a NFS-e no portal da sua prefeitura ou no Emissor Nacional (gov.br/nfse) e registre aqui o número, a chave e os arquivos para manter o controle.</p>
        <p className="mt-1">A emissão automática exige certificado digital e, conforme o município, integração paga; está prevista como evolução do produto.</p>
      </Notice>
      <div className="mt-5">
        <Tabs label="Situação" value={filter} onChange={setFilter} items={[
          { value: 'a_emitir', label: 'A emitir', count: q.data?.filter((i) => i.status === 'a_emitir').length },
          { value: 'emitida', label: 'Emitidas' }, { value: 'cancelada', label: 'Canceladas' }, { value: 'todas', label: 'Todas' },
        ]} />
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox>{errorMessage(q.error)}</ErrorBox>}
      {q.data && list.length === 0 && <Empty title="Nenhuma nota nesta situação." />}
      <ul className="divide-y divide-linha rounded-lg border border-linha bg-papel empty:hidden">
        {list.map((i) => (
          <li key={i.id}>
            <button onClick={() => setEditing(i)} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gesso">
              <span>
                <span className="block font-bold">{i.patient_name}</span>
                <span className="num text-sm text-tinta-2">Competência {formatDate(i.competence).slice(3)}{i.number ? `, nº ${i.number}` : ''}{i.issued_on ? `, emitida em ${formatDate(i.issued_on)}` : ''}</span>
              </span>
              <span className="flex items-center gap-3"><span className="num font-bold">{money(i.amount)}</span><Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge></span>
            </button>
          </li>
        ))}
      </ul>
      <InvoiceDialog invoice={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function InvoiceDialog({ invoice, onClose }: { invoice: Partial<InvoiceItem> | null; onClose: () => void }) {
  const { session } = useAuth();
  const { tz } = useProfile();
  const qc = useQueryClient();
  const toast = useToast();
  const patients = useQuery({ queryKey: ['patients'], queryFn: api.listPatients, enabled: !!invoice });
  const atts = useQuery({ queryKey: ['attachments', invoice?.patient_id], queryFn: () => api.listAttachments(invoice!.patient_id!), enabled: !!invoice?.patient_id });
  const [f, setF] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<{ pdf?: File; xml?: File }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const xmlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!invoice) return;
    setF({
      patient_id: invoice.patient_id ?? '', competence: invoice.competence ?? startOfMonth(todayIn(tz)), amount: invoice.amount != null ? String(invoice.amount).replace('.', ',') : '',
      status: invoice.status ?? 'a_emitir', number: invoice.number ?? '', access_key: invoice.access_key ?? '', issued_on: invoice.issued_on ?? '', notes: invoice.notes ?? '',
    });
    setFiles({}); setError(null);
  }, [invoice, tz]);

  if (!invoice) return null;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setError(null);
    const amount = parseMoney(f.amount ?? '');
    if (!f.patient_id) return setError('Escolha o paciente.');
    if (!amount) return setError('Informe o valor da nota.');
    if (f.status === 'emitida' && (!f.number.trim() || !f.issued_on)) return setError('Para marcar como emitida, informe o número e a data de emissão da nota.');
    const key = onlyDigits(f.access_key);
    if (key && (key.length < 44 || key.length > 50)) return setError('A chave de acesso deve ter de 44 a 50 números.');
    setBusy(true);
    try {
      const up = async (file: File | undefined) => file ? (await api.uploadAttachment({ ownerId: session!.user.id, patientId: f.patient_id, bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, mime: file.type || 'application/octet-stream', category: 'nota_fiscal' })).id : undefined;
      const pdfId = await up(files.pdf);
      const xmlId = await up(files.xml);
      await api.saveInvoice({
        id: invoice!.id, patient_id: f.patient_id, competence: f.competence, amount, status: f.status as InvoiceStatus,
        number: f.number.trim() || null, access_key: key || null, issued_on: f.issued_on || null, notes: f.notes.trim() || null,
        ...(pdfId ? { pdf_attachment_id: pdfId } : {}), ...(xmlId ? { xml_attachment_id: xmlId } : {}),
      });
      await qc.invalidateQueries({ queryKey: ['invoices'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Nota fiscal salva'); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const existing = (id: string | null | undefined) => atts.data?.find((a) => a.id === id);

  return (
    <Dialog open onClose={onClose} title={invoice.id ? 'Nota fiscal' : 'Registrar nota fiscal'} footer={<>
      <Button variant="secondary" onClick={onClose}>Voltar</Button><Button busy={busy} onClick={save}>Salvar nota</Button>
    </>}>
      <div className="flex flex-col gap-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Paciente (tomador)" required>{(id) => (
          <Select id={id} value={f.patient_id} onChange={set('patient_id')} disabled={!!invoice.id}>
            <option value="">Escolha o paciente</option>
            {patients.data?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </Select>
        )}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Competência">{(id) => <Input id={id} type="date" value={f.competence} onChange={set('competence')} />}</Field>
          <TextField label="Valor (R$)" inputMode="decimal" required value={f.amount} onChange={set('amount')} />
        </div>
        <Field label="Situação">{(id) => (
          <Select id={id} value={f.status} onChange={set('status')}>
            <option value="a_emitir">A emitir</option><option value="emitida">Emitida</option><option value="cancelada">Cancelada</option>
          </Select>
        )}</Field>
        {f.status !== 'a_emitir' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Número da nota" required={f.status === 'emitida'} value={f.number} onChange={set('number')} />
              <Field label="Data de emissão" required={f.status === 'emitida'}>{(id) => <Input id={id} type="date" value={f.issued_on} onChange={set('issued_on')} />}</Field>
            </div>
            <TextField label="Chave de acesso (opcional)" inputMode="numeric" value={f.access_key} onChange={set('access_key')} />
            <div className="flex flex-wrap gap-2">
              <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => setFiles({ ...files, pdf: e.target.files?.[0] })} />
              <input ref={xmlRef} type="file" accept="text/xml,application/xml,.xml" className="hidden" onChange={(e) => setFiles({ ...files, xml: e.target.files?.[0] })} />
              <Button variant="secondary" size="sm" onClick={() => pdfRef.current?.click()}>{files.pdf ? `PDF: ${files.pdf.name}` : 'Anexar PDF da nota'}</Button>
              <Button variant="secondary" size="sm" onClick={() => xmlRef.current?.click()}>{files.xml ? `XML: ${files.xml.name}` : 'Anexar XML da nota'}</Button>
            </div>
            {[existing(invoice.pdf_attachment_id), existing(invoice.xml_attachment_id)].filter(Boolean).map((a) => (
              <Button key={a!.id} variant="ghost" size="sm" onClick={async () => { try { saveBlob(await api.downloadAttachment(a!), a!.file_name); } catch (e) { toast(errorMessage(e), 'erro'); } }}>Baixar {a!.file_name}</Button>
            ))}
          </>
        )}
        <TextField label="Observações" value={f.notes} onChange={set('notes')} />
      </div>
    </Dialog>
  );
}

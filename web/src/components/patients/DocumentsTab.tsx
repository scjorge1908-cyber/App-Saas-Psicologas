import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { DocumentType, Patient } from '../../lib/types';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime, todayIn } from '../../lib/format';
import { DOC_LABELS, buildSpec, type DocumentSpec, type Professional } from '../../lib/pdf/spec';
import { sha256Hex } from '../../lib/hash';

// pdf-lib é carregado só quando um PDF é gerado (reduz o carregamento inicial)
const renderDocumentPdf = async (spec: DocumentSpec, pro: Professional) => (await import('../../lib/pdf/documents')).renderDocumentPdf(spec, pro);
import { useProfile } from '../../auth/AuthProvider';
import { supabase } from '../../lib/supabase';
import { Button, Dialog, Empty, ErrorBox, Field, Input, Loading, Notice, Select, TextField, Textarea, useToast } from '../ui';
import { IconDownload } from '../icons';

interface FieldDef { k: string; label: string; long?: boolean; hint?: string; type?: string; placeholder?: string }

const FIELDS: Record<DocumentType, FieldDef[]> = {
  declaracao: [
    { k: 'finalidade', label: 'Finalidade', placeholder: 'comprovação de comparecimento junto ao empregador' },
    { k: 'acompanhamento', label: 'Informação declarada', placeholder: 'está em acompanhamento psicológico', hint: 'É vedado registrar sintomas, situações ou estados psicológicos na declaração (Res. CFP 06/2019, art. 9º).' },
    { k: 'local', label: 'Local do atendimento' },
    { k: 'dias_horarios', label: 'Dias e horários', placeholder: 'às quartas-feiras, das 14h às 14h50' },
    { k: 'duracao', label: 'Período/duração', placeholder: 'desde março de 2026' },
  ],
  atestado: [
    { k: 'solicitante', label: 'Solicitante' },
    { k: 'finalidade', label: 'Finalidade' },
    { k: 'condicoes', label: 'Condições psicológicas atestadas', long: true, hint: 'Texto corrido, sem parágrafos (Res. CFP 06/2019, art. 10).' },
    { k: 'validade', label: 'Prazo de validade', placeholder: '30 dias' },
  ],
  relatorio: [
    { k: 'solicitante', label: 'Solicitante' }, { k: 'finalidade', label: 'Finalidade' },
    { k: 'demanda', label: 'Descrição da demanda', long: true }, { k: 'procedimento', label: 'Procedimento', long: true },
    { k: 'analise', label: 'Análise', long: true }, { k: 'conclusao', label: 'Conclusão', long: true },
    { k: 'validade', label: 'Prazo de validade', placeholder: '90 dias' },
  ],
  laudo: [
    { k: 'solicitante', label: 'Solicitante' }, { k: 'finalidade', label: 'Finalidade' },
    { k: 'demanda', label: 'Descrição da demanda', long: true }, { k: 'procedimento', label: 'Procedimento', long: true },
    { k: 'analise', label: 'Análise', long: true }, { k: 'conclusao', label: 'Conclusão', long: true },
    { k: 'referencias', label: 'Referências', long: true }, { k: 'validade', label: 'Prazo de validade' },
  ],
  parecer: [
    { k: 'solicitante', label: 'Solicitante' }, { k: 'finalidade', label: 'Assunto' },
    { k: 'demanda', label: 'Descrição da demanda', long: true }, { k: 'analise', label: 'Análise', long: true },
    { k: 'conclusao', label: 'Conclusão', long: true }, { k: 'referencias', label: 'Referências', long: true },
  ],
  recibo: [
    { k: 'valor', label: 'Valor (R$)', placeholder: '150.00' }, { k: 'descricao', label: 'Referente a', placeholder: 'sessões de psicoterapia de outubro/2026' },
    { k: 'data_pagamento', label: 'Data do pagamento', type: 'date' },
    { k: 'pagador_nome', label: 'Pagador (se não for o paciente)' }, { k: 'pagador_cpf', label: 'CPF do pagador' },
  ],
  contrato: [
    { k: 'modalidade', label: 'Modalidade', placeholder: 'presencial' }, { k: 'frequencia', label: 'Frequência', placeholder: 'semanal' },
    { k: 'duracao', label: 'Duração da sessão', placeholder: '50 minutos' }, { k: 'valor', label: 'Valor (R$)', placeholder: '150.00' },
    { k: 'forma_cobranca', label: 'Forma de cobrança', placeholder: 'por sessão' }, { k: 'forma_pagamento', label: 'Forma de pagamento', placeholder: 'Pix até o dia 10' },
    { k: 'reajuste', label: 'Reajuste' }, { k: 'politica_faltas', label: 'Faltas e cancelamentos', long: true },
    { k: 'tecnologia', label: 'Recursos tecnológicos utilizados', long: true, hint: 'Exigido pela Res. CFP 09/2024, art. 7º. Deixe em branco para usar o texto padrão.' },
    { k: 'responsavel', label: 'Responsável legal/financeiro' }, { k: 'foro', label: 'Foro (comarca)' },
  ],
};

export function DocumentsTab({ patient }: { patient: Patient }) {
  const { profile, tz } = useProfile();
  const q = useQuery({ queryKey: ['documents', patient.id], queryFn: () => api.listDocuments(patient.id) });
  const atts = useQuery({ queryKey: ['attachments', patient.id], queryFn: () => api.listAttachments(patient.id) });
  const [creating, setCreating] = useState(false);
  const [deliver, setDeliver] = useState<string | null>(null);
  const [deliverTo, setDeliverTo] = useState('');
  const qc = useQueryClient();
  const toast = useToast();

  async function download(attId: string | null, name: string) {
    const a = atts.data?.find((x) => x.id === attId);
    if (!a) return toast('Arquivo do documento não encontrado.', 'erro');
    try {
      const blob = await api.downloadAttachment(a);
      saveBlob(blob, name);
    } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-tinta-2">Documentos emitidos ficam guardados no prontuário e não podem ser alterados.</p>
        <Button onClick={() => setCreating(true)} disabled={!profile?.crp}>Emitir documento</Button>
      </div>
      {!profile?.crp && <Notice tone="ocre">Informe seu CRP em Configurações para emitir documentos.</Notice>}
      {q.isLoading && <Loading />}
      {q.data?.length === 0 && <Empty title="Nenhum documento emitido.">Declarações, atestados, relatórios, laudos, pareceres, recibos e contrato terapêutico.</Empty>}
      <ul className="divide-y divide-linha rounded-lg border border-linha bg-papel empty:hidden">
        {q.data?.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-bold">{d.title}</p>
              <p className="text-sm text-tinta-2">
                Emitido em {formatDate(d.issued_on)}{d.purpose ? `, finalidade: ${d.purpose}` : ''}.
                {d.delivered_at ? ` Entregue a ${d.delivered_to} em ${formatDateTime(d.delivered_at, tz)}.` : ' Entrega não registrada.'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => download(d.attachment_id, `${d.title} - ${patient.full_name}.pdf`)}><IconDownload width={18} height={18} /> Baixar PDF</Button>
              {!d.delivered_at && <Button size="sm" variant="ghost" onClick={() => { setDeliver(d.id); setDeliverTo(patient.full_name); }}>Registrar entrega</Button>}
            </div>
          </li>
        ))}
      </ul>

      <DocumentDialog open={creating} onClose={() => setCreating(false)} patient={patient} />

      <Dialog open={!!deliver} onClose={() => setDeliver(null)} title="Registrar entrega" footer={<>
        <Button variant="secondary" onClick={() => setDeliver(null)}>Voltar</Button>
        <Button onClick={async () => {
          try {
            await api.markDelivered(deliver!, deliverTo.trim());
            await qc.invalidateQueries({ queryKey: ['documents', patient.id] });
            toast('Entrega registrada'); setDeliver(null);
          } catch (e) { toast(errorMessage(e), 'erro'); }
        }} disabled={!deliverTo.trim()}>Registrar entrega</Button>
      </>}>
        <TextField label="Entregue a" value={deliverTo} onChange={(e) => setDeliverTo(e.target.value)} hint="Protocolo de entrega (Res. CFP 06/2019, art. 16)." />
      </Dialog>
    </div>
  );
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function DocumentDialog({ open, onClose, patient }: { open: boolean; onClose: () => void; patient: Patient }) {
  const { profile, tz } = useProfile();
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<DocumentType>('declaracao');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [issuedOn, setIssuedOn] = useState(todayIn(tz));
  const [sigilo, setSigilo] = useState(true);
  const [busy, setBusy] = useState<'preview' | 'issue' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setFields({}); setIssuedOn(todayIn(tz)); setError(null); } }, [open, tz]);
  useEffect(() => {
    // Valores iniciais úteis
    if (type === 'recibo') setFields((f) => ({ valor: f.valor ?? String(patient.session_price ?? ''), pagador_nome: patient.payer_name ?? '', pagador_cpf: patient.payer_cpf ?? '', data_pagamento: todayIn(tz), ...f }));
    if (type === 'contrato') setFields((f) => ({ valor: String(patient.session_price ?? ''), modalidade: patient.modality, responsavel: patient.guardian_name ?? patient.payer_name ?? '', foro: [profile?.city, profile?.uf].filter(Boolean).join('/'), ...f }));
  }, [type, patient, profile, tz]);

  const spec = useMemo(() => profile && buildSpec(type, { ...fields, sigilo: sigilo ? 'sim' : 'nao' }, { name: patient.full_name, cpf: patient.cpf }, profile, issuedOn), [type, fields, sigilo, patient, profile, issuedOn]);

  async function preview() {
    if (!spec || !profile) return;
    setBusy('preview');
    try {
      const bytes = await renderDocumentPdf(spec, profile);
      window.open(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })), '_blank', 'noopener');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  async function issue() {
    if (!spec || !profile) return;
    const required = FIELDS[type].filter((f) => ['finalidade', 'condicoes', 'conclusao', 'valor'].includes(f.k));
    const empty = required.find((f) => !(fields[f.k] ?? '').trim());
    if (empty) return setError(`Preencha o campo "${empty.label}".`);
    setBusy('issue'); setError(null);
    try {
      const bytes = await renderDocumentPdf(spec, profile);
      const sha = await sha256Hex(bytes);
      const att = await api.uploadAttachment({ ownerId: profile.id, patientId: patient.id, bytes, fileName: `${DOC_LABELS[type]} ${issuedOn}.pdf`, mime: 'application/pdf', category: 'documento_emitido' });
      await api.createDocument({
        patient_id: patient.id, doc_type: type, title: DOC_LABELS[type], purpose: fields.finalidade?.trim() || null,
        recipient: fields.solicitante?.trim() || null, issued_on: issuedOn, fields: { ...fields, sigilo }, attachment_id: att.id, pdf_sha256: sha,
      });
      await supabase.rpc('log_event', { p_action: 'GERAR_DOCUMENTO', p_table: 'documents' });
      await qc.invalidateQueries({ queryKey: ['documents', patient.id] });
      await qc.invalidateQueries({ queryKey: ['attachments', patient.id] });
      saveBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${DOC_LABELS[type]} - ${patient.full_name}.pdf`);
      toast('Documento emitido e guardado no prontuário');
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  return (
    <Dialog open={open} onClose={onClose} wide title="Emitir documento" footer={<>
      <Button variant="secondary" busy={busy === 'preview'} onClick={preview}>Pré-visualizar PDF</Button>
      <Button busy={busy === 'issue'} onClick={issue}>Emitir e baixar</Button>
    </>}>
      <div className="flex flex-col gap-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo de documento">{(id) => (
            <Select id={id} value={type} onChange={(e) => { setType(e.target.value as DocumentType); setFields({}); }}>
              {Object.entries(DOC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}</Field>
          <Field label="Data de emissão">{(id) => <Input id={id} type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />}</Field>
        </div>
        {FIELDS[type].map((f) => f.long ? (
          <Field key={f.k} label={f.label} hint={f.hint}>{(id, d) => <Textarea id={id} aria-describedby={d} rows={5} value={fields[f.k] ?? ''} onChange={(e) => setFields({ ...fields, [f.k]: e.target.value })} />}</Field>
        ) : (
          <TextField key={f.k} label={f.label} hint={f.hint} type={f.type} placeholder={f.placeholder} value={fields[f.k] ?? ''} onChange={(e) => setFields({ ...fields, [f.k]: e.target.value })} />
        ))}
        {!['recibo', 'contrato'].includes(type) && (
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-anil" checked={sigilo} onChange={(e) => setSigilo(e.target.checked)} />
            <span>Incluir cláusula de sigilo e uso restrito à finalidade</span>
          </label>
        )}
        <p className="text-sm text-tinta-3">O PDF sai com seu nome e CRP, páginas numeradas e campo de rubrica. Assine digitalmente (gov.br ou certificado ICP-Brasil) antes de entregar; o sistema não aplica assinatura.</p>
      </div>
    </Dialog>
  );
}

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { Attachment, AttachmentCategory } from '../../lib/types';
import { errorMessage } from '../../lib/errors';
import { formatBytes, formatDateTime } from '../../lib/format';
import { useAuth, useProfile } from '../../auth/AuthProvider';
import { Badge, Button, Empty, Field, Loading, Select, useConfirm, useToast } from '../ui';
import { saveBlob } from './DocumentsTab';

export const CATEGORY_LABEL: Record<AttachmentCategory, string> = {
  avaliacao: 'Material de avaliação',
  documento_emitido: 'Documento emitido',
  autorizacao_responsavel: 'Autorização do responsável',
  nota_fiscal: 'Nota fiscal',
  outro: 'Outro',
  laudo: 'Laudo',
  encaminhamento: 'Encaminhamento médico',
  documento_identidade: 'Documento de identidade',
  exame: 'Exame',
};
const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif,text/xml,application/xml,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
export const PROTECTED: AttachmentCategory[] = ['avaliacao', 'documento_emitido', 'laudo', 'encaminhamento', 'exame'];
/** Laudos e encaminhamentos médicos: aparecem também na aba Prontuário. */
export const CATEGORIAS_PRONTUARIO: AttachmentCategory[] = ['laudo', 'encaminhamento'];
const OPCOES: AttachmentCategory[] = ['outro', 'laudo', 'encaminhamento', 'avaliacao', 'autorizacao_responsavel', 'nota_fiscal'];

export function AttachmentsTab({ patientId, somente }: { patientId: string; somente?: AttachmentCategory[] }) {
  const { session } = useAuth();
  const { tz } = useProfile();
  const q = useQuery({ queryKey: ['attachments', patientId], queryFn: () => api.listAttachments(patientId) });
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const opcoes = somente ?? OPCOES;
  const [category, setCategory] = useState<AttachmentCategory>(somente ? somente[0] : 'outro');
  const lista = somente ? q.data?.filter((a) => somente.includes(a.category)) : q.data;
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('Arquivo acima do limite de 10 MB.', 'erro');
    if (PROTECTED.includes(category) && !(await confirm({ title: 'Anexo permanente', body: `${CATEGORY_LABEL[category]} faz parte do prontuário e não poderá ser excluído depois. Continuar?`, confirmLabel: 'Anexar' }))) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await api.uploadAttachment({ ownerId: session!.user.id, patientId, bytes, fileName: file.name, mime: file.type || 'application/octet-stream', category });
      await qc.invalidateQueries({ queryKey: ['attachments', patientId] });
      toast('Arquivo anexado');
    } catch (e) { toast(errorMessage(e), 'erro'); } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove(a: Attachment) {
    if (!(await confirm({ title: 'Excluir anexo?', body: `"${a.file_name}" será apagado definitivamente.`, confirmLabel: 'Excluir', danger: true }))) return;
    try {
      await api.deleteAttachment(a);
      await qc.invalidateQueries({ queryKey: ['attachments', patientId] });
      toast('Anexo excluído');
    } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="cartao flex flex-wrap items-end gap-3 p-4">
        <Field label="Tipo do arquivo" className="min-w-56 flex-1">{(id) => (
          <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as AttachmentCategory)}>
            {opcoes.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </Select>
        )}</Field>
        <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button busy={busy} onClick={() => input.current?.click()}>Escolher arquivo</Button>
        <p className="w-full text-sm text-tinta-3">PDF, imagem (inclusive foto de iPhone), Word, Excel, XML ou TXT, até 10 MB. Os arquivos ficam em armazenamento privado, acessível só pela sua conta.</p>
      </div>
      {q.isLoading && <Loading />}
      {lista?.length === 0 && <Empty title={somente ? 'Nenhum laudo ou encaminhamento.' : 'Nenhum anexo.'} />}
      <ul className="cartao divide-y divide-linha/70 overflow-hidden empty:hidden">
        {lista?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-bold">{a.file_name}</p>
              <p className="flex flex-wrap items-center gap-2 text-sm text-tinta-2">
                <Badge tone={PROTECTED.includes(a.category) ? 'anil' : 'neutro'}>{CATEGORY_LABEL[a.category]}</Badge>
                <span className="num">{formatBytes(a.size_bytes)}, {formatDateTime(a.created_at, tz)}</span>
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={async () => {
                try { saveBlob(await api.downloadAttachment(a), a.file_name); } catch (e) { toast(errorMessage(e), 'erro'); }
              }}>Baixar</Button>
              {!PROTECTED.includes(a.category) && <Button size="sm" variant="ghost" onClick={() => remove(a)}>Excluir</Button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

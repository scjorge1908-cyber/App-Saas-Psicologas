import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { AgendaItem, RecordEntry, RecordKind } from '../../lib/types';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime, formatTime, todayIn, zonedParts } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { useProfile } from '../../auth/AuthProvider';
import { Badge, Button, Dialog, Empty, ErrorBox, Field, Input, Loading, Notice, Select, TextField, Textarea, useToast } from '../ui';
import { IconLock } from '../icons';
import { isDemo } from '../../lib/demo/modo';

export const KIND_LABEL: Record<RecordKind, string> = {
  identificacao_demanda: 'Avaliação da demanda',
  objetivos: 'Objetivos do trabalho',
  evolucao: 'Evolução',
  procedimento: 'Procedimento',
  encaminhamento: 'Encaminhamento',
  encerramento: 'Encerramento',
  observacao: 'Observação',
};

export function RecordTab({ patientId, sessionId, sessions }: { patientId: string; sessionId?: string | null; sessions: AgendaItem[] }) {
  const { tz } = useProfile();
  const q = useQuery({ queryKey: ['records', patientId], queryFn: () => api.listRecords(patientId) });
  const [editing, setEditing] = useState<Partial<RecordEntry> | null>(null);
  const [history, setHistory] = useState<RecordEntry | null>(null);

  // Registra acesso ao prontuário (auditoria sem conteúdo)
  useEffect(() => { if (!isDemo()) void supabase.rpc('log_event', { p_action: 'VISUALIZAR_PRONTUARIO', p_table: 'record_entries' }); }, [patientId]);

  // Vindo de "Registrar no prontuário" a partir de uma sessão
  useEffect(() => {
    if (!sessionId) return;
    const s = sessions.find((x) => x.id === sessionId);
    if (s) setEditing({ patient_id: patientId, appointment_id: s.id, kind: 'evolucao', entry_date: zonedParts(s.starts_at, tz).date });
  }, [sessionId, sessions, patientId, tz]);

  const kinds = new Set((q.data ?? []).map((r) => r.kind));
  const missing = (['identificacao_demanda', 'objetivos'] as RecordKind[]).filter((k) => !kinds.has(k));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-tinta-2"><IconLock width={18} height={18} /> Acesso restrito a você. Registros não podem ser apagados; correções ficam no histórico.</p>
        <Button onClick={() => setEditing({ patient_id: patientId, kind: 'evolucao', entry_date: todayIn(tz) })}>Novo registro</Button>
      </div>
      {q.data && q.data.length > 0 && missing.length > 0 && (
        <Notice tone="ocre">Ainda falta registrar: {missing.map((k) => KIND_LABEL[k].toLowerCase()).join(' e ')} (conteúdo mínimo do registro documental, Res. CFP 001/2009).</Notice>
      )}
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox>{errorMessage(q.error)}</ErrorBox>}
      {q.data?.length === 0 && (
        <Empty title="Prontuário sem registros." action={<Button variant="secondary" onClick={() => setEditing({ patient_id: patientId, kind: 'identificacao_demanda', entry_date: todayIn(tz) })}>Registrar avaliação da demanda</Button>}>
          Comece pela avaliação da demanda e pelos objetivos do trabalho; depois registre a evolução a cada sessão.
        </Empty>
      )}
      <ol className="flex flex-col gap-3">
        {q.data?.map((r) => (
          <li key={r.id} className="rounded-lg border border-linha bg-papel p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="num font-bold">{formatDate(r.entry_date)}</span>
              <Badge tone="anil">{KIND_LABEL[r.kind]}</Badge>
              {r.title && <span className="font-bold">{r.title}</span>}
              {r.version > 1 && <button className="text-sm text-tinta-3 underline" onClick={() => setHistory(r)}>retificado ({r.version - 1}x)</button>}
            </div>
            <p className="whitespace-pre-wrap leading-relaxed">{r.content}</p>
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>Retificar</Button>
            </div>
          </li>
        ))}
      </ol>
      <RecordEditor entry={editing} sessions={sessions} onClose={() => setEditing(null)} />
      <HistoryDialog entry={history} onClose={() => setHistory(null)} />
    </div>
  );
}

function RecordEditor({ entry, sessions, onClose }: { entry: Partial<RecordEntry> | null; sessions: AgendaItem[]; onClose: () => void }) {
  const { tz } = useProfile();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<RecordKind>('evolucao');
  const [date, setDate] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [appt, setAppt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    setKind(entry.kind ?? 'evolucao'); setDate(entry.entry_date ?? todayIn(tz)); setTitle(entry.title ?? '');
    setContent(entry.content ?? ''); setAppt(entry.appointment_id ?? ''); setError(null);
  }, [entry, tz]);

  if (!entry) return null;
  const isEdit = !!entry.id;
  const pastSessions = sessions.filter((s) => s.status === 'atendido' || new Date(s.starts_at).getTime() < Date.now()).slice(0, 30);

  async function save() {
    if (!content.trim()) return setError('Escreva o registro.');
    setBusy(true); setError(null);
    try {
      await api.saveRecord({ id: entry!.id, patient_id: entry!.patient_id!, kind, entry_date: date, title: title.trim() || null, content, appointment_id: isEdit ? undefined : appt || null });
      await qc.invalidateQueries({ queryKey: ['records', entry!.patient_id] });
      toast(isEdit ? 'Registro retificado' : 'Registro salvo');
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onClose={onClose} wide title={isEdit ? 'Retificar registro' : 'Novo registro no prontuário'} footer={<>
      <Button variant="secondary" onClick={onClose}>Voltar</Button>
      <Button busy={busy} onClick={save}>{isEdit ? 'Salvar retificação' : 'Salvar registro'}</Button>
    </>}>
      <div className="flex flex-col gap-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        {isEdit && <Notice>A versão atual será preservada no histórico do registro.</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo de registro">{(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as RecordKind)}>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}</Field>
          <Field label="Data">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        {!isEdit && pastSessions.length > 0 && (
          <Field label="Sessão relacionada (opcional)">{(id) => (
            <Select id={id} value={appt} onChange={(e) => setAppt(e.target.value)}>
              <option value="">Nenhuma</option>
              {pastSessions.map((s) => <option key={s.id} value={s.id}>{formatDate(zonedParts(s.starts_at, tz).date)} às {formatTime(s.starts_at, tz)}</option>)}
            </Select>
          )}</Field>
        )}
        <TextField label="Título (opcional)" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Field label="Registro" required hint="Registre apenas o necessário ao trabalho (Código de Ética, art. 12).">
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={12} maxLength={50000} value={content} onChange={(e) => setContent(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}

function HistoryDialog({ entry, onClose }: { entry: RecordEntry | null; onClose: () => void }) {
  const { tz } = useProfile();
  const q = useQuery({ queryKey: ['record-versions', entry?.id], queryFn: () => api.listRecordVersions(entry!.id), enabled: !!entry });
  if (!entry) return null;
  return (
    <Dialog open onClose={onClose} wide title="Histórico de retificações">
      {q.isLoading && <Loading />}
      <ol className="flex flex-col gap-3">
        {q.data?.map((v) => (
          <li key={v.id} className="rounded-lg border border-linha p-3">
            <p className="mb-1 text-sm text-tinta-3">Versão {v.version}, substituída em {formatDateTime(v.replaced_at, tz)}</p>
            <p className="whitespace-pre-wrap">{v.content}</p>
          </li>
        ))}
      </ol>
    </Dialog>
  );
}

// Prontuário do paciente (layout Stitch, adaptado às regras do CFP):
// abas Evoluções | Avaliação e plano | Laudos; cards de evolução com resumo, técnicas, tarefas e anotações pessoais ocultas;
// "Nova evolução" estruturada (humor, queixa, intervenções, tarefas, anotações pessoais). Registros não são apagados:
// correções viram retificações com histórico (Res. CFP 001/2009).
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { AgendaItem, Patient, RecordEntry, RecordKind } from '../../lib/types';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime, formatLongDate, formatTime, minutesBetween, todayIn, zonedParts } from '../../lib/format';
import { ABORDAGENS, EVOLUCAO_VAZIA, HUMORES, lerEvolucao, montarEvolucao, type Evolucao } from '../../lib/prontuario';
import { supabase } from '../../lib/supabase';
import { useProfile } from '../../auth/AuthProvider';
import { Badge, Button, Dialog, Empty, ErrorBox, Field, Input, Loading, Notice, Select, TextField, Textarea, cx, useToast } from '../ui';
import { IconCheck, IconDoc, IconEye, IconEyeOff, IconLock, IconPlus, IconVideo, IconDoor } from '../icons';
import { isDemo } from '../../lib/demo/modo';
import { AttachmentsTab, CATEGORIAS_PRONTUARIO } from './AttachmentsTab';

export const KIND_LABEL: Record<RecordKind, string> = {
  identificacao_demanda: 'Avaliação da demanda',
  objetivos: 'Objetivos do trabalho',
  evolucao: 'Evolução',
  procedimento: 'Procedimento',
  encaminhamento: 'Encaminhamento',
  encerramento: 'Encerramento',
  observacao: 'Observação',
};

type Aba = 'evolucoes' | 'avaliacao' | 'laudos';

export function RecordTab({ patientId, sessionId, sessions, patient }: { patientId: string; sessionId?: string | null; sessions: AgendaItem[]; patient?: Patient }) {
  const { tz } = useProfile();
  const q = useQuery({ queryKey: ['records', patientId], queryFn: () => api.listRecords(patientId) });
  const [aba, setAba] = useState<Aba>('evolucoes');
  const [editing, setEditing] = useState<Partial<RecordEntry> | null>(null);
  const [evoluindo, setEvoluindo] = useState<{ entry?: RecordEntry; sessao?: AgendaItem } | null>(null);
  const [history, setHistory] = useState<RecordEntry | null>(null);

  // Registra acesso ao prontuário (auditoria sem conteúdo)
  useEffect(() => { if (!isDemo()) void supabase.rpc('log_event', { p_action: 'VISUALIZAR_PRONTUARIO', p_table: 'record_entries' }); }, [patientId]);

  // Vindo de "Registrar no prontuário"/"Evoluir sessão" a partir de uma sessão
  useEffect(() => {
    if (!sessionId) return;
    const s = sessions.find((x) => x.id === sessionId);
    if (s) setEvoluindo({ sessao: s });
  }, [sessionId, sessions]);

  // Número da sessão: ordem entre as sessões atendidas
  const numeroSessao = useMemo(() => {
    const m = new Map<string, number>();
    sessions.filter((s) => s.status === 'atendido').sort((a, b) => a.starts_at.localeCompare(b.starts_at)).forEach((s, i) => m.set(s.id, i + 1));
    return m;
  }, [sessions]);

  const registros = q.data ?? [];
  const evolucoes = registros.filter((r) => r.kind === 'evolucao');
  const outros = registros.filter((r) => r.kind !== 'evolucao');
  const kinds = new Set(registros.map((r) => r.kind));
  const faltando = (['identificacao_demanda', 'objetivos'] as RecordKind[]).filter((k) => !kinds.has(k));
  const comRegistro = new Set(registros.map((r) => r.appointment_id).filter(Boolean));
  const pendentes = sessions.filter((s) => s.status === 'atendido' && !comRegistro.has(s.id)).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const proximaSerie = sessions.find((s) => s.series_frequency);

  return (
    <div className="flex flex-col gap-4">
      {/* Contato e frequência */}
      {patient && (
        <div className="grid grid-cols-2 gap-3">
          <div className="cartao p-3">
            <p className="rotulo">Contato de emergência</p>
            <p className="truncate font-bold">{patient.emergency_contact_name || patient.guardian_name || '—'}</p>
            <p className="num truncate text-sm text-tinta-2">{patient.emergency_contact_phone || patient.guardian_phone || ''}</p>
          </div>
          <div className="cartao p-3">
            <p className="rotulo">Frequência</p>
            <p className="truncate font-bold">{proximaSerie?.series_frequency ? { semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal' }[proximaSerie.series_frequency] : 'Avulsa'}</p>
            <p className="text-sm text-tinta-2">{numeroSessao.size} {numeroSessao.size === 1 ? 'sessão atendida' : 'sessões atendidas'}</p>
          </div>
        </div>
      )}

      <p className="flex items-center gap-2 rounded-campo bg-anil-claro/50 px-3 py-2 text-sm text-sobre-anil-claro">
        <IconLock className="size-4 shrink-0" /> Prontuário individual e sigiloso: só você acessa, cada abertura fica registrada e nada é apagado (correções ficam no histórico).
      </p>

      <div role="tablist" aria-label="Prontuário" className="flex gap-1 overflow-x-auto border-b border-linha">
        {([['evolucoes', `Evoluções (${evolucoes.length})`], ['avaliacao', 'Avaliação e plano'], ['laudos', 'Laudos e encaminhamentos']] as Array<[Aba, string]>).map(([v, r]) => (
          <button key={v} role="tab" aria-selected={aba === v} onClick={() => setAba(v)}
            className={cx('shrink-0 border-b-[3px] px-3 py-2.5 font-bold', aba === v ? 'border-anil text-anil-escuro' : 'border-transparent text-tinta-3')}>{r}</button>
        ))}
      </div>

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox>{errorMessage(q.error)}</ErrorBox>}

      {aba === 'evolucoes' && (
        <>
          {pendentes.length > 0 && (
            <div className="flex flex-col gap-2 rounded-cartao border border-ocre-forte/30 bg-ocre-fundo p-3">
              <p className="font-bold text-ocre">{pendentes.length} {pendentes.length === 1 ? 'sessão atendida sem evolução' : 'sessões atendidas sem evolução'}</p>
              {pendentes.slice(0, 3).map((s) => (
                <button key={s.id} onClick={() => setEvoluindo({ sessao: s })} className="flex items-center justify-between gap-2 rounded-campo bg-papel px-3 py-2 text-left">
                  <span className="num text-[0.9375rem]">Sessão #{numeroSessao.get(s.id)} · {formatDate(zonedParts(s.starts_at, tz).date)} às {formatTime(s.starts_at, tz)}</span>
                  <span className="text-sm font-bold text-anil-escuro">Evoluir</span>
                </button>
              ))}
            </div>
          )}
          {q.data && evolucoes.length === 0 && <Empty title="Nenhuma evolução registrada.">Registre a evolução a cada sessão atendida.</Empty>}
          <ol className="flex flex-col gap-3">
            {evolucoes.map((r) => (
              <li key={r.id}><CardEvolucao r={r} sessao={sessions.find((s) => s.id === r.appointment_id)} numero={r.appointment_id ? numeroSessao.get(r.appointment_id) : undefined}
                onRetificar={() => (lerEvolucao(r.content) ? setEvoluindo({ entry: r, sessao: sessions.find((s) => s.id === r.appointment_id) }) : setEditing(r))}
                onHistorico={() => setHistory(r)} /></li>
            ))}
          </ol>
          <button onClick={() => setEvoluindo({})} className="btn-degrade pressionar sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 inline-flex min-h-14 items-center justify-center gap-2 rounded-cartao font-bold shadow-flutuante lg:bottom-4">
            <IconPlus /> Adicionar evolução{patient ? ` de ${(patient.social_name || patient.full_name).split(' ')[0]}` : ''}
          </button>
        </>
      )}

      {aba === 'avaliacao' && (
        <>
          {faltando.length > 0 && (
            <Notice tone="ocre">Ainda falta registrar: {faltando.map((k) => KIND_LABEL[k].toLowerCase()).join(' e ')} (conteúdo mínimo do registro documental, Res. CFP 001/2009).</Notice>
          )}
          <div className="flex flex-wrap gap-2">
            {(['identificacao_demanda', 'objetivos', 'encaminhamento', 'encerramento', 'observacao'] as RecordKind[]).map((k) => (
              <Button key={k} size="sm" variant="secondary" onClick={() => setEditing({ patient_id: patientId, kind: k, entry_date: todayIn(tz) })}><IconPlus className="size-4" /> {KIND_LABEL[k]}</Button>
            ))}
          </div>
          {q.data && outros.length === 0 && <Empty title="Sem avaliação registrada.">Comece pela avaliação da demanda (anamnese) e pelos objetivos do trabalho.</Empty>}
          <ol className="flex flex-col gap-3">
            {outros.map((r) => (
              <li key={r.id} className="cartao p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone="anil">{KIND_LABEL[r.kind]}</Badge>
                  <span className="num text-sm text-tinta-2">{formatDate(r.entry_date)}</span>
                  {r.title && <span className="font-bold">{r.title}</span>}
                </div>
                <p className="whitespace-pre-wrap leading-relaxed">{r.content}</p>
                <div className="mt-3 flex items-center justify-between">
                  {r.version > 1 ? <button className="text-sm text-tinta-3 underline" onClick={() => setHistory(r)}>retificado ({r.version - 1}x)</button> : <span />}
                  <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>Retificar</Button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      {aba === 'laudos' && <AttachmentsTab patientId={patientId} somente={CATEGORIAS_PRONTUARIO} />}

      <RecordEditor entry={editing} sessions={sessions} onClose={() => setEditing(null)} />
      <EvolucaoEditor aberto={evoluindo} patientId={patientId} patient={patient} sessions={sessions} numeroSessao={numeroSessao} onClose={() => setEvoluindo(null)} />
      <HistoryDialog entry={history} onClose={() => setHistory(null)} />
    </div>
  );
}

/** Card de uma evolução: sessão, data, formato, resumo clínico, técnicas, tarefas e anotações pessoais (ocultas). */
function CardEvolucao({ r, sessao, numero, onRetificar, onHistorico }: {
  r: RecordEntry; sessao?: AgendaItem; numero?: number; onRetificar: () => void; onHistorico: () => void;
}) {
  const [verNotas, setVerNotas] = useState(false);
  const e = lerEvolucao(r.content);
  const formato = e?.formato ?? sessao?.modality ?? null;
  const dur = sessao ? minutesBetween(sessao.starts_at, sessao.ends_at) : null;
  return (
    <article className="cartao p-4">
      <header className="flex flex-wrap items-center gap-2">
        {numero && <span className="num rounded-campo bg-anil-escuro px-2 py-1 text-[0.75rem] font-extrabold text-sobre-anil">Sessão #{numero}</span>}
        <span className="text-[1.0625rem] font-bold first-letter:uppercase">{formatLongDate(r.entry_date, true).split(', ')[1]}</span>
        {formato && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-afundado px-2.5 py-1 text-[0.75rem] font-bold text-tinta-2">
            {formato === 'online' ? <IconVideo className="size-4" /> : <IconDoor className="size-4" />}
            {formato === 'online' ? 'On-line' : 'Presencial'}{dur ? ` (${dur} min)` : ''}
          </span>
        )}
      </header>

      {e ? (
        <div className="mt-3 flex flex-col gap-3">
          {e.humor.length > 0 && <p className="text-sm text-tinta-2"><b>Humor inicial:</b> {e.humor.join(', ')}</p>}
          <div className="rounded-campo bg-afundado p-3">
            <p className="mb-1 inline-flex items-center gap-1.5 font-bold text-anil-escuro"><IconDoc className="size-4" /> Resumo clínico da sessão</p>
            <p className="whitespace-pre-wrap leading-relaxed">{e.queixa || '—'}</p>
            {e.intervencoes && <p className="mt-2 whitespace-pre-wrap leading-relaxed text-tinta-2">{e.intervencoes}</p>}
          </div>
          {e.abordagens.length > 0 && (
            <div>
              <p className="rotulo mb-1.5">Técnicas e abordagem</p>
              <div className="flex flex-wrap gap-1.5">{e.abordagens.map((a) => <span key={a} className="rounded-campo bg-afundado px-2.5 py-1 text-[0.8125rem] font-bold">{a}</span>)}</div>
            </div>
          )}
          {e.tarefas.length > 0 && (
            <div className="rounded-campo border border-livre/30 bg-livre-fundo p-3">
              <p className="mb-1 inline-flex items-center gap-1.5 font-bold text-livre"><IconCheck className="size-4" /> Tarefas inter-sessão</p>
              <ul className="list-inside list-disc text-[0.9375rem]">{e.tarefas.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 whitespace-pre-wrap leading-relaxed">{r.content}</p>
      )}

      {r.private_notes && (
        <div className="mt-3 rounded-campo border border-linha p-3">
          <button onClick={() => setVerNotas((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left text-sm font-bold text-anil-escuro" aria-expanded={verNotas}>
            <span className="inline-flex items-center gap-1.5"><IconLock className="size-4" /> Anotações pessoais (sigilosas)</span>
            {verNotas ? <IconEyeOff className="size-5" /> : <IconEye className="size-5" />}
          </button>
          {verNotas && <p className="mt-2 whitespace-pre-wrap text-[0.9375rem]">{r.private_notes}</p>}
        </div>
      )}

      <footer className="mt-3 flex items-center justify-between">
        {r.version > 1 ? <button className="text-sm text-tinta-3 underline" onClick={onHistorico}>retificado ({r.version - 1}x)</button> : <span />}
        <Button variant="ghost" size="sm" onClick={onRetificar}>Retificar</Button>
      </footer>
    </article>
  );
}

const RASCUNHO = (patientId: string, sessaoId?: string) => `psi.rascunho-evolucao.${patientId}.${sessaoId ?? 'avulsa'}`;

/** Nova evolução estruturada (ou retificação de uma evolução estruturada). */
function EvolucaoEditor({ aberto, patientId, patient, sessions, numeroSessao, onClose }: {
  aberto: { entry?: RecordEntry; sessao?: AgendaItem } | null; patientId: string; patient?: Patient; sessions: AgendaItem[];
  numeroSessao: Map<string, number>; onClose: () => void;
}) {
  const { profile, tz } = useProfile();
  const qc = useQueryClient();
  const toast = useToast();
  const [ev, setEv] = useState<Evolucao>(EVOLUCAO_VAZIA);
  const [notas, setNotas] = useState('');
  const [data, setData] = useState('');
  const [sessaoId, setSessaoId] = useState('');
  const [novaTarefa, setNovaTarefa] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    const s = aberto.sessao;
    setErro(null); setNovaTarefa('');
    if (aberto.entry) {
      setEv(lerEvolucao(aberto.entry.content) ?? EVOLUCAO_VAZIA); setNotas(aberto.entry.private_notes ?? '');
      setData(aberto.entry.entry_date); setSessaoId(aberto.entry.appointment_id ?? '');
      return;
    }
    let rasc: { ev: Evolucao; notas: string } | null = null;
    try { const t = localStorage.getItem(RASCUNHO(patientId, s?.id)); rasc = t ? JSON.parse(t) : null; } catch { rasc = null; }
    setEv(rasc?.ev ?? { ...EVOLUCAO_VAZIA, formato: s?.modality ?? patient?.modality ?? 'presencial', humor: [], abordagens: [], tarefas: [] });
    setNotas(rasc?.notas ?? '');
    setData(s ? zonedParts(s.starts_at, tz).date : todayIn(tz));
    setSessaoId(s?.id ?? '');
  }, [aberto, patientId, patient, tz]);

  if (!aberto) return null;
  const isEdit = !!aberto.entry;
  const sessao = sessions.find((s) => s.id === sessaoId);
  const atendidas = sessions.filter((s) => s.status === 'atendido' || new Date(s.starts_at).getTime() < Date.now()).slice(0, 30);
  const alterna = (lista: string[], v: string) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  function guardarRascunho() {
    try { localStorage.setItem(RASCUNHO(patientId, sessaoId || undefined), JSON.stringify({ ev, notas })); toast('Rascunho guardado neste aparelho'); onClose(); }
    catch { toast('Não foi possível guardar o rascunho neste aparelho.', 'erro'); }
  }

  async function salvar() {
    if (!ev.queixa.trim()) return setErro('Escreva a queixa ou o tema central da sessão.');
    setBusy(true); setErro(null);
    try {
      await api.saveRecord({
        id: aberto!.entry?.id, patient_id: patientId, kind: 'evolucao', entry_date: data, title: aberto!.entry?.title ?? 'Sessão',
        content: montarEvolucao({ ...ev, tarefas: novaTarefa.trim() ? [...ev.tarefas, novaTarefa.trim()] : ev.tarefas }),
        private_notes: notas.trim() || null, appointment_id: isEdit ? undefined : sessaoId || null,
      });
      try { localStorage.removeItem(RASCUNHO(patientId, sessaoId || undefined)); } catch { /* sem armazenamento */ }
      await qc.invalidateQueries({ queryKey: ['records', patientId] });
      await qc.invalidateQueries({ queryKey: ['prontuarios'] });
      toast(isEdit ? 'Evolução retificada' : 'Evolução salva');
      onClose();
    } catch (e) { setErro(errorMessage(e)); } finally { setBusy(false); }
  }

  const nome = patient ? patient.social_name || patient.full_name : '';
  return (
    <Dialog open onClose={onClose} wide title={isEdit ? 'Retificar evolução' : 'Nova evolução'} footer={<>
      {!isEdit && <Button variant="secondary" onClick={guardarRascunho}>Rascunho</Button>}
      <Button busy={busy} onClick={salvar}><IconLock className="size-4" /> {isEdit ? 'Salvar retificação' : 'Salvar evolução'}</Button>
    </>}>
      <div className="flex flex-col gap-4">
        {erro && <ErrorBox>{erro}</ErrorBox>}
        <p className="flex items-center gap-2 rounded-campo bg-afundado px-3 py-2 text-sm text-tinta-2"><IconLock className="size-4 shrink-0" /> Prontuário psicológico individual e sigiloso (Res. CFP 001/2009).{isEdit && ' A versão atual fica guardada no histórico.'}</p>

        {/* Paciente e sessão */}
        <section className="cartao flex flex-col gap-3 p-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="relative grid size-12 shrink-0 place-items-center rounded-full bg-anil-claro font-bold text-sobre-anil-claro">
              {nome.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()}
              {sessao && numeroSessao.get(sessao.id) && <span className="num absolute -bottom-1 -right-1 rounded-full bg-anil-escuro px-1.5 text-[0.75rem] font-extrabold text-sobre-anil">#{numeroSessao.get(sessao.id)}</span>}
            </span>
            <div className="min-w-0">
              <p className="truncate font-bold">{nome}</p>
              <p className="num text-sm text-tinta-2">{sessao ? `${formatDate(zonedParts(sessao.starts_at, tz).date)} · ${formatTime(sessao.starts_at, tz)} – ${formatTime(sessao.ends_at, tz)} (${minutesBetween(sessao.starts_at, sessao.ends_at)} min)` : formatDate(data)}</p>
            </div>
          </div>
          {!isEdit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Sessão">{(id) => (
                <Select id={id} value={sessaoId} onChange={(e) => { setSessaoId(e.target.value); const s = sessions.find((x) => x.id === e.target.value); if (s) { setData(zonedParts(s.starts_at, tz).date); setEv((v) => ({ ...v, formato: s.modality })); } }}>
                  <option value="">Sem sessão vinculada</option>
                  {atendidas.map((s) => <option key={s.id} value={s.id}>{numeroSessao.get(s.id) ? `#${numeroSessao.get(s.id)} · ` : ''}{formatDate(zonedParts(s.starts_at, tz).date)} às {formatTime(s.starts_at, tz)}</option>)}
                </Select>
              )}</Field>
              <Field label="Data">{(id) => <Input id={id} type="date" value={data} onChange={(e) => setData(e.target.value)} />}</Field>
            </div>
          )}
          <div>
            <p className="rotulo mb-1.5">Formato do atendimento</p>
            <div className="grid grid-cols-2 gap-2">
              {([['presencial', 'Presencial', IconDoor], ['online', 'On-line', IconVideo]] as const).map(([v, r, I]) => (
                <button key={v} type="button" aria-pressed={ev.formato === v} onClick={() => setEv({ ...ev, formato: v })}
                  className={cx('inline-flex min-h-12 items-center justify-center gap-2 rounded-campo border font-bold', ev.formato === v ? 'btn-degrade border-transparent' : 'border-linha bg-papel text-tinta-2')}><I className="size-5" /> {r}</button>
              ))}
            </div>
          </div>
        </section>

        {/* Humor */}
        <section className="cartao p-3">
          <div className="mb-2 flex items-baseline justify-between"><p className="font-bold">Estado geral e humor inicial</p><span className="text-[0.75rem] text-tinta-3">um ou mais</span></div>
          <div className="flex flex-wrap gap-2">
            {HUMORES.map((h) => (
              <button key={h} type="button" aria-pressed={ev.humor.includes(h)} onClick={() => setEv({ ...ev, humor: alterna(ev.humor, h) })}
                className={cx('inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-bold', ev.humor.includes(h) ? 'border-transparent bg-anil-claro text-sobre-anil-claro' : 'border-linha text-tinta-2')}>
                <span className={cx('size-1.5 rounded-full', ev.humor.includes(h) ? 'bg-current' : 'bg-linha-forte')} />{h}
              </button>
            ))}
          </div>
        </section>

        {/* 1. Queixa */}
        <section className="cartao p-3">
          <p className="font-bold">1. Queixa / tema central da sessão</p>
          <p className="mb-2 text-sm text-tinta-2">Síntese do que o paciente trouxe. Registre apenas o necessário (Código de Ética, art. 12).</p>
          <Textarea rows={5} maxLength={20000} value={ev.queixa} onChange={(e) => setEv({ ...ev, queixa: e.target.value })} aria-label="Queixa / tema central" />
          <p className="mt-1 text-right text-[0.75rem] text-tinta-3">{ev.queixa.length} caracteres</p>
        </section>

        {/* 2. Intervenções */}
        <section className="cartao p-3">
          <p className="font-bold">2. Intervenções e abordagem</p>
          <div className="my-2 flex flex-wrap gap-2">
            {ABORDAGENS.map((a) => (
              <button key={a} type="button" aria-pressed={ev.abordagens.includes(a)} onClick={() => setEv({ ...ev, abordagens: alterna(ev.abordagens, a) })}
                className={cx('min-h-11 rounded-campo border px-3 text-sm font-bold', ev.abordagens.includes(a) ? 'btn-degrade border-transparent' : 'border-linha text-tinta-2')}>{a}</button>
            ))}
          </div>
          <Textarea rows={4} maxLength={20000} value={ev.intervencoes} onChange={(e) => setEv({ ...ev, intervencoes: e.target.value })} aria-label="Intervenções realizadas" placeholder="Técnicas e recursos usados na sessão" />
        </section>

        {/* 3. Tarefas */}
        <section className="cartao p-3">
          <p className="font-bold">3. Tarefas / plano inter-sessão</p>
          <p className="mb-2 text-sm text-tinta-2">Atividades combinadas com o paciente até a próxima sessão.</p>
          <ul className="mb-2 flex flex-col gap-2">
            {ev.tarefas.map((t, i) => (
              <li key={i} className="flex items-center gap-2 rounded-campo bg-afundado px-3 py-2">
                <IconCheck className="size-4 shrink-0 text-livre" />
                <span className="flex-1 text-[0.9375rem]">{t}</span>
                <button type="button" onClick={() => setEv({ ...ev, tarefas: ev.tarefas.filter((_, j) => j !== i) })} className="min-h-11 px-2 text-sm font-bold text-tinta-3" aria-label={`Remover tarefa ${t}`}>Remover</button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input value={novaTarefa} maxLength={300} onChange={(e) => setNovaTarefa(e.target.value)} placeholder="Nova tarefa" aria-label="Nova tarefa"
              onKeyDown={(e) => { if (e.key === 'Enter' && novaTarefa.trim()) { e.preventDefault(); setEv({ ...ev, tarefas: [...ev.tarefas, novaTarefa.trim()] }); setNovaTarefa(''); } }} />
            <Button type="button" variant="secondary" onClick={() => { if (novaTarefa.trim()) { setEv({ ...ev, tarefas: [...ev.tarefas, novaTarefa.trim()] }); setNovaTarefa(''); } }}><IconPlus className="size-4" /></Button>
          </div>
        </section>

        {/* 4. Anotações pessoais */}
        <section className="rounded-cartao border border-linha bg-afundado p-3">
          <p className="inline-flex items-center gap-1.5 font-bold"><IconLock className="size-4" /> 4. Anotações pessoais</p>
          <p className="mb-2 text-sm text-tinta-2">Uso restrito seu. Ficam separadas do registro e não entram em declarações, laudos ou relatórios.</p>
          <Textarea rows={3} maxLength={20000} value={notas} onChange={(e) => setNotas(e.target.value)} aria-label="Anotações pessoais" />
        </section>

        {profile && (
          <p className="flex items-center gap-2 text-sm text-tinta-2"><IconDoc className="size-4" /> {profile.full_name}{profile.crp ? ` · CRP ${profile.crp}` : ''}</p>
        )}
      </div>
    </Dialog>
  );
}

/** Editor simples para os demais registros (avaliação, objetivos, encaminhamento, encerramento, observação) e evoluções antigas em texto livre. */
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
      await api.saveRecord({ id: entry!.id, patient_id: entry!.patient_id!, kind, entry_date: date, title: title.trim() || null, content, private_notes: entry!.private_notes, appointment_id: isEdit ? undefined : appt || null });
      await qc.invalidateQueries({ queryKey: ['records', entry!.patient_id] });
      await qc.invalidateQueries({ queryKey: ['prontuarios'] });
      toast(isEdit ? 'Registro retificado' : 'Registro salvo');
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onClose={onClose} wide title={isEdit ? 'Retificar registro' : KIND_LABEL[kind]} footer={<>
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
          <li key={v.id} className="rounded-campo border border-linha p-3">
            <p className="mb-1 text-sm text-tinta-3">Versão {v.version}, substituída em {formatDateTime(v.replaced_at, tz)}</p>
            <p className="whitespace-pre-wrap">{v.content}</p>
            {v.private_notes && <p className="mt-2 whitespace-pre-wrap text-sm text-tinta-2"><b>Anotações pessoais:</b> {v.private_notes}</p>}
          </li>
        ))}
      </ol>
    </Dialog>
  );
}

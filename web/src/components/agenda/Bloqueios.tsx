// Bloqueio de agenda (pedido do Jorge, 27/10/2026), na tela Grade: férias, feriados, folgas.
// Nos dias/horários bloqueados a agenda não mostra horários livres e não deixa marcar sessão nova.
// Sessões já marcadas no período não são apagadas: o app avisa para mover ou cancelar.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BlockKind, ScheduleBlock } from '../../lib/types';
import * as api from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { addDays, formatDate, todayIn, zonedToUtc } from '../../lib/format';
import { TIPO_BLOQUEIO, feriadosNacionais, textoBloqueio } from '../../lib/bloqueios';
import { useProfile } from '../../auth/AuthProvider';
import { Button, Dialog, ErrorBox, Field, Input, Select, TextField, useConfirm, useToast } from '../ui';
import { IconLock, IconPlus } from '../icons';

type Form = { id?: string; kind: BlockKind; starts_on: string; ends_on: string; diaInteiro: boolean; start_time: string; end_time: string; reason: string };

export function BloqueiosSecao() {
  const { tz } = useProfile();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const hoje = todayIn(tz);
  const q = useQuery({ queryKey: ['blocks'], queryFn: api.listBlocks });
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const atuais = (q.data ?? []).filter((b) => b.ends_on >= hoje);
  const atualizar = () => Promise.all([qc.invalidateQueries({ queryKey: ['blocks'] }), qc.invalidateQueries({ queryKey: ['agenda'] })]);

  /** Quantas sessões ativas já caem no período (para avisar: mover ou cancelar). */
  async function sessoesNoPeriodo(f: Form): Promise<number> {
    const itens = await api.listAgenda(zonedToUtc(f.starts_on, '00:00', tz), zonedToUtc(addDays(f.ends_on, 1), '00:00', tz));
    return itens.filter((it) => (it.status === 'agendado' || it.status === 'confirmado')).filter((it) => {
      if (f.diaInteiro) return true;
      const h = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(it.starts_at));
      return h >= f.start_time && h < f.end_time;
    }).length;
  }

  async function salvar() {
    if (!form) return;
    setErro(null);
    if (!form.starts_on || !form.ends_on) return setErro('Informe o primeiro e o último dia.');
    if (form.ends_on < form.starts_on) return setErro('O último dia precisa ser igual ou depois do primeiro.');
    if (!form.diaInteiro && (!form.start_time || !form.end_time || form.end_time <= form.start_time)) return setErro('Informe o horário de início e de fim (o fim depois do início).');
    setBusy(true);
    try {
      await api.saveBlock({
        id: form.id, kind: form.kind, starts_on: form.starts_on, ends_on: form.ends_on,
        start_time: form.diaInteiro ? null : form.start_time, end_time: form.diaInteiro ? null : form.end_time,
        reason: form.reason.trim() || null,
      });
      const n = await sessoesNoPeriodo(form);
      await atualizar();
      toast(n ? `Bloqueio salvo. ${n === 1 ? '1 sessão já marcada' : `${n} sessões já marcadas`} nesse período: mova ou cancele na agenda.` : 'Bloqueio salvo');
      setForm(null);
    } catch (e) { setErro(errorMessage(e)); } finally { setBusy(false); }
  }

  async function excluir(b: ScheduleBlock) {
    if (!(await confirm({ title: 'Tirar este bloqueio?', body: `${textoBloqueio(b)}. Os horários voltam a ficar livres na agenda.`, confirmLabel: 'Tirar bloqueio' }))) return;
    try { await api.deleteBlock(b.id); await atualizar(); toast('Bloqueio retirado'); } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  async function adicionarFeriados(ano: number) {
    const existentes = new Set((q.data ?? []).filter((b) => b.kind === 'feriado').map((b) => b.starts_on));
    const novos = feriadosNacionais(ano).filter((f) => f.data >= hoje && !existentes.has(f.data));
    if (!novos.length) { toast(`Os feriados nacionais de ${ano} já estão na agenda.`); return; }
    setBusy(true);
    try {
      for (const f of novos) await api.saveBlock({ kind: 'feriado', starts_on: f.data, ends_on: f.data, start_time: null, end_time: null, reason: f.nome });
      await atualizar();
      toast(`${novos.length} ${novos.length === 1 ? 'feriado nacional adicionado' : 'feriados nacionais adicionados'} (${ano}).`);
    } catch (e) { toast(errorMessage(e), 'erro'); } finally { setBusy(false); }
  }

  const anoAtual = Number(hoje.slice(0, 4));
  const novo = (): Form => ({ kind: 'ferias', starts_on: hoje, ends_on: hoje, diaInteiro: true, start_time: '13:00', end_time: '18:00', reason: '' });
  const intervalo = (b: ScheduleBlock) => (b.starts_on === b.ends_on ? formatDate(b.starts_on) : `${formatDate(b.starts_on)} a ${formatDate(b.ends_on)}`);

  return (
    <section aria-labelledby="t-bloqueios" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="t-bloqueios" className="text-[1.125rem] font-bold">Bloqueios: férias, feriados e folgas</h2>
        <Button variant="ghost" size="sm" onClick={() => { setErro(null); setForm(novo()); }}><IconPlus /> Novo bloqueio</Button>
      </div>
      <p className="text-sm text-tinta-2">Nos dias bloqueados a agenda não mostra horários livres e não deixa marcar sessão nova.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" busy={busy} onClick={() => adicionarFeriados(anoAtual)}>Feriados nacionais de {anoAtual}</Button>
        <Button variant="secondary" size="sm" busy={busy} onClick={() => adicionarFeriados(anoAtual + 1)}>Feriados nacionais de {anoAtual + 1}</Button>
      </div>
      {q.error && <ErrorBox>{errorMessage(q.error)}</ErrorBox>}
      {atuais.length === 0 ? <p className="text-sm text-tinta-3">Nenhum bloqueio daqui para frente.</p> : (
        <ul className="flex flex-col gap-1.5" aria-label="Bloqueios">
          {atuais.map((b) => (
            <li key={b.id} className="cartao flex items-center gap-2 px-3 py-2">
              <IconLock className="size-4 shrink-0 text-tinta-3" />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setErro(null); setForm({ id: b.id, kind: b.kind, starts_on: b.starts_on, ends_on: b.ends_on, diaInteiro: !b.start_time, start_time: (b.start_time ?? '13:00').slice(0, 5), end_time: (b.end_time ?? '18:00').slice(0, 5), reason: b.reason ?? '' }); }}>
                <span className="num block font-bold">{intervalo(b)}</span>
                <span className="block truncate text-sm text-tinta-2">{textoBloqueio(b)}</span>
              </button>
              <Button variant="ghost" size="sm" onClick={() => excluir(b)}>Tirar</Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar bloqueio' : 'Novo bloqueio'} footer={<>
        <Button variant="secondary" onClick={() => setForm(null)}>Voltar</Button>
        <Button busy={busy} onClick={salvar}>Salvar bloqueio</Button>
      </>}>
        {form && (
          <div className="flex flex-col gap-3">
            {erro && <ErrorBox>{erro}</ErrorBox>}
            <Field label="Tipo">{(id) => (
              <Select id={id} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as BlockKind })}>
                {(Object.keys(TIPO_BLOQUEIO) as BlockKind[]).map((k) => <option key={k} value={k}>{k === 'outro' ? 'Outro' : TIPO_BLOQUEIO[k]}</option>)}
              </Select>
            )}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Primeiro dia">{(id) => <Input id={id} type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value, ends_on: form.ends_on < e.target.value ? e.target.value : form.ends_on })} />}</Field>
              <Field label="Último dia">{(id) => <Input id={id} type="date" value={form.ends_on} min={form.starts_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />}</Field>
            </div>
            <label className="flex items-center gap-3">
              <input type="checkbox" className="h-5 w-5 accent-anil" checked={form.diaInteiro} onChange={(e) => setForm({ ...form, diaInteiro: e.target.checked })} />
              Dia inteiro
            </label>
            {!form.diaInteiro && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Das">{(id) => <Input id={id} type="time" step={300} value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />}</Field>
                <Field label="Até">{(id) => <Input id={id} type="time" step={300} value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />}</Field>
              </div>
            )}
            <TextField label="Motivo (opcional)" maxLength={120} placeholder="Ex.: férias de janeiro, consulta médica" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
        )}
      </Dialog>
    </section>
  );
}

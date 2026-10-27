// "Horários": onde a psicóloga cadastra os locais em que atende e as faixas semanais de atendimento.
// A agenda usa isso para sugerir os horários livres. Aberta por um botão discreto na Agenda.
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { Location, Modality, WorkingHour } from '../lib/types';
import { DIAS_SEMANA, faixaTexto } from '../lib/horarios';
import { DURACOES, INTERVALOS, PERIODOS, gerarInicios, periodoDe, type PeriodoId } from '../lib/periodos';
import { useProfile } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import { Button, Dialog, ErrorBox, Loading, Select, TextField, cx, useConfirm, useToast } from '../components/ui';
import { IconChevronLeft, IconPlus } from '../components/icons';

const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]; // a semana de trabalho começa na segunda
const CORES = ['#146C70', '#0B6E8A', '#B3541E', '#2F7D5B', '#9C2F6B', '#5B6472'];

export function HorariosPage() {
  const qc = useQueryClient();
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations });
  const horas = useQuery({ queryKey: ['working-hours'], queryFn: api.listWorkingHours });
  const [editLocal, setEditLocal] = useState<Partial<Location> | null>(null);
  const [editHora, setEditHora] = useState<Partial<WorkingHour> | null>(null);
  const [params] = useSearchParams();
  const [criando, setCriando] = useState(params.get('novo') === '1');
  const { profile } = useProfile();
  const durPadrao = profile?.session_minutes ?? 50;
  const intPadrao = profile?.buffer_minutes ?? 10;
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ['locations'] });
    void qc.invalidateQueries({ queryKey: ['working-hours'] });
    void qc.invalidateQueries({ queryKey: ['agenda'] });
  };

  const erro = locais.error ?? horas.error;
  const lista = locais.data ?? [];
  const nomeLocal = (id: string) => lista.find((l) => l.id === id);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-2">
        <Link to="/" className="grid size-11 place-items-center rounded-xl text-tinta-2 hover:bg-cinza-fundo" aria-label="Voltar para a agenda"><IconChevronLeft /></Link>
        <div>
          <h1 className="titulo-display text-[26px] leading-tight">Meus horários</h1>
          <p className="text-[15px] text-tinta-2">Sala, dia e período em que você atende. A agenda mostra os horários disponíveis a partir daqui.</p>
        </div>
      </header>

      <Button className="self-start" onClick={() => setCriando(true)}><IconPlus /> Adicionar horários</Button>

      {erro && <ErrorBox>{errorMessage(erro)}</ErrorBox>}
      {(locais.isLoading || horas.isLoading) && <Loading />}

      {/* Locais */}
      <section aria-labelledby="t-locais" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id="t-locais" className="text-[13px] font-bold uppercase tracking-[.06em] text-tinta-3">Locais de atendimento</h2>
          <Button variant="ghost" size="sm" onClick={() => setEditLocal({ modality: 'presencial', color: CORES[lista.length % CORES.length] })}><IconPlus /> Local</Button>
        </div>
        {locais.data && lista.length === 0 && (
          <button type="button" onClick={() => setEditLocal({ modality: 'presencial', color: CORES[0] })}
            className="rounded-2xl border border-dashed border-linha-forte bg-papel px-4 py-5 text-left text-tinta-2 hover:border-anil">
            <strong className="block text-tinta">Comece cadastrando um local</strong>
            Ex.: "Sala 1 · Centro" ou "On-line".
          </button>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {lista.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => setEditLocal(l)}
                className={cx('flex w-full items-center gap-3 cartao pressionar px-4 py-3 text-left', !l.active && 'opacity-60')}>
                <span className="size-3 shrink-0 rounded-full" style={{ background: l.color ?? 'var(--color-anil)' }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate">{l.name}</strong>
                  <span className="text-sm text-tinta-3">{l.modality === 'online' ? 'On-line' : l.address || 'Presencial'}{!l.active && ' · desativado'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Semana: um card por bloco (sala + período) */}
      {lista.length > 0 && (
        <section aria-labelledby="t-semana" className="flex flex-col gap-3">
          <h2 id="t-semana" className="rotulo">Horários da semana</h2>
          {(horas.data ?? []).length === 0 && (
            <button type="button" onClick={() => setCriando(true)} className="cartao px-4 py-5 text-left text-tinta-2">
              <strong className="block text-tinta">Nenhum horário ainda</strong>
              Escolha os dias, o período (manhã, tarde ou noite) e a duração da sessão. O app monta os horários.
            </button>
          )}
          {ORDEM_DIAS.map((d) => {
            const doDia = (horas.data ?? []).filter((h) => h.weekday === d);
            if (doDia.length === 0) return null;
            return (
              <div key={d}>
                <h3 className="mb-1.5 font-bold">{DIAS_SEMANA[d]}</h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {doDia.map((h) => {
                    const l = nomeLocal(h.location_id);
                    const dur = h.session_minutes ?? durPadrao; const int = h.buffer_minutes ?? intPadrao;
                    const inicios = gerarInicios(h.start_time.slice(0, 5), h.end_time.slice(0, 5), dur, int);
                    return (
                      <li key={h.id}>
                        <button type="button" onClick={() => setEditHora(h)} className="cartao pressionar flex w-full flex-col gap-1 px-4 py-3 text-left">
                          <span className="flex items-center gap-2 font-bold">
                            <span className="size-2.5 rounded-full" style={{ background: l?.color ?? 'var(--color-anil)' }} aria-hidden />
                            {l?.name ?? 'Local'} · {periodoDe(h.start_time).nome}
                          </span>
                          <span className="num text-sm text-tinta-2">{faixaTexto(h)} · sessões de {dur} min{int ? ` + ${int} de intervalo` : ''}</span>
                          <span className="num text-sm text-tinta-3">{inicios.length} {inicios.length === 1 ? 'horário' : 'horários'}: {inicios.join(', ')}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </section>
      )}

      <LocalDialog local={editLocal} onClose={() => setEditLocal(null)} onSaved={atualizar} />
      <HoraDialog hora={editHora} locais={lista} durPadrao={durPadrao} intPadrao={intPadrao} onClose={() => setEditHora(null)} onSaved={atualizar} />
      <CriarHorariosDialog open={criando} locais={lista} durPadrao={durPadrao} intPadrao={intPadrao} onClose={() => setCriando(false)} onSaved={atualizar} />
    </div>
  );
}

function LocalDialog({ local, onClose, onSaved }: { local: Partial<Location> | null; onClose: () => void; onSaved: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<Partial<Location>>({});
  const [aberto, setAberto] = useState<Partial<Location> | null>(null);
  if (local !== aberto) { setAberto(local); setForm(local ?? {}); }

  const salvar = useMutation({
    mutationFn: () => api.saveLocation({ ...form, name: (form.name ?? '').trim() }),
    onSuccess: () => { onSaved(); toast('Local salvo'); onClose(); },
  });
  const excluir = useMutation({
    mutationFn: () => api.deleteLocation(form.id!),
    onSuccess: () => { onSaved(); toast('Local excluído'); onClose(); },
  });

  async function pedirExclusao() {
    const ok = await confirm({ title: 'Excluir este local?', confirmLabel: 'Excluir', danger: true,
      body: 'Os horários deste local saem da semana. As sessões já marcadas continuam na agenda, só sem o local.' });
    if (ok) excluir.mutate();
  }
  function enviar(e: FormEvent) { e.preventDefault(); salvar.mutate(); }

  return (
    <Dialog open={!!local} onClose={onClose} title={form.id ? 'Editar local' : 'Novo local'}
      footer={<>
        {form.id && <Button variant="ghost" className="mr-auto text-vermelho" onClick={pedirExclusao} busy={excluir.isPending}>Excluir</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="form-local" busy={salvar.isPending}>Salvar</Button>
      </>}>
      <form id="form-local" onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        {(salvar.error || excluir.error) && <ErrorBox>{errorMessage(salvar.error ?? excluir.error)}</ErrorBox>}
        <TextField label="Nome" required maxLength={80} placeholder="Sala 1 · Centro" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="flex gap-2" role="radiogroup" aria-label="Tipo de atendimento">
          {(['presencial', 'online'] as Modality[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={form.modality === m} onClick={() => setForm({ ...form, modality: m })}
              className={cx('min-h-11 flex-1 rounded-xl border px-3 font-bold', form.modality === m ? 'border-anil bg-anil-claro text-anil' : 'border-linha-forte text-tinta-2')}>
              {m === 'online' ? 'On-line' : 'Presencial'}
            </button>
          ))}
        </div>
        {form.modality !== 'online' && (
          <TextField label="Endereço (opcional)" maxLength={300} value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value || null })} />
        )}
        <fieldset>
          <legend className="mb-2 text-sm font-bold text-tinta-2">Cor na agenda</legend>
          <div className="flex gap-2">
            {CORES.map((c) => (
              <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} aria-label={`Cor ${c}`} aria-pressed={form.color === c}
                className={cx('size-10 rounded-full border-2', form.color === c ? 'border-tinta' : 'border-transparent')} style={{ background: c }} />
            ))}
          </div>
        </fieldset>
        {form.id && (
          <label className="flex items-center gap-3 text-[15px]">
            <input type="checkbox" className="size-5 accent-anil" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Local em uso (desmarque para pausar sem excluir)
          </label>
        )}
      </form>
    </Dialog>
  );
}

function HoraDialog({ hora, locais, durPadrao, intPadrao, onClose, onSaved }: { hora: Partial<WorkingHour> | null; locais: Location[]; durPadrao: number; intPadrao: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Partial<WorkingHour>>({});
  const [aberto, setAberto] = useState<Partial<WorkingHour> | null>(null);
  if (hora !== aberto) { setAberto(hora); setForm(hora ? { ...hora, start_time: hora.start_time?.slice(0, 5), end_time: hora.end_time?.slice(0, 5) } : {}); }

  const salvar = useMutation({
    mutationFn: () => api.saveWorkingHour({ id: form.id, weekday: form.weekday ?? 1, start_time: form.start_time ?? '', end_time: form.end_time ?? '', location_id: form.location_id ?? '',
      session_minutes: form.session_minutes ?? durPadrao, buffer_minutes: form.buffer_minutes ?? intPadrao }),
    onSuccess: () => { onSaved(); toast('Horário salvo'); onClose(); },
  });
  const excluir = useMutation({
    mutationFn: () => api.deleteWorkingHour(form.id!),
    onSuccess: () => { onSaved(); toast('Horário excluído'); onClose(); },
  });
  function enviar(e: FormEvent) { e.preventDefault(); salvar.mutate(); }

  return (
    <Dialog open={!!hora} onClose={onClose} title={form.id ? 'Editar horário' : 'Novo horário'}
      footer={<>
        {form.id && <Button variant="ghost" className="mr-auto text-vermelho" onClick={() => excluir.mutate()} busy={excluir.isPending}>Excluir</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="form-hora" busy={salvar.isPending}>Salvar</Button>
      </>}>
      <form id="form-hora" onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        {(salvar.error || excluir.error) && <ErrorBox>{errorMessage(salvar.error ?? excluir.error)}</ErrorBox>}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-tinta-2">Dia da semana</span>
          <Select value={form.weekday ?? 1} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>
            {ORDEM_DIAS.map((d) => <option key={d} value={d}>{DIAS_SEMANA[d]}</option>)}
          </Select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Início" type="time" step={300} required value={form.start_time ?? ''} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          <TextField label="Fim" type="time" step={300} required value={form.end_time ?? ''} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-tinta-2">Local</span>
          <Select value={form.location_id ?? ''} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
            {locais.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </label>
        <Escolha rotulo="Duração da sessão" valores={DURACOES} valor={form.session_minutes ?? durPadrao} sufixo="min" onChange={(v) => setForm({ ...form, session_minutes: v })} />
        <Escolha rotulo="Intervalo entre sessões" valores={INTERVALOS} valor={form.buffer_minutes ?? intPadrao} sufixo="min" onChange={(v) => setForm({ ...form, buffer_minutes: v })} />
        {form.start_time && form.end_time && (
          <p className="num text-sm text-tinta-2">Horários: {gerarInicios(form.start_time, form.end_time, form.session_minutes ?? durPadrao, form.buffer_minutes ?? intPadrao).join(', ') || 'nenhum cabe nesse período'}</p>
        )}
      </form>
    </Dialog>
  );
}

/** Linha de botões de escolha única (duração, intervalo). */
function Escolha({ rotulo, valores, valor, sufixo, onChange }: { rotulo: string; valores: number[]; valor: number; sufixo: string; onChange: (v: number) => void }) {
  return (
    <fieldset>
      <legend className="rotulo mb-2">{rotulo}</legend>
      <div className="flex flex-wrap gap-2">
        {valores.map((v) => (
          <button key={v} type="button" aria-pressed={valor === v} onClick={() => onChange(v)}
            className={cx('num min-h-11 min-w-16 rounded-full border px-3 font-bold', valor === v ? 'border-anil bg-anil-claro text-sobre-anil-claro' : 'border-linha-forte text-tinta-2')}>
            {v === 0 ? 'Sem' : `${v} ${sufixo}`}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Assistente: escolhe sala, dias, períodos, duração e intervalo; cria um bloco por dia × período. */
function CriarHorariosDialog({ open, locais, durPadrao, intPadrao, onClose, onSaved }: {
  open: boolean; locais: Location[]; durPadrao: number; intPadrao: number; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [localId, setLocalId] = useState('');
  const [novoLocal, setNovoLocal] = useState('Sala 1');
  const [dias, setDias] = useState<number[]>([]);
  const [periodos, setPeriodos] = useState<PeriodoId[]>([]);
  const [dur, setDur] = useState(60);
  const [int, setInt] = useState(intPadrao);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [estavaAberto, setEstavaAberto] = useState(false);
  if (open !== estavaAberto) {
    setEstavaAberto(open);
    if (open) { setLocalId(locais.find((l) => l.active)?.id ?? ''); setDias([]); setPeriodos([]); setDur(durPadrao >= 60 ? 60 : durPadrao); setInt(intPadrao); setErro(null); }
  }
  const alterna = <T,>(lista: T[], v: T) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
  const semLocal = locais.length === 0;

  async function salvar() {
    setErro(null);
    if (semLocal && !novoLocal.trim()) return setErro('Dê um nome para a sala.');
    if (dias.length === 0) return setErro('Escolha pelo menos um dia da semana.');
    if (periodos.length === 0) return setErro('Escolha pelo menos um período.');
    setSalvando(true);
    try {
      const id = semLocal ? (await api.saveLocation({ name: novoLocal.trim(), modality: 'presencial', color: CORES[0] })).id : localId;
      const falhas: string[] = [];
      let criados = 0;
      for (const d of ORDEM_DIAS.filter((x) => dias.includes(x))) {
        for (const p of PERIODOS.filter((x) => periodos.includes(x.id))) {
          try {
            await api.saveWorkingHour({ location_id: id, weekday: d, start_time: p.inicio, end_time: p.fim, session_minutes: dur, buffer_minutes: int });
            criados++;
          } catch (e) { falhas.push(`${DIAS_SEMANA[d]} · ${p.nome}: ${errorMessage(e)}`); }
        }
      }
      onSaved();
      if (falhas.length === 0) { toast(`${criados} ${criados === 1 ? 'bloco criado' : 'blocos criados'}`); onClose(); }
      else setErro(`Criados: ${criados}. Não deu para criar: ${falhas.join(' · ')}`);
    } catch (e) { setErro(errorMessage(e)); } finally { setSalvando(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Adicionar horários"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={salvar} busy={salvando}>Criar horários</Button>
      </>}>
      <div className="flex flex-col gap-5">
        {erro && <ErrorBox>{erro}</ErrorBox>}
        {semLocal ? (
          <TextField label="Sala" required maxLength={80} value={novoLocal} onChange={(e) => setNovoLocal(e.target.value)} hint="Ex.: Sala 1, Sala 2 ou On-line. Dá para criar outras depois." />
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="rotulo">Sala</span>
            <Select value={localId} onChange={(e) => setLocalId(e.target.value)}>
              {locais.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </label>
        )}
        <fieldset>
          <legend className="rotulo mb-2">Dias da semana</legend>
          <div className="flex flex-wrap gap-2">
            {ORDEM_DIAS.map((d) => (
              <button key={d} type="button" aria-pressed={dias.includes(d)} onClick={() => setDias(alterna(dias, d))}
                className={cx('min-h-11 min-w-14 rounded-full border px-3 font-bold', dias.includes(d) ? 'border-anil bg-anil-claro text-sobre-anil-claro' : 'border-linha-forte text-tinta-2')}>
                {DIAS_SEMANA[d].slice(0, 3)}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="rotulo mb-2">Períodos</legend>
          <div className="grid grid-cols-3 gap-2">
            {PERIODOS.map((p) => (
              <button key={p.id} type="button" aria-pressed={periodos.includes(p.id)} onClick={() => setPeriodos(alterna(periodos, p.id))}
                className={cx('flex min-h-14 flex-col items-center justify-center rounded-campo border px-2 font-bold', periodos.includes(p.id) ? 'border-anil bg-anil-claro text-sobre-anil-claro' : 'border-linha-forte text-tinta-2')}>
                {p.nome}<span className="num text-[12px] font-normal">{p.inicio}–{p.fim}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <Escolha rotulo="Duração da sessão" valores={DURACOES} valor={dur} sufixo="min" onChange={setDur} />
        <Escolha rotulo="Intervalo entre sessões" valores={INTERVALOS} valor={int} sufixo="min" onChange={setInt} />
        {periodos.length > 0 && (
          <div className="rounded-campo bg-afundado p-3 text-sm">
            <p className="rotulo mb-1">Horários que serão criados</p>
            {PERIODOS.filter((p) => periodos.includes(p.id)).map((p) => (
              <p key={p.id} className="num"><b>{p.nome}:</b> {gerarInicios(p.inicio, p.fim, dur, int).join(', ')}</p>
            ))}
            {dias.length > 0 && <p className="mt-1 text-tinta-2">Em: {ORDEM_DIAS.filter((d) => dias.includes(d)).map((d) => DIAS_SEMANA[d]).join(', ')}.</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

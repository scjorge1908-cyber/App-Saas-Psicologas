// "Grade e horários" (layout Stitch): gerador de grade por sala, dias, turno, duração e intervalo, com pré-visualização;
// abaixo, a grade atual (cada bloco editável/excluível) e as salas. A agenda mostra os horários livres a partir daqui.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { Location, Modality, WorkingHour } from '../lib/types';
import { DIAS_SEMANA, faixaTexto } from '../lib/horarios';
import { DURACOES, INTERVALOS, PERIODOS, gerarInicios, hhmm, periodoDe, type PeriodoId } from '../lib/periodos';
import { useProfile } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import { Button, Dialog, ErrorBox, Loading, Select, TextField, cx, useConfirm, useToast } from '../components/ui';
import { IconChevronLeft, IconCircleCheck, IconPlus } from '../components/icons';
import { BloqueiosSecao } from '../components/agenda/Bloqueios';

const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]; // a semana de trabalho começa na segunda
const CORES = ['#146C70', '#0B6E8A', '#B3541E', '#2F7D5B', '#9C2F6B', '#5B6472'];

export function HorariosPage() {
  const qc = useQueryClient();
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations });
  const horas = useQuery({ queryKey: ['working-hours'], queryFn: api.listWorkingHours });
  const [editLocal, setEditLocal] = useState<Partial<Location> | null>(null);
  const [editHora, setEditHora] = useState<Partial<WorkingHour> | null>(null);
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
    <div className="flex flex-col gap-5 pb-6">
      <header className="flex items-center gap-2">
        <Link to="/" className="grid size-11 shrink-0 place-items-center rounded-xl text-tinta-2 hover:bg-cinza-fundo" aria-label="Voltar para a agenda"><IconChevronLeft /></Link>
        <div>
          <h1 className="titulo-display text-[1.625rem] leading-tight">Grade e horários</h1>
          <p className="text-[0.9375rem] text-tinta-2">Gere os horários da sua rotina com os intervalos certos. A agenda usa esta grade.</p>
        </div>
      </header>

      {erro && <ErrorBox>{errorMessage(erro)}</ErrorBox>}
      {(locais.isLoading || horas.isLoading) && <Loading />}

      {locais.data && horas.data && (
        <GeradorGrade locais={lista} durPadrao={durPadrao} intPadrao={intPadrao} onNovaSala={() => setEditLocal({ modality: 'presencial', color: CORES[lista.length % CORES.length] })} onSaved={atualizar} />
      )}

      {/* Grade atual: um card por bloco (sala + turno), por dia */}
      {(horas.data ?? []).length > 0 && (
        <section aria-labelledby="t-semana" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 id="t-semana" className="text-[1.125rem] font-bold">Grade atual</h2>
            <span className="text-sm text-tinta-2">Toque num bloco para mudar ou excluir</span>
          </div>
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
                        <button type="button" onClick={() => setEditHora(h)} className="cartao pressionar flex w-full flex-col gap-1 border-l-4 border-l-livre px-4 py-3 text-left">
                          <span className="flex items-center gap-2 font-bold">
                            <span className="size-2.5 rounded-full" style={{ background: l?.color ?? 'var(--color-anil)' }} aria-hidden />
                            {l?.name ?? 'Local'} · {periodoDe(h.start_time).nome}
                          </span>
                          <span className="num text-sm text-tinta-2">{faixaTexto(h)} · {dur} min{int ? ` + ${int} de intervalo` : ''}</span>
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

      {/* Salas */}
      {lista.length > 0 && (
        <section aria-labelledby="t-salas" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 id="t-salas" className="text-[1.125rem] font-bold">Salas</h2>
            <Button variant="ghost" size="sm" onClick={() => setEditLocal({ modality: 'presencial', color: CORES[lista.length % CORES.length] })}><IconPlus /> Sala</Button>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {lista.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => setEditLocal(l)} className={cx('cartao pressionar flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left', !l.active && 'opacity-60')}>
                  <span className="size-3 shrink-0 rounded-full" style={{ background: l.color ?? 'var(--color-anil)' }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate">{l.name}</strong>
                    <span className="text-sm text-tinta-3">{l.modality === 'online' ? 'On-line' : l.address || 'Presencial'}{!l.active && ' · pausada'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Férias, feriados e folgas (27/10) */}
      <BloqueiosSecao />

      <LocalDialog local={editLocal} onClose={() => setEditLocal(null)} onSaved={atualizar} />
      <HoraDialog hora={editHora} locais={lista} durPadrao={durPadrao} intPadrao={intPadrao} onClose={() => setEditHora(null)} onSaved={atualizar} />
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
          <label className="flex items-center gap-3 text-[0.9375rem]">
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
  const confirm = useConfirm();
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
    <Dialog open={!!hora} onClose={onClose} title={form.id ? 'Editar bloco da grade' : 'Novo bloco da grade'}
      footer={<>
        {form.id && <Button variant="ghost" className="mr-auto text-vermelho" busy={excluir.isPending} onClick={async () => { if (await confirm({ title: 'Excluir este bloco da grade?', body: 'Os horários livres deste bloco saem da agenda. Sessões já marcadas continuam.', confirmLabel: 'Excluir', danger: true })) excluir.mutate(); }}>Excluir</Button>}
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

/** Gerador de grade (layout Stitch): sala, dias, turno com início/término, duração, intervalo e pré-visualização. */
function GeradorGrade({ locais, durPadrao, intPadrao, onNovaSala, onSaved }: {
  locais: Location[]; durPadrao: number; intPadrao: number; onNovaSala: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const ativas = locais.filter((l) => l.active);
  const [localId, setLocalId] = useState('');
  const [novoLocal, setNovoLocal] = useState('Sala 1');
  const [dias, setDias] = useState<number[]>([1]);
  const [turno, setTurno] = useState<PeriodoId>('manha');
  const [ini, setIni] = useState(PERIODOS[0].inicio);
  const [fim, setFim] = useState(PERIODOS[0].fim);
  const [dur, setDur] = useState(durPadrao >= 60 ? 60 : durPadrao);
  const [int, setInt] = useState(intPadrao);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const salaSel = ativas.find((l) => l.id === localId) ?? ativas[0] ?? null;
  const semSala = ativas.length === 0;
  const alterna = (v: number) => setDias((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]));
  const escolheTurno = (t: PeriodoId) => { const p = PERIODOS.find((x) => x.id === t)!; setTurno(t); setIni(p.inicio); setFim(p.fim); };
  const restaurar = () => { escolheTurno('manha'); setDias([1]); setDur(durPadrao >= 60 ? 60 : durPadrao); setInt(intPadrao); setErro(null); };

  const inicios = ini && fim ? gerarInicios(ini, fim, dur, int) : [];
  const fimDe = (t: string) => hhmm(Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + dur);
  const util = inicios.length * dur;

  async function salvar() {
    setErro(null);
    if (semSala && !novoLocal.trim()) return setErro('Dê um nome para a sala.');
    if (dias.length === 0) return setErro('Escolha pelo menos um dia.');
    if (!ini || !fim || fim <= ini) return setErro('O término precisa ser depois do início.');
    if (inicios.length === 0) return setErro('Nenhum horário cabe nesse turno com essa duração.');
    setSalvando(true);
    try {
      const id = semSala ? (await api.saveLocation({ name: novoLocal.trim(), modality: 'presencial', color: CORES[0] })).id : salaSel!.id;
      const falhas: string[] = [];
      let criados = 0;
      for (const d of ORDEM_DIAS.filter((x) => dias.includes(x))) {
        try {
          await api.saveWorkingHour({ location_id: id, weekday: d, start_time: ini, end_time: fim, session_minutes: dur, buffer_minutes: int });
          criados++;
        } catch (e) { falhas.push(`${DIAS_SEMANA[d]}: ${errorMessage(e)}`); }
      }
      onSaved();
      if (falhas.length === 0) toast(`Grade gerada: ${criados} ${criados === 1 ? 'dia' : 'dias'} × ${inicios.length} horários`);
      else setErro(`Gerados: ${criados}. Não deu para gerar em ${falhas.join(' · ')}`);
    } catch (e) { setErro(errorMessage(e)); } finally { setSalvando(false); }
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="t-gerar">
      <div>
        <span className="inline-flex h-7 items-center rounded-full bg-livre-fundo px-3 text-[0.75rem] font-bold text-livre">Gerador de horários</span>
        <h2 id="t-gerar" className="mt-2 text-[1.25rem] font-bold leading-tight">Configurar regras de atendimento</h2>
      </div>
      {erro && <ErrorBox>{erro}</ErrorBox>}

      {/* Sala */}
      <div>
        <div className="mb-2 flex items-center justify-between"><p className="font-bold">Consultório e sala</p>{!semSala && <span className="text-sm text-anil-escuro">{salaSel?.name}</span>}</div>
        {semSala ? (
          <TextField label="Nome da sala" required maxLength={80} value={novoLocal} onChange={(e) => setNovoLocal(e.target.value)} hint="Ex.: Sala 1, Sala 2 ou On-line." />
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {ativas.map((l) => {
              const sel = l.id === salaSel?.id;
              return (
                <button key={l.id} type="button" aria-pressed={sel} onClick={() => setLocalId(l.id)}
                  className={cx('flex min-h-16 min-w-36 shrink-0 items-center gap-2 rounded-cartao border px-3 text-left', sel ? 'btn-degrade border-transparent shadow-elevado' : 'border-linha bg-papel')}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: sel ? 'currentColor' : l.color ?? 'var(--color-anil)' }} aria-hidden />
                  <span className="min-w-0"><span className="block truncate font-bold">{l.name}</span><span className="block text-[0.75rem] opacity-80">{l.modality === 'online' ? 'On-line' : 'Presencial'}</span></span>
                </button>
              );
            })}
            <button type="button" onClick={onNovaSala} className="flex min-h-16 shrink-0 items-center gap-1.5 rounded-cartao border border-dashed border-linha-forte px-3 font-bold text-anil-escuro"><IconPlus className="size-5" /> Sala</button>
          </div>
        )}
      </div>

      {/* Dias */}
      <div>
        <div className="mb-2 flex items-center justify-between"><p className="font-bold">Dias de aplicação</p><span className="text-sm text-anil-escuro">{dias.length} {dias.length === 1 ? 'dia ativo' : 'dias ativos'}</span></div>
        <div className="grid grid-cols-7 gap-1.5">
          {ORDEM_DIAS.map((d) => (
            <button key={d} type="button" aria-pressed={dias.includes(d)} onClick={() => alterna(d)}
              className={cx('flex min-h-12 flex-col items-center justify-center rounded-campo border text-sm font-bold', dias.includes(d) ? 'btn-degrade border-transparent' : 'border-linha bg-papel text-tinta-2')}>
              {DIAS_SEMANA[d].slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      {/* Turno */}
      <div className="cartao flex flex-col gap-4 p-4">
        <p className="rotulo">Turno de atendimento</p>
        <div role="tablist" aria-label="Turno" className="grid grid-cols-3 gap-1 rounded-campo bg-afundado p-1">
          {PERIODOS.map((p) => (
            <button key={p.id} role="tab" type="button" aria-selected={turno === p.id} onClick={() => escolheTurno(p.id)}
              className={cx('min-h-11 rounded-[calc(var(--r-field)-4px)] font-bold', turno === p.id ? 'bg-papel text-anil-escuro shadow-cartao' : 'text-tinta-2')}>{p.nome}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Início do turno" type="time" step={300} value={ini} onChange={(e) => setIni(e.target.value)} />
          <TextField label="Término previsto" type="time" step={300} value={fim} onChange={(e) => setFim(e.target.value)} />
        </div>
        <Escolha rotulo={`Duração por consulta · ${dur} min`} valores={DURACOES} valor={dur} sufixo="min" onChange={setDur} />
        <Escolha rotulo={`Intervalo entre sessões · ${int} min`} valores={INTERVALOS} valor={int} sufixo="min" onChange={setInt} />
      </div>

      {/* Pré-visualização */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between"><p className="text-[1.125rem] font-bold">Pré-visualização da grade</p></div>
        <p className="rounded-campo bg-anil-claro/60 px-3 py-2.5 text-[0.9375rem] text-sobre-anil-claro">
          <b className="num">{String(inicios.length).padStart(2, '0')} horários</b> de {dur} min{int ? <> com <b>{int} min</b> de intervalo</> : ' sem intervalo'}.
          Total útil: <b className="num">{Math.floor(util / 60)}h{util % 60 ? `${util % 60}` : ''}</b> de agenda{dias.length ? `, em ${ORDEM_DIAS.filter((d) => dias.includes(d)).map((d) => DIAS_SEMANA[d].slice(0, 3)).join(', ')}` : ''}. Vale para todas as semanas.
        </p>
        <ol className="flex flex-col">
          {inicios.map((t, i) => (
            <li key={t}>
              {i > 0 && int > 0 && <p className="num py-1 text-center text-[0.75rem] text-tinta-3">{int} min de intervalo</p>}
              <div className={cx('cartao flex items-center gap-3 border-l-4 border-l-livre px-4 py-3', i > 0 && int === 0 && 'mt-2')}>
                <span className="min-w-0 flex-1">
                  <span className="num block font-bold">{t} — {fimDe(t)}</span>
                  <span className="block text-sm text-tinta-2">{salaSel?.name ?? (novoLocal || 'Sala')} · horário {i + 1}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-sm text-livre"><IconCircleCheck className="size-4" /> Disponível</span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <Button onClick={salvar} busy={salvando} className="min-h-14 w-full text-[1rem]">Salvar e gerar grade</Button>
      <Button variant="secondary" onClick={restaurar} className="w-full">Restaurar padrão</Button>
    </section>
  );
}

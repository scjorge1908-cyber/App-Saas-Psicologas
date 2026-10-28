// "Grade e horários" (layout Stitch): gerador de grade por sala, dias, turno, duração e intervalo, com pré-visualização;
// abaixo, a grade atual (cada bloco editável/excluível) e as salas. A agenda mostra os horários livres a partir daqui.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { Location, Modality, WorkingHour } from '../lib/types';
import { DIAS_SEMANA, faixaTexto } from '../lib/horarios';
import { GRADE_FIM, GRADE_INICIO, PERIODOS, dividirPorPeriodo, foraDaGrade, gerarInicios, hhmm, type PeriodoId } from '../lib/periodos';
import { useProfile } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import { Button, Dialog, ErrorBox, Field, Input, Loading, Select, TextField, cx, useConfirm, useToast } from '../components/ui';
import { IconCircleCheck, IconPencil, IconPlus, IconTrash } from '../components/icons';
import { BloqueiosSecao } from '../components/agenda/Bloqueios';
import { AppointmentSheet } from '../components/appointments/AppointmentSheet';
import { DarAltaDialog } from '../components/patients/DarAltaDialog';
import type { AgendaItem } from '../lib/types';
import { referenciasDosAtivos } from '../lib/agenda-ativos';
import { pacientesNoHorario, pacientesNoTurno, type PacienteNoTurno } from '../lib/grade-ocupada';
import { addDays, todayIn, zonedToUtc } from '../lib/format';

const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]; // a semana de trabalho começa na segunda
const CORES = ['#146C70', '#0B6E8A', '#B3541E', '#2F7D5B', '#9C2F6B', '#5B6472'];

/**
 * Grava o turno já dividido em manhã, tarde e noite (regra do Jorge, 27/10): 07:00–21:00 vira três turnos.
 * Com id, o 1º pedaço atualiza o turno existente e os outros entram como novos. Devolve quantos turnos ficaram.
 */
async function salvarTurnoDividido(t: { id?: string; location_id: string; weekday: number; ini: string; fim: string; dur: number; int: number }): Promise<number> {
  const pedacos = dividirPorPeriodo(t.ini, t.fim, t.dur, t.int);
  if (pedacos.length === 0) throw new Error('Nenhum horário cabe nesse turno com essa duração.');
  for (const [i, p] of pedacos.entries()) {
    await api.saveWorkingHour({ ...(i === 0 && t.id ? { id: t.id } : {}), location_id: t.location_id, weekday: t.weekday, start_time: p.ini, end_time: p.fim, session_minutes: t.dur, buffer_minutes: t.int });
  }
  return pedacos.length;
}

export function HorariosPage() {
  const qc = useQueryClient();
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations });
  const horas = useQuery({ queryKey: ['working-hours'], queryFn: api.listWorkingHours });
  const [editLocal, setEditLocal] = useState<Partial<Location> | null>(null);
  const [editHora, setEditHora] = useState<Partial<WorkingHour> | null>(null);
  const [info, setInfo] = useState(false);
  const [editSlot, setEditSlot] = useState<{ h: WorkingHour; t: string; novo: string } | null>(null);
  const [slotBusy, setSlotBusy] = useState(false);
  const confirmar = useConfirm();
  const avisar = useToast();
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  // Pacientes na grade (27/10): turno com paciente não muda nem sai inteiro; horário com paciente não muda nem sai
  const { profile, tz } = useProfile();
  const hoje = todayIn(tz);
  const fromA = zonedToUtc(addDays(hoje, -183), '00:00', tz);
  const toA = zonedToUtc(addDays(hoje, 400), '00:00', tz);
  const agenda = useQuery({ queryKey: ['agenda', fromA, toA], queryFn: () => api.listAgenda(fromA, toA) });
  const pacientes = useQuery({ queryKey: ['patients'], queryFn: api.listPatients });
  const agora = Date.now();
  const itensAg = agenda.data ?? [];
  const refs = referenciasDosAtivos((pacientes.data ?? []).filter((p) => p.status === 'ativo').map((p) => p.id), itensAg, agora, tz);
  const ocupTurno = (h: WorkingHour) => pacientesNoTurno(h, itensAg, refs, agora, tz);
  const ocupHorario = (h: WorkingHour, t: string, dur: number) => pacientesNoHorario(h, t, dur, itensAg, refs, agora, tz);
  const ocupSala = (id: string) => {
    const vistos = new Map<string, PacienteNoTurno>();
    for (const d of ORDEM_DIAS) for (const p of pacientesNoTurno({ weekday: d, location_id: id, start_time: '00:00', end_time: '23:59' }, itensAg.filter((a) => a.location_id === id), refs, agora, tz)) vistos.set(p.patient_id, p);
    return [...vistos.values()];
  };
  const carregandoOcup = agenda.isLoading || pacientes.isLoading;
  const [travado, setTravado] = useState<{ titulo: string; texto: string; pacientes: PacienteNoTurno[] } | null>(null);
  const [moverItem, setMoverItem] = useState<AgendaItem | null>(null);
  const [alta, setAlta] = useState(false);
  // Criar outro turno no mesmo dia e sala (27/10): "+ Tarde", "+ Noite" no cartão abrem o Turno de atendimento
  const [novoTurno, setNovoTurno] = useState<{ weekday: number; location_id: string; periodo: PeriodoId } | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  /** Períodos que ainda cabem no dia (a agenda é individual: não pode bater com turno de nenhuma sala). */
  const periodosLivres = (d: number) => PERIODOS.filter((p) => !(horas.data ?? []).some((x) => x.weekday === d && mins(x.start_time) < mins(p.fim) && mins(x.end_time) > mins(p.inicio)));
  const travarTurno = (h: WorkingHour, ps: PacienteNoTurno[]) => setTravado({
    titulo: `Este turno tem ${ps.length} ${ps.length === 1 ? 'paciente' : 'pacientes'}`,
    texto: `O turno de ${DIAS_SEMANA[h.weekday]} (${faixaTexto(h)}) não pode ser mudado nem excluído inteiro enquanto tiver paciente. Para mudar: crie uma nova sala, passe estes pacientes para ela (botão Mover) e depois ajuste esta sala. Para excluir tudo: dê alta aos pacientes antes.`,
    pacientes: ps,
  });
  const travarHorario = (t: string, d: number, ps: PacienteNoTurno[]) => setTravado({
    titulo: `O horário das ${t} tem paciente`,
    texto: `Este horário de ${DIAS_SEMANA[d]} não pode ser mudado nem excluído enquanto tiver paciente. Passe o paciente para outro horário ou sala (botão Mover), ou dê alta.`,
    pacientes: ps,
  });

  /** Tira só o horário t do bloco: o bloco vira até dois pedaços (antes e depois), com a mesma duração e intervalo. */
  async function tirarHorario(h: WorkingHour, t: string) {
    const dur = h.session_minutes ?? durPadrao; const int = h.buffer_minutes ?? intPadrao;
    const ini = h.start_time.slice(0, 5); const fim = h.end_time.slice(0, 5);
    const pedacos = [{ ini, fim: t }, { ini: hhmm(mins(t) + dur + int), fim }].filter((p) => gerarInicios(p.ini, p.fim, dur, int).length > 0);
    const base = { location_id: h.location_id, weekday: h.weekday, session_minutes: h.session_minutes ?? null, buffer_minutes: h.buffer_minutes ?? null };
    if (pedacos.length === 0) { await api.deleteWorkingHour(h.id); return; }
    await api.saveWorkingHour({ id: h.id, ...base, start_time: pedacos[0].ini, end_time: pedacos[0].fim });
    if (pedacos[1]) await api.saveWorkingHour({ ...base, start_time: pedacos[1].ini, end_time: pedacos[1].fim });
  }
  async function excluirHorario(h: WorkingHour, t: string, d: number) {
    if (!(await confirmar({ title: `Excluir o horário das ${t}?`, body: `Só este horário sai da grade de ${DIAS_SEMANA[d]}. Os outros continuam. Sessões já marcadas não são apagadas.`, confirmLabel: 'Excluir horário', danger: true }))) return;
    try { await tirarHorario(h, t); atualizar(); avisar(`Horário das ${t} excluído`); } catch (e) { avisar(errorMessage(e), 'erro'); }
  }
  async function mudarHorario() {
    if (!editSlot) return;
    const { h, t, novo } = editSlot;
    if (!novo || novo === t) { setEditSlot(null); return; }
    const dur = h.session_minutes ?? durPadrao; const int = h.buffer_minutes ?? intPadrao;
    // Confere antes de mexer: o novo horário não pode bater com outro turno do mesmo dia (a regra do banco
    // compara as faixas inteiras), considerando o turno atual já sem o horário que sai
    const nIni = mins(novo); const nFim = nIni + dur;
    const limite = foraDaGrade(novo, hhmm(nFim));
    if (limite) { avisar(limite, 'erro'); return; }
    const ini = h.start_time.slice(0, 5); const fim = h.end_time.slice(0, 5);
    const pedacos = [[mins(ini), mins(t)], [mins(t) + dur + int, mins(fim)]].filter(([a, b]) => b > a);
    const outras = (horas.data ?? []).filter((x) => x.weekday === h.weekday && x.id !== h.id).map((x) => [mins(x.start_time), mins(x.end_time)]);
    if ([...pedacos, ...outras].some(([a, b]) => a < nFim && b > nIni)) {
      avisar(`O horário das ${novo} bate com outro horário de ${DIAS_SEMANA[h.weekday]} (a agenda é individual, vale para todas as salas). Escolha outro, ou exclua o horário vizinho antes.`, 'erro'); return;
    }
    setSlotBusy(true);
    try {
      await tirarHorario(h, t);
      await api.saveWorkingHour({ location_id: h.location_id, weekday: h.weekday, start_time: novo, end_time: hhmm(mins(novo) + dur), session_minutes: dur, buffer_minutes: 0 });
      atualizar(); avisar(`Horário mudado de ${t} para ${novo}`); setEditSlot(null);
    } catch (e) { atualizar(); avisar(errorMessage(e), 'erro'); } finally { setSlotBusy(false); }
  }
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
      {/* Só o título; a explicação abre na bolinha "i" (pedido do Jorge, 27/10). O Voltar fica no fim da tela. */}
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="titulo-display text-[1.625rem] leading-tight">Grade e horários</h1>
          <button type="button" onClick={() => setInfo((v) => !v)} aria-expanded={info} aria-label="O que é a grade?"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-linha-forte bg-papel font-titulo text-[0.9375rem] font-bold italic text-anil-escuro hover:bg-anil-claro/50">i</button>
        </div>
        {info && <p className="text-[0.9375rem] text-tinta-2">Gere os horários da sua rotina com os intervalos certos. A agenda usa esta grade.</p>}
      </header>

      {erro && <ErrorBox>{errorMessage(erro)}</ErrorBox>}
      {(locais.isLoading || horas.isLoading) && <Loading />}

      {locais.data && horas.data && (
        <GeradorGrade locais={lista} durPadrao={durPadrao} intPadrao={intPadrao} onNovaSala={() => setEditLocal({ modality: 'presencial', color: CORES[lista.length % CORES.length] })} onSaved={atualizar} onSucesso={setSucesso} />
      )}

      {/* Grade atual (27/10): cartão igual ao da agenda (dia + sala, com o turno) e, em cada horário,
          lápis para mudar só aquele horário e lixeira para excluir só ele — não o bloco todo */}
      {(horas.data ?? []).length > 0 && (
        <section aria-labelledby="t-semana" className="flex flex-col gap-3">
          <h2 id="t-semana" className="text-[1.125rem] font-bold">Grade atual</h2>
          {ORDEM_DIAS.flatMap((d) => {
            const doDia = (horas.data ?? []).filter((h) => h.weekday === d);
            const salas = [...new Set(doDia.map((h) => h.location_id))];
            return salas.map((sid) => {
              const l = nomeLocal(sid);
              const faixas = doDia.filter((h) => h.location_id === sid).sort((a, b) => a.start_time.localeCompare(b.start_time));
              return (
                <div key={`${d}-${sid}`} className="cartao flex flex-col gap-2 p-2.5 sm:p-3">
                  <header className="flex items-center gap-2 border-b border-linha pb-2">
                    <h3 className="text-[1.0625rem] font-extrabold">{DIAS_SEMANA[d]}</h3>
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-afundado px-2.5 py-0.5 text-[0.8125rem] font-bold text-tinta-2">
                      <span aria-hidden className="size-2 rounded-full" style={{ background: l?.color ?? 'var(--color-anil)' }} />{l?.name ?? 'Sala'}
                    </span>
                  </header>
                  {faixas.flatMap((h) => {
                    const dur = h.session_minutes ?? durPadrao; const int = h.buffer_minutes ?? intPadrao;
                    const noTurno = ocupTurno(h);
                    // Mostra separado por manhã, tarde e noite, mesmo um turno antigo que atravessa os períodos (27/10)
                    return dividirPorPeriodo(h.start_time.slice(0, 5), h.end_time.slice(0, 5), dur, int).map((g) => {
                    const doGrupo = new Set(g.inicios.flatMap((t) => ocupHorario(h, t, dur).map((p) => p.patient_id)));
                    return (
                      <div key={`${h.id}-${g.periodo}`} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline gap-x-1.5">
                          <h4 className="rotulo text-tinta-3">{PERIODOS.find((p) => p.id === g.periodo)!.nome} <span className="num font-semibold normal-case tracking-normal">{g.ini}–{g.fim}</span></h4>
                          {doGrupo.size > 0 && <span className="num text-[0.75rem] font-bold text-ag-pac">{doGrupo.size} {doGrupo.size === 1 ? 'paciente' : 'pacientes'}</span>}
                          <button type="button" disabled={carregandoOcup} onClick={() => (noTurno.length ? travarTurno(h, noTurno) : setEditHora(h))} className="ml-auto min-h-9 px-1 text-[0.8125rem] font-bold text-anil-escuro underline-offset-2 hover:underline">Ajustar turno</button>
                        </div>
                        <ul className="flex flex-col gap-1.5">
                          {g.inicios.map((t) => {
                            const ps = ocupHorario(h, t, dur);
                            const ocupado = ps.length > 0;
                            const abrir = (acao: () => void) => () => (ocupado ? travarHorario(t, d, ps) : acao());
                            return (
                            <li key={t} className={cx('flex min-h-12 items-center gap-2 rounded-campo border-l-4 pl-2.5 pr-1.5',
                              ocupado ? 'border-l-ag-pac-borda bg-ag-pac-fundo text-ag-pac' : 'border-l-ag-livre-borda bg-ag-livre-fundo text-ag-livre')}>
                              <span className="num text-[1.0625rem] font-extrabold">{t}</span>
                              <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold opacity-80">
                                {ocupado ? ps.map((p) => p.nome).join(', ') : <span className="num">até {hhmm(Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + dur)}</span>}
                              </span>
                              <button type="button" disabled={carregandoOcup} onClick={abrir(() => setEditSlot({ h, t, novo: t }))} aria-label={`Mudar o horário das ${t} de ${DIAS_SEMANA[d]}`} title="Mudar só este horário"
                                className="pressionar grid size-10 place-items-center rounded-full border border-current/30 bg-papel disabled:opacity-40"><IconPencil className="size-[1.125rem]" /></button>
                              <button type="button" disabled={carregandoOcup} onClick={abrir(() => excluirHorario(h, t, d))} aria-label={`Excluir o horário das ${t} de ${DIAS_SEMANA[d]}`} title="Excluir só este horário"
                                className="pressionar grid size-10 place-items-center rounded-full border border-vermelho-forte/40 bg-papel text-vermelho disabled:opacity-40"><IconTrash className="size-[1.125rem]" /></button>
                            </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                    });
                  })}
                  {periodosLivres(d).length > 0 && (
                    <div className="flex flex-wrap gap-2 border-t border-linha pt-2">
                      {periodosLivres(d).map((p) => (
                        <button key={p.id} type="button" onClick={() => setNovoTurno({ weekday: d, location_id: sid, periodo: p.id })}
                          aria-label={`Criar ${p.nome.toLowerCase()} na ${DIAS_SEMANA[d]}`}
                          className="pressionar inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-dashed border-ag-livre-borda bg-ag-livre-fundo px-3 text-[0.9375rem] font-bold text-ag-livre">
                          <IconPlus className="size-4" strokeWidth={2.4} /> {p.nome}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            });
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

      <Dialog open={!!editSlot} onClose={() => setEditSlot(null)} title={editSlot ? `Mudar o horário das ${editSlot.t}` : ''} footer={<>
        <Button variant="secondary" onClick={() => setEditSlot(null)}>Voltar</Button>
        <Button busy={slotBusy} onClick={mudarHorario}>Salvar horário</Button>
      </>}>
        {editSlot && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-tinta-2">Muda só este horário de {DIAS_SEMANA[editSlot.h.weekday]}. Os outros horários do turno continuam iguais.</p>
            <TextField label="Novo horário" type="time" step={300} value={editSlot.novo} onChange={(e) => setEditSlot({ ...editSlot, novo: e.target.value })} />
          </div>
        )}
      </Dialog>
      <Dialog open={!!travado} onClose={() => setTravado(null)} title={travado?.titulo ?? ''} footer={<>
        <Button variant="secondary" onClick={() => setTravado(null)}>Voltar</Button>
        <Button variant="secondary" onClick={() => { setTravado(null); setAlta(true); }}>Dar alta</Button>
        <Button onClick={() => { setTravado(null); setEditLocal({ modality: 'presencial', color: CORES[lista.length % CORES.length] }); }}><IconPlus /> Criar nova sala</Button>
      </>}>
        {travado && (
          <div className="flex flex-col gap-3">
            <p className="text-[0.9375rem] text-tinta-2">{travado.texto}</p>
            <ul className="flex flex-col gap-1.5">
              {travado.pacientes.map((p) => (
                <li key={p.patient_id} className="flex min-h-12 items-center gap-2 rounded-campo border-l-4 border-l-ag-pac-borda bg-ag-pac-fundo pl-2.5 pr-1.5 text-ag-pac">
                  <span className="num font-extrabold">{p.hora}</span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate">{p.nome}</strong>
                    {p.semHorario && <span className="block text-[0.75rem]">sem próximo horário</span>}
                  </span>
                  {!p.semHorario && <Button size="sm" variant="secondary" onClick={() => { setTravado(null); setMoverItem(p.item); }}>Mover</Button>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>
      <AppointmentSheet item={moverItem} mover onClose={() => { setMoverItem(null); atualizar(); }} />
      <DarAltaDialog open={alta} onClose={() => { setAlta(false); atualizar(); }} />
      <LocalDialog local={editLocal} ocupados={editLocal?.id ? ocupSala(editLocal.id) : []} onClose={() => setEditLocal(null)} onSaved={atualizar}
        onTravado={(ps) => setTravado({ titulo: `Esta sala tem ${ps.length} ${ps.length === 1 ? 'paciente' : 'pacientes'}`,
          texto: 'A sala não pode ser excluída enquanto tiver paciente. Crie uma nova sala e passe estes pacientes para ela (botão Mover), ou dê alta. Depois exclua esta sala.', pacientes: ps })} />
      <NovoTurnoDialog alvo={novoTurno} locais={lista} durPadrao={durPadrao} intPadrao={intPadrao} onClose={() => setNovoTurno(null)}
        onCriado={(msg) => { setNovoTurno(null); atualizar(); setSucesso(msg); }} />
      <Dialog open={!!sucesso} onClose={() => setSucesso(null)} title="Consultório criado com sucesso!" footer={<Button onClick={() => setSucesso(null)} className="w-full">OK</Button>}>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-livre-fundo text-livre"><IconCircleCheck className="size-9" /></span>
          <p className="text-[0.9375rem] text-tinta-2">{sucesso}</p>
        </div>
      </Dialog>
      <HoraDialog hora={editHora} locais={lista} durPadrao={durPadrao} intPadrao={intPadrao} onClose={() => setEditHora(null)} onSaved={atualizar} />
    </div>
  );
}

function LocalDialog({ local, ocupados, onClose, onSaved, onTravado }: { local: Partial<Location> | null; ocupados: PacienteNoTurno[]; onClose: () => void; onSaved: () => void; onTravado: (ps: PacienteNoTurno[]) => void }) {
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
    if (ocupados.length) { onClose(); onTravado(ocupados); return; }
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
    mutationFn: () => salvarTurnoDividido({ id: form.id, weekday: form.weekday ?? 1, ini: form.start_time ?? '', fim: form.end_time ?? '', location_id: form.location_id ?? '',
      dur: form.session_minutes ?? durPadrao, int: form.buffer_minutes ?? intPadrao }),
    onSuccess: () => { onSaved(); toast('Horário salvo'); onClose(); },
  });
  const excluir = useMutation({
    mutationFn: () => api.deleteWorkingHour(form.id!),
    onSuccess: () => { onSaved(); toast('Horário excluído'); onClose(); },
  });
  const [limite, setLimite] = useState<string | null>(null);
  function enviar(e: FormEvent) {
    e.preventDefault();
    const fora = foraDaGrade(form.start_time ?? '', form.end_time ?? '');
    setLimite(fora);
    if (!fora) salvar.mutate();
  }

  return (
    <Dialog open={!!hora} onClose={onClose} title={form.id ? 'Editar bloco da grade' : 'Novo bloco da grade'}
      footer={<>
        {form.id && <Button variant="ghost" className="mr-auto text-vermelho" busy={excluir.isPending} onClick={async () => { if (await confirm({ title: 'Excluir este bloco da grade?', body: 'Os horários livres deste bloco saem da agenda. Sessões já marcadas continuam.', confirmLabel: 'Excluir', danger: true })) excluir.mutate(); }}>Excluir</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="form-hora" busy={salvar.isPending}>Salvar</Button>
      </>}>
      <form id="form-hora" onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        {limite && <ErrorBox>{limite}</ErrorBox>}
        {(salvar.error || excluir.error) && <ErrorBox>{errorMessage(salvar.error ?? excluir.error)}</ErrorBox>}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-tinta-2">Dia da semana</span>
          <Select value={form.weekday ?? 1} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>
            {ORDEM_DIAS.map((d) => <option key={d} value={d}>{DIAS_SEMANA[d]}</option>)}
          </Select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Início" type="time" step={300} min={GRADE_INICIO} max={GRADE_FIM} required value={form.start_time ?? ''} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          <TextField label="Fim" type="time" step={300} min={GRADE_INICIO} max={GRADE_FIM} required value={form.end_time ?? ''} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-tinta-2">Local</span>
          <Select value={form.location_id ?? ''} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
            {locais.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </label>
        <Passo rotulo="Duração da sessão" valor={form.session_minutes ?? durPadrao} min={10} max={300} onChange={(v) => setForm({ ...form, session_minutes: v })} />
        <Passo rotulo="Intervalo entre sessões" valor={form.buffer_minutes ?? intPadrao} min={0} max={120} onChange={(v) => setForm({ ...form, buffer_minutes: v })} />
        {form.start_time && form.end_time && (
          <p className="num text-sm text-tinta-2">Horários: {gerarInicios(form.start_time, form.end_time, form.session_minutes ?? durPadrao, form.buffer_minutes ?? intPadrao).join(', ') || 'nenhum cabe nesse período'}</p>
        )}
      </form>
    </Dialog>
  );
}

/** Linha de botões de escolha única (duração, intervalo). */
/** Campo de minutos com – e + (pedido do Jorge, 27/10): digita ou sobe/desce de 5 em 5. */
function Passo({ rotulo, valor, min, max, onChange }: { rotulo: string; valor: number; min: number; max: number; onChange: (v: number) => void }) {
  const limitar = (v: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? Math.round(v) : min));
  const btn = 'pressionar grid size-12 shrink-0 place-items-center rounded-full border border-linha-forte bg-papel text-[1.375rem] font-bold text-anil-escuro disabled:opacity-40';
  return (
    <Field label={rotulo}>
      {(id) => (
        <div className="flex items-center gap-2">
          <button type="button" className={btn} aria-label={`Diminuir ${rotulo.toLowerCase()}`} disabled={valor <= min} onClick={() => onChange(limitar(valor - 5))}>–</button>
          <div className="relative min-w-0 flex-1">
            <Input id={id} type="number" inputMode="numeric" min={min} max={max} step={5} value={valor}
              onChange={(e) => onChange(limitar(Number(e.target.value)))} className="num pr-12 text-center text-[1.125rem] font-bold" />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-tinta-3">min</span>
          </div>
          <button type="button" className={btn} aria-label={`Aumentar ${rotulo.toLowerCase()}`} disabled={valor >= max} onClick={() => onChange(limitar(valor + 5))}>+</button>
        </div>
      )}
    </Field>
  );
}

/** Gerador de grade (layout Stitch): sala, dias, turno com início/término, duração, intervalo e pré-visualização. */
function GeradorGrade({ locais, durPadrao, intPadrao, onNovaSala, onSaved, onSucesso }: {
  locais: Location[]; durPadrao: number; intPadrao: number; onNovaSala: () => void; onSaved: () => void; onSucesso: (msg: string) => void;
}) {
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
  const [infoTurno, setInfoTurno] = useState(false);
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
    const limite = foraDaGrade(ini, fim);
    if (limite) return setErro(limite);
    if (inicios.length === 0) return setErro('Nenhum horário cabe nesse turno com essa duração.');
    setSalvando(true);
    try {
      const id = semSala ? (await api.saveLocation({ name: novoLocal.trim(), modality: 'presencial', color: CORES[0] })).id : salaSel!.id;
      const falhas: string[] = [];
      let criados = 0;
      for (const d of ORDEM_DIAS.filter((x) => dias.includes(x))) {
        try {
          await salvarTurnoDividido({ location_id: id, weekday: d, ini, fim, dur, int });
          criados++;
        } catch (e) { falhas.push(`${DIAS_SEMANA[d]}: ${errorMessage(e)}`); }
      }
      onSaved();
      if (falhas.length === 0) onSucesso(`Grade gerada: ${criados} ${criados === 1 ? 'dia' : 'dias'} × ${inicios.length} horários. Veja em "Grade atual".`);
      else setErro(`Gerados: ${criados}. Não deu para gerar em ${falhas.join(' · ')}`);
    } catch (e) { setErro(errorMessage(e)); } finally { setSalvando(false); }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Gerador de horários">
      {/* "Criar consultório" no lugar do selo "Gerador de horários" e do título (27/10) */}
      <button type="button" onClick={onNovaSala}
        className="pressionar inline-flex min-h-11 items-center gap-1.5 self-start rounded-full bg-livre-fundo px-4 text-[0.9375rem] font-bold text-livre hover:brightness-95">
        <IconPlus className="size-4" strokeWidth={2.4} /> Criar consultório
      </button>
      {erro && <ErrorBox>{erro}</ErrorBox>}

      {/* Sala */}
      <div>
        <div className="mb-2 flex items-center justify-between"><p className="font-bold">Consultório e sala</p>{!semSala && <span className="text-sm text-anil-escuro">{salaSel?.name}</span>}</div>
        {semSala ? (
          <TextField label="Nome da sala" required maxLength={80} value={novoLocal} onChange={(e) => setNovoLocal(e.target.value)} hint="Ex.: Sala 1, Sala 2 ou On-line." />
        ) : (
          // Salas em quadrados do mesmo tamanho, até 3 por linha; as demais descem (nunca rolagem para o lado) — 27/10
          <div className="grid grid-cols-3 gap-2">
            {ativas.map((l) => {
              const sel = l.id === salaSel?.id;
              return (
                <button key={l.id} type="button" aria-pressed={sel} onClick={() => setLocalId(l.id)}
                  className={cx('flex aspect-square min-w-0 flex-col items-center justify-center gap-1 rounded-cartao border p-2 text-center', sel ? 'btn-degrade border-transparent shadow-elevado' : 'border-linha bg-papel')}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: sel ? 'currentColor' : l.color ?? 'var(--color-anil)' }} aria-hidden />
                  <span className="w-full break-words text-[0.9375rem] font-bold leading-tight [overflow-wrap:anywhere]">{l.name}</span>
                  <span className="text-[0.75rem] opacity-80">{l.modality === 'online' ? 'On-line' : 'Presencial'}</span>
                </button>
              );
            })}
            <button type="button" onClick={onNovaSala} aria-label="Nova sala"
              className="flex aspect-square min-w-0 flex-col items-center justify-center gap-1 rounded-cartao border border-dashed border-linha-forte p-2 font-bold text-anil-escuro">
              <IconPlus className="size-6" /> <span className="text-[0.8125rem]">Sala</span>
            </button>
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
        {/* Explicação na bolinha "i" ao lado do título (27/10), não fixa no cartão */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <p className="rotulo">Turno de atendimento</p>
            <button type="button" onClick={() => setInfoTurno((v) => !v)} aria-expanded={infoTurno} aria-label="Sobre o turno de atendimento"
              className="grid size-7 shrink-0 place-items-center rounded-full border border-linha-forte bg-papel font-titulo text-[0.8125rem] font-bold italic text-anil-escuro hover:bg-anil-claro/50">i</button>
          </div>
          {infoTurno && <p className="text-[0.8125rem] text-tinta-2">A grade vai das {GRADE_INICIO} às {GRADE_FIM}. Pode criar manhã, tarde e noite na mesma sala; sem espaço no dia, use outro dia.</p>}
        </div>
        <div role="tablist" aria-label="Turno" className="grid grid-cols-3 gap-1 rounded-campo bg-afundado p-1">
          {PERIODOS.map((p) => (
            <button key={p.id} role="tab" type="button" aria-selected={turno === p.id} onClick={() => escolheTurno(p.id)}
              className={cx('min-h-11 rounded-[calc(var(--r-field)-4px)] font-bold', turno === p.id ? 'bg-papel text-anil-escuro shadow-cartao' : 'text-tinta-2')}>{p.nome}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Início do turno" type="time" step={300} min={GRADE_INICIO} max={GRADE_FIM} value={ini} onChange={(e) => setIni(e.target.value)} />
          <TextField label="Término previsto" type="time" step={300} min={GRADE_INICIO} max={GRADE_FIM} value={fim} onChange={(e) => setFim(e.target.value)} />
        </div>
        <Passo rotulo="Duração por consulta" valor={dur} min={10} max={300} onChange={setDur} />
        <Passo rotulo="Intervalo entre sessões" valor={int} min={0} max={120} onChange={setInt} />
      </div>

      {/* Pré-visualização */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between"><p className="text-[1.125rem] font-bold">Pré-visualização da grade</p></div>
        <p className="rounded-campo bg-anil-claro/60 px-3 py-2.5 text-[0.9375rem] text-sobre-anil-claro">
          <b className="num">{String(inicios.length).padStart(2, '0')} horários</b> de {dur} min{int ? <> com <b>{int} min</b> de intervalo</> : ' sem intervalo'}.
          Total útil: <b className="num">{Math.floor(util / 60)}h{util % 60 ? `${util % 60}` : ''}</b> de agenda{dias.length ? `, em ${ORDEM_DIAS.filter((d) => dias.includes(d)).map((d) => DIAS_SEMANA[d].slice(0, 3)).join(', ')}` : ''}. Vale para todas as semanas.
          {(() => { const g = dividirPorPeriodo(ini, fim, dur, int); return g.length > 1 ? <> Fica dividido em <b>{g.map((x) => PERIODOS.find((p) => p.id === x.periodo)!.nome).join(', ')}</b>.</> : null; })()}
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

      {/* "Aplicar" (27/10): cria os horários; eles aparecem logo abaixo, em "Grade atual", com lápis e lixeira em cada um */}
      <Button onClick={salvar} busy={salvando} className="min-h-14 w-full text-[1rem]">Aplicar</Button>
      <Button variant="secondary" onClick={restaurar} className="w-full">Restaurar padrão</Button>
    </section>
  );
}

/** "+ Tarde" / "+ Noite" no cartão da Grade atual (27/10): o mesmo Turno de atendimento, já com o dia, a sala e o período. */
function NovoTurnoDialog({ alvo, locais, durPadrao, intPadrao, onClose, onCriado }: {
  alvo: { weekday: number; location_id: string; periodo: PeriodoId } | null; locais: Location[]; durPadrao: number; intPadrao: number;
  onClose: () => void; onCriado: (msg: string) => void;
}) {
  const [aberto, setAberto] = useState<typeof alvo>(null);
  const [ini, setIni] = useState(''); const [fim, setFim] = useState('');
  const [dur, setDur] = useState(durPadrao); const [int, setInt] = useState(intPadrao);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  if (alvo !== aberto) {
    setAberto(alvo);
    if (alvo) { const p = PERIODOS.find((x) => x.id === alvo.periodo)!; setIni(p.inicio); setFim(p.fim); setDur(durPadrao >= 60 ? 60 : durPadrao); setInt(intPadrao); setErro(null); }
  }
  const p = alvo ? PERIODOS.find((x) => x.id === alvo.periodo)! : null;
  const sala = locais.find((l) => l.id === alvo?.location_id);
  const inicios = ini && fim ? gerarInicios(ini, fim, dur, int) : [];
  async function aplicar() {
    if (!alvo) return;
    setErro(null);
    if (!ini || !fim || fim <= ini) return setErro('O término precisa ser depois do início.');
    const limite = foraDaGrade(ini, fim);
    if (limite) return setErro(limite);
    if (inicios.length === 0) return setErro('Nenhum horário cabe nesse turno com essa duração.');
    setSalvando(true);
    try {
      await salvarTurnoDividido({ location_id: alvo.location_id, weekday: alvo.weekday, ini, fim, dur, int });
      onCriado(`${p!.nome} de ${DIAS_SEMANA[alvo.weekday]} na ${sala?.name ?? 'sala'}: ${inicios.length} horários (${ini}–${fim}).`);
    } catch (e) { setErro(errorMessage(e)); } finally { setSalvando(false); }
  }
  return (
    <Dialog open={!!alvo} onClose={onClose} title={p && alvo ? `Criar ${p.nome.toLowerCase()} · ${DIAS_SEMANA[alvo.weekday]}` : ''} footer={<>
      <Button variant="secondary" onClick={onClose}>Voltar</Button>
      <Button busy={salvando} onClick={aplicar}>Aplicar</Button>
    </>}>
      {alvo && p && (
        <div className="flex flex-col gap-4">
          {erro && <ErrorBox>{erro}</ErrorBox>}
          <p className="rotulo">Turno de atendimento · {sala?.name ?? 'Sala'}</p>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Início do turno" type="time" step={300} min={GRADE_INICIO} max={GRADE_FIM} value={ini} onChange={(e) => setIni(e.target.value)} />
            <TextField label="Término previsto" type="time" step={300} min={GRADE_INICIO} max={GRADE_FIM} value={fim} onChange={(e) => setFim(e.target.value)} />
          </div>
          <Passo rotulo="Duração por consulta" valor={dur} min={10} max={300} onChange={setDur} />
          <Passo rotulo="Intervalo entre sessões" valor={int} min={0} max={120} onChange={setInt} />
          <p className="num rounded-campo bg-anil-claro/60 px-3 py-2.5 text-[0.9375rem] text-sobre-anil-claro">
            <b>{inicios.length} horários</b>{inicios.length ? `: ${inicios.join(', ')}` : ' — nenhum cabe nesse período'}
          </p>
        </div>
      )}
    </Dialog>
  );
}

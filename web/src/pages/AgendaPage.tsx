// Agenda (referência visual: agenda do Hope App). Topo: Semana | Dia e navegação ‹ datas ›.
// Corpo: um cartão por dia + sala, com Manhã / Tarde / Noite e uma linha por horário:
//   • livre: linha verde-clara "09:20 · LIVRE" — tocar abre o agendamento já com dia, horário e sala;
//   • paciente: linha azul-clara com hora, nome (prioridade) e "Situação · modalidade · idade",
//     e na mesma linha Mover e WhatsApp (descem para baixo do nome quando falta espaço). Tocar no paciente abre
//     todas as opções da sessão.
// A agenda nasce da grade (tela Grade e horários). Regras de conflito, recorrência e remarcação
// continuam nos diálogos de sempre (NewAppointmentDialog e AppointmentSheet).
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { AgendaItem, AppointmentStatus, WorkingHour } from '../lib/types';
import { horariosLivres } from '../lib/horarios';
import { periodoDe } from '../lib/periodos';
import { agruparColunas, type Bloco, type Coluna, type Linha } from '../lib/agenda-colunas';
import { addDays, ageOn, formatDate, formatTime, minutesBetween, monthName, todayIn, weekday, weekdayName, weekdayShort, zonedParts, zonedToUtc } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useProfile } from '../auth/AuthProvider';
import { AppointmentSheet } from '../components/appointments/AppointmentSheet';
import { WhatsAppCard } from '../components/appointments/WhatsAppCard';
import { DarAltaDialog } from '../components/patients/DarAltaDialog';
import { NewAppointmentDialog } from '../components/appointments/NewAppointmentDialog';
import { ErrorBox, Loading, cx } from '../components/ui';
import { PrimeirosPassos, iniciarPasseio } from '../components/ajuda/Ajuda';
import { FLAG_PASSEIO_OFERECIDO, FLAG_WHATS_ENVIADO, gravarFlag, lerFlag } from '../lib/ajuda';
import { IconCake, IconCheck, IconChevronLeft, IconChevronRight, IconClock, IconDoc, IconPlus, IconSwap, IconVideo, IconWhats } from '../components/icons';

type NovoEm = { date: string; time?: string; locationId?: string | null; minutes?: number; modo?: 'novo' | 'existente'; repeat?: 'quinzenal'; encaixe?: boolean };
type Visao = 'semana' | 'dia';

const diaNome = (d: string) => { const n = weekdayName(d).replace('-feira', ''); return n[0].toUpperCase() + n.slice(1); };
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** Dias de `a` até `b` (datas AAAA-MM-DD; negativo se `b` for antes). */
const diasEntre = (a: string, b: string) => {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86400e3);
};
/** "Mariana Costa Albuquerque" → "Mariana Albuquerque" */
export const nomeCurto = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1]}` : p[0] ?? ''; };

/** Situação da sessão: texto + cor da linha (a cor nunca é o único sinal). */
const SITUACAO: Record<AppointmentStatus, { rotulo: string; linha: string; texto: string }> = {
  agendado: { rotulo: 'Agendada', linha: 'bg-ag-pac-fundo border-l-ag-pac-borda', texto: 'text-ag-pac' },
  confirmado: { rotulo: 'Confirmada', linha: 'bg-ag-pac-fundo border-l-azul-forte', texto: 'text-azul' },
  atendido: { rotulo: 'Atendida', linha: 'bg-afundado border-l-verde-forte', texto: 'text-verde' },
  faltou: { rotulo: 'Falta', linha: 'bg-ocre-fundo border-l-ocre-forte', texto: 'text-ocre' },
  cancelado: { rotulo: 'Cancelada', linha: 'bg-cinza-fundo border-l-linha-forte', texto: 'text-tinta-2' },
};

const registrada = (it: AgendaItem) => it.status === 'atendido' || it.status === 'faltou';

export function AgendaPage() {
  const { profile, tz } = useProfile();
  const [params, setParams] = useSearchParams();
  const hoje = todayIn(tz);
  const date = params.get('d') || hoje;
  const visao: Visao = params.get('v') === 'dia' ? 'dia' : 'semana';
  const [open, setOpen] = useState<{ item: AgendaItem; mover?: boolean } | null>(null);
  const [novoEm, setNovoEm] = useState<NovoEm | null>(null);
  const [whats, setWhats] = useState<AgendaItem | null>(null);
  const [alta, setAlta] = useState(false);
  const [passeioPerguntado, setPasseioPerguntado] = useState(() => lerFlag(FLAG_PASSEIO_OFERECIDO));

  // "Semana" = 7 dias a partir de hoje (ex.: hoje terça → terça a segunda). As setas andam de 7 em 7 dias
  // a partir de hoje; a visão Dia usa a mesma janela de 7 dias na faixa de dias.
  const semana = addDays(hoje, 7 * Math.floor(diasEntre(hoje, date) / 7));
  const dias = Array.from({ length: 7 }, (_, i) => addDays(semana, i));
  const fromIso = zonedToUtc(semana, '00:00', tz);
  const toIso = zonedToUtc(addDays(semana, 7), '00:00', tz);

  const q = useQuery({ queryKey: ['agenda', fromIso, toIso], queryFn: () => api.listAgenda(fromIso, toIso) });
  // Uma semana antes e depois: para enxergar os pacientes quinzenais nas semanas alternadas
  const fromX = zonedToUtc(addDays(semana, -7), '00:00', tz);
  const toX = zonedToUtc(addDays(semana, 14), '00:00', tz);
  const qx = useQuery({ queryKey: ['agenda', fromX, toX], queryFn: () => api.listAgenda(fromX, toX) });
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations });
  const horas = useQuery({ queryKey: ['working-hours'], queryFn: api.listWorkingHours });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const semGrade = horas.data !== undefined && horas.data.length === 0;

  // Blocos da semana: dia + bloco da grade (sala + período); sessões fora da grade em "Outros horários"
  const blocos = useMemo<Bloco[]>(() => {
    if (!q.data || !horas.data || !profile) return [];
    const out: Bloco[] = [];
    for (const d of dias) {
      const itens = q.data.filter((it) => it.status !== 'cancelado' && zonedParts(it.starts_at, tz).date === d);
      const faixas: WorkingHour[] = horas.data.filter((h) => h.weekday === weekday(d))
        .filter((h) => (locais.data ?? []).find((l) => l.id === h.location_id)?.active !== false)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      const livres = horariosLivres({ date: d, hours: faixas, locations: locais.data ?? [], items: q.data.filter((it) => zonedParts(it.starts_at, tz).date === d),
        sessionMinutes: profile.session_minutes, bufferMinutes: profile.buffer_minutes, tz });
      const usados = new Set<string>();
      const doDia: Bloco[] = [];
      for (const f of faixas) {
        const ini = f.start_time.slice(0, 5); const fim = f.end_time.slice(0, 5);
        const sessoes = itens.filter((it) => {
          const h = formatTime(it.starts_at, tz);
          const ok = !usados.has(it.id) && h >= ini && h < fim && (!it.location_id || it.location_id === f.location_id);
          if (ok) usados.add(it.id);
          return ok;
        });
        // Sessão já registrada (atendida ou falta) sai da agenda: fica no histórico do paciente e no financeiro.
        const linhas: Linha[] = [
          ...sessoes.filter((item) => !registrada(item)).map((item) => ({ tipo: 'sessao' as const, hora: formatTime(item.starts_at, tz), item })),
          ...livres.filter((l) => l.faixaId === f.id).map((livre) => ({ tipo: 'livre' as const, hora: livre.time, livre })),
        ];
        // Quinzenal: o horário do paciente aparece toda semana; o vago das semanas alternadas aparece como
        // "LIVRE · quinzenal" até outro paciente quinzenal ocupá-lo (aí o duplicado some sozinho).
        const mesmaSala = (it: AgendaItem) => !it.location_id || it.location_id === f.location_id;
        const naData = (dt: string, hora: string) => (qx.data ?? []).filter((it) => it.status !== 'cancelado' && zonedParts(it.starts_at, tz).date === dt && formatTime(it.starts_at, tz) === hora && mesmaSala(it));
        const prox = addDays(d, 7);
        for (const item of sessoes.filter((it) => it.series_frequency === 'quinzenal')) {
          const hora = formatTime(item.starts_at, tz);
          if (naData(prox, hora).length === 0)
            linhas.push({ tipo: 'livre', hora, livre: { time: hora, location: (locais.data ?? []).find((l) => l.id === f.location_id) ?? null, minutes: minutesBetween(item.starts_at, item.ends_at), faixaId: f.id }, quinzenal: true, dataAlvo: prox });
        }
        for (const alt of (qx.data ?? []).filter((it) => it.status !== 'cancelado' && it.series_frequency === 'quinzenal' && zonedParts(it.starts_at, tz).date === prox && mesmaSala(it))) {
          const hora = formatTime(alt.starts_at, tz);
          if (hora < ini || hora >= fim || itens.some((it) => it.series_id && it.series_id === alt.series_id)) continue;
          linhas.push({ tipo: 'fantasma', hora, item: alt, proxima: prox });
          const vaga = linhas.find((l) => l.tipo === 'livre' && l.hora === hora);
          if (vaga && vaga.tipo === 'livre') { vaga.quinzenal = true; vaga.dataAlvo = d; }
        }
        linhas.sort((a, b) => a.hora.localeCompare(b.hora) || (a.tipo === 'livre' ? 1 : 0) - (b.tipo === 'livre' ? 1 : 0));
        doDia.push({ chave: `${d}-${f.id}`, date: d, titulo: periodoDe(ini).nome, sala: (locais.data ?? []).find((l) => l.id === f.location_id) ?? null, faixa: `${ini}–${fim}`, linhas });
      }
      // Sessão de outra sala ou on-line sem bloco próprio: entra no mesmo período do dia (com selo); sem período, "Outros horários"
      const outros: Linha[] = [];
      for (const it of itens.filter((x) => !usados.has(x.id) && !registrada(x))) {
        const hora = formatTime(it.starts_at, tz);
        const alvo = doDia.find((b) => b.titulo === periodoDe(hora).nome);
        if (alvo) alvo.linhas = [...alvo.linhas, { tipo: 'sessao' as const, hora, item: it }].sort((a, b) => a.hora.localeCompare(b.hora));
        else outros.push({ tipo: 'sessao' as const, hora, item: it });
      }
      out.push(...doDia.filter((b) => b.linhas.length > 0));
      if (outros.length) out.push({ chave: `${d}-fora`, date: d, titulo: 'Outros horários', sala: null, faixa: null, linhas: outros.sort((a, b) => a.hora.localeCompare(b.hora)) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, qx.data, horas.data, locais.data, profile, tz, semana]);

  // Semana: dias de hoje em diante (e dias passados que tiveram sessão). Dia: só o dia escolhido.
  const colunasBase = agruparColunas(blocos.filter((b) => (visao === 'dia' ? b.date === date : b.date >= hoje || b.linhas.some((l) => l.tipo === 'sessao'))));
  const colunas: Coluna[] = colunasBase;
  const totalAgendadosSemana = blocos.reduce((n, b) => n + b.linhas.filter((l) => l.tipo === 'sessao').length, 0);

  // Alvos do passeio: o primeiro horário livre e o primeiro botão de WhatsApp da tela
  const todasLinhas = colunas.flatMap((c) => c.periodos.flatMap((p) => p.linhas.map((l) => ({ c, l }))));
  const primeiroLivre = todasLinhas.find((x) => x.l.tipo === 'livre');
  const primeiroWhats = todasLinhas.find((x) => x.l.tipo === 'sessao' && !!x.l.item.patient_phone);

  const ir = (d: string, v: Visao = visao) => setParams(v === 'dia' ? { d, v } : { d }, { replace: true });
  const andar = (n: number) => ir(addDays(date, visao === 'dia' ? n : 7 * n));
  const naSemanaAtual = semana === hoje;
  const rotuloData = visao === 'dia'
    ? `${diaNome(date)}, ${Number(date.slice(8))} de ${monthName(Number(date.slice(5, 7)))}`
    : `${ddmm(semana)} a ${ddmm(addDays(semana, 6))}`;
  const subRotulo = visao === 'dia' ? (date === hoje ? 'Hoje' : 'voltar para hoje') : (naSemanaAtual ? 'A partir de hoje' : 'voltar para hoje');

  return (
    <div className="flex flex-col gap-3 pb-6">
      <h1 className="sr-only">Agenda</h1>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      {/* Semana | Dia */}
      <div className="flex gap-1 rounded-cartao border border-linha bg-papel p-1 lg:w-72 lg:shrink-0" role="tablist" aria-label="Visualização da agenda">
        {(['semana', 'dia'] as Visao[]).map((v) => (
          <button key={v} role="tab" aria-selected={visao === v} onClick={() => ir(date, v)}
            className={cx('min-h-11 flex-1 rounded-campo text-[0.9375rem] font-bold', visao === v ? 'btn-degrade' : 'text-tinta-2 hover:bg-afundado')}>
            {v === 'semana' ? 'Semana' : 'Dia'}
          </button>
        ))}
      </div>

      {/* ‹ datas › */}
      <div className="flex items-center gap-1 rounded-cartao border border-linha bg-papel lg:flex-1">
        <button onClick={() => andar(-1)} aria-label={visao === 'dia' ? 'Dia anterior' : 'Semana anterior'} className="grid size-12 shrink-0 place-items-center rounded-cartao text-anil-escuro hover:bg-afundado"><IconChevronLeft /></button>
        <button onClick={() => ir(hoje)} className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center px-1 py-1 text-center leading-tight"
          aria-label={`${rotuloData}. ${subRotulo.startsWith('voltar') ? 'Toque para ' + subRotulo : subRotulo}`}>
          <span className="num text-[1.0625rem] font-extrabold [overflow-wrap:anywhere]">{rotuloData}</span>
          <span className={cx('text-[0.8125rem] font-bold', subRotulo.startsWith('voltar') ? 'text-anil-escuro underline' : 'text-tinta-3')}>{subRotulo}</span>
        </button>
        <button onClick={() => andar(1)} aria-label={visao === 'dia' ? 'Próximo dia' : 'Próxima semana'} className="grid size-12 shrink-0 place-items-center rounded-cartao text-anil-escuro hover:bg-afundado"><IconChevronRight /></button>
      </div>
      </div>

      {/* Dia: os 7 dias da semana para trocar num toque */}
      {visao === 'dia' && (
        <div className="grid grid-cols-7 gap-1" aria-label="Dias da semana">
          {dias.map((d) => {
            const sel = d === date;
            const temAlgo = blocos.some((b) => b.date === d);
            return (
              <button key={d} onClick={() => ir(d)} aria-current={sel ? 'date' : undefined} aria-label={`${diaNome(d)} ${ddmm(d)}${d === hoje ? ', hoje' : ''}${temAlgo ? '' : ', sem horários'}`}
                className={cx('flex min-h-12 min-w-0 flex-col items-center justify-center rounded-campo border leading-tight', sel ? 'btn-degrade border-transparent' : 'border-linha bg-papel', !temAlgo && !sel && 'text-tinta-3', d === hoje && !sel && 'border-anil-escuro')}>
                <span className="text-[0.75rem] font-bold uppercase">{weekdayShort(d)}</span>
                <span className="num text-[1rem] font-extrabold">{Number(d.slice(8))}</span>
              </button>
            );
          })}
        </div>
      )}

      {semGrade && (
        <section className="cartao cartao-boas-vindas flex flex-col gap-3 px-4 pb-4 pt-5">
          <div>
            <strong className="block text-[1.0625rem]">Monte sua grade de horários</strong>
            <span className="text-[0.9375rem] text-tinta-2">Escolha a sala, os dias, o turno, a duração e o intervalo. O app gera os horários, que aparecem aqui prontos para agendar. Dá para mudar ou excluir quando quiser.</span>
          </div>
          <Link to="/agenda/horarios" className="btn-degrade pressionar inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-botao px-5 font-bold"><IconClock /> Criar minha grade</Link>
        </section>
      )}

      {(q.isLoading || horas.isLoading) && <Loading />}
      {(q.error || horas.error) && <ErrorBox>{errorMessage(q.error ?? horas.error)}</ErrorBox>}
      {q.data && horas.data && !semGrade && colunas.length === 0 && (
        <p className="cartao px-4 py-4 text-tinta-2">
          {visao === 'dia' ? 'Sem horários neste dia.' : 'Nada a seguir nesta semana.'}
        </p>
      )}

      {/* Um cartão por dia + sala, com os períodos dentro */}
      <div className="grid items-start gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))]">
        {colunas.map((c, i) => {
          const primeiroDoDia = i === 0 || colunas[i - 1].date !== c.date;
          const ehHoje = c.date === hoje;
          const online = !!c.sala && /online|on-line|virtual|remot/i.test(c.sala.name);
          return (
            <section key={c.chave} id={primeiroDoDia ? `dia-${c.date}` : undefined} aria-label={`${diaNome(c.date)} ${ddmm(c.date)}${c.sala ? `, ${c.sala.name}` : ''}`}
              className={cx('cartao flex min-w-0 scroll-mt-24 flex-col gap-2 p-2.5 sm:p-3', ehHoje && 'ring-2 ring-anil-escuro')}>
              <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-linha pb-2">
                <h2 className={cx('text-[1.0625rem] font-extrabold', ehHoje && 'text-anil-escuro')}>{diaNome(c.date)} <span className="num">{ddmm(c.date)}</span></h2>
                {ehHoje && <span className="rounded-full bg-anil-escuro px-2 py-0.5 text-[0.75rem] font-extrabold uppercase text-sobre-anil">Hoje</span>}
                {c.sala && (
                  <span className="ml-auto inline-flex max-w-full items-center gap-1 rounded-full bg-afundado px-2.5 py-0.5 text-[0.8125rem] font-bold text-tinta-2">
                    {online ? <IconVideo className="size-3.5 shrink-0" aria-hidden /> : <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: c.sala.color ?? 'var(--color-anil)' }} />}
                    <span className="truncate">{c.sala.name}</span>
                  </span>
                )}
              </header>
              {c.periodos.map((p) => (
                <div key={p.titulo} className="flex flex-col gap-1.5">
                  <h3 className="rotulo flex flex-wrap items-baseline gap-x-1.5 text-tinta-3">{p.titulo}{p.faixa && <span className="num font-semibold normal-case tracking-normal">{p.faixa}</span>}</h3>
                  <ul className="flex flex-col gap-1.5">
                    {p.linhas.map((l) => l.tipo === 'livre' ? (
                      <li key={`livre-${l.hora}-${l.livre.faixaId ?? ''}-${l.quinzenal ? 'q' : ''}`}>
                        <button {...(primeiroLivre?.l === l ? { 'data-ajuda': 'livre' } : {})}
                          onClick={() => setNovoEm({ date: l.dataAlvo ?? c.date, time: l.hora, locationId: l.livre.location?.id ?? c.sala?.id ?? null, minutes: l.livre.minutes, modo: 'novo', repeat: l.quinzenal ? 'quinzenal' : undefined })}
                          aria-label={`Horário livre${l.quinzenal ? ' para quinzenal' : ''} às ${l.hora}${c.sala ? `, ${c.sala.name}` : ''}: toque para agendar`}
                          className="pressionar flex min-h-12 w-full items-center gap-3 rounded-campo border-l-4 border-l-ag-livre-borda bg-ag-livre-fundo pl-2.5 pr-3 text-left text-ag-livre hover:brightness-[.97]">
                          <span className="num whitespace-nowrap text-[1.0625rem] font-extrabold">{l.hora}</span>
                          {/* hora à esquerda · LIVRE no meio · botão Agendar à direita (a linha inteira também abre) */}
                          <span className="flex-1 text-center text-[0.8125rem] font-extrabold uppercase tracking-wide">{l.quinzenal ? 'Livre · quinzenal' : 'Livre'}</span>
                          <span aria-hidden className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-ag-livre-borda/45 bg-papel px-3.5 text-[0.875rem] font-bold tracking-[.01em] text-ag-livre shadow-[0_1px_2px_rgb(0_0_0/0.08)]"><IconPlus className="size-3.5" strokeWidth={2.4} />Agendar</span>
                        </button>
                      </li>
                    ) : l.tipo === 'fantasma' ? (
                      // Paciente quinzenal na semana em que não tem sessão: lembrete apagado com a próxima data
                      // Mover e WhatsApp valem para a próxima sessão (sempre disponíveis, como na linha do paciente)
                      <li key={`q-${l.item.id}`} className="flex items-center gap-1 rounded-campo border border-dashed border-ag-pac-borda/40 py-1 pl-2.5 pr-1.5">
                        <button onClick={() => setOpen({ item: l.item })} aria-label={`${l.hora}, ${nomeCurto(l.item.patient_social_name || l.item.patient_name)}, quinzenal, próxima sessão em ${ddmm(l.proxima)}`}
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left opacity-80">
                          <span className="num shrink-0 px-1 text-[1rem] font-extrabold text-tinta-2">{l.hora}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-bold text-tinta-2">{nomeCurto(l.item.patient_social_name || l.item.patient_name)}</span>
                            <span className="block text-[0.8125rem] text-tinta-3">Quinzenal · próxima <span className="num">{ddmm(l.proxima)}</span></span>
                          </span>
                        </button>
                        {(l.item.status === 'agendado' || l.item.status === 'confirmado') && (
                          <button onClick={() => setOpen({ item: l.item, mover: true })} aria-label={`Mover ${nomeCurto(l.item.patient_social_name || l.item.patient_name)} (sessão de ${ddmm(l.proxima)})`} title="Mover (dia, horário ou sala)"
                            className="pressionar grid size-11 shrink-0 place-items-center rounded-full border-[1.5px] border-ag-pac-borda bg-papel text-ag-pac"><IconSwap className="size-5" /></button>
                        )}
                        <button onClick={() => setWhats(l.item)} aria-label={`Enviar WhatsApp para ${nomeCurto(l.item.patient_social_name || l.item.patient_name)} (sessão de ${ddmm(l.proxima)})`} title="Enviar WhatsApp"
                          className="pressionar grid size-11 shrink-0 place-items-center rounded-full bg-[#25D366] text-[#0B3B1E]"><IconWhats className="size-5" /></button>
                      </li>
                    ) : (
                      <LinhaPaciente key={l.item.id} item={l.item} date={c.date} tz={tz}
                        foraDaSala={!!c.sala && (l.item.location_id ? l.item.location_id !== c.sala.id : l.item.modality === 'online')}
                        marcarWhats={primeiroWhats?.l === l}
                        onOpen={() => setOpen({ item: l.item })} onMover={() => setOpen({ item: l.item, mover: true })} onWhats={() => setWhats(l.item)} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          );
        })}
      </div>

      {q.data && horas.data && (
        <PrimeirosPassos passos={[
          { feito: !semGrade, texto: 'Criar meus horários', para: '/agenda/horarios' },
          { feito: (dash.data?.active_patients ?? 0) > 0 || totalAgendadosSemana > 0, texto: 'Agendar o primeiro paciente', acao: () => setNovoEm({ date: hoje, modo: 'novo' }) },
          { feito: totalAgendadosSemana > 0, texto: 'Ver o agendamento aqui na agenda', acao: () => ir(hoje, 'semana') },
          { feito: lerFlag(FLAG_WHATS_ENVIADO), texto: 'Enviar a confirmação pelo WhatsApp', acao: () => ir(hoje, 'semana') },
        ]} />
      )}

      {!passeioPerguntado && !semGrade && q.data && (
        <section className="cartao flex flex-col gap-2 px-4 py-3" aria-label="Passeio pela agenda">
          <p className="text-[0.9375rem]"><b>Quer um passeio de 1 minuto pela agenda?</b> Dá para refazer depois em Mais → Ajuda.</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={() => { gravarFlag(FLAG_PASSEIO_OFERECIDO); setPasseioPerguntado(true); }} className="min-h-11 px-2 text-sm font-bold text-tinta-3">Agora não</button>
            <button onClick={() => { gravarFlag(FLAG_PASSEIO_OFERECIDO); setPasseioPerguntado(true); setTimeout(() => iniciarPasseio('agenda'), 100); }} className="btn-degrade min-h-11 rounded-botao px-4 text-sm font-bold">Fazer o passeio</button>
          </div>
        </section>
      )}

      {/* Ações da agenda (pedido do Jorge, 27/10): Prontuário no lugar de Editar grade (a Grade foi para o rodapé)
          e Dar alta no lugar do Encaixe (o Encaixe foi para o Resumo do dia) */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/prontuario"
          className="pressionar flex min-h-14 items-center justify-center gap-2 whitespace-nowrap rounded-cartao border border-linha bg-papel px-3 text-[0.9375rem] font-extrabold text-tinta shadow-cartao hover:border-anil">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-anil-claro text-sobre-anil-claro"><IconDoc className="size-[1.125rem]" /></span>
          Prontuário
        </Link>
        <button onClick={() => setAlta(true)}
          className="pressionar flex min-h-14 items-center justify-center gap-2 whitespace-nowrap rounded-cartao border border-anil/30 bg-anil px-3 text-[0.9375rem] font-extrabold text-sobre-anil shadow-elevado hover:brightness-110">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-sobre-anil/15"><IconCheck className="size-[1.125rem]" strokeWidth={2.4} /></span>
          Dar alta
        </button>
      </div>
      <DarAltaDialog open={alta} onClose={() => setAlta(false)} />

      <AppointmentSheet item={open?.item ?? null} mover={open?.mover} onClose={() => setOpen(null)} />
      <WhatsAppCard key={whats?.id ?? 'nenhum'} item={whats} onClose={() => setWhats(null)} onMover={(item) => setOpen({ item, mover: true })} />
      <NewAppointmentDialog open={!!novoEm} onClose={() => setNovoEm(null)} initialDate={novoEm?.date} initialTime={novoEm?.time}
        initialLocationId={novoEm?.locationId ?? null} initialMinutes={novoEm?.minutes} initialModo={novoEm?.modo} initialRepeat={novoEm?.repeat} encaixe={novoEm?.encaixe} />
    </div>
  );
}

/** Paciente em uma linha: hora + nome (prioridade) e "Situação · modalidade · idade"; Mover e WhatsApp ao lado.
 *  Tocar no paciente abre todas as opções (registrar atendida, falta, cancelar, lembrete, editar). */
function LinhaPaciente({ item, date, tz, onOpen, onMover, onWhats, foraDaSala, marcarWhats }: { item: AgendaItem; date: string; tz: string; onOpen: () => void; onMover: () => void; onWhats: () => void; foraDaSala?: boolean; marcarWhats?: boolean }) {
  const nome = nomeCurto(item.patient_social_name || item.patient_name);
  const nasc = item.patient_birth_date ?? null;
  const idade = nasc ? ageOn(nasc, date) : null;
  const aniversario = !!nasc && nasc.slice(5) === date.slice(5);
  const ativa = item.status === 'agendado' || item.status === 'confirmado';
  const s = SITUACAO[item.status];
  const modalidade = item.modality === 'online' ? 'On-line' : foraDaSala ? item.location_name ?? 'Outra sala' : 'Presencial';
  return (
    <li className={cx('flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-campo border-l-4 py-1 pl-2.5 pr-1.5', s.linha)}>
      <button onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 basis-[7.5rem] items-center gap-2 py-0.5 text-left" aria-label={`${formatTime(item.starts_at, tz)}, ${nome}, ${s.rotulo}. Abrir detalhes`}>
        {/* Hora; sessão on-line ganha o selo 📹 On-line logo abaixo da hora */}
        <span className="flex shrink-0 flex-col items-center gap-0.5">
          <span className="num rounded-md bg-papel/80 px-1 py-0.5 text-[1rem] font-extrabold text-tinta">{formatTime(item.starts_at, tz)}</span>
          {item.modality === 'online' && <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-azul-fundo px-1.5 text-[0.6875rem] font-bold leading-[1.125rem] text-azul"><IconVideo className="size-3" aria-hidden />On-line</span>}
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1 text-[1rem] font-bold leading-tight text-tinta">
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{nome}</span>
            {aniversario && <IconCake className="size-4 shrink-0 text-acento" aria-label={`Aniversário hoje (${formatDate(nasc).slice(0, 5)})`} role="img" />}
          </span>
          <span className="block text-[0.8125rem] leading-snug text-tinta-2">
            <b className={cx('font-bold', s.texto)}>{item.status === 'confirmado' && <IconCheck className="mr-0.5 inline size-3.5 align-[-2px]" aria-hidden />}{s.rotulo}</b>
            {item.modality !== 'online' && <>{' · '}<span>{modalidade}</span></>}
            {item.series_frequency === 'quinzenal' && <>{' · '}<span className="whitespace-nowrap font-bold text-ag-pac">Quinzenal</span></>}
            {idade != null && <>{' · '}<span className="whitespace-nowrap">{idade} anos</span></>}
          </span>
        </span>
      </button>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {ativa && (
          <button onClick={onMover} aria-label={`Mover ${nome}`} title="Mover (dia, horário ou sala)"
            className="pressionar grid size-11 place-items-center rounded-full border-[1.5px] border-ag-pac-borda bg-papel text-ag-pac"><IconSwap className="size-5" /></button>
        )}
        {/* WhatsApp sempre visível (pedido do Jorge, 27/10): sem celular, o cartão oferece copiar a mensagem */}
        <button onClick={onWhats} {...(marcarWhats ? { 'data-ajuda': 'whats' } : {})} aria-label={`Enviar WhatsApp para ${nome}`} title={aniversario ? 'WhatsApp: parabéns + lembrete' : 'Enviar WhatsApp'}
          className="pressionar grid size-11 place-items-center rounded-full bg-[#25D366] text-[#0B3B1E]"><IconWhats className="size-5" /></button>
      </span>
    </li>
  );
}

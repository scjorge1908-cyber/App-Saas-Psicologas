// Agenda no formato do app da Hope: semana (ou dia), cartão "Hoje", botão para montar a agenda
// e um card por dia dividido em Manhã / Tarde / Noite, com os horários livres prontos para cadastrar paciente.
// A agenda nasce dos horários de atendimento (tela Meus horários): sem eles, não há horários livres.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { AgendaItem, Location, WorkingHour } from '../lib/types';
import { horariosLivres, type HorarioLivre } from '../lib/horarios';
import { periodoDe } from '../lib/periodos';
import { addDays, formatTime, monthName, startOfWeek, todayIn, weekday, weekdayName, zonedParts, zonedToUtc } from '../lib/format';
import { whatsappLink } from '../lib/messages';
import { errorMessage } from '../lib/errors';
import { useProfile } from '../auth/AuthProvider';
import { AppointmentSheet } from '../components/appointments/AppointmentSheet';
import { NewAppointmentDialog } from '../components/appointments/NewAppointmentDialog';
import { ErrorBox, Loading, STATUS_BAR, STATUS_LABEL, cx } from '../components/ui';
import { IconAlert, IconChevronLeft, IconChevronRight, IconClock, IconPlus, IconToday, IconWhats } from '../components/icons';

type View = 'semana' | 'dia';
type NovoEm = { date: string; time?: string; locationId?: string | null; minutes?: number; modo?: 'novo' | 'existente' };

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const diaCurto = (d: string) => { const n = weekdayName(d).replace('-feira', ''); return n[0].toUpperCase() + n.slice(1); };

export function AgendaPage() {
  const { profile, tz } = useProfile();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('v') === 'dia' ? 'dia' : 'semana';
  const hoje = todayIn(tz);
  const date = params.get('d') || hoje;
  const [open, setOpen] = useState<AgendaItem | null>(null);
  const [novoEm, setNovoEm] = useState<NovoEm | null>(null);
  const set = (v: View, d: string) => setParams({ v, d }, { replace: true });

  const inicio = view === 'dia' ? date : startOfWeek(date);
  const dias = view === 'dia' ? [date] : Array.from({ length: 7 }, (_, i) => addDays(inicio, i));
  const fromIso = zonedToUtc(inicio, '00:00', tz);
  const toIso = zonedToUtc(addDays(inicio, dias.length), '00:00', tz);

  const q = useQuery({ queryKey: ['agenda', fromIso, toIso], queryFn: () => api.listAgenda(fromIso, toIso) });
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations });
  const horas = useQuery({ queryKey: ['working-hours'], queryFn: api.listWorkingHours });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const semHorarios = horas.data !== undefined && horas.data.length === 0;

  const porDia = useMemo(() => {
    const m = new Map<string, AgendaItem[]>();
    for (const it of q.data ?? []) {
      if (it.status === 'cancelado') continue;
      const d = zonedParts(it.starts_at, tz).date;
      m.set(d, [...(m.get(d) ?? []), it]);
    }
    return m;
  }, [q.data, tz]);

  const livresDo = (d: string): HorarioLivre[] => !horas.data || !profile ? [] : horariosLivres({
    date: d, hours: horas.data, locations: locais.data ?? [], items: porDia.get(d) ?? [],
    sessionMinutes: profile.session_minutes, bufferMinutes: profile.buffer_minutes, tz,
  });

  // Próximo atendimento de hoje (cartão "Hoje")
  const agora = Date.now();
  const proximo = (porDia.get(hoje) ?? []).filter((i) => new Date(i.ends_at).getTime() > agora).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const rotuloPeriodo = view === 'dia'
    ? `${diaCurto(date)}, ${ddmm(date)}`
    : `${ddmm(inicio)} a ${ddmm(addDays(inicio, 6))}`;

  // Na semana, mostra só os dias com atendimento cadastrado ou com sessão
  const diasVisiveis = dias.filter((d) => view === 'dia'
    || (porDia.get(d)?.length ?? 0) > 0
    || (d >= hoje && (horas.data ?? []).some((h) => h.weekday === weekday(d))));

  return (
    <div className="flex flex-col gap-3 pb-6">
      {/* Semana | Dia */}
      <div role="tablist" aria-label="Visualização" className="cartao grid grid-cols-2 gap-1 p-1">
        {([['semana', 'Semana'], ['dia', 'Dia']] as Array<[View, string]>).map(([v, r]) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => set(v, date)}
            className={cx('min-h-12 rounded-[calc(var(--r-lg)-4px)] text-[16px] font-bold', view === v ? 'btn-degrade shadow-cartao' : 'text-tinta-2')}>{r}</button>
        ))}
      </div>

      {/* Navegação do período */}
      <div className="cartao flex items-center justify-between px-1">
        <button onClick={() => set(view, addDays(date, view === 'dia' ? -1 : -7))} aria-label="Anterior" className="grid size-12 place-items-center rounded-full text-tinta-2 hover:bg-cinza-fundo"><IconChevronLeft /></button>
        <span className="num text-[18px] font-bold">{rotuloPeriodo}</span>
        <button onClick={() => set(view, addDays(date, view === 'dia' ? 1 : 7))} aria-label="Próximo" className="grid size-12 place-items-center rounded-full text-tinta-2 hover:bg-cinza-fundo"><IconChevronRight /></button>
      </div>

      {/* Hoje */}
      <section className="cartao flex items-center gap-3 border-l-4 border-l-anil py-3 pl-4 pr-3">
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-bold leading-snug">Hoje, {weekdayName(hoje).replace('-feira', '')}, {Number(hoje.slice(8))} de {monthName(Number(hoje.slice(5, 7))).slice(0, 3)}</p>
          <p className="text-[15px] text-tinta-2">{proximo
            ? `Próximo: ${proximo.patient_social_name || proximo.patient_name} às ${formatTime(proximo.starts_at, tz)}`
            : 'Nenhum atendimento a seguir hoje.'}</p>
        </div>
        {!(view === 'dia' && date === hoje) && (
          <button onClick={() => set('dia', hoje)} className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-botao border-[1.5px] border-anil-escuro px-3.5 font-bold text-anil-escuro hover:bg-anil-claro/50">
            <IconToday className="size-5" /> Ver hoje
          </button>
        )}
      </section>

      {/* Montar / editar a agenda */}
      <div className="flex items-center gap-3">
        <Link to="/agenda/horarios" className="btn-degrade pressionar inline-flex min-h-12 items-center gap-2 rounded-botao px-4 font-bold shadow-cartao">
          <IconClock className="size-5" /> Meus horários
        </Link>
        <button onClick={() => setNovoEm({ date: view === 'dia' ? date : hoje, modo: 'existente' })} className="ml-auto inline-flex min-h-12 items-center gap-1.5 px-2 font-bold text-anil-escuro underline-offset-4 hover:underline">
          <IconPlus className="size-5" /> Agendar
        </button>
      </div>

      {semHorarios && (
        <section className="cartao cartao-boas-vindas flex flex-col gap-3 px-4 pb-4 pt-5">
          <div>
            <strong className="block text-[17px]">Monte sua agenda</strong>
            <span className="text-[15px] text-tinta-2">Escolha a sala, os dias e o período (manhã, tarde ou noite). O app cria os horários e eles aparecem aqui como livres, prontos para cadastrar paciente. Você pode incluir, mudar ou excluir quando quiser.</span>
          </div>
          <Link to="/agenda/horarios?novo=1" className="btn-degrade pressionar inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-botao px-5 font-bold"><IconClock /> Criar meus horários</Link>
        </section>
      )}

      {dash.data && dash.data.to_register > 0 && (
        <Link to="/resumo#registrar" className="flex min-h-12 items-center gap-2 rounded-campo bg-ocre-fundo px-4 py-2 text-[15px] font-bold text-ocre">
          <IconAlert className="size-5 shrink-0" />
          <span className="flex-1">{dash.data.to_register} {dash.data.to_register === 1 ? 'sessão aguarda' : 'sessões aguardam'} registro</span>
          <IconChevronRight className="size-5 shrink-0" />
        </Link>
      )}

      {(q.isLoading || horas.isLoading) && <Loading />}
      {(q.error || horas.error) && <ErrorBox>{errorMessage(q.error ?? horas.error)}</ErrorBox>}

      {q.data && horas.data && diasVisiveis.length === 0 && !semHorarios && (
        <p className="cartao px-4 py-4 text-tinta-2">Nenhum atendimento nesta semana.</p>
      )}

      {q.data && horas.data && diasVisiveis.map((d) => (
        <DiaCard key={d} date={d} hoje={hoje} tz={tz} items={porDia.get(d) ?? []}
          faixas={horas.data.filter((h) => h.weekday === weekday(d))} locais={locais.data ?? []} livres={livresDo(d)}
          onOpen={setOpen}
          onLivre={(h) => setNovoEm({ date: d, time: h.time, locationId: h.location?.id ?? null, minutes: h.minutes, modo: 'novo' })}
          onAgendar={() => setNovoEm({ date: d, modo: 'existente' })} />
      ))}

      <AppointmentSheet item={open} onClose={() => setOpen(null)} />
      <NewAppointmentDialog open={!!novoEm} onClose={() => setNovoEm(null)} initialDate={novoEm?.date} initialTime={novoEm?.time}
        initialLocationId={novoEm?.locationId ?? null} initialMinutes={novoEm?.minutes} initialModo={novoEm?.modo} />
    </div>
  );
}

type Linha = { tipo: 'sessao'; hora: string; item: AgendaItem } | { tipo: 'livre'; hora: string; livre: HorarioLivre };
type Grupo = { chave: string; titulo: string; linhas: Linha[] };

/** Card de um dia: cabeçalho com HOJE e salas; grupos Manhã/Tarde/Noite com sessões e horários livres. */
function DiaCard({ date, hoje, tz, items, faixas, locais, livres, onOpen, onLivre, onAgendar }: {
  date: string; hoje: string; tz: string; items: AgendaItem[]; faixas: WorkingHour[]; locais: Location[]; livres: HorarioLivre[];
  onOpen: (i: AgendaItem) => void; onLivre: (h: HorarioLivre) => void; onAgendar: () => void;
}) {
  const blocos = faixas
    .map((f) => ({ f, local: locais.find((l) => l.id === f.location_id) ?? null }))
    .filter((b) => b.local?.active !== false)
    .sort((a, b) => a.f.start_time.localeCompare(b.f.start_time));
  const salas = [...new Map(blocos.map((b) => [b.f.location_id, b.local])).values()].filter(Boolean) as Location[];
  const variasSalas = salas.length > 1;

  const usados = new Set<string>();
  const grupos: Grupo[] = [];
  for (const { f, local } of blocos) {
    const ini = f.start_time.slice(0, 5); const fim = f.end_time.slice(0, 5);
    const sessoes = items.filter((it) => {
      const h = formatTime(it.starts_at, tz);
      const ok = !usados.has(it.id) && h >= ini && h < fim && (!it.location_id || it.location_id === f.location_id);
      if (ok) usados.add(it.id);
      return ok;
    });
    const linhas: Linha[] = [
      ...sessoes.map((item) => ({ tipo: 'sessao' as const, hora: formatTime(item.starts_at, tz), item })),
      ...livres.filter((l) => l.faixaId === f.id).map((livre) => ({ tipo: 'livre' as const, hora: livre.time, livre })),
    ].sort((x, y) => x.hora.localeCompare(y.hora));
    if (linhas.length === 0) continue; // período que já passou sem sessões: não ocupa espaço
    grupos.push({ chave: f.id, titulo: `${periodoDe(ini).nome}${variasSalas ? ` · ${local?.name ?? ''}` : ''}`, linhas });
  }
  const fora = items.filter((it) => !usados.has(it.id)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (fora.length > 0) grupos.unshift({ chave: 'fora', titulo: 'Outros horários', linhas: fora.map((item) => ({ tipo: 'sessao' as const, hora: formatTime(item.starts_at, tz), item })) });

  const ehHoje = date === hoje;
  return (
    <section className={cx('cartao px-4 pb-3 pt-3.5', ehHoje && 'ring-2 ring-anil-escuro')} aria-label={`${diaCurto(date)} ${ddmm(date)}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-linha pb-2.5">
        <h2 className="num text-[19px] font-bold">{diaCurto(date)} {ddmm(date)}</h2>
        {ehHoje && <span className="rounded-full bg-anil-escuro px-2.5 py-0.5 text-[12px] font-extrabold uppercase tracking-wide text-sobre-anil">Hoje</span>}
        {!variasSalas && salas[0] && <span className="rounded-full bg-cinza-fundo px-2.5 py-0.5 text-sm font-bold text-tinta-2">{salas[0].name}</span>}
      </header>

      {grupos.length === 0 ? (
        <div className="flex items-center justify-between gap-2 pt-3">
          <p className="text-tinta-2">{blocos.length > 0 ? 'Nenhum horário a seguir.' : 'Sem atendimento neste dia.'}</p>
          {date >= hoje && <button onClick={onAgendar} className="min-h-11 px-2 font-bold text-anil-escuro">Agendar</button>}
        </div>
      ) : grupos.map((g) => (
        <div key={g.chave} className="mt-3">
          <p className="rotulo mb-2">{g.titulo}</p>
          <ol className="flex flex-col gap-2">
            {g.linhas.map((l) => l.tipo === 'livre' ? (
              <li key={`l-${g.chave}-${l.hora}`} className="flex min-h-14 items-center gap-2 rounded-campo border-l-4 border-l-livre bg-livre-fundo py-2 pl-3 pr-2">
                <span className="num w-14 shrink-0 text-[17px] font-bold text-livre">{l.hora}</span>
                <span className="flex-1 text-[13px] font-extrabold uppercase tracking-wide text-livre">Livre</span>
                <button onClick={() => onLivre(l.livre)} className="btn-degrade pressionar inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold">
                  <IconPlus className="size-4" /> Cadastrar paciente
                </button>
              </li>
            ) : (
              <li key={l.item.id} className={cx('flex min-h-16 items-center gap-3 rounded-campo border-l-4 bg-afundado/60 py-2 pl-3 pr-2', STATUS_BAR[l.item.status])}>
                <button onClick={() => onOpen(l.item)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="num shrink-0 rounded-campo bg-papel px-2.5 py-1.5 text-[16px] font-bold shadow-cartao">{l.hora}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[16px] font-bold uppercase">{l.item.patient_social_name || l.item.patient_name}</span>
                    <span className="block truncate text-sm text-tinta-2">{STATUS_LABEL[l.item.status]} · {l.item.modality === 'online' ? 'On-line' : l.item.location_name ?? 'Presencial'}</span>
                  </span>
                </button>
                {l.item.patient_phone && (
                  <a href={whatsappLink(l.item.patient_phone, `Olá, ${(l.item.patient_social_name || l.item.patient_name).split(' ')[0]}!`) ?? undefined}
                    target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp de ${l.item.patient_name}`}
                    className="grid size-12 shrink-0 place-items-center rounded-full bg-livre text-sobre-status"><IconWhats /></a>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

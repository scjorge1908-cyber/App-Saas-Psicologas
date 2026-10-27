// Agenda diária por período (layout Stitch aprovado por Jorge, com as cores e a marca do PsiConsultório):
// cartão do consultório ativo, faixa de dias da semana, abas Manhã/Tarde/Noite e um card por horário.
// A agenda nasce da grade (tela Meus horários): sem grade, não há horários livres.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { AgendaItem, Location } from '../lib/types';
import { horariosLivres, type HorarioLivre } from '../lib/horarios';
import { PERIODOS, periodoDe, type PeriodoId } from '../lib/periodos';
import { addDays, ageOn, firstName, formatDate, formatTime, minutesBetween, monthName, startOfWeek, todayIn, weekday, weekdayShort, zonedParts, zonedToUtc } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { whatsappLink } from '../lib/messages';
import { useProfile } from '../auth/AuthProvider';
import { AppointmentSheet, openReminder } from '../components/appointments/AppointmentSheet';
import { NewAppointmentDialog } from '../components/appointments/NewAppointmentDialog';
import { ErrorBox, Loading, STATUS_BAR, StatusBadge, cx, useToast } from '../components/ui';
import {
  IconAlert, IconCake, IconChevronLeft, IconChevronRight, IconCircleCheck, IconClock, IconDoor, IconDots, IconMoon, IconPlus,
  IconSun, IconSunset, IconSwap, IconUserPlus, IconWhats,
} from '../components/icons';

type NovoEm = { date: string; time?: string; locationId?: string | null; minutes?: number; modo?: 'novo' | 'existente' };
const ICONE_PERIODO: Record<PeriodoId, typeof IconSun> = { manha: IconSun, tarde: IconSunset, noite: IconMoon };
const hh = (t: string) => `${Number(t.slice(0, 2))}h`;

export function AgendaPage() {
  const { profile, tz } = useProfile();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const hoje = todayIn(tz);
  const date = params.get('d') || hoje;
  const [salaId, setSalaId] = useState<string>(''); // '' = todas as salas
  const [periodoEscolhido, setPeriodoEscolhido] = useState<PeriodoId | null>(null);
  const [open, setOpen] = useState<AgendaItem | null>(null);
  const [novoEm, setNovoEm] = useState<NovoEm | null>(null);
  const irPara = (d: string) => { setParams({ d }, { replace: true }); setPeriodoEscolhido(null); };

  const semana = startOfWeek(date);
  const diasSemana = Array.from({ length: 7 }, (_, i) => addDays(semana, i));
  const fromIso = zonedToUtc(semana, '00:00', tz);
  const toIso = zonedToUtc(addDays(semana, 7), '00:00', tz);

  const q = useQuery({ queryKey: ['agenda', fromIso, toIso], queryFn: () => api.listAgenda(fromIso, toIso) });
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations });
  const horas = useQuery({ queryKey: ['working-hours'], queryFn: api.listWorkingHours });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const semGrade = horas.data !== undefined && horas.data.length === 0;

  const salasAtivas = (locais.data ?? []).filter((l) => l.active);
  const sala: Location | null = salasAtivas.find((l) => l.id === salaId) ?? null;
  const daSala = (locId: string | null | undefined) => !sala || !locId || locId === sala.id;

  const doDia = useMemo(
    () => (q.data ?? []).filter((it) => it.status !== 'cancelado' && zonedParts(it.starts_at, tz).date === date && daSala(it.location_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.data, tz, date, salaId, locais.data],
  );
  const faixasDia = (horas.data ?? []).filter((h) => h.weekday === weekday(date) && daSala(h.location_id));
  const livres: HorarioLivre[] = !horas.data || !profile ? [] : horariosLivres({
    date, hours: faixasDia, locations: locais.data ?? [], items: (q.data ?? []).filter((it) => zonedParts(it.starts_at, tz).date === date),
    sessionMinutes: profile.session_minutes, bufferMinutes: profile.buffer_minutes, tz,
  });

  // Resumo por período (para as abas) e período padrão: o atual, se for hoje; senão o primeiro com algo
  const resumo = PERIODOS.map((p) => {
    const ocupados = doDia.filter((it) => periodoDe(formatTime(it.starts_at, tz)).id === p.id).length;
    const nLivres = livres.filter((l) => periodoDe(l.time).id === p.id).length;
    const faixas = faixasDia.filter((f) => periodoDe(f.start_time).id === p.id);
    const ini = faixas.length ? faixas.map((f) => f.start_time).sort()[0] : p.inicio;
    const fim = faixas.length ? faixas.map((f) => f.end_time).sort().slice(-1)[0] : p.fim;
    return { ...p, ocupados, livres: nLivres, temGrade: faixas.length > 0, ini, fim };
  });
  const agoraHora = formatTime(new Date().toISOString(), tz);
  const padrao = (date === hoje && resumo.find((r) => r.id === periodoDe(agoraHora).id && (r.ocupados + r.livres) > 0))
    || resumo.find((r) => r.ocupados + r.livres > 0) || resumo[0];
  const periodo = periodoEscolhido ?? padrao.id;

  const cards = [
    ...doDia.filter((it) => periodoDe(formatTime(it.starts_at, tz)).id === periodo).map((item) => ({ tipo: 'sessao' as const, hora: formatTime(item.starts_at, tz), item })),
    ...livres.filter((l) => periodoDe(l.time).id === periodo).map((livre) => ({ tipo: 'livre' as const, hora: livre.time, livre })),
  ].sort((a, b) => a.hora.localeCompare(b.hora));

  const totalAgendados = doDia.length;
  const totalLivres = livres.length;

  async function enviarWhatsApp(item: AgendaItem) {
    const janela = window.open('', '_blank'); // abre já no toque, para o navegador não bloquear
    try {
      const r = await openReminder(item, tz, profile?.full_name ?? '');
      const nasc = item.patient_birth_date;
      const aniversario = !!nasc && nasc.slice(5) === zonedParts(item.starts_at, tz).date.slice(5);
      const wa = aniversario
        ? whatsappLink(item.patient_phone, `Feliz aniversário, ${firstName(item.patient_social_name || item.patient_name)}! Desejo um dia muito especial.\n\n${r.text}`)
        : r.wa;
      if (!wa) { janela?.close(); toast('Paciente sem celular cadastrado.', 'erro'); return; }
      if (janela) janela.location.href = wa; else window.location.href = wa;
    } catch (e) { janela?.close(); toast(errorMessage(e), 'erro'); }
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* Consultório ativo */}
      <section className="cartao flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-campo bg-anil-claro text-sobre-anil-claro"><IconDoor /></span>
          <div className="min-w-0 flex-1">
            <p className="rotulo text-anil-escuro">Consultório ativo · {date === hoje ? 'Hoje' : formatDate(date).slice(0, 5)}</p>
            <p className="truncate text-[19px] font-bold leading-snug">{sala?.name ?? (salasAtivas.length > 1 ? 'Todas as salas' : salasAtivas[0]?.name ?? 'Minha agenda')}{profile?.full_name ? ` · ${profile.full_name.split(' ')[0]}` : ''}</p>
          </div>
          {salasAtivas.length > 1 && (
            <button onClick={() => { const ids = ['', ...salasAtivas.map((l) => l.id)]; setSalaId(ids[(ids.indexOf(salaId) + 1) % ids.length]); }}
              aria-label="Trocar sala" title="Trocar sala" className="grid size-12 shrink-0 place-items-center rounded-full bg-afundado text-tinta-2 hover:bg-cinza-fundo"><IconSwap /></button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-anil-claro px-3 text-sm font-bold text-sobre-anil-claro"><span className="size-1.5 rounded-full bg-current" />{totalAgendados} {totalAgendados === 1 ? 'agendado' : 'agendados'}</span>
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-livre-fundo px-3 text-sm font-bold text-livre"><span className="size-1.5 rounded-full bg-current" />{totalLivres} {totalLivres === 1 ? 'livre' : 'livres'}</span>
          <span className="ml-auto inline-flex items-center gap-1 text-sm text-tinta-2">
            {faixasDia.length > 0 ? <><IconCircleCheck className="size-4 text-livre" /> Grade ativa</> : 'Sem grade neste dia'}
          </span>
        </div>
      </section>

      {/* Dias da semana */}
      <div className="flex items-center gap-1">
        <button onClick={() => irPara(addDays(date, -7))} aria-label="Semana anterior" className="grid size-10 shrink-0 place-items-center rounded-full text-tinta-2 hover:bg-cinza-fundo"><IconChevronLeft /></button>
        <div className="flex flex-1 gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Dia">
          {diasSemana.map((d) => {
            const sel = d === date;
            const temAlgo = (horas.data ?? []).some((h) => h.weekday === weekday(d)) || (q.data ?? []).some((it) => it.status !== 'cancelado' && zonedParts(it.starts_at, tz).date === d);
            return (
              <button key={d} role="tab" aria-selected={sel} onClick={() => irPara(d)}
                className={cx('flex min-w-[54px] flex-1 flex-col items-center rounded-cartao border py-2 leading-tight', sel ? 'btn-degrade border-transparent shadow-elevado' : 'border-linha bg-papel', !temAlgo && !sel && 'opacity-55')}>
                <span className="text-[12px] font-bold uppercase">{weekdayShort(d)}</span>
                <span className="num text-[20px] font-extrabold">{Number(d.slice(8))}</span>
                <span className="text-[12px] capitalize">{monthName(Number(d.slice(5, 7))).slice(0, 3)}</span>
                {d === hoje && !sel && <span className="mt-0.5 size-1.5 rounded-full bg-anil" aria-label="hoje" />}
              </button>
            );
          })}
        </div>
        <button onClick={() => irPara(addDays(date, 7))} aria-label="Próxima semana" className="grid size-10 shrink-0 place-items-center rounded-full text-tinta-2 hover:bg-cinza-fundo"><IconChevronRight /></button>
      </div>

      {semGrade && (
        <section className="cartao cartao-boas-vindas flex flex-col gap-3 px-4 pb-4 pt-5">
          <div>
            <strong className="block text-[17px]">Monte sua grade de horários</strong>
            <span className="text-[15px] text-tinta-2">Escolha a sala, os dias, o turno, a duração e o intervalo. O app gera os horários, que aparecem aqui prontos para agendar. Dá para mudar ou excluir quando quiser.</span>
          </div>
          <Link to="/agenda/horarios" className="btn-degrade pressionar inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-botao px-5 font-bold"><IconClock /> Criar minha grade</Link>
        </section>
      )}

      {/* Turnos */}
      {!semGrade && (
        <div role="tablist" aria-label="Turno" className="grid grid-cols-3 gap-1 rounded-cartao bg-anil-claro/60 p-1.5">
          {resumo.map((r) => {
            const Icone = ICONE_PERIODO[r.id];
            const sel = r.id === periodo;
            return (
              <button key={r.id} role="tab" aria-selected={sel} onClick={() => setPeriodoEscolhido(r.id)}
                className={cx('flex flex-col items-center gap-0.5 rounded-[calc(var(--r-lg)-4px)] px-1 py-2', sel ? 'bg-papel shadow-cartao' : 'text-tinta-2')}>
                <span className={cx('inline-flex items-center gap-1 font-bold', sel && 'text-anil-escuro')}><Icone className="size-[18px]" /> {r.nome}</span>
                <span className="num text-[13px]">{hh(r.ini)} – {hh(r.fim)}</span>
                <span className={cx('mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold', r.ocupados + r.livres > 0 ? 'bg-livre-fundo text-livre' : 'bg-cinza-fundo text-tinta-3')}>
                  {!r.temGrade && r.ocupados === 0 ? 'Sem grade' : r.ocupados + r.livres === 0 ? 'Encerrado' : r.ocupados ? `${r.ocupados} ocup. · ${r.livres} livre${r.livres === 1 ? '' : 's'}` : `${r.livres} livre${r.livres === 1 ? '' : 's'}`}
                </span>
              </button>
            );
          })}
        </div>
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

      {q.data && horas.data && !semGrade && cards.length === 0 && (
        <p className="cartao px-4 py-4 text-tinta-2">
          {resumo.find((r) => r.id === periodo)?.temGrade ? 'Nenhum horário a seguir neste turno.' : 'Sem grade neste turno. Use “Editar grade” para criar.'}
        </p>
      )}

      {/* Cards dos horários */}
      <ol className="flex flex-col gap-3">
        {cards.map((c) => c.tipo === 'sessao' ? (
          <li key={c.item.id}><CardSessao item={c.item} date={date} tz={tz} onOpen={() => setOpen(c.item)} onWhats={() => enviarWhatsApp(c.item)} /></li>
        ) : (
          <li key={`livre-${c.hora}-${c.livre.location?.id ?? ''}`}>
            <section className="cartao border-l-4 border-l-livre p-4">
              <div className="flex items-center gap-2">
                <span className="num inline-flex items-center gap-1.5 rounded-campo bg-afundado px-2.5 py-1.5 text-[17px] font-bold"><IconClock className="size-[18px]" />{c.hora}</span>
                <span className="text-sm text-tinta-2">{c.livre.minutes ?? profile?.session_minutes ?? 50} min</span>
                <span className="ml-auto inline-flex h-7 items-center gap-1 rounded-full bg-livre-fundo px-2.5 text-[12px] font-bold text-livre">Horário disponível</span>
              </div>
              <div className="mt-3 flex items-center gap-3 rounded-campo bg-afundado px-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-livre-fundo text-livre"><IconPlus className="size-5" /></span>
                <span className="min-w-0">
                  <span className="block font-bold">Vaga aberta na grade</span>
                  <span className="block text-sm text-tinta-2">{c.livre.location?.name ? `${c.livre.location.name} · ` : ''}Pronto para novo atendimento</span>
                </span>
              </div>
              <button onClick={() => setNovoEm({ date, time: c.hora, locationId: c.livre.location?.id ?? null, minutes: c.livre.minutes, modo: 'novo' })}
                className="btn-degrade pressionar mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-botao font-bold">
                <IconUserPlus className="size-5" /> Agendar paciente
              </button>
            </section>
          </li>
        ))}
      </ol>

      {/* Ações da agenda */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/agenda/horarios" className="cartao pressionar inline-flex min-h-14 items-center justify-center gap-2 font-bold text-anil-escuro"><IconClock className="size-5" /> Editar grade</Link>
        <button onClick={() => setNovoEm({ date, modo: 'existente' })} className="btn-degrade pressionar inline-flex min-h-14 items-center justify-center gap-2 rounded-cartao font-bold shadow-elevado"><IconPlus className="size-5" /> Adicionar encaixe</button>
      </div>

      <AppointmentSheet item={open} onClose={() => setOpen(null)} />
      <NewAppointmentDialog open={!!novoEm} onClose={() => setNovoEm(null)} initialDate={novoEm?.date} initialTime={novoEm?.time}
        initialLocationId={novoEm?.locationId ?? null} initialMinutes={novoEm?.minutes} initialModo={novoEm?.modo} />
    </div>
  );
}

/** Card de uma sessão marcada: hora e duração, situação, paciente (idade, nascimento, cobrança) e ações. */
function CardSessao({ item, date, tz, onOpen, onWhats }: { item: AgendaItem; date: string; tz: string; onOpen: () => void; onWhats: () => void }) {
  const nome = item.patient_social_name || item.patient_name;
  const nasc = item.patient_birth_date ?? null;
  const idade = nasc ? ageOn(nasc, date) : null;
  const aniversario = !!nasc && nasc.slice(5) === date.slice(5);
  const iniciais = nome.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  return (
    <section className={cx('cartao border-l-4 p-4', STATUS_BAR[item.status])}>
      <div className="flex items-center gap-2">
        <span className="num inline-flex items-center gap-1.5 rounded-campo bg-afundado px-2.5 py-1.5 text-[17px] font-bold"><IconClock className="size-[18px]" />{formatTime(item.starts_at, tz)}</span>
        <span className="text-sm text-tinta-2">{minutesBetween(item.starts_at, item.ends_at)} min</span>
        <span className="ml-auto"><StatusBadge status={item.status} /></span>
      </div>
      <button onClick={onOpen} className="mt-3 flex w-full items-center gap-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[20px] font-bold leading-tight">{nome}</span>
          <span className="block truncate text-[15px] text-tinta-2">
            {[idade != null ? `${idade} anos` : null, item.modality === 'online' ? 'On-line' : item.location_name, item.series_frequency ? 'Recorrente' : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-anil-claro text-[16px] font-bold text-sobre-anil-claro">{iniciais}</span>
      </button>
      <div className="mt-2 flex flex-wrap gap-2 text-[13px]">
        {aniversario ? (
          <span className="inline-flex h-7 items-center gap-1 rounded-full bg-acento-claro px-2.5 font-bold text-sobre-acento-claro"><IconCake className="size-4" /> Hoje é aniversário! ({formatDate(nasc)})</span>
        ) : nasc && (
          <span className="inline-flex h-7 items-center gap-1 rounded-full bg-afundado px-2.5 font-bold text-tinta-2"><IconCake className="size-4" /> {formatDate(nasc)}</span>
        )}
        <span className="inline-flex h-7 items-center rounded-full bg-afundado px-2.5 font-bold text-tinta-2">{item.patient_billing_mode === 'mensal' ? 'Mensal / pacote' : 'Particular'}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={onWhats} disabled={!item.patient_phone}
          className="pressionar inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-botao bg-livre font-bold text-sobre-status disabled:opacity-50">
          <IconWhats className="size-5" /> {aniversario ? 'WhatsApp: parabéns + lembrete' : item.status === 'confirmado' ? 'WhatsApp da agenda' : 'Enviar WhatsApp'}
        </button>
        <button onClick={onOpen} aria-label="Mais opções" className="grid size-12 shrink-0 place-items-center rounded-botao bg-anil-claro text-sobre-anil-claro"><IconDots /></button>
      </div>
    </section>
  );
}

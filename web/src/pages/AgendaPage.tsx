// Agenda: um card grande por dia + período (+ sala), ex.: "Segunda 27/10 · Tarde · Sala 1".
// Dentro do card: horários livres em uma linha (hora + "Agendar paciente") e sessões com nome e último sobrenome,
// WhatsApp (botão pequeno), Mover (dia, horário ou sala) e mais opções. Filtro "Só horários livres".
// A agenda nasce da grade (tela Grade e horários): sem grade, não há horários livres.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { AgendaItem, Location, WorkingHour } from '../lib/types';
import { horariosLivres, type HorarioLivre } from '../lib/horarios';
import { periodoDe } from '../lib/periodos';
import { addDays, ageOn, firstName, formatDate, formatTime, minutesBetween, monthName, startOfWeek, todayIn, weekday, weekdayName, weekdayShort, zonedParts, zonedToUtc } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { whatsappLink } from '../lib/messages';
import { useProfile } from '../auth/AuthProvider';
import { AppointmentSheet, openReminder } from '../components/appointments/AppointmentSheet';
import { NewAppointmentDialog } from '../components/appointments/NewAppointmentDialog';
import { ErrorBox, Loading, STATUS_BAR, StatusBadge, cx, useToast } from '../components/ui';
import { IconAlert, IconCake, IconChevronLeft, IconChevronRight, IconCircleCheck, IconClock, IconDoor, IconDots, IconPlus, IconSwap, IconUserPlus, IconWhats } from '../components/icons';

type NovoEm = { date: string; time?: string; locationId?: string | null; minutes?: number; modo?: 'novo' | 'existente' };
type Filtro = 'tudo' | 'livres' | 'agendados';
type Linha = { tipo: 'sessao'; hora: string; item: AgendaItem } | { tipo: 'livre'; hora: string; livre: HorarioLivre };
type Bloco = { chave: string; date: string; titulo: string; sala: Location | null; faixa: string | null; linhas: Linha[] };

const diaNome = (d: string) => { const n = weekdayName(d).replace('-feira', ''); return n[0].toUpperCase() + n.slice(1); };
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** "Mariana Costa Albuquerque" → "Mariana Albuquerque" */
export const nomeCurto = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1]}` : p[0] ?? ''; };

export function AgendaPage() {
  const { profile, tz } = useProfile();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const hoje = todayIn(tz);
  const date = params.get('d') || hoje;
  const [salaId, setSalaId] = useState(''); // '' = todas as salas
  const [filtro, setFiltro] = useState<Filtro>('tudo');
  const [open, setOpen] = useState<{ item: AgendaItem; mover?: boolean } | null>(null);
  const [novoEm, setNovoEm] = useState<NovoEm | null>(null);

  const semana = startOfWeek(date);
  const dias = Array.from({ length: 7 }, (_, i) => addDays(semana, i));
  const fromIso = zonedToUtc(semana, '00:00', tz);
  const toIso = zonedToUtc(addDays(semana, 7), '00:00', tz);

  const q = useQuery({ queryKey: ['agenda', fromIso, toIso], queryFn: () => api.listAgenda(fromIso, toIso) });
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations });
  const horas = useQuery({ queryKey: ['working-hours'], queryFn: api.listWorkingHours });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const semGrade = horas.data !== undefined && horas.data.length === 0;
  const salasAtivas = (locais.data ?? []).filter((l) => l.active);
  const sala = salasAtivas.find((l) => l.id === salaId) ?? null;
  const daSala = (id: string | null | undefined) => !sala || !id || id === sala.id;

  // Cards da semana: um por dia + bloco da grade (sala + período); sessões fora da grade num card "Outros horários"
  const blocos = useMemo<Bloco[]>(() => {
    if (!q.data || !horas.data || !profile) return [];
    const out: Bloco[] = [];
    for (const d of dias) {
      const itens = q.data.filter((it) => it.status !== 'cancelado' && zonedParts(it.starts_at, tz).date === d && daSala(it.location_id));
      const faixas: WorkingHour[] = horas.data.filter((h) => h.weekday === weekday(d) && daSala(h.location_id))
        .filter((h) => (locais.data ?? []).find((l) => l.id === h.location_id)?.active !== false)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      const livres = horariosLivres({ date: d, hours: faixas, locations: locais.data ?? [], items: q.data.filter((it) => zonedParts(it.starts_at, tz).date === d),
        sessionMinutes: profile.session_minutes, bufferMinutes: profile.buffer_minutes, tz });
      const usados = new Set<string>();
      for (const f of faixas) {
        const ini = f.start_time.slice(0, 5); const fim = f.end_time.slice(0, 5);
        const sessoes = itens.filter((it) => {
          const h = formatTime(it.starts_at, tz);
          const ok = !usados.has(it.id) && h >= ini && h < fim && (!it.location_id || it.location_id === f.location_id);
          if (ok) usados.add(it.id);
          return ok;
        });
        const linhas: Linha[] = [
          ...sessoes.map((item) => ({ tipo: 'sessao' as const, hora: formatTime(item.starts_at, tz), item })),
          ...livres.filter((l) => l.faixaId === f.id).map((livre) => ({ tipo: 'livre' as const, hora: livre.time, livre })),
        ].sort((a, b) => a.hora.localeCompare(b.hora));
        if (linhas.length) out.push({ chave: `${d}-${f.id}`, date: d, titulo: periodoDe(ini).nome, sala: (locais.data ?? []).find((l) => l.id === f.location_id) ?? null, faixa: `${ini}–${fim}`, linhas });
      }
      const fora = itens.filter((it) => !usados.has(it.id));
      if (fora.length) out.push({ chave: `${d}-fora`, date: d, titulo: 'Outros horários', sala: null, faixa: null,
        linhas: fora.map((item) => ({ tipo: 'sessao' as const, hora: formatTime(item.starts_at, tz), item })).sort((a, b) => a.hora.localeCompare(b.hora)) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, horas.data, locais.data, profile, tz, semana, salaId]);

  const visiveis = blocos
    .filter((b) => b.date >= hoje || b.linhas.some((l) => l.tipo === 'sessao'))
    .map((b) => ({ ...b, linhas: b.linhas.filter((l) => filtro === 'tudo' || (filtro === 'livres' ? l.tipo === 'livre' : l.tipo === 'sessao')) }))
    .filter((b) => b.linhas.length > 0);
  const totalAgendados = blocos.reduce((n, b) => n + b.linhas.filter((l) => l.tipo === 'sessao').length, 0);
  const totalLivres = blocos.reduce((n, b) => n + b.linhas.filter((l) => l.tipo === 'livre').length, 0);

  const irPara = (d: string) => {
    if (startOfWeek(d) !== semana) { setParams({ d }, { replace: true }); return; }
    setParams({ d }, { replace: true });
    document.getElementById(`dia-${d}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
            <p className="rotulo text-anil-escuro">Consultório ativo · semana {ddmm(semana)} a {ddmm(addDays(semana, 6))}</p>
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
          {!semGrade && <span className="ml-auto inline-flex items-center gap-1 text-sm text-tinta-2"><IconCircleCheck className="size-4 text-livre" /> Grade ativa</span>}
        </div>
      </section>

      {/* Dias da semana: toca para ir ao dia */}
      <div className="flex items-center gap-1">
        <button onClick={() => setParams({ d: addDays(date, -7) }, { replace: true })} aria-label="Semana anterior" className="grid size-10 shrink-0 place-items-center rounded-full text-tinta-2 hover:bg-cinza-fundo"><IconChevronLeft /></button>
        <div className="flex flex-1 gap-1.5 overflow-x-auto pb-1" aria-label="Dias da semana">
          {dias.map((d) => {
            const sel = d === date;
            const temAlgo = blocos.some((b) => b.date === d);
            return (
              <button key={d} onClick={() => irPara(d)} aria-current={sel ? 'date' : undefined}
                className={cx('flex min-w-[54px] flex-1 flex-col items-center rounded-cartao border py-2 leading-tight', sel ? 'btn-degrade border-transparent shadow-elevado' : 'border-linha bg-papel', !temAlgo && !sel && 'opacity-55')}>
                <span className="text-[12px] font-bold uppercase">{weekdayShort(d)}</span>
                <span className="num text-[20px] font-extrabold">{Number(d.slice(8))}</span>
                <span className="text-[12px] capitalize">{monthName(Number(d.slice(5, 7))).slice(0, 3)}</span>
                {d === hoje && !sel && <span className="mt-0.5 size-1.5 rounded-full bg-anil" aria-label="hoje" />}
              </button>
            );
          })}
        </div>
        <button onClick={() => setParams({ d: addDays(date, 7) }, { replace: true })} aria-label="Próxima semana" className="grid size-10 shrink-0 place-items-center rounded-full text-tinta-2 hover:bg-cinza-fundo"><IconChevronRight /></button>
      </div>

      {dash.data && dash.data.to_register > 0 && (
        <Link to="/resumo#registrar" className="flex min-h-12 items-center gap-2 rounded-campo bg-ocre-fundo px-4 py-2 text-[15px] font-bold text-ocre">
          <IconAlert className="size-5 shrink-0" />
          <span className="flex-1">{dash.data.to_register} {dash.data.to_register === 1 ? 'sessão aguarda' : 'sessões aguardam'} registro</span>
          <IconChevronRight className="size-5 shrink-0" />
        </Link>
      )}

      {/* Filtro */}
      {!semGrade && (
        <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Filtro">
          {([['tudo', 'Tudo'], ['livres', `Só horários livres (${totalLivres})`], ['agendados', `Só agendados (${totalAgendados})`]] as Array<[Filtro, string]>).map(([f, r]) => (
            <button key={f} role="tab" aria-selected={filtro === f} onClick={() => setFiltro(f)}
              className={cx('min-h-10 shrink-0 rounded-full border px-3.5 text-sm font-bold', filtro === f ? 'btn-degrade border-transparent' : 'border-linha bg-papel text-tinta-2')}>{r}</button>
          ))}
        </div>
      )}

      {semGrade && (
        <section className="cartao cartao-boas-vindas flex flex-col gap-3 px-4 pb-4 pt-5">
          <div>
            <strong className="block text-[17px]">Monte sua grade de horários</strong>
            <span className="text-[15px] text-tinta-2">Escolha a sala, os dias, o turno, a duração e o intervalo. O app gera os horários, que aparecem aqui prontos para agendar. Dá para mudar ou excluir quando quiser.</span>
          </div>
          <Link to="/agenda/horarios" className="btn-degrade pressionar inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-botao px-5 font-bold"><IconClock /> Criar minha grade</Link>
        </section>
      )}

      {(q.isLoading || horas.isLoading) && <Loading />}
      {(q.error || horas.error) && <ErrorBox>{errorMessage(q.error ?? horas.error)}</ErrorBox>}
      {q.data && horas.data && !semGrade && visiveis.length === 0 && (
        <p className="cartao px-4 py-4 text-tinta-2">{filtro === 'livres' ? 'Nenhum horário livre nesta semana.' : filtro === 'agendados' ? 'Nenhuma sessão agendada nesta semana.' : 'Nada a seguir nesta semana.'}</p>
      )}

      {/* Cards grandes: dia + período (+ sala) */}
      {visiveis.map((b, i) => {
        const primeiroDoDia = i === 0 || visiveis[i - 1].date !== b.date;
        return (
          <section key={b.chave} id={primeiroDoDia ? `dia-${b.date}` : undefined} className={cx('cartao scroll-mt-24 overflow-hidden', b.date === hoje && 'ring-2 ring-anil-escuro')}>
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-linha bg-afundado/60 px-4 py-3">
              <h2 className="text-[18px] font-bold">{diaNome(b.date)} <span className="num">{ddmm(b.date)}</span> · {b.titulo}</h2>
              {b.date === hoje && <span className="rounded-full bg-anil-escuro px-2 py-0.5 text-[11px] font-extrabold uppercase text-sobre-anil">Hoje</span>}
              <span className="ml-auto flex items-center gap-2 text-sm text-tinta-2">
                {b.sala && <span className="inline-flex items-center gap-1 font-bold"><span className="size-2 rounded-full" style={{ background: b.sala.color ?? 'var(--color-anil)' }} />{b.sala.name}</span>}
                {b.faixa && <span className="num">{b.faixa}</span>}
              </span>
            </header>
            <ol className="flex flex-col gap-2 p-3">
              {b.linhas.map((l) => l.tipo === 'livre' ? (
                <li key={`livre-${l.hora}`} className="flex min-h-14 items-center gap-3 rounded-campo border-l-4 border-l-livre bg-livre-fundo py-2 pl-3 pr-2">
                  <span className="num text-[17px] font-bold">{l.hora}</span>
                  <span className="text-sm text-tinta-2">{l.livre.minutes ?? profile?.session_minutes ?? 50} min</span>
                  <button onClick={() => setNovoEm({ date: b.date, time: l.hora, locationId: l.livre.location?.id ?? null, minutes: l.livre.minutes, modo: 'novo' })}
                    className="btn-degrade pressionar ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-botao px-3.5 text-sm font-bold">
                    <IconUserPlus className="size-4" /> Agendar paciente
                  </button>
                </li>
              ) : (
                <li key={l.item.id}>
                  <LinhaSessao item={l.item} date={b.date} tz={tz} onOpen={() => setOpen({ item: l.item })} onMover={() => setOpen({ item: l.item, mover: true })} onWhats={() => enviarWhatsApp(l.item)} />
                </li>
              ))}
            </ol>
          </section>
        );
      })}

      {/* Ações da agenda */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/agenda/horarios" className="cartao pressionar inline-flex min-h-14 items-center justify-center gap-2 font-bold text-anil-escuro"><IconClock className="size-5" /> Editar grade</Link>
        <button onClick={() => setNovoEm({ date, modo: 'existente' })} className="btn-degrade pressionar inline-flex min-h-14 items-center justify-center gap-2 rounded-cartao font-bold shadow-elevado"><IconPlus className="size-5" /> Adicionar encaixe</button>
      </div>

      <AppointmentSheet item={open?.item ?? null} mover={open?.mover} onClose={() => setOpen(null)} />
      <NewAppointmentDialog open={!!novoEm} onClose={() => setNovoEm(null)} initialDate={novoEm?.date} initialTime={novoEm?.time}
        initialLocationId={novoEm?.locationId ?? null} initialMinutes={novoEm?.minutes} initialModo={novoEm?.modo} />
    </div>
  );
}

/** Sessão dentro do card: hora e duração, nome e último sobrenome, situação; WhatsApp (pequeno), Mover e mais opções. */
function LinhaSessao({ item, date, tz, onOpen, onMover, onWhats }: { item: AgendaItem; date: string; tz: string; onOpen: () => void; onMover: () => void; onWhats: () => void }) {
  const nome = nomeCurto(item.patient_social_name || item.patient_name);
  const nasc = item.patient_birth_date ?? null;
  const idade = nasc ? ageOn(nasc, date) : null;
  const aniversario = !!nasc && nasc.slice(5) === date.slice(5);
  const ativa = item.status === 'agendado' || item.status === 'confirmado';
  return (
    <div className={cx('rounded-campo border border-linha border-l-4 bg-papel p-3', STATUS_BAR[item.status])}>
      <div className="flex items-center gap-2">
        <span className="num text-[17px] font-bold">{formatTime(item.starts_at, tz)}</span>
        <span className="text-sm text-tinta-2">{minutesBetween(item.starts_at, item.ends_at)} min</span>
        <span className="ml-auto"><StatusBadge status={item.status} /></span>
      </div>
      <button onClick={onOpen} className="mt-1 block w-full text-left">
        <span className="block truncate text-[18px] font-bold leading-tight">{nome}</span>
        <span className="block truncate text-sm text-tinta-2">
          {[idade != null ? `${idade} anos` : null, item.modality === 'online' ? 'On-line' : null, item.patient_billing_mode === 'mensal' ? 'Mensal' : 'Particular', item.series_frequency ? 'Recorrente' : null].filter(Boolean).join(' · ')}
        </span>
      </button>
      {aniversario && <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-acento-claro px-2.5 py-0.5 text-[13px] font-bold text-sobre-acento-claro"><IconCake className="size-4" /> Aniversário hoje ({formatDate(nasc).slice(0, 5)})</p>}
      <div className="mt-2 flex items-center gap-2">
        {item.patient_phone && (
          <button onClick={onWhats} aria-label="Enviar WhatsApp" title={aniversario ? 'WhatsApp: parabéns + lembrete' : 'Enviar WhatsApp'}
            className="pressionar grid size-11 shrink-0 place-items-center rounded-full bg-livre text-sobre-status"><IconWhats className="size-5" /></button>
        )}
        {ativa && (
          <button onClick={onMover} className="pressionar inline-flex min-h-11 items-center gap-1.5 rounded-botao border border-anil-escuro/50 px-3.5 text-sm font-bold text-anil-escuro">
            <IconSwap className="size-4" /> Mover
          </button>
        )}
        <button onClick={onOpen} aria-label="Mais opções" className="ml-auto grid size-11 shrink-0 place-items-center rounded-botao bg-anil-claro text-sobre-anil-claro"><IconDots /></button>
      </div>
    </div>
  );
}

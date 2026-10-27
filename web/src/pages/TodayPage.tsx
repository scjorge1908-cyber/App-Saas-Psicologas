import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { DashboardSummary } from '../lib/types';
import { formatLongDate, formatTime, money, todayIn } from '../lib/format';
import { useProfile } from '../auth/AuthProvider';
import { NewAppointmentDialog } from '../components/appointments/NewAppointmentDialog';
import { ConfirmarAgendaDialog } from '../components/appointments/ConfirmarAgenda';
import { Notice, cx } from '../components/ui';
import { IconCalendar, IconClock, IconDoc, IconEye, IconEyeOff, IconMoney, IconPeople, IconReceipt, IconPlus, IconWhats } from '../components/icons';
import { VALOR_OCULTO, useValoresVisiveis } from '../lib/privacidade';

function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

export function TodayPage() {
  const [valoresVisiveis, alternarValores] = useValoresVisiveis();
  const valor = (n: number) => (valoresVisiveis ? money(n) : VALOR_OCULTO);
  const { profile, tz } = useProfile();
  const now = useNow();
  const today = todayIn(tz);
  const [encaixe, setEncaixe] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const dash = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });

  const d = dash.data;

  const primeiroNome = (profile?.full_name ?? '').trim().split(/\s+/)[0] ?? '';
  const saudacao = (() => { const h = Number(formatTime(new Date(now).toISOString(), tz).slice(0, 2)); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; })();

  return (
    <div className="flex flex-col gap-6">
      {/* Boas-vindas — faixa em degradê no topo do cartão */}
      <section className="cartao cartao-boas-vindas flex flex-wrap items-end justify-between gap-4 px-5 pb-5 pt-6">
        <div>
          <p className="rotulo">{formatLongDate(today)}</p>
          <h1 className="titulo-display mt-1 text-[1.875rem] leading-tight">{saudacao}{primeiroNome ? `, ${primeiroNome}` : ''}</h1>
          {d && <p className="mt-1 text-tinta-2">{d.sessions_today === 0 ? 'Nenhuma sessão hoje.' : `${d.sessions_today} ${d.sessions_today === 1 ? 'sessão' : 'sessões'} hoje.`}</p>}
        </div>
      </section>

      {/* Atalhos — as pendências aparecem como bolinha com o número no atalho de cada área
          (detalhes no sininho do cabeçalho). Agenda: aguardando registro + sem confirmação;
          Financeiro: cobranças vencidas + recibos do Receita Saúde; Notas fiscais: notas a emitir. */}
      <nav aria-label="Atalhos" className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {ATALHOS.map((a) => {
          const n = d ? pendenciasDoAtalho(a.to, d) : 0;
          return (
            <Link key={a.to} to={a.to} aria-label={n ? `${a.label}: ${n} ${n === 1 ? 'pendência' : 'pendências'}` : a.label}
              className="cartao pressionar relative flex aspect-square flex-col items-center justify-center gap-2 p-2 text-center text-[0.8125rem] font-bold leading-tight">
              <span className={cx('atalho-icone grid size-12 place-items-center', a.cor)}><a.icon /></span>
              {a.label}
              {n > 0 && <span aria-hidden className="absolute right-2 top-2 grid min-w-6 place-items-center rounded-full bg-vermelho-forte px-1.5 text-[0.75rem] font-extrabold leading-6 text-white">{n}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Ações do dia (pedido do Jorge, 27/10): Encaixe (sessão fora da grade) e Confirmar agenda
          (sessões de hoje, amanhã ou outro dia, com o WhatsApp para confirmar presença). As sessões de hoje ficam lá dentro. */}
      <div className="flex gap-3">
        <button onClick={() => setEncaixe(true)}
          className="pressionar flex min-h-14 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-cartao border border-anil/30 bg-anil px-4 text-[0.9375rem] font-extrabold text-sobre-anil shadow-elevado hover:brightness-110">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-sobre-anil/15"><IconPlus className="size-[1.125rem]" strokeWidth={2.4} /></span>
          Encaixe
        </button>
        <button onClick={() => setConfirmar(true)}
          className="pressionar flex min-h-14 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-cartao border border-linha bg-papel px-3 text-[0.9375rem] font-extrabold text-tinta shadow-cartao hover:border-anil">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-[#25D366]/20 text-[#128C4A]"><IconWhats className="size-[1.125rem]" /></span>
          Confirmar agenda
        </button>
      </div>

      {/* "Aguardando registro" saiu daqui (27/10): agora abre como janela na Agenda, com botão e número no fim dela */}

      {/* Carteira escura — valores ocultos até tocar no olho */}
      {d && (
        <section aria-label="Resumo financeiro do mês" className="carteira p-5">
          <div className="flex items-center justify-between">
            <p className="rotulo">Recebido neste mês</p>
            <button type="button" onClick={alternarValores} className="-mr-2 grid size-12 place-items-center rounded-full hover:bg-white/10"
              aria-label={valoresVisiveis ? 'Ocultar valores' : 'Mostrar valores'} aria-pressed={valoresVisiveis}>
              {valoresVisiveis ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>
          <p className="num text-[2rem] font-extrabold leading-tight tracking-tight">{valor(d.received_month)}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="carteira-bloco p-3"><p className="rotulo">A receber</p><p className="num mt-0.5 text-[1.125rem] font-extrabold">{valor(d.receivable)}</p></div>
            <div className="carteira-bloco p-3"><p className="rotulo">Vencido</p><p className="num mt-0.5 text-[1.125rem] font-extrabold">{valor(d.overdue)}</p></div>
          </div>
          <Link to="/financeiro" className="mt-3 inline-flex min-h-11 items-center text-[0.9375rem] font-bold underline-offset-4 hover:underline">Abrir financeiro</Link>
        </section>
      )}

      {/* Mini-indicadores */}
      {d && (
        <section aria-label="Indicadores" className="grid grid-cols-3 gap-2">
          <Kpi valor={d.sessions_today} rotulo="Sessões hoje" />
          <Kpi valor={d.to_confirm_48h} rotulo="A confirmar" alerta={d.to_confirm_48h > 0} />
          <Kpi valor={d.active_patients} rotulo="Pacientes ativos" />
        </section>
      )}

      {!profile?.crp && <Notice tone="ocre">Complete seu CRP em <Link to="/configuracoes" className="font-bold underline">Configurações</Link> para emitir documentos.</Notice>}

      <NewAppointmentDialog open={encaixe} onClose={() => setEncaixe(false)} encaixe />
      <ConfirmarAgendaDialog key={confirmar ? 'aberta' : 'fechada'} open={confirmar} onClose={() => setConfirmar(false)} />
    </div>
  );
}

const ATALHOS = [
  { to: '/', label: 'Agenda', icon: IconCalendar, cor: 'bg-anil-claro text-sobre-anil-claro' },
  { to: '/pacientes', label: 'Pacientes', icon: IconPeople, cor: 'bg-acento-claro text-sobre-acento-claro' },
  { to: '/prontuario', label: 'Prontuário', icon: IconDoc, cor: 'bg-azul-fundo text-azul' },
  { to: '/financeiro', label: 'Financeiro', icon: IconMoney, cor: 'bg-verde-fundo text-verde' },
  { to: '/notas-fiscais', label: 'Notas fiscais', icon: IconReceipt, cor: 'bg-anil-claro text-sobre-anil-claro' },
  { to: '/agenda/horarios', label: 'Horários', icon: IconClock, cor: 'bg-acento-claro text-sobre-acento-claro' },
];

/** Número de pendências que aparece na bolinha de cada atalho. */
function pendenciasDoAtalho(to: string, d: DashboardSummary): number {
  if (to === '/') return d.to_register + d.to_confirm_48h;
  if (to === '/financeiro') return (d.overdue > 0 ? 1 : 0) + d.receita_saude_pending;
  if (to === '/notas-fiscais') return d.invoices_pending;
  return 0;
}

function Kpi({ valor, rotulo, alerta }: { valor: number; rotulo: string; alerta?: boolean }) {
  return (
    <div className="cartao p-3">
      <p className={cx('num text-[1.375rem] font-extrabold leading-tight', alerta ? 'text-ocre' : 'text-tinta')}>{valor}</p>
      <p className="rotulo mt-1">{rotulo}</p>
    </div>
  );
}

// "Confirmar agenda" (pedido do Jorge, 27/10): no Resumo do dia, abre as sessões de hoje, de amanhã ou de outro dia,
// para mandar a confirmação pelo WhatsApp (por exemplo, um dia antes do atendimento). O botão do WhatsApp abre o mesmo
// cartão de mensagens da agenda (Confirmar presença, Avisar que não vou atender, Mensagem livre, Mover).
// As sessões de hoje saíram da tela do Resumo e ficam aqui, com Atendida / Falta ou outro quando já começaram.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgendaItem } from '../../lib/types';
import * as api from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { addDays, formatLongDate, formatTime, minutesBetween, todayIn, zonedToUtc } from '../../lib/format';
import { useProfile } from '../../auth/AuthProvider';
import { Button, Dialog, ErrorBox, Input, Loading, STATUS_BAR, cx, useToast } from '../ui';
import { IconCheck, IconPin, IconVideo, IconWhats } from '../icons';
import { AppointmentSheet, useInvalidateAgenda } from './AppointmentSheet';
import { WhatsAppCard } from './WhatsAppCard';

export function ConfirmarAgendaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tz } = useProfile();
  const toast = useToast();
  const invalidate = useInvalidateAgenda();
  const hoje = todayIn(tz);
  const amanha = addDays(hoje, 1);
  const [dia, setDia] = useState(hoje);
  const [sessao, setSessao] = useState<{ item: AgendaItem; mover?: boolean; falta?: boolean } | null>(null);
  const [whats, setWhats] = useState<AgendaItem | null>(null);
  const de = zonedToUtc(dia, '00:00', tz);
  const ate = zonedToUtc(addDays(dia, 1), '00:00', tz);
  const q = useQuery({ queryKey: ['agenda', de, ate], queryFn: () => api.listAgenda(de, ate), enabled: open });
  const itens = (q.data ?? []).filter((i) => i.status !== 'cancelado');
  const [agora] = useState(() => Date.now());

  async function atendida(it: AgendaItem) {
    try { await api.setStatus(it.id, 'atendido'); await invalidate(); toast('Presença registrada'); }
    catch (e) { toast(errorMessage(e), 'erro'); }
  }

  const chip = (d: string, rotulo: string) => (
    <button key={rotulo} type="button" role="tab" aria-selected={dia === d} onClick={() => setDia(d)}
      className={cx('min-h-11 rounded-full px-4 text-[0.9375rem] font-bold', dia === d ? 'bg-anil text-sobre-anil' : 'bg-afundado text-tinta-2')}>{rotulo}</button>
  );

  return (
    <>
      <Dialog open={open && !sessao && !whats} onClose={onClose} title="Confirmar agenda" footer={<Button variant="ghost" onClick={onClose}>Fechar</Button>}>
        <div className="flex flex-col gap-3">
          <div role="tablist" aria-label="Dia" className="flex flex-wrap items-center gap-2">
            {chip(hoje, 'Hoje')}
            {chip(amanha, 'Amanhã')}
            <Input aria-label="Outro dia" type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} className="!min-h-11 w-auto flex-1" />
          </div>
          <p className="text-sm font-bold text-tinta-2 first-letter:uppercase">{formatLongDate(dia)}</p>
          {q.isLoading && <Loading />}
          {q.error && <ErrorBox>{errorMessage(q.error)}</ErrorBox>}
          {q.data && itens.length === 0 && <p className="text-tinta-3">Nenhuma sessão neste dia.</p>}
          {itens.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Sessões do dia">
              {itens.map((it) => {
                const comecou = new Date(it.starts_at).getTime() <= agora;
                const ativa = it.status === 'agendado' || it.status === 'confirmado';
                const nome = it.patient_social_name || it.patient_name;
                return (
                  <li key={it.id} className={cx('cartao flex flex-col gap-2 border-l-4 py-2.5 pl-3 pr-2', STATUS_BAR[it.status])}>
                    <div className="flex items-center gap-2">
                      <div className="w-14 shrink-0">
                        <p className="num text-[1.0625rem] font-bold leading-none">{formatTime(it.starts_at, tz)}</p>
                        <p className="num mt-1 text-[0.75rem] text-tinta-3">{minutesBetween(it.starts_at, it.ends_at)} min</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{nome}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-tinta-2">
                          <SituacaoConfirmacao item={it} />
                          {it.modality === 'online' ? <span className="inline-flex items-center gap-1"><IconVideo className="size-4" /> On-line</span>
                            : it.location_name ? <span className="inline-flex items-center gap-1"><IconPin className="size-4" /> {it.location_name}</span> : null}
                        </span>
                      </div>
                      <button onClick={() => setWhats(it)} aria-label={`Enviar WhatsApp para ${nome}`} title="WhatsApp: confirmar presença e outras mensagens"
                        className="pressionar grid size-11 shrink-0 place-items-center rounded-full bg-[#25D366] text-[#0B3B1E]"><IconWhats className="size-5" /></button>
                    </div>
                    {comecou && ativa && (
                      <div className="flex flex-wrap gap-2 pl-16">
                        {/* Só os dois registros que fazem sentido aqui (27/10); "Compareceu" serve para homem e mulher */}
                        <Button size="sm" onClick={() => atendida(it)}><IconCheck className="size-4" /> Compareceu</Button>
                        <Button size="sm" variant="secondary" onClick={() => setSessao({ item: it, falta: true })}>Falta</Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Dialog>
      <AppointmentSheet item={sessao?.item ?? null} mover={sessao?.mover} falta={sessao?.falta} onClose={() => setSessao(null)} />
      <WhatsAppCard key={whats?.id ?? 'nenhum'} item={whats} onClose={() => setWhats(null)} onMover={(item) => setSessao({ item, mover: true })} />
    </>
  );
}

/** Situação pensada para confirmar a agenda (27/10): nada de "Agendada", que confundia. */
function SituacaoConfirmacao({ item }: { item: AgendaItem }) {
  const [rotulo, cor] =
    item.status === 'confirmado' ? ['Confirmado', 'bg-verde-fundo text-verde']
    : item.status === 'atendido' ? ['Compareceu', 'bg-verde-fundo text-verde']
    : item.status === 'faltou' ? ['Faltou', 'bg-ocre-fundo text-ocre']
    : item.confirmation_link_at ? ['Aguardando confirmação', 'bg-azul-fundo text-azul']
    : ['Falta enviar link', 'bg-vermelho-fundo text-vermelho'];
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.8125rem] font-bold', cor)}><span aria-hidden className="size-1.5 rounded-full bg-current" />{rotulo}</span>;
}

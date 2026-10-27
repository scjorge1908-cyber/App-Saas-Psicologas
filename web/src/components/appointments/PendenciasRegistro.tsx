// Pendências de registro (pedido do Jorge, 27/10): sessões de dias anteriores ainda agendadas ou confirmadas.
// Saiu da tela inicial para deixar o app mais limpo: na Agenda, abre sozinha como janela (uma vez por abertura
// do app) quando há pendências, e fica um botão "Pendências de registro" com o número no fim da agenda.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgendaItem } from '../../lib/types';
import * as api from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatTime, todayIn, zonedParts, zonedToUtc } from '../../lib/format';
import { useProfile } from '../../auth/AuthProvider';
import { Button, Dialog, STATUS_BAR, cx, useToast } from '../ui';
import { AppointmentSheet, useInvalidateAgenda } from './AppointmentSheet';

export function usePendenciasRegistro() {
  const { tz } = useProfile();
  const from = zonedToUtc(todayIn(tz), '00:00', tz);
  return useQuery({ queryKey: ['to-register', from], queryFn: () => api.listToRegister(from) });
}

export function JanelaPendencias({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tz } = useProfile();
  const toast = useToast();
  const invalidate = useInvalidateAgenda();
  const pend = usePendenciasRegistro();
  const [sessao, setSessao] = useState<AgendaItem | null>(null);
  const itens = pend.data ?? [];

  async function atendida(it: AgendaItem) {
    try { await api.setStatus(it.id, 'atendido'); await invalidate(); toast('Sessão registrada como atendida'); }
    catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <>
      <Dialog open={open && !sessao} onClose={onClose} title="Aguardando registro" footer={<Button variant="ghost" onClick={onClose}>Fechar</Button>}>
        <p className="mb-3 text-tinta-2">Sessões de dias anteriores ainda marcadas como agendadas ou confirmadas.</p>
        {itens.length === 0 ? <p className="font-bold text-verde">Nenhuma pendência de registro.</p> : (
          <ul className="cartao divide-y divide-linha/70 overflow-hidden">
            {itens.map((it) => (
              <li key={it.id} className={cx('flex flex-wrap items-center justify-between gap-3 border-l-4 px-4 py-3', STATUS_BAR[it.status])}>
                <button onClick={() => setSessao(it)} className="text-left">
                  <span className="block font-bold">{it.patient_social_name || it.patient_name}</span>
                  <span className="num text-sm text-tinta-2">{formatDate(zonedParts(it.starts_at, tz).date)} às {formatTime(it.starts_at, tz)}</span>
                </button>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => atendida(it)}>Atendida</Button>
                  <Button size="sm" variant="secondary" onClick={() => setSessao(it)}>Falta ou outro</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <AppointmentSheet item={sessao} onClose={() => setSessao(null)} />
    </>
  );
}

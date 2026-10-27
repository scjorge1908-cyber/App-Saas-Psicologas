// Alerta do avulso sem próximo horário (27/10): a psicóloga escolhe marcar um novo horário ou dar alta.
// Enquanto não ajustar, o paciente continua na agenda no dia e horário da última sessão.
import { useState } from 'react';
import type { AgendaItem, Patient } from '../../lib/types';
import { errorMessage } from '../../lib/errors';
import { addDays, formatLongDate, formatTime, weekday, zonedParts } from '../../lib/format';
import { useProfile } from '../../auth/AuthProvider';
import { Button, Dialog, useConfirm, useToast } from '../ui';
import { useInvalidateAgenda } from '../appointments/AppointmentSheet';
import { darAltaPaciente } from './DarAltaDialog';

/** Próxima data (a partir de hoje) no mesmo dia da semana da última sessão. */
export function proximaData(it: AgendaItem, hoje: string, tz: string): string {
  const alvo = weekday(zonedParts(it.starts_at, tz).date);
  let d = hoje;
  while (weekday(d) !== alvo) d = addDays(d, 1);
  return d;
}

export function AjustarSemHorario({ item, onClose, onAgendar }: { item: AgendaItem | null; onClose: () => void; onAgendar: (it: AgendaItem) => void }) {
  const { tz } = useProfile();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidar = useInvalidateAgenda();
  const [busy, setBusy] = useState(false);
  if (!item) return null;
  const nome = item.patient_social_name || item.patient_name;

  async function alta() {
    if (!item) return;
    const ok = await confirm({ title: `Dar alta a ${nome}?`, body: 'Sai da agenda e vai para a aba Inativos. Histórico, prontuário, documentos e financeiro continuam guardados.', confirmLabel: 'Dar alta', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await darAltaPaciente({ id: item.patient_id } as Patient, tz);
      await invalidar();
      toast(`${nome} foi para Inativos.`);
      onClose();
    } catch (e) { toast(errorMessage(e), 'erro'); } finally { setBusy(false); }
  }

  return (
    <Dialog open onClose={onClose} title="Ajustar paciente" footer={<Button variant="ghost" onClick={onClose}>Fechar</Button>}>
      <div className="flex flex-col gap-3">
        <p><b>{nome}</b> não tem próximo horário. A última sessão foi {formatLongDate(zonedParts(item.starts_at, tz).date)}, às {formatTime(item.starts_at, tz)}.</p>
        <p className="text-sm text-tinta-2">Enquanto não ajustar, ele continua na agenda nesse dia e horário, com este alerta.</p>
        <Button onClick={() => onAgendar(item)}>Marcar novo horário</Button>
        <Button variant="secondary" busy={busy} onClick={alta}>Dar alta</Button>
      </div>
    </Dialog>
  );
}

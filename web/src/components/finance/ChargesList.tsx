import { useState } from 'react';
import type { ChargeBalance, Patient } from '../../lib/types';
import * as api from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { formatDate, money } from '../../lib/format';
import { chargeText, whatsappLink } from '../../lib/messages';
import { useProfile } from '../../auth/AuthProvider';
import { Badge, Button, cx, useConfirm, useToast } from '../ui';
import { IconWhats } from '../icons';
import { PaymentDialog, useInvalidateFinance } from './PaymentDialog';

const STATUS: Record<ChargeBalance['status'], { label: string; tone: 'atencao' | 'ok' | 'neutro' | 'anil' }> = {
  aberta: { label: 'Em aberto', tone: 'atencao' },
  parcial: { label: 'Parcial', tone: 'anil' },
  paga: { label: 'Paga', tone: 'ok' },
  cancelada: { label: 'Cancelada', tone: 'neutro' },
};

export function ChargesList({ charges, patients, showPatient = true }: { charges: ChargeBalance[]; patients?: Patient[]; showPatient?: boolean }) {
  const { profile } = useProfile();
  const [paying, setPaying] = useState<ChargeBalance | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const invalidate = useInvalidateFinance();

  if (charges.length === 0) return null;
  return (
    <>
      <ul className="divide-y divide-linha rounded-lg border border-linha bg-papel">
        {charges.map((c) => {
          const wa = c.balance > 0 ? whatsappLink(c.patient_phone, chargeText({ patientName: c.patient_name, amount: c.balance, description: c.description, professionalName: profile?.full_name ?? '' })) : null;
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                {showPatient && <p className="truncate font-bold">{c.patient_name}</p>}
                <p className={cx(showPatient ? 'text-sm text-tinta-2' : 'font-bold')}>{c.description}</p>
                <p className="num mt-0.5 flex flex-wrap items-center gap-2 text-sm text-tinta-2">
                  <Badge tone={c.overdue ? 'erro' : STATUS[c.status].tone}>{c.overdue ? 'Vencida' : STATUS[c.status].label}</Badge>
                  <span>Venc. {formatDate(c.due_date)}</span>
                  {c.paid > 0 && c.status !== 'paga' && <span>recebido {money(c.paid)}</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="num text-lg font-bold">{money(c.status === 'paga' || c.status === 'cancelada' ? c.amount : c.balance)}</span>
                {c.balance > 0 && <Button size="sm" onClick={() => setPaying(c)}>Receber</Button>}
                {wa && <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`Lembrar ${c.patient_name} pelo WhatsApp`} className="inline-flex min-h-9 items-center rounded-[var(--radius-campo)] px-2 text-verde hover:bg-verde-fundo"><IconWhats /></a>}
                {c.status === 'aberta' && !c.appointment_id && (
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!(await confirm({ title: 'Cancelar cobrança?', body: `${c.description} (${money(c.amount)}) deixa de constar como a receber.`, confirmLabel: 'Cancelar cobrança', danger: true }))) return;
                    try { await api.cancelCharge(c.id); await invalidate(); toast('Cobrança cancelada'); } catch (e) { toast(errorMessage(e), 'erro'); }
                  }}>Cancelar</Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <PaymentDialog open={!!paying} onClose={() => setPaying(null)} charge={paying} patient={patients?.find((p) => p.id === paying?.patient_id)} />
    </>
  );
}

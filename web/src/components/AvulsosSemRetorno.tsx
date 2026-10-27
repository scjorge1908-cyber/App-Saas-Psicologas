// Paciente AVULSO cuja sessão já passou e que não tem próxima sessão: a agenda pergunta o que fazer —
// manter na agenda (escolhendo de novo a modalidade: avulso, semanal ou quinzenal) ou dar alta.
// Quem decide é a psicóloga; o sistema só lembra. Some da lista quando houver nova sessão ou alta.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import { addDays, formatDate, todayIn, zonedParts, zonedToUtc } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useProfile } from '../auth/AuthProvider';
import { NewAppointmentDialog } from './appointments/NewAppointmentDialog';
import { Button, Dialog, useConfirm, useToast } from './ui';

export type AvulsoPendente = { patientId: string; nome: string; ultima: string };

/** Pacientes ativos cuja última sessão (já passada) foi avulsa e que não têm sessão marcada daqui para frente. */
export function useAvulsosSemRetorno(): AvulsoPendente[] {
  const { tz } = useProfile();
  const hoje = todayIn(tz);
  const fromIso = zonedToUtc(addDays(hoje, -90), '00:00', tz);
  const toIso = zonedToUtc(addDays(hoje, 366), '00:00', tz);
  const agenda = useQuery({ queryKey: ['agenda', fromIso, toIso], queryFn: () => api.listAgenda(fromIso, toIso) });
  const pacientes = useQuery({ queryKey: ['patients'], queryFn: api.listPatients });
  return useMemo(() => {
    if (!agenda.data || !pacientes.data) return [];
    const agora = Date.now();
    const ativos = new Set(pacientes.data.filter((p) => p.status === 'ativo').map((p) => p.id));
    const porPaciente = new Map<string, typeof agenda.data>();
    for (const it of agenda.data) {
      if (it.status === 'cancelado' || !ativos.has(it.patient_id)) continue;
      porPaciente.set(it.patient_id, [...(porPaciente.get(it.patient_id) ?? []), it]);
    }
    const out: AvulsoPendente[] = [];
    for (const [pid, itens] of porPaciente) {
      const futura = itens.some((i) => new Date(i.starts_at).getTime() >= agora && (i.status === 'agendado' || i.status === 'confirmado'));
      if (futura) continue;
      const ultima = itens.filter((i) => new Date(i.starts_at).getTime() < agora).sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0];
      if (!ultima || ultima.series_id) continue; // última foi de série (semanal/quinzenal): não é o caso do avulso
      out.push({ patientId: pid, nome: ultima.patient_social_name || ultima.patient_name, ultima: zonedParts(ultima.starts_at, tz).date });
    }
    return out.sort((a, b) => a.ultima.localeCompare(b.ultima));
  }, [agenda.data, pacientes.data, tz]);
}

/** Janela: cada paciente avulso com "Manter na agenda" (abre o agendamento, modalidade obrigatória) ou "Dar alta". */
export function JanelaAvulsos({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lista = useAvulsosSemRetorno();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [agendarPara, setAgendarPara] = useState<string | null>(null);

  async function darAlta(p: AvulsoPendente) {
    if (!(await confirm({ title: `Dar alta para ${p.nome}?`, body: 'O paciente sai da lista de atendimento ativo. O prontuário e o histórico continuam guardados, e dá para reativar depois.', confirmLabel: 'Dar alta' }))) return;
    try {
      await api.savePatient({ id: p.patientId, status: 'alta' });
      await qc.invalidateQueries({ queryKey: ['patients'] });
      toast(`Alta registrada para ${p.nome}`);
    } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <>
      <Dialog open={open && !agendarPara} onClose={onClose} title="Pacientes avulsos sem próxima sessão"
        footer={<Button variant="secondary" onClick={onClose}>Decidir depois</Button>}>
        <div className="flex flex-col gap-3">
          <p className="text-[0.9375rem] text-tinta-2">A sessão avulsa já passou e não há próxima marcada. Deseja manter na agenda ou dar alta?</p>
          {lista.length === 0 && <p className="rounded-campo bg-afundado px-3 py-3 text-tinta-2">Nenhum paciente pendente.</p>}
          <ul className="flex flex-col gap-2">
            {lista.map((p) => (
              <li key={p.patientId} className="flex flex-col gap-2 rounded-campo border border-linha p-3">
                <div><p className="font-bold">{p.nome}</p><p className="text-sm text-tinta-2">Última sessão (avulsa): <span className="num">{formatDate(p.ultima)}</span></p></div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" onClick={() => setAgendarPara(p.patientId)}>Manter na agenda</Button>
                  <Button size="sm" variant="secondary" onClick={() => darAlta(p)}>Dar alta</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
      {/* Manter: abre o agendamento do paciente; a modalidade (avulso, semanal ou quinzenal) é obrigatória lá */}
      <NewAppointmentDialog open={!!agendarPara} onClose={() => setAgendarPara(null)} patientId={agendarPara ?? undefined} />
    </>
  );
}

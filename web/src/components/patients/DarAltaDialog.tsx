// "Dar alta" (pedido do Jorge, 27/10): tira o paciente da agenda e o leva para a aba Inativos de Pacientes.
// Remove as sessões futuras ainda não realizadas (agendadas ou confirmadas) e encerra as recorrências.
// O histórico continua: atendidas, faltas, cancelamentos, prontuário, documentos e financeiro não são apagados.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Patient } from '../../lib/types';
import * as api from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { zonedParts } from '../../lib/format';
import { useProfile } from '../../auth/AuthProvider';
import { Button, Dialog, ErrorBox, Input, useConfirm, useToast } from '../ui';
import { useInvalidateAgenda } from '../appointments/AppointmentSheet';

/** Remove as sessões futuras do paciente e o passa para Inativos. Devolve quantas sessões saíram da agenda. */
export async function darAltaPaciente(p: Patient, tz: string): Promise<number> {
  const agora = Date.now();
  const futuras = (await api.listPatientAgenda(p.id))
    .filter((a) => (a.status === 'agendado' || a.status === 'confirmado') && new Date(a.starts_at).getTime() > agora);
  let removidas = 0;
  // Cada série é encerrada a partir da sua primeira sessão futura (sessões passadas ainda sem registro ficam)
  const inicioPorSerie = new Map<string, string>();
  for (const a of futuras.filter((x) => x.series_id)) {
    const d = zonedParts(a.starts_at, tz).date;
    const atual = inicioPorSerie.get(a.series_id!);
    if (!atual || d < atual) inicioPorSerie.set(a.series_id!, d);
  }
  for (const [serie, desde] of inicioPorSerie) removidas += await api.endSeries(serie, desde);
  for (const a of futuras.filter((x) => !x.series_id)) { await api.deleteAppointment(a.id); removidas++; }
  await api.savePatient({ id: p.id, status: 'inativo' });
  return removidas;
}

export function DarAltaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tz } = useProfile();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidar = useInvalidateAgenda();
  const [busca, setBusca] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const pacientes = useQuery({ queryKey: ['patients'], queryFn: api.listPatients, enabled: open });
  const ativos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (pacientes.data ?? []).filter((p) => p.status === 'ativo' && (!t || `${p.social_name ?? ''} ${p.full_name}`.toLowerCase().includes(t)));
  }, [pacientes.data, busca]);

  async function alta(p: Patient) {
    const nome = p.social_name || p.full_name;
    const ok = await confirm({
      title: `Dar alta a ${nome}?`,
      body: 'As sessões futuras saem da agenda e o horário fica livre. O paciente vai para a aba Inativos. O histórico, o prontuário, os documentos e o financeiro continuam guardados.',
      confirmLabel: 'Dar alta', danger: true,
    });
    if (!ok) return;
    setBusy(p.id); setErro(null);
    try {
      const n = await darAltaPaciente(p, tz);
      await invalidar();
      toast(`${nome} foi para Inativos${n ? ` (${n} ${n === 1 ? 'sessão futura removida' : 'sessões futuras removidas'})` : ''}.`);
    } catch (e) { setErro(errorMessage(e)); } finally { setBusy(null); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Dar alta" footer={<Button variant="ghost" onClick={onClose}>Fechar</Button>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-tinta-2">Escolha o paciente. Ele sai da agenda e vai para <b>Inativos</b>; nada do histórico é apagado.</p>
        {erro && <ErrorBox>{erro}</ErrorBox>}
        <Input aria-label="Buscar paciente" placeholder="Buscar pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {pacientes.isLoading ? <p className="text-sm text-tinta-3">Carregando…</p> : ativos.length === 0 ? (
          <p className="text-sm text-tinta-3">Nenhum paciente ativo{busca ? ' com esse nome' : ''}.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {ativos.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-campo border border-linha bg-papel px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate font-bold">{p.social_name || p.full_name}</span>
                <Button size="sm" variant="secondary" busy={busy === p.id} disabled={!!busy && busy !== p.id} onClick={() => alta(p)}>Dar alta</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

// Agendamento pelo paciente (pedido do Jorge, 28/10/2026). Regras puras, sem rede.
import type { AgendaItem, BookingFrequency, BookingRequest, Modality, Patient } from './types';

export const FREQUENCIA_LINK: Record<BookingFrequency, string> = { nao: 'Avulsa (uma sessão)', semanal: 'Semanal', quinzenal: 'Quinzenal' };

/** Endereço do link que o paciente abre. */
export const linkAgendamentoUrl = (origin: string, token: string) => `${origin.replace(/\/$/, '')}/a/${token}`;

/** Texto pronto para o WhatsApp (a psicóloga revisa e envia). */
export function textoConviteLink(url: string, profissional: string): string {
  return [
    'Olá! Tudo bem?',
    'Por este link você escolhe o melhor horário para a sua sessão e preenche o seu cadastro:',
    url,
    'Depois eu confirmo o horário com você.',
    profissional,
  ].join('\n');
}

const CAMPOS_PACIENTE = ['full_name', 'phone', 'cpf', 'birth_date', 'email', 'cep', 'street', 'address_number', 'address_complement',
  'neighborhood', 'city', 'uf', 'nf_tomador', 'payer_tipo', 'payer_name', 'payer_cpf', 'payer_cnpj', 'payer_im', 'payer_email',
  'payer_phone', 'payer_cep', 'payer_street', 'payer_number', 'payer_complement', 'payer_neighborhood', 'payer_city', 'payer_uf'] as const;

/** Cadastro do paciente a partir do pedido (só os campos permitidos) + valor, duração e modalidade do link. */
export function pacienteDoPedido(r: Pick<BookingRequest, 'patient_data' | 'starts_at' | 'ends_at'>, o: { price: number | null; modality: Modality }): Partial<Patient> {
  const p: Record<string, unknown> = {};
  for (const k of CAMPOS_PACIENTE) {
    const v = r.patient_data[k];
    if (typeof v === 'string' && v.trim()) p[k] = v.trim();
  }
  const minutos = Math.round((new Date(r.ends_at).getTime() - new Date(r.starts_at).getTime()) / 60000);
  return { ...(p as Partial<Patient>), modality: o.modality, session_price: o.price, session_minutes: minutos };
}

/** Pedidos pendentes viram "ocupado" para a agenda não mostrar o horário como LIVRE. */
export function pedidosComoOcupados(pedidos: BookingRequest[] | undefined): AgendaItem[] {
  return (pedidos ?? []).filter((r) => r.status === 'pendente')
    .map((r) => ({ id: `pedido-${r.id}`, starts_at: r.starts_at, ends_at: r.ends_at, status: 'agendado', location_id: r.location_id }) as AgendaItem);
}

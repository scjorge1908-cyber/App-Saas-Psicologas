// Recibo do Receita Saúde no modo assistido (pedido do Jorge em 31/10/2026).
// A Receita não oferece API para sistemas emitirem o recibo: a psicóloga emite no app Receita Federal
// ou no Carnê-Leão Web, e o PsiConsultório só prepara os dados para copiar e controla o que já foi emitido.
import type { PaymentItem } from './types';
import { formatCpf, formatDate } from './format';

export interface CampoRecibo {
  rotulo: string;
  mostrar: string;
  copiar: string | null; // null: dado ausente, nada para copiar
}

// e-CAC, onde fica o Carnê-Leão Web com o Receita Saúde (no celular, o mesmo serviço está no app Receita Federal)
export const URL_ECAC = 'https://cav.receita.fazenda.gov.br/autenticacao/login';

const DESCRICAO_PADRAO = 'Atendimento psicológico';

const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

export function pagadorEhOutraPessoa(p: Pick<PaymentItem, 'payer_name' | 'payer_cpf' | 'patient_cpf'>): boolean {
  const cpfPagador = soDigitos(p.payer_cpf);
  if (cpfPagador) return cpfPagador !== soDigitos(p.patient_cpf);
  return !!p.payer_name;
}

export function dadosRecibo(p: Pick<PaymentItem, 'amount' | 'paid_on' | 'payer_name' | 'payer_cpf' | 'patient_name' | 'patient_cpf' | 'charge_description'>): CampoRecibo[] {
  const cpfPagador = soDigitos(p.payer_cpf ?? p.patient_cpf);
  const nomePagador = p.payer_name ?? p.patient_name;
  const valor = p.amount.toFixed(2).replace('.', ',');
  const campos: CampoRecibo[] = [
    { rotulo: 'CPF de quem pagou', mostrar: cpfPagador ? formatCpf(cpfPagador) : 'não cadastrado', copiar: cpfPagador || null },
    { rotulo: 'Nome de quem pagou', mostrar: nomePagador, copiar: nomePagador },
  ];
  if (pagadorEhOutraPessoa(p)) {
    const cpfPaciente = soDigitos(p.patient_cpf);
    campos.push(
      { rotulo: 'CPF do paciente (beneficiário)', mostrar: cpfPaciente ? formatCpf(cpfPaciente) : 'não cadastrado', copiar: cpfPaciente || null },
      { rotulo: 'Nome do paciente (beneficiário)', mostrar: p.patient_name, copiar: p.patient_name },
    );
  }
  const descricao = p.charge_description?.trim() || DESCRICAO_PADRAO;
  campos.push(
    { rotulo: 'Valor (R$)', mostrar: valor, copiar: valor },
    { rotulo: 'Data do pagamento', mostrar: formatDate(p.paid_on), copiar: formatDate(p.paid_on) },
    { rotulo: 'Descrição do serviço', mostrar: descricao, copiar: descricao },
  );
  return campos;
}

// Texto único com todos os dados, para colar numa nota do celular ou mandar para quem emite por procuração
export function textoRecibo(campos: CampoRecibo[]): string {
  return campos.map((c) => `${c.rotulo}: ${c.mostrar}`).join('\n');
}

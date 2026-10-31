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

// ---------------------------------------------------------------------------------------------
// Arquivo de importação do Carnê-Leão Web (pedido do Jorge em 31/10/2026, às 20:14).
// Leiaute do manual "Receita Saúde" v2.1 (Receita Federal, out/2025): CSV sem cabeçalho, campos
// separados por ";", 16 campos, até 1.000 linhas, todos os pagamentos do mesmo ano.
// Caminho no e-CAC: Carnê-Leão → Escrituração → Importar Escrituração → Analisar Arquivo → Importar.
// ---------------------------------------------------------------------------------------------

export const LOTE_MAX_LINHAS = 1000;
const CODIGO_RENDIMENTO = 'R01.001.001';
const CODIGO_OCUPACAO_PSICOLOGO = '255';
const DESCRICAO_MAX = 255;

export interface ProfissionalLote { cpf: string | null }

export interface ItemFora { id: string; motivo: string }

export interface ArquivoLote {
  ano: string;
  conteudo: string;
  incluidos: string[]; // ids dos recebimentos que entraram no arquivo
  fora: ItemFora[]; // recebimentos que não entraram e por quê
}

type PagamentoLote = Pick<PaymentItem, 'id' | 'amount' | 'paid_on' | 'payer_cpf' | 'patient_cpf' | 'patient_name' | 'charge_description'>;

// Sem acentos e sem ";" ou quebra de linha: evita erro de codificação e de coluna na importação
function textoSeguro(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, DESCRICAO_MAX);
}

export function motivoFora(p: PagamentoLote, prof: ProfissionalLote): string | null {
  if (soDigitos(prof.cpf).length !== 11) return 'Complete o seu CPF no perfil profissional.';
  const pagador = soDigitos(p.payer_cpf ?? p.patient_cpf);
  if (pagador.length !== 11) return 'Falta o CPF de quem pagou. Complete no cadastro do paciente.';
  const beneficiario = soDigitos(p.patient_cpf) || (p.payer_cpf ? '' : pagador);
  if (beneficiario.length !== 11) return `Falta o CPF do paciente ${p.patient_name}. Complete no cadastro do paciente.`;
  if (!(p.amount > 0)) return 'Valor do recebimento inválido.';
  return null;
}

export function linhaLote(p: PagamentoLote, prof: ProfissionalLote): string {
  const pagador = soDigitos(p.payer_cpf ?? p.patient_cpf);
  const beneficiario = soDigitos(p.patient_cpf) || pagador;
  const descricao = textoSeguro(p.charge_description?.trim() || DESCRICAO_PADRAO);
  return [
    formatDate(p.paid_on), // 1 data do pagamento DD/MM/AAAA
    CODIGO_RENDIMENTO, // 2 código do rendimento
    CODIGO_OCUPACAO_PSICOLOGO, // 3 código da ocupação (255 = psicólogo)
    p.amount.toFixed(2).replace('.', ','), // 4 valor, sem separador de milhar
    '', // 5 valor da dedução (vazio)
    descricao, // 6 descrição
    'PF', // 7 recebido de
    pagador, // 8 CPF do pagador
    beneficiario, // 9 CPF do beneficiário
    '', // 10 indicador de CPF não informado (vazio)
    '', // 11 CNPJ (vazio)
    '', // 12 indicador de IRRF (vazio)
    '', // 13 valor do IRRF (vazio)
    'S', // 14 indicador de recibo
    soDigitos(prof.cpf), // 15 CPF da profissional
    '', // 16 registro profissional: vazio quando há um só registro ativo
  ].join(';');
}

// Um arquivo por ano (exigência da Receita), em ordem de data, com no máximo 1.000 linhas cada
export function arquivosLote(pagamentos: PagamentoLote[], prof: ProfissionalLote): ArquivoLote[] {
  const porAno = new Map<string, ArquivoLote>();
  const ordenados = [...pagamentos].sort((a, b) => a.paid_on.localeCompare(b.paid_on));
  for (const p of ordenados) {
    const ano = p.paid_on.slice(0, 4);
    let arq = porAno.get(ano);
    if (!arq) { arq = { ano, conteudo: '', incluidos: [], fora: [] }; porAno.set(ano, arq); }
    const motivo = motivoFora(p, prof);
    if (motivo) { arq.fora.push({ id: p.id, motivo }); continue; }
    if (arq.incluidos.length >= LOTE_MAX_LINHAS) { arq.fora.push({ id: p.id, motivo: 'Passou de 1.000 recibos: gere outro arquivo depois de importar este.' }); continue; }
    arq.conteudo += linhaLote(p, prof) + '\r\n';
    arq.incluidos.push(p.id);
  }
  return [...porAno.values()].sort((a, b) => a.ano.localeCompare(b.ano));
}

export function nomeArquivoLote(ano: string, sufixo = ''): string {
  return `receita-saude-${ano}${sufixo ? '-' + sufixo : ''}.csv`;
}

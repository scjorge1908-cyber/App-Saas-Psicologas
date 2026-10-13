// Modelos de documentos (sem dependência de pdf-lib).
import type { DocumentType } from '../types';
import { formatCpf, formatDate, money, monthName, parseMoney } from '../format';

export interface Professional {
  full_name: string;
  crp: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  phone?: string | null;
  contact_email?: string | null;
  address?: string | null;
  city?: string | null;
  uf?: string | null;
}

export interface Section {
  heading?: string;
  text: string;
}

export interface DocumentSpec {
  type: DocumentType;
  title: string;
  sections: Section[];
  issuedOn: string; // YYYY-MM-DD
  validity?: string | null;
  confidentialityClause?: boolean;
}

export const DOC_LABELS: Record<DocumentType, string> = {
  declaracao: 'Declaração',
  atestado: 'Atestado psicológico',
  relatorio: 'Relatório psicológico',
  laudo: 'Laudo psicológico',
  parecer: 'Parecer psicológico',
  recibo: 'Recibo',
  contrato: 'Contrato de prestação de serviços psicológicos',
};

export function longDatePt(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} de ${monthName(m)} de ${y}`;
}

// ------------------------------------------------------------------ modelos ---

export interface PatientInfo {
  name: string;
  cpf?: string | null;
}

/** Monta as seções de cada tipo de documento a partir dos campos do formulário. */
export function buildSpec(type: DocumentType, f: Record<string, string>, patient: PatientInfo, pro: Professional, issuedOn: string): DocumentSpec {
  const v = (k: string) => (f[k] ?? '').trim();
  switch (type) {
    case 'declaracao':
      return {
        type, title: DOC_LABELS[type], issuedOn,
        confidentialityClause: f.sigilo === 'sim',
        sections: [{
          text: `Declaro, para fins de ${v('finalidade') || '[finalidade]'}, que ${patient.name} `
            + `${v('acompanhamento') || 'compareceu a atendimento psicológico'}`
            + `${v('local') ? `, em ${v('local')}` : ''}`
            + `${v('dias_horarios') ? `, ${v('dias_horarios')}` : ''}`
            + `${v('duracao') ? `, ${v('duracao')}` : ''}.`,
        }],
      };
    case 'atestado':
      return {
        type, title: DOC_LABELS[type], issuedOn, validity: v('validade') || null,
        confidentialityClause: f.sigilo === 'sim',
        sections: [{
          text: `Atesto, a pedido de ${v('solicitante') || '[solicitante]'}, para fins de ${v('finalidade') || '[finalidade]'}, `
            + `que ${patient.name} ${v('condicoes') || '[condições psicológicas]'}`.replace(/\n+/g, ' '),
        }],
      };
    case 'relatorio':
    case 'laudo': {
      const sections: Section[] = [
        { heading: '1. Identificação', text: `Autora: ${pro.full_name}${pro.crp ? `, CRP ${pro.crp}` : ''}.\nInteressado(a): ${patient.name}.\nSolicitante: ${v('solicitante') || '-'}.\nFinalidade: ${v('finalidade') || '-'}.` },
        { heading: '2. Descrição da demanda', text: v('demanda') || '-' },
        { heading: '3. Procedimento', text: v('procedimento') || '-' },
        { heading: '4. Análise', text: v('analise') || '-' },
        { heading: '5. Conclusão', text: v('conclusao') || '-' },
      ];
      if (type === 'laudo') sections.push({ heading: '6. Referências', text: v('referencias') || '-' });
      return { type, title: DOC_LABELS[type], issuedOn, sections, validity: v('validade') || null, confidentialityClause: f.sigilo === 'sim' };
    }
    case 'parecer':
      return {
        type, title: DOC_LABELS[type], issuedOn, confidentialityClause: f.sigilo === 'sim',
        sections: [
          { heading: '1. Identificação', text: `Parecerista: ${pro.full_name}${pro.crp ? `, CRP ${pro.crp}` : ''}.\nSolicitante: ${v('solicitante') || '-'}.\nAssunto: ${v('finalidade') || '-'}.` },
          { heading: '2. Descrição da demanda', text: v('demanda') || '-' },
          { heading: '3. Análise', text: v('analise') || '-' },
          { heading: '4. Conclusão', text: v('conclusao') || '-' },
          { heading: '5. Referências', text: v('referencias') || '-' },
        ],
      };
    case 'recibo': {
      const amount = parseMoney(f.valor || '') ?? 0;
      const payer = v('pagador_nome') || patient.name;
      const payerCpf = v('pagador_cpf') || patient.cpf || '';
      return {
        type, title: DOC_LABELS[type], issuedOn,
        sections: [
          {
            text: `Recebi de ${payer}${payerCpf ? `, CPF ${formatCpf(payerCpf)}` : ''}, a importância de ${money(amount)} `
              + `referente a ${v('descricao') || 'atendimento psicológico'}`
              + `${payer !== patient.name ? `, prestado a ${patient.name}${patient.cpf ? ` (CPF ${formatCpf(patient.cpf)})` : ''}` : ''}`
              + `${v('data_pagamento') ? `, pagamento efetuado em ${formatDate(v('data_pagamento'))}` : ''}.`,
          },
          { text: `Profissional: ${pro.full_name}${pro.crp ? `, CRP ${pro.crp}` : ''}${pro.cpf ? `, CPF ${formatCpf(pro.cpf)}` : ''}${pro.cnpj ? `, CNPJ ${pro.cnpj}` : ''}.` },
          { text: 'Profissionais pessoa física devem emitir também o recibo oficial no Receita Saúde (Receita Federal). Este documento é um comprovante complementar.' },
        ],
      };
    }
    case 'contrato':
      return {
        type, title: DOC_LABELS[type], issuedOn,
        sections: [
          { heading: 'Partes', text: `Psicóloga: ${pro.full_name}${pro.crp ? `, CRP ${pro.crp}` : ''}.\nPaciente: ${patient.name}${patient.cpf ? `, CPF ${formatCpf(patient.cpf)}` : ''}.${v('responsavel') ? `\nResponsável legal/financeiro: ${v('responsavel')}.` : ''}` },
          { heading: 'Atendimento', text: `Modalidade: ${v('modalidade') || 'presencial'}. Frequência: ${v('frequencia') || 'semanal'}. Duração de cada sessão: ${v('duracao') || '50 minutos'}.` },
          { heading: 'Valores e pagamento', text: `Valor: ${v('valor') ? money(parseMoney(v('valor')) ?? 0) : '-'} ${v('forma_cobranca') || 'por sessão'}. Forma de pagamento: ${v('forma_pagamento') || 'Pix'}. Reajuste: ${v('reajuste') || 'anual, comunicado com 30 dias de antecedência'}.` },
          { heading: 'Faltas e cancelamentos', text: v('politica_faltas') || 'Cancelamentos com menos de 24 horas de antecedência e faltas sem aviso poderão ser cobrados integralmente.' },
          { heading: 'Sigilo e registros', text: 'A psicóloga mantém sigilo sobre as informações obtidas, nos termos do Código de Ética Profissional do Psicólogo. Os registros do atendimento são mantidos em prontuário sigiloso pelo prazo mínimo previsto nas normas do Conselho Federal de Psicologia.' },
          { heading: 'Recursos tecnológicos', text: v('tecnologia') || 'Agenda, prontuário e financeiro são mantidos em sistema eletrônico com acesso restrito à psicóloga, conexão criptografada e controle de acesso por conta individual. Atendimentos online, quando houver, utilizam plataforma de videochamada indicada pela psicóloga.' },
          { heading: 'Foro', text: `Fica eleito o foro da comarca de ${v('foro') || [pro.city, pro.uf].filter(Boolean).join('/') || '[comarca]'} para dirimir questões deste contrato.` },
          { text: '\n\n______________________________\nPaciente ou responsável legal' },
        ],
      };
  }
}


// Prontuário: evolução estruturada (layout Stitch) gravada como texto legível no registro,
// e o resumo de cada paciente para a lista de prontuários. Regras puras, cobertas por testes.
import type { Patient, RecordEntry } from './types';

export const HUMORES = ['Ansioso', 'Calmo', 'Reativo', 'Reflexivo', 'Desanimado', 'Agitado', 'Choroso', 'Colaborativo'];
export const ABORDAGENS = ['TCC', 'Psicanálise', 'Humanista / ACP', 'ACT', 'Gestalt', 'Sistêmica', 'Comportamental'];

export interface Evolucao {
  formato: 'presencial' | 'online' | null;
  humor: string[];
  queixa: string;
  abordagens: string[];
  intervencoes: string;
  tarefas: string[];
}
export const EVOLUCAO_VAZIA: Evolucao = { formato: null, humor: [], queixa: '', abordagens: [], intervencoes: '', tarefas: [] };

const T_QUEIXA = '## Queixa / tema central';
const T_INTERV = '## Intervenções e abordagem';
const T_TAREFAS = '## Tarefas inter-sessão';

/** Monta o texto do registro. Fica legível em qualquer exportação, sem depender do app. */
export function montarEvolucao(e: Evolucao): string {
  const linhas: string[] = [];
  if (e.formato) linhas.push(`Formato: ${e.formato === 'online' ? 'On-line' : 'Presencial'}`);
  if (e.humor.length) linhas.push(`Humor: ${e.humor.join(', ')}`);
  linhas.push('', T_QUEIXA, e.queixa.trim() || '—');
  if (e.abordagens.length || e.intervencoes.trim()) {
    linhas.push('', T_INTERV);
    if (e.abordagens.length) linhas.push(`Abordagens: ${e.abordagens.join(', ')}`);
    if (e.intervencoes.trim()) linhas.push(e.intervencoes.trim());
  }
  const tarefas = e.tarefas.map((t) => t.trim()).filter(Boolean);
  if (tarefas.length) linhas.push('', T_TAREFAS, ...tarefas.map((t) => `- ${t}`));
  return linhas.join('\n').trim();
}

/** Lê um registro montado por montarEvolucao. Registros em texto livre (antigos) devolvem null. */
export function lerEvolucao(content: string): Evolucao | null {
  if (!content.includes(T_QUEIXA)) return null;
  const e: Evolucao = { ...EVOLUCAO_VAZIA, humor: [], abordagens: [], tarefas: [] };
  let secao: 'topo' | 'queixa' | 'interv' | 'tarefas' = 'topo';
  const queixa: string[] = []; const interv: string[] = [];
  for (const l of content.split('\n')) {
    if (l === T_QUEIXA) { secao = 'queixa'; continue; }
    if (l === T_INTERV) { secao = 'interv'; continue; }
    if (l === T_TAREFAS) { secao = 'tarefas'; continue; }
    if (secao === 'topo') {
      if (l.startsWith('Formato: ')) e.formato = l.includes('On-line') ? 'online' : 'presencial';
      else if (l.startsWith('Humor: ')) e.humor = l.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (secao === 'queixa') queixa.push(l);
    else if (secao === 'interv') {
      if (l.startsWith('Abordagens: ')) e.abordagens = l.slice(12).split(',').map((s) => s.trim()).filter(Boolean);
      else interv.push(l);
    } else if (l.startsWith('- ')) e.tarefas.push(l.slice(2));
  }
  e.queixa = queixa.join('\n').trim().replace(/^—$/, '');
  e.intervencoes = interv.join('\n').trim();
  return e;
}

export interface SessaoResumo { id: string; patient_id: string; starts_at: string; status: string }
export interface ProntuarioResumo {
  patient: Patient;
  demanda: string | null;          // primeira parte da avaliação da demanda mais recente
  ultima: { id: string; starts_at: string; numero: number } | null;
  proxima: string | null;
  evolucaoPendente: boolean;       // última sessão atendida sem registro vinculado
  evolucoes: number;
}

/** Junta pacientes, registros e sessões no resumo da lista (ordenado por atividade mais recente). */
export function resumirProntuarios(
  patients: Patient[],
  records: Array<Pick<RecordEntry, 'patient_id' | 'kind' | 'appointment_id' | 'entry_date' | 'created_at'> & { content?: string | null }>,
  sessoes: SessaoResumo[],
  agora = new Date(),
): ProntuarioResumo[] {
  const t = agora.getTime();
  const out = patients.map((p) => {
    const regs = records.filter((r) => r.patient_id === p.id);
    const dem = regs.filter((r) => r.kind === 'identificacao_demanda' && r.content)
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at))[0];
    const atendidas = sessoes.filter((s) => s.patient_id === p.id && s.status === 'atendido' && new Date(s.starts_at).getTime() <= t)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const ultimaS = atendidas[atendidas.length - 1];
    const proxima = sessoes.filter((s) => s.patient_id === p.id && (s.status === 'agendado' || s.status === 'confirmado') && new Date(s.starts_at).getTime() > t)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    const comRegistro = new Set(regs.map((r) => r.appointment_id).filter(Boolean));
    return {
      patient: p,
      demanda: dem?.content ? dem.content.replace(/\s+/g, ' ').trim().slice(0, 220) : null,
      ultima: ultimaS ? { id: ultimaS.id, starts_at: ultimaS.starts_at, numero: atendidas.length } : null,
      proxima: proxima?.starts_at ?? null,
      evolucaoPendente: !!ultimaS && !comRegistro.has(ultimaS.id),
      evolucoes: regs.filter((r) => r.kind === 'evolucao').length,
    };
  });
  const atividade = (r: ProntuarioResumo) => r.ultima?.starts_at ?? r.patient.created_at;
  return out.sort((a, b) => Number(b.evolucaoPendente) - Number(a.evolucaoPendente) || atividade(b).localeCompare(atividade(a)));
}

/** CPF com o meio oculto: ***.824.108-** */
export const cpfMascarado = (cpf: string | null | undefined) => (cpf && cpf.length === 11 ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : null);

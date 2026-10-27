// Agenda em colunas (referência: agenda do Hope App): um cartão por dia + sala, com os períodos
// (Manhã, Tarde, Noite) dentro e uma linha por horário — livre ou com paciente.
// Só organiza o que a tela já calculou (blocos da grade + sessões); não muda regra de agenda.
import type { AgendaItem, Location, ScheduleBlock } from './types';
import type { HorarioLivre } from './horarios';

// livre.quinzenal: horário vago só nas semanas alternadas de um paciente quinzenal (dataAlvo = data para agendar).
// fantasma: paciente quinzenal na semana em que NÃO tem sessão — aparece apagado, com a data da próxima.
export type Linha =
  | { tipo: 'sessao'; hora: string; item: AgendaItem }
  | { tipo: 'livre'; hora: string; livre: HorarioLivre; quinzenal?: boolean; dataAlvo?: string; ate?: string }
  | { tipo: 'fantasma'; hora: string; item: AgendaItem; proxima: string }
  // Paciente ativo fora da semana das sessões (27/10): "Começa dd/mm" ou avulso "sem próximo horário" (alerta para ajustar)
  | { tipo: 'futuro'; hora: string; item: AgendaItem; inicio: string; livreAte: string }
  | { tipo: 'semHorario'; hora: string; item: AgendaItem }
  // Férias, feriado ou folga no dia (27/10): faixa bloqueada, com quantas sessões já marcadas caem nela
  | { tipo: 'bloqueio'; hora: string; bloqueio: ScheduleBlock; sessoes: number };
/** Bloco da grade num dia (sala + período), ou "Outros horários" (sessões fora de qualquer bloco). */
export type Bloco = { chave: string; date: string; titulo: string; sala: Location | null; faixa: string | null; linhas: Linha[] };
export type PeriodoColuna = { titulo: string; faixa: string | null; linhas: Linha[] };
export type Coluna = { chave: string; date: string; sala: Location | null; periodos: PeriodoColuna[] };

const ORDEM = ['Manhã', 'Tarde', 'Noite', 'Outros horários'];
const ordem = (t: string) => { const i = ORDEM.indexOf(t); return i < 0 ? ORDEM.length : i; };
const porHora = (a: Linha, b: Linha) => a.hora.localeCompare(b.hora);

/** Junta faixas do mesmo período ("07:00–09:00" + "10:00–12:00" → "07:00–12:00"). */
function juntarFaixa(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const [ia, fa] = a.split('–'); const [ib, fb] = b.split('–');
  return `${ia < ib ? ia : ib}–${fa > fb ? fa : fb}`;
}

/**
 * Agrupa os blocos em colunas "dia + sala", na ordem dos dias. Blocos sem sala (Outros horários) entram na
 * primeira coluna do mesmo dia; se o dia não tiver nenhuma, ganham coluna própria. Períodos iguais na mesma
 * coluna viram um só, com as linhas em ordem de horário.
 */
export function agruparColunas(blocos: Bloco[]): Coluna[] {
  const colunas: Coluna[] = [];
  const achar = (date: string, salaId: string | null) => colunas.find((c) => c.date === date && (c.sala?.id ?? null) === salaId);
  // blocos com sala primeiro, para "Outros horários" sempre achar o cartão do dia (se houver)
  for (const b of [...blocos.filter((x) => x.sala), ...blocos.filter((x) => !x.sala)]) {
    let col = b.sala ? achar(b.date, b.sala.id) : colunas.find((c) => c.date === b.date) ?? null;
    if (!col) { col = { chave: `${b.date}|${b.sala?.id ?? 'sem-sala'}`, date: b.date, sala: b.sala, periodos: [] }; colunas.push(col); }
    const p = col.periodos.find((x) => x.titulo === b.titulo);
    if (p) { p.linhas = [...p.linhas, ...b.linhas].sort(porHora); p.faixa = juntarFaixa(p.faixa, b.faixa); }
    else col.periodos.push({ titulo: b.titulo, faixa: b.faixa, linhas: [...b.linhas].sort(porHora) });
  }
  for (const c of colunas) c.periodos.sort((a, b) => ordem(a.titulo) - ordem(b.titulo));
  return colunas.sort((a, b) => a.date.localeCompare(b.date) || (a.sala?.name ?? '~').localeCompare(b.sala?.name ?? '~'));
}

/** Contagem de linhas por tipo (para os totais da semana ou do dia). */
export function contar(colunas: Coluna[]): { agendados: number; livres: number } {
  let agendados = 0; let livres = 0;
  for (const c of colunas) for (const p of c.periodos) for (const l of p.linhas) { if (l.tipo === 'sessao') agendados++; else if (l.tipo === 'livre') livres++; }
  return { agendados, livres };
}

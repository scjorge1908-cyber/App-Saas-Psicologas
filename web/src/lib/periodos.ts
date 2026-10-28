// Períodos de atendimento e geração dos horários de cada bloco.
// Regra de Jorge: Manhã 07–12, Tarde 13–17, Noite 18–22. A psicóloga escolhe a duração da sessão
// e o intervalo; o sistema monta os horários dentro do período respeitando o intervalo.

export type PeriodoId = 'manha' | 'tarde' | 'noite';
export const PERIODOS: Array<{ id: PeriodoId; nome: string; inicio: string; fim: string }> = [
  { id: 'manha', nome: 'Manhã', inicio: '07:00', fim: '12:00' },
  { id: 'tarde', nome: 'Tarde', inicio: '13:00', fim: '17:00' },
  { id: 'noite', nome: 'Noite', inicio: '18:00', fim: '22:00' },
];

/** A grade vai das 07:00 às 23:00 (regra do Jorge, 27/10/2026). Dentro disso a psicóloga cria quantos turnos quiser. */
export const GRADE_INICIO = '07:00';
export const GRADE_FIM = '23:00';
/** Mensagem de erro se a faixa sai do limite da grade; null se está dentro. */
export function foraDaGrade(inicio: string, fim: string): string | null {
  return inicio < GRADE_INICIO || fim > GRADE_FIM ? `A grade vai das ${GRADE_INICIO} às ${GRADE_FIM}. Ajuste o início e o término dentro desse horário.` : null;
}

export const DURACOES = [30, 40, 45, 50, 60, 90];
export const INTERVALOS = [0, 10, 15, 20, 30];

const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Período pelo horário de início: antes de 12h manhã, antes de 18h tarde, depois noite. */
export function periodoDe(inicio: string): (typeof PERIODOS)[number] {
  const m = min(inicio);
  return m < 12 * 60 ? PERIODOS[0] : m < 18 * 60 ? PERIODOS[1] : PERIODOS[2];
}

/** Inícios de sessão dentro do bloco: a cada (duração + intervalo), sem passar do fim. */
export function gerarInicios(inicio: string, fim: string, duracao: number, intervalo: number): string[] {
  const passo = Math.max(10, duracao + Math.max(0, intervalo));
  const out: string[] = [];
  for (let m = min(inicio); m + duracao <= min(fim); m += passo) out.push(hhmm(m));
  return out;
}

/**
 * Divide um turno pelos períodos (regra do Jorge, 27/10/2026): manhã até 12h, tarde das 12h às 18h, noite a partir das 18h.
 * Ex.: 07:00–21:00 vira manhã, tarde e noite, cada uma com os mesmos horários que o turno inteiro teria.
 * Cada pedaço vai do 1º horário até o fim da última sessão dele.
 */
export function dividirPorPeriodo(inicio: string, fim: string, duracao: number, intervalo: number): Array<{ periodo: PeriodoId; ini: string; fim: string; inicios: string[] }> {
  const grupos: Array<{ periodo: PeriodoId; ini: string; fim: string; inicios: string[] }> = [];
  for (const t of gerarInicios(inicio, fim, duracao, intervalo)) {
    const p = periodoDe(t).id;
    const ult = grupos[grupos.length - 1];
    if (ult && ult.periodo === p) { ult.inicios.push(t); ult.fim = hhmm(min(t) + duracao); }
    else grupos.push({ periodo: p, ini: t, fim: hhmm(min(t) + duracao), inicios: [t] });
  }
  return grupos;
}

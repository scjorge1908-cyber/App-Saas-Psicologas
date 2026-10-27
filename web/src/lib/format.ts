// Formatação e conversões para pt-BR. Funções puras (testadas em format.test.ts).

export const DEFAULT_TZ = 'America/Sao_Paulo';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function money(v: number | null | undefined): string {
  return brl.format(Number(v ?? 0));
}

/** Converte "1.234,56" | "1234.56" | "150" em número com 2 casas; null se inválido. */
export function parseMoney(input: string): number | null {
  const s = input.trim().replace(/\s|R\$/g, '');
  if (!s) return null;
  let norm = s;
  if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return null;
  return Math.round(Number(norm) * 100) / 100;
}

/** Soma valores monetários sem erro de ponto flutuante (em centavos). */
export function sumMoney(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + Math.round(Number(v ?? 0) * 100), 0) / 100;
}

export const onlyDigits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

export function formatCpf(cpf: string | null | undefined): string {
  const d = onlyDigits(cpf);
  if (d.length !== 11) return cpf ?? '';
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Valida CPF pelos dígitos verificadores. */
export function isValidCpf(cpf: string): boolean {
  const d = onlyDigits(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function formatPhone(p: string | null | undefined): string {
  const d = onlyDigits(p);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p ?? '';
}

/** Normaliza CRP para "RR/NNNNNN" (região com 2 dígitos). */
export function normalizeCrp(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})\s*[/\-.\s]\s*(\d{3,7})$/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}/${m[2]}`;
}

// ---------------------------------------------------------------- datas -----

/** Partes de data/hora de um instante num fuso. */
export function zonedParts(iso: string | Date, tz = DEFAULT_TZ) {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    year: Number(get('year')), month: Number(get('month')), day: Number(get('day')),
    hour: Number(get('hour')), minute: Number(get('minute')), second: Number(get('second')),
  };
}

/** Converte data+hora locais de um fuso para instante UTC (ISO). */
export function zonedToUtc(date: string, time: string, tz = DEFAULT_TZ): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // offset do fuso naquele instante (duas iterações cobrem transições de horário de verão)
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(ts), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    ts = guess - (asUtc - ts);
  }
  return new Date(ts).toISOString();
}

export function todayIn(tz = DEFAULT_TZ): string {
  return zonedParts(new Date(), tz).date;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Dia da semana (0=domingo) de uma data YYYY-MM-DD. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function startOfWeek(date: string): string {
  // semana começando na segunda-feira
  const wd = weekday(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function daysInMonth(date: string): number {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const weekdayName = (date: string) => WEEKDAYS[weekday(date)];
export const weekdayShort = (date: string) => WEEKDAYS_SHORT[weekday(date)];
export const monthName = (m: number) => MONTHS[m - 1];

/** "12/10/2026" */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "segunda-feira, 12 de outubro" */
export function formatLongDate(date: string, withYear = false): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${weekdayName(date)}, ${d} de ${monthName(m)}${withYear ? ` de ${y}` : ''}`;
}

export function formatTime(iso: string, tz = DEFAULT_TZ): string {
  return zonedParts(iso, tz).time;
}

export function formatDateTime(iso: string, tz = DEFAULT_TZ): string {
  const p = zonedParts(iso, tz);
  return `${formatDate(p.date)} às ${p.time}`;
}

export function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

/** Idade em anos completos numa data de referência. */
export function ageOn(birth: string, ref: string): number {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ry, rm, rd] = ref.split('-').map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age--;
  return age;
}

export function isMinor(birth: string | null, ref: string): boolean {
  return !!birth && ageOn(birth, ref) < 18;
}

export function firstName(full: string | null | undefined): string {
  return (full ?? '').trim().split(/\s+/)[0] ?? '';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Aviso para data de nascimento implausível (idade abaixo de 2 ou acima de 110 anos).
 * Só avisa: nunca corrige a data sozinho. Vazio = sem aviso.
 */
export function avisoNascimento(birth: string | null | undefined, ref: string): string | null {
  if (!birth || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
  if (birth > ref) return 'Confira a data de nascimento: está no futuro.';
  const idade = ageOn(birth, ref);
  if (idade < 2) return `Confira a data de nascimento: idade calculada ${idade} ${idade === 1 ? 'ano' : 'anos'}.`;
  if (idade > 110) return `Confira a data de nascimento: idade calculada ${idade} anos.`;
  return null;
}

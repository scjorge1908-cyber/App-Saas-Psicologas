// Máscaras de digitação (formatam enquanto a pessoa digita; o que é salvo continua só com os números).

const dig = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

/** (48) 99999-9999 ou (48) 3333-4444 */
export function mascararTelefone(v: string): string {
  const d = dig(v, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** 000.000.000-00 */
export function mascararCpf(v: string): string {
  const d = dig(v, 11);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join('.') + (d.length > 9 ? `-${d.slice(9)}` : '');
}

/** dd/mm/aaaa */
export function mascararData(v: string): string {
  const d = dig(v, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join('/');
}

/** "25/03/1990" → "1990-03-25"; data incompleta ou impossível → null */
export function dataBrParaIso(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const [, dd, mm, aaaa] = m;
  const d = new Date(Date.UTC(Number(aaaa), Number(mm) - 1, Number(dd)));
  if (d.getUTCFullYear() !== Number(aaaa) || d.getUTCMonth() !== Number(mm) - 1 || d.getUTCDate() !== Number(dd)) return null;
  return `${aaaa}-${mm}-${dd}`;
}

/** "1990-03-25" → "25/03/1990" */
export const isoParaDataBr = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** CNPJ: 00.000.000/0000-00 */
export const mascararCnpj = (v: string) => {
  const d = dig(v, 14);
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
};

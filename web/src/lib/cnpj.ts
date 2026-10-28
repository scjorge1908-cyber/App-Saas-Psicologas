// Consulta de CNPJ na BrasilAPI (pública e gratuita), pedido do Jorge em 28/10/2026: digitou o CNPJ,
// o nome da empresa (razão social) aparece sozinho. Só o CNPJ sai do aparelho.
import { isValidCnpj, onlyDigits } from './format';

export interface EmpresaCnpj { razaoSocial: string; nomeFantasia: string }

export async function buscarCnpj(cnpj: string, f: typeof fetch = fetch): Promise<EmpresaCnpj | null> {
  const d = onlyDigits(cnpj);
  if (!isValidCnpj(d)) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await f(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { razao_social?: string; nome_fantasia?: string | null };
    if (!j.razao_social) return null;
    return { razaoSocial: j.razao_social.trim(), nomeFantasia: (j.nome_fantasia ?? '').trim() };
  } catch {
    return null; // sem internet ou serviço fora do ar: a psicóloga digita o nome
  } finally {
    clearTimeout(t);
  }
}

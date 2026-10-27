// Consulta de CEP no ViaCEP (serviço público e gratuito). Só o CEP sai do aparelho, nenhum dado do paciente.
export interface EnderecoCep { street: string; neighborhood: string; city: string; uf: string }

export async function buscarCep(cep: string, f: typeof fetch = fetch): Promise<EnderecoCep | null> {
  const d = cep.replace(/\D/g, '');
  if (d.length !== 8) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await f(`https://viacep.com.br/ws/${d}/json/`, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { erro?: boolean | string; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (j.erro) return null;
    return { street: j.logradouro ?? '', neighborhood: j.bairro ?? '', city: j.localidade ?? '', uf: (j.uf ?? '').toUpperCase() };
  } catch {
    return null; // sem internet ou serviço fora do ar: a psicóloga digita o endereço
  } finally {
    clearTimeout(t);
  }
}

export const formatarCep = (s: string) => { const d = s.replace(/\D/g, '').slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };

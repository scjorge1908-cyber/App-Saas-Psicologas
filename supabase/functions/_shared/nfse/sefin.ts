// Cliente da API oficial da NFS-e Nacional (Sefin Nacional + ADN). Gratuita; autenticação por
// certificado de cliente (mTLS) do próprio prestador. O transporte (quem faz o HTTPS com o certificado)
// é injetado: Deno.createHttpClient na função do servidor, https do Node nos testes locais.
import { deGzipB64, gzipB64 } from './assinatura.ts';
import type { Ambiente } from './dps.ts';

export const URLS: Record<Ambiente, { sefin: string; adn: string }> = {
  // Produção restrita usa "/API/SefinNacional"; produção, "/SefinNacional" (página oficial de APIs; confirmado com A1 real
  // por outro projeto em 05/11/2026 — o POST /nfse foi aceito em /API/SefinNacional).
  homologacao: { sefin: 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional', adn: 'https://adn.producaorestrita.nfse.gov.br' },
  producao: { sefin: 'https://sefin.nfse.gov.br/SefinNacional', adn: 'https://adn.nfse.gov.br' },
};

export interface RespostaHttp { status: number; corpo: Uint8Array; tipo: string }
export type Transporte = (url: string, init: { method: 'GET' | 'POST'; json?: unknown }) => Promise<RespostaHttp>;

/** Situação do município no sistema nacional da NFS-e. */
export type SituacaoConvenio = 'emissor_nacional' | 'sistema_proprio' | 'sem_convenio';

export class ErroSefin extends Error {
  status: number;
  codigos: string[];
  /** true quando não houve resposta (rede/tempo): a nota pode ou não ter sido gerada. */
  semResposta: boolean;
  constructor(msg: string, status = 0, codigos: string[] = [], semResposta = false) {
    super(msg); this.status = status; this.codigos = codigos; this.semResposta = semResposta;
  }
}

const texto = (r: RespostaHttp) => new TextDecoder().decode(r.corpo);
function json(r: RespostaHttp): Record<string, unknown> | null {
  try { return JSON.parse(texto(r)); } catch { return null; }
}

/** Lista de erros da Sefin (vem como "erros" ou "erro", com Codigo/codigo e Descricao/descricao). */
export function errosSefin(corpo: Record<string, unknown> | null): { codigo: string; descricao: string }[] {
  if (!corpo) return [];
  const bruto = (corpo.erros ?? corpo.Erros ?? corpo.erro ?? corpo.Erro) as unknown;
  const lista = Array.isArray(bruto) ? bruto : bruto ? [bruto] : [];
  return lista.map((e) => {
    const o = e as Record<string, string>;
    const desc = [o.Descricao ?? o.descricao, o.Complemento ?? o.complemento].filter(Boolean).join(' — ');
    return { codigo: String(o.Codigo ?? o.codigo ?? ''), descricao: desc || 'erro sem descrição' };
  });
}

function falha(r: RespostaHttp, acao: string): never {
  const erros = errosSefin(json(r));
  if (erros.length) throw new ErroSefin(erros.map((e) => `${e.codigo}: ${e.descricao}`).join(' | '), r.status, erros.map((e) => e.codigo));
  if (r.status === 401 || r.status === 403) throw new ErroSefin(`${acao}: o sistema nacional recusou o certificado (HTTP ${r.status}). Confira se é o A1 do mesmo CNPJ/CPF do Perfil.`, r.status);
  throw new ErroSefin(`${acao}: resposta inesperada do sistema nacional (HTTP ${r.status}).`, r.status);
}

export interface NfseGerada { chave: string; xml: string; numero: string | null; emitidaEm: string | null }

export function dadosDaNfse(chave: string, xml: string): NfseGerada {
  const numero = xml.match(/<nNFSe>(\d+)<\/nNFSe>/)?.[1] ?? null;
  const dh = xml.match(/<dhProc>([0-9T:\-+]+)<\/dhProc>/)?.[1] ?? xml.match(/<dhEmi>([0-9T:\-+]+)<\/dhEmi>/)?.[1] ?? null;
  return { chave, xml, numero, emitidaEm: dh ? dh.slice(0, 10) : null };
}

const CHAVE = /^[0-9]{50}$/;
const ID_DPS = /^DPS[0-9]{42}$/;
/** Só chave/Id no formato oficial entram no endereço (nada de "../" vindo do banco). */
function exigir(v: string, re: RegExp, nome: string) {
  if (!re.test(v)) throw new ErroSefin(`${nome} inválida.`);
  return v;
}

export function clienteSefin(transporte: Transporte, ambiente: Ambiente, base = URLS[ambiente]) {
  const chamar = async (url: string, init: Parameters<Transporte>[1]) => {
    try { return await transporte(url, init); } catch (e) {
      throw new ErroSefin(`Sem resposta do sistema nacional (${(e as Error).message}).`, 0, [], true);
    }
  };
  return {
    async enviarDps(xmlAssinado: string): Promise<NfseGerada> {
      const r = await chamar(`${base.sefin}/nfse`, { method: 'POST', json: { dpsXmlGZipB64: await gzipB64(xmlAssinado) } });
      const j = json(r);
      if (r.status >= 200 && r.status < 300 && CHAVE.test(String(j?.chaveAcesso ?? '')) && j?.nfseXmlGZipB64) {
        return dadosDaNfse(String(j.chaveAcesso), await deGzipB64(String(j.nfseXmlGZipB64)));
      }
      falha(r, 'Emissão');
    },
    /** Procura a NFS-e gerada a partir de uma DPS (usado no reenvio, para não emitir em dobro). */
    async chaveDaDps(idDps: string): Promise<string | null> {
      const r = await chamar(`${base.sefin}/dps/${exigir(idDps, ID_DPS, 'Id da DPS')}`, { method: 'GET' });
      if (r.status === 404) return null;
      const j = json(r);
      if (r.status === 200 && CHAVE.test(String(j?.chaveAcesso ?? ''))) return String(j!.chaveAcesso);
      if (r.status === 400 && errosSefin(j).length) return null;
      falha(r, 'Consulta da DPS');
    },
    async obterNfse(chave: string): Promise<NfseGerada> {
      const r = await chamar(`${base.sefin}/nfse/${exigir(chave, CHAVE, 'Chave')}`, { method: 'GET' });
      const j = json(r);
      if (r.status === 200 && j?.nfseXmlGZipB64) return dadosDaNfse(chave, await deGzipB64(String(j.nfseXmlGZipB64)));
      falha(r, 'Consulta da NFS-e');
    },
    async cancelar(chave: string, eventoAssinado: string): Promise<void> {
      const r = await chamar(`${base.sefin}/nfse/${exigir(chave, CHAVE, 'Chave')}/eventos`, { method: 'POST', json: { pedidoRegistroEventoXmlGZipB64: await gzipB64(eventoAssinado) } });
      if (r.status >= 200 && r.status < 300) return;
      falha(r, 'Cancelamento');
    },
    /**
     * Convênio do município com o sistema nacional: GET {adn}/parametrizacao/{município}/convenio (Swagger oficial da
     * parametrização; a rota via Sefin responde 404). Resposta: { parametrosConvenio: { aderenteAmbienteNacional,
     * aderenteEmissorNacional, ... } } com 1/0.
     *  - 404, ou aderenteAmbienteNacional ≠ 1 → sem_convenio;
     *  - aderenteEmissorNacional ≠ 1 → sistema_proprio (envia dados ao nacional, mas emite no sistema da prefeitura);
     *  - os dois = 1 → emissor_nacional (o app emite).
     * Qualquer outra resposta = não dá para saber (null), e o app não bloqueia por isso.
     */
    async convenio(cMun: string): Promise<{ situacao: SituacaoConvenio | null; detalhe: string }> {
      const r = await chamar(`${base.adn}/parametrizacao/${exigir(cMun, /^[0-9]{7}$/, 'Município')}/convenio`, { method: 'GET' });
      const j = json(r);
      const detalhe = texto(r).slice(0, 500);
      if (r.status === 404 && j) return { situacao: 'sem_convenio', detalhe };
      const p = (j?.parametrosConvenio ?? null) as Record<string, unknown> | null;
      if (r.status === 200 && p) {
        if (Number(p.aderenteAmbienteNacional) !== 1) return { situacao: 'sem_convenio', detalhe };
        return { situacao: Number(p.aderenteEmissorNacional) === 1 ? 'emissor_nacional' : 'sistema_proprio', detalhe };
      }
      return { situacao: null, detalhe: `HTTP ${r.status}` };
    },
    async danfse(chave: string): Promise<Uint8Array> {
      const r = await chamar(`${base.adn}/danfse/${exigir(chave, CHAVE, 'Chave')}`, { method: 'GET' });
      if (r.status === 200 && r.tipo.includes('pdf')) return r.corpo;
      falha(r, 'PDF da nota (DANFSe)');
    },
  };
}

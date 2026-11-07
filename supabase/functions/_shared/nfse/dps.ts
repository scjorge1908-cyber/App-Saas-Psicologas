// Montagem da DPS (Declaração de Prestação de Serviço) da NFS-e Nacional, leiaute 1.01
// (esquemas oficiais DPS_v1.01.xsd / tiposComplexos_v1.01.xsd). Sem dependências: roda no Deno
// (função do servidor) e no Node (testes locais).
//
// O XML sai já na forma canônica (sem espaços entre tags, atributos em ordem fixa), o que permite
// assinar sem um canonicalizador genérico. A verificação independente é feita nos testes com xml-crypto.

export const NS_NFSE = 'http://www.sped.fazenda.gov.br/nfse';
export const VERSAO_LEIAUTE = '1.01';
export const VER_APLIC = 'PsiConsultorio-1.0';

export type Ambiente = 'homologacao' | 'producao';
export type Regime = 'mei' | 'me_epp' | 'nao_optante';

export interface Prestador {
  cnpj?: string | null;
  cpf?: string | null;
  im?: string | null;
  ibge: string;
  regime: Regime;
  aliquota?: number | null;
}

export interface Tomador {
  tipo: 'pf' | 'pj';
  documento: string;
  nome: string;
  im?: string | null;
  email?: string | null;
  fone?: string | null;
}

export interface DadosDps {
  ambiente: Ambiente;
  emitidoEm: Date;
  fuso: string;
  serie: string;
  numero: number | bigint;
  competencia: string; // AAAA-MM-DD
  prestador: Prestador;
  tomador: Tomador;
  codTribNac: string;
  descricao: string;
  valor: number;
}

export class ErroDados extends Error {
  campos: string[];
  constructor(campos: string[]) {
    super(`Faltam ou estão inválidos: ${campos.join('; ')}`);
    this.campos = campos;
  }
}

/** Escapa texto como a canonicalização C14N faz (o leiaute não usa atributos com texto livre). */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

/** Texto aceito pelo tipo TSString do leiaute: só Latin-1, sem quebras, sem espaço nas pontas. */
export function textoLeiaute(s: string, max: number): string {
  const t = s.normalize('NFC')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return t.slice(0, max).trim();
}

const so = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

export function cpfValido(c: string): boolean {
  const d = so(c);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function cnpjValido(c: string): boolean {
  const d = so(c);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => { const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * pesos[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** Data e hora no fuso informado, no formato do leiaute: AAAA-MM-DDThh:mm:ss-03:00. */
export function dataHoraLeiaute(d: Date, fuso: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const minutos = Math.round((local - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sinal = minutos < 0 ? '-' : '+';
  const abs = Math.abs(minutos);
  const off = `${sinal}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off}`;
}

/** Id da DPS (45 posições): "DPS" + município(7) + tipo de inscrição(1: 1=CPF, 2=CNPJ) + inscrição(14) + série(5) + número(15). */
export function idDps(ibge: string, prestador: Prestador, serie: string, numero: number | bigint): string {
  const cnpj = so(prestador.cnpj);
  const tipo = cnpj ? '2' : '1';
  const insc = (cnpj || so(prestador.cpf)).padStart(14, '0');
  return `DPS${ibge}${tipo}${insc}${so(serie).padStart(5, '0')}${String(numero).padStart(15, '0')}`;
}

export function validarDados(d: DadosDps): string[] {
  const erros: string[] = [];
  const cnpj = so(d.prestador.cnpj); const cpf = so(d.prestador.cpf);
  if (cnpj ? !cnpjValido(cnpj) : !cpfValido(cpf)) erros.push('CNPJ (ou CPF) do prestador no Perfil');
  if (!/^[0-9]{7}$/.test(d.prestador.ibge ?? '')) erros.push('município do prestador (código IBGE) — busque o CEP no Perfil');
  if (!['mei', 'me_epp', 'nao_optante'].includes(d.prestador.regime)) erros.push('regime tributário (MEI, ME/EPP ou não optante)');
  if (d.prestador.im != null && d.prestador.im !== '' && !/^[0-9A-Za-z./-]{1,15}$/.test(d.prestador.im)) erros.push('inscrição municipal');
  if (!/^[0-9]{6}$/.test(d.codTribNac)) erros.push('código de tributação nacional (6 números)');
  if (!/^[0-9]{1,5}$/.test(d.serie)) erros.push('série da DPS');
  if (!(BigInt(d.numero) >= 1n && BigInt(d.numero) <= 999999999999999n)) erros.push('número da DPS');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.competencia)) erros.push('competência');
  if (!(d.valor > 0 && d.valor < 1e13)) erros.push('valor da nota');
  const t = d.tomador;
  if (!t?.documento) erros.push('CPF ou CNPJ de quem recebe a nota (cadastro do paciente, cartão Nota fiscal)');
  else if (t.tipo === 'pj' ? !cnpjValido(t.documento) : !cpfValido(t.documento)) erros.push(`${t.tipo === 'pj' ? 'CNPJ' : 'CPF'} de quem recebe a nota`);
  if (!textoLeiaute(t?.nome ?? '', 300)) erros.push('nome de quem recebe a nota');
  if (!textoLeiaute(d.descricao ?? '', 2000)) erros.push('descrição do serviço');
  return erros;
}

const el = (nome: string, conteudo: string) => `<${nome}>${conteudo}</${nome}>`;
const opt = (nome: string, v: string | null | undefined) => (v ? el(nome, esc(v)) : '');
export const valorLeiaute = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

export interface DpsMontada {
  id: string;
  /** Documento completo, sem assinatura (sem declaração XML). */
  xml: string;
  /** infDPS na forma canônica (com o xmlns herdado), base do DigestValue. */
  canonico: string;
}

export function montarDps(d: DadosDps): DpsMontada {
  const erros = validarDados(d);
  if (erros.length) throw new ErroDados(erros);
  const p = d.prestador;
  const id = idDps(p.ibge, p, d.serie, d.numero);
  const cnpj = so(p.cnpj); const cpf = so(p.cpf);

  const opSimpNac = p.regime === 'mei' ? '2' : p.regime === 'me_epp' ? '3' : '1';
  const regTrib = el('regTrib',
    el('opSimpNac', opSimpNac) + (p.regime === 'me_epp' ? el('regApTribSN', '1') : '') + el('regEspTrib', '0'));
  const prest = el('prest', (cnpj ? el('CNPJ', cnpj) : el('CPF', cpf)) + opt('IM', p.im) + regTrib);

  const t = d.tomador;
  const doc = so(t.documento);
  const fone = so(t.fone);
  const email = t.email ? textoLeiaute(t.email, 80) : '';
  const toma = el('toma',
    (t.tipo === 'pj' ? el('CNPJ', doc) : el('CPF', doc)) +
    (t.tipo === 'pj' ? opt('IM', t.im ? textoLeiaute(t.im, 15) : '') : '') +
    el('xNome', esc(textoLeiaute(t.nome, 300))) +
    (fone.length >= 6 && fone.length <= 20 ? el('fone', fone) : '') +
    (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? el('email', esc(email)) : ''));

  const serv = el('serv',
    el('locPrest', el('cLocPrestacao', p.ibge)) +
    el('cServ', el('cTribNac', d.codTribNac) + el('xDescServ', esc(textoLeiaute(d.descricao, 2000)))));

  // ISS: operação tributável, não retido. Alíquota só para ME/EPP que a informou (MEI e não optante usam a do município).
  const aliq = p.regime === 'me_epp' && p.aliquota ? el('pAliq', valorLeiaute(p.aliquota)) : '';
  const valores = el('valores',
    el('vServPrest', el('vServ', valorLeiaute(d.valor))) +
    el('trib', el('tribMun', el('tribISSQN', '1') + el('tpRetISSQN', '1') + aliq) + el('totTrib', el('indTotTrib', '0'))));

  const corpo =
    el('tpAmb', d.ambiente === 'producao' ? '1' : '2') +
    el('dhEmi', dataHoraLeiaute(d.emitidoEm, d.fuso)) +
    el('verAplic', VER_APLIC) +
    el('serie', so(d.serie)) +
    el('nDPS', String(d.numero)) +
    el('dCompet', d.competencia) +
    el('tpEmit', '1') +
    el('cLocEmi', p.ibge) +
    prest + toma + serv + valores;

  const infDps = `<infDPS Id="${id}">${corpo}</infDPS>`;
  return {
    id,
    xml: `<DPS xmlns="${NS_NFSE}" versao="${VERSAO_LEIAUTE}">${infDps}</DPS>`,
    canonico: `<infDPS xmlns="${NS_NFSE}" Id="${id}">${corpo}</infDPS>`,
  };
}

/** Pedido de registro do evento de cancelamento (e101101). */
export function montarCancelamento(a: {
  ambiente: Ambiente; chave: string; emitidoEm: Date; fuso: string; cnpj?: string | null; cpf?: string | null;
  codigo: '1' | '2' | '9'; motivo: string;
}): DpsMontada {
  const motivo = textoLeiaute(a.motivo, 255);
  const erros: string[] = [];
  if (!/^[0-9]{50}$/.test(a.chave)) erros.push('chave de acesso da NFS-e');
  if (motivo.length < 15) erros.push('motivo do cancelamento (mínimo 15 letras)');
  if (!['1', '2', '9'].includes(a.codigo)) erros.push('código do motivo');
  const cnpj = so(a.cnpj); const cpf = so(a.cpf);
  if (cnpj ? !cnpjValido(cnpj) : !cpfValido(cpf)) erros.push('CNPJ (ou CPF) do prestador');
  if (erros.length) throw new ErroDados(erros);
  const id = `PRE${a.chave}101101`;
  const corpo =
    el('tpAmb', a.ambiente === 'producao' ? '1' : '2') +
    el('verAplic', VER_APLIC) +
    el('dhEvento', dataHoraLeiaute(a.emitidoEm, a.fuso)) +
    (cnpj ? el('CNPJAutor', cnpj) : el('CPFAutor', cpf)) +
    el('chNFSe', a.chave) +
    el('e101101', el('xDesc', 'Cancelamento de NFS-e') + el('cMotivo', a.codigo) + el('xMotivo', esc(motivo)));
  return {
    id,
    xml: `<pedRegEvento xmlns="${NS_NFSE}" versao="${VERSAO_LEIAUTE}"><infPedReg Id="${id}">${corpo}</infPedReg></pedRegEvento>`,
    canonico: `<infPedReg xmlns="${NS_NFSE}" Id="${id}">${corpo}</infPedReg>`,
  };
}

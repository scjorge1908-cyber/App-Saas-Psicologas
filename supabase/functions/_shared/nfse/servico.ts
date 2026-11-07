// Regras da emissão de NFS-e pelo app. Independente de plataforma: a função do servidor (Deno) e o
// gateway local de testes (Node) injetam o acesso ao banco (rpc com papel de servidor), o transporte
// HTTPS com certificado e a chave do cofre.
//
// Ordem segura da emissão:
//  1. confere dados e certificado ANTES de reservar número (erro de cadastro não gasta número);
//  2. reserva (trava a nota, marca "processando", dá número da DPS; reenvio reaproveita o mesmo);
//  3. no reenvio, pergunta à Sefin se aquela DPS já virou nota (evita nota em dobro);
//  4. assina e envia; grava sucesso (emitida) ou erro (volta a "a emitir" com a mensagem da Sefin).
import { assinar, b64, importarChave } from './assinatura.ts';
import { lerPfx, verificarValidade, ErroCertificado } from './certificado.ts';
import { cifrar, decifrar, deB64 } from './cofre.ts';
import { montarCancelamento, montarDps, valorLeiaute, ErroDados, type Ambiente, type DadosDps, type Regime } from './dps.ts';
import { clienteSefin, ErroSefin, URLS, type SituacaoConvenio, type Transporte } from './sefin.ts';

export interface Dependencias {
  dono: string;
  rpc: (nome: string, args: Record<string, unknown>) => Promise<unknown>;
  transporte: (certPem: string, chavePem: string) => Transporte;
  chaveMestra: () => Promise<CryptoKey>;
  agora?: () => Date;
  /** Endereços da API (só os testes locais trocam, para o simulador). */
  urls?: Record<Ambiente, { sefin: string; adn: string }>;
}

export class ErroUsuario extends Error {
  status: number;
  constructor(msg: string, status = 400) { super(msg); this.status = status; }
}

interface Contexto {
  prestador: { nome: string; tipo: 'pf' | 'pj'; cpf: string | null; cnpj: string | null; ibge: string | null; im: string | null;
    regime: Regime | null; cod_trib_nac: string; aliquota: number | null; descricao: string; serie: string; ambiente: Ambiente; timezone: string };
  nota: { id: string; status: string; emissao: string; amount: number; competence: string; descricao: string | null;
    dps_id: string | null; access_key: string | null; ambiente: Ambiente | null; emissao_estado: string | null };
  tomador: { tipo: 'pf' | 'pj'; documento: string | null; nome: string | null; im?: string | null; email?: string | null; fone?: string | null };
  certificado: { documento: string; valido_ate: string } | null;
}

const MAX_PFX = 50_000;

async function certificadoDa(d: Dependencias) {
  const c = (await d.rpc('nfse_certificado_obter', { p_owner: d.dono })) as { cifrado: string; iv: string } | null;
  if (!c) throw new ErroUsuario('Envie seu certificado A1 em Perfil → Nota fiscal (NFS-e) antes de emitir.');
  const { pfx, senha } = await decifrar(await d.chaveMestra(), c.cifrado, c.iv, d.dono);
  return lerPfx(deB64(pfx), senha);
}

function dadosDaNota(ctx: Contexto, numero: number, agora: Date): DadosDps {
  const p = ctx.prestador;
  return {
    ambiente: p.ambiente, emitidoEm: new Date(agora.getTime() - 60_000), fuso: p.timezone || 'America/Sao_Paulo',
    serie: p.serie, numero, competencia: ctx.nota.competence,
    prestador: { cnpj: p.tipo === 'pj' ? p.cnpj : null, cpf: p.tipo === 'pj' ? null : p.cpf, im: p.im, ibge: p.ibge ?? '', regime: p.regime as Regime, aliquota: p.aliquota },
    tomador: { tipo: ctx.tomador.tipo, documento: ctx.tomador.documento ?? '', nome: ctx.tomador.nome ?? '', im: ctx.tomador.im, email: ctx.tomador.email, fone: ctx.tomador.fone },
    codTribNac: p.cod_trib_nac, descricao: ctx.nota.descricao || p.descricao, valor: Number(ctx.nota.amount),
  };
}

export async function enviarCertificado(d: Dependencias, pfxB64: string, senha: string) {
  if (typeof pfxB64 !== 'string' || pfxB64.length > MAX_PFX * 1.4) throw new ErroUsuario('Arquivo de certificado inválido ou grande demais.');
  if (typeof senha !== 'string' || senha.length > 200) throw new ErroUsuario('Senha inválida.');
  let cert;
  try { cert = lerPfx(deB64(pfxB64), senha); } catch (e) {
    if (e instanceof ErroCertificado) throw new ErroUsuario(e.message);
    throw new ErroUsuario('Não consegui abrir o arquivo. Envie o certificado A1 (.pfx ou .p12).');
  }
  const venc = verificarValidade(cert, d.agora?.() ?? new Date());
  if (venc) throw new ErroUsuario(venc);
  const { cifrado, iv } = await cifrar(await d.chaveMestra(), { pfx: pfxB64, senha }, d.dono);
  await d.rpc('nfse_certificado_salvar', { p_owner: d.dono, p: { cifrado, iv, titular: cert.titular, documento: cert.documento, valido_ate: cert.validoAte.toISOString() } });
  return { titular: cert.titular, documento: cert.documento, valido_ate: cert.validoAte.toISOString() };
}

/** Confere o que falta para emitir, sem enviar nada. */
export async function conferir(d: Dependencias, notaId: string) {
  const ctx = (await d.rpc('nfse_contexto', { p_owner: d.dono, p_invoice: notaId })) as Contexto;
  const faltas: string[] = [];
  try { montarDps(dadosDaNota(ctx, 1, d.agora?.() ?? new Date())); } catch (e) {
    if (e instanceof ErroDados) faltas.push(...e.campos); else throw e;
  }
  const docPrest = ctx.prestador.tipo === 'pj' ? ctx.prestador.cnpj : ctx.prestador.cpf;
  if (!ctx.certificado) faltas.push('certificado A1 (Perfil → Nota fiscal)');
  else {
    if (new Date(ctx.certificado.valido_ate) < (d.agora?.() ?? new Date())) faltas.push('certificado A1 vencido — envie o novo');
    if (docPrest && ctx.certificado.documento !== docPrest) faltas.push(`certificado é de outro ${ctx.certificado.documento.length === 14 ? 'CNPJ' : 'CPF'} (${ctx.certificado.documento}); o Perfil está com ${docPrest}`);
  }
  return { faltas, ctx };
}

export type SituacaoMunicipio = SituacaoConvenio | 'desconhecido';
const MSG_SEM_CONVENIO = 'Seu município ainda não emite pelo sistema nacional. Emita no portal da prefeitura e registre a nota aqui (botão "Registrar como nota emitida na prefeitura").';
/** Município onde o app não emite: só o sistema da prefeitura (ou sem convênio). */
export const emitePeloApp = (s: SituacaoMunicipio) => s === 'emissor_nacional' || s === 'desconhecido';

/**
 * Situação do município da psicóloga no sistema nacional, consultada automaticamente na API oficial e guardada
 * por município (válida 7 dias se emite pelo nacional, 1 dia se não — para perceber logo quando o município aderir).
 * A tabela já nasce com o retrato de todos os municípios em produção (05/11/2026), usado enquanto não há consulta nova.
 * Sem certificado não há como consultar: fica "desconhecido" e não bloqueia nada.
 */
export async function situacaoMunicipio(d: Dependencias, ibge: string | null, ambiente: Ambiente, temCertificado: boolean): Promise<SituacaoMunicipio> {
  if (!ibge || !/^[0-9]{7}$/.test(ibge)) return 'desconhecido';
  const agora = (d.agora?.() ?? new Date()).getTime();
  const cache = (await d.rpc('nfse_municipio_obter', { p_ibge: ibge, p_ambiente: ambiente })) as { situacao: SituacaoConvenio; consultado_em: string } | null;
  if (cache) {
    const idade = agora - new Date(cache.consultado_em).getTime();
    if (idade < (cache.situacao === 'emissor_nacional' ? 7 : 1) * 86_400_000) return cache.situacao;
  }
  if (!temCertificado) return cache?.situacao ?? 'desconhecido';
  try {
    const cert = await certificadoDa(d);
    const r = await clienteSefin(d.transporte(cert.certPem, cert.chavePem), ambiente, (d.urls ?? URLS)[ambiente]).convenio(ibge);
    if (!r.situacao) return cache?.situacao ?? 'desconhecido';
    await d.rpc('nfse_municipio_salvar', { p_ibge: ibge, p_ambiente: ambiente, p_situacao: r.situacao, p_detalhe: r.detalhe });
    return r.situacao;
  } catch {
    return cache?.situacao ?? 'desconhecido'; // rede fora ou certificado com problema: não bloqueia por isso
  }
}

export async function emitir(d: Dependencias, notaId: string) {
  const agora = d.agora?.() ?? new Date();
  const { faltas, ctx } = await conferir(d, notaId);
  if (ctx.nota.status !== 'a_emitir') throw new ErroUsuario('Esta nota não está "a emitir".');
  if (faltas.length) throw new ErroUsuario(`Antes de emitir, complete: ${faltas.join('; ')}.`);
  // Município sem convênio: para antes de reservar número (não gasta numeração nem tenta à toa).
  if (!emitePeloApp(await situacaoMunicipio(d, ctx.prestador.ibge, ctx.prestador.ambiente, true))) throw new ErroUsuario(MSG_SEM_CONVENIO, 422);
  const cert = await certificadoDa(d);
  const chave = await importarChave(cert.chavePkcs8);

  const res = (await d.rpc('nfse_reservar', { p_owner: d.dono, p_invoice: notaId })) as { numero: number; serie: string; ambiente: Ambiente; reenvio: boolean;
    dps_id: string | null; amount: number; competence: string; patient_id: string; descricao: string | null };
  // A DPS sai dos valores da nota TRAVADA (revisão de segurança 06/11). Se o paciente mudou entre a conferência
  // e a trava, os dados do tomador lidos antes podem não valer: pede para tentar de novo.
  if (res.patient_id !== (ctx.nota as unknown as { patient_id: string }).patient_id) {
    await d.rpc('nfse_resultado', { p_owner: d.dono, p_invoice: notaId, p: { ok: false, erro: 'A nota mudou durante o envio. Toque em Emitir de novo.' } });
    throw new ErroUsuario('A nota mudou durante o envio. Toque em Emitir de novo.', 409);
  }
  ctx.nota.amount = Number(res.amount); ctx.nota.competence = res.competence; ctx.nota.descricao = res.descricao;
  const dados = dadosDaNota(ctx, Number(res.numero), agora);
  dados.serie = res.serie; dados.ambiente = res.ambiente;
  const dps = montarDps(dados);
  const urls = (d.urls ?? URLS)[res.ambiente];
  const sefin = clienteSefin(d.transporte(cert.certPem, cert.chavePem), res.ambiente, urls);
  const fotoTomador = { tomador_tipo: ctx.tomador.tipo, tomador_documento: (ctx.tomador.documento ?? '').replace(/\D/g, ''), tomador_nome: dados.tomador.nome };

  try {
    // Recupera a nota que esta mesma DPS já gerou (reenvio após falta de resposta ou falha ao gravar),
    // conferindo valor e tomador para nunca ligar a nota de outro atendimento a este.
    const recuperar = async () => {
      const k = await sefin.chaveDaDps(dps.id);
      if (!k) return null;
      const n = await sefin.obterNfse(k);
      const confere = n.xml.includes(`<vServ>${valorLeiaute(dados.valor)}</vServ>`) && n.xml.includes(`>${fotoTomador.tomador_documento}</`);
      return confere ? n : null;
    };
    let gerada = res.reenvio ? await recuperar() : null;
    if (!gerada) {
      try {
        gerada = await sefin.enviarDps(await assinar(dps, chave, cert.certDer));
      } catch (e) {
        if (!(e instanceof ErroSefin && e.codigos.includes('E0014'))) throw e;
        gerada = await recuperar();
        if (!gerada) throw e;
      }
    }
    await d.rpc('nfse_resultado', { p_owner: d.dono, p_invoice: notaId, p: {
      ok: true, dps_id: dps.id, numero: gerada.numero ?? gerada.chave.slice(-15).replace(/^0+/, ''), chave: gerada.chave,
      emitida_em: gerada.emitidaEm ?? agora.toISOString().slice(0, 10), xml: gerada.xml, descricao: dados.descricao, ...fotoTomador } });
    return { ok: true, chave: gerada.chave, numero: gerada.numero, ambiente: res.ambiente };
  } catch (e) {
    const msg = e instanceof ErroSefin
      ? (e.semResposta ? `${e.message} Toque em Emitir de novo: o app confere se a nota já foi gerada antes de reenviar.`
        : `O sistema nacional recusou: ${e.message}${e.codigos.includes('E0014') ? ' (Esse número de DPS já foi usado neste CNPJ/CPF, talvez em outro sistema. Em Perfil → Nota fiscal, mude a série ou o próximo número.)' : ''}${e.codigos.includes('E0037') ? ' (Seu município ainda não emite pelo sistema nacional. Emita no portal da prefeitura e guarde a nota aqui em Notas fiscais → Registrar nota.)' : ''}`)
      : 'Falha inesperada ao emitir. Tente de novo em instantes.';
    if (!(e instanceof ErroSefin)) console.error('nfse emitir', (e as Error)?.message);
    if (e instanceof ErroSefin && e.codigos.includes('E0037')) {
      await d.rpc('nfse_municipio_salvar', { p_ibge: dados.prestador.ibge, p_ambiente: res.ambiente, p_situacao: 'sem_convenio', p_detalhe: e.message.slice(0, 500) }).catch(() => {});
    }
    await d.rpc('nfse_resultado', { p_owner: d.dono, p_invoice: notaId, p: { ok: false, erro: msg, dps_id: dps.id } });
    throw new ErroUsuario(msg, 422);
  }
}

export async function cancelar(d: Dependencias, notaId: string, codigo: '1' | '2' | '9', motivo: string) {
  const { ctx } = await conferir(d, notaId);
  if (ctx.nota.emissao !== 'nfse_nacional' || ctx.nota.status !== 'emitida' || !ctx.nota.access_key) {
    throw new ErroUsuario('Só nota emitida pelo app pode ser cancelada aqui. Notas registradas à mão se cancelam no portal.');
  }
  const cert = await certificadoDa(d);
  const amb = ctx.nota.ambiente ?? ctx.prestador.ambiente;
  let ped;
  try {
    ped = montarCancelamento({ ambiente: amb, chave: ctx.nota.access_key, emitidoEm: new Date((d.agora?.() ?? new Date()).getTime() - 60_000),
      fuso: ctx.prestador.timezone, cnpj: ctx.prestador.tipo === 'pj' ? ctx.prestador.cnpj : null, cpf: ctx.prestador.tipo === 'pj' ? null : ctx.prestador.cpf, codigo, motivo });
  } catch (e) {
    if (e instanceof ErroDados) throw new ErroUsuario(`Confira: ${e.campos.join('; ')}.`);
    throw e;
  }
  const sefin = clienteSefin(d.transporte(cert.certPem, cert.chavePem), amb, (d.urls ?? URLS)[amb]);
  try {
    await sefin.cancelar(ctx.nota.access_key, await assinar(ped, await importarChave(cert.chavePkcs8), cert.certDer));
  } catch (e) {
    if (e instanceof ErroSefin) throw new ErroUsuario(`O sistema nacional não cancelou: ${e.message}`, 422);
    throw e;
  }
  await d.rpc('nfse_cancelada', { p_owner: d.dono, p_invoice: notaId, p_motivo: motivo.trim() });
  return { ok: true };
}

export async function pdf(d: Dependencias, notaId: string) {
  const { ctx } = await conferir(d, notaId);
  if (ctx.nota.emissao !== 'nfse_nacional' || !/^[0-9]{50}$/.test(ctx.nota.access_key ?? '')) throw new ErroUsuario('PDF disponível só para nota emitida pelo app.');
  const cert = await certificadoDa(d);
  const amb = ctx.nota.ambiente ?? ctx.prestador.ambiente;
  try {
    const bytes = await clienteSefin(d.transporte(cert.certPem, cert.chavePem), amb, (d.urls ?? URLS)[amb]).danfse(ctx.nota.access_key!);
    return { pdf_b64: b64(bytes) };
  } catch (e) {
    if (e instanceof ErroSefin) throw new ErroUsuario(`Não consegui baixar o PDF agora: ${e.message}`, 422);
    throw e;
  }
}

/** Entrada única (POST { acao, ... }), comum ao servidor e ao gateway local. */
export async function atender(d: Dependencias, corpo: Record<string, unknown>): Promise<unknown> {
  const id = String(corpo.nota_id ?? '');
  const idOk = /^[0-9a-f-]{36}$/i.test(id);
  switch (corpo.acao) {
    case 'certificado': return await enviarCertificado(d, String(corpo.pfx_b64 ?? ''), String(corpo.senha ?? ''));
    case 'conferir': if (!idOk) break; {
      const r = await conferir(d, id);
      const certOk = !!r.ctx.certificado && !r.faltas.some((f) => /certificado/.test(f));
      const municipio = await situacaoMunicipio(d, r.ctx.prestador.ibge, r.ctx.prestador.ambiente, certOk);
      return { faltas: r.faltas, ambiente: r.ctx.prestador.ambiente, tomador: r.ctx.tomador, municipio,
        servico: { codigo: r.ctx.prestador.cod_trib_nac, descricao: r.ctx.nota.descricao || r.ctx.prestador.descricao } };
    }
    case 'emitir': if (!idOk) break; return await emitir(d, id);
    case 'cancelar': if (!idOk) break; return await cancelar(d, id, String(corpo.codigo ?? '9') as '1' | '2' | '9', String(corpo.motivo ?? ''));
    case 'pdf': if (!idOk) break; return await pdf(d, id);
  }
  throw new ErroUsuario('Pedido inválido.');
}

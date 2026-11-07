// Testes do núcleo da NFS-e Nacional com dados FICTÍCIOS: montagem da DPS, esquema oficial 1.01,
// assinatura conferida por biblioteca independente, certificado A1 e cancelamento.
// Rodar: cd supabase/functions && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { montarDps, montarCancelamento, idDps, dataHoraLeiaute, textoLeiaute, ErroDados, type DadosDps } from './dps.ts';
import { assinar, importarChave, gzipB64, deGzipB64 } from './assinatura.ts';
import { lerPfx, verificarValidade, ErroCertificado } from './certificado.ts';
import { clienteSefin } from './sefin.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gerarCertificadoFicticio, validarXsd, CNPJ_FICTICIO, SENHA_FICTICIA } from './teste-util.ts';

const fx = gerarCertificadoFicticio();

const base = (): DadosDps => ({
  ambiente: 'homologacao', emitidoEm: new Date('2026-11-06T13:10:00Z'), fuso: 'America/Sao_Paulo',
  serie: '1', numero: 27, competencia: '2026-11-01',
  prestador: { cnpj: CNPJ_FICTICIO, im: '12345', ibge: '4211900', regime: 'me_epp', aliquota: 2 },
  tomador: { tipo: 'pf', documento: '52998224725', nome: 'Paciente Fictícia & Cia', email: 'paciente@exemplo.invalid', fone: '48999990000' },
  codTribNac: '041601', descricao: 'Atendimento psicológico — sessões de novembro', valor: 250,
});

function verificar(xml: string, certPem: string) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const sig = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  const v = new SignedXml({ publicCert: certPem, getCertFromKeyInfo: () => null });
  v.loadSignature(sig);
  const ok = v.checkSignature(xml);
  return { ok, erros: (v as unknown as { validationErrors?: string[] }).validationErrors };
}

test('Id da DPS tem 45 posições e segue a regra oficial', () => {
  const id = idDps('4211900', { cnpj: CNPJ_FICTICIO, ibge: '4211900', regime: 'mei' }, '1', 27);
  assert.equal(id, `DPS4211900211222333000181000010000000000000${'27'}`);
  assert.equal(id.length, 45);
  const pf = idDps('4211900', { cpf: '52998224725', ibge: '4211900', regime: 'mei' }, '900', 1);
  assert.equal(pf.slice(10, 11), '1');
  assert.equal(pf.slice(11, 25), '00052998224725');
});

test('data/hora no formato do leiaute, no fuso da profissional', () => {
  assert.equal(dataHoraLeiaute(new Date('2026-11-06T13:10:05Z'), 'America/Sao_Paulo'), '2026-11-06T10:10:05-03:00');
  assert.equal(dataHoraLeiaute(new Date('2026-11-06T13:10:05Z'), 'America/Manaus'), '2026-11-06T09:10:05-04:00');
});

test('texto vira Latin-1 sem quebras nem espaços nas pontas', () => {
  assert.equal(textoLeiaute('  Sessão “online”\n– 🙂 ok ', 100), 'Sessão "online" - ok');
});

test('DPS PF (ME/EPP) passa no esquema oficial 1.01 depois de assinada', async () => {
  const cert = lerPfx(fx.pfx, SENHA_FICTICIA);
  const xml = await assinar(montarDps(base()), await importarChave(cert.chavePkcs8), cert.certDer);
  assert.equal(validarXsd(xml, 'DPS_v1.01.xsd'), '');
  assert.match(xml, /<regApTribSN>1<\/regApTribSN>/);
  assert.match(xml, /<pAliq>2.00<\/pAliq>/);
  assert.match(xml, /Paciente Fictícia &amp; Cia/);
});

test('assinatura confere numa biblioteca independente (xml-crypto) e quebra se o XML for alterado', async () => {
  const cert = lerPfx(fx.pfx, SENHA_FICTICIA);
  const xml = await assinar(montarDps(base()), await importarChave(cert.chavePkcs8), cert.certDer);
  const r = verificar(xml, fx.certPem);
  assert.equal(r.ok, true, String(r.erros));
  const adulterado = xml.replace('<vServ>250.00</vServ>', '<vServ>25.00</vServ>');
  assert.throws(() => { if (!verificar(adulterado, fx.certPem).ok) throw new Error('inválida'); });
});

test('MEI e não optante; tomador empresa (CNPJ); sem alíquota', async () => {
  const cert = lerPfx(fx.pfx, SENHA_FICTICIA);
  const chave = await importarChave(cert.chavePkcs8);
  for (const regime of ['mei', 'nao_optante'] as const) {
    const d = base();
    d.prestador.regime = regime;
    d.tomador = { tipo: 'pj', documento: '11444777000161', nome: 'Empresa Fictícia Ltda', im: '999' };
    const xml = await assinar(montarDps(d), chave, cert.certDer);
    assert.equal(validarXsd(xml, 'DPS_v1.01.xsd'), '', regime);
    assert.doesNotMatch(xml, /pAliq|regApTribSN/);
    assert.ok(xml.includes(`<opSimpNac>${regime === "mei" ? 2 : 1}</opSimpNac>`));
    assert.match(xml, /<toma><CNPJ>11444777000161<\/CNPJ><IM>999<\/IM>/);
    assert.equal(verificar(xml, fx.certPem).ok, true);
  }
});

test('produção usa tpAmb 1; homologação usa 2', () => {
  assert.match(montarDps(base()).xml, /<tpAmb>2<\/tpAmb>/);
  assert.match(montarDps({ ...base(), ambiente: 'producao' }).xml, /<tpAmb>1<\/tpAmb>/);
});

test('dados faltando viram lista clara para a psicóloga', () => {
  const d = base();
  d.prestador.ibge = '';
  d.tomador.documento = '12345678900';
  d.descricao = '   ';
  try { montarDps(d); assert.fail('deveria recusar'); } catch (e) {
    assert.ok(e instanceof ErroDados);
    assert.equal(e.campos.length, 3);
    assert.match(e.message, /IBGE/); assert.match(e.message, /CPF de quem recebe/); assert.match(e.message, /descrição/);
  }
});

test('certificado A1: lê titular, CNPJ e validade (PFX novo AES e legado 3DES)', () => {
  for (const pfx of [fx.pfx, fx.pfxLegado]) {
    const c = lerPfx(pfx, SENHA_FICTICIA);
    assert.equal(c.documento, CNPJ_FICTICIO);
    assert.equal(c.titular, 'PSICOLOGA FICTICIA LTDA');
    assert.equal(verificarValidade(c), null);
    assert.match(c.certPem, /BEGIN CERTIFICATE/); assert.match(c.chavePem, /BEGIN PRIVATE KEY/);
  }
});

test('certificado: senha errada e arquivo inválido dão mensagem clara', () => {
  assert.throws(() => lerPfx(fx.pfx, 'errada'), (e: unknown) => e instanceof ErroCertificado && /Senha/.test((e as Error).message));
  assert.throws(() => lerPfx(new Uint8Array([1, 2, 3]), 'x'), ErroCertificado);
});

test('certificado com iterações absurdas (arquivo feito para travar o servidor) é recusado antes de abrir', () => {
  const d = fx.dir;
  execFileSync('openssl', ['pkcs12', '-export', '-iter', '5000000', '-maciter', '-inkey', `${d}/chave.pem`, '-in', `${d}/cert.pem`, '-out', `${d}/pesado.pfx`, '-passout', `pass:${SENHA_FICTICIA}`], { stdio: 'ignore' });
  const t0 = Date.now();
  assert.throws(() => lerPfx(new Uint8Array(readFileSync(`${d}/pesado.pfx`)), SENHA_FICTICIA), (e: unknown) => e instanceof ErroCertificado && /fora do padrão/.test((e as Error).message));
  assert.ok(Date.now() - t0 < 2000, 'recusa sem gastar CPU');
});

test('cliente da Sefin não monta endereço com chave fora do padrão', async () => {
  const sefin = clienteSefin(async () => { throw new Error('não deveria chamar'); }, 'homologacao');
  await assert.rejects(sefin.danfse('../../outra-rota'), /inválida/);
  await assert.rejects(sefin.chaveDaDps('DPS123'), /inválida/);
});

test('certificado vencido é recusado', () => {
  const msg = verificarValidade({ validoDe: new Date('2020-01-01'), validoAte: new Date('2021-01-01') }, new Date('2026-11-06'));
  assert.match(msg ?? '', /venceu/);
});

test('pedido de cancelamento (e101101) passa no esquema e a assinatura confere', async () => {
  const cert = lerPfx(fx.pfx, SENHA_FICTICIA);
  const chave = '4'.repeat(50);
  const ped = montarCancelamento({ ambiente: 'homologacao', chave, emitidoEm: new Date(), fuso: 'America/Sao_Paulo', cnpj: CNPJ_FICTICIO, codigo: '1', motivo: 'Erro no valor da sessão informada' });
  assert.equal(ped.id, `PRE${chave}101101`);
  const xml = await assinar(ped, await importarChave(cert.chavePkcs8), cert.certDer);
  assert.equal(validarXsd(xml, 'pedRegEvento_v1.01.xsd'), '');
  assert.equal(verificar(xml, fx.certPem).ok, true);
  assert.throws(() => montarCancelamento({ ambiente: 'homologacao', chave, emitidoEm: new Date(), fuso: 'America/Sao_Paulo', cnpj: CNPJ_FICTICIO, codigo: '1', motivo: 'curto' }), ErroDados);
});

test('GZip+Base64 ida e volta', async () => {
  const t = '<DPS>ção</DPS>'.repeat(50);
  assert.equal(await deGzipB64(await gzipB64(t)), t);
});

// Teste no DENO (mesmo runtime da função do servidor): leitura do A1, assinatura e envio por mTLS
// com Deno.createHttpClient até o simulador local da Sefin, que confere esquema e assinatura.
// Pré-requisito: gateway local rodando (sobe o simulador em https://localhost:54400).
// Rodar: deno test -A --config supabase/functions/nfse/deno.json supabase/functions/_shared/nfse/transporte.deno-test.ts
import { assinar, importarChave } from './assinatura.ts';
import { lerPfx } from './certificado.ts';
import { montarDps } from './dps.ts';
import { clienteSefin, ErroSefin } from './sefin.ts';
import { transporteMtls } from './transporte-deno.ts';

const ca = Deno.readTextFileSync(new URL('../../../../dev-gateway/.simulador-cert.pem', import.meta.url));
const urls = { sefin: 'https://localhost:54400/SefinNacional', adn: 'https://localhost:54400' };

async function pfxFicticio(cnpj: string) {
  const d = Deno.makeTempDirSync();
  const run = (args: string[]) => new Deno.Command('openssl', { args, stdout: 'null', stderr: 'null' }).outputSync();
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${d}/k.pem`, '-out', `${d}/c.pem`, '-days', '30', '-subj', `/CN=DENO FICTICIA:${cnpj}`]);
  run(['pkcs12', '-export', '-inkey', `${d}/k.pem`, '-in', `${d}/c.pem`, '-out', `${d}/a.pfx`, '-passout', 'pass:x']);
  return Deno.readFileSync(`${d}/a.pfx`);
}

Deno.test('Deno.createHttpClient com certificado de cliente: emite, consulta e baixa PDF no simulador', async () => {
  if (typeof (Deno as unknown as { createHttpClient?: unknown }).createHttpClient !== 'function') throw new Error('createHttpClient indisponível');
  const cnpj = '11444777000161';
  const cert = lerPfx(await pfxFicticio(cnpj), 'x');
  const dps = montarDps({
    ambiente: 'homologacao', emitidoEm: new Date(), fuso: 'America/Sao_Paulo', serie: '7', numero: Date.now() % 1e9, competencia: '2026-11-01',
    prestador: { cnpj, ibge: '4211900', regime: 'mei' }, tomador: { tipo: 'pf', documento: '52998224725', nome: 'Paciente Fictícia' },
    codTribNac: '041601', descricao: 'Atendimento psicológico', valor: 180,
  });
  const sefin = clienteSefin(transporteMtls(cert.certPem, cert.chavePem, [ca]), 'homologacao', urls);
  const nota = await sefin.enviarDps(await assinar(dps, await importarChave(cert.chavePkcs8), cert.certDer));
  if (!/^\d{50}$/.test(nota.chave) || !nota.numero) throw new Error(`resposta inesperada ${JSON.stringify(nota).slice(0, 200)}`);
  if ((await sefin.chaveDaDps(dps.id)) !== nota.chave) throw new Error('consulta por DPS não achou a nota');
  const pdf = await sefin.danfse(nota.chave);
  if (new TextDecoder().decode(pdf.slice(0, 5)) !== '%PDF-') throw new Error('PDF inválido');
});

Deno.test('Deno: certificado de cliente diferente do que assinou é recusado pela "Sefin"', async () => {
  const a = lerPfx(await pfxFicticio('11444777000161'), 'x');
  const b = lerPfx(await pfxFicticio('11444777000161'), 'x');
  const dps = montarDps({
    ambiente: 'homologacao', emitidoEm: new Date(), fuso: 'America/Sao_Paulo', serie: '8', numero: Date.now() % 1e9, competencia: '2026-11-01',
    prestador: { cnpj: '11444777000161', ibge: '4211900', regime: 'mei' }, tomador: { tipo: 'pf', documento: '52998224725', nome: 'Paciente Fictícia' },
    codTribNac: '041601', descricao: 'Atendimento psicológico', valor: 180,
  });
  const sefin = clienteSefin(transporteMtls(b.certPem, b.chavePem, [ca]), 'homologacao', urls);
  try {
    await sefin.enviarDps(await assinar(dps, await importarChave(a.chavePkcs8), a.certDer));
    throw new Error('deveria recusar');
  } catch (e) {
    if (!(e instanceof ErroSefin) || !e.codigos.includes('E0714')) throw e;
  }
});

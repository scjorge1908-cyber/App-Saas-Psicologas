// Simulador LOCAL da API da NFS-e Nacional (Sefin + ADN) — somente desenvolvimento e testes.
// Comporta-se como a API real nos pontos que importam para o app:
//  - exige certificado de cliente (mTLS) e confere se a DPS foi assinada com ESSE certificado;
//  - valida a DPS no esquema oficial 1.01 (xmllint) e a assinatura (xml-crypto);
//  - recusa DPS repetida (mesmo Id), responde consulta por DPS/chave, cancelamento e PDF.
// Nenhum dado sai da máquina; nenhuma nota fiscal real é gerada.
import https from 'node:https';
import zlib from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { gerarCertificadoServidor, validarXsd } from '../supabase/functions/_shared/nfse/teste-util.ts';

const servidor = gerarCertificadoServidor();
// AC do simulador gravada para testes que conferem a cadeia (ex.: transporte do Deno).
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./.simulador-cert.pem', import.meta.url), servidor.caPem);
const dps = new Map(); // id da DPS -> chave
const notas = new Map(); // chave -> { xml, cancelada, cnpj }
let seq = 0;

const gunzip = (b64) => zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
const gzip = (s) => zlib.gzipSync(Buffer.from(s, 'utf8')).toString('base64');
const erro = (res, status, codigo, descricao) => envia(res, status, { erros: [{ Codigo: codigo, Descricao: descricao }] });
function envia(res, status, corpo, tipo = 'application/json') {
  const b = tipo === 'application/json' ? JSON.stringify(corpo) : corpo;
  res.writeHead(status, { 'content-type': tipo }); res.end(b);
}
const tag = (xml, t) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1] ?? null;

function conferirAssinatura(xml, certPem) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const sig = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  if (!sig) return 'sem assinatura';
  const v = new SignedXml({ publicCert: certPem, getCertFromKeyInfo: () => null });
  v.loadSignature(sig);
  try { return v.checkSignature(xml) ? '' : 'assinatura inválida'; } catch (e) { return `assinatura inválida: ${e.message}`; }
}

const pemDoCliente = (req) => {
  const c = req.socket.getPeerCertificate();
  if (!c?.raw) return null;
  return `-----BEGIN CERTIFICATE-----\n${c.raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
};

async function corpo(req) { const p = []; for await (const c of req) p.push(c); return Buffer.concat(p).toString('utf8'); }

export function iniciarSimulador(porta = 54400) {
  const srv = https.createServer({ key: servidor.chavePem, cert: servidor.certPem, requestCert: true, rejectUnauthorized: false }, async (req, res) => {
    const certCliente = pemDoCliente(req);
    if (!certCliente) return envia(res, 403, { erro: 'certificado de cliente obrigatório' });
    const u = new URL(req.url, 'https://localhost');
    const p = u.pathname.replace(/^\/SefinNacional/, '');
    try {
      if (req.method === 'POST' && p === '/nfse') {
        const xml = gunzip(JSON.parse(await corpo(req)).dpsXmlGZipB64);
        const xsd = validarXsd(xml, 'DPS_v1.01.xsd');
        if (xsd) return erro(res, 400, 'E1235', `Falha no esquema XML: ${xsd.split('\n')[0]}`);
        const sigErr = conferirAssinatura(xml, certCliente);
        if (sigErr) return erro(res, 400, 'E0714', `Arquivo enviado com erro na assinatura (${sigErr}).`);
        const id = xml.match(/<infDPS Id="(DPS\d{42})"/)[1];
        if (dps.has(id)) return erro(res, 400, 'E0014', 'DPS já existe (Id repetido).');
        const valor = tag(xml, 'vServ');
        if (valor === '666.00') return erro(res, 400, 'E0310', 'Regra de teste do simulador: valor recusado.');
        const cMun = tag(xml, 'cLocEmi'); const cnpj = tag(xml, 'CNPJ') ?? tag(xml, 'CPF').padStart(14, '0');
        seq += 1;
        const n = String(seq);
        const chave = `${cMun}2${cnpj.length === 14 ? 2 : 1}${cnpj.padStart(14, '0')}${n.padStart(13, '0')}2611${'1'.repeat(9)}${seq % 10}`.slice(0, 50);
        const hoje = new Date().toISOString().slice(0, 19) + '-03:00';
        const nfse = `<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${chave}"><xLocEmi>SIMULADOR</xLocEmi><nNFSe>${n}</nNFSe><dhProc>${hoje}</dhProc><valores><vLiq>${valor}</vLiq></valores>${xml.replace(/^<\?xml[^>]*\?>/, '')}</infNFSe></NFSe>`;
        dps.set(id, chave); notas.set(chave, { xml: nfse, cancelada: false });
        // Regra de teste: valor 777,00 gera a nota mas "perde" a resposta (como queda de conexão/gateway).
        if (valor === '777.00') return envia(res, 504, '<html>Gateway Timeout</html>', 'text/html');
        return envia(res, 201, { tipoAmbiente: 2, idDps: id, chaveAcesso: chave, nfseXmlGZipB64: gzip(nfse), dataHoraProcessamento: hoje });
      }
      let m;
      if (req.method === 'GET' && (m = p.match(/^\/dps\/(DPS\d{42})$/))) {
        return dps.has(m[1]) ? envia(res, 200, { chaveAcesso: dps.get(m[1]) }) : envia(res, 404, { erro: 'não encontrada' });
      }
      if (req.method === 'GET' && (m = p.match(/^\/nfse\/(\d{50})$/))) {
        const n = notas.get(m[1]);
        return n ? envia(res, 200, { chaveAcesso: m[1], nfseXmlGZipB64: gzip(n.xml) }) : erro(res, 404, 'E2001', 'NFS-e não encontrada.');
      }
      if (req.method === 'POST' && (m = p.match(/^\/nfse\/(\d{50})\/eventos$/))) {
        const n = notas.get(m[1]);
        if (!n) return erro(res, 404, 'E2001', 'NFS-e não encontrada.');
        if (n.cancelada) return erro(res, 400, 'E0840', 'NFS-e já cancelada.');
        const xml = gunzip(JSON.parse(await corpo(req)).pedidoRegistroEventoXmlGZipB64);
        const xsd = validarXsd(xml, 'pedRegEvento_v1.01.xsd');
        if (xsd) return erro(res, 400, 'E1235', `Falha no esquema XML: ${xsd.split('\n')[0]}`);
        const sigErr = conferirAssinatura(xml, certCliente);
        if (sigErr) return erro(res, 400, 'E0714', sigErr);
        n.cancelada = true;
        return envia(res, 201, { tipoAmbiente: 2, eventoXmlGZipB64: gzip('<evento/>') });
      }
      if (req.method === 'GET' && (m = u.pathname.match(/^\/danfse\/(\d{50})$/))) {
        if (!notas.has(m[1])) return erro(res, 404, 'E2001', 'NFS-e não encontrada.');
        const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF SIMULADOR DANFSe ${m[1]}`;
        return envia(res, 200, Buffer.from(pdf), 'application/pdf');
      }
      return envia(res, 404, { erro: 'rota não simulada' });
    } catch (e) {
      return erro(res, 500, 'E9999', `Simulador: ${e.message}`);
    }
  });
  return new Promise((ok) => srv.listen(porta, '127.0.0.1', () => ok(srv)));
}

export const URL_SIMULADOR = (porta = 54400) => ({ sefin: `https://127.0.0.1:${porta}/SefinNacional`, adn: `https://127.0.0.1:${porta}` });

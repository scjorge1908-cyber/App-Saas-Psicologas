// Assinatura XMLDSIG (envelopada, RSA-SHA256, C14N 1.0) da DPS e do pedido de evento, como pede o
// leiaute da NFS-e Nacional. Usa só WebCrypto (Deno e Node têm). O conteúdo assinado já vem canônico
// de dps.ts; os testes conferem a assinatura com uma biblioteca independente (xml-crypto).
import type { DpsMontada } from './dps.ts';

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

export const b64 = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function importarChave(pkcs8: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey('pkcs8', pkcs8 as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export async function assinar(doc: DpsMontada, chave: CryptoKey, certDer: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const digest = b64(await crypto.subtle.digest('SHA-256', enc.encode(doc.canonico)));
  const signedInfoCorpo =
    `<CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod>` +
    `<Reference URI="#${doc.id}"><Transforms>` +
    `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>` +
    `<Transform Algorithm="${C14N}"></Transform></Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod>` +
    `<DigestValue>${digest}</DigestValue></Reference>`;
  // Forma canônica do SignedInfo: herda só o xmlns do Signature (o default do DPS é sobrescrito).
  const signedInfoCanonico = `<SignedInfo xmlns="${DSIG}">${signedInfoCorpo}</SignedInfo>`;
  const valor = b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, enc.encode(signedInfoCanonico)));
  const assinatura = `<Signature xmlns="${DSIG}"><SignedInfo>${signedInfoCorpo}</SignedInfo>` +
    `<SignatureValue>${valor}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${b64(certDer)}</X509Certificate></X509Data></KeyInfo></Signature>`;
  const fim = doc.xml.lastIndexOf('</');
  return `<?xml version="1.0" encoding="UTF-8"?>${doc.xml.slice(0, fim)}${assinatura}${doc.xml.slice(fim)}`;
}

/** GZip + Base64, formato dos campos *XmlGZipB64 da API. */
export async function gzipB64(texto: string): Promise<string> {
  const s = new Blob([new TextEncoder().encode(texto)]).stream().pipeThrough(new CompressionStream('gzip'));
  return b64(new Uint8Array(await new Response(s).arrayBuffer()));
}

export async function deGzipB64(b: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await new Response(s).arrayBuffer());
}

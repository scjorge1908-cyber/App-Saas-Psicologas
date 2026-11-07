// Leitura do certificado A1 (.pfx/.p12 + senha) da psicóloga. Usa node-forge (JavaScript puro),
// que roda no Deno (npm:node-forge, via deno.json) e no Node (testes).
// @ts-types="npm:@types/node-forge@1.3.11"
import forge from 'node-forge';

export interface CertificadoLido {
  titular: string;
  /** CNPJ (14) ou CPF (11) do titular, lido do certificado ICP-Brasil. */
  documento: string;
  validoDe: Date;
  validoAte: Date;
  /** Chave privada em PKCS#8 (DER), para assinar com WebCrypto. */
  chavePkcs8: Uint8Array;
  /** Certificado do titular em DER (vai no KeyInfo da assinatura). */
  certDer: Uint8Array;
  /** PEMs para a conexão TLS com certificado de cliente (mTLS) exigida pela Sefin. */
  certPem: string;
  chavePem: string;
}

export class ErroCertificado extends Error {}

const paraBytes = (bin: string) => Uint8Array.from(bin, (c) => c.charCodeAt(0));
const deBytes = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return s; };

// OIDs ICP-Brasil (DOC-ICP-04): 2.16.76.1.3.3 = CNPJ da empresa; 2.16.76.1.3.1 = dados do titular PF (nascimento + CPF).
function documentoDoCertificado(cert: forge.pki.Certificate): string | null {
  const cn = String(cert.subject.getField('CN')?.value ?? '');
  const m = cn.match(/:(\d{14}|\d{11})\s*$/);
  if (m) return m[1];
  const ext = cert.getExtension('subjectAltName') as { value?: string } | undefined;
  const raw = ext?.value ?? '';
  // Procura o valor logo após o OID no DER bruto da extensão (otherName).
  const oidCnpj = forge.asn1.oidToDer('2.16.76.1.3.3').getBytes();
  const oidPf = forge.asn1.oidToDer('2.16.76.1.3.1').getBytes();
  const depois = (oid: string) => { const i = raw.indexOf(oid); return i < 0 ? '' : raw.slice(i + oid.length, i + oid.length + 80); };
  const cnpj = depois(oidCnpj).match(/\d{14}/);
  if (cnpj) return cnpj[0];
  const pf = depois(oidPf).match(/\d{8}(\d{11})/);
  if (pf) return pf[1];
  return null;
}

export function lerPfx(pfx: Uint8Array, senha: string): CertificadoLido {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(deBytes(pfx));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/mac|password|invalid/i.test(msg)) throw new ErroCertificado('Senha do certificado incorreta ou arquivo danificado.');
    if (/unsupported|oid/i.test(msg)) throw new ErroCertificado('Formato de certificado não suportado. Exporte o .pfx novamente (com chave privada).');
    throw new ErroCertificado('Não consegui abrir o arquivo. Envie o certificado A1 (.pfx ou .p12).');
  }
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ].filter((b) => b.key);
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).filter((b) => b.cert);
  if (!chaves.length) throw new ErroCertificado('O arquivo não tem a chave privada. Exporte o certificado A1 com a chave.');
  const chave = chaves[0].key as forge.pki.rsa.PrivateKey;
  if (!chave.n) throw new ErroCertificado('Só certificados com chave RSA são aceitos.');
  const cert = certs.map((b) => b.cert!).find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(chave.n));
  if (!cert) throw new ErroCertificado('O certificado do titular não foi encontrado no arquivo.');

  const documento = documentoDoCertificado(cert);
  if (!documento) throw new ErroCertificado('Não encontrei o CNPJ/CPF no certificado. Use um certificado ICP-Brasil (e-CNPJ ou e-CPF).');
  const titular = String(cert.subject.getField('CN')?.value ?? '').replace(/:\d+\s*$/, '').trim() || 'Titular';

  const pkcs8 = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(chave));
  return {
    titular,
    documento,
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
    chavePkcs8: paraBytes(forge.asn1.toDer(pkcs8).getBytes()),
    certDer: paraBytes(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()),
    certPem: forge.pki.certificateToPem(cert),
    chavePem: forge.pki.privateKeyInfoToPem(pkcs8),
  };
}

export function verificarValidade(c: Pick<CertificadoLido, 'validoDe' | 'validoAte'>, agora = new Date()): string | null {
  if (agora < c.validoDe) return 'O certificado ainda não começou a valer.';
  if (agora > c.validoAte) return `O certificado venceu em ${c.validoAte.toLocaleDateString('pt-BR')}. Renove e envie o novo.`;
  return null;
}

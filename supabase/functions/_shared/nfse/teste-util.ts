// Apoio aos testes locais (Node): certificado A1 FICTÍCIO autoassinado gerado na hora com openssl.
// Nada aqui vai para a função do servidor.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CNPJ_FICTICIO = '11222333000181';
export const SENHA_FICTICIA = 'senha-de-teste';

export interface Fixture { dir: string; pfx: Uint8Array; certPem: string; chavePem: string; pfxLegado: Uint8Array }

export function gerarCertificadoFicticio(cn = `PSICOLOGA FICTICIA LTDA:${CNPJ_FICTICIO}`, dias = 365): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'nfse-cert-'));
  const k = join(dir, 'chave.pem'); const c = join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', k, '-out', c, '-days', String(dias),
    '-subj', `/C=BR/O=ICP-Brasil FICTICIO/CN=${cn}`], { stdio: 'ignore' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', k, '-in', c, '-out', join(dir, 'a1.pfx'), '-passout', `pass:${SENHA_FICTICIA}`], { stdio: 'ignore' });
  execFileSync('openssl', ['pkcs12', '-export', '-legacy', '-inkey', k, '-in', c, '-out', join(dir, 'a1-legado.pfx'), '-passout', `pass:${SENHA_FICTICIA}`], { stdio: 'ignore' });
  return {
    dir,
    pfx: new Uint8Array(readFileSync(join(dir, 'a1.pfx'))),
    pfxLegado: new Uint8Array(readFileSync(join(dir, 'a1-legado.pfx'))),
    certPem: readFileSync(c, 'utf8'),
    chavePem: readFileSync(k, 'utf8'),
  };
}

/** Certificado de servidor do simulador: uma AC local fictícia + certificado "localhost" (não-AC) emitido por ela. */
export function gerarCertificadoServidor(): { caPem: string; certPem: string; chavePem: string } {
  const dir = mkdtempSync(join(tmpdir(), 'nfse-srv-'));
  const f = (n: string) => join(dir, n);
  const o = (args: string[]) => execFileSync('openssl', args, { stdio: 'ignore' });
  o(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('ca.key'), '-out', f('ca.pem'), '-days', '30', '-subj', '/CN=AC FICTICIA SIMULADOR']);
  o(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('srv.key'), '-out', f('srv.csr'), '-subj', '/CN=localhost']);
  writeFileSync(f('ext.cnf'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
  o(['x509', '-req', '-in', f('srv.csr'), '-CA', f('ca.pem'), '-CAkey', f('ca.key'), '-CAcreateserial', '-out', f('srv.pem'), '-days', '30', '-extfile', f('ext.cnf')]);
  return { caPem: readFileSync(f('ca.pem'), 'utf8'), certPem: readFileSync(f('srv.pem'), 'utf8'), chavePem: readFileSync(f('srv.key'), 'utf8') };
}

/** Valida um XML contra o esquema oficial com xmllint. Devolve '' se válido, senão a mensagem. */
export function validarXsd(xml: string, esquema: 'DPS_v1.01.xsd' | 'pedRegEvento_v1.01.xsd' | 'NFSe_v1.01.xsd'): string {
  const dir = mkdtempSync(join(tmpdir(), 'nfse-xsd-'));
  const arq = join(dir, 'doc.xml');
  execFileSync('bash', ['-c', `cat > ${JSON.stringify(arq)}`], { input: xml });
  // O esquema oficial de série usa "^...$" (âncoras não existem em XSD e o libxml as lê como letras).
  // Validamos numa cópia com só essa correção; os arquivos oficiais do repositório ficam intactos.
  const orig = new URL('./xsd/1.01/', import.meta.url).pathname;
  const copia = join(dir, 'xsd');
  execFileSync('cp', ['-r', orig, copia]);
  const ts = join(copia, 'tiposSimples_v1.01.xsd');
  writeFileSync(ts, readFileSync(ts, 'utf8').replace('value="^0{0,4}\\d{1,5}$"', 'value="0{0,4}\\d{1,5}"'));
  const xsd = join(copia, esquema);
  try {
    execFileSync('xmllint', ['--noout', '--schema', xsd, arq], { stdio: 'pipe' });
    return '';
  } catch (e) {
    return String((e as { stderr?: Buffer }).stderr ?? e);
  }
}

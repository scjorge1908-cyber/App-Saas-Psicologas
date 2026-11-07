// Cofre do certificado: AES-256-GCM com chave mestra que fica só no servidor (segredo NFSE_CHAVE_CERTIFICADOS,
// 32 bytes em Base64). O banco guarda apenas o texto cifrado; nem o app nem quem lê o banco abre o certificado.
import { b64 } from './assinatura.ts';

const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function chaveMestra(base64: string | undefined | null): Promise<CryptoKey> {
  const bruto = base64 ? deB64(base64.trim()) : new Uint8Array();
  if (bruto.length !== 32) throw new Error('Segredo NFSE_CHAVE_CERTIFICADOS ausente ou inválido (precisa de 32 bytes em Base64).');
  return await crypto.subtle.importKey('raw', bruto as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function cifrar(chave: CryptoKey, dados: { pfx: string; senha: string }, dono: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // O id da dona entra como dado autenticado: um texto cifrado copiado para outra conta não abre.
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(dono) }, chave,
    new TextEncoder().encode(JSON.stringify(dados)));
  return { cifrado: b64(c), iv: b64(iv) };
}

export async function decifrar(chave: CryptoKey, cifrado: string, iv: string, dono: string): Promise<{ pfx: string; senha: string }> {
  const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(iv) as BufferSource, additionalData: new TextEncoder().encode(dono) }, chave, deB64(cifrado) as BufferSource);
  return JSON.parse(new TextDecoder().decode(p));
}

export { deB64 };

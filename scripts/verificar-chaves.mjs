// Garante que nenhuma chave privilegiada do Supabase entrou no build do app (web/dist).
// Falha se encontrar:
//  - chave secreta nova (sb_secret_ seguida do valor);
//  - JWT cujo payload tenha role "service_role" (chave antiga de serviço).
// A palavra "sb_secret_" sozinha aparece no código da biblioteca supabase-js e não é chave.
// Uso: node scripts/verificar-chaves.mjs web/dist
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const raiz = process.argv[2] ?? 'web/dist';
const SECRETA = /sb_secret_[A-Za-z0-9_-]{20,}/;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;

function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
  });
}

const problemas = [];
for (const arquivo of arquivos(raiz)) {
  if (!/\.(js|mjs|html|json|txt|webmanifest)$/.test(arquivo)) continue;
  const texto = readFileSync(arquivo, 'utf8');
  if (SECRETA.test(texto)) problemas.push(`${arquivo}: chave secreta sb_secret_`);
  for (const [, payload] of texto.matchAll(JWT)) {
    try {
      const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (dados.role === 'service_role') problemas.push(`${arquivo}: JWT com role service_role`);
    } catch {
      // não é um JWT de verdade
    }
  }
}

if (problemas.length) {
  console.error('Chave privilegiada encontrada no build:\n' + problemas.join('\n'));
  process.exit(1);
}
console.log(`Nenhuma chave privilegiada em ${raiz}.`);

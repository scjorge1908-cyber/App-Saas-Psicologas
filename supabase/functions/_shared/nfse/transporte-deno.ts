// Transporte HTTPS com certificado de cliente (mTLS) para a função do servidor (Deno / Supabase Edge).
// Preferência: Deno.createHttpClient({ cert, key }); se o runtime não oferecer, usa node:https.
// caCerts só é usado nos testes locais (simulador com certificado próprio).
import type { RespostaHttp, Transporte } from './sefin.ts';

/** HTTPS com certificado de cliente (mTLS). Deno.createHttpClient quando existe; senão, node:https. */
export function transporteMtls(certPem: string, chavePem: string, caCerts?: string[]): Transporte {
  const criar = (Deno as unknown as { createHttpClient?: (o: { cert: string; key: string; caCerts?: string[] }) => { close(): void } }).createHttpClient;
  if (criar) {
    return async (url, init) => {
      const client = criar({ cert: certPem, key: chavePem, ...(caCerts ? { caCerts } : {}) });
      try {
        const r = await fetch(url, {
          method: init.method, signal: AbortSignal.timeout(45_000),
          headers: init.json ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json, application/pdf' },
          body: init.json ? JSON.stringify(init.json) : undefined,
          // deno-lint-ignore no-explicit-any
          client: client as any,
        } as RequestInit);
        return { status: r.status, corpo: new Uint8Array(await r.arrayBuffer()), tipo: r.headers.get('content-type') ?? '' };
      } finally { client.close(); }
    };
  }
  return async (url, init) => {
    const https = await import('node:https');
    return await new Promise<RespostaHttp>((resolve, reject) => {
      const corpo = init.json ? JSON.stringify(init.json) : undefined;
      const req = https.request(url, {
        method: init.method, cert: certPem, key: chavePem, timeout: 45_000, ...(caCerts ? { ca: caCerts } : {}),
        headers: corpo ? { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': String(new TextEncoder().encode(corpo).length) } : { Accept: 'application/json, application/pdf' },
      }, (res) => {
        const partes: Uint8Array[] = [];
        res.on('data', (c: Uint8Array) => partes.push(c));
        res.on('end', () => {
          const total = new Uint8Array(partes.reduce((n, p) => n + p.length, 0)); let o = 0;
          for (const p of partes) { total.set(p, o); o += p.length; }
          resolve({ status: res.statusCode ?? 0, corpo: total, tipo: String(res.headers['content-type'] ?? '') });
        });
      });
      req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
      req.on('error', reject);
      if (corpo) req.write(corpo);
      req.end();
    });
  };
}


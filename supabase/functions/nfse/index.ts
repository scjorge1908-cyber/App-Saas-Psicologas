// Função do servidor "nfse" — emissão de NFS-e pela API oficial e gratuita do padrão nacional
// (pedido do Jorge, 06/11/2026). Chamada pelo app com o login da psicóloga.
//
// Ações (POST JSON): certificado | conferir | emitir | cancelar | pdf. Regras em _shared/nfse/servico.ts.
// Segurança:
//  - quem chama é identificado pelo token de login; tudo é filtrado por esse id (dono);
//  - o certificado A1 é lido só aqui, decifrado com o segredo NFSE_CHAVE_CERTIFICADOS, e nunca volta ao app;
//  - o banco é acessado por funções restritas ao papel de servidor (service_role).
// Segredos: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (já existem no Supabase) e NFSE_CHAVE_CERTIFICADOS (32 bytes Base64).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { atender, ErroUsuario, type Dependencias } from '../_shared/nfse/servico.ts';
import { chaveMestra } from '../_shared/nfse/cofre.ts';
import { transporteMtls } from '../_shared/nfse/transporte-deno.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { erro: 'Método não permitido.' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const servico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const db = createClient(url, servico, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return json(401, { erro: 'Entre novamente no app.' });

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return json(400, { erro: 'Pedido inválido.' }); }

  const deps: Dependencias = {
    dono: u.user.id,
    rpc: async (nome, args) => {
      const { data, error } = await db.rpc(nome, args);
      if (error) throw new ErroUsuario(error.message, error.code === 'P0002' ? 404 : error.code === '55P03' ? 409 : 400);
      return data;
    },
    transporte: transporteMtls,
    chaveMestra: () => chaveMestra(Deno.env.get('NFSE_CHAVE_CERTIFICADOS')),
  };

  try {
    return json(200, await atender(deps, corpo));
  } catch (e) {
    if (e instanceof ErroUsuario) return json(e.status, { erro: e.message });
    console.error('nfse', (e as Error)?.message);
    return json(500, { erro: 'Erro inesperado no servidor. Tente de novo em instantes.' });
  }
});

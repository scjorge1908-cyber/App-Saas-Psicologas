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
// Só as mensagens que o próprio banco escreve em português (raise das funções nfse_*) vão para a tela;
// o resto vira mensagem fixa, sem nomes de tabelas ou restrições (revisão de segurança 06/11).
function erroDoBanco(code: string | undefined, message: string): ErroUsuario {
  if (code === 'P0002') return new ErroUsuario(message, 404);
  if (code === '55P03') return new ErroUsuario(message, 409);
  if (code === '22023') return new ErroUsuario(message, 400);
  console.error('nfse banco', code, message);
  return new ErroUsuario('Não consegui gravar no banco agora. Tente de novo em instantes.', 500);
}

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

  // Limite de tamanho do pedido (certificado A1 tem poucos KB).
  if (Number(req.headers.get('content-length') ?? '0') > 200_000) return json(413, { erro: 'Pedido grande demais.' });
  let corpo: Record<string, unknown>;
  try {
    const texto = await req.text();
    if (texto.length > 200_000) return json(413, { erro: 'Pedido grande demais.' });
    corpo = JSON.parse(texto);
  } catch { return json(400, { erro: 'Pedido inválido.' }); }

  const deps: Dependencias = {
    dono: u.user.id,
    rpc: async (nome, args) => {
      const { data, error } = await db.rpc(nome, args);
      if (error) throw erroDoBanco(error.code, error.message);
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

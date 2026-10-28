// Notificação no celular quando chega um pedido pelo link (pedido do Jorge, 28/10/2026).
// Chamada pelo banco (gatilho em booking_requests). Não confia no chamador: relê o pedido com a chave
// do servidor, só avisa pedido pendente criado há menos de 10 minutos e só uma vez (booking_notifications).
// Texto sem nome do paciente (aparece na tela bloqueada): só dia e horário.
// Segredo necessário: FCM_SERVICE_ACCOUNT (JSON da conta de serviço do Firebase), guardado no Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = ''; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function tokenGoogle(sa: { client_email: string; private_key: string }): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const chave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(`${cab}.${corpo}`));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cab}.${corpo}.${b64url(assinatura)}` }),
  });
  if (!r.ok) throw new Error(`Google recusou a chave (${r.status})`);
  return (await r.json()).access_token as string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { erro: 'método' });
  let id: string | undefined;
  try { id = (await req.json())?.request_id; } catch { /* corpo inválido */ }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json(400, { erro: 'pedido inválido' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: pedido } = await db.from('booking_requests').select('id, owner_id, starts_at, status, created_at').eq('id', id).maybeSingle();
  if (!pedido || pedido.status !== 'pendente' || Date.now() - new Date(pedido.created_at).getTime() > 10 * 60_000) return json(200, { enviado: false });

  // Uma vez só por pedido
  const marca = await db.from('booking_notifications').insert({ request_id: id });
  if (marca.error) return json(200, { enviado: false, motivo: 'já avisado' });

  const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') ?? 'null');
  if (!sa?.client_email || !sa?.private_key || !sa?.project_id) return json(200, { enviado: false, motivo: 'Firebase não configurado' });

  const [{ data: tokens }, { data: perfil }] = await Promise.all([
    db.from('device_tokens').select('id, token').eq('owner_id', pedido.owner_id),
    db.from('profiles').select('timezone').eq('id', pedido.owner_id).maybeSingle(),
  ]);
  if (!tokens?.length) return json(200, { enviado: false, motivo: 'nenhum celular' });

  const quando = new Intl.DateTimeFormat('pt-BR', { timeZone: perfil?.timezone ?? 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(new Date(pedido.starts_at)).replace(',', '').replace('.', '');
  const acesso = await tokenGoogle(sa);
  let enviados = 0;
  for (const t of tokens) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${acesso}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        token: t.token,
        notification: { title: 'Novo pedido de horário', body: `${quando} · toque para aprovar` },
        data: { tipo: 'pedido', id },
        android: { priority: 'HIGH' },
      } }),
    });
    if (r.ok) enviados++;
    else if (r.status === 404) await db.from('device_tokens').delete().eq('id', t.id); // celular saiu do app (token não existe mais)
  }
  return json(200, { enviado: enviados > 0, enviados });
});

// Notificação no celular (pedido do Jorge, 28/10/2026): quando chega um pedido pelo link, o servidor manda
// um aviso pelo Firebase. Aqui o app pede permissão, registra o celular e trata o toque na notificação.
// Só liga no app Android publicado com o Firebase configurado (VITE_PUSH=1); no navegador não faz nada.
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabase';

export const pushDisponivel = () => Capacitor.isNativePlatform() && import.meta.env.VITE_PUSH === '1';

/** Pede permissão, registra o celular e guarda o token da conta. Chamar depois do login. */
export async function ligarPush(opts: { aoAbrirPedido: (id: string | null) => void; aoReceber: () => void }): Promise<() => void> {
  if (!pushDisponivel()) return () => {};
  const subs = [
    await PushNotifications.addListener('registration', async ({ value }) => {
      await supabase.from('device_tokens').upsert({ token: value, platform: Capacitor.getPlatform() }, { onConflict: 'token' });
    }),
    await PushNotifications.addListener('pushNotificationReceived', () => opts.aoReceber()),
    await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const d = a.notification.data as { tipo?: string; id?: string } | undefined;
      if (d?.tipo === 'pedido') opts.aoAbrirPedido(d.id ?? null);
    }),
  ];
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
  if (perm.receive === 'granted') await PushNotifications.register();
  return () => { for (const s of subs) void s.remove(); };
}

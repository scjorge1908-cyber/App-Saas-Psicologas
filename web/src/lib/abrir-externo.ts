// Abre um link de fora do app (WhatsApp, por exemplo).
// No aplicativo Android/iOS, window.open('') não abre nada; navegar para o link faz o sistema entregá-lo ao app
// certo (wa.me → WhatsApp). No navegador, abre em outra aba (se o navegador bloquear, abre na mesma aba).
import { Capacitor } from '@capacitor/core';

export function abrirExterno(url: string) {
  if (Capacitor.isNativePlatform()) { window.location.href = url; return; }
  const w = window.open(url, '_blank', 'noopener');
  if (!w) window.location.href = url;
}

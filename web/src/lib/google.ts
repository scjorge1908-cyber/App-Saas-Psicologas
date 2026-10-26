// Entrar com Google (Supabase Auth).
// Web: o Supabase redireciona de volta ao app web e a sessão é lida da URL (detectSessionInUrl).
// Android/iOS: abre o navegador do sistema; o Google volta para br.com.clinicahope.psi://auth e o app
// captura esse endereço (appUrlOpen), grava a sessão e fecha o navegador.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { publicOrigin, supabase } from './supabase';

export const RETORNO_APP = 'br.com.clinicahope.psi://auth';

export async function entrarComGoogle(): Promise<void> {
  const nativo = Capacitor.isNativePlatform();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: nativo ? RETORNO_APP : `${publicOrigin()}/`,
      skipBrowserRedirect: nativo,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
  if (nativo && data.url) await Browser.open({ url: data.url, presentationStyle: 'popover' });
}

/** Lê os dados de sessão que o Supabase devolve no endereço de retorno (fragmento #... ou ?code=...). */
export async function concluirRetorno(url: string): Promise<boolean> {
  const u = new URL(url);
  const params = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.search);
  const erro = params.get('error_description') ?? params.get('error');
  if (erro) throw new Error(erro);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return true;
  }
  const code = params.get('code') ?? new URLSearchParams(u.search).get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return true;
  }
  return false;
}

/** No app nativo: escuta o retorno do Google. Chamado uma vez ao iniciar. */
export function escutarRetornoGoogle(aoErro: (msg: string) => void) {
  if (!Capacitor.isNativePlatform()) return;
  void App.addListener('appUrlOpen', async ({ url }) => {
    if (!url.startsWith(RETORNO_APP)) return;
    try {
      await concluirRetorno(url);
    } catch (e) {
      aoErro(e instanceof Error ? e.message : 'Não foi possível entrar com o Google.');
    } finally {
      void Browser.close().catch(() => undefined);
    }
  });
}

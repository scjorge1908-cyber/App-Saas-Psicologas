import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

/**
 * Cliente único do Supabase. Usa SOMENTE a chave pública (anon/publishable).
 * Toda a segurança dos dados é garantida pelo banco (RLS); nunca coloque a
 * chave service_role no frontend.
 */
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
});

export const STORAGE_BUCKET = 'prontuario';

/**
 * Endereço público do app web. Links enviados a pacientes e redirecionamentos de
 * e-mail usam este endereço — dentro do app Android/iOS (Capacitor) a origem local
 * é "https://localhost", que não serve para quem recebe o link.
 */
export function publicOrigin(): string {
  const env = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return ((env && env.trim()) || `${window.location.origin}${base}`).replace(/\/$/, '');
}

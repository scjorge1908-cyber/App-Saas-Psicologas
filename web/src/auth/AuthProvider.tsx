import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { DEFAULT_TZ } from '../lib/format';

interface AuthState {
  session: Session | null;
  loading: boolean;
  recovering: boolean; // chegou pelo link de recuperação de senha
  clearRecovering: () => void;
}

const AuthCtx = createContext<AuthState>({ session: null, loading: true, recovering: false, clearRecovering: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(() => window.location.hash.includes('type=recovery'));
  const qc = useQueryClient();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') qc.clear(); // nenhum dado de outra sessão fica em memória
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [qc]);

  return (
    <AuthCtx.Provider value={{ session, loading, recovering, clearRecovering: () => setRecovering(false) }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);

export function useProfile() {
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ['profile', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', session!.user.id).single();
      if (error) throw error;
      return data as Profile;
    },
  });
  return { ...q, profile: q.data, tz: q.data?.timezone ?? DEFAULT_TZ };
}

export async function signOut() {
  await supabase.auth.signOut();
}

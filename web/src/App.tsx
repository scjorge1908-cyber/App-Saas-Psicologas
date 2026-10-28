import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth, useProfile } from './auth/AuthProvider';
import { supabaseConfigured } from './lib/supabase';
import { AppShell, MorePage } from './components/AppShell';
import { AjudaPage } from './pages/AjudaPage';
import { ErrorBox, Loading } from './components/ui';
import { ForgotPasswordPage, LoginPage, OnboardingPage, ResetPasswordPage, SignupPage } from './pages/auth/AuthPages';
import { TodayPage } from './pages/TodayPage';
import { AgendaPage } from './pages/AgendaPage';
import { PatientsPage } from './pages/PatientsPage';
import { PatientDetailPage } from './pages/PatientDetailPage';
import { FinancePage } from './pages/FinancePage';
import { InvoicesPage } from './pages/InvoicesPage';
import { SettingsPage } from './pages/SettingsPage';
import { PublicConfirmPage } from './pages/PublicConfirmPage';
import { PublicBookingPage } from './pages/PublicBookingPage';
import { TermsPage } from './pages/TermsPage';
import { WelcomePage } from './pages/WelcomePage';
import { HorariosPage } from './pages/HorariosPage';
import { ProntuarioPage } from './pages/ProntuarioPage';
import { faltandoPerfil } from './lib/perfil';

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, recovering } = useAuth();
  const { profile, isLoading, error } = useProfile();
  const loc = useLocation();
  if (loading || (session && isLoading)) return <div className="p-6"><Loading /></div>;
  if (!session) return <Navigate to="/boas-vindas" replace state={{ from: loc.pathname }} />;
  if (recovering) return <Navigate to="/redefinir-senha" replace />;
  if (error) return <div className="p-6"><ErrorBox>Não foi possível carregar seu perfil. Recarregue a página.</ErrorBox></div>;
  // Só o nome é pedido no começo; o CRP é pedido quando ela for emitir documento.
  if (profile && !profile.onboarded_at) return <OnboardingPage />;
  // Perfil profissional obrigatório (28/10): incompleto, só Configurações (e a Ajuda) abrem
  if (profile && faltandoPerfil(profile).length && !['/configuracoes', '/ajuda'].includes(loc.pathname)) return <Navigate to="/configuracoes" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return null;
  return session ? <Navigate to="/" replace /> : <>{children}</>;
}

export default function App() {
  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorBox>Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (veja .env.example).</ErrorBox>
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/c/:token" element={<PublicConfirmPage />} />
      <Route path="/a/:token" element={<PublicBookingPage />} />
      <Route path="/termos" element={<TermsPage />} />
      <Route path="/boas-vindas" element={<PublicOnly><WelcomePage /></PublicOnly>} />
      <Route path="/entrar" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/cadastro" element={<PublicOnly><SignupPage /></PublicOnly>} />
      <Route path="/esqueci-senha" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<AgendaPage />} />
        <Route path="agenda" element={<Navigate to="/" replace />} />
        <Route path="resumo" element={<TodayPage />} />
        <Route path="agenda/horarios" element={<HorariosPage />} />
        <Route path="prontuario" element={<ProntuarioPage />} />
        <Route path="pacientes" element={<PatientsPage />} />
        <Route path="pacientes/:id" element={<PatientDetailPage />} />
        <Route path="financeiro" element={<FinancePage />} />
        <Route path="notas-fiscais" element={<InvoicesPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="mais" element={<MorePage />} />
        <Route path="ajuda" element={<AjudaPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

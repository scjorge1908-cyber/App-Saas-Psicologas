import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { FeedbackProvider } from './components/ui';
import { UpdatePrompt } from './components/UpdatePrompt';
import { escutarRetornoGoogle } from './lib/google';
import { aplicarTema } from './lib/tema';

aplicarTema(); // antes de desenhar, para não piscar o tema errado

// Android/iOS: o login com Google volta ao app por br.com.clinicahope.psi://auth
escutarRetornoGoogle((msg) => window.dispatchEvent(new CustomEvent('psi:erro-login', { detail: msg })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <FeedbackProvider>
            <App />
            <UpdatePrompt />
          </FeedbackProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);

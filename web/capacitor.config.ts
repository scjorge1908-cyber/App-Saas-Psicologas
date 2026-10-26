import type { CapacitorConfig } from '@capacitor/cli';

// Aplicativo Android/iOS empacotando o mesmo build web (dist/).
// Identificador definitivo nas lojas (aprovado 26/10/2026). Publicado pela conta de desenvolvedor da Hope.
const config: CapacitorConfig = {
  appId: 'br.com.clinicahope.psi',
  appName: 'PsiConsultório',
  webDir: 'dist',
  android: { allowMixedContent: false },
  ios: { contentInset: 'automatic' },
  server: { androidScheme: 'https' },
};

export default config;

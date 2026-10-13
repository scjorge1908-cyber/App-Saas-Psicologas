import type { CapacitorConfig } from '@capacitor/cli';

// Aplicativo Android/iOS empacotando o mesmo build web (dist/).
// appId provisório: definir o identificador definitivo antes de publicar nas lojas.
const config: CapacitorConfig = {
  appId: 'br.com.psiconsultorio.app',
  appName: 'PsiConsultório',
  webDir: 'dist',
  android: { allowMixedContent: false },
  ios: { contentInset: 'automatic' },
  server: { androidScheme: 'https' },
};

export default config;

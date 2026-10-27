import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// VITE_BASE: subcaminho de publicação (ex.: /psi-gestao-facil-ideia-jorge/ no GitHub Pages)
const base = process.env.VITE_BASE || '/';

import { readFileSync } from 'node:fs';
const versaoPacote = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

export default defineConfig({
  base,
  define: { __VERSAO_APP__: JSON.stringify(versaoPacote) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'PsiConsultório',
        short_name: 'PsiConsultório',
        description: 'Agenda, pacientes, prontuário e recebimentos para psicólogas.',
        lang: 'pt-BR',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F3F4EF',
        theme_color: '#146C70',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Somente o "esqueleto" do app é guardado offline.
        // Dados clínicos e respostas da API NUNCA são armazenados em cache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [],
      },
    }),
  ],
  server: { port: 5173, host: '127.0.0.1' },
  preview: { port: 4173, host: '127.0.0.1' },
});

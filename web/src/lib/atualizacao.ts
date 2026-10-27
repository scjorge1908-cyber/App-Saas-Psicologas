// Atualização automática no Android: quando a Play tem versão nova, o app abre a tela
// de atualização da própria Play e instala (fluxo "imediato" da In-App Updates API).
// Só funciona em apps instalados pela Play (inclusive o teste interno). Na web, o PWA
// já se atualiza pelo service worker (UpdatePrompt).
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { AppUpdate, AppUpdateAvailability } from '@capawesome/capacitor-app-update';

let verificando = false;

async function verificar() {
  if (verificando) return;
  verificando = true;
  try {
    const info = await AppUpdate.getAppUpdateInfo();
    if (info.updateAvailability === AppUpdateAvailability.UPDATE_AVAILABLE && info.immediateUpdateAllowed) {
      await AppUpdate.performImmediateUpdate();
    }
  } catch {
    // Sem Play (instalado por fora), sem rede ou usuário cancelou: segue com a versão atual.
  } finally {
    verificando = false;
  }
}

export function ativarAtualizacaoAutomatica() {
  if (Capacitor.getPlatform() !== 'android') return;
  void verificar();
  // Também ao voltar para o app depois de um tempo em segundo plano
  void App.addListener('resume', () => { void verificar(); });
}

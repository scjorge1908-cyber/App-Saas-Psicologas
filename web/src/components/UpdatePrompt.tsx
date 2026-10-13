import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './ui';

/** Avisa quando há uma versão nova do app instalada (PWA). */
export function UpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg bg-tinta px-4 py-3 text-white shadow-lg lg:bottom-6">
      <span>Nova versão disponível.</span>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => setNeedRefresh(false)}>Depois</Button>
        <Button size="sm" onClick={() => updateServiceWorker(true)}>Atualizar</Button>
      </div>
    </div>
  );
}

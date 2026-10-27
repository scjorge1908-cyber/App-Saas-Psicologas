// Versão instalada, no rodapé. No Android vem do próprio pacote (ex.: "0.1.0 (12)"),
// que é o número que a Play mostra; na web, a versão do package.json.
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { cx } from './ui';

export function Versao({ className }: { className?: string }) {
  const [texto, setTexto] = useState(`Versão ${__VERSAO_APP__}`);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    App.getInfo().then((i) => setTexto(`Versão ${i.version}`)).catch(() => {});
  }, []);
  return <p className={cx('num text-center text-[0.75rem] text-tinta-3', className)}>PsiConsultório · {texto}</p>;
}

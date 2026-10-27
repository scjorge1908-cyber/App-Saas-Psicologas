// Versão instalada, no rodapé. No Android vem do próprio pacote (ex.: "0.1.0 (12)"),
// que é o número que a Play mostra; na web, a versão do package.json com o número do último envio.
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { cx } from './ui';

export function Versao({ className }: { className?: string }) {
  // Celular: o próprio pacote diz "0.1.0 (27)". Navegador: o número do último envio à Play;
  // no painel de prévia (desenvolvimento) com "· prévia", para mostrar que é o código mais novo, ainda não enviado.
  const numero = __NUMERO_PLAY__ ? ` (${__NUMERO_PLAY__}${import.meta.env.DEV ? ' · prévia' : ''})` : import.meta.env.DEV ? ' (prévia)' : '';
  const [texto, setTexto] = useState(`Versão ${__VERSAO_APP__}${numero}`);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    App.getInfo().then((i) => setTexto(`Versão ${i.version}`)).catch(() => {});
  }, []);
  return <p className={cx('num text-center text-[0.75rem] text-tinta-3', className)}>PsiConsultório · {texto}</p>;
}

// Bolinha "i" de explicação, usada nas telas (Grade, Bloqueios…).
import { useState } from 'react';
import { cx } from './ui';

/**
 * Bolinha "i" (pedido do Jorge, 27/10): passando o mouse já mostra o conteúdo; um toque/clique deixa aberto;
 * outro toque/clique fecha. No celular, o toque abre e o segundo toque fecha.
 */
export function useInfo() {
  const [fixo, setFixo] = useState(false);
  const [hover, setHover] = useState(false);
  return { aberto: fixo || hover, fixo, alternar: () => { if (fixo) { setFixo(false); setHover(false); } else setFixo(true); }, setHover };
}
export function Bolinha({ info, rotulo, grande }: { info: ReturnType<typeof useInfo>; rotulo: string; grande?: boolean }) {
  return (
    <button type="button" onClick={info.alternar} aria-expanded={info.aberto} aria-label={rotulo} title={rotulo}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') info.setHover(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') info.setHover(false); }}
      className={cx('grid shrink-0 place-items-center rounded-full border font-titulo font-bold italic text-anil-escuro hover:bg-anil-claro/50',
        grande ? 'size-8 text-[0.9375rem]' : 'size-7 text-[0.8125rem]', info.fixo ? 'border-anil bg-anil-claro/60' : 'border-linha-forte bg-papel')}>i</button>
  );
}


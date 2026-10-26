// Valores em reais ocultos por padrão na tela inicial.
// Motivo: avaliações do concorrente reclamam que o financeiro aparece ao abrir o app, na frente de outras pessoas.
// A escolha fica só neste aparelho (localStorage); se o armazenamento falhar, os valores continuam ocultos.
import { useState } from 'react';

const CHAVE = 'psi.valoresVisiveis';

function lerPreferencia(): boolean {
  try {
    return localStorage.getItem(CHAVE) === '1';
  } catch {
    return false;
  }
}

export function useValoresVisiveis(): [boolean, () => void] {
  const [visiveis, setVisiveis] = useState(lerPreferencia);
  const alternar = () => {
    setVisiveis((v) => {
      const novo = !v;
      try {
        localStorage.setItem(CHAVE, novo ? '1' : '0');
      } catch {
        // sem armazenamento: vale só nesta sessão
      }
      return novo;
    });
  };
  return [visiveis, alternar];
}

export const VALOR_OCULTO = 'R$ •••';

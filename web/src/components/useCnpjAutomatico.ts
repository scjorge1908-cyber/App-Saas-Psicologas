// Digitou um CNPJ válido → busca a razão social e preenche o nome da empresa (28/10/2026).
// Se a psicóloga mexer no nome ou no CNPJ enquanto a busca demora, o que ela digitou vale.
import { useRef, useState } from 'react';
import { buscarCnpj } from '../lib/cnpj';
import { isValidCnpj, onlyDigits } from '../lib/format';

export function useCnpjAutomatico(cnpj: string, nome: string, preencher: (razaoSocial: string) => void) {
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const atual = useRef({ cnpj, nome, preencher });
  atual.current = { cnpj, nome, preencher };

  async function aoMudarCnpj(novo: string) {
    setAviso(null);
    const d = onlyDigits(novo);
    if (d.length !== 14) return;
    if (!isValidCnpj(d)) { setAviso('CNPJ inválido. Confira os números.'); return; }
    const nomeAntes = atual.current.nome;
    setBuscando(true);
    const r = await buscarCnpj(d);
    setBuscando(false);
    if (onlyDigits(atual.current.cnpj) !== d) return; // o CNPJ mudou durante a busca
    if (!r) { setAviso('Não deu para buscar o nome da empresa. Digite a razão social.'); return; }
    if (atual.current.nome !== nomeAntes) return; // digitou o nome durante a busca: fica o que digitou
    atual.current.preencher(r.razaoSocial);
    setAviso(`Nome da empresa preenchido pelo CNPJ${r.nomeFantasia ? ` (nome fantasia: ${r.nomeFantasia})` : ''}.`);
  }
  return { buscando, aviso, aoMudarCnpj };
}

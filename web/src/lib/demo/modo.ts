// Modo demonstração: a pessoa conhece o app antes de criar conta.
// Tudo roda no próprio aparelho, em memória, com dados fictícios — nada vai para o banco.
// A escolha dura enquanto a aba/app estiver aberto (sessionStorage); fechar o app volta às boas-vindas.
import { useSyncExternalStore } from 'react';

const CHAVE = 'psi.demo';
const ouvintes = new Set<() => void>();

function ler(): boolean {
  try {
    return sessionStorage.getItem(CHAVE) === '1';
  } catch {
    return false;
  }
}

let ativo = ler();

function avisar() {
  for (const o of ouvintes) o();
}

export function isDemo(): boolean {
  return ativo;
}

export function entrarNaDemo() {
  ativo = true;
  try {
    sessionStorage.setItem(CHAVE, '1');
  } catch {
    // sem armazenamento: vale só enquanto a página estiver aberta
  }
  avisar();
}

export function sairDaDemo() {
  ativo = false;
  try {
    sessionStorage.removeItem(CHAVE);
  } catch {
    // nada a limpar
  }
  avisar();
}

export function useDemo(): boolean {
  return useSyncExternalStore(
    (cb) => {
      ouvintes.add(cb);
      return () => ouvintes.delete(cb);
    },
    () => ativo,
    () => false,
  );
}

/** Identificador fixo da "psicóloga" da demonstração. */
export const DEMO_USER_ID = '00000000-0000-4000-8000-00000000d3e0';

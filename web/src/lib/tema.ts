// Aparência: direção visual (tema) e modo claro/escuro, por aparelho.
// Fica no <html> como data-theme / data-mode; os tokens vêm de styles/temas.css.
import { useSyncExternalStore } from 'react';

export type Tema = 'petroleo' | 'lavanda' | 'indigo' | 'salvia';
export type Modo = 'sistema' | 'claro' | 'escuro';

export const TEMAS: Array<{ id: Tema; nome: string; descricao: string; cores: [string, string, string] }> = [
  { id: 'petroleo', nome: 'Azul-petróleo', descricao: 'Profissional e discreto (padrão)', cores: ['#146C70', '#216A5C', '#F6F9FA'] },
  { id: 'lavanda', nome: 'Lavanda serena', descricao: 'Acolhedor, sombras suaves', cores: ['#674698', '#8D5375', '#F6F5FB'] },
  { id: 'indigo', nome: 'Índigo noturno', descricao: 'Sóbrio, linhas finas', cores: ['#44549D', '#A64831', '#F2F6FD'] },
  { id: 'salvia', nome: 'Sálvia terrosa', descricao: 'Natural, cantos redondos', cores: ['#4F6236', '#9C522E', '#EFF0E7'] },
];

const KT = 'psi.tema';
const KM = 'psi.modo';
const ouvintes = new Set<() => void>();

function ler<T extends string>(k: string, validos: readonly T[], padrao: T): T {
  try {
    const v = localStorage.getItem(k) as T | null;
    return v && validos.includes(v) ? v : padrao;
  } catch { return padrao; }
}

let atual = {
  tema: ler<Tema>(KT, ['petroleo', 'lavanda', 'indigo', 'salvia'], 'petroleo'),
  modo: ler<Modo>(KM, ['sistema', 'claro', 'escuro'], 'sistema'),
};

const midia = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function aplicarTema() {
  const escuro = atual.modo === 'escuro' || (atual.modo === 'sistema' && !!midia?.matches);
  const raiz = document.documentElement;
  raiz.setAttribute('data-theme', atual.tema);
  raiz.setAttribute('data-mode', escuro ? 'dark' : 'light');
  // Cor da barra do navegador/sistema acompanha o cabeçalho
  const cor = getComputedStyle(raiz).getPropertyValue('--header-from').trim();
  if (cor) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', cor);
}

midia?.addEventListener?.('change', () => { if (atual.modo === 'sistema') aplicarTema(); });

export function definirAparencia(p: Partial<typeof atual>) {
  atual = { ...atual, ...p };
  try { localStorage.setItem(KT, atual.tema); localStorage.setItem(KM, atual.modo); } catch { /* modo privado */ }
  aplicarTema();
  ouvintes.forEach((f) => f());
}

export function useAparencia() {
  return useSyncExternalStore(
    (f) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; },
    () => atual,
    () => atual,
  );
}

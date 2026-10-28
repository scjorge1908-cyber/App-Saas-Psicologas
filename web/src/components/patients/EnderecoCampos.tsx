// Endereço do paciente: digita o CEP e o resto vem preenchido (dá para corrigir).
import { useRef, useState } from 'react';
import { buscarCep, formatarCep } from '../../lib/cep';
import { Spinner, TextField } from '../ui';

export type Endereco = { cep: string; street: string; address_number: string; address_complement: string; neighborhood: string; city: string; uf: string };
export const ENDERECO_VAZIO: Endereco = { cep: '', street: '', address_number: '', address_complement: '', neighborhood: '', city: '', uf: '' };

export function EnderecoCampos({ valor, onChange, obrigatorio }: { valor: Endereco; onChange: (e: Endereco) => void; obrigatorio?: boolean }) {
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // O que está na tela agora: a busca do CEP demora e a psicóloga pode digitar enquanto isso (28/10)
  const atual = useRef(valor);
  atual.current = valor;
  const set = (k: keyof Endereco) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...valor, [k]: e.target.value });

  async function mudarCep(e: React.ChangeEvent<HTMLInputElement>) {
    const cep = formatarCep(e.target.value);
    const novo = { ...valor, cep };
    onChange(novo);
    setAviso(null);
    if (cep.replace(/\D/g, '').length !== 8) return;
    setBuscando(true);
    const r = await buscarCep(cep);
    setBuscando(false);
    const agora = atual.current;
    if (agora.cep !== cep) return; // o CEP mudou durante a busca: vale a busca nova
    if (!r) { setAviso('CEP não encontrado. Preencha o endereço.'); return; }
    // Campo mexido durante a busca fica como foi digitado; os outros recebem o endereço do CEP, como antes
    const mexeu = (k: keyof Endereco) => agora[k] !== novo[k];
    onChange({ ...agora,
      street: mexeu('street') ? agora.street : r.street || novo.street,
      neighborhood: mexeu('neighborhood') ? agora.neighborhood : r.neighborhood || novo.neighborhood,
      city: mexeu('city') ? agora.city : r.city,
      uf: mexeu('uf') ? agora.uf : r.uf });
  }

  return (
    <div className="grid grid-cols-6 gap-3">
      <div className="col-span-3 sm:col-span-2">
        <TextField label="CEP" required={obrigatorio} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" value={valor.cep} onChange={mudarCep}
          hint={buscando ? <span className="inline-flex items-center gap-1.5"><Spinner small /> Buscando…</span> : aviso ?? undefined} />
      </div>
      <TextField className="col-span-6 sm:col-span-4" label="Rua" required={obrigatorio} value={valor.street} onChange={set('street')} />
      <TextField className="col-span-2" label="Número" required={obrigatorio} value={valor.address_number} onChange={set('address_number')} />
      <TextField className="col-span-4" label="Complemento" value={valor.address_complement} onChange={set('address_complement')} />
      <TextField className="col-span-6 sm:col-span-2" label="Bairro" required={obrigatorio} value={valor.neighborhood} onChange={set('neighborhood')} />
      <TextField className="col-span-4 sm:col-span-3" label="Cidade" required={obrigatorio} value={valor.city} onChange={set('city')} />
      <TextField className="col-span-2 sm:col-span-1" label="UF" required={obrigatorio} maxLength={2} value={valor.uf} onChange={(e) => onChange({ ...valor, uf: e.target.value.toUpperCase() })} />
    </div>
  );
}

/** Converte os campos do formulário para as colunas do paciente (vazio vira null). */
export function enderecoParaPaciente(e: Endereco) {
  const nn = (v: string) => (v.trim() ? v.trim() : null);
  const uf = e.uf.trim().toUpperCase();
  return {
    cep: nn(e.cep.replace(/\D/g, '')), street: nn(e.street), address_number: nn(e.address_number), address_complement: nn(e.address_complement),
    neighborhood: nn(e.neighborhood), city: nn(e.city), uf: /^[A-Z]{2}$/.test(uf) ? uf : null,
  };
}

/** Partes que faltam para o endereço servir na nota fiscal (complemento é opcional). */
export function enderecoFaltando(e: Endereco): string[] {
  const f: string[] = [];
  if (e.cep.replace(/\D/g, '').length !== 8) f.push('CEP');
  if (!e.street.trim()) f.push('rua');
  if (!e.address_number.trim()) f.push('número');
  if (!e.neighborhood.trim()) f.push('bairro');
  if (!e.city.trim()) f.push('cidade');
  if (!/^[A-Za-z]{2}$/.test(e.uf.trim())) f.push('UF');
  return f;
}

// Perfil profissional obrigatório (regra do Jorge, 28/10/2026): sem ele completo, o resto do app não funciona.
// Regra pura: diz o que falta. O complemento do endereço é o único campo opcional.
import type { Profile } from './types';
import { isValidCnpj, isValidCpf, normalizeCrp, onlyDigits } from './format';

export type CamposPerfil = Pick<Profile, 'full_name' | 'crp' | 'cpf' | 'cnpj' | 'fiscal_type' | 'contact_email' | 'phone' | 'address' | 'city' | 'uf' | 'cep' | 'address_number' | 'neighborhood' | 'company_name'>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lista do que falta (vazio = perfil completo). */
export function faltandoPerfil(p: Partial<CamposPerfil> | null | undefined): string[] {
  if (!p) return ['perfil'];
  const t = (v: string | null | undefined) => (v ?? '').trim();
  const falta: string[] = [];
  if (t(p.full_name).length < 3) falta.push('nome completo');
  if (!normalizeCrp(t(p.crp))) falta.push('CRP');
  if (!isValidCpf(t(p.cpf))) falta.push('CPF');
  if (p.fiscal_type === 'pj' && !isValidCnpj(t(p.cnpj))) falta.push('CNPJ');
  if (p.fiscal_type === 'pj' && t(p.company_name).length < 2) falta.push('razão social');
  if (!EMAIL.test(t(p.contact_email))) falta.push('e-mail profissional');
  const tel = onlyDigits(t(p.phone));
  if (tel.length < 10 || tel.length > 11) falta.push('telefone');
  if (onlyDigits(t(p.cep)).length !== 8) falta.push('CEP');
  if (!t(p.address)) falta.push('rua');
  if (!t(p.address_number)) falta.push('número');
  if (!t(p.neighborhood)) falta.push('bairro');
  if (!t(p.city)) falta.push('cidade');
  if (!/^[A-Za-z]{2}$/.test(t(p.uf))) falta.push('UF');
  return falta;
}

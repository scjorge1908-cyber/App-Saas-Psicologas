import { describe, expect, it } from 'vitest';
import { faltandoPerfil } from './perfil';

const completo = {
  full_name: 'Ana Fictícia', crp: '12/345678', cpf: '529.982.247-25', cnpj: null, fiscal_type: 'pf' as const,
  contact_email: 'ana@exemplo.invalid', phone: '(48) 99999-0000', cep: '88132-150', address: 'Rua Fictícia', address_number: '10',
  neighborhood: 'Centro', city: 'Palhoça', uf: 'SC',
};

describe('perfil profissional obrigatório', () => {
  it('completo não falta nada (complemento é opcional)', () => {
    expect(faltandoPerfil(completo)).toEqual([]);
  });
  it('lista o que falta', () => {
    expect(faltandoPerfil({ ...completo, cpf: '', address_number: ' ', contact_email: 'sem-arroba' })).toEqual(['CPF', 'e-mail profissional', 'número']);
    expect(faltandoPerfil({ ...completo, fiscal_type: 'pj', cnpj: '11.222.333/0001-82' })).toEqual(['CNPJ', 'razão social']);
    expect(faltandoPerfil({ ...completo, fiscal_type: 'pj', cnpj: '11.222.333/0001-81', company_name: 'Empresa Fictícia Ltda' })).toEqual([]);
    expect(faltandoPerfil(null)).toEqual(['perfil']);
  });
});

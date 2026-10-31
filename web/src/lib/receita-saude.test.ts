import { describe, expect, it } from 'vitest';
import { dadosRecibo, pagadorEhOutraPessoa, textoRecibo } from './receita-saude';

// Dados fictícios
const base = {
  amount: 180, paid_on: '2026-10-24', payer_name: null, payer_cpf: null,
  patient_name: 'Mariana Costa Fictícia', patient_cpf: '11111111111', charge_description: null,
};

describe('recibo do Receita Saúde (modo assistido)', () => {
  it('paciente que paga a própria sessão: só os dados dela, valor e data no formato brasileiro', () => {
    const c = dadosRecibo(base);
    expect(c.map((x) => x.rotulo)).toEqual(['CPF de quem pagou', 'Nome de quem pagou', 'Valor (R$)', 'Data do pagamento', 'Descrição do serviço']);
    expect(c[0]).toEqual({ rotulo: 'CPF de quem pagou', mostrar: '111.111.111-11', copiar: '11111111111' });
    expect(c[2].copiar).toBe('180,00');
    expect(c[3].copiar).toBe('24/10/2026');
    expect(c[4].copiar).toBe('Atendimento psicológico');
  });

  it('outra pessoa paga (mãe de criança): pagador e paciente beneficiário separados', () => {
    const p = { ...base, payer_name: 'Ana Responsável Fictícia', payer_cpf: '22222222222', patient_cpf: null };
    expect(pagadorEhOutraPessoa(p)).toBe(true);
    const c = dadosRecibo(p);
    expect(c[0].copiar).toBe('22222222222');
    expect(c[1].copiar).toBe('Ana Responsável Fictícia');
    expect(c[2]).toEqual({ rotulo: 'CPF do paciente (beneficiário)', mostrar: 'não cadastrado', copiar: null });
    expect(c[3].copiar).toBe('Mariana Costa Fictícia');
  });

  it('pagador com o mesmo CPF do paciente não vira beneficiário separado', () => {
    expect(pagadorEhOutraPessoa({ payer_name: 'Mariana', payer_cpf: '111.111.111-11', patient_cpf: '11111111111' })).toBe(false);
  });

  it('sem CPF de quem pagou não há o que copiar; descrição da cobrança é usada quando existe', () => {
    const c = dadosRecibo({ ...base, patient_cpf: null, charge_description: 'Sessão de 24/10' });
    expect(c[0]).toEqual({ rotulo: 'CPF de quem pagou', mostrar: 'não cadastrado', copiar: null });
    expect(c.at(-1)?.copiar).toBe('Sessão de 24/10');
  });

  it('texto único com todos os campos, um por linha', () => {
    expect(textoRecibo(dadosRecibo(base))).toBe(
      'CPF de quem pagou: 111.111.111-11\nNome de quem pagou: Mariana Costa Fictícia\nValor (R$): 180,00\nData do pagamento: 24/10/2026\nDescrição do serviço: Atendimento psicológico',
    );
  });
});

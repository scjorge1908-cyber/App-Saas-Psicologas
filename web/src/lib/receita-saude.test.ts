import { describe, expect, it } from 'vitest';
import { arquivosLote, dadosRecibo, linhaLote, motivoFora, nomeArquivoLote, pagadorEhOutraPessoa, textoRecibo } from './receita-saude';

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

describe('arquivo de importação do Carnê-Leão (leiaute do manual Receita Saúde v2.1)', () => {
  const prof = { cpf: '333.333.333-33' }; // fictício
  const pg = (id: string, extra: Partial<typeof base> = {}) => ({ id, ...base, ...extra });

  it('linha com os 16 campos na ordem do manual', () => {
    const campos = linhaLote(pg('a'), prof).split(';');
    expect(campos).toHaveLength(16);
    expect(campos).toEqual([
      '24/10/2026', 'R01.001.001', '255', '180,00', '', 'Atendimento psicologico', 'PF',
      '11111111111', '11111111111', '', '', '', '', 'S', '33333333333', '',
    ]);
  });

  it('outra pessoa paga: CPF do pagador e do paciente beneficiário em colunas próprias', () => {
    const campos = linhaLote(pg('b', { payer_cpf: '22222222222', payer_name: 'Ana Responsável Fictícia' }), prof).split(';');
    expect(campos[7]).toBe('22222222222');
    expect(campos[8]).toBe('11111111111');
  });

  it('valor sem separador de milhar e descrição sem acento, sem ";" e com até 255 caracteres', () => {
    const campos = linhaLote(pg('c', { amount: 1234.5, charge_description: 'Sessão; avaliação\n' + 'x'.repeat(400) }), prof).split(';');
    expect(campos[3]).toBe('1234,50');
    expect(campos[5].startsWith('Sessao avaliacao x')).toBe(true);
    expect(campos[5].length).toBe(255);
  });

  it('deixa de fora quem não tem CPF e explica por quê', () => {
    expect(motivoFora(pg('d', { patient_cpf: null }), prof)).toMatch(/CPF de quem pagou/);
    expect(motivoFora(pg('e', { patient_cpf: null, payer_cpf: '22222222222' }), prof)).toMatch(/CPF do paciente/);
    expect(motivoFora(pg('f'), { cpf: null })).toMatch(/seu CPF no perfil/);
    expect(motivoFora(pg('g'), prof)).toBeNull();
  });

  it('um arquivo por ano, em ordem de data, sem cabeçalho e com linhas terminadas em CRLF', () => {
    const arqs = arquivosLote([
      pg('x', { paid_on: '2026-10-24' }),
      pg('y', { paid_on: '2025-12-30' }),
      pg('z', { paid_on: '2026-10-03', patient_cpf: null }),
      pg('w', { paid_on: '2026-10-10' }),
    ], prof);
    expect(arqs.map((a) => a.ano)).toEqual(['2025', '2026']);
    const a2026 = arqs[1];
    expect(a2026.incluidos).toEqual(['w', 'x']);
    expect(a2026.fora).toEqual([{ id: 'z', motivo: expect.stringMatching(/CPF de quem pagou/) }]);
    const linhas = a2026.conteudo.split('\r\n');
    expect(linhas).toHaveLength(3); // 2 linhas + vazio após o último CRLF
    expect(linhas[0].startsWith('10/10/2026;')).toBe(true);
    expect(linhas[1].startsWith('24/10/2026;')).toBe(true);
  });

  it('para em 1.000 linhas por arquivo', () => {
    const muitos = Array.from({ length: 1002 }, (_, i) => pg(`p${i}`));
    const [arq] = arquivosLote(muitos, prof);
    expect(arq.incluidos).toHaveLength(1000);
    expect(arq.fora).toHaveLength(2);
  });

  it('nome do arquivo', () => {
    expect(nomeArquivoLote('2026')).toBe('receita-saude-2026.csv');
    expect(nomeArquivoLote('2026', 'mariana')).toBe('receita-saude-2026-mariana.csv');
  });
});

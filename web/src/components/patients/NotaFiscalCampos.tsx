// Cartão "Nota fiscal" do cadastro do paciente: quem recebe a nota (tomador) e os dados exigidos para emitir.
// Tomador: o próprio paciente (PF, dados do cadastro), outra pessoa (PF, CPF) ou uma empresa (PJ, CNPJ).
// Com "Emitir nota fiscal" marcado, ficam obrigatórios: nome/razão social, CPF/CNPJ, e-mail e endereço completo.
// Usado no "Editar cadastro" e no cadastro de paciente novo feito pelo horário livre.
import type { Patient } from '../../lib/types';
import { isValidCnpj, isValidCpf, onlyDigits } from '../../lib/format';
import { mascararCnpj, mascararCpf, mascararTelefone } from '../../lib/mascaras';
import { useRef } from 'react';
import { Button, Notice, Spinner, TextField, cx } from '../ui';
import { useCnpjAutomatico } from '../useCnpjAutomatico';
import { EnderecoCampos, enderecoFaltando, enderecoParaPaciente, ENDERECO_VAZIO, type Endereco } from './EnderecoCampos';

export type Tomador = 'paciente' | 'pf' | 'pj';
export type NotaFiscal = { emite: boolean; tomador: Tomador; nome: string; doc: string; im: string; email: string; phone: string; end: Endereco };
/** Dados do próprio paciente usados quando a nota sai no nome dele (e para "repetir o contato"). */
export type DadosPaciente = { full_name: string; cpf: string; email: string; phone: string; end: Endereco };

export const NOTA_VAZIA: NotaFiscal = { emite: false, tomador: 'paciente', nome: '', doc: '', im: '', email: '', phone: '', end: ENDERECO_VAZIO };
const emailOk = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

export function notaDoPaciente(p?: Patient | null): NotaFiscal {
  if (!p) return NOTA_VAZIA;
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const tomador: Tomador = p.payer_tipo === 'pj' ? 'pj' : (p.payer_tipo === 'pf' || p.payer_name || p.nf_tomador === 'outro') ? 'pf' : 'paciente';
  return {
    emite: !!p.nf_tomador, tomador, nome: s(p.payer_name), doc: tomador === 'pj' ? s(p.payer_cnpj) : s(p.payer_cpf), im: s(p.payer_im),
    email: s(p.payer_email), phone: s(p.payer_phone),
    end: { cep: s(p.payer_cep), street: s(p.payer_street), address_number: s(p.payer_number), address_complement: s(p.payer_complement),
      neighborhood: s(p.payer_neighborhood), city: s(p.payer_city), uf: s(p.payer_uf) },
  };
}

/** O que falta para salvar (nome e documento de quem paga) e, com a nota marcada, para emitir. */
export function faltandoNota(n: NotaFiscal, pac: DadosPaciente): string[] {
  const f: string[] = [];
  if (n.tomador === 'paciente') {
    if (!n.emite) return f;
    if (pac.full_name.trim().length < 2) f.push('nome completo do paciente');
    if (!isValidCpf(pac.cpf)) f.push('CPF do paciente');
    if (!emailOk(pac.email)) f.push('e-mail do paciente');
    return [...f, ...enderecoFaltando(pac.end).map((x) => `${x} do paciente`)];
  }
  const pj = n.tomador === 'pj';
  if (n.nome.trim().length < 2) f.push(pj ? 'razão social' : 'nome completo de quem paga');
  if (pj ? !isValidCnpj(n.doc) : !isValidCpf(n.doc)) f.push(pj ? 'CNPJ válido' : 'CPF válido de quem paga');
  if (n.emite) {
    if (!emailOk(n.email)) f.push('e-mail');
    f.push(...enderecoFaltando(n.end));
  }
  return f;
}

/** Colunas do paciente: payer_* só quando outra pessoa ou empresa paga; nf_tomador só com a nota marcada. */
export function notaParaPaciente(n: NotaFiscal): Partial<Patient> {
  const nn = (v: string) => (v.trim() ? v.trim() : null);
  const nota = { nf_tomador: n.emite ? (n.tomador === 'paciente' ? 'paciente' : 'outro') : null } as const;
  if (n.tomador === 'paciente') {
    return { ...nota, payer_tipo: null, payer_name: null, payer_cpf: null, payer_cnpj: null, payer_im: null, payer_email: null, payer_phone: null,
      payer_cep: null, payer_street: null, payer_number: null, payer_complement: null, payer_neighborhood: null, payer_city: null, payer_uf: null };
  }
  const e = enderecoParaPaciente(n.end);
  const pj = n.tomador === 'pj';
  return {
    ...nota, payer_tipo: pj ? 'pj' : 'pf', payer_name: nn(n.nome),
    payer_cpf: pj ? null : nn(onlyDigits(n.doc)), payer_cnpj: pj ? nn(onlyDigits(n.doc)) : null, payer_im: pj ? nn(n.im) : null,
    payer_email: nn(n.email), payer_phone: nn(onlyDigits(n.phone)),
    payer_cep: e.cep, payer_street: e.street, payer_number: e.address_number, payer_complement: e.address_complement,
    payer_neighborhood: e.neighborhood, payer_city: e.city, payer_uf: e.uf,
  };
}


export function NotaFiscalCampos({ valor, onChange, paciente }: { valor: NotaFiscal; onChange: (n: NotaFiscal) => void; paciente: DadosPaciente }) {
  const set = (patch: Partial<NotaFiscal>) => onChange({ ...valor, ...patch });
  // CNPJ digitado → razão social automática (28/10); usa o valor mais recente porque a busca demora
  const ultimo = useRef(valor);
  ultimo.current = valor;
  const cnpjAuto = useCnpjAutomatico(valor.doc, valor.nome, (nome) => onChange({ ...ultimo.current, nome }));
  const pj = valor.tomador === 'pj';
  const falta = faltandoNota(valor, paciente);
  const opcoes: Array<[Tomador, string, string]> = [['paciente', 'O paciente', 'Pessoa física'], ['pf', 'Outra pessoa', 'Pessoa física (CPF)'], ['pj', 'Empresa', 'Pessoa jurídica (CNPJ)']];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-tinta-2">Quem paga e recebe a nota (também usado no recibo do Receita Saúde). Com a nota marcada, os campos com <span className="text-vermelho">*</span> são obrigatórios.</p>
      <div role="radiogroup" aria-label="Nota fiscal no nome de" className="grid grid-cols-3 gap-2">
        {opcoes.map(([v, rot, sub]) => (
          <button key={v} type="button" role="radio" aria-checked={valor.tomador === v}
            onClick={() => set({ tomador: v, doc: v === valor.tomador ? valor.doc : '' })}
            className={cx('flex min-h-14 flex-col items-center justify-center rounded-campo border-[1.5px] px-1.5 py-1 text-center leading-tight',
              valor.tomador === v ? 'border-anil bg-anil-claro text-sobre-anil-claro' : 'border-linha bg-papel text-tinta-2')}>
            <span className="text-[0.9375rem] font-bold">{rot}</span>
            <span className="text-[0.6875rem] font-semibold opacity-80">{sub}</span>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3">
        <input type="checkbox" className="h-5 w-5 accent-anil" checked={valor.emite} onChange={(e) => set({ emite: e.target.checked })} />
        Emitir nota fiscal para este paciente
      </label>

      {valor.tomador === 'paciente' ? (
        <p className="text-sm text-tinta-2">A nota sai no nome do paciente, com o CPF, o e-mail e o endereço do cadastro dele.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={pj ? 'Razão social' : 'Nome completo de quem paga'} required value={valor.nome} onChange={(e) => set({ nome: e.target.value })} className="sm:col-span-2" />
            <TextField label={pj ? 'CNPJ' : 'CPF de quem paga'} required inputMode="numeric" value={valor.doc}
              hint={pj ? (cnpjAuto.buscando ? <span className="inline-flex items-center gap-1.5"><Spinner small /> Buscando o nome da empresa…</span> : cnpjAuto.aviso ?? 'Digite o CNPJ: a razão social vem sozinha.') : undefined}
              onChange={(e) => { const doc = pj ? mascararCnpj(e.target.value) : mascararCpf(e.target.value); set({ doc }); if (pj) void cnpjAuto.aoMudarCnpj(doc); }} />
            {pj
              ? <TextField label="Inscrição municipal" hint="Opcional; alguns municípios pedem." value={valor.im} onChange={(e) => set({ im: e.target.value })} />
              : <TextField label="Celular" inputMode="tel" placeholder="(48) 99999-9999" value={valor.phone} onChange={(e) => set({ phone: mascararTelefone(e.target.value) })} />}
            <TextField label="E-mail (recebe a nota)" required={valor.emite} type="email" value={valor.email} onChange={(e) => set({ email: e.target.value })} />
            {pj && <TextField label="Telefone" inputMode="tel" value={valor.phone} onChange={(e) => set({ phone: mascararTelefone(e.target.value) })} />}
          </div>
          <Button type="button" variant="ghost" size="sm" className="self-start"
            onClick={() => set({ email: paciente.email, phone: mascararTelefone(paciente.phone), end: { ...paciente.end } })}>
            Repetir celular, e-mail e endereço do paciente
          </Button>
          <EnderecoCampos valor={valor.end} onChange={(end) => set({ end })} obrigatorio={valor.emite} />
        </div>
      )}
      {(valor.emite || valor.tomador !== 'paciente') && (falta.length
        ? <Notice tone="ocre">{valor.emite ? 'Para emitir a nota, falta' : 'Falta'}: {falta.join(', ')}.</Notice>
        : valor.emite && <p className="text-sm font-bold text-verde">Dados completos para a nota fiscal{pj ? ' (PJ)' : ' (PF)'}.</p>)}
    </div>
  );
}

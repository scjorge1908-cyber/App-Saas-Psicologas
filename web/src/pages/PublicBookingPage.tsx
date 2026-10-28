// Página pública do agendamento pelo paciente (pedido do Jorge, 28/10/2026). Sem login.
// O paciente vê só os horários que a psicóloga escolheu e que ainda estão livres, escolhe um e
// preenche o cadastro (nascimento, e-mail, CPF, endereço pelo CEP e nota fiscal). O pedido espera a aprovação dela.
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatLongDate, formatTime, isValidCpf, onlyDigits, zonedParts } from '../lib/format';
import { mascararCpf, mascararTelefone } from '../lib/mascaras';
import { FREQUENCIA_LINK } from '../lib/agendamento-link';
import type { BookingFrequency } from '../lib/types';
import { Button, ErrorBox, Loading, Notice, TextField, cx } from '../components/ui';
import { EnderecoCampos, ENDERECO_VAZIO, enderecoParaPaciente, type Endereco } from '../components/patients/EnderecoCampos';
import { NOTA_VAZIA, NotaFiscalCampos, faltandoNota, notaParaPaciente, type NotaFiscal } from '../components/patients/NotaFiscalCampos';

interface Slot { starts_at: string; ends_at: string; location_name: string | null; modality: 'presencial' | 'online' }
interface Info {
  state: 'aberto' | 'usado' | 'expirado' | 'cancelado' | 'invalido';
  status?: 'pendente' | 'aprovado' | 'recusado';
  starts_at?: string;
  professional_name?: string;
  professional_crp?: string | null;
  timezone?: string;
  frequency?: BookingFrequency;
  session_minutes?: number;
  slots?: Slot[];
}

const ERROS: Record<string, string> = {
  ocupado: 'Esse horário acabou de ser ocupado. Escolha outro.',
  horario_invalido: 'Esse horário não está mais disponível. Escolha outro.',
  dados_incompletos: 'Confira os dados: todos são obrigatórios (só o complemento é opcional).',
  usado: 'Este link já foi usado.', expirado: 'Este link expirou.', cancelado: 'Este link foi cancelado.', invalido: 'Link inválido.',
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PublicBookingPage() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [celular, setCelular] = useState('');
  const [nasc, setNasc] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [end, setEnd] = useState<Endereco>(ENDERECO_VAZIO);
  const [nota, setNota] = useState<NotaFiscal>(NOTA_VAZIA);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function carregar() {
    supabase.rpc('get_booking', { p_token: token }).then(({ data, error }) => {
      if (error) setErroCarga('Não foi possível carregar o link. Tente de novo em instantes.');
      else setInfo(data as Info);
    });
  }
  useEffect(carregar, [token]);

  const tz = info?.timezone ?? 'America/Sao_Paulo';
  const porDia = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of info?.slots ?? []) { const d = zonedParts(s.starts_at, tz).date; m.set(d, [...(m.get(d) ?? []), s]); }
    return [...m.entries()];
  }, [info, tz]);
  const slot = (info?.slots ?? []).find((s) => s.starts_at === escolhido) ?? null;
  const paciente = { full_name: nome, cpf, email, phone: celular, end };

  async function enviar() {
    setErro(null);
    const falta: string[] = [];
    if (!slot) falta.push('o horário');
    if (nome.trim().length < 3) falta.push('nome completo');
    const tel = onlyDigits(celular);
    if (tel.length < 10 || tel.length > 11) falta.push('celular com DDD');
    if (!nasc || nasc > new Date().toISOString().slice(0, 10)) falta.push('data de nascimento');
    if (!EMAIL.test(email.trim())) falta.push('e-mail');
    if (!isValidCpf(cpf)) falta.push('CPF válido');
    if (onlyDigits(end.cep).length !== 8) falta.push('CEP');
    if (!end.street.trim()) falta.push('rua');
    if (!end.address_number.trim()) falta.push('número');
    if (!end.neighborhood.trim()) falta.push('bairro');
    if (!end.city.trim()) falta.push('cidade');
    if (!/^[A-Za-z]{2}$/.test(end.uf.trim())) falta.push('UF');
    const fn = faltandoNota(nota, paciente);
    if (fn.length) falta.push(`nota fiscal (${fn.join(', ')})`);
    if (falta.length) return setErro(`Falta: ${falta.join(', ')}.`);
    setBusy(true);
    const dados: Record<string, string | null> = {
      full_name: nome.trim(), phone: tel, cpf: onlyDigits(cpf), email: email.trim(), birth_date: nasc,
      ...enderecoParaPaciente(end), ...(notaParaPaciente(nota) as Record<string, string | null>),
    };
    const { data, error } = await supabase.rpc('request_booking', { p_token: token, p_starts_at: slot!.starts_at, p_data: dados });
    setBusy(false);
    if (error) return setErro('Não foi possível enviar. Tente de novo em instantes.');
    const r = data as { ok: boolean; state: string; starts_at?: string };
    if (!r.ok) {
      setErro(ERROS[r.state] ?? 'Não foi possível enviar.');
      if (r.state === 'ocupado' || r.state === 'horario_invalido') { setEscolhido(null); carregar(); }
      return;
    }
    setInfo((i) => ({ ...(i as Info), state: 'usado', status: 'pendente', starts_at: r.starts_at }));
    window.scrollTo({ top: 0 });
  }

  const quando = (iso: string) => `${formatLongDate(zonedParts(iso, tz).date)}, às ${formatTime(iso, tz)}`;

  return (
    <div className="flex min-h-dvh items-start justify-center px-4 py-8">
      <main className="flex w-full max-w-lg flex-col gap-5 rounded-2xl border border-linha bg-papel p-5 sm:p-6">
        {!info && !erroCarga && <Loading />}
        {erroCarga && <p role="alert" className="text-vermelho">{erroCarga}</p>}
        {info && info.state !== 'aberto' && (
          <div>
            <h1 className="text-[1.625rem] font-bold leading-tight">
              {info.state === 'usado' && (info.status === 'aprovado' ? 'Horário confirmado' : info.status === 'recusado' ? 'Pedido não aprovado' : 'Pedido enviado')}
              {info.state === 'expirado' && 'Este link expirou'}
              {info.state === 'cancelado' && 'Este link foi cancelado'}
              {info.state === 'invalido' && 'Link inválido'}
            </h1>
            {info.state === 'usado' && info.starts_at && (
              <p className="mt-3 border-l-4 border-anil pl-4 text-lg font-bold first-letter:uppercase">{quando(info.starts_at)}</p>
            )}
            <p className="mt-3 text-tinta-2">
              {info.state === 'usado' && info.status === 'pendente' && `Obrigado! ${info.professional_name ?? 'A psicóloga'} vai conferir e confirmar o horário com você.`}
              {info.state === 'usado' && info.status === 'aprovado' && 'Seu horário está na agenda. Até lá!'}
              {info.state === 'usado' && info.status === 'recusado' && 'Fale com a psicóloga para combinar outro horário.'}
              {(info.state === 'expirado' || info.state === 'cancelado' || info.state === 'invalido') && 'Peça um link novo para a sua psicóloga.'}
            </p>
          </div>
        )}
        {info?.state === 'aberto' && (
          <>
            <header>
              <h1 className="text-[1.625rem] font-bold leading-tight">Escolha seu horário</h1>
              <p className="mt-1 text-tinta-2">
                Com {info.professional_name}{info.professional_crp ? `, psicóloga CRP ${info.professional_crp}` : ''}.
                {info.frequency && ` ${FREQUENCIA_LINK[info.frequency]}`}{info.session_minutes ? ` · ${info.session_minutes} min` : ''}.
              </p>
            </header>
            {erro && <ErrorBox>{erro}</ErrorBox>}
            {porDia.length === 0 && <Notice tone="ocre">Os horários deste link já foram ocupados. Peça novos horários para a sua psicóloga.</Notice>}
            {porDia.length > 0 && (
              <section aria-label="Horários disponíveis" className="flex flex-col gap-3">
                {porDia.map(([d, lista]) => (
                  <div key={d} className="flex flex-col gap-1.5">
                    <h2 className="font-extrabold first-letter:uppercase">{formatLongDate(d)}</h2>
                    <div className="grid grid-cols-3 gap-1.5">
                      {lista.map((s) => {
                        const on = escolhido === s.starts_at;
                        return (
                          <button key={s.starts_at} type="button" aria-pressed={on} onClick={() => setEscolhido(s.starts_at)}
                            aria-label={`${formatLongDate(d)} às ${formatTime(s.starts_at, tz)}${s.modality === 'online' ? ', on-line' : ''}`}
                            className={cx('flex min-h-12 flex-col items-center justify-center rounded-campo border px-1 leading-tight', on ? 'btn-degrade border-transparent' : 'border-ag-livre-borda/50 bg-ag-livre-fundo text-ag-livre')}>
                            <span className="num text-[1.0625rem] font-extrabold">{formatTime(s.starts_at, tz)}</span>
                            <span className="text-[0.6875rem] opacity-80">{s.modality === 'online' ? 'On-line' : 'Presencial'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            )}
            {slot && <p className="num rounded-campo bg-anil-claro/60 px-3 py-2 font-bold text-sobre-anil-claro first-letter:uppercase">{quando(slot.starts_at)}{slot.location_name ? ` · ${slot.location_name}` : ''}</p>}

            {porDia.length > 0 && (
              <section aria-label="Seu cadastro" className="flex flex-col gap-3">
                <h2 className="text-[1.125rem] font-bold">Seu cadastro</h2>
                <TextField label="Nome completo" required autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} />
                <TextField label="Celular (WhatsApp)" required inputMode="tel" autoComplete="tel" placeholder="(48) 99999-9999" value={celular} onChange={(e) => setCelular(mascararTelefone(e.target.value))} />
                <TextField label="Data de nascimento" required type="date" value={nasc} onChange={(e) => setNasc(e.target.value)} />
                <TextField label="E-mail" required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <TextField label="CPF" required inputMode="numeric" value={cpf} onChange={(e) => setCpf(mascararCpf(e.target.value))} />
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-bold text-tinta-2">Endereço</legend>
                  <EnderecoCampos valor={end} onChange={setEnd} obrigatorio />
                </fieldset>
                <NotaFiscalCampos valor={nota} onChange={setNota} paciente={paciente} />
                <Button busy={busy} onClick={enviar} className="w-full">Enviar pedido</Button>
                <p className="text-[0.8125rem] text-tinta-3">Seus dados vão só para a sua psicóloga. O horário fica reservado até ela confirmar.</p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatLongDate, formatTime, zonedParts } from '../lib/format';
import { Button, Loading } from '../components/ui';

interface Info {
  state: 'pendente' | 'confirmado' | 'cancelado' | 'expirado' | 'invalido';
  patient_first_name?: string;
  professional_name?: string;
  professional_crp?: string | null;
  starts_at?: string;
  ends_at?: string;
  timezone?: string;
  modality?: 'presencial' | 'online';
  cancellation_hours?: number;
}

/**
 * Página pública que o paciente abre pelo link. Mostra apenas data, horário,
 * nome e CRP da profissional e o primeiro nome do paciente. Sem login.
 */
export function PublicConfirmPage() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState<'confirmar' | 'cancelar' | null>(null);
  const [askCancel, setAskCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('get_confirmation', { p_token: token }).then(({ data, error }) => {
      if (error) setError('Não foi possível carregar o link. Tente de novo em instantes.');
      else setInfo(data as Info);
    });
  }, [token]);

  async function respond(action: 'confirmar' | 'cancelar') {
    setBusy(action); setError(null);
    const { data, error } = await supabase.rpc('respond_confirmation', { p_token: token, p_action: action });
    setBusy(null); setAskCancel(false);
    if (error) return setError('Não foi possível registrar sua resposta. Tente de novo.');
    setInfo((i) => ({ ...(i as Info), state: (data as { state: Info['state'] }).state }));
  }

  const tz = info?.timezone ?? 'America/Sao_Paulo';
  const late = info?.starts_at && info.cancellation_hours != null
    && new Date(info.starts_at).getTime() - Date.now() < info.cancellation_hours * 3600e3;

  return (
    <div className="flex min-h-dvh items-start justify-center px-4 py-10 sm:items-center">
      <main className="w-full max-w-md rounded-2xl border border-linha bg-papel p-6">
        {!info && !error && <Loading />}
        {error && <p role="alert" className="text-vermelho">{error}</p>}
        {info && (info.state === 'invalido' ? (
          <>
            <h1 className="text-2xl font-bold">Link inválido</h1>
            <p className="mt-2 text-tinta-2">Este link não existe ou foi substituído porque a sessão foi remarcada. Fale com sua psicóloga para receber o link atualizado.</p>
          </>
        ) : (
          <>
            <p className="text-tinta-2">Olá, {info.patient_first_name}.</p>
            <h1 className="mt-1 text-[26px] font-bold leading-tight">
              {info.state === 'confirmado' && 'Presença confirmada'}
              {info.state === 'cancelado' && 'Sessão cancelada'}
              {info.state === 'expirado' && 'Este link expirou'}
              {info.state === 'pendente' && 'Confirme sua sessão'}
            </h1>
            {info.starts_at && (
              <div className="my-5 border-l-4 border-anil pl-4">
                <p className="text-lg font-bold first-letter:uppercase">{formatLongDate(zonedParts(info.starts_at, tz).date)}</p>
                <p className="num text-xl">{formatTime(info.starts_at, tz)} às {formatTime(info.ends_at!, tz)}</p>
                <p className="text-tinta-2">{info.modality === 'online' ? 'Sessão online' : 'Sessão presencial'}</p>
              </div>
            )}
            <p className="text-tinta-2">Com {info.professional_name}{info.professional_crp ? `, psicóloga CRP ${info.professional_crp}` : ''}.</p>

            {info.state === 'pendente' && !askCancel && (
              <div className="mt-6 flex flex-col gap-2">
                <Button busy={busy === 'confirmar'} onClick={() => respond('confirmar')}>Confirmar presença</Button>
                <Button variant="secondary" onClick={() => setAskCancel(true)}>Não poderei ir</Button>
              </div>
            )}
            {info.state === 'confirmado' && !askCancel && (
              <div className="mt-6">
                <p className="text-tinta-2">Obrigado. Se surgir um imprevisto, você ainda pode avisar por aqui.</p>
                <Button className="mt-3" variant="ghost" onClick={() => setAskCancel(true)}>Não poderei ir</Button>
              </div>
            )}
            {askCancel && (
              <div className="mt-6 flex flex-col gap-2 rounded-lg bg-gesso p-4">
                <p className="font-bold">Cancelar esta sessão?</p>
                {late && <p className="text-sm text-ocre">Faltam menos de {info.cancellation_hours} horas para a sessão. Verifique com sua psicóloga a política de cancelamento combinada.</p>}
                <Button variant="danger" busy={busy === 'cancelar'} onClick={() => respond('cancelar')}>Sim, cancelar sessão</Button>
                <Button variant="secondary" onClick={() => setAskCancel(false)}>Voltar</Button>
              </div>
            )}
            {info.state === 'cancelado' && <p className="mt-6 text-tinta-2">Para remarcar, fale com sua psicóloga.</p>}
            {info.state === 'expirado' && <p className="mt-6 text-tinta-2">O horário da sessão já passou ou o link não é mais válido.</p>}
          </>
        ))}
      </main>
    </div>
  );
}

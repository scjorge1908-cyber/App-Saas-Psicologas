// Botão do WhatsApp na agenda: abre um cartão com as mensagens prontas da sessão.
// Escolher uma mensagem mostra o texto (dá para ajustar) e "Abrir no WhatsApp" — o envio é sempre da profissional.
// Também leva para Mover a sessão, que fica disponível a qualquer momento enquanto a sessão está ativa.
import { useState, type ReactNode } from 'react';
import type { AgendaItem } from '../../lib/types';
import * as api from '../../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../lib/errors';
import { firstName, zonedParts } from '../../lib/format';
import { ausenciaText, conversaText, whatsappLink } from '../../lib/messages';
import { abrirExterno } from '../../lib/abrir-externo';
import { FLAG_WHATS_ENVIADO, gravarFlag } from '../../lib/ajuda';
import { useProfile } from '../../auth/AuthProvider';
import { Button, Dialog, Textarea, useToast } from '../ui';
import { IconCake, IconCheck, IconSwap, IconWhats } from '../icons';
import { openReminder } from './AppointmentSheet';

type Opcao = 'lembrete' | 'ausencia' | 'aniversario' | 'livre';

export function WhatsAppCard({ item, onClose, onMover }: { item: AgendaItem | null; onClose: () => void; onMover: (item: AgendaItem) => void }) {
  const { profile, tz } = useProfile();
  const toast = useToast();
  const qc = useQueryClient();
  const [opcao, setOpcao] = useState<Opcao | null>(null);
  const [texto, setTexto] = useState('');
  const [busy, setBusy] = useState(false);
  const [agora] = useState(() => Date.now()); // o cartão é recriado a cada paciente (key no AgendaPage)
  if (!item) return null;

  const nome = item.patient_social_name || item.patient_name;
  const pro = `${profile?.full_name ?? ''}${profile?.crp ? `, CRP ${profile.crp}` : ''}`;
  const ativa = item.status === 'agendado' || item.status === 'confirmado';
  const futura = new Date(item.starts_at).getTime() > agora;
  const nasc = item.patient_birth_date;
  const aniversario = !!nasc && nasc.slice(5) === zonedParts(item.starts_at, tz).date.slice(5);

  /** Sessão a que o texto se refere: esta, se ainda vai acontecer; senão, a próxima agendada do paciente. */
  async function proximaSessao(): Promise<AgendaItem | null> {
    if (ativa && futura) return item;
    const lista = await api.listPatientAgenda(item!.patient_id);
    return lista.filter((a) => (a.status === 'agendado' || a.status === 'confirmado') && new Date(a.starts_at).getTime() > Date.now())
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;
  }

  async function escolher(o: Opcao) {
    if (o === 'lembrete' || o === 'ausencia') {
      setBusy(true);
      try {
        const alvo = await proximaSessao();
        if (o === 'lembrete') {
          if (!alvo) { toast('Este paciente não tem próxima sessão agendada para confirmar. Agende antes ou use a mensagem livre.', 'erro'); return; }
          setTexto((await openReminder(alvo, tz, pro)).text);
          void qc.invalidateQueries({ queryKey: ['agenda'] }); // situação passa a "Aguardando confirmação"
        } else setTexto(ausenciaText({ patientName: nome, startsAt: (alvo ?? item!).starts_at, tz, professionalName: pro }));
      } catch (e) { toast(errorMessage(e), 'erro'); return; } finally { setBusy(false); }
    } else if (o === 'aniversario') setTexto(`Feliz aniversário, ${firstName(nome)}! Desejo um dia muito especial.\n${profile?.full_name ?? ''}`);
    else setTexto(conversaText({ patientName: nome, professionalName: profile?.full_name ?? '' }));
    setOpcao(o);
  }

  const wa = whatsappLink(item.patient_phone, texto);
  const opcoes: Array<{ o: Opcao; titulo: string; sub: string; icone: ReactNode; mostrar: boolean }> = [
    // Os 3 modelos de texto aparecem sempre (pedido do Jorge, 27/10); sessão que já passou usa a próxima agendada
    { o: 'lembrete', titulo: 'Confirmar presença', sub: ativa && futura ? 'Lembrete com link para o paciente confirmar ou cancelar' : 'Lembrete da próxima sessão, com link de confirmação', icone: <IconCheck className="size-5" />, mostrar: true },
    { o: 'ausencia', titulo: 'Avisar que não vou atender', sub: 'Texto pronto informando que neste dia você não atende', icone: <IconWhats className="size-5" />, mostrar: true },
    { o: 'aniversario', titulo: 'Parabéns pelo aniversário', sub: 'Hoje é aniversário do paciente', icone: <IconCake className="size-5" />, mostrar: aniversario },
    { o: 'livre', titulo: 'Mensagem livre', sub: 'Abre a conversa só com a saudação', icone: <IconWhats className="size-5" />, mostrar: true },
  ];

  return (
    <Dialog open={!!item} onClose={onClose} title={`WhatsApp · ${firstName(nome)}`}
      footer={opcao
        ? <><Button variant="ghost" onClick={() => setOpcao(null)}>Voltar</Button>
            {wa
              ? <Button onClick={() => { gravarFlag(FLAG_WHATS_ENVIADO); abrirExterno(wa); onClose(); }}><IconWhats /> Abrir no WhatsApp</Button>
              : <Button onClick={async () => { await navigator.clipboard.writeText(texto); toast('Mensagem copiada'); }}>Copiar mensagem</Button>}</>
        : <Button variant="ghost" onClick={onClose}>Fechar</Button>}>
      {!item.patient_phone && <p className="mb-3 text-sm text-ocre">Paciente sem celular cadastrado: dá para copiar a mensagem e enviar por outro meio.</p>}
      {!opcao ? (
        <div className="flex flex-col gap-2">
          {opcoes.filter((x) => x.mostrar).map((x) => (
            <button key={x.o} disabled={busy} onClick={() => escolher(x.o)}
              className="pressionar flex min-h-14 w-full items-center gap-3 rounded-campo border border-linha bg-papel px-3 py-2 text-left hover:bg-afundado disabled:opacity-60">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-livre-fundo text-livre">{x.icone}</span>
              <span className="min-w-0 flex-1"><span className="block font-bold">{x.titulo}</span><span className="block text-[0.8125rem] text-tinta-3">{x.sub}</span></span>
            </button>
          ))}
          {ativa && (
            <button onClick={() => { onClose(); onMover(item); }}
              className="pressionar flex min-h-14 w-full items-center gap-3 rounded-campo border border-linha bg-papel px-3 py-2 text-left hover:bg-afundado">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ag-pac-fundo text-ag-pac"><IconSwap className="size-5" /></span>
              <span className="min-w-0 flex-1"><span className="block font-bold">Mover a sessão</span><span className="block text-[0.8125rem] text-tinta-3">Trocar dia, horário ou sala</span></span>
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor="wa-texto" className="text-sm text-tinta-2">Mensagem (pode ajustar antes de abrir o WhatsApp):</label>
          <Textarea id="wa-texto" rows={7} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
      )}
    </Dialog>
  );
}

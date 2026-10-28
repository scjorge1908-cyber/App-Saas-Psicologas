// Agendamento pelo paciente (pedido do Jorge, 28/10/2026).
// • GerarLinkDialog: a psicóloga escolhe os horários LIVRES que quer oferecer, a frequência e o valor, e gera
//   um link para UMA pessoa (enviado pelo WhatsApp).
// • PedidosDialog: pedidos que chegaram pelo link (aprovar ou recusar) e links ainda abertos (cancelar).
//   Só ao aprovar o paciente e as sessões entram na agenda.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { BookingFrequency, BookingLink, BookingRequest, BookingSlot, Location } from '../../lib/types';
import { useProfile } from '../../auth/AuthProvider';
import { horariosLivres } from '../../lib/horarios';
import { addDays, formatCpf, formatLongDate, formatPhone, formatTime, money, parseMoney, todayIn, weekday, zonedParts, zonedToUtc } from '../../lib/format';
import { FREQUENCIA_LINK, linkAgendamentoUrl, pacienteDoPedido, pedidosComoOcupados, textoConviteLink } from '../../lib/agendamento-link';
import { publicOrigin } from '../../lib/supabase';
import { abrirExterno } from '../../lib/abrir-externo';
import { errorMessage } from '../../lib/errors';
import { Button, Dialog, ErrorBox, Field, Loading, Notice, Select, TextField, cx, useConfirm, useToast } from '../ui';
import { IconWhats } from '../icons';

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const nomeDia = (d: string) => { const n = formatLongDate(d).split(',')[0].replace('-feira', ''); return n[0].toUpperCase() + n.slice(1); };

/** Pedidos e links (compartilhado pela Agenda e pela janela). */
export function useLinksPaciente() {
  const pedidos = useQuery({ queryKey: ['booking-requests'], queryFn: api.listBookingRequests });
  const links = useQuery({ queryKey: ['booking-links'], queryFn: api.listBookingLinks });
  const pendentes = (pedidos.data ?? []).filter((r) => r.status === 'pendente');
  return { pedidos, links, pendentes };
}

type Oferta = BookingSlot & { chave: string; date: string; time: string; sala: Location | null; minutes: number };

export function GerarLinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, tz } = useProfile();
  const qc = useQueryClient();
  const toast = useToast();
  const hoje = todayIn(tz);
  const [semanas, setSemanas] = useState(2);
  const fim = addDays(hoje, 7 * semanas);
  const fromIso = zonedToUtc(hoje, '00:00', tz); const toIso = zonedToUtc(fim, '00:00', tz);
  const agenda = useQuery({ queryKey: ['agenda', fromIso, toIso], queryFn: () => api.listAgenda(fromIso, toIso), enabled: open });
  const horas = useQuery({ queryKey: ['working-hours'], queryFn: api.listWorkingHours, enabled: open });
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations, enabled: open });
  const bloqueios = useQuery({ queryKey: ['blocks'], queryFn: api.listBlocks, enabled: open });
  const { pedidos } = useLinksPaciente();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [freq, setFreq] = useState<BookingFrequency>('semanal');
  const [qtd, setQtd] = useState('12');
  const [valor, setValor] = useState(profile?.default_price != null ? String(profile.default_price).replace('.', ',') : '');
  const [label, setLabel] = useState('');
  const [dias, setDias] = useState('7');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gerado, setGerado] = useState<string | null>(null);

  // Horários LIVRES dos próximos dias (os pedidos pendentes já contam como ocupados)
  const ofertas = useMemo<Oferta[]>(() => {
    if (!open || !profile || !agenda.data || !horas.data || !locais.data) return [];
    const itens = [...agenda.data, ...pedidosComoOcupados(pedidos.data)];
    const out: Oferta[] = [];
    for (let d = hoje; d < fim; d = addDays(d, 1)) {
      const doDia = itens.filter((it) => zonedParts(it.starts_at, tz).date === d);
      for (const l of horariosLivres({ date: d, hours: horas.data.filter((h) => h.weekday === weekday(d)), locations: locais.data, items: doDia,
        sessionMinutes: profile.session_minutes, bufferMinutes: profile.buffer_minutes, tz, bloqueios: bloqueios.data })) {
        const starts = zonedToUtc(d, l.time, tz);
        const minutes = l.minutes ?? profile.session_minutes;
        out.push({ chave: `${d} ${l.time} ${l.location?.id ?? ''}`, date: d, time: l.time, sala: l.location, minutes,
          starts_at: starts, ends_at: new Date(new Date(starts).getTime() + minutes * 60000).toISOString(), location_id: l.location?.id ?? null });
      }
    }
    return out;
  }, [open, profile, agenda.data, horas.data, locais.data, bloqueios.data, pedidos.data, hoje, fim, tz]);
  const porDia = useMemo(() => {
    const m = new Map<string, Oferta[]>();
    for (const o of ofertas) m.set(o.date, [...(m.get(o.date) ?? []), o]);
    return [...m.entries()];
  }, [ofertas]);
  const escolhidas = ofertas.filter((o) => sel.has(o.chave));
  const alterna = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const alternaDia = (lista: Oferta[]) => setSel((s) => {
    const n = new Set(s); const todos = lista.every((o) => n.has(o.chave));
    for (const o of lista) { if (todos) n.delete(o.chave); else n.add(o.chave); }
    return n;
  });

  function fechar() { setSel(new Set()); setGerado(null); setErro(null); setLabel(''); onClose(); }

  async function gerar() {
    setErro(null);
    if (escolhidas.length === 0) return setErro('Escolha pelo menos um horário livre.');
    if (escolhidas.length > 60) return setErro('No máximo 60 horários por link.');
    const pr = valor.trim() ? parseMoney(valor) : null;
    if (valor.trim() && pr === null) return setErro('Valor inválido. Exemplo: 150,00');
    const n = Number(qtd);
    if (freq !== 'nao' && (!n || n < 1 || n > 104)) return setErro('Quantidade de sessões entre 1 e 104.');
    setBusy(true);
    try {
      const token = await api.createBookingLink({
        slots: escolhidas.map(({ starts_at, ends_at, location_id }) => ({ starts_at, ends_at, location_id })),
        frequency: freq, occurrences: freq === 'nao' ? null : n, minutes: escolhidas[0].minutes, price: pr, label: label.trim() || null, days: Number(dias),
      });
      setGerado(linkAgendamentoUrl(publicOrigin(), token));
      await qc.invalidateQueries({ queryKey: ['booking-links'] });
    } catch (e) { setErro(errorMessage(e)); } finally { setBusy(false); }
  }

  const carregando = agenda.isLoading || horas.isLoading || locais.isLoading;
  return (
    <Dialog open={open} onClose={fechar} wide title={gerado ? 'Link pronto' : 'Link para o paciente agendar'} footer={gerado ? (
      <Button onClick={fechar} className="w-full">Concluir</Button>
    ) : <>
      <Button variant="secondary" onClick={fechar}>Voltar</Button>
      <Button busy={busy} onClick={gerar}>Gerar link ({escolhidas.length})</Button>
    </>}>
      {gerado ? (
        <div className="flex flex-col gap-3">
          <Notice>
            Envie este link para <b>uma pessoa</b>. Ela vai ver só os {escolhidas.length === 1 ? 'horário escolhido' : `${escolhidas.length} horários escolhidos`} que ainda estiverem livres,
            escolher um e preencher o cadastro. O pedido chega para você <b>aprovar</b> antes de entrar na agenda.
          </Notice>
          <p className="break-all rounded-campo border border-linha bg-afundado px-3 py-2 font-mono text-[0.8125rem]">{gerado}</p>
          <Button onClick={() => abrirExterno(`https://wa.me/?text=${encodeURIComponent(textoConviteLink(gerado, profile?.full_name ?? ''))}`)}
            className="w-full bg-[#25D366]! text-[#0B3B1E]!"><IconWhats className="size-5" /> Enviar pelo WhatsApp</Button>
          <Button variant="secondary" className="w-full" onClick={async () => { try { await navigator.clipboard.writeText(gerado); toast('Link copiado'); } catch { toast('Não deu para copiar. Selecione o link e copie.', 'erro'); } }}>Copiar link</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {erro && <ErrorBox>{erro}</ErrorBox>}
          <p className="text-[0.9375rem] text-tinta-2">Toque nos horários livres que o paciente poderá escolher. Só eles aparecem no link.</p>
          {carregando && <Loading />}
          {!carregando && porDia.length === 0 && <Notice tone="ocre">Nenhum horário livre nos próximos {7 * semanas} dias. Crie horários na Grade ou veja mais semanas.</Notice>}
          <div className="flex flex-col gap-3">
            {porDia.map(([d, lista]) => (
              <section key={d} aria-label={`${nomeDia(d)} ${ddmm(d)}`} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold">{nomeDia(d)} <span className="num">{ddmm(d)}</span></h3>
                  <button type="button" onClick={() => alternaDia(lista)} className="ml-auto min-h-9 px-1 text-[0.8125rem] font-bold text-anil-escuro underline-offset-2 hover:underline">
                    {lista.every((o) => sel.has(o.chave)) ? 'Tirar o dia' : 'Todos do dia'}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {lista.map((o) => {
                    const on = sel.has(o.chave);
                    return (
                      <button key={o.chave} type="button" aria-pressed={on} onClick={() => alterna(o.chave)}
                        aria-label={`${nomeDia(d)} ${ddmm(d)} às ${o.time}${o.sala ? `, ${o.sala.name}` : ''}`}
                        className={cx('flex min-h-12 flex-col items-center justify-center rounded-campo border px-1 leading-tight', on ? 'btn-degrade border-transparent' : 'border-ag-livre-borda/50 bg-ag-livre-fundo text-ag-livre')}>
                        <span className="num text-[1rem] font-extrabold">{o.time}</span>
                        {o.sala && <span className="w-full truncate text-center text-[0.6875rem] opacity-80">{o.sala.name}</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          {semanas < 8 && <Button variant="ghost" onClick={() => setSemanas((s) => s + 2)} className="self-start">Ver mais 2 semanas</Button>}

          <div className="cartao flex flex-col gap-3 p-3">
            <TextField label="Para quem (opcional)" maxLength={80} placeholder="Ex.: Maria, indicação da Dra. Ana" value={label} onChange={(e) => setLabel(e.target.value)} hint="Só você vê. Ajuda a reconhecer o pedido." />
            <Field label="Frequência" required>{(id) => (
              <Select id={id} value={freq} onChange={(e) => setFreq(e.target.value as BookingFrequency)}>
                {(Object.keys(FREQUENCIA_LINK) as BookingFrequency[]).map((f) => <option key={f} value={f}>{FREQUENCIA_LINK[f]}</option>)}
              </Select>
            )}</Field>
            {freq !== 'nao' && <TextField label="Quantidade de sessões" type="number" min={1} max={104} value={qtd} onChange={(e) => setQtd(e.target.value)} />}
            <TextField label="Valor da sessão (R$)" inputMode="decimal" placeholder="150,00" value={valor} onChange={(e) => setValor(e.target.value)} />
            <Field label="O link vale por">{(id) => (
              <Select id={id} value={dias} onChange={(e) => setDias(e.target.value)}>
                {['3', '7', '15', '30'].map((n) => <option key={n} value={n}>{n} dias</option>)}
              </Select>
            )}</Field>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function PedidosDialog({ open, onClose, inicial }: { open: boolean; onClose: () => void; inicial?: string | null }) {
  const { pedidos, links, pendentes } = useLinksPaciente();
  const qc = useQueryClient();
  const confirmar = useConfirm();
  const toast = useToast();
  const [ver, setVer] = useState<string | null>(null);
  const atual = pendentes.find((r) => r.id === (ver ?? inicial)) ?? null;
  const abertos = (links.data ?? []).filter((l) => !l.canceled_at && new Date(l.expires_at).getTime() > Date.now()
    && !(pedidos.data ?? []).some((r) => r.link_id === l.id));

  async function cancelar(l: BookingLink) {
    if (!(await confirmar({ title: 'Cancelar este link?', body: 'Quem tiver o link não vai mais conseguir escolher horário.', confirmLabel: 'Cancelar link', danger: true }))) return;
    try { await api.cancelBookingLink(l.id); await qc.invalidateQueries({ queryKey: ['booking-links'] }); toast('Link cancelado'); } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <>
      <Dialog open={open && !atual} onClose={onClose} title="Pedidos pelo link" footer={<Button onClick={onClose} className="w-full">Fechar</Button>}>
        <div className="flex flex-col gap-4">
          {(pedidos.isLoading || links.isLoading) && <Loading />}
          <section className="flex flex-col gap-2" aria-label="Pedidos para aprovar">
            <h3 className="font-extrabold">Para aprovar</h3>
            {pendentes.length === 0 && <p className="text-[0.9375rem] text-tinta-3">Nenhum pedido esperando.</p>}
            {pendentes.map((r) => <LinhaPedido key={r.id} r={r} onVer={() => setVer(r.id)} />)}
          </section>
          <section className="flex flex-col gap-2" aria-label="Links abertos">
            <h3 className="font-extrabold">Links abertos</h3>
            {abertos.length === 0 && <p className="text-[0.9375rem] text-tinta-3">Nenhum link aberto.</p>}
            {abertos.map((l) => (
              <div key={l.id} className="flex items-center gap-2 rounded-campo border border-linha px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{l.label || 'Sem nome'}</span>
                  <span className="block text-[0.8125rem] text-tinta-3">{l.slots.length} {l.slots.length === 1 ? 'horário' : 'horários'} · {FREQUENCIA_LINK[l.frequency]} · vale até {ddmm(l.expires_at.slice(0, 10))}</span>
                </span>
                <Button size="sm" variant="ghost" className="text-vermelho" onClick={() => cancelar(l)}>Cancelar</Button>
              </div>
            ))}
          </section>
        </div>
      </Dialog>
      <AprovarPedidoDialog pedido={atual} link={(links.data ?? []).find((l) => l.id === atual?.link_id) ?? null} onClose={() => { setVer(null); if (inicial) onClose(); }} />
    </>
  );
}

function LinhaPedido({ r, onVer }: { r: BookingRequest; onVer: () => void }) {
  const { tz } = useProfile();
  const d = zonedParts(r.starts_at, tz).date;
  return (
    <button type="button" onClick={onVer} className="pressionar flex min-h-14 items-center gap-2 rounded-campo border-l-4 border-l-ocre-forte bg-ocre-fundo/50 px-3 py-2 text-left">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{r.patient_data.full_name}</span>
        <span className="num block text-[0.8125rem] text-tinta-2">{nomeDia(d)} {ddmm(d)} às {formatTime(r.starts_at, tz)}</span>
      </span>
      <span className="rounded-full bg-ocre-forte/20 px-2.5 py-1 text-[0.8125rem] font-bold text-ocre">Ver pedido</span>
    </button>
  );
}

/** Aprovar: cria o paciente e as sessões; recusar: o horário volta a ficar livre. */
export function AprovarPedidoDialog({ pedido, link, onClose }: { pedido: BookingRequest | null; link: BookingLink | null; onClose: () => void }) {
  const { tz } = useProfile();
  const qc = useQueryClient();
  const toast = useToast();
  const confirmar = useConfirm();
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations, enabled: !!pedido });
  const [busy, setBusy] = useState<'aprovar' | 'recusar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const atualizar = () => Promise.all(['booking-requests', 'booking-links', 'agenda', 'patients'].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  if (!pedido) return null;
  const sala = (locais.data ?? []).find((l) => l.id === pedido.location_id) ?? null;
  const d = zonedParts(pedido.starts_at, tz).date;
  const hora = formatTime(pedido.starts_at, tz);
  const minutos = Math.round((new Date(pedido.ends_at).getTime() - new Date(pedido.starts_at).getTime()) / 60000);
  const pd = pedido.patient_data;
  const freq = link?.frequency ?? 'nao';

  async function aprovar() {
    if (!pedido) return;
    setErro(null); setBusy('aprovar');
    let pacienteId: string | null = null;
    try {
      const modality = sala?.modality ?? 'presencial';
      const p = await api.savePatient(pacienteDoPedido(pedido, { price: link?.price ?? null, modality }));
      pacienteId = p.id;
      let conflitos = 0;
      if (freq === 'nao') {
        await api.createAppointment({ patient_id: p.id, starts_at: pedido.starts_at, ends_at: pedido.ends_at, price: link?.price ?? null, modality, location_id: pedido.location_id });
      } else {
        const r = await api.createSeries({ patientId: p.id, frequency: freq, startDate: d, startTime: hora, duration: minutos, untilDate: null,
          occurrences: link?.occurrences ?? 12, price: link?.price ?? null, modality, locationId: pedido.location_id });
        if (r.created.length === 0) throw new Error('O horário pedido já está ocupado na agenda. Recuse o pedido ou mova a outra sessão.');
        conflitos = r.conflicts.length;
      }
      await api.decideBookingRequest(pedido.id, 'aprovado', p.id);
      await atualizar();
      toast(conflitos ? `Aprovado. ${conflitos} ${conflitos === 1 ? 'data ficou' : 'datas ficaram'} de fora por já estarem ocupadas.` : 'Pedido aprovado: paciente e sessões na agenda');
      onClose();
    } catch (e) {
      // O paciente nasce pelo agendamento: se a sessão não entrou, o cadastro criado agora sai
      if (pacienteId) { try { await api.deletePatient(pacienteId); } catch { /* fica para a psicóloga excluir */ } }
      setErro(errorMessage(e));
    } finally { setBusy(null); }
  }
  async function recusar() {
    if (!pedido) return;
    if (!(await confirmar({ title: 'Recusar este pedido?', body: 'O horário volta a ficar livre. Combine com a pessoa pelo WhatsApp, se precisar.', confirmLabel: 'Recusar', danger: true }))) return;
    setBusy('recusar');
    try { await api.decideBookingRequest(pedido.id, 'recusado', null); await atualizar(); toast('Pedido recusado'); onClose(); }
    catch (e) { setErro(errorMessage(e)); } finally { setBusy(null); }
  }

  const endereco = [pd.street, pd.address_number, pd.address_complement, pd.neighborhood, pd.city && `${pd.city}/${pd.uf ?? ''}`].filter(Boolean).join(', ');
  const nf = pd.nf_tomador ? (pd.payer_tipo === 'pj' ? `Empresa: ${pd.payer_name ?? ''}` : pd.payer_tipo === 'pf' ? `Outra pessoa: ${pd.payer_name ?? ''}` : 'No nome do paciente') : 'Não pediu nota fiscal';
  return (
    <Dialog open onClose={onClose} title="Pedido pelo link" footer={<>
      <Button variant="ghost" className="mr-auto text-vermelho" busy={busy === 'recusar'} onClick={recusar}>Recusar</Button>
      <Button variant="secondary" onClick={onClose}>Voltar</Button>
      <Button busy={busy === 'aprovar'} onClick={aprovar}>Aprovar</Button>
    </>}>
      <div className="flex flex-col gap-3">
        {erro && <ErrorBox>{erro}</ErrorBox>}
        <p className="num rounded-campo bg-anil-claro/60 px-3 py-2 font-bold text-sobre-anil-claro">
          {formatLongDate(d)} às {hora}{sala ? ` · ${sala.name}` : ''} · {minutos} min
        </p>
        <p className="text-[0.9375rem] text-tinta-2">
          {FREQUENCIA_LINK[freq]}{freq !== 'nao' ? ` · ${link?.occurrences ?? 12} sessões` : ''}{link?.price != null ? ` · ${money(link.price)}` : ''}{link?.label ? ` · ${link.label}` : ''}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[0.9375rem]">
          <dt className="text-tinta-3">Nome</dt><dd className="font-bold">{pd.full_name}</dd>
          <dt className="text-tinta-3">Celular</dt><dd className="num">{formatPhone(pd.phone)}</dd>
          <dt className="text-tinta-3">Nascimento</dt><dd className="num">{pd.birth_date ? pd.birth_date.split('-').reverse().join('/') : '—'}</dd>
          <dt className="text-tinta-3">E-mail</dt><dd className="break-all">{pd.email}</dd>
          <dt className="text-tinta-3">CPF</dt><dd className="num">{formatCpf(pd.cpf)}</dd>
          <dt className="text-tinta-3">Endereço</dt><dd>{endereco}</dd>
          <dt className="text-tinta-3">Nota fiscal</dt><dd>{nf}</dd>
        </dl>
        <p className="text-[0.8125rem] text-tinta-3">Ao aprovar, o paciente é cadastrado e as sessões entram na agenda. Ao recusar, o horário volta a ficar livre.</p>
      </div>
    </Dialog>
  );
}

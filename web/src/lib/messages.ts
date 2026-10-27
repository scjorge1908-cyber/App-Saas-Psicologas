// Mensagens prontas para o paciente e links "wa.me".
// IMPORTANTE: wa.me apenas ABRE o WhatsApp da profissional com o texto pronto;
// o envio é feito por ela. Não há envio automático.
import { firstName, formatLongDate, formatTime, money, onlyDigits, zonedParts } from './format';

export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  let d = onlyDigits(phone);
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export function confirmationUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/c/${token}`;
}

export function reminderText(opts: {
  patientName: string;
  startsAt: string;
  tz: string;
  professionalName: string;
  link?: string;
  modality: 'presencial' | 'online';
}): string {
  const p = zonedParts(opts.startsAt, opts.tz);
  const when = `${formatLongDate(p.date)}, às ${formatTime(opts.startsAt, opts.tz)}`;
  const lines = [
    `Olá, ${firstName(opts.patientName)}! Lembrete da sua sessão ${opts.modality === 'online' ? 'online ' : ''}em ${when}.`,
  ];
  if (opts.link) lines.push(`Confirme ou cancele por aqui: ${opts.link}`);
  lines.push(opts.professionalName);
  return lines.join('\n');
}

/** Aviso de que a profissional não vai atender no dia da sessão (texto pronto; ela revisa antes de enviar). */
export function ausenciaText(opts: { patientName: string; startsAt: string; tz: string; professionalName: string }): string {
  const p = zonedParts(opts.startsAt, opts.tz);
  return [
    `Olá, ${firstName(opts.patientName)}! Tudo bem?`,
    `Passando para avisar que no dia ${formatLongDate(p.date)}, às ${formatTime(opts.startsAt, opts.tz)}, não vou poder atender.`,
    'Peço desculpas pelo transtorno. Vamos combinar um novo horário? Me diga o melhor dia para você.',
    opts.professionalName,
  ].join('\n');
}

/** Início de conversa livre (a profissional escreve o resto no WhatsApp). */
export function conversaText(opts: { patientName: string; professionalName: string }): string {
  return `Olá, ${firstName(opts.patientName)}! Aqui é ${opts.professionalName}.`;
}

export function chargeText(opts: { patientName: string; amount: number; description: string; professionalName: string }): string {
  return [
    `Olá, ${firstName(opts.patientName)}! Tudo bem?`,
    `Consta em aberto: ${opts.description} — ${money(opts.amount)}.`,
    'Se já fez o pagamento, por favor desconsidere esta mensagem.',
    opts.professionalName,
  ].join('\n');
}

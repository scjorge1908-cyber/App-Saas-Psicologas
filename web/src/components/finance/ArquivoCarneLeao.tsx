// Arquivo de importação do Carnê-Leão Web (pedido do Jorge em 31/10/2026, às 20:14).
// A psicóloga baixa um arquivo com os recibos pendentes e importa uma vez no e-CAC, em vez de digitar recibo por recibo.
// Serve também para um recibo só (botão em cada recebimento).
import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { PaymentItem } from '../../lib/types';
import * as api from '../../lib/api';
import { arquivosLote, nomeArquivoLote, URL_ECAC, type ArquivoLote } from '../../lib/receita-saude';
import { abrirExterno } from '../../lib/abrir-externo';
import { useProfile } from '../../auth/AuthProvider';
import { errorMessage } from '../../lib/errors';
import { Button, Notice, useConfirm, useToast } from '../ui';
import { saveBlob } from '../patients/DocumentsTab';
import { useInvalidateFinance } from './PaymentDialog';

const nativo = () => Capacitor.isNativePlatform();

function baixar(arq: ArquivoLote, sufixo = '') {
  saveBlob(new Blob([arq.conteudo], { type: 'text/csv;charset=utf-8' }), nomeArquivoLote(arq.ano, sufixo));
}

async function marcarEmitidos(ids: string[]) {
  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(ids.slice(i, i + 10).map((id) => api.updatePayment(id, { receita_saude_status: 'emitido' })));
  }
}

function PassosImportacao() {
  return (
    <ol className="mt-2 list-decimal pl-5 text-sm text-tinta-2">
      <li>No computador, entre no <strong>e-CAC</strong> com a sua conta gov.br e abra o <strong>Carnê-Leão</strong>.</li>
      <li>No menu do lado, toque em <strong>Escrituração → Importar Escrituração</strong>.</li>
      <li>Escolha o arquivo baixado e toque em <strong>Analisar Arquivo</strong>. Se aparecer algum erro, nada é gravado: corrija aqui e baixe de novo.</li>
      <li>Sem erros, toque em <strong>Importar</strong>. Os recibos aparecem em "Histórico da Escrituração".</li>
      <li>Volte aqui e toque em <strong>Já importei</strong>.</li>
    </ol>
  );
}

export function ArquivoCarneLeao({ pendentes }: { pendentes: PaymentItem[] }) {
  const { profile } = useProfile();
  const confirm = useConfirm();
  const toast = useToast();
  const invalidate = useInvalidateFinance();
  const [baixado, setBaixado] = useState<ArquivoLote | null>(null);
  const [busy, setBusy] = useState(false);
  const arquivos = arquivosLote(pendentes, { cpf: profile?.cpf ?? null });
  const nomes = new Map(pendentes.map((p) => [p.id, `${p.payer_name ?? p.patient_name} · ${p.paid_on.split('-').reverse().join('/')}`]));
  const fora = arquivos.flatMap((a) => a.fora);

  const concluir = async (arq: ArquivoLote) => {
    const ok = await confirm({
      title: `Marcar ${arq.incluidos.length} recibo${arq.incluidos.length > 1 ? 's' : ''} como emitido${arq.incluidos.length > 1 ? 's' : ''}?`,
      body: 'Confirme só depois que o Carnê-Leão mostrar a importação concluída. Se precisar, cada um pode ser desfeito em "Emitidos nos últimos 30 dias".',
      confirmLabel: 'Já importei',
    });
    if (!ok) return;
    setBusy(true);
    try { await marcarEmitidos(arq.incluidos); await invalidate(); setBaixado(null); toast('Recibos marcados como emitidos'); }
    catch (e) { toast(errorMessage(e), 'erro'); }
    finally { setBusy(false); }
  };

  return (
    <section aria-label="Emitir pelo arquivo do Carnê-Leão" className="rounded-lg border-2 border-anil bg-papel p-4">
      <p className="font-bold">Mais fácil: todos os recibos de uma vez</p>
      <p className="mt-1 text-sm text-tinta-2">O app monta o arquivo oficial da Receita com os recibos pendentes. Você importa uma vez no Carnê-Leão, no computador, e todos são emitidos juntos.</p>
      {nativo() && <div className="mt-3"><Notice tone="ocre">No celular o arquivo não é baixado. Abra <strong>psiconsultorio.vercel.app</strong> no computador para baixar e importar.</Notice></div>}
      {!nativo() && arquivos.filter((a) => a.incluidos.length > 0).map((a) => (
        <div key={a.ano} className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => { baixar(a); setBaixado(a); }}>Baixar arquivo de {a.ano} ({a.incluidos.length} recibo{a.incluidos.length > 1 ? 's' : ''})</Button>
        </div>
      ))}
      {!nativo() && arquivos.every((a) => a.incluidos.length === 0) && pendentes.length > 0 && (
        <p className="mt-3 text-sm text-vermelho">Nenhum recibo pendente está completo para o arquivo. Veja abaixo o que falta.</p>
      )}
      {baixado && (
        <div className="mt-4 rounded-lg bg-anil-claro p-3">
          <p className="font-bold">Arquivo baixado. Agora, no e-CAC:</p>
          <PassosImportacao />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => abrirExterno(URL_ECAC)}>Abrir e-CAC</Button>
            <Button busy={busy} onClick={() => concluir(baixado)}>Já importei: marcar {baixado.incluidos.length} como emitido{baixado.incluidos.length > 1 ? 's' : ''}</Button>
          </div>
        </div>
      )}
      {fora.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-bold text-vermelho">Ficaram fora do arquivo ({fora.length}):</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-tinta-2">
            {fora.map((f) => <li key={f.id}><strong>{nomes.get(f.id)}</strong>: {f.motivo}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

// Botão em cada recebimento: arquivo com um recibo só, para importar do mesmo jeito
export function ArquivoUmRecibo({ pagamento }: { pagamento: PaymentItem }) {
  const { profile } = useProfile();
  const toast = useToast();
  if (nativo()) return null;
  const [arq] = arquivosLote([pagamento], { cpf: profile?.cpf ?? null });
  if (!arq || arq.incluidos.length === 0) return null;
  const sufixo = (pagamento.payer_name ?? pagamento.patient_name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  return (
    <Button size="sm" variant="ghost" onClick={() => { baixar(arq, `${pagamento.paid_on}-${sufixo}`); toast('Arquivo baixado. Importe no Carnê-Leão e depois toque em "Recibo emitido".'); }}>
      Baixar arquivo só deste
    </Button>
  );
}

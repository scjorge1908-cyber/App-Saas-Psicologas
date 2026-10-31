// Cartão "Dados para o recibo" do Receita Saúde (modo assistido, pedido do Jorge em 31/10/2026).
// Mostra cada campo do formulário da Receita com um botão de copiar, na ordem em que ela preenche.
import { useState } from 'react';
import type { PaymentItem } from '../../lib/types';
import { dadosRecibo, textoRecibo } from '../../lib/receita-saude';
import { Button, useToast } from '../ui';

async function copiarTexto(texto: string) {
  await navigator.clipboard.writeText(texto);
}

export function ReciboAssistido({ pagamento }: { pagamento: PaymentItem }) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const campos = dadosRecibo(pagamento);
  const copiar = async (texto: string, aviso: string) => {
    try { await copiarTexto(texto); toast(aviso); } catch { toast('Não foi possível copiar. Selecione o texto e copie manualmente.', 'erro'); }
  };
  return (
    <div className="w-full">
      <Button size="sm" variant="secondary" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        {aberto ? 'Esconder dados do recibo' : 'Ver dados para o recibo'}
      </Button>
      {aberto && (
        <div className="mt-3 rounded-lg border border-linha bg-papel p-3">
          <dl className="flex flex-col gap-2">
            {campos.map((c) => (
              <div key={c.rotulo} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <dt className="text-xs text-tinta-3">{c.rotulo}</dt>
                  <dd className={c.copiar ? 'num break-words font-bold' : 'text-sm text-vermelho'}>{c.mostrar}</dd>
                </div>
                {c.copiar && (
                  <Button size="sm" variant="ghost" aria-label={`Copiar ${c.rotulo}`} onClick={() => copiar(c.copiar as string, `${c.rotulo} copiado`)}>Copiar</Button>
                )}
              </div>
            ))}
          </dl>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => copiar(textoRecibo(campos), 'Dados do recibo copiados')}>Copiar tudo</Button>
        </div>
      )}
    </div>
  );
}

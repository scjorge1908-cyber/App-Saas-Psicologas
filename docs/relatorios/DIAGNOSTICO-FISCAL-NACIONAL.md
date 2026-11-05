# Diagnóstico Fiscal Nacional — Parte 1: F0 Inventário técnico

| Item | Valor |
|---|---|
| Fase | **F0 — Inventário** (somente leitura). Plano em `docs/PROJETO-FISCAL-NACIONAL-COORDENACAO.md` |
| Data | 05/11/2026 |
| Branch / commit analisado | `main` @ `d4fcf3e` ("docs: registrar coordenação e fases da integração fiscal nacional") |
| Versão do app | `web/package.json` 0.1.0; último envio à Play: (34), em 31/10/2026 (`ULTIMO_VERSION_CODE_ENVIADO: 34`) |
| Autor | Claude (executor). Revisão: ChatGPT/CX. Decisão: Jorge |
| Escopo | Nenhum código, migration, deploy, configuração ou emissão foi feito. Este PR só acrescenta este arquivo |

Este documento cobre os itens (a) mapa dos fluxos, (b) lacunas, (e) linha de base de testes e (f) decisões do Jorge, pedidos no §9 do documento de coordenação. Os itens (c) matriz de requisitos oficiais e (d) arquitetura proposta pertencem às fases **F1** e **F3** e ficam para a Parte 2, depois do gate F0.

> **Aviso.** Afirmações normativas encontradas no repositório (ex.: "a Receita não tem API para o Receita Saúde", "Palhoça usa sistema próprio IPM", "API nacional gratuita com certificado A1", preços de certificado) foram **apenas registradas** aqui. Nenhuma foi revalidada nesta fase. Revalidar em F1 com fonte primária e data.

---

## 1. Resumo executivo

1. **O app não emite nenhum documento fiscal.** Existe controle e apoio: lista de recebimentos pendentes de recibo no Receita Saúde (modo assistido, copiar campo a campo) e registro manual de NFS-e emitidas fora do app (número, chave, PDF/XML).
2. **A base é sólida para isolamento:** RLS `owner_id = auth.uid()` em `payments` e `invoices`, FKs compostas `(id, owner_id)`, auditoria sem conteúdo, anônimo sem acesso. Isso pode ser reaproveitado.
3. **Faltam os dados que qualquer emissão de NFS-e exige do prestador:** código IBGE do município, inscrição municipal, regime tributário (Simples/MEI/outro), código do serviço (LC 116), alíquota/retensão de ISS. Nada disso existe em `profiles`.
4. **O recebimento não guarda uma "foto" do tomador.** `payments` só tem `payer_name` e `payer_cpf`. Se quem paga é empresa (CNPJ), o dado se perde no recebimento, e o recibo assistido pode mostrar a razão social como "Nome de quem pagou" com CPF vazio.
5. **Não há vínculo entre recebimento e nota.** `invoices.payment_id`/`charge_id` existem no banco, mas a tela nunca os preenche; não há unicidade por recebimento. Hoje nada impede notas duplicadas para o mesmo pagamento.
6. **Registro fiscal pode ser apagado ou alterado depois de emitido.** Um recebimento marcado "Recibo emitido" pode ser excluído ou ter valor alterado sem bloqueio no banco.
7. Infraestrutura reaproveitável para um conector servidor: Edge Function `notificar-pedido` (segredos no Supabase, `service_role` só no servidor, chamada via `pg_net`, idempotência por tabela de controle).

---

## 2. (a) Mapa arquivo → função → risco

### 2.1 Banco (Supabase/Postgres)

| Arquivo | O que faz no fiscal/financeiro | Risco / observação |
|---|---|---|
| `supabase/migrations/20261012000100_base.sql` L11, L30–56 | Enum `fiscal_type ('pf','pj')`; `profiles` com `cpf`, `cnpj`, `fiscal_type`, `city`, `uf`, `address` | Sem IBGE, inscrição municipal, regime, CNAE/serviço, alíquota. `fiscal_type` é um só valor por conta (não há histórico: troca PF→PJ altera a leitura de recebimentos antigos) |
| `20261028000100_perfil_endereco_aniversario.sql` | `profiles.cep`, `address_number`, `address_complement`, `neighborhood` | Endereço do prestador completo, mas sem código de município |
| `20261028000200_perfil_razao_social.sql` | `profiles.company_name` (razão social PJ) | OK para PJ; nome fantasia não guardado |
| `20261012000200_patients_agenda.sql` L28–29 | `patients.payer_name`, `payer_cpf` | Dados do pagador ficam no paciente (estado atual), não no recebimento |
| `20261027000200_endereco_paciente_duracao_faixa.sql` | Endereço do paciente (`cep`…`uf`) | Sem IBGE |
| `20261027001000_nota_fiscal_tomador.sql` | `patients.nf_tomador ('paciente','outro')`, `payer_email/phone/cep/street/…/uf` | Tomador é atributo do paciente; não há "foto" por nota. `nf_tomador` (emitir nota) não gera nenhuma ação |
| `20261027001100_nota_fiscal_pf_pj.sql` | `patients.payer_tipo ('pf','pj')`, `payer_cnpj`, `payer_im` | PJ tomador existe no paciente, mas `payments` não tem `payer_cnpj` |
| `20261012000500_finance.sql` L12–14 | Enums `payment_method`, `receita_saude_status ('pendente','emitido','nao_aplicavel')`, `invoice_status ('a_emitir','emitida','cancelada')` | Estados insuficientes para emissão automática (sem `processando`, `erro`, `rejeitada`, `substituida`) |
| idem L17–46 | `charges` (a receber), única por `appointment_id`, RLS | OK. Base para conciliação |
| idem L49–111 | `payments` (recebimento) com `payer_name`, `payer_cpf`, `receita_saude_status`; gatilho que impede passar do saldo | **Sem `payer_cnpj`, sem data/número do recibo, sem bloqueio de DELETE/UPDATE após "emitido"** |
| idem L171–210 | `invoices` (acompanhamento de NFS-e externa): `competence`, `amount`, `status`, `number`, `access_key` (44–50 dígitos), `issued_on`, PDF/XML como anexos; check "emitida exige número e data" | **Sem unicidade por `payment_id`**, sem provedor, sem DPS/protocolo, sem motivo/data de cancelamento, sem snapshot de prestador/tomador, sem log de tentativas. Comentário da tabela: "O sistema não emite nem simula notas" |
| idem L215–262 | `tg_appointments_charge`: sessão atendida/falta cobrada gera cobrança | Confirma a regra do §5: sessão não deve disparar emissão; o gatilho fiscal correto é o recebimento |
| idem L362–391 | `dashboard_summary`: `invoices_pending`, `receita_saude_pending` (só se `fiscal_type='pf'`) | Contadores dependem de lançamento manual |
| `20261012000700_views.sql` L56–75 | Views `payment_items` (com `patient_cpf`, `charge_description`) e `invoice_items`, `security_invoker` | OK. Qualquer coluna nova precisa entrar nas views |
| `20261012000400_records_documents.sql` L28 | Categoria de anexo `nota_fiscal` | PDF/XML de nota vão para o mesmo bucket clínico |
| `20261027000900_laudo_encaminhamento_excluiveis.sql` | Versão vigente de `tg_attachments_protect`: anexo ligado a `invoices` não pode ser apagado | Dependência: novas tabelas de documento fiscal precisam entrar nesse gatilho (redefinido em 4 migrations ao longo do tempo) |
| `20261012000800_hardening.sql` L364–365 | Paciente com `payments`/`invoices` não pode ser excluído | Dependência: novas tabelas fiscais precisam entrar aqui |
| `20261012000600_export_import.sql` L59, L164 | Backup/restauração inclui `invoices` e `payments` | Dependência: novas tabelas precisam entrar no export/import e no teste de restauração |
| `20261028000300_agendamento_pelo_paciente.sql` L272–295 | Link público aceita campos de nota (`nf_tomador`, `payer_*`) | Dados fiscais podem chegar por fluxo anônimo; validação é só de formato |
| `20261028000400_notificacao_push.sql` | `_config`, `pg_net`, gatilho que chama Edge Function | Padrão reaproveitável para fila/conector |

### 2.2 Servidor (Edge Functions)

| Arquivo | Função | Observação |
|---|---|---|
| `supabase/functions/notificar-pedido/index.ts` | Única Edge Function. Relê o dado com `service_role`, não confia no chamador, envia uma vez só (tabela de controle) | Bom modelo para conector fiscal. **Não existe** função fiscal, fila, retry nem cofre de certificado |

### 2.3 App (React/Vite/Capacitor)

| Arquivo | Função | Risco / observação |
|---|---|---|
| `web/src/lib/types.ts` L3, L15–16, L73–89, L237–291 | Tipos `FiscalType`, `ReceitaSaudeStatus`, `InvoiceStatus`, `Patient.payer_*`, `PaymentItem`, `InvoiceItem` | Tipos escritos à mão (não gerados do banco): risco de divergência com enums |
| `web/src/lib/receita-saude.ts` | `dadosRecibo()` monta os campos do recibo (pagador, beneficiário, valor, data, descrição); `URL_ECAC` | Só prepara texto. Supõe pagador PF; não trata pagador PJ |
| `web/src/components/finance/ReciboAssistido.tsx` | Mostra campos com "Copiar" / "Copiar tudo" | Apoio manual (PR #21, Play 34) |
| `web/src/pages/FinancePage.tsx` L35, L305–370 | Aba "Receita Saúde" (só PF): pendentes, "Recibo emitido", "Não se aplica", "Desfazer" (30 dias), planilha de apoio CSV | Planilha **não** segue o leiaute oficial de lote (o próprio app avisa, L356). Status muda sem guardar número/data do recibo |
| idem L143–147 | CSV de recebimentos do mês | Exporta CPF de paciente e pagador (dado sensível em arquivo local) |
| `web/src/components/finance/PaymentDialog.tsx` L37–38, L53–57 | Registro de recebimento; copia `payer_name`/`payer_cpf` do paciente; define `receita_saude_status` pelo `fiscal_type` atual | **Pagador PJ:** `payer_name` recebe a razão social e `payer_cpf` fica vazio; o recebimento vira "pendente" de Receita Saúde mesmo pago por empresa |
| `web/src/pages/InvoicesPage.tsx` | Tela "Notas fiscais": registrar nota externa, status, número, chave, PDF/XML | Não liga a nota ao recebimento (`payment_id`/`charge_id` nunca preenchidos). Texto atual: "O sistema não emite notas fiscais" |
| `web/src/components/patients/NotaFiscalCampos.tsx` | Cartão "Nota fiscal" do paciente: tomador paciente/PF/PJ, obrigatórios | Base boa de dados do tomador (falta IBGE) |
| `web/src/lib/perfil.ts` L11–29 | Perfil obrigatório (CPF; CNPJ e razão social se PJ; endereço) | Não exige nada municipal/tributário |
| `web/src/lib/cep.ts` L12–14 | ViaCEP: rua, bairro, cidade, UF | O ViaCEP também devolve o código IBGE, que hoje é descartado (melhoria barata, sem custo) |
| `web/src/lib/cnpj.ts` | BrasilAPI: razão social e nome fantasia | A mesma resposta traz dados cadastrais que poderiam pré-preencher regime/município (validar em F1 se são confiáveis para fins fiscais) |
| `web/src/lib/api.ts` L42–52 / `api-real.ts` L172–214 / `demo/api-demo.ts` | `listPayments`, `createPayment`, `updatePayment`, `deletePayment`, `listInvoices`, `saveInvoice`; fachada real × demo | Toda função nova precisa de versão demo (dependência). Escrita direta via PostgREST, sem camada de serviço fiscal |
| `web/src/lib/ajuda.ts` L70 | Ajuda: "A emissão pelo sistema nacional (NFS-e) está em preparação." | Mensagem já promete algo; revisar com o §5 do plano |
| `web/src/App.tsx` L73, `AppShell.tsx` L28, `TodayPage.tsx` L122–130, `AvisosHoje.tsx` L52 | Rota `/notas-fiscais` e avisos de pendência | — |

### 2.4 Fluxo atual (como funciona hoje)

```
Sessão marcada "Compareceu" (ou falta cobrada)
  └─ gatilho tg_appointments_charge → charges (valor a receber)
        └─ PaymentDialog → payments (recebimento)
              ├─ Psicóloga PF → receita_saude_status = 'pendente'
              │     └─ Financeiro › Receita Saúde: copiar dados → emitir no app da Receita / Carnê-Leão Web (fora do app)
              │           → toque "Recibo emitido" (só muda o status)
              └─ Psicóloga PJ → 'nao_aplicavel'
                    └─ Notas fiscais: registrar à mão a NFS-e emitida no portal/Emissor Nacional (fora do app)
                          → número, chave, PDF/XML anexados (sem vínculo com o recebimento)
```

---

## 3. (b) Lacunas e riscos

Severidade: **A** (bloqueia emissão automática ou causa erro fiscal), **M** (retrabalho ou inconsistência), **B** (melhoria).

| # | Sev. | Lacuna / risco | Evidência |
|---|---|---|---|
| L1 | A | Prestador sem código IBGE do município, inscrição municipal, regime tributário, código de serviço, alíquota/retensão de ISS | `20261012000100_base.sql` L30–56; `perfil.ts` |
| L2 | A | Recebimento sem "foto" do tomador: só `payer_name`/`payer_cpf`; sem CNPJ, endereço, IBGE. Mudança no cadastro do paciente muda a leitura de recebimentos antigos | `20261012000500_finance.sql` L57–58; `PaymentDialog.tsx` L37–38 |
| L3 | A | Pagador PJ: Receita Saúde marca "pendente" e o recibo assistido mostra razão social como pagador PF com CPF vazio | `PaymentDialog.tsx` L37–38, L56; `receita-saude.ts` L26–33 |
| L4 | A | Sem idempotência: `invoices` não tem unicidade por `payment_id`/evento; nada impede duas notas para o mesmo recebimento | `20261012000500_finance.sql` L171–195 |
| L5 | A | Recebimento com recibo emitido pode ser excluído ou ter valor/data alterados (sem gatilho de proteção); nota "emitida" pode ser editada livremente pela tela | `api-real.ts` L182–186; `InvoicesPage.tsx` L95–99 |
| L6 | A | Não existe backend fiscal: sem Edge Function, fila, retries, log de tentativas, nem lugar seguro para certificado A1 (Vault/KMS) | `supabase/functions/` só tem `notificar-pedido` |
| L7 | M | Estados insuficientes: falta `processando`, `erro`/`rejeitada`, `substituida`; cancelamento sem motivo, data e protocolo | `20261012000500_finance.sql` L13–14 |
| L8 | M | Receita Saúde "emitido" não guarda número/data do recibo nem quem marcou; "Desfazer" só nos últimos 30 dias | `FinancePage.tsx` L311, L349–366 |
| L9 | M | `receita_saude_status` decidido pelo `fiscal_type` no momento do registro; troca PF↔PJ não é tratada | `PaymentDialog.tsx` L42, L56 |
| L10 | M | Nota não liga ao recebimento (`payment_id`/`charge_id` nunca preenchidos) → sem conciliação | `InvoicesPage.tsx` L95–99 |
| L11 | M | `nf_tomador` ("emitir nota") não gera nota "a emitir" automaticamente | `NotaFiscalCampos.tsx`; nenhum consumidor no banco |
| L12 | M | Planilha de apoio do Receita Saúde não segue o leiaute oficial de lote; Jorge já disse preferir importar arquivo no Carnê-Leão | `FinancePage.tsx` L332–356; `PENDENCIAS.md` |
| L13 | M | Dependências a lembrar em qualquer tabela fiscal nova: views, `tg_attachments_protect`, exclusão de paciente, export/import, demo API, tipos TS | §2.1 e §2.3 |
| L14 | M | PDF/XML fiscais no mesmo bucket dos anexos clínicos; retenção fiscal (prazo próprio) não separada da clínica | `20261012000400_records_documents.sql` L28 |
| L15 | M | Documentação com informações divergentes: `PENDENCIAS.md` fala em "intermediário a partir de ~R$ 95/mês"; `HISTORICO-DECISOES.md` (31/10) combina API oficial gratuita com certificado A1; `PENDENCIAS.md` diz que Palhoça não usa o Emissor Nacional. Tudo a revalidar em F1 | `PENDENCIAS.md` L86; `HISTORICO-DECISOES.md` L25 |
| L16 | B | Texto de ajuda promete "emissão nacional em preparação" | `ajuda.ts` L70; conflita com §5 (não prometer sem homologação) |
| L17 | B | Código IBGE é descartado da resposta do ViaCEP | `cep.ts` L12–14 |
| L18 | B | Tipos TS escritos à mão (risco de divergência com enums novos) | `types.ts` |

**Riscos de plataforma (já registrados no repositório, impactam F4–F6):** plano Supabase Free sem backup automático (`SEGURANCA.md`, `PENDENCIAS.md`); Vercel Hobby proíbe uso comercial (D2); SMTP próprio não configurado (D4); revisão jurídica pendente (D6); fluxo de autenticação `implicit` (migrar para PKCE).

---

## 4. O que já funciona e pode ser reaproveitado

- Isolamento por profissional (RLS + FKs compostas), testado em `supabase/tests/01_isolation.sql`, `05_finance.sql`, `10_nota_fiscal_tomador.sql`.
- Auditoria (`tg_audit`) já ligada a `payments` e `invoices`, sem conteúdo.
- Cadastro completo do tomador PF/PJ no paciente, com validação de CPF/CNPJ e endereço (`NotaFiscalCampos.tsx`).
- Perfil profissional obrigatório com CPF/CNPJ/razão social e endereço.
- Cálculo de recebimento × cobrança (sem passar do saldo) e geração de cobrança só por sessão atendida.
- Modo assistido do Receita Saúde em produção (Play 34) e registro manual de NFS-e com PDF/XML protegidos contra exclusão.
- Modelo de Edge Function segura com segredo no servidor e envio único.

---

## 5. (e) Linha de base de testes

| Camada | Arquivos fiscais | Resultado nesta análise |
|---|---|---|
| Unitários (Vitest) | `receita-saude.test.ts` (5), `perfil.test.ts`, `cnpj.test.ts` | Rodados em 05/11/2026 neste ambiente: **3 arquivos, 9 testes, todos passaram** |
| SQL | `05_finance.sql` (inclui "NFS-e emitida exige número e data", chave 44–50), `10_nota_fiscal_tomador.sql` (tomador PF/PJ, isolamento) | Não rodados aqui (sem servidor Postgres). Rodam no CI (`scripts/db-test.sh`). Último CI verde em `main`: 31/10 (`41abdff`); CI do commit atual estava em execução |
| E2E (Playwright) | `web/e2e/flows.spec.ts` L180 (aba Receita Saúde), L428–473 (cartão Nota fiscal) | Não rodados aqui; rodam no CI |

**Sem cobertura hoje:** pagador PJ no recebimento; proteção de recebimento com recibo emitido; duplicidade de nota por recebimento; troca PF↔PJ.

---

## 6. Recomendações para as próximas fases (sem execução)

1. **F1 — antes de qualquer desenho:** revalidar com fonte primária e data: (a) se existe via oficial de envio do Receita Saúde por sistema ou só app/Carnê-Leão e lote; (b) leiaute oficial do lote/importação no Carnê-Leão; (c) elegibilidade da API da NFS-e Nacional por regime (MEI, Simples, demais) e se o município precisa ter aderido; (d) situação de Palhoça/SC e dos municípios-alvo; (e) autenticação (certificado A1 do prestador, procuração), ambiente de produção restrita, cancelamento/substituição.
2. **Correções de baixo risco que podem vir antes da integração** (cada uma exige ordem do Jorge, PR próprio e migration só de acréscimo): L3 (pagador PJ não é Receita Saúde), L5 (bloquear exclusão/alteração de recebimento com recibo emitido), L2/L4 (snapshot do tomador e unicidade nota × recebimento), L16 (texto da ajuda).
3. **F3:** módulo fiscal no servidor seguindo o padrão `notificar-pedido`: tabela de documentos fiscais com chave de idempotência por recebimento, fila com retries, log de tentativas, conectores versionados (`receita_saude_assistido`, `nfse_nacional`, `manual`), certificado só no servidor (Supabase Vault ou equivalente), bucket separado para XML/PDF fiscal com retenção própria.
4. Manter a regra do §5: o gatilho fiscal é o **recebimento confirmado**, nunca a sessão atendida.

---

## 7. (f) Decisões que dependem do Jorge

| # | Decisão | Por quê |
|---|---|---|
| J1 | Aprovar este inventário (gate F0) e autorizar F1 | Gate obrigatório |
| J2 | Autorizar ou não as correções de baixo risco L3, L5 e L16 antes de F3 | Corrigem riscos atuais, independem da integração |
| J3 | Municípios e perfis prioritários do piloto (ex.: Palhoça/SC; PF × PJ; MEI × Simples) | Define o que F1 e F2 verificam primeiro |
| J4 | Confirmar a diretriz "sem intermediário pago" (registrada em 31/10) e corrigir `PENDENCIAS.md` | Documentos atuais divergem (L15) |
| J5 | Política para certificado A1: o app guarda o certificado da psicóloga (cofre no servidor) ou ela assina fora | Custo, segurança e LGPD |
| J6 | Plano Supabase para produção fiscal (backup) e hospedagem comercial (D2) | Pré-requisito de F5/F6 |

---

## 8. Como este relatório foi feito

Leitura de `CLAUDE.md`, `README.md`, `docs/PROJETO-FISCAL-NACIONAL-COORDENACAO.md`, `docs/HISTORICO-DECISOES.md`, `docs/PENDENCIAS.md`, `docs/CONFORMIDADE.md`, `docs/SEGURANCA.md`, `docs/TESTES.md`, das 27 migrations (busca por termos fiscais e leitura integral das financeiras/fiscais), da Edge Function e dos arquivos do app listados no §2. Execução local apenas de `npm ci` e testes unitários. Nada foi alterado no banco, no Supabase, na Vercel ou na Play.

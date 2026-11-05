# Projeto Fiscal Nacional — Coordenação e plano mestre
Data-base: 2026-11-05. Estado: PLANEJAMENTO / ANÁLISE. Dono do produto e aprovador: Jorge. Coordenador técnico/arquitetural: ChatGPT (CX). Executor proposto: Claude, somente após autorização de Jorge. Documento de coordenação, NÃO autorização de implementação.

## 1. Objetivo e limites
Adicionar ao PsiConsultório uma experiência fiscal nacional para psicólogas, aproveitando cadastro, pagamentos, cobranças e acompanhamento de documentos já existentes. PF: Receita Saúde, quando legalmente aplicável. PJ: NFS-e, priorizando integração oficial nacional quando elegível; fallback assistido para outras situações. Mostrar claramente a disponibilidade por perfil/município. Nunca prometer emissão automática sem homologação comprovada. Não realizar emissão real, contratação, armazenamento de certificados, alteração de schema, deploy ou custos sem autorização explícita.

## 2. Repositório e ativos existentes (verificar na branch atual)
- web/src/lib/receita-saude.ts: prepara dados para emissão assistida, sem integração de transmissão.
- web/src/lib/types.ts: FiscalType, ReceitaSaudeStatus, InvoiceStatus, Profile, Patient, PaymentItem, InvoiceItem; separar emissor (fiscal_type) de pagador (payer_tipo).
- supabase/migrations/20261027001000_nota_fiscal_tomador.sql e 20261027001100_nota_fiscal_pf_pj.sql: dados do tomador PF/PJ.
- supabase/migrations/20261012000500_finance.sql: pagamentos e status Receita Saúde.
- web/src/lib/api-real.ts, web/src/lib/api.ts, web/src/components/finance/PaymentDialog.tsx: conferir funções e fluxo de recebimento.
- docs/PENDENCIAS.md, docs/SEGURANCA.md, docs/CONFORMIDADE.md, docs/TESTES.md e CLAUDE.md: decisões, restrições e testes.
Não inferir que tabelas existentes equivalem a emissão governamental implementada.

## 3. Modelo de responsabilidade
Jorge: aprova escopo, custos, fornecedores, uso de dados e produção.
ChatGPT/CX: coordena, valida fontes oficiais, especifica critérios de aceite e revisa evidências do Claude.
Claude: faz inventário técnico, propõe arquitetura e testes; só escreve código após ordem específica de Jorge, com PR e sem merge automático.
GitHub: fonte persistente de verdade. Cada etapa deve registrar evidências, data, riscos, decisão, status e PR/commit.

## 4. Fases e gates
F0 — INVENTÁRIO: Claude mapear migrations, tabelas, RLS, policies, funções, telas, fluxos e testes fiscais; confirmar versão e branch. Entregar mapa arquivo->função->risco e lacunas. Sem mudanças funcionais.
F1 — VALIDAÇÃO NORMATIVA: confirmar por fontes primárias atuais Receita Saúde PF, elegibilidade NFS-e nacional por perfil/regime/competência, adesão e parâmetros municipais, exigências de certificado, autorização, credenciais, ambiente de produção restrita, cancelamento/substituição e contingência. Separar norma, adesão, elegibilidade e homologação da integração. Registrar URLs e datas.
F2 — MATRIZ DE COBERTURA: base com IBGE município, UF, tipo de emissor, regime, serviço, provedor aplicável, elegibilidade, autenticação, status de homologação, data de validação, fonte e motivo da indisponibilidade. Estados/municípios não devem ser rotulados 'aceitos' só por adesão. Status sugeridos: nao_verificado, elegivel_nao_testado, em_teste, homologado, indisponivel, suspenso. Prospecção apenas com alegações comprovadas.
F3 — DESENHO: módulo fiscal independente da UI, conectores versionados (NFS-e nacional, Receita Saúde assistido e futuros provedores), backend seguro, fila/retries, idempotência por evento de pagamento/documento, auditoria, RBAC/RLS por profissional, segregação de tenants, criptografia e política de retenção. Nenhuma credencial no frontend ou logs.
F4 — PROTÓTIPO CONTROLADO: dados fictícios e ambiente oficial de teste quando disponível; testar validações, XML/DPS, retorno, erros, duplicidade, PDF/XML e conciliação. Emissão real somente com consentimento explícito e conferência tributária.
F5 — PILOTO: poucos profissionais voluntários, municípios/perfis homologados, consentimento e plano de rollback, monitoramento e suporte.
F6 — LANÇAMENTO: habilitação por feature flag e perfil, mensagens honestas de cobertura, funil comercial e métricas de custo/nota, sucesso, falha e suporte.

Gate obrigatório entre fases: relatório de evidências + análise de riscos + autorização de Jorge. Nenhum merge ou deploy automático.

## 5. UX e regra de negócios
Onboarding coleta PF/PJ, CPF/CNPJ, município IBGE, regime e dados fiscais estritamente necessários. Para PF, Receita Saúde deve permanecer assistido até haver via de automação oficial/autorizada comprovada; não solicitar senha gov.br. Para PJ, consultar elegibilidade e parâmetros; mostrar:
- 'Emissão automática disponível' SOMENTE após homologação para aquele perfil.
- 'Em validação' se elegível porém sem teste conclusivo.
- 'Ainda não disponível no PsiConsultório' se não suportado, com fluxo manual e anexo.
Não bloquear agenda/financeiro. Sessão atendida não dispara emissão: conferir recebimento, pagador/tomador, competência, valor, regras fiscais, cancelamentos e documentos já emitidos. Emissão exige confirmação do profissional quando necessário. Permitir correção, cancelamento e rastreabilidade conforme normas.

## 6. Segurança e conformidade
CPF, dados de saúde, recibos e certificados são sensíveis. Minimização de dados, LGPD, segregação por tenant, RLS, controle de acesso, auditoria sem dados clínicos, criptografia em trânsito e repouso, proteção de segredo no backend, rotação e revogação, retenção e exclusão conforme obrigação legal. Nunca usar automação frágil por senha gov.br sem parecer técnico/jurídico e autorização. Não colocar XML, certificados ou tokens em repositório. Exigir revisão contábil/jurídica das regras fiscais.

## 7. Critérios de aceite da primeira integração
1. Evidência oficial da elegibilidade por regime/município e autenticação.
2. Teste documentado sem custo inesperado.
3. Nenhuma emissão duplicada mesmo com retry.
4. Histórico consistente de status, número/chave, XML/PDF, erro e data.
5. Isolamento entre profissionais e testes de RLS.
6. Mensagens de indisponibilidade e fallback manual funcionando.
7. Custos de infraestrutura/certificado/suporte estimados e aprovados.
8. Testes automatizados, revisão independente, PR aprovado e rollback.

## 8. Métricas de negócio
Cobertura homologada por perfil e município; número de profissionais elegíveis; conversão da prospecção por segmento; emissões/mês; taxa de sucesso; tempo médio; custo total por emissão e por profissional; chamados de suporte. NÃO equiparar cobertura do governo a cobertura homologada do produto.

## 9. Próxima tarefa do Claude (ANÁLISE APENAS)
Ler este documento, CLAUDE.md, README.md, docs/PENDENCIAS.md, docs/CONFORMIDADE.md, docs/SEGURANCA.md, docs/TESTES.md, migrations e arquivos fiscais/financeiros. Produzir docs/relatorios/DIAGNOSTICO-FISCAL-NACIONAL.md via PR separado, sem alterar código ou banco, incluindo: (a) mapa exato dos fluxos, (b) lacunas, (c) matriz de requisitos oficiais com fontes, (d) arquitetura proposta e alternativas/custos, (e) plano de testes e (f) decisões que dependem de Jorge. Aguardar autorização antes de executar F3/F4.

## 10. Referências oficiais a consultar e revalidar
https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
https://www.gov.br/nfse/pt-br/municipios/monitoramento-adesoes
Portal Receita Federal: orientações oficiais sobre Receita Saúde e Carnê-Leão.
A documentação oficial pode mudar; registrar data de consulta e não tomar comentários antigos do repositório como comprovação normativa.

# Pendências e decisões

## Decisões que precisam de você (bloqueiam etapas)

| # | Decisão | Por que bloqueia | Opções | Custo |
|---|---------|------------------|--------|-------|
| D1 | ~~Projeto Supabase~~ | **Resolvido (26/10/2026)**: projeto `psiconsultorio` (`sstuqkxatcbusxkqpfvx`, sa-east-1, plano Free). Migrations 1–3 pela ferramenta; 4–9 no SQL Editor (contêm `DELETE` em funções), por isso não aparecem no histórico de migrations | — | — |
| D2 | **Hospedagem do app web** | Teste: **Vercel Hobby (decidido)**, permitido para uso não comercial. Lançamento: Hobby e GitHub Pages proíbem SaaS comercial | Produção: Cloudflare Pages ou Vercel Pro | Teste R$ 0; produção R$ 0 (Cloudflare) ou US$ 20/mês (Vercel Pro) |
| D3 | **Domínio** | Necessário para links de confirmação estáveis, e-mails e lojas | Ex.: `app.seudominio.com.br` | ~R$ 40/ano (registro.br) |
| D4 | **E-mail transacional (SMTP)** | O SMTP embutido do Supabase só envia para membros da equipe → recuperação de senha e confirmação de cadastro não chegam às usuárias | Brevo Free (300/dia) ou Resend Free (100/dia), com domínio próprio | R$ 0; exige criar conta e chave (credencial) |
| D5 | **Nome comercial** | Nome provisório "PsiConsultório"; verificar marca no INPI antes de publicar. Identificador nas lojas já definido: `br.com.clinicahope.psi` (conta de desenvolvedor da Hope) | — | — |
| D6 | **Revisão jurídica** | Termos de uso, política de privacidade, contrato de operador (DPA), prazos de guarda e destino do acervo (ver `CONFORMIDADE.md`) | Advogado com experiência em LGPD/saúde | Honorários |
| D7 | ~~Repositório remoto~~ | **Resolvido**: https://github.com/scjorge1908-cyber/App-Saas-Psicologas, com CI verde | — | — |

## Objetivo de distribuição

O produto final será **app na Google Play e na App Store**. A versão web e a PWA servem para testes e uso pelo navegador. Os projetos nativos (Capacitor) já estão em `web/android` e `web/ios`.

## Etapas pendentes que dependem de equipamento, conta ou taxa

| Etapa | Requisito | Situação |
|-------|-----------|----------|
| Build Android (APK/AAB) | Android Studio/SDK (download bloqueado neste ambiente) | Projeto pronto em `web/android`. `npm run build && npx cap sync && npx cap open android` |
| Teste em aparelho Android | APK de debug instalado direto | Gratuito |
| Google Play | Conta de desenvolvedor da Hope (já paga) | **Teste interno ativo desde 26/10/2026**: app `br.com.clinicahope.psi`, versão 0.1.0 (7). Próximos envios pelo workflow `play-teste-interno` (enviar=teste-interno) |
| Build iOS | Mac com Xcode 26+ | Projeto pronto em `web/ios` |
| Teste em iPhone | Xcode "Personal Team" (gratuito, perfis de 7 dias) ou TestFlight | TestFlight exige Apple Developer Program (US$ 99/ano) |
| App Store | Apple Developer Program | US$ 99/ano |
| Emissão automática de NFS-e | Certificado ICP-Brasil A1 de cada profissional (~R$ 160–235/ano) + integração por município ou intermediário (a partir de ~R$ 95/mês) | Não implementado; módulo de acompanhamento pronto. Palhoça/SC usa sistema próprio (IPM), não o Emissor Nacional |
| Lembrete automático por WhatsApp | API oficial cobra por mensagem iniciada pela empresa desde 07/2025 | Não ativado; usa `wa.me` (manual, gratuito) |
| Lembrete por e-mail automático | D4 + função agendada (Supabase Edge Function + pg_cron, gratuitos) | Não implementado |
| Notificação push (Web Push) | VAPID (grátis) + Edge Function agendada; iOS exige PWA instalada | Não implementado |
| Backup automático do banco | Plano Free não tem backup | Script e instruções em `IMPLANTACAO.md`; requer a senha do banco (credencial) |

## Melhorias identificadas (não bloqueiam)

- Migrar autenticação para fluxo PKCE ao configurar o projeto real.
- Exportação do prontuário de **um** paciente (pedido de acesso do titular) em PDF.
- Pacotes de sessões com saldo e reajuste de valor com data de vigência.
- Bloqueios de agenda (férias, feriados).
- Sincronização com Google Agenda.
- Modelo CSV no leiaute oficial do lote do Receita Saúde (o layout oficial não foi verificado).

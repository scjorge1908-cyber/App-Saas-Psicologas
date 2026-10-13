# Arquitetura e decisões técnicas

Nome de trabalho: **PsiConsultório**. O nome comercial é uma decisão pendente
de negócio. Ver `PENDENCIAS.md`.

## 1. Premissas

| # | Premissa | Origem |
|---|----------|--------|
| P1 | Orçamento zero: nenhum serviço pago, cartão ou trial que vire assinatura. | Briefing |
| P2 | Cada psicóloga é uma conta isolada. Não há clínica ou multiusuário nesta versão. | Briefing |
| P3 | Pacientes não fazem login. Recebem apenas um link de confirmação. | Briefing |
| P4 | Todo dado usado em desenvolvimento e teste é fictício. | Briefing |
| P5 | O backend é o Supabase (Postgres, Auth, Storage, RLS). O isolamento é garantido no banco. | Briefing + análise |
| P6 | Fuso padrão `America/Sao_Paulo`, configurável por profissional. | Mercado BR |
| P7 | Sessão padrão de 50 min com 10 min de intervalo, ambos configuráveis. | Pesquisa de mercado |

## 2. Arquitetura escolhida

```
┌──────────────────────────────┐        ┌───────────────────────────────────┐
│ App web React + TypeScript   │  HTTPS │ Supabase                          │
│ (Vite, PWA instalável)       │───────▶│  • Auth (e-mail/senha, recuperação)│
│  • mesma base para Capacitor │        │  • PostgREST → Postgres + RLS     │
│    (Android/iOS)             │        │  • Storage (bucket privado)       │
│  • PDFs gerados no aparelho  │        │  • RPCs SQL (agenda, confirmação, │
│    (pdf-lib)                 │        │    relatórios, export/import)     │
└──────────────────────────────┘        └───────────────────────────────────┘
          ▲ link /c/<token>  (paciente anônimo → 2 RPCs restritas)
```

**Por que assim**
- **Sem servidor próprio.** Toda a regra crítica fica em Postgres: RLS, chaves
  estrangeiras compostas, gatilhos e restrição de exclusão. O frontend nunca
  usa a chave `service_role`. Assim não há backend extra para hospedar ou
  pagar, e a segurança não depende da interface.
- **Isolamento em três camadas.**
  1. RLS `owner_id = auth.uid()` em todas as tabelas.
  2. FKs compostas `(x_id, owner_id)`, que impedem apontar para dados de outra conta mesmo com id conhecido.
  3. `REVOKE` para `anon`, que só executa `get_confirmation` e `respond_confirmation`.
- **Conflitos de agenda resolvidos no banco** com `EXCLUDE USING gist`. Funciona
  mesmo com duas abas ou dois aparelhos ao mesmo tempo.
- **Recorrência materializada.** Cada ocorrência é uma linha, o que permite
  confirmar, faltar, cobrar e remarcar uma sessão isolada. Séries sem data final
  geram 26 semanas e podem ser estendidas.
- **PDF gerado no aparelho.** O conteúdo clínico não passa por serviço externo.
  Uma cópia imutável vai para o Storage, com hash SHA-256 (Res. CFP 001/2009,
  art. 2º, cópias dos documentos emitidos).
- **Uma base de código para web, PWA e apps.** Capacitor (licença MIT) empacota o
  mesmo build. Ver seção 4.

## 3. Modelo de dados (resumo)

| Tabela | Função | Proteções principais |
|--------|--------|----------------------|
| `profiles` | Psicóloga: nome, CRP, preferências de agenda e fiscais | Criada por gatilho no cadastro; sem DELETE |
| `patients` | Pacientes, responsável legal e responsável financeiro | Exclusão só sem histórico; senão, alta ou inativação |
| `appointment_series` | Regras de recorrência | — |
| `appointments` | Sessões e status | `EXCLUDE` contra sobreposição; regras de transição |
| `confirmation_tokens` | Hash SHA-256 do link | Inacessível a clientes; expira no início da sessão |
| `record_entries` + `record_entry_versions` | Prontuário com versões | Sem DELETE nem para admin; retificação preserva o texto anterior |
| `attachments` | Metadados de arquivos | Avaliação e documentos emitidos não são apagados; caminho preso à pasta da dona |
| `documents` | Documentos emitidos | Imutáveis; permitem só registrar a entrega |
| `charges` / `payments` / `expenses` | Controle financeiro | Pagamento ≤ saldo; cobrança paga não é cancelada |
| `invoices` | Acompanhamento de NFS-e emitida fora do sistema | "emitida" exige número e data reais |
| `audit_log` | Quem, quando, o quê (nomes de colunas) | Sem conteúdo clínico; escrita só por gatilhos |

## 4. Web, PWA, apps e lojas

| Modalidade | Situação | Custo |
|------------|----------|-------|
| Acesso pelo navegador (desktop e celular) | Implementado | Hospedagem estática gratuita (ver abaixo) |
| Instalação como PWA ("Adicionar à tela inicial") | Implementado (manifest + service worker) | Zero |
| Projeto Android/iOS com Capacitor | Configuração preparada no repositório | Zero |
| Build Android (APK/AAB) | **Pendente**: exige Android SDK e Gradle, sem acesso a download neste ambiente | Zero na máquina da profissional |
| Build iOS | **Pendente**: exige macOS + Xcode | Mac próprio |
| Distribuição para testes | Android: APK direto ou teste fechado na Play. iOS: TestFlight exige conta paga | Play US$ 25 (único); Apple US$ 99/ano |
| Publicação nas lojas | **Não realizada** | Idem; Play exige 12 testadores por 14 dias para contas novas |

A PWA **não** é um aplicativo nativo publicado. Ela roda no navegador e pode
ser instalada na tela inicial.

**Hospedagem web.**
- Vercel Hobby e GitHub Pages proíbem uso comercial ou SaaS.
- A opção recomendada é **Cloudflare Pages**: plano gratuito sem cobrança automática e assets estáticos ilimitados.
- Netlify Free também serve: tem limite rígido e não gera cobrança.

## 5. Canais de lembrete

| Canal | Decisão |
|-------|---------|
| Link `wa.me` com mensagem pronta | **Implementado.** Abre o WhatsApp da profissional com o texto e o link de confirmação; ela toca em "enviar". **Não é envio automático.** |
| WhatsApp Cloud API (envio automático) | **Não ativado.** Lembretes iniciados pela empresa são cobrados por mensagem desde 07/2025. |
| E-mail transacional (Brevo/Resend, plano gratuito) | **Preparado para o futuro.** Exige conta e chave, que são credenciais. |
| Web Push (VAPID) | **Pendente, opcional.** Gratuito, mas precisa de Edge Function com agendamento. No iOS só funciona com a PWA instalada (16.4+). |
| Alertas no painel | **Implementado.** Sessões a confirmar em 48h, sessões a registrar, cobranças vencidas e recibos pendentes. |

## 6. NFS-e

Achados da pesquisa (detalhes em `CONFORMIDADE.md`):
- Existe API oficial (SEFIN Nacional). Ela exige certificado ICP-Brasil A1, pago (~R$ 160–235/ano), assinatura XML e mTLS.
- A API só atende municípios que usam o Emissor Nacional. Palhoça/SC, por exemplo, usa o sistema da IPM.
- Intermediários com cobertura multimunicipal custam a partir de ~R$ 95/mês. Nenhum tem plano gratuito em produção.

**Entregue:** módulo de controle com status a emitir / emitida / cancelada,
número, chave de acesso, anexos PDF/XML da nota emitida no portal da
prefeitura e pendências no painel. **Não há emissão nem simulação.**
O banco recusa nota "emitida" sem número e data. Ver `PENDENCIAS.md`.

## 7. Ambiente de desenvolvimento e testes

- **Supabase local via Docker:** inviável aqui, porque o registro de imagens está bloqueado.
- **Projeto Supabase gratuito novo:** recusado pela plataforma, porque a conta já tem 2 projetos ativos. É um bloqueio de decisão; ver `PENDENCIAS.md`.
- **Solução adotada:** Postgres 16 local com um *shim* fiel do Supabase (`supabase/local-shim`).
  - Inclui papéis `anon`/`authenticated`, `auth.uid()` lido do JWT, `storage.objects` e `storage.foldername`.
  - As migrations são as mesmas que vão para o Supabase.
  - Os testes SQL exercitam RLS exatamente como o PostgREST faz (`SET ROLE` + `request.jwt.claims`).
- **Testes de interface:** usam um backend falso em memória (`web/src/lib/mockBackend`) com as mesmas regras críticas. Valida fluxos e layout mobile, mas **não** substitui o teste de integração real (pendente).

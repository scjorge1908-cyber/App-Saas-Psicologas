# PsiConsultório

Agenda, pacientes, prontuário, documentos e controle financeiro para psicólogas.
Cada profissional tem uma conta isolada. Pacientes não fazem login: recebem um
link para confirmar ou cancelar a sessão.

> **Nome provisório.** O nome comercial é uma decisão pendente (`docs/PENDENCIAS.md`).

## Estado atual

| Item | Situação |
|------|----------|
| Banco (Supabase/Postgres): schema, RLS, regras, RPCs | Implementado e testado localmente |
| App web responsivo + PWA instalável | Implementado e testado (celular e desktop) |
| Projetos Android e iOS (Capacitor) | Gerados; **builds pendentes** (exigem Android SDK / macOS) |
| Projeto Supabase remoto | **Não criado.** A conta atingiu o limite de 2 projetos gratuitos ativos |
| Publicação web | **Não realizada** |
| Publicação nas lojas | **Não realizada** (taxas: Google US$ 25, Apple US$ 99/ano) |
| Emissão de NFS-e | **Não implementada.** Há módulo de acompanhamento de notas emitidas fora do sistema |

Detalhes em `docs/PROGRESSO.md` e `docs/PENDENCIAS.md`.

Repositório: https://github.com/scjorge1908-cyber/App-Saas-Psicologas. O GitHub Actions roda todos os testes a cada envio (`.github/workflows/ci.yml`) e publica o app de teste no GitHub Pages quando as variáveis do Supabase estiverem configuradas (`deploy-pages.yml`).

## Funcionalidades

- **Conta**
  - Cadastro, login, recuperação de senha e troca de senha.
  - Perfil com nome e CRP; o CRP é obrigatório no primeiro acesso.
- **Pacientes**
  - Cadastro com responsável legal, que é exigido para menores.
  - Pagador diferente do paciente.
  - Valor por sessão ou mensalidade.
  - Busca e situação (ativo, inativo, alta).
- **Agenda**
  - Visões de dia, semana (grade no desktop, lista no celular) e mês.
  - Recorrência semanal, quinzenal ou a cada 4 semanas.
  - Remarcação, cancelamento, encerramento de série e estender série.
  - Conflitos de horário bloqueados **no banco**.
  - Status: agendada, confirmada, atendida, falta e cancelada.
- **Confirmação e lembretes**
  - Link seguro (192 bits) que expira no início da sessão.
  - O link abre página pública com o mínimo de dados.
  - Mensagem pronta para o WhatsApp via `wa.me`. É envio **manual**, não automático.
  - Pendências no painel.
- **Prontuário**
  - Registros por tipo: demanda, objetivos, evolução, encaminhamento e encerramento.
  - Sem exclusão. Retificações ficam no histórico de versões.
  - Anexos em armazenamento privado.
- **Documentos em PDF**
  - Declaração, atestado, relatório, laudo, parecer, recibo e contrato.
  - Estrutura conforme a Res. CFP 06/2019.
  - A cópia imutável fica no prontuário com SHA-256.
- **Financeiro**
  - Cobrança automática ao registrar sessão atendida ou falta cobrada.
  - Cobranças manuais, como mensalidade ou pacote.
  - Recebimentos parciais e despesas.
  - Inadimplência e relatório mensal/anual, com exportação CSV.
  - Conferência do Receita Saúde para atendimento como pessoa física.
- **Notas fiscais**: controle de status, número, chave e anexos PDF/XML de NFS-e emitidas no portal municipal.
- **Dados**
  - Backup completo (ZIP com dados e arquivos) e restauração.
  - Trilha de auditoria sem conteúdo clínico.

## Estrutura

```
supabase/migrations/   SQL do banco (aplicar em ordem no Supabase)
supabase/tests/        testes SQL (RLS, agenda, confirmação, prontuário, financeiro, segurança)
supabase/local-shim/   emulação local de auth/storage do Supabase (só testes)
dev-gateway/           servidor local compatível com a API do Supabase (só desenvolvimento)
scripts/               db-test.sh, test-backup-restore.sh, e2e-db.sh, dev-up.sh
web/                   app React + TypeScript (Vite, Tailwind, PWA, Capacitor)
web/android, web/ios   projetos nativos gerados pelo Capacitor
docs/                  arquitetura, conformidade, segurança, testes, uso, pendências, progresso
docs/evidencias/       logs e capturas de tela dos testes
```

## Rodar localmente

Requisitos:
- Node 20+.
- PostgreSQL 15+ com `btree_gist` e `pgcrypto`.
- Acesso de superusuário local (`sudo -u postgres psql`).

```bash
cd web && npm install && cd ../dev-gateway && npm install && cd ..
cp web/.env.example web/.env.development.local   # e ajuste para o gateway local:
#   VITE_SUPABASE_URL=http://localhost:54321
#   VITE_SUPABASE_ANON_KEY=dev-anon-key
scripts/dev-up.sh                                # banco limpo + gateway + app
# abra http://127.0.0.1:5173
```

O gateway local aceita qualquer e-mail sem confirmação. Os links de recuperação
de senha aparecem em `http://localhost:54321/__mailbox`.

## Testes

```bash
scripts/db-test.sh                 # 159 asserções SQL (isolamento, regras, segurança)
scripts/test-backup-restore.sh     # exportação/importação e pg_dump/pg_restore
cd web
npx vitest run                     # unitários (formatação, fuso, PDFs)
npx vitest run --config vitest.integration.config.ts   # supabase-js real via gateway
CHROMIUM_PATH=/caminho/do/chrome npx playwright test   # E2E celular + desktop
```

Detalhes e limitações em `docs/TESTES.md`.

## Implantação

Passo a passo em `docs/IMPLANTACAO.md`: Supabase, hospedagem web, domínio, e-mail e builds Android/iOS.

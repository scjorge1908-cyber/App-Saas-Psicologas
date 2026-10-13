# Testes e evidências

Última execução completa: 12/10/2026. Logs em `docs/evidencias/`.

| Camada | O que cobre | Resultado | Evidência |
|--------|-------------|-----------|-----------|
| SQL (Postgres 16 + shim do Supabase) | Isolamento entre contas, anônimo, conflitos, recorrência, remarcação, confirmação por link, prontuário/versões, documentos, anexos, financeiro, NFS-e, regressão da auditoria | **159 asserções, 7 arquivos, todos passaram** | `resumo-sql.txt`, `testes-sql.log` |
| Backup e restauração | Export → banco novo vazio → import, com comparação de contagens, valores e textos clínicos; reimportação recusada; `pg_dump`/`pg_restore` | **Passou** | `teste-backup-restauracao.log` |
| Unitários (Vitest) | Dinheiro, CPF, CRP, fuso horário (inclusive horário de verão), datas, mensagens/WhatsApp, PDFs dos 7 tipos com extração de texto (`pdftotext`), numeração e rubrica, hash | **27 testes passaram** | `resumo-unitarios.txt`, PDFs em `web/test-results/pdf/` |
| Integração (supabase-js real) | Cadastro/login, perfil automático, CRP, isolamento via API, série com conflitos, confirmação anônima, storage com isolamento e tipos, recuperação de senha | **15 testes passaram** | `resumo-integracao.txt` |
| E2E (Playwright, Chromium) | 13 fluxos em tela de celular (Pixel 7) e 1 em desktop: cadastro → paciente → série → presença → cobrança → recebimento → lembrete → **paciente confirma pelo link** → prontuário com retificação → documento PDF → anexo → backup ZIP → **restauração em conta nova** → isolamento entre profissionais → agenda dia/semana/mês → ausência de rolagem horizontal | **14 testes passaram** | `resumo-e2e.txt`, capturas em `telas/` |
| Tipos e build | `tsc -b`, `vite build`, `cap sync` | OK | — |

## Critérios de conclusão do briefing

| Critério | Evidência |
|----------|-----------|
| Uma profissional não acessa dados de outra | `01_isolation.sql` (35 asserções), integração "Isolamento pela API", E2E "outra profissional não acessa os dados" |
| Conflitos e recorrências corretos | `02_agenda.sql` (sobreposição parcial e total, sessões encostadas, cancelada libera horário, séries semanal/quinzenal/4 semanas, data final, extensão, encerramento, alteração), E2E com conflito |
| Confirmações atualizam o agendamento | `03_confirmation.sql`, integração, E2E com o paciente em outro navegador |
| Registros clínicos e anexos restritos | `04_records.sql`, `06_hardening.sql`, integração de storage |
| Cálculos financeiros conferem | `05_finance.sql` (centavos, parcial, saldo, inadimplência, relatório e painel), unitário `sumMoney` |
| Documentos abrem e baixam | Unitário com `pdftotext`; E2E baixa o PDF emitido e a cópia guardada |
| Fluxos principais no celular | Todos os E2E em viewport 412×915 e verificação de rolagem horizontal em 7 telas |
| Backup e restauração em ambiente seguro | `test-backup-restore.sh` + E2E de restauração com arquivos |

## Ambiente de teste e limitações (leia antes de confiar nos resultados)

- **Postgres local + shim.** Não foi possível usar o Supabase real: o registro de imagens Docker está bloqueado e a conta atingiu o limite de projetos gratuitos.
  - As **migrations são as mesmas** que irão para o Supabase.
  - O shim reproduz papéis, `auth.uid()` via JWT e `storage.objects`, como o Supabase faz.
- **Gateway local (`dev-gateway/`).** Fala o protocolo HTTP do Supabase e executa cada requisição no Postgres **assumindo o papel do usuário**, como o PostgREST, com RLS real.
  - Implementa apenas o subconjunto de filtros usado pelo app.
  - Não envia e-mails: os links ficam em `/__mailbox`.
  - Aceita cadastro sem confirmação de e-mail.
- **Ainda não validado com o Supabase real:**
  - aplicação das migrations no Postgres 17 gerenciado;
  - advisors;
  - envio de e-mails;
  - políticas do Storage no serviço real.

  Primeiro passo após criar o projeto: `IMPLANTACAO.md`, etapa 1.
- O Chromium de teste mostra campos de data e hora no formato americano. Celulares configurados em português mostram dd/mm/aaaa.
- Builds Android/iOS não foram executados (ver `PENDENCIAS.md`).

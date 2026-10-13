# Registro de progresso

Legenda: **código** = implementado; **testado** = teste automatizado executado e
aprovado; **integração real** = validado em serviço externo real; **publicado**.

| Etapa | Situação | Evidência |
|-------|----------|-----------|
| 1. Arquitetura, escopo, critérios | Concluída | `ARQUITETURA.md`, pesquisas em `CONFORMIDADE.md`/`PENDENCIAS.md` |
| 2. Base, autenticação, isolamento | Código + testado | `01_isolation.sql`, integração, E2E |
| 3. Pacientes e agenda | Código + testado | `02_agenda.sql`, E2E |
| 4. Prontuário e documentos | Código + testado | `04_records.sql`, unitários de PDF, E2E |
| 5. Financeiro e NFS-e (acompanhamento) | Código + testado | `05_finance.sql`, E2E |
| 6. Confirmações e lembretes | Código + testado (link + `wa.me` manual) | `03_confirmation.sql`, integração, E2E |
| 7. Experiência mobile | PWA testada em viewport de celular; projetos Android/iOS gerados; **builds pendentes** | E2E celular, `web/android`, `web/ios` |
| 8. Testes, segurança, documentação | Concluída; auditoria independente com correções | `TESTES.md`, `SEGURANCA.md` |
| Integração real com Supabase | **Pendente** (decisão D1) | — |
| Publicação web / lojas | **Pendente** (D2, D3, taxas) | — |

## Decisões tomadas (resumo)

- Supabase com toda regra crítica no Postgres (RLS, FKs compostas, `EXCLUDE` para conflitos, gatilhos de guarda). Não há backend próprio.
- Recorrência materializada em ocorrências: 26 semanas para séries sem fim, com extensão.
- PDFs gerados no aparelho (pdf-lib) e cópia imutável com SHA-256.
- Lembretes por `wa.me` (manual). A API do WhatsApp é paga para lembretes.
- NFS-e: só acompanhamento. Emissão exige certificado e integração paga, e varia por município.
- Hospedagem recomendada: Cloudflare Pages (Vercel Hobby e GitHub Pages proíbem uso comercial).
- Ambiente de teste: Postgres local + shim + gateway compatível, porque Docker e um novo projeto Supabase estavam indisponíveis.

## Ponto de retomada

1. Resolver **D1** (projeto Supabase).
2. Aplicar as migrations, rodar os advisors e o teste de integração contra o projeto real (`IMPLANTACAO.md`, etapa 1).
3. Resolver **D2/D3/D4** e publicar a versão web de teste com dados fictícios.
4. Gerar o APK de debug numa máquina com Android Studio.
5. Revisão jurídica (D6) antes de qualquer dado real.

Para retomar o desenvolvimento local: `scripts/dev-up.sh` e, em seguida, os comandos de `README.md` → Testes.

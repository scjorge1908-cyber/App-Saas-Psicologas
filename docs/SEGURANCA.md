# Segurança

## Modelo

| Camada | Controle |
|--------|----------|
| Isolamento | RLS `owner_id = auth.uid()` em **todas** as tabelas (verificado em teste) e views com `security_invoker` |
| Integridade entre contas | FKs compostas `(x_id, owner_id)`. Mesmo com um id alheio, não há como vincular dados de outra conta |
| Anônimo | Sem acesso a tabelas. Executa apenas `get_confirmation` e `respond_confirmation` (verificado em teste) |
| Chaves | O frontend usa só a chave pública. A `service_role` nunca aparece no app nem no repositório |
| Funções privilegiadas | Toda `SECURITY DEFINER` usa `search_path = ''` e verifica `auth.uid()` |
| Prontuário | Sem DELETE nem para administrador. Retificação gera versão. Data de criação e versão são definidas pelo banco |
| Documentos | Imutáveis. Entrega registrada uma única vez com horário do servidor. PDF com SHA-256 |
| Arquivos | Bucket privado, pasta por conta, sem sobrescrita, limite de 10 MB e tipos permitidos. Arquivos de avaliação, documentos e notas não podem ser apagados |
| Link do paciente | 192 bits aleatórios. O banco guarda só o SHA-256. Expira no início da sessão. É invalidado ao remarcar, trocar o paciente, reativar ou cancelar pela profissional. Mostra apenas o primeiro nome do paciente |
| Auditoria | Tabela, id, ação, nomes das colunas alteradas, ator e horário. **Nunca** o conteúdo. Registra também visualização de prontuário, download de anexo, geração de documento e exportação |
| App | Sem cache offline de respostas da API (só o "esqueleto" do app), `referrer: no-referrer` e sessão limpa ao sair |

## Auditoria independente (12/10/2026)

Um agente revisor que não participou da construção analisou o código e executou
ataques em banco de teste. **Não encontrou caminho de acesso entre contas.**
Corrigido na migration `20261012000800_hardening.sql` e coberto pelo teste
`supabase/tests/06_hardening.sql`:

| Id | Severidade | Achado | Correção |
|----|-----------|--------|----------|
| H1 | Alta | `TRUNCATE` concedido a usuários: ignora RLS e apagaria todas as contas (não alcançável pela API) | TRUNCATE revogado, inclusive nos privilégios padrão |
| H2 | Alta | Sessão atendida podia ser excluída; anexo de avaliação podia ser desvinculado ou trocado de paciente | Sessões passadas ou registradas não são excluídas; desfazer status é bloqueado se houver prontuário vinculado; anexos protegidos são imutáveis |
| M1 | Média | Datas e versões de prontuário e documentos podiam ser forjadas; entrega podia ser apagada | Valores definidos por gatilho; entrega registrada uma única vez; restaurações marcadas `restored_from_backup` |
| M2 | Média | Link antigo continuava válido após trocar o paciente da sessão | Link invalidado ao trocar paciente ou reativar |
| L1 | Baixa | Arquivo de documento podia ser apagado do storage se mal categorizado | Política verifica vínculo com documentos e notas; documento exige anexo "documento emitido" |
| L2 | Baixa | `anon` com EXECUTE em funções internas (sem efeito prático) | Revogado; só as duas RPCs públicas |
| — | Info | Profissional podia gravar "resposta do paciente" | Esses campos só mudam pelo link |

**Riscos residuais**
- `flowType: 'implicit'` coloca tokens no fragmento da URL na recuperação de senha. Migrar para PKCE ao configurar o projeto real; ver pendências.
- O ator gravado na auditoria vem de configuração de sessão que só o servidor pode definir. Não é alterável pela API.

## Configurações obrigatórias no projeto Supabase (antes de dados reais)

1. Região **sa-east-1 (São Paulo)**.
2. Auth:
   - confirmação de e-mail **ligada**;
   - senha mínima de 10 caracteres;
   - `Site URL` e `Redirect URLs` com o domínio do app;
   - SMTP próprio (Brevo/Resend gratuitos), porque o SMTP embutido só envia a membros da equipe.
3. Rodar os *Security* e *Performance Advisors* após aplicar as migrations.
4. **Backups.** O plano gratuito não tem backup automático. Agendar `pg_dump` diário (ver `IMPLANTACAO.md`) ou contratar o plano Pro, que é pago e exige sua decisão.
5. Ativar MFA na conta administrativa do Supabase e do GitHub.

## Resposta a incidentes (resumo)

1. Conter: revogar chaves, bloquear contas afetadas e preservar logs.
2. Avaliar: dados, contas e titulares afetados e risco.
3. Comunicar cada psicóloga afetada (controladora) **em até 24 horas**. Ela tem 3 dias úteis para comunicar a ANPD e os titulares (Res. CD/ANPD 15/2024). A plataforma fornece as informações necessárias.
4. Registrar o incidente e as medidas, e corrigir a causa.

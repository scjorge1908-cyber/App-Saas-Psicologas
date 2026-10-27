# PsiConsultório — regras do projeto (definidas pelo Jorge em 27/10/2026)

**Antes de qualquer trabalho, leia `docs/HISTORICO-DECISOES.md`.** Ele registra cada mudança: o que foi feito, quando, por quê e quem autorizou.

## Regras obrigatórias

1. **Nenhuma alteração do sistema sem autorização do Jorge.** Isso vale para código, banco (migrations), publicação na Play, deploy e configuração. Pode-se investigar, ler, testar e propor livremente; para executar, é preciso a autorização dele nesta conversa.
2. **Registrar antes de publicar.** Antes de qualquer deploy, envio à Play, migration em produção ou outra operação, atualizar `docs/HISTORICO-DECISOES.md` com: data, o que mudou, por que mudou, quem pediu ou autorizou, e o PR ou versão correspondente.
3. **Ajustes e melhorias aprovados nunca são desfeitos.** Nada do que está no histórico pode ser retirado em refatorações, redesenhos ou novas entregas.
4. **Questionar antes de contrariar.** Se um pedido novo contradiz algo já registrado, não executar na hora. Responder citando o registro ("esse ajuste foi feito em tal data por tal motivo") e esperar a confirmação do Jorge.
5. **Não perder o fio da meada.** A conversa pode ser longa ou mudar de sessão: o histórico no GitHub é a fonte da verdade, não a memória da conversa.

## Regras que continuam valendo

- Desenvolvimento e testes só com dados fictícios. Segredos nunca no repositório nem no chat.
- O juntar (merge) dos PRs é feito pelo Jorge no GitHub.
- Publicação na Play: workflow `play-teste-interno.yml`; após cada envio, atualizar `ULTIMO_VERSION_CODE_ENVIADO`.

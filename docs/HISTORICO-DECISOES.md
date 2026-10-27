# Histórico de decisões e evoluções

Registro de **o que foi feito, quando, por quê e quem autorizou**. Toda mudança nova entra aqui **antes** de ser publicada (regras em `CLAUDE.md`).
Itens aprovados não podem ser desfeitos sem nova autorização do Jorge. Se um pedido novo contrariar um item daqui, citar o item e perguntar antes.

Legenda de situação: **Publicado** (na Play/produção) · **Pronto, não publicado** · **Em aberto** (aguardando decisão do Jorge).

---

## Em aberto — aguardando decisão do Jorge

### A1. Sessão marcada como Falta: o que aparece na agenda (27/10/2026)
- **Histórico:** às 16:03, olhando a agenda, o Jorge disse que a falta "não era para ficar aqui nesta tela aparecendo como falta", e que a informação deve ir para onde se decide se a sessão será cobrada e para o histórico de atendimentos. Na versão 20, interpretei isso como "sessão atendida ou com falta sai da agenda".
- **Esclarecimento do Jorge (16:54):** ele **não pediu para tirar o paciente da sessão**. A falta não deve ficar travada na tela da agenda; essa informação vai para outro lugar, que ainda vamos desenhar.
- **Proposta para aprovação:** o paciente continua no horário dele na agenda, com os botões Mover e WhatsApp, e sem o rótulo "Falta" travado. O registro da falta vai para o histórico do paciente e para o financeiro. O lugar próprio para as faltas será desenhado depois.
- **Situação:** nada foi alterado ainda. Aguardando autorização.

### A2. Botões "Editar grade" e "Encaixe" e linha do quinzenal com botões (27/10/2026)
- **Pedido:** modernizar os botões "Editar grade" e "Adicionar encaixe" e explicar o fluxo do encaixe (16:42).
- **Correção junto:** a linha apagada do paciente quinzenal, na semana em que ele não tem sessão, ganha os botões Mover e WhatsApp, valendo para a próxima sessão. O motivo é que os botões precisam estar sempre disponíveis, como pedido às 16:03.
- **Situação:** pronto na branch `agenda/botoes-encaixe`, com o **PR #5 aberto mas não juntado**. O PR foi criado pelo comando que o Jorge interrompeu às 16:50. **Não publicado.** Aguardando autorização; não juntar o PR #5 antes dela.

---

## 27/10/2026

| Versão / PR | O que mudou | Por quê / quem pediu | Situação |
|---|---|---|---|
| v17 | Agenda limpa, resumo do dia, selo on-line, ajuda guiada e telas responsivas | Ordem CX de UX/UI do Jorge | Publicado |
| PR #1 → v18 | Redesenho da agenda com a referência visual do Hope App: Semana \| Dia, linhas LIVRE (verde) e de paciente (azul) | Ordem CX "Redesign da agenda", com revisão visual antes do merge | Publicado |
| PR #2 → v19 | **Agenda:** semana começa hoje; sem seletor de sala e sem contadores; "+ Agendar" no LIVRE; quinzenal aparece toda semana, com "Livre · quinzenal" na semana alternada e linha apagada "próxima dd/mm"; selo "On-line" com câmera embaixo do horário. **Avisos:** sininho no cabeçalho, janela que abre ao abrir o app quando há pendências, bolinhas nos atalhos da tela Hoje, sem "Nova sessão". **Avulsos sem retorno:** pergunta se mantém na agenda ou dá alta. **Mover:** escolhe dia da semana e sala, depois modalidade e data de início, com datas ocupadas bloqueadas. **Cadastro pelo horário livre:** telefone obrigatório, máscaras, só datas livres, horário e local fixos, duração 30/45/50/60, modalidade obrigatória, Presencial/On-line, anexos no fim, corrigir logo após salvar. **Anexos:** laudo e encaminhamento podem ser excluídos, com aviso de risco (migration `20261027000900`) | Pedidos do Jorge durante a revisão visual no Preview | Publicado |
| PR #3 → v20 | **WhatsApp:** passa a abrir no app Android, que antes não abria nada; o botão abre um cartão com Confirmar presença, Avisar que não vou atender, Parabéns, Mensagem livre e Mover a sessão, com texto editável. **Sessão atendida ou com falta sai da agenda** (ver A1: precisa revisão) | Pedido do Jorge às 16:03 | Publicado |
| PR #4 → v21 | **Cartão Nota fiscal** no cadastro do paciente: quem paga (o paciente ou outra pessoa); com "Emitir nota fiscal" marcado, ficam obrigatórios nome, CPF, e-mail e endereço completo do tomador; botão para repetir o contato principal (migration `20261027001000`) | Pedido do Jorge às 16:26 | Publicado |

### Por que os botões WhatsApp e Mover não apareceram na v21
Os botões não foram retirados do código: existem em toda linha de paciente agendado ou confirmado. Na semana de 27/10 a 02/11 não havia linha assim:
- a sessão do Jorge (teste) foi marcada como Falta e, desde a v20, saiu da agenda (A1);
- a primeira sessão do Pedro (quinzenal) é só em 03/11, e na linha apagada do quinzenal não havia botões (corrigido em A2, não publicado).

## 26/10/2026 e antes
Base do app, autenticação, agenda, prontuário, financeiro, temas, grade de horários e envios à Play das versões 7 a 16. Os detalhes estão no histórico de commits e em `docs/PROGRESSO.md`.

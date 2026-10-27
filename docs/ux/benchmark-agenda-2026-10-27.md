# Agenda do PsiConsultório × mercado (27/10/2026)

Pedido do Jorge (27/10, 17:47): antes de novos ajustes, levantar tudo o que a agenda já faz e o que o mercado tem e nós não.
Referências: PsicoManager, Plenne, Corpora, Psicoplanner, Doctoralia (Brasil) e SimplePractice (EUA).

## O que a agenda já tem
- Grade por sala, dia, turno, duração e intervalo; horários LIVRES com "+ Agendar"
- Visões Semana (a partir de hoje) e Dia; cartão por dia e sala, com Manhã, Tarde e Noite
- Cadastro do paciente no próprio horário: só datas livres, horário e sala fixos, anexos de laudo e encaminhamento, nota fiscal PF/PJ
- Recorrência avulsa, semanal, quinzenal e mensal; quinzenais alternados no mesmo horário; conflito de horário bloqueado no banco
- Mover: uma sessão ou a série, com modalidade e data de início; datas ocupadas ficam bloqueadas
- Encaixe fora da grade
- Situações: agendada, confirmada, atendida, falta (com ou sem cobrança), cancelada (com cancelamento tardio)
- WhatsApp com mensagens prontas (confirmar presença com link, aviso de ausência, parabéns, mensagem livre); o paciente confirma ou cancela pelo link, sem login
- Sininho de avisos, pendências de registro e avulsos sem retorno (manter ou dar alta)
- Selo On-line com link da sala; idade e aniversário; registrar no prontuário a partir da sessão
- Funciona no celular (Play, teste interno) e no computador

## O que o mercado tem e nós não temos
| Recurso | Quem tem | Custo para nós |
|---|---|---|
| Lembrete **automático** por WhatsApp/SMS (sem tocar no botão) | PsicoManager, Plenne, SimplePractice | Pago (API do WhatsApp Business ou SMS por mensagem) |
| **Agendamento on-line pelo paciente** (link público com horários livres) | Doctoralia, SimplePractice, PsicoManager | Sem custo extra |
| **Bloqueio de agenda**: férias, feriados, folgas, indisponibilidade | Praticamente todos | Sem custo extra |
| **Visão do mês** | Praticamente todos | Sem custo extra |
| **Sincronizar com Google Agenda / Outlook / iCal** | SimplePractice, vários | Sem custo extra (exportar .ics); a sincronização nos dois sentidos dá mais trabalho |
| **Lista de espera** (paciente aguardando horário, avisar quando abrir vaga) | Alguns (SimplePractice tem pedidos de horário) | Sem custo extra |
| **Relatórios de ocupação e faltas** (taxa de faltas, horários ociosos) | Vários | Sem custo extra |
| **Notificação no celular** (push) de sessão próxima ou confirmação recebida | Apps móveis | Sem custo extra (Firebase) |
| **Teleconsulta integrada** (vídeo dentro do app) | SimplePractice, Plenne | Pago (serviço de vídeo); hoje usamos link externo |
| **Cobrança integrada** (Pix ou cartão gerado na sessão) | Asaas, PsicoManager | Taxa por cobrança |
| **Pacotes de sessões** (ex.: 4 sessões pagas, abatimento automático) | Alguns | Sem custo extra |
| **Política de cancelamento** mostrada ao paciente no link | SimplePractice | Sem custo extra |

## Sugestão de prioridade (para o Jorge decidir)
1. Bloqueio de agenda (férias, feriados, folgas)
2. Visão do mês
3. Agendamento on-line pelo paciente (link público)
4. Relatório de ocupação e faltas
5. Lista de espera
6. Exportar para o Google Agenda (.ics)
7. Lembrete automático (pago): só com decisão de custo

Nada aqui foi implementado. Cada item depende da autorização do Jorge.

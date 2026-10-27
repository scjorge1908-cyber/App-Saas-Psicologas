# PsiConsultório — Auditoria de UX/UI, responsividade e ajuda guiada (27/10/2026)

Ordem CX "Auditoria de UX/UI, design responsivo e ajuda guiada" (P0). **Só auditoria e proposta: nenhum código, banco ou produção foi alterado.**
Documento completo (com imagens): https://claude.ai/artifact/4nE9ZG5VrBrkx1ip2AN9Lw · Script: `docs/ux/auditar-ux.cjs` · Medições: `docs/ux/evidencias/`.

## Resumo
Nas larguras comuns (320 a 1280 px), nenhuma tela quebra. Os problemas que pesam:
1. Linha do horário livre quebra em celulares de até 360 px.
2. Com zoom de 200%, a barra inferior sobrepõe os rótulos e 7 telas rolam para o lado.
3. Cerca de metade dos textos está em px fixo e não acompanha a fonte do usuário.
4. Não existe nenhuma ajuda no app.
5. A data de nascimento implausível é aceita sem aviso.

O caso "0 anos" não é erro de cálculo: 1 dos 2 pacientes reais tem nascimento em 2026.

## Método
- Playwright (Chromium) em 11 telas + diálogo de agendamento, em 320/360/412/768/1280 px e 360 px com 200% de zoom.
- Medições por tela: rolagem lateral, controles fora da tela, cortes, alvos < 44 px e "N min" quebrado.
- axe-core 4.10 (WCAG 2.0/2.1/2.2 A/AA) em todas as telas a 360 px.
- Fonte do navegador em 200%.
- Uma consulta agregada ao banco, sem dados pessoais.
- Modo demonstração, com dados fictícios.

## O que preservar
- Tokens e quatro temas com contraste calculado.
- Nenhuma quebra estrutural entre 320 e 1280 px.
- Demonstração sem cadastro.
- Agenda nascida da grade.
- Situação sempre escrita, não só em cor.
- Prontuário sem exclusão e com histórico.
- Avisos após cada ação.
- Atualização automática pela Play.
- Prontuário a 2 toques da barra inferior.

## Diagnóstico
| # | Problema | Tipo | Evidência | Onde |
| --- | --- | --- | --- | --- |
| A | "Agendar paciente" ocupa metade da linha livre e quebra | Interface | Quebra em 320 e 360 px | `pages/AgendaPage.tsx` |
| B | "50 min" quebra | Interface | 33 ocorrências por semana em 320/360 px | `AgendaPage.tsx` |
| C | "0 anos" | Dado sem aviso | 1 de 2 pacientes reais nasceu em 2026; `ageOn` correto | `NewAppointmentDialog.tsx`, `PatientForm.tsx` |
| D | Excesso de rolagem | Fluxo | 33 livres × 6 sessões; 7.457 px de altura em 320 px | `AgendaPage.tsx` |
| E | Livre e ocupado com o mesmo peso | Interface | Fundo verde e botão cheio nos livres | `AgendaPage.tsx` |
| F1 | Zoom 200%: rótulos da barra inferior sobrepostos | Interface (crítico) | Captura em `evidencias/atual-zoom-barra.png` | `components/AppShell.tsx` |
| F2 | Zoom 200%: rolagem lateral em 7 telas | Interface | Config 128 px, financeiro 80, resumo 62, prontuários 52, boas-vindas 28, grade 3, agenda 2 | Várias |
| F3 | Faixa "Demonstração": botão com 33 px, transborda | Interface | Todas as telas | `AppShell.tsx` |
| G | Texto em px fixo | Acessibilidade | Fonte em 200%: 107 elementos ficam iguais e 103 crescem; 23 textos com 10–12 px | `text-[Npx]` |
| H | Alvos de 40 px | Interface | 45 de 80 controles da agenda < 44 px (passa no mínimo de 24 px) | `components/ui.tsx` |
| I | ARIA proibido no logotipo | Acessibilidade | axe `aria-prohibited-attr` em 10/10 telas | `AppShell.tsx` (`Marca`) |
| J | Contraste baixo nos dias sem atendimento | Acessibilidade | axe `color-contrast` | `AgendaPage.tsx` |
| K | Teclado pode cobrir campos | Risco | Sem `windowSoftInputMode` | `AndroidManifest.xml` |
| L | Sem ajuda no app | Fluxo | Nenhuma rota ou componente | — |
| M | Sessão on-line sem bloco cai em "Outros horários" | Fluxo | Demonstração, terça 14:00 | `AgendaPage.tsx` |
| N | "Resumo do dia" escondido em Mais | Fluxo | Tela inicial mudou para a agenda | `App.tsx`, `AppShell.tsx` |

## Prioridade e soluções
- **Crítica:**
  - A/B: linha livre de 48 px, hora e duração sem quebra, botão "+ Agendar" com contorno.
  - F1: barra inferior só com ícones quando o rótulo não cabe.
  - F2/F3: refluxo com `flex-wrap`, faixa de demonstração em duas linhas com botão de 44 px, tabelas viram cartões.
  - C: aviso "Confira a data de nascimento" quando a idade fica < 2 ou > 110, sem corrigir sozinho.
  - K: `adjustResize` e rolagem até o campo focado.
  - I: texto oculto no lugar do `aria-label`.
  - H: alvos de 44 px.
- **Alto impacto:**
  - D/E: até 3 livres por card com "+N livres"; sessões como destaque. Opção B: chips de horário.
  - G: escala em rem, piso de 12 px.
  - L: ajuda guiada.
  - N: cartão "Hoje" recolhível na agenda.
  - Primeiros passos.
- **Refinamento:**
  - J: dias sem atendimento com a cor `tinta-3` em vez de opacidade.
  - M: sessão on-line no card do período, com selo.
  - Configurações em seções recolhíveis.

## Responsividade
| Faixa | Organização |
| --- | --- |
| ~320 px | Uma coluna; rótulos curtos; barra inferior só com ícones se não couber |
| 360–430 px | Atual, sem quebras |
| 600–900 px (dobrável/grande) | Cards da agenda em 2 colunas; formulários em 2 colunas |
| Tablet | Menu lateral; agenda semanal em grade |
| Desktop | Menu lateral; largura máxima de leitura; prontuário em duas colunas |

Valem em todas as faixas:
- 200% de zoom sem rolagem lateral (WCAG 1.4.10).
- Orientação horizontal (barra ≤ 15% da altura).
- Áreas seguras.
- Teclado virtual.
- TalkBack e VoiceOver.
- Foco visível.
- Cor nunca sozinha.

## Ajuda guiada
1. **Primeiros passos:** cartão na agenda vazia com 4 tarefas reais que se marcam sozinhas (criar horários, agendar o primeiro paciente, ver na agenda, enviar a confirmação pelo WhatsApp). Pode ser ocultado.
2. **Tour opcional:** oferecido uma única vez, com 5 passos sobre a tela real. Tem Voltar, Próximo, Concluir e Pular. Componente próprio, sem biblioteca nova. Não mostra dado clínico real.
3. **Botão "?" no cabeçalho:** abre uma folha com "Como usar esta tela", "Ver tutorial" e "Dúvidas frequentes", conforme a tela. Não troca de tela nem apaga formulário.
4. **Mais → Ajuda e tutoriais:** todos os guias em texto, com busca. É a alternativa acessível ao tour e o lugar para refazê-lo.

Regras: abre sozinha no máximo uma vez, fecha com um toque, nunca bloqueia o trabalho e os textos ficam em `lib/ajuda.ts`.

## Plano técnico
| Entrega | Itens | Arquivos |
| --- | --- | --- |
| 1. Críticas | A, B, C, F1–F3, H, I, K | `AgendaPage.tsx`, `AppShell.tsx`, `ui.tsx`, `NewAppointmentDialog.tsx`, `PatientForm.tsx`, `AndroidManifest.xml`, `lib/format.ts` |
| 2. Rolagem e fonte | D, E, G, J, N | `AgendaPage.tsx`, `index.css`, varredura de `text-[Npx]` |
| 3. Ajuda | L e primeiros passos | `components/ajuda/*`, `lib/ajuda.ts`, `AppShell.tsx`, Mais |

**Testes (Playwright no CI):**
- Regressão visual nos 5 tamanhos e com 200% de zoom.
- Zero rolagem lateral e zero controle fora da tela.
- Alvos ≥ 44 px.
- axe sem violação séria.
- Fluxo completo: grade → agendar → WhatsApp → evolução → pagamento.
- Tour: abrir, fechar, pular e repetir sem perder dados.

**Manual em aparelho:** teclado sobre formulário, fonte do sistema no máximo e TalkBack.

**Riscos:**
- Px→rem mexe em muitas telas de uma vez (por isso fica na entrega 2, com comparação visual).
- Confirmar se o WebView aplica a fonte do sistema.
- Seletores do tour estáveis via `data-ajuda`.

**Indicadores:**
- ≥ 90% concluem as tarefas sem ajuda (sessão observada com 5 a 8 psicólogas).
- Prontuário em ≤ 3 ações (hoje: 2).
- Evolução simples em ~60 s.
- 0 controles cortados.
- 0 perda de dados.

Métricas de uso dentro do app exigem coleta de eventos. É uma decisão à parte, por envolver LGPD.

## Decisões do proprietário
- [ ] Livres: proposta A (linhas com "+N livres") ou B (chips)?
- [ ] Resumo do dia como cartão recolhível na agenda?
- [ ] Sessão on-line sem bloco no card do período, com selo?
- [ ] Autorizar as entregas 1, 2 e 3, em versões separadas?
- [ ] Sessão observada com psicólogas?

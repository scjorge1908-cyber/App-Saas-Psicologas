# PsiConsultório — Design System

Tokens e catálogo de componentes do app (React + Tailwind 4, web/Android/iOS via Capacitor).
Referência estrutural: **Material 3** para os tokens e **MUI** para a divisão e as props dos componentes.
Formato visual herdado do app interno da clínica (HopeCore): cabeçalho em degradê, cartão de boas-vindas
com faixa, banner com número grande, grade de atalhos, carteira escura com valores ocultos, itens com borda
de status, mini-KPIs e rótulos em caixa alta acima dos campos. A paleta é outra: não usa o verde-petróleo da clínica.

## Arquivos

| Arquivo | Papel |
|---|---|
| `styles.css` | **Fonte única**: tokens estruturais, 3 direções × claro/escuro e todas as classes de componente |
| `index.html` | Guia vivo: fundamentos + catálogo completo, Dev Mode (inspetor) e "Copiar como prompt" |
| `concept.html` | Duas telas de conceito (Hoje + Paciente) feitas só com componentes do DS |
| `icons.html` | Sprite SVG canônico (copiado no topo de `index.html` e `concept.html`) |
| `theme.js` | Seletor compartilhado de direção (`data-theme`) e modo (`data-mode`), salvo no navegador |

Abra `index.html` direto pelo navegador (`file://`); não há build. A "Prévia do conceito" fica no topo da
barra lateral e o conceito tem "Voltar ao guia de estilo".

## As três direções

Todas derivadas em **OKLCH** a partir de uma semente (matiz e croma fixos, luminosidade variando para
cada papel; modo escuro = mesmos matizes com luminosidade invertida). Mesma estrutura de componentes;
mudam cor, forma, elevação, fontes e traço dos ícones.

| Direção | `data-theme` | Semente / primária (claro) | Acento | Fontes (leitura + display) | Forma e elevação |
|---|---|---|---|---|---|
| **Lavanda serena** (padrão) | `lavanda` | `#674698` (oklch .47 .13 300) | malva `#8D5375` | Figtree + Fraunces | cantos 12–16, sombra suave, traço 1,75 |
| **Índigo noturno com coral** | `indigo` | `#44549D` (oklch .47 .12 272) | coral `#A64831` | Manrope + Newsreader | cantos 8–10, filete (borda) sem sombra em repouso, traço 2 |
| **Sálvia terrosa com terracota** | `salvia` | `#4F6236` (oklch .47 .07 128) | terracota `#9C522E` | Work Sans + Young Serif | cantos 16–20, botões em pílula, tonal sem sombra, traço 1,6 |

A display serifada só aparece em h1–h4 (marca, saudação, nome do paciente, títulos). Corpo, rótulos,
botões e valores usam a sans de leitura com algarismos tabulares.

## Contraste (WCAG, calculado)

Calculado a partir dos hex (luminância relativa sRGB) para as 6 combinações tema × modo. Todos os pares passam:
texto ≥ 4,5:1, bordas/ícones/indicadores ≥ 3:1. Mínimos encontrados:

- `--on-primary` sobre `--primary`: 6,7 (sálvia claro) a 8,9 (escuro)
- `--on-surface` sobre `--surface`: ≥ 14,7
- `--muted` sobre `--bg`: ≥ 5,9
- `--primary-ink` (primária como texto) sobre `--surface`: ≥ 7,5
- `--wallet-muted` (rótulos da carteira) sobre `--wallet`: ≥ 8,5
- pills de status (`--*-bg` / `--*-ink`): ≥ 8,0
- `--outline` e `--cancelada` sobre `--surface`: ≥ 3,6 (uso não textual)
- `--on-header` sobre as duas pontas do degradê do cabeçalho: ≥ 4,5

Ao mudar um token de cor, recalcule o par antes de publicar.

## Catálogo (Material + MUI)

- **Inputs:** Button, Button group, Icon button, FAB, Checkbox, Radio group, Switch, Select, Autocomplete, Slider, Text field, Toggle button, Rating
- **Data display:** Avatar, Badge, Chip (+ pills de status), Divider, List, Table, Tooltip, Typography, Icon
- **Feedback:** Alert, Dialog, Snackbar, Progress, Skeleton, Backdrop
- **Surfaces:** App bar, Card, Paper, Accordion
- **Navigation:** Bottom navigation, Drawer, Tabs, Menu, Link, Stepper, Speed dial
- **Layout (utilitários):** Box, Container, Grid, Stack
- **Extensões do app:** Banner de alerta, Item de sessão, Grade de atalhos, Carteira, Mini-KPIs, Linha do tempo (prontuário), Cabeçalho do paciente, Bottom sheet

## Regras de uso

- Componentes usam **só tokens** (`var(--…)`); nunca hex ou px soltos.
- Uma família de interação: a primária. O acento aparece na faixa do cartão de boas-vindas, em atalhos alternados e no Rating.
- Degradê só em: cabeçalho, faixa do cartão de boas-vindas, botão contained e carteira. Fundos são planos.
- Alvo de toque ≥ 48px; fonte base 16px; toque com `scale(var(--press-scale))` (.98).
- Valores financeiros **ocultos por padrão** (carteira); o olho alterna.
- Todo texto em português do Brasil; datas `dd/mm`; moeda `R$ 1.234,56`.

## Usar no app (React + Tailwind 4)

1. Copie os blocos de tokens de `styles.css` (seções 1 e 2) para o CSS global.
2. Exponha-os ao Tailwind:
   ```css
   @import "tailwindcss";
   @theme inline {
     --color-primary: var(--primary);
     --color-on-primary: var(--on-primary);
     --color-surface: var(--surface);
     --color-bg: var(--bg);
     --radius-lg: var(--r-lg);
     --font-sans: var(--font-body);
     --font-display: var(--font-display);
     /* … demais papéis */
   }
   ```
3. Defina `data-theme` e `data-mode` no `<html>` (como faz `theme.js`).
4. Para cada componente, use **Copiar como prompt** no `index.html` (React + Tailwind 4 já vem selecionado), ou
   **⤓ Instalar design system** para o conjunto inteiro.

## Como estender

- **Novo token:** acrescente a variável no grupo certo de `styles.css`. Se for cor, crie também o par `--on-*`
  em **todos os 6 blocos** (3 direções × claro/escuro) e confira o contraste.
- **Novo componente:** (1) bloco de classe em `styles.css` só com tokens; (2) `<section id="chave">` em
  `index.html` com variantes e estados, marcando os exemplos com `data-insp="chave"`; (3) entrada `SPECS.chave`
  (nome, arquivo, descrição, props, tokens, medidas); (4) link na barra lateral. O botão "Copiar como prompt"
  aparece sozinho.
- **Nova direção de tema:** copie um par de blocos `:root[data-theme="…"]` / `[data-mode="dark"]`, derive as cores
  de uma nova semente em OKLCH, ajuste forma/elevação/fontes e registre-a em `THEMES` (`theme.js`) e `TINFO` (`index.html`).
- **Novo ícone:** acrescente um `<symbol id="i-…" viewBox="0 0 24 24">` em `icons.html` e copie para os dois HTML.
  Estilo Material Symbols/Lucide, traço por token; nunca emoji.
- **Nomes semânticos:** `--primary`, `--falta-bg`, nunca `--roxo-500`.

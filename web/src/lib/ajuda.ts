// Textos de ajuda do app num só lugar (fácil de revisar sem mexer nas telas).
// Cada tela tem "como usar", um passeio opcional (quando existe) e dúvidas frequentes.
// Regra: frases curtas, nas palavras da psicóloga. Nada de dado clínico nos exemplos.

export interface Duvida { p: string; r: string }
export interface AjudaTela { titulo: string; comoUsar: string[]; passeio?: PasseioId; duvidas: Duvida[] }
export type PasseioId = 'agenda';
export interface PassoPasseio { alvo: string; titulo: string; texto: string }

export const PASSEIOS: Record<PasseioId, PassoPasseio[]> = {
  agenda: [
    { alvo: 'grade', titulo: 'Sua grade de horários', texto: 'Aqui você cria os dias, turnos e salas em que atende. A agenda mostra os horários livres a partir dela.' },
    { alvo: 'livre', titulo: 'Horário livre', texto: 'Linha verde é horário livre. Toque nela para marcar um paciente neste horário; dá para cadastrar o paciente na hora.' },
    { alvo: 'whats', titulo: 'Lembrete pelo WhatsApp', texto: 'Abre as mensagens prontas: confirmar presença, avisar que não vai atender ou mensagem livre. Também leva para mover a sessão.' },
    { alvo: 'nav-pacientes', titulo: 'Pacientes', texto: 'Cadastro, sessões, documentos e financeiro de cada paciente.' },
    { alvo: 'nav-mais', titulo: 'Mais opções', texto: 'Prontuário, notas fiscais, configurações e esta ajuda ficam em Mais. O Resumo do dia é a tela inicial e toda tela tem “Voltar ao Resumo”.' },
  ],
};

const AGENDA: AjudaTela = {
  titulo: 'Agenda',
  passeio: 'agenda',
  comoUsar: [
    'Use Semana para ver todos os dias e Dia para um dia só. As setas trocam a semana (ou o dia).',
    'Cada cartão é um dia de uma sala, com manhã, tarde e noite. Linha verde “LIVRE”: toque para agendar naquele horário.',
    'Linha azul é paciente: ⇄ move (dia, horário ou sala) e o botão verde abre o WhatsApp. Toque no nome para registrar atendida, falta ou cancelamento; depois de registrada, a sessão sai da agenda e fica no histórico do paciente.',
  ],
  duvidas: [
    { p: 'Como configuro meus horários?', r: 'Toque em “Grade”, no rodapé, escolha a sala, os dias, o turno, a duração e o intervalo, e salve. Os horários aparecem na agenda como livres.' },
    { p: 'Como agendo um paciente?', r: 'Toque numa linha verde “LIVRE”. Escolha um paciente cadastrado ou cadastre um novo no mesmo formulário.' },
    { p: 'Como envio a confirmação?', r: 'Toque no botão verde do WhatsApp na sessão e escolha "Confirmar presença". O app abre o WhatsApp com o lembrete e o link; o paciente confirma por ali.' },
    { p: 'O que é o Encaixe?', r: 'É uma sessão num horário que não está na sua grade (ex.: 12:30 ou um dia em que você não atende). Fica no Resumo do dia: toque em “Encaixe”, escolha o paciente (ou cadastre um novo), o dia e o horário. Regras: dentro do seu horário de atendimento (Configurações), nunca num horário que já passou e nunca coincidindo com outra sessão.' },
    { p: 'Por que um paciente aparece com “Sem próximo horário”?', r: 'Todo paciente ativo fica na agenda. O avulso que não tem mais sessão marcada continua no dia e horário da última sessão, com um alerta piscando. Toque nele para marcar um novo horário ou dar alta.' },
    { p: 'O que é “Começa dd/mm” e “Livre até dd/mm”?', r: 'É o paciente que só começa mais à frente: ele já aparece no horário dele. Até o início, o horário fica livre para encaixar outra pessoa só antes dessa data.' },
    { p: 'Como dou alta a um paciente?', r: 'Na agenda, toque em “Dar alta” e escolha o paciente. As sessões futuras saem da agenda, o horário fica livre e o paciente vai para a aba Inativos. Histórico, prontuário, documentos e financeiro continuam guardados.' },
    { p: 'Por que uma sessão aparece em “Outros horários”?', r: 'Ela foi marcada num turno sem grade naquele dia. Ela continua valendo; só não pertence a nenhum bloco da grade.' },
  ],
};

export const AJUDA: Array<{ rota: RegExp; ajuda: AjudaTela }> = [
  { rota: /^\/$/, ajuda: AGENDA },
  { rota: /^\/agenda\/horarios/, ajuda: {
    titulo: 'Grade e horários',
    comoUsar: ['Em “Bloqueios”, marque férias, feriados (há atalho para os nacionais) e folgas: a agenda não oferece esses horários.', 'Escolha a sala e os dias, depois o turno.', 'Ajuste início e término, a duração da sessão e o intervalo.', 'Confira a pré-visualização e toque em “Salvar e gerar grade”.', 'Toque num bloco da grade atual para mudar ou excluir.'],
    duvidas: [
      { p: 'Posso ter turnos diferentes em salas diferentes?', r: 'Sim. Gere um bloco por vez: escolha a sala, os dias e o turno de cada um.' },
      { p: 'Excluir um bloco apaga sessões?', r: 'Não. Só tira os horários livres daquele bloco. As sessões marcadas continuam.' },
    ] } },
  { rota: /^\/pacientes\/[^/]+/, ajuda: {
    titulo: 'Ficha do paciente',
    comoUsar: ['As abas reúnem resumo, sessões, prontuário, documentos, financeiro e anexos.', '“Agendar” marca uma sessão para este paciente.', '“Editar cadastro” muda dados e endereço (o CEP preenche o resto).'],
    duvidas: [{ p: 'Como registro uma evolução?', r: 'Abra a aba Prontuário e toque em “Adicionar evolução”. Preencha a queixa e salve. Rascunhos ficam no aparelho.' }] } },
  { rota: /^\/pacientes/, ajuda: {
    titulo: 'Pacientes',
    comoUsar: ['Busque pelo nome e toque no paciente para abrir a ficha.', 'Paciente novo nasce pelo agendamento: na agenda, “+ Agendar” num horário LIVRE, ou “Encaixe” no Resumo do dia.'],
    duvidas: [{ p: 'Posso excluir um paciente?', r: 'Só cadastros feitos por engano, sem prontuário, sessões ou valores. Os demais ficam guardados, como exige o CFP.' }] } },
  { rota: /^\/prontuario/, ajuda: {
    titulo: 'Prontuários',
    comoUsar: ['Cada card mostra a demanda principal, a última e a próxima sessão.', '“Evolução pendente” indica sessão atendida sem registro: toque em “Evoluir sessão”.', 'O olho oculta os resumos quando alguém pode ver a tela.'],
    duvidas: [
      { p: 'Como registro uma evolução?', r: 'Toque em “Evoluir sessão” ou abra o paciente e use “Adicionar evolução”. Só a queixa é obrigatória.' },
      { p: 'Posso apagar um registro?', r: 'Não: o prontuário é guardado (Res. CFP 001/2009). Use “Retificar”; a versão anterior fica no histórico.' },
    ] } },
  { rota: /^\/financeiro/, ajuda: {
    titulo: 'Financeiro',
    comoUsar: ['“A receber” lista o que está em aberto; “Receber” registra um pagamento.', 'Sessões atendidas geram o valor a receber sozinhas (pacientes por sessão).'],
    duvidas: [{ p: 'Como registro um pagamento?', r: 'Em “A receber”, toque em “Receber” na cobrança, confira o valor e a forma, e salve.' }] } },
  { rota: /^\/notas-fiscais/, ajuda: {
    titulo: 'Notas fiscais',
    comoUsar: ['Liste as notas a emitir e marque as emitidas.', 'A emissão pelo sistema nacional (NFS-e) está em preparação.'],
    duvidas: [] } },
  { rota: /^\/configuracoes/, ajuda: {
    titulo: 'Configurações',
    comoUsar: ['Abra a seção que quer mudar: perfil, agenda, aparência, backup ou segurança.', 'Cada seção tem o seu botão de salvar.'],
    duvidas: [{ p: 'Como deixo as letras maiores?', r: 'Aumente a fonte do celular nas configurações do sistema. O app acompanha.' }] } },
  { rota: /^\/resumo/, ajuda: {
    titulo: 'Resumo do dia',
    comoUsar: ['Atalhos com as pendências, valores do mês (ocultos até tocar no olho), Encaixe e Confirmar agenda.', '“Confirmar agenda” mostra as sessões de hoje, de amanhã ou de outro dia; o botão verde abre o WhatsApp com “Confirmar presença”.'],
    duvidas: [{ p: 'Como mando a confirmação um dia antes?', r: 'No Resumo do dia, toque em “Confirmar agenda”, escolha “Amanhã” e toque no botão verde do WhatsApp de cada paciente. Escolha “Confirmar presença”, confira o texto e toque em “Abrir no WhatsApp”.' }] } },
];

export const ajudaDaRota = (caminho: string): AjudaTela => AJUDA.find((a) => a.rota.test(caminho))?.ajuda ?? AGENDA;

/** Todas as dúvidas, para a página Ajuda e tutoriais (com a tela de origem). */
export const TODAS_DUVIDAS = AJUDA.flatMap((a) => a.ajuda.duvidas.map((d) => ({ ...d, tela: a.ajuda.titulo })));

// Preferências da ajuda no aparelho (nunca obrigatórias; falha de armazenamento = segue sem lembrar)
export function lerFlag(chave: string): boolean { try { return localStorage.getItem(chave) === '1'; } catch { return false; } }
export function gravarFlag(chave: string) { try { localStorage.setItem(chave, '1'); } catch { /* modo privado */ } }
export const FLAG_PASSEIO_OFERECIDO = 'psi.passeio.oferecido';
export const FLAG_PASSOS_OCULTOS = 'psi.passos.ocultos';
export const FLAG_WHATS_ENVIADO = 'psi.passo.whats';

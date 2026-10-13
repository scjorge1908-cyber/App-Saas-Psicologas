# Conformidade: LGPD e normas do CFP

> Esta análise identifica requisitos e riscos a partir de fontes oficiais
> consultadas em 12/10/2026. **Não substitui** a revisão por advogado nem a
> orientação do Conselho Regional de Psicologia. Itens não verificados em fonte
> oficial estão marcados.

## Requisitos e como o sistema atende

| Requisito | Norma | Implementação | Situação |
|-----------|-------|---------------|----------|
| Registro documental obrigatório e sigiloso, em papel ou informatizado | Res. CFP 001/2009, art. 1º | Prontuário por paciente, acesso só da dona da conta (RLS) | Implementado |
| Conteúdo mínimo: identificação, demanda e objetivos, evolução, encaminhamento/encerramento, cópias de documentos emitidos | Res. CFP 001/2009, art. 2º | Tipos de registro dedicados. O sistema avisa quando faltam demanda ou objetivos. Documentos emitidos são guardados no prontuário | Implementado |
| Guarda mínima de 5 anos | Res. CFP 001/2009, art. 4º; Res. CFP 06/2019, art. 15 | Registros e documentos não podem ser excluídos, nem por administrador (gatilhos). Prazo configurável de 5 a 30 anos | Implementado. Rotina de expurgo após o prazo **não** implementada (decisão consciente) |
| Material de avaliação com acesso exclusivo da psicóloga | Res. CFP 001/2009, art. 2º | Categoria "material de avaliação": protegida contra exclusão, desvinculação e alteração | Implementado |
| Acesso integral do usuário ao prontuário | Res. CFP 001/2009, art. 5º, II | Exportação completa (ZIP) para atender o pedido | Implementado. Exportação por paciente individual está **pendente** |
| Documentos: declaração, atestado, relatório, laudo, parecer, com elementos obrigatórios | Res. CFP 06/2019, arts. 8º a 14 | Modelos com os itens de cada tipo. A declaração não tem campo de sintomas e há aviso sobre o art. 9º | Implementado |
| Páginas numeradas, rubrica até a penúltima, local/data/assinatura na última, nome e CRP | Res. CFP 06/2019, art. 5º | PDF com "Página X de Y", campo de rubrica e bloco final de assinatura | Implementado |
| Prazo de validade e cláusula de sigilo | Res. CFP 06/2019, arts. 10 a 14 e 17 | Campos opcionais por documento | Implementado |
| Protocolo de entrega | Res. CFP 06/2019, art. 16 | "Registrar entrega", com data do servidor e registro único | Implementado |
| Responsável legal no atendimento de menor | Código de Ética (Res. CFP 010/2005), art. 8º | Exigido no cadastro de menor de 18 anos, com data da autorização e anexo | Implementado |
| Sigilo; não compartilhar prontuário automaticamente | Código de Ética, arts. 9º, 10 e 12 | Não existe compartilhamento entre contas | Implementado |
| Contrato informa os recursos tecnológicos e a proteção de sigilo | Res. CFP 09/2024, art. 7º | Modelo de contrato com cláusula de tecnologia e foro | Implementado (modelo) |
| Recibo pessoa física pelo Receita Saúde desde 01/2025 | IN RFB 2.240/2024 | O sistema **não** emite o recibo oficial. Lista recebimentos pendentes, com CPF de pagador e beneficiário, e permite marcar como emitido | Implementado (apoio) |
| Dado de saúde é sensível | LGPD, art. 5º, II; art. 11 | Isolamento, criptografia em trânsito, armazenamento privado e auditoria sem conteúdo | Implementado |
| Controlador × operador | LGPD, arts. 5º, 37 e 39 | Termos (minuta) definem a psicóloga como controladora e a plataforma como operadora | Minuta, **revisão jurídica pendente** |
| Direitos do titular × guarda obrigatória | LGPD, arts. 16, I e 18 | Exclusão bloqueada durante a guarda; exportação disponível | Implementado |
| Incidentes: comunicação em 3 dias úteis | Res. CD/ANPD 15/2024 | Procedimento descrito em `SEGURANCA.md` | Procedimento documentado |
| Transferência internacional | Res. CD/ANPD 19/2024 | Recomendado Supabase na região São Paulo (sa-east-1). Subprocessadores no exterior ainda precisam ser listados | **Pendente** |
| IA com dados de pacientes | Nota CFP de 03/07/2025 (não normativa) | O sistema não usa IA sobre dados de pacientes | Atendido por ausência |

## Riscos para revisão por advogado ou CRP

1. **Prazo de guarda.** Definir se a Lei 13.787/2018 (20 anos, prontuário digitalizado) se aplica ao prontuário psicológico nascido digital. O padrão hoje é 5 anos, configurável até 30.
2. **Falecimento da profissional ou encerramento da conta.** As normas consultadas não tratam do falecimento. É preciso definir em contrato a custódia, a entrega ao CRP ou ao espólio e o congelamento da conta.
3. **Plataforma como agente de alto risco.** A plataforma reúne dados sensíveis de muitas profissionais. Avaliar nomeação de encarregado, relatório de impacto e cláusulas-padrão com subprocessadores estrangeiros.
4. **Base legal para dados de criança.** Escolher entre consentimento específico (LGPD art. 14) e tutela da saúde (art. 11).
5. **Assinatura digital** de atestados e laudos entregues em meio digital. O sistema gera o PDF para assinatura externa (gov.br ou ICP-Brasil) e **não** a aplica.
6. **Normas não verificadas.** Confirmar o fim do cadastro e-Psi e possíveis alterações das Res. 005/2010 e 31/2022. O portal atosoficiais estava inacessível na pesquisa.
7. **Termos de uso e política de privacidade.** A minuta está em `/termos` e precisa de revisão antes de qualquer uso com dados reais.

## Fontes oficiais consultadas

- https://site.cfp.org.br/wp-content/uploads/2009/04/resolucao2009_01.pdf
- https://site.cfp.org.br/wp-content/uploads/2019/09/Resolução-CFP-n-06-2019-comentada.pdf
- https://site.cfp.org.br/wp-content/uploads/2012/07/codigo-de-etica-psicologia.pdf
- https://abmes.org.br/public/arquivos/legislacoes/Resolucao-cfp-009-2024-07-18.pdf (cópia da Res. CFP 09/2024)
- https://site.cfp.org.br/cfp-divulga-posicionamento-sobre-inteligencia-artificial-no-contexto-da-pratica-psicologica/
- https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13787.htm
- https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm
- https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/auditoria-fiscal/conformidade/perguntas-e-respostas-receita-saude
- https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis
- https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual

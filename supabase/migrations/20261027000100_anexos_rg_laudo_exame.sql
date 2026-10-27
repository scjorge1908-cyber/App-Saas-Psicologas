-- Novas categorias de anexo do paciente:
--   documento_identidade: RG/CNH enviados no cadastro (pode ser excluído)
--   laudo / exame: laudos e exames de outros profissionais; entram no prontuário e ficam guardados
-- Em arquivo separado: um valor novo de enum só pode ser usado depois de confirmado.
alter type public.attachment_category add value if not exists 'documento_identidade';
alter type public.attachment_category add value if not exists 'laudo';
alter type public.attachment_category add value if not exists 'exame';
-- Atualização (26/10, decisão de Jorge): o app só anexa laudo e encaminhamento médico.
-- documento_identidade e exame ficam sem uso no app (valor de enum não se remove com segurança).

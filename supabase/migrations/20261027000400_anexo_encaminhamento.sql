-- Encaminhamento médico como categoria de anexo (decisão de Jorge: anexar só laudos e encaminhamentos).
alter type public.attachment_category add value if not exists 'encaminhamento';

-- Anexos: aceita também planilhas (XLSX/XLS), Word antigo (DOC) e fotos de iPhone (HEIC/HEIF).
-- Motivo: avaliações do concorrente reclamam de anexos limitados a poucos formatos. Limite de 10 MB mantido.
update storage.buckets
   set allowed_mime_types = array[
         'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
         'text/xml', 'application/xml', 'text/plain',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-excel'
       ]
 where id = 'prontuario';

// Backup completo da conta: dados (JSON) + arquivos do storage, num ZIP.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { supabase, STORAGE_BUCKET } from './supabase';
import * as api from './api';

export interface BackupProgress { step: string; done: number; total: number }

export async function buildBackupZip(onProgress?: (p: BackupProgress) => void): Promise<Uint8Array> {
  onProgress?.({ step: 'Exportando dados', done: 0, total: 1 });
  const data = await api.exportAll();
  const attachments = (data.attachments as Array<{ storage_path: string; id: string }>) ?? [];
  const files: Record<string, Uint8Array> = {
    'dados.json': strToU8(JSON.stringify(data, null, 1)),
    'LEIA-ME.txt': strToU8(
      'Backup do PsiConsultório\n\n'
      + 'dados.json: todos os registros da conta (pacientes, agenda, prontuário com versões, documentos, financeiro, notas fiscais).\n'
      + 'arquivos/: anexos e documentos emitidos, pelo identificador do anexo.\n\n'
      + 'ATENÇÃO: este arquivo contém dados pessoais sensíveis de saúde (LGPD, art. 5º, II).\n'
      + 'Guarde em local protegido (pendrive criptografado ou nuvem com senha) e não envie por e-mail ou WhatsApp.\n',
    ),
  };
  let i = 0;
  for (const a of attachments) {
    onProgress?.({ step: 'Baixando arquivos', done: i++, total: attachments.length });
    const r = await supabase.storage.from(STORAGE_BUCKET).download(a.storage_path);
    if (r.error) throw r.error;
    files[`arquivos/${a.id}`] = new Uint8Array(await r.data.arrayBuffer());
  }
  onProgress?.({ step: 'Compactando', done: attachments.length, total: attachments.length });
  return zipSync(files, { level: 6 });
}

export async function restoreBackup(file: File, ownerId: string, onProgress?: (p: BackupProgress) => void): Promise<Record<string, number>> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let data: Record<string, unknown>;
  let blobs: Record<string, Uint8Array> = {};
  if (file.name.toLowerCase().endsWith('.json')) {
    data = JSON.parse(strFromU8(buf));
  } else {
    const z = unzipSync(buf);
    if (!z['dados.json']) throw new Error('Arquivo de backup inválido: dados.json não encontrado.');
    data = JSON.parse(strFromU8(z['dados.json']));
    blobs = z;
  }
  onProgress?.({ step: 'Restaurando dados', done: 0, total: 1 });
  const counts = await api.importAll(data);

  // Envia os arquivos para os novos caminhos (o banco já remapeou owner_id)
  const atts = (data.attachments as Array<{ id: string; storage_path: string; mime_type: string }>) ?? [];
  let i = 0;
  for (const a of atts) {
    onProgress?.({ step: 'Restaurando arquivos', done: i++, total: atts.length });
    const bytes = blobs[`arquivos/${a.id}`];
    if (!bytes) continue;
    const path = `${ownerId}${a.storage_path.slice(a.storage_path.indexOf('/'))}`;
    const up = await supabase.storage.from(STORAGE_BUCKET).upload(path, bytes, { contentType: a.mime_type, upsert: false });
    if (up.error && !/exists/i.test(up.error.message)) throw up.error;
  }
  return counts;
}

// Traduz erros do Supabase/Postgres para mensagens úteis em português.

interface AnyError {
  code?: string;
  message?: string;
  status?: number;
  error_code?: string;
  name?: string;
}

const AUTH_MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'User already registered': 'Já existe uma conta com este e-mail. Entre ou recupere a senha.',
  'Email not confirmed': 'Confirme seu e-mail pelo link enviado antes de entrar.',
  'Password should be at least 8 characters.': 'A senha precisa ter pelo menos 8 caracteres.',
  'New password should be different from the old password.': 'A nova senha precisa ser diferente da atual.',
};

export function errorMessage(err: unknown, fallback = 'Não foi possível concluir a operação.'): string {
  if (!err) return fallback;
  const e = err as AnyError;
  const msg = e.message ?? '';

  if (AUTH_MESSAGES[msg]) return AUTH_MESSAGES[msg];
  if (/rate limit/i.test(msg)) return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  if (/JWT expired|invalid JWT/i.test(msg)) return 'Sua sessão expirou. Entre novamente.';

  switch (e.code) {
    case '23P01':
      return 'Este horário já está ocupado por outra sessão. Escolha outro horário ou cancele a sessão existente.';
    case '23505':
      return 'Já existe um registro com estes dados.';
    case '23503':
      return 'Registro relacionado não encontrado ou sem permissão.';
    case '23514':
      if (/crp/i.test(msg)) return 'CRP inválido. Use o formato 06/123456.';
      if (/cpf/i.test(msg)) return 'CPF inválido. Informe os 11 números.';
      if (/phone/i.test(msg)) return 'Telefone inválido. Informe DDD + número.';
      if (/meeting_url/i.test(msg)) return 'O link da videochamada deve começar com https://';
      if (/emitted_has_number/i.test(msg)) return 'Para marcar como emitida, informe o número e a data da nota.';
      if (/access_key/i.test(msg)) return 'Chave de acesso inválida (44 a 50 números).';
      if (/size_bytes/i.test(msg)) return 'Arquivo acima do limite de 10 MB.';
      return 'Algum campo está com valor inválido. Revise e tente de novo.';
    case '42501':
      return 'Você não tem permissão para esta ação.';
    case 'P0001':
    case 'P0002':
    case '22023':
      return msg || fallback; // mensagens já escritas em português no banco
    case 'PGRST116':
      return 'Registro não encontrado.';
  }
  if (e.name === 'StorageApiError') {
    if (/mime/i.test(msg)) return 'Tipo de arquivo não permitido. Use PDF, imagem, XML, TXT ou DOCX.';
    if (/maximum allowed size/i.test(msg)) return 'Arquivo acima do limite de 10 MB.';
    if (/row-level security/i.test(msg)) return 'Sem permissão para salvar este arquivo.';
  }
  return fallback;
}

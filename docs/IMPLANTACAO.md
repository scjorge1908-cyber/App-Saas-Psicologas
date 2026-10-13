# Implantação

Nenhuma etapa abaixo foi executada. Todas dependem das decisões D1 a D4 de `PENDENCIAS.md`.

## 1. Supabase (banco, autenticação, arquivos)

1. Crie o projeto na região **South America (São Paulo) – sa-east-1**.
2. Aplique as migrations **em ordem**. Escolha uma das formas:
   - **Supabase CLI:**
     ```bash
     supabase link --project-ref <ref>
     supabase db push
     ```
     A CLI usa `supabase/migrations/`.
   - **SQL Editor:** cole cada arquivo de `supabase/migrations/`, do `000100` ao `000800`.
   - **Não** aplique `supabase/local-shim/` nem `supabase/tests/` em produção.
3. Confira em *Advisors → Security* e *Performance*. Não deve restar alerta de RLS.
4. Configure *Authentication*:
   - *Email*: confirmação ligada e senha mínima de 10 caracteres.
   - *URL Configuration*: `Site URL = https://app.seudominio.com.br` e Redirect URLs com `https://app.seudominio.com.br/**`.
   - *SMTP Settings*: credenciais do Brevo ou Resend (decisão D4).
5. Em *Project Settings → API*, copie a **URL** e a **publishable/anon key**. **Nunca** use a `service_role` no app.
6. **Teste de fumaça com dados fictícios.** Rode os testes de integração apontando para o projeto real:
   ```bash
   cd web
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> npx vitest run --config vitest.integration.config.ts
   ```
   - Com confirmação de e-mail ligada, o cadastro de teste não retorna sessão. Para o teste, desligue a confirmação **temporariamente** ou crie os usuários pelo painel.
   - O teste de recuperação de senha usa a caixa postal do gateway local e não funciona no projeto real; valide-o manualmente.
   - Apague os usuários de teste ao final (*Authentication → Users*).

## 2a. Ambiente de TESTE na Vercel (escolhido)

O `vercel.json` na raiz já define instalação, build, pasta de saída, rotas da SPA e cabeçalhos de segurança. Não é preciso mudar nada na importação.

1. Em vercel.com/new, importe `scjorge1908-cyber/App-Saas-Psicologas` e mantenha as configurações detectadas.
2. Em *Settings → Environment Variables*, cadastre:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_PUBLIC_APP_URL` (o endereço `https://<projeto>.vercel.app`)
3. Faça um novo deploy.

O plano Hobby da Vercel é **apenas para uso não comercial**: serve para testes. No lançamento comercial, use Vercel Pro ou Cloudflare Pages (seção 2b).

## 2b. App web em produção (Cloudflare Pages, recomendado)

1. Conecte o repositório no Cloudflare Pages.
2. Configure o build:
   - Diretório raiz: `web`
   - Comando de build: `npm ci && npm run build`
   - Saída: `dist`
3. Defina as variáveis de ambiente:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_PUBLIC_APP_URL=https://app.seudominio.com.br`
4. O arquivo `web/public/_redirects` (já incluído) faz as rotas da SPA funcionarem, por exemplo o link `/c/<token>`.
5. Aponte o domínio personalizado.

## 3. Backup do banco (plano gratuito não tem backup automático)

Execute diariamente, numa máquina de confiança, com a string de conexão (credencial):

```bash
pg_dump "postgresql://postgres:<SENHA>@db.<ref>.supabase.co:5432/postgres" \
  -Fc --schema=public --schema=auth --schema=storage -f backup-$(date +%F).dump
```

- Guarde os arquivos criptografados, pois contêm dados de saúde.
- Teste a restauração com `pg_restore` num banco separado, como faz `scripts/test-backup-restore.sh`.
- Os arquivos do Storage não entram no dump. Cada psicóloga pode baixar o backup completo (dados e arquivos) em *Configurações → Seus dados*.

## 4. Android

Requisitos: Android Studio e JDK 21.

```bash
cd web
VITE_PUBLIC_APP_URL=https://app.seudominio.com.br npm run build
npx cap sync android
npx cap open android    # Build → Generate Signed Bundle/APK
```

- Antes de publicar, troque o `appId` em `capacitor.config.ts`. Hoje é `br.com.psiconsultorio.app`, provisório.
- Ícones: gere os ícones nativos a partir de `web/public/icon-512.png`.

## 5. iOS

Requisitos: Mac com Xcode 26+.

```bash
cd web
npm run build
npx cap sync ios
npx cap open ios
```

- Para testar no próprio iPhone sem pagar, use o *Personal Team*. Os perfis expiram em 7 dias.
- TestFlight e App Store exigem o Apple Developer Program (US$ 99/ano).

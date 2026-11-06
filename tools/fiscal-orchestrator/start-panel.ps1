# Dashboard local para o orquestrador do PsiConsultorio.
# Uso: powershell -ExecutionPolicy Bypass -File tools\fiscal-orchestrator\start-panel.ps1
# Missões reais: acrescente -EnableRuns (consomem crédito Anthropic, teto estimado de US$ 0,50 POR MISSÃO).
param([switch]$EnableRuns)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Instale Node.js 22+." }
if ($EnableRuns) {
  if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { throw "Codex CLI indisponível. Execute codex login." }
  $secure = Read-Host "Cole a chave API do Workspace PsiConsultorio-IA (oculta)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $env:FISCAL_DASHBOARD_ENABLE_RUN = 'YES'
} else {
  $env:FISCAL_DASHBOARD_ENABLE_RUN = 'NO'
}
try {
  Write-Host "Painel: http://127.0.0.1:4876" -ForegroundColor Cyan
  Write-Host "O computador deve permanecer ligado e esta janela aberta para missões rodarem."
  node tools/fiscal-orchestrator/dashboard.mjs
} finally {
  Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:FISCAL_DASHBOARD_ENABLE_RUN -ErrorAction SilentlyContinue
}

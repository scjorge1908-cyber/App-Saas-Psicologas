# PsiConsultorio - Fiscal AI orchestrator (real mode) for Windows PowerShell.
# The Anthropic key is read as a SecureString, lives only in this process and is never
# written to disk, shell history, the repository or logs.
# Usage (from the repository root):
#   powershell -ExecutionPolicy Bypass -File tools\fiscal-orchestrator\run-real.ps1 -Check
#   powershell -ExecutionPolicy Bypass -File tools\fiscal-orchestrator\run-real.ps1 -Objective "Sua missao com dados ficticios"
param(
  [string]$Objective = "",
  [switch]$Check,
  [double]$MaxUsd = 0.50,
  [int]$MaxRounds = 3,
  [string]$Model = "claude-sonnet-4-5"
)
$ErrorActionPreference = "Stop"
if ($MaxUsd -le 0 -or $MaxUsd -gt 5) { throw "MaxUsd deve ser > 0 e <= 5 (limite do workspace PsiConsultorio-IA)." }
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { throw "Codex CLI nao instalado: npm i -g @openai/codex ; depois: codex login" }

if (-not $env:ANTHROPIC_API_KEY) {
  $secure = Read-Host "Cole a chave da API do workspace PsiConsultorio-IA (nao aparece na tela)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
$env:ANTHROPIC_MODEL = $Model
$env:FISCAL_AI_MAX_USD = "$MaxUsd"
$env:FISCAL_AI_MAX_ROUNDS = "$MaxRounds"
try {
  if ($Check) {
    node tools/fiscal-orchestrator/real-cli.mjs --check
  } else {
    if ($Objective.Length -lt 8) { throw "Informe -Objective com a missao (somente dados ficticios)." }
    $env:FISCAL_AI_REAL_MODE = "YES_I_ACCEPT_API_BILLING"
    node tools/fiscal-orchestrator/real-cli.mjs $Objective
    Write-Host "Evidencias: .fiscal-orchestrator-runs\<runId>.evidence.json"
  }
} finally {
  Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:FISCAL_AI_REAL_MODE -ErrorAction SilentlyContinue
}

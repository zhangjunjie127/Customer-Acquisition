$ErrorActionPreference = "Stop"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "未找到 Node.js。请在 Codex 环境中启动，或先安装 Node.js。"
  exit 1
}

Set-Location -LiteralPath $PSScriptRoot
& $node.Source (Join-Path $PSScriptRoot "server.js")

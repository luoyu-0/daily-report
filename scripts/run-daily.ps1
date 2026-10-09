$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$date = Get-Date -Format 'yyyy-MM-dd'
$logDir = Join-Path $projectRoot 'data\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
npm run daily -- --date $date *>&1 | Tee-Object -FilePath (Join-Path $logDir "$date.log")


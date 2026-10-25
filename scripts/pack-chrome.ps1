$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $taskRoot
try {
  & npm.cmd run locales:check
  if ($LASTEXITCODE -ne 0) { throw 'Localization check failed' }
  & npm.cmd run chrome:check
  if ($LASTEXITCODE -ne 0) { throw 'Chrome syntax check failed' }
  & npm.cmd run chrome:store:check
  if ($LASTEXITCODE -ne 0) { throw 'Chrome store check failed' }
  $taskVersion = (Get-Content -LiteralPath 'chrome-extension/manifest.json' -Raw | ConvertFrom-Json).version
  $taskFiles = @(Get-ChildItem -LiteralPath (Join-Path $taskRoot 'chrome-extension') -Force | ForEach-Object { $_.FullName })
  $taskOutput = Join-Path $taskRoot "media-bridge-$taskVersion.zip"
  Compress-Archive -LiteralPath $taskFiles -DestinationPath $taskOutput -Force
  Write-Host "Chrome review ZIP: $taskOutput"
  Write-Host 'Draft package only: complete docs/chrome-web-store.md before submitting.'
} finally { Pop-Location }

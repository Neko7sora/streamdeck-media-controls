param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [string]$NodePath = (node -p 'process.execPath')
)
$ErrorActionPreference = 'Stop'
$hostDir = Join-Path $env:LOCALAPPDATA 'StreamDeckMediaControls\native-host'
New-Item -ItemType Directory -Path $hostDir -Force | Out-Null
$nodeExe = (Resolve-Path -LiteralPath $NodePath).Path
if ($nodeExe.Contains('%') -or $hostDir.Contains('%')) { throw 'Paths containing % are unsupported' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'chrome-native-host.mjs') -Destination $hostDir -Force
$launcher = Join-Path $hostDir 'host.cmd'
$script = Join-Path $hostDir 'chrome-native-host.mjs'
[IO.File]::WriteAllText($launcher, "@echo off`r`n`"$nodeExe`" `"$script`"`r`n", [Text.Encoding]::Default)
$manifestPath = Join-Path $hostDir 'dev.local.media_controls.json'
$manifest = @{
  name = 'dev.local.media_controls'
  description = 'Stream Deck Media Controls native bridge'
  path = $launcher
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json
[IO.File]::WriteAllText($manifestPath, $manifest, (New-Object Text.UTF8Encoding($false)))
$key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\dev.local.media_controls'
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value $manifestPath
Write-Host 'Native Messaging host registered. Reload the Chrome extension.'

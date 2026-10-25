param(
  [ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [string]$NodePath = (node -p 'process.execPath'),
  [string]$ChromeUserDataDir = (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'),
  [switch]$DetectOnly
)
$ErrorActionPreference = 'Stop'

# Labels cannot authorize an extension. Require an ID verified by the user.
# ChromeUserDataDir is retained for CLI compatibility; profiles are not trusted.
if (-not $ExtensionId) {
  Write-Host 'Specify -ExtensionId with the verified ID from chrome://extensions.'
  exit 2
}
if ($ExtensionId -cnotmatch '^[a-p]{32}$') { throw 'Invalid extension ID' }
if ($DetectOnly) { $ExtensionId | Write-Output; exit 0 }

$nodeExe = (Resolve-Path -LiteralPath $NodePath).Path
$nodeMajor = & $nodeExe -p 'process.versions.node.split(String.fromCharCode(46))[0]'
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 24) { throw 'Node.js 24 or newer is required' }
$hostDir = Join-Path $env:LOCALAPPDATA 'StreamDeckMediaControls\native-host'
if ($nodeExe.Contains('%') -or $hostDir.Contains('%')) { throw 'Paths containing % are unsupported' }
New-Item -ItemType Directory -Path $hostDir -Force | Out-Null
$sourceScript = Join-Path $PSScriptRoot 'chrome-native-host.mjs'
$installedScript = Join-Path $hostDir 'chrome-native-host.mjs'
if (-not (Test-Path -LiteralPath $installedScript) -or (Get-FileHash -LiteralPath $sourceScript).Hash -ne (Get-FileHash -LiteralPath $installedScript).Hash) {
  Copy-Item -LiteralPath $sourceScript -Destination $installedScript -Force
}
function Write-IfChanged([string]$Path, [string]$Content, [Text.Encoding]$Encoding) {
  if (-not (Test-Path -LiteralPath $Path) -or [IO.File]::ReadAllText($Path) -cne $Content) { [IO.File]::WriteAllText($Path, $Content, $Encoding) }
}
$launcher = Join-Path $hostDir 'host.cmd'
$script = Join-Path $hostDir 'chrome-native-host.mjs'
Write-IfChanged $launcher "@echo off`r`n`"$nodeExe`" `"$script`"`r`n" ([Text.Encoding]::Default)
$manifestPath = Join-Path $hostDir 'dev.n7s.media_controls.json'
$manifest = [ordered]@{
  name = 'dev.n7s.media_controls'
  description = 'Stream Deck Media Controls native bridge'
  path = $launcher
  type = 'stdio'
  allowed_origins = @($ExtensionId | Sort-Object -Unique | ForEach-Object { "chrome-extension://$_/" })
} | ConvertTo-Json
Write-IfChanged $manifestPath $manifest (New-Object Text.UTF8Encoding($false))
$key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\dev.n7s.media_controls'
if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
if ((Get-Item -LiteralPath $key).GetValue('') -cne $manifestPath) { Set-Item -Path $key -Value $manifestPath }
Write-Host 'Native Messaging host registered. Enable sending in the Chrome extension options.'

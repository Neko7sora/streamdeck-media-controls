param(
  [ValidatePattern('^[a-p]{32}$')][string[]]$ExtensionId,
  [string]$NodePath = (node -p 'process.execPath'),
  [string]$ChromeUserDataDir = (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'),
  [switch]$DetectOnly
)
$ErrorActionPreference = 'Stop'

# Inspect only extension settings. Never modify Chrome's profile files.
if (-not $ExtensionId) {
  $detected = @()
  if (Test-Path -LiteralPath $ChromeUserDataDir) {
    $profiles = Get-ChildItem -LiteralPath $ChromeUserDataDir -Directory | Where-Object { $_.Name -eq 'Default' -or $_.Name -match '^Profile \d+$' }
    foreach ($profile in $profiles) {
      foreach ($prefName in @('Preferences', 'Secure Preferences')) {
        $prefPath = Join-Path $profile.FullName $prefName
        if (-not (Test-Path -LiteralPath $prefPath)) { continue }
        try { $prefs = Get-Content -LiteralPath $prefPath -Raw -Encoding UTF8 | ConvertFrom-Json }
        catch { continue } # Chrome may be replacing the file; retry on the next attempt.
        foreach ($entry in $prefs.extensions.settings.PSObject.Properties) {
          if ($entry.Name -notmatch '^[a-p]{32}$' -or $entry.Value.state -eq 0) { continue }
          $extension = $entry.Value
          $extensionManifest = $extension.manifest
          if (-not $extensionManifest.name -and $extension.path) {
            $extensionPath = $extension.path
            if (-not [IO.Path]::IsPathRooted($extensionPath)) { $extensionPath = Join-Path (Join-Path $profile.FullName 'Extensions') $extensionPath }
            try { $extensionManifest = Get-Content -LiteralPath (Join-Path $extensionPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json }
            catch { continue }
          }
          if ($extensionManifest.name -eq 'Stream Deck Media Metadata Bridge (Local)' -and
              $extensionManifest.permissions -contains 'nativeMessaging' -and
              $extensionManifest.background.service_worker -eq 'background.js') { $detected += $entry.Name }
        }
      }
    }
  }
  $ExtensionId = @($detected | Sort-Object -Unique)
}
if (-not $ExtensionId) {
  Write-Host 'Chrome media extension not found yet; load chrome-extension in Chrome first.'
  exit 2
}
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

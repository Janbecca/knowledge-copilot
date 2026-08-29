param(
  [Parameter(Mandatory = $true)][string]$AppPath,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId
)

$resolvedApp = (Resolve-Path -LiteralPath $AppPath).Path
$bridgeRoot = Join-Path $env:LOCALAPPDATA 'KnowledgeCopilot\NativeMessaging'
$manifestPath = Join-Path $bridgeRoot 'xyz.knowledge_copilot.desktop.json'
$templatePath = Join-Path $PSScriptRoot '..\apps\chatgpt-extension\native-host-manifest.template.json'

New-Item -ItemType Directory -Path $bridgeRoot -Force | Out-Null
$manifest = Get-Content -LiteralPath $templatePath -Raw
$escapedPath = $resolvedApp.Replace('\', '\\')
$manifest = $manifest.Replace('__APP_PATH__', $escapedPath).Replace('__EXTENSION_ID__', $ExtensionId)
[System.IO.File]::WriteAllText($manifestPath, $manifest, [System.Text.UTF8Encoding]::new($false))

$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\xyz.knowledge_copilot.desktop'
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath

Write-Host "Native Messaging host installed for extension $ExtensionId"
Write-Host "Manifest: $manifestPath"

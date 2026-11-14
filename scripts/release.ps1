# Construit une version publiable d'iBox : installeur + paquet de mise à jour signé.
#
#   .\scripts\release.ps1 -UpdateUrl "https://…/latest.json"
#
# La clé privée de signature reste HORS du projet (par défaut dans
# Documents\iBox-sauvegarde\signature) ; elle n'est jamais copiée ni versionnée.
# -UpdateUrl : adresse où sera publié latest.json (iBox y vérifie les mises à jour).
param(
  [Parameter(Mandatory = $true)][string]$UpdateUrl,
  [string]$KeyPath = "$env:USERPROFILE\Documents\iBox-sauvegarde\signature\ibox-updater.key",
  [string]$Notes = ""
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $KeyPath)) { throw "Clé de signature introuvable : $KeyPath" }
$manifestUrl = $null
if (-not [uri]::TryCreate($UpdateUrl, [UriKind]::Absolute, [ref]$manifestUrl) -or
    $manifestUrl.Scheme -ne "https" -or $manifestUrl.Segments[-1] -ne "latest.json") {
  throw "Indiquez l'adresse HTTPS complète du fichier latest.json."
}

$previousKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousUrl = $env:IBOX_UPDATE_URL
Push-Location (Join-Path $PSScriptRoot "..")
try {
  $env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path -LiteralPath $KeyPath).Path
  $env:IBOX_UPDATE_URL = $manifestUrl.AbsoluteUri
  $config = Get-Content -Raw "src-tauri/tauri.conf.json" | ConvertFrom-Json
  $targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { "src-tauri/target" }
  $bundle = Join-Path $targetDir "release/bundle/nsis"

  npx tauri build --bundles nsis
  if ($LASTEXITCODE -ne 0) { throw "Échec de la compilation Tauri (code $LASTEXITCODE)." }

  $name = "iBox_$($config.version)_x64-setup.exe"
  $installer = Get-Item -LiteralPath (Join-Path $bundle $name)
  $signature = (Get-Content -LiteralPath "$($installer.FullName).sig" -Raw).Trim()
  if (-not $signature) { throw "La signature Tauri est vide." }

  $installerUrl = [uri]::new($manifestUrl, $name).AbsoluteUri
  if ($manifestUrl.Host -eq "github.com" -and $manifestUrl.AbsolutePath -match '^/[^/]+/[^/]+/releases/latest/download/latest\.json$') {
    $releasePath = $manifestUrl.AbsolutePath -replace '/latest/download/latest\.json$', "/download/v$($config.version)/"
    $installerUrl = [uri]::new($manifestUrl, "$releasePath$name").AbsoluteUri
  }

  $manifest = @{
    version = $config.version
    notes = $Notes
    pub_date = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = @{
      "windows-x86_64" = @{
        signature = $signature
        url = $installerUrl
      }
    }
  }
  $manifestPath = Join-Path $installer.DirectoryName "latest.json"
  [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5))
  Write-Host "Publiez d'abord $($installer.FullName), puis $manifestPath."
} finally {
  $env:TAURI_SIGNING_PRIVATE_KEY = $previousKey
  $env:IBOX_UPDATE_URL = $previousUrl
  Pop-Location
}

# Construit puis publie une version d'iBox sur https://github.com/atzski/ibox/releases.
#
#   1. .\scripts\release.ps1            construit release\v<version>\ et vérifie tout
#   2. (relire release\v<version>\NOTES.md)
#   3. .\scripts\release.ps1 -Publish   publie ce dossier, sans rien reconstruire
#
# Garanties :
#   - les notes viennent uniquement de src/content/changelog.ts (entrée de la version) ;
#   - les chemins de compilation (nom d'utilisateur Windows) sont effacés du binaire ;
#   - avant de construire et avant de publier, le binaire, l'installeur, la signature et
#     latest.json sont analysés : nom d'utilisateur, dossier personnel, nom du PC, e-mail
#     et nom git. Une seule trace bloque tout ;
#   - la clé privée de signature reste HORS du projet et n'est jamais copiée.
#
# Les versions <= 0.1.46 vérifient leurs mises à jour sur atzski/inbox-releases.
# -Publish y dépose donc aussi latest.json seul (il pointe vers l'installeur sur atzski/ibox),
# pour que ces utilisateurs reçoivent la mise à jour. Les versions suivantes ne lisent que
# atzski/ibox. -NoBridge désactive ce relais, quand plus personne n'a de version <= 0.1.46.
param(
  [switch]$Publish,
  [switch]$NoBridge,
  [string]$Repo = "atzski/ibox",
  [string]$LegacyRepo = "atzski/inbox-releases",
  [string]$KeyPath = "$env:USERPROFILE\Documents\iBox-sauvegarde\signature\ibox-updater.key"
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# ——— Version et notes ———
function Get-Version {
  $tauri = (Get-Content -Raw "$root\src-tauri\tauri.conf.json" | ConvertFrom-Json).version
  $npm = (Get-Content -Raw "$root\package.json" | ConvertFrom-Json).version
  $cargo = [regex]::Match((Get-Content -Raw "$root\src-tauri\Cargo.toml"), '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
  if ($tauri -ne $npm -or $tauri -ne $cargo) {
    throw "Versions différentes : tauri.conf.json $tauri, package.json $npm, Cargo.toml $cargo."
  }
  if ($tauri -notmatch '^\d+\.\d+\.\d+$') { throw "Version invalide : $tauri" }
  $tauri
}

function Get-Highlights([string]$version) {
  $changelog = Get-Content -Raw -Encoding UTF8 "$root\src\content\changelog.ts"
  $block = [regex]::Match($changelog, 'version:\s*"' + [regex]::Escape($version) + '"(?<body>[\s\S]*?)(?=\{\s*version:|\];)')
  if (-not $block.Success) { throw "Ajoutez l'entrée $version dans src/content/changelog.ts avant de publier." }
  $items = [regex]::Matches($block.Groups["body"].Value, 'title:\s*"(?<t>[^"]+)",\s*text:\s*"(?<x>[^"]+)"')
  if ($items.Count -eq 0) { throw "L'entrée $version de changelog.ts n'a aucune nouveauté." }
  @($items | ForEach-Object { [pscustomobject]@{ Title = $_.Groups["t"].Value; Text = $_.Groups["x"].Value } })
}

# ——— Analyse des fuites d'informations personnelles ———
function Get-Needles {
  $list = [Collections.Generic.List[string]]::new()
  foreach ($value in @($env:USERNAME, $env:USERPROFILE, $env:COMPUTERNAME)) {
    if ($value -and $value.Length -ge 4) { $list.Add($value) }
  }
  $email = (git -C $root config user.email) 2>$null
  if ($email -and $email -notmatch 'users\.noreply\.github\.com$') {
    $list.Add($email)
    $local = $email.Split("@")[0]
    if ($local.Length -ge 5) { $list.Add($local) }
  }
  $name = (git -C $root config user.name) 2>$null
  if ($name -and $name -notin @("Votre nom", "atzski") -and $name.Length -ge 4) { $list.Add($name) }
  $list | Select-Object -Unique
}

function Assert-NoLeak([string[]]$files) {
  $latin1 = [Text.Encoding]::GetEncoding(28591)
  $needles = Get-Needles
  foreach ($file in $files) {
    $text = $latin1.GetString([IO.File]::ReadAllBytes($file))
    foreach ($needle in $needles) {
      $forms = @($needle, $latin1.GetString([Text.Encoding]::Unicode.GetBytes($needle)), $latin1.GetString([Text.Encoding]::UTF8.GetBytes($needle)))
      foreach ($form in $forms) {
        $at = $text.IndexOf($form, [StringComparison]::OrdinalIgnoreCase)
        if ($at -ge 0) {
          $count = ([regex]::Matches($text, [regex]::Escape($form), "IgnoreCase")).Count
          throw "Information personnelle trouvée dans $(Split-Path -Leaf $file) ($count occurrence(s)). Rien n'est publié."
        }
      }
    }
  }
  Write-Host "Analyse : aucune information personnelle dans $($files.Count) fichier(s)."
}

function Find-Gh {
  $command = Get-Command gh -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $default = "$env:ProgramFiles\GitHub CLI\gh.exe"
  if (Test-Path $default) { return $default }
  throw "GitHub CLI (gh) est introuvable. Installez-le : winget install --id GitHub.cli"
}

$version = Get-Version
$tag = "v$version"
$name = "iBox_${version}_x64-setup.exe"
$updateUrl = "https://github.com/$Repo/releases/latest/download/latest.json"
$installerUrl = "https://github.com/$Repo/releases/download/$tag/$name"
$out = Join-Path $root "release\$tag"
$highlights = Get-Highlights $version

if (-not $Publish) {
  # ——— Construction ———
  if (-not (Test-Path $KeyPath)) { throw "Clé de signature introuvable : $KeyPath" }
  if (git -C $root status --porcelain) { Write-Warning "Des modifications ne sont pas commitées : le code publié sur GitHub doit correspondre à cette version." }

  $saved = @{}
  foreach ($var in "TAURI_SIGNING_PRIVATE_KEY", "IBOX_UPDATE_URL", "CARGO_ENCODED_RUSTFLAGS", "CARGO_TARGET_DIR") {
    $saved[$var] = [Environment]::GetEnvironmentVariable($var)
  }
  $cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { "$env:USERPROFILE\.cargo" }
  $rustupHome = if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { "$env:USERPROFILE\.rustup" }
  # La dernière règle qui correspond l'emporte : de la plus générale à la plus précise.
  $remaps = @(
    "--remap-path-prefix=$env:USERPROFILE=C:\build",
    "--remap-path-prefix=$cargoHome=C:\cargo",
    "--remap-path-prefix=$rustupHome=C:\rustup",
    "--remap-path-prefix=$root=C:\ibox"
  )
  $target = Join-Path $root "src-tauri\target\publish"
  Push-Location $root
  try {
    $env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path -LiteralPath $KeyPath).Path
    $env:IBOX_UPDATE_URL = $updateUrl
    $env:CARGO_ENCODED_RUSTFLAGS = $remaps -join [char]0x1f
    $env:CARGO_TARGET_DIR = $target   # dossier séparé : n'oblige pas à tout recompiler en développement

    npx tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "Échec de la compilation Tauri (code $LASTEXITCODE)." }
  } finally {
    foreach ($var in $saved.Keys) { [Environment]::SetEnvironmentVariable($var, $saved[$var]) }
    Pop-Location
  }

  $exe = Join-Path $target "release\ibox.exe"
  $installer = Join-Path $target "release\bundle\nsis\$name"
  $signature = (Get-Content -LiteralPath "$installer.sig" -Raw).Trim()
  if (-not $signature) { throw "La signature Tauri est vide." }
  $latin1 = [Text.Encoding]::GetEncoding(28591)
  if ($latin1.GetString([IO.File]::ReadAllBytes($exe)).IndexOf($updateUrl) -lt 0) {
    throw "L'adresse de mise à jour n'est pas intégrée au programme."
  }
  # L'interface (dist) est compressée dans le programme : on l'analyse avant compression.
  $front = @(Get-ChildItem -LiteralPath "$root\dist" -Recurse -File -Include *.js, *.html, *.css, *.json, *.svg | ForEach-Object FullName)
  Assert-NoLeak (@($exe, $installer, "$installer.sig") + $front)

  if (Test-Path $out) { Remove-Item -LiteralPath $out -Recurse -Force }
  New-Item -ItemType Directory -Force $out | Out-Null
  Copy-Item -LiteralPath $installer, "$installer.sig" -Destination $out

  $plain = ($highlights | ForEach-Object { "$($_.Title) : $($_.Text)" }) -join "`n"
  $manifest = [ordered]@{
    version = $version
    notes = $plain
    pub_date = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = @{ "windows-x86_64" = [ordered]@{ signature = $signature; url = $installerUrl } }
  }
  $utf8 = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText("$out\latest.json", ($manifest | ConvertTo-Json -Depth 5), $utf8)

  $hash = (Get-FileHash -LiteralPath "$out\$name" -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText("$out\SHA256SUMS.txt", "$hash  $name`n", $utf8)

  $notes = @("## Nouveautés", "") + ($highlights | ForEach-Object { "- **$($_.Title)** : $($_.Text)" }) + @(
    "", "## Installation", "",
    "Téléchargez **$name** ci-dessous (Windows 10 et 11, 64 bits).",
    "Si iBox est déjà installé, la mise à jour est proposée automatiquement.",
    "", "Empreinte SHA-256 : ``$hash``")
  [IO.File]::WriteAllText("$out\NOTES.md", ($notes -join "`n"), $utf8)

  Assert-NoLeak @(Get-ChildItem -LiteralPath $out -File | ForEach-Object FullName)
  Write-Host ""
  Write-Host "Version $version prête dans $out"
  Write-Host "Relisez NOTES.md, puis publiez avec : .\scripts\release.ps1 -Publish"
  return
}

# ——— Publication ———
$files = @("$out\$name", "$out\$name.sig", "$out\latest.json", "$out\SHA256SUMS.txt")
foreach ($file in $files + "$out\NOTES.md") {
  if (-not (Test-Path -LiteralPath $file)) { throw "Fichier manquant : $file. Lancez d'abord .\scripts\release.ps1" }
}
$manifest = Get-Content -Raw -LiteralPath "$out\latest.json" | ConvertFrom-Json
if ($manifest.version -ne $version -or $manifest.platforms."windows-x86_64".url -ne $installerUrl) {
  throw "latest.json ne correspond pas à la version $version sur $Repo."
}
$hash = (Get-FileHash -LiteralPath "$out\$name" -Algorithm SHA256).Hash.ToLowerInvariant()
if ((Get-Content -Raw "$out\SHA256SUMS.txt") -notmatch "^$hash ") { throw "L'installeur a changé depuis la construction." }
Assert-NoLeak ($files + "$out\NOTES.md")

$gh = Find-Gh
& $gh auth status *> $null
if ($LASTEXITCODE -ne 0) { throw "Connectez GitHub CLI une fois : gh auth login" }
& $gh release view $tag --repo $Repo *> $null
if ($LASTEXITCODE -eq 0) { throw "La release $tag existe déjà sur $Repo." }

& $gh release create $tag @files --repo $Repo --title "iBox $version" --notes-file "$out\NOTES.md" --latest
if ($LASTEXITCODE -ne 0) { throw "Échec de la publication sur $Repo." }
Write-Host "Publiée : https://github.com/$Repo/releases/tag/$tag"

if (-not $NoBridge) {
  & $gh release view $tag --repo $LegacyRepo *> $null
  if ($LASTEXITCODE -ne 0) {
    $bridge = "Relais de mise à jour pour les versions 0.1.46 et antérieures. iBox est désormais publié sur https://github.com/$Repo/releases"
    & $gh release create $tag "$out\latest.json" --repo $LegacyRepo --title "iBox $version" --notes $bridge --latest
    if ($LASTEXITCODE -ne 0) { throw "Release publiée sur $Repo, mais le relais $LegacyRepo a échoué : relancez la commande ci-dessus à la main." }
    Write-Host "Relais publié sur $LegacyRepo (latest.json seul)."
  }
}

$online = Invoke-RestMethod -Uri $updateUrl -Headers @{ "User-Agent" = "ibox-release" }
if ($online.version -ne $version) { Write-Warning "En ligne, latest.json annonce encore $($online.version)." }
else { Write-Host "Vérifié : $updateUrl annonce $version." }

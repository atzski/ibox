# Construit puis publie une version d'iBox sur https://github.com/atzski/ibox/releases.
#
#   1. .\scripts\release.ps1            construit release\v<version>\ et vérifie tout
#   2. (relire release\v<version>\NOTES.md)
#   3. .\scripts\release.ps1 -Publish   publie ce dossier, sans rien reconstruire
#
# Garanties :
#   - rien n'est construit si tsc, vitest ou cargo test échoue (-SkipTests : urgence seulement) ;
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
#
# -Linux ajoute la version Steam Deck (AppImage signée, construite dans WSL Ubuntu 22.04 par
# scripts/linux-build.sh release) et son entrée linux-x86_64 dans le même latest.json.
# Une fois une version Linux publiée, toutes les suivantes doivent l'inclure : sinon la mise à
# jour automatique du Deck échoue. Le script refuse donc de construire sans -Linux dans ce cas.
param(
  [switch]$Publish,
  [switch]$Linux,
  [string]$Distro = "Ubuntu-22.04",
  [switch]$NoBridge,
  # saute tsc, vitest et cargo test avant la construction (correctif d'urgence seulement)
  [switch]$SkipTests,
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

# Traduction anglaise des nouveautés (clés françaises de src/i18n/en.ts) ; $null s'il en manque une.
function Get-EnglishHighlights($highlights) {
  $en = Get-Content -Raw -Encoding UTF8 "$root\src\i18n\en.ts"
  $dict = @{}
  foreach ($m in [regex]::Matches($en, '"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)"')) {
    $dict[[regex]::Unescape($m.Groups[1].Value)] = [regex]::Unescape($m.Groups[2].Value)
  }
  $out = @()
  foreach ($h in $highlights) {
    if (-not $dict.ContainsKey($h.Title) -or -not $dict.ContainsKey($h.Text)) { return $null }
    $out += [pscustomobject]@{ Title = $dict[$h.Title]; Text = $dict[$h.Text] }
  }
  $out
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
$linuxName = "iBox_${version}_amd64.AppImage"
$linuxUrl = "https://github.com/$Repo/releases/download/$tag/$linuxName"

# Construit la version Linux dans WSL ; secrets transmis par l'environnement (WSLENV), jamais
# en argument. Le script est recopié sans retours chariot (fichier Windows).
function Build-Linux([string]$dest) {
  $wsl = (Get-Command wsl.exe -ErrorAction SilentlyContinue).Source
  if (-not $wsl) { throw "WSL est introuvable : la version Linux se construit dans $Distro (docs/STEAMDECK.md)." }
  $toWsl = { param($p) "/mnt/" + $p.Substring(0, 1).ToLowerInvariant() + ($p.Substring(2) -replace '\\', '/') }
  $saved = @{}
  $vars = "WSLENV", "IBOX_OUT", "IBOX_SRC", "IBOX_SKIP_TESTS", "TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "IBOX_UPDATE_URL", "IBOX_SS_DEVID", "IBOX_SS_DEVPASSWORD"
  foreach ($var in $vars) { $saved[$var] = [Environment]::GetEnvironmentVariable($var) }
  try {
    $env:IBOX_SRC = & $toWsl $root
    $env:IBOX_OUT = & $toWsl $dest
    $env:IBOX_SKIP_TESTS = if ($SkipTests) { "1" } else { "0" }
    $env:TAURI_SIGNING_PRIVATE_KEY = & $toWsl (Resolve-Path -LiteralPath $KeyPath).Path
    $env:IBOX_UPDATE_URL = $updateUrl
    $env:WSLENV = "IBOX_SRC/u:IBOX_OUT/u:IBOX_SKIP_TESTS/u:TAURI_SIGNING_PRIVATE_KEY/u:TAURI_SIGNING_PRIVATE_KEY_PASSWORD/u:IBOX_UPDATE_URL/u:IBOX_SS_DEVID/u:IBOX_SS_DEVPASSWORD/u"
    $script = (& $toWsl "$root\scripts\linux-build.sh")
    & $wsl -d $Distro -u root -- bash -lc "tr -d '\r' < '$script' > /root/ibox-release.sh && bash /root/ibox-release.sh release"
    if ($LASTEXITCODE -ne 0) { throw "Échec de la construction Linux (code $LASTEXITCODE). Rien n'est publié." }
  } finally {
    foreach ($var in $vars) { [Environment]::SetEnvironmentVariable($var, $saved[$var]) }
  }
}

if (-not $Publish) {
  # ——— Construction ———
  if (-not (Test-Path $KeyPath)) { throw "Clé de signature introuvable : $KeyPath" }
  if (git -C $root status --porcelain) { Write-Warning "Des modifications ne sont pas commitées : le code publié sur GitHub doit correspondre à cette version." }
  if (-not $Linux) {
    # une version Linux déjà publiée doit être suivie : le Deck lit le même latest.json
    $current = $null
    try { $current = Invoke-RestMethod -Uri $updateUrl -Headers @{ "User-Agent" = "ibox-release" } -TimeoutSec 15 }
    catch { Write-Warning "latest.json en ligne illisible : impossible de vérifier si Linux doit être inclus." }
    if ($current -and $current.platforms."linux-x86_64") {
      throw "La version $($current.version) publiée inclut Linux : ajoutez -Linux, sinon la mise à jour du Steam Deck échouera."
    }
  }

  # ——— Vérifications : une version dont un contrôle échoue n'est jamais construite ———
  if ($SkipTests) {
    Write-Warning "Vérifications sautées (-SkipTests) : à réserver à un correctif d'urgence."
  } else {
    $checks = @(
      @{ Name = "Types TypeScript"; Dir = $root; Cmd = { npx tsc -b --noEmit } },
      @{ Name = "Tests de l'interface"; Dir = $root; Cmd = { npx vitest run --silent } },
      @{ Name = "Tests natifs (Rust)"; Dir = (Join-Path $root "src-tauri"); Cmd = { cargo test --lib --quiet } }
    )
    foreach ($check in $checks) {
      Write-Host "Vérification : $($check.Name)…"
      Push-Location $check.Dir
      try {
        & $check.Cmd
        if ($LASTEXITCODE -ne 0) { throw "Vérification échouée : $($check.Name) (code $LASTEXITCODE). Rien n'est construit." }
      } finally { Pop-Location }
    }
    Write-Host "Vérifications : tout est passé."
  }

  $saved = @{}
  foreach ($var in "TAURI_SIGNING_PRIVATE_KEY", "IBOX_UPDATE_URL", "CARGO_ENCODED_RUSTFLAGS", "CARGO_TARGET_DIR", "IBOX_SS_DEVID", "IBOX_SS_DEVPASSWORD") {
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
    # Identifiants développeur ScreenScraper (manuels) : fichier hors du projet, deux lignes
    # (devid puis devpassword). Brouillés dans l'exécutable par build.rs, jamais dans les sources.
    $ssFile = Join-Path (Split-Path -Parent $KeyPath) "screenscraper.txt"
    if (Test-Path -LiteralPath $ssFile) {
      $ss = @(Get-Content -LiteralPath $ssFile | Where-Object { $_.Trim() -and -not $_.TrimStart().StartsWith("#") })
      if ($ss.Count -ge 2) {
        $env:IBOX_SS_DEVID = $ss[0].Trim()
        $env:IBOX_SS_DEVPASSWORD = $ss[1].Trim()
        Write-Host "ScreenScraper : identifiants développeur fournis."
      } else { Write-Warning "$ssFile doit contenir deux lignes (devid, devpassword) : ScreenScraper indisponible dans cette version." }
    } else { Write-Warning "Pas d'identifiants ScreenScraper ($ssFile) : source indisponible dans cette version." }

    # Vosk (« Clip ça ! ») livré par l'installeur : versions officielles vérifiées par SHA-256
    & (Join-Path $PSScriptRoot "get-vosk.ps1")
    if (-not $?) { throw "Vosk indisponible : impossible de construire l'installeur." }
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
  $platforms = [ordered]@{ "windows-x86_64" = [ordered]@{ signature = $signature; url = $installerUrl } }
  $sums = @("$((Get-FileHash -LiteralPath "$out\$name" -Algorithm SHA256).Hash.ToLowerInvariant())  $name")
  if ($Linux) {
    Build-Linux $out
    $appimage = Join-Path $out $linuxName
    $linuxSig = (Get-Content -LiteralPath "$appimage.sig" -Raw).Trim()
    if (-not $linuxSig) { throw "La signature de l'AppImage est vide." }
    Assert-NoLeak @($appimage, "$appimage.sig")
    $platforms["linux-x86_64"] = [ordered]@{ signature = $linuxSig; url = $linuxUrl }
    $sums += "$((Get-FileHash -LiteralPath $appimage -Algorithm SHA256).Hash.ToLowerInvariant())  $linuxName"
  }

  $plain = ($highlights | ForEach-Object { "$($_.Title) : $($_.Text)" }) -join "`n"
  $manifest = [ordered]@{
    version = $version
    notes = $plain
    pub_date = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = $platforms
  }
  $utf8 = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText("$out\latest.json", ($manifest | ConvertTo-Json -Depth 5), $utf8)

  $hash = $sums[0].Split(" ")[0]
  [IO.File]::WriteAllText("$out\SHA256SUMS.txt", (($sums -join "`n") + "`n"), $utf8)

  $notes = @("## Nouveautés", "") + ($highlights | ForEach-Object { "- **$($_.Title)** : $($_.Text)" }) + @(
    "", "## Installation", "",
    "Téléchargez **$name** ci-dessous (Windows 10 et 11, 64 bits).",
    "Si iBox est déjà installé, la mise à jour est proposée automatiquement.")
  # Section anglaise tirée de src/i18n/en.ts (reprise par le bot Discord atzski/ibox-bot).
  $english = Get-EnglishHighlights $highlights
  if ($english) {
    $notes += @("", "## What's new", "") + ($english | ForEach-Object { "- **$($_.Title)**: $($_.Text)" })
  } else {
    Write-Warning "Traduction anglaise incomplète dans src/i18n/en.ts : notes publiées sans section « What's new »."
  }
  if ($Linux) {
    # notes de la version Steam Deck : docs/STEAMDECK-NOTES.md (à relire à chaque version Linux)
    $deckNotes = Get-Content -Raw -Encoding UTF8 "$root\docs\STEAMDECK-NOTES.md"
    if (-not $deckNotes.Contains("VERSION")) { throw "docs/STEAMDECK-NOTES.md doit citer le fichier iBox_VERSION_amd64.AppImage." }
    $notes += @("", $deckNotes.Replace("iBox_VERSION_amd64.AppImage", $linuxName).TrimEnd())
  }
  $notes += @("", "Empreintes SHA-256 : voir SHA256SUMS.txt (Windows : ``$hash``).")
  [IO.File]::WriteAllText("$out\NOTES.md", ($notes -join "`n"), $utf8)

  Assert-NoLeak @(Get-ChildItem -LiteralPath $out -File | ForEach-Object FullName)
  Write-Host ""
  Write-Host "Version $version prête dans $out"
  Write-Host "Relisez NOTES.md, puis publiez avec : .\scripts\release.ps1 -Publish"
  return
}

# ——— Publication ———
$files = @("$out\$name", "$out\$name.sig", "$out\latest.json", "$out\SHA256SUMS.txt")
$withLinux = Test-Path -LiteralPath "$out\$linuxName"
if ($withLinux) { $files += @("$out\$linuxName", "$out\$linuxName.sig") }
foreach ($file in $files + "$out\NOTES.md") {
  if (-not (Test-Path -LiteralPath $file)) { throw "Fichier manquant : $file. Lancez d'abord .\scripts\release.ps1" }
}
$manifest = Get-Content -Raw -LiteralPath "$out\latest.json" | ConvertFrom-Json
if ($manifest.version -ne $version -or $manifest.platforms."windows-x86_64".url -ne $installerUrl) {
  throw "latest.json ne correspond pas à la version $version sur $Repo."
}
if ($withLinux -and $manifest.platforms."linux-x86_64".url -ne $linuxUrl) { throw "latest.json n'annonce pas l'AppImage $linuxName." }
$sumsText = Get-Content -Raw "$out\SHA256SUMS.txt"
foreach ($file in @($name) + @(if ($withLinux) { $linuxName })) {
  $hash = (Get-FileHash -LiteralPath "$out\$file" -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sumsText -notmatch "(?m)^$hash  $([regex]::Escape($file))$") { throw "$file a changé depuis la construction." }
}
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

# Annonce Discord : GitHub ne garantit pas le passage du bot toutes les 5 min, on le réveille.
& $gh workflow run bot.yml --repo atzski/ibox-bot *> $null
if ($LASTEXITCODE -eq 0) { Write-Host "Bot Discord lancé : l'annonce part dans #releases d'ici quelques minutes." }
else { Write-Warning "Bot Discord non lancé : gh workflow run bot.yml --repo atzski/ibox-bot" }

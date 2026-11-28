# Libère la place prise par les compilations d'iBox (tout ce qui est effacé se reconstruit seul).
#
#   .\scripts\menage.ps1               ménage normal
#   .\scripts\menage.ps1 -Simulation   affiche ce qui serait effacé, sans rien effacer
#   .\scripts\menage.ps1 -Complet      efface aussi target\publish (la prochaine release
#                                      recompile tout : plus longue, environ 10 min de plus)
#
# Effacé :
#   - src-tauri\target sauf publish : debug (npm run tauri dev, cargo test), Android, public-check ;
#   - src-tauri\gen\android\app\build (APK intermédiaires) ;
#   - dans chaque worktree .claude\worktrees\* : src-tauri\target, gen\android\app\build,
#     node_modules (le worktree et ses commits restent intacts). Un worktree utilisé depuis
#     moins de 2 h est laissé de côté (une session y compile peut-être) ;
#   - release\v* sauf les $Garder versions les plus récentes (déjà publiées sur GitHub).
# Jamais touché : le code, git, les worktrees eux-mêmes, les caches cargo/npm/gradle.
param(
  [switch]$Simulation,
  [switch]$Complet,
  [int]$Garder = 3
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Get-Bytes([string]$path) {
  $sum = (Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if ($sum) { [long]$sum } else { 0L }
}
function Format-Go([long]$bytes) { "{0:N1} Go" -f ($bytes / 1GB) }

$cibles = [System.Collections.Generic.List[string]]::new()

# 1. Dépôt principal
$target = Join-Path $root "src-tauri\target"
if (Test-Path -LiteralPath $target) {
  foreach ($dir in Get-ChildItem -LiteralPath $target -Directory -Force) {
    if ($dir.Name -eq "publish" -and -not $Complet) { continue }
    $cibles.Add($dir.FullName)
  }
}
$cibles.Add((Join-Path $root "src-tauri\gen\android\app\build"))

# 2. Worktrees des sessions
$limite = (Get-Date).AddHours(-2)
$worktrees = Join-Path $root ".claude\worktrees"
if (Test-Path -LiteralPath $worktrees) {
  foreach ($wt in Get-ChildItem -LiteralPath $worktrees -Directory -Force) {
    $gitFile = Join-Path $wt.FullName ".git"
    $recent = $false
    if (Test-Path -LiteralPath $gitFile -PathType Leaf) {
      $gitDir = ((Get-Content -LiteralPath $gitFile -TotalCount 1) -replace "^gitdir:\s*", "").Trim()
      $index = Join-Path $gitDir "index"
      if ((Test-Path -LiteralPath $index) -and (Get-Item -LiteralPath $index).LastWriteTime -gt $limite) { $recent = $true }
    }
    if ($recent) { Write-Host "Laissé de côté (utilisé il y a moins de 2 h) : $($wt.Name)"; continue }
    foreach ($sub in "src-tauri\target", "src-tauri\gen\android\app\build", "node_modules") {
      $cibles.Add((Join-Path $wt.FullName $sub))
    }
  }
}

# 3. Anciennes versions construites
$releases = Join-Path $root "release"
if (Test-Path -LiteralPath $releases) {
  $versions = Get-ChildItem -LiteralPath $releases -Directory | Where-Object { $_.Name -match "^v\d+\.\d+\.\d+$" } |
    Sort-Object { [version]$_.Name.Substring(1) } -Descending
  $versions | Select-Object -Skip $Garder | ForEach-Object { $cibles.Add($_.FullName) }
}

# Ménage
$avant = (Get-PSDrive ($root.Substring(0, 1))).Free
$total = 0L
$bloques = @()
foreach ($cible in $cibles) {
  if (-not (Test-Path -LiteralPath $cible)) { continue }
  $taille = Get-Bytes $cible
  $total += $taille
  $nom = $cible.Substring($root.Length + 1)
  if ($Simulation) {
    if ($taille -ge 50MB) { Write-Host ("{0,10}  {1}" -f (Format-Go $taille), $nom) }
    continue
  }
  Remove-Item -LiteralPath $cible -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $cible) { $bloques += $nom }   # fichiers ouverts (iBox en dev, rust-analyzer...)
}

if ($Simulation) {
  Write-Host "Simulation : $(Format-Go $total) seraient libérés. Relancez sans -Simulation pour effacer."
  return
}
$apres = (Get-PSDrive ($root.Substring(0, 1))).Free
Write-Host "Ménage terminé : $(Format-Go ($apres - $avant)) libérés, $(Format-Go $apres) libres sur le disque."
if ($bloques) {
  Write-Warning "En partie effacés seulement (fichiers en cours d'utilisation, fermez iBox dev / l'éditeur puis relancez) :"
  $bloques | ForEach-Object { Write-Warning "  $_" }
}

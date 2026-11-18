# Aperçu Steam Deck d'iBox : lance la version Linux dans un écran 1280x800 en Mode Jeu simulé.
# Prérequis : WSL Ubuntu-22.04 préparé (docs/STEAMDECK.md §12) et AppImage construite
# (scripts/linux-build.sh bundle). Usage :  .\scripts\deck-preview.ps1  [-Build] [-Xephyr]
# -Xephyr : écran isolé sans gestionnaire de fenêtres (plus proche de gamescope, mais 3D très lente).
# -RemotePlay : banc d'essai de l'invité natif (phase D3). Lancer d'abord l'hôte d'essai Windows :
#   cargo test --lib remote_play::guest::tests::hote_pour_apercu -- --ignored --nocapture
param([switch]$Build, [switch]$Xephyr, [switch]$RemotePlay)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$wslRepo = '/mnt/' + $repo.Substring(0, 1).ToLower() + ($repo.Substring(2) -replace '\\', '/')
$prep = "tr -d '\r' < '$wslRepo/scripts/linux-build.sh' > /root/lb.sh; tr -d '\r' < '$wslRepo/scripts/deck-preview.sh' > /root/deck-preview.sh"
if ($Build) {
    wsl -d Ubuntu-22.04 -u root -- bash -lc "$prep; IBOX_SRC='$wslRepo' bash /root/lb.sh bundle"
}
$mode = if ($Xephyr) { '--xephyr' } else { '' }
if ($RemotePlay) {
    $bench = Join-Path $env:TEMP 'ibox-rp'
    $mode += " --remote-play '/mnt/" + $bench.Substring(0, 1).ToLower() + ($bench.Substring(2) -replace '\\', '/') + "'"
}
wsl -d Ubuntu-22.04 -u root -- bash -lc "$prep; bash /root/deck-preview.sh $mode"

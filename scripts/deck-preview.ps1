# Aperçu Steam Deck d'iBox : lance la version Linux dans un écran 1280x800 en Mode Jeu simulé.
# Prérequis : WSL Ubuntu-22.04 préparé (docs/STEAMDECK.md §12) et AppImage construite
# (scripts/linux-build.sh bundle). Usage :  .\scripts\deck-preview.ps1  [-Build] [-Xephyr]
# -Xephyr : écran isolé sans gestionnaire de fenêtres (plus proche de gamescope, mais 3D très lente).
# -RemotePlay : banc d'essai de l'invité natif (phase D3). Lancer d'abord l'hôte d'essai Windows :
#   cargo test --lib remote_play::guest::tests::hote_pour_apercu -- --ignored --nocapture
# -Windows : sans WSL, l'interface Steam Deck (Mode Jeu, 1280×800) sur le cœur Windows, avec le GPU
#   du PC : rapide pour essayer l'interface et la navigation à la manette. Données séparées
#   (identifiant app.ibox.deckpreview) : l'iBox habituel n'est jamais touché.
param([switch]$Build, [switch]$Xephyr, [switch]$RemotePlay, [switch]$Windows)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..").Path
if ($Windows) {
    $env:IBOX_SIMULATE_DECK = '1'
    # configuration passée par fichier (les guillemets d'un JSON en argument ne survivent pas à npx.cmd)
    $conf = Join-Path $env:TEMP 'ibox-deckpreview.conf.json'
    Set-Content -LiteralPath $conf -Encoding utf8NoBOM -Value '{"identifier":"app.ibox.deckpreview","productName":"iBox Deck Preview"}'
    Push-Location $repo
    try {
        npx tauri dev --config $conf
    } finally {
        Pop-Location
        Remove-Item Env:IBOX_SIMULATE_DECK -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $conf -ErrorAction SilentlyContinue
    }
    return
}
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

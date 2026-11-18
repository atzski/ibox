#!/usr/bin/env bash
# Aperçu Steam Deck d'iBox sur PC (WSL Ubuntu 22.04, voir docs/STEAMDECK.md §12).
#
# Lance la vraie AppImage Linux d'iBox dans une fenêtre de 1280x800 (écran du Steam Deck),
# affichée par WSLg avec l'accélération graphique du PC, en « Mode Jeu » simulé :
#   - XDG_CURRENT_DESKTOP=gamescope : chemin Mode Jeu d'iBox (une seule fenêtre, rien ne se masque)
#   - IBOX_SIMULATE_DECK=1          : iBox se croit sur un Steam Deck, fenêtre 1280x800 sans plein écran
# Données de l'aperçu : ~/.local/share/app.ibox.desktop dans WSL (jamais l'iBox Windows).
#
# `--xephyr` : écran Xephyr isolé (sans gestionnaire de fenêtres, au plus près de gamescope),
# mais sans accélération graphique : la 3D y est très lente.
# `--remote-play <dossier>` : banc d'essai Remote Play (phase D3). L'hôte d'essai Windows dépose
# `offer.sdp` dans ce dossier ; iBox y répond en invité natif (`answer.sdp`) et décode le flux avec
# WebCodecs. Mesures dans le journal, lignes `[webcodecs]`.
#
# Ce que l'aperçu ne reproduit pas : processeur et GPU du Deck, Steam Input, gamescope lui-même,
# la mise en veille, Steam et les émulateurs.
set -uo pipefail
# AppImage la plus récente construite par linux-build.sh bundle (numéro de version quelconque)
APPIMAGE="${IBOX_APPIMAGE:-$(ls -t "$HOME"/ibox/src-tauri/target/release/bundle/appimage/iBox_*_amd64.AppImage 2>/dev/null | head -1)}"
[ -n "$APPIMAGE" ] && [ -x "$APPIMAGE" ] || { echo "AppImage introuvable : $APPIMAGE (construire avec linux-build.sh bundle)"; exit 1; }

run_ibox() {
  GDK_BACKEND=x11 XDG_CURRENT_DESKTOP=gamescope IBOX_SIMULATE_DECK=1 GDK_SCALE=1 \
    APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGE" >/tmp/deck-ibox.log 2>&1
}

XEPHYR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --xephyr) XEPHYR=1 ;;
    --remote-play) shift; export IBOX_RP_OFFER_FILE="$1/offer.sdp" IBOX_RP_ANSWER_FILE="$1/answer.sdp" IBOX_RP_SAMPLE_FILE="$1/sample.bin" ;;
  esac
  shift
done

if [ "$XEPHYR" = 1 ]; then
  SCREEN=":7"
  pkill -f "Xephyr $SCREEN" 2>/dev/null
  Xephyr "$SCREEN" -screen 1280x800 -title "Steam Deck - apercu iBox" -no-host-grab -nolisten tcp >/tmp/deck-xephyr.log 2>&1 &
  xephyr=$!
  for _ in $(seq 1 50); do DISPLAY="$SCREEN" xdpyinfo >/dev/null 2>&1 && break; sleep 0.1; done
  echo "Aperçu Steam Deck (Xephyr) : fermez la fenêtre pour arrêter."
  DISPLAY="$SCREEN" WAYLAND_DISPLAY= run_ibox &
  ibox=$!
  while kill -0 "$xephyr" 2>/dev/null && kill -0 "$ibox" 2>/dev/null; do sleep 1; done
  kill "$ibox" "$xephyr" 2>/dev/null
else
  echo "Aperçu Steam Deck : fenêtre 1280x800 (accélérée). Fermez-la pour arrêter."
  run_ibox
fi
wait 2>/dev/null
echo "Aperçu terminé. Journal : /tmp/deck-ibox.log"

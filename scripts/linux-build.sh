#!/usr/bin/env bash
# Construction Linux d'iBox (Steam Deck) dans WSL Ubuntu 22.04. Voir docs/STEAMDECK.md.
#
# Copie le dépôt Windows dans un dossier Linux (bien plus rapide que /mnt/c), puis :
#   check  : cargo check (par défaut)
#   test   : cargo test --lib
#   bundle : npm ci + build + AppImage d'essai (sans signature)
#   release : tests stricts puis AppImage signée pour la publication, copiée dans $IBOX_OUT
#             (appelé par scripts/release.ps1 -Linux ; clé, adresse de mise à jour et
#             identifiants ScreenScraper arrivent par l'environnement, jamais en argument)
#
# Depuis PowerShell :  wsl -d Ubuntu-22.04 -u root -- bash /mnt/c/Users/<moi>/Desktop/ibox/scripts/linux-build.sh test
set -euo pipefail
SRC="${IBOX_SRC:-$(cd "$(dirname "$0")/.." && pwd)}"
DST="${IBOX_LINUX_DIR:-$HOME/ibox}"
MODE="${1:-check}"
. "$HOME/.cargo/env"

mkdir -p "$DST"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude .git --exclude 'src-tauri/target' --exclude /release \
  --exclude 'services/inetbox/node_modules' "$SRC/" "$DST/"
cd "$DST"

# Médias (Remote Play, WebCodecs) : FFmpeg LGPL seul et greffons GStreamer sans GPL, préparés par
# scripts/linux-media.sh (docs/STEAMDECK.md, « Licences »). linuxdeploy résout les dépendances avec
# LD_LIBRARY_PATH : il embarque ce FFmpeg-là, et seulement les greffons de GSTREAMER_PLUGINS_DIR.
FFMPEG_LGPL=/opt/ffmpeg-lgpl
GST_LGPL=/opt/gst-lgpl/plugins
if [ "$MODE" = bundle ] || [ "$MODE" = release ]; then
  if [ -f "$FFMPEG_LGPL/lib/libavcodec.so.58" ] && [ -d "$GST_LGPL" ]; then
    export LD_LIBRARY_PATH="$FFMPEG_LGPL/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export GSTREAMER_PLUGINS_DIR="$GST_LGPL"
  elif [ "$MODE" = release ]; then
    echo "FFmpeg LGPL absent : lancez d'abord scripts/linux-media.sh (rien n'est publié avec le FFmpeg GPL d'Ubuntu)"; exit 6
  else
    echo "ATTENTION : FFmpeg LGPL absent (scripts/linux-media.sh) : AppImage d'essai avec le FFmpeg d'Ubuntu (GPL), à ne pas publier"
  fi
fi

# Contrôle de licence de l'AppImage construite : FFmpeg déclaré LGPL, aucune bibliothèque GPL connue.
check_licenses() {
  local appdir="$1" codec bad
  codec=$(find "$appdir" -name 'libavcodec.so.*' | head -1)
  [ -n "$codec" ] || { echo "Licences : libavcodec absent de l'AppImage"; return 1; }
  # sans « grep -q » : avec pipefail, strings interrompu ferait échouer la ligne
  strings "$codec" | grep 'LGPL version 2.1 or later' >/dev/null || { echo "Licences : libavcodec n'est pas LGPL ($codec)"; return 1; }
  bad=$(find "$appdir" \( -name 'libx264*' -o -name 'libx265*' -o -name 'libxvidcore*' -o -name 'libpostproc*' \
    -o -name 'libfaad*' -o -name 'libmpeg2encpp*' -o -name 'libmplex2*' -o -name 'libdvdnav*' -o -name 'libdca*' \
    -o -name 'libgstx265*' -o -name 'libgstfaad*' -o -name 'libgstdtsdec*' -o -name 'libgstresindvd*' \
    -o -name 'libgstmpeg2enc*' -o -name 'libgstmplex*' \) | sed "s#$appdir/##")
  [ -z "$bad" ] || { echo "Licences : composants GPL dans l'AppImage : $bad"; return 1; }
  [ -f "$appdir/usr/share/licenses/ibox/FFmpeg-COPYING.LGPLv2.1" ] || { echo "Licences : texte de la LGPL absent de l'AppImage"; return 1; }
  echo "Licences : FFmpeg LGPL 2.1, aucun composant GPL connu, textes et sources fournis."
}

case "$MODE" in
  check)  (cd src-tauri && cargo check --all-targets --message-format short 2>&1 | grep -E '^(error|warning: unused)|^src/|could not compile|Finished' || true) ;;
  test)   (cd src-tauri && cargo test --lib 2>&1 | grep -E 'test result|FAILED|panicked|^error|failures:' || true) ;;
  bundle)
    [ -d node_modules ] || npm ci --no-audit --no-fund
    # paquet d'essai : sans artefacts de mise à jour (la clé de signature reste sous Windows)
    npx tauri build --bundles appimage --config '{"bundle":{"createUpdaterArtifacts":false}}' 2>&1 | grep -vE '^\s+(Compiling|Downloaded|Downloading)' | tail -25
    ls -lh src-tauri/target/release/bundle/appimage/ 2>/dev/null || true
    [ -n "${GSTREAMER_PLUGINS_DIR:-}" ] && check_licenses src-tauri/target/release/bundle/appimage/iBox.AppDir || true ;;
  release)
    OUT="${IBOX_OUT:?IBOX_OUT manquant}"
    : "${TAURI_SIGNING_PRIVATE_KEY:?clé de signature manquante}" "${IBOX_UPDATE_URL:?adresse de mise à jour manquante}"
    [ -f "$TAURI_SIGNING_PRIVATE_KEY" ] || { echo "clé de signature introuvable dans WSL"; exit 3; }
    if [ "${IBOX_SKIP_TESTS:-0}" != 1 ]; then
      echo "Vérification : tests natifs sous Linux…"
      (cd src-tauri && cargo test --lib --quiet 2>&1 | grep -E 'test result|FAILED|panicked|^error' )
    fi
    [ -d node_modules ] || npm ci --no-audit --no-fund
    # dossier séparé, chemins de compilation effacés (la dernière règle qui correspond l'emporte)
    export CARGO_TARGET_DIR="$DST/src-tauri/target/publish"
    sep=$'\x1f'
    export CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=$HOME=/build${sep}--remap-path-prefix=$HOME/.cargo=/cargo${sep}--remap-path-prefix=$HOME/.rustup=/rustup${sep}--remap-path-prefix=$DST=/ibox"
    npx tauri build --bundles appimage 2>&1 | grep -vE '^\s+(Compiling|Downloaded|Downloading)' | tail -15
    bundle="$CARGO_TARGET_DIR/release/bundle/appimage"
    check_licenses "$bundle/iBox.AppDir" || exit 7
    version=$(node -p "require('./src-tauri/tauri.conf.json').version")
    name="iBox_${version}_amd64.AppImage"
    [ -s "$bundle/$name" ] && [ -s "$bundle/$name.sig" ] || { echo "AppImage ou signature absente : $bundle/$name"; exit 4; }
    grep -qaF "$IBOX_UPDATE_URL" "$CARGO_TARGET_DIR/release/ibox" || { echo "adresse de mise à jour absente du programme Linux"; exit 5; }
    mkdir -p "$OUT"
    cp "$bundle/$name" "$bundle/$name.sig" "$OUT/"
    echo "Linux : $name copiée dans la release." ;;
  *) echo "mode inconnu : $MODE (check | test | bundle | release)"; exit 2 ;;
esac

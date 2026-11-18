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

# Remote Play (invité natif, WebCodecs) : l'AppImage n'emporte que les décodeurs GStreamer de cette
# machine ; sans eux, aucun flux H.264 n'est décodable (docs/STEAMDECK.md §12, D3)
if [ "$MODE" = bundle ] || [ "$MODE" = release ]; then
  [ -f /usr/lib/x86_64-linux-gnu/gstreamer-1.0/libgstlibav.so ] ||
    echo "ATTENTION : gstreamer1.0-libav absent, Remote Play ne pourra rien décoder (apt install gstreamer1.0-libav gstreamer1.0-plugins-bad)"
fi

case "$MODE" in
  check)  (cd src-tauri && cargo check --all-targets --message-format short 2>&1 | grep -E '^(error|warning: unused)|^src/|could not compile|Finished' || true) ;;
  test)   (cd src-tauri && cargo test --lib 2>&1 | grep -E 'test result|FAILED|panicked|^error|failures:' || true) ;;
  bundle)
    [ -d node_modules ] || npm ci --no-audit --no-fund
    # paquet d'essai : sans artefacts de mise à jour (la clé de signature reste sous Windows)
    npx tauri build --bundles appimage --config '{"bundle":{"createUpdaterArtifacts":false}}' 2>&1 | grep -vE '^\s+(Compiling|Downloaded|Downloading)' | tail -25
    ls -lh src-tauri/target/release/bundle/appimage/ 2>/dev/null || true ;;
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
    version=$(node -p "require('./src-tauri/tauri.conf.json').version")
    name="iBox_${version}_amd64.AppImage"
    [ -s "$bundle/$name" ] && [ -s "$bundle/$name.sig" ] || { echo "AppImage ou signature absente : $bundle/$name"; exit 4; }
    grep -qaF "$IBOX_UPDATE_URL" "$CARGO_TARGET_DIR/release/ibox" || { echo "adresse de mise à jour absente du programme Linux"; exit 5; }
    mkdir -p "$OUT"
    cp "$bundle/$name" "$bundle/$name.sig" "$OUT/"
    echo "Linux : $name copiée dans la release." ;;
  *) echo "mode inconnu : $MODE (check | test | bundle | release)"; exit 2 ;;
esac

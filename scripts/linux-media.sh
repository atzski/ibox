#!/usr/bin/env bash
# Prépare les médias de la version Linux (Steam Deck) sur la machine de construction (WSL Ubuntu
# 22.04), une fois. Voir docs/STEAMDECK.md (« Licences : FFmpeg LGPL et GStreamer »).
#
#   1. FFmpeg 4.4.2 officiel (ffmpeg.org, signature PGP vérifiée), compilé en **LGPL seulement**
#      (ni --enable-gpl ni --enable-nonfree), bibliothèques partagées (liaison dynamique), avec le
#      seul décodeur et analyseur H.264 : /opt/ffmpeg-lgpl. Même version et mêmes noms
#      (libavcodec.so.58…) que le FFmpeg d'Ubuntu, contre lequel gst-libav est compilé.
#   2. Greffons GStreamer : /opt/gst-lgpl/plugins, liens vers ceux du système dont la licence
#      déclarée (gst-inspect) n'est ni GPL ni inconnue. linuxdeploy n'embarque que ceux-là.
#   3. Licences et sources : /opt/ffmpeg-lgpl/share/ibox-licenses (texte LGPL 2.1, configuration
#      exacte, archive source et empreinte), copiés dans l'AppImage par tauri.linux.conf.json.
#
# Usage (root, dans WSL) : bash scripts/linux-media.sh
set -euo pipefail
FF_VERSION=4.4.2
PREFIX=/opt/ffmpeg-lgpl
GST_DIR=/opt/gst-lgpl/plugins
WORK=/opt/ffmpeg-lgpl-build
# clé de publication de FFmpeg (« FFmpeg release signing key », ffmpeg.org/download.html)
FF_KEY=FCF986EA15E6E293A5644F10B4322F04D67658D8

DEBIAN_FRONTEND=noninteractive apt-get install -y -q nasm gnupg gstreamer1.0-tools >/dev/null

mkdir -p "$WORK" && cd "$WORK"
tarball="ffmpeg-$FF_VERSION.tar.xz"
if [ ! -f "$tarball" ]; then
  curl -fsSLO "https://ffmpeg.org/releases/$tarball"
  curl -fsSLO "https://ffmpeg.org/releases/$tarball.asc"
fi
export GNUPGHOME="$WORK/gnupg"
mkdir -p "$GNUPGHOME" && chmod 700 "$GNUPGHOME"
if ! gpg --list-keys "$FF_KEY" >/dev/null 2>&1; then
  curl -fsSL https://ffmpeg.org/ffmpeg-devel.asc | gpg --import 2>/dev/null
fi
gpg --verify "$tarball.asc" "$tarball" 2>&1 | grep -q "Good signature" || { echo "signature de FFmpeg invalide : arrêt"; exit 3; }
gpg --verify --status-fd 1 "$tarball.asc" "$tarball" 2>/dev/null | grep -q "VALIDSIG $FF_KEY" || { echo "FFmpeg signé par une autre clé : arrêt"; exit 3; }
echo "FFmpeg $FF_VERSION : signature officielle vérifiée."

if [ ! -f "$PREFIX/lib/libavcodec.so.58" ]; then
  rm -rf "ffmpeg-$FF_VERSION" && tar xf "$tarball" && cd "ffmpeg-$FF_VERSION"
  # LGPL : ni --enable-gpl ni --enable-nonfree ; rien de détecté automatiquement (aucune
  # bibliothèque externe) ; seul le décodage H.264 sert à WebCodecs (gst-libav, avdec_h264)
  CONFIG=(--prefix="$PREFIX" --enable-shared --disable-static --disable-programs --disable-doc
    --disable-autodetect --disable-everything --enable-decoder=h264 --enable-parser=h264
    --enable-avformat --enable-avfilter --enable-swresample --enable-swscale
    --extra-version=ibox-lgpl)
  ./configure "${CONFIG[@]}" >/dev/null
  make -j"$(nproc)" >/dev/null
  make install >/dev/null
  cd "$WORK"
  printf '%s\n' "${CONFIG[@]}" > "$WORK/configure-options.txt"
fi

# contrôle : licence déclarée par la bibliothèque elle-même
license=$(strings "$PREFIX/lib/libavcodec.so.58" | grep -m1 -E '^(GPL|LGPL) version|license: ' || true)
# sans « grep -q » : avec pipefail, strings interrompu masquerait le résultat
if strings "$PREFIX/lib/libavcodec.so.58" | grep -e '--enable-gpl' -e '--enable-nonfree' >/dev/null; then echo "FFmpeg compilé en GPL ou nonfree : arrêt"; exit 4; fi
echo "FFmpeg LGPL : ${license:-LGPL (configuration sans --enable-gpl)}"

# licences et sources livrées avec l'AppImage (obligations LGPL 2.1, §6)
L="$PREFIX/share/ibox-licenses"
mkdir -p "$L"
cp "$WORK/ffmpeg-$FF_VERSION/COPYING.LGPLv2.1" "$L/FFmpeg-COPYING.LGPLv2.1" 2>/dev/null || tar xOf "$WORK/$tarball" "ffmpeg-$FF_VERSION/COPYING.LGPLv2.1" > "$L/FFmpeg-COPYING.LGPLv2.1"
{
  echo "FFmpeg $FF_VERSION (https://ffmpeg.org), LGPL 2.1 ou ultérieure, bibliothèques partagées."
  echo "Source exacte : https://ffmpeg.org/releases/$tarball"
  echo "SHA-256 : $(sha256sum "$WORK/$tarball" | cut -d' ' -f1)"
  echo "Signature : https://ffmpeg.org/releases/$tarball.asc (clé $FF_KEY)"
  echo "Options de compilation :"
  sed 's/^/  /' "$WORK/configure-options.txt" 2>/dev/null || true
} > "$L/FFmpeg-BUILD.txt"

# greffons GStreamer sans GPL
# licence déclarée par un greffon (vide si illisible : il est alors écarté)
plugin_license() { gst-inspect-1.0 "$1" 2>/dev/null | awk '/^  License/ {print $2; exit}' || true; }
SYS=/usr/lib/x86_64-linux-gnu/gstreamer-1.0
rm -rf "$GST_DIR" && mkdir -p "$GST_DIR"
kept=0; dropped=()
for so in "$SYS"/*.so; do
  lic=$(plugin_license "$so")
  case "$lic" in
    LGPL|BSD|MIT/X11|MPL|"Proprietary") ln -s "$so" "$GST_DIR/"; kept=$((kept+1)) ;;
    *) dropped+=("$(basename "$so") (${lic:-inconnue})") ;;
  esac
done
echo "GStreamer : $kept greffons gardés, ${#dropped[@]} écartés : ${dropped[*]:-aucun}"
{
  echo "Greffons GStreamer embarqués (licence déclarée par gst-inspect-1.0) :"
  for so in "$GST_DIR"/*.so; do echo "  $(basename "$so") : $(plugin_license "$so")"; done
  echo "Écartés : ${dropped[*]:-aucun}"
} > "$L/GStreamer-PLUGINS.txt"
echo "Prêt : LD_LIBRARY_PATH=$PREFIX/lib GSTREAMER_PLUGINS_DIR=$GST_DIR (utilisés par linux-build.sh)."

#!/usr/bin/env bash
# Installation d'iBox sur Steam Deck (et tout Linux 64 bits). Voir docs/STEAMDECK-INSTALL.md.
#
# À lancer en Mode Bureau, sans droits d'administrateur :
#   - télécharge la dernière AppImage publiée sur github.com/atzski/ibox et vérifie son empreinte
#     SHA-256 (SHA256SUMS.txt de la même version) ;
#   - la range dans ~/Applications/iBox.AppImage, sous un nom fixe : raccourcis et entrée Steam
#     restent valables après chaque mise à jour (iBox se met à jour sur place) ;
#   - la rend exécutable, crée le raccourci du bureau et l'entrée du menu des applications ;
#   - propose d'ajouter iBox à Steam, pour le Mode Jeu.
# Rien n'est écrit hors du dossier personnel. Relancer le script met iBox à jour ou le répare.
#
#   install-steamdeck.sh              installe ou met à jour
#   install-steamdeck.sh --steam      ajoute à Steam sans demander
#   install-steamdeck.sh --no-steam   ne touche pas à Steam
#   install-steamdeck.sh --uninstall  retire iBox et ses raccourcis (vos données sont gardées)
#
# Variables : IBOX_DIR (dossier de l'AppImage, ~/Applications par défaut),
#             IBOX_RELEASES (adresse des versions, pour les essais).
set -euo pipefail

REPO="atzski/ibox"
RELEASES="${IBOX_RELEASES:-https://github.com/$REPO/releases}"
DIR="${IBOX_DIR:-$HOME/Applications}"
APP="$DIR/iBox.AppImage"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
MENU="$DATA/applications/ibox.desktop"
ICON="$DATA/icons/hicolor/256x256/apps/ibox.png"

# messages en français, ou en anglais selon la langue du système
case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in fr*) FR=1 ;; *) FR=0 ;; esac
say() { if [ "$FR" = 1 ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }
die() { say "Erreur : $1" "Error: $2" >&2; exit 1; }

desktop_dir() {
  local d=""
  command -v xdg-user-dir >/dev/null 2>&1 && d="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
  # sans bureau configuré, xdg-user-dir renvoie le dossier personnel : pas de raccourci dans ce cas
  if [ -z "$d" ] || [ "$d" = "$HOME" ]; then d="$HOME/Desktop"; fi
  printf '%s' "$d"
}
SHORTCUT="$(desktop_dir)/iBox.desktop"

STEAM=ask
MODE=install
for arg in "$@"; do
  case "$arg" in
    --steam) STEAM=yes ;;
    --no-steam) STEAM=no ;;
    --uninstall) MODE=uninstall ;;
    -h|--help) if [ -f "$0" ]; then sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; else say "Options : --steam, --no-steam, --uninstall" "Options: --steam, --no-steam, --uninstall"; fi; exit 0 ;;
    *) die "option inconnue : $arg" "unknown option: $arg" ;;
  esac
done

[ "$(id -u)" != 0 ] || die "ne lancez pas ce script en administrateur (sudo) : iBox s'installe dans votre dossier personnel." "do not run this script as root (sudo): iBox installs into your home folder."

if [ "$MODE" = uninstall ]; then
  rm -f "$APP" "$MENU" "$SHORTCUT" "$ICON"
  say "iBox est retiré. Vos données (bibliothèque, réglages) restent dans $DATA/app.ibox.desktop ; si iBox est dans Steam, retirez-le depuis sa page (Gérer › Retirer le jeu non-Steam)." \
      "iBox is removed. Your data (library, settings) stays in $DATA/app.ibox.desktop; if iBox is in Steam, remove it from its page (Manage › Remove non-Steam game)."
  exit 0
fi

[ "$(uname -m)" = x86_64 ] || die "iBox pour Linux existe en 64 bits (x86_64) seulement ; cet appareil est en $(uname -m)." "iBox for Linux is 64-bit (x86_64) only; this device is $(uname -m)."
command -v curl >/dev/null 2>&1 || die "curl est introuvable." "curl is missing."
command -v sha256sum >/dev/null 2>&1 || die "sha256sum est introuvable." "sha256sum is missing."

TMP="$(mktemp -d)"
PART="$DIR/.iBox.AppImage.part"
trap 'rm -rf "$TMP" "$PART"' EXIT

# 1. Dernière version : le fichier que lit aussi la mise à jour automatique d'iBox
say "Recherche de la dernière version d'iBox…" "Looking for the latest iBox version…"
curl -fsSL --retry 2 "$RELEASES/latest/download/latest.json" -o "$TMP/latest.json" \
  || die "la page des versions ne répond pas ($RELEASES). Vérifiez la connexion." "the releases page is unreachable ($RELEASES). Check your connection."
# seule une AppImage hébergée parmi les versions officielles est acceptée
URL="$(grep -o "$RELEASES/download/v[0-9][0-9A-Za-z.+-]*/iBox_[0-9][0-9A-Za-z.+-]*_amd64\.AppImage" "$TMP/latest.json" | head -n 1 || true)"
[ -n "$URL" ] || die "la dernière version publiée n'a pas d'AppImage pour Linux." "the latest release has no AppImage for Linux."
NAME="${URL##*/}"
TAG="${URL%/*}"; TAG="${TAG##*/}"
say "Version trouvée : ${TAG#v}" "Found version: ${TAG#v}"

# 2. Téléchargement puis vérification de l'empreinte, avant de toucher à l'installation en place
mkdir -p "$DIR"
say "Téléchargement de $NAME…" "Downloading $NAME…"
curl -fL --retry 2 --progress-bar "$URL" -o "$PART" || die "téléchargement interrompu." "download failed."
curl -fsSL --retry 2 "$RELEASES/download/$TAG/SHA256SUMS.txt" -o "$TMP/sums.txt" \
  || die "empreintes de la version introuvables : rien n'est installé." "release checksums not found: nothing was installed."
WANT="$(awk -v n="$NAME" '$2 == n || $2 == "*" n { print tolower($1) }' "$TMP/sums.txt" | head -n 1)"
[ -n "$WANT" ] || die "l'empreinte de $NAME manque dans SHA256SUMS.txt : rien n'est installé." "the checksum of $NAME is missing from SHA256SUMS.txt: nothing was installed."
GOT="$(sha256sum "$PART" | awk '{ print $1 }')"
[ "$GOT" = "$WANT" ] || die "l'empreinte du fichier téléchargé ne correspond pas : rien n'est installé." "the downloaded file does not match its checksum: nothing was installed."
say "Empreinte SHA-256 vérifiée." "SHA-256 checksum verified."

# 3. Mise en place (remplacement en une fois : jamais d'AppImage à moitié écrite)
chmod +x "$PART"
mv -f "$PART" "$APP"

# 4. Icône, tirée de l'AppImage elle-même (sans la lancer : simple extraction)
ICON_LINE=""
if (cd "$TMP" && "$APP" --appimage-extract 'usr/share/icons/*' >/dev/null 2>&1); then
  best="$(find "$TMP/squashfs-root/usr/share/icons" -name '*.png' -type f -printf '%s %p\n' 2>/dev/null | sort -n | tail -n 1 | cut -d' ' -f2-)"
  if [ -n "$best" ]; then
    mkdir -p "${ICON%/*}"
    cp -f "$best" "$ICON"
    ICON_LINE="Icon=$ICON"
  fi
fi

# 5. Entrée du menu des applications et raccourci du bureau
write_entry() {
  mkdir -p "${1%/*}"
  {
    printf '%s\n' "[Desktop Entry]" "Type=Application" "Name=iBox" \
      "Comment=Game library and emulation frontend" "Comment[fr]=Bibliothèque de jeux et émulation" \
      "Exec=\"$APP\"" "Terminal=false" "Categories=Game;"
    [ -z "$ICON_LINE" ] || printf '%s\n' "$ICON_LINE"
  } > "$1"
  # KDE (Mode Bureau du Steam Deck) n'ouvre d'un double-clic que les raccourcis exécutables
  chmod +x "$1"
}
write_entry "$MENU"
if [ -d "${SHORTCUT%/*}" ]; then write_entry "$SHORTCUT"; fi
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true

say "iBox ${TAG#v} est installé : $APP" "iBox ${TAG#v} is installed: $APP"

# 6. Steam (Mode Jeu). `steamos-add-to-steam` est l'outil de SteamOS derrière « Ajouter à Steam » du
#    gestionnaire de fichiers : il passe par Steam lui-même, qui doit être ouvert. Aucun fichier de
#    Steam n'est modifié par ce script.
add_to_steam() {
  if ! command -v steamos-add-to-steam >/dev/null 2>&1; then
    say "Pour le Mode Jeu : ouvrez iBox, puis Paramètres › Système › Ajouter iBox à Steam (Steam fermé). Ou, dans Steam : Jeux › Ajouter un jeu non-Steam › iBox." \
        "For Game Mode: open iBox, then Settings › System › Add iBox to Steam (with Steam closed). Or, in Steam: Games › Add a Non-Steam Game › iBox."
    return
  fi
  if [ "$STEAM" = ask ]; then
    # lancé par « curl … | bash », le script n'a pas le clavier sur son entrée : on lit le terminal,
    # et seulement si quelqu'un est devant (sortie affichée dans un terminal)
    if [ -t 1 ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then
      say "Ajouter iBox à Steam, pour le lancer depuis le Mode Jeu ? [O/n]" "Add iBox to Steam, to launch it from Game Mode? [Y/n]" > /dev/tty
      read -r answer < /dev/tty || answer=""
      case "$answer" in n*|N*) STEAM=no ;; *) STEAM=yes ;; esac
    else
      STEAM=no
    fi
  fi
  if [ "$STEAM" = yes ]; then
    if steamos-add-to-steam "$MENU" >/dev/null 2>&1; then
      say "iBox est proposé à Steam : il apparaît dans la bibliothèque, catégorie « Non-Steam ». Pour ses illustrations, quittez Steam puis, dans iBox : Paramètres › Système › Ajouter iBox à Steam." \
          "iBox was handed to Steam: it shows in the library under “Non-Steam”. For its artwork, quit Steam then, in iBox: Settings › System › Add iBox to Steam."
    else
      say "Steam n'a pas répondu (est-il ouvert ?). Dans iBox : Paramètres › Système › Ajouter iBox à Steam (Steam fermé)." \
          "Steam did not answer (is it running?). In iBox: Settings › System › Add iBox to Steam (with Steam closed)."
    fi
  else
    say "Steam n'est pas modifié. Plus tard, dans iBox : Paramètres › Système › Ajouter iBox à Steam (Steam fermé)." \
        "Steam was left untouched. Later, in iBox: Settings › System › Add iBox to Steam (with Steam closed)."
  fi
}
[ "$STEAM" = no ] && say "Steam n'est pas modifié (--no-steam)." "Steam was left untouched (--no-steam)." || add_to_steam

say "Ouvrez iBox depuis le bureau ou le menu des applications. Les mises à jour suivantes se font dans iBox." \
    "Open iBox from the desktop or the application menu. Later updates happen inside iBox."

# Composants tiers de la version Linux (Steam Deck)

Ce document accompagne l'AppImage d'iBox (`/usr/share/licenses/ibox/` dans l'AppImage). Il
recense les composants tiers qui ne sont livrés **que** dans la version Linux, et la façon dont
iBox respecte leurs licences. La version Windows n'embarque ni FFmpeg ni GStreamer.

## FFmpeg (décodage H.264) : LGPL 2.1 ou ultérieure

- **Version** : FFmpeg 4.4.2, archive officielle `https://ffmpeg.org/releases/ffmpeg-4.4.2.tar.xz`,
  signature PGP vérifiée avant compilation (clé de publication de FFmpeg
  `FCF986EA15E6E293A5644F10B4322F04D67658D8`).
- **Licence** : LGPL 2.1 ou ultérieure. FFmpeg est compilé **sans** `--enable-gpl` ni
  `--enable-nonfree`, et sans aucune bibliothèque externe (`--disable-autodetect`). La bibliothèque
  déclare elle-même « LGPL version 2.1 or later », ce que la construction vérifie. Elle refuse de
  produire l'AppImage dans le cas contraire.
- **Contenu** : seuls le décodeur et l'analyseur H.264 sont compilés (`--disable-everything
  --enable-decoder=h264 --enable-parser=h264`). Les options exactes sont dans `FFmpeg-BUILD.txt`.
- **Liaison dynamique** : FFmpeg est livré en bibliothèques partagées (`libavcodec.so.58`,
  `libavutil.so.56`, `libavformat.so.58`, `libavfilter.so.7`, `libswresample.so.3`,
  `libswscale.so.5`), chargées par le greffon GStreamer `gst-libav`. iBox n'est pas lié à FFmpeg.
- **Code source non modifié** : l'archive officielle ci-dessus, avec son empreinte SHA-256 dans
  `FFmpeg-BUILD.txt`. Aucune modification n'est apportée. La procédure complète est dans
  `scripts/linux-media.sh` du code source d'iBox.
- **Remplacer FFmpeg (LGPL 2.1, §6)** : extraire l'AppImage (`./iBox_*.AppImage
  --appimage-extract`), remplacer les fichiers `squashfs-root/usr/lib/libav*.so.*` par une
  version compatible de son choix, puis lancer `squashfs-root/AppRun`.
- **Texte de la licence** : `FFmpeg-COPYING.LGPLv2.1`.

## GStreamer et ses greffons : LGPL 2.1 ou ultérieure (et licences permissives)

- WebKitGTK lit l'image et le son par GStreamer, qui est livré dans l'AppImage. Ce sont les
  bibliothèques et greffons d'Ubuntu 22.04 (GStreamer 1.20), non modifiés.
- **Aucun greffon GPL** : les greffons sont choisis d'après la licence qu'ils déclarent
  (`gst-inspect-1.0`). Ceux sous GPL ou à licence inconnue sont écartés. La liste exacte des
  greffons livrés, et des greffons écartés, est dans `GStreamer-PLUGINS.txt`.
- La construction vérifie aussi qu'aucune bibliothèque GPL connue n'entre dans l'AppImage :
  x264, x265, Xvid, postproc, FAAD, mpeg2enc, mplex, libdvdnav, libdca. Sinon, elle s'arrête.
- Sources : paquets source d'Ubuntu 22.04 (`gstreamer1.0`, `gst-plugins-base1.0`,
  `gst-plugins-good1.0`, `gst-plugins-bad1.0`, `gst-libav1.0`), disponibles sur
  `https://launchpad.net/ubuntu/jammy`.

## Autres bibliothèques de l'AppImage

WebKitGTK (LGPL 2 et BSD), GTK 3, GLib, libsoup et Cairo (LGPL), et leurs dépendances viennent
d'Ubuntu 22.04, non modifiées, sous leurs propres licences (LGPL, MIT, BSD). Le transport Remote
Play (str0m, sa cryptographie RustCrypto) est sous licences MIT ou Apache 2.0. Les licences des
bibliothèques Rust et JavaScript d'iBox sont listées dans iBox (Paramètres › Système › À propos ›
Mentions légales).

## Brevets

La question des brevets du format H.264 est traitée à part : `H264-PATENTS.md`.

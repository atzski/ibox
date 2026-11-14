# Phase 4 — Émulateurs (livrée)

Profils et sources : voir [EMULATORS.md](EMULATORS.md).

## Ce qui fonctionne

| Brique | Fichier | État |
| --- | --- | --- |
| Profils vérifiés (Dolphin, melonDS, PCSX2, DuckStation, PPSSPP, mGBA, RetroArch, personnalisé) | `src-tauri/src/launcher/profiles.rs` | ✅ |
| Émulateurs enregistrés, console par défaut, émulateur par jeu | `launcher/repo.rs` | ✅ |
| Recherche des émulateurs déjà installés (aucun téléchargement) | `launcher/detect.rs` | ✅ |
| Lancement sans shell, suivi de session, diagnostic d'échec | `launcher/launch.rs` | ✅ |
| Historique : dernière partie, nombre de parties, temps de jeu | migration `003_launcher.sql` | ✅ |
| Paramètres › Émulateurs (ajout, recherche, plein écran, arguments, cœurs, consoles) | `EmulatorsPanel.tsx` | ✅ |
| Bouton « Jouer » (états clairs), « Reprendre » sur l'accueil | `PlayControls.tsx`, `HomeScreen.tsx` | ✅ |
| Animation de lancement désactivable, message d'erreur explicite | `LaunchOverlay.tsx` | ✅ |
| Musique de menu en pause pendant la partie | `services/music.ts` | ✅ |

## Vérification

- 87 tests Rust (dont noms de fichiers piégés, `.bat` refusé, cœur `..` refusé, priorité
  émulateur par jeu, diagnostic des sorties), 27 tests interface.
- Application Windows, avec de faux émulateurs qui enregistrent les arguments reçus :
  - Dolphin détecté, reconnu, associé à GameCube/Wii ; arguments reçus exactement
    `-b -C Dolphin.Display.Fullscreen=True -e <chemin complet>` ;
  - session de 20 s → 1 partie, 20 s de jeu, « dernière partie » mise à jour ;
  - PCSX2 qui plante → « PCSX2 s'est fermé aussitôt (code 3) : « Erreur : BIOS PS2 introuvable » ».

## Limites connues

- Les profils n'ont pas été essayés avec les vrais émulateurs sur ce PC (aucun installé) :
  les options viennent du code source de chaque projet.
- Un seul jeu à la fois.
- Pas de bouton pour forcer la fermeture d'un émulateur (fermez-le normalement).
- Les jeux multi-disques sont lancés via leur `.m3u` (pris en charge par DuckStation et RetroArch).

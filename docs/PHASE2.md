# Phase 2 — Bibliothèque réelle (livrée)

Objectif : remplacer les jeux de démonstration par **vos vrais jeux**, détectés dans les
dossiers que vous choisissez, enregistrés dans SQLite, et actualisables — sans jamais
déplacer, modifier ni supprimer un fichier.

## 1. État : livrée

| Brique | Fichier | État |
| --- | --- | --- |
| Table des formats partagée TS ↔ Rust | `shared/platform-formats.json` | ✅ |
| Schéma SQLite v1 + migrations | `src-tauri/src/db/` | ✅ |
| Parcours, en-têtes, noms, identification, empreintes, rapprochement | `src-tauri/src/scanner/` | ✅ |
| Dossiers, jeux, corrections (SQLite) | `src-tauri/src/library/repo.rs` | ✅ |
| Actualisation transactionnelle, annulable, avec progression | `src-tauri/src/library/scan.rs` | ✅ |
| Commandes Tauri + sélecteur de dossier (`dialog:allow-open` seulement) | `src-tauri/src/library/commands.rs` | ✅ |
| Source native de l'interface, favoris en base, démo masquée automatiquement | `src/services/library.ts` | ✅ |
| Paramètres › Dossiers de jeux | `src/components/library/FoldersPanel.tsx` | ✅ |
| Actualiser (accueil, bibliothèque, paramètres) + pastille de progression | `ScanStatus.tsx` | ✅ |
| Badges Introuvable / À vérifier / Doublon, filtre « À vérifier » | `GameCard`, `LibraryScreen` | ✅ |
| Fiche jeu : identifiant, méthode, taille, avertissements, **Corriger** | `GameScreen.tsx` | ✅ |
| Accueil : premier lancement « Où se trouvent vos jeux ? » | `HomeScreen.tsx` | ✅ |

Tests : 49 en Rust (dont scénarios complets ajout → déplacement → doublon →
disparition → réapparition, correction verrouillée, disque débranché, annulation),
27 côté interface. Vérifié dans l'application Windows sur un dossier de test.

Décisions prises par défaut : pas d'archives `.zip`/`.7z` pour l'instant ; pas de
nouvelle console ; démo masquée dès qu'un vrai jeu est trouvé (réglage pour la garder).

Base : `%APPDATA%\app.ibox.desktop\library.db`.

### Reconnaissance, dans l'ordre demandé

1. **En-têtes** (confiance 0,98) — GameCube/Wii (ISO, GCM, RVZ, WIA, WBFS, CISO), DS, GBA,
   Game Boy/Color, N64 (3 ordres d'octets), Super Nintendo (LoROM/HiROM, en-tête copieur),
   3DS (NCSD), Switch (XCI, NSP/NSZ), PS1/PS2/PSP via ISO 9660 + `SYSTEM.CNF` / `PARAM.SFO`
   (secteurs 2048 et 2352), EBOOT.PBP. Chaque format est validé par signature ou somme
   de contrôle.
2. **Dossier associé** par l'utilisateur (0,9).
3. **Extension non ambiguë** (0,85) — `.gba`, `.nds`, `.z64`…
4. **Nom d'un dossier parent** (« …/PS2/… ») (0,7), comparaison exacte.
5. **Base de données** de titres (phase 3).
6. **Correction manuelle** — verrouille le jeu (`user_locked`) : les scans suivants ne
   l'écrasent plus.

Sous 0,5 de confiance (ex. un `.iso` illisible dans un dossier non associé), le jeu est
marqué **« à vérifier »** avec ses consoles possibles, au lieu d'être classé au hasard.
Formats compressés opaques (GCZ, CSO, CHD) : identifiés par dossier ou nom.

## 2. Limites connues (pour les phases suivantes)

- Jaquettes provisoires aux couleurs de la console : les visuels réels arrivent en phase 3.
- Les jeux d'autres consoles s'affichent dans un boîtier GameCube sur l'étagère 3D, et
  en jaquette plate sur leur fiche, jusqu'aux nouveaux modèles (phase 5).
- Les jeux multi-disques sans `.m3u` (« Disc 1 », « Disc 2 » séparés) restent deux entrées.
- Le bouton « Annuler » de la pastille de progression n'est pas encore atteignable au clavier.
- Formats compressés opaques (GCZ, CSO, CHD) : identifiés par dossier ou nom seulement.

## 3. Décisions prises au lancement de la phase 2

1. **Archives `.zip` / `.7z`** pour les consoles à cartouche : les reconnaître dès la
   phase 2 (lecture de l'en-tête dans l'archive) ou plus tard ?
2. **Jeux Wii U / autres consoles** non listées : à ajouter au registre maintenant ?
3. **Démo** : la masquer automatiquement dès qu'un vrai jeu est trouvé ?

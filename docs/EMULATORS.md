# Profils de lancement des émulateurs (phase 4)

Options vérifiées le 12/11/2026 **dans le code source** de chaque émulateur (et non sur
des forums, souvent contradictoires sur la syntaxe à un ou deux tirets).

| Profil | Consoles | Arguments | Plein écran | Source |
| --- | --- | --- | --- | --- |
| Dolphin | GameCube, Wii | `-b -e {rom}` — `-b` : « Run Dolphin without the user interface (Requires --exec…) », quitte avec le jeu | `-C Dolphin.Display.Fullscreen=True` (option de configuration `Main.Display.Fullscreen`) | `Source/Core/UICommon/CommandLineParse.cpp`, `Core/Config/MainSettings.cpp` |
| melonDS | DS | `{rom}` (argument positionnel `nds`) | `-f` / `--fullscreen` | `src/frontend/qt_sdl/CLI.cpp` |
| PCSX2 | PS2 | `-batch -- {rom}` — `-batch` : « exits after shutting down », `--` : fin des options | `-fullscreen` | `pcsx2-qt/QtHost.cpp` |
| DuckStation | PS1 | `-batch -- {rom}` | `-fullscreen` | `src/duckstation-qt/qthost.cpp` |
| PPSSPP | PSP | `--pause-menu-exit {rom}` — quitte à la fin du jeu au lieu du menu | `--fullscreen` | ppsspp.org › docs › command-line, `Windows/main.cpp` |
| mGBA | GB, GBC, GBA | `{rom}` (`usage: … [option ...] file`) | `-f` / `--fullscreen` | `src/feature/commandline.c` |
| Azahar (ou Citra, Lime3DS) | 3DS | `{rom}` en argument positionnel (`game_path = args[1]`, puis `BootGame(game_path)`) | `-f` / `--fullscreen` | github.com/azahar-emu/azahar : `src/citra_qt/citra_qt.cpp` |
| Lichii | Switch 2, Switch | `-g {rom}` (option `{"game", required_argument, 0, 'g'}`) | `-f` / `--fullscreen` (sans `-f`, un lancement avec `-g` désactive le plein écran) | github.com/zortos293/Lichii, branche `nx2` : `src/core/launch_params.cpp`, `src/yuzu/main_window.cpp` |
| RetroArch | N64, SNES, GB/GBC/GBA, DS, PS1, PSP | `-L {core} {rom}` (cœur choisi par console dans `cores/`) | `-f` / `--fullscreen` | man retroarch(6) |
| Personnalisé | autres | modèle libre, `{rom}` obligatoire | — | — |

Marqueurs : `{rom}` (fichier du jeu, argument entier), `{fullscreen}` (options de plein
écran du profil, ou rien), `{core}` (chemin du cœur RetroArch).

## Sécurité

- iBox ne télécharge **aucun** émulateur ni aucun jeu.
- Seuls des programmes `.exe` existants sont acceptés (pas de `.bat`/`.cmd`, interprétés par `cmd.exe`).
- Lancement par `std::process::Command` avec une **liste d'arguments** : aucun shell, aucune
  chaîne de commande construite à partir des noms de fichiers. Un nom comme
  `Tom & Jerry ; del *.iso` reste un argument unique et inerte (testé).
- Les cœurs RetroArch sont des noms de fichiers simples du dossier `cores` (pas de chemin, pas de `..`).
- Le dossier de travail est celui de l'émulateur (configurations portables respectées).

## Diagnostic

- Sortie en erreur dans les 6 premières secondes → message clair avec la dernière ligne
  d'erreur de l'émulateur (ex. « PCSX2 s'est fermé aussitôt (code 3) : « BIOS introuvable » »).
- Une partie compte à partir de 15 secondes (temps de jeu et nombre de parties).
- La musique de menu se met en pause pendant la partie et reprend ensuite.

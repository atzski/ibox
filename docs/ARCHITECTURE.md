# iBox architecture and design system

[← Home](../README.md) · [Developing iBox](DEVELOPMENT.md)

This page describes iBox as of version 0.1.104: how the app is put together, where each feature lives in the code, and the design tokens the interface is built on. The code is the reference; paths are relative to the repository root.

## 1. Technical overview

```
+------------------------- Tauri 2 window (WebView2) --------------------------+
|  React 19 + TypeScript + Vite + Tailwind 4                                   |
|                                                                              |
|  app/        shell, screen stack (zustand), transitions                      |
|  screens/    Home, Library, Game, PC game, Platforms, Settings,              |
|              Achievements, Community, SmartConfig                            |
|  components/ UI by feature (library, game, manual, social, remoteplay...)    |
|  three/      React Three Fiber scenes: shelf, inspect viewer, 3D cases       |
|  services/   business logic and zustand stores, bridges to Rust commands     |
|  input/      keyboard + gamepads -> abstract actions, spatial navigation     |
|  i18n/       French source text translated to English at render time        |
|  domain/     types, console registry, platform catalogue (no React)          |
+--------------------------------------+---------------------------------------+
                                       | invoke() / events
+--------------------------------------v---------- src-tauri/ (Rust) ----------+
|  db/ SQLite + migrations   scanner/ library/   metadata/ assets/ manuals/    |
|  launcher/ pc/ emulators/ smartconfig/   achievements.rs   inetbox.rs        |
|  remote_play/   capture.rs clips.rs   profile.rs shell.rs toast.rs ...       |
+------------------------------------------------------------------------------+
```

The interface never touches the file system, the network or other processes directly: it calls Rust commands registered in `src-tauri/src/lib.rs` (`invoke_handler`) through thin wrappers in `src/services/` (`native.ts`, `nativeLibrary.ts`, `metadata.ts`, `launcher.ts`, `emulators.ts`, `smartconfig.ts`, `remotePlay.ts`...). Long jobs (scans, downloads, installs, metadata) report progress through Tauri events. Launches use `std::process::Command` with separate arguments, never a shell.

In the browser preview (`npm run dev`), Tauri is absent: services fall back to a demo library (`domain/demoLibrary.ts`, `domain/pcDemo.ts`).

### Main choices

| Topic | Choice | Why |
| --- | --- | --- |
| Navigation | Screen stack in `app/navigation.ts` (zustand), no URL router | A desktop app driven by a gamepad has no URLs; Back (B / Escape) is a pop, transitions know their direction, and the focused element is remembered per screen. |
| State | zustand stores in `services/` | Light, and readable outside React (sounds, input controller, Rust events). |
| Persistence | SQLite for the library (`src-tauri/src/db/`, numbered migrations in `db/migrations/`, rolling backups); interface settings in a persisted zustand store (`services/settings.ts`, key `ibox.settings`) | The library is shared with the Rust side; settings stay instant to read. API keys go to the Windows Credential Manager (`metadata/keys.rs`). |
| Translation | French source text, English through `src/i18n/` | Components keep plain French strings; no translation calls scattered in the code. |
| 3D | React Three Fiber + Drei, Drei lightformers, no tone mapping (`flat`) | Works offline; tone mapping desaturated the cover art. |
| Missing artwork | Procedural covers painted in Canvas 2D (`art/`) | Original artwork, never a fake scan. |
| Sounds | Original Web Audio synthesis (`services/sound.ts`), optional imported menu music (`services/music.ts`, `menuMusic.ts`) | No official sounds are shipped. |
| File formats | `shared/platform-formats.json` | One table read by TypeScript and by the Rust scanner. |
| Native windows | Created asynchronously (overlay, toast window) | Creating a Tauri window from a synchronous command blocks WebView2. |

## 2. Interface (`src/`)

### Shell and navigation

- `app/App.tsx`: global mounts (top bar, hint bar, backdrop, notifications, update and achievement watchers), screen transitions.
- `app/navigation.ts`: routes `home`, `platforms`, `platform`, `library`, `game`, `settings` (with a category), `achievements`, `community`, `smartconfig`.
- `app/shellState.ts`: hints and ambience shared by the shell; `app/attract.ts`: idle mode.
- `components/shell/`: `TopBar`, `HintBar`, `Backdrop`, `QuickMenu`, `PadKeyboard` (virtual keyboard), `PadGlyph` (drawn controller buttons), `Players`, `FriendsButton`, `NotificationsButton`, `PowerButton`.
- `components/start/`: first-run `SetupWizard` and `ProfileGate`.

### Translation (`src/i18n/`)

French is the source language. `i18n/index.ts` installs a `MutationObserver` that replaces every visible text node and readable attribute (`placeholder`, `aria-label`, `title`, `alt`) with its English entry from `i18n/en.ts` as it appears. Templates such as `{0} jeux` cover variable text. Game data (titles, descriptions from providers) is left untouched. Switching language reloads the window. `scripts/i18n-extract.mjs` lists untranslated strings.

### Input and controllers (`src/input/`)

- `InputController.ts`: keyboard and gamepads produce the same abstract actions (move, confirm, back, page...).
- `spatial.ts`: pure spatial navigation algorithm (tested).
- `gamepad.ts`: several controllers at once, player slots P1 to P8, accelerated repeat, triggers as page up/down.
- `commands.ts`: quick menu and global search commands.

### Screens

`screens/`: `HomeScreen`, `LibraryScreen`, `GameScreen` (console game sheet), `PcGameSheet`, `PlatformsScreen` and `PlatformSheet` (iBox Platforms), `SettingsScreen` (pages in `screens/settings/`: Profile, Home, Display, Library, Sound, Remote Play, Controls, System), `AchievementsScreen`, `CommunityScreen`, `SmartConfigScreen`.

## 3. Feature modules

Each feature has an interface part in `src/` and a native part in `src-tauri/src/`.

| Feature | Interface | Native |
| --- | --- | --- |
| Library and scan | `services/library.ts` (store, variants), `components/library/` (folders, scan status, backups, uninstall) | `scanner/` (walk, headers, fingerprints, identification, reconciliation), `library/` (repository, scan, portable backups), `db/` |
| PC games | `services/pc.ts`, `components/pc/`, `screens/PcGameSheet.tsx` | `pc/` (Steam, Epic, GOG, Xbox, shortcuts from other launchers, running-game detection), `uninstall.rs` |
| Metadata and artwork | `services/metadata.ts`, `components/assets/` (artwork picker, iiDB panel), `components/library/MetadataPanel.tsx` | `metadata/` (GameTDB, LaunchBox, SteamGridDB, libretro, matching, media cache), `assets/` (iiDB illustrations, collections, music, sounds) |
| 3D cases and manuals | `three/cases/` (`KeepCase`, `GltfCase`, `RetroBox`, `GameCardModel`, `ManualBooklet`), `three/scenes/` (`ShelfView`, `InspectViewer`), `components/manual/` (reader, settings), `services/manualPdf.ts` (pdf.js) | `manuals/` (Steam, ScreenScraper, Internet Archive) |
| iBox Platforms and emulators | `screens/PlatformsScreen.tsx`, `screens/PlatformSheet.tsx`, `components/platforms/`, `domain/platformCatalog.ts`, `services/emulators.ts` | `emulators/` (official source catalogue, download, archive extraction, install, BIOS requirements), `launcher/` (detection, launch profiles, sessions) |
| SmartConfig | `services/smartconfig.ts`, `components/smartconfig/`, `screens/SmartConfigScreen.tsx` | `smartconfig/` (hardware detection, EmuReady and verified providers, recommendation engine, per-emulator adapters, backups and history) |
| Achievements | `services/retro.ts` (RetroAchievements, live watch), `services/steamAchievements.ts`, `components/achievements/` | `achievements.rs` (whitelisted RetroAchievements API, Steam) |
| iNetbox, friends, groups | `services/inetbox.ts`, `services/social.ts`, `services/groups.ts`, `components/social/` (friends, chat, groups, presence, toast window) | `inetbox.rs` (client and heartbeat), `toast.rs` (bottom-right window) |
| Remote Play | `services/remotePlay.ts`, `remotePlayOnline.ts`, `remotePlayGuest.ts`, `components/remoteplay/` | `remote_play/` (WGC/D3D capture, H.264 encode, Opus audio, peer-to-peer transport, signed signalling, virtual controllers, permissions) |
| Capture and clips | `components/overlay/OverlayWindow.tsx`, `services/community.ts`, `screens/CommunityScreen.tsx` | `capture.rs` (screenshots), `clips.rs` (MP4 clips with sound) |
| Profiles | `services/profiles.ts` (per-player settings), `components/profile/` (Profile Studio, avatars, banners), `services/avatarProviders.ts` | `profile.rs` (per-profile data folders) |
| Updates and shell | `services/updater.ts`, `services/shell.ts`, `services/notifications.ts` | `shell.rs` (tray, update install), `crash.rs`, `wallpaper.rs` |

Further detail: [PHASE2.md](PHASE2.md) (library), [PHASE3.md](PHASE3.md) (metadata), [PHASE4.md](PHASE4.md) (emulators), [PHASE5.md](PHASE5.md) (cases, controllers), [PC.md](PC.md), [PLATFORMS.md](PLATFORMS.md), [SMARTCONFIG.md](SMARTCONFIG.md), [REMOTE-PLAY.md](REMOTE-PLAY.md), [INETBOX-DATABASE.md](INETBOX-DATABASE.md) (mostly in French).

## 4. Design system

### Tokens (`src/styles/tokens.css`)

All colours, spacing, radii, shadows and motion live in `tokens.css` as CSS variables, then are mapped to Tailwind through `@theme` in `src/styles/global.css`. Each colour is declared once with `light-dark(light, dark)`; the theme follows `color-scheme` on `<html>` (System / Light / Dark setting). Dark mode is a soft blue-violet night, never pure black.

| Family | Values |
| --- | --- |
| Backgrounds | cream `#F8F7F3`, deep cream `#F1EFE8`; tinted white surface (`--ibox-white`) |
| Pastels | sky `#8CCDF1`, lavender `#B9A6E8`, mint `#A9DFC8`, peach `#F5C4AC`, each with `-soft` and `-deep` variants |
| Text | `--ibox-ink` `#344459` (9.4:1), `--ibox-ink-soft` `#637184` (4.6:1), `--ibox-ink-faint` decorative only; night `#E8ECF5` / `#A7B0C3` |
| Accent | `--accent`, `--accent-soft`, `--accent-deep` (solid fills), `--accent-text` (readable in both themes), `--accent-glow`; set by the active console |
| Tones | `--tone-blue`, `-green`, `-yellow`, `-orange`, `-red`, `-pink`, `-purple`, `-teal` and their `-ink` text variants, blended with the theme accent through `--theme-blend` |
| Spacing | 4 px base: `--space-1` to `--space-9` (4, 8, 12, 16, 24, 32, 48, 64, 96 px, in rem) |
| Radii | `--radius-sm` 12, `-md` 20, `-lg` 28, `-xl` 36 px, `--radius-pill` |
| Shadows | `--shadow-xs` to `--shadow-lg`, `--shadow-inset`; soft and ink-tinted |
| Motion | `--ease-out-soft`, `--ease-bounce`; `--dur-fast` 160 ms, `--dur-base` 260 ms, `--dur-slow` 480 ms |

The root font size is fluid, `clamp(14px, 0.62vw + 7px, 24px)`, multiplied by `--ui-scale` (interface size setting), so the same layout reads on a desk monitor and a TV.

Themes: `src/theme/appThemes.ts` defines the app palettes that replace the base tints in light mode; `src/theme/platformTheme.ts` sets the accent and spring personality of each console (bouncy, airy, snappy, calm, floaty). Console colours stay the same across palettes.

### Fonts

- **Cal Sans** (`src/assets/fonts/cal-sans/`, SIL Open Font License) is the interface font for titles and body text (`--font-display`, `--font-body`), declared with `@font-face` in `global.css`.
- **Nunito** (variable, Fontsource) is the fallback.
- **Fredoka** (variable, Fontsource) is used only for the titles painted on procedural covers (`src/art/covers.ts`).

All fonts are bundled, so the interface works offline.

### Accessibility

- Text colours meet WCAG AA contrast in both themes; `--ibox-ink-faint` is reserved for decoration.
- The *Animations* setting (System / Full / Reduced) drives Motion's `MotionConfig`, the CSS transitions and the 3D scenes.
- Every action is reachable with keyboard and controller; the focus ring takes the console colour.

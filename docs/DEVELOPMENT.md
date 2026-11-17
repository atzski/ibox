# Developing iBox

[← Home](../README.md) · [User guide](GUIDE.md)

iBox is a Windows desktop app built with **Tauri 2** (Rust, WebView2) and **React 19**, **TypeScript**, **Three.js** (React Three Fiber) and **SQLite**. This page is for people who want to build it, read the code or contribute.

## Requirements

- Windows 10 or 11, 64-bit
- [Node.js](https://nodejs.org/) 24
- [Rust](https://rustup.rs/) stable with the MSVC toolchain
- Visual Studio Build Tools with the C++ workload
- Microsoft Edge WebView2 Runtime (already present on most Windows installations)

## Commands

```bash
npm ci
npm run tauri dev      # Windows app with hot reload
npm run dev            # interface only, in a browser (http://localhost:1420)
npm test               # interface unit tests (Vitest)
npm run build          # type check + front-end build
cd src-tauri && cargo test   # Rust tests (scanner, database, metadata)
cd src-tauri && cargo test --test live_sources -- --ignored --nocapture   # real network tests
npm run tauri build -- --bundles nsis --config src-tauri/tauri.ci.conf.json
```

In the browser preview (`npm run dev`), native features (scanning, launching, iNetbox) are unavailable; iBox shows a small library of fictional demo games instead.

## Continuous integration

The [Windows build](../.github/workflows/windows.yml) workflow runs the TypeScript and Rust tests, then builds a test NSIS installer and its SHA-256 checksum, attached to the workflow run. These CI artifacts are not official releases: official versions are published on the [Releases page](https://github.com/atzski/ibox/releases). See [RELEASE.md](RELEASE.md) (in French).

Public builds let you import your own menu music under **Settings → Sound**. Media fetched from artwork providers are not included in the repository.

## Repository layout

| Folder | Contents |
| --- | --- |
| `src/` | React interface: screens, components, 3D scenes (`three/`), procedural artwork (`art/`), services, translations (`i18n/`) |
| `src-tauri/` | Rust side: SQLite library, scanner, metadata providers, launchers, emulator installation, iNetbox client, Remote Play, capture |
| `3d-assets/` | Sources and pipeline of the 3D game cases |
| `public/` | Static assets: console photos, case models, interface sounds |
| `docs/` | Documentation and README media |

## Data and restore

The standalone `ibox.exe` and the NSIS installer share the same Windows data folder, `%APPDATA%\app.ibox.desktop`. Game files always stay in their original folders.

Under **Settings → Library → Library backups**, pick a backup by date and number of games. iBox closes after confirmation; on the next launch, the previous database is archived in a `before-restore-*` folder. Backups cover the SQLite database only: game files and cached images stay on disk.

## Profile Studio and Riot Data Dragon

**Settings → Profile → Customize** edits the local profile with a live preview. Imported photos and banners stay on the PC. Riot references are saved without copying remote images into the repository.

**Riot Data Dragon** is configured under **Avatar sources**; its catalogue is paginated and images come from Riot's CDN. Before any wider public distribution of this feature, iBox must be registered and submitted to Riot's review. See the [Riot policies](https://developer.riotgames.com/policies/general).

## Technical documentation

Most design notes are written in French.

- [Architecture and design system](ARCHITECTURE.md)
- [Real library](PHASE2.md) · [Metadata and artwork](PHASE3.md) · [Emulators](PHASE4.md) · [Cases per console, controllers](PHASE5.md)
- [PC games](PC.md) · [iBox Platforms](PLATFORMS.md) · [Emulator launch profiles](EMULATORS.md)
- [Artwork sources and licences](PROVIDERS.md) · [3D assets](ASSETS.md)
- [Remote Play](REMOTE-PLAY.md) · [iNetbox database](INETBOX-DATABASE.md)
- [Regenerating the README media](media/README.md)

## Reporting a bug

[Open an issue](https://github.com/atzski/ibox/issues) with your iBox version (**Settings → System**), what you did and what happened. Check screenshots and logs for private information first, and never share API keys.

## Licence

iBox code is released under the [MIT licence](../LICENSE). The Cal Sans font is under the [SIL Open Font License](../src/assets/fonts/cal-sans/OFL.txt). Licence notices included in the repository still apply to the components they cover.

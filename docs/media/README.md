# README media

[← Development guide](../DEVELOPMENT.md)

Every image and animation here comes from the real iBox app, recorded from a real library. Nothing is mocked up.

| Folder | Contents |
| --- | --- |
| `branding/` | `ibox-wordmark.png` (current logo, cropped), `social-preview.png` (1280×640, for the repository’s **Settings → General → Social preview** on GitHub) |
| `demos/` | Animated WebP loops shown in the README (`collection-tour`, `home-collections`, `game-case`, `manual`, `platforms`) |
| `screenshots/` | Still WebP screenshots, 1600×900 unless cropped |

Animated WebP is used instead of GIF: the same 15-second library tour weighs about 4 MB in WebP and over 40 MB as a GIF, because of the moving blurred backgrounds. GitHub and current browsers display it.

## Recording again

Last recorded with iBox 0.1.103.

1. Build a copy of iBox with its own identifier, so it never touches your real data:
   `npx tauri build --no-bundle --config '{"identifier":"app.ibox.showcase"}'`
2. Copy your library into that copy's data folder (`%APPDATA%\app.ibox.showcase`: `library.db*`, `media`, `manuals`, `wallpaper`, `home-tiles`, `smartconfig`) and, for your settings, `%LOCALAPPDATA%\app.ibox.desktop\EBWebView\Default\Local Storage` into the matching `app.ibox.showcase` folder. Switch the copy to English and turn sounds and notifications off.
3. Start it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, connect with Playwright (`chromium.connectOverCDP`), set the viewport to 1707×960 at 1.125× (1920×1080 frames) and drive it with the keyboard or the viewer buttons. Record with the DevTools screencast (`Page.startScreencast`), which captures the page without the cursor or other windows.
4. Assemble the frames with FFmpeg using their timestamps, keep an H.264 master, then export:
   - collection tour: crop `1856:932:32:114`, 18 fps, 1000 px wide, `libwebp_anim -quality 45`
   - home collections: full frame, 18 fps, 1000 px wide, `-quality 45`
   - game case: crop `1066:876:790:114`, 18 fps, 640 px wide, `-quality 55`
   - manual: crop `1200:960:360:110`, 18 fps, 760 px wide, `-quality 50`
   - iBox Platforms: full frame, 18 fps, 960 px wide, `-quality 50`
5. Blur friends' names and any private message before publishing. Keep each animation under about 5 MB.

# Getting started with iBox

[← Home](../README.md) · [Download iBox](https://github.com/atzski/ibox/releases/latest)

This guide walks you through installation and connecting services. **API keys are optional**: they add features, but you can start using iBox without them.

## 1. Install iBox

1. Open the [latest release](https://github.com/atzski/ibox/releases/latest).
2. Under **Assets**, download the Windows file ending in `-setup.exe`.
3. Open the file, follow the installer, and launch iBox.
4. Follow the setup wizard to choose your game folders and configure your emulators.

Your games remain in their original folders. iBox does not include games, BIOS files or emulators: use your own legally obtained files.

**Need an emulator?** Open **iBox Platforms** from the home screen, choose a console and select **Install**. iBox downloads the recommended emulator from its official source, checks the file, installs it in your `iBox\Emulators` folder and links it to the console. The console page also tells you if a BIOS, firmware or Windows component is still missing and lets you import your own file; iBox never downloads BIOS files or keys. Emulators you already have are detected and reused.

## 2. What are API keys?

An API key is a personal code that lets iBox connect to a service using your account. You can enter keys during setup, or reopen the wizard later from **Settings → System → Setup wizard**. Choose only the services you want to use.

| Service | What it adds |
| --- | --- |
| Steam Web API | Owned Steam games, including games that are not installed. |
| SteamGridDB | Covers, logos and backgrounds. |
| iiDB | Artwork for consoles and games. |
| RetroAchievements | Retro achievements on game pages. |
| GIPHY | Animated stickers to decorate your collections. |
| ScreenScraper account | Optional: your own quota for finding game manuals. |

**Keep your keys private**, just like passwords. Never include them in screenshots, messages or GitHub issues. If you share one accidentally, revoke or regenerate it on the service’s website, then replace it in iBox.

## 3. Create your keys

### Steam Web API

1. Sign in to Steam, then open the [official Steam API key page](https://steamcommunity.com/dev/apikey).
2. If Steam asks for a domain name, enter `localhost`, accept the terms and submit.
3. Copy the displayed key. In iBox, paste it into **Steam Web API key** and select **Save**.
4. To allow Steam to share your game list, open **Profile → Edit Profile → Privacy Settings** in Steam and set **Game details** to **Public**. This makes those details publicly visible, so change it only if you are comfortable doing so.

If Steam refuses to create a key, follow the instructions on its page: Steam determines account eligibility.

### SteamGridDB

1. Open [SteamGridDB](https://www.steamgriddb.com/) and sign in or create an account.
2. Open [Preferences → API](https://www.steamgriddb.com/profile/preferences/api).
3. Select **Generate API Key** and copy the key.
4. In iBox, paste it into **SteamGridDB key** and select **Save**.

### iiDB

1. Sign in or create an account on [iiSU Accounts](https://accounts.iisu.network/).
2. Copy your **iiDB API key** from your profile. See the official [iiDB getting started page](https://iisu.network/wiki/iidb-developers/getting-started) for details.
3. In iBox, paste it into **iiDB API key** and select **Save**.

### RetroAchievements

1. Create an account or sign in to [RetroAchievements](https://retroachievements.org/).
2. Open your [settings](https://retroachievements.org/settings) and copy your **Web API Key**. This is not your password.
3. In iBox, paste it into **RetroAchievements API key** and select **Save**. Also enter your RetroAchievements username in iBox settings if prompted.
4. To earn achievements while playing, configure RetroAchievements separately in a compatible emulator; adding the key to iBox does not configure your emulator.

### GIPHY

1. Sign in or create an account on [GIPHY Developers](https://developers.giphy.com/).
2. Select **Create an API Key**, choose **API** and copy the key.
3. In iBox, open the home screen, select **Add a decoration** (the sparkle button next to your collections), open the stickers search and paste the key once.

### ScreenScraper account (optional)

iBox finds game manuals on its own (Steam, ScreenScraper, Internet Archive). A free account on [ScreenScraper](https://www.screenscraper.fr/) gives you your own quota, so manuals arrive faster when the service is busy.

1. Create an account on ScreenScraper.
2. In iBox, open **Settings → Manuals → ScreenScraper account** and enter your username and password. The password is checked with ScreenScraper, then stored in the Windows vault.

## 4. Controls

iBox works with a controller, a keyboard or a mouse, and you can switch between them at any time. Up to eight controllers are recognised (P1 to P8).

| Action | Keyboard | Controller | Mouse |
| --- | --- | --- | --- |
| Navigate | Arrow keys | D-pad / left stick | Hover / click |
| Confirm | Enter | A (bottom button; right button on Nintendo layouts) | Click |
| Back | Esc / Backspace | B | Back arrow, top left |
| Switch view (library) | Q / E | L / R | 3D shelf / Covers switch |
| Turn the case around | ← → (viewer focused) | Right stick | Drag |
| Open / close the case | Enter (viewer focused) | A | Double-click or **Open** |
| Zoom | + / − | Triggers | Mouse wheel |
| Quick menu (go anywhere, list of controls) | F1 | Start | — |
| Search | / | Select | Search button |
| Previous / next game (game page) | Q / E | LB / RB | — |
| Turn the manual's pages | ← → | D-pad | Click |

Open a case and click its booklet to read the game's manual. If none was found, **Manual** on the game page offers the versions found, or lets you import any PDF.

During a game, **Alt+E** opens the iBox overlay to save a screenshot or a clip of the last seconds.

## 5. Troubleshooting

- **Key rejected:** check that you signed in to the correct account, copy the entire key without extra spaces, and try again.
- **Steam games missing:** check the public game details setting, then refresh your library.
- **Missing artwork or achievements:** the service may not have a result for that game. Check the game name and your connection to the service.
- **No manual in the box:** iBox only keeps a manual when it is sure of the edition. Use **Manual** on the game page to pick one of the versions found, import a PDF, or select **Refresh manuals** in **Settings → Manuals**.
- **Need help?** Open an [iBox issue](https://github.com/atzski/ibox/issues) with your version, the steps you followed and the error message. Do not share your keys or personal information.

External websites can change their menus. If a step no longer matches, follow the service’s current instructions and let us know in an issue.

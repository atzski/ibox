# Getting started with iBox

[← Home](../README.md) · [Download iBox](https://github.com/atzski/inbox-releases/releases/latest)

This guide walks you through installation and connecting services. **API keys are optional**: they add features, but you can start using iBox without them.

## 1. Install iBox

1. Open the [latest release](https://github.com/atzski/inbox-releases/releases/latest).
2. Under **Assets**, download the Windows file ending in `-setup.exe`.
3. Open the file, follow the installer, and launch iBox.
4. Follow the setup wizard to choose your game folders and configure your emulators.

Your games remain in their original folders. iBox does not include games, BIOS files or emulators: use your own legally obtained files and install the software needed to run them.

## 2. What are API keys?

An API key is a personal code that lets iBox connect to a service using your account. You can enter keys during setup, or reopen the wizard later from **Settings → System → Setup wizard**. Choose only the services you want to use.

| Service | What it adds |
| --- | --- |
| Steam Web API | Owned Steam games, including games that are not installed. |
| SteamGridDB | Covers, logos and backgrounds. |
| iiDB | Artwork for consoles and games. |
| RetroAchievements | Retro achievements on game pages. |

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

## 4. Troubleshooting

- **Key rejected:** check that you signed in to the correct account, copy the entire key without extra spaces, and try again.
- **Steam games missing:** check the public game details setting, then refresh your library.
- **Missing artwork or achievements:** the service may not have a result for that game. Check the game name and your connection to the service.
- **Need help?** Open an [iBox issue](https://github.com/atzski/ibox/issues) with your version, the steps you followed and the error message. Do not share your keys or personal information.

External websites can change their menus. If a step no longer matches, follow the service’s current instructions and let us know in an issue.

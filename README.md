# RIPPERDOC

🇬🇧 English · [🇩🇪 Deutsch](README.de.md)

A mod manager for **Cyberpunk 2077**, styled like the game's menus. Mods are not copied into the game folder;
they are deployed from a separate staging folder via **hardlinks**. Every change is written to the journal before
it happens, and **PURGE → VANILLA** verifiably returns the game folder to its state before the first mod.

> **This is an unofficial fan work and is not approved/endorsed by CD PROJEKT RED.** Free and non-commercial.
> The UI sounds come from Cyberpunk 2077 (© CD PROJEKT S.A.), see [NOTICE.md](NOTICE.md).
> Working title.

## Status

| Step | Contents | Status |
|---|---|---|
| 0 | Scaffold, theme + UI kit, game detection, boot | ✅ v0.1 |
| 1 | Import → analysis → staging → hardlink deploy, journal, purge, launch | ✅ v0.1 |
| 2 | Framework watcher: CET, RED4ext, redscript, ArchiveXL, TweakXL, Codeware from GitHub | open |
| 3 | Nexus: API key, `nxm://` button, downloads, update check | ✅ v0.2 |
| 4 | Conflicts inside `.archive` files (RDAR scan), `modlist.txt` | open |
| 5 | Profiles + savegame backups | open |
| 6 | Diagnostics: logs after the game exits, crash bisect | open |
| 7 | Packaging: installer + portable zip | ✅ v0.3 |
| 7 | FOMOD, REDmod deploy | open |

## Install (for users)

- **Installer:** double-click `RIPPERDOC-Setup-<version>.exe`. Installs without admin rights to
  `%LOCALAPPDATA%\Programs\RIPPERDOC`, creates desktop and Start menu shortcuts and shows up under “Apps” for
  uninstalling. When uninstalling, RIPPERDOC asks whether mods that are still deployed should be removed from the
  game folder first (PURGE). The data folder and settings are always kept.
- **Portable:** unzip `RIPPERDOC-<version>-portable.zip` and start `RIPPERDOC.exe`.
- Without a code-signing certificate, Windows SmartScreen shows a warning on first launch
  (“More info → Run anyway”).
- Your own UI sounds for the installed version: `%APPDATA%\RIPPERDOC\sounds\sfx_<name>.wav`.
- The Steam version of Cyberpunk 2077 is found automatically. Otherwise: SYS.CONFIG › “Choose game folder…”.
- UI in English and German: SYS.CONFIG › Look › Language (AUTO follows the Windows language).

Build packages: `npm run dist` → `release/<version>/` (installer, zip, `win-unpacked/`). `npm run pack` only
builds `win-unpacked/` for quick testing.

## Run (development)

```powershell
npm install
# If node_modules\electron\dist is missing (postinstall didn't run):
node node_modules\electron\install.js
npm start          # builds and starts
npm run dev        # with hot reload for the UI
npm test           # tests (layout detection, deployer in a test game folder, first start, languages)
npm run typecheck
npm run shortcut   # RIPPERDOC shortcut on desktop + Start menu (then double-click)
```

The shortcut always starts the latest build (`out/`). After code changes, run `npm run build` once.
Remove it again: `scripts\install-shortcut.ps1 -Remove`. `npm run icon` generates the icon (`build/icon.ico`).

Requirements: Windows 10/11 and Node 22 or newer. For unpacking, RIPPERDOC uses Windows' own `tar.exe`
(handles zip, 7z and rar), so nothing else needs to be installed.

## Usage

- **Install:** drag archives (zip/7z/rar), loose `.archive` files or folders into the window, or use
  `+ INSTALL` or `Ctrl+O`. The dialog shows where every file goes, what the mod provides and what it requires.
  If an archive contains several equivalent folders (“Option A / Option B”), you pick a variant.
- **Toggles:** take effect immediately (hardlinks take milliseconds). While the game is running, nothing is changed.
- **Load order:** drag rows in INVENTORY. **Top wins** when two mods ship the same file.
- **Update:** import a new archive of the same mod (same name or same Nexus ID) → “Install update” keeps
  position and toggle.
- **PURGE:** takes everything out of the game folder, puts backed-up game files back, resets the script cache and
  compares against the vanilla snapshot. After that, VANILLA MODE applies: toggles only change the selection,
  **RE-DEPLOY** deploys it again.
- **LAUNCH:** first deploys everything cleanly (repairing broken links on the way), then starts the game, either
  directly via the exe (with `-skipStartScreen`) or via Steam.
- **Keys:** `Q`/`E` switch tabs like in the game.

## Nexus Mods

- **Key:** NET › Uplink. Your personal API key from nexusmods.com (Settings › API Keys). It is verified and only
  stored encrypted (Windows DPAPI via Electron `safeStorage`, file `%APPDATA%\RIPPERDOC\nexus-key.bin`). It is
  only sent to api.nexusmods.com, never to the game or the journal.
- **Mod Manager Download:** when you connect the key, RIPPERDOC takes over `nxm://` links if no other program
  owns them (NET › Mod Manager Download: connect, take over, disconnect). A click on the website starts RIPPERDOC
  (or sends the link to the open window), downloads the file and opens the install dialog with name, author,
  picture and version from Nexus.
- **Updates:** on start, every 6 hours (and via “Check now”) for every mod with a Nexus ID: the file's update
  chain, otherwise the mod version. With Premium, “Get update” downloads directly; without Premium, “Nexus”
  opens the file page. An update replaces the old mod in the same position; optional extra files of the same mod
  are not suggested as replacements automatically.
- **Nexus outage:** RIPPERDOC retries hanging or broken requests, resumes interrupted downloads where they stopped
  and keeps retrying in the background. NET then shows “NEXUS OUTAGE”, the next attempt and what Nexus' public
  status page reports (queried without a key). Installed mods, PURGE and LAUNCH don't need Nexus.
- One-time setup without the UI: environment variable `RIPPERDOC_NEXUS_KEY` at start (removed from the
  environment immediately so the game never inherits it).

## Safety

- Base game archives (`archive/pc/content`, `archive/pc/ep1`), the exe and `r6/cache` are off limits for mods.
- Before the first deploy, `snapshot-vanilla.json` (all files in the game folder) plus a copy of `r6/cache` are
  created.
- Foreign files in a mod's way move to `backups/files` and come back when the mod is turned off.
- Files that mods create at runtime (settings, logs) or that were changed from outside are never deleted; they are
  rescued to `overwrite/` and deployed again with their mod.

## Data folder

Default: `<game drive>:\RipperdocData` (same drive, otherwise hardlinks don't work).

```
RipperdocData/
  mods/<id>/files/…      the mod exactly as it sits in the game folder
  mods/<id>/docs/…       readmes & co.
  mods/<id>/mod.json     name, version, source, types, files, dependencies
  downloads/             original archives
  profiles/Default.json  load order + toggles
  deployment.json        what is currently in the game folder (incl. inode per file)
  journal/*.jsonl        every change, before it happens
  backups/files/         displaced game files
  backups/vanilla/       copy of r6/cache before the first mod
  overwrite/             rescued runtime files
  snapshot-vanilla.json  state before the first mod
```

App settings: `%APPDATA%\RIPPERDOC\settings.json`.

## Docs

[docs/CHANGELOG.md](docs/CHANGELOG.md) (versions) · [docs/TECHNICAL.md](docs/TECHNICAL.md) (architecture, quirks,
test hooks) · [sounds/README.md](sounds/README.md) (UI sounds)

## License

Code: MIT, see [LICENSE](LICENSE). Excluded are the original sounds in `sounds/game/` (© CD PROJEKT S.A.).
Third-party components and trademarks: [NOTICE.md](NOTICE.md).

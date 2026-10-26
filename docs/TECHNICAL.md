# Technical notes

## Structure

Electron + TypeScript + React, built with electron-vite (Vite 8).

```
src/shared/      Types, API contract (CoreApi + CORE_METHODS), framework table, brand name (brand.ts)
src/main/        Node side: everything that touches files
  core.ts        holds everything together, queue for mutating actions, doesn't know about Electron
  index.ts       window, IPC (one handler per CORE_METHODS entry), test hooks
  game/          Steam (registry + libraryfolders.vdf + appmanifest), GOG, Epic, PE version reader
  install/       extraction (Windows tar), layout detection (analyze.ts)
  mods/          staging (store.ts), profile (profiles.ts)
  deploy/        planning, deployer, guard, journal, snapshot
  launch.ts      game launch + process monitoring (tasklist)
src/preload/     contextBridge: window.rd (only invoke + events, no Node APIs)
src/renderer/    UI (React), UI kit in ui/kit.tsx, styles in styles/
tests/           vitest: layout detection, deployer in the test game folder, game detection (read-only)
```

## Deployer

`planDeployment()` (pure computation) turns profile + mods into the desired state: map `target path → {mod, source}`.
Load order = priority, index 0 wins. Rescued overwrite files of active mods beat everything.

`Deployer.apply(desired)`:
1. For each file in the manifest: still wanted and link intact → stays. Wanted but broken → link again
   (self-healing). No longer wanted → `unlink` if it belongs to us (hardlink: same inode as when it was
   linked; copy: size + time), otherwise rescue it to `overwrite/`. Put the backed-up original file back.
2. Missing files: check the guard, create parent folders (with the owning mod in the manifest), move a foreign
   file to `backups/files`, `fs.link` (on EXDEV/EPERM: copy).
3. Clean up our own folders that have no files of ours; whatever is still in them was created by a mod at
   runtime → rescue it to `overwrite/`, owner = mod of the deepest folder of ours above it.

Every step goes into the journal first. If something was rescued, `Core.applyNow()` plans again right away, so
the rescued version is deployed again from `overwrite/` immediately.

`r6/cache`: redscript writes into it at runtime. On the first deploy the cache is copied and hashed
(`backups/vanilla`). Once redscript is no longer installed (and on PURGE), `restoreCache()` resets the cache to
the snapshot. Only if the game build is the same; otherwise a hint to run Steam “Verify integrity of game files”.

## Layout detection

`analyze()` works on the file list only; contents are read by `peek()` (info.json, .reds, .lua; max. 512 KB).

1. Throw out junk (`__MACOSX`, `Thumbs.db`, …).
2. Find anchors: folders that contain game root folders which also look the part (`archive/pc`, `bin/x64`,
   `r6/scripts|tweaks|input|config`, `engine/config|tools`, `red4ext`, `mods/<x>/info.json`). The shallowest
   win. Several at the same depth → **variants**.
3. No anchor → by type: REDmod (info.json with a name) → CET (folder with init.lua) → RED4ext (folder with dll)
   → `.reds` / `.yaml|.tweak` (common folder is kept) → `.archive`/`.xl` flat → `.asi` → `.xml` (Input).
   Duplicate targets from different top-level folders → variants.
4. The guard filters out blocked targets. Types, bundled frameworks (marker files) and dependencies
   (types + contents, e.g. `import Codeware`) come from `summarize()`.

## Nexus

`src/main/nexus/`:
- `client.ts`: API v1 (`users/validate`, `mods/{id}`, `mods/{id}/files`, `download_link`), headers
  `apikey`, `Application-Name`, `Application-Version`; reads `x-rl-hourly/daily-remaining`. Errors 401/403/
  404/410/429 as understandable messages. Timeout 20 s per attempt; outages (network, 408, 5xx, HTML instead of
  JSON, Cloudflare 403) are retried after 1.5 s and 5 s (`NexusError.transient`). After every request
  `onHealth` reports “responding” or the outage (429 counts as an outage).
- `statuspage.ts`: public status page `nexusmods.statuspage.io/api/v2/summary.json` (no key), at most
  every 3 min, immediately when an outage begins.
- `keystore.ts`: key stored only encrypted (`safeStorage`, in tests a toy encryption). Without
  encryption nothing is stored. `safeStorage` is tied to the `Local State` of the userData folder: keys saved
  with `--userdata` only work there.
- `nxm.ts`: `nxm://cyberpunk2077/mods/<mod>/files/<file>?key&expires&user_id`; key/expires allow the
  download without Premium. `redactNxm()` for messages.
- `updates.ts`: version comparison, update chain (`file_updates`: old_file_id → new_file_id), predecessor
  of a file (for “Replace”), preview image = image URL with `/thumbnails/`.
- `downloads.ts`: queue (FIFO, one file at a time). A job first fetches the Nexus data
  (`prepare`, state `preparing`), then the links, then the file. `.part` file until the last byte; on
  abort it stays and the next attempt sends `Range: bytes=<size>-` (206 → append,
  200 → start over, 416 → drop the partial file). Up to 3 retries (2/5/10 s), rotating through the CDN links;
  403/410 from the CDN → fetch the links again. 30 s without data = stalled. Same size already present → no new
  download. `retry(id)` for “Retry”.
- `service.ts`: status, set/delete key, register nxm, links and updates; cache
  `<data>/nexus-updates.json` (6 h). `init()` doesn't go online (the window appears immediately); the check
  happens in `Core.backgroundNexus()`. Last known account in `<userData>/nexus-account.json`; during an outage
  it stays as is (`verified: false`), `outage` carries the reason and the next attempt (30 s, 1, 2, 5, then
  every 10 min). If an attempt succeeds, `onRecovered` catches up on a due update check. The update check
  aborts during an outage, keeps old results and doesn't set `checkedAt`.

Registration (`index.ts`): `app.setAsDefaultProtocolClient('nxm', electron.exe, [project folder])` →
`HKCU\Software\Classes\nxm`, command `"electron.exe" "<project folder>" "%1"` (dev build); the installed version
registers `"RIPPERDOC.exe" "%1"`. Links arrive via
`process.argv` (cold start) or `second-instance` (app already open). Imports that are ready before the UI
are buffered by `Core.pendingImports()`.

## Game detection

`HKLM\SOFTWARE\WOW6432Node\Valve\Steam` InstallPath (fallback HKCU SteamPath) → `steamapps/libraryfolders.vdf`
→ `appmanifest_1091500.acf` (installdir, Phantom Liberty = depot with `dlcappid 2138330`, language).
No Steam hit: GOG (`HKLM\SOFTWARE\WOW6432Node\GOG.com\Games`, all `path` values via `reg query /s`), then
Epic (`.item` JSONs in `<AppDataPath>\Manifests`, fallback `%ProgramData%\Epic\EpicGamesLauncher\Data`). Only a
folder that really contains `bin\x64\Cyberpunk2077.exe` ever counts; Phantom Liberty there = `archive\pc\ep1`.
GOG/Epic always launch via the exe (steam:// would only work for Steam). Nothing found → SYS.CONFIG
“Choose game folder…” (also accepts `bin\x64` or the exe itself). The data folder is pinned on the first
hit; if it was in the fallback folder until then and there are no mods yet, it moves to the game's drive
and the app restarts once. Changing the folder only without deployed mods (PURGE first); the old
vanilla snapshot then becomes `snapshot-vanilla.old-<time>.json`. Tests: `LocateSources` + `dataRootFor`
replace the registry and the drive.
Version: own PE reader (load `.rsrc`, search for UTF-16 “ProductVersion”/“FileVersion”). Patch 2.5 =
ProductVersion `2.5`, FileVersion `3.0.5813403` (= 3.0.88.46235, the LS part is 88·65536+46235).
The build is remembered in the settings; if it changes, the app shows “GAME UPDATED”.

## Languages

`src/shared/i18n/`: one area per file (`common`, `main`, `inventory`, `shell`, `net`, `config`), each with
German and English side by side via `area()`; tsc reports missing/extra keys and mismatched
parameters. `t('net.btn.connect')`, values as arguments (`t('inv.mod.docs', n)`), plurals inside the function.
The main process and the UI each have their own current language: main sets it in `Core.init()` /
`applyLanguage()` from `settings.language` + `app.getPreferredSystemLanguages()`, the UI from
`settings.language` + `AppInfo.systemLang`; the frame is keyed to it via `key={lang}`. Messages from main are
created already translated (errors, notifications, `GameInfo.error`). New strings: never directly in JSX/`new Error()`,
always a key in the matching area. Comments and `console.*` stay in German.

## Packaging

`electron-builder.yml`: NSIS one-click per user + zip, both x64, output `release/<version>/`. Electron comes
from `node_modules/electron/dist` (`electronDist`), `scripts/after-pack.cjs` throws out Electron's `default_app.asar`.
Into the package: only `out/**` + `package.json` (React is bundled by Vite, hence a devDependency), plus as
extraResources `sounds/default`, `build/icon.ico`, LICENSE, NOTICE. No code signing.
Uninstall: `build/installer.nsh` hooks into `customUnInit` (after the running app is closed, before
deletion) and calls `RIPPERDOC.exe --uninstall`, except with `--updated` (update) or an explicit `/S`.
This mode opens no window, loads the core and asks via `uninstall.ts` (no Electron, tested) only if
`Core.deployedFiles() > 0`. Exit 2 aborts the uninstall. Test hook `--answer=purge|keep|cancel`.
Checked on the built package: silent install/uninstall (Apps entry, shortcuts, AppData stays),
`--uninstall` with a deployed mod in a sandbox. Only a human can click through the dialog via the real
uninstaller (not silent).

## Test hooks

```powershell
node_modules\electron\dist\electron.exe . --noboot --screen=inventory --shot=C:\tmp\x.png --shot-delay=1500
node_modules\electron\dist\electron.exe . --userdata=C:\tmp\demo\user --import="C:\tmp\a.zip" --shot=...
```

- `--shot=<png>`: image of the window after `--shot-delay` ms, then quit (the Windows window buttons are
  missing from the image; they sit outside the page).
- `--screen=<id>`: inventory, cyberware, loadorder, net, journal, config.
- `--noboot`: skip the boot sequence.
- `--userdata=<folder>`: different settings; with `settings.json` → point `gameRoot`/`dataRoot` at a
  test game folder, then the real game isn't touched.
- `--import=<file>`: open the import dialog after startup.
- `--nexus-offline`: every request to api.nexusmods.com fails (to simulate an outage and check the display).

## Gotchas

- Always extract with `%SystemRoot%\System32\tar.exe` (bsdtar/libarchive). The `tar` from Git/MSYS can't handle zip/7z.
- npm once didn't run Electron's postinstall → `node node_modules\electron\install.js`.
- Steam asks for confirmation every time with `steam://run/…//<args>`. Hence: launch via Steam without arguments,
  `-skipStartScreen` only for a direct exe launch.
- Hardlinks only work on the same drive; that's why the data folder sits on the game's drive by default.
  On a different drive files are copied (detecting “our file” then works via size + time).
- `fs.stat(..., { bigint: true }).ino` returns the NTFS file index on Windows; that's how the deployer recognizes
  its links.
- Preload runs with `sandbox: true`; electron-vite bundles `@shared` into it.
- Config files are `.mts` (otherwise Vite 8 warns about ESM in CommonJS).

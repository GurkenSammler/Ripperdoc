# Changelog

## 0.4.0 – 2026-10-30
- **Nexus requirements:** the install dialog and the mod detail show what the mod's Nexus page lists as
  requirements (via Nexus' GraphQL API, works without a key), with present / off / missing and the author's notes.
  Missing, non-optional ones are pre-checked and fetched after installing: Premium downloads the main file
  directly and installs it without a dialog when clear; without Premium, RIPPERDOC opens the Nexus pages and the
  “Mod Manager Download” click from there is handled the same way. INVENTORY shows a “NEEDS …” chip and the
  PROBLEMS filter includes these mods. Cached for 24 h in `<data>/nexus-requirements.json`.
- **Nexus collections:** new SHARDS tab. Paste a collection link, `nxm://…/collections/…` (the website's
  collection button) or the short name → list of all files with present / newer / older-or-same / missing /
  unavailable, optional and 18+ markers, sizes, search and state filters with counts, selection that survives
  switching tabs. Premium: download everything selected. Without Premium: open the file pages in batches of 5
  (one click on “Slow download” per file is Nexus' rule) with an “opened N/M” counter. **No silent downgrades:**
  an entry only counts as an update when its version is really newer than yours; older or equal ones are never
  pre-selected and, if you pick them anyway, install with the dialog. Collection installer instructions (FOMOD
  choices, rules) are not applied yet.
- **Mod sharing (shards):** share your mod list as a code (`RDSHARD1:` + deflate + base64url), a `.rdshard` file
  or a Markdown list with Nexus links. Only references, never files. Opening a shard (paste, file dialog, drop
  onto the window or double-click on a `.rdshard` with the installed version) shows it like a collection;
  “Apply load order” (with confirmation) takes over the sender's order and toggles.
- **Endorse** button in the mod detail (Nexus API; only works for mods downloaded with your account).
- **Auto-install:** downloads from collections, shards and requirements (and all Nexus downloads with the new
  SYS.CONFIG › Install › Quick install) skip the dialog when there is nothing to decide (one variant, nothing
  unknown or blocked, replacement certain). They are deployed together once no auto download is running anymore
  (at most every 60 s), with one message for all. If the game is running, they stay collected (one warning) and are
  deployed on the next attempt; a replaced mod's files are only deleted after that deploy.
- **Multi-select in INVENTORY:** Ctrl+click / Shift+click / Ctrl+A, Esc clears; then enable, disable or remove all
  in one deploy. Search also matches author and Nexus ID. A requirement that is installed but off shows “X OFF”
  with an “Enable” button.
- NET: “Cancel N queued” for long download lists; outdated files without a clear successor show “PICK FILE”.
- **Archive cleanup:** SYS.CONFIG › Install shows how much space the kept archives use and deletes the ones no
  installed mod needs anymore.
- **Fix: update check for multi-file mods** (e.g. Garage: core + service parts under one mod ID). A file that is
  still current on Nexus is no longer reported as outdated just because the mod version rose; an outdated file
  without an update chain follows the successor with the same file title, otherwise it shows “UPDATE ?” with a
  Nexus button instead of offering the wrong file. File titles ignore version numbers in them (“CET 1.38.0 …”).
- **Fix: replacing the right file:** downloading another file of the same mod no longer offers to replace a
  different part; local re-imports of Nexus-named archives match the record with the same file title, and with
  several files of one mod and no match nothing is suggested. New records remember their Nexus file title.
- **Robustness (review with several agents):** GraphQL answers that carry data and an error (one hidden mod in a
  batch) keep the data; lookups someone waits for use a short timeout instead of retries; no stuck outage banner
  without a key; nxm clicks expected from a plan expire after 30 min or when the plan is closed; the import
  refuses if the mod to replace changed meanwhile; archives being imported are safe from “Delete unused”;
  requirement lookups after a collection are bundled; “NOT optional” notes count as required; IPC only opens
  folders of known mods and reads shard files from local drives only.
- Collection cover images (media.nexusmods.com) allowed in the CSP. 33 new tests, 127 in total.

## 0.3.0 – 2026-10-26
- **Installer + portable version** (electron-builder 26.17.0): `RIPPERDOC-Setup-0.3.0.exe` (no admin rights,
  desktop + Start menu, entry under “Apps”) and `RIPPERDOC-0.3.0-portable.zip`. On uninstall, RIPPERDOC itself
  asks (German/English) whether deployed mods should be removed first via PURGE: reset, leave as is, or cancel.
  Not on updates and not with silent `/S`. Data folder and settings stay; the nxm association is removed if it
  points to RIPPERDOC. No code signing (SmartScreen warning).
- **Original UI sounds from Cyberpunk 2077** (`sounds/game/`, © CD PROJEKT S.A.) now ship in the repo and the
  installer (non-commercial, under CD PROJEKT RED's Fan Content Guidelines). The error sound is then
  “menu_close” instead of the synthesized one. Required notice “unofficial fan work, not approved/endorsed by CD
  PROJEKT RED” in SYS.CONFIG › About, README and NOTICE. Your own sounds: `sounds/custom` (private) or
  `%APPDATA%\RIPPERDOC\sounds` (also in the installed version).
  5 new tests, 94 in total.
- **First launch on another PC:** game detection now tries Steam → GOG → Epic (previously Steam only). If nothing
  is found, SYS.CONFIG offers “Choose game folder…” (the message used to point to a button that didn't exist)
  and “Auto-detect”. The data folder then goes on the game's drive (hardlinks); if needed, RIPPERDOC restarts
  once. Changing the folder only after PURGE.
- **GOG/Epic launch via the exe**, even if “Launch via” is set to Steam.
- **Fix:** If the exe can't be started (broken, blocked by an antivirus), you get “The game failed to start: …”
  instead of just “spawn UNKNOWN”.
- 18 new tests (game detection on a fake PC, first launch, folder change, launch per store version), 80 in total.
- **English:** the complete UI and all messages from the main process in German and English
  (`src/shared/i18n/`, ~300 strings). SYS.CONFIG › Look › Language: AUTO / DEUTSCH / ENGLISH; AUTO follows the
  first Windows language (German stays German, everything else gets English). Switching takes effect immediately.
  If an English string is missing, the project doesn't build (tsc). Times/dates follow the language. German is
  now correct for a count of 1 (“1 Datei” instead of “1 Dateien”). Texts saved earlier (journal notes, detection
  rule in the mod) stay in the language they were created in. 9 new tests, 89 in total.

## 0.2.1 – 2026-10-25
Reason: that evening Nexus itself reported an outage (“Slow website / API responses”).

- **Nexus outages:** Every API request has a timeout (20 s) and is retried twice on network errors, 5xx or
  Cloudflare pages. Genuine responses (invalid key, not found) are never retried. The rate limit (429) names the
  time when requests work again.
- **No more hanging on startup:** The account is only checked after the window has opened; until then (and
  during an outage) the last known account applies (`%APPDATA%\RIPPERDOC\nexus-account.json`, only name
  and Premium, no secret). Premium downloads therefore carry on as soon as Nexus responds.
- **Outage display:** NET shows “NEXUS OUTAGE” with reason, time, a countdown to the next automatic
  attempt (30 s → 10 min) and “Try now”; the header shows a “NEXUS OUTAGE” chip. Plus the state of the
  public Nexus status page (incident + affected components) and a button that opens it.
- **Robust downloads:** An nxm click lands in the list immediately (the job fetches the Nexus data itself, state
  CONNECTING), so it doesn't get lost during an outage. Dropped connections resume via Range where they broke
  off, broken CDN servers are switched, stalled connections (30 s without data) are re-established, up to
  4 attempts. Failed downloads: “Retry”. Expired link authorization: Premium works without it, otherwise a clear
  message. The same click twice only lands in the list once.
- **Update check during an outage:** aborts instead of flooding Nexus, keeps old results and stays due;
  after the outage RIPPERDOC catches up on it automatically. Checks 3 mods at a time.
- **Deployer fixes (review):**
  - After a game patch, `r6/cache` stays untouched. Previously, the patch's new cache files were cleared away
    the next time something was toggled. For this, the build is read fresh from the exe every time.
  - If linking fails after a game file has been backed up, the original comes back immediately;
    orphaned backups are put back on every run.
  - RIPPERDOC's own links from an aborted run are taken over instead of being backed up as the “original”;
    quitting waits until a running change has finished.
  - Updating a mod keeps rescued settings (e.g. CET's `settings.json`); removed mods pass on the folders they
    created.
  - Shared mod folders (`archive/pc/mod`, `r6/tweaks`, …) that RIPPERDOC created are only removed when
    empty; files placed there by hand stay.
  - A missing backup or vanilla copy no longer blocks PURGE; it is reported instead.
  - “Game running” is checked via the process list, not only after RIPPERDOC launched the game. In VANILLA MODE,
    toggles also work while the game is running (selection only).
  - Deploy errors show up as a message (“DEPLOY PROBLEMS”) instead of silently in the report.
  - Clean rollback on errors: RE-DEPLOY keeps VANILLA MODE, removing keeps the toggle, installing
    checks “game running” before staging.
- **Import:** root folder as its own variant (“Foo.archive” + “Optional/Foo.archive”); “unknown files to the
  game root” keeps detected dependencies; cancel is locked while installing (it could swallow the
  next import in the queue).
- **Misc:** settings are written one after another (fast slider moves were sometimes lost), the
  data folder is pinned on the first start with a game, startup errors show a dialog instead of an
  invisible process, a missing exe on direct launch is reported, tabs stay on one line in narrow
  windows. Test hook `--nexus-offline`.
- Tests: 62 (new: 13 for Nexus outages, 10 regressions from the review).

## 0.2 – 2026-10-25
- Nexus integration (step 3): validate the API key and store it encrypted, account status with Premium and
  API limit, `nxm://` links (“Mod Manager Download”) also on cold start and to the open window,
  download queue with progress, speed and cancel; finished downloads open the
  install dialog on their own.
- Import with Nexus data: mod name, author, short description, preview image, file ID and category; the
  “Replace” checkbox is only pre-checked when it is definitely the same package (update chain, MAIN → MAIN, same file).
- Update check via Nexus's update chain or the mod version, badges in INVENTORY, one-click update
  (Premium).
- New screen NET (Uplink, Mod Manager Download, Downloads, Updates); download indicator in the header.
- Mod Settings and Native Settings UI count as recommended instead of required (mods also run without them).
- New Nexus file name scheme (`Name 107 1.38.0 2026-10-22T12-57Z xyz.zip`) is recognized.
- Tested against the real API with 8 real packages (CET, RED4ext, redscript, ArchiveXL, TweakXL, Codeware,
  Native Settings UI, Virtual Atelier) in the test game folder: all detected and installed correctly.

## 0.1.1 – 2026-10-25
- Launch by double-click: `npm run shortcut` puts RIPPERDOC on the desktop and in the Start menu.
- Custom app icon (red R with a chamfer, `scripts/make-icon.cjs`), also in the window and the taskbar.

## 0.1 – 2026-10-25
- Scaffold: Electron 45 + React 19 + TypeScript, electron-vite. Custom window frame with Windows buttons in the
  theme color.
- Look like NC-OS: five color schemes (RED/AMBER/ACID/VIOLET/ICE), Rajdhani, chamfered boxes, scanlines with
  a moving stripe, glitch as horizontal slices (SVG filter), circuit-trace background, boot sequence with
  real data, custom synthesized UI sounds (`scripts/make-sounds.mjs`), private sounds in `sounds/custom`.
- Game detection via Steam (registry, libraryfolders.vdf, app manifest), version straight from the exe,
  Phantom Liberty, REDmod, notice on game update.
- Import: zip/7z/rar/loose files/folders, layout detection for the game root (also with a wrapper folder), .archive/.xl,
  CET, redscript, TweakXL, RED4ext, REDmod, ASI, Input; variant selection; skip unknown files or put them
  in the game root; dependencies and bundled frameworks; Nexus file names → name, version, mod ID;
  an update takes over position and toggle.
- Deployer: hardlinks from staging, priority by load order, journal before every change, backup of
  displaced game files, rescue of runtime files to `overwrite/`, self-healing, guard for
  base game/exe/r6-cache, vanilla snapshot + cache copy, PURGE with snapshot comparison, VANILLA MODE +
  RE-DEPLOY.
- Screens: INVENTORY (list, toggles, drag, badges, detail card), CYBERWARE (status), LOAD ORDER
  (priority + file conflicts), JOURNAL, SYS.CONFIG, NET (placeholder).
- LAUNCH directly (`-skipStartScreen`) or via Steam, process monitoring.
- Tests: 26 (layout detection, full run in the test game folder, game detection read-only).
  Round trip on the real game (self-test file in and out): hardlink confirmed, snapshot comparison identical.

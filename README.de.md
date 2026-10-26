# RIPPERDOC

[🇬🇧 English](README.md) · 🇩🇪 Deutsch

Eigener Mod Manager für **Cyberpunk 2077** im Stil der Spielmenüs. Mods werden nicht in den Spielordner kopiert,
sondern aus einem eigenen Staging-Ordner per **Hardlink** eingespielt. Jede Änderung steht vorher im Journal, und
**PURGE → VANILLA** bringt den Spielordner nachweisbar auf den Zustand vor dem ersten Mod zurück.

> **This is an unofficial fan work and is not approved/endorsed by CD PROJEKT RED.** Kostenlos und nicht
> kommerziell. Die UI-Sounds stammen aus Cyberpunk 2077 (© CD PROJEKT S.A.), siehe [NOTICE.md](NOTICE.md).
> Arbeitstitel.

## Stand

| Schritt | Inhalt | Status |
|---|---|---|
| 0 | Gerüst, Theme + UI-Kit, Spielerkennung, Boot | ✅ v0.1 |
| 1 | Import → Analyse → Staging → Hardlink-Deploy, Journal, Purge, Launch | ✅ v0.1 |
| 2 | Framework-Wächter: CET, RED4ext, redscript, ArchiveXL, TweakXL, Codeware aus GitHub | offen |
| 3 | Nexus: API-Key, `nxm://`-Knopf, Downloads, Update-Check | ✅ v0.2 |
| 4 | Konflikte in `.archive`-Dateien (RDAR-Scan), `modlist.txt` | offen |
| 5 | Profile + Savegame-Backups | offen |
| 6 | Diagnose: Logs nach Spielende, Crash-Bisect | offen |
| 7 | Paketierung: Installer + portable Zip | ✅ v0.3 |
| 7 | FOMOD, REDmod-Deploy | offen |

## Installieren (für Nutzer)

- **Installer:** `RIPPERDOC-Setup-<version>.exe` doppelklicken. Installiert ohne Admin-Rechte nach
  `%LOCALAPPDATA%\Programs\RIPPERDOC`, legt Desktop- und Startmenü-Verknüpfung an und steht unter „Apps“ zum
  Deinstallieren. Beim Deinstallieren fragt RIPPERDOC, ob noch eingebundene Mods vorher aus dem Spielordner sollen
  (PURGE). Datenordner und Einstellungen bleiben immer erhalten.
- **Portabel:** `RIPPERDOC-<version>-portable.zip` entpacken, `RIPPERDOC.exe` starten.
- Ohne Code-Signing-Zertifikat zeigt Windows SmartScreen beim ersten Start eine Warnung
  („Weitere Informationen → Trotzdem ausführen“).
- Eigene UI-Sounds für die installierte Version: `%APPDATA%\RIPPERDOC\sounds\sfx_<name>.wav`.
- Die Steam-Fassung von Cyberpunk 2077 wird automatisch gefunden. Sonst: SYS.CONFIG › „Spielordner wählen…“.
- Oberfläche auf Deutsch und Englisch: SYS.CONFIG › Look › Sprache (AUTO folgt der Windows-Sprache).

Pakete bauen: `npm run dist` → `release/<version>/` (Installer, Zip, `win-unpacked/`). `npm run pack` baut nur
`win-unpacked/` zum schnellen Testen.

## Starten (Entwicklung)

```powershell
npm install
# Falls node_modules\electron\dist fehlt (Postinstall lief nicht):
node node_modules\electron\install.js
npm start          # baut und startet
npm run dev        # mit Hot Reload für die Oberfläche
npm test           # Tests (Layout-Erkennung, Deployer im Test-Spielordner)
npm run typecheck
npm run shortcut   # Verknüpfung RIPPERDOC auf Desktop + Startmenü (danach Doppelklick)
```

Die Verknüpfung startet immer den letzten Build (`out/`). Nach Änderungen am Code einmal `npm run build`.
Wieder entfernen: `scripts\install-shortcut.ps1 -Remove`. Das Icon erzeugt `npm run icon` (`build/icon.ico`).

Voraussetzung: Windows 10/11 und Node 22 oder neuer. Zum Entpacken nimmt RIPPERDOC das `tar.exe` von Windows
(kann zip, 7z und rar), es muss also nichts zusätzlich installiert werden.

## Bedienung

- **Installieren:** Archive (zip/7z/rar), lose `.archive`-Dateien oder Ordner ins Fenster ziehen, oder
  `+ INSTALL` bzw. `Strg+O`. Der Dialog zeigt, wohin jede Datei kommt, was der Mod mitbringt und was er braucht.
  Hat ein Archiv mehrere gleichwertige Ordner („Option A / Option B“), wählt man eine Variante.
- **Schalter:** wirken sofort (Hardlinks gehen in Millisekunden). Läuft das Spiel, wird nichts geändert.
- **Reihenfolge:** Zeilen in INVENTORY ziehen. **Oben gewinnt**, wenn zwei Mods dieselbe Datei liefern.
- **Update:** Neues Archiv desselben Mods (gleicher Name oder gleiche Nexus-ID) importieren → „Update
  installieren“ übernimmt Platz und Schalter.
- **PURGE:** nimmt alles aus dem Spielordner, legt gesicherte Spieldateien zurück, setzt den Script-Cache
  zurück und vergleicht mit dem Vanilla-Snapshot. Danach gilt der VANILLA MODE: Schalter ändern nur die Auswahl,
  **RE-DEPLOY** spielt sie wieder ein.
- **LAUNCH:** spielt zuerst alles sauber ein (repariert dabei kaputte Links) und startet dann das Spiel, direkt
  über die exe (mit `-skipStartScreen`) oder über Steam.
- **Tasten:** `Q`/`E` wechselt die Tabs wie im Spiel.

## Nexus Mods

- **Key:** NET › Uplink. Persönlicher API-Key von nexusmods.com (Einstellungen › API Keys). Er wird geprüft und
  nur verschlüsselt gespeichert (Windows DPAPI über Electron `safeStorage`, Datei
  `%APPDATA%\RIPPERDOC\nexus-key.bin`). Er geht nur an api.nexusmods.com, nie ins Spiel oder ins Journal.
- **Mod Manager Download:** Beim Verbinden des Keys übernimmt RIPPERDOC `nxm://`-Links, wenn kein anderes
  Programm sie hat (NET › Mod Manager Download: verbinden, übernehmen, trennen). Ein Klick auf der Website
  startet RIPPERDOC (oder schickt den Link an das offene Fenster), lädt die Datei und öffnet den
  Installations-Dialog mit Name, Autor, Bild und Version von Nexus.
- **Updates:** Beim Start alle 6 Stunden (und per „Jetzt prüfen“) für jeden Mod mit Nexus-ID: Update-Kette
  der Datei, sonst Mod-Version. Mit Premium lädt „Update laden“ direkt, ohne Premium führt „Nexus“ zur
  Dateiseite. Ein Update ersetzt den alten Mod an gleicher Stelle; optionale Zusatzdateien desselben Mods
  werden nicht automatisch als Ersatz vorgeschlagen.
- **Nexus gestört:** RIPPERDOC wiederholt hängende oder kaputte Anfragen, lädt abgebrochene Downloads an der
  Abbruchstelle weiter und versucht es im Hintergrund neu. NET zeigt dann „NEXUS GESTÖRT“, den nächsten
  Versuch und was die öffentliche Statusseite von Nexus meldet (die wird ohne Key abgefragt). Installierte
  Mods, PURGE und LAUNCH brauchen Nexus nicht.
- Einmalige Einrichtung ohne Oberfläche: Umgebungsvariable `RIPPERDOC_NEXUS_KEY` beim Start (wird sofort aus
  der Umgebung gelöscht, damit das Spiel sie nie erbt).

## Sicherheit

- Basisspiel-Archive (`archive/pc/content`, `archive/pc/ep1`), die exe und `r6/cache` sind für Mods gesperrt.
- Vor dem ersten Einspielen entsteht `snapshot-vanilla.json` (alle Dateien des Spielordners) plus eine Kopie von
  `r6/cache`.
- Fremde Dateien, die einem Mod im Weg sind, wandern nach `backups/files` und kommen beim Abschalten zurück.
- Dateien, die Mods zur Laufzeit anlegen (Einstellungen, Logs) oder die jemand von außen geändert hat, werden
  nie gelöscht, sondern nach `overwrite/` gerettet und mit ihrem Mod wieder eingespielt.

## Datenordner

Standard: `<Laufwerk des Spiels>:\RipperdocData` (gleiches Laufwerk, sonst gehen keine Hardlinks).

```
RipperdocData/
  mods/<id>/files/…      Mod genau so, wie er im Spielordner liegt
  mods/<id>/docs/…       Liesmich & Co.
  mods/<id>/mod.json     Name, Version, Quelle, Typen, Dateien, Abhängigkeiten
  downloads/             Originalarchive
  profiles/Default.json  Reihenfolge + Schalter
  deployment.json        was gerade im Spielordner liegt (inkl. Inode je Datei)
  journal/*.jsonl        jede Änderung, bevor sie passiert
  backups/files/         verdrängte Spieldateien
  backups/vanilla/       Kopie von r6/cache vor dem ersten Mod
  overwrite/             gerettete Laufzeitdateien
  snapshot-vanilla.json  Zustand vor dem ersten Mod
```

Einstellungen der App: `%APPDATA%\RIPPERDOC\settings.json`.

## Doku (Englisch)

[docs/CHANGELOG.md](docs/CHANGELOG.md) (Versionen) · [docs/TECHNICAL.md](docs/TECHNICAL.md) (Aufbau, Eigenheiten,
Test-Hooks) · [sounds/README.md](sounds/README.md) (UI-Sounds)

## Lizenz

Code: MIT, siehe [LICENSE](LICENSE). Ausgenommen sind die Original-Sounds in `sounds/game/` (© CD PROJEKT S.A.).
Fremde Bestandteile und Marken: [NOTICE.md](NOTICE.md).

# Notices on trademarks and third-party components

> **This is an unofficial fan work and is not approved/endorsed by CD PROJEKT RED.**

## Trademarks
RIPPERDOC is a free, non-commercial fan project and is not affiliated with CD PROJEKT RED, Valve or Nexus Mods.
- “Cyberpunk 2077” and “Phantom Liberty” are trademarks of CD PROJEKT S.A.
- “Steam” is a trademark of Valve Corporation.
- “Nexus Mods” is a trademark of Black Tree Gaming Ltd.

The names are only used to describe which game the software is meant for and which style it draws on. The
interface is inspired by game menus. All graphics and animations are drawn in code (CSS/SVG); no images from the
game are included. The name is a working title and will be reviewed again before a release.

## UI sounds from Cyberpunk 2077
The sounds in `sounds/game/` are original UI sounds from Cyberpunk 2077 and belong to **CD PROJEKT S.A.**
(© CD PROJEKT S.A.). They are **not** covered by this project's MIT license. They are used non-commercially
under CD PROJEKT RED's [Fan Content Guidelines](https://www.cdprojektred.com/en/fan-content), which explicitly
allow mods and software that works alongside their games. They will be removed at the rights holder's request;
RIPPERDOC then falls back to its own freely usable tones in `sounds/default/`.

## Included third-party components
| Component | License | Location |
|---|---|---|
| UI sounds from Cyberpunk 2077 | © CD PROJEKT S.A., see above | `sounds/game/` |
| Font Rajdhani (Indian Type Foundry) | SIL Open Font License 1.1 | `src/renderer/src/assets/fonts/`, license text `FONT-LICENSE-OFL.txt` next to it |

## Dependencies (downloaded by npm on install)
Electron, electron-vite, electron-builder, Vite, React, TypeScript, Vitest – MIT or Apache 2.0 (license texts in
`node_modules`).

## Frameworks and mods
RIPPERDOC does not ship any mods or frameworks itself. It only installs files you download yourself (later also
via the frameworks' official GitHub releases and via Nexus Mods with your own API key).

## Not included
- `sounds/custom/`: private sounds in the project folder; never go into the repo or a package.
- The data folder (`RipperdocData`) and `%APPDATA%\RIPPERDOC`: mods, journal, snapshot, settings and the
  encrypted Nexus key.

# UI sounds

On start, RIPPERDOC loads the sounds in this order; later folders replace files with the same name:

1. **`default/`**: own fallback tones, computed by `scripts/make-sounds.mjs`, free to use (MIT).
2. **`game/`**: original UI sounds from Cyberpunk 2077 (© CD PROJEKT S.A., see [NOTICE.md](../NOTICE.md)).
   Part of the repo and the installer.
3. **`custom/`**: private sounds in the project folder, listed in `.gitignore`, never go into a package.
4. **`%APPDATA%\RIPPERDOC\sounds\`**: your own sounds, also for the installed version.

| File | When |
|---|---|
| `sfx_hover.wav` | Mouse over buttons, tabs, rows |
| `sfx_move.wav` | Load order changed, color scheme switched |
| `sfx_tab.wav` | Tab switch |
| `sfx_press.wav` | Toggles, buttons |
| `sfx_enter.wav` | Mod selected, install finished |
| `sfx_menu_open.wav` / `sfx_menu_close.wav` | Dialogs open / close |
| `sfx_open.wav` | LAUNCH |
| `sfx_boot.wav` | Boot sequence |
| `sfx_error.wav` | Errors. The original sounds have none; then `sfx_menu_close` plays instead of the computed tone |

Format: WAV (PCM). The name must match exactly. Volume and on/off: SYS.CONFIG › Audio.

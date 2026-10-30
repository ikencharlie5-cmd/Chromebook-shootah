# Chromebook Shootah

A 5v5 tactical first-person shooter that runs in the browser — built to be light enough for a Chromebook.
You and four bot teammates take on five bots on the map **Outpost**: attack to plant the Core at site A or B,
or defend and defuse it. First team to 7 rounds wins; sides swap after round 6.

## Play it

The game uses ES modules, so it has to be served over HTTP (opening `index.html` straight from disk won't work).

**Easiest (works on a Chromebook, nothing to install):** turn on GitHub Pages for this repo —
*Settings → Pages → Build and deployment → Deploy from a branch →* pick your branch and `/ (root)`.
After a minute the game is live at `https://<your-username>.github.io/Chromebook-shootah/`.

**Locally** (any computer with Python):

```bash
python3 -m http.server 8000
```

then open <http://localhost:8000>.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Aim / shoot |
| Shift | Walk — silent and more accurate |
| C | Crouch |
| Space | Jump |
| R | Reload |
| 1 / 2 / 3, Q, mouse wheel | Primary / pistol / knife, last weapon, cycle |
| Right click | Scope (sniper) |
| B | Buy menu (buy phase only) — or press 1–6 inside it |
| E (hold) | Plant / defuse the Core |
| Tab | Scoreboard |
| Esc | Pause + settings |

Crouch is on **C** because Ctrl+W closes the tab on a Chromebook. If you turn on *Fullscreen when playing* in
settings, the game also locks the keyboard so Ctrl works for crouching.

## How it plays

- **Rounds:** 15 s buy phase (you're held in spawn) → 1:40 round. Attackers win by detonating the Core
  (40 s fuse) or wiping the defenders. Defenders win by wiping the attackers before a plant, defusing (7 s), or
  running out the clock.
- **Economy:** ¤800 at the start of each half. +¤200 per kill, +¤3000 for a round win, ¤1900–2900 for a loss
  (more for losing streaks), +¤300 to attackers for a plant. Survivors keep their guns and shield.
- **Gunplay:** first shots are accurate when you're standing still; running, jumping and spraying all add spread.
  Rifles climb straight up and then sway side to side — pull down to control them. The crosshair gap shows your
  real current spread. Headshots deal big damage (the Talon rifle one-taps).
- **Sound matters:** running footsteps and gunfire are positional, and bots hear them too. Walk to stay quiet.
- **Bots** take different routes, hold angles, rotate between sites, pick up a dropped Core, and defuse.
  Difficulty changes their reaction time, aim and spray control.

| Weapon | Price | Notes |
| --- | --- | --- |
| Pip-9 | free | Semi-auto pistol |
| Bolt .50 | ¤800 | Hand cannon, one-taps the head at close range |
| Wasp SMG | ¤1600 | Fast fire, accurate while moving |
| Talon Rifle | ¤2900 | One-tap headshots, strong recoil |
| Lynx Sniper | ¤4500 | Scope with right click, one shot to the body kills |
| Light / Heavy Shield | ¤400 / ¤1000 | +25 / +50 damage absorbed |

## Code layout

```
index.html, css/style.css   UI, menus and HUD markup
lib/three.module.min.js     three.js r170 (bundled so it works offline / on locked-down networks)
js/main.js                  boot, settings, input, menus, main loop
js/game.js                  round flow, economy, shooting, damage, objective, rendering
js/map.js                   ASCII map → geometry, colliders, sites, A* pathfinding
js/bots.js                  bot AI (perception, aiming, objectives, movement)
js/entities.js              players/bots, hitboxes, movement + collision
js/weapons.js               weapon stats and recoil patterns
js/viewmodel.js             first-person gun
js/models.js                low-poly characters, guns, the Core
js/effects.js               tracers, bullet holes, particles, explosion
js/hud.js                   HUD, minimap, killfeed, scoreboard, buy menu
js/audio.js                 synthesized WebAudio sound effects
```

The map is a plain ASCII grid at the top of `js/map.js`, so it's easy to edit.

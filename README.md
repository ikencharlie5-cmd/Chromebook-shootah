# Chromebook Shootah

A 3v3 tactical first-person shooter with agents and abilities that runs in the browser — built to be light enough
for a Chromebook. Pick one of six agents, team up with two bots, and fight three bots on one of five maps.
Attack to plant the Core at site A or B, or defend and defuse it. First team to 7 rounds wins; sides swap after round 6.

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
| 1 / 2 / 3, mouse wheel | Primary / pistol / knife, cycle |
| Q / E / F | Abilities (E is your free signature ability) |
| X | Ultimate |
| Right click | Scope (sniper) |
| B | Buy menu (buy phase only) — or press 1–8 inside it |
| 4 (hold) | Plant / defuse the Core |
| Tab | Scoreboard |
| Esc | Pause + settings |

Crouch is on **C** because Ctrl+W closes the tab on a Chromebook. If you turn on *Fullscreen when playing* in
settings, the game also locks the keyboard so Ctrl works for crouching.

## Agents

Each agent has three abilities and an ultimate. **E** (signature) refills for free every round; **Q** and **F** charges
are bought in the buy menu and carry over between rounds. Ultimates charge from kills, deaths, plants and defuses.

| Agent | Look | Role | Q | E (free) | F | X (ultimate) |
| --- | --- | --- | --- | --- | --- | --- |
| Haze | Hooded mystic, glowing tattoos, long coat | Controller | Incendiary | Smoke ×2 | Barrier wall | Nightfall — line of 4 smokes |
| Vesper | Silver-haired medic with round glasses | Sentinel | Barrier wall | Mend (heal) | Recon dart | Lifeline — heal team + shields |
| Flare | Big orange afro, goggles, bomber jacket | Initiator | Flashbang ×2 | Recon dart | Smoke | Overwatch — reveal all enemies |
| Ember | Spiky red hair, freckles, leather jacket | Duelist | Incendiary | Dash | Flashbang | Inferno — huge firestorm |
| Jolt | Blue mohawk, headphones, lightning tattoo | Duelist | Flashbang ×2 | Dash ×2 | Mend (heal) | Overdrive — speed, fire rate, accuracy |
| Rook | Bald, big beard, heavy plate carrier | Initiator | Smoke | Flashbang ×2 | Incendiary | Blackout — blind everyone who sees you |

Agents are clean cel-shaded cartoon people (slightly big heads, smooth shapes). Enemies always have a
**red outline** and your team wears a teal armband.

- **Smokes** land where you aim and block vision (for bots too).
- **Flashes** pop after a moment and blind enemies who are looking at them — turn away!
- **Incendiaries** burn enemies standing in the fire; great for stopping a defuse.
- **Recon darts** stick to surfaces and pulse twice, marking enemies through walls.
- **Barriers** block bullets and movement until they time out or are shot down.

## Maps

All maps are compact two-site layouts built for 3v3, and the map is picked at random each match. They have
height to fight over — balconies and raised platforms with stairs, 1m ledges you can jump onto, raised bridges —
plus buildings you can walk through, windows you can see and shoot through (and vault, if you crouch-jump),
curved archways and arched windows, rounded walls and cover, domes / hangar roofs / gabled roofs, cornices,
balconies, rocks, bushes and puddles, real-time shadows (Medium/High graphics) and lots of props.

| Map | Theme |
| --- | --- |
| Neon District | Night city, neon signs, rain |
| Sunken Temple | Sandstone ruins, palms, sunset |
| Frostbite Base | Snowy military base, shipping containers |
| Overgrowth | Jungle-covered research lab, fireflies |
| Canal Quarter | Venice-style canals, bridges and gondolas |

## How it plays

- **Rounds:** 15 s buy phase (you're held in spawn) → 1:40 round. Attackers win by detonating the Core
  (40 s fuse) or wiping the defenders. Defenders win by wiping the attackers before a plant, defusing (7 s), or
  running out the clock.
- **Economy:** ¤800 at the start of each half. +¤200 per kill, +¤3000 for a round win, ¤1900–2900 for a loss
  (more for losing streaks), +¤300 to attackers for a plant. Survivors keep their guns and shield.
- **Gunplay:** first shots are accurate when you're standing still; running, jumping and spraying all add spread.
  Rifles climb straight up and then sway side to side — pull down to control them. Headshots deal big damage.
- **Sound matters:** running footsteps and gunfire are positional, and bots hear them too. Walk to stay quiet.
- **Bots** take different routes, execute onto sites with smokes/flashes/recon, hold angles, rotate, heal,
  molly the Core when you defuse, and use their ultimates. Difficulty changes their reaction time and aim.

| Weapon | Price | Notes |
| --- | --- | --- |
| Pip-9 | free | Semi-auto pistol |
| Bolt .50 | ¤800 | Hand cannon, one-taps the head at close range |
| Hornet Burst | ¤1400 | PDW, 3-round bursts |
| Wasp SMG | ¤1600 | Fast fire, accurate while moving |
| Thunder Pump | ¤1800 | Shotgun, 9 pellets, one-shots up close |
| Needle | ¤1200 | Budget bolt-action sniper with a scope |
| Arbiter DMR | ¤2400 | Semi-auto scoped marksman rifle |
| Raptor AR | ¤2800 | Fast-firing rifle, easy to spray |
| Talon Rifle | ¤2900 | One-tap headshots, strong recoil |
| Bastion LMG | ¤3200 | 100-round belt, slows you down |
| Lynx Sniper | ¤4500 | One shot to the body kills |
| Light / Heavy Shield | ¤400 / ¤1000 | +25 / +50 damage absorbed |

## Locker & skins

The main menu is a **lobby**: your agent stands on a floating stage above the current map holding your best
skin, with two **+ INVITE** slots ready for future multiplayer parties. Click your character (or CHANGE AGENT)
to pick an agent, then hit **PLAY**.

From the lobby open the **Locker**. Spend coins to **roll** (¤100) — a reel spins and lands on a random
skin for a random weapon or knife (Combat Knife or Karambit). Rarities: Common 58%, Rare 28%, Epic 11%,
Legendary 3%, and knives are a special ★ drop (4% of rolls). Equip anything you own; duplicates refund ¤30. You earn coins after every match
(+50, +10 per kill, +100 for a win). Your Locker is saved in the browser. Bots use random skins too.

## Releasing

Before committing a change, run `python3 tools/bump-version.py`. It stamps a new version on every script and
stylesheet URL so players' browsers always load a matching set of files after an update.

## Code layout

```
index.html, css/style.css   UI, menus, agent select and HUD markup
lib/three.module.min.js     three.js r170 (bundled so it works offline / on locked-down networks)
js/main.js                  boot, settings, input, menus, agent select, main loop
js/game.js                  round flow, economy, shooting, damage, objective, rendering
js/maps.js                  the five map layouts (ASCII grids)
js/map.js                   layout → geometry, colliders, sites, A* pathfinding, bot routes
js/theme.js                 per-map art: procedural textures, skies, props, backdrops, weather
js/agents.js                agents, ability kits, ability icons
js/abilities.js             smokes, flashes, fire, recon, walls, heals, dashes, ultimates
js/bots.js                  bot AI (perception, aiming, objectives, ability usage)
js/entities.js              players/bots, hitboxes, movement + collision
js/weapons.js               weapon stats and recoil patterns
js/viewmodel.js             first-person gun and cartoon hands styled after your agent
js/people.js                cartoon agent characters (faces, hair, outfits), outlines, animation
js/guns.js                  weapon + knife models and skin materials/patterns
js/skins.js                 skins, rarities, rolling, saved profile
js/locker.js                Locker UI (equip skins, roll reel)
js/models.js                muzzle flash, the Core
js/effects.js               tracers, bullet holes, particles, explosion
js/hud.js                   HUD, ability bar, minimap, killfeed, scoreboard, buy menu
js/audio.js                 synthesized WebAudio sound effects
```

Maps are plain ASCII grids in `js/maps.js` (see the legend at the top of that file), so they're easy to edit. `game.startMatch(agentId, mapId)` accepts a
map id, ready for matchmaking to choose the map later.

# Chromebook Shootah — Roblox version

The same game (Core Rush, 3v3, first to 7 rounds) rebuilt for Roblox. Roblox runs the servers, so there's no
host and nothing for school WiFi to block. The code lives here and is synced into Roblox Studio with **Rojo**.

## What's in this first version
- All 5 maps, generated from the same layouts as the browser game (walls, cover, ledges, stairs, windows, sites, spawns)
- Core Rush rounds: buy phase, plant (hold **F** on site A/B), defuse, 40 s Core timer, side swap after round 6
- Economy: credits, kill/assist/plant rewards, win/loss bonuses, loss streaks, buy menu (**B**)
- All 12 weapons with the same damage, fire rate, spread, recoil, falloff, burst, shotgun pellets and scopes
- Knife slashes (left click) and heavy stab (right click)
- Server-checked hits (rate of fire, ammo, range, no shooting through walls)
- HUD: score, timer, health, shield, credits, ammo, crosshair that grows with spread, kill feed with
  headshots and assists, hit markers + damage numbers, ACE banner, scoreboard (**Tab**), match results
- Saved coins, rank (RR), wins and stats in a Roblox DataStore
- Practice dummies when you test alone in Studio

**Not yet:** agents and abilities, bots, the locker and skins, sounds, real gun models and animations.

## Controls
WASD move · Shift walk · Ctrl or C crouch · Space jump · Left click shoot · Right click scope (knife: heavy stab)
· 1/2/3 weapons · R reload · B buy · F plant/defuse · Tab scoreboard

## Setup (one time)
1. Install **Roblox Studio** from https://create.roblox.com and sign in.
2. Install **Visual Studio Code** from https://code.visualstudio.com.
3. In VS Code open Extensions (Ctrl+Shift+X), search **Rojo** and install *Rojo – Roblox Studio Sync*.
4. Download this project: on GitHub open the branch, click **Code → Download ZIP**, and unzip it.
5. In VS Code: **File → Open Folder** and pick the `roblox` folder.
6. Click the Rojo icon in VS Code's left bar. If it offers to install Rojo and the Roblox Studio plugin, click yes.
   Then click `default.project.json` to **start the Rojo server**.

## Every time you work on it
1. In Roblox Studio create a new **Baseplate** place (first time), or open your saved place.
2. Open the **Plugins** tab → **Rojo** → **Connect**. The scripts and settings appear in the Explorer.
3. Press **Play** (F5). Alone, you get practice dummies in the enemy spawn to shoot at.
4. To test multiplayer: **Test** tab → **Clients and Servers** → pick 2 players → **Start**.

## Saving progress (DataStore)
1. **File → Publish to Roblox** (creates the game on your account).
2. **Home → Game Settings → Security** → turn on **Enable Studio Access to API Services** → Save.

## Going live
1. Publish again after changes (File → Publish to Roblox).
2. In **Game Settings → Avatar** set Avatar Type to **R15**.
3. In the Creator Dashboard (https://create.roblox.com/dashboard/creations) open the game → **Places** → set max
   players to **6** → then make the game **Public** when you're ready.

## Files
- `src/shared` — weapons, maps, ranks and rules (shared by server and players)
- `src/server` — map builder, match logic (rounds, economy, hits, Core), saving
- `src/client` — shooting, viewmodel, HUD and buy menu
- `src/character` — turns off health regeneration

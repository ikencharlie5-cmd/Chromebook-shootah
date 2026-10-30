import { Game } from './game.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);

// ---- settings ---------------------------------------------------------------

const DEFAULTS = {
  difficulty: 'normal', sensitivity: 1, fov: 90, volume: 0.6, quality: 'medium',
  crossColor: '#00ff9c', fullscreen: false, showFps: false,
};
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('cbs-settings') || '{}') }; } catch { /* ignore */ }
const saveSettings = () => localStorage.setItem('cbs-settings', JSON.stringify(settings));

// ---- input ------------------------------------------------------------------

class Input {
  constructor() {
    this.keys = new Set();
    this.mouse = [false, false, false];
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.edges = new Set();
  }
  pressed(code) {
    if (!this.edges.has(code)) return false;
    this.edges.delete(code);
    return true;
  }
  consumeMouse() { const r = { dx: this.dx, dy: this.dy }; this.dx = this.dy = 0; return r; }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
  endFrame() { this.edges.clear(); }
  reset() { this.keys.clear(); this.mouse = [false, false, false]; this.dx = this.dy = 0; this.edges.clear(); }
}

const input = new Input();
const sound = new Sound();
const game = new Game($('game'), settings, sound, input);
const canvas = game.canvas;

const locked = () => document.pointerLockElement === canvas;

function lock() {
  try {
    const r = canvas.requestPointerLock({ unadjustedMovement: true });
    if (r && r.catch) r.catch(() => { try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* ignore */ } });
  } catch {
    try { canvas.requestPointerLock(); } catch { /* ignore */ }
  }
}

document.addEventListener('keydown', (e) => {
  if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code) && game.running) e.preventDefault();
  if (!game.running) return;
  if (!e.repeat) input.edges.add(e.code);
  input.keys.add(e.code);

  if (e.code === 'KeyB' && !e.repeat && !game.paused) {
    if (game.buyOpen) closeBuy(); else openBuy();
  }
  if (game.buyOpen && /^Digit[1-6]$/.test(e.code)) game.hud.buyKey(Number(e.code.slice(5)) - 1);
  if (e.code === 'Escape' && game.buyOpen) closeBuy(false);
  // with keyboard lock (fullscreen) Escape reaches the page instead of the browser
  if (e.code === 'Escape' && locked() && navigator.keyboard?.lock) document.exitPointerLock();
});
document.addEventListener('keyup', (e) => input.keys.delete(e.code));
window.addEventListener('blur', () => input.reset());

document.addEventListener('mousedown', (e) => {
  if (!game.running) return;
  if (game.buyOpen) { closeBuy(); return; }
  if (!locked()) {
    if (!game.paused || $('pauseMenu').classList.contains('hidden')) lock();
    return;
  }
  input.mouse[e.button] = true;
  input.edges.add(`Mouse${e.button}`);
});
document.addEventListener('mouseup', (e) => { input.mouse[e.button] = false; });
document.addEventListener('contextmenu', (e) => { if (game.running) e.preventDefault(); });
document.addEventListener('wheel', (e) => { if (locked()) input.wheel += Math.sign(e.deltaY); }, { passive: true });
document.addEventListener('mousemove', (e) => {
  if (!locked()) return;
  // Some platforms report a huge spike right after locking; drop it.
  if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
  input.dx += e.movementX;
  input.dy += e.movementY;
});

document.addEventListener('pointerlockchange', () => {
  if (locked()) {
    game.paused = false;
    $('pauseMenu').classList.add('hidden');
  } else if (game.running && !game.buyOpen) {
    game.paused = true;
    input.reset();
    showPause();
  }
});

function openBuy() {
  game.toggleBuy(true);
  if (game.buyOpen) {
    input.reset();
    document.exitPointerLock();
  }
}

function closeBuy(relock = true) {
  game.toggleBuy(false);
  input.reset();
  if (relock) lock();
  else { game.paused = true; showPause(); }
}

// ---- menus ------------------------------------------------------------------

const settingsEl = $('settings');
function placeSettings(slot) { $(slot).appendChild(settingsEl); }
placeSettings('settingsSlot');

function bindSettings() {
  const diff = $('setDifficulty'), sens = $('setSens'), fov = $('setFov'), vol = $('setVol');
  const qual = $('setQuality'), cross = $('setCrossColor'), fs = $('setFullscreen'), fps = $('setFps');
  diff.value = settings.difficulty; sens.value = settings.sensitivity; fov.value = settings.fov;
  vol.value = settings.volume; qual.value = settings.quality; cross.value = settings.crossColor;
  fs.checked = settings.fullscreen; fps.checked = settings.showFps;
  const labels = () => {
    $('sensVal').textContent = Number(settings.sensitivity).toFixed(2);
    $('fovVal').textContent = settings.fov;
    $('volVal').textContent = Math.round(settings.volume * 100) + '%';
  };
  labels();
  const apply = () => {
    settings.difficulty = diff.value;
    settings.sensitivity = Number(sens.value);
    settings.fov = Number(fov.value);
    settings.volume = Number(vol.value);
    settings.quality = qual.value;
    settings.crossColor = cross.value;
    settings.fullscreen = fs.checked;
    settings.showFps = fps.checked;
    labels();
    saveSettings();
    game.applySettings();
  };
  for (const el of [diff, sens, fov, vol, qual, cross, fs, fps]) el.addEventListener('input', apply);
}
bindSettings();

function showPause() {
  placeSettings('pauseSettingsSlot');
  $('pauseMenu').classList.remove('hidden');
}

function enterFullscreen() {
  if (!settings.fullscreen || document.fullscreenElement) return;
  document.documentElement.requestFullscreen?.()
    .then(() => navigator.keyboard?.lock?.().catch(() => {}))
    .catch(() => {});
}

function startGame() {
  sound.init();
  enterFullscreen();
  $('menu').classList.add('hidden');
  $('matchEnd').classList.add('hidden');
  $('pauseMenu').classList.add('hidden');
  game.hud.show(true);
  game.startMatch();
  game.paused = true;
  lock();
}

$('playBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
$('resumeBtn').addEventListener('click', () => {
  $('pauseMenu').classList.add('hidden');
  sound.init();
  enterFullscreen();
  lock();
});
const toMenu = () => {
  game.stop();
  game.hud.show(false);
  $('pauseMenu').classList.add('hidden');
  $('matchEnd').classList.add('hidden');
  placeSettings('settingsSlot');
  $('menu').classList.remove('hidden');
  if (locked()) document.exitPointerLock();
};
$('quitBtn').addEventListener('click', toMenu);
$('menuBtn').addEventListener('click', toMenu);

game.onMatchEnd = (won, mine, theirs, player) => {
  if (locked()) document.exitPointerLock();
  game.hud.show(false);
  game.hud.showBuy(false);
  const r = $('matchResult');
  r.textContent = won ? 'VICTORY' : 'DEFEAT';
  r.className = won ? 'win' : 'loss';
  $('matchScore').textContent = `${mine} — ${theirs}`;
  $('matchStats').textContent = `Your stats: ${player.kills} kills · ${player.deaths} deaths`;
  $('matchEnd').classList.remove('hidden');
};

// The buy phase ended while the cursor was free for the buy menu.
game.onBuyAutoClose = () => {
  if (locked()) return;
  game.paused = true;
  input.reset();
  showPause();
};

// ---- loop -------------------------------------------------------------------

let last = performance.now();
let fpsAcc = 0, fpsFrames = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.running) game.frame(dt);
  else game.renderIdle(now / 1000);
  input.endFrame();

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    game.hud.fps(settings.showFps ? `${Math.round(fpsFrames / fpsAcc)} FPS` : null);
    fpsAcc = 0; fpsFrames = 0;
  }
}
requestAnimationFrame(loop);
window.__game = game; // handy for debugging from the console

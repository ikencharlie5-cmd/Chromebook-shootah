import { Game } from './game.js?v=20261031060040';
import { Sound } from './audio.js?v=20261031060040';
import { AGENTS, AGENT_BY_ID, ABILITY_INFO, iconSvg } from './agents.js?v=20261031060040';
import { Locker } from './locker.js?v=20261031060040';
import { SKINS, RARITY_ORDER, equippedFor, saveProfile } from './skins.js?v=20261031060040';
import { rankOf, badgeHtml, rrDelta, skillForRR } from './ranks.js?v=20261031060040';
import { makeRoster } from './game.js?v=20261031060040';
import { randomMapDef } from './maps.js?v=20261031060040';
import { Party, MAX_PARTY } from './net.js?v=20261031060040';

const $ = (id) => document.getElementById(id);

// ---- settings ---------------------------------------------------------------

const DEFAULTS = {
  difficulty: 'normal', sensitivity: 1, fov: 90, volume: 0.6, quality: 'medium',
  crossColor: '#00ff9c', fullscreen: false, showFps: false, agent: 'haze', name: '', queue: 'unrated',
  chLen: 7, chThick: 2, chGap: 3, chDot: true, tipsLeft: 3, music: true,
};
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('cbs-settings') || '{}') }; } catch { /* ignore */ }
const saveSettings = () => localStorage.setItem('cbs-settings', JSON.stringify(settings));
if (!settings.name) { settings.name = `Player${Math.floor(100 + Math.random() * 900)}`; saveSettings(); }

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
const locker = new Locker(game, sound);
document.getElementById('lockerBtn').addEventListener('click', () => { sound.init(); locker.open(); });

const locked = () => document.pointerLockElement === canvas;
// browsers only allow audio after a click/key press
sound.musicOff = settings.music === false;
const startLobbyAudio = () => { sound.init(); if (!game.running) sound.lobbyMusic(true); };
document.addEventListener('pointerdown', startLobbyAudio, { once: true });
document.addEventListener('keydown', startLobbyAudio, { once: true });

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
  if (game.buyOpen && /^Digit[1-9]$/.test(e.code)) game.hud.buyKey(Number(e.code.slice(5)) - 1);
  if (game.buyOpen && e.code === 'KeyQ') game.buy('ab:q');
  if (game.buyOpen && e.code === 'KeyF') game.buy('ab:f');
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
  const chLen = $('setChLen'), chThick = $('setChThick'), chGap = $('setChGap'), chDot = $('setChDot');
  const music = $('setMusic'); music.checked = settings.music;
  chLen.value = settings.chLen; chThick.value = settings.chThick; chGap.value = settings.chGap; chDot.checked = settings.chDot;
  const labels = () => {
    $('chLenVal').textContent = settings.chLen; $('chThickVal').textContent = settings.chThick; $('chGapVal').textContent = settings.chGap;
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
    settings.chLen = Number(chLen.value); settings.chThick = Number(chThick.value);
    settings.chGap = Number(chGap.value); settings.chDot = chDot.checked;
    settings.music = music.checked;
    sound.musicOff = !settings.music;
    if (!game.running) sound.lobbyMusic(settings.music);
    labels();
    saveSettings();
    game.applySettings();
  };
  for (const el of [diff, sens, fov, vol, qual, cross, fs, fps, chLen, chThick, chGap, chDot, music]) el.addEventListener('input', apply);
}
bindSettings();

function showPause() {
  placeSettings('pauseSettingsSlot');
  $('pauseNote').textContent = (game.net ? 'Online match — the game keeps running while you\'re paused. ' : '')
    + (game.ranked && !game.practice ? `Quitting a ranked match costs ${LEAVE_PENALTY} RR.` : '');
  $('pauseMenu').classList.remove('hidden');
}

function enterFullscreen() {
  if (!settings.fullscreen || document.fullscreenElement) return;
  document.documentElement.requestFullscreen?.()
    .then(() => navigator.keyboard?.lock?.().catch(() => {}))
    .catch(() => {});
}

// ---- lobby ---------------------------------------------------------------------


// Show off the player's best equipped item in the lobby.
function lobbyHeld() {
  let best = { weapon: 'talon', skin: 'factory', key: 'talon|factory' }, score = -1;
  for (const w of ['talon', 'raptor', 'lynx', 'wasp', 'hornet', 'thunder', 'bastion', 'arbiter', 'needle', 'bolt', 'pip']) {
    const e = equippedFor(locker.profile, w);
    const sc = RARITY_ORDER.indexOf(SKINS[e.skin]?.rarity || 'common') + (e.skin === 'factory' ? -1 : 0);
    if (sc > score) { score = sc; best = { weapon: w, skin: e.skin, key: `${w}|${e.skin}` }; }
  }
  return best;
}

function refreshLobby() {
  const agent = AGENT_BY_ID[settings.agent] || AGENTS[0];
  settings.agent = agent.id;
  try { game.buildLobby(agent, lobbyHeld()); } catch (err) { console.error('lobby', err); }
  if (party.active) party.updateMe(meInfo());
  $('tagAgent').textContent = `${agent.name} · ${agent.role}`;
  $('tagAgent').style.color = '#' + agent.accent.toString(16).padStart(6, '0');
}
// ---- party (multiplayer) ------------------------------------------------------

const party = new Party();
window.__party = party;
const meInfo = () => ({ name: settings.name, agent: settings.agent, held: lobbyHeld(), skins: game.playerSkins(), rr: locker.profile.rr });

// ---- queue: unrated / ranked / practice ----
function refreshRank() {
  $('lobbyRank').innerHTML = badgeHtml(locker.profile.rr);
  $('tagRank').innerHTML = badgeHtml(locker.profile.rr);
}
function renderQueue() {
  let q = settings.queue;
  if (party.active && q === 'practice') q = settings.queue = 'unrated';
  for (const b of $('queueToggle').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.q === q);
    b.disabled = party.active && !party.isHost || (party.active && b.dataset.q === 'practice');
  }
  $('modeTitle').textContent = q === 'ranked' ? 'RANKED · CORE RUSH' : q === 'practice' ? 'PRACTICE RANGE' : 'CORE RUSH';
  if (!party.active) {
    $('modeSub').textContent = q === 'ranked' ? `Bots match your rank (${rankOf(locker.profile.rr).name}) · win to climb`
      : q === 'practice' ? 'Targets, free guns & abilities, no timer' : '3v3 · bots · random map · first to 7';
  }
}
for (const b of $('queueToggle').querySelectorAll('button')) b.addEventListener('click', () => {
  if (party.active && !party.isHost) return;
  settings.queue = b.dataset.q; saveSettings(); renderQueue();
  if (party.isHost) party.send({ t: 'queue', q: settings.queue });
});

$('nameInput').value = settings.name;
$('nameInput').addEventListener('input', () => {
  settings.name = $('nameInput').value.trim().slice(0, 16) || 'Player';
  saveSettings();
  if (party.active) party.updateMe(meInfo());
  $('tagName').textContent = settings.name.toUpperCase();
});
$('tagName').textContent = settings.name.toUpperCase();

party.onStatus = (text, err) => {
  const el = $('partyStatus');
  el.textContent = text;
  el.className = err ? 'err' : '';
};
const busy = (b) => { for (const id of ['createParty', 'joinParty']) $(id).disabled = b; };
$('createParty').addEventListener('click', () => {
  busy(true); party.status('Creating party…');
  party.host(meInfo()).then(() => party.status('Share the code with friends')).catch((e) => party.status(e.message, true)).finally(() => busy(false));
});
$('joinParty').addEventListener('click', () => {
  const code = $('joinCode').value.trim();
  if (code.length < 5) { party.status('Enter the 5-letter party code', true); return; }
  busy(true); party.status('Joining…');
  party.join(code, meInfo()).then(() => party.status('Joined! Waiting for the host to start')).catch((e) => party.status(e.message, true)).finally(() => busy(false));
});
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinParty').click(); });
$('leaveParty').addEventListener('click', () => { party.leave(); party.status('Left the party'); });
$('copyCode').addEventListener('click', () => { navigator.clipboard?.writeText(party.code || ''); party.status('Code copied'); });
for (const b of $('modeToggle').querySelectorAll('button')) b.addEventListener('click', () => party.setMode(b.dataset.mode));

function renderParty() {
  const inParty = party.active;
  $('partyNone').classList.toggle('hidden', inParty);
  $('partyIn').classList.toggle('hidden', !inParty);
  const others = inParty ? party.members.filter((m) => m.id !== party.myId) : [];
  game.setLobbyFriends(others.slice(0, 2).map((m) => ({ agent: AGENT_BY_ID[m.agent] || AGENTS[0], held: m.held })));
  for (let i = 0; i < 2; i++) {
    const t = $('tag' + (i + 1));
    t.textContent = others[i] ? others[i].name : '+ INVITE';
    t.classList.toggle('invite', !others[i]);
  }
  $('partyMore').textContent = others.length > 2 ? `+${others.length - 2} more in party` : '';
  const play = $('playBtn');
  play.disabled = false; play.textContent = 'PLAY';
  $('modeSub').textContent = '3v3 · bots · random map · first to 7';
  if (!inParty) return;
  $('partyCode').textContent = party.code;
  for (const b of $('modeToggle').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === party.mode);
  $('modeToggle').classList.toggle('locked', !party.isHost);
  $('partyMembers').innerHTML = party.members.map((m) => {
    const ag = AGENT_BY_ID[m.agent];
    const team = party.mode === 'pvp' ? `<span class="tm t${m.team}" data-id="${m.id}">${m.team ? 'RED' : 'BLUE'}</span>` : '';
    return `<div class="pm"><span class="nm">${m.host ? '★ ' : ''}${escapeHtml(m.name)}${m.id === party.myId ? ' (you)' : ''}</span><span class="ag">${ag ? ag.name : ''}</span>${team}</div>`;
  }).join('');
  for (const t of $('partyMembers').querySelectorAll('.tm')) {
    t.addEventListener('click', () => {
      const id = t.dataset.id;
      if (id !== party.myId && !party.isHost) return;
      const m = party.members.find((x) => x.id === id);
      party.setTeam(id, m.team ? 0 : 1);
    });
  }
  const n = party.members.length;
  if (party.mode === 'coop') $('modeSub').textContent = `PARTY vs BOTS · ${n} player${n > 1 ? 's' : ''} + ${Math.max(0, 3 - n)} bot allies vs 3 bots`;
  else $('modeSub').textContent = `FRIENDS vs FRIENDS · ${n}/${MAX_PARTY} players · bots fill empty spots`;
  if (!party.isHost) { play.disabled = true; play.textContent = 'WAITING FOR HOST'; }
  else if (party.mode === 'coop' && n > 3) { play.disabled = true; play.textContent = 'MAX 3 vs BOTS'; }
}
party.onChange = () => { renderParty(); renderQueue(); };
party.on('queue', (m) => { settings.queue = m.q; renderQueue(); });
renderParty();
refreshRank();
renderQueue();

function escapeHtml(t) { return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function startNetMatch() {
  const humans = party.members.map((m) => ({
    human: m.id, name: m.name, agent: m.agent, team: party.mode === 'coop' ? 0 : m.team,
    skins: m.id === party.myId ? game.playerSkins() : m.skins,
  }));
  const roster = makeRoster(humans);
  const mapId = randomMapDef().id;
  const ranked = settings.queue === 'ranked';
  const rrs = party.members.map((m) => m.rr || 0);
  game.ranked = ranked;
  game.skill = ranked ? skillForRR(rrs.reduce((a, b) => a + b, 0) / rrs.length) : null;
  party.inMatch = true;
  party.send({ t: 'start', roster, mapId, ranked });
  beginMatch(roster, mapId);
  if (!ranked) game.applySettings();
}

function useTip() {
  game.tips = settings.tipsLeft > 0;
  if (settings.tipsLeft > 0) { settings.tipsLeft--; saveSettings(); }
}

function beginMatch(roster, mapId) {
  useTip();
  sound.init();
  for (const id of ['agentSelect', 'menu', 'matchEnd', 'pauseMenu', 'locker']) $(id).classList.add('hidden');
  game.hud.show(true);
  game.startFromRoster(roster, party.myId, mapId, party);
  game.paused = true;
  game.hud.message(game.map.name.toUpperCase(), 'Click to play', 'warn', 5);
  lock();
}

party.on('start', (m) => { if (!party.isHost) { party.inMatch = true; game.ranked = !!m.ranked; beginMatch(m.roster, m.mapId); } });
party.on('in', (m, from) => game.onRemoteInput(from, m));
party.on('s', (m) => game.applySnapshot(m));
party.on('quit', (m, from) => game.onMemberLeft(from));
party.on('abort', () => { if (game.running) { toMenu(true); party.status('The host ended the match', true); } });
party.on('memberLeft', (id) => game.onMemberLeft(id));
party.on('hostLeft', () => { if (game.running) toMenu(true); });

locker.onChange = refreshLobby;
refreshLobby();

function openPanel(id) {
  for (const p of ['settingsPanel', 'controlsPanel']) $(p).classList.toggle('hidden', p !== id);
}
$('settingsBtn').addEventListener('click', () => { placeSettings('settingsSlot'); openPanel('settingsPanel'); });
$('controlsBtn').addEventListener('click', () => openPanel('controlsPanel'));
for (const b of document.querySelectorAll('.panel-close')) b.addEventListener('click', () => openPanel(null));
$('agentBtn').addEventListener('click', () => openAgentSelect(false));
canvas.addEventListener('click', () => { if (!game.running && !$('menu').classList.contains('hidden')) openAgentSelect(false); });

// ---- agent select -------------------------------------------------------------

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
let picked = AGENT_BY_ID[settings.agent] ? settings.agent : AGENTS[0].id;
let portraitsDone = false;

function showAgentDetail(agent) {
  const keys = ['q', 'e', 'f', 'x'];
  $('agentDetail').style.setProperty('--ac', hex(agent.accent));
  $('agentDetail').innerHTML = `<p class="bio"><b style="color:${hex(agent.accent)}">${agent.name}</b> · ${agent.role} — ${agent.bio}</p>
    <div class="abil">${keys.map((k) => {
      const kit = agent.kit[k], info = ABILITY_INFO[kit.type];
      const cost = k === 'x' ? `${kit.cost} points` : kit.free ? `free · ${kit.free} per round` : `¤${kit.price} · max ${kit.max}`;
      return `<div>${iconSvg(kit.type)}<b><span class="k">${k.toUpperCase()}</span>${info.name}</b>${info.desc.replace('ULTIMATE · ', '')}<br><span class="c">${cost}</span></div>`;
    }).join('')}</div>`;
}

function buildAgentSelect() {
  const grid = $('agentGrid');
  if (!grid.children.length) {
    for (const a of AGENTS) {
      const card = document.createElement('div');
      card.className = 'agent-card';
      card.dataset.id = a.id;
      card.style.setProperty('--ac', hex(a.accent));
      card.innerHTML = `<canvas></canvas><div class="nm">${a.name.toUpperCase()}</div><div class="rl">${a.role}</div>`;
      card.addEventListener('click', () => selectAgent(a.id));
      card.addEventListener('dblclick', () => { selectAgent(a.id); if (selectStarts) startGame(); });
      grid.appendChild(card);
    }
  }
  if (!portraitsDone) {
    for (const card of grid.children) game.renderPortrait(AGENT_BY_ID[card.dataset.id], card.querySelector('canvas'));
    portraitsDone = true;
  }
  selectAgent(picked);
}

function selectAgent(id) {
  picked = id;
  settings.agent = id;
  saveSettings();
  refreshLobby();
  for (const card of $('agentGrid').children) card.classList.toggle('sel', card.dataset.id === id);
  showAgentDetail(AGENT_BY_ID[id]);
}

let selectStarts = true;
function openAgentSelect(startAfter = true) {
  selectStarts = startAfter;
  $('lockBtn').textContent = startAfter ? 'LOCK IN' : 'DONE';
  sound.init();
  $('menu').classList.add('hidden');
  $('matchEnd').classList.add('hidden');
  $('agentSelect').classList.remove('hidden');
  buildAgentSelect();
}

function startGame() {
  if (party.active) {
    if (party.isHost && !$('playBtn').disabled) { settings.agent = picked; saveSettings(); startNetMatch(); }
    return;
  }
  sound.init();
  enterFullscreen();
  settings.agent = picked;
  saveSettings();
  $('agentSelect').classList.add('hidden');
  $('menu').classList.add('hidden');
  $('matchEnd').classList.add('hidden');
  $('pauseMenu').classList.add('hidden');
  game.hud.show(true);
  useTip();
  if (settings.queue === 'practice') game.startPractice(picked);
  else if (settings.queue === 'ranked') game.startMatch(picked, null, { ranked: true, skill: skillForRR(locker.profile.rr) });
  else { game.ranked = false; game.applySettings(); game.startMatch(picked); }
  game.paused = true;
  lock();
}

$('playBtn').addEventListener('click', () => { sound.init(); startGame(); });
$('againBtn').addEventListener('click', () => {
  $('matchEnd').classList.add('hidden');
  if (party.active) toMenu(true); else startGame();
});
$('lockBtn').addEventListener('click', () => {
  if (selectStarts) startGame();
  else { $('agentSelect').classList.add('hidden'); $('menu').classList.remove('hidden'); }
});
$('backBtn').addEventListener('click', () => {
  $('agentSelect').classList.add('hidden');
  $('menu').classList.remove('hidden');
});
$('resumeBtn').addEventListener('click', () => {
  $('pauseMenu').classList.add('hidden');
  sound.init();
  enterFullscreen();
  lock();
});
const LEAVE_PENALTY = 25;
const toMenu = (silent = false) => {
  // walking out of a ranked match counts against you
  if (!silent && game.running && game.ranked && !game.practice) {
    const prof = locker.profile;
    prof.rr = Math.max(0, prof.rr - LEAVE_PENALTY);
    saveProfile(prof);
    setTimeout(() => party.status(`Left a ranked match: -${LEAVE_PENALTY} RR`, true), 50);
    refreshRank();
  }
  sound.lobbyMusic(true);
  if (game.net && !silent) {
    if (party.isHost) party.send({ t: 'abort' });
    else party.send({ t: 'quit' });
  }
  party.inMatch = false;
  game.net = null; game.isHost = false; game.isClient = false;
  game.stop();
  game.hud.show(false);
  $('pauseMenu').classList.add('hidden');
  $('matchEnd').classList.add('hidden');
  placeSettings('settingsSlot');
  $('menu').classList.remove('hidden');
  refreshLobby();
  if (locked()) document.exitPointerLock();
};
$('quitBtn').addEventListener('click', () => toMenu());
$('menuBtn').addEventListener('click', () => toMenu(true));

game.onMatchEnd = (won, mine, theirs, player) => {
  party.inMatch = false;
  $('againBtn').textContent = party.active ? 'BACK TO PARTY' : 'PLAY AGAIN';
  if (locked()) document.exitPointerLock();
  game.hud.show(false);
  game.hud.showBuy(false);
  const r = $('matchResult');
  r.textContent = won ? 'VICTORY' : 'DEFEAT';
  r.className = won ? 'win' : 'loss';
  $('matchScore').textContent = `${mine} — ${theirs}`;
  $('matchStats').innerHTML = matchTable(player);
  const earned = 50 + player.kills * 10 + (won ? 100 : 0) + (game.ranked ? 50 : 0);
  locker.addCoins(earned);
  $('matchCoins').textContent = `+ ¤ ${earned} coins — spend them in the Locker`;
  showRankResult(won, mine, theirs, player);
  $('matchEnd').classList.remove('hidden');
};

// End-of-match scoreboard with damage, headshot % and an MVP.
function matchTable(player) {
  const rows = [...game.combatants].map((c) => ({
    c, score: c.kills * 150 + (c.dmgDealt || 0) - c.deaths * 40,
    hs: c.hitsLanded ? Math.round((c.headHits || 0) / c.hitsLanded * 100) : 0,
  })).sort((a, b) => b.score - a.score);
  const mvp = rows[0]?.c;
  const line = (r) => `<tr class="${r.c === player ? 'me' : ''} ${r.c.team === player.team ? 'ally' : 'enemy'}">
    <td>${r.c === mvp ? '<span class="mvp">MVP</span> ' : ''}${escapeHtml(r.c.name)}</td><td>${r.c.agent.name}</td>
    <td>${r.c.kills}</td><td>${r.c.deaths}</td><td>${Math.round(r.c.dmgDealt || 0)}</td><td>${r.hs}%</td></tr>`;
  return `<table class="end-table"><tr><th>PLAYER</th><th>AGENT</th><th>K</th><th>D</th><th>DMG</th><th>HS</th></tr>${rows.map(line).join('')}</table>`;
}

function showRankResult(won, mine, theirs, player) {
  const box = $('matchRank');
  if (!game.ranked) { box.classList.add('hidden'); return; }
  const prof = locker.profile;
  const before = prof.rr, beforeRank = rankOf(before);
  const delta = rrDelta(won, mine, theirs, player.kills, player.deaths);
  prof.rr = Math.max(0, before + delta);
  prof.ranked.played++; if (won) prof.ranked.wins++;
  prof.ranked.peak = Math.max(prof.ranked.peak, prof.rr);
  saveProfile(prof);
  const after = rankOf(prof.rr);
  box.classList.remove('hidden');
  $('mrBadge').innerHTML = badgeHtml(prof.rr, true);
  $('mrBadge').classList.remove('rank-up');
  box.style.setProperty('--rk', after.color);
  $('mrFill').style.transition = 'none';
  $('mrFill').style.width = `${(beforeRank.tier === after.tier && beforeRank.div === after.div ? beforeRank.progress : delta > 0 ? 0 : 1) * 100}%`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $('mrFill').style.transition = '';
    $('mrFill').style.width = `${(after.legend ? 1 : after.progress) * 100}%`;
  }));
  const changed = after.name !== beforeRank.name;
  $('mrDelta').textContent = `${delta > 0 ? '+' : ''}${delta} RR${changed ? (delta > 0 ? ' · RANK UP!' : ' · RANK DOWN') : ''}`;
  $('mrDelta').className = delta > 0 ? 'up' : 'down';
  if (changed && delta > 0) { $('mrBadge').classList.add('rank-up'); sound.announce(true); }
  refreshRank();
}

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

// Browsers stop animation frames in hidden tabs. If you're hosting an online match,
// keep simulating in the background so your friends' game doesn't freeze.
let bgLast = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - bgLast) / 1000);
  bgLast = now;
  if (document.hidden && game.running && game.isHost) game.update(dt);
}, 50);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.running) {
    game.frame(dt);
    const needClick = !locked() && $('pauseMenu').classList.contains('hidden') && !game.buyOpen && $('matchEnd').classList.contains('hidden');
    $('clickToPlay').classList.toggle('hidden', !needClick);
  }
  else {
    let tags = null;
    try { tags = game.lobby ? game.renderLobby(now / 1000, dt) : null; } catch (err) { console.error(err); }
    if (!tags) game.renderIdle(now / 1000, dt);
    const show = tags && !$('menu').classList.contains('hidden');
    for (let i = 0; i < 3; i++) {
      const el = $('tag' + i);
      el.style.display = show ? '' : 'none';
      if (show) { el.style.left = `${tags[i].x}px`; el.style.top = `${tags[i].y}px`; }
    }
  }
  input.endFrame();

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    game.hud.fps(settings.showFps ? `${Math.round(fpsFrames / fpsAcc)} FPS` : null);
    fpsAcc = 0; fpsFrames = 0;
  }
}
requestAnimationFrame(loop);
window.__game = game; // handy for debugging from the console

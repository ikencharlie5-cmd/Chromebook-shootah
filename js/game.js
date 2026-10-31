import * as THREE from '../lib/three.module.min.js?v=20261031180755';
import { GameMap } from './map.js?v=20261031180755';
import { randomMapDef, MAP_DEFS } from './maps.js?v=20261031180755';
import { Combatant, hitboxes, moveBody, applyMovement, speedFor, RUN_SPEED, JUMP_VEL } from './entities.js?v=20261031180755';
import { WEAPONS, ARMOR, makeWeaponState, recoilOffset } from './weapons.js?v=20261031180755';
import { AGENTS, AGENT_BY_ID, ABILITY_INFO } from './agents.js?v=20261031180755';
import { buildCharacter, setCharacterGun, buildCore, animateCharacter, buildGun } from './models.js?v=20261031180755';
import { BotBrain, DIFFICULTY } from './bots.js?v=20261031180755';
import { Abilities } from './abilities.js?v=20261031180755';
import { Effects } from './effects.js?v=20261031180755';
import { ViewModel } from './viewmodel.js?v=20261031180755';
import { Hud } from './hud.js?v=20261031180755';
import { clamp, rand, choice, shuffle, wrapAngle, dirFromAngles, rayAABB, rayHit, yawTo } from './util.js?v=20261031180755';
import { LOCKER_WEAPONS, randomBotSkin, equippedFor } from './skins.js?v=20261031180755';
import { NetMixin } from './netgame.js?v=20261031180755';

const TEAM_SIZE = 3;
const BUY_TIME = 15;
const FIRST_BUY_TIME = 25;
const ROUND_TIME = 100;
const CORE_TIME = 40;
const PLANT_TIME = 4;
const DEFUSE_TIME = 7;
const END_TIME = 5;
const WIN_ROUNDS = 7;
const HALF = 6;
const MAX_CREDITS = 9000;

const ALLY_LIGHT = 0x2ee6d6;
const ENEMY_LIGHT = 0xff3048;
const NAMES = ['Kestrel', 'Brick', 'Moth', 'Sable', 'Quill', 'Drift', 'Ash', 'Pike', 'Wren', 'Torch', 'Flint', 'Nyx', 'Rook', 'Juno', 'Vex', 'Halo', 'Grit'];

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _hb = [{}, {}, {}];

const markerTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#ff3048'; g.strokeStyle = '#fff'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(32, 6); g.lineTo(54, 30); g.lineTo(32, 58); g.lineTo(10, 30); g.closePath();
  g.fill(); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

export class Game {
  constructor(container, settings, sound, input) {
    this.settings = settings;
    this.sound = sound;
    this.input = input;

    this.renderer = new THREE.WebGLRenderer({ antialias: settings.quality === 'high', powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 700);
    this.camera.rotation.order = 'YXZ';
    this.viewmodel = new ViewModel(1);
    this.brain = new BotBrain(this);
    this.hud = new Hud(this);

    this.time = 0;
    this.running = false;
    this.paused = true;
    this.playerTeam = 0;
    this.combatants = [];
    this.punch = { pitch: 0, yaw: 0 };
    this.lookDx = 0; this.lookDy = 0;
    this.buyOpen = false;
    this.spectating = null;
    this.onMatchEnd = null;
    this.fovKick = 0;
    this.core = { state: 'none', pos: new THREE.Vector3(), site: null, timer: 0, beepT: 0 };

    this.loadMap(randomMapDef());
    this.applySettings();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Builds a fresh scene for a map.
  loadMap(def) {
    if (this.scene) disposeScene(this.scene);
    this.scene = new THREE.Scene();
    const q = this.settings.quality;
    this.shadows = q === 'high' ? 'high' : q === 'medium' ? 'medium' : false;
    this.renderer.shadowMap.enabled = !!this.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.map = new GameMap(this.scene, def, { shadows: this.shadows });
    this.effects = new Effects(this.scene);
    this.abilities = new Abilities(this);
    this.muzzleLight = new THREE.PointLight(0xffc870, 0, 9, 2);
    this.scene.add(this.muzzleLight);
    this.shake = 0;
    const core = buildCore();
    this.core.mesh = core.group;
    this.core.parts = core;
    core.group.visible = false;
    this.scene.add(core.group);
    const th = this.map.theme;
    this.viewmodel.setLighting(th.hemi[0], th.hemi[1], th.hemi[2]);
    this.hud.setMap(this.map);
  }

  applySettings() {
    const s = this.settings;
    const scale = s.quality === 'low' ? 0.6 : s.quality === 'medium' ? 0.85 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * scale);
    this.baseFov = s.fov;
    if (!this.ranked) this.skill = DIFFICULTY[s.difficulty] || DIFFICULTY.normal;
    this.hud.setCrossColor(s.crossColor);
    this.hud.setCrosshairStyle(s.chLen ?? 7, s.chThick ?? 2, s.chGap ?? 3, s.chDot ?? true, (s.chLen ?? 7) > 0);
    this.sound.setVolume(s.volume);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel.resize(w / h);
  }

  // ---- match / round flow -------------------------------------------------

  // Practice range: moving targets, free gear, no timer.
  startPractice(agentId) {
    this.ranked = false;
    this.applySettings();
    this.startMatch(agentId);
    this.practice = { shots: 0, hits: 0, heads: 0, kills: 0, respawn: [] };
    for (const c of this.combatants) {
      if (c.isPlayer || c.team !== this.playerTeam) continue;
      c.alive = false;
      if (c.model) c.model.root.visible = false;
    }
    this.player.hasCore = false;
    this.core.state = 'none';
    this.phase = 'live'; this.phaseT = 9999;
    this.map.barriers.visible = false;
    for (const c of this.combatants) if (c.team !== this.playerTeam) this.placeTarget(c);
    this.hud.message('PRACTICE RANGE', 'Press B to buy anything · abilities recharge · Esc to leave', 'warn', 4);
  }

  placeTarget(c) {
    const p = this.player, m = this.map;
    for (let tries = 0; tries < 60; tries++) {
      const cx = Math.floor(Math.random() * m.W), cz = Math.floor(Math.random() * m.H);
      if (!m.walkable(cx, cz) || m.isStair(cx, cz)) continue;
      const pos = m.groundCenter(cx, cz);
      const d = pos.distanceTo(p.pos);
      if (d < 8 || d > 32) continue;
      // keep targets roughly in front of you
      if (tries < 40 && Math.abs(wrapAngle(yawTo(pos.x - p.pos.x, pos.z - p.pos.z) - p.yaw)) > 1.0) continue;
      const eye = new THREE.Vector3(p.pos.x, p.pos.y + 1.6, p.pos.z);
      if (!this.canSee(eye, new THREE.Vector3(pos.x, pos.y + 1.3, pos.z)) && tries < 50) continue;
      c.pos.copy(pos);
      break;
    }
    c.alive = true; c.health = 100; c.armor = 0; c.deadT = 0; c.vel.set(0, 0, 0);
    c.yaw = yawTo(p.pos.x - c.pos.x, p.pos.z - c.pos.z);
    c.practiceDir = Math.random() < 0.5 ? -1 : 1; c.practiceT = rand(0.5, 1.5);
    if (c.model) { c.model.root.visible = true; c.model.root.rotation.x = 0; }
  }

  updatePractice(dt) {
    const P = this.practice, p = this.player;
    for (const c of this.combatants) {
      if (c.team === this.playerTeam || c.isPlayer) continue;
      if (!c.alive) {
        c.deadT += dt;
        if (c.deadT > 1.4) this.placeTarget(c);
        continue;
      }
      // strafe side to side, sometimes stop or crouch, always face the player
      c.practiceT -= dt;
      if (c.practiceT <= 0) { c.practiceT = rand(0.4, 1.4); c.practiceDir = Math.random() < 0.25 ? 0 : Math.random() < 0.5 ? -1 : 1; c.crouching = Math.random() < 0.2; }
      c.yaw = yawTo(p.pos.x - c.pos.x, p.pos.z - c.pos.z);
      const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
      c.walking = true;
      this.updateBody(c, dt, rx * c.practiceDir, rz * c.practiceDir);
    }
    if (p.alive) {
      p.health = 100;
      for (const k of ['q', 'e', 'f']) p.charges[k] = p.agent.kit[k].max || p.agent.kit[k].free || 1;
      p.ult = p.agent.kit.x.cost;
      p.credits = 9000;
      for (const w of [p.inv.primary, p.inv.secondary]) if (w && w.reserve < w.def.mag) w.reserve = w.def.reserve;
    }
    const acc = P.shots ? Math.round(P.hits / P.shots * 100) : 0, hs = P.hits ? Math.round(P.heads / P.hits * 100) : 0;
    this.hud.practiceStats(`PRACTICE · KILLS ${P.kills} · ACCURACY ${acc}% · HEADSHOTS ${hs}%`);
  }

  // Single player: you + 2 bot allies vs 3 bots.
  startMatch(agentId, mapId = null, opts = {}) {
    this.practice = null;
    this.ranked = !!opts.ranked;
    this.skill = opts.skill || DIFFICULTY[this.settings.difficulty] || DIFFICULTY.normal;
    const roster = makeRoster([{ human: 'local', name: this.settings.name || 'You', agent: agentId, team: 0, skins: this.playerSkins() }]);
    this.startFromRoster(roster, 'local', mapId || randomMapDef().id, null);
  }

  // roster: [{ cid, name, agent, team, human (peer id / 'local' / null for bots), skins }]
  // net: the Party (multiplayer) or null. The host simulates; clients only predict themselves.
  startFromRoster(roster, myHuman, mapId, net) {
    if (net) this.practice = null;
    this.net = net;
    this.isHost = net?.role === 'host';
    this.isClient = net?.role === 'client';
    this.loadMap(MAP_DEFS.find((m) => m.id === mapId) || randomMapDef());
    const me = roster.find((r) => r.human === myHuman) || roster[0];
    this.playerTeam = me.team;
    this.combatants = [];
    this.byId = {};
    for (const r of roster) {
      const agent = AGENT_BY_ID[r.agent] || AGENTS[0];
      const isMe = r === me;
      const c = new Combatant(r.cid, r.name, r.team, isMe, agent);
      c.human = r.human;
      c.isRemote = this.isHost && !isMe && !!r.human;
      c.isPuppet = this.isClient && !isMe;
      c.skins = r.skins || {};
      c.tp = 0;
      if (isMe) this.player = c;
      else {
        c.model = buildCharacter(agent, r.team === this.playerTeam ? ALLY_LIGHT : ENEMY_LIGHT, r.team !== this.playerTeam);
        if (this.shadows) c.model.root.traverse((o) => { if (o.isMesh && !o.userData.noShadow) o.castShadow = true; });
        this.scene.add(c.model.root);
        if (r.team !== this.playerTeam) {
          c.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, depthTest: false, transparent: true }));
          c.marker.scale.set(0.45, 0.45, 1);
          c.marker.renderOrder = 10;
          c.marker.visible = false;
          this.scene.add(c.marker);
        }
      }
      this.combatants.push(c);
      this.byId[c.id] = c;
    }
    this.viewmodel.setAgent(this.player.agent);
    this.viewmodel.setSkins(this.player.skins);
    this.score = [0, 0];
    this.lossStreak = [0, 0];
    this.round = 0;
    this.attackTeam = 0;
    this.matchOver = false;
    this.netEvents = [];
    this.stats = { shots: 0 };
    this.snapT = 0; this.inT = 0;
    this.out = { shots: [], casts: [], buys: [], rl: false };
    this.hud.clearKillfeed();
    this.hud.setAgent(this.player.agent);
    if (this.isClient) {
      // wait for the host's first snapshot; show the spawn area meanwhile
      this.phase = 'buy'; this.phaseT = FIRST_BUY_TIME; this.round = 1;
      this.core.state = 'carried';
      this.player.tp = -1;
      this.effects.clear();
      this.abilities.reset();
      this.viewmodel.setWeapon(this.player.weapon.def.id, 0.3);
    } else this.startRound();
    this.running = true;
    this.sound.lobbyMusic(false);
    this.sound.ambient(this.map.def.theme);
    this.hud.message(this.map.name.toUpperCase(), this.map.def.blurb, 'warn', 4);
  }

  // Host: queue an event for clients (no-op offline).
  emit(ev) {
    if (this.isHost) this.netEvents.push(ev);
  }

  sideOf(team) { return team === this.attackTeam ? 'ATK' : 'DEF'; }

  playerSkins() {
    const out = {};
    if (!this.profile) return out;
    for (const w of LOCKER_WEAPONS) { const e = equippedFor(this.profile, w); out[w] = { skin: e.skin, model: e.model }; }
    return out;
  }

  startRound() {
    this.round++;
    const swap = this.round === HALF + 1;
    if (swap) this.attackTeam = 1 - this.attackTeam;
    const pistolRound = this.round === 1 || swap;

    this.effects.clear();
    this.abilities.reset();
    this.phase = 'buy';
    this.phaseT = this.round === 1 ? FIRST_BUY_TIME : BUY_TIME;
    this.defAlert = null;
    this.core.state = 'carried';
    this.core.mesh.visible = false;
    this.core.site = null;
    this.spectating = null;
    this.deathCam = null;
    this.map.barriers.visible = true;

    const spawnCells = { T: shuffle([...this.map.spawns.T]), D: shuffle([...this.map.spawns.D]) };
    const attackers = [];
    for (const c of this.combatants) {
      c.tp = (c.tp || 0) + 1;
      c.hist = [];   // positions jump at round start: don't rewind across it
      if (pistolRound) {
        c.credits = 800;
        c.resetLoadout();
        c.charges.q = 0; c.charges.f = 0;
      } else if (!c.alive) {
        c.resetLoadout();
      }
      c.alive = true;
      c.health = 100;
      c.roundKills = 0;
      c.assistBy.clear();
      c.hasCore = false;
      c.action = null;
      c.scoped = false;
      c.crouch = 0; c.crouching = false;
      c.vel.set(0, 0, 0);
      c.clearStatus();
      c.refillSignature();
      c.refillAmmo();
      c.slot = c.bestSlot();
      c.switchT = 0;
      const side = this.sideOf(c.team);
      const cell = spawnCells[side === 'ATK' ? 'T' : 'D'].pop();
      this.map.groundCenter(cell[0], cell[1], c.pos);
      c.pos.x += rand(-0.6, 0.6); c.pos.z += rand(-0.6, 0.6);
      c.yaw = side === 'ATK' ? 0 : Math.PI;
      c.pitch = 0;
      if (side === 'ATK') attackers.push(c);
      if (c.model) {
        c.model.root.visible = true;
        c.model.root.rotation.x = 0;
      }
    }
    const carrier = choice(attackers);
    carrier.hasCore = true;
    this.core.carrier = carrier;

    for (const c of this.combatants) if (!c.human) this.botBuy(c, pistolRound);
    this.assignRoles();

    this.punch.pitch = this.punch.yaw = 0;
    this.viewmodel.setWeapon(this.player.weapon.def.id, 0.3);
    this.emit({ e: 'rs', round: this.round, swap });
    this.roundStartMessage(swap);
  }

  roundStartMessage(swap) {
    const side = this.sideOf(this.playerTeam);
    if (this.round > 1) {
      if (swap) this.hud.message('SWITCHING SIDES', `You are now ${side === 'ATK' ? 'ATTACKING' : 'DEFENDING'}`, 'warn', 4);
      else this.hud.message(`ROUND ${this.round}`, side === 'ATK' ? 'ATTACK — plant the Core at A or B' : 'DEFEND — protect sites A and B', '', 3);
    }
  }

  assignRoles() {
    const atk = this.combatants.filter((c) => !c.human && this.sideOf(c.team) === 'ATK');
    const def = this.combatants.filter((c) => !c.human && this.sideOf(c.team) === 'DEF');
    const site = Math.random() < 0.5 ? 'A' : 'B';
    this.attackSite = site;
    const routes = this.map.routes[site];
    atk.forEach((c, i) => this.brain.initRound(c, { kind: 'attack', site, route: routes[i % routes.length] }));
    const areas = shuffle(['A', 'B', 'mid']);
    // with only two defending bots (player defends too) cover both sites
    const list = def.length >= 3 ? areas : shuffle(['A', 'B']);
    def.forEach((c, i) => this.brain.initRound(c, { kind: 'hold', area: list[i % list.length] }));
  }

  botBuy(c, pistolRound) {
    const buy = (id) => {
      const d = WEAPONS[id];
      if (c.credits < d.price) return false;
      c.credits -= d.price;
      c.inv[d.slot] = makeWeaponState(id);
      return true;
    };
    const armor = (kind) => {
      const a = ARMOR[kind];
      if (c.armor >= a.value || c.credits < a.price) return;
      c.credits -= a.price;
      c.armor = a.value;
    };
    const abilities = () => {
      for (const k of ['q', 'f']) {
        const kit = c.agent.kit[k];
        while (c.charges[k] < kit.max && c.credits >= kit.price) { c.credits -= kit.price; c.charges[k]++; }
      }
    };
    if (pistolRound) {
      const r = Math.random();
      if (r < 0.4) armor('light');
      else if (r < 0.7) buy('bolt');
      abilities();
    } else if (!c.inv.primary) {
      const cr = c.credits, r = Math.random();
      const rifle = () => (Math.random() < 0.5 ? 'talon' : 'raptor');
      if (cr >= 5500 && r < 0.15) { buy('lynx'); armor('heavy'); }
      else if (cr >= 4200 && r < 0.25) { buy('bastion'); armor('heavy'); }
      else if (cr >= 3900) { buy(rifle()); armor('heavy'); }
      else if (cr >= 3400 && r < 0.3) { buy('arbiter'); armor('heavy'); }
      else if (cr >= 3300) { buy(rifle()); armor('light'); }
      else if (cr >= 2900 && r < 0.6) buy(rifle());
      else if (cr >= 2200 && r < 0.35) { buy('thunder'); armor('light'); }
      else if (cr >= 2000) { buy(r < 0.5 ? 'wasp' : 'hornet'); armor('light'); }
      else if (cr >= 1600 && r < 0.4) buy(r < 0.2 ? 'needle' : 'wasp');
      else if (cr >= 1400 && r < 0.5) buy('hornet');
      else if (cr >= 800 && r < 0.4) buy('bolt');
      abilities();
    } else {
      if (c.credits >= 1000) armor('heavy');
      else armor('light');
      abilities();
    }
    c.slot = c.bestSlot();
  }

  // Player purchases from the buy menu. ids: weapon id, 'light'/'heavy', or 'ab:q' / 'ab:f'.
  buy(id) {
    if (this.isClient) {
      if (this.phase !== 'buy' || !this.player.alive) { this.sound.deny(); return; }
      this.out.buys.push(id);
      this.sound.buy();
      return;
    }
    this.buyFor(this.player, id);
  }

  buyFor(p, id) {
    const deny = () => { if (p.isPlayer) this.sound.deny(); };
    if ((this.phase !== 'buy' && !this.practice) || !p.alive) { deny(); return; }
    if (id.startsWith('ab:')) {
      const k = id.slice(3), kit = p.agent.kit[k];
      if (!kit || !kit.price || p.charges[k] >= kit.max || p.credits < kit.price) { deny(); return; }
      p.credits -= kit.price;
      p.charges[k]++;
    } else if (ARMOR[id]) {
      const a = ARMOR[id];
      if (p.armor >= a.value || p.credits < a.price) { deny(); return; }
      p.credits -= a.price;
      p.armor = a.value;
    } else {
      const d = WEAPONS[id];
      if (!d || p.credits < d.price || p.inv[d.slot]?.def.id === id) { deny(); return; }
      p.credits -= d.price;
      p.inv[d.slot] = makeWeaponState(id);
      this.switchSlot(p, d.slot, true);
    }
    if (p.isPlayer) { this.sound.buy(); this.hud.refreshBuyMenu(); }
  }

  endRound(winnerSide, reason) {
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.phaseT = END_TIME;
    const winTeam = winnerSide === 'ATK' ? this.attackTeam : 1 - this.attackTeam;
    const loseTeam = 1 - winTeam;
    this.score[winTeam]++;
    this.lossStreak[winTeam] = 0;
    this.lossStreak[loseTeam] = Math.min(this.lossStreak[loseTeam] + 1, 3);
    for (const c of this.combatants) {
      const bonus = c.team === winTeam ? 3000 : 1400 + this.lossStreak[loseTeam] * 500;
      c.credits = Math.min(MAX_CREDITS, c.credits + bonus);
      c.action = null;
    }
    this.emit({ e: 'end', win: winTeam, reason });
    this.roundEndMessage(winTeam, reason);
    if (this.score[winTeam] >= WIN_ROUNDS) this.matchOver = true;
  }

  roundEndMessage(winTeam, reason) {
    const won = winTeam === this.playerTeam;
    this.sound.announce(won);
    const reasons = { elim: 'Team eliminated', time: 'Time ran out', detonate: 'Core detonated', defuse: 'Core defused' };
    this.hud.message(won ? 'ROUND WON' : 'ROUND LOST', reasons[reason] || '', won ? 'win' : 'loss', END_TIME - 0.5);
  }

  addUlt(c, n = 1) {
    if (!c.agent) return;
    const before = c.ult;
    c.ult = Math.min(c.agent.kit.x.cost, c.ult + n);
    if (c.isPlayer && before < c.agent.kit.x.cost && c.ult >= c.agent.kit.x.cost) this.hud.message('', 'ULTIMATE READY — press X', 'warn', 2);
  }

  // ---- main update --------------------------------------------------------

  update(dt) {
    if (!this.running) return;
    // offline the game pauses; online the match keeps going (input is just ignored)
    if (this.paused && !this.net) return;
    if (this.isClient) { this.updateClient(dt); return; }
    this.time += dt;
    if (this.practice) {
      this.updatePlayer(dt);
      this.updatePractice(dt);
      for (const c of this.combatants) if (c.alive) { this.updateWeapon(c, dt); this.updateStatus(c, dt); }
      this.abilities.update(dt);
      this.updateModels(dt);
      this.effects.update(dt);
      this.map.update(dt);
      return;
    }
    this.phaseT -= dt;

    if (this.phase === 'buy' && this.phaseT <= 0) {
      this.phase = 'live';
      this.phaseT = ROUND_TIME;
      this.map.barriers.visible = false;
      if (this.buyOpen) { this.toggleBuy(false); this.onBuyAutoClose?.(); }
      this.hud.message('GO', '', 'warn', 1.2);
      this.emit({ e: 'go' });
    } else if (this.phase === 'live') {
      if (this.core.state !== 'planted' && this.phaseT <= 0) this.endRound('DEF', 'time');
    } else if (this.phase === 'end' && this.phaseT <= 0) {
      if (this.matchOver) { this.finishMatch(); return; }
      this.startRound();
      return;
    }

    this.updatePlayer(dt);
    for (const c of this.combatants) {
      if (c.isPlayer || !c.alive) continue;
      if (c.isRemote) {
        c.crouch += clamp((c.crouching ? 1 : 0) - c.crouch, -dt * 7, dt * 7);
        continue;
      }
      this.brain.update(c, dt);
      this.updateBody(c, dt, c.wx, c.wz);
    }
    this.separate();
    if (this.isHost) this.recordHistory();
    for (const c of this.combatants) if (c.alive) { this.updateWeapon(c, dt); this.updateStatus(c, dt); }
    this.abilities.update(dt);
    this.updateActions(dt);
    this.updateCore(dt);
    this.updateSpotting();
    this.checkElimination();
    this.updateModels(dt);
    this.effects.update(dt);
    this.map.update(dt);
    if (this.isHost) this.netTick(dt);
  }

  updateStatus(c, dt) {
    if (c.blind > 0) c.blind = Math.max(0, c.blind - dt);
    if (c.overdriveT > 0) c.overdriveT -= dt;
    if (c.castT > 0) c.castT -= dt;
    if (c.healT > 0) {
      c.healT -= dt;
      c.health = Math.min(100, c.health + 15 * dt);
    }
  }

  updateBody(c, dt, wx, wz) {
    const restrict = this.phase === 'buy' ? (this.sideOf(c.team) === 'ATK' ? 'T' : 'D') : null;
    if (c.action) { wx = 0; wz = 0; }
    const target = c.crouching ? 1 : 0;
    c.crouch += clamp(target - c.crouch, -dt * 7, dt * 7);
    applyMovement(c, wx, wz, speedFor(c), dt);
    const fallV = c.vel.y;
    const landed = moveBody(this.map, c, dt, restrict);
    if (landed && c.isPlayer) this.sound.land();
    if (landed && fallV < -6.5) { this.effects.dust(c.pos, 6); if (c.isPlayer) this.shake = Math.min(1, this.shake + 0.15); }

    const sp = Math.hypot(c.vel.x, c.vel.z);
    if (c.onGround && sp > 0.5) {
      c.stepDist += sp * dt;
      const stride = c.crouching ? 1.25 : c.walking ? 1.6 : 2.2;
      if (c.stepDist > stride) {
        c.stepDist = 0;
        const loud = sp > RUN_SPEED * 0.75 && !c.walking && !c.crouching;
        const mode = loud ? 'run' : c.crouching ? 'crouch' : 'walk';
        // quiet steps are only heard by yourself (and very close by)
        if (c.isPlayer) this.sound.footstep(null, mode, this.surfaceAt(c), true);
        else if (loud || c.pos.distanceTo(this.camera.position) < 6) this.sound.footstep(c.pos, mode, this.surfaceAt(c));
        if (loud) {
          for (const o of this.combatants) {
            if (o.team === c.team || !o.alive || o.human) continue;
            if (o.pos.distanceTo(c.pos) < 16) this.brain.hear(o, c.pos, 0.5);
          }
        }
      }
    }
  }

  separate() {
    const list = this.combatants;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || a.isRemote || b.isRemote) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d >= min || d < 1e-4 || Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
        const push = (min - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
        const ax = a.vel.x, az = a.vel.z, bx = b.vel.x, bz = b.vel.z;
        a.vel.x = a.vel.z = b.vel.x = b.vel.z = 0;
        moveBody(this.map, a, 0, null);
        moveBody(this.map, b, 0, null);
        a.vel.x = ax; a.vel.z = az; b.vel.x = bx; b.vel.z = bz;
      }
    }
  }

  // ---- player --------------------------------------------------------------

  updatePlayer(dt) {
    const p = this.player, inp = this.input, s = this.settings;
    const look = inp.consumeMouse();
    this.lookDx = look.dx; this.lookDy = look.dy;

    if (!p.alive) {
      this.updateSpectate();
      return;
    }

    if (!this.buyOpen && !this.paused) {
      const zoomMul = p.scoped ? p.weapon.def.zoomFov / this.baseFov : 1;
      const sens = 0.0022 * s.sensitivity * zoomMul;
      p.yaw = wrapAngle(p.yaw - look.dx * sens);
      p.pitch = clamp(p.pitch - look.dy * sens, -1.55, 1.55);
    }

    const k = (c) => inp.keys.has(c);
    const menuBlock = this.buyOpen || this.paused;
    p.crouching = !menuBlock && (k('KeyC') || k('ControlLeft'));
    p.walking = !menuBlock && (k('ShiftLeft') || k('ShiftRight'));

    if (!menuBlock) {
      if (inp.pressed('Digit1') && p.inv.primary) this.switchSlot(p, 'primary');
      if (inp.pressed('Digit2') && p.inv.secondary) this.switchSlot(p, 'secondary');
      if (inp.pressed('Digit3')) this.switchSlot(p, 'melee');
      const wheel = inp.consumeWheel();
      if (wheel) {
        const order = ['primary', 'secondary', 'melee'].filter((sl) => p.inv[sl]);
        const i = order.indexOf(p.slot);
        this.switchSlot(p, order[(i + (wheel > 0 ? 1 : -1) + order.length) % order.length]);
      }
      if (inp.pressed('KeyR')) { this.startReload(p); if (this.isClient) this.out.rl = true; }
      for (const [code, key] of [['KeyQ', 'q'], ['KeyE', 'e'], ['KeyF', 'f'], ['KeyX', 'x']]) {
        if (!inp.pressed(code)) continue;
        if (this.isClient) { this.clientCast(key); continue; }
        if (!this.abilities.cast(p, key)) {
          this.sound.deny();
          if (key === 'x' && this.phase === 'live') this.hud.message('', `Ultimate ${p.ult}/${p.agent.kit.x.cost}`, '', 1.2);
        }
      }
    }

    let fx = 0, fz = 0;
    if (!menuBlock) {
      const fwd = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
      const str = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      fx = -sy * fwd + cy * str;
      fz = -cy * fwd - sy * str;
      const l = Math.hypot(fx, fz);
      if (l > 0) { fx /= l; fz /= l; }
      if (k('Space') && p.onGround && !p.action) p.vel.y = JUMP_VEL;
    }
    p.moveX = fx; p.moveZ = fz;
    this.updateBody(p, dt, fx, fz);

    const w = p.weapon;
    if (w.def.melee && inp.pressed('Mouse2') && !menuBlock && !p.action && this.phase !== 'buy') this.tryShoot(p, true);
    if (w.def.scope) {
      if (inp.pressed('Mouse2') && !menuBlock && w.reloadT <= 0 && p.switchT <= 0) p.scoped = !p.scoped;
      if (w.reloadT > 0 || p.switchT > 0) p.scoped = false;
    } else p.scoped = false;

    const trigger = inp.mouse[0] && !menuBlock && !p.action;
    if (w.def.burst && trigger && !p.triggerHeld) p.burstQueue = w.def.burst - (w.burstShot || 0);
    if (w.def.burst && !trigger && p.burstQueue > 0 && this.phase !== 'buy' && w.mag > 0) {
      if (this.tryShoot(p)) p.burstQueue--;
    } else if (trigger && this.phase !== 'buy') {
      if (w.def.auto || !p.triggerHeld) {
        if (!w.def.melee && w.mag <= 0 && w.reloadT <= 0) {
          if (!p.triggerHeld) this.sound.click();
          this.startReload(p);
        } else if (this.tryShoot(p) && p.burstQueue > 0) p.burstQueue--;
      }
    }
    p.triggerHeld = trigger;

    // standing in enemy fire
    if (this.abilities.inFire(p)) {
      this.burnT = (this.burnT || 0) - dt;
      if (this.burnT <= 0) { this.burnT = 0.3; this.sound.burn(); }
    }
  }

  updateSpectate() {
    const allies = this.combatants.filter((c) => c.alive && c.team === this.playerTeam && !c.isPlayer);
    if (!this.spectating || !this.spectating.alive || this.input.pressed('Mouse0')) {
      if (allies.length) {
        const i = allies.indexOf(this.spectating);
        this.spectating = allies[(i + 1) % allies.length];
      } else this.spectating = null;
    }
  }

  switchSlot(c, slot, force = false) {
    if (!c.inv[slot] || (c.slot === slot && !force)) return;
    const cur = c.weapon;
    if (cur) cur.reloadT = 0;
    if (c.slot !== slot) c.lastSlot = c.slot;
    c.slot = slot;
    c.scoped = false;
    c.switchT = c.inv[slot].def.equip;
    if (c.isPlayer) {
      this.viewmodel.setWeapon(c.inv[slot].def.id, c.switchT);
      this.sound.equip();
    }
  }

  startReload(c) {
    const w = c.weapon;
    if (!w || w.def.melee || w.reloadT > 0 || w.mag >= w.def.mag || w.reserve <= 0) return;
    w.reloadT = w.def.reload * (c.overdriveT > 0 ? 0.5 : 1);
    c.scoped = false;
    if (c.isPlayer) this.sound.reload();
  }

  updateWeapon(c, dt) {
    const w = c.weapon;
    if (!w) return;
    c.switchT -= dt;
    w.cool -= dt;
    w.sinceShot += dt;
    if (w.reloadT > 0) {
      w.reloadT -= dt;
      if (w.reloadT <= 0) {
        const need = w.def.mag - w.mag, take = Math.min(need, w.reserve);
        w.mag += take; w.reserve -= take;
        w.reloadT = 0;
      }
    }
    const interval = 60 / w.def.rpm;
    if (w.sinceShot > interval * 1.6) w.spray = Math.max(0, w.spray - dt * 14);
  }

  spreadFor(c) {
    const d = c.weapon.def;
    const sp = Math.hypot(c.vel.x, c.vel.z);
    const move = c.overdriveT > 0 ? 0 : clamp((sp - 0.8) / 4.6, 0, 1);
    let base = d.spread;
    if (d.scope && (c.scoped || !c.isPlayer)) base = d.scopedSpread;
    let s = base * (c.crouch > 0.5 ? 0.75 : 1) + d.moveSpread * Math.pow(move, 1.5);
    if (!c.onGround && c.overdriveT <= 0) s += d.airSpread;
    s += d.bloom * Math.min(c.weapon.spray, 10);
    return s;
  }

  canFire(c) {
    const w = c.weapon;
    return w && c.alive && !c.action && c.switchT <= 0 && w.cool <= 0 && w.reloadT <= 0 && this.phase !== 'buy' &&
      c.castT <= 0.25 && (w.def.melee || w.mag > 0);
  }

  tryShoot(c, heavy = false) {
    if (!this.canFire(c)) return false;
    const w = c.weapon, d = w.def;
    heavy = heavy && d.melee;
    w.cool = (heavy ? d.heavyCool : 60 / d.rpm) * (c.overdriveT > 0 ? 0.8 : 1);
    if (!c.isPlayer && !d.auto) w.cool = Math.max(w.cool, rand(0.22, 0.38));
    w.sinceShot = 0;
    const dirs = [];

    if (d.melee) {
      dirs.push(dirFromAngles(c.yaw, c.pitch, new THREE.Vector3()));
      if (c.isPlayer) this.viewmodel.swing(heavy ? 'heavy' : 'light');
      this.sound.knife(c.isPlayer ? null : c.pos, heavy);
      c.swingT = heavy ? 0.6 : 0.35; c.swingSide = -(c.swingSide || 1);
    } else {
      w.mag--;
      const rec = recoilOffset(d, w.spray);
      w.spray += 1;
      if (d.burst) {
        // 3-round burst: after the last round of a burst there's a longer pause
        w.burstShot = (w.burstShot || 0) + 1;
        if (w.burstShot >= d.burst) { w.burstShot = 0; w.cool = d.burstGap; }
      }
      const spread = this.spreadFor(c) + (c.blind > 0 ? 0.08 : 0);
      if (c.isPlayer) {
        this.effects.muzzleFlash(this.viewmodel.flash);
        this.viewmodel.kick({ sniper: 3, shotgun: 2.6, rifle: 1.2, lmg: 1.1 }[d.kind] || 1);
        this.punch.pitch += d.vKick * 0.5 + 0.004;
        this.punch.yaw += (Math.random() - 0.5) * d.hKick * 0.5;
        if (d.scope) c.scoped = false;
        this.playerFireFx(c, d);
      } else if (c.model?.flash) this.effects.muzzleFlash(c.model.flash);
      this.sound.shot(d.sound, c.isPlayer ? null : c.pos);
      // one direction per pellet (shotguns fire many)
      const pellets = d.pellets || 1;
      for (let k = 0; k < pellets; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = pellets > 1 ? spread * Math.sqrt(Math.random()) : spread * Math.random();
        dirs.push(dirFromAngles(c.yaw + rec.yaw + Math.cos(a) * r, c.pitch + rec.pitch + Math.sin(a) * r, new THREE.Vector3()));
      }
    }
    if (c.isPlayer && !d.melee) { this.stats.shots++; if (this.practice) this.practice.shots++; }
    this.fireTraces(c, d, dirs, heavy);
    if (this.isClient && c.isPlayer) {
      const r4 = (v) => Math.round(v * 10000) / 10000;
      // what the host clock was for the enemies we were looking at (we draw them ~80ms behind)
      const ht = (this.hostTime ?? 0) + (this.time - (this.hostTimeAt ?? this.time)) - 0.08;
      this.out.shots.push({ w: d.id, hv: heavy ? 1 : 0, ht: Math.round(ht * 1000) / 1000, d: dirs.map((v) => [r4(v.x), r4(v.y), r4(v.z)]) });
    }
    return true;
  }

  // Host: a remote player fired. Directions come from their client.
  remoteShoot(c, s) {
    const slot = ['primary', 'secondary', 'melee'].find((k) => c.inv[k]?.def.id === s.w);
    if (!slot || !Array.isArray(s.d)) return;
    const w = c.inv[slot], d = w.def;
    if (!d.melee) { if (w.mag <= 0) return; w.mag--; w.sinceShot = 0; }
    const dirs = s.d.slice(0, 12).map((a) => new THREE.Vector3(a[0], a[1], a[2]).normalize());
    if (d.melee) { this.sound.knife(c.pos, !!s.hv); c.swingT = s.hv ? 0.6 : 0.35; c.swingSide = -(c.swingSide || 1); }
    else {
      if (c.model?.flash) this.effects.muzzleFlash(c.model.flash);
      this.sound.shot(d.sound, c.pos);
    }
    this.fireTraces(c, d, dirs, d.melee && !!s.hv);
  }

  muzzleOf(c) {
    _o.set(c.pos.x, c.pos.y + c.eyeHeight, c.pos.z);
    if (c.isPlayer) {
      const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
      return new THREE.Vector3(_o.x + cy * 0.18 - sy * 0.6, _o.y - 0.14, _o.z - sy * 0.18 - cy * 0.6);
    }
    return c.model?.muzzle ? c.model.muzzle.getWorldPosition(new THREE.Vector3()) : _o.clone();
  }

  // Traces shots: visuals everywhere, damage only where the match is simulated (offline / host).
  fireTraces(c, d, dirs, heavy = false) {
    const eye = new THREE.Vector3(c.pos.x, c.pos.y + c.eyeHeight, c.pos.z);
    const maxT = d.melee ? (heavy ? d.heavyRange : d.range) : 200;
    const table = heavy ? d.heavyDmg : d.dmg;
    const muzzle = d.melee ? null : this.muzzleOf(c);
    const hits = new Map(), pts = [];
    const r2 = (v) => Math.round(v * 100) / 100;
    dirs.forEach((dir, k) => {
      const hit = this.trace(c, eye, dir, maxT);
      if (!d.melee && k < 3 && (Math.random() < 0.7 || c.isPlayer)) this.effects.tracer(muzzle, hit.point);
      if (hit.entity) {
        let dmg = table[hit.part];
        if (d.pellets) dmg *= clamp(1 - (hit.t - d.closeRange) / (d.farRange - d.closeRange) * 0.85, 0.15, 1);
        else if (d.falloff && hit.t > d.falloff[0]) dmg *= d.falloff[1];
        if (!d.melee) this.effects.blood(hit.point, dir);
        const h = hits.get(hit.entity) || { dmg: 0, head: false, part: hit.part, dir: dir.clone() };
        h.dmg += dmg; h.head = h.head || hit.part === 'head';
        hits.set(hit.entity, h);
        pts.push([r2(hit.point.x), r2(hit.point.y), r2(hit.point.z), 1]);
      } else if (hit.t < maxT) {
        if (!d.melee) this.effects.impact(hit.point, hit.normal);
        if (!this.isClient && hit.box?.kind === 'ability') this.abilities.damageWall(hit.box, d.dmg.body);
        pts.push([r2(hit.point.x), r2(hit.point.y), r2(hit.point.z), 0, hit.normal.x, hit.normal.y, hit.normal.z]);
      } else pts.push([r2(hit.point.x), r2(hit.point.y), r2(hit.point.z), 2]);
    });
    if (this.isClient) return;
    for (const [victim, h] of hits) this.applyDamage(victim, c, h.dmg, d.melee ? h.part : h.head ? 'head' : 'body', d.name, h.dir);
    this.emit({ e: 'sh', c: c.id, w: d.id, m: d.melee ? 1 : 0, hv: heavy ? 1 : 0, pts });
    for (const o of this.combatants) {
      if (o.human || !o.alive || o.team === c.team) continue;
      if (o.pos.distanceTo(c.pos) < 55) this.brain.hear(o, c.pos, 1);
    }
  }

  // ---- feedback effects -----------------------------------------------------

  playerFireFx(c, d) {
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    const eye = new THREE.Vector3(c.pos.x, c.pos.y + c.eyeHeight, c.pos.z);
    this.muzzleLight.position.set(eye.x - sy * 0.9 + cy * 0.2, eye.y - 0.1, eye.z - cy * 0.9 - sy * 0.2);
    this.muzzleLight.intensity = d.kind === 'shotgun' || d.kind === 'sniper' ? 45 : 25;
    this.shake = Math.min(1, this.shake + ({ sniper: 0.35, shotgun: 0.4, lmg: 0.08 }[d.kind] || 0.05));
    // brass flies out to the right
    const pos = eye.clone().add(new THREE.Vector3(cy * 0.25 - sy * 0.35, -0.15, -sy * 0.25 - cy * 0.35));
    const vel = new THREE.Vector3(cy * (2 + Math.random()), 2.2 + Math.random(), -sy * (2 + Math.random())).add(c.vel);
    this.effects.casing(pos, vel);
    if (Math.random() < 0.3) this.sound.casing();
  }

  // Bring a dead combatant back where they fell (Lifeline ultimate).
  revive(c) {
    if (c.alive || this.phase === 'end') return;
    c.alive = true;
    c.health = 100;
    c.deadT = 0;
    c.vel.set(0, 0, 0);
    c.action = null;
    c.clearStatus();
    c.pos.y = Math.max(c.pos.y, this.map.heightAt(c.pos.x, c.pos.z));
    if (c.model) { c.model.root.visible = true; c.model.root.rotation.x = 0; }
    if (c.isPlayer) { this.deathCam = null; this.spectating = null; this.viewmodel.setWeapon(c.weapon.def.id, 0.4); this.hud.message('REVIVED', '', 'win', 1.5); }
    if (c.ai) { c.ai.target = null; c.ai.goalKey = ''; }
  }

  creditAssist(victim, by, seconds) {
    if (!victim || !by || by === victim || by.team === victim.team) return;
    victim.assistBy.set(by.id, Math.max(victim.assistBy.get(by.id) || 0, this.time + seconds));
  }

  onPlayerAssist(victim) {
    this.hud.assistPop(victim.name);
    this.sound.assist();
  }

  onPlayerKill(victim, n) {
    this.sound.kill(n);
    const enemies = this.combatants.filter((c) => c.team !== this.playerTeam).length;
    if (n >= enemies && enemies >= 3) { this.hud.ace(); this.sound.ace(); this.shake = Math.min(1.2, this.shake + 0.5); }
    else this.hud.killBanner(victim.name, n);
  }

  // What's underfoot (for footstep sounds).
  surfaceAt(c) {
    const ch = this.map.charAt(c.pos.x, c.pos.z);
    if (ch === ',') return 'wood';
    if (c.pos.y > 0.3 && /[12^v<>]/.test(ch)) return this.map.def.theme === 'snow' || this.map.def.theme === 'neon' ? 'metal' : 'stone';
    if (c.pos.y > 0.3) return 'wood';   // standing on crates
    return { neon: 'wet', desert: 'sand', snow: 'snow', jungle: 'grass', canals: 'stone' }[this.map.def.theme] || 'stone';
  }

  // floating damage number above the victim
  popDamage(victim, amount, kind) {
    const p = new THREE.Vector3(victim.pos.x, victim.pos.y + 1.9 - 0.5 * victim.crouch, victim.pos.z).project(this.camera);
    if (p.z > 1) return;
    this.hud.damageNumber((p.x + 1) / 2 * window.innerWidth, (1 - p.y) / 2 * window.innerHeight, amount, kind);
  }

  startDeathCam(killer, weapon) {
    this.deathCam = killer && killer !== this.player ? { killer, t: 3, from: this.camera.position.clone(), weapon } : null;
  }

  // World-only ray (no characters). Returns { t, axis, sign, box }.
  traceWorld(o, d, maxT) {
    let bestT = maxT, axis = -1, sign = 0, box = null;
    for (const b of this.map.boxes) {
      if (b.noShot) continue;
      const t = rayAABB(o.x, o.y, o.z, d.x, d.y, d.z, b, bestT);
      if (t >= 0 && t < bestT) { bestT = t; axis = rayHit.axis; sign = rayHit.sign; box = b; }
    }
    if (d.y < 0 && this.map.charAt(o.x + d.x * (-o.y / d.y), o.z + d.z * (-o.y / d.y)) !== '~') {
      const t = -o.y / d.y;
      if (t < bestT) { bestT = t; axis = 1; sign = 1; box = null; }
    }
    return { t: bestT, axis, sign, box };
  }

  trace(shooter, o, d, maxT) {
    const w = this.traceWorld(o, d, maxT);
    let bestT = w.t;
    let entity = null, part = null;
    for (const e of this.combatants) {
      if (!e.alive || e.team === shooter.team) continue;
      const ex = e.pos.x - o.x, ez = e.pos.z - o.z;
      if (ex * d.x + ez * d.z < -1) continue;
      hitboxes(e, _hb);
      for (const b of _hb) {
        const t = rayAABB(o.x, o.y, o.z, d.x, d.y, d.z, b, bestT);
        if (t >= 0 && t < bestT) { bestT = t; entity = e; part = b.part; }
      }
    }
    const point = new THREE.Vector3(o.x + d.x * bestT, o.y + d.y * bestT, o.z + d.z * bestT);
    _n.set(0, 0, 0);
    if (!entity && w.axis >= 0) _n.setComponent(w.axis, w.sign);
    return { t: bestT, point, normal: _n.clone(), entity, part, box: entity ? null : w.box };
  }

  // Line of sight: world geometry, ability walls and smokes all block vision.
  canSee(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    const ix = dx / len, iy = dy / len, iz = dz / len;
    for (const b of this.map.boxes) {
      if (b.noShot) continue;
      const t = rayAABB(from.x, from.y, from.z, ix, iy, iz, b, len);
      if (t >= 0 && t < len - 0.05) return false;
    }
    return !this.abilities.smokeBlocks(from, to);
  }

  applyDamage(victim, attacker, dmg, part, weaponName, dir) {
    if (!victim.alive) return;
    let d = dmg;
    if (victim.armor > 0) {
      const a = Math.min(victim.armor, d);
      victim.armor -= a;
      d -= a;
    }
    victim.health -= d;
    const killed = victim.health <= 0;
    this.emit({ e: 'dmg', v: victim.id, a: attacker.id, hd: part === 'head' ? 1 : 0, k: killed ? 1 : 0, s: dir ? 1 : 0, n: Math.round(dmg) });
    victim.hitT = 0.22;
    if (attacker !== victim && attacker.team !== victim.team) {
      this.creditAssist(victim, attacker, 15);
      attacker.dmgDealt = (attacker.dmgDealt || 0) + Math.min(dmg, victim.health + d);
      if (dir) { attacker.hitsLanded = (attacker.hitsLanded || 0) + 1; if (part === 'head') attacker.headHits = (attacker.headHits || 0) + 1; }
    }
    if (this.practice && attacker.isPlayer && dir) { this.practice.hits++; if (part === 'head') this.practice.heads++; if (killed) this.practice.kills++; }
    if (attacker.isPlayer && dir) this.popDamage(victim, dmg, killed ? 'kill' : part === 'head' ? 'head' : '');
    if (victim.isPlayer && dir) this.shake = Math.min(1, this.shake + dmg / 120);

    if (attacker.isPlayer) {
      this.hud.hitmarker(killed ? 'kill' : part === 'head' ? 'head' : 'hit');
      if (dir) this.sound.hit(part === 'head');
    }
    if (victim.isPlayer) {
      const ang = wrapAngle(yawTo(attacker.pos.x - victim.pos.x, attacker.pos.z - victim.pos.z) - victim.yaw);
      this.hud.damageFrom(-ang);
      if (dir) { this.sound.hurt(); this.punch.pitch += 0.02; }
      victim.action = null;
    } else if (!victim.human) {
      this.brain.hear(victim, attacker.pos, 2);
      if (victim.ai && !victim.ai.target) {
        victim.ai.lastKnown = attacker.pos.clone();
        victim.ai.lostT = 0;
      }
    }
    if (dir) { victim.vel.x *= 0.5; victim.vel.z *= 0.5; }

    if (killed) this.kill(victim, attacker, weaponName, part === 'head');
  }

  kill(victim, killer, weaponName, head) {
    victim.alive = false;
    victim.health = 0;
    victim.deaths++;
    victim.action = null;
    victim.scoped = false;
    victim.deadT = 0;
    this.addUlt(victim, 1);
    // assists: teammates of the killer who damaged, flashed or revealed the victim recently
    const assisters = [];
    for (const [id, until] of victim.assistBy) {
      const a = this.byId[id];
      if (!a || a === killer || until < this.time || (killer && a.team !== killer.team) || a.team === victim.team) continue;
      a.assists++;
      a.credits = Math.min(MAX_CREDITS, a.credits + 50);
      assisters.push(a);
      if (a.isPlayer) this.onPlayerAssist(victim);
    }
    victim.assistBy.clear();
    if (killer && killer !== victim && killer.team !== victim.team) {
      killer.roundKills = (killer.roundKills || 0) + 1;
      if (killer.isPlayer) this.onPlayerKill(victim, killer.roundKills);
      killer.kills++;
      killer.credits = Math.min(MAX_CREDITS, killer.credits + 200);
      this.addUlt(killer, 1);
      if (killer.overdriveT > 0) killer.health = Math.min(100, killer.health + 40);

    }
    if (victim.hasCore) {
      victim.hasCore = false;
      this.core.state = 'dropped';
      this.core.pos.set(victim.pos.x, Math.max(0, victim.pos.y), victim.pos.z);
      this.core.mesh.visible = true;
      this.core.carrier = null;
    }
    this.emit({ e: 'k', v: victim.id, k: killer ? killer.id : -1, w: weaponName, h: head ? 1 : 0, as: assisters.map((a) => a.id) });
    this.hud.killfeed(killer, victim, weaponName, head, assisters);
    if (victim.isPlayer) {
      this.startDeathCam(killer, weaponName);
      this.hud.message('YOU DIED', '', 'loss', 2.5);
      this.hud.scope(false);
    }
  }

  // ---- objective --------------------------------------------------------------

  updateActions(dt) {
    const core = this.core;
    let playerProgress = null;
    for (const c of this.combatants) {
      if (!c.alive) { c.action = null; continue; }
      const wants = c.isPlayer ? this.input.keys.has('Digit4') && !this.buyOpen && !this.paused : c.isRemote ? c.remoteAct : c.ai?.wantAction;
      let type = null;
      if (this.phase === 'live' && wants && c.onGround) {
        const side = this.sideOf(c.team);
        if (side === 'ATK' && c.hasCore && core.state === 'carried' && this.map.siteAt(c.pos.x, c.pos.z)) type = 'plant';
        else if (side === 'DEF' && core.state === 'planted' &&
          Math.hypot(core.pos.x - c.pos.x, core.pos.z - c.pos.z) < 1.8) type = 'defuse';
      }
      if (!type) { c.action = null; continue; }
      if (!c.action || c.action.type !== type) {
        c.action = { type, t: 0 };
        if (c.isPlayer) this.sound.action();
      }
      c.action.t += dt;
      c.vel.x = 0; c.vel.z = 0;
      const need = type === 'plant' ? PLANT_TIME : DEFUSE_TIME;
      if (c.isPlayer) playerProgress = [type === 'plant' ? 'PLANTING CORE' : 'DEFUSING CORE', c.action.t / need];
      if (c.action.t >= need) {
        this.addUlt(c, 1);
        if (type === 'plant') this.plantCore(c);
        else this.defuseCore(c);
        c.action = null;
      }
    }
    if (playerProgress) this.hud.progress(playerProgress[0], playerProgress[1]);
    else this.hud.progress('', null);

    const p = this.player;
    let hint = '';
    if (p.alive && this.phase === 'live') {
      if (p.hasCore && this.map.siteAt(p.pos.x, p.pos.z) && !p.action) hint = 'Hold 4 to plant the Core';
      else if (this.sideOf(p.team) === 'DEF' && core.state === 'planted' && !p.action &&
        Math.hypot(core.pos.x - p.pos.x, core.pos.z - p.pos.z) < 1.8) hint = 'Hold 4 to defuse';
    }
    this.hud.hint(hint || this.tipHint());
  }

  // Short how-to-play hints during the first few matches.
  tipHint() {
    if (!this.tips || !this.player.alive || this.practice) return '';
    if (this.phase === 'buy') return 'TIP: press B to buy guns & abilities · Q E F use abilities · X ultimate';
    if (this.phase === 'live' && this.phaseT > 85) {
      return this.sideOf(this.playerTeam) === 'ATK'
        ? 'TIP: take the Core ◆ to site A or B and hold 4 to plant · Shift = walk quietly'
        : 'TIP: stop the plant at A or B — if they plant, hold 4 on the Core to defuse';
    }
    return '';
  }

  plantCore(c) {
    const core = this.core;
    c.hasCore = false;
    core.state = 'planted';
    core.site = this.map.siteAt(c.pos.x, c.pos.z);
    core.pos.set(c.pos.x, c.pos.y, c.pos.z);
    core.timer = CORE_TIME;
    core.beepT = 0;
    core.mesh.visible = true;
    for (const o of this.combatants) {
      if (this.sideOf(o.team) === 'ATK') o.credits = Math.min(MAX_CREDITS, o.credits + 300);
      if (o.ai) { o.ai.postPlantSpot = null; o.ai.goalKey = ''; }
    }
    this.emit({ e: 'pl', site: core.site });
    this.plantMessage(core.site);
  }

  plantMessage(site) {
    const mine = this.sideOf(this.playerTeam) === 'ATK';
    this.hud.message('CORE PLANTED', `Site ${site}`, mine ? 'win' : 'loss', 2.5);
    this.sound.announce(mine);
  }

  defuseCore() {
    this.core.state = 'defused';
    this.endRound('DEF', 'defuse');
  }

  updateCore(dt) {
    const core = this.core;
    const parts = core.parts;
    parts.crystal.rotation.y += dt * 2;
    parts.ring.rotation.z += dt * 1.5;

    if (core.state === 'carried' && core.carrier && !core.carrier.alive) core.state = 'dropped';
    if (core.state === 'dropped') {
      core.mesh.position.copy(core.pos);
      if (this.phase !== 'end') {
        for (const c of this.combatants) {
          if (!c.alive || this.sideOf(c.team) !== 'ATK') continue;
          if (Math.hypot(c.pos.x - core.pos.x, c.pos.z - core.pos.z) < 1.2 && Math.abs(c.pos.y - core.pos.y) < 1.5) {
            c.hasCore = true;
            core.state = 'carried';
            core.carrier = c;
            core.mesh.visible = false;
            if (c.isPlayer) this.hud.message('', 'You picked up the Core', '', 1.5);
            break;
          }
        }
      }
    }
    if (core.state === 'planted') {
      core.mesh.position.copy(core.pos);
      if (this.phase === 'end') return;
      core.timer -= dt;
      const urgent = core.timer < 10;
      parts.glowMat.color.setHex(Math.floor(this.time * (urgent ? 8 : 3)) % 2 ? 0xff3b5c : 0xff9aa9);
      core.beepT -= dt;
      if (core.beepT <= 0) {
        core.beepT = 0.12 + 0.88 * Math.max(0, core.timer / CORE_TIME);
        this.sound.beep(core.pos, urgent);
      }
      if (core.timer <= 0) this.detonate();
    }
  }

  detonate() {
    const core = this.core;
    core.state = 'exploded';
    core.mesh.visible = false;
    this.effects.explosion(_p.set(core.pos.x, 1, core.pos.z));
    this.sound.explosion(core.pos);
    this.shake = Math.min(1.5, this.shake + Math.max(0.2, 1.5 - this.camera.position.distanceTo(core.pos) / 40));
    this.emit({ e: 'boom', p: [core.pos.x, core.pos.y, core.pos.z] });
    for (const c of this.combatants) {
      if (!c.alive) continue;
      const d = c.pos.distanceTo(core.pos);
      if (d < 20) {
        c.health -= d < 11 ? 999 : 300 * (1 - (d - 11) / 9);
        if (c.health <= 0) this.kill(c, null, 'Core', false);
      }
    }
    this.endRound('ATK', 'detonate');
  }

  checkElimination() {
    if (this.phase !== 'live') return;
    let atk = 0, def = 0;
    for (const c of this.combatants) {
      if (!c.alive) continue;
      if (this.sideOf(c.team) === 'ATK') atk++; else def++;
    }
    if (def === 0) this.endRound('ATK', 'elim');
    else if (atk === 0 && this.core.state !== 'planted') this.endRound('DEF', 'elim');
  }

  updateSpotting() {
    this.spotT = (this.spotT || 0) - 1;
    if (this.spotT > 0) return;
    this.spotT = 6;
    for (const p of this.combatants) {
      if (!p.human || !p.alive || p.blind > 0) continue;
      _o.set(p.pos.x, p.pos.y + p.eyeHeight, p.pos.z);
      for (const e of this.combatants) {
        if (e.team === p.team || !e.alive) continue;
        const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
        if (Math.abs(wrapAngle(yawTo(dx, dz) - p.yaw)) > 1.0) continue;
        _p.set(e.pos.x, e.pos.y + 1.3 - 0.45 * e.crouch, e.pos.z);
        if (this.canSee(_o, _p)) e.spotBy[p.team] = this.time + 0.6;
      }
    }
    if (!this.defAlert && this.phase === 'live') {
      const defTeam = 1 - this.attackTeam;
      for (const e of this.combatants) {
        if (!e.alive || e.team !== this.attackTeam) continue;
        const site = this.map.siteAt(e.pos.x, e.pos.z);
        if (!site) continue;
        const seen = this.combatants.some((d) => d.alive && d.team === defTeam && d.ai?.target === e);
        if (seen) { this.defAlert = { site, time: this.time }; break; }
      }
    }
  }

  // ---- visuals ------------------------------------------------------------

  updateModels(dt) {
    for (const c of this.combatants) {
      const m = c.model;
      if (!m) continue;
      if (!c.alive) {
        c.deadT += dt;
        animateCharacter(m, { dead: true, deadT: c.deadT }, dt);
        if (c.marker) c.marker.visible = false;
        continue;
      }
      m.root.position.copy(c.pos);
      m.root.rotation.y = c.yaw;
      setCharacterGun(m, c.weapon.def.id, c.skins);
      animateCharacter(m, {
        speed: Math.hypot(c.vel.x, c.vel.z), vx: c.vel.x, vz: c.vel.z, yaw: c.yaw,
        crouch: c.crouch, pitch: c.pitch, walking: c.walking,
        action: !!c.action, onGround: c.onGround, hit: c.hitT > 0 ? c.hitT / 0.22 : 0,
        swing: c.swingT > 0 ? c.swingT : 0, swingSide: c.swingSide || 1,
      }, dt);
      if (c.swingT > 0) c.swingT -= dt;
      if (c.hitT > 0) c.hitT -= dt;
      if (c.marker) {
        const show = c.revealUntil > this.time;
        c.marker.visible = show;
        if (show) c.marker.position.set(c.pos.x, c.pos.y + 2.25, c.pos.z);
      }
    }
  }

  render() {
    const p = this.player;
    const dt = this.dtLast;
    this.punch.pitch *= Math.exp(-dt * 9);
    this.punch.yaw *= Math.exp(-dt * 9);
    this.fovKick *= Math.exp(-dt * 6);

    let viewer = p;
    const aliveView = p.alive;
    if (!p.alive && this.spectating) viewer = this.spectating;
    const dc = !p.alive && this.deathCam && this.deathCam.t > 0 ? this.deathCam : null;
    if (dc) dc.t -= dt;
    if (dc && dc.killer) {
      // death cam: drift up and back from where you died, looking at whoever got you
      const k = dc.killer, age = 3 - dc.t;
      const target = new THREE.Vector3(k.pos.x, k.pos.y + 1.4, k.pos.z);
      const from = dc.from.clone();
      const back = from.clone().sub(target).setY(0).normalize();
      this.camera.position.copy(from).addScaledVector(back, Math.min(1.5, age * 1.2)).add(new THREE.Vector3(0, Math.min(1.2, age), 0));
      this.camera.lookAt(target);
      this.hud.deathCam(`KILLED BY ${k.name.toUpperCase()} · ${dc.weapon || ''} · ${Math.max(0, Math.ceil(k.health))} HP left`);
    } else if (!p.alive && !this.spectating) {
      this.camera.position.set(0, 50, this.map.H * 1.8);
      this.camera.rotation.set(-0.95, 0, 0);
    } else {
      this.camera.position.set(viewer.pos.x, viewer.pos.y + viewer.eyeHeight, viewer.pos.z);
      let rp = 0, ry = 0;
      if (aliveView) {
        const w = p.weapon;
        const rec = recoilOffset(w.def, w.spray);
        rp = rec.pitch * 0.45 + this.punch.pitch;
        ry = rec.yaw * 0.45 + this.punch.yaw;
      }
      // screen shake
      const sh = this.shake * this.shake * 0.03;
      this.camera.rotation.set(viewer.pitch + rp + (Math.random() - 0.5) * sh, viewer.yaw + ry + (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh * 0.5);
    }
    if (!dc) this.hud.deathCam('');
    this.shake *= Math.exp(-dt * 7);
    this.muzzleLight.intensity *= Math.exp(-dt * 30);
    // low health: pulsing red edges + heartbeat
    if (aliveView && p.health < 35) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
      this.hud.lowHealth((0.35 + 0.35 * pulse) * (1 - p.health / 35) + 0.15);
      this.beatT = (this.beatT || 0) - dt;
      if (this.beatT <= 0) { this.beatT = 0.6 + p.health / 60; this.sound.heartbeat(); }
    } else this.hud.lowHealth(0);
    for (const c of this.combatants) if (c.model) c.model.root.visible = c !== this.spectating;

    const scoped = aliveView && p.scoped;
    const fov = (scoped ? p.weapon.def.zoomFov : this.baseFov) + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.hud.scope(scoped);

    this.sound.setListener(this.camera.position.x, this.camera.position.z, this.camera.rotation.y);

    const showCross = aliveView && !scoped && !this.buyOpen;
    if (showCross) {
      const w = p.weapon;
      const spread = w.def.melee ? 0 : this.spreadFor(p);
      const px = spread / Math.tan((this.camera.fov * Math.PI / 180) / 2) * (window.innerHeight / 2);
      this.hud.crosshair(3 + px, true);
    } else this.hud.crosshair(0, false);

    const watched = p.alive ? p : this.spectating;
    this.hud.flash(watched ? Math.min(1, watched.blind / 0.9) : 0);
    this.hud.overdrive(watched?.overdriveT > 0);
    this.hud.inSmoke(this.abilities.inSmoke(this.camera.position));

    if (this.player.alive || dc) this.hud.spectate('');
    else if (this.spectating) this.hud.spectate(`Spectating ${this.spectating.name} (${this.spectating.agent.name}) · click to switch`);
    else this.hud.spectate('Waiting for next round');

    const w = p.weapon;
    this.viewmodel.update(dt, {
      speed: Math.hypot(p.vel.x, p.vel.z),
      side: p.vel.x * Math.cos(p.yaw) - p.vel.z * Math.sin(p.yaw),
      walking: p.walking || p.crouch > 0.5,
      onGround: p.onGround,
      lookDx: this.lookDx, lookDy: this.lookDy,
      reload: w.reloadT > 0 ? 1 - w.reloadT / w.def.reload : -1,
      visible: aliveView && !scoped,
      crouch: p.crouch,
      action: !!p.action,
    });
    const vfov = Math.min(this.baseFov, 80);
    if (this.viewmodel.camera.fov !== vfov) { this.viewmodel.camera.fov = vfov; this.viewmodel.camera.updateProjectionMatrix(); }

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);
  }

  frame(dt) {
    this.dtLast = dt;
    this.update(dt);
    if (this.running) {
      this.render();
      this.hud.update(dt);
      this.hud.scoreboard(this.input.keys.has('Tab') && !this.paused);
    }
  }

  toggleBuy(on) {
    if (on && ((this.phase !== 'buy' && !this.practice) || !this.player.alive)) { this.sound.deny(); return; }
    this.buyOpen = on;
    this.hud.showBuy(on);
  }

  // Renders a 3D portrait of an agent into a 2D canvas (agent select cards).
  renderPortrait(agent, cv, w = 180, h = 240) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10151d);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-2, 3, -3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(agent.accent, 2.5);
    rim.position.set(2, 2, 3);
    scene.add(rim);
    const m = buildCharacter(agent, ALLY_LIGHT);
    setCharacterGun(m, 'talon');
    animateCharacter(m, { speed: 0, crouch: 0, pitch: -0.05, onGround: true }, 0);
    m.root.rotation.y = -0.4;
    scene.add(m.root);
    const cam = new THREE.PerspectiveCamera(26, w / h, 0.1, 20);
    cam.position.set(0.25, 1.55, -2.35);
    cam.lookAt(0, 1.3, 0);
    const r = this.renderer, pr = r.getPixelRatio();
    r.setScissorTest(true);
    r.setViewport(0, 0, w, h);
    r.setScissor(0, 0, w, h);
    r.clear();
    r.render(scene, cam);
    r.setScissorTest(false);
    r.setViewport(0, 0, window.innerWidth, window.innerHeight);
    cv.width = Math.round(w * pr); cv.height = Math.round(h * pr);
    const src = r.domElement;
    cv.getContext('2d').drawImage(src, 0, src.height - cv.height, cv.width, cv.height, 0, 0, cv.width, cv.height);
  }

  // Renders a weapon (with skin) into a 2D canvas for the Locker.
  renderGunPreview(id, skin, model, cv, w = 420, h = 240, angle = 0.35) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x161b24);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 3, 2); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ac8ff, 1.2); rim.position.set(-2, 1, -2); scene.add(rim);
    const { group } = buildGun(id, skin, model);
    group.rotation.y = -Math.PI / 2 + angle;
    scene.add(group);
    const box = new THREE.Box3().setFromObject(group), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const cam = new THREE.PerspectiveCamera(28, w / h, 0.01, 50);
    const dist = Math.max(size.x / (w / h), size.y, size.z / (w / h)) * 2.3 + 0.08;
    cam.position.set(c.x + 0.05, c.y + 0.08, c.z + dist);
    cam.lookAt(c);
    const r = this.renderer, pr = r.getPixelRatio();
    r.setScissorTest(true);
    r.setViewport(0, 0, w, h); r.setScissor(0, 0, w, h);
    r.clear(); r.render(scene, cam);
    r.setScissorTest(false);
    r.setViewport(0, 0, window.innerWidth, window.innerHeight);
    cv.width = Math.round(w * pr); cv.height = Math.round(h * pr);
    const src = r.domElement;
    cv.getContext('2d').drawImage(src, 0, src.height - cv.height, cv.width, cv.height, 0, 0, cv.width, cv.height);
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }

  // ---- lobby: a stage just outside the current map, you in the middle, two invite pads ----

  buildLobby(agent, held) {
    if (this.lobby && this.lobby.scene === this.scene && this.lobby.agentId === agent.id && this.lobby.heldKey === held.key) return;
    if (this.lobby && this.lobby.scene === this.scene) this.scene.remove(this.lobby.group);
    const group = new THREE.Group();
    const S = new THREE.Vector3(0, 11, this.map.H * 1.5 + 9);
    group.position.copy(S);
    const accent = new THREE.Color(agent.accent);
    // three pads
    const pads = [];
    for (const [i, x, z] of [[0, 0, 0], [1, -2.4, 0.9], [2, 2.4, 0.9]]) {
      const pad = new THREE.Group();
      pad.position.set(x, 0, z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.22, 40), new THREE.MeshPhongMaterial({ color: 0x1b2230, shininess: 80 }));
      base.position.y = 0.11;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.035, 8, 48), new THREE.MeshBasicMaterial({ color: i === 0 ? accent : 0x5a6a80 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.23;
      const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshBasicMaterial({ color: i === 0 ? accent : 0x3a4a60, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      glowDisc.rotation.x = -Math.PI / 2; glowDisc.position.y = 0.225;
      pad.add(base, ring, glowDisc);
      if (i > 0) {
        // empty slot: a glowing + hologram
        const plus = new THREE.Group();
        const pm = new THREE.MeshBasicMaterial({ color: 0x9ab8e0, transparent: true, opacity: 0.55 });
        plus.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.12), pm), new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), pm));
        plus.position.y = 1.2;
        pad.add(plus);
        pad.userData.plus = plus;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 2.6, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x6a8ab8, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
        beam.position.y = 1.5;
        pad.add(beam);
      }
      group.add(pad);
      pads.push(pad);
    }
    // backing arc + floor glow
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.6, 48), new THREE.MeshPhongMaterial({ color: 0x141a24, shininess: 60 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01;
    group.add(floor);
    // floating island underneath
    const under = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 1.2, 3.2, 40), new THREE.MeshPhongMaterial({ color: 0x232b38, shininess: 30 }));
    under.position.y = -1.6;
    group.add(under);
    const rimGlow = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.05, 8, 80), new THREE.MeshBasicMaterial({ color: accent }));
    rimGlow.rotation.x = Math.PI / 2; rimGlow.position.y = -0.02;
    group.add(rimGlow);
    const arcM = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.06, 8, 64, Math.PI), new THREE.MeshBasicMaterial({ color: accent }));
    arcM.rotation.x = -Math.PI / 2; arcM.rotation.z = Math.PI; arcM.position.set(0, 0.03, 0.3);
    group.add(arcM);
    const key = new THREE.PointLight(0xffffff, 30, 14, 1.6); key.position.set(1.5, 3.5, 4); group.add(key);
    const rim = new THREE.PointLight(accent.getHex(), 25, 10, 1.6); rim.position.set(-1.5, 2.5, -2); group.add(rim);
    // the player
    const model = buildCharacter(agent, ALLY_LIGHT, false);
    setCharacterGun(model, held.weapon, { [held.weapon]: held });
    model.root.position.set(0, 0.22, 0);
    model.root.rotation.y = Math.PI;
    pads[0].add(model.root);
    this.scene.add(group);
    this.lobby = { scene: this.scene, group, pads, model, agentId: agent.id, heldKey: held.key, S, t: 0, friends: [null, null], friendKeys: ['', ''] };
    if (this.lobbyFriends) this.setLobbyFriends(this.lobbyFriends);
  }

  // Party members standing on the side pads: [{ agent, held }, ...] (up to 2).
  setLobbyFriends(list) {
    this.lobbyFriends = list;
    const L = this.lobby;
    if (!L) return;
    for (let i = 0; i < 2; i++) {
      const f = list[i];
      const key = f ? `${f.agent.id}|${f.held?.key || ''}` : '';
      if (L.friendKeys[i] === key) continue;
      const pad = L.pads[i + 1];
      if (L.friends[i]) { pad.remove(L.friends[i].root); L.friends[i] = null; }
      L.friendKeys[i] = key;
      for (const ch of pad.children) if (ch !== pad.children[0] && ch !== pad.children[1] && ch !== pad.children[2]) ch.visible = !f;
      if (!f) continue;
      const model = buildCharacter(f.agent, ALLY_LIGHT, false);
      const held = f.held || { weapon: 'talon', skin: 'factory' };
      setCharacterGun(model, held.weapon, { [held.weapon]: held });
      model.root.position.set(0, 0.22, 0);
      model.root.rotation.y = Math.PI;
      model.phaseOffset = i * 1.7 + 1;
      pad.add(model.root);
      L.friends[i] = model;
    }
  }

  // Renders the lobby; returns screen positions of the three name tags.
  renderLobby(t, dt) {
    const L = this.lobby;
    if (!L) return null;
    L.t += dt;
    const S = L.S;
    // gentle camera drift
    const cx = Math.sin(L.t * 0.25) * 0.35;
    this.camera.fov = 38; this.camera.updateProjectionMatrix();
    this.camera.position.set(S.x + cx, S.y + 1.55, S.z + 6.4);
    this.camera.lookAt(S.x, S.y + 1.35, S.z);
    // idle animation: breathing, weight shift, gun held low, occasional look around
    const look = Math.sin(L.t * 0.35) * 0.25 + Math.sin(L.t * 1.3) * 0.04;
    L.model.root.rotation.y = Math.PI + look;
    animateCharacter(L.model, { speed: 0, vx: 0, vz: 0, yaw: Math.PI + look, crouch: 0, pitch: -0.45, onGround: true }, dt);
    for (const pad of L.pads) if (pad.userData.plus) { pad.userData.plus.rotation.y += dt * 1.2; pad.userData.plus.position.y = 1.2 + Math.sin(L.t * 2) * 0.06; }
    L.friends.forEach((f, i) => {
      if (!f) return;
      const lk = Math.sin(L.t * 0.3 + f.phaseOffset) * 0.3 + (i ? -0.15 : 0.15);
      f.root.rotation.y = Math.PI + lk;
      animateCharacter(f, { speed: 0, vx: 0, vz: 0, yaw: Math.PI + lk, crouch: 0, pitch: -0.45, onGround: true }, dt);
    });
    this.map.update(dt);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    const out = [];
    const w = window.innerWidth, h = window.innerHeight;
    for (const pad of L.pads) {
      const p = pad.getWorldPosition(new THREE.Vector3());
      p.y += pad === L.pads[0] ? 2.2 : 2.25;
      p.project(this.camera);
      out.push({ x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h });
    }
    return out;
  }

  // Slow orbit over the map behind the menus.
  renderIdle(t, dt) {
    const a = t * 0.05;
    this.camera.fov = 60; this.camera.updateProjectionMatrix();
    this.camera.position.set(Math.sin(a) * 55, 34, Math.cos(a) * 45);
    this.camera.lookAt(0, 0, 0);
    this.map.update(dt);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  finishMatch() {
    this.sound.stopAmbient();
    if (this.isHost) { this.emit({ e: 'fin' }); this.sendSnapshot(); }
    this.running = false;
    this.paused = true;
    const won = this.score[this.playerTeam] > this.score[1 - this.playerTeam];
    if (this.onMatchEnd) this.onMatchEnd(won, this.score[this.playerTeam], this.score[1 - this.playerTeam], this.player);
  }

  stop() {
    this.sound.stopAmbient();
    this.running = false;
    this.paused = true;
    this.buyOpen = false;
    this.hud.showBuy(false);
  }
}

export { ABILITY_INFO };

function disposeScene(scene) {
  scene.traverse((o) => {
    if (o.geometry && !o.geometry.parameters) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.map && m.map.isCanvasTexture) m.map.dispose();
      if (m.emissiveMap && m.emissiveMap.isCanvasTexture) m.emissiveMap.dispose();
    }
  });
}

// Builds a match roster: the given humans plus bots so each team has TEAM_SIZE players.
export function makeRoster(humans) {
  const names = shuffle(NAMES.filter((n) => !humans.some((h) => h.name === n)));
  const roster = [];
  let cid = 0;
  for (const team of [0, 1]) {
    const hs = humans.filter((h) => h.team === team).slice(0, TEAM_SIZE);
    const used = new Set(hs.map((h) => h.agent));
    const pool = shuffle(AGENTS.filter((a) => !used.has(a.id)));
    for (const h of hs) roster.push({ cid: cid++, name: h.name, agent: h.agent, team, human: h.human, skins: h.skins || {} });
    for (let i = hs.length; i < TEAM_SIZE; i++) {
      const agent = (pool.pop() || choice(AGENTS)).id;
      const skins = {};
      for (const w of LOCKER_WEAPONS) skins[w] = randomBotSkin(w);
      roster.push({ cid: cid++, name: names.pop() || `Bot${cid}`, agent, team, human: null, skins });
    }
  }
  return roster;
}

Object.assign(Game.prototype, NetMixin);

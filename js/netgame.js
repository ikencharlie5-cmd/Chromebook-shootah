import * as THREE from '../lib/three.module.min.js?v=20261031055456';
import { makeWeaponState } from './weapons.js?v=20261031055456';
import { applyMovement } from './entities.js?v=20261031055456';
import { wrapAngle, yawTo } from './util.js?v=20261031055456';

// Multiplayer glue mixed into Game.
//   Host: simulates the whole match (bots + every player), applies remote players' inputs,
//         and broadcasts a snapshot + events 20 times a second.
//   Client: moves and aims its own player locally (instant response), predicts its own shots,
//           sends inputs 30 times a second, and draws everyone else from snapshots.

const SNAP_RATE = 1 / 20;
const INPUT_RATE = 1 / 30;
const SLOTS = ['primary', 'secondary', 'melee'];
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const _v = new THREE.Vector3();

export const NetMixin = {
  // ---------------------------------------------------------------- host ----

  netTick(dt) {
    this.snapT -= dt;
    if (this.snapT > 0) return;
    this.snapT = SNAP_RATE;
    this.sendSnapshot();
  },

  sendSnapshot() {
    if (!this.net?.isHost) return;
    const core = this.core;
    const snap = {
      t: 's', ht: r3(this.time),
      ph: this.phase, pt: r2(this.phaseT), rd: this.round, sc: this.score, at: this.attackTeam,
      co: { st: core.state, p: [r2(core.pos.x), r2(core.pos.y), r2(core.pos.z)], tm: r2(core.timer || 0), si: core.site, ca: core.carrier ? core.carrier.id : -1 },
      cs: this.combatants.map((c) => {
        const w = c.weapon;
        return {
          i: c.id, p: [r2(c.pos.x), r2(c.pos.y), r2(c.pos.z)], y: r3(c.yaw), pi: r3(c.pitch), cr: r2(c.crouch),
          v: [r2(c.vel.x), r2(c.vel.z)], g: c.onGround ? 1 : 0, a: c.alive ? 1 : 0, wk: c.walking ? 1 : 0,
          h: Math.ceil(c.health), ar: Math.ceil(c.armor), sl: SLOTS.indexOf(c.slot),
          pr: c.inv.primary?.def.id || '', se: c.inv.secondary?.def.id || '',
          mg: w?.mag ?? 0, rs: w?.reserve ?? 0,
          cd: c.credits, k: c.kills, d: c.deaths, hc: c.hasCore ? 1 : 0, bl: r2(c.blind), od: c.overdriveT > 0 ? 1 : 0,
          ac: c.action ? [c.action.type === 'plant' ? 1 : 2, r2(c.action.t)] : 0,
          ch: [c.charges.q, c.charges.e, c.charges.f], u: c.ult,
          sp: [c.spotBy[0] > this.time ? 1 : 0, c.spotBy[1] > this.time ? 1 : 0], rv: c.revealUntil > this.time ? 1 : 0,
          tp: c.tp, so: c.scoped ? 1 : 0, dd: Math.round(c.dmgDealt || 0), hl: c.hitsLanded || 0, hh: c.headHits || 0,
        };
      }),
      ab: this.abilities.netState(),
      ev: this.netEvents,
    };
    this.netEvents = [];
    this.net.send(snap);
  },

  // Host: remember recent positions so shots can be checked against what the shooter saw.
  recordHistory() {
    for (const c of this.combatants) {
      const h = c.hist || (c.hist = []);
      h.push({ t: this.time, x: c.pos.x, y: c.pos.y, z: c.pos.z, cr: c.crouch });
      while (h.length && this.time - h[0].t > 0.6) h.shift();
    }
  },

  // Temporarily move everyone (except the shooter) back to time t; returns a restore function.
  rewindTo(t, shooter) {
    const saved = [];
    t = Math.max(t, this.time - 0.35);    // cap compensation at 350ms
    for (const c of this.combatants) {
      if (c === shooter || !c.alive || !c.hist?.length) continue;
      const h = c.hist;
      let a = h[0], b = h[h.length - 1];
      for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t) { a = h[i]; b = h[Math.min(i + 1, h.length - 1)]; break; }
      const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
      saved.push([c, c.pos.x, c.pos.y, c.pos.z, c.crouch]);
      c.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      c.crouch = a.cr + (b.cr - a.cr) * k;
    }
    return () => { for (const [c, x, y, z, cr] of saved) { c.pos.set(x, y, z); c.crouch = cr; } };
  },

  // A client's input packet.
  onRemoteInput(from, m) {
    const c = this.combatants?.find((x) => x.human === from && x.isRemote);
    if (!c || !this.running) return;
    for (const id of (m.buys || []).slice(0, 10)) this.buyFor(c, String(id));
    if (!c.alive) return;
    if (m.tp === c.tp && Array.isArray(m.p)) {
      c.pos.set(+m.p[0] || 0, +m.p[1] || 0, +m.p[2] || 0);
      if (Array.isArray(m.v)) c.vel.set(+m.v[0] || 0, +m.v[1] || 0, +m.v[2] || 0);
      c.onGround = !!m.og;
    }
    c.yaw = +m.yaw || 0; c.pitch = +m.pitch || 0;
    c.crouching = !!m.cr; c.walking = !!m.wk; c.scoped = !!m.sc;
    c.remoteAct = !!m.act;
    if (SLOTS.includes(m.sl) && m.sl !== c.slot && c.inv[m.sl]) this.switchSlot(c, m.sl, true);
    if (m.rl) this.startReload(c);
    for (const s of (m.shots || []).slice(0, 20)) {
      const restore = typeof s.ht === 'number' ? this.rewindTo(s.ht, c) : null;
      this.remoteShoot(c, s);
      restore?.();
    }
    for (const k of (m.casts || []).slice(0, 4)) if (['q', 'e', 'f', 'x'].includes(k)) this.abilities.cast(c, k);
  },

  // A player disconnected mid-match: a bot takes over their character.
  onMemberLeft(id) {
    if (!this.running) return;
    const c = this.combatants.find((x) => x.human === id);
    if (!c) return;
    c.human = null; c.isRemote = false;
    c.name += ' (bot)';
    const side = this.sideOf(c.team);
    this.brain.initRound(c, side === 'ATK'
      ? { kind: 'attack', site: this.attackSite || 'A', route: this.map.routes[this.attackSite || 'A'][0] }
      : { kind: 'hold', area: 'A' });
    this.hud.message('', `${c.name.replace(' (bot)', '')} left — a bot took over`, '', 2.5);
  },

  // -------------------------------------------------------------- client ----

  updateClient(dt) {
    this.time += dt;
    this.phaseT = Math.max(0, this.phaseT - dt);
    const p = this.player;

    this.updatePlayer(dt);
    if (p.alive) { this.updateWeapon(p, dt); if (p.blind > 0) p.blind = Math.max(0, p.blind - dt); }

    // smooth everyone else toward their latest snapshot
    const k = 1 - Math.exp(-dt * 15);
    for (const c of this.combatants) {
      if (c === p || !c.net) continue;
      c.pos.x += (c.net.x - c.pos.x) * k;
      c.pos.y += (c.net.y - c.pos.y) * k;
      c.pos.z += (c.net.z - c.pos.z) * k;
      c.yaw = wrapAngle(c.yaw + wrapAngle(c.net.yaw - c.yaw) * k);
      c.pitch += (c.net.pitch - c.pitch) * k;
    }

    this.abilities.updateVisual(dt);
    this.updateCoreVisual(dt);

    // objective progress + hints come from the host
    if (p.action) this.hud.progress(p.action.type === 'plant' ? 'PLANTING CORE' : 'DEFUSING CORE', p.action.t / (p.action.type === 'plant' ? 4 : 7));
    else this.hud.progress('', null);
    let hint = '';
    if (p.alive && this.phase === 'live' && !p.action) {
      if (p.hasCore && this.map.siteAt(p.pos.x, p.pos.z)) hint = 'Hold 4 to plant the Core';
      else if (this.sideOf(p.team) === 'DEF' && this.core.state === 'planted' && Math.hypot(this.core.pos.x - p.pos.x, this.core.pos.z - p.pos.z) < 1.8) hint = 'Hold 4 to defuse';
    }
    this.hud.hint(hint || this.tipHint());

    this.updateModels(dt);
    this.effects.update(dt);
    this.map.update(dt);

    this.inT -= dt;
    if (this.inT <= 0) { this.inT = INPUT_RATE; this.sendInput(); }
  },

  sendInput() {
    const p = this.player, o = this.out;
    this.net.send({
      t: 'in', tp: p.tp,
      p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], v: [r2(p.vel.x), r2(p.vel.y), r2(p.vel.z)], og: p.onGround ? 1 : 0,
      yaw: r3(p.yaw), pitch: r3(p.pitch), cr: p.crouching ? 1 : 0, wk: p.walking ? 1 : 0, sc: p.scoped ? 1 : 0,
      sl: p.slot, act: this.input.keys.has('Digit4') && !this.buyOpen && !this.paused ? 1 : 0, rl: o.rl ? 1 : 0,
      shots: o.shots, casts: o.casts, buys: o.buys,
    });
    this.out = { shots: [], casts: [], buys: [], rl: false };
  },

  // Client ability key: send it, and predict what we can (animation, dash movement).
  clientCast(key) {
    const p = this.player, kit = p.agent.kit[key];
    const ok = p.alive && !p.action && this.phase === 'live' && (key === 'x' ? p.ult >= kit.cost : p.charges[key] > 0);
    if (!ok) { this.sound.deny(); return; }
    this.out.casts.push(key);
    this.viewmodel.cast(this.abilities.colorOf(p, kit.type));
    p.castT = 0.5;
    if (key !== 'x') p.charges[key]--;
    if (kit.type === 'dash') {
      let wx = p.moveX || 0, wz = p.moveZ || 0;
      if (Math.hypot(wx, wz) < 0.1) { wx = -Math.sin(p.yaw); wz = -Math.cos(p.yaw); }
      const l = Math.hypot(wx, wz);
      p.vel.x = wx / l * 17; p.vel.z = wz / l * 17; p.vel.y = Math.max(p.vel.y, 1.5);
      p.dashT = 0.2;
      this.fovKick = 12;
    }
  },

  applySnapshot(s) {
    if (!this.isClient || !this.running) return;
    this.phase = s.ph; this.phaseT = s.pt; this.round = s.rd; this.score = s.sc; this.attackTeam = s.at;
    this.hostTime = s.ht; this.hostTimeAt = this.time;
    this.map.barriers.visible = s.ph === 'buy';
    if (this.buyOpen && s.ph !== 'buy') { this.toggleBuy(false); this.onBuyAutoClose?.(); }

    const core = this.core;
    core.state = s.co.st; core.pos.set(...s.co.p); core.timer = s.co.tm; core.site = s.co.si;
    core.carrier = this.byId[s.co.ca] || null;
    core.mesh.visible = core.state === 'dropped' || core.state === 'planted';

    const p = this.player;
    for (const o of s.cs) {
      const c = this.byId[o.i];
      if (!c) continue;
      const wasAlive = c.alive;
      c.alive = !!o.a;
      if (wasAlive && !c.alive) { c.deadT = 0; if (c === p) { this.hud.scope(false); p.scoped = false; } }
      c.health = o.h; c.armor = o.ar; c.credits = o.cd; c.kills = o.k; c.deaths = o.d; c.hasCore = !!o.hc;
      c.dmgDealt = o.dd; c.hitsLanded = o.hl; c.headHits = o.hh;
      c.overdriveT = o.od ? 1 : 0;
      c.action = o.ac ? { type: o.ac[0] === 1 ? 'plant' : 'defuse', t: o.ac[1] } : null;
      c.spotBy[this.playerTeam] = o.sp[this.playerTeam] ? this.time + 0.3 : 0;
      c.revealUntil = o.rv ? this.time + 0.3 : 0;
      const invKey = `${o.pr}|${o.se}`;
      if (c === p) {
        const ultBefore = p.ult;
        p.charges.q = o.ch[0]; p.charges.e = o.ch[1]; p.charges.f = o.ch[2]; p.ult = o.u;
        if (ultBefore < p.agent.kit.x.cost && p.ult >= p.agent.kit.x.cost) this.hud.message('', 'ULTIMATE READY — press X', 'warn', 2);
        p.blind = Math.max(p.blind, o.bl);
        if (o.tp !== p.tp) {
          // round start (or first snapshot): host placed us
          p.tp = o.tp;
          p.pos.set(...o.p); p.vel.set(0, 0, 0); p.yaw = o.y; p.pitch = 0;
          this.rebuildInv(p, o, true);
          p.slot = SLOTS[o.sl] || 'secondary';
          this.viewmodel.setWeapon(p.weapon.def.id, 0.3);
        } else if (invKey !== p.invKey) {
          const hadPrimary = p.inv.primary?.def.id;
          this.rebuildInv(p, o, false);
          if (o.pr && o.pr !== hadPrimary) this.switchSlot(p, 'primary', true);
          else if (!p.inv[p.slot]) this.switchSlot(p, p.bestSlot(), true);
        }
        if (this.buyOpen) this.hud.refreshBuyMenu();
      } else {
        c.net = { x: o.p[0], y: o.p[1], z: o.p[2], yaw: o.y, pitch: o.pi };
        if (o.tp !== c.tp || !wasAlive && c.alive) { c.tp = o.tp; c.pos.set(...o.p); c.yaw = o.y; }
        c.crouch = o.cr; c.vel.x = o.v[0]; c.vel.z = o.v[1]; c.onGround = !!o.g; c.walking = !!o.wk; c.scoped = !!o.so;
        if (invKey !== c.invKey) this.rebuildInv(c, o, false);
        c.slot = SLOTS[o.sl] || 'secondary';
        if (!c.inv[c.slot]) c.slot = c.bestSlot();
      }
    }
    this.abilities.applyNetState(s.ab);
    for (const ev of s.ev || []) this.handleEvent(ev);
  },

  rebuildInv(c, o, full) {
    const keep = (slot, id) => (id ? (!full && c.inv[slot]?.def.id === id ? c.inv[slot] : makeWeaponState(id)) : null);
    c.inv.primary = keep('primary', o.pr);
    c.inv.secondary = keep('secondary', o.se) || (c.inv.secondary && !o.se ? null : c.inv.secondary);
    if (!c.inv.melee) c.inv.melee = makeWeaponState('knife');
    c.invKey = `${o.pr}|${o.se}`;
  },

  handleEvent(ev) {
    const p = this.player;
    const C = (id) => this.byId[id];
    switch (ev.e) {
      case 'sh': {
        const c = C(ev.c);
        if (!c || c === p) return;   // our own shots were already drawn
        const muzzle = this.muzzleOf(c);
        if (ev.m) { this.sound.knife(c.pos); return; }
        if (c.model?.flash) this.effects.muzzleFlash(c.model.flash);
        const def = c.inv.primary?.def.id === ev.w ? c.inv.primary.def : c.inv.secondary?.def.id === ev.w ? c.inv.secondary.def : null;
        this.sound.shot(def?.sound || 'rifle', c.pos);
        ev.pts.forEach((pt, k) => {
          _v.set(pt[0], pt[1], pt[2]);
          if (k < 3) this.effects.tracer(muzzle, _v);
          if (pt[3] === 1) this.effects.blood(_v.clone(), _v.clone().sub(muzzle).normalize());
          else if (pt[3] === 0) this.effects.impact(_v.clone(), new THREE.Vector3(pt[4], pt[5], pt[6]));
        });
        return;
      }
      case 'dmg': {
        const v = C(ev.v), a = C(ev.a);
        if (v) v.hitT = 0.22;
        if (a === p && v) {
          this.hud.hitmarker(ev.k ? 'kill' : ev.hd ? 'head' : 'hit');
          if (ev.s) { this.sound.hit(!!ev.hd); this.popDamage(v, ev.n || 0, ev.k ? 'kill' : ev.hd ? 'head' : ''); }
        }
        if (v === p && a) {
          this.hud.damageFrom(-wrapAngle(yawTo(a.pos.x - p.pos.x, a.pos.z - p.pos.z) - p.yaw));
          if (ev.s) { this.sound.hurt(); this.punch.pitch += 0.02; this.shake = Math.min(1, this.shake + (ev.n || 20) / 120); }
        }
        return;
      }
      case 'k': {
        const v = C(ev.v), k = C(ev.k);
        if (!v) return;
        this.hud.killfeed(k || null, v, ev.w, !!ev.h);
        if (k === p && v.team !== p.team) {
          this.sound.kill();
          p.roundKills = (p.roundKills || 0) + 1;
          this.hud.killBanner(v.name, p.roundKills);
          this.sound.streak(p.roundKills);
        }
        if (v === p) {
          this.startDeathCam(k, ev.w);
          this.hud.message('YOU DIED', '', 'loss', 2.5);
        }
        return;
      }
      case 'rs':
        p.roundKills = 0;
        this.deathCam = null;
        this.effects.clear();
        this.spectating = null;
        this.roundStartMessage(ev.swap);
        return;
      case 'go': this.hud.message('GO', '', 'warn', 1.2); return;
      case 'end': this.roundEndMessage(ev.win, ev.reason); return;
      case 'pl': this.plantMessage(ev.site); return;
      case 'boom':
        this.shake = Math.min(1.5, this.shake + 1);
        this.effects.explosion(new THREE.Vector3(ev.p[0], 1, ev.p[2]));
        this.sound.explosion(new THREE.Vector3(...ev.p));
        return;
      case 'ring':
        this.abilities.ring(new THREE.Vector3(...ev.p), ev.c, ev.r, ev.d, true);
        return;
      case 'sfx': {
        const mine = ev.c === p.id || ev.w === p.id;
        this.sound[ev.k]?.(mine || !ev.p ? null : new THREE.Vector3(...ev.p));
        return;
      }
      case 'msg':
        if (ev.team === this.playerTeam) this.hud.message('', ev.sub, 'win', 1.6);
        return;
      case 'fin':
        this.finishMatch();
        return;
    }
  },

  updateCoreVisual(dt) {
    const core = this.core, parts = core.parts;
    parts.crystal.rotation.y += dt * 2;
    parts.ring.rotation.z += dt * 1.5;
    core.mesh.position.copy(core.pos);
    if (core.state !== 'planted' || this.phase === 'end') return;
    core.timer = Math.max(0, core.timer - dt);
    const urgent = core.timer < 10;
    parts.glowMat.color.setHex(Math.floor(this.time * (urgent ? 8 : 3)) % 2 ? 0xff3b5c : 0xff9aa9);
    core.beepT = (core.beepT || 0) - dt;
    if (core.beepT <= 0) { core.beepT = 0.12 + 0.88 * Math.max(0, core.timer / 40); this.sound.beep(core.pos, urgent); }
  },
};

void applyMovement;

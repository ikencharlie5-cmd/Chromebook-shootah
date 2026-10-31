import * as THREE from '../lib/three.module.min.js?v=20261031171146';
import { rayAABB, rayHit, dirFromAngles, wrapAngle, yawTo } from './util.js?v=20261031171146';

const GRAV = 14;
const SMOKE_R = 4.3;
const SMOKE_TIME = 14;
const FIRE_TIME = 7;
const WALL_TIME = 25;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const projGeo = new THREE.IcosahedronGeometry(0.11, 1);
const smokeGeo = new THREE.IcosahedronGeometry(1, 2);
const flameGeo = new THREE.ConeGeometry(0.35, 1, 6);
const ringGeo = new THREE.TorusGeometry(1, 0.06, 6, 40);

const COLORS = { smoke: 0xb8bcc8, flash: 0xffffff, molly: 0xff7a2a, recon: 0x4ff3ff };

export class Abilities {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.projectiles = [];
    this.smokes = [];
    this.fires = [];
    this.walls = [];
    this.darts = [];
    this.fx = [];
    this.timers = [];
    this.nextId = 1;
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flameMat2 = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    this.scorchMat = new THREE.MeshBasicMaterial({ color: 0x2a0c04, transparent: true, opacity: 0.6, depthWrite: false });
  }

  // Remove everything (round start).
  reset() {
    for (const list of [this.projectiles, this.smokes, this.fires, this.walls, this.darts, this.fx]) {
      for (const o of list) if (o.mesh) this.scene.remove(o.mesh);
      list.length = 0;
    }
    this.game.map.boxes = this.game.map.boxes.filter((b) => b.kind !== 'ability');
    this.timers.length = 0;
  }

  // ---- casting ------------------------------------------------------------

  canCast(c, key) {
    const kit = c.agent.kit[key];
    if (!kit || !c.alive || c.action) return false;
    if (this.game.phase !== 'live') return false;
    if (key === 'x') return c.ult >= kit.cost;
    return c.charges[key] > 0;
  }

  // target: optional world point (bots aim abilities at points; players use their crosshair)
  cast(c, key, target = null) {
    if (!this.canCast(c, key)) return false;
    const kit = c.agent.kit[key];
    const ok = this.perform(c, kit.type, target);
    if (!ok) return false;
    if (key === 'x') c.ult = 0; else c.charges[key]--;
    if (c.isPlayer) this.game.viewmodel.cast(this.colorOf(c, kit.type));
    c.castT = 0.5;
    return true;
  }

  colorOf(c, type) {
    return { smoke: c.agent.accent, flash: 0xffffff, molly: 0xff7a2a, recon: c.agent.accent, heal: 0x5dffb0, wall: c.agent.accent, dash: c.agent.accent }[type] ?? c.agent.accent;
  }

  // Play a sound locally and tell clients. `caster` hears it non-positionally (it's their own).
  sfx(name, pos, caster, who = null) {
    const g = this.game;
    const mine = caster?.isPlayer || who?.isPlayer;
    g.sound[name]?.(mine ? null : pos);
    const p = pos || caster?.pos;
    g.emit?.({ e: 'sfx', k: name, p: p ? [p.x, p.y, p.z] : null, c: caster ? caster.id : -1, w: who ? who.id : -1 });
  }

  eye(c, out) { return out.set(c.pos.x, c.pos.y + c.eyeHeight, c.pos.z); }

  // Where the crosshair is pointing, capped at maxDist; backs off walls a little.
  aimPoint(c, maxDist) {
    const o = this.eye(c, new THREE.Vector3());
    const d = dirFromAngles(c.yaw, c.pitch, new THREE.Vector3());
    const hit = this.game.traceWorld(o, d, maxDist);
    const p = o.clone().addScaledVector(d, hit.t);
    if (hit.axis === 0 || hit.axis === 2) p.addScaledVector(d, -0.8);
    if (hit.axis < 0 || hit.t >= maxDist) {
      // nothing hit: drop to the ground below the far point
      p.y = this.groundAt(p.x, p.z);
    }
    return p;
  }

  groundAt(x, z) {
    return this.game.map.heightAt(x, z);
  }

  handPos(c) {
    const p = this.eye(c, new THREE.Vector3());
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    p.x += -sy * 0.4 - cy * 0.15; p.z += -cy * 0.4 + sy * 0.15; p.y -= 0.15;
    return p;
  }

  perform(c, type, target) {
    const g = this.game, snd = g.sound;
    switch (type) {
      case 'smoke': {
        const t = target ? target.clone() : this.aimPoint(c, 45);
        this.lob(c, 'smoke', t, Math.min(1.3, Math.max(0.35, this.handPos(c).distanceTo(t) / 26)));
        this.sfx('throw', c.pos, c);
        return true;
      }
      case 'flash':
      case 'molly':
      case 'recon': {
        if (target) {
          const aimAt = type === 'flash' ? target.clone().add(new THREE.Vector3(0, 2.2, 0)) : target.clone();
          this.lob(c, type, aimAt, type === 'recon' ? 0.5 : 0.65, true);
        } else {
          const d = dirFromAngles(c.yaw, c.pitch, new THREE.Vector3());
          const speed = { flash: 21, molly: 16, recon: 40 }[type];
          const vel = d.multiplyScalar(speed);
          vel.y += type === 'recon' ? 1 : 3.5;
          this.spawnProjectile(c, type, this.handPos(c), vel);
        }
        this.sfx('throw', c.pos, c);
        return true;
      }
      case 'dash': {
        let wx = c.wx || 0, wz = c.wz || 0;
        if (c.isPlayer) { wx = c.moveX || 0; wz = c.moveZ || 0; }
        if (Math.hypot(wx, wz) < 0.1) { wx = -Math.sin(c.yaw); wz = -Math.cos(c.yaw); }
        const l = Math.hypot(wx, wz);
        c.vel.x = wx / l * 17; c.vel.z = wz / l * 17;
        c.vel.y = Math.max(c.vel.y, 1.5);
        c.dashT = 0.2;
        this.sfx('dash', c.pos, c);
        if (c.isPlayer) g.fovKick = 12;
        return true;
      }
      case 'heal': {
        const who = this.allyInCrosshair(c) || c;
        if (who.health >= 100 && who === c) return false;
        who.healT = 4;
        this.sfx('heal', c.pos, c, who);
        g.effects.burst(_a.set(who.pos.x, who.pos.y + 1.2, who.pos.z), _b.set(0, 1, 0), 'heal', 12, 2);
        return true;
      }
      case 'wall': {
        let p = this.aimPoint(c, 14);
        const flat = Math.hypot(p.x - c.pos.x, p.z - c.pos.z);
        if (flat < 3) {
          p = c.pos.clone();
          p.x -= Math.sin(c.yaw) * 3; p.z -= Math.cos(c.yaw) * 3;
        }
        p.y = this.groundAt(p.x, p.z);
        const alongX = Math.abs(Math.cos(c.yaw)) >= Math.abs(Math.sin(c.yaw));
        this.createWall(c, p, alongX);
        this.sfx('wall', c.pos, c);
        return true;
      }
      case 'smokeline': {
        const d = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
        const o = new THREE.Vector3(c.pos.x, c.pos.y + 1.5, c.pos.z);
        const max = this.game.traceWorld(o, d, 40).t;
        let n = 0;
        for (let i = 0; i < 4; i++) {
          const dist = 5 + i * 7;
          if (dist > max - 1) break;
          const t = o.clone().addScaledVector(d, dist);
          t.y = this.groundAt(t.x, t.z);
          this.lob(c, 'smoke', t, 0.4 + i * 0.15);
          n++;
        }
        if (!n) {
          const t = o.clone().addScaledVector(d, Math.max(1, max - 1.5));
          t.y = 0;
          this.lob(c, 'smoke', t, 0.3);
        }
        this.sfx('ult', c.pos, c);
        return true;
      }
      case 'teamheal':
        for (const o of g.combatants) {
          if (!o.alive || o.team !== c.team) continue;
          o.health = 100;
          o.armor = Math.max(o.armor, 50);
          g.effects.burst(_a.set(o.pos.x, o.pos.y + 1.2, o.pos.z), _b.set(0, 1, 0), 'heal', 18, 3);
        }
        this.sfx('ult', null, null);
        if (c.team === g.playerTeam) g.hud.message('', `${c.isPlayer ? 'You' : c.name} healed the team`, 'win', 1.6);
        g.emit?.({ e: 'msg', team: c.team, sub: `${c.name} healed the team` });
        return true;
      case 'reveal':
        for (let i = 0; i < 3; i++) {
          this.timers.push({ t: i * 2, fn: () => {
            for (const e of g.combatants) if (e.alive && e.team !== c.team) this.reveal(e, c.team, 1.6, c);
            this.sfx('recon', null, null);
          } });
        }
        this.sfx('ult', null, null);
        return true;
      case 'inferno': {
        const p = target ? target.clone() : this.aimPoint(c, 35);
        p.y = this.groundAt(p.x, p.z);
        this.createFire(c, p, 6.5, 9, 60);
        this.sfx('ult', c.pos, c);
        return true;
      }
      case 'overdrive':
        c.overdriveT = 10;
        this.sfx('ult', c.pos, c);
        return true;
      case 'blackout': {
        const eye = this.eye(c, new THREE.Vector3());
        for (const e of g.combatants) {
          if (!e.alive || e.team === c.team) continue;
          const ee = this.eye(e, new THREE.Vector3());
          if (ee.distanceTo(eye) < 40 && g.canSee(ee, eye)) this.blind(e, 3.2, c);
        }
        this.ring(eye, 0xffffff, 40, 0.7);
        this.sfx('flash', c.pos, c);
        this.sfx('ult', null, null);
        return true;
      }
    }
    return false;
  }

  allyInCrosshair(c) {
    const d = dirFromAngles(c.yaw, c.pitch, new THREE.Vector3());
    const eye = this.eye(c, new THREE.Vector3());
    let best = null, bestAng = 0.15;
    for (const o of this.game.combatants) {
      if (o === c || !o.alive || o.team !== c.team) continue;
      _a.set(o.pos.x, o.pos.y + 1.2, o.pos.z).sub(eye);
      const dist = _a.length();
      if (dist > 14) continue;
      const ang = Math.acos(Math.min(1, _a.normalize().dot(d)));
      if (ang < bestAng && this.game.canSee(eye, _b.set(o.pos.x, o.pos.y + 1.2, o.pos.z))) { best = o; bestAng = ang; }
    }
    return best && best.health < 100 ? best : null;
  }

  // ---- projectiles ----------------------------------------------------------

  spawnProjectile(c, type, pos, vel) {
    const mesh = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: this.colorOf(c, type) }));
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.projectiles.push({ id: this.nextId++, color: this.colorOf(c, type), type, owner: c, pos: pos.clone(), vel, mesh, t: 0, fuse: type === 'flash' ? 0.7 : type === 'molly' ? 2.5 : 3, lob: null });
  }

  // Ballistic throw that lands exactly on `target` after `flight` seconds (used for smokes and by bots).
  lob(c, type, target, flight, physicsAfter = false) {
    const start = this.handPos(c);
    const v = target.clone().sub(start).multiplyScalar(1 / flight);
    v.y += 0.5 * GRAV * flight;
    const mesh = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: this.colorOf(c, type) }));
    mesh.position.copy(start);
    this.scene.add(mesh);
    this.projectiles.push({ id: this.nextId++, color: this.colorOf(c, type), type, owner: c, pos: start.clone(), vel: v, mesh, t: 0, fuse: type === 'flash' ? flight + 0.05 : 3, lob: physicsAfter ? null : { start, v, flight, target: target.clone() } });
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      let done = false;
      if (p.lob) {
        const { start, v, flight } = p.lob;
        const t = Math.min(p.t, flight);
        p.pos.set(start.x + v.x * t, start.y + v.y * t - 0.5 * GRAV * t * t, start.z + v.z * t);
        if (p.t >= flight) { this.detonate(p, p.lob.target, 1); done = true; }
      } else if (!p.stuck) {
        p.vel.y -= GRAV * (p.type === 'recon' ? 0.4 : 1) * dt;
        const len = p.vel.length() * dt;
        _d.copy(p.vel).normalize();
        let bestT = len, axis = -1, sign = 0;
        for (const b of this.game.map.boxes) {
          if (b.noShot) continue;
          const t = rayAABB(p.pos.x, p.pos.y, p.pos.z, _d.x, _d.y, _d.z, b, bestT);
          if (t >= 0 && t < bestT) { bestT = t; axis = rayHit.axis; sign = rayHit.sign; }
        }
        const overWater = this.game.map.charAt(p.pos.x, p.pos.z) === '~';
        if (!overWater && _d.y < 0) {
          const t = -p.pos.y / _d.y;
          if (t >= 0 && t < bestT) { bestT = t; axis = 1; sign = 1; }
        }
        if (axis >= 0) {
          p.pos.addScaledVector(_d, Math.max(0, bestT - 0.02));
          if (p.type === 'recon') { p.stuck = true; p.normal = new THREE.Vector3().setComponent(axis, sign); this.startDart(p); done = true; }
          else if (p.type === 'molly' && axis === 1 && sign > 0) { this.detonate(p, p.pos, 1); done = true; }
          else {
            const comps = ['x', 'y', 'z'];
            p.vel[comps[axis]] *= -0.4;
            for (let k = 0; k < 3; k++) if (k !== axis) p.vel[comps[k]] *= 0.7;
            this.sfx('bounce', p.pos, null);
          }
        } else p.pos.addScaledVector(_d, len);
        if (p.pos.y < -1.5) { this.scene.remove(p.mesh); this.projectiles.splice(i, 1); continue; }
        if (!done && p.t >= p.fuse) {
          if (p.type === 'molly') { p.pos.y = this.groundAt(p.pos.x, p.pos.z); }
          this.detonate(p, p.pos, 1);
          done = true;
        }
      }
      p.mesh.position.copy(p.pos);
      if (done) { this.scene.remove(p.mesh); this.projectiles.splice(i, 1); }
    }
  }

  detonate(p, pos) {
    const snd = this.game.sound;
    switch (p.type) {
      case 'smoke': this.createSmoke(p.owner, pos); this.sfx('smoke', pos, null); break;
      case 'flash': this.popFlash(p.owner, pos); break;
      case 'molly':
        if (this.game.map.charAt(pos.x, pos.z) === '~') return;
        this.createFire(p.owner, pos.clone(), 3.6, FIRE_TIME, 45);
        break;
      case 'recon': this.startDart({ ...p, pos: pos.clone(), normal: new THREE.Vector3(0, 1, 0) }); break;
    }
  }

  // ---- smoke ------------------------------------------------------------------

  createSmoke(owner, pos) {
    const group = this.smokeMesh(owner.agent.accent);
    const center = new THREE.Vector3(pos.x, pos.y + 1.2, pos.z);
    group.position.copy(center);
    group.scale.setScalar(0.2);
    this.smokes.push({ id: this.nextId++, color: owner.agent.accent, mesh: group, center, r: SMOKE_R, t: SMOKE_TIME, age: 0, scale: 0.2 });
  }

  smokeMesh(accent) {
    const color = new THREE.Color(0xaeb3be).lerp(new THREE.Color(accent), 0.22);
    const group = new THREE.Group();
    const core = new THREE.Mesh(smokeGeo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
    core.scale.setScalar(SMOKE_R);
    group.add(core);
    const puffMat = new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(1.08), transparent: true, opacity: 0.93, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(smokeGeo, puffMat);
      const a = i / 7 * Math.PI * 2;
      m.position.set(Math.cos(a) * 2.6, (i % 3) * 0.9 - 0.6, Math.sin(a) * 2.6);
      m.scale.setScalar(1.9 + (i % 2) * 0.5);
      group.add(m);
    }
    this.scene.add(group);
    return group;
  }

  // Does any smoke block the segment a→b?
  smokeBlocks(a, b) {
    for (const s of this.smokes) {
      const r = s.r * s.scale;
      if (r < 1) continue;
      const c = s.center;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len2 = dx * dx + dy * dy + dz * dz;
      let t = ((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / (len2 || 1);
      t = Math.max(0, Math.min(1, t));
      const px = a.x + dx * t - c.x, py = a.y + dy * t - c.y, pz = a.z + dz * t - c.z;
      if (px * px + py * py + pz * pz < r * r) return true;
    }
    return false;
  }

  inSmoke(p) {
    for (const s of this.smokes) {
      const r = s.r * s.scale;
      if (p.distanceToSquared(s.center) < r * r) return true;
    }
    return false;
  }

  // ---- flash ------------------------------------------------------------------

  popFlash(owner, pos) {
    const g = this.game;
    this.sfx('flash', pos, null);
    this.ring(pos, 0xffffff, 4, 0.25);
    for (const c of g.combatants) {
      // flashes only affect the thrower's enemies
      if (!c.alive || c.team === owner.team) continue;
      const eye = this.eye(c, _a);
      const dist = eye.distanceTo(pos);
      if (dist > 45 || !g.canSee(eye, pos)) continue;
      _b.copy(pos).sub(eye).normalize();
      dirFromAngles(c.yaw, c.pitch, _d);
      const facing = _d.dot(_b);
      let dur = facing > 0.55 ? 2.3 : facing > 0.1 ? 1.3 : facing > -0.3 ? 0.5 : 0;
      dur *= dist > 25 ? 0.7 : 1;
      if (dur > 0) this.blind(c, dur, owner);
    }
  }

  blind(c, dur, by = null) {
    if (dur <= 0) return;
    if (by) this.game.creditAssist(c, by, 4 + dur);
    c.blind = Math.max(c.blind, dur);
    c.blindMax = Math.max(c.blind, c.blindMax || 0);
    if (c.ai) { c.ai.target = null; c.ai.reactT = 0.6; }
  }

  // ---- fire -------------------------------------------------------------------

  createFire(owner, pos, r, time, dps) {
    const { mesh, flames } = this.fireMesh(pos, r);
    this.fires.push({ id: this.nextId++, mesh, flames, pos: pos.clone(), r, t: time, dps, owner, tick: 0 });
    this.sfx('fire', pos, null);
  }

  fireMesh(pos, r) {
    const group = new THREE.Group();
    group.position.copy(pos);
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(r, 24), this.scorchMat);
    scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.04;
    group.add(scorch);
    const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 24), new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    glowDisc.rotation.x = -Math.PI / 2; glowDisc.position.y = 0.06;
    group.add(glowDisc);
    const flames = [];
    const n = Math.round(r * r * 1.6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r * 0.92;
      const f = new THREE.Mesh(flameGeo, i % 3 ? this.flameMat : this.flameMat2);
      f.position.set(Math.cos(a) * d, 0.5, Math.sin(a) * d);
      f.userData.phase = Math.random() * 10;
      group.add(f);
      flames.push(f);
    }
    this.scene.add(group);
    return { mesh: group, flames };
  }

  inFire(c) {
    for (const f of this.fires) {
      if (f.owner.team === c.team) continue;
      if (Math.hypot(c.pos.x - f.pos.x, c.pos.z - f.pos.z) < f.r && Math.abs(c.pos.y - f.pos.y) < 1.5) return f;
    }
    return null;
  }

  // ---- recon ------------------------------------------------------------------

  startDart(p) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 6), new THREE.MeshBasicMaterial({ color: p.owner.agent.accent }));
    mesh.position.copy(p.pos);
    if (p.normal) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.normal);
    this.scene.add(mesh);
    const pos = p.pos.clone().addScaledVector(p.normal || new THREE.Vector3(0, 1, 0), 0.25);
    const dart = { id: this.nextId++, mesh, pos, owner: p.owner, pulses: [0.3, 2.0], t: 0, life: 3 };
    this.darts.push(dart);
  }

  reconPulse(d) {
    const g = this.game;
    this.sfx('recon', d.pos, null);
    this.ring(d.pos, d.owner.agent.accent, 28, 0.6);
    for (const e of g.combatants) {
      if (!e.alive || e.team === d.owner.team) continue;
      _a.set(e.pos.x, e.pos.y + 1.2, e.pos.z);
      if (_a.distanceTo(d.pos) < 28 && g.canSee(d.pos, _a)) this.reveal(e, d.owner.team, 2.2, d.owner);
    }
  }

  reveal(e, byTeam, dur, by = null) {
    const g = this.game;
    if (by) g.creditAssist(e, by, 6);
    e.revealUntil = Math.max(e.revealUntil || 0, g.time + dur);
    e.spotBy[byTeam] = Math.max(e.spotBy[byTeam], g.time + dur);
    for (const o of g.combatants) {
      if (!o.ai || !o.alive || o.team !== byTeam || o.ai.target) continue;
      o.ai.lastKnown = e.pos.clone();
      o.ai.lostT = 0;
    }
  }

  // ---- walls ------------------------------------------------------------------

  createWall(owner, p, alongX) {
    const len = 7, h = 3.4, th = 0.5;
    const box = alongX
      ? { minX: p.x - len / 2, maxX: p.x + len / 2, minZ: p.z - th / 2, maxZ: p.z + th / 2 }
      : { minX: p.x - th / 2, maxX: p.x + th / 2, minZ: p.z - len / 2, maxZ: p.z + len / 2 };
    box.minY = p.y; box.maxY = p.y + h; box.kind = 'ability'; box.hp = 500;
    const mesh = this.wallMesh(box, owner.agent.accent);
    box.wall = { id: this.nextId++, mesh, t: WALL_TIME, owner, grow: 0 };
    this.walls.push(box.wall);
    box.wall.box = box;
    this.game.map.boxes.push(box);
  }

  wallMesh(box, accent) {
    const h = box.maxY - box.minY;
    const color = new THREE.Color(accent);
    const geo = new THREE.BoxGeometry(box.maxX - box.minX, h, box.maxZ - box.minZ);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.55), emissive: color, emissiveIntensity: 0.25, transparent: true, opacity: 0.82 }));
    mesh.position.set((box.minX + box.maxX) / 2, box.minY + h / 2, (box.minZ + box.maxZ) / 2);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color }));
    mesh.add(edges);
    mesh.scale.y = 0.05;
    this.scene.add(mesh);
    return mesh;
  }

  damageWall(box, dmg) {
    box.hp -= dmg;
    if (box.hp <= 0) this.removeWall(box.wall);
    else box.wall.mesh.material.opacity = 0.4 + 0.42 * box.hp / 500;
  }

  removeWall(w) {
    this.scene.remove(w.mesh);
    const i = this.walls.indexOf(w);
    if (i >= 0) this.walls.splice(i, 1);
    const boxes = this.game.map.boxes;
    const j = boxes.indexOf(w.box);
    if (j >= 0) boxes.splice(j, 1);
    this.game.effects.burst(w.mesh.position, _b.set(0, 1, 0), 'spark', 14, 5);
  }

  // ---- misc fx ----------------------------------------------------------------

  ring(pos, color, radius, dur, local = false) {
    if (!local) this.game.emit?.({ e: 'ring', p: [pos.x, pos.y, pos.z], c: color, r: radius, d: dur });
    const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.position.copy(pos);
    mesh.rotation.x = Math.PI / 2;
    this.scene.add(mesh);
    this.fx.push({ mesh, t: 0, dur, radius });
  }

  // ---- per-frame ----------------------------------------------------------------

  update(dt) {
    const g = this.game;
    this.updateProjectiles(dt);

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { t.fn(); this.timers.splice(i, 1); }
    }

    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t -= dt; s.age += dt;
      s.scale = Math.min(1, 0.2 + s.age * 1.6);
      if (s.t < 1.2) s.scale = Math.max(0, s.t / 1.2);
      s.mesh.scale.setScalar(Math.max(0.001, s.scale));
      s.mesh.rotation.y += dt * 0.05;
      if (s.t <= 0) { this.scene.remove(s.mesh); this.smokes.splice(i, 1); }
    }

    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      const fade = Math.min(1, f.t / 0.8);
      for (const fl of f.flames) {
        const k = fl.userData.phase += dt * 9;
        const s = (0.7 + Math.sin(k) * 0.3 + Math.sin(k * 2.3) * 0.15) * fade;
        fl.scale.set(s, s * (1.2 + Math.sin(k * 1.7) * 0.4), s);
        fl.position.y = fl.scale.y * 0.5;
      }
      f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = 0.25;
        for (const c of g.combatants) {
          if (!c.alive || c.team === f.owner.team) continue;
          if (Math.hypot(c.pos.x - f.pos.x, c.pos.z - f.pos.z) < f.r && Math.abs(c.pos.y - f.pos.y) < 1.5) {
            g.applyDamage(c, f.owner, f.dps * 0.25, 'body', f.r > 5 ? 'Inferno' : 'Incendiary', null);
          }
        }
      }
      if (f.t <= 0) { this.scene.remove(f.mesh); this.fires.splice(i, 1); }
    }

    for (let i = this.darts.length - 1; i >= 0; i--) {
      const d = this.darts[i];
      d.t += dt;
      while (d.pulses.length && d.t >= d.pulses[0]) { d.pulses.shift(); this.reconPulse(d); }
      if (d.t >= d.life) { this.scene.remove(d.mesh); this.darts.splice(i, 1); }
    }

    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i];
      w.t -= dt;
      w.grow = Math.min(1, w.grow + dt * 4);
      w.mesh.scale.y = Math.max(0.05, w.grow);
      if (w.t <= 0) this.removeWall(w);
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const k = f.t / f.dur;
      f.mesh.scale.setScalar(0.5 + k * f.radius);
      f.mesh.material.opacity = 0.9 * (1 - k);
      if (k >= 1) { this.scene.remove(f.mesh); this.fx.splice(i, 1); }
    }
  }

  // ---- network sync --------------------------------------------------------------

  // Host: compact state of every live ability object.
  netState() {
    const r = (v) => Math.round(v * 100) / 100;
    return {
      pr: this.projectiles.map((p) => [p.id, r(p.pos.x), r(p.pos.y), r(p.pos.z), p.color]),
      sm: this.smokes.map((s) => [s.id, r(s.center.x), r(s.center.y), r(s.center.z), r(s.scale), s.color]),
      fi: this.fires.map((f) => [f.id, r(f.pos.x), r(f.pos.y), r(f.pos.z), r(f.r), r(f.t)]),
      wa: this.walls.map((w) => [w.id, r(w.box.minX), r(w.box.minY), r(w.box.minZ), r(w.box.maxX), r(w.box.maxY), r(w.box.maxZ), w.owner.agent.accent]),
      da: this.darts.map((d) => [d.id, r(d.pos.x), r(d.pos.y), r(d.pos.z), d.owner.agent.accent]),
    };
  }

  // Client: create / move / remove visuals to match the host.
  applyNetState(st) {
    const sync = (list, rows, make, upd, remove) => {
      const seen = new Set();
      for (const row of rows) {
        seen.add(row[0]);
        let o = list.find((x) => x.id === row[0]);
        if (!o) { o = make(row); o.id = row[0]; list.push(o); }
        upd(o, row);
      }
      for (let i = list.length - 1; i >= 0; i--) if (!seen.has(list[i].id)) { remove(list[i]); list.splice(i, 1); }
    };
    const rm = (o) => this.scene.remove(o.mesh);
    sync(this.projectiles, st.pr || [], (row) => {
      const mesh = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: row[4] }));
      this.scene.add(mesh);
      return { mesh, pos: new THREE.Vector3() };
    }, (o, row) => { o.pos.set(row[1], row[2], row[3]); o.mesh.position.copy(o.pos); }, rm);
    sync(this.smokes, st.sm || [], (row) => {
      const mesh = this.smokeMesh(row[5]);
      return { mesh, center: new THREE.Vector3(row[1], row[2], row[3]), r: SMOKE_R, scale: row[4] };
    }, (o, row) => { o.scale = row[4]; o.mesh.position.copy(o.center); o.mesh.scale.setScalar(Math.max(0.001, o.scale)); }, rm);
    sync(this.fires, st.fi || [], (row) => {
      const v = this.fireMesh(new THREE.Vector3(row[1], row[2], row[3]), row[4]);
      return { ...v, pos: new THREE.Vector3(row[1], row[2], row[3]), r: row[4], owner: { team: -1 } };
    }, (o, row) => { o.t = row[5]; }, rm);
    sync(this.walls, st.wa || [], (row) => {
      const box = { minX: row[1], minY: row[2], minZ: row[3], maxX: row[4], maxY: row[5], maxZ: row[6], kind: 'ability' };
      const mesh = this.wallMesh(box, row[7]);
      this.game.map.boxes.push(box);
      return { mesh, box, grow: 0, owner: { agent: { accent: row[7] } } };
    }, () => {}, (o) => {
      this.scene.remove(o.mesh);
      const i = this.game.map.boxes.indexOf(o.box);
      if (i >= 0) this.game.map.boxes.splice(i, 1);
    });
    sync(this.darts, st.da || [], (row) => {
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 6), new THREE.MeshBasicMaterial({ color: row[4] }));
      this.scene.add(mesh);
      return { mesh, pos: new THREE.Vector3() };
    }, (o, row) => { o.pos.set(row[1], row[2], row[3]); o.mesh.position.copy(o.pos); }, rm);
  }

  // Client: only animate what the host told us about.
  updateVisual(dt) {
    for (const s of this.smokes) s.mesh.rotation.y += dt * 0.05;
    for (const f of this.fires) {
      const fade = Math.min(1, (f.t ?? 1) / 0.8);
      for (const fl of f.flames) {
        const k = fl.userData.phase += dt * 9;
        const sc = (0.7 + Math.sin(k) * 0.3 + Math.sin(k * 2.3) * 0.15) * fade;
        fl.scale.set(sc, sc * (1.2 + Math.sin(k * 1.7) * 0.4), sc);
        fl.position.y = fl.scale.y * 0.5;
      }
      f.t = Math.max(0, (f.t ?? 1) - dt);
    }
    for (const w of this.walls) { w.grow = Math.min(1, w.grow + dt * 4); w.mesh.scale.y = Math.max(0.05, w.grow); }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const k = f.t / f.dur;
      f.mesh.scale.setScalar(0.5 + k * f.radius);
      f.mesh.material.opacity = 0.9 * (1 - k);
      if (k >= 1) { this.scene.remove(f.mesh); this.fx.splice(i, 1); }
    }
  }

  // ---- minimap ------------------------------------------------------------------

  drawMinimap(ctx, toX, toZ, scale) {
    for (const s of this.smokes) {
      ctx.fillStyle = 'rgba(200,205,215,0.75)';
      ctx.beginPath(); ctx.arc(toX(s.center.x), toZ(s.center.z), s.r * s.scale / 3 * scale, 0, Math.PI * 2); ctx.fill();
    }
    for (const f of this.fires) {
      ctx.fillStyle = 'rgba(255,110,40,0.6)';
      ctx.beginPath(); ctx.arc(toX(f.pos.x), toZ(f.pos.z), f.r / 3 * scale, 0, Math.PI * 2); ctx.fill();
    }
    for (const w of this.walls) {
      const b = w.box;
      ctx.fillStyle = '#' + new THREE.Color(w.owner.agent.accent).getHexString();
      ctx.fillRect(toX(b.minX), toZ(b.minZ), Math.max(2, toX(b.maxX) - toX(b.minX)), Math.max(2, toZ(b.maxZ) - toZ(b.minZ)));
    }
  }
}

export { COLORS as ABILITY_COLORS, wrapAngle, yawTo };

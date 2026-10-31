import * as THREE from '../lib/three.module.min.js?v=20261031053739';
import { rand, choice, wrapAngle, yawTo, pitchTo, clamp } from './util.js?v=20261031053739';
import { recoilOffset } from './weapons.js?v=20261031053739';

export const DIFFICULTY = {
  easy:   { react: [0.5, 0.85], aimErr: 0.13, errDecay: 2.2, turn: 4.5, headChance: 0.1, fov: 0.9, comp: 0.3 },
  normal: { react: [0.28, 0.5], aimErr: 0.08, errDecay: 3.8, turn: 7, headChance: 0.3, fov: 1.0, comp: 0.55 },
  hard:   { react: [0.16, 0.3], aimErr: 0.05, errDecay: 6, turn: 11, headChance: 0.55, fov: 1.15, comp: 0.8 },
};

const _eye = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class BotBrain {
  constructor(game) {
    this.game = game;
  }

  // Called at round start, once teams are placed.
  initRound(c, role) {
    const map = this.game.map;
    c.ai = {
      role,                       // { kind: 'attack', site, route } or { kind: 'hold', area }
      thinkT: Math.random() * 0.1,
      target: null, reactT: 0, errYaw: 0, errPitch: 0, aimPart: 'body',
      lastKnown: null, lostT: 99,
      alertPos: new THREE.Vector3(), alertT: 0,
      path: [], pathIdx: 0, goalKey: '', goal: null,
      routeIdx: 0,
      startDelay: role.kind === 'attack' ? rand(0, 6) : rand(0, 1.5),
      holdYaw: null,
      burst: 0, burstMax: 6, burstPause: 0,
      strafeDir: Math.random() < 0.5 ? -1 : 1, strafeT: 0,
      stuckT: 0, lastPos: c.pos.clone(),
      wantAction: false,
      spot: null, postPlantSpot: null,
      idleLookT: 0,
      rotateDelay: rand(2, 9), rotSpot: null,
      utilCD: rand(0.5, 2), execDone: false, smokedEarly: false, walled: false,
    };
    // Defensive hold spot.
    if (role.kind === 'hold') {
      let cell;
      if (role.area === 'mid') cell = choice(map.midHold);
      else {
        const s = map.sites[role.area];
        cell = choice(s.coverCells.length ? s.coverCells : s.cells);
      }
      c.ai.spot = cell;
    } else {
      const s = map.sites[role.site];
      c.ai.spot = choice(s.coverCells.length ? s.coverCells : s.cells);
    }
  }

  // `exact` (optional) is a precise world position to finish at instead of the cell centre.
  setGoal(c, cx, cz, type, exact = null) {
    const ai = c.ai, key = `${type}:${cx},${cz}`;
    if (ai.goalKey === key) return;
    ai.goalKey = key;
    ai.goal = { cx, cz, type, exact };
    const map = this.game.map;
    ai.path = map.findPath(map.cellX(c.pos.x), map.cellZ(c.pos.z), cx, cz);
    ai.pathIdx = 0;
    ai.holdYaw = null;
  }

  // ---- perception -------------------------------------------------------

  perceive(c) {
    const g = this.game, ai = c.ai, sk = g.skill;
    _eye.set(c.pos.x, c.pos.y + c.eyeHeight, c.pos.z);
    let best = null, bestD = Infinity, bestPart = 'body';
    for (const e of g.combatants) {
      if (e.team === c.team || !e.alive) continue;
      const dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 85) continue;
      const ang = Math.abs(wrapAngle(yawTo(dx, dz) - c.yaw));
      if (ai.target !== e && d > 3 && ang > sk.fov) continue;
      _pt.set(e.pos.x, e.pos.y + 1.2 - 0.45 * e.crouch, e.pos.z);
      let seen = g.canSee(_eye, _pt), part = 'body';
      if (!seen) {
        _pt.y = e.pos.y + 1.66 - 0.5 * e.crouch;
        seen = g.canSee(_eye, _pt);
        part = 'head';
      }
      if (seen && d < bestD) { best = e; bestD = d; bestPart = part; }
    }

    if (best) {
      if (ai.target !== best) {
        const alerted = ai.alertT > 0 || ai.lostT < 1.5;
        ai.reactT = rand(sk.react[0], sk.react[1]) * (alerted ? 0.65 : 1);
        const err = sk.aimErr * rand(0.5, 1);
        const a = Math.random() * Math.PI * 2;
        ai.errYaw = Math.cos(a) * err;
        ai.errPitch = Math.sin(a) * err * 0.6;
        ai.aimPart = bestPart === 'head' || Math.random() < sk.headChance ? 'head' : 'body';
        ai.burst = 0;
      }
      ai.target = best;
      ai.lastKnown = (ai.lastKnown || new THREE.Vector3()).copy(best.pos);
      ai.lostT = 0;
      ai.dist = bestD;
      best.spotBy[c.team] = g.time + 0.6;
    } else if (ai.target) {
      ai.target = null;
      ai.lostT = 0;
    }
  }

  // ---- objectives -------------------------------------------------------

  plan(c) {
    const g = this.game, ai = c.ai, map = g.map, core = g.core;
    const side = g.sideOf(c.team);
    ai.wantAction = false;

    if (side === 'ATK') {
      if (core.state === 'planted') {
        if (!ai.postPlantSpot) {
          const s = map.sites[core.site];
          ai.postPlantSpot = choice(s.coverCells.length ? s.coverCells : s.cells);
        }
        this.setGoal(c, ai.postPlantSpot[0], ai.postPlantSpot[1], 'hold');
        return;
      }
      if (c.hasCore) {
        this.followRouteOr(c, ai.spot, 'plant');
        if (ai.goal.type === 'plant' && this.arrived(c) && map.siteAt(c.pos.x, c.pos.z) && !ai.target) {
          ai.wantAction = true;
        }
        return;
      }
      if (core.state === 'dropped' && this.isClosestTo(c, core.pos, 'ATK')) {
        this.setGoal(c, map.cellX(core.pos.x), map.cellZ(core.pos.z), 'pickup', core.pos);
        return;
      }
      this.followRouteOr(c, ai.spot, 'hold');
      return;
    }

    // Defenders
    if (core.state === 'planted') {
      const cx = map.cellX(core.pos.x), cz = map.cellZ(core.pos.z);
      if (this.isClosestTo(c, core.pos, 'DEF')) {
        this.setGoal(c, cx, cz, 'defuse', core.pos);
        const d = Math.hypot(core.pos.x - c.pos.x, core.pos.z - c.pos.z);
        if (d < 1.6 && !ai.target) ai.wantAction = true;
      } else {
        if (!ai.postPlantSpot) {
          const s = map.sites[core.site];
          ai.postPlantSpot = choice(s.cells);
        }
        this.setGoal(c, ai.postPlantSpot[0], ai.postPlantSpot[1], 'retake');
      }
      return;
    }
    // Rotate toward a site where attackers were spotted.
    const alert = g.defAlert;
    if (alert && ai.role.area !== alert.site && g.time - alert.time > ai.rotateDelay) {
      if (!ai.rotSpot) {
        const s = map.sites[alert.site];
        ai.rotSpot = choice(s.coverCells.length ? s.coverCells : s.cells);
      }
      this.setGoal(c, ai.rotSpot[0], ai.rotSpot[1], 'hold');
      return;
    }
    this.setGoal(c, ai.spot[0], ai.spot[1], 'hold');
  }

  followRouteOr(c, spot, type) {
    const ai = c.ai, route = ai.role.route || [];
    if (ai.routeIdx < route.length) {
      const wp = route[ai.routeIdx];
      this.setGoal(c, wp[0], wp[1], 'via');
      if (this.arrived(c, 2.2)) ai.routeIdx++;
      return;
    }
    this.setGoal(c, spot[0], spot[1], type);
  }

  arrived(c, tol = 0.8) {
    const ai = c.ai;
    if (!ai.goal) return false;
    const p = ai.goal.exact || this.game.map.center(ai.goal.cx, ai.goal.cz, _tmp);
    return Math.hypot(p.x - c.pos.x, p.z - c.pos.z) < tol;
  }

  isClosestTo(c, pos, side) {
    const g = this.game;
    let best = null, bd = Infinity;
    for (const o of g.combatants) {
      if (!o.alive || o.human || g.sideOf(o.team) !== side) continue;
      const d = Math.hypot(o.pos.x - pos.x, o.pos.z - pos.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best === c;
  }

  // ---- per-frame ----------------------------------------------------------

  update(c, dt) {
    const g = this.game, ai = c.ai, sk = g.skill;
    c.wx = 0; c.wz = 0;
    c.walking = false;
    c.crouching = false;
    ai.alertT -= dt;
    ai.lostT += dt;
    ai.startDelay -= g.phase === 'live' ? dt : 0;

    if (g.phase === 'buy') {
      ai.idleLookT -= dt;
      if (ai.idleLookT <= 0) { ai.idleLookT = rand(1, 3); ai.idleYaw = c.yaw + rand(-0.6, 0.6); }
      this.turnTo(c, ai.idleYaw ?? c.yaw, 0, 2, dt);
      return;
    }

    ai.thinkT -= dt;
    if (ai.thinkT <= 0) {
      ai.thinkT = 0.08 + Math.random() * 0.06;
      if (c.blind > 0) { ai.target = null; } else this.perceive(c);
      this.plan(c);
      this.utility(c, 0.11);
    }

    // Blinded: back off and wait it out.
    if (c.blind > 0.25) {
      c.wx = Math.sin(c.yaw); c.wz = Math.cos(c.yaw);
      c.walking = true;
      return;
    }
    // Get out of enemy fire.
    const fire = g.abilities.inFire(c);
    if (fire && !c.action) {
      const dx = c.pos.x - fire.pos.x, dz = c.pos.z - fire.pos.z, d = Math.hypot(dx, dz) || 1;
      c.wx = dx / d; c.wz = dz / d;
      if (ai.target?.alive) this.fight(c, ai.target, dt, true);
      return;
    }

    const w = c.weapon;
    // keep a gun with ammo out
    if (c.switchT <= 0) {
      const best = c.inv.primary && (c.inv.primary.mag + c.inv.primary.reserve > 0) ? 'primary'
        : c.inv.secondary && (c.inv.secondary.mag + c.inv.secondary.reserve > 0) ? 'secondary' : 'melee';
      if (c.slot !== best && !(ai.target && w.mag > 0)) g.switchSlot(c, best);
    }

    const t = ai.target;
    if (t && t.alive) {
      this.fight(c, t, dt);
      return;
    }
    if (ai.target && !ai.target.alive) ai.target = null;

    // Reload in downtime.
    if (w && !w.def.melee && w.reloadT <= 0 && w.mag < w.def.mag * 0.5 && w.reserve > 0) g.startReload(c);

    // Objective action (plant/defuse) — stand still.
    if (ai.wantAction) {
      c.crouching = ai.goal?.type === 'defuse';
      return;
    }

    let lookYaw = null, lookPitch = 0;
    if (ai.alertT > 0) {
      lookYaw = yawTo(ai.alertPos.x - c.pos.x, ai.alertPos.z - c.pos.z);
    } else if (ai.lastKnown && ai.lostT < 2.5) {
      lookYaw = yawTo(ai.lastKnown.x - c.pos.x, ai.lastKnown.z - c.pos.z);
    }

    const moving = (g.sideOf(c.team) === 'DEF' || ai.startDelay <= 0) && this.followPath(c, dt);
    if (!moving && ai.goal) {
      if (ai.holdYaw === null) {
        const map = g.map;
        const enemySpawn = g.sideOf(c.team) === 'ATK' ? map.spawns.D[0] : map.spawns.T[Math.floor(map.spawns.T.length / 2)];
        ai.holdYaw = map.watchYaw(ai.goal.cx, ai.goal.cz, enemySpawn[0], enemySpawn[1]);
      }
      if (lookYaw === null) {
        ai.idleLookT -= dt;
        if (ai.idleLookT <= 0) { ai.idleLookT = rand(1.5, 4); ai.idleOff = rand(-0.5, 0.5); }
        lookYaw = ai.holdYaw + (ai.idleOff || 0);
      }
    }
    if (lookYaw === null && moving) lookYaw = Math.atan2(-c.wx, -c.wz);
    if (lookYaw !== null) this.turnTo(c, lookYaw, lookPitch, sk.turn * 0.6, dt);

    // Defuser runs, others walk when close to known danger.
    if (moving && ai.lastKnown && ai.lostT < 6 && ai.goal?.type !== 'defuse') c.walking = true;
  }

  followPath(c, dt) {
    const ai = c.ai, map = this.game.map;
    if (!ai.path || ai.pathIdx >= ai.path.length) {
      // final approach to the goal centre
      if (ai.goal && !this.arrived(c, 0.4)) {
        const p = ai.goal.exact || map.center(ai.goal.cx, ai.goal.cz, _tmp);
        const dx = p.x - c.pos.x, dz = p.z - c.pos.z, d = Math.hypot(dx, dz);
        if (d < 2.5) { c.wx = dx / d; c.wz = dz / d; return true; }
      }
      return false;
    }
    const [cx, cz] = ai.path[ai.pathIdx];
    const p = map.center(cx, cz, _tmp);
    const dx = p.x - c.pos.x, dz = p.z - c.pos.z, d = Math.hypot(dx, dz);
    const last = ai.pathIdx === ai.path.length - 1;
    if (d < (last ? 0.4 : 1.1)) {
      ai.pathIdx++;
      return ai.pathIdx < ai.path.length || !last;
    }
    c.wx = dx / d; c.wz = dz / d;
    // hop up onto ledges
    if (c.onGround && d < 2.4 && !map.isStair(cx, cz) && map.cellHeight(cx, cz) - c.pos.y > 0.45) c.vel.y = 7;

    // light separation from teammates so they don't stack
    for (const o of this.game.combatants) {
      if (o === c || !o.alive || o.team !== c.team) continue;
      const ox = c.pos.x - o.pos.x, oz = c.pos.z - o.pos.z, od = Math.hypot(ox, oz);
      if (od < 1.2 && od > 0.01) { c.wx += ox / od * 0.5; c.wz += oz / od * 0.5; }
    }
    const l = Math.hypot(c.wx, c.wz) || 1;
    c.wx /= l; c.wz /= l;

    // stuck detection
    ai.stuckT += dt;
    if (ai.stuckT > 1.2) {
      const moved = Math.hypot(c.pos.x - ai.lastPos.x, c.pos.z - ai.lastPos.z);
      ai.lastPos.copy(c.pos);
      ai.stuckT = 0;
      if (moved < 0.4) {
        ai.path = map.findPath(map.cellX(c.pos.x), map.cellZ(c.pos.z), ai.goal.cx, ai.goal.cz);
        ai.pathIdx = 0;
        c.vel.y = c.onGround ? 7 : c.vel.y; // hop over small obstacles
      }
    }
    return true;
  }

  turnTo(c, yaw, pitch, rate, dt) {
    const dy = wrapAngle(yaw - c.yaw);
    const step = rate * dt;
    // ease in: fast when far, smooth when close
    c.yaw = wrapAngle(c.yaw + clamp(dy * Math.min(1, dt * 12), -step, step));
    c.pitch += clamp((pitch - c.pitch) * Math.min(1, dt * 10), -step, step);
  }

  fight(c, t, dt, keepMoving = false) {
    const g = this.game, ai = c.ai, sk = g.skill, w = c.weapon;
    const aimY = ai.aimPart === 'head' ? 1.67 - 0.5 * t.crouch : 1.2 - 0.45 * t.crouch;
    const dx = t.pos.x - c.pos.x, dz = t.pos.z - c.pos.z;
    const dy = t.pos.y + aimY - (c.pos.y + c.eyeHeight);
    const dist = Math.hypot(dx, dz);

    // aim error shrinks over time while tracking
    const decay = Math.exp(-sk.errDecay * dt);
    ai.errYaw *= decay; ai.errPitch *= decay;
    let yaw = yawTo(dx, dz) + ai.errYaw;
    let pitch = pitchTo(dx, dy, dz) + ai.errPitch;
    if (w && !w.def.melee) {
      const rec = recoilOffset(w.def, w.spray);
      pitch -= rec.pitch * sk.comp;
      yaw -= rec.yaw * sk.comp;
    }
    this.turnTo(c, yaw, pitch, sk.turn, dt);
    ai.reactT -= dt;

    if (w.def.melee) {
      // charge with the knife
      c.wx = dx / (dist || 1); c.wz = dz / (dist || 1);
      if (dist < w.def.range && ai.reactT <= 0) g.tryShoot(c);
      return;
    }

    if (w.mag <= 0) {
      if (w.reloadT <= 0) {
        if (w.reserve > 0) g.startReload(c);
        else if (c.slot === 'primary' && c.inv.secondary) g.switchSlot(c, 'secondary');
        else g.switchSlot(c, 'melee');
      }
    }

    const errAng = Math.abs(wrapAngle(yaw - c.yaw)) + Math.abs(pitch - c.pitch);
    const tol = Math.max(0.025, Math.atan2(0.3, dist));
    ai.burstPause -= dt;

    let shooting = false;
    if (c.blind <= 0 && ai.reactT <= 0 && errAng < tol && w.reloadT <= 0 && w.mag > 0 && ai.burstPause <= 0 && c.switchT <= 0) {
      ai.burstMax = w.def.auto ? (dist > 28 ? 2 : dist > 14 ? 4 : 9) : 1;
      if (g.tryShoot(c)) {
        shooting = true;
        ai.burst++;
        if (ai.burst >= ai.burstMax) {
          ai.burst = 0;
          ai.burstPause = w.def.auto ? rand(0.22, 0.42) : rand(0.18, 0.4);
        }
      }
    }

    // strafe between bursts, stand still to shoot
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafeT = rand(0.35, 0.9); ai.strafeDir = Math.random() < 0.5 ? -1 : 1; }
    const firingWindow = ai.reactT <= 0 && ai.burstPause <= 0;
    if (keepMoving) return;
    if (!firingWindow && !shooting && dist > 4) {
      const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
      c.wx = rx * ai.strafeDir; c.wz = rz * ai.strafeDir;
    }
    if (g.skill === DIFFICULTY.hard && dist > 20 && firingWindow) c.crouching = Math.random() < 0.4;
  }

  // ---- abilities -----------------------------------------------------------

  utility(c, step) {
    const g = this.game, ai = c.ai, ab = g.abilities, kit = c.agent.kit;
    if (g.phase !== 'live' || c.blind > 0 || c.action) return;
    ai.utilCD -= step;
    if (ai.utilCD > 0) return;
    const side = g.sideOf(c.team), map = g.map, core = g.core;
    const keysFor = (type) => ['q', 'e', 'f'].filter((k) => kit[k].type === type && ab.canCast(c, k));
    const use = (type, target) => {
      const k = keysFor(type)[0];
      if (!k) return false;
      const ok = type === 'wall' && target ? this.withAim(c, target, () => ab.cast(c, k)) : ab.cast(c, k, target);
      if (ok) ai.utilCD = rand(1.2, 2.5);
      return ok;
    };
    const ultType = kit.x.type, ultReady = ab.canCast(c, 'x');
    const ult = (target) => {
      const ok = target && (ultType === 'smokeline') ? this.withAim(c, target, () => ab.cast(c, 'x')) : ab.cast(c, 'x', target);
      if (ok) ai.utilCD = rand(1.5, 3);
      return ok;
    };
    const dist = (p) => Math.hypot(p.x - c.pos.x, p.z - c.pos.z);

    // healing
    if (!ai.target && c.health < 55 && use('heal')) return;
    if (ultReady && ultType === 'teamheal') {
      const hurt = g.combatants.filter((o) => o.alive && o.team === c.team && o.health < 50).length;
      if (hurt >= 2 || (c.health < 35 && !ai.target)) { ult(); return; }
    }
    // fight ults
    if (ultReady && ai.target && (ultType === 'overdrive' || (ultType === 'blackout' && ai.dist < 35))) { ult(); return; }

    if (side === 'ATK') {
      if (core.state === 'planted') {
        const defuser = g.combatants.find((o) => o.alive && o.action?.type === 'defuse');
        if (defuser && dist(core.pos) < 35) {
          if (use('molly', core.pos)) return;
          if (ultReady && ultType === 'inferno' && ult(core.pos)) return;
          if (use('flash', core.pos)) return;
        }
        return;
      }
      // the site execute: smoke the defender side, scout, flash, dash in
      const s = map.sites[ai.role.site];
      const ds = dist(s.center);
      const routeDone = ai.routeIdx >= (ai.role.route || []).length;
      if (!ai.execDone && routeDone && ds < 24 && ds > 5) {
        ai.execDone = true;
        const toward = map.center(map.dCenter[0], map.dCenter[1]).sub(s.center).setY(0).normalize();
        const smokeAt = s.center.clone().addScaledVector(toward, 4);
        smokeAt.y = 0;
        if (ultReady && ultType === 'smokeline') ult(smokeAt);
        else use('smoke', smokeAt);
        if (ultReady && (ultType === 'reveal' || ultType === 'blackout')) ult();
        use('recon', s.center) || use('flash', s.center);
        if (keysFor('dash').length) ab.cast(c, keysFor('dash')[0]);
        ai.utilCD = 1.5;
        return;
      }
      // covering wall while planting
      if (c.hasCore && ai.wantAction && !ai.walled && keysFor('wall').length) {
        ai.walled = true;
        use('wall', map.center(map.dCenter[0], map.dCenter[1]));
        return;
      }
    } else {
      if (core.state === 'planted') {
        if (ultReady && ultType === 'reveal') { ult(); return; }
        if (dist(core.pos) < 30 && dist(core.pos) > 6 && !ai.target) {
          const site = map.sites[core.site];
          if (use('recon', site.center) || use('flash', core.pos) || use('smoke', site.center)) return;
        }
        return;
      }
      // early-round smoke on the lane we're watching
      if (!ai.smokedEarly && g.phaseT < 95 && ai.goal?.type === 'hold' && this.arrived(c, 1.5) && ai.holdYaw !== null) {
        ai.smokedEarly = true;
        if (Math.random() < 0.5) {
          const t = c.pos.clone();
          t.x -= Math.sin(ai.holdYaw) * 11; t.z -= Math.cos(ai.holdYaw) * 11; t.y = 0;
          if (g.canSee(new THREE.Vector3(c.pos.x, 1.5, c.pos.z), new THREE.Vector3(t.x, 1.5, t.z))) use('smoke', t);
        }
        return;
      }
      // enemies heard / just lost: utility at them
      if (!ai.target && ai.lastKnown && ai.lostT < 3) {
        const d = dist(ai.lastKnown);
        if (d < 28 && d > 5) {
          if (use('recon', ai.lastKnown) || use('molly', ai.lastKnown) || use('flash', ai.lastKnown)) return;
          if (!ai.walled && d < 14 && use('wall', ai.lastKnown)) { ai.walled = true; return; }
          if (ultReady && (ultType === 'inferno' || ultType === 'reveal')) { ult(ai.lastKnown); return; }
        }
      }
    }
  }

  // Temporarily look at a point while casting (walls/lines are placed along the view).
  withAim(c, target, fn) {
    const y = c.yaw, p = c.pitch;
    c.yaw = yawTo(target.x - c.pos.x, target.z - c.pos.z);
    c.pitch = -0.25;
    const ok = fn();
    c.yaw = y; c.pitch = p;
    return ok;
  }

  // Sounds and damage make bots look toward the source.
  hear(c, pos, strength = 1) {
    if (!c.ai || c.ai.target) return;
    c.ai.alertPos.copy(pos);
    c.ai.alertT = 1.5 + strength;
  }
}

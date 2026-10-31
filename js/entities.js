import * as THREE from '../lib/three.module.min.js?v=20261031172740';
import { makeWeaponState } from './weapons.js?v=20261031172740';

export const RUN_SPEED = 5.4;
export const WALK_SPEED = 2.9;
export const CROUCH_SPEED = 2.0;
export const GRAVITY = 20;
export const JUMP_VEL = 7;

export class Combatant {
  constructor(id, name, team, isPlayer = false, agent = null) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.radius = 0.35;
    this.crouch = 0; // 0 standing .. 1 fully crouched
    this.crouching = false;
    this.walking = false;
    this.onGround = true;
    this.health = 100;
    this.armor = 0;
    this.alive = true;
    this.credits = 800;
    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;
    this.assistBy = new Map();   // attacker id -> time until which they'd get an assist
    this.hasCore = false;
    this.spotUntil = 0;
    this.spotBy = [0, 0];   // per team: time until which this combatant shows on that team's minimap
    this.slot = 'secondary';
    this.lastSlot = 'melee';
    this.switchT = 0;
    this.scoped = false;
    this.stepDist = 0;
    this.action = null;
    this.model = null;
    this.ai = null;
    this.deadT = 0;
    this.agent = agent;
    this.charges = { q: 0, e: 0, f: 0 };
    this.ult = 0;
    this.blind = 0;
    this.blindMax = 0;
    this.healT = 0;
    this.dashT = 0;
    this.overdriveT = 0;
    this.revealUntil = 0;
    this.castT = 0;
    this.wx = 0; this.wz = 0;
    this.resetLoadout();
  }

  resetLoadout() {
    this.inv = { primary: null, secondary: makeWeaponState('pip'), melee: makeWeaponState('knife') };
    this.slot = 'secondary';
    this.armor = 0;
  }

  // Signature ability refills each round; bought charges carry over.
  refillSignature() {
    if (!this.agent) return;
    this.charges.e = this.agent.kit.e.free;
  }

  clearStatus() {
    this.blind = 0; this.blindMax = 0; this.healT = 0; this.dashT = 0;
    this.overdriveT = 0; this.revealUntil = 0; this.castT = 0;
  }

  get weapon() { return this.inv[this.slot]; }
  get height() { return 1.84 - 0.5 * this.crouch; }
  get eyeHeight() { return 1.62 - 0.5 * this.crouch; }

  bestSlot() {
    if (this.inv.primary) return 'primary';
    if (this.inv.secondary) return 'secondary';
    return 'melee';
  }

  refillAmmo() {
    for (const k of ['primary', 'secondary']) {
      const w = this.inv[k];
      if (!w) continue;
      w.mag = w.def.mag; w.reserve = w.def.reserve;
      w.reloadT = 0; w.spray = 0; w.cool = 0;
    }
  }
}

// Hitboxes in world space: head, body, legs. Written into `out` (array of 3 boxes).
export function hitboxes(c, out) {
  const x = c.pos.x, y = c.pos.y, z = c.pos.z, cr = c.crouch;
  const legTop = y + 0.88 - 0.4 * cr;
  const bodyTop = y + 1.5 - 0.5 * cr;
  const headTop = y + 1.84 - 0.5 * cr;
  let b = out[0];
  b.minX = x - 0.17; b.maxX = x + 0.17; b.minZ = z - 0.17; b.maxZ = z + 0.17; b.minY = bodyTop; b.maxY = headTop; b.part = 'head';
  b = out[1];
  b.minX = x - 0.3; b.maxX = x + 0.3; b.minZ = z - 0.3; b.maxZ = z + 0.3; b.minY = legTop; b.maxY = bodyTop; b.part = 'body';
  b = out[2];
  b.minX = x - 0.25; b.maxX = x + 0.25; b.minZ = z - 0.25; b.maxZ = z + 0.25; b.minY = y; b.maxY = legTop; b.part = 'leg';
  return out;
}

function overlaps(p, r, h, b) {
  return p.x + r > b.minX && p.x - r < b.maxX &&
         p.z + r > b.minZ && p.z - r < b.maxZ &&
         p.y + h > b.minY + 1e-4 && p.y < b.maxY - 1e-4;
}

const STEP = 0.45;

// Can the body stand at height y without hitting anything?
function clearAt(boxes, p, r, h, y) {
  for (const b of boxes) {
    if (p.x + r > b.minX && p.x - r < b.maxX && p.z + r > b.minZ && p.z - r < b.maxZ &&
        y + h > b.minY + 1e-4 && y < b.maxY - 1e-4) return false;
  }
  return true;
}

function resolveAxis(map, c, axis, delta, restrict) {
  const p = c.pos, v = c.vel, r = c.radius, h = c.height, boxes = map.boxes;
  const old = p[axis];
  p[axis] += delta;
  const vel = axis === 'x' ? v.x : v.z;
  for (const b of boxes) {
    if (!overlaps(p, r, h, b)) continue;
    // walk up small steps (stairs, curbs)
    const rise = b.maxY - p.y;
    if (rise > 0 && rise <= STEP && (c.onGround || c.wasGround) && clearAt(boxes, p, r, h, b.maxY + 1e-3)) {
      p.y = b.maxY + 1e-3;
      continue;
    }
    const min = axis === 'x' ? b.minX : b.minZ, max = axis === 'x' ? b.maxX : b.maxZ;
    if (vel > 0) p[axis] = min - r - 1e-3;
    else if (vel < 0) p[axis] = max + r + 1e-3;
    else p[axis] = p[axis] < (min + max) / 2 ? min - r - 1e-3 : max + r + 1e-3;
    if (axis === 'x') v.x = 0; else v.z = 0;
  }
  if (restrict && map.charAt(p.x, p.z) !== restrict) {
    p[axis] = old;
    if (axis === 'x') v.x = 0; else v.z = 0;
  }
}

// Moves a combatant through the world with axis-separated AABB collision and step-up.
// `restrict` (optional) is a map character the combatant must stay on (buy-phase barrier).
export function moveBody(map, c, dt, restrict) {
  const p = c.pos, v = c.vel, r = c.radius, h = c.height;
  c.wasGround = c.onGround;
  resolveAxis(map, c, 'x', v.x * dt, restrict);
  resolveAxis(map, c, 'z', v.z * dt, restrict);

  const wasGround = c.onGround;
  c.onGround = false;
  p.y += v.y * dt;
  for (const b of map.boxes) {
    if (!overlaps(p, r, h, b)) continue;
    if (v.y <= 0) { p.y = b.maxY; c.onGround = true; }
    else p.y = b.minY - h;
    v.y = 0;
  }
  if (p.y <= 0) { p.y = 0; v.y = 0; c.onGround = true; }
  // stick to the ground when walking down stairs
  if (!c.onGround && wasGround && v.y <= 0) {
    for (let k = 1; k <= 3; k++) {
      const y = p.y - k * 0.15;
      if (!clearAt(map.boxes, p, r, h, y) || y <= 0) {
        // find the surface just below
        let top = 0;
        for (const b of map.boxes) {
          if (p.x + r > b.minX && p.x - r < b.maxX && p.z + r > b.minZ && p.z - r < b.maxZ && b.maxY <= p.y + 1e-3) top = Math.max(top, b.maxY);
        }
        if (p.y - top <= STEP + 0.01) { p.y = top; v.y = 0; c.onGround = true; }
        break;
      }
    }
  }
  return !wasGround && c.onGround;
}

// Accelerate horizontal velocity toward a wished direction (wx, wz normalized or zero).
export function applyMovement(c, wx, wz, maxSpeed, dt) {
  const v = c.vel;
  if (c.dashT > 0) {
    c.dashT -= dt;
    v.y -= GRAVITY * dt;
    return;
  }
  if (c.onGround) {
    const tx = wx * maxSpeed, tz = wz * maxSpeed;
    const accel = (wx || wz) ? 45 : 38;
    const dx = tx - v.x, dz = tz - v.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-5) {
      const step = Math.min(len, accel * dt);
      v.x += dx / len * step; v.z += dz / len * step;
    }
  } else {
    v.x += wx * 10 * dt; v.z += wz * 10 * dt;
    const sp = Math.hypot(v.x, v.z), cap = Math.max(maxSpeed, 1);
    if (sp > cap) { v.x *= cap / sp; v.z *= cap / sp; }
  }
  v.y -= GRAVITY * dt;
}

export function speedFor(c) {
  const w = c.weapon;
  let s = c.crouching ? CROUCH_SPEED : c.walking ? WALK_SPEED : RUN_SPEED;
  if (w) s *= w.def.speedMul;
  if (c.scoped) s *= 0.6;
  if (c.overdriveT > 0) s *= 1.2;
  return s;
}

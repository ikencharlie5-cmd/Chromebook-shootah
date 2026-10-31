import * as THREE from '../lib/three.module.min.js';

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
const box = (w, h, d) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cap = (r, l) => cached(`c${r},${l}`, () => new THREE.CapsuleGeometry(r, l, 4, 10));
const sph = (r) => cached(`s${r}`, () => new THREE.SphereGeometry(r, 16, 12));
const cyl = (r1, r2, h, n = 12) => cached(`y${r1},${r2},${h},${n}`, () => new THREE.CylinderGeometry(r1, r2, h, n));

const matCache = new Map();
export function phong(color, shininess = 50) {
  const k = `${color}:${shininess}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshPhongMaterial({ color, shininess, specular: 0x555555 }));
  return matCache.get(k);
}
export function glow(color) {
  const k = `g${color}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshBasicMaterial({ color }));
  return matCache.get(k);
}

function add(parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

const _up = new THREE.Vector3(0, 1, 0);
// Capsule/cylinder limb stretched between two points in the parent's space.
function limb(parent, a, b, r, material, tapered = 0) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = tapered ? cyl(r * (1 - tapered), r, len, 10) : cap(r, Math.max(0.01, len - r * 2) + r * 0.6);
  const m = new THREE.Mesh(geo, material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(_up, dir.normalize());
  parent.add(m);
  return m;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Guns — pointing down -Z with the grip at the origin.
// ---------------------------------------------------------------------------

export function buildGun(id) {
  const g = new THREE.Group();
  const metal = phong(0x2a2e35, 80), poly = phong(0x1a1d22, 20), lite = phong(0x5c6470, 70);
  let muzzleZ = -0.3;
  const barrel = (len, z, y = 0.05, r = 0.018) => add(g, cyl(r, r, len, 10), metal, 0, y, z, Math.PI / 2);
  switch (id) {
    case 'knife': {
      add(g, box(0.034, 0.1, 0.13), poly, 0, 0, 0.03);
      add(g, box(0.06, 0.025, 0.035), metal, 0, 0.055, -0.04);
      const blade = add(g, box(0.008, 0.055, 0.25), phong(0xd8e0e8, 120), 0, 0.06, -0.18);
      blade.rotation.x = 0.04;
      add(g, box(0.009, 0.012, 0.25), glow(0x7ff6ff), 0, 0.035, -0.18);
      muzzleZ = -0.3;
      break;
    }
    case 'pip':
    case 'bolt': {
      const big = id === 'bolt';
      add(g, box(0.042, 0.115, 0.06), poly, 0, -0.03, 0.025, -0.25);
      add(g, box(0.05, 0.055, big ? 0.27 : 0.21), big ? lite : metal, 0, 0.05, big ? -0.095 : -0.065);
      add(g, box(0.046, 0.025, big ? 0.25 : 0.19), poly, 0, 0.012, big ? -0.09 : -0.06);
      add(g, box(0.012, 0.03, 0.035), poly, 0, -0.005, -0.03);
      if (big) { barrel(0.08, -0.25, 0.05, 0.022); add(g, box(0.015, 0.02, 0.02), glow(0xffb347), 0, 0.085, 0.02); }
      add(g, box(0.01, 0.015, 0.012), metal, 0, 0.083, -0.17);
      muzzleZ = big ? -0.29 : -0.18;
      break;
    }
    case 'wasp':
      add(g, box(0.045, 0.12, 0.06), poly, 0, -0.05, 0.03, -0.2);
      add(g, box(0.075, 0.1, 0.36), metal, 0, 0.04, -0.1);
      add(g, box(0.07, 0.04, 0.3), poly, 0, 0.1, -0.1);
      add(g, box(0.038, 0.2, 0.05), lite, 0, -0.08, -0.13, 0.12);
      barrel(0.14, -0.34, 0.045, 0.02);
      add(g, cyl(0.03, 0.03, 0.08, 10), poly, 0, 0.045, -0.43, Math.PI / 2);
      add(g, box(0.05, 0.05, 0.18), poly, 0, 0.04, 0.16);
      add(g, box(0.078, 0.012, 0.2), glow(0x7ff6ff), 0, 0.065, -0.1);
      muzzleZ = -0.48;
      break;
    case 'talon':
      add(g, box(0.045, 0.13, 0.06), poly, 0, -0.05, 0.03, -0.2);
      add(g, box(0.075, 0.1, 0.5), metal, 0, 0.04, -0.14);
      add(g, box(0.06, 0.08, 0.3), poly, 0, 0.03, -0.5);
      add(g, box(0.045, 0.2, 0.08), lite, 0, -0.1, -0.13, 0.25);
      barrel(0.22, -0.72, 0.05);
      add(g, cyl(0.026, 0.03, 0.07, 8), poly, 0, 0.05, -0.85, Math.PI / 2);
      add(g, box(0.06, 0.1, 0.26), poly, 0, 0.0, 0.22);
      add(g, box(0.07, 0.04, 0.08), poly, 0, -0.02, 0.36);
      add(g, box(0.04, 0.05, 0.13), poly, 0, 0.12, -0.12);
      add(g, box(0.05, 0.035, 0.03), glow(0xff4f7a), 0, 0.13, -0.05);
      add(g, box(0.077, 0.012, 0.42), glow(0xffb347), 0, 0.02, -0.14);
      muzzleZ = -0.9;
      break;
    case 'lynx':
      add(g, box(0.045, 0.13, 0.06), poly, 0, -0.05, 0.03, -0.2);
      add(g, box(0.08, 0.11, 0.55), phong(0x34443a, 40), 0, 0.04, -0.12);
      barrel(0.55, -0.66, 0.05, 0.022);
      add(g, cyl(0.032, 0.032, 0.1, 10), poly, 0, 0.05, -0.96, Math.PI / 2);
      add(g, cyl(0.04, 0.04, 0.32, 12), poly, 0, 0.15, -0.12, Math.PI / 2);
      add(g, cyl(0.048, 0.048, 0.04, 12), metal, 0, 0.15, -0.28, Math.PI / 2);
      add(g, cyl(0.045, 0.045, 0.03, 12), glow(0x5dffb0), 0, 0.15, 0.04, Math.PI / 2);
      add(g, box(0.07, 0.13, 0.3), phong(0x34443a, 40), 0, 0.0, 0.26);
      add(g, box(0.04, 0.12, 0.06), lite, 0, -0.08, -0.12);
      muzzleZ = -1.02;
      break;
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.05, muzzleZ);
  g.add(muzzle);
  return { group: g, muzzle };
}

const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
const flashGeo = new THREE.PlaneGeometry(0.35, 0.35);
export function buildFlash() {
  const grp = new THREE.Group();
  const a = new THREE.Mesh(flashGeo, flashMat);
  const b = new THREE.Mesh(flashGeo, flashMat); b.rotation.y = Math.PI / 2;
  const c = new THREE.Mesh(flashGeo, flashMat); c.rotation.x = Math.PI / 2;
  grp.add(a, b, c);
  grp.visible = false;
  return grp;
}

// ---------------------------------------------------------------------------
// Characters — sleek armored agents. Feet at y = 0, facing -Z.
// `teamColor` drives the visor and light strips so teams are always readable.
// ---------------------------------------------------------------------------

export function buildCharacter(agent, teamColor) {
  const suit = phong(agent.suit, 60), under = phong(agent.suit2, 25), plate = phong(lighten(agent.suit, 0.18), 90);
  const light = glow(teamColor), accent = glow(agent.accent);
  const bulky = agent.look === 'bulky' ? 1.12 : 1;

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = new THREE.Group();
  root.add(body);

  // legs
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.12 * side, 0.92, 0);
    body.add(hip);
    limb(hip, V(0, 0, 0), V(0, -0.44, 0), 0.105, under);
    add(hip, cap(0.115, 0.16), suit, 0, -0.19, -0.01).scale.set(1, 1, 1.05);
    add(hip, box(0.025, 0.2, 0.012), light, 0.07 * side, -0.18, -0.105);
    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    hip.add(knee);
    add(knee, sph(0.085), plate, 0, 0, -0.06);
    limb(knee, V(0, 0, 0), V(0, -0.38, 0), 0.085, under);
    add(knee, cap(0.098, 0.14), suit, 0, -0.16, -0.012);
    add(knee, sph(0.1), phong(0x15171b, 30), 0, -0.41, -0.05).scale.set(0.85, 0.6, 1.5);
    add(knee, box(0.16, 0.02, 0.16), accent, 0, -0.36, -0.03);
    legs.push({ hip, knee });
  }

  // pelvis + torso
  add(body, sph(0.2), under, 0, 0.95, 0).scale.set(1, 0.6, 0.72);
  add(body, cyl(0.2, 0.2, 0.05, 14), suit, 0, 1.03, 0).scale.set(1, 1, 0.68);
  const torso = new THREE.Group();
  torso.position.set(0, 1.04, 0);
  body.add(torso);
  limb(torso, V(0, 0.02, 0), V(0, 0.2, 0), 0.15, under);
  add(torso, sph(0.27), suit, 0, 0.33, 0).scale.set(bulky, 0.78, 0.62 * bulky);
  add(torso, sph(0.2), plate, 0, 0.37, -0.1 * bulky).scale.set(bulky, 0.62, 0.4);
  add(torso, box(0.025, 0.17, 0.012), light, -0.075, 0.35, -0.178 * bulky, 0.25, 0, 0.35);
  add(torso, box(0.025, 0.17, 0.012), light, 0.075, 0.35, -0.178 * bulky, 0.25, 0, -0.35);
  add(torso, cap(0.12, 0.12), under, 0, 0.32, 0.17 * bulky).scale.set(1.25, 1, 0.75);
  add(torso, box(0.05, 0.16, 0.02), accent, 0, 0.34, 0.26 * bulky);
  // shoulders
  for (const side of [-1, 1]) {
    const pad = add(torso, sph(0.12 * bulky), plate, 0.27 * side * bulky, 0.46, 0);
    pad.scale.set(1.1, 0.75, 1.15);
    if (agent.look === 'spikes') {
      add(torso, cyl(0, 0.05, 0.16, 6), accent, 0.31 * side, 0.57, -0.02, 0, 0, -0.5 * side);
      add(torso, cyl(0, 0.04, 0.12, 6), accent, 0.31 * side, 0.55, 0.08, 0.4, 0, -0.5 * side);
    }
    if (agent.look === 'bulky') add(torso, box(0.2, 0.06, 0.26), suit, 0.3 * side, 0.55, 0);
  }
  if (agent.look === 'bulky') add(torso, box(0.36, 0.42, 0.18), suit, 0, 0.32, 0.27);
  limb(torso, V(0, 0.48, 0), V(0, 0.58, 0), 0.06, under);

  // head
  const head = new THREE.Group();
  head.position.set(0, 0.63, 0);
  torso.add(head);
  const helmet = add(head, sph(0.14), suit, 0, 0, 0);
  helmet.scale.set(1, 1.08, 1.1);
  const visor = add(head, cached('visor', () => new THREE.SphereGeometry(0.145, 16, 8, Math.PI * 1.12, Math.PI * 0.76, Math.PI * 0.36, Math.PI * 0.22)), light, 0, 0, -0.005);
  visor.scale.set(1.02, 1.1, 1.12);
  add(head, box(0.2, 0.05, 0.14), under, 0, -0.1, 0.0);
  switch (agent.look) {
    case 'hood': {
      const hood = add(head, sph(0.18), under, 0, 0.02, 0.04);
      hood.scale.set(1.05, 1.05, 1.15);
      add(torso, box(0.42, 0.55, 0.04), under, 0, 0.22, 0.27, 0.12);
      break;
    }
    case 'halo': {
      const halo = add(head, cached('halo', () => new THREE.TorusGeometry(0.17, 0.018, 6, 24)), accent, 0, 0.22, 0.03);
      halo.rotation.x = Math.PI / 2 - 0.25;
      break;
    }
    case 'antenna':
      for (const side of [-1, 1]) {
        add(head, cyl(0.008, 0.008, 0.22, 5), under, 0.1 * side, 0.18, 0.06, -0.3, 0, -0.25 * side);
        add(head, sph(0.022), accent, 0.13 * side, 0.28, 0.1);
      }
      break;
    case 'fin':
      add(head, box(0.03, 0.09, 0.26), accent, 0, 0.15, 0.03);
      break;
    case 'spikes':
      for (let i = 0; i < 3; i++) add(head, cyl(0, 0.03, 0.12, 5), accent, (i - 1) * 0.06, 0.16, 0.06, -0.5, 0, (i - 1) * -0.3);
      break;
    case 'bulky':
      add(head, box(0.3, 0.07, 0.3), suit, 0, 0.11, 0.0);
      break;
  }

  // arms + gun, pivoting at shoulder height for aim pitch
  const aim = new THREE.Group();
  aim.position.set(0, 1.42, 0);
  body.add(aim);
  const gunHolder = new THREE.Group();
  gunHolder.position.set(0.08, -0.1, -0.42);
  aim.add(gunHolder);
  const rS = V(0.26 * bulky, 0, 0.02), rE = V(0.24, -0.22, -0.16), rH = V(0.09, -0.12, -0.4);
  const lS = V(-0.26 * bulky, 0, 0.02), lE = V(-0.24, -0.2, -0.3), lH = V(0.02, -0.07, -0.66);
  limb(aim, rS, rE, 0.07, suit); limb(aim, rE, rH, 0.06, under);
  limb(aim, lS, lE, 0.07, suit); limb(aim, lE, lH, 0.06, under);
  add(aim, sph(0.05), phong(0x15171b, 20), rH.x, rH.y, rH.z);
  add(aim, sph(0.05), phong(0x15171b, 20), lH.x, lH.y, lH.z);
  for (const [a, b] of [[rE, rH], [lE, lH]]) {
    const band = limb(aim, a.clone().lerp(b, 0.45), a.clone().lerp(b, 0.55), 0.064, accent, 0.01);
    band.scale.set(1, 1, 1);
  }

  return { root, body, torso, head, aim, legs, gunHolder, gun: null, muzzle: null, gunId: null, walk: 0 };
}

function lighten(hex, amt) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), amt);
  return c.getHex();
}

export function setCharacterGun(model, id) {
  if (model.gunId === id) return;
  if (model.gun) model.gunHolder.remove(model.gun);
  const { group, muzzle } = buildGun(id);
  group.scale.setScalar(1.1);
  model.gunHolder.add(group);
  model.gun = group; model.muzzle = muzzle; model.gunId = id;
  if (!model.flash) model.flash = buildFlash();
  muzzle.add(model.flash);
}

// Poses the rig for this frame.
export function animateCharacter(m, s, dt) {
  // s: { speed, crouch, pitch, dead, deadT, action, onGround }
  if (s.dead) {
    const k = Math.min(1, s.deadT * 4);
    m.root.rotation.x = k * Math.PI / 2 * 0.95;
    m.body.position.y = -k * 0.15;
    m.aim.rotation.x = 0.6 * k;
    for (const l of m.legs) { l.hip.rotation.x = 0.3 * k; l.knee.rotation.x = -0.4 * k; }
    return;
  }
  m.root.rotation.x = 0;
  const run = Math.min(s.speed / 5.4, 1);
  if (s.speed > 0.3) m.walk += dt * (3 + s.speed * 1.5);
  const cr = s.crouch;
  const sw = Math.sin(m.walk) * 0.65 * run;
  m.legs.forEach((l, i) => {
    const swing = i ? -sw : sw;
    const bend = Math.max(0, (i ? Math.sin(m.walk) : -Math.sin(m.walk))) * 0.9 * run;
    l.hip.rotation.x = swing + cr * 1.2 + (s.onGround ? 0 : 0.5);
    l.knee.rotation.x = -bend - cr * 2.2 - (s.onGround ? 0 : 0.9);
  });
  const bob = Math.abs(Math.cos(m.walk)) * 0.035 * run;
  m.body.position.y = -0.42 * cr + bob - (s.action ? 0.25 : 0);
  m.torso.rotation.x = cr * 0.25 + run * 0.08;
  m.torso.rotation.y = Math.sin(m.walk) * 0.08 * run;
  m.aim.rotation.x = s.pitch * 0.85 - (s.action ? 0.7 : 0);
  m.head.rotation.x = s.pitch * 0.4 - cr * 0.2;
}

// The objective device ("Core").
export function buildCore() {
  const g = new THREE.Group();
  add(g, cyl(0.28, 0.32, 0.16, 8), phong(0x2a2d33, 60), 0, 0.08, 0);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff3b5c });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 6, 20), glowMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.2;
  g.add(ring);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), glowMat);
  crystal.position.y = 0.45;
  g.add(crystal);
  return { group: g, crystal, ring, glowMat };
}

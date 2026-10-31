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

export { buildCharacter } from './people.js';

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

export { animateCharacter } from './people.js';

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

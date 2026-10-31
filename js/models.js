import * as THREE from '../lib/three.module.min.js?v=20261031055727';

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

import { buildGun } from './guns.js?v=20261031055727';
export { buildGun };

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

export { buildCharacter } from './people.js?v=20261031055727';

export function setCharacterGun(model, id, skins = null) {
  if (model.gunId === id) return;
  if (model.gun) model.gunHolder.remove(model.gun);
  const sk = skins?.[id] || {};
  const { group, muzzle } = buildGun(id, sk.skin || 'factory', sk.model || 'combat');
  group.scale.setScalar(1.1);
  model.gunHolder.add(group);
  model.gun = group; model.muzzle = muzzle; model.gunId = id;
  if (!model.flash) model.flash = buildFlash();
  muzzle.add(model.flash);
}

export { animateCharacter } from './people.js?v=20261031055727';

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

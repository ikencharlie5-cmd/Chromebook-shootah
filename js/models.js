import * as THREE from '../lib/three.module.min.js';

const boxCache = new Map();
function box(w, h, d) {
  const k = `${w},${h},${d}`;
  if (!boxCache.has(k)) boxCache.set(k, new THREE.BoxGeometry(w, h, d));
  return boxCache.get(k);
}

const mats = new Map();
function lambert(color) {
  if (!mats.has(color)) mats.set(color, new THREE.MeshLambertMaterial({ color }));
  return mats.get(color);
}

function part(parent, w, h, d, color, x, y, z, mat) {
  const m = new THREE.Mesh(box(w, h, d), mat || lambert(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

const METAL = 0x2b2f36;
const METAL2 = 0x40464f;

// Gun pointing down -Z with the grip at the origin. Returns { group, muzzle }.
export function buildGun(id, accent = 0x6a7b8c) {
  const g = new THREE.Group();
  let muzzleZ = -0.3;
  switch (id) {
    case 'knife':
      part(g, 0.035, 0.1, 0.12, 0x222222, 0, 0, 0.02);
      part(g, 0.012, 0.06, 0.26, 0xcfd6dc, 0, 0.02, -0.17);
      part(g, 0.05, 0.03, 0.03, METAL2, 0, 0.02, -0.04);
      muzzleZ = -0.3;
      break;
    case 'pip':
    case 'bolt': {
      const big = id === 'bolt';
      part(g, 0.05, 0.12, 0.06, 0x1d1f23, 0, -0.03, 0.02);
      part(g, 0.055, 0.06, big ? 0.28 : 0.22, big ? 0x8c8f94 : METAL, 0, 0.05, big ? -0.1 : -0.07);
      part(g, 0.02, 0.02, 0.03, accent, 0, 0.09, 0.02);
      muzzleZ = big ? -0.25 : -0.19;
      break;
    }
    case 'wasp':
      part(g, 0.05, 0.12, 0.06, 0x1d1f23, 0, -0.05, 0.03);
      part(g, 0.08, 0.1, 0.42, METAL, 0, 0.04, -0.12);
      part(g, 0.04, 0.2, 0.05, METAL2, 0, -0.08, -0.13);
      part(g, 0.03, 0.03, 0.12, METAL2, 0, 0.05, -0.38);
      part(g, 0.06, 0.06, 0.16, accent, 0, 0.05, 0.15);
      muzzleZ = -0.44;
      break;
    case 'talon':
      part(g, 0.05, 0.13, 0.06, 0x1d1f23, 0, -0.05, 0.03);
      part(g, 0.08, 0.11, 0.62, METAL, 0, 0.04, -0.18);
      part(g, 0.05, 0.2, 0.08, METAL2, 0, -0.1, -0.15);
      part(g, 0.03, 0.03, 0.22, METAL2, 0, 0.05, -0.58);
      part(g, 0.07, 0.11, 0.26, accent, 0, 0.02, 0.24);
      part(g, 0.03, 0.04, 0.12, 0x111111, 0, 0.12, -0.1);
      muzzleZ = -0.7;
      break;
    case 'lynx':
      part(g, 0.05, 0.13, 0.06, 0x1d1f23, 0, -0.05, 0.03);
      part(g, 0.08, 0.11, 0.6, 0x3b4a3a, 0, 0.04, -0.15);
      part(g, 0.035, 0.035, 0.45, METAL, 0, 0.05, -0.65);
      part(g, 0.06, 0.06, 0.28, 0x111111, 0, 0.15, -0.12);
      part(g, 0.08, 0.13, 0.3, accent, 0, 0.0, 0.27);
      muzzleZ = -0.88;
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
  const b = new THREE.Mesh(flashGeo, flashMat);
  b.rotation.y = Math.PI / 2;
  const c = new THREE.Mesh(flashGeo, flashMat);
  c.rotation.x = Math.PI / 2;
  grp.add(a, b, c);
  grp.visible = false;
  return grp;
}

// Low-poly soldier facing -Z. Feet at y = 0.
export function buildCharacter(teamColor, visorColor) {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = lambert(teamColor);
  const dark = lambert(0x23272e);
  const skin = lambert(0xc89b7b);

  const legPivotL = new THREE.Group(); legPivotL.position.set(-0.13, 0.88, 0);
  const legPivotR = new THREE.Group(); legPivotR.position.set(0.13, 0.88, 0);
  part(legPivotL, 0.2, 0.88, 0.24, 0, 0, -0.44, 0, dark);
  part(legPivotR, 0.2, 0.88, 0.24, 0, 0, -0.44, 0, dark);
  part(legPivotL, 0.22, 0.12, 0.3, 0, 0, -0.82, -0.04, lambert(0x15171a));
  part(legPivotR, 0.22, 0.12, 0.3, 0, 0, -0.82, -0.04, lambert(0x15171a));
  root.add(legPivotL, legPivotR);

  const upper = new THREE.Group();
  root.add(upper);
  part(upper, 0.56, 0.64, 0.32, 0, 0, 1.2, 0, body);
  part(upper, 0.6, 0.36, 0.36, 0, 0, 1.28, 0, dark);
  part(upper, 0.5, 0.1, 0.3, 0, 0, 0.92, 0, lambert(0x15171a));
  const head = new THREE.Group();
  head.position.set(0, 1.67, 0);
  upper.add(head);
  part(head, 0.28, 0.3, 0.28, 0, 0, 0, 0, skin);
  part(head, 0.32, 0.14, 0.32, 0, 0, 0.12, 0.01, body);
  const visor = new THREE.Mesh(box(0.26, 0.07, 0.04), new THREE.MeshBasicMaterial({ color: visorColor }));
  visor.position.set(0, 0.02, -0.15);
  head.add(visor);

  // arms reaching forward to hold the gun
  part(upper, 0.13, 0.13, 0.45, 0, 0.24, 1.32, -0.18, body);
  part(upper, 0.13, 0.13, 0.42, 0, -0.18, 1.3, -0.3, body).rotation.y = -0.5;
  const gunHolder = new THREE.Group();
  gunHolder.position.set(0.1, 1.3, -0.45);
  upper.add(gunHolder);

  return { root, legL: legPivotL, legR: legPivotR, upper, head, gunHolder, gun: null, muzzle: null, gunId: null };
}

export function setCharacterGun(model, id) {
  if (model.gunId === id) return;
  if (model.gun) model.gunHolder.remove(model.gun);
  const { group, muzzle } = buildGun(id, 0x555c66);
  group.scale.setScalar(1.15);
  model.gunHolder.add(group);
  model.gun = group; model.muzzle = muzzle; model.gunId = id;
  if (!model.flash) model.flash = buildFlash();
  muzzle.add(model.flash);
}

// The spinning objective device ("Core").
export function buildCore() {
  const g = new THREE.Group();
  part(g, 0.5, 0.18, 0.5, 0, 0, 0.09, 0, lambert(0x2a2d33));
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff3b5c });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 16), glowMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.2;
  g.add(ring);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), glowMat);
  crystal.position.y = 0.42;
  g.add(crystal);
  return { group: g, crystal, ring, glowMat };
}

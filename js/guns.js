import * as THREE from '../lib/three.module.min.js';
import { outlineMaterial } from './people.js';

// Weapon models. Every gun points down -Z with the grip at the origin.
// Bodies are built from beveled side profiles (shapes drawn in forward/up space and
// extruded sideways), then merged per material so each gun is only a few draw calls.

const MATS = {
  metal: new THREE.MeshPhongMaterial({ color: 0x2c3138, shininess: 90, specular: 0x8890a0 }),
  dark: new THREE.MeshPhongMaterial({ color: 0x1b1e23, shininess: 30, specular: 0x333844 }),
  steel: new THREE.MeshPhongMaterial({ color: 0x9aa2ad, shininess: 110, specular: 0xffffff }),
  blade: new THREE.MeshPhongMaterial({ color: 0xd8e0e8, shininess: 140, specular: 0xffffff }),
  wood: new THREE.MeshPhongMaterial({ color: 0x8a5a34, shininess: 40, specular: 0x553322 }),
  lens: new THREE.MeshPhongMaterial({ color: 0x1a3a4a, shininess: 160, specular: 0xffffff }),
};
const paintCache = new Map();
function paint(color) {
  if (!paintCache.has(color)) paintCache.set(color, new THREE.MeshPhongMaterial({ color, shininess: 60, specular: 0x666666 }));
  return paintCache.get(color);
}
const glowCache = new Map();
function glowMat(color) {
  if (!glowCache.has(color)) glowCache.set(color, new THREE.MeshBasicMaterial({ color }));
  return glowCache.get(color);
}
const INK = outlineMaterial(0x07090c, 0.0035);

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

class GunBuilder {
  constructor() { this.parts = new Map(); }

  put(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    _e.set(rx, ry, rz);
    g.applyMatrix4(new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz)));
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }

  // Side profile: pts are [forward, up] pairs (forward = -Z). Extruded `width` across X, centred.
  profile(mat, pts, width, x = 0, opts = {}) {
    const shape = new THREE.Shape();
    pts.forEach(([f, y], i) => (i ? shape.lineTo(f, y) : shape.moveTo(f, y)));
    shape.closePath();
    for (const h of opts.holes || []) {
      const path = new THREE.Path();
      h.forEach(([f, y], i) => (i ? path.lineTo(f, y) : path.moveTo(f, y)));
      path.closePath();
      shape.holes.push(path);
    }
    const bevel = opts.bevel ?? Math.min(0.008, width * 0.2);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.001, width - bevel * 2), bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel,
      bevelSegments: 2, curveSegments: 10,
    });
    g.rotateY(Math.PI / 2);          // shape x (forward) -> -Z, extrusion -> +X
    g.translate(-(width - bevel * 2) / 2 + x, 0, 0);
    return this.put(mat, g);
  }

  // Cylinder along the barrel axis (Z), from z0 to z1 (z0 > z1 since forward is -Z).
  tube(mat, r, z0, z1, y = 0, x = 0, seg = 16, r2 = r) {
    const len = Math.abs(z1 - z0);
    return this.put(mat, new THREE.CylinderGeometry(r2, r, len, seg), x, y, (z0 + z1) / 2, -Math.PI / 2);
  }

  box(mat, w, h, d, x, y, z, r = 0.004, rx = 0, ry = 0, rz = 0) {
    return this.put(mat, roundBox(w, h, d, r), x, y, z, rx, ry, rz);
  }

  build(outline = true) {
    const group = new THREE.Group();
    for (const [mat, list] of this.parts) {
      const geo = merge(list);
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      if (outline && !(mat instanceof THREE.MeshBasicMaterial)) {
        const ink = new THREE.Mesh(geo, INK);
        ink.userData.noShadow = true;
        mesh.add(ink);
      }
    }
    return group;
  }
}

function merge(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

function roundBox(w, h, d, r) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const g = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  const p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  const snap = (x, half) => { const t = Math.round((x / half + 1) * 1.5); return [-half, -half + r, half - r, half][t]; };
  for (let i = 0; i < p.count; i++) {
    v.set(snap(p.getX(i), w / 2), snap(p.getY(i), h / 2), snap(p.getZ(i), d / 2));
    c.set(Math.max(-w / 2 + r, Math.min(w / 2 - r, v.x)), Math.max(-h / 2 + r, Math.min(h / 2 - r, v.y)), Math.max(-d / 2 + r, Math.min(d / 2 - r, v.z)));
    const dv = v.clone().sub(c);
    if (dv.lengthSq() > 1e-12) v.copy(c).add(dv.normalize().multiplyScalar(r));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// a smooth arc of points (for curved magazines, trigger guards, grips)
function arc(cf, cy, r, a0, a1, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    out.push([cf + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

// ---------------------------------------------------------------------------

function knife(B) {
  // curved tanto blade
  B.profile(MATS.blade, [[0.02, 0.035], [0.2, 0.05], [0.27, 0.07], [0.3, 0.045], [0.24, 0.012], [0.02, 0.012]], 0.012, 0, { bevel: 0.003 });
  B.profile(glowMat(0x7ff6ff), [[0.05, 0.016], [0.24, 0.016], [0.29, 0.042], [0.285, 0.046], [0.235, 0.022], [0.05, 0.022]], 0.014, 0, { bevel: 0 });
  // guard + grip with finger grooves and a ring pommel
  B.box(MATS.metal, 0.05, 0.075, 0.02, 0, 0.02, -0.015, 0.008);
  B.profile(MATS.dark, [[-0.13, -0.01], [0.0, -0.015], [0.0, 0.03], [-0.03, 0.04], [-0.05, 0.03], [-0.07, 0.04], [-0.09, 0.03], [-0.13, 0.035]], 0.032, 0, { bevel: 0.008 });
  B.put(MATS.steel, new THREE.TorusGeometry(0.016, 0.005, 8, 18), 0, 0.012, 0.145, 0, Math.PI / 2, 0);
  B.box(paint(0x7ff6ff), 0.034, 0.008, 0.06, 0, 0.022, 0.07, 0.003);
  return -0.3;
}

function pistol(B, big) {
  const L = big ? 0.27 : 0.21, acc = big ? 0xd8a640 : 0x4fd8c8;
  // slide: rounded nose, flat top
  B.profile(big ? MATS.steel : MATS.metal, [[-0.035, 0.03], [L - 0.02, 0.03], [L, 0.045], [L - 0.005, 0.072], [-0.035, 0.074]], 0.05, 0, { bevel: 0.006 });
  // slide serrations
  for (let i = 0; i < 5; i++) B.box(MATS.dark, 0.052, 0.03, 0.004, 0, 0.052, 0.015 - i * 0.009, 0.001);
  // ejection port + vent cuts on the big one
  B.box(MATS.dark, 0.052, 0.012, 0.04, 0, 0.066, -0.06, 0.002);
  if (big) for (let i = 0; i < 3; i++) B.box(MATS.dark, 0.052, 0.012, 0.022, 0, 0.066, -0.13 - i * 0.04, 0.003);
  // frame with trigger guard (shape with a hole) and an angled grip
  B.profile(MATS.dark, [
    [-0.04, 0.03], [L - 0.04, 0.03], [L - 0.04, 0.012], [0.09, 0.008], ...arc(0.06, -0.005, 0.03, 0, -Math.PI, 6).slice(1),
    [0.022, -0.012], [0.0, -0.118], [-0.012, -0.128], [-0.06, -0.122], [-0.062, -0.1], [-0.048, -0.01], [-0.045, 0.03],
  ], 0.046, 0, { holes: [[[0.075, 0.0], ...arc(0.06, -0.005, 0.017, 0, -Math.PI, 6), [0.045, 0.0]]], bevel: 0.006 });
  // textured grip panels + trigger
  B.profile(paint(new THREE.Color(acc).multiplyScalar(0.7).getHex()), [[0.012, -0.025], [-0.004, -0.1], [-0.05, -0.098], [-0.042, -0.028]], 0.05, 0, { bevel: 0.004 });
  for (let i = 0; i < 4; i++) B.box(MATS.dark, 0.052, 0.004, 0.035, 0, -0.04 - i * 0.017, 0.022 + i * 0.002, 0.001);
  B.put(MATS.steel, new THREE.TorusGeometry(0.012, 0.004, 6, 10, Math.PI), 0, 0.0, -0.055, 0, Math.PI / 2, Math.PI / 2);
  // barrel
  B.tube(MATS.steel, 0.012, -L + 0.02, -L - (big ? 0.03 : 0.0), 0.05);
  if (big) B.tube(MATS.metal, 0.02, -L + 0.0, -L - 0.05, 0.05, 0, 8);
  // sights + mag base + accent
  B.box(MATS.dark, 0.012, 0.012, 0.01, 0, 0.08, -L + 0.02, 0.002);
  B.box(MATS.dark, 0.03, 0.012, 0.012, 0, 0.08, 0.025, 0.002);
  B.put(glowMat(acc), new THREE.SphereGeometry(0.0035, 8, 6), 0, 0.087, -L + 0.02);
  B.box(MATS.metal, 0.05, 0.012, 0.064, 0, -0.127, 0.035, 0.004);
  B.box(glowMat(acc), 0.052, 0.006, L * 0.6, 0, 0.034, -L * 0.45, 0.001);
  return -(L + (big ? 0.05 : 0.01));
}

function wasp(B) {
  const acc = 0xffc23a;
  // angular upper receiver
  B.profile(MATS.metal, [[-0.12, 0.0], [0.3, 0.0], [0.34, 0.03], [0.34, 0.085], [0.1, 0.1], [-0.12, 0.09]], 0.07, 0, { bevel: 0.01 });
  // lower with trigger guard and slanted grip
  B.profile(MATS.dark, [[-0.04, 0.0], [0.17, 0.0], [0.17, -0.03], ...arc(0.1, -0.02, 0.035, 0, -Math.PI, 6).slice(1), [0.04, -0.03], [0.03, -0.14], [-0.03, -0.145], [-0.06, -0.01]], 0.06, 0, { holes: [[[0.125, -0.012], ...arc(0.1, -0.02, 0.02, 0, -Math.PI, 6), [0.08, -0.012]]], bevel: 0.008 });
  // long straight magazine forward of the grip
  B.profile(MATS.dark, [[0.19, 0.0], [0.24, 0.0], [0.25, -0.21], [0.2, -0.215]], 0.04, 0, { bevel: 0.006 });
  B.box(paint(acc), 0.044, 0.016, 0.06, 0, -0.205, -0.225, 0.004);
  // shroud with honeycomb vents
  B.tube(MATS.dark, 0.034, -0.3, -0.44, 0.05, 0, 12);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) B.put(MATS.metal, new THREE.CylinderGeometry(0.008, 0.008, 0.01, 6), 0.033 * s, 0.05, -0.32 - i * 0.03, 0, 0, Math.PI / 2);
  B.tube(MATS.steel, 0.014, -0.44, -0.48, 0.05);
  // folding wire stock
  for (const y of [0.07, 0.01]) B.tube(MATS.metal, 0.008, 0.11, 0.3, y);
  B.box(MATS.dark, 0.05, 0.09, 0.025, 0, 0.04, 0.31, 0.008);
  // red dot + rail
  B.box(MATS.dark, 0.03, 0.01, 0.24, 0, 0.105, -0.1, 0.002);
  B.box(MATS.metal, 0.04, 0.045, 0.06, 0, 0.13, -0.06, 0.01);
  B.put(glowMat(0xff3048), new THREE.SphereGeometry(0.004, 8, 6), 0, 0.135, -0.03);
  B.put(MATS.lens, new THREE.CircleGeometry(0.016, 14), 0, 0.132, -0.031);
  // paint stripe
  B.box(glowMat(acc), 0.072, 0.008, 0.18, 0, 0.065, -0.14, 0.002);
  return -0.49;
}

function talon(B) {
  const acc = 0xff7a2a;
  // receiver with sculpted top
  B.profile(MATS.metal, [[-0.15, 0.0], [0.25, 0.0], [0.27, 0.035], [0.27, 0.1], [0.05, 0.11], [-0.15, 0.1]], 0.075, 0, { bevel: 0.01 });
  // handguard with slots
  B.profile(MATS.dark, [[0.25, 0.005], [0.6, 0.012], [0.62, 0.035], [0.62, 0.095], [0.25, 0.1]], 0.07, 0, { bevel: 0.012 });
  for (let i = 0; i < 5; i++) B.box(MATS.metal, 0.072, 0.012, 0.035, 0, 0.055, -0.32 - i * 0.06, 0.005);
  // lower: guard + grip
  B.profile(MATS.dark, [[-0.06, 0.0], [0.15, 0.0], [0.15, -0.025], ...arc(0.09, -0.02, 0.033, 0, -Math.PI, 6).slice(1), [0.04, -0.03], [0.025, -0.15], [-0.035, -0.155], [-0.07, -0.01]], 0.062, 0, { holes: [[[0.112, -0.012], ...arc(0.09, -0.02, 0.019, 0, -Math.PI, 6), [0.068, -0.012]]], bevel: 0.008 });
  // curved magazine
  const mag = [...arc(0.42, -0.02, 0.27, Math.PI * 0.97, Math.PI * 1.23, 8), ...arc(0.42, -0.02, 0.215, Math.PI * 1.23, Math.PI * 0.97, 8)];
  B.profile(paint(0x3a3f46), mag, 0.045, 0, { bevel: 0.006 });
  // stock with cheek rest + butt pad
  B.profile(MATS.dark, [[-0.15, 0.1], [-0.42, 0.075], [-0.43, -0.07], [-0.36, -0.07], [-0.25, -0.01], [-0.15, -0.0]], 0.06, 0, { bevel: 0.012 });
  B.box(paint(acc), 0.064, 0.02, 0.09, 0, 0.088, 0.3, 0.008);
  B.box(MATS.metal, 0.066, 0.15, 0.025, 0, 0.0, 0.43, 0.01);
  // barrel + muzzle brake
  B.tube(MATS.steel, 0.014, -0.62, -0.78, 0.055);
  B.tube(MATS.metal, 0.024, -0.76, -0.86, 0.055, 0, 10);
  for (const s of [-1, 1]) B.box(MATS.dark, 0.01, 0.014, 0.05, 0.024 * s, 0.055, -0.81, 0.002);
  // top rail + holographic sight
  B.box(MATS.dark, 0.034, 0.012, 0.42, 0, 0.115, -0.15, 0.002);
  for (let i = 0; i < 10; i++) B.box(MATS.metal, 0.036, 0.006, 0.012, 0, 0.123, 0.02 - i * 0.04, 0.001);
  B.profile(MATS.metal, [[0.04, 0.125], [0.14, 0.125], [0.135, 0.2], [0.115, 0.2], [0.115, 0.14], [0.065, 0.14], [0.065, 0.2], [0.045, 0.2]], 0.05, 0, { bevel: 0.004 });
  B.put(MATS.lens, new THREE.PlaneGeometry(0.044, 0.05), 0, 0.17, -0.09, 0, 0, 0);
  B.put(glowMat(0xff3048), new THREE.TorusGeometry(0.008, 0.0016, 6, 16), 0, 0.17, -0.091);
  // front sight post
  B.box(MATS.dark, 0.012, 0.04, 0.012, 0, 0.12, -0.58, 0.003);
  // paint accents
  B.box(glowMat(acc), 0.077, 0.008, 0.3, 0, 0.03, -0.42, 0.002);
  B.box(paint(acc), 0.064, 0.03, 0.08, 0, -0.005, 0.0, 0.006);
  return -0.87;
}

function lynx(B) {
  const camo = 0x4a5a3c, acc = 0x5dffb0;
  // thumbhole stock + chassis
  B.profile(paint(camo), [
    [0.32, 0.0], [0.32, 0.085], [-0.08, 0.085], [-0.2, 0.06], [-0.48, 0.07], [-0.5, -0.09], [-0.42, -0.1],
    [-0.28, -0.03], [-0.1, -0.03], [-0.03, -0.14], [0.03, -0.14], [0.05, -0.02], [0.32, -0.02],
  ], 0.07, 0, { holes: [[[-0.07, -0.005], [-0.2, 0.0], [-0.24, 0.04], [-0.1, 0.045]]], bevel: 0.012 });
  B.box(MATS.dark, 0.072, 0.17, 0.03, 0, -0.01, 0.49, 0.01);
  // trigger guard
  B.put(MATS.metal, new THREE.TorusGeometry(0.03, 0.006, 6, 14, Math.PI), 0, -0.02, -0.08, 0, Math.PI / 2, Math.PI);
  // action + bolt handle
  B.tube(MATS.metal, 0.032, 0.1, -0.3, 0.1, 0, 16);
  B.tube(MATS.steel, 0.012, 0.0, 0.0 - 0.001, 0.1);
  B.put(MATS.steel, new THREE.CylinderGeometry(0.007, 0.007, 0.08, 8), 0.05, 0.09, 0.02, 0, 0, Math.PI / 2 + 0.4);
  B.put(MATS.dark, new THREE.SphereGeometry(0.016, 12, 8), 0.088, 0.075, 0.02);
  // fluted barrel + suppressor
  B.tube(MATS.steel, 0.02, -0.3, -0.85, 0.1, 0, 12, 0.016);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; B.box(MATS.dark, 0.006, 0.006, 0.45, Math.cos(a) * 0.017, 0.1 + Math.sin(a) * 0.017, -0.58, 0.001); }
  B.tube(MATS.dark, 0.032, -0.85, -1.05, 0.1, 0, 18);
  B.tube(paint(acc), 0.033, -0.87, -0.89, 0.1, 0, 18);
  // magazine
  B.box(MATS.dark, 0.05, 0.09, 0.09, 0, -0.06, -0.02, 0.01);
  // scope: tube, bells, turrets, glowing lens
  B.tube(MATS.dark, 0.024, 0.13, -0.17, 0.17, 0, 18);
  B.tube(MATS.dark, 0.042, -0.17, -0.29, 0.17, 0, 20, 0.026);
  B.tube(MATS.dark, 0.034, 0.21, 0.13, 0.17, 0, 20, 0.024);
  B.put(MATS.dark, new THREE.CylinderGeometry(0.017, 0.017, 0.03, 12), 0, 0.2, -0.02);
  B.put(MATS.dark, new THREE.CylinderGeometry(0.017, 0.017, 0.03, 12), 0.03, 0.17, -0.02, 0, 0, Math.PI / 2);
  B.put(glowMat(acc), new THREE.CircleGeometry(0.037, 20), 0, 0.17, -0.292, Math.PI, 0, 0);
  B.put(MATS.lens, new THREE.CircleGeometry(0.03, 20), 0, 0.17, 0.211);
  for (const z of [0.06, -0.1]) B.box(MATS.metal, 0.02, 0.06, 0.03, 0, 0.13, z, 0.004);
  // folded bipod
  for (const s of [-1, 1]) B.tube(MATS.metal, 0.006, -0.3, -0.52, -0.005, 0.02 * s);
  B.box(glowMat(acc), 0.072, 0.008, 0.25, 0, 0.04, 0.1, 0.002);
  return -1.06;
}

export function buildGun(id) {
  const B = new GunBuilder();
  let muzzleZ;
  switch (id) {
    case 'knife': muzzleZ = knife(B); break;
    case 'pip': muzzleZ = pistol(B, false); break;
    case 'bolt': muzzleZ = pistol(B, true); break;
    case 'wasp': muzzleZ = wasp(B); break;
    case 'talon': muzzleZ = talon(B); break;
    case 'lynx': muzzleZ = lynx(B); break;
    default: muzzleZ = pistol(B, false);
  }
  const group = B.build();
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, id === 'lynx' ? 0.1 : 0.05, muzzleZ);
  group.add(muzzle);
  return { group, muzzle };
}

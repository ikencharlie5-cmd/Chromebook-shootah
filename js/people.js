import * as THREE from '../lib/three.module.min.js';

// Chunky cartoon people: big heads with faces, hair, outfits. Each body part group is merged
// into one cel-shaded mesh (+ an outline shell) to keep draw calls low.

export const toonGradient = (() => {
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

export const toonMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient, side: THREE.DoubleSide });
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });

const outlineCache = new Map();
export function outlineMaterial(color, thickness) {
  const key = `${color}:${thickness}`;
  if (outlineCache.has(key)) return outlineCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed += normal * ${thickness.toFixed(4)};`);
  };
  m.customProgramCacheKey = () => `outline${thickness}`;
  outlineCache.set(key, m);
  return m;
}

const G = {
  sph: (r, ws = 16, hs = 12) => new THREE.SphereGeometry(r, ws, hs),
  cap: (r, l) => new THREE.CapsuleGeometry(r, l, 4, 12),
  cyl: (r1, r2, h, n = 14, open = false) => new THREE.CylinderGeometry(r1, r2, h, n, 1, open),
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  rbox: (w, h, d, r) => roundedBox(w, h, d, r),
  torus: (r, t, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 8, 20, arc),
  cone: (r, h, n = 8) => new THREE.ConeGeometry(r, h, n),
  // smooth body of revolution from [radius, y] pairs
  lathe: (pts, n = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n),
};

function roundedBox(w, h, d, r) {
  const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
  const p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    v.sub(c).normalize().multiplyScalar(r).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// Collects parts per bone, then merges them.
class Rig {
  constructor() { this.parts = new Map(); }

  // kind: false/'std' (outlined), true/'glow' (unlit), 'flat' (shaded, no outline — small face details)
  push(bone, geo, color, m, glow) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(m);
    const n = g.attributes.position.count, c = new THREE.Color(color), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this.parts.has(bone)) this.parts.set(bone, { std: [], glow: [], flat: [] });
    this.parts.get(bone)[glow === 'flat' ? 'flat' : glow ? 'glow' : 'std'].push(g);
  }

  add(bone, geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, glow = false) {
    _e.set(rx, ry, rz);
    const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
    this.push(bone, geo, color, m, glow);
  }

  glow(bone, geo, color, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    this.add(bone, geo, color, x, y, z, rx, ry, rz, sx, sy, sz, true);
  }

  flat(bone, geo, color, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    this.add(bone, geo, color, x, y, z, rx, ry, rz, sx, sy, sz, 'flat');
  }

  // capsule/cylinder stretched between two points
  limb(bone, a, b, r, color, tapered = 0) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = tapered ? G.cyl(r * (1 - tapered), r, len) : G.cap(r, Math.max(0.01, len));
    const m = new THREE.Matrix4().compose(a.clone().addScaledVector(dir, 0.5), _q.setFromUnitVectors(_up, dir.normalize()), _s.set(1, 1, 1));
    this.push(bone, geo, color, m, false);
  }

  finish(outline) {
    for (const [bone, { std, glow, flat }] of this.parts) {
      if (flat.length) bone.add(new THREE.Mesh(merge(flat), toonMat));
      if (std.length) {
        const geo = merge(std);
        const mesh = new THREE.Mesh(geo, toonMat);
        bone.add(mesh);
        const shell = new THREE.Mesh(geo, outline);
        shell.userData.noShadow = true;
        bone.add(shell);
      }
      if (glow.length) {
        const mesh = new THREE.Mesh(merge(glow), glowMat);
        mesh.userData.noShadow = true;
        bone.add(mesh);
      }
    }
  }
}

function merge(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// ---------------------------------------------------------------------------

export function buildCharacter(agent, teamColor, isEnemy = false) {
  const A = agent;
  const rig = new Rig();
  const big = A.style === 'beard' ? 1.1 : 1;

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = new THREE.Group();
  root.add(body);

  // ---- legs: tapered thigh + shin, one smooth shoe
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.105 * side * big, 0.93, 0);
    body.add(hip);
    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    hip.add(knee);
    rig.add(hip, G.lathe([[0.001, 0.04], [0.085, 0.02], [0.092 * big, -0.08], [0.08, -0.3], [0.068, -0.44], [0.001, -0.47]], 16), A.pants);
    rig.add(knee, G.lathe([[0.001, 0.03], [0.068, 0.0], [0.072, -0.12], [0.058, -0.34], [0.05, -0.38], [0.001, -0.4]], 16), A.pants);
    rig.add(knee, G.rbox(0.13, 0.11, 0.27, 0.05), A.shoes, 0, -0.43, -0.045);
    rig.add(knee, G.rbox(0.135, 0.03, 0.275, 0.014), mix(A.shoes, 0xffffff, 0.7), 0, -0.475, -0.045);
    legs.push({ hip, knee });
  }

  // ---- pelvis + torso as smooth turned shapes (flattened front-to-back)
  rig.add(body, G.lathe([[0.001, 1.06], [0.165, 1.04], [0.19 * big, 0.97], [0.18 * big, 0.88], [0.12, 0.83], [0.001, 0.82]], 20), A.pants, 0, 0, 0, 0, 0, 0, 1, 1, 0.72);
  const torso = new THREE.Group();
  torso.position.set(0, 0.99, 0);
  body.add(torso);
  const jacket = A.style === 'beard' ? A.outfit2 : A.outfit;
  rig.add(torso, G.lathe([[0.001, -0.02], [0.175 * big, 0.0], [0.19 * big, 0.12], [0.225 * big, 0.3], [0.23 * big, 0.38], [0.2 * big, 0.45], [0.09, 0.5], [0.001, 0.51]], 22), jacket, 0, 0, 0, 0, 0, 0, 1, 1, 0.68);
  rig.add(torso, G.cyl(0.06, 0.065, 0.12, 14), A.skin, 0, 0.52, 0);

  // ---- head (slightly big, friendly)
  const head = new THREE.Group();
  head.position.set(0, 0.67, 0);
  torso.add(head);
  rig.add(head, G.sph(0.165, 24, 18), A.skin, 0, 0, 0, 0, 0, 0, 0.96, 1.04, 0.98);
  for (const s of [-1, 1]) rig.add(head, G.sph(0.04, 12, 10), A.skin, 0.157 * s, -0.005, 0.01, 0, 0, 0, 0.45, 0.85, 0.7);
  face(rig, head, A);
  hair(rig, head, torso, body, A, big);
  outfit(rig, torso, body, A, big);

  // ---- arms holding the gun (pivot at shoulder height for aiming)
  const aim = new THREE.Group();
  aim.position.set(0, 1.4, 0);
  body.add(aim);
  const gunHolder = new THREE.Group();
  gunHolder.position.set(0.08, -0.1, -0.42);
  aim.add(gunHolder);
  const bare = A.style === 'mohawk';
  const sleeve = bare ? A.skin : jacket;
  const rS = V(0.225 * big, 0, 0.02), rE = V(0.22 * big, -0.22, -0.13), rH = V(0.085, -0.12, -0.4);
  const lS = V(-0.225 * big, 0, 0.02), lE = V(-0.2 * big, -0.2, -0.3), lH = V(0.02, -0.07, -0.64);
  rig.add(aim, G.sph(0.085 * big, 16, 12), jacket, rS.x, rS.y, rS.z);
  rig.add(aim, G.sph(0.085 * big, 16, 12), jacket, lS.x, lS.y, lS.z);
  rig.limb(aim, rS, rE, 0.062 * big, sleeve); rig.limb(aim, rE, rH, 0.054 * big, sleeve);
  rig.limb(aim, lS, lE, 0.062 * big, sleeve); rig.limb(aim, lE, lH, 0.054 * big, sleeve);
  rig.add(aim, G.sph(0.055, 14, 10), A.glove, rH.x, rH.y, rH.z, 0, 0, 0, 1, 0.85, 1.25);
  rig.add(aim, G.sph(0.055, 14, 10), A.glove, lH.x, lH.y, lH.z, 0, 0, 0, 1, 0.85, 1.25);
  // team armband — always readable
  const band = lS.clone().lerp(lE, 0.5);
  const dir = new THREE.Vector3().subVectors(lE, lS).normalize();
  const m = new THREE.Matrix4().compose(band, new THREE.Quaternion().setFromUnitVectors(_up, dir), _s.set(1, 1, 1));
  rig.push(aim, G.cyl(0.066 * big, 0.066 * big, 0.05, 16), teamColor, m, true);
  if (bare) rig.glow(aim, G.box(0.015, 0.1, 0.015), A.accent, rE.x + 0.05, rE.y - 0.03, rE.z - 0.1, 0.9, 0, 0.5);

  rig.finish(outlineMaterial(isEnemy ? 0xff2436 : 0x0e1a20, isEnemy ? 0.016 : 0.009));
  return { root, body, torso, head, aim, legs, gunHolder, gun: null, muzzle: null, gunId: null, walk: 0 };
}

function face(rig, head, A) {
  const angry = A.mood === 'angry' || A.mood === 'stern';
  for (const s of [-1, 1]) {
    rig.flat(head, G.sph(0.038, 14, 10), 0xffffff, 0.058 * s, 0.018, -0.142, 0, 0, 0, 0.82, angry ? 0.9 : 1.08, 0.42);
    rig.flat(head, G.sph(0.021, 12, 8), 0x1d1a24, 0.056 * s, 0.016, -0.157, 0, 0, 0, 1, 1.1, 0.5);
    rig.glow(head, G.sph(0.0065, 8, 6), 0xffffff, 0.05 * s, 0.026, -0.166);
    const tilt = { angry: 0.38, stern: 0.12, calm: -0.05, kind: -0.22, happy: -0.12, grin: 0.04 }[A.mood] || 0;
    rig.flat(head, G.rbox(0.06, A.style === 'beard' ? 0.022 : 0.016, 0.02, 0.007), A.style === 'medic' ? 0xa8acb4 : shade(A.hair, 0.75), 0.06 * s, 0.075, -0.152, 0, 0, -tilt * s);
    if (A.mood === 'happy' || A.mood === 'kind') rig.flat(head, G.sph(0.022, 10, 8), 0xf29a96, 0.088 * s, -0.035, -0.135, 0, 0, 0, 1, 0.6, 0.35);
    if (A.style === 'spiky') for (let k = 0; k < 3; k++) rig.flat(head, G.sph(0.006, 6, 6), 0xb0603a, (0.072 + k * 0.015) * s, -0.035 + (k % 2) * 0.01, -0.152, 0, 0, 0, 1, 1, 0.4);
  }
  rig.flat(head, G.sph(0.022, 12, 10), shade(A.skin, 0.92), 0, -0.028, -0.16, 0, 0, 0, 0.9, 0.85, 0.9);
  const my = -0.082, mz = -0.148;
  if (A.mood === 'happy' || A.mood === 'kind' || A.mood === 'calm') {
    rig.flat(head, G.torus(0.03, 0.007, Math.PI), 0x6a2424, 0, my + 0.014, mz, 0, 0, Math.PI, 1, A.mood === 'calm' ? 0.4 : 0.75, 1);
  } else if (A.mood === 'grin') {
    rig.flat(head, G.rbox(0.072, 0.024, 0.014, 0.009), 0xffffff, 0.006, my, mz - 0.002, 0, 0, -0.08);
  } else {
    rig.flat(head, G.rbox(0.055, 0.011, 0.014, 0.005), 0x6a2424, 0, my, mz, 0, 0, A.mood === 'angry' ? 0.08 : 0);
  }
}

function hair(rig, head, torso, body, A, big) {
  const H = A.hair;
  const cap = (t) => new THREE.SphereGeometry(0.172, 24, 14, 0, Math.PI * 2, 0, Math.PI * t);
  switch (A.style) {
    case 'hood': {
      rig.add(head, cap(0.36), H, 0, 0.012, 0, 0.5);
      const hood = new THREE.SphereGeometry(0.205, 24, 16, Math.PI * 1.5 + 0.9, Math.PI * 2 - 1.8, 0, Math.PI * 0.74);
      rig.add(head, hood, A.outfit, 0, 0.015, 0.02, 0, 0, 0, 1, 1.06, 1.06);
      rig.add(head, G.torus(0.16, 0.024, Math.PI * 1.2), A.outfit2, 0, 0.0, -0.11, 0, 0, Math.PI * 1.4, 1.02, 1.12, 1);
      for (const s of [-1, 1]) rig.glow(head, G.box(0.009, 0.05, 0.008), A.accent, 0.095 * s, -0.035, -0.13, 0.4, 0, 0.3 * s);
      rig.add(body, G.lathe([[0.2, 0.0], [0.24, -0.25], [0.28, -0.46]], 22), A.outfit, 0, 1.02, 0.01, 0, 0, 0, 1, 1, 0.72);
      break;
    }
    case 'medic':
      rig.add(head, cap(0.5), H, 0, 0.012, 0.012, 0.42);
      rig.add(head, G.sph(0.17, 22, 16), H, 0, -0.035, 0.065, 0, 0, 0, 1.04, 0.92, 0.74);
      for (const s of [-1, 1]) rig.flat(head, G.torus(0.033, 0.006, Math.PI * 2), 0x2a3a3a, 0.058 * s, 0.018, -0.168);
      rig.flat(head, G.box(0.04, 0.006, 0.006), 0x2a3a3a, 0, 0.022, -0.17);
      break;
    case 'afro':
      rig.add(head, G.sph(0.21, 24, 18), H, 0, 0.085, 0.05, 0, 0, 0, 1.08, 0.88, 1.0);
      rig.add(head, G.torus(0.172, 0.014, Math.PI * 2), 0x3a2a1a, 0, 0.075, 0, Math.PI / 2 - 0.2);
      for (const s of [-1, 1]) {
        rig.add(head, G.cyl(0.034, 0.034, 0.03, 16), 0x3a2a1a, 0.055 * s, 0.11, -0.15, Math.PI / 2 - 0.25);
        rig.glow(head, G.cyl(0.026, 0.026, 0.006, 16), 0xffa040, 0.055 * s, 0.112, -0.166, Math.PI / 2 - 0.25);
      }
      break;
    case 'spiky': {
      rig.add(head, cap(0.44), H, 0, 0.012, 0.01, 0.35);
      const spikes = [[0, 0.16, -0.03, -0.55, 0], [0.075, 0.15, 0.0, -0.3, -0.45], [-0.075, 0.15, 0.0, -0.3, 0.45], [0.04, 0.15, 0.09, 0.45, -0.25], [-0.04, 0.15, 0.09, 0.45, 0.25]];
      for (const [x, y, z, rx, rz] of spikes) rig.add(head, G.cone(0.06, 0.17, 12), H, x, y, z, rx, 0, rz);
      break;
    }
    case 'mohawk':
      rig.add(head, cap(0.42), shade(A.skin, 0.8), 0, 0.004, 0, 0.3);
      rig.add(head, G.lathe([[0.001, -0.1], [0.04, -0.06], [0.045, 0.05], [0.03, 0.12], [0.001, 0.14]], 12), H, 0, 0.17, 0.02, Math.PI / 2 - 0.15, 0, 0, 0.55, 1.35, 1);
      rig.add(torso, G.torus(0.105, 0.016, Math.PI * 2), 0x222228, 0, 0.53, 0.0, Math.PI / 2 + 0.3);
      for (const s of [-1, 1]) rig.add(torso, G.cyl(0.04, 0.04, 0.035, 16), 0x222228, 0.105 * s, 0.51, -0.035, 0, 0, Math.PI / 2);
      rig.glow(torso, G.cyl(0.028, 0.028, 0.037, 16), A.accent, 0.105, 0.51, -0.035, 0, 0, Math.PI / 2);
      break;
    case 'beard':
      rig.add(head, G.sph(0.135, 20, 14), H, 0, -0.075, -0.055, 0, 0, 0, 1.1, 1.0, 0.85);
      rig.flat(head, G.rbox(0.1, 0.028, 0.035, 0.013), H, 0, -0.058, -0.158);
      break;
  }
}

function outfit(rig, torso, body, A, big) {
  switch (A.style) {
    case 'medic':
      rig.add(torso, G.torus(0.095, 0.03, Math.PI * 2), A.outfit, 0, 0.47, 0, Math.PI / 2);
      rig.glow(torso, G.box(0.08, 0.024, 0.01), A.outfit2, 0, 0.3, 0.158);
      rig.glow(torso, G.box(0.024, 0.08, 0.01), A.outfit2, 0, 0.3, 0.158);
      rig.flat(torso, G.box(0.016, 0.38, 0.01), A.outfit2, 0, 0.24, -0.158);
      break;
    case 'afro':
      rig.add(torso, G.torus(0.12, 0.045, Math.PI * 2), A.outfit2, 0, 0.47, 0, Math.PI / 2);
      rig.flat(torso, G.box(0.014, 0.36, 0.01), 0x8a6a1a, 0, 0.24, -0.158);
      break;
    case 'spiky':
      for (const s of [-1, 1]) rig.add(torso, G.rbox(0.07, 0.12, 0.03, 0.012), A.outfit, 0.085 * s, 0.48, -0.06, -0.3, 0, 0.3 * s);
      rig.flat(torso, G.box(0.13, 0.34, 0.01), 0x2a2a2e, 0, 0.25, -0.158);
      break;
    case 'mohawk':
      rig.glow(torso, G.box(0.018, 0.36, 0.01), A.accent, 0, 0.24, -0.158);
      break;
    case 'beard':
      rig.add(torso, G.rbox(0.33, 0.22, 0.06, 0.03), shade(A.outfit2, 1.2), 0, 0.27, -0.155 * big);
      rig.glow(torso, G.box(0.14, 0.018, 0.01), A.accent, 0, 0.36, -0.188 * big);
      break;
    default:
      rig.flat(torso, G.box(0.016, 0.38, 0.01), A.outfit2, 0, 0.24, -0.158);
  }
  rig.add(body, G.cyl(0.185 * big, 0.185 * big, 0.045, 22), shade(A.outfit2, 0.8), 0, 1.0, 0, 0, 0, 0, 1, 1, 0.73);
}

// Poses the rig for this frame.
export function animateCharacter(m, s, dt) {
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
  else m.walk += dt * 1.2 * 0;
  m.idle = (m.idle || 0) + dt;
  const cr = s.crouch;
  const sw = Math.sin(m.walk) * 0.7 * run;
  m.legs.forEach((l, i) => {
    const swing = i ? -sw : sw;
    const bend = Math.max(0, (i ? Math.sin(m.walk) : -Math.sin(m.walk))) * 1.0 * run;
    l.hip.rotation.x = swing + cr * 1.2 + (s.onGround ? 0 : 0.5);
    l.knee.rotation.x = -bend - cr * 2.2 - (s.onGround ? 0 : 0.9);
  });
  const bob = Math.abs(Math.cos(m.walk)) * 0.04 * run;
  const breathe = Math.sin(m.idle * 2.2) * 0.008;
  m.body.position.y = -0.42 * cr + bob - (s.action ? 0.25 : 0);
  m.torso.rotation.x = cr * 0.25 + run * 0.1;
  m.torso.rotation.y = Math.sin(m.walk) * 0.1 * run;
  m.torso.scale.y = 1 + breathe;
  m.aim.rotation.x = s.pitch * 0.85 - (s.action ? 0.7 : 0);
  m.head.rotation.x = s.pitch * 0.4 - cr * 0.2;
  m.head.rotation.z = Math.sin(m.walk * 0.5) * 0.04 * run;
}

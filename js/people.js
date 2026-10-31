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
  const big = A.style === 'beard' ? 1.14 : 1;

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = new THREE.Group();
  root.add(body);

  // ---- legs
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.13 * side * big, 0.86, 0);
    body.add(hip);
    const knee = new THREE.Group();
    knee.position.set(0, -0.42, 0);
    hip.add(knee);
    rig.limb(hip, V(0, 0.02, 0), V(0, -0.42, 0), 0.115 * big, A.pants);
    rig.limb(knee, V(0, 0, 0), V(0, -0.34, 0), 0.1 * big, A.pants);
    // chunky sneakers / boots
    rig.add(knee, G.rbox(0.19, 0.14, 0.32, 0.06), A.shoes, 0, -0.4, -0.05);
    rig.add(knee, G.rbox(0.2, 0.04, 0.33, 0.02), mix(A.shoes, 0xffffff, 0.6), 0, -0.46, -0.05);
    if (A.style === 'beard' || A.style === 'mohawk') rig.add(knee, G.rbox(0.16, 0.16, 0.08, 0.04), A.outfit2, 0, -0.04, -0.09);
    legs.push({ hip, knee });
  }

  // ---- hips + torso
  rig.add(body, G.sph(0.21), A.pants, 0, 0.9, 0, 0, 0, 0, 1.05 * big, 0.55, 0.8 * big);
  rig.add(body, G.cyl(0.215 * big, 0.215 * big, 0.06), shade(A.outfit2, 0.8), 0, 0.98, 0, 0, 0, 0, 1, 1, 0.8);
  const torso = new THREE.Group();
  torso.position.set(0, 0.95, 0);
  body.add(torso);
  rig.add(torso, G.rbox(0.52 * big, 0.5, 0.34 * big, 0.13), A.outfit, 0, 0.27, 0);
  rig.add(torso, G.cyl(0.075, 0.08, 0.12), A.skin, 0, 0.56, 0);

  // ---- head
  const head = new THREE.Group();
  head.position.set(0, 0.7, 0);
  torso.add(head);
  rig.add(head, G.sph(0.2, 20, 16), A.skin, 0, 0, 0, 0, 0, 0, 1, 1.04, 0.96);
  for (const s of [-1, 1]) rig.add(head, G.sph(0.05), shade(A.skin, 0.95), 0.198 * s, -0.01, 0.01, 0, 0, 0, 0.5, 0.95, 0.8);
  face(rig, head, A);
  hair(rig, head, torso, body, A, big);

  // ---- outfit details on the torso
  outfit(rig, torso, body, A, big);

  // ---- arms holding the gun (pivot at shoulder height for aiming)
  const aim = new THREE.Group();
  aim.position.set(0, 1.37, 0);
  body.add(aim);
  const gunHolder = new THREE.Group();
  gunHolder.position.set(0.08, -0.1, -0.42);
  aim.add(gunHolder);
  const sleeve = A.style === 'mohawk' ? A.skin : A.outfit;
  const fore = A.style === 'mohawk' || A.style === 'spiky' ? (A.style === 'mohawk' ? A.skin : A.outfit) : A.outfit;
  const rS = V(0.28 * big, 0, 0.02), rE = V(0.25 * big, -0.23, -0.15), rH = V(0.09, -0.12, -0.4);
  const lS = V(-0.28 * big, 0, 0.02), lE = V(-0.25 * big, -0.21, -0.3), lH = V(0.02, -0.07, -0.66);
  rig.add(aim, G.sph(0.11 * big), A.outfit, rS.x, rS.y + 0.01, rS.z);
  rig.add(aim, G.sph(0.11 * big), A.outfit, lS.x, lS.y + 0.01, lS.z);
  rig.limb(aim, rS, rE, 0.08 * big, sleeve); rig.limb(aim, rE, rH, 0.07 * big, fore);
  rig.limb(aim, lS, lE, 0.08 * big, sleeve); rig.limb(aim, lE, lH, 0.07 * big, fore);
  rig.add(aim, G.sph(0.08), A.glove, rH.x, rH.y, rH.z, 0, 0, 0, 1, 0.9, 1.2);
  rig.add(aim, G.sph(0.08), A.glove, lH.x, lH.y, lH.z, 0, 0, 0, 1, 0.9, 1.2);
  // team armband — always readable
  const band = lS.clone().lerp(lE, 0.45);
  const dir = new THREE.Vector3().subVectors(lE, lS).normalize();
  const m = new THREE.Matrix4().compose(band, new THREE.Quaternion().setFromUnitVectors(_up, dir), _s.set(1, 1, 1));
  rig.push(aim, G.cyl(0.088 * big, 0.088 * big, 0.06), teamColor, m, true);
  if (A.style === 'mohawk') {
    // lightning tattoo glowing on the forearm
    rig.glow(aim, G.box(0.02, 0.12, 0.02), A.accent, rE.x + 0.06, rE.y - 0.03, rE.z - 0.1, 0.9, 0, 0.5);
  }

  rig.finish(outlineMaterial(isEnemy ? 0xff2436 : 0x0b2a30, isEnemy ? 0.022 : 0.014));
  return { root, body, torso, head, aim, legs, gunHolder, gun: null, muzzle: null, gunId: null, walk: 0 };
}

function face(rig, head, A) {
  const angry = A.mood === 'angry' || A.mood === 'stern';
  for (const s of [-1, 1]) {
    rig.add(head, G.sph(0.055), 0xffffff, 0.077 * s, 0.025, -0.162, 0, 0, 0, 0.85, angry ? 0.95 : 1.15, 0.55);
    rig.flat(head, G.sph(0.03), 0x1d1a24, 0.074 * s, 0.022, -0.19, 0, 0, 0, 1, 1.1, 0.6);
    rig.glow(head, G.sph(0.011), 0xffffff, 0.066 * s, 0.036, -0.205);
    // brows
    const tilt = { angry: 0.42, stern: 0.15, calm: -0.05, kind: -0.25, happy: -0.15, grin: 0.05 }[A.mood] || 0;
    rig.add(head, G.rbox(0.09, A.style === 'beard' ? 0.035 : 0.024, 0.03, 0.01), A.style === 'medic' ? 0xb8bcc4 : shade(A.hair, 0.8), 0.077 * s, 0.098, -0.175, 0, 0, -tilt * s);
    // cheeks / freckles
    if (A.mood === 'happy' || A.mood === 'kind') rig.flat(head, G.sph(0.03), 0xff9a9a, 0.11 * s, -0.045, -0.158, 0, 0, 0, 1, 0.6, 0.4);
    if (A.style === 'spiky') for (let k = 0; k < 3; k++) rig.flat(head, G.sph(0.009), 0xb0603a, (0.09 + k * 0.02) * s, -0.045 + (k % 2) * 0.014, -0.181, 0, 0, 0, 1, 1, 0.4);
  }
  rig.add(head, G.sph(0.034), shade(A.skin, 0.9), 0, -0.035, -0.198, 0, 0, 0, 0.85, 0.9, 1);
  // mouth by mood
  const mouthY = -0.105, mz = -0.18;
  if (A.mood === 'happy' || A.mood === 'kind' || A.mood === 'calm') {
    rig.flat(head, G.torus(0.04, 0.011, Math.PI), 0x5a1e1e, 0, mouthY + 0.02, mz, 0, 0, Math.PI, 1, A.mood === 'calm' ? 0.4 : 0.8, 1);
  } else if (A.mood === 'grin') {
    rig.flat(head, G.rbox(0.1, 0.035, 0.02, 0.012), 0xffffff, 0.01, mouthY, mz - 0.005, 0, 0, -0.08);
    rig.flat(head, G.rbox(0.11, 0.012, 0.022, 0.005), 0x5a1e1e, 0.01, mouthY - 0.02, mz - 0.006, 0, 0, -0.08);
  } else {
    rig.flat(head, G.rbox(0.08, 0.016, 0.02, 0.006), 0x5a1e1e, 0, mouthY, mz, 0, 0, A.mood === 'angry' ? 0.1 : 0);
  }
}

function hair(rig, head, torso, body, A, big) {
  const H = A.hair;
  const capGeo = (r, t) => new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI * t);
  switch (A.style) {
    case 'hood': {
      rig.add(head, capGeo(0.208, 0.33), H, 0, 0.02, 0.0, -0.75);
      // hood: open in front
      const hood = new THREE.SphereGeometry(0.255, 18, 14, Math.PI * 1.5 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.78);
      rig.add(head, hood, A.outfit, 0, 0.02, 0.02, 0, 0, 0, 1, 1.05, 1.05);
      rig.add(head, G.torus(0.2, 0.035, Math.PI * 1.25), A.outfit2, 0, 0.0, -0.13, 0, 0, Math.PI * 1.375, 1.05, 1.15, 1);
      // glowing tattoo lines
      for (const s of [-1, 1]) {
        rig.glow(head, G.box(0.012, 0.07, 0.01), A.accent, 0.12 * s, -0.04, -0.16, 0.4, 0, 0.3 * s);
        rig.glow(head, G.box(0.012, 0.04, 0.01), A.accent, 0.145 * s, -0.08, -0.13, 0.4, 0, -0.4 * s);
      }
      // long coat flaring from the waist
      rig.add(body, G.cyl(0.27, 0.36, 0.5, 16, true), A.outfit, 0, 0.72, 0.02, 0, 0, 0, 1, 1, 0.85);
      rig.add(torso, G.box(0.06, 0.4, 0.02), A.accent, 0.09, 0.25, -0.172, 0, 0, 0, 1, 1, 1, true);
      break;
    }
    case 'medic': {
      rig.add(head, capGeo(0.215, 0.5), H, 0, 0.01, 0.02, -0.25);
      for (const s of [-1, 1]) rig.add(head, G.sph(0.1), H, 0.155 * s, -0.06, 0.03, 0, 0, 0, 0.6, 1.25, 1.1);
      rig.add(head, G.sph(0.17), H, 0, -0.03, 0.09, 0, 0, 0, 1.15, 1.1, 0.8);
      // round glasses
      for (const s of [-1, 1]) rig.flat(head, G.torus(0.045, 0.008), 0x2a3a3a, 0.077 * s, 0.025, -0.2);
      rig.flat(head, G.box(0.05, 0.008, 0.008), 0x2a3a3a, 0, 0.03, -0.205);
      break;
    }
    case 'afro': {
      const blobs = [[0, 0.14, 0.02, 0.15], [0.12, 0.1, 0.03, 0.13], [-0.12, 0.1, 0.03, 0.13], [0.15, -0.01, 0.06, 0.11], [-0.15, -0.01, 0.06, 0.11],
        [0, 0.1, 0.13, 0.15], [0.09, 0.02, 0.14, 0.12], [-0.09, 0.02, 0.14, 0.12], [0.06, 0.2, -0.04, 0.1], [-0.06, 0.2, -0.04, 0.1], [0, 0.22, 0.07, 0.12]];
      for (const [x, y, z, r] of blobs) rig.add(head, G.sph(r, 12, 10), H, x * 1.05, y, z);
      // goggles pushed up on the forehead
      rig.add(head, G.torus(0.212, 0.018), 0x3a2a1a, 0, 0.1, 0, Math.PI / 2 - 0.25);
      for (const s of [-1, 1]) {
        rig.add(head, G.cyl(0.045, 0.045, 0.04), 0x3a2a1a, 0.07 * s, 0.135, -0.19, Math.PI / 2 - 0.25);
        rig.glow(head, G.cyl(0.035, 0.035, 0.01), 0xffa040, 0.07 * s, 0.136, -0.212, Math.PI / 2 - 0.25);
      }
      break;
    }
    case 'spiky': {
      rig.add(head, capGeo(0.212, 0.45), H, 0, 0.01, 0.01, -0.3);
      const spikes = [[0, 0.2, -0.05, -0.5, 0], [0.09, 0.19, -0.02, -0.4, -0.4], [-0.09, 0.19, -0.02, -0.4, 0.4], [0.05, 0.2, 0.08, 0.3, -0.3],
        [-0.05, 0.2, 0.08, 0.3, 0.3], [0, 0.17, 0.14, 0.8, 0], [0.15, 0.12, 0.05, 0, -0.9], [-0.15, 0.12, 0.05, 0, 0.9]];
      for (const [x, y, z, rx, rz] of spikes) rig.add(head, G.cone(0.065, 0.2, 6), H, x, y, z, rx, 0, rz);
      break;
    }
    case 'mohawk': {
      rig.add(head, capGeo(0.204, 0.42), shade(A.skin, 0.75), 0, 0.005, 0.0, -0.3);
      for (let i = 0; i < 6; i++) {
        const a = -0.6 + i * 0.36;
        rig.add(head, G.rbox(0.05, 0.13, 0.08, 0.02), H, 0, Math.cos(a) * 0.21, Math.sin(a) * 0.21, a, 0, 0);
      }
      // headphones around the neck
      rig.add(torso, G.torus(0.13, 0.02), 0x222228, 0, 0.55, 0.0, Math.PI / 2 + 0.3);
      for (const s of [-1, 1]) rig.add(torso, G.cyl(0.05, 0.05, 0.04), 0x222228, 0.13 * s, 0.53, -0.04, 0, 0, Math.PI / 2);
      rig.glow(torso, G.cyl(0.035, 0.035, 0.042), A.accent, 0.13, 0.53, -0.04, 0, 0, Math.PI / 2);
      break;
    }
    case 'beard': {
      // bald head, big beard and moustache
      rig.add(head, G.sph(0.16), H, 0, -0.1, -0.07, 0, 0, 0, 1.15, 1.0, 0.85);
      rig.add(head, G.rbox(0.13, 0.04, 0.05, 0.02), H, 0, -0.07, -0.19);
      rig.add(head, G.sph(0.21), shade(A.skin, 1.05), 0, 0.012, 0.01, 0, 0, 0, 0.98, 0.97, 0.95);
      break;
    }
  }
}

function outfit(rig, torso, body, A, big) {
  switch (A.style) {
    case 'medic':
      rig.add(torso, G.rbox(0.36, 0.08, 0.36, 0.03), A.outfit, 0, 0.5, 0.0);
      rig.add(torso, G.box(0.1, 0.03, 0.02), A.outfit2, 0, 0.32, 0.18, 0, 0, 0, 1, 1, 1, true);
      rig.add(torso, G.box(0.03, 0.1, 0.02), A.outfit2, 0, 0.32, 0.18, 0, 0, 0, 1, 1, 1, true);
      rig.add(torso, G.box(0.03, 0.42, 0.01), A.outfit2, -0.05, 0.27, -0.172);
      rig.add(torso, G.rbox(0.2, 0.18, 0.08, 0.03), 0xe8e8e8, -0.32, 0.12, 0.0); // med pouch
      break;
    case 'afro':
      rig.add(torso, G.torus(0.17, 0.06), A.outfit2, 0, 0.5, 0, Math.PI / 2);
      rig.add(torso, G.box(0.02, 0.42, 0.01), 0x8a6a1a, 0, 0.27, -0.172);
      rig.add(torso, G.rbox(0.54, 0.08, 0.36, 0.03), shade(A.outfit, 0.8), 0, 0.03, 0);
      break;
    case 'spiky':
      for (const s of [-1, 1]) rig.add(torso, G.box(0.08, 0.18, 0.04), A.outfit, 0.13 * s, 0.53, -0.08, -0.3, 0, 0.25 * s);
      rig.add(torso, G.box(0.18, 0.4, 0.01), 0x2a2a2e, 0, 0.27, -0.172); // shirt under the open jacket
      rig.glow(torso, G.box(0.03, 0.3, 0.01), A.accent, 0.12, 0.25, -0.175, 0, 0, 0.2);
      break;
    case 'mohawk':
      rig.add(torso, G.box(0.03, 0.42, 0.01), A.accent, 0, 0.27, -0.172, 0, 0, 0, 1, 1, 1, true);
      rig.add(torso, G.rbox(0.54, 0.06, 0.36, 0.02), 0x2a2a2e, 0, 0.03, 0);
      break;
    case 'beard':
      // heavy plate carrier with pouches
      rig.add(torso, G.rbox(0.56 * big, 0.42, 0.4 * big, 0.08), A.outfit2, 0, 0.29, 0);
      for (let i = 0; i < 3; i++) rig.add(torso, G.rbox(0.13, 0.13, 0.08, 0.03), shade(A.outfit2, 1.25), (i - 1) * 0.15, 0.16, -0.23 * big);
      rig.add(torso, G.rbox(0.36, 0.42, 0.18, 0.06), A.outfit2, 0, 0.27, 0.27);
      rig.glow(torso, G.box(0.18, 0.025, 0.01), A.accent, 0, 0.42, -0.232 * big);
      break;
    default:
      rig.add(torso, G.box(0.02, 0.42, 0.01), A.outfit2, 0, 0.27, -0.172);
  }
  // belt pouch on everyone
  rig.add(body, G.rbox(0.12, 0.1, 0.07, 0.02), A.outfit2, 0.2 * big, 0.92, -0.12);
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

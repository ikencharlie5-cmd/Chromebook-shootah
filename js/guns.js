import * as THREE from '../lib/three.module.min.js?v=20261031060040';
import { outlineMaterial } from './people.js?v=20261031060040';
import { SKINS } from './skins.js?v=20261031060040';

// Weapon models. Every gun points down -Z with the grip at the origin.
// Bodies are built from beveled side profiles (shapes drawn in forward/up space and
// extruded sideways) and merged per material, so each gun is only a few draw calls.
// Skins swap the materials (colours, patterns, glow).

const INK = outlineMaterial(0x07090c, 0.0035);

// ---- skin patterns (small canvas textures) -------------------------------------------

const patternCache = new Map();
function patternTexture(kind, colors) {
  const key = kind + colors.join();
  if (patternCache.has(key)) return patternCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.fillStyle = colors[0]; g.fillRect(0, 0, 128, 128);
  switch (kind) {
    case 'camo':
      for (let i = 0; i < 46; i++) {
        g.fillStyle = colors[1 + (i % (colors.length - 1))];
        g.beginPath();
        const x = rnd() * 128, y = rnd() * 128;
        for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; const r = 6 + rnd() * 12; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8); }
        g.fill();
      }
      break;
    case 'stripes':
      g.strokeStyle = colors[1]; g.lineWidth = 5;
      for (let i = -128; i < 256; i += 26) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke(); }
      break;
    case 'carbon':
      for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 8) {
        g.fillStyle = ((x + y) / 8) % 2 ? colors[1] : colors[0];
        g.fillRect(x, y, 8, 8);
        g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x, y, 8, 2);
      }
      break;
    case 'hex':
      g.strokeStyle = colors[1]; g.lineWidth = 2;
      for (let y = 0; y < 140; y += 18) for (let x = 0; x < 140; x += 20) {
        const ox = (y / 18) % 2 ? 10 : 0;
        g.beginPath();
        for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; g.lineTo(x + ox + Math.cos(a) * 9, y + Math.sin(a) * 9); }
        g.stroke();
      }
      break;
    case 'tiger':
      g.fillStyle = colors[1];
      for (let i = 0; i < 14; i++) {
        const x = rnd() * 128, w = 4 + rnd() * 6;
        g.beginPath(); g.moveTo(x, 0);
        g.bezierCurveTo(x + 20, 40, x - 20, 80, x + 6, 128);
        g.lineTo(x + 6 + w, 128); g.bezierCurveTo(x - 20 + w, 80, x + 20 + w, 40, x + w, 0); g.fill();
      }
      break;
    case 'grid':
      g.strokeStyle = colors[1]; g.lineWidth = 2;
      for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
      break;
    case 'sakura':
      for (let i = 0; i < 22; i++) {
        const x = rnd() * 128, y = rnd() * 128;
        for (let k = 0; k < 5; k++) {
          const a = k / 5 * Math.PI * 2;
          g.fillStyle = colors[1];
          g.beginPath(); g.ellipse(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 4, 2.4, a, 0, 7); g.fill();
        }
        g.fillStyle = colors[2]; g.beginPath(); g.arc(x, y, 1.5, 0, 7); g.fill();
      }
      break;
    case 'drip':
      g.fillStyle = colors[1];
      for (let i = 0; i < 18; i++) { const x = rnd() * 128, h = 20 + rnd() * 60; g.fillRect(x, 0, 3 + rnd() * 3, h); g.beginPath(); g.arc(x + 2.5, h, 4, 0, 7); g.fill(); }
      break;
    case 'brushed':
      for (let y = 0; y < 128; y++) { g.fillStyle = rnd() < 0.5 ? colors[0] : colors[1]; g.globalAlpha = 0.35; g.fillRect(0, y, 128, 1); }
      g.globalAlpha = 1;
      break;
    case 'galaxy': {
      const grd = g.createRadialGradient(40, 60, 4, 64, 64, 90);
      grd.addColorStop(0, colors[2]); grd.addColorStop(0.4, colors[1]); grd.addColorStop(1, colors[0]);
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${0.4 + rnd() * 0.6})`; g.fillRect(rnd() * 128, rnd() * 128, rnd() < 0.1 ? 2 : 1, rnd() < 0.1 ? 2 : 1); }
      break;
    }
    case 'scales':
      g.strokeStyle = colors[1]; g.lineWidth = 2;
      for (let y = 0; y < 140; y += 12) for (let x = 0; x < 140; x += 16) {
        g.beginPath(); g.arc(x + ((y / 12) % 2 ? 8 : 0), y, 8, 0, Math.PI); g.stroke();
      }
      break;
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2.5, 2.5);
  t.colorSpace = THREE.SRGBColorSpace;
  patternCache.set(key, t);
  return t;
}

// ---- materials per skin --------------------------------------------------------------

const matCache = new Map();
function skinMats(skinId, defAccent) {
  const key = `${skinId}:${defAccent}`;
  if (matCache.has(key)) return matCache.get(key);
  const S = SKINS[skinId] || SKINS.factory;
  const tex = S.pattern ? patternTexture(S.pattern, S.colors) : null;
  const phong = (color, shininess, map, emissive) => new THREE.MeshPhongMaterial({
    color: map ? 0xffffff : color, map: map || null, shininess, specular: S.spec ?? 0x8890a0,
    emissive: emissive ? new THREE.Color(S.glow) : 0x000000, emissiveIntensity: emissive || 0, emissiveMap: emissive ? map : null,
  });
  const accent = S.accent ?? defAccent;
  const M = {
    body: phong(S.body ?? 0x2c3138, S.shiny ?? 90, tex, S.emissive),
    dark: phong(S.dark ?? 0x1b1e23, 30, S.patternOn === 'both' ? tex : null, S.patternOn === 'both' ? S.emissive : 0),
    steel: new THREE.MeshPhongMaterial({ color: S.steel ?? 0x9aa2ad, shininess: 110, specular: 0xffffff }),
    // knife skins paint the blade itself
    blade: skinId.startsWith('factory')
      ? new THREE.MeshPhongMaterial({ color: 0xd8e0e8, shininess: 150, specular: 0xffffff })
      : new THREE.MeshPhongMaterial({ color: tex ? 0xffffff : S.body, map: tex, shininess: 150, specular: 0xffffff, emissive: S.emissive ? new THREE.Color(S.glow) : 0x000000, emissiveIntensity: S.emissive || 0, emissiveMap: S.emissive ? tex : null }),
    wood: new THREE.MeshPhongMaterial({ color: 0x8a5a34, shininess: 40, specular: 0x553322 }),
    lens: new THREE.MeshPhongMaterial({ color: 0x1a3a4a, shininess: 160, specular: 0xffffff }),
    rubber: new THREE.MeshPhongMaterial({ color: S.dark ?? 0x1b1e23, shininess: 10, specular: 0x222222 }),
    accent: new THREE.MeshPhongMaterial({ color: accent, shininess: 60, specular: 0x666666 }),
    accentDark: new THREE.MeshPhongMaterial({ color: new THREE.Color(accent).multiplyScalar(0.7), shininess: 40, specular: 0x444444 }),
    glow: new THREE.MeshBasicMaterial({ color: S.glow ?? defAccent }),
    red: new THREE.MeshBasicMaterial({ color: 0xff3048 }),
  };
  matCache.set(key, M);
  return M;
}

// ---- geometry helpers ------------------------------------------------------------------

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

class GunBuilder {
  constructor(M) { this.M = M; this.parts = new Map(); }

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
    g.rotateY(Math.PI / 2);
    g.translate(-(width - bevel * 2) / 2 + x, 0, 0);
    // pattern scale: extrude UVs are in metres
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3);
    return this.put(mat, g);
  }

  tube(mat, r, z0, z1, y = 0, x = 0, seg = 16, r2 = r) {
    const len = Math.abs(z1 - z0);
    return this.put(mat, new THREE.CylinderGeometry(r2, r, len, seg), x, y, (z0 + z1) / 2, -Math.PI / 2);
  }

  box(mat, w, h, d, x, y, z, r = 0.004, rx = 0, ry = 0, rz = 0) {
    return this.put(mat, roundBox(w, h, d, r), x, y, z, rx, ry, rz);
  }

  build() {
    const group = new THREE.Group();
    for (const [mat, list] of this.parts) {
      const geo = merge(list);
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      if (!(mat instanceof THREE.MeshBasicMaterial)) {
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
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
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

function arc(cf, cy, r, a0, a1, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    out.push([cf + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

// pistol-style lower: frame with trigger guard hole + raked grip. Returns nothing; grip at origin.
function lower(B, mat, front = 0.15, width = 0.06) {
  B.profile(mat, [
    [-0.06, 0.0], [front, 0.0], [front, -0.025], ...arc(front - 0.06, -0.02, 0.033, 0, -Math.PI, 6).slice(1),
    [front - 0.11, -0.03], [0.022, -0.035], [0.0, -0.15], [-0.012, -0.16], [-0.065, -0.152], [-0.07, -0.01],
  ], width, 0, { holes: [[[front - 0.038, -0.012], ...arc(front - 0.06, -0.02, 0.019, 0, -Math.PI, 6), [front - 0.082, -0.012]]], bevel: 0.008 });
  for (let i = 0; i < 4; i++) B.box(B.M.rubber, width + 0.002, 0.005, 0.04, 0, -0.06 - i * 0.02, 0.022 + i * 0.004, 0.002);
  B.put(B.M.steel, new THREE.TorusGeometry(0.012, 0.004, 6, 10, Math.PI), 0, -0.012, -(front - 0.075), 0, Math.PI / 2, Math.PI / 2);
}

function rail(B, z0, z1, y) {
  B.box(B.M.dark, 0.032, 0.012, Math.abs(z1 - z0), 0, y, (z0 + z1) / 2, 0.002);
  for (let z = z0; z > z1; z -= 0.04) B.box(B.M.body, 0.034, 0.006, 0.012, 0, y + 0.008, z - 0.02, 0.001);
}

function redDot(B, z, y) {
  B.box(B.M.dark, 0.04, 0.045, 0.06, 0, y + 0.025, z, 0.01);
  B.put(B.M.red, new THREE.SphereGeometry(0.004, 8, 6), 0, y + 0.03, z + 0.031);
  B.put(B.M.lens, new THREE.CircleGeometry(0.016, 14), 0, y + 0.028, z + 0.03);
}

function scope(B, zBack, zFront, y, r = 0.024, bell = 0.04) {
  B.tube(B.M.dark, r, zBack, zFront, y, 0, 18);
  B.tube(B.M.dark, bell, zFront, zFront - 0.1, y, 0, 20, r + 0.002);
  B.tube(B.M.dark, bell * 0.8, zBack + 0.07, zBack, y, 0, 20, r);
  B.put(B.M.dark, new THREE.CylinderGeometry(0.016, 0.016, 0.03, 12), 0, y + 0.03, (zBack + zFront) / 2);
  B.put(B.M.dark, new THREE.CylinderGeometry(0.016, 0.016, 0.03, 12), 0.03, y, (zBack + zFront) / 2, 0, 0, Math.PI / 2);
  B.put(B.M.glow, new THREE.CircleGeometry(bell * 0.88, 20), 0, y, zFront - 0.101, Math.PI, 0, 0);
  B.put(B.M.lens, new THREE.CircleGeometry(bell * 0.7, 20), 0, y, zBack + 0.071);
  for (const z of [zBack + 0.03, zFront + 0.02]) B.box(B.M.body, 0.02, 0.05, 0.025, 0, y - r - 0.02, z, 0.004);
}

// ---- weapons ---------------------------------------------------------------------------

const GUNS = {
  knife(B, model) {
    const M = B.M;
    if (model === 'karambit') {
      // curved claw blade sweeping forward and down, short handle, finger ring at the back
      const outer = arc(0.0, -0.045, 0.12, Math.PI / 2, -0.25, 14);
      const inner = arc(0.0, -0.045, 0.078, -0.12, Math.PI / 2, 14);
      B.profile(M.blade, [...outer, ...inner], 0.01, 0, { bevel: 0.0022 });
      const edge = arc(0.0, -0.045, 0.078, -0.12, Math.PI / 2 - 0.25, 12);
      const edgeIn = arc(0.0, -0.045, 0.085, Math.PI / 2 - 0.25, -0.14, 12);
      B.profile(M.glow, [...edge, ...edgeIn], 0.0108, 0, { bevel: 0 });
      B.profile(M.rubber, [[0.0, 0.075], [0.0, 0.02], [-0.11, 0.016], [-0.12, 0.05], [-0.06, 0.076]], 0.03, 0, { bevel: 0.008 });
      for (let i = 0; i < 3; i++) B.box(M.accent, 0.032, 0.006, 0.012, 0, 0.048, 0.025 + i * 0.03, 0.002);
      B.put(M.body, new THREE.TorusGeometry(0.026, 0.008, 10, 22), 0, 0.045, 0.145, 0, Math.PI / 2, 0);
      return { muzzleZ: -0.25, grip: { type: 'knife', length: 0.11 } };
    }
    // combat knife: drop-point blade with fuller, crossguard, ridged grip, pommel
    B.profile(M.blade, [[0.0, 0.014], [0.2, 0.012], [0.255, 0.024], [0.27, 0.036], [0.22, 0.05], [0.0, 0.052]], 0.01, 0, { bevel: 0.0025 });
    B.profile(M.body, [[0.03, 0.03], [0.17, 0.03], [0.17, 0.038], [0.03, 0.038]], 0.0115, 0, { bevel: 0 });
    B.profile(M.glow, [[0.02, 0.012], [0.2, 0.0105], [0.25, 0.022], [0.247, 0.025], [0.198, 0.0145], [0.02, 0.0155]], 0.0102, 0, { bevel: 0 });
    B.box(M.steel, 0.024, 0.075, 0.018, 0, 0.033, 0.002, 0.006);
    B.tube(M.rubber, 0.019, 0.012, 0.125, 0.033, 0, 12, 0.017);
    for (let i = 0; i < 5; i++) B.tube(M.accentDark, 0.0205, 0.025 + i * 0.02, 0.031 + i * 0.02, 0.033, 0, 12);
    B.tube(M.steel, 0.02, 0.125, 0.142, 0.033, 0, 12, 0.014);
    return { muzzleZ: -0.28, grip: { type: 'knife', length: 0.12 } };
  },

  pip(B) { return pistol(B, false); },
  bolt(B) { return pistol(B, true); },

  hornet(B) {
    // compact PDW: rounded body with a thumbhole stock and a translucent top magazine
    const M = B.M;
    B.profile(M.body, [[-0.24, 0.02], [-0.25, 0.08], [0.0, 0.1], [0.22, 0.095], [0.28, 0.06], [0.28, 0.0], [0.2, -0.04], [0.08, -0.02], [-0.03, -0.02], [-0.12, -0.08], [-0.22, -0.08]], 0.064, 0, {
      holes: [[[-0.15, -0.045], [-0.07, -0.0], [-0.05, 0.04], [-0.2, 0.05], [-0.2, -0.04]]], bevel: 0.012,
    });
    lower(B, M.dark, 0.13, 0.054);
    B.profile(M.accent, [[-0.06, 0.1], [0.24, 0.096], [0.25, 0.135], [-0.05, 0.14]], 0.05, 0, { bevel: 0.01 });
    for (let i = 0; i < 8; i++) B.box(M.dark, 0.052, 0.01, 0.006, 0, 0.12, 0.03 - i * 0.03, 0.001);
    B.tube(M.steel, 0.012, -0.28, -0.36, 0.04);
    B.tube(M.dark, 0.02, -0.33, -0.38, 0.04, 0, 8);
    // front grip hole for the support hand
    B.profile(M.dark, [[0.17, -0.04], [0.25, -0.02], [0.24, -0.1], [0.19, -0.11]], 0.04, 0, { bevel: 0.008 });
    redDot(B, -0.02, 0.14);
    B.box(M.glow, 0.066, 0.006, 0.18, 0, 0.06, -0.1, 0.002);
    return { muzzleZ: -0.39, grip: { type: 'rifle', fore: -0.21, foreY: -0.05, vertical: true } };
  },

  wasp(B) {
    const M = B.M;
    B.profile(M.body, [[-0.12, 0.0], [0.3, 0.0], [0.34, 0.03], [0.34, 0.085], [0.1, 0.1], [-0.12, 0.09]], 0.07, 0, { bevel: 0.01 });
    lower(B, M.dark, 0.17, 0.06);
    B.profile(M.dark, [[0.19, 0.0], [0.24, 0.0], [0.25, -0.21], [0.2, -0.215]], 0.04, 0, { bevel: 0.006 });
    B.box(M.accent, 0.044, 0.016, 0.06, 0, -0.205, -0.225, 0.004);
    B.tube(M.dark, 0.034, -0.3, -0.44, 0.05, 0, 12);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) B.put(M.body, new THREE.CylinderGeometry(0.008, 0.008, 0.01, 6), 0.033 * s, 0.05, -0.32 - i * 0.03, 0, 0, Math.PI / 2);
    B.tube(M.steel, 0.014, -0.44, -0.48, 0.05);
    for (const y of [0.07, 0.01]) B.tube(M.body, 0.008, 0.11, 0.3, y);
    B.box(M.dark, 0.05, 0.09, 0.025, 0, 0.04, 0.31, 0.008);
    rail(B, 0.02, -0.22, 0.105);
    redDot(B, -0.06, 0.11);
    B.box(M.glow, 0.072, 0.008, 0.18, 0, 0.065, -0.14, 0.002);
    return { muzzleZ: -0.49, grip: { type: 'rifle', fore: -0.36, foreY: 0.02 } };
  },

  thunder(B) {
    // pump shotgun: receiver, barrel over a tube magazine, ridged pump, solid stock
    const M = B.M;
    B.profile(M.body, [[-0.12, 0.0], [0.2, 0.0], [0.2, 0.09], [-0.1, 0.095], [-0.12, 0.08]], 0.066, 0, { bevel: 0.01 });
    lower(B, M.dark, 0.13, 0.058);
    B.tube(M.steel, 0.02, -0.2, -0.8, 0.065, 0, 16);
    B.tube(M.dark, 0.017, -0.2, -0.7, 0.022, 0, 14);
    B.tube(M.dark, 0.024, -0.79, -0.82, 0.065, 0, 16);
    B.put(M.glow, new THREE.SphereGeometry(0.006, 8, 6), 0, 0.09, -0.8);
    // pump with grooves
    B.tube(M.accent, 0.03, -0.36, -0.54, 0.024, 0, 16);
    for (let i = 0; i < 6; i++) B.tube(M.accentDark, 0.031, -0.38 - i * 0.03, -0.39 - i * 0.03, 0.024, 0, 16);
    B.box(M.dark, 0.05, 0.01, 0.3, 0, 0.044, -0.4, 0.002);
    // stock
    B.profile(M.accent, [[-0.12, 0.085], [-0.46, 0.06], [-0.48, -0.09], [-0.42, -0.1], [-0.22, -0.03], [-0.07, -0.01]], 0.056, 0, { bevel: 0.012 });
    B.box(M.rubber, 0.06, 0.16, 0.025, 0, -0.015, 0.49, 0.008);
    // shell holder on the receiver side
    for (let i = 0; i < 4; i++) B.put(M.accent, new THREE.CylinderGeometry(0.008, 0.008, 0.04, 10), 0.038, 0.045, 0.05 - i * 0.025);
    B.box(M.glow, 0.068, 0.006, 0.2, 0, 0.03, 0.0, 0.002);
    return { muzzleZ: -0.83, grip: { type: 'rifle', fore: -0.45, foreY: -0.005 } };
  },

  raptor(B) {
    // AR with long rail handguard, straight mag, tube stock and a vertical foregrip
    const M = B.M;
    B.profile(M.body, [[-0.14, 0.0], [0.24, 0.0], [0.24, 0.1], [-0.14, 0.1]], 0.07, 0, { bevel: 0.01 });
    B.profile(M.dark, [[0.24, 0.0], [0.64, 0.0], [0.64, 0.1], [0.24, 0.1]], 0.074, 0, { bevel: 0.014 });
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) B.box(M.body, 0.004, 0.018, 0.04, 0.038 * s, 0.05, -0.29 - i * 0.055, 0.002);
    lower(B, M.dark, 0.14, 0.06);
    B.profile(M.dark, [[0.17, 0.0], [0.23, 0.0], [0.26, -0.19], [0.2, -0.2]], 0.042, 0, { bevel: 0.006 });
    B.box(M.accent, 0.046, 0.014, 0.06, 0, -0.19, -0.23, 0.004);
    // tube stock
    B.tube(M.body, 0.017, 0.14, 0.38, 0.06);
    B.profile(M.dark, [[-0.27, 0.09], [-0.42, 0.09], [-0.43, -0.07], [-0.38, -0.07], [-0.3, 0.02], [-0.27, 0.04]], 0.05, 0, { bevel: 0.01 });
    B.tube(M.steel, 0.013, -0.64, -0.76, 0.05);
    B.tube(M.dark, 0.02, -0.74, -0.8, 0.05, 0, 6);
    rail(B, 0.1, -0.62, 0.108);
    redDot(B, -0.05, 0.114);
    // vertical foregrip
    B.box(M.dark, 0.036, 0.11, 0.04, 0, -0.055, -0.42, 0.015);
    B.box(M.glow, 0.076, 0.006, 0.34, 0, 0.02, -0.44, 0.002);
    B.box(M.accent, 0.072, 0.03, 0.08, 0, 0.07, 0.02, 0.006);
    return { muzzleZ: -0.81, grip: { type: 'rifle', fore: -0.42, foreY: -0.08, vertical: true } };
  },

  talon(B) {
    const M = B.M;
    B.profile(M.body, [[-0.15, 0.0], [0.25, 0.0], [0.27, 0.035], [0.27, 0.1], [0.05, 0.11], [-0.15, 0.1]], 0.075, 0, { bevel: 0.01 });
    B.profile(M.dark, [[0.25, 0.005], [0.6, 0.012], [0.62, 0.035], [0.62, 0.095], [0.25, 0.1]], 0.07, 0, { bevel: 0.012 });
    for (let i = 0; i < 5; i++) B.box(M.body, 0.072, 0.012, 0.035, 0, 0.055, -0.32 - i * 0.06, 0.005);
    lower(B, M.dark, 0.15, 0.062);
    const mag = [...arc(0.42, -0.02, 0.27, Math.PI * 0.97, Math.PI * 1.23, 8), ...arc(0.42, -0.02, 0.215, Math.PI * 1.23, Math.PI * 0.97, 8)];
    B.profile(M.accentDark, mag, 0.045, 0, { bevel: 0.006 });
    B.profile(M.dark, [[-0.15, 0.1], [-0.42, 0.075], [-0.43, -0.07], [-0.36, -0.07], [-0.25, -0.01], [-0.15, -0.0]], 0.06, 0, { bevel: 0.012 });
    B.box(M.accent, 0.064, 0.02, 0.09, 0, 0.088, 0.3, 0.008);
    B.box(M.body, 0.066, 0.15, 0.025, 0, 0.0, 0.43, 0.01);
    B.tube(M.steel, 0.014, -0.62, -0.78, 0.055);
    B.tube(M.body, 0.024, -0.76, -0.86, 0.055, 0, 10);
    for (const s of [-1, 1]) B.box(M.dark, 0.01, 0.014, 0.05, 0.024 * s, 0.055, -0.81, 0.002);
    rail(B, 0.05, -0.37, 0.115);
    B.profile(M.body, [[0.04, 0.125], [0.14, 0.125], [0.135, 0.2], [0.115, 0.2], [0.115, 0.14], [0.065, 0.14], [0.065, 0.2], [0.045, 0.2]], 0.05, 0, { bevel: 0.004 });
    B.put(M.lens, new THREE.PlaneGeometry(0.044, 0.05), 0, 0.17, -0.09);
    B.put(M.red, new THREE.TorusGeometry(0.008, 0.0016, 6, 16), 0, 0.17, -0.091);
    B.box(M.dark, 0.012, 0.04, 0.012, 0, 0.12, -0.58, 0.003);
    B.box(M.glow, 0.077, 0.008, 0.3, 0, 0.03, -0.42, 0.002);
    return { muzzleZ: -0.87, grip: { type: 'rifle', fore: -0.43, foreY: 0.005 } };
  },

  bastion(B) {
    // LMG: big receiver, feed cover + carry handle, box magazine, perforated heat shield, bipod
    const M = B.M;
    B.profile(M.body, [[-0.16, -0.0], [0.3, 0.0], [0.3, 0.12], [0.05, 0.14], [-0.16, 0.13]], 0.09, 0, { bevel: 0.012 });
    B.profile(M.dark, [[-0.12, 0.13], [0.22, 0.13], [0.24, 0.16], [-0.1, 0.165]], 0.08, 0, { bevel: 0.01 });
    lower(B, M.dark, 0.15, 0.064);
    B.box(M.accent, 0.11, 0.15, 0.14, 0.012, -0.07, -0.22, 0.015);
    B.box(M.accentDark, 0.115, 0.02, 0.145, 0.012, -0.12, -0.22, 0.004);
    // ammo belt peeking out
    for (let i = 0; i < 4; i++) B.put(M.steel, new THREE.CylinderGeometry(0.007, 0.007, 0.04, 8), 0.06 - i * 0.012, 0.03 + i * 0.012, -0.2, 0, 0, Math.PI / 2 + 0.3);
    B.tube(M.dark, 0.042, -0.3, -0.62, 0.065, 0, 14);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) B.put(M.body, new THREE.CylinderGeometry(0.009, 0.009, 0.012, 8), 0.04 * s, 0.065, -0.33 - i * 0.05, 0, 0, Math.PI / 2);
    B.tube(M.steel, 0.019, -0.62, -0.86, 0.065);
    B.tube(M.dark, 0.026, -0.84, -0.9, 0.065, 0, 8);
    // carry handle
    B.profile(M.dark, [[0.08, 0.165], [0.1, 0.23], [0.24, 0.23], [0.26, 0.165], [0.24, 0.165], [0.225, 0.21], [0.115, 0.21], [0.1, 0.165]], 0.03, 0, { bevel: 0.004 });
    // stock
    B.profile(M.dark, [[-0.16, 0.12], [-0.46, 0.1], [-0.47, -0.08], [-0.4, -0.09], [-0.26, -0.02], [-0.16, 0.0]], 0.07, 0, { bevel: 0.012 });
    B.box(M.accent, 0.072, 0.04, 0.14, 0, 0.08, 0.36, 0.008);
    // folded bipod
    for (const s of [-1, 1]) B.tube(M.body, 0.007, -0.55, -0.8, 0.02, 0.025 * s);
    B.box(M.glow, 0.092, 0.008, 0.26, 0, 0.06, -0.02, 0.002);
    return { muzzleZ: -0.9, grip: { type: 'rifle', fore: -0.46, foreY: 0.02 } };
  },

  arbiter(B) {
    // DMR: skeleton stock, long free-floated barrel, medium scope, straight 10-round mag
    const M = B.M;
    B.profile(M.body, [[-0.14, 0.0], [0.28, 0.0], [0.28, 0.1], [-0.14, 0.1]], 0.07, 0, { bevel: 0.01 });
    B.profile(M.dark, [[0.28, 0.01], [0.62, 0.015], [0.62, 0.09], [0.28, 0.095]], 0.066, 0, { bevel: 0.014 });
    for (let i = 0; i < 5; i++) B.box(M.body, 0.068, 0.02, 0.025, 0, 0.05, -0.34 - i * 0.055, 0.008);
    lower(B, M.dark, 0.15, 0.06);
    B.box(M.dark, 0.045, 0.13, 0.07, 0, -0.06, -0.21, 0.008);
    B.box(M.accent, 0.047, 0.014, 0.072, 0, -0.125, -0.21, 0.004);
    B.profile(M.accent, [[-0.14, 0.1], [-0.44, 0.08], [-0.45, -0.08], [-0.36, -0.08], [-0.22, 0.0], [-0.14, 0.0]], 0.055, 0, {
      holes: [[[-0.2, 0.065], [-0.38, 0.055], [-0.39, -0.02], [-0.3, -0.02]]], bevel: 0.01,
    });
    B.tube(M.steel, 0.015, -0.62, -0.92, 0.055, 0, 14);
    B.tube(M.body, 0.024, -0.9, -0.98, 0.055, 0, 8);
    for (const s of [-1, 1]) B.box(M.dark, 0.008, 0.016, 0.05, 0.024 * s, 0.055, -0.95, 0.002);
    rail(B, 0.05, -0.3, 0.108);
    scope(B, 0.05, -0.17, 0.165, 0.021, 0.034);
    B.box(M.glow, 0.072, 0.006, 0.2, 0, 0.02, -0.4, 0.002);
    return { muzzleZ: -0.99, grip: { type: 'rifle', fore: -0.44, foreY: 0.012 } };
  },

  needle(B) {
    // budget bolt-action: slim wooden stock, thin barrel, small scope
    const M = B.M;
    B.profile(M.wood, [[0.5, 0.0], [0.5, 0.05], [0.05, 0.06], [-0.1, 0.07], [-0.46, 0.05], [-0.48, -0.08], [-0.4, -0.085], [-0.1, -0.02], [-0.03, -0.12], [0.03, -0.12], [0.06, -0.015], [0.3, -0.01]], 0.056, 0, { bevel: 0.01 });
    B.box(M.rubber, 0.058, 0.14, 0.02, 0, -0.01, 0.49, 0.008);
    B.tube(M.body, 0.022, 0.12, -0.18, 0.085, 0, 14);
    B.tube(M.steel, 0.012, -0.18, -0.95, 0.085, 0, 12, 0.01);
    B.tube(M.dark, 0.016, -0.93, -0.97, 0.085, 0, 10);
    B.put(M.steel, new THREE.CylinderGeometry(0.006, 0.006, 0.07, 8), 0.045, 0.075, 0.06, 0, 0, Math.PI / 2 + 0.4);
    B.put(M.dark, new THREE.SphereGeometry(0.013, 10, 8), 0.078, 0.062, 0.06);
    B.put(M.steel, new THREE.TorusGeometry(0.026, 0.005, 6, 12, Math.PI), 0, -0.01, -0.0, 0, Math.PI / 2, Math.PI);
    scope(B, 0.1, -0.12, 0.14, 0.017, 0.026);
    B.box(M.accent, 0.058, 0.012, 0.12, 0, 0.055, 0.25, 0.004);
    return { muzzleZ: -0.98, grip: { type: 'rifle', fore: -0.4, foreY: -0.015 } };
  },

  lynx(B) {
    const M = B.M;
    B.profile(M.body, [
      [0.32, 0.0], [0.32, 0.085], [-0.08, 0.085], [-0.2, 0.06], [-0.48, 0.07], [-0.5, -0.09], [-0.42, -0.1],
      [-0.28, -0.03], [-0.1, -0.03], [-0.03, -0.14], [0.03, -0.14], [0.05, -0.02], [0.32, -0.02],
    ], 0.07, 0, { holes: [[[-0.07, -0.005], [-0.2, 0.0], [-0.24, 0.04], [-0.1, 0.045]]], bevel: 0.012 });
    B.box(M.dark, 0.072, 0.17, 0.03, 0, -0.01, 0.49, 0.01);
    B.put(M.steel, new THREE.TorusGeometry(0.03, 0.006, 6, 14, Math.PI), 0, -0.02, -0.08, 0, Math.PI / 2, Math.PI);
    B.tube(M.dark, 0.032, 0.1, -0.3, 0.1, 0, 16);
    B.put(M.steel, new THREE.CylinderGeometry(0.007, 0.007, 0.08, 8), 0.05, 0.09, 0.02, 0, 0, Math.PI / 2 + 0.4);
    B.put(M.dark, new THREE.SphereGeometry(0.016, 12, 8), 0.088, 0.075, 0.02);
    B.tube(M.steel, 0.02, -0.3, -0.85, 0.1, 0, 12, 0.016);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; B.box(M.dark, 0.006, 0.006, 0.45, Math.cos(a) * 0.017, 0.1 + Math.sin(a) * 0.017, -0.58, 0.001); }
    B.tube(M.dark, 0.032, -0.85, -1.05, 0.1, 0, 18);
    B.tube(M.accent, 0.033, -0.87, -0.89, 0.1, 0, 18);
    B.box(M.dark, 0.05, 0.09, 0.09, 0, -0.06, -0.02, 0.01);
    scope(B, 0.21, -0.17, 0.17, 0.024, 0.042);
    for (const s of [-1, 1]) B.tube(M.body, 0.006, -0.3, -0.52, -0.005, 0.02 * s);
    B.box(M.glow, 0.072, 0.008, 0.25, 0, 0.04, 0.1, 0.002);
    return { muzzleZ: -1.06, grip: { type: 'rifle', fore: -0.36, foreY: -0.02 } };
  },
};

function pistol(B, big) {
  const M = B.M, L = big ? 0.27 : 0.21;
  B.profile(big ? M.steel : M.body, [[-0.035, 0.03], [L - 0.02, 0.03], [L, 0.045], [L - 0.005, 0.072], [-0.035, 0.074]], 0.05, 0, { bevel: 0.006 });
  for (let i = 0; i < 5; i++) B.box(M.dark, 0.052, 0.03, 0.004, 0, 0.052, 0.015 - i * 0.009, 0.001);
  B.box(M.dark, 0.052, 0.012, 0.04, 0, 0.066, -0.06, 0.002);
  if (big) for (let i = 0; i < 3; i++) B.box(M.dark, 0.052, 0.012, 0.022, 0, 0.066, -0.13 - i * 0.04, 0.003);
  B.profile(M.dark, [
    [-0.04, 0.03], [L - 0.04, 0.03], [L - 0.04, 0.012], [0.09, 0.008], ...arc(0.06, -0.005, 0.03, 0, -Math.PI, 6).slice(1),
    [0.022, -0.012], [0.0, -0.118], [-0.012, -0.128], [-0.06, -0.122], [-0.062, -0.1], [-0.048, -0.01], [-0.045, 0.03],
  ], 0.046, 0, { holes: [[[0.075, 0.0], ...arc(0.06, -0.005, 0.017, 0, -Math.PI, 6), [0.045, 0.0]]], bevel: 0.006 });
  B.profile(M.accentDark, [[0.012, -0.025], [-0.004, -0.1], [-0.05, -0.098], [-0.042, -0.028]], 0.05, 0, { bevel: 0.004 });
  for (let i = 0; i < 4; i++) B.box(M.dark, 0.052, 0.004, 0.035, 0, -0.04 - i * 0.017, 0.022 + i * 0.002, 0.001);
  B.put(M.steel, new THREE.TorusGeometry(0.012, 0.004, 6, 10, Math.PI), 0, 0.0, -0.055, 0, Math.PI / 2, Math.PI / 2);
  B.tube(M.steel, 0.012, -L + 0.02, -L - (big ? 0.03 : 0.0), 0.05);
  if (big) B.tube(M.body, 0.02, -L + 0.0, -L - 0.05, 0.05, 0, 8);
  B.box(M.dark, 0.012, 0.012, 0.01, 0, 0.08, -L + 0.02, 0.002);
  B.box(M.dark, 0.03, 0.012, 0.012, 0, 0.08, 0.025, 0.002);
  B.put(M.glow, new THREE.SphereGeometry(0.0035, 8, 6), 0, 0.087, -L + 0.02);
  B.box(M.body, 0.05, 0.012, 0.064, 0, -0.127, 0.035, 0.004);
  B.box(M.glow, 0.052, 0.006, L * 0.6, 0, 0.034, -L * 0.45, 0.001);
  return { muzzleZ: -(L + (big ? 0.05 : 0.01)), grip: { type: 'pistol' } };
}

const DEFAULT_ACCENT = {
  knife: 0x7ff6ff, pip: 0x4fd8c8, bolt: 0xd8a640, hornet: 0xffd23f, wasp: 0xffc23a, thunder: 0xb8743a,
  raptor: 0x8ad8ff, talon: 0xff7a2a, bastion: 0xc23a3a, arbiter: 0x6a7a4a, needle: 0xd8c08a, lynx: 0x5dffb0,
};

// Factory skins keep each gun's own colourway.
const FACTORY = {
  lynx: { body: 0x4a5a3c }, needle: { body: 0x3a3f46 }, arbiter: { body: 0x3a3f46 }, thunder: { body: 0x2e3238 },
};

export function buildGun(id, skin = 'factory', knifeModel = 'combat') {
  let skinId = skin;
  if (skin === 'factory' && FACTORY[id]) {
    // register a per-gun factory variant once
    skinId = `factory-${id}`;
    if (!SKINS[skinId]) SKINS[skinId] = { ...SKINS.factory, ...FACTORY[id], hidden: true };
  }
  const B = new GunBuilder(skinMats(skinId, DEFAULT_ACCENT[id] ?? 0x4fd8c8));
  const fn = GUNS[id] || GUNS.pip;
  const { muzzleZ, grip } = fn(B, knifeModel);
  const group = B.build();
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, id === 'lynx' ? 0.1 : id === 'needle' ? 0.085 : id === 'thunder' ? 0.065 : 0.05, muzzleZ);
  group.add(muzzle);
  return { group, muzzle, grip };
}

import * as THREE from '../lib/three.module.min.js?v=20261031060040';

// ---------------------------------------------------------------------------
// Helpers: seeded random, canvas textures, geometry batching
// ---------------------------------------------------------------------------

export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  draw(g, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function noise(g, s, amount, rng = Math.random) {
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

// Merges many small geometries into one mesh per material to keep draw calls low.
export class Batcher {
  constructor() { this.lists = new Map(); }

  add(key, geo, matrix, color) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const c = new THREE.Color(color ?? 0xffffff);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(g);
  }

  // Axis-aligned box with world-space UVs (textures tile instead of stretch) and fake AO at the bottom.
  addBox(key, b, color, uvScale = 1 / 3, ao = 0) {
    const g = new THREE.BoxGeometry(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ).toNonIndexed();
    g.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    const p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
      if (nx > 0.5) uv.setXY(i, z * uvScale, y * uvScale);
      else if (ny > 0.5) uv.setXY(i, x * uvScale, z * uvScale);
      else uv.setXY(i, x * uvScale, y * uvScale);
      const shade = ao && ny < 0.5 && y <= b.minY + 0.01 ? 1 - ao : 1;
      col[i * 3] = c.r * shade; col[i * 3 + 1] = c.g * shade; col[i * 3 + 2] = c.b * shade;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(g);
  }

  // Any geometry, with world-space UVs and vertex colour (+ optional AO toward minY).
  addGeo(key, geo, color, uvScale = 1 / 3, ao = 0, aoY = -Infinity) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position, nrm = g.attributes.normal;
    const uv = new Float32Array(p.count * 2), col = new Float32Array(p.count * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
      if (ny >= nx && ny >= nz) { uv[i * 2] = x * uvScale; uv[i * 2 + 1] = z * uvScale; }
      else if (nx >= nz) { uv[i * 2] = z * uvScale; uv[i * 2 + 1] = y * uvScale; }
      else { uv[i * 2] = x * uvScale; uv[i * 2 + 1] = y * uvScale; }
      const shade = ao && y <= aoY + 0.01 && ny < 0.5 ? 1 - ao : 1;
      col[i * 3] = c.r * shade; col[i * 3 + 1] = c.g * shade; col[i * 3 + 2] = c.b * shade;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(g);
  }

  // Box with rounded edges and flat faces.
  addRoundBox(key, b, color, uvScale = 1 / 3, ao = 0, r = 0.15) {
    const g = roundBoxGeo(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ, r);
    g.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    this.addGeo(key, g, color, uvScale, ao, b.minY);
  }

  build(parent, materials) {
    const meshes = [];
    for (const [key, geos] of this.lists) {
      let count = 0;
      for (const g of geos) count += g.attributes.position.count;
      const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
      const uv = new Float32Array(count * 2), col = new Float32Array(count * 3);
      let o = 0;
      for (const g of geos) {
        const n = g.attributes.position.count;
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        uv.set(g.attributes.uv.array, o * 2);
        col.set(g.attributes.color.array, o * 3);
        o += n;
        g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      out.setAttribute('color', new THREE.BufferAttribute(col, 3));
      out.computeBoundingSphere();
      const mesh = new THREE.Mesh(out, materials[key] || materials.plain);
      parent.add(mesh);
      mesh.userData.key = key;
      meshes.push(mesh);
    }
    this.lists.clear();
    return meshes;
  }
}

// Rounded box whose subdivisions sit near the edges, so faces stay flat and only the edges curve.
const rbCache = new Map();
export function roundBoxGeo(w, h, d, r) {
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const key = `${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)},${r.toFixed(3)}`;
  if (rbCache.has(key)) return rbCache.get(key).clone();
  const g = new THREE.BoxGeometry(w, h, d, 5, 5, 5);
  const p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  const remap = (x, half) => {
    // snap the 6 grid lines to [-h, -h+.35r, -h+r, h-r, h-.35r, h]
    const t = Math.round((x / half + 1) * 2.5);
    return [-half, -half + 0.35 * r, -half + r, half - r, half - 0.35 * r, half][t];
  };
  const hx = w / 2, hy = h / 2, hz = d / 2;
  for (let i = 0; i < p.count; i++) {
    v.set(remap(p.getX(i), hx), remap(p.getY(i), hy), remap(p.getZ(i), hz));
    c.set(Math.max(-hx + r, Math.min(hx - r, v.x)), Math.max(-hy + r, Math.min(hy - r, v.y)), Math.max(-hz + r, Math.min(hz - r, v.z)));
    const dv = v.clone().sub(c);
    if (dv.lengthSq() > 1e-10) v.copy(c).add(dv.normalize().multiplyScalar(r));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  rbCache.set(key, g);
  return g.clone();
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
export function mat(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return _m.clone().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// Shared primitive geometries for props.
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  cone: new THREE.ConeGeometry(0.5, 1, 9),
  cone4: new THREE.ConeGeometry(0.5, 1, 4),
  sphere: new THREE.IcosahedronGeometry(0.5, 1),
  sphereHi: new THREE.SphereGeometry(0.5, 14, 10),
  plane: new THREE.PlaneGeometry(1, 1),
};

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

const TEX = {
  facade(rng) {
    // 6m x 6m tile: 4 x 4 windows. Returns { map, emissive }.
    const lit = [];
    for (let i = 0; i < 16; i++) lit.push(rng() < 0.4 ? ['#b8925a', '#5aa8b0', '#a85a92', '#b8ac8a'][Math.floor(rng() * 4)] : null);
    const draw = (emissive) => (g, s) => {
      g.fillStyle = emissive ? '#000' : '#c9cbd3'; g.fillRect(0, 0, s, s);
      if (!emissive) noise(g, s, 18, rng);
      const cell = s / 4;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const L = lit[y * 4 + x];
        if (emissive) { if (!L) continue; g.fillStyle = L; }
        else g.fillStyle = L ? '#8a8270' : '#2c3140';
        g.fillRect(x * cell + cell * 0.28, y * cell + cell * 0.22, cell * 0.44, cell * 0.5);
        if (emissive) {
          // window frame bars
          g.fillStyle = '#000';
          g.fillRect(x * cell + cell * 0.49, y * cell + cell * 0.22, cell * 0.02, cell * 0.5);
          g.fillRect(x * cell + cell * 0.28, y * cell + cell * 0.46, cell * 0.44, cell * 0.02);
        }
        if (!emissive) {
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(x * cell + cell * 0.12, y * cell + cell * 0.78, cell * 0.76, cell * 0.06);
        }
      }
      if (!emissive) {
        g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3;
        for (let y = 0; y <= 4; y++) { g.beginPath(); g.moveTo(0, y * cell); g.lineTo(s, y * cell); g.stroke(); }
      }
    };
    return { map: canvas(512, draw(false)), emissive: canvas(512, draw(true)) };
  },
  sandstone(rng) {
    return canvas(256, (g, s) => {
      g.fillStyle = '#efe2cc'; g.fillRect(0, 0, s, s);
      const rows = 4, h = s / rows;
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) * s / 4;
        for (let x = -1; x < 3; x++) {
          const v = 220 + rng() * 30;
          g.fillStyle = `rgb(${v},${v * 0.93},${v * 0.82})`;
          g.fillRect(x * s / 2 + off + 3, r * h + 3, s / 2 - 6, h - 6);
        }
      }
      noise(g, s, 26, rng);
      g.fillStyle = 'rgba(120,80,40,0.12)';
      for (let i = 0; i < 40; i++) g.fillRect(rng() * s, rng() * s, 2 + rng() * 6, 1 + rng() * 3);
    });
  },
  metal(rng) {
    return canvas(256, (g, s) => {
      for (let x = 0; x < s; x += 2) {
        const v = 170 + Math.sin(x / s * Math.PI * 16) * 40;
        g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 2, s);
      }
      noise(g, s, 14, rng);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, s, 6); g.fillRect(0, s - 6, s, 6);
      g.fillStyle = 'rgba(130,70,30,0.18)';
      for (let i = 0; i < 25; i++) g.fillRect(rng() * s, s * 0.7 + rng() * s * 0.3, 3, 10 + rng() * 30);
    });
  },
  mossConcrete(rng) {
    return canvas(256, (g, s) => {
      g.fillStyle = '#cfd2cc'; g.fillRect(0, 0, s, s);
      noise(g, s, 24, rng);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3;
      g.strokeRect(2, 2, s - 4, s - 4);
      for (let i = 0; i < 70; i++) {
        const y = s * (0.45 + rng() * 0.6), x = rng() * s, r = 6 + rng() * 26;
        g.fillStyle = `rgba(${40 + rng() * 40},${100 + rng() * 60},${40 + rng() * 30},${0.25 + rng() * 0.4})`;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(40,50,40,0.25)';
      for (let i = 0; i < 14; i++) g.fillRect(rng() * s, 0, 2 + rng() * 3, s * (0.2 + rng() * 0.5));
    });
  },
  stucco(rng) {
    return canvas(256, (g, s) => {
      g.fillStyle = '#f2ece4'; g.fillRect(0, 0, s, s);
      noise(g, s, 20, rng);
      // window with shutters
      const wx = s * 0.36, wy = s * 0.18, ww = s * 0.28, wh = s * 0.42;
      g.fillStyle = '#3a3330'; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = '#2f6b4a';
      g.fillRect(wx - ww * 0.42, wy, ww * 0.4, wh); g.fillRect(wx + ww * 1.02, wy, ww * 0.4, wh);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
      for (let i = 1; i < 7; i++) {
        const y = wy + wh * i / 7;
        g.beginPath(); g.moveTo(wx - ww * 0.42, y); g.lineTo(wx - ww * 0.02, y); g.stroke();
        g.beginPath(); g.moveTo(wx + ww * 1.02, y); g.lineTo(wx + ww * 1.42, y); g.stroke();
      }
      g.fillStyle = '#d9d1c4'; g.fillRect(wx - 6, wy + wh, ww + 12, 8);
      g.fillStyle = 'rgba(90,60,40,0.12)';
      for (let i = 0; i < 30; i++) g.fillRect(rng() * s, s * 0.8 + rng() * s * 0.2, 4 + rng() * 10, 2 + rng() * 6);
    });
  },
  asphalt(rng) {
    return canvas(256, (g, s) => {
      g.fillStyle = '#9aa0ab'; g.fillRect(0, 0, s, s);
      noise(g, s, 40, rng);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.strokeRect(0, 0, s, s);
      g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        g.beginPath(); let x = rng() * s, y = rng() * s; g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (rng() - 0.5) * 50; y += (rng() - 0.5) * 50; g.lineTo(x, y); }
        g.stroke();
      }
    });
  },
  sandTile(rng) {
    return canvas(256, (g, s) => {
      g.fillStyle = '#f0e2c6'; g.fillRect(0, 0, s, s);
      noise(g, s, 22, rng);
      g.strokeStyle = 'rgba(110,80,40,0.35)'; g.lineWidth = 3;
      g.strokeRect(0, 0, s, s); g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
      g.fillStyle = 'rgba(200,170,120,0.35)';
      for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(rng() * s, rng() * s, 5 + rng() * 20, 0, 7); g.fill(); }
    });
  },
  snow(rng) {
    return canvas(256, (g, s) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
      noise(g, s, 16, rng);
      g.fillStyle = 'rgba(150,170,200,0.18)';
      for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(rng() * s, rng() * s, 10 + rng() * 30, 4 + rng() * 10, rng() * 3, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(120,140,170,0.25)'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(0, s * 0.3); g.bezierCurveTo(s * 0.3, s * 0.2, s * 0.7, s * 0.5, s, s * 0.4); g.stroke();
    });
  },
  mossTile(rng) {
    return canvas(256, (g, s) => {
      g.fillStyle = '#c4c9c0'; g.fillRect(0, 0, s, s);
      noise(g, s, 30, rng);
      g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 3;
      g.strokeRect(0, 0, s, s); g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(${50 + rng() * 40},${110 + rng() * 50},${40 + rng() * 30},${0.2 + rng() * 0.35})`;
        g.beginPath(); g.arc(rng() * s, rng() * s, 4 + rng() * 22, 0, 7); g.fill();
      }
    });
  },
  cobble(rng) {
    return canvas(256, (g, s) => {
      g.fillStyle = '#6b625a'; g.fillRect(0, 0, s, s);
      const n = 8, c = s / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const v = 170 + rng() * 50;
        g.fillStyle = `rgb(${v},${v * 0.95},${v * 0.88})`;
        g.beginPath();
        g.ellipse((x + 0.5 + (y % 2) * 0.5) * c % s, (y + 0.5) * c, c * 0.44, c * 0.4, rng(), 0, 7);
        g.fill();
      }
      noise(g, s, 20, rng);
    });
  },
  wood(rng) {
    return canvas(256, (g, s) => {
      const n = 6, h = s / n;
      for (let i = 0; i < n; i++) {
        const v = 200 + rng() * 40;
        g.fillStyle = `rgb(${v},${v * 0.86},${v * 0.7})`;
        g.fillRect(0, i * h, s, h);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, i * h, s, 2);
        g.fillRect(((i * 97) % 5) * s / 5, i * h, 2, h);
        g.strokeStyle = 'rgba(90,50,20,0.18)'; g.lineWidth = 1;
        for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(0, i * h + rng() * h); g.bezierCurveTo(s / 3, i * h + rng() * h, s * 0.6, i * h + rng() * h, s, i * h + rng() * h); g.stroke(); }
      }
      noise(g, s, 14, rng);
    });
  },
  crate(rng) {
    return canvas(128, (g, s) => {
      g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, s, s);
      noise(g, s, 26, rng);
      g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10);
      g.lineWidth = 7; g.beginPath(); g.moveTo(8, 8); g.lineTo(s - 8, s - 8); g.stroke();
    });
  },
  container(rng) {
    return canvas(128, (g, s) => {
      for (let x = 0; x < s; x += 2) {
        const v = 200 + Math.sin(x / s * Math.PI * 12) * 45;
        g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 2, s);
      }
      noise(g, s, 12, rng);
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 6; g.strokeRect(3, 3, s - 6, s - 6);
    });
  },
  stone(rng) {
    return canvas(128, (g, s) => {
      g.fillStyle = '#e0e0e0'; g.fillRect(0, 0, s, s);
      noise(g, s, 30, rng);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3; g.strokeRect(2, 2, s - 4, s - 4);
      g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
    });
  },
  water(rng) {
    return canvas(256, (g, s) => {
      g.fillStyle = '#7fb4c4'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 140; i++) {
        g.strokeStyle = `rgba(255,255,255,${0.1 + rng() * 0.25})`; g.lineWidth = 1 + rng() * 2;
        const x = rng() * s, y = rng() * s, w = 10 + rng() * 30;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 4, x + w, y); g.stroke();
      }
    });
  },
};

function signTexture(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 160;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(8,6,20,0.85)';
  g.fillRect(0, 0, 512, 160);
  g.strokeStyle = color; g.lineWidth = 8; g.shadowColor = color; g.shadowBlur = 24;
  g.strokeRect(12, 12, 488, 136);
  g.font = 'bold 92px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff'; g.fillText(text, 256, 84);
  g.fillStyle = color; g.globalAlpha = 0.6; g.fillText(text, 256, 84);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function letterTexture(letter, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.shadowColor = color; g.shadowBlur = 18;
  g.strokeStyle = color; g.lineWidth = 12;
  g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.stroke();
  g.fillStyle = color;
  g.font = 'bold 170px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 128, 138);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Sky, backdrop and props
// ---------------------------------------------------------------------------

function skyDome(top, mid, bottom) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*1.6,0.0,1.0), 0.8)) : mix(mid, bottom, clamp(-h*4.0,0.0,1.0));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(480, 24, 16), mat);
  m.renderOrder = -10;
  return m;
}

function stars(n, rng) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const th = rng() * Math.PI * 2, y = 0.12 + rng() * 0.88, r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(th) * r * 450; pos[i * 3 + 1] = y * 450; pos[i * 3 + 2] = Math.sin(th) * r * 450;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false }));
}

function disc(color, size, dir) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(size, 32), new THREE.MeshBasicMaterial({ color, fog: false, depthWrite: false }));
  m.position.copy(dir).normalize().multiplyScalar(440);
  m.lookAt(0, 0, 0);
  return m;
}

const P = {
  lamp(b, x, z, h, poleColor, glowColor, ry = 0) {
    b.add('plain', G.cyl, mat(x, h / 2, z, 0, 0.14, h, 0.14), poleColor);
    b.add('plain', G.box, mat(x - Math.sin(ry) * 0.45, h, z - Math.cos(ry) * 0.45, ry, 0.12, 0.12, 1.0), poleColor);
    b.add('glow', G.box, mat(x - Math.sin(ry) * 0.9, h - 0.12, z - Math.cos(ry) * 0.9, ry, 0.35, 0.12, 0.5), glowColor);
    b.add('beam', G.cone, mat(x - Math.sin(ry) * 0.9, h / 2 - 0.1, z - Math.cos(ry) * 0.9, 0, 2.6, h - 0.2, 2.6), glowColor);
  },
  palm(b, x, z, h, rng) {
    const lean = (rng() - 0.5) * 0.25, dir = rng() * Math.PI * 2;
    const segs = 6;
    let px = x, pz = z;
    for (let i = 0; i < segs; i++) {
      const y = (i + 0.5) * h / segs;
      px += Math.sin(dir) * lean * h / segs; pz += Math.cos(dir) * lean * h / segs;
      b.add('plain', G.cyl6, mat(px, y, pz, i, 0.32 - i * 0.025, h / segs + 0.05, 0.32 - i * 0.025), i % 2 ? 0x8a6a45 : 0x7a5c3a);
    }
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + rng();
      b.add('plain', G.box, mat(px + Math.sin(a) * 1.3, h - 0.1, pz + Math.cos(a) * 1.3, a, 0.5, 0.06, 2.8, 0.45), i % 2 ? 0x3f8a3a : 0x2f7a32);
    }
    b.add('plain', G.sphere, mat(px, h - 0.1, pz, 0, 0.6), 0x5a3e22);
  },
  pine(b, x, z, h, snowy) {
    b.add('plain', G.cyl6, mat(x, h * 0.12, z, 0, 0.35, h * 0.25, 0.35), 0x4a3524);
    for (let i = 0; i < 3; i++) {
      const y = h * (0.3 + i * 0.22), w = h * (0.42 - i * 0.1);
      b.add('plain', G.cone, mat(x, y, z, i, w, h * 0.4, w), 0x2b5a3a);
      if (snowy) b.add('plain', G.cone, mat(x, y + h * 0.1, z, i, w * 0.6, h * 0.2, w * 0.6), 0xf2f6ff);
    }
  },
  jungleTree(b, x, z, h, rng) {
    b.add('plain', G.cyl6, mat(x, h / 2, z, 0, 0.7, h, 0.7), 0x5a4632);
    for (let i = 0; i < 4; i++) {
      const a = rng() * Math.PI * 2, r = rng() * h * 0.15;
      const s = h * (0.25 + rng() * 0.15);
      b.add('plain', G.sphere, mat(x + Math.sin(a) * r, h * (0.85 + rng() * 0.2), z + Math.cos(a) * r, a, s, s * 0.7, s),
        [0x2f6b2a, 0x3d7d32, 0x285c26, 0x4a8a3a][i]);
    }
  },
  fern(b, x, z, rng) {
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + rng();
      b.add('plain', G.box, mat(x + Math.sin(a) * 0.4, 0.35, z + Math.cos(a) * 0.4, a, 0.25, 0.04, 1.1, -0.6), 0x3f8a3a);
    }
  },
  vine(b, x, y, z, nx, nz, len, rng) {
    const ry = Math.atan2(nx, nz);
    b.add('plain', G.box, mat(x + nx * 0.05, y - len / 2, z + nz * 0.05, ry, 0.12 + rng() * 0.1, len, 0.05), rng() < 0.5 ? 0x2f6b2a : 0x3d7d32);
  },
  barrel(b, x, z, color) {
    b.add('plain', G.cyl, mat(x, 0.5, z, 0, 0.7, 1.0, 0.7), color);
    b.add('plain', G.cyl, mat(x, 0.25, z, 0, 0.72, 0.06, 0.72), 0x333333);
    b.add('plain', G.cyl, mat(x, 0.75, z, 0, 0.72, 0.06, 0.72), 0x333333);
  },
  pot(b, x, z, s, color) {
    b.add('plain', G.sphereHi, mat(x, 0.45 * s, z, 0, 0.8 * s, 0.9 * s, 0.8 * s), color);
    b.add('plain', G.cyl, mat(x, 0.92 * s, z, 0, 0.35 * s, 0.25 * s, 0.35 * s), color);
  },
  gondola(b, x, y, z, ry) {
    b.add('plain', G.box, mat(x, y, z, ry, 1.1, 0.5, 6.5), 0x15151a);
    b.add('plain', G.cone, mat(x + Math.sin(ry) * 3.6, y + 0.5, z + Math.cos(ry) * 3.6, ry, 0.5, 1.6, 0.5, 0.4), 0x15151a);
    b.add('plain', G.cone, mat(x - Math.sin(ry) * 3.6, y + 0.4, z - Math.cos(ry) * 3.6, ry, 0.5, 1.2, 0.5, -0.4), 0x15151a);
    b.add('plain', G.box, mat(x, y + 0.3, z, ry, 0.9, 0.15, 1.2), 0x8a2a2a);
  },
  mooring(b, x, y0, z, h, c1, c2) {
    const n = 4;
    for (let i = 0; i < n; i++) b.add('plain', G.cyl, mat(x, y0 + (i + 0.5) * h / n, z, 0, 0.2, h / n, 0.2), i % 2 ? c1 : c2);
  },
  snowPile(b, x, z, s) {
    b.add('plain', G.sphere, mat(x, 0, z, s, s * 1.6, s * 0.7, s * 1.2), 0xf4f8ff);
  },
  antenna(b, x, z, h) {
    b.add('plain', G.cyl6, mat(x, h / 2, z, 0, 0.15, h, 0.15), 0x777e88);
    for (let i = 1; i < 4; i++) b.add('plain', G.box, mat(x, h * i / 4, z, i, 1.2 - i * 0.2, 0.06, 0.06), 0x777e88);
    b.add('glow', G.sphere, mat(x, h + 0.2, z, 0, 0.35), 0xff3b3b);
  },
  cloud(b, x, y, z, s, rng) {
    for (let i = 0; i < 5; i++) {
      b.add('cloud', G.sphere, mat(x + (rng() - 0.5) * s * 2, y + rng() * s * 0.3, z + (rng() - 0.5) * s, 0, s * (0.6 + rng() * 0.5), s * 0.45, s * 0.8), 0xffffff);
    }
  },
};

function posterAtlas(rng) {
  // 4 x 2 posters / banners in one texture
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d');
  const sets = [
    ['#ff3fd2', '#1a0f2e', 'NEON'], ['#3ff3ff', '#0f1a2e', 'VOLT'], ['#ffd23f', '#2e1a0f', 'SALE'], ['#ff6b4f', '#1a1a1a', 'LIVE'],
    ['#9a5bff', '#f2f2f2', 'RAVE'], ['#4fff9a', '#102010', 'GO!'], ['#ff4f7a', '#fff3d6', 'OPEN'], ['#4f9aff', '#ffe9c4', 'FIZZ'],
  ];
  sets.forEach(([fg, bg, txt], i) => {
    const x = (i % 4) * 128, y = Math.floor(i / 4) * 128;
    g.fillStyle = bg; g.fillRect(x + 4, y + 4, 120, 120);
    g.fillStyle = fg;
    g.beginPath(); g.arc(x + 64, y + 50, 28 + rng() * 10, 0, 7); g.fill();
    g.fillStyle = bg === '#f2f2f2' || bg.startsWith('#ff') ? '#222' : '#fff';
    g.font = 'bold 30px sans-serif'; g.textAlign = 'center';
    g.fillText(txt, x + 64, y + 112);
    g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(x + 8, y + 8, 112, 112);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const posterGeo = [];
for (let i = 0; i < 8; i++) {
  const g = new THREE.PlaneGeometry(1, 1);
  const u0 = (i % 4) / 4, v0 = 1 - (Math.floor(i / 4) + 1) / 2;
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) / 4, v0 + uv.getY(k) / 2);
  posterGeo.push(g);
}

// Walks from a wall face across open cells until the opposite wall. Returns length in cells (or 0).
function spanAcross(map, f, maxCells = 5) {
  for (let k = 1; k <= maxCells + 1; k++) {
    const c = map.ch(f.cx + f.nx * k, f.cz + f.nz * k);
    if (c === '#') return k - 1;
    if (c === 'w' || c === 'n' || c === ',' || c === '2') return 0;
  }
  return 0;
}

const Q = {
  poster(b, f, y, i, w = 1.1, h = 1.4) {
    b.add('poster', posterGeo[i % 8], mat(f.x + f.nx * 0.04, y, f.z + f.nz * 0.04, Math.atan2(f.nx, f.nz), w, h, 1));
  },
  // A sagging line strung between two walls, with things hanging off it.
  string(b, map, f, y, cells, hang, rng) {
    const len = cells * 3, n = Math.max(4, cells * 4);
    const ry = Math.atan2(f.nx, f.nz);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
      const sag = Math.sin(tm * Math.PI) * 0.6;
      const x = f.x + f.nx * len * tm, z = f.z + f.nz * len * tm;
      b.add('plain', G.box, mat(x, y - sag, z, ry, 0.03, 0.03, len / n + 0.02), 0x222222);
      if (i % 2 === 0) hang(x, y - sag, z, ry, i);
    }
  },
  ac(b, f, y) {
    const ry = Math.atan2(f.nx, f.nz);
    b.add('plain', G.box, mat(f.x + f.nx * 0.35, y, f.z + f.nz * 0.35, ry, 1.0, 0.7, 0.7), 0xc8ccd2);
    b.add('plain', G.cyl, mat(f.x + f.nx * 0.71, y, f.z + f.nz * 0.71, ry, 0.5, 0.02, 0.5, Math.PI / 2), 0x55595f);
  },
  vending(b, x, z, ry, color, glowColor) {
    b.add('plain', G.box, mat(x, 1.0, z, ry, 1.0, 2.0, 0.8), color);
    b.add('glow', G.box, mat(x - Math.sin(ry) * 0.41, 1.25, z - Math.cos(ry) * 0.41, ry, 0.7, 1.1, 0.02), glowColor);
    b.add('plain', G.box, mat(x - Math.sin(ry) * 0.41, 0.35, z - Math.cos(ry) * 0.41, ry, 0.6, 0.18, 0.03), 0x111111);
  },
  dumpster(b, x, z, ry, color) {
    b.add('plain', G.box, mat(x, 0.6, z, ry, 1.9, 1.2, 1.1), color);
    b.add('plain', G.box, mat(x, 1.25, z, ry, 2.0, 0.1, 1.2, -0.12), 0x2a2a2a);
  },
  bags(b, x, z, rng) {
    for (let i = 0; i < 3; i++) b.add('plain', G.sphere, mat(x + (rng() - 0.5) * 0.8, 0.25, z + (rng() - 0.5) * 0.8, rng() * 3, 0.55, 0.5, 0.5), 0x1d1f24);
  },
  crates(b, x, z, ry, rng) {
    b.add('low', G.box, mat(x, 0.4, z, ry, 0.8, 0.8, 0.8), 0xb08860);
    if (rng() < 0.7) b.add('low', G.box, mat(x + 0.85 * Math.cos(ry), 0.35, z - 0.85 * Math.sin(ry), ry + 0.2, 0.7, 0.7, 0.7), 0xa07850);
    if (rng() < 0.5) b.add('low', G.box, mat(x + 0.1, 1.08, z, ry + 0.4, 0.6, 0.6, 0.6), 0xc09870);
  },
  bench(b, x, z, ry, color) {
    b.add('plain', G.box, mat(x, 0.45, z, ry, 1.6, 0.08, 0.45), color);
    b.add('plain', G.box, mat(x + Math.sin(ry) * 0.22, 0.75, z + Math.cos(ry) * 0.22, ry, 1.6, 0.4, 0.06), color);
    b.add('plain', G.box, mat(x, 0.22, z, ry, 1.4, 0.44, 0.06), 0x333333);
  },
  planter(b, x, z, s, potColor, leaf) {
    b.add('plain', G.box, mat(x, 0.3 * s, z, 0, 0.8 * s, 0.6 * s, 0.8 * s), potColor);
    b.add('plain', G.sphere, mat(x, 0.85 * s, z, 0, 1.0 * s, 0.9 * s, 1.0 * s), leaf);
  },
  stall(b, x, z, ry, c1, c2, rng) {
    const fx = -Math.sin(ry), fz = -Math.cos(ry);
    b.add('plain', G.box, mat(x, 0.9, z, ry, 2.2, 0.1, 1.0), 0x8a5a32);
    b.add('plain', G.box, mat(x, 0.45, z, ry, 2.1, 0.9, 0.9), 0x6a4426);
    for (let i = 0; i < 4; i++) b.add('plain', G.sphere, mat(x + (rng() - 0.5) * 1.6 * Math.cos(ry), 1.05, z - (rng() - 0.5) * 1.6 * Math.sin(ry), 0, 0.3, 0.2, 0.3), [0xff6b3d, 0xffd23f, 0x6bd23f, 0xd23f6b][i]);
    for (const s of [-1, 1]) b.add('plain', G.cyl, mat(x + s * 1.05 * Math.cos(ry) + fx * 0.45, 1.25, z - s * 1.05 * Math.sin(ry) + fz * 0.45, 0, 0.06, 2.5, 0.06), 0x5a3a20);
    for (let i = 0; i < 4; i++) {
      const o = (i - 1.5) * 0.56;
      b.add('plain', G.box, mat(x + o * Math.cos(ry) + fx * 0.25, 2.45, z - o * Math.sin(ry) + fz * 0.25, ry, 0.56, 0.05, 1.5, -0.25), i % 2 ? c1 : c2);
    }
  },
  rug(b, x, y, z, ry, c1, c2) {
    b.add('plain', G.box, mat(x, y + 0.02, z, ry, 2.2, 0.03, 1.5), c1);
    b.add('plain', G.box, mat(x, y + 0.035, z, ry, 1.6, 0.03, 0.9), c2);
  },
  sandbags(b, x, z, ry) {
    for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) {
      const o = (i - 1 + (r ? 0.5 : 0)) * 0.6;
      if (r && i === 2) continue;
      b.add('plain', G.sphere, mat(x + o * Math.cos(ry), 0.18 + r * 0.3, z - o * Math.sin(ry), ry, 0.62, 0.32, 0.4), 0xa89a78);
    }
  },
  flood(b, x, z, h, ry) {
    b.add('plain', G.cyl6, mat(x, h / 2, z, 0, 0.16, h, 0.16), 0x5a606a);
    b.add('plain', G.box, mat(x, h, z, ry, 1.0, 0.5, 0.35), 0x3a3f48);
    b.add('glow', G.box, mat(x - Math.sin(ry) * 0.18, h - 0.02, z - Math.cos(ry) * 0.18, ry, 0.85, 0.36, 0.02), 0xfff2d0);
    b.add('beam', G.cone, mat(x - Math.sin(ry) * 2.2, h / 2, z - Math.cos(ry) * 2.2, ry, 3.5, h, 3.5, 0.45), 0xfff2c0);
  },
  table(b, x, y, z, ry) {
    b.add('plain', G.box, mat(x, y + 0.75, z, ry, 1.4, 0.08, 0.8), 0x7a5232);
    for (const [a, c] of [[-0.6, -0.32], [0.6, -0.32], [-0.6, 0.32], [0.6, 0.32]]) {
      b.add('plain', G.box, mat(x + a * Math.cos(ry) + c * Math.sin(ry), y + 0.37, z - a * Math.sin(ry) + c * Math.cos(ry), ry, 0.07, 0.74, 0.07), 0x5a3a20);
    }
    b.add('plain', G.cyl, mat(x, y + 0.88, z, 0, 0.16, 0.18, 0.16), 0xe8e2d6);
  },
  shelf(b, f, y, rng) {
    const ry = Math.atan2(f.nx, f.nz);
    const x = f.x + f.nx * 0.3, z = f.z + f.nz * 0.3;
    b.add('plain', G.box, mat(x, y + 1.0, z, ry, 2.2, 2.0, 0.5), 0x6a4a2e);
    for (let k = 0; k < 3; k++) for (let i = 0; i < 5; i++) {
      b.add('plain', G.box, mat(x + (i - 2) * 0.4 * Math.cos(ry) + f.nx * 0.05, y + 0.45 + k * 0.6, z - (i - 2) * 0.4 * Math.sin(ry) + f.nz * 0.05, ry, 0.25, 0.3 + rng() * 0.15, 0.3), [0xd8503a, 0x3a8ad8, 0xe8c24a, 0x5ab85a, 0xe8e2d6][Math.floor(rng() * 5)]);
    }
  },
  cable(b, f, y0, y1) {
    const ry = Math.atan2(f.nx, f.nz);
    b.add('plain', G.box, mat(f.x + f.nx * 0.08, (y0 + y1) / 2, f.z + f.nz * 0.08, ry, 0.05, y1 - y0, 0.05), 0x1a1a1a);
  },
};


// ---- curved / organic pieces ------------------------------------------------

const hemi = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const halfCyl = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false, 0, Math.PI);
const rockGeo = new THREE.IcosahedronGeometry(0.5, 0);
const discGeo = new THREE.CircleGeometry(1, 22);

const R = {
  rock(b, x, y, z, s, color, rng, cap) {
    b.add('plain', rockGeo, mat(x, y + s * 0.18, z, rng() * 6, s * (0.9 + rng() * 0.5), s * (0.55 + rng() * 0.35), s * (0.9 + rng() * 0.4), rng(), rng()), color);
    if (cap) b.add('plain', G.sphere, mat(x, y + s * 0.42, z, 0, s * 0.8, s * 0.22, s * 0.7), cap);
  },
  bush(b, x, y, z, s, color, rng) {
    for (let i = 0; i < 3; i++) {
      const a = rng() * Math.PI * 2;
      b.add('plain', G.sphere, mat(x + Math.cos(a) * s * 0.3, y + s * (0.32 + rng() * 0.15), z + Math.sin(a) * s * 0.3, 0, s * (0.7 + rng() * 0.3), s * 0.6, s * (0.7 + rng() * 0.3)), i ? color : new THREE.Color(color).multiplyScalar(1.15));
    }
  },
  puddle(b, x, y, z, s, rng) {
    b.add('puddle', discGeo, mat(x, y + 0.012, z, rng() * 3, s * (0.8 + rng() * 0.6), 1, s * (0.5 + rng() * 0.4), -Math.PI / 2), 0xffffff);
  },
  drift(b, x, z, s, rng) {
    b.add('plain', G.sphere, mat(x, 0, z, rng() * 3, s * 2.2, s * 0.5, s * 1.1), 0xf4f8ff);
  },
  dome(b, cx, h, cz, r, color, tip) {
    b.add('plain', G.cyl, mat(cx, h + 0.2, cz, 0, r * 2.1, 0.4, r * 2.1), color);
    b.add('plain', hemi, mat(cx, h + 0.4, cz, 0, r, r * 0.9, r), color);
    if (tip) { b.add('plain', G.cyl6, mat(cx, h + 0.4 + r * 0.9 + 0.3, cz, 0, 0.12, 0.6, 0.12), tip); b.add('glow', G.sphere, mat(cx, h + 0.4 + r * 0.9 + 0.7, cz, 0, 0.25), 0xffd27a); }
  },
  hangar(b, bx, h, color, alongX) {
    const w = bx.maxX - bx.minX, d = bx.maxZ - bx.minZ, cx = (bx.minX + bx.maxX) / 2, cz = (bx.minZ + bx.maxZ) / 2;
    const r = (alongX ? d : w) / 2, len = alongX ? w : d;
    // half cylinder lying along the long axis
    b.add('plain', halfCyl, mat(cx, h, cz, alongX ? 0 : Math.PI / 2, r, len, r * 0.75, 0, Math.PI / 2), color);
  },
  gable(b, bx, h, color, alongX) {
    const w = bx.maxX - bx.minX, d = bx.maxZ - bx.minZ;
    const half = (alongX ? d : w) / 2 + 0.35, rise = Math.min(2.6, half * 0.75), len = (alongX ? w : d) + 0.5;
    const shape = new THREE.Shape();
    shape.moveTo(-half, 0); shape.lineTo(half, 0); shape.lineTo(0, rise); shape.lineTo(-half, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);
    if (alongX) g.rotateY(Math.PI / 2);
    g.translate((bx.minX + bx.maxX) / 2, h + 0.25, (bx.minZ + bx.maxZ) / 2);
    b.add('plain', g, null, color);
  },
  tank(b, x, h, z, color) {
    for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) b.add('plain', G.cyl6, mat(x + dx, h + 0.6, z + dz, 0, 0.1, 1.2, 0.1), 0x3a3f48);
    b.add('plain', G.cyl, mat(x, h + 2.1, z, 0, 2.0, 1.8, 2.0), color);
    b.add('plain', G.cone, mat(x, h + 3.3, z, 0, 2.1, 0.6, 2.1), shade(color, 0.8));
  },
  balcony(b, f, y, color, rail, rng) {
    const ry = Math.atan2(f.nx, f.nz);
    const fx = f.x + f.nx * 0.45, fz = f.z + f.nz * 0.45;
    b.add('plain', G.box, mat(fx, y, fz, ry, 2.2, 0.16, 0.9), color);
    b.add('plain', G.box, mat(f.x + f.nx * 0.03, y + 1.1, f.z + f.nz * 0.03, ry, 1.0, 2.0, 0.04), 0x2a2420);
    b.add('plain', G.box, mat(f.x + f.nx * 0.88, y + 0.95, f.z + f.nz * 0.88, ry, 2.2, 0.06, 0.06), rail);
    for (let k = 0; k < 7; k++) {
      const o = (k - 3) * 0.35;
      b.add('plain', G.cyl6, mat(fx + Math.cos(ry) * o + f.nx * 0.43, y + 0.5, fz - Math.sin(ry) * o + f.nz * 0.43, 0, 0.04, 0.85, 0.04), rail);
    }
    if (rng() < 0.6) b.add('plain', G.sphere, mat(fx + Math.cos(ry) * 0.7, y + 0.3, fz - Math.sin(ry) * 0.7, 0, 0.4, 0.35, 0.4), rng() < 0.5 ? 0x3f8a3a : 0xe84a6a);
  },
};

function shade(hex, k) { return new THREE.Color(hex).multiplyScalar(k).getHex(); }

// Rocks, bushes, puddles and drifts that break up floors and wall lines.
export function scatterGround(ctx, spec) {
  if (!spec) return;
  const { b, rng, faces, floorCells, cellCenter, map } = ctx;
  const ok = (c) => c.ch !== 'T' && c.ch !== 'D' && !'^v<>,'.includes(c.ch);
  for (const f of faces) {
    if (f.base) continue;
    const along = (rng() - 0.5) * 2.4;
    const x = f.x + f.nx * 0.45 + f.nz * along, z = f.z + f.nz * 0.45 - f.nx * along;
    const r = rng();
    if (spec.rocks && r < spec.rockChance) R.rock(b, x, 0, z, 0.5 + rng() * 0.6, spec.rocks[Math.floor(rng() * spec.rocks.length)], rng, spec.rockCap);
    else if (spec.bushes && r < spec.rockChance + spec.bushChance) R.bush(b, x, 0, z, 0.6 + rng() * 0.5, spec.bushes[Math.floor(rng() * spec.bushes.length)], rng);
    else if (spec.drifts && r < spec.rockChance + 0.25) R.drift(b, x, z, 0.5 + rng() * 0.5, rng);
  }
  for (const c of floorCells) {
    if (!ok(c)) continue;
    const p = cellCenter(c.x, c.z), y = map.cellHeight(c.x, c.z);
    if (spec.puddles && rng() < spec.puddles) R.puddle(b, p.x + (rng() - 0.5) * 1.6, y, p.z + (rng() - 0.5) * 1.6, 0.6 + rng() * 0.6, rng);
    if (spec.pebbles && rng() < spec.pebbles) for (let i = 0; i < 4; i++) R.rock(b, p.x + (rng() - 0.5) * 2.4, y, p.z + (rng() - 0.5) * 2.4, 0.12 + rng() * 0.12, spec.rocks[0], rng);
  }
  if (spec.balconies) {
    for (const f of faces) if (f.top >= 7 && rng() < spec.balconies) R.balcony(b, f, f.base + 3.45, spec.balconyColor, spec.railColor, rng);
  }
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export const THEMES = {
  neon: {
    archStyle: 'square', pilasterColor: 0x2a2a3a,
    ground: { rocks: [0x55586a], rockChance: 0.04, puddles: 0.22, pebbles: 0, balconies: 0.12, balconyColor: 0x3a3a4e, railColor: 0xff3fd2 },
    roof(b, bx, rng, r) {
      if (rng() < 0.35 && r.w >= 3 && r.d >= 3) R.tank(b, r.cx, r.h, r.cz, 0x6a5a7a);
      else if (rng() < 0.3) { b.add('plain', G.box, mat(r.cx, r.h + 1.6, r.cz, rng() * 3, 4, 2.2, 0.15), 0x1a1a24); b.add('glow', G.box, mat(r.cx, r.h + 1.6, r.cz, 0, 3.6, 1.8, 0.17), [0xff3fd2, 0x3ff3ff, 0xffd23f][Math.floor(rng() * 3)]); }
    },
    sky: ['#05030f', '#2a1048', '#0b0716'], stars: true, moon: { color: 0xdfe6ff, size: 14, dir: [0.4, 0.5, -0.8] },
    fog: [0x24163e, 40, 200], hemi: [0x9a8bff, 0x4a3a66, 1.7], sun: [0xb0c4ff, 1.0, [30, 60, 40]],
    wall: 'facade', wallUv: 1 / 6, wallColors: [0x6a6a8a, 0x5a6a86, 0x7a6a86, 0x5a607a, 0x72729a], wallHeight: [7, 14],
    emissiveWalls: true, trim: { glow: true, colors: [0xff3fd2, 0x3ff3ff, 0xffd23f, 0x9a5bff] },
    floor: 'asphalt', floorColor: 0x7a7d8c, site: { A: 0x6a4a7a, B: 0x3f5a7a }, spawn: { T: 0x4a5a58, D: 0x5a4a52 },
    low: { tex: 'crate', colors: [0x4a5068, 0x56506a], glow: 0x3ff3ff }, high: { tex: 'container', colors: [0x283a5a, 0x5a2846, 0x284a3a], glow: 0xff3fd2 },
    pillar: 0x3a3f52, siteGlow: { A: '#ff7ad9', B: '#7ff6ff' },
    lights: [[0xff3fd2, 'A'], [0x3ff3ff, 'B'], [0xffb347, 'mid']],
    particles: 'rain', exposure: 1.0,
    shinyFloor: true, trimColor: 0x2a2a3a, ledgeColor: 0x4a4a66, railColor: 0x22222e, ceilColor: 0x3a3a4e, indoorColor: 0x8a6a5a, indoorLight: 0xff9ae0,
    coverDetail(b, bx, low, rng) {
      const cx = (bx.minX + bx.maxX) / 2, cz = (bx.minZ + bx.maxZ) / 2;
      if (!low) {
        // food kiosk: glowing menu board + awning
        b.add('glow', G.box, mat(cx, 1.7, bx.minZ - 0.02, 0, 2.2, 0.5, 0.03), rng() < 0.5 ? 0xff7ad9 : 0x7ff6ff);
        b.add('plain', G.box, mat(cx, 2.5, cz, 0, 3.0, 0.1, 3.0), 0x22222e);
      }
    },
    decorate(ctx) {
      const { b, rng, faces, scene, map, indoorCells, cellCenter } = ctx;
      const words = [['NOODLE', '#ff4fd8'], ['24/7', '#4ff3ff'], ['ARCADE', '#ffd23f'], ['HOTEL', '#9a7bff'], ['RAMEN', '#ff6b4f'], ['CYBER', '#4fff9a'], ['BAR', '#ff4f7a'], ['TAXI', '#ffe14f'], ['KARAOKE', '#4fd8ff'], ['PIZZA', '#ff9a3f']];
      const picks = faces.filter(() => rng() < 0.55).sort(() => rng() - 0.5).slice(0, 14);
      picks.forEach((f, i) => {
        const [text, color] = words[i % words.length];
        const m = new THREE.Mesh(G.plane, new THREE.MeshBasicMaterial({ map: signTexture(text, color), transparent: true }));
        const vertical = i % 3 === 0;
        m.scale.set(vertical ? 1.2 : 3.2, vertical ? 3.4 : 1.0, 1);
        m.position.set(f.x + f.nx * (vertical ? 0.5 : 0.06), f.base + 4.4 + rng() * 1.6, f.z + f.nz * (vertical ? 0.5 : 0.06));
        m.rotation.y = Math.atan2(f.nx, f.nz) + (vertical ? Math.PI / 2 : 0);
        if (vertical) m.material.side = THREE.DoubleSide;
        scene.add(m);
      });
      for (const f of faces) {
        const y = f.base, r = rng(), ry = Math.atan2(f.nx, f.nz);
        const px = f.x + f.nx * 0.55, pz = f.z + f.nz * 0.55;
        if (r < 0.08) P.lamp(b, f.x + f.nx * 0.3, f.z + f.nz * 0.3, 4.2, 0x22252e, rng() < 0.5 ? 0xff7ad9 : 0x7ff6ff, ry + Math.PI);
        else if (r < 0.15 && !y) Q.vending(b, px, pz, ry + Math.PI, [0xc23a5a, 0x2a5ac2, 0x2a2a3a][Math.floor(rng() * 3)], rng() < 0.5 ? 0xbff6ff : 0xffd6f0);
        else if (r < 0.2 && !y) Q.dumpster(b, f.x + f.nx * 0.7, f.z + f.nz * 0.7, ry, 0x2f5a3a);
        else if (r < 0.26 && !y) Q.bags(b, px, pz, rng);
        if (rng() < 0.45) Q.poster(b, f, y + 1.6 + rng() * 0.5, Math.floor(rng() * 8));
        if (rng() < 0.3) Q.ac(b, f, y + 3 + rng() * 3);
        if (rng() < 0.25) Q.cable(b, f, 0.2, f.top);
        if (rng() < 0.35) b.add('glow', G.box, mat(f.x + f.nx * 0.03, y + 0.08, f.z + f.nz * 0.03, ry, 2.6, 0.06, 0.04), rng() < 0.5 ? 0xff3fd2 : 0x3ff3ff);
        // strings of lanterns over the street
        const span = spanAcross(map, f, 4);
        if (span >= 2 && rng() < 0.22) {
          const col = [0xff4fd8, 0x4ff3ff, 0xffd23f][Math.floor(rng() * 3)];
          Q.string(b, map, f, Math.min(f.top - 0.5, 6.2), span, (x, yy, z) => b.add('glow', G.sphere, mat(x, yy - 0.25, z, 0, 0.3, 0.38, 0.3), col), rng);
        }
      }
      for (const c of indoorCells) {
        const p = cellCenter(c.x, c.z);
        if (rng() < 0.4) Q.table(b, p.x + (rng() - 0.5), 0, p.z + (rng() - 0.5), rng() * 3);
      }
    },
    backdrop(ctx) {
      const { b, rng, cx, cz, rx, rz } = ctx;
      for (let i = 0; i < 70; i++) {
        const a = i / 70 * Math.PI * 2, r = Math.max(rx, rz) + 18 + rng() * 60;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.85;
        const w = 8 + rng() * 14, h = 25 + rng() * 70;
        b.addBox('wall', { minX: x - w / 2, maxX: x + w / 2, minZ: z - w / 2, maxZ: z + w / 2, minY: 0, maxY: h }, [0x2e2e44, 0x34304a, 0x2a3346][i % 3], 1 / 6);
        if (rng() < 0.6) b.add('glow', G.box, mat(x, h + 0.1, z, 0, w + 0.2, 0.25, w + 0.2), [0xff3fd2, 0x3ff3ff, 0x9a5bff][i % 3]);
        if (rng() < 0.3) P.antenna(b, x, z, 0);
      }
    },
  },

  desert: {
    archStyle: 'arch', pilasters: false,
    ground: { rocks: [0xd2a676, 0xc89a6a, 0xb88a5a], rockChance: 0.18, bushes: [0x8a9a4a, 0x6a7a3a], bushChance: 0.08, pebbles: 0.12 },
    roof(b, bx, rng, r) {
      if (rng() < 0.35 && Math.min(r.w, r.d) >= 3) R.dome(b, r.cx, r.h, r.cz, Math.min(r.w, r.d) * 0.36, rng() < 0.5 ? 0xf2d8ae : 0x4aa8b8, 0xc9952a);
    },
    sky: ['#4f86d0', '#ffc07a', '#f6d0a0'], sun: [0xffd0a0, 2.4, [-50, 40, 70]], sunDisc: { color: 0xffe0a8, size: 18 },
    fog: [0xf2c79a, 60, 260], hemi: [0xfff0d8, 0xa8805a, 1.6],
    wall: 'sandstone', wallUv: 1 / 3, wallColors: [0xf2cfa0, 0xeac294, 0xf6d8ae, 0xe2b888], wallHeight: [5, 10],
    trim: { colors: [0xc9955f], crenel: true },
    floor: 'sandTile', floorColor: 0xe9cfa3, site: { A: 0xe0a86a, B: 0xd49a7a }, spawn: { T: 0xd8c49a, D: 0xd8b49a },
    low: { tex: 'stone', colors: [0xd2a676, 0xc89a6a] }, high: { tex: 'crate', colors: [0x9a7048, 0x8a6440] },
    pillar: 0xe6c495, siteGlow: { A: '#fff1c4', B: '#fff1c4' },
    lights: [], particles: 'dust',
    trimColor: 0xd9b48a, ledgeColor: 0xe2b98a, railColor: 0x8a6440, ceilColor: 0xcfa070, indoorColor: 0xc89a6a, indoorLight: 0xffd8a0, railings: true,
    coverDetail(b, bx, low, rng) {
      const cx = (bx.minX + bx.maxX) / 2, cz = (bx.minZ + bx.maxZ) / 2;
      if (!low) b.add('plain', G.box, mat(cx, bx.maxY + 0.05, cz, 0, bx.maxX - bx.minX + 0.4, 0.1, bx.maxZ - bx.minZ + 0.4), [0xc0392b, 0x2e86c1, 0xe5a823][Math.floor(rng() * 3)]);
    },
    decorate(ctx) {
      const { b, rng, faces, floorCells, cellCenter, map, indoorCells } = ctx;
      for (const f of faces) {
        const r = rng(), ry = Math.atan2(f.nx, f.nz), y = f.base;
        const px = f.x + f.nx * 0.7, pz = f.z + f.nz * 0.7;
        if (r < 0.07) P.pot(b, f.x + f.nx * 0.6, f.z + f.nz * 0.6, 0.9 + rng() * 0.4, rng() < 0.5 ? 0xb5653a : 0x8a4a2a);
        else if (r < 0.12) b.add('plain', G.box, mat(f.x + f.nx * 0.8, y + 3.0, f.z + f.nz * 0.8, ry, 2.4, 0.06, 1.7, 0.35), [0xc0392b, 0x2e86c1, 0xe5a823, 0x1e8449][Math.floor(rng() * 4)]);
        else if (r < 0.17) b.add('plain', G.box, mat(f.x + f.nx * 0.05, y + 4.0, f.z + f.nz * 0.05, ry, 1.1, 2.6, 0.04), [0x8e2a2a, 0x2a4a8e, 0xc9952a][Math.floor(rng() * 3)]);
        else if (r < 0.22 && !y) Q.stall(b, f.x + f.nx * 0.9, f.z + f.nz * 0.9, ry + Math.PI, 0xe8d8b8, [0xc0392b, 0x2e86c1, 0x1e8449][Math.floor(rng() * 3)], rng);
        else if (r < 0.26 && !y) Q.crates(b, px, pz, ry, rng);
        // torches
        if (rng() < 0.12) {
          b.add('plain', G.box, mat(f.x + f.nx * 0.2, y + 2.6, f.z + f.nz * 0.2, ry, 0.12, 0.5, 0.12), 0x5a3a20);
          b.add('glow', G.cone, mat(f.x + f.nx * 0.2, y + 3.0, f.z + f.nz * 0.2, 0, 0.25, 0.4, 0.25), 0xffa040);
        }
        // cloth canopies stretched between buildings
        const span = spanAcross(map, f, 3);
        if (span >= 1 && rng() < 0.18) {
          const col = [0xc0392b, 0xe5a823, 0x2e86c1, 0xe8d8b8][Math.floor(rng() * 4)];
          b.add('plain', G.box, mat(f.x + f.nx * span * 1.5, Math.min(f.top, 6) - 0.4, f.z + f.nz * span * 1.5, ry, 2.6, 0.05, span * 3), col);
        }
      }
      for (const c of floorCells) {
        const p = cellCenter(c.x, c.z);
        if (c.ch === '.' && rng() < 0.035) P.palm(b, p.x + (rng() - 0.5), p.z + (rng() - 0.5), 6 + rng() * 3, rng);
        else if ((c.ch === 'A' || c.ch === 'B' || c.ch === ',') && rng() < 0.12) Q.rug(b, p.x, map.cellHeight(c.x, c.z), p.z, rng() < 0.5 ? 0 : Math.PI / 2, 0x8e2a2a, 0xd9a43a);
      }
      for (const c of indoorCells) if (rng() < 0.4) { const p = cellCenter(c.x, c.z); P.pot(b, p.x + 0.8, p.z - 0.8, 0.7, 0xb5653a); }
    },
    backdrop(ctx) {
      const { b, rng, cx, cz, rx, rz } = ctx;
      for (let i = 0; i < 26; i++) {
        const a = rng() * Math.PI * 2, r = Math.max(rx, rz) + 30 + rng() * 120;
        b.add('plain', G.sphere, mat(cx + Math.cos(a) * r, -4, cz + Math.sin(a) * r, a, 40 + rng() * 50, 14 + rng() * 16, 30 + rng() * 30), [0xe6b47a, 0xdca86c, 0xeec08a][i % 3]);
      }
      for (const [x, z, s] of [[-140, -150, 70], [-60, -190, 45], [160, -120, 55]]) {
        b.add('plain', G.cone4, mat(cx + x, s / 2 - 2, cz + z, Math.PI / 4, s * 1.5, s, s * 1.5), 0xd8a868);
      }
      for (let i = 0; i < 30; i++) {
        const a = rng() * Math.PI * 2, r = Math.max(rx, rz) + 8 + rng() * 25;
        P.palm(b, cx + Math.cos(a) * r, cz + Math.sin(a) * r, 8 + rng() * 6, rng);
      }
    },
  },

  snow: {
    archStyle: 'square',
    ground: { rocks: [0x7a8290, 0x8a929e], rockChance: 0.12, rockCap: 0xf4f8ff, drifts: true, pebbles: 0.05 },
    roof(b, bx, rng, r) {
      const alongX = r.w >= r.d;
      if (rng() < 0.45 && Math.min(r.w, r.d) >= 3 && Math.max(r.w, r.d) >= 6) R.hangar(b, bx, r.h, rng() < 0.5 ? 0xb4bec8 : 0x96aec8, alongX);
      else if (rng() < 0.3 && r.w >= 3 && r.d >= 3) R.tank(b, r.cx, r.h, r.cz, 0xd8dee6);
    },
    sky: ['#8fa6c4', '#d8e2ee', '#eef3f8'], sun: [0xe8f0ff, 1.3, [40, 50, 30]],
    fog: [0xdbe4ee, 30, 170], hemi: [0xf0f6ff, 0xa8b4c4, 1.6],
    wall: 'metal', wallUv: 1 / 3, wallColors: [0xc4ccd6, 0xb4bec8, 0xd8946e, 0x96aec8, 0x7aa08a], wallHeight: [6, 11],
    trim: { colors: [0xf6f9ff], snowCap: true },
    floor: 'snow', floorColor: 0xe9eef6, site: { A: 0xd8c4c0, B: 0xc0cce0 }, spawn: { T: 0xdde6dd, D: 0xe6dde0 },
    low: { tex: 'stone', colors: [0xb8bcc2, 0xa8adb5], cap: true }, high: { tex: 'container', colors: [0xb83a2e, 0x2e6ab8, 0x2e8a5a, 0xd88a2e], cap: true },
    pillar: 0x8a95a3, siteGlow: { A: '#ff8a7a', B: '#7ab8ff' },
    lights: [[0xffb060, 'A'], [0xffb060, 'B']], particles: 'snow',
    trimColor: 0x4a5058, ledgeColor: 0x8a95a3, railColor: 0xf2c12e, ceilColor: 0x6a7480, indoorColor: 0x7a7f88, indoorLight: 0xe8f4ff,
    coverDetail(b, bx, low, rng) {
      const cx = (bx.minX + bx.maxX) / 2, cz = (bx.minZ + bx.maxZ) / 2;
      if (!low) {
        // container doors + lock bars
        for (const s of [-0.3, 0.3]) b.add('plain', G.box, mat(cx + s, 1.2, bx.maxZ + 0.02, 0, 0.05, 2.2, 0.04), 0x2a2a2a);
      }
    },
    decorate(ctx) {
      const { b, rng, faces, indoorCells, cellCenter } = ctx;
      for (const f of faces) {
        const r = rng(), ry = Math.atan2(f.nx, f.nz), y = f.base;
        const px = f.x + f.nx * 0.6, pz = f.z + f.nz * 0.6;
        if (r < 0.08) P.snowPile(b, f.x + f.nx * 0.5, f.z + f.nz * 0.5, 0.6 + rng() * 0.6);
        else if (r < 0.13 && !y) P.barrel(b, px, pz, rng() < 0.5 ? 0xb8402e : 0x2e5ab8);
        else if (r < 0.18 && !y) Q.crates(b, px, pz, ry, rng);
        else if (r < 0.22 && !y) Q.sandbags(b, f.x + f.nx * 0.8, f.z + f.nz * 0.8, ry);
        else if (r < 0.26) Q.flood(b, f.x + f.nx * 0.4, f.z + f.nz * 0.4, 5, ry + Math.PI);
        if (rng() < 0.3) b.add('plain', G.box, mat(f.x + f.nx * 0.03, y + 0.4, f.z + f.nz * 0.03, ry, 2.8, 0.25, 0.04), 0xf2c12e);
        if (rng() < 0.15) b.add('plain', G.box, mat(f.x + f.nx * 0.04, y + 2.2, f.z + f.nz * 0.04, ry, 1.6, 1.0, 0.03), 0xe8e8e8);
        if (rng() < 0.2) Q.ac(b, f, y + 2.5 + rng() * 2);
        if (rng() < 0.15) for (let k = 0; k < 4; k++) b.add('plain', G.cone, mat(f.x + f.nx * 0.1 + (k - 1.5) * 0.5 * Math.cos(ry), f.top - 0.35, f.z + f.nz * 0.1 - (k - 1.5) * 0.5 * Math.sin(ry), 0, 0.12, 0.6, 0.12, Math.PI), 0xdff0ff);
      }
      for (const c of indoorCells) {
        const p = cellCenter(c.x, c.z);
        if (rng() < 0.5) Q.table(b, p.x, 0, p.z, rng() * 3);
      }
    },
    backdrop(ctx) {
      const { b, rng, cx, cz, rx, rz } = ctx;
      for (let i = 0; i < 22; i++) {
        const a = i / 22 * Math.PI * 2 + rng() * 0.2, r = Math.max(rx, rz) + 90 + rng() * 90;
        const h = 60 + rng() * 80, w = 60 + rng() * 50;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        b.add('plain', G.cone, mat(x, h / 2 - 5, z, a, w, h, w), 0x7d8a9c);
        b.add('plain', G.cone, mat(x, h * 0.78 - 5, z, a, w * 0.45, h * 0.45, w * 0.45), 0xf4f8ff);
      }
      for (let i = 0; i < 90; i++) {
        const a = rng() * Math.PI * 2, r = Math.max(rx, rz) + 8 + rng() * 50;
        P.pine(b, cx + Math.cos(a) * r, cz + Math.sin(a) * r, 7 + rng() * 8, true);
      }
      for (let i = 0; i < 4; i++) {
        const a = rng() * Math.PI * 2, r = Math.max(rx, rz) + 12;
        P.antenna(b, cx + Math.cos(a) * r, cz + Math.sin(a) * r, 16 + rng() * 8);
      }
    },
  },

  jungle: {
    archStyle: 'arch',
    ground: { rocks: [0x6a7a6a, 0x7a8a72], rockChance: 0.14, rockCap: 0x3d7d32, bushes: [0x2f6b2a, 0x3d7d32, 0x4a8a3a], bushChance: 0.3, puddles: 0.1, pebbles: 0.06 },
    roof(b, bx, rng, r) {
      for (let i = 0; i < 2; i++) if (rng() < 0.6) R.bush(b, bx.minX + rng() * r.w, r.h + 0.2, bx.minZ + rng() * r.d, 1.2 + rng(), [0x2f6b2a, 0x3d7d32][i], rng);
      if (rng() < 0.25 && Math.min(r.w, r.d) >= 3) R.dome(b, r.cx, r.h, r.cz, Math.min(r.w, r.d) * 0.3, 0x8a948c, null);
    },
    sky: ['#4f7a6a', '#a9c9a0', '#c8dcc0'], sun: [0xfff2c8, 1.4, [20, 70, 40]],
    fog: [0x8fb39a, 22, 140], hemi: [0xd8ffd8, 0x3a4a30, 1.1],
    wall: 'mossConcrete', wallUv: 1 / 3, wallColors: [0x9aa39a, 0x8a948c, 0xa0a8a0, 0x7f8a82], wallHeight: [6, 10],
    trim: { colors: [0x3d6b34], moss: true },
    floor: 'mossTile', floorColor: 0xb0b8a8, site: { A: 0xc8b48a, B: 0x8ab4b0 }, spawn: { T: 0xa8b8a0, D: 0xb8a8a0 },
    low: { tex: 'crate', colors: [0x6a7a5a, 0x7a6a4a] }, high: { tex: 'container', colors: [0x5a6a4a, 0x4a5a5a] },
    pillar: 0x8a948c, siteGlow: { A: '#ffe08a', B: '#8affea' },
    lights: [[0x9affb0, 'A'], [0x9affb0, 'B']], particles: 'fireflies',
    trimColor: 0x6a7a6a, ledgeColor: 0x7f8a82, railColor: 0x4a3a2a, ceilColor: 0x6a706a, indoorColor: 0x8a8a7a, indoorLight: 0xd8ffd0,
    decorate(ctx) {
      const { b, rng, faces, blocks, floorCells, cellCenter, indoorCells, map } = ctx;
      for (const f of faces) {
        const top = f.top, ry = Math.atan2(f.nx, f.nz), y = f.base;
        const n = Math.floor(rng() * 4);
        for (let i = 0; i < n; i++) {
          const off = (rng() - 0.5) * 2.6;
          P.vine(b, f.x + f.nz * off, top, f.z - f.nx * off, f.nx, f.nz, 1.5 + rng() * (top - 1.5 - y), rng);
        }
        const r = rng();
        if (r < 0.14) P.fern(b, f.x + f.nx * 0.6, f.z + f.nz * 0.6, rng);
        else if (r < 0.2 && !y) Q.crates(b, f.x + f.nx * 0.6, f.z + f.nz * 0.6, ry, rng);
        else if (r < 0.24 && !y) P.barrel(b, f.x + f.nx * 0.6, f.z + f.nz * 0.6, 0x5a6a3a);
        if (rng() < 0.08) b.add('plain', G.cyl, mat(f.x + f.nx * 0.25, y + 2.5 + rng() * 2, f.z + f.nz * 0.25, ry, 0.25, 3, 0.25, 0, Math.PI / 2), 0x7a5a3a);
        if (rng() < 0.2) b.add('plain', G.box, mat(f.x + f.nx * 0.03, y + 0.5, f.z + f.nz * 0.03, ry, 2.8, 0.18, 0.04), 0xd8b02e);
        if (rng() < 0.12) {
          // caged wall lamp with a light cone
          b.add('glow', G.box, mat(f.x + f.nx * 0.2, y + 3.2, f.z + f.nz * 0.2, ry, 0.4, 0.25, 0.25), 0xfff2c0);
          b.add('beam', G.cone, mat(f.x + f.nx * 1.2, y + 1.6, f.z + f.nz * 1.2, ry, 2.6, 3.2, 2.6), 0xfff2c0);
        }
        const span = spanAcross(map, f, 3);
        if (span >= 1 && rng() < 0.2) {
          Q.string(b, map, f, Math.min(top, 6) - 0.2, span, (x, yy, z, rr) => b.add('plain', G.box, mat(x, yy - 0.7, z, rr, 0.12, 1.4, 0.04), 0x3d7d32), rng);
        }
      }
      for (const c of floorCells) {
        const p = cellCenter(c.x, c.z);
        if (rng() < 0.08) P.fern(b, p.x + (rng() - 0.5) * 2, p.z + (rng() - 0.5) * 2, rng);
        if (rng() < 0.04) b.add('plain', G.box, mat(p.x, map.cellHeight(c.x, c.z) + 0.05, p.z, rng() * 3, 1.6, 0.1, 0.3), 0x6a5a40);
      }
      for (const c of indoorCells) {
        const p = cellCenter(c.x, c.z);
        if (rng() < 0.4) Q.table(b, p.x, 0, p.z, rng() * 3);
      }
      void blocks;
    },
    backdrop(ctx) {
      const { b, rng, cx, cz, rx, rz } = ctx;
      for (let i = 0; i < 120; i++) {
        const a = rng() * Math.PI * 2, r = Math.max(rx, rz) + 6 + rng() * 60;
        P.jungleTree(b, cx + Math.cos(a) * r, cz + Math.sin(a) * r, 14 + rng() * 16, rng);
      }
    },
  },

  canals: {
    archStyle: 'arch', pilasters: false,
    ground: { rocks: [0xc8bca8], rockChance: 0.0, bushes: [0x3f8a3a, 0x4a9a42], bushChance: 0.1, puddles: 0.06, balconies: 0.22, balconyColor: 0xe6dccc, railColor: 0x2a2a2a },
    roof(b, bx, rng, r) {
      if (Math.min(r.w, r.d) >= 3 && Math.max(r.w, r.d) <= 30) R.gable(b, bx, r.h, 0xb8573a, r.w >= r.d);
    },
    sky: ['#3f86d6', '#a9d4f5', '#e6f2fa'], sun: [0xfff0d6, 1.8, [50, 60, -30]], sunDisc: { color: 0xfff6e0, size: 10 }, clouds: true,
    fog: [0xcfe3f2, 60, 260], hemi: [0xeaf4ff, 0x8a6a50, 1.1],
    wall: 'stucco', wallUv: 1 / 3, wallColors: [0xe8a46a, 0xe8c26a, 0xd98a7a, 0xf0d8a8, 0xc9705a, 0xe6b8a0], wallHeight: [7, 13],
    trim: { colors: [0xa8492e], roof: true },
    floor: 'cobble', floorColor: 0xd8cfc4, site: { A: 0xe0b89a, B: 0xb8c8d8 }, spawn: { T: 0xd0d8c8, D: 0xd8c8c8 },
    low: { tex: 'crate', colors: [0x9a7048, 0x8a6440] }, high: { tex: 'stone', colors: [0xd8cdbd, 0xc8bca8] },
    pillar: 0xe6dccc, siteGlow: { A: '#ffd27a', B: '#7ac8ff' },
    lights: [], particles: null, water: true,
    trimColor: 0xf2e8d8, ledgeColor: 0xe6dccc, railColor: 0xe6dccc, ceilColor: 0xe8dcc8, indoorColor: 0xa8704a, indoorLight: 0xffe0b0,
    coverDetail(b, bx, low, rng) {
      const cx = (bx.minX + bx.maxX) / 2, cz = (bx.minZ + bx.maxZ) / 2;
      if (!low) {
        // market stall roof
        for (let i = 0; i < 4; i++) b.add('plain', G.box, mat(cx - 1.05 + i * 0.7, bx.maxY + 0.35, cz, 0, 0.7, 0.06, 3.1, 0.2), i % 2 ? 0xffffff : 0xc0392b);
      }
    },
    decorate(ctx) {
      const { b, rng, faces, waterCells, cellCenter, waterY, map, indoorCells } = ctx;
      for (const f of faces) {
        const r = rng(), ry = Math.atan2(f.nx, f.nz), y = f.base;
        if (r < 0.1) {
          b.add('plain', G.box, mat(f.x + f.nx * 0.25, y + 3.2, f.z + f.nz * 0.25, ry, 0.08, 0.08, 0.5), 0x222222);
          b.add('glow', G.box, mat(f.x + f.nx * 0.45, y + 3.0, f.z + f.nz * 0.45, ry, 0.25, 0.4, 0.25), 0xffd27a);
        } else if (r < 0.17) {
          b.add('plain', G.box, mat(f.x + f.nx * 0.7, y + 3.2, f.z + f.nz * 0.7, ry, 2.2, 0.06, 1.4, 0.3), [0xb83a2e, 0x2e6a4a, 0x2e4a8a, 0xe8d8b8][Math.floor(rng() * 4)]);
        } else if (r < 0.22 && !y) {
          Q.bench(b, f.x + f.nx * 0.5, f.z + f.nz * 0.5, ry + Math.PI, 0x5a3a20);
        } else if (r < 0.26 && !y) {
          Q.planter(b, f.x + f.nx * 0.6, f.z + f.nz * 0.6, 1, 0xb5653a, 0x3f8a3a);
        }
        if (rng() < 0.3) {
          b.add('plain', G.box, mat(f.x + f.nx * 0.2, y + 4.6, f.z + f.nz * 0.2, ry, 1.2, 0.3, 0.35), 0x7a4a2a);
          b.add('plain', G.sphere, mat(f.x + f.nx * 0.25, y + 4.85, f.z + f.nz * 0.25, ry, 1.1, 0.35, 0.35), rng() < 0.5 ? 0xe84a6a : 0xf2d24a);
        }
        // laundry lines between houses
        const span = spanAcross(map, f, 4);
        if (span >= 1 && rng() < 0.25) {
          const cols = [0xffffff, 0xe84a6a, 0x4a8ae8, 0xf2d24a, 0x6ac86a];
          Q.string(b, map, f, Math.min(f.top - 0.8, 6.5), span, (x, yy, z, rr, i) => b.add('plain', G.box, mat(x, yy - 0.35, z, rr, 0.04, 0.6, 0.5), cols[i % cols.length]), rng);
        }
      }
      for (const c of waterCells) {
        const p = cellCenter(c.x, c.z);
        if (rng() < 0.12) P.gondola(b, p.x, waterY + 0.15, p.z, Math.PI / 2 + (rng() - 0.5) * 0.3);
        if (rng() < 0.15) P.mooring(b, p.x + (rng() - 0.5) * 2, waterY - 0.2, p.z + (rng() - 0.5) * 2, 3.2, 0xffffff, rng() < 0.5 ? 0xc0392b : 0x2e5ab8);
      }
      for (const c of waterCells) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ch = map.ch(c.x + dx, c.z + dz);
          if (ch === '~' || ch === '#' || ch === 'w') continue;
          const p = cellCenter(c.x, c.z);
          const ex = p.x + dx * 1.5, ez = p.z + dz * 1.5;
          b.add('plain', G.box, mat(ex + dx * 0.15, 0.45, ez + dz * 0.15, dx ? Math.PI / 2 : 0, 3, 0.15, 0.3), 0xe6dccc);
          for (let k = -1; k <= 1; k++) b.add('plain', G.box, mat(ex + dx * 0.15 + (dz ? k : 0), 0.2, ez + dz * 0.15 + (dx ? k : 0), 0, 0.18, 0.4, 0.18), 0xd8cdbd);
        }
      }
      for (const c of indoorCells) {
        const p = cellCenter(c.x, c.z);
        if (rng() < 0.45) Q.table(b, p.x, 0, p.z, rng() * 3);
      }
    },
    backdrop(ctx) {
      const { b, rng, cx, cz, rx, rz } = ctx;
      const cols = [0xe8a46a, 0xe8c26a, 0xd98a7a, 0xf0d8a8, 0xc9705a];
      for (let i = 0; i < 50; i++) {
        const a = i / 50 * Math.PI * 2, r = Math.max(rx, rz) + 14 + rng() * 40;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.85;
        const w = 8 + rng() * 10, h = 12 + rng() * 16;
        b.addBox('wall', { minX: x - w / 2, maxX: x + w / 2, minZ: z - w / 2, maxZ: z + w / 2, minY: 0, maxY: h }, cols[i % cols.length], 1 / 3);
        b.add('plain', G.cone4, mat(x, h + 1.4, z, Math.PI / 4, w * 1.45, 2.8, w * 1.45), 0xa8492e);
      }
      // a bell tower
      b.addBox('wall', { minX: cx - 3, maxX: cx + 3, minZ: cz - rz - 40, maxZ: cz - rz - 34, minY: 0, maxY: 45 }, 0xc9705a, 1 / 3);
      b.add('plain', G.cone4, mat(cx, 50, cz - rz - 37, Math.PI / 4, 8.5, 10, 8.5), 0x4a7a5a);
    },
  },
};

// ---------------------------------------------------------------------------
// Theme application
// ---------------------------------------------------------------------------

export function buildTheme(themeId, map, scene, seed, opts = {}) {
  const th = THEMES[themeId];
  const rng = seeded(seed);
  const b = new Batcher();
  const bb = new Batcher();

  // sky & lights
  scene.add(skyDome(...th.sky));
  if (th.stars) scene.add(stars(900, rng));
  if (th.moon) scene.add(disc(th.moon.color, th.moon.size, new THREE.Vector3(...th.moon.dir)));
  if (th.sunDisc) scene.add(disc(th.sunDisc.color, th.sunDisc.size, new THREE.Vector3(...th.sun[2])));
  scene.fog = new THREE.Fog(th.fog[0], th.fog[1], th.fog[2]);
  scene.background = new THREE.Color(th.fog[0]);
  scene.add(new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]));
  const sun = new THREE.DirectionalLight(th.sun[0], th.sun[1]);
  sun.position.set(...th.sun[2]).normalize().multiplyScalar(90);
  scene.add(sun);
  scene.add(sun.target);
  if (opts.shadows) {
    sun.castShadow = true;
    const ext = Math.max(map.W, map.H) * 3 * 0.62 + 6;
    const cam = sun.shadow.camera;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext; cam.near = 10; cam.far = 220;
    sun.shadow.mapSize.set(opts.shadows === 'high' ? 2048 : 1024, opts.shadows === 'high' ? 2048 : 1024);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
  }

  // materials
  const wallTex = TEX[th.wall](rng);
  const wallMap = wallTex.map || wallTex;
  const mats = {
    wall: new THREE.MeshLambertMaterial({ map: wallMap, vertexColors: true }),
    floor: th.shinyFloor
      ? new THREE.MeshPhongMaterial({ map: TEX[th.floor](rng), vertexColors: true, shininess: 60, specular: 0x666688 })
      : new THREE.MeshLambertMaterial({ map: TEX[th.floor](rng), vertexColors: true }),
    indoor: new THREE.MeshLambertMaterial({ map: TEX.wood(rng), vertexColors: true }),
    puddle: new THREE.MeshPhongMaterial({ color: th.puddleColor ?? 0x2a2e38, shininess: 120, specular: 0xaaaacc, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
    beam: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
    poster: new THREE.MeshLambertMaterial({ map: posterAtlas(rng), vertexColors: true }),
    low: new THREE.MeshLambertMaterial({ map: TEX[th.low.tex](rng), vertexColors: true }),
    high: new THREE.MeshLambertMaterial({ map: TEX[th.high.tex](rng), vertexColors: true }),
    plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    cloud: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.9 }),
  };
  if (th.emissiveWalls && wallTex.emissive) {
    mats.wall.emissive = new THREE.Color(0xffffff);
    mats.wall.emissiveMap = wallTex.emissive;
    mats.wall.emissiveIntensity = 0.9;
  }
  return { th, rng, b, bb, mats };
}

export function addParticles(kind, scene, bounds) {
  if (!kind) return null;
  const n = { rain: 1400, snow: 1600, dust: 500, fireflies: 160 }[kind];
  const pos = new Float32Array(n * 3);
  const { minX, maxX, minZ, maxZ } = bounds;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = minX + Math.random() * (maxX - minX);
    pos[i * 3 + 1] = Math.random() * (kind === 'fireflies' ? 4 : 25);
    pos[i * 3 + 2] = minZ + Math.random() * (maxZ - minZ);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const style = {
    rain: { color: 0x9ab8ff, size: 0.06, opacity: 0.55 },
    snow: { color: 0xffffff, size: 0.09, opacity: 0.9 },
    dust: { color: 0xffe2b0, size: 0.05, opacity: 0.6 },
    fireflies: { color: 0xd8ff7a, size: 0.12, opacity: 0.95 },
  }[kind];
  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    color: style.color, size: style.size, transparent: true, opacity: style.opacity, depthWrite: false,
    blending: kind === 'fireflies' ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  pts.frustumCulled = false;
  scene.add(pts);
  let t = 0;
  return (dt) => {
    t += dt;
    const a = g.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (kind === 'rain') { a[k + 1] -= dt * 22; a[k] += dt * 2; }
      else if (kind === 'snow') { a[k + 1] -= dt * 1.6; a[k] += Math.sin(t + i) * dt * 0.6; }
      else if (kind === 'dust') { a[k] += dt * 1.2; a[k + 1] += Math.sin(t * 0.7 + i) * dt * 0.2; }
      else { a[k] += Math.sin(t * 0.9 + i) * dt * 0.5; a[k + 1] += Math.cos(t * 1.3 + i * 0.7) * dt * 0.3; a[k + 2] += Math.cos(t * 0.8 + i) * dt * 0.5; }
      if (a[k + 1] < 0) a[k + 1] += 25;
      if (a[k + 1] > 25 || (kind === 'fireflies' && (a[k + 1] > 5 || a[k + 1] < 0.3))) a[k + 1] = kind === 'fireflies' ? 1 + Math.random() * 3 : 0.1;
      if (a[k] > maxX) a[k] -= maxX - minX;
      if (a[k] < minX) a[k] += maxX - minX;
    }
    g.attributes.position.needsUpdate = true;
  };
}

export { P as Props, G as Geo, Q as Props2 };

import * as THREE from '../lib/three.module.min.js';

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

  build(parent, materials) {
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
    }
    this.lists.clear();
  }
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

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export const THEMES = {
  neon: {
    sky: ['#05030f', '#2a1048', '#0b0716'], stars: true, moon: { color: 0xdfe6ff, size: 14, dir: [0.4, 0.5, -0.8] },
    fog: [0x24163e, 40, 200], hemi: [0x9a8bff, 0x4a3a66, 1.7], sun: [0xb0c4ff, 1.0, [30, 60, 40]],
    wall: 'facade', wallUv: 1 / 6, wallColors: [0x6a6a8a, 0x5a6a86, 0x7a6a86, 0x5a607a, 0x72729a], wallHeight: [7, 14],
    emissiveWalls: true, trim: { glow: true, colors: [0xff3fd2, 0x3ff3ff, 0xffd23f, 0x9a5bff] },
    floor: 'asphalt', floorColor: 0x7a7d8c, site: { A: 0x6a4a7a, B: 0x3f5a7a }, spawn: { T: 0x4a5a58, D: 0x5a4a52 },
    low: { tex: 'crate', colors: [0x4a5068, 0x56506a], glow: 0x3ff3ff }, high: { tex: 'container', colors: [0x283a5a, 0x5a2846, 0x284a3a], glow: 0xff3fd2 },
    pillar: 0x3a3f52, siteGlow: { A: '#ff7ad9', B: '#7ff6ff' },
    lights: [[0xff3fd2, 'A'], [0x3ff3ff, 'B'], [0xffb347, 'mid']],
    particles: 'rain', exposure: 1.0,
    decorate(ctx) {
      const { b, rng, faces, scene } = ctx;
      // neon signs on walls
      const words = [['NOODLE', '#ff4fd8'], ['24/7', '#4ff3ff'], ['ARCADE', '#ffd23f'], ['HOTEL', '#9a7bff'], ['RAMEN', '#ff6b4f'], ['CYBER', '#4fff9a'], ['BAR', '#ff4f7a'], ['TAXI', '#ffe14f']];
      const picks = faces.filter((f) => rng() < 0.5).sort(() => rng() - 0.5).slice(0, 9);
      picks.forEach((f, i) => {
        const [text, color] = words[i % words.length];
        const m = new THREE.Mesh(G.plane, new THREE.MeshBasicMaterial({ map: signTexture(text, color), transparent: true }));
        m.scale.set(3.2, 1.0, 1);
        m.position.set(f.x + f.nx * 0.06, 4.2 + rng() * 1.6, f.z + f.nz * 0.06);
        m.rotation.y = Math.atan2(f.nx, f.nz);
        scene.add(m);
      });
      // street lamps
      for (const f of faces) {
        if (rng() > 0.1) continue;
        P.lamp(b, f.x + f.nx * 0.3, f.z + f.nz * 0.3, 4.2, 0x22252e, rng() < 0.5 ? 0xff7ad9 : 0x7ff6ff, Math.atan2(-f.nx, -f.nz) + Math.PI);
      }
      // floor lane markings / glowing strips along building bases
      for (const f of faces) {
        if (rng() > 0.35) continue;
        b.add('glow', G.box, mat(f.x + f.nx * 0.03, 0.08, f.z + f.nz * 0.03, Math.atan2(f.nx, f.nz), 2.6, 0.06, 0.04), rng() < 0.5 ? 0xff3fd2 : 0x3ff3ff);
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
    sky: ['#4f86d0', '#ffc07a', '#f6d0a0'], sun: [0xffd0a0, 2.4, [-50, 40, 70]], sunDisc: { color: 0xffe0a8, size: 18 },
    fog: [0xf2c79a, 60, 260], hemi: [0xfff0d8, 0xa8805a, 1.6],
    wall: 'sandstone', wallUv: 1 / 3, wallColors: [0xf2cfa0, 0xeac294, 0xf6d8ae, 0xe2b888], wallHeight: [5, 10],
    trim: { colors: [0xc9955f], crenel: true },
    floor: 'sandTile', floorColor: 0xe9cfa3, site: { A: 0xe0a86a, B: 0xd49a7a }, spawn: { T: 0xd8c49a, D: 0xd8b49a },
    low: { tex: 'stone', colors: [0xd2a676, 0xc89a6a] }, high: { tex: 'crate', colors: [0x9a7048, 0x8a6440] },
    pillar: 0xe6c495, siteGlow: { A: '#fff1c4', B: '#fff1c4' },
    lights: [], particles: 'dust',
    decorate(ctx) {
      const { b, rng, faces, floorCells, cellCenter } = ctx;
      for (const f of faces) {
        const r = rng();
        if (r < 0.05) P.pot(b, f.x + f.nx * 0.6, f.z + f.nz * 0.6, 0.9 + rng() * 0.4, rng() < 0.5 ? 0xb5653a : 0x8a4a2a);
        else if (r < 0.1) {
          // cloth awning sticking out of the wall
          const ry = Math.atan2(f.nx, f.nz);
          b.add('plain', G.box, mat(f.x + f.nx * 0.8, 3.0, f.z + f.nz * 0.8, ry, 2.4, 0.06, 1.7, 0.35), [0xc0392b, 0x2e86c1, 0xe5a823, 0x1e8449][Math.floor(rng() * 4)]);
        } else if (r < 0.14) {
          const ry = Math.atan2(f.nx, f.nz);
          b.add('plain', G.box, mat(f.x + f.nx * 0.05, 4.0, f.z + f.nz * 0.05, ry, 1.1, 2.6, 0.04), [0x8e2a2a, 0x2a4a8e, 0xc9952a][Math.floor(rng() * 3)]);
        }
      }
      for (const c of floorCells) {
        if (c.ch !== '.' || rng() > 0.03) continue;
        const p = cellCenter(c.x, c.z);
        P.palm(b, p.x + (rng() - 0.5), p.z + (rng() - 0.5), 6 + rng() * 3, rng);
      }
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
    sky: ['#8fa6c4', '#d8e2ee', '#eef3f8'], sun: [0xe8f0ff, 1.3, [40, 50, 30]],
    fog: [0xdbe4ee, 30, 170], hemi: [0xf0f6ff, 0xa8b4c4, 1.6],
    wall: 'metal', wallUv: 1 / 3, wallColors: [0xc4ccd6, 0xb4bec8, 0xd8946e, 0x96aec8, 0x7aa08a], wallHeight: [6, 11],
    trim: { colors: [0xf6f9ff], snowCap: true },
    floor: 'snow', floorColor: 0xe9eef6, site: { A: 0xd8c4c0, B: 0xc0cce0 }, spawn: { T: 0xdde6dd, D: 0xe6dde0 },
    low: { tex: 'stone', colors: [0xb8bcc2, 0xa8adb5], cap: true }, high: { tex: 'container', colors: [0xb83a2e, 0x2e6ab8, 0x2e8a5a, 0xd88a2e], cap: true },
    pillar: 0x8a95a3, siteGlow: { A: '#ff8a7a', B: '#7ab8ff' },
    lights: [[0xffb060, 'A'], [0xffb060, 'B']], particles: 'snow',
    decorate(ctx) {
      const { b, rng, faces } = ctx;
      for (const f of faces) {
        const r = rng();
        if (r < 0.08) P.snowPile(b, f.x + f.nx * 0.5, f.z + f.nz * 0.5, 0.6 + rng() * 0.6);
        else if (r < 0.12) P.barrel(b, f.x + f.nx * 0.6, f.z + f.nz * 0.6, rng() < 0.5 ? 0xb8402e : 0x2e5ab8);
        else if (r < 0.15) P.lamp(b, f.x + f.nx * 0.3, f.z + f.nz * 0.3, 4.5, 0x3a3f48, 0xffc070, Math.atan2(-f.nx, -f.nz) + Math.PI);
        // hazard stripes along the wall base
        if (rng() < 0.25) b.add('plain', G.box, mat(f.x + f.nx * 0.03, 0.4, f.z + f.nz * 0.03, Math.atan2(f.nx, f.nz), 2.8, 0.25, 0.04), 0xf2c12e);
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
    sky: ['#4f7a6a', '#a9c9a0', '#c8dcc0'], sun: [0xfff2c8, 1.4, [20, 70, 40]],
    fog: [0x8fb39a, 22, 140], hemi: [0xd8ffd8, 0x3a4a30, 1.1],
    wall: 'mossConcrete', wallUv: 1 / 3, wallColors: [0x9aa39a, 0x8a948c, 0xa0a8a0, 0x7f8a82], wallHeight: [6, 10],
    trim: { colors: [0x3d6b34], moss: true },
    floor: 'mossTile', floorColor: 0xb0b8a8, site: { A: 0xc8b48a, B: 0x8ab4b0 }, spawn: { T: 0xa8b8a0, D: 0xb8a8a0 },
    low: { tex: 'crate', colors: [0x6a7a5a, 0x7a6a4a] }, high: { tex: 'container', colors: [0x5a6a4a, 0x4a5a5a] },
    pillar: 0x8a948c, siteGlow: { A: '#ffe08a', B: '#8affea' },
    lights: [[0x9affb0, 'A'], [0x9affb0, 'B']], particles: 'fireflies',
    decorate(ctx) {
      const { b, rng, faces, blocks, floorCells, cellCenter } = ctx;
      for (const f of faces) {
        const top = blocks.heightAt(f.cx, f.cz);
        const n = Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const off = (rng() - 0.5) * 2.6;
          P.vine(b, f.x + f.nz * off, top, f.z - f.nx * off, f.nx, f.nz, 1.5 + rng() * (top - 1.5), rng);
        }
        if (rng() < 0.12) P.fern(b, f.x + f.nx * 0.6, f.z + f.nz * 0.6, rng);
        if (rng() < 0.06) {
          // rusty pipe running along the wall
          b.add('plain', G.cyl, mat(f.x + f.nx * 0.25, 2.5 + rng() * 2, f.z + f.nz * 0.25, Math.atan2(f.nx, f.nz), 0.25, 3, 0.25, 0, Math.PI / 2), 0x7a5a3a);
        }
        if (rng() < 0.18) b.add('plain', G.box, mat(f.x + f.nx * 0.03, 0.5, f.z + f.nz * 0.03, Math.atan2(f.nx, f.nz), 2.8, 0.18, 0.04), 0xd8b02e);
      }
      for (const c of floorCells) {
        if (rng() < 0.08) P.fern(b, cellCenter(c.x, c.z).x + (rng() - 0.5) * 2, cellCenter(c.x, c.z).z + (rng() - 0.5) * 2, rng);
      }
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
    sky: ['#3f86d6', '#a9d4f5', '#e6f2fa'], sun: [0xfff0d6, 1.8, [50, 60, -30]], sunDisc: { color: 0xfff6e0, size: 10 }, clouds: true,
    fog: [0xcfe3f2, 60, 260], hemi: [0xeaf4ff, 0x8a6a50, 1.1],
    wall: 'stucco', wallUv: 1 / 3, wallColors: [0xe8a46a, 0xe8c26a, 0xd98a7a, 0xf0d8a8, 0xc9705a, 0xe6b8a0], wallHeight: [7, 13],
    trim: { colors: [0xa8492e], roof: true },
    floor: 'cobble', floorColor: 0xd8cfc4, site: { A: 0xe0b89a, B: 0xb8c8d8 }, spawn: { T: 0xd0d8c8, D: 0xd8c8c8 },
    low: { tex: 'crate', colors: [0x9a7048, 0x8a6440] }, high: { tex: 'stone', colors: [0xd8cdbd, 0xc8bca8] },
    pillar: 0xe6dccc, siteGlow: { A: '#ffd27a', B: '#7ac8ff' },
    lights: [], particles: null, water: true,
    decorate(ctx) {
      const { b, rng, faces, waterCells, cellCenter, waterY, map } = ctx;
      for (const f of faces) {
        const r = rng();
        const ry = Math.atan2(f.nx, f.nz);
        if (r < 0.1) {
          // wall lantern
          b.add('plain', G.box, mat(f.x + f.nx * 0.25, 3.2, f.z + f.nz * 0.25, ry, 0.08, 0.08, 0.5), 0x222222);
          b.add('glow', G.box, mat(f.x + f.nx * 0.45, 3.0, f.z + f.nz * 0.45, ry, 0.25, 0.4, 0.25), 0xffd27a);
        } else if (r < 0.17) {
          b.add('plain', G.box, mat(f.x + f.nx * 0.7, 3.2, f.z + f.nz * 0.7, ry, 2.2, 0.06, 1.4, 0.3), [0xb83a2e, 0x2e6a4a, 0x2e4a8a, 0xe8d8b8][Math.floor(rng() * 4)]);
        } else if (r < 0.22) {
          // flower boxes
          b.add('plain', G.box, mat(f.x + f.nx * 0.2, 4.6, f.z + f.nz * 0.2, ry, 1.2, 0.3, 0.35), 0x7a4a2a);
          b.add('plain', G.sphere, mat(f.x + f.nx * 0.25, 4.85, f.z + f.nz * 0.25, ry, 1.1, 0.35, 0.35), rng() < 0.5 ? 0xe84a6a : 0xf2d24a);
        }
      }
      // gondolas and mooring poles along the canals
      for (const c of waterCells) {
        const p = cellCenter(c.x, c.z);
        if (rng() < 0.12) P.gondola(b, p.x, waterY + 0.15, p.z, Math.PI / 2 + (rng() - 0.5) * 0.3);
        if (rng() < 0.15) P.mooring(b, p.x + (rng() - 0.5) * 2, waterY - 0.2, p.z + (rng() - 0.5) * 2, 3.2, 0xffffff, rng() < 0.5 ? 0xc0392b : 0x2e5ab8);
      }
      // stone railings along bridges and quays
      for (const c of waterCells) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ch = map.ch(c.x + dx, c.z + dz);
          if (ch === '~' || ch === '#') continue;
          const p = cellCenter(c.x, c.z);
          const ex = p.x + dx * 1.5, ez = p.z + dz * 1.5;
          b.add('plain', G.box, mat(ex + dx * 0.15, 0.45, ez + dz * 0.15, dx ? Math.PI / 2 : 0, 3, 0.15, 0.3), 0xe6dccc);
          for (let k = -1; k <= 1; k++) b.add('plain', G.box, mat(ex + dx * 0.15 + (dz ? k : 0), 0.2, ez + dz * 0.15 + (dx ? k : 0), 0, 0.18, 0.4, 0.18), 0xd8cdbd);
        }
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

export function buildTheme(themeId, map, scene, seed) {
  const th = THEMES[themeId];
  const rng = seeded(seed);
  const b = new Batcher();

  // sky & lights
  scene.add(skyDome(...th.sky));
  if (th.stars) scene.add(stars(900, rng));
  if (th.moon) scene.add(disc(th.moon.color, th.moon.size, new THREE.Vector3(...th.moon.dir)));
  if (th.sunDisc) scene.add(disc(th.sunDisc.color, th.sunDisc.size, new THREE.Vector3(...th.sun[2])));
  scene.fog = new THREE.Fog(th.fog[0], th.fog[1], th.fog[2]);
  scene.background = new THREE.Color(th.fog[0]);
  scene.add(new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]));
  const sun = new THREE.DirectionalLight(th.sun[0], th.sun[1]);
  sun.position.set(...th.sun[2]);
  scene.add(sun);

  // materials
  const wallTex = TEX[th.wall](rng);
  const wallMap = wallTex.map || wallTex;
  const mats = {
    wall: new THREE.MeshLambertMaterial({ map: wallMap, vertexColors: true }),
    floor: new THREE.MeshLambertMaterial({ map: TEX[th.floor](rng), vertexColors: true }),
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
  return { th, rng, b, mats };
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

export { P as Props, G as Geo };

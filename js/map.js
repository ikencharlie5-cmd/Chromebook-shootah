import * as THREE from '../lib/three.module.min.js';

// Map "Outpost" — each character is one CELL x CELL square.
//   #  wall          .  floor        c  low crate (jumpable)   C  tall crate
//   A  site A        B  site B       T  attacker spawn         D  defender spawn
export const MAP_NAME = 'Outpost';
export const CELL = 3;
export const WALL_H = 7;
const LOW_H = 1.1;
const HIGH_H = 2.4;

const ROWS = [
  '########################################',
  '#.........#.....DDDDDDDD.....#.........#',
  '#.AAAAAAA.#.....DDDDDDDD.....#.BBBBBBB.#',
  '#.AAAcAAA.......DDDDDDDD.......BBBcBBB.#',
  '#.AACCAAA.......DDDDDDDD.......BBCCBBB.#',
  '#.AAAAAAA.#.....DDDDDDDD.....#.BBBBBBB.#',
  '#.AAAAAcA.#..C............C..#.BcBBBBB.#',
  '#.........#######......#######.........#',
  '#..c......#######C....C#######......c..#',
  '#.....##..........####........####.....#',
  '#.....##..........####.................#',
  '#.....###########......########........#',
  '#.....###########......########.C......#',
  '#..C..###########..cc..#######.........#',
  '#.....###########......#######.........#',
  '#.....###########....CC########..###...#',
  '#.....###########......########..###...#',
  '#.....###########......########........#',
  '#.....###......................####..c.#',
  '#..........c..........C..........#.....#',
  '#.....####.......####......####........#',
  '#.....###########......########........#',
  '#.c...###########......########...c....#',
  '#.....##########........#######........#',
  '#..........TTTTTTTTTTTTTTTTTT..........#',
  '#..........TTTTTTTTTTTTTTTTTT..........#',
  '#######....TTTTTTTTTTTTTTTTTT....#######',
  '#######....TTTTTTTTTTTTTTTTTT....#######',
  '########################################',
];

// Routes attackers can take toward each site (lists of cells to pass through).
const ROUTES = {
  A: [[[3, 16]], [[19, 16], [12, 9]], [[3, 20]]],
  B: [[[36, 16]], [[19, 16], [27, 10]], [[37, 20]]],
};
const MID_HOLD = [[18, 8], [21, 8], [17, 10], [22, 9]];

const FLOOR_COLORS = {
  '.': 0xb8ad9a, c: 0xb8ad9a, C: 0xb8ad9a,
  A: 0xc99a6a, B: 0x7f9bbd, T: 0x9fae96, D: 0xb59a9c,
};

function canvasTexture(draw, size = 128) {
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

function noise(g, s, amount) {
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function makeTextures() {
  const wall = canvasTexture((g, s) => {
    g.fillStyle = '#ececec'; g.fillRect(0, 0, s, s);
    noise(g, s, 22);
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2;
    g.strokeRect(1, 1, s - 2, s - 2);
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, s * 0.85, s, s * 0.15);
  });
  const floor = canvasTexture((g, s) => {
    g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, s, s);
    noise(g, s, 18);
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 2;
    g.strokeRect(0, 0, s, s);
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    g.strokeRect(s / 2, 0, s / 2, s / 2); g.strokeRect(0, s / 2, s / 2, s / 2);
  });
  const crate = canvasTexture((g, s) => {
    g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, s, s);
    noise(g, s, 26);
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 10;
    g.strokeRect(5, 5, s - 10, s - 10);
    g.lineWidth = 7;
    g.beginPath(); g.moveTo(8, 8); g.lineTo(s - 8, s - 8); g.stroke();
  });
  return { wall, floor, crate };
}

function letterTexture(letter, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.strokeStyle = color; g.lineWidth = 12;
  g.beginPath(); g.arc(128, 128, 110, 0, Math.PI * 2); g.stroke();
  g.fillStyle = color;
  g.font = 'bold 170px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 128, 138);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Box geometry with world-space UVs (so textures tile instead of stretching)
// and vertex colours with a bit of fake ambient occlusion near the floor.
function boxGeo(b, color, uvScale, aoHeight = 0) {
  const g = new THREE.BoxGeometry(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ).toNonIndexed();
  g.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    if (nx > 0.5) uv.setXY(i, z * uvScale, y * uvScale);
    else if (ny > 0.5) uv.setXY(i, x * uvScale, z * uvScale);
    else uv.setXY(i, x * uvScale, y * uvScale);
    let shade = 1;
    if (aoHeight > 0 && ny < 0.5 && y < 0.01) shade = 0.62;
    col[i * 3] = c.r * shade; col[i * 3 + 1] = c.g * shade; col[i * 3 + 2] = c.b * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function mergeGeos(geos) {
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
  return out;
}

function tint(hex, amt) {
  const c = new THREE.Color(hex);
  const k = 1 + (Math.random() - 0.5) * amt;
  return c.multiplyScalar(k);
}

export class GameMap {
  constructor(scene) {
    this.rows = ROWS;
    this.H = ROWS.length;
    this.W = ROWS[0].length;
    this.ox = -this.W * CELL / 2;
    this.oz = -this.H * CELL / 2;
    this.boxes = [];
    this.spawns = { T: [], D: [] };
    this.sites = {};
    this.routes = ROUTES;
    this.midHold = MID_HOLD;
    this.scanCells();
    this.build(scene);
  }

  ch(cx, cz) {
    if (cz < 0 || cz >= this.H || cx < 0 || cx >= this.W) return '#';
    return this.rows[cz][cx];
  }

  walkable(cx, cz) {
    const c = this.ch(cx, cz);
    return c !== '#' && c !== 'C' && c !== 'c';
  }

  cellX(x) { return Math.floor((x - this.ox) / CELL); }
  cellZ(z) { return Math.floor((z - this.oz) / CELL); }
  charAt(x, z) { return this.ch(this.cellX(x), this.cellZ(z)); }

  center(cx, cz, out = new THREE.Vector3()) {
    return out.set(this.ox + (cx + 0.5) * CELL, 0, this.oz + (cz + 0.5) * CELL);
  }

  siteAt(x, z) {
    const cx = this.cellX(x), cz = this.cellZ(z);
    for (const k in this.sites) {
      const s = this.sites[k];
      if (cx >= s.x0 && cx <= s.x1 && cz >= s.z0 && cz <= s.z1) return k;
    }
    return null;
  }

  scanCells() {
    const sites = { A: [], B: [] };
    for (let z = 0; z < this.H; z++) {
      for (let x = 0; x < this.W; x++) {
        const c = this.ch(x, z);
        if (c === 'T' || c === 'D') this.spawns[c].push([x, z]);
        if (c === 'A' || c === 'B') sites[c].push([x, z]);
      }
    }
    for (const k of ['A', 'B']) {
      const cells = sites[k];
      const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
      const s = {
        name: k,
        x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs),
        cells: [],
      };
      for (let z = s.z0; z <= s.z1; z++)
        for (let x = s.x0; x <= s.x1; x++)
          if (this.walkable(x, z)) s.cells.push([x, z]);
      // Cells with walls/crates next to them make better hiding spots.
      s.coverCells = s.cells.filter(([x, z]) => {
        let n = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!this.walkable(x + dx, z + dz)) n++;
        return n >= 1;
      });
      s.center = this.center((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
      this.sites[k] = s;
    }
  }

  build(scene) {
    const tex = makeTextures();
    const wallGeos = [], crateGeos = [], floorGeos = [];

    // Walls: merge horizontal runs, then stack identical runs vertically.
    const runs = [];
    for (let z = 0; z < this.H; z++) {
      let x = 0;
      while (x < this.W) {
        if (this.ch(x, z) === '#') {
          let x1 = x;
          while (x1 + 1 < this.W && this.ch(x1 + 1, z) === '#') x1++;
          runs.push({ x0: x, x1, z0: z, z1: z });
          x = x1 + 1;
        } else x++;
      }
    }
    const merged = [];
    for (const r of runs) {
      const prev = merged.find((m) => m.x0 === r.x0 && m.x1 === r.x1 && m.z1 === r.z0 - 1);
      if (prev) prev.z1 = r.z0; else merged.push({ ...r });
    }
    for (const m of merged) {
      const b = {
        minX: this.ox + m.x0 * CELL, maxX: this.ox + (m.x1 + 1) * CELL,
        minZ: this.oz + m.z0 * CELL, maxZ: this.oz + (m.z1 + 1) * CELL,
        minY: 0, maxY: WALL_H,
      };
      wallGeos.push(boxGeo(b, tint(0xd9c6a8, 0.12), 1 / 3.5, 1));
      // Walls block everything; make their collider very tall so nobody jumps over.
      this.boxes.push({ ...b, maxY: 50, kind: 'wall' });
    }

    // Crates and floor.
    for (let z = 0; z < this.H; z++) {
      let x = 0;
      while (x < this.W) {
        const c = this.ch(x, z);
        if (c === '#') { x++; continue; }
        // floor runs of equal colour
        const fc = FLOOR_COLORS[c] ?? FLOOR_COLORS['.'];
        let x1 = x;
        while (x1 + 1 < this.W && this.ch(x1 + 1, z) !== '#' && (FLOOR_COLORS[this.ch(x1 + 1, z)] ?? FLOOR_COLORS['.']) === fc) x1++;
        floorGeos.push(boxGeo({
          minX: this.ox + x * CELL, maxX: this.ox + (x1 + 1) * CELL,
          minZ: this.oz + z * CELL, maxZ: this.oz + (z + 1) * CELL,
          minY: -0.5, maxY: 0,
        }, fc, 1 / 3));
        x = x1 + 1;
      }
      for (let x2 = 0; x2 < this.W; x2++) {
        const c = this.ch(x2, z);
        if (c !== 'c' && c !== 'C') continue;
        const inset = 0.15;
        const h = c === 'c' ? LOW_H : HIGH_H;
        const b = {
          minX: this.ox + x2 * CELL + inset, maxX: this.ox + (x2 + 1) * CELL - inset,
          minZ: this.oz + z * CELL + inset, maxZ: this.oz + (z + 1) * CELL - inset,
          minY: 0, maxY: h,
        };
        crateGeos.push(boxGeo(b, c === 'c' ? tint(0x6f8a96, 0.1) : tint(0x9a7550, 0.1), 1 / (CELL - inset * 2), 1));
        this.boxes.push({ ...b, kind: 'crate' });
      }
    }

    const wallMat = new THREE.MeshLambertMaterial({ map: tex.wall, vertexColors: true });
    const floorMat = new THREE.MeshLambertMaterial({ map: tex.floor, vertexColors: true });
    const crateMat = new THREE.MeshLambertMaterial({ map: tex.crate, vertexColors: true });
    scene.add(new THREE.Mesh(mergeGeos(wallGeos), wallMat));
    scene.add(new THREE.Mesh(mergeGeos(floorGeos), floorMat));
    scene.add(new THREE.Mesh(mergeGeos(crateGeos), crateMat));

    // Site markers on the floor.
    for (const [k, color] of [['A', '#ffcf8a'], ['B', '#9fd0ff']]) {
      const s = this.sites[k];
      const mat = new THREE.MeshBasicMaterial({ map: letterTexture(k, color), transparent: true, opacity: 0.75, depthWrite: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), mat);
      m.rotation.x = -Math.PI / 2;
      const spot = this.center(s.x0 + 1, s.z1 - 0);
      m.position.set(spot.x, 0.03, spot.z);
      scene.add(m);
    }
  }

  // ---- navigation -------------------------------------------------------

  nearestWalkable(cx, cz) {
    if (this.walkable(cx, cz)) return [cx, cz];
    for (let r = 1; r < 6; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++)
          if (this.walkable(cx + dx, cz + dz)) return [cx + dx, cz + dz];
    return [cx, cz];
  }

  // A* over the cell grid, 8-way without cutting corners.
  findPath(sx, sz, gx, gz) {
    [sx, sz] = this.nearestWalkable(sx, sz);
    [gx, gz] = this.nearestWalkable(gx, gz);
    const W = this.W, N = W * this.H;
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = [];
    const push = (i, f) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]]; k = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top[1];
    };
    const h = (x, z) => {
      const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    const start = sz * W + sx, goal = gz * W + gx;
    gScore[start] = 0;
    push(start, h(sx, sz));
    while (heap.length) {
      const cur = pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % W, cz = (cur / W) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.walkable(nx, nz)) continue;
          if (dx && dz && (!this.walkable(cx + dx, cz) || !this.walkable(cx, cz + dz))) continue;
          const ni = nz * W + nx;
          const ng = gScore[cur] + (dx && dz ? Math.SQRT2 : 1);
          if (ng < gScore[ni]) {
            gScore[ni] = ng; came[ni] = cur;
            push(ni, ng + h(nx, nz));
          }
        }
      }
    }
    if (came[goal] === -1 && goal !== start) return [];
    const path = [];
    for (let i = goal; i !== -1 && i !== start; i = came[i]) path.push([i % W, (i / W) | 0]);
    path.reverse();
    return path;
  }

  // Direction (yaw) a defender/holder at a cell should watch: toward where enemies come from.
  watchYaw(cx, cz, fromCx, fromCz) {
    const path = this.findPath(cx, cz, fromCx, fromCz);
    if (!path.length) return 0;
    const p = path[Math.min(4, path.length - 1)];
    const dx = p[0] - cx, dz = p[1] - cz;
    return Math.atan2(-dx, -dz);
  }

  // Draws the static layout for the minimap.
  drawMinimap(ctx, scale) {
    for (let z = 0; z < this.H; z++) {
      for (let x = 0; x < this.W; x++) {
        const c = this.ch(x, z);
        let col = null;
        if (c === '#') continue;
        if (c === 'C' || c === 'c') col = '#5a6470';
        else if (c === 'A') col = '#6b5640';
        else if (c === 'B') col = '#3f5068';
        else if (c === 'T') col = '#3f4c40';
        else if (c === 'D') col = '#4f3f44';
        else col = '#3a3f46';
        ctx.fillStyle = col;
        ctx.fillRect(x * scale, z * scale, scale + 0.5, scale + 0.5);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `bold ${scale * 2.4}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const k of ['A', 'B']) {
      const s = this.sites[k];
      ctx.fillText(k, ((s.x0 + s.x1) / 2 + 0.5) * scale, ((s.z0 + s.z1) / 2 + 0.5) * scale);
    }
  }
}

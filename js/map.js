import * as THREE from '../lib/three.module.min.js';
import { buildTheme, addParticles, letterTexture, mat, Geo } from './theme.js';

export const CELL = 3;
const LOW_H = 1.1;
const HIGH_H = 2.4;
const WATER_Y = -1.0;

export class GameMap {
  constructor(scene, def) {
    this.def = def;
    this.name = def.name;
    this.rows = def.rows;
    this.H = this.rows.length;
    this.W = this.rows[0].length;
    this.ox = -this.W * CELL / 2;
    this.oz = -this.H * CELL / 2;
    this.boxes = [];
    this.spawns = { T: [], D: [] };
    this.sites = {};
    this.updaters = [];
    this.scanCells();
    this.build(scene);
    this.computeRoutes();
  }

  ch(cx, cz) {
    if (cz < 0 || cz >= this.H || cx < 0 || cx >= this.W) return '#';
    return this.rows[cz][cx];
  }

  walkable(cx, cz) {
    const c = this.ch(cx, cz);
    return c !== '#' && c !== 'C' && c !== 'c' && c !== 'o' && c !== '~';
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
      const s = { name: k, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), cells: [] };
      for (let z = s.z0; z <= s.z1; z++)
        for (let x = s.x0; x <= s.x1; x++)
          if (this.walkable(x, z)) s.cells.push([x, z]);
      s.coverCells = s.cells.filter(([x, z]) => {
        let n = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!this.walkable(x + dx, z + dz)) n++;
        return n >= 1;
      });
      s.center = this.center((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
      this.sites[k] = s;
    }
    const tc = this.spawns.T, dc = this.spawns.D;
    this.tCenter = tc[Math.floor(tc.length / 2)];
    this.dCenter = dc[Math.floor(dc.length / 2)];
  }

  build(scene) {
    const def = this.def;
    let seed = 0;
    for (const ch of def.id) seed = seed * 31 + ch.charCodeAt(0);
    const { th, rng, b, mats } = buildTheme(def.theme, this, scene, seed);
    this.theme = th;

    // --- wall blocks: horizontal runs merged vertically into rectangles
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
    const rects = [];
    for (const r of runs) {
      const prev = rects.find((m) => m.x0 === r.x0 && m.x1 === r.x1 && m.z1 === r.z0 - 1);
      if (prev) prev.z1 = r.z0; else rects.push({ ...r });
    }
    const heightGrid = new Float32Array(this.W * this.H);
    for (const m of rects) {
      const border = m.x0 === 0 || m.z0 === 0 || m.x1 === this.W - 1 || m.z1 === this.H - 1;
      const [h0, h1] = th.wallHeight;
      const h = Math.round((h0 + rng() * (h1 - h0) + (border ? 2 : 0)) * 2) / 2;
      m.h = h;
      for (let z = m.z0; z <= m.z1; z++) for (let x = m.x0; x <= m.x1; x++) heightGrid[z * this.W + x] = h;
      const bx = {
        minX: this.ox + m.x0 * CELL, maxX: this.ox + (m.x1 + 1) * CELL,
        minZ: this.oz + m.z0 * CELL, maxZ: this.oz + (m.z1 + 1) * CELL,
        minY: 0, maxY: h,
      };
      const color = th.wallColors[Math.floor(rng() * th.wallColors.length)];
      b.addBox('wall', { ...bx, minY: -1.6 }, color, th.wallUv, 0.35);
      this.boxes.push({ ...bx, maxY: 60, kind: 'wall' });
      this.addTrim(b, bx, th, rng);
    }
    this.blocks = { rects, heightAt: (cx, cz) => heightGrid[cz * this.W + cx] || 6 };

    // --- floors, cover, pillars, water
    const floorCells = [], waterCells = [];
    for (let z = 0; z < this.H; z++) {
      for (let x = 0; x < this.W; x++) {
        const c = this.ch(x, z);
        if (c === '#') continue;
        const minX = this.ox + x * CELL, minZ = this.oz + z * CELL;
        if (c === '~') {
          waterCells.push({ x, z });
          this.boxes.push({ minX, maxX: minX + CELL, minZ, maxZ: minZ + CELL, minY: -5, maxY: 60, kind: 'water', noShot: true });
          b.addBox('floor', { minX, maxX: minX + CELL, minZ, maxZ: minZ + CELL, minY: -3, maxY: WATER_Y - 1.2 }, 0x6a6a60, 1 / 3);
          continue;
        }
        floorCells.push({ x, z, ch: c });
        let col = th.floorColor;
        if (c === 'A' || c === 'B') col = th.site[c];
        else if (c === 'T' || c === 'D') col = th.spawn[c];
        b.addBox('floor', { minX, maxX: minX + CELL, minZ, maxZ: minZ + CELL, minY: -1.6, maxY: 0 }, tintColor(col, rng, 0.06), 1 / 3);

        if (c === 'c' || c === 'C') {
          const low = c === 'c';
          const spec = low ? th.low : th.high;
          const inset = low ? 0.25 : 0.15;
          const h = low ? LOW_H : HIGH_H;
          const bx = { minX: minX + inset, maxX: minX + CELL - inset, minZ: minZ + inset, maxZ: minZ + CELL - inset, minY: 0, maxY: h };
          b.addBox(low ? 'low' : 'high', bx, spec.colors[Math.floor(rng() * spec.colors.length)], 1 / (CELL - inset * 2), 0.25);
          this.boxes.push({ ...bx, kind: 'cover' });
          if (spec.glow) {
            b.add('glow', Geo.box, mat((bx.minX + bx.maxX) / 2, h + 0.03, (bx.minZ + bx.maxZ) / 2, 0, CELL - inset * 2 + 0.02, 0.06, CELL - inset * 2 + 0.02), spec.glow);
          }
          if (spec.cap) {
            b.add('plain', Geo.box, mat((bx.minX + bx.maxX) / 2, h + 0.08, (bx.minZ + bx.maxZ) / 2, 0, CELL - inset * 2 + 0.1, 0.16, CELL - inset * 2 + 0.1), 0xf6f9ff);
          }
        }
        if (c === 'o') {
          const cx = minX + CELL / 2, cz = minZ + CELL / 2, h = 5.5;
          b.add('plain', Geo.cyl, mat(cx, h / 2, cz, 0, 1.1, h, 1.1), th.pillar);
          b.add('plain', Geo.box, mat(cx, 0.2, cz, 0, 1.5, 0.4, 1.5), th.pillar);
          b.add('plain', Geo.box, mat(cx, h, cz, 0, 1.5, 0.4, 1.5), th.pillar);
          this.boxes.push({ minX: cx - 0.6, maxX: cx + 0.6, minZ: cz - 0.6, maxZ: cz + 0.6, minY: 0, maxY: h + 0.2, kind: 'pillar' });
        }
      }
    }

    // --- wall faces that look onto walkable ground (for decorations)
    const faces = [];
    for (let z = 0; z < this.H; z++) {
      for (let x = 0; x < this.W; x++) {
        if (this.ch(x, z) !== '#') continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = this.ch(x + dx, z + dz);
          if (n === '#' || n === '~' || n === 'C') continue;
          if (x + dx < 0 || z + dz < 0 || x + dx >= this.W || z + dz >= this.H) continue;
          const c = this.center(x, z);
          faces.push({ x: c.x + dx * CELL / 2, z: c.z + dz * CELL / 2, nx: dx, nz: dz, cx: x, cz: z });
        }
      }
    }

    const cellCenter = (x, z) => this.center(x, z);
    const ext = { cx: 0, cz: 0, rx: this.W * CELL / 2, rz: this.H * CELL / 2 };
    const ctx = { b, rng, faces, floorCells, waterCells, cellCenter, blocks: this.blocks, scene, map: this, waterY: WATER_Y, ...ext };
    th.decorate?.(ctx);
    th.backdrop?.(ctx);

    // clouds
    if (th.clouds) {
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2, r = 120 + rng() * 200;
        for (let k = 0; k < 4; k++) {
          b.add('cloud', Geo.sphere, mat(Math.cos(a) * r + (rng() - 0.5) * 30, 70 + rng() * 40, Math.sin(a) * r + (rng() - 0.5) * 15, 0, 18 + rng() * 14, 6 + rng() * 4, 12 + rng() * 8), 0xffffff);
        }
      }
    }

    // ground plane outside the playable area so the backdrop sits on something
    const groundCol = th.floorColor;
    b.addBox('floor', { minX: -400, maxX: 400, minZ: -400, maxZ: 400, minY: -2.5, maxY: -0.02 }, groundCol, 1 / 6);

    b.build(scene, mats);

    // water surface (animated)
    if (waterCells.length) {
      const tex = makeWaterTex();
      const wm = new THREE.MeshPhongMaterial({ color: 0x3f8aa0, map: tex, transparent: true, opacity: 0.88, shininess: 90, specular: 0xffffff });
      const geo = new THREE.PlaneGeometry(this.W * CELL, this.H * CELL);
      const water = new THREE.Mesh(geo, wm);
      water.rotation.x = -Math.PI / 2;
      water.position.set(0, WATER_Y, 0);
      tex.repeat.set(this.W / 2, this.H / 2);
      scene.add(water);
      this.updaters.push((dt) => { tex.offset.x += dt * 0.03; tex.offset.y += dt * 0.012; });
    }

    // site letters glowing on the floor
    for (const k of ['A', 'B']) {
      const s = this.sites[k];
      const color = th.siteGlow?.[k] || '#ffffff';
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5),
        new THREE.MeshBasicMaterial({ map: letterTexture(k, color), transparent: true, opacity: 0.85, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      const spot = s.coverCells.find(([x, z]) => this.ch(x, z) === k) || s.cells[0];
      const p = this.center(spot[0], spot[1]);
      m.position.set(p.x, 0.03, p.z);
      scene.add(m);
    }

    // colored point lights (night / moody maps)
    for (const [color, where] of th.lights || []) {
      const l = new THREE.PointLight(color, 40, 26, 1.6);
      const p = where === 'mid' ? new THREE.Vector3(0, 0, 0) : this.sites[where].center.clone();
      l.position.set(p.x, 5, p.z);
      scene.add(l);
    }

    // buy-phase barriers around spawns
    this.barriers = this.buildBarriers(scene);

    const upd = addParticles(th.particles, scene, { minX: this.ox, maxX: -this.ox, minZ: this.oz, maxZ: -this.oz });
    if (upd) this.updaters.push(upd);
  }

  addTrim(b, bx, th, rng) {
    const t = th.trim || {};
    const cx = (bx.minX + bx.maxX) / 2, cz = (bx.minZ + bx.maxZ) / 2;
    const w = bx.maxX - bx.minX, d = bx.maxZ - bx.minZ, h = bx.maxY;
    const color = t.colors[Math.floor(rng() * t.colors.length)];
    if (t.glow) {
      b.add('glow', Geo.box, mat(cx, h - 0.25, cz, 0, w + 0.08, 0.12, d + 0.08), color);
      b.add('plain', Geo.box, mat(cx, h + 0.15, cz, 0, w + 0.3, 0.3, d + 0.3), 0x22222e);
    } else if (t.snowCap) {
      b.add('plain', Geo.box, mat(cx, h + 0.15, cz, 0, w + 0.3, 0.3, d + 0.3), color);
      b.add('plain', Geo.box, mat(cx, h - 0.05, cz, 0, w + 0.12, 0.12, d + 0.12), 0x4a5058);
    } else if (t.crenel) {
      b.add('plain', Geo.box, mat(cx, h + 0.1, cz, 0, w + 0.25, 0.2, d + 0.25), color);
      const n = Math.max(1, Math.floor(w / 1.5)), m = Math.max(1, Math.floor(d / 1.5));
      for (let i = 0; i < n; i += 2) {
        const x = bx.minX + (i + 0.5) * w / n;
        b.add('plain', Geo.box, mat(x, h + 0.55, bx.minZ + 0.2, 0, w / n, 0.7, 0.4), color);
        b.add('plain', Geo.box, mat(x, h + 0.55, bx.maxZ - 0.2, 0, w / n, 0.7, 0.4), color);
      }
      for (let i = 0; i < m; i += 2) {
        const z = bx.minZ + (i + 0.5) * d / m;
        b.add('plain', Geo.box, mat(bx.minX + 0.2, h + 0.55, z, 0, 0.4, 0.7, d / m), color);
        b.add('plain', Geo.box, mat(bx.maxX - 0.2, h + 0.55, z, 0, 0.4, 0.7, d / m), color);
      }
    } else if (t.moss) {
      b.add('plain', Geo.box, mat(cx, h + 0.1, cz, 0, w + 0.3, 0.25, d + 0.3), color);
      if (rng() < 0.5) b.add('plain', Geo.sphere, mat(cx + (rng() - 0.5) * w * 0.6, h + 0.3, cz + (rng() - 0.5) * d * 0.6, 0, Math.min(w, d) * 0.7, 1.2, Math.min(w, d) * 0.7), 0x3d7d32);
    } else if (t.roof) {
      b.add('plain', Geo.box, mat(cx, h + 0.15, cz, 0, w + 0.6, 0.3, d + 0.6), color);
      b.add('plain', Geo.box, mat(cx, h - 0.2, cz, 0, w + 0.25, 0.25, d + 0.25), 0xf2e8d8);
      if (rng() < 0.5) b.add('plain', Geo.box, mat(cx + (rng() - 0.5) * (w - 1), h + 1.0, cz + (rng() - 0.5) * (d - 1), 0, 0.7, 1.6, 0.7), 0xb8604a);
    } else {
      b.add('plain', Geo.box, mat(cx, h + 0.1, cz, 0, w + 0.2, 0.2, d + 0.2), color);
    }
  }

  buildBarriers(scene) {
    const group = new THREE.Group();
    const mats = {
      T: new THREE.MeshBasicMaterial({ color: 0xff7a3d, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
      D: new THREE.MeshBasicMaterial({ color: 0x3dc8ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    };
    const plane = new THREE.PlaneGeometry(CELL, 3.2);
    for (const k of ['T', 'D']) {
      for (const [x, z] of this.spawns[k]) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = this.ch(x + dx, z + dz);
          if (n === k || n === '#' || n === 'C') continue;
          const c = this.center(x, z);
          const m = new THREE.Mesh(plane, mats[k]);
          m.position.set(c.x + dx * CELL / 2, 1.6, c.z + dz * CELL / 2);
          m.rotation.y = dx ? Math.PI / 2 : 0;
          group.add(m);
        }
      }
    }
    scene.add(group);
    return group;
  }

  update(dt) {
    for (const u of this.updaters) u(dt);
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

  // A* over the cell grid, 8-way without cutting corners. `penalty` (optional Float32Array) adds cost per cell.
  findPath(sx, sz, gx, gz, penalty = null) {
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
          const ng = gScore[cur] + (dx && dz ? Math.SQRT2 : 1) + (penalty ? penalty[ni] : 0);
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

  // Finds a few distinct attacker routes to each site by penalising cells already used.
  computeRoutes() {
    this.routes = {};
    const [tx, tz] = this.tCenter;
    for (const k of ['A', 'B']) {
      const s = this.sites[k];
      const goal = s.cells[Math.floor(s.cells.length / 2)];
      const penalty = new Float32Array(this.W * this.H);
      const routes = [];
      for (let i = 0; i < 3; i++) {
        const path = this.findPath(tx, tz, goal[0], goal[1], penalty);
        if (!path.length) break;
        // waypoint: a cell about 60% along the path
        const wp = path[Math.floor(path.length * 0.6)];
        if (!routes.some((r) => Math.abs(r[0][0] - wp[0]) + Math.abs(r[0][1] - wp[1]) < 3)) routes.push([wp]);
        for (const [x, z] of path) {
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const ix = x + dx, iz = z + dz;
            if (ix >= 0 && iz >= 0 && ix < this.W && iz < this.H) penalty[iz * this.W + ix] += 4;
          }
        }
      }
      this.routes[k] = routes.length ? routes : [[goal]];
    }
    // "mid" holding spots for defenders: walkable cells closest to the map centre
    const cells = [];
    for (let z = 0; z < this.H; z++) for (let x = 0; x < this.W; x++) {
      if (!this.walkable(x, z) || this.siteAt(this.center(x, z).x, this.center(x, z).z)) continue;
      const c = this.ch(x, z);
      if (c === 'T' || c === 'D') continue;
      cells.push([x, z, Math.hypot(x - this.W / 2, z - this.H * 0.45)]);
    }
    cells.sort((a, b) => a[2] - b[2]);
    this.midHold = cells.slice(0, 6).map(([x, z]) => [x, z]);
  }

  watchYaw(cx, cz, fromCx, fromCz) {
    const path = this.findPath(cx, cz, fromCx, fromCz);
    if (!path.length) return 0;
    const p = path[Math.min(4, path.length - 1)];
    return Math.atan2(-(p[0] - cx), -(p[1] - cz));
  }

  drawMinimap(ctx, scale) {
    const th = this.theme;
    for (let z = 0; z < this.H; z++) {
      for (let x = 0; x < this.W; x++) {
        const c = this.ch(x, z);
        if (c === '#') continue;
        let col;
        if (c === 'C' || c === 'c' || c === 'o') col = '#5a6470';
        else if (c === '~') col = '#2c5a7a';
        else if (c === 'A') col = '#6b5640';
        else if (c === 'B') col = '#3f5068';
        else if (c === 'T') col = '#3f4c40';
        else if (c === 'D') col = '#4f3f44';
        else col = '#3a3f46';
        ctx.fillStyle = col;
        ctx.fillRect(x * scale, z * scale, scale + 0.5, scale + 0.5);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `bold ${scale * 2.2}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const k of ['A', 'B']) {
      const s = this.sites[k];
      ctx.fillText(k, ((s.x0 + s.x1) / 2 + 0.5) * scale, ((s.z0 + s.z1) / 2 + 0.5) * scale);
    }
    void th;
  }
}

function tintColor(hex, rng, amt) {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(1 + (rng() - 0.5) * amt);
}

function makeWaterTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#9ad0dc'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.3})`;
    g.lineWidth = 1 + Math.random() * 2;
    const x = Math.random() * 256, y = Math.random() * 256, w = 10 + Math.random() * 30;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 4, x + w, y); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

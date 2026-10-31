import * as THREE from '../lib/three.module.min.js?v=20261031170820';
import { buildTheme, addParticles, letterTexture, mat, Geo, scatterGround } from './theme.js?v=20261031170820';

export const CELL = 3;
const LOW_H = 1.1;
const HIGH_H = 2.4;
const WATER_Y = -1.0;
const LEVEL = { 1: 1.0, 2: 2.4, 3: 3.6 };
const STAIRS = { '^': [0, -1], v: [0, 1], '<': [-1, 0], '>': [1, 0] };
const BLOCKING = new Set(['#', 'C', 'c', 'o', '~', 'w']);
const SILL = 1.1, WIN_TOP = 2.5, ARCH_TOP = 3.1, CEIL = 4.0;

export class GameMap {
  constructor(scene, def, opts = {}) {
    this.opts = opts;
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
    return !BLOCKING.has(this.ch(cx, cz));
  }

  isStair(cx, cz) { return !!STAIRS[this.ch(cx, cz)]; }

  // Floor height of a plain (non-stair) cell.
  baseHeight(cx, cz) {
    const c = this.ch(cx, cz);
    return LEVEL[c] ?? 0;
  }

  // Low and high ends of a stair cell.
  stairInfo(cx, cz) {
    const [dx, dz] = STAIRS[this.ch(cx, cz)];
    return { dx, dz, lo: this.baseHeight(cx - dx, cz - dz), hi: this.baseHeight(cx + dx, cz + dz) };
  }

  cellHeight(cx, cz) {
    if (this.isStair(cx, cz)) { const s = this.stairInfo(cx, cz); return (s.lo + s.hi) / 2; }
    return this.baseHeight(cx, cz);
  }

  // Ground height at a world position (floors, platforms, stairs and cover tops).
  heightAt(x, z) {
    const cx = this.cellX(x), cz = this.cellZ(z);
    if (this.isStair(cx, cz)) {
      const s = this.stairInfo(cx, cz);
      const fx = (x - this.ox) / CELL - cx, fz = (z - this.oz) / CELL - cz;
      let t = s.dx > 0 ? fx : s.dx < 0 ? 1 - fx : s.dz > 0 ? fz : 1 - fz;
      t = Math.max(0, Math.min(1, t));
      return s.lo + (s.hi - s.lo) * Math.ceil(t * this.stepCount(s) ) / this.stepCount(s);
    }
    let y = this.baseHeight(cx, cz);
    for (const b of this.boxes) {
      if (b.kind !== 'cover') continue;
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) y = Math.max(y, b.maxY);
    }
    return y;
  }

  stepCount(s) { return Math.max(2, Math.round(Math.abs(s.hi - s.lo) / 0.3)); }

  // Can a bot walk from cell a to neighbouring cell b?
  edgeOK(ax, az, bx, bz) {
    if (!this.walkable(bx, bz)) return false;
    const mx = bx - ax, mz = bz - az;
    const sa = this.isStair(ax, az), sb = this.isStair(bx, bz);
    if (sa || sb) {
      if (mx && mz) return false;
      for (const [cx, cz, on] of [[ax, az, sa], [bx, bz, sb]]) {
        if (!on) continue;
        const s = this.stairInfo(cx, cz);
        if (Math.abs(s.dx) !== Math.abs(mx) || Math.abs(s.dz) !== Math.abs(mz)) return false;
      }
      return true;
    }
    const ha = this.baseHeight(ax, az), hb = this.baseHeight(bx, bz);
    if (mx && mz) {
      if (!this.walkable(ax + mx, az) || !this.walkable(ax, az + mz)) return false;
      if (this.isStair(ax + mx, az) || this.isStair(ax, az + mz)) return false;
      if (ha !== hb || this.baseHeight(ax + mx, az) !== ha || this.baseHeight(ax, az + mz) !== ha) return false;
    }
    if (hb - ha > 1.05) return false; // too high to climb (1.0 ledges need a jump)
    if (ha - hb > 2.6) return false;  // too far to drop
    return true;
  }

  cellX(x) { return Math.floor((x - this.ox) / CELL); }
  cellZ(z) { return Math.floor((z - this.oz) / CELL); }
  charAt(x, z) { return this.ch(this.cellX(x), this.cellZ(z)); }

  center(cx, cz, out = new THREE.Vector3()) {
    return out.set(this.ox + (cx + 0.5) * CELL, 0, this.oz + (cz + 0.5) * CELL);
  }

  // Cell centre standing on the floor.
  groundCenter(cx, cz, out = new THREE.Vector3()) {
    this.center(cx, cz, out);
    out.y = this.cellHeight(cx, cz);
    return out;
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
    const { th, rng, b, bb, mats } = buildTheme(def.theme, this, scene, seed, this.opts);
    this.theme = th;
    const W = this.W, H = this.H;
    const wx = (x) => this.ox + x * CELL, wz = (z) => this.oz + z * CELL;

    // --- solid wall blocks: horizontal runs merged vertically into rectangles
    const runs = [];
    for (let z = 0; z < H; z++) {
      let x = 0;
      while (x < W) {
        if (this.ch(x, z) === '#') {
          let x1 = x;
          while (x1 + 1 < W && this.ch(x1 + 1, z) === '#') x1++;
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
    const heightGrid = new Float32Array(W * H);
    for (const m of rects) {
      const border = m.x0 === 0 || m.z0 === 0 || m.x1 === W - 1 || m.z1 === H - 1;
      const [h0, h1] = th.wallHeight;
      const h = Math.round((h0 + rng() * (h1 - h0) + (border ? 2 : 0)) * 2) / 2;
      m.h = h;
      for (let z = m.z0; z <= m.z1; z++) for (let x = m.x0; x <= m.x1; x++) heightGrid[z * W + x] = h;
      const bx = { minX: wx(m.x0), maxX: wx(m.x1 + 1), minZ: wz(m.z0), maxZ: wz(m.z1 + 1), minY: 0, maxY: h };
      m.color = th.wallColors[Math.floor(rng() * th.wallColors.length)];
      b.addRoundBox('wall', { ...bx, minY: -1.6 }, m.color, th.wallUv, 0.35, 0.22);
      this.boxes.push({ ...bx, maxY: 60, kind: 'wall' });
      this.addTrim(b, bx, th, rng);
    }
    const neighborWallH = (x, z) => {
      let h = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) h = Math.max(h, heightGrid[(z + dz) * W + (x + dx)] || 0);
      return h || th.wallHeight[0];
    };
    const wallColorNear = (x, z) => {
      for (const m of rects) if (x >= m.x0 - 1 && x <= m.x1 + 1 && z >= m.z0 - 1 && z <= m.z1 + 1) return m.color;
      return th.wallColors[0];
    };

    const floorCells = [], waterCells = [], indoorCells = [];
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const c = this.ch(x, z);
        if (c === '#') continue;
        const minX = wx(x), minZ = wz(z), maxX = minX + CELL, maxZ = minZ + CELL;
        const cell = { minX, maxX, minZ, maxZ };

        // --- windows and archways sit in wall lines: walls with a real (curved) opening cut through
        if (c === 'w' || c === 'n') {
          const top = neighborWallH(x, z), col = wallColorNear(x, z);
          heightGrid[z * W + x] = top;
          b.addBox('floor', { ...cell, minY: -1.6, maxY: 0 }, th.floorColor, 1 / 3);
          const alongX = '#wn'.includes(this.ch(x - 1, z)) || '#wn'.includes(this.ch(x + 1, z));
          const round = th.archStyle !== 'square';
          const geo = c === 'n'
            ? openingWall(top, 1.2, 0, 1.9, round ? 'arch' : 'rect', 3.1)
            : openingWall(top, round ? 0.8 : 0.9, SILL, round ? 1.75 : 2.5, round ? 'arch' : 'rect', 2.5);
          if (!alongX) geo.rotateY(Math.PI / 2);
          geo.translate(minX + CELL / 2, 0, minZ + CELL / 2);
          b.addGeo('wall', geo, col, th.wallUv, 0.35, -1.6);
          const tc = th.trimColor ?? 0xe8e2d6;
          const side = c === 'n' ? 0.3 : round ? 0.7 : 0.6;
          // colliders: the two sides of the opening, plus sill / lintel
          const post = (lo, hi) => alongX
            ? { minX: lo, maxX: hi, minZ, maxZ }
            : { minZ: lo, maxZ: hi, minX, maxX };
          const a0 = alongX ? minX : minZ, a1 = alongX ? maxX : maxZ;
          this.boxes.push({ ...post(a0, a0 + side), minY: 0, maxY: 60, kind: 'wall' });
          this.boxes.push({ ...post(a1 - side, a1), minY: 0, maxY: 60, kind: 'wall' });
          if (c === 'w') {
            this.boxes.push({ ...cell, minY: 0, maxY: SILL, kind: 'wall' });
            this.boxes.push({ ...cell, minY: WIN_TOP, maxY: 60, kind: 'wall' });
            b.addRoundBox('plain', { ...grow(cell, alongX, 0.12), ...(alongX ? { minX: minX + side - 0.1, maxX: maxX - side + 0.1 } : { minZ: minZ + side - 0.1, maxZ: maxZ - side + 0.1 }), minY: SILL - 0.08, maxY: SILL + 0.04 }, tc, 1, 0, 0.04);
          } else {
            this.boxes.push({ ...cell, minY: ARCH_TOP, maxY: 60, kind: 'wall' });
            // keystone
            b.addRoundBox('plain', { ...grow({ minX: minX + 1.3, maxX: maxX - 1.3, minZ: minZ + 1.3, maxZ: maxZ - 1.3 }, alongX, 1.42), minY: 2.85, maxY: 3.35 }, tc, 1, 0, 0.05);
          }
          continue;
        }

        if (c === '~') {
          waterCells.push({ x, z });
          this.boxes.push({ ...cell, minY: -5, maxY: 60, kind: 'water', noShot: true });
          b.addBox('floor', { ...cell, minY: -3, maxY: WATER_Y - 1.2 }, 0x6a6a60, 1 / 3);
          continue;
        }

        floorCells.push({ x, z, ch: c });
        const site = this.siteAt(minX + 1.5, minZ + 1.5);
        let col = th.floorColor;
        if (site) col = th.site[site];
        else if (c === 'T' || c === 'D') col = th.spawn[c];
        else if (c === ',') col = th.indoorColor ?? 0xb08a64;
        const floorKey = c === ',' ? 'indoor' : 'floor';

        if (STAIRS[c]) {
          // solid stepped block rising toward the stair direction
          const sI = this.stairInfo(x, z), n = this.stepCount(sI);
          b.addBox('floor', { ...cell, minY: -1.6, maxY: sI.lo }, col, 1 / 3);
          if (sI.lo > 0) this.boxes.push({ ...cell, minY: 0, maxY: sI.lo, kind: 'floor' });
          for (let k = 0; k < n; k++) {
            const t0 = k / n, t1 = (k + 1) / n;
            const y = sI.lo + (sI.hi - sI.lo) * (k + 1) / n;
            const st = { ...cell, minY: sI.lo, maxY: y };
            if (sI.dx > 0) { st.minX = minX + t0 * CELL; st.maxX = maxX; }
            if (sI.dx < 0) { st.maxX = maxX - t0 * CELL; st.minX = minX; }
            if (sI.dz > 0) { st.minZ = minZ + t0 * CELL; st.maxZ = maxZ; }
            if (sI.dz < 0) { st.maxZ = maxZ - t0 * CELL; st.minZ = minZ; }
            b.addBox('floor', st, shade(col, 0.9 + (k % 2) * 0.08), 1 / 3);
            // collider: only the part of each step that is not covered by the next one
            const cb = { ...st, kind: 'floor' };
            if (sI.dx > 0) cb.maxX = minX + t1 * CELL;
            if (sI.dx < 0) cb.minX = maxX - t1 * CELL;
            if (sI.dz > 0) cb.maxZ = minZ + t1 * CELL;
            if (sI.dz < 0) cb.minZ = maxZ - t1 * CELL;
            if (k === n - 1) { cb.minX = st.minX; cb.maxX = st.maxX; cb.minZ = st.minZ; cb.maxZ = st.maxZ; }
            this.boxes.push(cb);
          }
          continue;
        }

        const lvl = LEVEL[c] ?? 0;
        if (lvl > 0) {
          b.addBox('wall', { ...cell, minY: -1.6, maxY: lvl - 0.12 }, th.ledgeColor ?? th.wallColors[0], th.wallUv, 0.3);
          b.addBox(floorKey, { ...cell, minY: lvl - 0.12, maxY: lvl }, col, 1 / 3);
          this.boxes.push({ ...cell, minY: 0, maxY: lvl, kind: 'floor' });
          // railings / lips where the platform drops off
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nc = this.ch(x + dx, z + dz);
            if (BLOCKING.has(nc) && nc !== 'c' && nc !== 'C' && nc !== '~') continue;
            if (STAIRS[nc] || (LEVEL[nc] ?? 0) >= lvl) continue;
            const ex = dx ? (dx > 0 ? maxX : minX) : (minX + maxX) / 2, ez = dz ? (dz > 0 ? maxZ : minZ) : (minZ + maxZ) / 2;
            b.add('plain', Geo.cyl, mat(ex - dx * 0.06, lvl + 0.02, ez - dz * 0.06, dx ? Math.PI / 2 : 0, 0.2, CELL, 0.2, 0, Math.PI / 2), th.trimColor ?? 0xe8e2d6);
            if (lvl >= 2 && th.railings !== false) {
              b.add('plain', Geo.box, mat(ex - dx * 0.08, lvl + 0.95, ez - dz * 0.08, 0, dx ? 0.08 : CELL, 0.08, dz ? 0.08 : CELL), th.railColor ?? 0x3a3f48);
              for (let k = 0; k < 4; k++) {
                const o = -CELL / 2 + (k + 0.5) * CELL / 4;
                b.add('plain', Geo.box, mat(ex - dx * 0.08 + (dz ? o : 0), lvl + 0.5, ez - dz * 0.08 + (dx ? o : 0), 0, 0.06, 0.9, 0.06), th.railColor ?? 0x3a3f48);
              }
            }
          }
        } else {
          b.addBox(floorKey, { ...cell, minY: -1.6, maxY: 0 }, tintColor(col, rng, 0.06), 1 / 3);
        }

        if (c === ',') {
          indoorCells.push({ x, z });
          // ceiling slab; lamp panel every other cell
          b.addBox('wall', { ...cell, minY: CEIL, maxY: CEIL + 0.4 }, th.ceilColor ?? 0xd8d0c4, th.wallUv);
          this.boxes.push({ ...cell, minY: CEIL, maxY: CEIL + 0.4, kind: 'wall' });
          if ((x + z) % 2 === 0) b.add('glow', Geo.box, mat(minX + 1.5, CEIL - 0.03, minZ + 1.5, 0, 1.2, 0.05, 0.5), th.indoorLight ?? 0xfff0d0);
          // support posts on open corners so the roof doesn't float
          for (const [sx, sz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const ox = sx ? 1 : -1, oz = sz ? 1 : -1;
            const solid = (cx, cz) => { const k = this.ch(cx, cz); return k === '#' || k === 'w' || k === 'n' || k === ','; };
            if (solid(x + ox, z) || solid(x, z + oz) || solid(x + ox, z + oz)) continue;
            const px = sx ? maxX - 0.15 : minX + 0.15, pz = sz ? maxZ - 0.15 : minZ + 0.15;
            b.addBox('wall', { minX: px - 0.15, maxX: px + 0.15, minZ: pz - 0.15, maxZ: pz + 0.15, minY: 0, maxY: CEIL }, th.ledgeColor ?? th.wallColors[0], th.wallUv);
            this.boxes.push({ minX: px - 0.15, maxX: px + 0.15, minZ: pz - 0.15, maxZ: pz + 0.15, minY: 0, maxY: CEIL, kind: 'pillar' });
          }
        }

        if (c === 'c' || c === 'C') {
          const low = c === 'c';
          const spec = low ? th.low : th.high;
          const inset = low ? 0.25 : 0.15;
          const h = low ? LOW_H : HIGH_H;
          const bx = { minX: minX + inset, maxX: maxX - inset, minZ: minZ + inset, maxZ: maxZ - inset, minY: 0, maxY: h };
          b.addRoundBox(low ? 'low' : 'high', bx, spec.colors[Math.floor(rng() * spec.colors.length)], 1 / (CELL - inset * 2), 0.25, low ? 0.14 : 0.12);
          this.boxes.push({ ...bx, kind: 'cover' });
          th.coverDetail?.(b, bx, low, rng);
          if (spec.glow) {
            // glowing trim along the top edges
            const w = CELL - inset * 2, mx = (bx.minX + bx.maxX) / 2, mz = (bx.minZ + bx.maxZ) / 2;
            b.add('glow', Geo.box, mat(mx, h - 0.05, bx.minZ - 0.01, 0, w + 0.02, 0.08, 0.04), spec.glow);
            b.add('glow', Geo.box, mat(mx, h - 0.05, bx.maxZ + 0.01, 0, w + 0.02, 0.08, 0.04), spec.glow);
            b.add('glow', Geo.box, mat(bx.minX - 0.01, h - 0.05, mz, 0, 0.04, 0.08, w + 0.02), spec.glow);
            b.add('glow', Geo.box, mat(bx.maxX + 0.01, h - 0.05, mz, 0, 0.04, 0.08, w + 0.02), spec.glow);
          }
          if (spec.cap) b.add('plain', Geo.box, mat((bx.minX + bx.maxX) / 2, h + 0.08, (bx.minZ + bx.maxZ) / 2, 0, CELL - inset * 2 + 0.1, 0.16, CELL - inset * 2 + 0.1), 0xf6f9ff);
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
    this.blocks = { rects, heightAt: (cx, cz) => heightGrid[cz * W + cx] || 6 };

    // --- wall faces that look onto walkable ground (for decorations)
    const faces = [];
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        if (this.ch(x, z) !== '#') continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
          const n = this.ch(nx, nz);
          if (BLOCKING.has(n) || n === 'n' || n === ',' || STAIRS[n]) continue;
          const c = this.center(x, z);
          faces.push({ x: c.x + dx * CELL / 2, z: c.z + dz * CELL / 2, nx: dx, nz: dz, cx: x, cz: z, base: LEVEL[n] ?? 0, top: heightGrid[z * W + x] });
        }
      }
    }

    const cellCenter = (x, z) => this.center(x, z);
    const ext = { cx: 0, cz: 0, rx: W * CELL / 2, rz: H * CELL / 2 };
    const ctx = { b, rng, faces, floorCells, waterCells, indoorCells, cellCenter, blocks: this.blocks, scene, map: this, waterY: WATER_Y, ...ext };
    th.decorate?.(ctx);
    scatterGround(ctx, th.ground);
    th.backdrop?.({ ...ctx, b: bb });

    if (th.clouds) {
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2, r = 120 + rng() * 200;
        for (let k = 0; k < 4; k++) {
          bb.add('cloud', Geo.sphere, mat(Math.cos(a) * r + (rng() - 0.5) * 30, 70 + rng() * 40, Math.sin(a) * r + (rng() - 0.5) * 15, 0, 18 + rng() * 14, 6 + rng() * 4, 12 + rng() * 8), 0xffffff);
        }
      }
    }
    bb.addBox('floor', { minX: -400, maxX: 400, minZ: -400, maxZ: 400, minY: -2.5, maxY: -0.02 }, th.floorColor, 1 / 6);

    const shadows = !!this.opts.shadows;
    for (const m of b.build(scene, mats)) { m.castShadow = shadows; m.receiveShadow = shadows; }
    for (const m of bb.build(scene, mats)) { m.receiveShadow = shadows; }

    if (waterCells.length) {
      const tex = makeWaterTex();
      const wm = new THREE.MeshPhongMaterial({ color: 0x3f8aa0, map: tex, transparent: true, opacity: 0.88, shininess: 90, specular: 0xffffff });
      const water = new THREE.Mesh(new THREE.PlaneGeometry(W * CELL, H * CELL), wm);
      water.rotation.x = -Math.PI / 2;
      water.position.set(0, WATER_Y, 0);
      water.receiveShadow = shadows;
      tex.repeat.set(W / 2, H / 2);
      scene.add(water);
      this.updaters.push((dt) => { tex.offset.x += dt * 0.03; tex.offset.y += dt * 0.012; });
    }

    for (const k of ['A', 'B']) {
      const s = this.sites[k];
      const color = th.siteGlow?.[k] || '#ffffff';
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5),
        new THREE.MeshBasicMaterial({ map: letterTexture(k, color), transparent: true, opacity: 0.85, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      const spot = s.cells.find(([x, z]) => this.ch(x, z) === k) || s.cells[0];
      const p = this.groundCenter(spot[0], spot[1]);
      m.position.set(p.x, p.y + 0.03, p.z);
      scene.add(m);
    }

    for (const [color, where] of th.lights || []) {
      const l = new THREE.PointLight(color, 40, 26, 1.6);
      const p = where === 'mid' ? new THREE.Vector3(0, 0, 0) : this.sites[where].center.clone();
      l.position.set(p.x, 5, p.z);
      scene.add(l);
    }

    this.barriers = this.buildBarriers(scene);
    const upd = addParticles(th.particles, scene, { minX: this.ox, maxX: -this.ox, minZ: this.oz, maxZ: -this.oz });
    if (upd) this.updaters.push(upd);
  }

  addTrim(b, bx, th, rng) {
    const t = th.trim || {};
    const cx = (bx.minX + bx.maxX) / 2, cz = (bx.minZ + bx.maxZ) / 2;
    const w = bx.maxX - bx.minX, d = bx.maxZ - bx.minZ, h = bx.maxY;
    const color = t.colors[Math.floor(rng() * t.colors.length)];
    const tc = th.trimColor ?? 0xe8e2d6;
    // base plinth and floor-line bands so walls aren't flat slabs
    b.addRoundBox('plain', { minX: bx.minX - 0.08, maxX: bx.maxX + 0.08, minZ: bx.minZ - 0.08, maxZ: bx.maxZ + 0.08, minY: -0.2, maxY: 0.42 }, th.plinthColor ?? shade(th.wallColors[0], 0.75), 1, 0, 0.08);
    for (let y = 3.3; y < h - 1.2; y += 3.3) {
      b.addRoundBox('plain', { minX: bx.minX - 0.1, maxX: bx.maxX + 0.1, minZ: bx.minZ - 0.1, maxZ: bx.maxZ + 0.1, minY: y - 0.08, maxY: y + 0.08 }, tc, 1, 0, 0.06);
    }
    // rounded corner columns
    if (th.pilasters !== false) {
      for (const [x, z] of [[bx.minX, bx.minZ], [bx.maxX, bx.minZ], [bx.minX, bx.maxZ], [bx.maxX, bx.maxZ]]) {
        b.add('plain', Geo.cyl, mat(x, h / 2, z, 0, 0.42, h, 0.42), th.pilasterColor ?? tc);
      }
    }
    th.roof?.(b, bx, rng, { cx, cz, w, d, h });
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
          if (n === k || BLOCKING.has(n)) continue;
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
          if (!this.edgeOK(cx, cz, nx, nz)) continue;
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
      // attackers shouldn't plan routes through the defenders' spawn
      for (const [x, z] of this.spawns.D) penalty[z * this.W + x] = 60;
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
      if (c === 'T' || c === 'D' || STAIRS[c]) continue;
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
        if (c === 'w') col = '#20242a';
        else if (c === 'C' || c === 'c' || c === 'o') col = '#5a6470';
        else if (LEVEL[c] || STAIRS[c]) col = LEVEL[c] >= 2 ? '#6a7480' : '#525a64';
        else if (c === ',' || c === 'n') col = '#4a4038';
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

// A 3m wall section with an opening cut through it (shape in X/Y, extruded across Z).
// hw: half width of the hole, y0: bottom of hole, ys: where the arch springs (or top for 'rect').
function openingWall(top, hw, y0, ys, style, holeTop) {
  const H = CELL / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-H, -1.6); shape.lineTo(H, -1.6); shape.lineTo(H, top); shape.lineTo(-H, top); shape.lineTo(-H, -1.6);
  const hole = new THREE.Path();
  if (style === 'arch') {
    hole.moveTo(-hw, y0);
    hole.lineTo(-hw, ys);
    hole.absarc(0, ys, hw, Math.PI, 0, true);
    hole.lineTo(hw, y0);
    hole.lineTo(-hw, y0);
  } else {
    const r = 0.18, t = holeTop;
    hole.moveTo(-hw, y0);
    hole.lineTo(-hw, t - r);
    hole.quadraticCurveTo(-hw, t, -hw + r, t);
    hole.lineTo(hw - r, t);
    hole.quadraticCurveTo(hw, t, hw, t - r);
    hole.lineTo(hw, y0);
    hole.lineTo(-hw, y0);
  }
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: CELL, bevelEnabled: false, curveSegments: 12 });
  g.translate(0, 0, -H);
  return g;
}

// Expand a cell box sideways (across the wall's thickness) for trims.
function grow(cell, alongX, d) {
  return alongX ? { minZ: cell.minZ - d, maxZ: cell.maxZ + d, minX: cell.minX, maxX: cell.maxX }
    : { minX: cell.minX - d, maxX: cell.maxX + d, minZ: cell.minZ, maxZ: cell.maxZ };
}

function shade(hex, k) {
  return new THREE.Color(hex).multiplyScalar(k);
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

import * as THREE from '../lib/three.module.min.js';

// Pooled visual effects: tracers, bullet holes, particles, explosions.
export class Effects {
  constructor(scene) {
    this.scene = scene;

    this.tracers = [];
    for (let i = 0; i < 24; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0 }));
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerIdx = 0;

    const decalGeo = new THREE.PlaneGeometry(0.12, 0.12);
    const decalMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a1a, transparent: true, opacity: 0.85, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.decals = [];
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(decalGeo, decalMat);
      m.visible = false;
      scene.add(m);
      this.decals.push(m);
    }
    this.decalIdx = 0;

    const pGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    this.pMats = {
      blood: new THREE.MeshBasicMaterial({ color: 0xb3122a }),
      spark: new THREE.MeshBasicMaterial({ color: 0xffd27a }),
      dust: new THREE.MeshBasicMaterial({ color: 0x9a8f80 }),
    };
    this.particles = [];
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(pGeo, this.pMats.dust);
      m.visible = false;
      scene.add(m);
      this.particles.push({ mesh: m, vel: new THREE.Vector3(), life: 0 });
    }
    this.pIdx = 0;

    this.boom = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.boom.visible = false;
    scene.add(this.boom);
    this.boomT = 0;
    this.flashes = [];
  }

  tracer(from, to) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const a = t.line.geometry.attributes.position;
    // start a little way along so the tracer doesn't sit in front of the muzzle
    const sx = from.x + (to.x - from.x) * 0.05, sy = from.y + (to.y - from.y) * 0.05, sz = from.z + (to.z - from.z) * 0.05;
    a.setXYZ(0, sx, sy, sz);
    a.setXYZ(1, to.x, to.y, to.z);
    a.needsUpdate = true;
    t.line.geometry.computeBoundingSphere();
    t.line.visible = true;
    t.life = 0.07;
    t.line.material.opacity = 0.8;
  }

  impact(point, normal) {
    const d = this.decals[this.decalIdx];
    this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    d.position.copy(point).addScaledVector(normal, 0.01);
    d.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z);
    d.rotation.z = Math.random() * Math.PI;
    d.visible = true;
    this.burst(point, normal, 'dust', 4, 2.5);
    this.burst(point, normal, 'spark', 2, 4);
  }

  blood(point, dir) {
    this.burst(point, dir, 'blood', 7, 2.5);
  }

  burst(point, dir, kind, n, speed) {
    for (let i = 0; i < n; i++) {
      const p = this.particles[this.pIdx];
      this.pIdx = (this.pIdx + 1) % this.particles.length;
      p.mesh.material = this.pMats[kind];
      p.mesh.position.copy(point);
      p.mesh.visible = true;
      p.vel.set(
        dir.x * speed * 0.5 + (Math.random() - 0.5) * speed,
        dir.y * speed * 0.5 + Math.random() * speed * 0.6,
        dir.z * speed * 0.5 + (Math.random() - 0.5) * speed,
      );
      p.life = 0.35 + Math.random() * 0.3;
    }
  }

  explosion(pos) {
    this.boom.position.copy(pos);
    this.boom.visible = true;
    this.boomT = 0;
  }

  muzzleFlash(flashObj) {
    flashObj.visible = true;
    flashObj.rotation.z = Math.random() * Math.PI;
    this.flashes.push({ obj: flashObj, t: 0.05 });
  }

  clear() {
    for (const d of this.decals) d.visible = false;
    for (const p of this.particles) { p.mesh.visible = false; p.life = 0; }
    this.boom.visible = false;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.8;
      if (t.life <= 0) t.line.visible = false;
    }
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vel.y -= 12 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.02) { p.mesh.position.y = 0.02; p.vel.set(0, 0, 0); }
      if (p.life <= 0) p.mesh.visible = false;
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      if (f.t <= 0) { f.obj.visible = false; this.flashes.splice(i, 1); }
    }
    if (this.boom.visible) {
      this.boomT += dt;
      const k = this.boomT / 1.2;
      this.boom.scale.setScalar(2 + k * 22);
      this.boom.material.opacity = Math.max(0, 0.85 * (1 - k));
      if (k >= 1) this.boom.visible = false;
    }
  }
}

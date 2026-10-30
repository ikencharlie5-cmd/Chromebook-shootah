import * as THREE from '../lib/three.module.min.js';
import { buildGun, buildFlash } from './models.js';

// First-person weapon, rendered in its own scene on top of the world so it never clips into walls.
export class ViewModel {
  constructor(aspect) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, aspect, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x554a40, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.4);
    dl.position.set(1, 2, 1);
    this.scene.add(dl);

    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.base = new THREE.Vector3(0.2, -0.21, -0.55);
    this.models = {};
    this.current = null;
    this.flash = buildFlash();
    this.bob = 0;
    this.kickZ = 0; this.kickRot = 0;
    this.swayX = 0; this.swayY = 0;
    this.equipT = 0; this.equipDur = 0.5;
    this.glove = new THREE.MeshLambertMaterial({ color: 0x2ec4b6 });
    this.knifeSwing = 0;
  }

  setTeamColor(color) { this.glove.color.setHex(color); }

  setWeapon(id, equipTime) {
    if (!this.models[id]) {
      const { group, muzzle } = buildGun(id, 0x6c7a89);
      // gloved hands and forearms reaching back toward the bottom of the screen
      const pistol = id === 'pip' || id === 'bolt';
      const handGeo = new THREE.BoxGeometry(0.06, 0.07, 0.1);
      const armGeo = new THREE.BoxGeometry(0.065, 0.065, 0.3);
      const right = new THREE.Mesh(handGeo, this.glove);
      right.position.set(0.0, -0.06, 0.03);
      const rArm = new THREE.Mesh(armGeo, this.glove);
      rArm.position.set(0.05, -0.12, 0.2);
      rArm.rotation.set(0.35, -0.25, 0);
      group.add(right, rArm);
      if (id !== 'knife') {
        const left = new THREE.Mesh(handGeo, this.glove);
        left.position.set(-0.035, -0.03, pistol ? -0.01 : -0.26);
        const lArm = new THREE.Mesh(armGeo, this.glove);
        lArm.position.set(-0.12, -0.1, pistol ? 0.12 : -0.08);
        lArm.rotation.set(0.3, 0.6, 0);
        group.add(left, lArm);
      }
      this.models[id] = { group, muzzle };
    }
    if (this.current) this.holder.remove(this.current.group);
    this.current = this.models[id];
    this.current.id = id;
    this.holder.add(this.current.group);
    this.current.muzzle.add(this.flash);
    this.equipT = equipTime; this.equipDur = Math.max(equipTime, 0.01);
  }

  kick(amount) {
    this.kickZ += 0.05 * amount;
    this.kickRot += 0.08 * amount;
  }

  swing() { this.knifeSwing = 1; }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt, s) {
    // s: { speed, onGround, lookDx, lookDy, reload (0..1 or -1), visible, crouch, action }
    this.holder.visible = s.visible;
    if (!this.current) return;
    if (s.onGround && s.speed > 0.5) this.bob += dt * (4 + s.speed * 1.4);
    const bobAmt = s.onGround ? Math.min(s.speed / 5.4, 1) : 0;
    const bx = Math.sin(this.bob) * 0.012 * bobAmt;
    const by = -Math.abs(Math.cos(this.bob)) * 0.012 * bobAmt;

    this.swayX += (-s.lookDx * 0.0004 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (s.lookDy * 0.0004 - this.swayY) * Math.min(1, dt * 10);
    this.swayX = Math.max(-0.04, Math.min(0.04, this.swayX));
    this.swayY = Math.max(-0.04, Math.min(0.04, this.swayY));

    this.kickZ += (0 - this.kickZ) * Math.min(1, dt * 14);
    this.kickRot += (0 - this.kickRot) * Math.min(1, dt * 12);

    let drop = 0, tilt = 0;
    if (this.equipT > 0) {
      this.equipT -= dt;
      const k = Math.max(0, this.equipT / this.equipDur);
      drop += k * 0.25; tilt += k * 0.6;
    }
    if (s.reload >= 0) {
      const k = Math.sin(Math.min(1, s.reload) * Math.PI);
      drop += k * 0.12; tilt += k * 0.7;
    }
    if (s.action) { drop += 0.2; tilt += 0.4; }
    let swingRot = 0;
    if (this.knifeSwing > 0) {
      this.knifeSwing = Math.max(0, this.knifeSwing - dt * 4);
      swingRot = Math.sin(this.knifeSwing * Math.PI) * 1.1;
    }

    const g = this.current.group;
    g.position.set(
      this.base.x + bx + this.swayX - swingRot * 0.1,
      this.base.y + by + this.swayY - drop - s.crouch * 0.01,
      this.base.z + this.kickZ,
    );
    g.rotation.set(this.kickRot - tilt, swingRot * 0.8, swingRot * 0.6);
  }
}

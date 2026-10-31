import * as THREE from '../lib/three.module.min.js';
import { buildGun, buildFlash, phong, glow } from './models.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _up = new THREE.Vector3(0, 1, 0);

function seg(parent, a, b, r0, r1, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 12), material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(_up, dir.normalize());
  parent.add(m);
  return m;
}
function part(parent, w, h, d, material, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

// Forearm from wrist to elbow: tapered sleeve, hex armor plate, glowing seam, glove cuff.
function forearm(parent, wrist, elbow, m) {
  const dir = new THREE.Vector3().subVectors(elbow, wrist);
  const len = dir.length();
  const g = new THREE.Group();
  g.position.copy(wrist);
  g.quaternion.setFromUnitVectors(_up, dir.normalize());
  parent.add(g);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.027, len, 12), m.sleeve);
  sleeve.position.y = len / 2;
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.036, len * 0.42, 6), m.armor);
  plate.position.y = len * 0.42;
  const seam = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.008, 6), m.accent);
  seam.position.y = len * 0.21;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.035, 12), m.glove);
  cuff.position.y = 0.012;
  g.add(sleeve, plate, seam, cuff);
  return g;
}

// A gloved hand: palm plus jointed fingers curled around a grip.
// side = 1 for right hand, -1 for left. curl ~ 0 (open) .. 1.6 (fist).
function hand(parent, glove, knuckle, side, curl = 1.3) {
  const h = new THREE.Group();
  parent.add(h);
  part(h, 0.075, 0.03, 0.085, glove, 0, 0, 0);
  part(h, 0.072, 0.012, 0.06, knuckle, 0, 0.018, -0.005);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    f.position.set((i - 1.5) * 0.019 * side, 0, -0.045);
    h.add(f);
    part(f, 0.016, 0.018, 0.035, glove, 0, 0, -0.016);
    const j = new THREE.Group();
    j.position.set(0, 0, -0.034);
    j.rotation.x = -curl * 0.8;
    f.add(j);
    part(j, 0.015, 0.016, 0.03, glove, 0, 0, -0.014);
    f.rotation.x = -curl * 0.6;
  }
  const thumb = new THREE.Group();
  thumb.position.set(0.04 * side, -0.005, -0.015);
  thumb.rotation.set(-0.4, 0.7 * side, 0);
  h.add(thumb);
  part(thumb, 0.018, 0.018, 0.045, glove, 0, 0, -0.02);
  return h;
}

// First-person weapon + agent-styled arms, rendered in its own scene on top of the world.
export class ViewModel {
  constructor(aspect) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, aspect, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x554a40, 1.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.position.set(1, 2, 1);
    this.scene.add(this.sun);

    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.base = new THREE.Vector3(0.21, -0.22, -0.58);
    this.models = {};
    this.current = null;
    this.flash = buildFlash();
    this.bob = 0;
    this.kickZ = 0; this.kickRot = 0;
    this.swayX = 0; this.swayY = 0;
    this.equipT = 0; this.equipDur = 0.5;
    this.knifeSwing = 0;
    this.castT = 0;
    this.agent = null;

    // throwing arm (left) used when casting abilities
    this.castArm = new THREE.Group();
    this.castArm.visible = false;
    this.castArm.scale.setScalar(0.85);
    this.scene.add(this.castArm);
    this.orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  }

  setLighting(hemiSky, hemiGround, intensity) {
    this.hemi.color.setHex(hemiSky);
    this.hemi.groundColor.setHex(hemiGround);
    this.hemi.intensity = intensity * 1.3;
  }

  setAgent(agent) {
    if (this.agent === agent) return;
    this.agent = agent;
    for (const id in this.models) this.holder.remove(this.models[id].group);
    this.models = {};
    this.current = null;
    // rebuild the throw arm
    this.castArm.clear();
    const m = this.mats();
    forearm(this.castArm, V(-0.01, -0.03, 0.05), V(-0.12, -0.24, 0.4), m);
    const hd = hand(this.castArm, m.glove, m.plate, -1, 0.9);
    hd.rotation.x = 0.2;
    this.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.026, 1), this.orbMat);
    this.orb.position.set(0, 0.035, -0.05);
    this.castArm.add(this.orb);
  }

  mats() {
    const a = this.agent || { suit: 0x2a86f2, suit2: 0x1a1d22, accent: 0x7ff6ff };
    const armor = new THREE.Color(a.suit).lerp(new THREE.Color(0xffffff), 0.12).getHex();
    return {
      sleeve: phong(new THREE.Color(a.suit2).lerp(new THREE.Color(a.suit), 0.35).getHex(), 20),
      armor: phong(armor, 70),
      glove: phong(0x1b1d22, 25),
      plate: phong(0x2c3038, 80),
      accent: glow(a.accent),
    };
  }

  build(id) {
    const { group, muzzle } = buildGun(id);
    const m = this.mats();
    const pistol = id === 'pip' || id === 'bolt';
    const knife = id === 'knife';

    // right hand on the grip, forearm running back toward the bottom-right of the screen
    const rh = hand(group, m.glove, m.plate, 1, knife ? 1.5 : 1.3);
    rh.position.set(0.005, -0.045, 0.02);
    rh.rotation.set(0.25, 0, Math.PI / 2 - 0.25);
    forearm(group, V(0.012, -0.075, 0.07), knife ? V(0.12, -0.3, 0.42) : V(0.15, -0.32, 0.4), m);
    if (!knife) {
      // left hand under the handguard (or cupping the pistol grip)
      const lz = pistol ? 0.015 : -0.26;
      const lh = hand(group, m.glove, m.plate, -1, 1.1);
      lh.position.set(-0.03, pistol ? -0.06 : -0.035, lz);
      lh.rotation.set(0.1, 0, pistol ? -Math.PI / 2 + 0.4 : -Math.PI / 2 + 0.15);
      const wrist = V(-0.045, -0.075, lz + 0.05);
      forearm(group, wrist, pistol ? V(-0.2, -0.32, 0.36) : V(-0.27, -0.3, 0.1), m);
    }
    return { group, muzzle };
  }

  setWeapon(id, equipTime) {
    if (!this.models[id]) this.models[id] = this.build(id);
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

  cast(color) {
    this.castT = 0.5;
    this.orbMat.color.setHex(color);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt, s) {
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

    // ability throw: gun dips, left arm swings up and forward
    if (this.castT > 0) {
      this.castT -= dt;
      const p = 1 - Math.max(0, this.castT) / 0.5;
      drop += Math.sin(p * Math.PI) * 0.18;
      tilt += Math.sin(p * Math.PI) * 0.3;
      this.castArm.visible = s.visible;
      const swing = p < 0.45 ? p / 0.45 : 1;
      const out = p < 0.45 ? 0 : (p - 0.45) / 0.55;
      this.castArm.position.set(-0.24 + swing * 0.08, -0.36 + swing * 0.18 - out * 0.15, -0.5 - out * 0.25);
      this.castArm.rotation.set(-0.3 + swing * 0.9, 0.2, 0);
      this.orb.visible = p < 0.55;
    } else this.castArm.visible = false;

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

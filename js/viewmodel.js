import * as THREE from '../lib/three.module.min.js?v=20261031171146';
import { buildGun, buildFlash, glow } from './models.js?v=20261031171146';
import { toonGradient, outlineMaterial } from './people.js?v=20261031171146';

const toonCache = new Map();
function toon(color) {
  if (!toonCache.has(color)) toonCache.set(color, new THREE.MeshToonMaterial({ color, gradientMap: toonGradient }));
  return toonCache.get(color);
}
const OUTLINE = outlineMaterial(0x101418, 0.005);

// Adds a mesh plus a thin cartoon outline shell.
function inked(parent, geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.add(new THREE.Mesh(geo, OUTLINE));
  parent.add(m);
  return m;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _up = new THREE.Vector3(0, 1, 0);

function seg(parent, a, b, r0, r1, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.001, dir.length());
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 10), material);
  m.add(new THREE.Mesh(m.geometry, OUTLINE));
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

// Forearm from wrist to elbow: sleeve (or bare arm), cuff and accent band.
function forearm(parent, wrist, elbow, m) {
  const dir = new THREE.Vector3().subVectors(elbow, wrist);
  const len = dir.length();
  const g = new THREE.Group();
  g.position.copy(wrist);
  g.quaternion.setFromUnitVectors(_up, dir.normalize());
  parent.add(g);
  const wristBit = inked(g, new THREE.CapsuleGeometry(0.026, 0.02, 4, 10), m.skin);
  wristBit.position.y = 0.012;
  if (m.bare) {
    const arm = inked(g, new THREE.CylinderGeometry(0.046, 0.034, len, 14), m.skin);
    arm.position.y = len / 2;
    const band = inked(g, new THREE.CylinderGeometry(0.037, 0.037, 0.035, 14), m.cuff);
    band.position.y = 0.07;
    const tat = new THREE.Mesh(new THREE.BoxGeometry(0.012, len * 0.35, 0.012), m.accent);
    tat.position.set(0.0, len * 0.55, -0.044);
    tat.rotation.x = 0.1;
    g.add(tat);
  } else {
    const sleeve = inked(g, new THREE.CylinderGeometry(0.056, 0.042, len - 0.035, 14), m.sleeve);
    sleeve.position.y = 0.035 + (len - 0.035) / 2;
    const cuff = inked(g, new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14), m.cuff);
    cuff.position.y = 0.045;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.059, 0.059, 0.012, 14), m.accent);
    band.position.y = len * 0.55;
    g.add(band);
  }
  return g;
}

// A hand wrapped around a cylinder-ish handle.
//   c: handle centre, a: handle axis (unit), u: angle-0 direction, v: angle-90 direction
//   r: handle radius, palm: angle of the palm, f0/f1: finger wrap angles, rows: finger offsets along a
//   thumb: [angleFrom, angleTo, along] (thumb lies on the handle surface)
// Returns the wrist point (for the forearm).
function grasp(parent, m, o) {
  const at = (ang, h, rad) => o.c.clone()
    .addScaledVector(o.u, Math.cos(ang) * rad).addScaledVector(o.v, Math.sin(ang) * rad).addScaledVector(o.a, h);
  const fingerMat = m.fingerless ? m.skin : m.glove;
  const R = o.r + 0.013;
  // palm block sitting against the handle
  const radial = o.u.clone().multiplyScalar(Math.cos(o.palm)).addScaledVector(o.v, Math.sin(o.palm)).normalize();
  const tangent = new THREE.Vector3().crossVectors(o.a, radial).normalize();
  const pc = at(o.palm, o.palmAlong ?? 0, o.r + 0.024);
  const palm = inked(parent, new THREE.CapsuleGeometry(0.026, 0.045, 4, 10), m.glove);
  palm.position.copy(pc);
  palm.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, o.a, radial));
  palm.scale.set(1.1, 1, 0.5);
  // fingers: three segments following the handle's curve, knuckle balls at the joints
  o.rows.forEach((h, i) => {
    const span = o.f1 - o.f0 - i * 0.12;
    let prev = at(o.f0, h, R);
    const k0 = inked(parent, new THREE.SphereGeometry(0.0135, 10, 8), m.glove);
    k0.position.copy(prev);
    for (let k = 1; k <= 3; k++) {
      const p = at(o.f0 + span * k / 3, h, R - k * 0.0008);
      seg(parent, prev, p, 0.0118, 0.0118, k === 1 && !m.fingerless ? m.glove : fingerMat);
      const ball = inked(parent, new THREE.SphereGeometry(0.012, 8, 6), fingerMat);
      ball.position.copy(p);
      prev = p;
    }
  });
  if (o.thumb) {
    const [t0, t1, ta] = o.thumb;
    const p0 = at(t0, ta, o.r + 0.016), p1 = at((t0 + t1) / 2, ta + 0.012, o.r + 0.013), p2 = at(t1, ta + 0.022, o.r + 0.012);
    seg(parent, p0, p1, 0.014, 0.0135, fingerMat);
    seg(parent, p1, p2, 0.0135, 0.0125, fingerMat);
    const tip = inked(parent, new THREE.SphereGeometry(0.0125, 8, 6), fingerMat);
    tip.position.copy(p2);
  }
  if (o.index) {
    // trigger finger: straight along the frame to the trigger
    const [p0, p1, p2] = o.index;
    seg(parent, p0, p1, 0.012, 0.012, fingerMat);
    seg(parent, p1, p2, 0.0115, 0.0115, fingerMat);
    for (const p of [p1, p2]) { const b = inked(parent, new THREE.SphereGeometry(0.0118, 8, 6), fingerMat); b.position.copy(p); }
  }
  return pc.clone().addScaledVector(radial, 0.02).add(o.wrist || new THREE.Vector3());
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
    // open hand holding the ability orb
    const palm = inked(this.castArm, new THREE.CapsuleGeometry(0.03, 0.05, 4, 10), m.glove);
    palm.rotation.x = Math.PI / 2; palm.scale.set(1.15, 1, 0.55);
    for (let i = 0; i < 4; i++) seg(this.castArm, V((i - 1.5) * 0.02, 0.0, -0.035), V((i - 1.5) * 0.022, 0.03, -0.065), 0.011, 0.011, m.fingerless ? m.skin : m.glove);
    this.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.026, 1), this.orbMat);
    this.orb.position.set(0, 0.035, -0.05);
    this.castArm.add(this.orb);
  }

  // { weaponId: { skin, model } } — rebuilds weapon models on change
  setSkins(skins) {
    this.skins = skins;
    for (const id in this.models) this.holder.remove(this.models[id].group);
    this.models = {};
    const cur = this.current?.id;
    this.current = null;
    if (cur) this.setWeapon(cur, 0);
  }

  mats() {
    const a = this.agent || { skin: 0xc68642, outfit: 0x2a86f2, outfit2: 0x1a1d22, glove: 0x1a1d22, accent: 0x7ff6ff, style: '' };
    return {
      skin: toon(a.skin),
      sleeve: toon(a.outfit),
      cuff: toon(a.outfit2),
      glove: toon(a.glove),
      accent: glow(a.accent),
      bare: a.style === 'mohawk',
      fingerless: a.style === 'spiky' || a.style === 'mohawk',
    };
  }

  build(id) {
    const sk = this.skins?.[id] || {};
    const { group, muzzle, grip } = buildGun(id, sk.skin || 'factory', sk.model || 'combat');
    const m = this.mats();
    const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

    if (grip.type === 'knife') {
      // right hand around the horizontal handle, thumb along the top
      const wr = grasp(group, m, {
        c: V3(0, 0.033, 0.07), a: Z.clone().negate(), u: X.clone(), v: Y.clone().negate(), r: 0.019,
        palm: -0.6, f0: 0.15, f1: 3.6, rows: [0.03, 0.009, -0.012, -0.033], thumb: [-1.9, -1.2, 0.035],
        wrist: V3(0.02, -0.01, 0.06),
      });
      forearm(group, wr, V3(0.2, -0.34, 0.45), m);
      return { group, muzzle };
    }

    // right hand on the pistol grip: palm on the backstrap, fingers round the front, thumb on the left
    const gripAxis = V3(0, 1, -0.22).normalize();
    const gc = grip.type === 'pistol' ? V3(0, -0.07, 0.008) : V3(0, -0.085, 0.012);
    const fwd = V3(0, -0.22, -1).normalize();
    const wrR = grasp(group, m, {
      c: gc, a: gripAxis, u: X.clone(), v: fwd, r: 0.026,
      palm: -1.25, palmAlong: -0.005, f0: 0.25, f1: 3.3, rows: [0.0, -0.022, -0.044],
      thumb: [2.6, 1.9, 0.045], wrist: V3(0.02, -0.035, 0.05),
      index: grip.type === 'pistol'
        ? [V3(0.03, -0.032, 0.0), V3(0.024, -0.022, -0.03), V3(0.012, -0.018, -0.052)]
        : [V3(0.034, -0.045, 0.0), V3(0.028, -0.035, -0.035), V3(0.014, -0.03, -0.07)],
    });
    forearm(group, wrR, grip.type === 'pistol' ? V3(0.3, -0.42, 0.38) : V3(0.24, -0.38, 0.44), m);

    if (grip.type === 'pistol') {
      // support hand cups the shooting hand from the left
      const wrL = grasp(group, m, {
        c: V3(0, -0.085, 0.005), a: gripAxis, u: X.clone().negate(), v: fwd, r: 0.045,
        palm: -0.9, f0: 0.4, f1: 2.7, rows: [0.0, -0.022, -0.044], thumb: [1.3, 0.7, 0.07], wrist: V3(-0.02, -0.04, 0.05),
      });
      forearm(group, wrL, V3(-0.42, -0.44, 0.32), m);
    } else if (grip.vertical) {
      // support hand on a vertical foregrip
      const wrL = grasp(group, m, {
        c: V3(0, grip.foreY, grip.fore), a: Y.clone(), u: X.clone().negate(), v: Z.clone().negate(), r: 0.022,
        palm: -1.2, f0: 0.3, f1: 3.3, rows: [0.03, 0.008, -0.014, -0.036], thumb: [2.5, 1.9, 0.05], wrist: V3(-0.03, -0.03, 0.04),
      });
      forearm(group, wrL, V3(-0.5, -0.4, 0.12), m);
    } else {
      // support hand cupping the handguard from below-left, thumb along the left side
      const wrL = grasp(group, m, {
        c: V3(0, grip.foreY + 0.042, grip.fore), a: Z.clone().negate(), u: X.clone().negate(), v: Y.clone().negate(), r: 0.042,
        palm: 0.75, f0: 1.25, f1: 3.6, rows: [0.03, 0.009, -0.012, -0.033], thumb: [-0.25, -0.6, 0.02], wrist: V3(-0.02, -0.03, 0.045),
      });
      forearm(group, wrL, V3(-0.52, -0.38, grip.fore + 0.55), m);
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
    // per-weapon placement: long guns sit lower and further out so sights don't block the view
    // [x, y, z, yaw]: the gun runs from the lower right toward the centre so you see its side
    const OFF = {
      talon: [0.25, -0.25, -0.6, 0.12], lynx: [0.25, -0.26, -0.62, 0.11], wasp: [0.23, -0.23, -0.55, 0.12],
      pip: [0.19, -0.21, -0.52, 0.05], bolt: [0.19, -0.21, -0.52, 0.05], knife: [0.22, -0.25, -0.6, 0.18],
    }[id] || [0.21, -0.22, -0.58, 0.08];
    this.base.set(OFF[0], OFF[1], OFF[2]);
    this.baseYaw = OFF[3];
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
    // footstep-synced figure-8 bob, strafe roll, landing dip, idle breathing
    this.t = (this.t || 0) + dt;
    if (s.onGround && s.speed > 0.3) this.bob += dt * (s.speed / (s.walking ? 0.95 : 1.35)) * Math.PI;
    const moveAmt = s.onGround ? Math.min(s.speed / 5.4, 1) : 0;
    this.bobAmt = (this.bobAmt || 0) + (moveAmt - (this.bobAmt || 0)) * Math.min(1, dt * 8);
    const bx = Math.sin(this.bob) * 0.014 * this.bobAmt;
    const by = -Math.abs(Math.cos(this.bob)) * 0.016 * this.bobAmt + Math.sin(this.t * 1.8) * 0.0025 * (1 - this.bobAmt);
    if (this.wasAir && s.onGround) this.landT = 1;
    this.wasAir = !s.onGround;
    this.landT = Math.max(0, (this.landT || 0) - dt * 5);
    const land = Math.sin(this.landT * Math.PI) * 0.035;
    const airLift = s.onGround ? 0 : 0.015;
    this.roll = (this.roll || 0) + ((-(s.side || 0) / 5.4) * 0.07 - (this.roll || 0)) * Math.min(1, dt * 8);
    const sprint = !s.walking && s.speed > 4.5 && s.onGround ? 1 : 0;
    this.sprint = (this.sprint || 0) + (sprint - (this.sprint || 0)) * Math.min(1, dt * 6);
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
      this.base.x + bx + this.swayX - swingRot * 0.1 + this.sprint * 0.015,
      this.base.y + by + this.swayY - drop - s.crouch * 0.01 - land + airLift - this.sprint * 0.025,
      this.base.z + this.kickZ + this.sprint * 0.02,
    );
    g.rotation.set(
      this.kickRot - tilt - this.sprint * 0.08 + Math.cos(this.bob * 2) * 0.01 * this.bobAmt,
      (this.baseYaw || 0) + swingRot * 0.8 + this.sprint * 0.12,
      swingRot * 0.6 + this.roll + Math.sin(this.bob) * 0.02 * this.bobAmt,
    );
  }
}

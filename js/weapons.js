// Weapon definitions. Angles are in radians; damage is per bullet.
// spread: base cone half-angle when standing still
// moveSpread: extra spread at full run speed, airSpread: extra while airborne
// bloom: extra spread added per consecutive shot (spray)
// vKick / hKick / vCap: recoil pattern (see recoilOffset)

export const WEAPONS = {
  knife: {
    id: 'knife', name: 'Knife', slot: 'melee', price: 0, melee: true,
    dmg: { head: 75, body: 50, leg: 50 }, rpm: 110, auto: true, range: 2.4,
    speedMul: 1.12, equip: 0.25, sound: 'knife', kind: 'knife',
  },
  pip: {
    id: 'pip', name: 'Pip-9', slot: 'secondary', price: 0, kind: 'pistol',
    dmg: { head: 78, body: 26, leg: 22 }, falloff: [30, 0.85],
    rpm: 400, auto: false, mag: 12, reserve: 36, reload: 1.6,
    spread: 0.004, moveSpread: 0.035, airSpread: 0.12, bloom: 0.004,
    vKick: 0.007, hKick: 0.003, vCap: 4, speedMul: 1.0, equip: 0.45, sound: 'pistol',
  },
  bolt: {
    id: 'bolt', name: 'Bolt .50', slot: 'secondary', price: 800, kind: 'pistol',
    dmg: { head: 150, body: 55, leg: 46 }, falloff: [30, 0.85],
    rpm: 150, auto: false, mag: 6, reserve: 24, reload: 2.2,
    spread: 0.004, moveSpread: 0.06, airSpread: 0.15, bloom: 0.01,
    vKick: 0.022, hKick: 0.006, vCap: 2, speedMul: 1.0, equip: 0.55, sound: 'heavy',
  },
  wasp: {
    id: 'wasp', name: 'Wasp SMG', slot: 'primary', price: 1600, kind: 'smg',
    dmg: { head: 66, body: 27, leg: 22 }, falloff: [20, 0.8],
    rpm: 800, auto: true, mag: 30, reserve: 90, reload: 2.25,
    spread: 0.008, moveSpread: 0.012, airSpread: 0.1, bloom: 0.0022,
    vKick: 0.0045, hKick: 0.0045, vCap: 7, speedMul: 1.0, equip: 0.6, sound: 'smg',
  },
  talon: {
    id: 'talon', name: 'Talon Rifle', slot: 'primary', price: 2900, kind: 'rifle',
    dmg: { head: 160, body: 40, leg: 34 },
    rpm: 585, auto: true, mag: 25, reserve: 75, reload: 2.5,
    spread: 0.0025, moveSpread: 0.06, airSpread: 0.15, bloom: 0.003,
    vKick: 0.009, hKick: 0.006, vCap: 8, speedMul: 0.93, equip: 0.9, sound: 'rifle',
  },
  lynx: {
    id: 'lynx', name: 'Lynx Sniper', slot: 'primary', price: 4500, kind: 'sniper',
    dmg: { head: 255, body: 150, leg: 120 },
    rpm: 42, auto: false, mag: 5, reserve: 15, reload: 3.0,
    spread: 0.07, scopedSpread: 0.0004, moveSpread: 0.12, airSpread: 0.25, bloom: 0,
    vKick: 0.03, hKick: 0.004, vCap: 1, scope: true, zoomFov: 22,
    speedMul: 0.88, equip: 1.1, sound: 'sniper',
  },
};

export const ARMOR = {
  light: { id: 'light', name: 'Light Shield', price: 400, value: 25 },
  heavy: { id: 'heavy', name: 'Heavy Shield', price: 1000, value: 50 },
};

export const BUY_LIST = ['bolt', 'wasp', 'talon', 'lynx'];

// Spray pattern: climbs straight up for vCap shots, then slowly rises while
// swaying left and right.
export function recoilOffset(def, idx) {
  const cap = def.vCap;
  const pitch = def.vKick * Math.min(idx, cap) + def.vKick * 0.25 * Math.max(0, idx - cap);
  const over = idx - cap;
  const yaw = over > 0 ? Math.sin(over * 0.55) * def.hKick * Math.min(over, 4) : 0;
  return { pitch, yaw };
}

export function makeWeaponState(id) {
  const def = WEAPONS[id];
  return {
    def,
    mag: def.mag || 0,
    reserve: def.reserve || 0,
    cool: 0,
    reloadT: 0,
    spray: 0,
    sinceShot: 9,
  };
}

// Weapon / knife skins, rarities and the player's locker profile (saved in localStorage).
import { markDirty } from './account.js?v=20261031180755';

export const RARITY = {
  common: { name: 'Common', color: '#a8b2bd', weight: 58 },
  rare: { name: 'Rare', color: '#4f9aff', weight: 28 },
  epic: { name: 'Epic', color: '#c06bff', weight: 11 },
  legendary: { name: 'Legendary', color: '#ffb23f', weight: 3 },
};

// body/dark/steel/accent/glow colours; pattern drawn on body (and dark when patternOn = 'both')
export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

export const SKINS = {
  factory: { name: 'Factory', rarity: 'common' },
  urban: { name: 'Urban Camo', rarity: 'common', body: 0x6a7078, dark: 0x3a3f46, pattern: 'camo', colors: ['#6a7078', '#4a5058', '#8c939b', '#2e3238'], patternOn: 'both', accent: 0xd0d4da, glow: 0xffffff },
  dune: { name: 'Dune', rarity: 'common', body: 0xc8aa7a, dark: 0x6a5238, pattern: 'camo', colors: ['#c8aa7a', '#a8885a', '#e2cc9a', '#7a6040'], patternOn: 'both', accent: 0x7a5a3a, glow: 0xffd27a },
  woodland: { name: 'Woodland', rarity: 'common', body: 0x4a5a3a, dark: 0x2a3322, pattern: 'camo', colors: ['#4a5a3a', '#2f3a26', '#6a7a4a', '#5a4a32'], patternOn: 'both', accent: 0xa8c070, glow: 0xc6ff4a },
  slate: { name: 'Slate', rarity: 'common', body: 0x4a5a6e, dark: 0x22282f, accent: 0xe8edf2, glow: 0xbfe6ff, shiny: 40 },
  crimson: { name: 'Crimson Line', rarity: 'rare', body: 0x1e1f24, dark: 0x111216, pattern: 'stripes', colors: ['#1e1f24', '#c0182e'], accent: 0xe0243a, glow: 0xff3048 },
  arctic: { name: 'Arctic', rarity: 'rare', body: 0xe8eef4, dark: 0x9fb4c8, pattern: 'camo', colors: ['#eef3f8', '#c8d8e8', '#9fb8d0', '#ffffff'], patternOn: 'both', accent: 0x4fb8ff, glow: 0x9fe0ff },
  carbon: { name: 'Carbon', rarity: 'rare', body: 0x24262b, dark: 0x16171a, pattern: 'carbon', colors: ['#2a2c31', '#17181b'], patternOn: 'both', accent: 0x2ee6d6, glow: 0x2ee6d6, shiny: 120 },
  hex: { name: 'Hex Tech', rarity: 'rare', body: 0x3a2f5a, dark: 0x1c1830, pattern: 'hex', colors: ['#3a2f5a', '#7a5cff'], accent: 0x9a7bff, glow: 0xb89cff },
  tiger: { name: 'Tiger', rarity: 'epic', body: 0xe8822a, dark: 0x1c1a18, pattern: 'tiger', colors: ['#f08c2a', '#1a1612'], accent: 0x1a1612, glow: 0xffb347 },
  neon: { name: 'Neon Grid', rarity: 'epic', body: 0x101018, dark: 0x0a0a10, pattern: 'grid', colors: ['#101018', '#ff3fd2'], accent: 0x3ff3ff, glow: 0xff3fd2, emissive: 0.6 },
  sakura: { name: 'Sakura', rarity: 'epic', body: 0xf6c6d6, dark: 0xfff0f4, pattern: 'sakura', colors: ['#f6c6d6', '#ff6fa0', '#ffffff'], accent: 0xff6fa0, glow: 0xff9ac0 },
  toxic: { name: 'Toxic', rarity: 'epic', body: 0x1e2a18, dark: 0x111810, pattern: 'drip', colors: ['#1e2a18', '#7aff3a'], accent: 0x7aff3a, glow: 0x9aff4a, emissive: 0.35 },
  gold: { name: 'Gold Plated', rarity: 'legendary', body: 0xd8a83a, dark: 0x2a2218, steel: 0xffe08a, pattern: 'brushed', colors: ['#e0b048', '#b88a28'], accent: 0x111111, glow: 0xfff2a0, shiny: 160, spec: 0xfff0b0 },
  galaxy: { name: 'Galaxy', rarity: 'legendary', body: 0x2a1850, dark: 0x0e0a20, pattern: 'galaxy', colors: ['#1a1040', '#6a2aa0', '#2a6ad8'], patternOn: 'both', accent: 0xc0a0ff, glow: 0xc0a0ff, emissive: 0.5 },
  dragon: { name: 'Dragon', rarity: 'legendary', body: 0x8a1810, dark: 0x1a0a08, pattern: 'scales', colors: ['#9a1c12', '#ffb020'], accent: 0xffb020, glow: 0xff7a20, shiny: 110 },
};

export const KNIFE_MODELS = { combat: 'Combat Knife', karambit: 'Karambit' };

export const LOCKER_WEAPONS = ['knife', 'pip', 'bolt', 'hornet', 'wasp', 'thunder', 'raptor', 'talon', 'bastion', 'needle', 'arbiter', 'lynx'];

export const ROLL_COST = 100;
export const KNIFE_CHANCE = 0.04;   // knives are special drops
export const DUPLICATE_REFUND = 30;

// item key: "weapon|skin" or "knife|skin|model"
export const itemKey = (weapon, skin, model) => (weapon === 'knife' ? `knife|${skin}|${model || 'combat'}` : `${weapon}|${skin}`);
export function parseKey(key) {
  const [weapon, skin, model] = key.split('|');
  return { weapon, skin, model: model || (weapon === 'knife' ? 'combat' : undefined) };
}

const STORE = 'cbs-profile';
export function loadProfile() {
  let p;
  try { p = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { p = null; }
  if (!p) p = { coins: 500, owned: [], equipped: {} };
  if (!Number.isFinite(p.coins)) p.coins = 500;
  p.rr = Number.isFinite(p.rr) ? p.rr : 0;
  p.ranked = p.ranked || { played: 0, wins: 0, peak: 0 };
  p.owned = p.owned || [];
  p.equipped = p.equipped || {};
  return p;
}
export function saveProfile(p) { localStorage.setItem(STORE, JSON.stringify(p)); markDirty(); }

// The skin equipped for a weapon (falls back to factory).
export function equippedFor(profile, weapon) {
  const key = profile.equipped[weapon];
  return key ? parseKey(key) : { weapon, skin: 'factory', model: weapon === 'knife' ? 'combat' : undefined };
}

function pickRarity(rng = Math.random) {
  const total = Object.values(RARITY).reduce((a, r) => a + r.weight, 0);
  let x = rng() * total;
  for (const [k, r] of Object.entries(RARITY)) { x -= r.weight; if (x <= 0) return k; }
  return 'common';
}

// A random item: weighted rarity, then a random skin of that rarity on a random weapon.
export function randomItem(rng = Math.random) {
  const rarity = pickRarity(rng);
  const skins = Object.entries(SKINS).filter(([id, s]) => s.rarity === rarity && id !== 'factory').map(([id]) => id);
  const skin = skins[Math.floor(rng() * skins.length)];
  const guns = LOCKER_WEAPONS.filter((w) => w !== 'knife');
  const weapon = rng() < KNIFE_CHANCE ? 'knife' : guns[Math.floor(rng() * guns.length)];
  const model = weapon === 'knife' ? (rng() < 0.45 ? 'karambit' : 'combat') : undefined;
  return { weapon, skin, model, rarity, key: itemKey(weapon, skin, model) };
}

// Random cosmetic loadout for bots so the server feels alive.
export function randomBotSkin(weapon) {
  if (weapon === 'knife') return Math.random() < 0.9 ? { skin: 'factory', model: 'combat' } : { skin: randomItem().skin, model: Math.random() < 0.5 ? 'karambit' : 'combat' };
  if (Math.random() < 0.45) return { skin: 'factory' };
  const it = randomItem();
  return { skin: it.skin, model: weapon === 'knife' ? it.model : undefined };
}

// Agents, their ability kits, and ability descriptions.
// Each agent has Q / E / F abilities plus an ultimate on X.
// E is the signature ability: its charges refill for free every round.
// Q and F charges are bought in the buy menu. Ultimates charge from kills, deaths, plants and defuses.

export const ABILITY_INFO = {
  smoke: { name: 'Smoke', desc: 'Throws a smoke cloud where you aim (up to 45m). Blocks vision for 14s.' },
  flash: { name: 'Flashbang', desc: 'Lobs a flash that pops after 0.7s and blinds anyone looking at it.' },
  molly: { name: 'Incendiary', desc: 'Lobs a fire grenade. The flames burn enemies standing in them for 7s.' },
  recon: { name: 'Recon Dart', desc: 'Fires a dart that sticks to surfaces and pulses twice, revealing enemies it can see.' },
  dash: { name: 'Dash', desc: 'Instantly dash a few meters in the direction you are moving.' },
  heal: { name: 'Mend', desc: 'Heals you (or the teammate in your crosshair) for 60 HP over 4s.' },
  wall: { name: 'Barrier', desc: 'Raises a wall where you aim. Blocks bullets and movement for 25s or until destroyed.' },
  smokeline: { name: 'Nightfall', desc: 'ULTIMATE · Drops a line of four smokes along your aim.' },
  teamheal: { name: 'Lifeline', desc: 'ULTIMATE · Revives every fallen teammate where they fell, then fully heals the team and gives everyone 50 shield.' },
  reveal: { name: 'Overwatch', desc: 'ULTIMATE · Reveals every enemy on the map three times over 6s.' },
  inferno: { name: 'Inferno', desc: 'ULTIMATE · Calls down a huge firestorm where you aim.' },
  overdrive: { name: 'Overdrive', desc: 'ULTIMATE · For 10s: faster movement and fire rate, perfect accuracy while moving, kills heal you.' },
  blackout: { name: 'Blackout', desc: 'ULTIMATE · Blinds every enemy within 40m who can see you.' },
};

// Small SVG icons (24x24) for the HUD and agent select.
export const ICONS = {
  smoke: '<circle cx="8" cy="14" r="5"/><circle cx="15" cy="11" r="6"/><circle cx="17" cy="16" r="4"/>',
  flash: '<path d="M12 2l2.5 7H22l-6 4.5 2.3 7.5L12 16.5 5.7 21 8 13.5 2 9h7.5z"/>',
  molly: '<path d="M12 2c3 5 7 7 7 13a7 7 0 0 1-14 0c0-3 2-5 3-6 0 3 2 4 3 4-1-4 1-8 1-11z"/>',
  recon: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" fill="none" stroke-width="2"/><circle cx="12" cy="12" r="10.5" fill="none" stroke-width="1.5"/>',
  dash: '<path d="M3 7h9M2 12h10M3 17h9" stroke-width="2.4" fill="none"/><path d="M13 4l9 8-9 8z"/>',
  heal: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  wall: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 12h20M8 5v7M16 12v7" stroke="#000" stroke-opacity=".35" stroke-width="1.5"/>',
  smokeline: '<circle cx="4" cy="14" r="3"/><circle cx="10" cy="11" r="3.5"/><circle cx="16" cy="13" r="3.5"/><circle cx="21" cy="10" r="2.5"/>',
  teamheal: '<path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-3 4.5 4.5 0 0 1 8 3c0 6-8 11-8 11z"/>',
  reveal: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3.5" fill="#000" fill-opacity=".45"/>',
  inferno: '<path d="M12 1c4 6 9 8 9 15a9 9 0 0 1-18 0c0-4 3-7 4-8 0 4 2 5 3 5-1-5 2-9 2-12z"/>',
  overdrive: '<path d="M13 1L4 14h7l-2 9 10-14h-7z"/>',
  blackout: '<circle cx="12" cy="12" r="5"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4 4l3 3M17 17l3 3M20 4l-3 3M7 17l-3 3" stroke-width="2"/>',
};

export function iconSvg(type, color = 'currentColor') {
  return `<svg viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-linecap="round">${ICONS[type] || ''}</svg>`;
}

export const AGENTS = [
  {
    id: 'haze', name: 'Haze', role: 'Controller',
    bio: 'Shapes the battlefield with smoke and fire.',
    suit: 0x3d3560, suit2: 0x1b1828, accent: 0xb88cff, look: 'hood',
    skin: 0x8d5a3b, hair: 0x1c1626, outfit: 0x4a3a78, outfit2: 0x241c38, pants: 0x2a2433, shoes: 0x1a1a1f, glove: 0x2a2433, mood: 'calm', style: 'hood',
    kit: {
      q: { type: 'molly', price: 200, max: 1 },
      e: { type: 'smoke', free: 2, max: 2 },
      f: { type: 'wall', price: 300, max: 1 },
      x: { type: 'smokeline', cost: 6 },
    },
  },
  {
    id: 'vesper', name: 'Vesper', role: 'Sentinel',
    bio: 'Keeps the team alive and locks down lanes.',
    suit: 0xe6e3da, suit2: 0x4f5864, accent: 0x5dffb0, look: 'halo',
    skin: 0xf2cdb4, hair: 0xc9a2dc, outfit: 0xf2f2ee, outfit2: 0x5dd6a0, pants: 0x3a6a72, shoes: 0xe8e8e8, glove: 0xf2f2ee, mood: 'kind', style: 'medic',
    kit: {
      q: { type: 'wall', price: 300, max: 1 },
      e: { type: 'heal', free: 1, max: 1 },
      f: { type: 'recon', price: 250, max: 1 },
      x: { type: 'teamheal', cost: 6 },
    },
  },
  {
    id: 'flare', name: 'Flare', role: 'Initiator',
    bio: 'Blinds and scouts to break open a site.',
    suit: 0xf0b030, suit2: 0x3a2e1a, accent: 0xfff27a, look: 'antenna',
    skin: 0xc68642, hair: 0xe0702a, outfit: 0xf2b630, outfit2: 0xfff2d8, pants: 0x6a5238, shoes: 0x3a2a1a, glove: 0x6a5238, mood: 'happy', style: 'afro',
    kit: {
      q: { type: 'flash', price: 200, max: 2 },
      e: { type: 'recon', free: 1, max: 1 },
      f: { type: 'smoke', price: 150, max: 1 },
      x: { type: 'reveal', cost: 7 },
    },
  },
  {
    id: 'ember', name: 'Ember', role: 'Duelist',
    bio: 'Dashes in and burns enemies out of cover.',
    suit: 0xc23c2a, suit2: 0x2a1412, accent: 0xff9a3c, look: 'spikes',
    skin: 0xf5c6a5, hair: 0xd8361e, outfit: 0xb8281e, outfit2: 0x1f1a1a, pants: 0x22222a, shoes: 0x111114, glove: 0x1f1a1a, mood: 'angry', style: 'spiky',
    kit: {
      q: { type: 'molly', price: 200, max: 1 },
      e: { type: 'dash', free: 1, max: 1 },
      f: { type: 'flash', price: 200, max: 1 },
      x: { type: 'inferno', cost: 7 },
    },
  },
  {
    id: 'jolt', name: 'Jolt', role: 'Duelist',
    bio: 'Hyper-fast fighter who heals up between fights.',
    suit: 0x2a86f2, suit2: 0x101e36, accent: 0x7ff6ff, look: 'fin',
    skin: 0x5a3825, hair: 0x2aa8ff, outfit: 0x1f6fe0, outfit2: 0x101828, pants: 0x1e2230, shoes: 0xf2f2f2, glove: 0x101828, mood: 'grin', style: 'mohawk',
    kit: {
      q: { type: 'flash', price: 200, max: 2 },
      e: { type: 'dash', free: 2, max: 2 },
      f: { type: 'heal', price: 250, max: 1 },
      x: { type: 'overdrive', cost: 6 },
    },
  },
  {
    id: 'rook', name: 'Rook', role: 'Initiator',
    bio: 'Armored breacher who floods sites with flashes.',
    suit: 0x5a6848, suit2: 0x20261a, accent: 0xc6ff4a, look: 'bulky',
    skin: 0xa47148, hair: 0x4a2e1a, outfit: 0x56653f, outfit2: 0x2c3322, pants: 0x3f4632, shoes: 0x2a2018, glove: 0x2c3322, mood: 'stern', style: 'beard',
    kit: {
      q: { type: 'smoke', price: 150, max: 1 },
      e: { type: 'flash', free: 2, max: 2 },
      f: { type: 'molly', price: 200, max: 1 },
      x: { type: 'blackout', cost: 7 },
    },
  },
];

export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

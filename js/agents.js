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
  teamheal: { name: 'Lifeline', desc: 'ULTIMATE · Fully heals every living teammate and gives them 50 shield.' },
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
    kit: {
      q: { type: 'smoke', price: 150, max: 1 },
      e: { type: 'flash', free: 2, max: 2 },
      f: { type: 'molly', price: 200, max: 1 },
      x: { type: 'blackout', cost: 7 },
    },
  },
];

export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

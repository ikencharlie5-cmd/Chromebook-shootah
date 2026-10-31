// Ranked: tiers, rating (RR) changes, and bot skill that scales with your rank.

export const TIERS = [
  { name: 'Rookie', color: '#9aa4ae' },
  { name: 'Bronze', color: '#c47a3a' },
  { name: 'Silver', color: '#c8d2dc' },
  { name: 'Gold', color: '#ffc83a' },
  { name: 'Platinum', color: '#4fd8c8' },
  { name: 'Diamond', color: '#8ab4ff' },
  { name: 'Master', color: '#c06bff' },
  { name: 'Legend', color: '#ff4f6a' },
];
const DIV = ['I', 'II', 'III'];
export const PER_DIV = 100;
const LEGEND_AT = (TIERS.length - 1) * 3 * PER_DIV;

export function rankOf(rr) {
  rr = Math.max(0, Math.floor(rr || 0));
  if (rr >= LEGEND_AT) return { tier: TIERS.length - 1, div: 0, name: 'Legend', short: 'LEGEND', color: TIERS.at(-1).color, progress: 1, inDiv: rr - LEGEND_AT, legend: true };
  const step = Math.floor(rr / PER_DIV);
  const tier = Math.floor(step / 3), div = step % 3;
  return {
    tier, div, name: `${TIERS[tier].name} ${DIV[div]}`, short: `${TIERS[tier].name.toUpperCase()} ${DIV[div]}`,
    color: TIERS[tier].color, progress: (rr % PER_DIV) / PER_DIV, inDiv: rr % PER_DIV, legend: false,
  };
}

// Small badge markup (a gem in the tier colour with pips for the division).
export function badgeHtml(rr, big = false) {
  const r = rankOf(rr);
  const pips = r.legend ? '★' : '▮'.repeat(r.div + 1);
  return `<span class="rank-badge ${big ? 'big' : ''}" style="--rk:${r.color}"><i class="gem"></i><b>${r.short}</b><em>${pips}</em></span>`;
}

// RR change after a ranked match.
export function rrDelta(won, myScore, theirScore, kills, deaths) {
  const diff = Math.abs(myScore - theirScore);
  const perf = Math.max(-4, Math.min(6, (kills - deaths) * 0.8));
  if (won) return Math.round(Math.max(10, Math.min(32, 16 + diff * 1.3 + perf)));
  return -Math.round(Math.max(8, Math.min(28, 22 - (7 - diff) * 0.9 - perf)));
}

// Bot skill for a rating: Rookie bots are slow and sloppy, Legend bots snap to heads.
export function skillForRR(rr) {
  const t = Math.max(0, Math.min(1, (rr || 0) / LEGEND_AT));
  const L = (a, b) => a + (b - a) * t;
  return {
    react: [L(0.55, 0.15), L(0.9, 0.27)], aimErr: L(0.14, 0.045), errDecay: L(2, 6.5), turn: L(4, 11.5),
    headChance: L(0.08, 0.6), fov: L(0.9, 1.15), comp: L(0.25, 0.85),
  };
}

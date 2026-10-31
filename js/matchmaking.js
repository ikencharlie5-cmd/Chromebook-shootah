// Public matchmaking on Firestore: open parties are listed in lobbies/{partyCode} so strangers can
// find and join them. The match itself still runs peer-to-peer (net.js). Firestore REST, no SDK.
import { FIREBASE_CONFIG } from './firebase-config.js?v=20261031180755';
import { accountAuth } from './account.js?v=20261031180755';

const ANON = 'cbs-anon';              // guest (anonymous) Firebase session: { uid, refresh }
const FRESH_MS = 25000;               // lobbies not refreshed for this long are dead
const BEAT_MS = 8000;                 // how often an open lobby re-advertises itself

const base = () => `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const docName = (code) => `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/lobbies/${code}`;
export const matchmakingEnabled = () => !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);

let anon = null;
try { anon = JSON.parse(localStorage.getItem(ANON) || 'null'); } catch { anon = null; }
let anonTok = null, anonExp = 0;

const ERR = {
  ADMIN_ONLY_OPERATION: 'Guest matchmaking is not switched on yet (enable Anonymous sign-in in Firebase).',
  OPERATION_NOT_ALLOWED: 'Guest matchmaking is not switched on yet (enable Anonymous sign-in in Firebase).',
  PERMISSION_DENIED: 'The matchmaking server refused (check the Firestore rules).',
};
async function call(url, opts = {}) {
  let res;
  try { res = await fetch(url, opts); } catch { throw new Error('No connection to the matchmaking server.'); }
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = d.error?.status === 'PERMISSION_DENIED' ? 'PERMISSION_DENIED' : String(d.error?.message || d.error?.status || res.status).split(' ')[0];
    throw new Error(ERR[code] || `Matchmaking error (${code})`);
  }
  return d;
}

// Signed-in players use their account; guests get an anonymous Firebase login.
async function auth() {
  const a = await accountAuth().catch(() => null);
  if (a) return a;
  if (anon && anonTok && Date.now() < anonExp - 60000) return { token: anonTok, uid: anon.uid };
  const key = FIREBASE_CONFIG.apiKey;
  if (anon) {
    try {
      const d = await call(`https://securetoken.googleapis.com/v1/token?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: anon.refresh }).toString(),
      });
      anon = { uid: d.user_id, refresh: d.refresh_token };
      anonTok = d.id_token; anonExp = Date.now() + Number(d.expires_in || 3600) * 1000;
      localStorage.setItem(ANON, JSON.stringify(anon));
      return { token: anonTok, uid: anon.uid };
    } catch { anon = null; }
  }
  const d = await call(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  anon = { uid: d.localId, refresh: d.refreshToken };
  anonTok = d.idToken; anonExp = Date.now() + Number(d.expiresIn || 3600) * 1000;
  localStorage.setItem(ANON, JSON.stringify(anon));
  return { token: anonTok, uid: anon.uid };
}

// ---- lobby documents ---------------------------------------------------------------

const str = (v) => ({ stringValue: String(v) });
const int = (v) => ({ integerValue: String(Math.round(v)) });

async function publish(lobby) {
  const a = await auth();
  await call(`${base()}:commit`, {
    method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [{
      update: { name: docName(lobby.code), fields: {
        code: str(lobby.code), host: str(lobby.host.slice(0, 16)), owner: str(a.uid), mode: str(lobby.mode),
        queue: str(lobby.queue), count: int(lobby.count), max: int(lobby.max), rr: int(lobby.rr || 0),
      } },
      updateTransforms: [{ fieldPath: 'updated', setToServerValue: 'REQUEST_TIME' }],
    }] }),
  });
}

async function remove(code, keepalive = false) {
  const a = keepalive ? (anonTok && anon ? { token: anonTok } : await accountAuth().catch(() => null)) : await auth();
  if (!a) return;
  await fetch(`${base()}/lobbies/${code}`, { method: 'DELETE', keepalive, headers: { Authorization: `Bearer ${a.token}` } }).catch(() => {});
}

// Open lobbies, freshest first. Freshness uses the server's clock (readTime), not the player's.
export async function listLobbies() {
  const rows = await call(`${base()}:runQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'lobbies' }],
      orderBy: [{ field: { fieldPath: 'updated' }, direction: 'DESCENDING' }],
      limit: 40,
    } }),
  });
  const out = [];
  for (const r of rows) {
    const f = r.document?.fields;
    if (!f) continue;
    const age = Date.parse(r.readTime) - Date.parse(f.updated?.timestampValue || 0);
    const l = {
      code: f.code?.stringValue, host: f.host?.stringValue || '?', mode: f.mode?.stringValue, queue: f.queue?.stringValue,
      count: Number(f.count?.integerValue || 0), max: Number(f.max?.integerValue || 6), rr: Number(f.rr?.integerValue || 0),
    };
    if (age < FRESH_MS && l.code && l.count < l.max) out.push(l);
  }
  return out;
}

// ---- matchmaker -------------------------------------------------------------------------

// Keeps the player's public party advertised, finds matches and merges duplicate searches.
// hooks: { info() -> { queue, rr, inMatch }, status(text, err), joinCode(code) -> Promise, startMatch(), changed() }
export class Matchmaker {
  constructor(party, hooks) {
    this.party = party;
    this.hooks = hooks;
    this.public = false;      // host: party is listed for strangers
    this.searching = false;   // started from FIND MATCH (auto-starts when players arrive)
    this.listed = null;       // code currently advertised
    this.countdown = 0;       // seconds until the auto-start
    this.timer = setInterval(() => this.tick(1), 1000);
    this.beat = 0;
    window.addEventListener('pagehide', () => { if (this.listed) remove(this.listed, true); });
  }

  // FIND MATCH: join the best open public match for this queue, or open one and wait.
  async find() {
    const { queue, rr } = this.hooks.info();
    this.searching = true;
    this.finding = true;
    try { await this.findInner(queue, rr); } finally { this.finding = false; }
  }

  async findInner(queue, rr) {
    this.hooks.status('Searching for a match…');
    this.hooks.changed();
    let lobbies = [];
    try { lobbies = await listLobbies(); } catch (e) { this.stop(); this.hooks.status(e.message, true); return; }
    if (!this.searching) return;
    const fits = lobbies.filter((l) => l.mode === 'pvp' && l.queue === queue && l.code !== this.party.code)
      .sort((a, b) => b.count - a.count || Math.abs(a.rr - rr) - Math.abs(b.rr - rr));
    for (const l of fits) {
      try {
        await this.hooks.joinCode(l.code);
        this.hooks.status(`Found a match! Joined ${l.host}'s lobby. It starts when enough players are in`);
        this.searching = false;
        this.hooks.changed();
        return;
      } catch { /* stale or full: try the next one */ }
      if (!this.searching) return;
    }
    // nobody waiting: open our own public lobby
    try {
      if (!this.party.isHost) await this.hooks.hostParty();
      this.party.setMode('pvp');
      this.public = true;
      await this.advertise(true);
      this.hooks.status('Waiting for players to join… (bots fill empty spots)');
    } catch (e) { this.stop(); this.hooks.status(e.message, true); }
    this.hooks.changed();
  }

  // Host toggles "anyone can join" on a normal party.
  async setPublic(on) {
    if (!this.party.isHost) return;
    this.public = on;
    if (on) { try { await this.advertise(true); } catch (e) { this.public = false; this.hooks.status(e.message, true); } }
    else await this.unlist();
    this.hooks.changed();
  }

  stop() {
    this.searching = false; this.public = false; this.countdown = 0; this.startAt = 0;
    this.unlist();
    this.hooks.changed();
  }

  async unlist() {
    const code = this.listed;
    this.listed = null;
    if (code) await remove(code);
  }

  async advertise(force = false) {
    const p = this.party, info = this.hooks.info();
    const should = this.public && p.isHost && !info.inMatch && p.members.length < 6;
    if (!should) { if (this.listed) await this.unlist(); return; }
    if (!force && Date.now() - this.beat < BEAT_MS) return;
    this.beat = Date.now();
    const rrs = p.members.map((m) => m.rr || 0);
    await publish({
      code: p.code, host: p.members[0]?.name || 'Player', mode: p.mode, queue: info.queue,
      count: p.members.length, max: p.mode === 'coop' ? 3 : 6, rr: rrs.reduce((a, b) => a + b, 0) / rrs.length,
    });
    this.listed = p.code;
  }

  async tick() {
    if (this.ticking) return;   // network calls can outlast the 1s interval
    this.ticking = true;
    try { await this.step(); } finally { this.ticking = false; }
  }

  async step() {
    const p = this.party;
    this.ticks = (this.ticks || 0) + 1;
    if (this.finding) return;
    if (!p.active) { if (this.listed || this.public || this.searching) this.stop(); return; }
    if (!p.isHost) return;
    if (this.listed && this.listed !== p.code) await this.unlist();
    try { await this.advertise(); } catch { /* retry next beat */ }
    if (!this.searching || this.hooks.info().inMatch) { this.countdown = 0; this.startAt = 0; return; }
    const n = p.members.length;
    // merge duplicate searches: if we are alone and an older-coded lobby is waiting, go join it
    if (n === 1 && this.ticks % 4 === 0) {
      const others = await listLobbies().catch(() => []);
      const q = this.hooks.info().queue;
      const other = others.find((l) => l.mode === 'pvp' && l.queue === q && l.code < p.code);
      if (other && this.searching && p.members.length === 1) {
        await this.unlist();
        this.public = false;
        try { await this.hooks.joinCode(other.code); this.searching = false; this.hooks.status(`Found a match! Joined ${other.host}'s lobby`); }
        catch { this.hooks.changed(); this.find(); return; }   // joining tore down our party: search again
        this.hooks.changed();
        return;
      }
    }
    // auto-start once someone joins (fills to 3v3 with bots)
    if (n >= 2) {
      const wait = n >= 6 ? 3000 : 25000;
      if (!this.startAt) this.startAt = Date.now() + wait;
      this.startAt = Math.min(this.startAt, Date.now() + wait);
      this.countdown = Math.max(0, Math.ceil((this.startAt - Date.now()) / 1000));
      this.hooks.status(`Match starts in ${this.countdown}s · ${n}/6 players · bots fill the rest`);
      if (this.countdown <= 0) {
        this.startAt = 0;
        await this.unlist();
        this.searching = false;   // the party stays public; the host starts later matches with PLAY
        this.hooks.startMatch();
      }
    } else if (this.startAt) {
      this.startAt = 0; this.countdown = 0;
      this.hooks.status('Waiting for players to join… (bots fill empty spots)');
    }
  }
}

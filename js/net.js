// Peer-to-peer party + match transport using PeerJS (loaded globally from lib/peerjs.min.js).
// One player hosts (their browser runs the match); friends join with a 5-letter party code.
// Signalling goes through the free PeerJS cloud server; game traffic is direct WebRTC.

const PREFIX = 'cbshootah-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_PARTY = 6;

function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

// Optional ?peerhost=host:port for a self-hosted PeerJS server (used for local testing).
function peerOptions() {
  const q = new URLSearchParams(location.search).get('peerhost');
  const opts = { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } };
  if (q) {
    const [host, port] = q.split(':');
    Object.assign(opts, { host, port: Number(port || 9000), path: '/', secure: location.protocol === 'https:' && host !== 'localhost', key: 'peerjs' });
    if (/^(localhost|127\.)/.test(host)) opts.config = { iceServers: [] };   // LAN / local testing
  }
  return opts;
}

export class Party {
  constructor() {
    this.peer = null;
    this.role = null;        // 'host' | 'client' | null
    this.code = null;
    this.conns = new Map();  // host: peerId -> conn ; client: 'host' -> conn
    this.members = [];       // [{ id, name, agent, held, team, host }]
    this.mode = 'coop';      // 'coop' (party vs bots) | 'pvp' (friends vs friends)
    this.myId = null;
    this.handlers = {};      // type -> fn(msg, fromId)
    this.onChange = null;    // party roster / mode changed
    this.onStatus = null;    // (text, isError)
  }

  get active() { return !!this.role; }
  get isHost() { return this.role === 'host'; }
  on(type, fn) { this.handlers[type] = fn; }
  status(t, err = false) { this.onStatus?.(t, err); }

  // ---- create / join -------------------------------------------------------

  host(me) {
    return new Promise((resolve, reject) => {
      this.leave();
      if (!window.Peer) { reject(new Error('Multiplayer library failed to load')); return; }
      const tryCode = (attempt) => {
        const code = makeCode();
        const peer = new window.Peer(PREFIX + code, peerOptions());
        peer.on('open', (id) => {
          this.peer = peer; this.role = 'host'; this.code = code; this.myId = id;
          this.members = [{ ...me, id, host: true, team: 0 }];
          peer.on('connection', (conn) => this.acceptClient(conn));
          peer.on('disconnected', () => peer.reconnect());
          this.changed();
          resolve(code);
        });
        peer.on('error', (e) => {
          if (e.type === 'unavailable-id' && attempt < 4) { peer.destroy(); tryCode(attempt + 1); return; }
          if (!this.role) reject(friendlyError(e)); else this.status(friendlyError(e).message, true);
        });
      };
      tryCode(0);
    });
  }

  join(code, me) {
    return new Promise((resolve, reject) => {
      this.leave();
      if (!window.Peer) { reject(new Error('Multiplayer library failed to load')); return; }
      code = code.trim().toUpperCase();
      const peer = new window.Peer(undefined, peerOptions());
      let done = false;
      const fail = (e) => { if (done) return; done = true; peer.destroy(); reject(e); };
      const timer = setTimeout(() => fail(new Error('Could not reach that party. Check the code, or your network may block peer-to-peer.')), 20000);
      peer.on('open', (id) => {
        this.myId = id;
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          if (done) return;
          clearTimeout(timer);
          done = true;
          this.peer = peer; this.role = 'client'; this.code = code;
          this.conns.set('host', conn);
          conn.on('data', (msg) => this.receive(msg, 'host'));
          conn.on('close', () => { if (this.role === 'client') { this.status('Lost connection to the party host', true); this.handlers.hostLeft?.(); this.leave(); } });
          this.send({ t: 'hello', me });
          resolve(code);
        });
        conn.on('error', (e) => fail(friendlyError(e)));
      });
      peer.on('error', (e) => fail(friendlyError(e)));
    });
  }

  acceptClient(conn) {
    conn.on('open', () => {
      if (this.members.length >= MAX_PARTY || this.inMatch && this.mode === 'pvp' && false) {
        conn.send({ t: 'full' });
        setTimeout(() => conn.close(), 300);
        return;
      }
      this.conns.set(conn.peer, conn);
    });
    conn.on('data', (msg) => this.receive(msg, conn.peer));
    conn.on('close', () => this.dropClient(conn.peer));
    conn.on('error', () => this.dropClient(conn.peer));
  }

  dropClient(id) {
    if (!this.conns.has(id)) return;
    this.conns.delete(id);
    const m = this.members.find((x) => x.id === id);
    this.members = this.members.filter((x) => x.id !== id);
    if (m) this.status(`${m.name} left the party`);
    this.handlers.memberLeft?.(id);
    this.changed();
  }

  leave() {
    if (this.peer) { try { this.peer.destroy(); } catch { /* ignore */ } }
    this.peer = null; this.role = null; this.code = null;
    this.conns.clear();
    this.members = [];
    this.inMatch = false;
    this.onChange?.();
  }

  // ---- messaging -------------------------------------------------------------

  send(msg, to = null) {
    if (this.role === 'client') { const c = this.conns.get('host'); if (c?.open) c.send(msg); return; }
    if (to) { const c = this.conns.get(to); if (c?.open) c.send(msg); return; }
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }

  receive(msg, from) {
    if (!msg || typeof msg !== 'object') return;
    if (this.isHost) {
      if (msg.t === 'hello') {
        if (this.members.length >= MAX_PARTY) { this.send({ t: 'full' }, from); return; }
        const teams = [0, 1].map((t) => this.members.filter((m) => m.team === t).length);
        const team = this.mode === 'pvp' && teams[1] < teams[0] ? 1 : 0;
        this.members.push({ ...sanitizeMe(msg.me), id: from, host: false, team });
        this.status(`${sanitizeMe(msg.me).name} joined`);
        this.changed();
        return;
      }
      if (msg.t === 'me') {
        const m = this.members.find((x) => x.id === from);
        if (m) { Object.assign(m, sanitizeMe(msg.me), { id: from, host: false }); this.changed(); }
        return;
      }
      if (msg.t === 'team') {
        const m = this.members.find((x) => x.id === from);
        if (m && this.mode === 'pvp') { this.setTeam(from, msg.team); }
        return;
      }
    } else {
      if (msg.t === 'party') {
        this.members = msg.members; this.mode = msg.mode;
        this.onChange?.();
        return;
      }
      if (msg.t === 'full') { this.status('That party is full', true); this.leave(); return; }
    }
    this.handlers[msg.t]?.(msg, from);
  }

  // host: broadcast roster
  changed() {
    if (this.isHost) this.send({ t: 'party', members: this.members, mode: this.mode });
    this.onChange?.();
  }

  updateMe(me) {
    if (this.isHost) { Object.assign(this.members[0], sanitizeMe(me)); this.changed(); }
    else if (this.role === 'client') this.send({ t: 'me', me });
  }

  setMode(mode) {
    if (!this.isHost) return;
    this.mode = mode;
    if (mode === 'coop') for (const m of this.members) m.team = 0;
    else this.members.forEach((m, i) => { m.team = i % 2; });
    this.changed();
  }

  setTeam(id, team) {
    if (this.role === 'client') { this.send({ t: 'team', team }); return; }
    const m = this.members.find((x) => x.id === id);
    if (!m || this.mode !== 'pvp') return;
    if (this.members.filter((x) => x.team === team).length >= 3) return;
    m.team = team;
    this.changed();
  }

  me() { return this.members.find((m) => m.id === this.myId); }
}

function sanitizeMe(me = {}) {
  return {
    name: String(me.name || 'Player').slice(0, 16),
    agent: String(me.agent || 'haze'),
    held: me.held && typeof me.held === 'object' ? { weapon: String(me.held.weapon), skin: String(me.held.skin), key: String(me.held.key) } : null,
    skins: me.skins && typeof me.skins === 'object' ? me.skins : {},
  };
}

function friendlyError(e) {
  const map = {
    'peer-unavailable': 'No party with that code',
    network: 'Could not reach the matchmaking server (your network may block it)',
    'server-error': 'Matchmaking server error — try again',
    'socket-error': 'Connection problem — try again',
    'browser-incompatible': 'This browser does not support peer-to-peer',
  };
  return new Error(map[e?.type] || e?.message || 'Connection failed');
}

// Cloud accounts: username + password via Firebase Auth, progress saved to Firestore.
// Uses Firebase's REST APIs directly (no SDK). Everything the game saves lives in localStorage
// (profile + settings); while signed in that data is mirrored to users/{uid} in Firestore.
import { FIREBASE_CONFIG } from './firebase-config.js?v=20261031180755';

const KEYS = ['cbs-profile', 'cbs-settings'];       // what gets synced
const SESSION = 'cbs-account';                       // { uid, name, refresh, stamp }
const GUEST = 'cbs-guest-backup';                    // guest progress, restored on sign out
const EMAIL_DOMAIN = 'players.shootah.game';

export const accountsEnabled = () => !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);

let session = null;
try { session = JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch { session = null; }
let idToken = null, idExpires = 0;
let pushTimer = 0, pushing = false, dirty = false;
let ready = false, earlyDirty = false;   // saves made before the startup sync finishes wait for it
const listeners = new Set();
let status = { state: session ? 'connecting' : 'guest', msg: '' };

const saveSession = () => (session ? localStorage.setItem(SESSION, JSON.stringify(session)) : localStorage.removeItem(SESSION));
const setStatus = (state, msg = '') => { status = { state, msg }; for (const f of listeners) f(); };
export const onAccountChange = (f) => listeners.add(f);
export const account = () => (session ? { name: session.name, uid: session.uid, ...status } : { ...status });

export const validUsername = (u) => /^[A-Za-z0-9_]{3,16}$/.test(u);

const ERRORS = {
  EMAIL_EXISTS: 'That username is taken.',
  EMAIL_NOT_FOUND: 'Wrong username or password.',
  INVALID_PASSWORD: 'Wrong username or password.',
  INVALID_LOGIN_CREDENTIALS: 'Wrong username or password.',
  USER_DISABLED: 'This account was disabled.',
  WEAK_PASSWORD: 'Password needs at least 6 characters.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many tries. Wait a minute and try again.',
  OPERATION_NOT_ALLOWED: 'Username/password sign-in is not switched on in Firebase yet.',
  CONFIGURATION_NOT_FOUND: 'Username/password sign-in is not switched on in Firebase yet.',
  PERMISSION_DENIED: 'The save database refused access (check the Firestore rules).',
};
const friendly = (code) => ERRORS[String(code).split(' ')[0].split(':')[0]] || `Something went wrong (${code}).`;

async function post(url, body, form = false) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
  } catch { throw new Error('No connection. Check your internet.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendly(data.error?.message || res.status));
  return data;
}

const authUrl = (op) => `https://identitytoolkit.googleapis.com/v1/accounts:${op}?key=${FIREBASE_CONFIG.apiKey}`;
const docUrl = (uid) => `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${uid}`;

async function token() {
  if (idToken && Date.now() < idExpires - 60000) return idToken;
  const d = await post(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`,
    { grant_type: 'refresh_token', refresh_token: session.refresh }, true);
  idToken = d.id_token; idExpires = Date.now() + Number(d.expires_in || 3600) * 1000;
  session.refresh = d.refresh_token; saveSession();
  return idToken;
}

// Signed-in player's ID token + uid (null when playing as a guest). Used by matchmaking.
export async function accountAuth() {
  if (!session || !accountsEnabled()) return null;
  return { token: await token(), uid: session.uid };
}

// ---- cloud document ----------------------------------------------------------

function localData() {
  const out = {};
  for (const k of KEYS) out[k] = localStorage.getItem(k);
  return out;
}

async function pull() {
  const res = await fetch(docUrl(session.uid), { headers: { Authorization: `Bearer ${await token()}` } });
  if (res.status === 404) return null;
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendly(d.error?.status || d.error?.message || res.status));
  const f = d.fields || {};
  return { data: JSON.parse(f.data?.stringValue || '{}'), stamp: Number(f.updated?.integerValue || 0), name: f.name?.stringValue };
}

async function push(keepalive = false) {
  if (!session) return;
  const stamp = Date.now();
  const body = JSON.stringify({ fields: {
    name: { stringValue: session.name },
    data: { stringValue: JSON.stringify(localData()) },
    updated: { integerValue: String(stamp) },
  } });
  const tok = keepalive && idToken ? idToken : await token();
  const res = await fetch(docUrl(session.uid), {
    method: 'PATCH', keepalive, body,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(friendly(d.error?.status || d.error?.message || res.status));
  }
  session.stamp = stamp; saveSession();
}

async function flush() {
  if (!session || pushing || !dirty) return;
  pushing = true; dirty = false;
  setStatus('saving');
  try {
    await push();
    if (!dirty) { session.pending = false; saveSession(); }
    setStatus('synced');
  }
  catch (e) { dirty = true; setStatus('offline', e.message); clearTimeout(pushTimer); pushTimer = setTimeout(flush, 15000); }
  pushing = false;
  if (dirty) schedule();
}
const schedule = (ms = 1500) => { clearTimeout(pushTimer); pushTimer = setTimeout(flush, ms); };

// Call after anything saves to localStorage; uploads shortly after while signed in.
export function markDirty() {
  if (!session) return;
  if (!ready) { earlyDirty = true; return; }
  dirty = true; session.pending = true; saveSession();
  schedule();
}

// Apply cloud data locally. Returns true if anything changed (caller reloads the page).
function apply(data) {
  let changed = false;
  for (const k of KEYS) {
    const v = data[k] ?? null;
    if (localStorage.getItem(k) === v) continue;
    if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    changed = true;
  }
  return changed;
}

// On page load: refresh the session and reconcile with the cloud copy.
// Resolves to true when cloud data replaced local data (the page should reload).
export async function startAccount() {
  const changed = await reconcile();
  ready = true;
  if (!changed && earlyDirty) markDirty();
  return changed;
}
async function reconcile() {
  if (!session || !accountsEnabled()) { if (session && !accountsEnabled()) setStatus('offline', 'Accounts are not configured.'); return false; }
  setStatus('connecting');
  try {
    const cloud = await pull();
    if (session.pending || !cloud) { dirty = true; await flush(); return false; }
    if (cloud.stamp !== session.stamp) {
      session.stamp = cloud.stamp; saveSession();
      const changed = apply(cloud.data);
      setStatus('synced');
      return changed;
    }
    setStatus('synced');
  } catch (e) {
    setStatus('offline', e.message);
  }
  return false;
}

// ---- sign up / in / out ---------------------------------------------------------

async function begin(name, d) {
  ready = true;
  // keep this device's guest progress aside so signing out gives it back
  if (!localStorage.getItem(GUEST)) localStorage.setItem(GUEST, JSON.stringify(localData()));
  session = { uid: d.localId, name, refresh: d.refreshToken, stamp: 0 };
  idToken = d.idToken; idExpires = Date.now() + Number(d.expiresIn || 3600) * 1000;
  saveSession();
}

// New account: your current progress becomes the account's progress.
export async function signUp(username, password) {
  if (!accountsEnabled()) throw new Error('Cloud accounts are not set up yet.');
  if (!validUsername(username)) throw new Error('Username: 3-16 letters, numbers or _');
  if (password.length < 6) throw new Error('Password needs at least 6 characters.');
  const d = await post(authUrl('signUp'), { email: `${username.toLowerCase()}@${EMAIL_DOMAIN}`, password, returnSecureToken: true });
  await begin(username, d);
  // nothing to restore for a brand-new account: the guest progress carries over
  localStorage.removeItem(GUEST);
  dirty = true;
  await flush();
  return false;
}

// Existing account: load its progress. Resolves true if the page should reload.
export async function signIn(username, password) {
  if (!accountsEnabled()) throw new Error('Cloud accounts are not set up yet.');
  if (!validUsername(username)) throw new Error('Wrong username or password.');
  const d = await post(authUrl('signInWithPassword'), { email: `${username.toLowerCase()}@${EMAIL_DOMAIN}`, password, returnSecureToken: true });
  await begin(username, d);
  const cloud = await pull().catch((e) => { setStatus('offline', e.message); return null; });
  if (cloud) {
    // keep the capitalisation the account was made with
    session.name = cloud.name || username; session.stamp = cloud.stamp; saveSession();
    apply(cloud.data);
    setStatus('synced');
    return true;
  }
  dirty = true; await flush();
  return false;
}

// Upload anything pending, then go back to this device's guest progress.
export async function signOut() {
  if (!session) return;
  clearTimeout(pushTimer);
  if (dirty || session.pending) { try { await push(); } catch { /* best effort */ } }
  session = null; idToken = null; dirty = false;
  saveSession();
  let guest = null;
  try { guest = JSON.parse(localStorage.getItem(GUEST) || 'null'); } catch { guest = null; }
  for (const k of KEYS) {
    if (guest && guest[k] != null) localStorage.setItem(k, guest[k]);
    else localStorage.removeItem(k);
  }
  localStorage.removeItem(GUEST);
  setStatus('guest');
}

// Last-chance upload when the tab is hidden or closed.
const lastChance = () => { if (session && dirty && idToken) { dirty = false; push(true).catch(() => { dirty = true; }); } };
document.addEventListener('visibilitychange', () => { if (document.hidden) lastChance(); });
window.addEventListener('pagehide', lastChance);

import { WEAPONS } from './weapons.js?v=20261031055727';
import {
  SKINS, RARITY, KNIFE_MODELS, LOCKER_WEAPONS, ROLL_COST, DUPLICATE_REFUND, KNIFE_CHANCE,
  loadProfile, saveProfile, itemKey, parseKey, equippedFor, randomItem,
} from './skins.js?v=20261031055727';

const $ = (id) => document.getElementById(id);
const weaponName = (w) => (w === 'knife' ? 'Knife' : WEAPONS[w].name);
const itemName = (it) => `${it.weapon === 'knife' ? KNIFE_MODELS[it.model] : weaponName(it.weapon)} · ${SKINS[it.skin].name}`;

// Locker: browse weapons, equip owned skins, and roll for new ones.
export class Locker {
  constructor(game, sound) {
    this.game = game;
    this.sound = sound;
    this.profile = loadProfile();
    game.profile = this.profile;
    this.selected = 'knife';
    this.thumbs = new Map();
    $('lockerBack').addEventListener('click', () => this.close());
    $('rollBtn').addEventListener('click', () => this.roll());
    $('rollClose').addEventListener('click', () => this.closeRoll());
    $('rollEquip').addEventListener('click', () => { if (this.lastRoll) this.equip(this.lastRoll.key); this.closeRoll(); });
    this.updateCoins();
    $('lockerOdds').innerHTML = Object.values(RARITY).map((r) => `<span style="color:${r.color}">${r.name} ${r.weight}%</span>`).join(' · ') +
      ` · <span class="knife-odds">★ Knife ${Math.round(KNIFE_CHANCE * 100)}%</span>`;
  }

  updateCoins() {
    for (const el of document.querySelectorAll('.coin-count')) el.textContent = `¤ ${this.profile.coins}`;
    $('rollBtn').disabled = this.profile.coins < ROLL_COST;
  }

  addCoins(n) {
    this.profile.coins += n;
    saveProfile(this.profile);
    this.updateCoins();
  }

  open() {
    $('menu').classList.add('hidden');
    $('locker').classList.remove('hidden');
    this.renderWeapons();
    this.select(this.selected);
  }

  close() {
    $('locker').classList.add('hidden');
    $('menu').classList.remove('hidden');
    this.onChange?.();
  }

  thumb(weapon, skin, model, w = 150, h = 84) {
    const key = `${weapon}|${skin}|${model || ''}|${w}`;
    if (!this.thumbs.has(key)) {
      const cv = document.createElement('canvas');
      this.game.renderGunPreview(weapon, skin, model, cv, w, h, 0.25);
      this.thumbs.set(key, cv.toDataURL());
    }
    return this.thumbs.get(key);
  }

  renderWeapons() {
    const list = $('lockerWeapons');
    list.innerHTML = '';
    for (const w of LOCKER_WEAPONS) {
      const eq = equippedFor(this.profile, w);
      const b = document.createElement('div');
      b.className = 'locker-weapon' + (w === this.selected ? ' sel' : '');
      const rarity = SKINS[eq.skin]?.rarity || 'common';
      b.style.setProperty('--rc', RARITY[rarity].color);
      b.innerHTML = `<b>${weaponName(w)}</b><span>${w === 'knife' ? KNIFE_MODELS[eq.model] + ' · ' : ''}${SKINS[eq.skin].name}</span>`;
      b.addEventListener('click', () => this.select(w));
      list.appendChild(b);
    }
  }

  select(w) {
    this.selected = w;
    for (const el of $('lockerWeapons').children) el.classList.toggle('sel', el.querySelector('b').textContent === weaponName(w));
    const eq = equippedFor(this.profile, w);
    this.game.renderGunPreview(w, eq.skin, eq.model, $('lockerCanvas'), 520, 280, 0.3);
    $('lockerTitle').innerHTML = `${w === 'knife' ? KNIFE_MODELS[eq.model] : weaponName(w)} <span style="color:${RARITY[SKINS[eq.skin].rarity].color}">${SKINS[eq.skin].name}</span>`;

    // owned items for this weapon (+ the free factory one)
    const owned = [itemKey(w, 'factory', w === 'knife' ? 'combat' : undefined), ...this.profile.owned.filter((k) => parseKey(k).weapon === w)];
    const ownedSet = new Set(owned);
    const grid = $('lockerSkins');
    grid.innerHTML = '';
    const current = this.profile.equipped[w] || owned[0];
    for (const key of owned) {
      const it = parseKey(key);
      const card = document.createElement('div');
      card.className = 'skin-card' + (key === current ? ' on' : '');
      card.style.setProperty('--rc', RARITY[SKINS[it.skin].rarity].color);
      card.innerHTML = `<img src="${this.thumb(it.weapon, it.skin, it.model)}"><b>${SKINS[it.skin].name}</b><span>${w === 'knife' ? KNIFE_MODELS[it.model] : RARITY[SKINS[it.skin].rarity].name}</span>`;
      card.addEventListener('click', () => this.equip(key));
      grid.appendChild(card);
    }
    // locked skins as silhouettes to chase
    for (const [id, sk] of Object.entries(SKINS)) {
      if (sk.hidden || id === 'factory') continue;
      if (owned.some((k) => parseKey(k).skin === id)) continue;
      const card = document.createElement('div');
      card.className = 'skin-card locked';
      card.style.setProperty('--rc', RARITY[sk.rarity].color);
      card.innerHTML = `<div class="lock">🔒</div><b>${sk.name}</b><span>${RARITY[sk.rarity].name}</span>`;
      grid.appendChild(card);
    }
    void ownedSet;
  }

  equip(key) {
    const it = parseKey(key);
    this.profile.equipped[it.weapon] = key;
    saveProfile(this.profile);
    this.onChange?.();
    this.sound.buy();
    this.renderWeapons();
    this.select(it.weapon);
  }

  roll() {
    if (this.profile.coins < ROLL_COST || this.rolling) { this.sound.deny(); return; }
    this.sound.init();
    this.profile.coins -= ROLL_COST;
    saveProfile(this.profile);
    this.updateCoins();
    this.rolling = true;

    const result = randomItem();
    const items = [];
    const WIN = 34;
    for (let i = 0; i < 42; i++) items.push(i === WIN ? result : randomItem());
    const reel = $('reel');
    reel.style.transition = 'none';
    reel.style.transform = 'translateX(0px)';
    reel.innerHTML = items.map((it) => `<div class="reel-card ${it.weapon === 'knife' ? 'knife' : ''}" style="--rc:${RARITY[it.rarity].color}">
      <img src="${this.thumb(it.weapon, it.skin, it.model, 150, 84)}"><b>${SKINS[it.skin].name}</b><span>${it.weapon === 'knife' ? '★ ' + KNIFE_MODELS[it.model] : weaponName(it.weapon)}</span></div>`).join('');
    $('rollResult').classList.add('hidden');
    $('rollOverlay').classList.remove('hidden');

    // spin: land the winning card under the marker with a little random offset
    const cardW = 170, windowW = $('reelWindow').clientWidth;
    const target = WIN * cardW + cardW / 2 - windowW / 2 + (Math.random() - 0.5) * (cardW * 0.6);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      reel.style.transition = 'transform 5s cubic-bezier(0.08, 0.6, 0.12, 1)';
      reel.style.transform = `translateX(${-target}px)`;
    }));
    // ticking sound as cards pass the marker
    let lastIdx = -1;
    const t0 = performance.now();
    const tick = () => {
      if (!this.rolling) return;
      const m = new DOMMatrixReadOnly(getComputedStyle(reel).transform);
      const idx = Math.floor((-m.m41 + windowW / 2) / cardW);
      if (idx !== lastIdx) { lastIdx = idx; this.sound.click(); }
      if (performance.now() - t0 < 5100) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => this.reveal(result), 5300);
  }

  reveal(it) {
    this.rolling = false;
    const dup = this.profile.owned.includes(it.key);
    if (dup) this.profile.coins += DUPLICATE_REFUND;
    else this.profile.owned.push(it.key);
    saveProfile(this.profile);
    this.updateCoins();
    this.lastRoll = it;
    const r = RARITY[it.rarity];
    $('rollResult').style.setProperty('--rc', r.color);
    $('rollRarity').textContent = (it.weapon === 'knife' ? '★ KNIFE · ' : '') + r.name.toUpperCase();
    $('rollName').textContent = itemName(it);
    $('rollNote').textContent = dup ? `Duplicate — refunded ¤ ${DUPLICATE_REFUND}` : 'NEW! Added to your Locker';
    this.game.renderGunPreview(it.weapon, it.skin, it.model, $('rollCanvas'), 460, 240, 0.3);
    $('rollResult').classList.remove('hidden');
    this.sound.announce(it.weapon === 'knife' || it.rarity === 'epic' || it.rarity === 'legendary');
    this.onChange?.();
  }

  closeRoll() {
    $('rollOverlay').classList.add('hidden');
    this.renderWeapons();
    this.select(this.lastRoll ? this.lastRoll.weapon : this.selected);
  }
}

import { WEAPONS, ARMOR, BUY_LIST } from './weapons.js';
import { fmtTime } from './util.js';
import { ABILITY_INFO, iconSvg } from './agents.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = {};
    for (const id of ['hud', 'scoreAlly', 'scoreEnemy', 'roundTimer', 'roundLabel', 'aliveAlly', 'aliveEnemy',
      'minimap', 'killfeed', 'crosshair', 'hitmarker', 'dmgIndicator', 'redFlash', 'scope', 'centerMsg', 'subMsg',
      'progressWrap', 'progressLabel', 'progressFill', 'hint', 'spectate', 'armorVal', 'healthVal', 'credits',
      'coreTag', 'weaponName', 'ammoMag', 'ammoReserve', 'slots', 'scoreboard', 'buyMenu', 'buyItems', 'buyCredits',
      'sideTag', 'fps', 'abilityBar', 'flashOverlay', 'odTint', 'smokeOverlay', 'buyAbilities', 'agentTag']) {
      this.el[id] = $(id);
    }
    this.ch = {
      top: this.el.crosshair.querySelector('.top'), bottom: this.el.crosshair.querySelector('.bottom'),
      left: this.el.crosshair.querySelector('.left'), right: this.el.crosshair.querySelector('.right'),
    };
    this.cache = {};
    this.hitT = 0; this.dmgT = 0; this.flashT = 0; this.msgT = 0;
    this.mmScale = 7;
    this.mmCtx = this.el.minimap.getContext('2d');
    this.buildBuyMenu();
  }

  setMap(map) {
    this.map = map;
    const mm = this.el.minimap;
    mm.width = map.W * this.mmScale; mm.height = map.H * this.mmScale;
    this.mmBase = document.createElement('canvas');
    this.mmBase.width = mm.width; this.mmBase.height = mm.height;
    map.drawMinimap(this.mmBase.getContext('2d'), this.mmScale);
    this.el.sideTag.style.left = `${mm.width + 22}px`;
  }

  // Builds the ability bar and the ability section of the buy menu for the player's agent.
  setAgent(agent) {
    this.agent = agent;
    const accent = '#' + agent.accent.toString(16).padStart(6, '0');
    this.el.agentTag.innerHTML = `<span style="color:${accent}">${agent.name}</span> · ${agent.role}`;
    this.el.abilityBar.innerHTML = ['q', 'e', 'f', 'x'].map((k) => {
      const kit = agent.kit[k];
      return `<div class="ab ${k === 'x' ? 'ult' : ''}" data-k="${k}" style="--ac:${accent}">
        <div class="ic">${iconSvg(kit.type)}</div>
        <div class="key">${k.toUpperCase()}</div>
        <div class="pips"></div>
      </div>`;
    }).join('');
    this.abEls = {};
    for (const n of this.el.abilityBar.children) this.abEls[n.dataset.k] = { node: n, pips: n.querySelector('.pips') };
    this.el.buyAbilities.innerHTML = '';
    this.abilityEntries = ['q', 'f'].map((k) => {
      const kit = agent.kit[k], info = ABILITY_INFO[kit.type];
      const n = document.createElement('div');
      n.className = 'buy-item ability';
      n.innerHTML = `<div class="ab-ic" style="color:${accent}">${iconSvg(kit.type)}</div><span class="nm">${info.name} <span class="key">[${k.toUpperCase()}]</span></span>
        <span class="pr">¤ ${kit.price} <span class="chg"></span></span><span class="ds">${info.desc}</span>`;
      n.addEventListener('mousedown', (e) => { e.stopPropagation(); this.game.buy('ab:' + k); });
      this.el.buyAbilities.appendChild(n);
      return { k, kit, node: n, chg: n.querySelector('.chg') };
    });
  }

  updateAbilities(c) {
    if (!this.abEls || !c.agent) return;
    for (const k of ['q', 'e', 'f']) {
      const kit = c.agent.kit[k], n = this.abEls[k];
      const sig = `${c.charges[k]}/${kit.max}`;
      if (n.sig !== sig) {
        n.sig = sig;
        n.pips.innerHTML = Array.from({ length: kit.max }, (_, i) => `<i class="${i < c.charges[k] ? 'on' : ''}"></i>`).join('');
        n.node.classList.toggle('empty', c.charges[k] <= 0);
      }
    }
    const x = this.abEls.x, cost = c.agent.kit.x.cost;
    const sig = `${c.ult}/${cost}`;
    if (x.sig !== sig) {
      x.sig = sig;
      x.pips.innerHTML = c.ult >= cost ? '<b>READY</b>' : Array.from({ length: cost }, (_, i) => `<i class="${i < c.ult ? 'on' : ''}"></i>`).join('');
      x.node.classList.toggle('ready', c.ult >= cost);
      x.node.classList.toggle('empty', c.ult < cost);
    }
  }

  flash(amount) {
    if (this.cache.flash === amount) return;
    this.cache.flash = amount;
    this.el.flashOverlay.style.opacity = amount;
  }

  overdrive(on) { this.set('od', this.el.odTint, on ? 'on' : '', 'className'); }
  inSmoke(on) { this.set('sm', this.el.smokeOverlay, on ? 'on' : '', 'className'); }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  setCrossColor(c) { document.documentElement.style.setProperty('--cross', c); }

  // ---- per frame ----

  update(dt) {
    const g = this.game, p = g.player;
    this.set('sa', this.el.scoreAlly, String(g.score[g.playerTeam]));
    this.set('se', this.el.scoreEnemy, String(g.score[1 - g.playerTeam]));
    this.set('rl', this.el.roundLabel, `ROUND ${g.round}`);

    let timer;
    const planted = g.core.state === 'planted';
    if (planted) timer = fmtTime(g.core.timer);
    else if (g.phase === 'buy') timer = fmtTime(g.phaseT);
    else if (g.phase === 'live') timer = fmtTime(g.phaseT);
    else timer = '0:00';
    this.set('rt', this.el.roundTimer, timer);
    this.set('rtc', this.el.roundTimer, planted ? 'planted' : '', 'className');

    const side = g.sideOf(g.playerTeam);
    this.set('side', this.el.sideTag, side === 'ATK' ? 'ATTACKING' : 'DEFENDING');
    this.el.sideTag.style.color = side === 'ATK' ? '#ff9f6b' : '#7fc8ff';

    this.aliveRow('aa', this.el.aliveAlly, g.combatants.filter((c) => c.team === g.playerTeam));
    this.aliveRow('ae', this.el.aliveEnemy, g.combatants.filter((c) => c.team !== g.playerTeam));

    // vitals
    const watch = p.alive ? p : g.spectating || p;
    this.set('hp', this.el.healthVal, String(Math.max(0, Math.ceil(watch.health))));
    this.set('hpc', this.el.healthVal, watch.health <= 30 ? 'low' : '', 'className');
    this.set('ar', this.el.armorVal, String(Math.ceil(watch.armor)));

    const w = watch.weapon;
    if (w) {
      this.set('wn', this.el.weaponName, w.def.name);
      if (w.def.melee) {
        this.set('am', this.el.ammoMag, '—');
        this.set('ares', this.el.ammoReserve, '');
      } else {
        this.set('am', this.el.ammoMag, w.reloadT > 0 ? '…' : String(w.mag));
        this.set('ares', this.el.ammoReserve, `/ ${w.reserve}`);
      }
      this.set('amc', this.el.ammoMag, !w.def.melee && w.mag <= w.def.mag * 0.25 ? 'low' : '', 'className');
    }
    const slotsHtml = ['primary', 'secondary', 'melee'].map((s, i) => {
      const it = watch.inv[s];
      return `<span class="${watch.slot === s ? 'on' : ''}">${i + 1} ${it ? it.def.name : '—'}</span>`;
    }).join('');
    this.set('slots', this.el.slots, slotsHtml, 'innerHTML');

    this.updateAbilities(watch);
    this.set('cr', this.el.credits, g.phase === 'buy' && p.alive ? `¤ ${p.credits}  ·  press B to buy` : `¤ ${p.credits}`);
    this.el.coreTag.classList.toggle('hidden', !(p.alive && p.hasCore));

    // timed fades
    this.hitT -= dt; this.dmgT -= dt; this.flashT -= dt; this.msgT -= dt;
    this.el.hitmarker.style.opacity = Math.max(0, this.hitT / 0.25);
    this.el.dmgIndicator.style.opacity = Math.max(0, this.dmgT);
    this.el.redFlash.style.opacity = Math.max(0, this.flashT * 2);
    if (this.msgT <= 0) {
      this.el.centerMsg.style.opacity = 0;
      this.el.subMsg.style.opacity = 0;
    }

    // killfeed expiry
    const now = performance.now();
    for (const n of [...this.el.killfeed.children]) {
      const age = now - Number(n.dataset.t);
      if (age > 6000) n.remove();
      else if (age > 5000) n.style.opacity = 0;
    }

    this.drawMinimap();
  }

  aliveRow(key, el, list) {
    const sig = list.map((c) => (c.alive ? 1 : 0) + (c.isPlayer ? 'p' : '')).join('');
    if (this.cache[key] === sig) return;
    this.cache[key] = sig;
    el.innerHTML = list.map((c) => `<div class="pip ${c.alive ? 'on' : ''} ${c.isPlayer ? 'me' : ''}"></div>`).join('');
  }

  crosshair(gap, visible) {
    this.el.crosshair.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const g = Math.round(Math.min(gap, 80));
    if (this.cache.gap === g) return;
    this.cache.gap = g;
    this.ch.top.style.top = `${-g - 7}px`;
    this.ch.bottom.style.top = `${g}px`;
    this.ch.left.style.left = `${-g - 7}px`;
    this.ch.right.style.left = `${g}px`;
  }

  scope(on) { this.el.scope.classList.toggle('on', on); }

  hitmarker(type) {
    this.el.hitmarker.className = type === 'head' ? 'head' : type === 'kill' ? 'kill' : '';
    this.hitT = 0.25;
  }

  damageFrom(angle) {
    this.el.dmgIndicator.style.transform = `rotate(${angle}rad)`;
    this.dmgT = 1;
    this.flashT = 0.3;
  }

  message(text, sub = '', cls = '', dur = 2.5) {
    this.el.centerMsg.textContent = text;
    this.el.centerMsg.className = cls;
    this.el.subMsg.textContent = sub;
    this.el.centerMsg.style.opacity = 1;
    this.el.subMsg.style.opacity = sub ? 1 : 0;
    this.msgT = dur;
  }

  progress(label, frac) {
    if (frac === null) { this.el.progressWrap.classList.add('hidden'); return; }
    this.el.progressWrap.classList.remove('hidden');
    this.set('pl', this.el.progressLabel, label);
    this.el.progressFill.style.width = `${Math.min(100, frac * 100)}%`;
  }

  hint(text) { this.set('hint', this.el.hint, text || ''); }
  spectate(text) { this.set('spec', this.el.spectate, text || ''); }

  killfeed(killer, victim, weapon, head) {
    const g = this.game;
    const n = document.createElement('div');
    n.className = 'kf' + (killer?.isPlayer || victim.isPlayer ? ' mine' : '');
    n.dataset.t = performance.now();
    const cls = (c) => (c.team === g.playerTeam ? 'a' : 'e');
    n.innerHTML = killer
      ? `<span class="${cls(killer)}">${killer.name}</span><span class="w">${weapon}</span>${head ? '<span class="hs">◎</span>' : ''}<span class="${cls(victim)}">${victim.name}</span>`
      : `<span class="w">${weapon}</span><span class="${cls(victim)}">${victim.name}</span>`;
    this.el.killfeed.appendChild(n);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
  }

  clearKillfeed() { this.el.killfeed.innerHTML = ''; }

  drawMinimap() {
    const g = this.game, ctx = this.mmCtx, s = this.mmScale, map = g.map;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(this.mmBase, 0, 0);
    const toX = (x) => (x - map.ox) / 3 * s, toZ = (z) => (z - map.oz) / 3 * s;

    g.abilities.drawMinimap(ctx, toX, toZ, s);
    const core = g.core;
    if (core.state === 'planted' || core.state === 'dropped') {
      const visible = core.state === 'planted' || g.sideOf(g.playerTeam) === 'ATK';
      if (visible) {
        ctx.fillStyle = (Math.floor(g.time * 4) % 2) ? '#ff3b5c' : '#ffd166';
        ctx.beginPath();
        const x = toX(core.pos.x), z = toZ(core.pos.z);
        ctx.moveTo(x, z - 6); ctx.lineTo(x + 5, z); ctx.lineTo(x, z + 6); ctx.lineTo(x - 5, z);
        ctx.fill();
      }
    }

    for (const c of g.combatants) {
      if (!c.alive) continue;
      const ally = c.team === g.playerTeam;
      if (!ally && c.spotUntil < g.time) continue;
      const x = toX(c.pos.x), z = toZ(c.pos.z);
      if (c.isPlayer) {
        ctx.save();
        ctx.translate(x, z);
        ctx.rotate(-c.yaw);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.fillStyle = ally ? '#2ee6d6' : '#ff3048';
      ctx.beginPath(); ctx.arc(x, z, 4.2, 0, Math.PI * 2); ctx.fill();
      if (c.hasCore && ally) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.stroke(); }
      // view direction tick
      ctx.strokeStyle = ally ? 'rgba(46,196,182,0.8)' : 'rgba(255,90,95,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, z); ctx.lineTo(x - Math.sin(c.yaw) * 8, z - Math.cos(c.yaw) * 8); ctx.stroke();
    }
  }

  scoreboard(show) {
    const el = this.el.scoreboard;
    el.classList.toggle('hidden', !show);
    if (!show) return;
    const g = this.game;
    const table = (team) => {
      const rows = g.combatants.filter((c) => c.team === team)
        .sort((a, b) => b.kills - a.kills)
        .map((c) => `<tr class="${c.alive ? '' : 'dead'} ${c.isPlayer ? 'me' : ''}">
          <td>${c.name} <span class="ag">${c.agent.name}</span>${c.hasCore && team === g.playerTeam ? ' ◆' : ''}</td><td>${c.kills}</td><td>${c.deaths}</td>
          <td>${team === g.playerTeam ? '¤ ' + c.credits : ''}</td>
          <td>${team === g.playerTeam ? (c.inv.primary ? c.inv.primary.def.name : c.inv.secondary?.def.name ?? '') : ''}</td></tr>`)
        .join('');
      return `<table><tr><th>PLAYER</th><th>K</th><th>D</th><th>CREDITS</th><th>WEAPON</th></tr>${rows}</table>`;
    };
    el.innerHTML = `<div class="ally"><h3>YOUR TEAM · ${g.score[g.playerTeam]}</h3>${table(g.playerTeam)}</div>
      <div class="enemy"><h3>ENEMY TEAM · ${g.score[1 - g.playerTeam]}</h3>${table(1 - g.playerTeam)}</div>`;
  }

  // ---- buy menu ----

  buildBuyMenu() {
    const items = [
      ...BUY_LIST.map((id) => ({ id, def: WEAPONS[id], desc: describe(WEAPONS[id]) })),
      { id: 'light', def: ARMOR.light, desc: '+25 shield' },
      { id: 'heavy', def: ARMOR.heavy, desc: '+50 shield' },
    ];
    this.buyEntries = items.map((it, i) => {
      const n = document.createElement('div');
      n.className = 'buy-item';
      const cat = it.def.category ? `<span class="cat">${it.def.category}</span>` : '<span class="cat">Shield</span>';
      n.innerHTML = `${cat}<span class="nm">${it.def.name}</span><span class="pr">¤ ${it.def.price}</span><span class="ds">${it.desc}</span>${i < 9 ? `<span class="key">[${i + 1}]</span>` : ''}`;
      n.addEventListener('mousedown', (e) => { e.stopPropagation(); this.game.buy(it.id); });
      this.el.buyItems.appendChild(n);
      return { ...it, node: n };
    });
    this.el.buyMenu.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  buyKey(index) {
    const it = this.buyEntries[index];
    if (it) this.game.buy(it.id);
  }

  refreshBuyMenu() {
    const p = this.game.player;
    this.el.buyCredits.textContent = `¤ ${p.credits}`;
    for (const it of this.abilityEntries || []) {
      const full = p.charges[it.k] >= it.kit.max;
      it.chg.textContent = `${p.charges[it.k]}/${it.kit.max}`;
      it.node.classList.toggle('owned', full);
      it.node.classList.toggle('poor', !full && p.credits < it.kit.price);
    }
    for (const it of this.buyEntries) {
      const owned = (it.def.slot && p.inv[it.def.slot]?.def.id === it.id) ||
        (it.id === 'light' && p.armor >= 25) || (it.id === 'heavy' && p.armor >= 50);
      it.node.classList.toggle('owned', !!owned);
      it.node.classList.toggle('poor', !owned && p.credits < it.def.price);
    }
  }

  showBuy(on) {
    this.el.buyMenu.classList.toggle('hidden', !on);
    if (on) this.refreshBuyMenu();
  }

  fps(text) {
    if (text === null) { this.el.fps.classList.add('hidden'); return; }
    this.el.fps.classList.remove('hidden');
    this.el.fps.textContent = text;
  }
}

function describe(d) {
  const notes = {
    bolt: 'Hand cannon', hornet: '3-round bursts', wasp: 'Run & gun', thunder: `${d.pellets} pellets · brutal up close`,
    raptor: 'Fast fire, easy spray', talon: 'One-tap headshots', bastion: '100-round belt, slow', needle: 'Cheap bolt-action · scope',
    arbiter: 'Semi-auto · scope', lynx: 'One-shot body · scope',
  };
  const per = d.pellets ? ' per pellet' : '';
  return `${notes[d.id] || d.category} · ${d.dmg.body} body / ${d.dmg.head} head${per} · ${d.mag} rds`;
}

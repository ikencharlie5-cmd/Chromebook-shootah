import { WEAPONS, ARMOR, BUY_LIST } from './weapons.js?v=20261031171522';
import { fmtTime } from './util.js?v=20261031171522';
import { ABILITY_INFO, iconSvg } from './agents.js?v=20261031171522';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = {};
    for (const id of ['hud', 'scoreAlly', 'scoreEnemy', 'roundTimer', 'roundLabel', 'aliveAlly', 'aliveEnemy',
      'minimap', 'killfeed', 'crosshair', 'hitmarker', 'dmgIndicator', 'redFlash', 'scope', 'centerMsg', 'subMsg',
      'progressWrap', 'progressLabel', 'progressFill', 'hint', 'spectate', 'armorVal', 'healthVal', 'credits',
      'coreTag', 'weaponName', 'ammoMag', 'ammoReserve', 'slots', 'scoreboard', 'buyMenu', 'buyItems', 'buyCredits', 'buyShields', 'buyDetail', 'buyLoadout',
      'sideTag', 'fps', 'lowHp', 'dmgNumbers', 'killBanner', 'kbTitle', 'kbName', 'deathCam', 'abilityBar', 'flashOverlay', 'odTint', 'smokeOverlay', 'buyAbilities', 'agentTag']) {
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

  setCrosshairStyle(len, thick, gap, dot, lines = true) {
    this.chLen = len; this.chGap = gap;
    const st = this.el.crosshair.style;
    st.setProperty('--chL', `${len}px`); st.setProperty('--chT', `${thick}px`);
    this.el.crosshair.classList.toggle('nodot', !dot);
    this.el.crosshair.classList.toggle('noline', !lines);
    this.cache.gap = null;
  }

  // ---- per frame ----

  update(dt) {
    const g = this.game, p = g.player;
    this.set('sa', this.el.scoreAlly, String(g.score[g.playerTeam]));
    this.set('se', this.el.scoreEnemy, String(g.score[1 - g.playerTeam]));
    if (!g.practice) this.set('rl', this.el.roundLabel, `ROUND ${g.round}`);

    let timer;
    const planted = g.core.state === 'planted';
    if (g.practice) {
      this.set('rt', this.el.roundTimer, '∞');
      this.set('rl', this.el.roundLabel, 'PRACTICE');
    }
    if (planted) timer = fmtTime(g.core.timer);
    else if (g.practice) timer = '∞';
    else if (g.phase === 'buy') timer = fmtTime(g.phaseT);
    else if (g.phase === 'live') timer = fmtTime(g.phaseT);
    else timer = '0:00';
    this.set('rt', this.el.roundTimer, timer);
    this.set('rtc', this.el.roundTimer, planted ? 'planted' : '', 'className');

    const side = g.sideOf(g.playerTeam);
    if (!g.practice) { this.el.sideTag.classList.remove('practice'); this.set('side', this.el.sideTag, side === 'ATK' ? 'ATTACKING' : 'DEFENDING'); }
    if (!g.practice) this.el.sideTag.style.color = side === 'ATK' ? '#ff9f6b' : '#7fc8ff';

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
    this.updateAce(dt);
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

  // floating damage number at a screen position
  damageNumber(x, y, amount, kind) {
    const n = document.createElement('div');
    n.className = 'dn ' + kind;
    n.textContent = Math.round(amount);
    n.style.left = `${x + (Math.random() - 0.5) * 30}px`;
    n.style.top = `${y}px`;
    this.el.dmgNumbers.appendChild(n);
    n.animate([{ transform: 'translate(-50%,-50%) scale(1.4)', opacity: 1 }, { transform: 'translate(-50%,-160%) scale(1)', opacity: 1, offset: 0.3 }, { transform: 'translate(-50%,-260%) scale(0.9)', opacity: 0 }],
      { duration: 900, easing: 'ease-out' }).onfinish = () => n.remove();
    while (this.el.dmgNumbers.children.length > 14) this.el.dmgNumbers.firstChild.remove();
  }

  ace() { this.aceT = 3.2; }

  // ACE overlay, animated from the game loop: flash, slam-in, spinning rays, fade out.
  updateAce(dt) {
    const el = this.aceEl || (this.aceEl = document.getElementById('aceScreen'));
    if (!(this.aceT > 0)) { if (el.style.opacity !== '0') el.style.opacity = '0'; return; }
    this.aceT -= dt;
    const t = 3.2 - this.aceT;
    el.style.opacity = String(Math.min(1, t / 0.15, Math.max(0, this.aceT) / 0.7));
    el.style.background = `rgba(255,230,140,${Math.max(0, 0.45 - t * 1.2)})`;
    const k = Math.min(1, t / 0.45), ease = 1 - Math.pow(1 - k, 3);
    el.querySelector('.ace-word').style.transform = `scale(${3 - 2 * ease})`;
    el.querySelector('.ace-rays').style.transform = `rotate(${t * 14}deg)`;
  }

  assistPop(name) {
    const n = document.createElement('div');
    n.className = 'assist-pop';
    n.innerHTML = `<b>ASSIST</b> ${name}<span>+¤50</span>`;
    this.el.hud.appendChild(n);
    setTimeout(() => n.remove(), 1600);
  }

  killBanner(name, streak) {
    const titles = ['ELIMINATED', 'DOUBLE KILL', 'TRIPLE KILL', 'TEAM WIPE'];
    this.el.kbTitle.textContent = titles[Math.min(streak - 1, titles.length - 1)];
    this.el.kbName.textContent = name.toUpperCase();
    this.el.killBanner.classList.toggle('streak', streak > 1);
    this.el.killBanner.classList.add('on');
    clearTimeout(this.kbTimer);
    this.kbTimer = setTimeout(() => this.el.killBanner.classList.remove('on'), 1800);
  }

  lowHealth(amount) {
    if (Math.abs((this.cache.lowHp ?? -1) - amount) < 0.02) return;
    this.cache.lowHp = amount;
    this.el.lowHp.style.opacity = amount;
  }

  deathCam(text) { this.set('dc', this.el.deathCam, text || ''); }

  crosshair(gap, visible) {
    this.el.crosshair.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const g = Math.round(Math.min(gap + (this.chGap ?? 3) - 3, 80));
    if (this.cache.gap === g) return;
    this.cache.gap = g;
    const L = this.chLen ?? 7;
    this.ch.top.style.top = `${-g - L}px`;
    this.ch.bottom.style.top = `${g}px`;
    this.ch.left.style.left = `${-g - L}px`;
    this.ch.right.style.left = `${g}px`;
  }

  practiceStats(text) {
    this.el.sideTag.classList.add('practice');
    this.set('side', this.el.sideTag, text);
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

  killfeed(killer, victim, weapon, head, assisters = []) {
    const g = this.game;
    const n = document.createElement('div');
    n.className = 'kf' + (killer?.isPlayer || victim.isPlayer || assisters.some((a) => a.isPlayer) ? ' mine' : '');
    n.dataset.t = performance.now();
    const cls = (c) => (c.team === g.playerTeam ? 'a' : 'e');
    n.innerHTML = killer
      ? `<span class="${cls(killer)}">${killer.name}</span>${assisters.map((a) => `<span class="as ${cls(a)}">+ ${a.name}</span>`).join('')}<span class="w">${weapon}</span>${head ? '<span class="hs">◎</span>' : ''}<span class="${cls(victim)}">${victim.name}</span>`
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
      if (!ally && (c.spotBy?.[g.playerTeam] || 0) < g.time) continue;
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
          <td>${c.name} <span class="ag">${c.agent.name}</span>${c.hasCore && team === g.playerTeam ? ' ◆' : ''}</td><td>${c.kills}</td><td>${c.deaths}</td><td>${c.assists || 0}</td><td>${Math.round(c.dmgDealt || 0)}</td>
          <td>${team === g.playerTeam ? '¤ ' + c.credits : ''}</td>
          <td>${team === g.playerTeam ? (c.inv.primary ? c.inv.primary.def.name : c.inv.secondary?.def.name ?? '') : ''}</td></tr>`)
        .join('');
      return `<table><tr><th>PLAYER</th><th>K</th><th>D</th><th>A</th><th>DMG</th><th>CREDITS</th><th>WEAPON</th></tr>${rows}</table>`;
    };
    el.innerHTML = `<div class="ally"><h3>YOUR TEAM · ${g.score[g.playerTeam]}</h3>${table(g.playerTeam)}</div>
      <div class="enemy"><h3>ENEMY TEAM · ${g.score[1 - g.playerTeam]}</h3>${table(1 - g.playerTeam)}</div>`;
  }

  // ---- buy menu ----

  // Buy menu laid out by category, with gun pictures, a stats panel and shields/abilities below.
  buildBuyMenu() {
    const COLS = [
      ['SIDEARMS', ['pip', 'bolt']], ['SMGS', ['hornet', 'wasp']], ['SHOTGUNS', ['thunder']],
      ['RIFLES', ['raptor', 'talon']], ['SNIPERS', ['needle', 'arbiter', 'lynx']], ['HEAVY', ['bastion']],
    ];
    const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Z', 'V'];
    this.buyEntries = [];
    let k = 0;
    for (const [title, ids] of COLS) {
      const col = document.createElement('div');
      col.className = 'buy-col';
      col.innerHTML = `<div class="buy-col-title">${title}</div>`;
      for (const id of ids) {
        const def = WEAPONS[id];
        const n = document.createElement('div');
        n.className = 'buy-item gun';
        n.innerHTML = `<div class="thumb"></div><div class="row"><span class="nm">${def.name}</span><span class="pr">${def.price ? '¤ ' + def.price : 'FREE'}</span></div>
          <span class="state"></span><span class="key">${KEYS[k] || ''}</span>`;
        this.addBuyHandlers(n, id, def, describe(def));
        col.appendChild(n);
        this.buyEntries.push({ id, def, node: n, thumb: n.querySelector('.thumb'), state: n.querySelector('.state'), key: KEYS[k++] });
      }
      this.el.buyItems.appendChild(col);
    }
    for (const id of ['light', 'heavy']) {
      const def = ARMOR[id];
      const n = document.createElement('div');
      n.className = 'buy-item shield';
      n.innerHTML = `<div class="shield-ic ${id}"></div><div><span class="nm">${def.name}</span><span class="pr">¤ ${def.price}</span><span class="ds">+${def.value} shield</span></div><span class="state"></span><span class="key">${KEYS[k] || ''}</span>`;
      this.addBuyHandlers(n, id, def, `Absorbs the next ${def.value} damage you take. Kept if you survive the round.`);
      this.el.buyShields.appendChild(n);
      this.buyEntries.push({ id, def, node: n, state: n.querySelector('.state'), key: KEYS[k++] });
    }
    this.keyMap = Object.fromEntries(this.buyEntries.map((it) => [it.key, it.id]));
    this.el.buyMenu.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  addBuyHandlers(n, id, def, desc) {
    n.addEventListener('mousedown', (e) => { e.stopPropagation(); this.game.buy(id); this.showDetail(id, def, desc); });
    n.addEventListener('mouseenter', () => this.showDetail(id, def, desc));
  }

  // Right-hand panel: what the item is and how it compares.
  showDetail(id, def, desc) {
    const el = this.el.buyDetail;
    const p = this.game.player;
    const owned = p && ((def.slot && p.inv[def.slot]?.def.id === id) || (id === 'light' && p.armor >= 25) || (id === 'heavy' && p.armor >= 50));
    const after = p ? p.credits - (def.price || 0) : 0;
    const afterHtml = owned ? '<div class="dt-after own">You already have this</div>'
      : `<div class="dt-after ${after < 0 ? 'neg' : ''}">${after < 0 ? `Need ¤ ${-after} more` : `After buying: ¤ ${after}`}</div>`;
    if (!def.dmg) {
      el.innerHTML = `<div class="dt-cat">SHIELD</div><div class="dt-name">${def.name}</div><p>${desc}</p>
        ${afterHtml}`;
      return;
    }
    const bar = (label, v, text) => `<div class="dt-stat"><span>${label}</span><div class="dt-bar"><i style="width:${Math.round(Math.max(0.04, Math.min(1, v)) * 100)}%"></i></div><b>${text}</b></div>`;
    const pellets = def.pellets ? ` ×${def.pellets}` : '';
    const acc = def.scope ? def.scopedSpread : def.spread;
    el.innerHTML = `<div class="dt-cat">${def.category}</div><div class="dt-name">${def.name}</div><p>${desc}</p>
      ${bar('Body damage', def.dmg.body * (def.pellets || 1) / 160, def.dmg.body + pellets)}
      ${bar('Head damage', def.dmg.head * (def.pellets || 1) / 260, def.dmg.head + pellets)}
      ${bar('Fire rate', def.rpm / 1100, `${def.rpm} rpm${def.burst ? ' (burst)' : ''}`)}
      ${bar('Magazine', def.mag / 100, `${def.mag}`)}
      ${bar('Accuracy', 1 - Math.min(1, acc / 0.06), def.scope ? 'scoped' : acc <= 0.004 ? 'high' : acc <= 0.01 ? 'medium' : 'low')}
      ${bar('Mobility', (def.speedMul - 0.75) / 0.3, `${Math.round(def.speedMul * 100)}%`)}
      ${afterHtml}`;
  }

  buyKey(key) {
    const id = this.keyMap?.[key];
    if (id) this.game.buy(id);
  }

  refreshBuyMenu() {
    const p = this.game.player;
    if (!p) return;
    this.el.buyCredits.textContent = `¤ ${p.credits}`;
    const prim = p.inv.primary?.def.name || '—', sec = p.inv.secondary?.def.name || '—';
    this.el.buyLoadout.innerHTML = `<span>PRIMARY <b>${prim}</b></span><span>SIDEARM <b>${sec}</b></span><span>SHIELD <b>${Math.ceil(p.armor)}</b></span>`;
    for (const it of this.abilityEntries || []) {
      const full = p.charges[it.k] >= it.kit.max;
      it.chg.textContent = `${p.charges[it.k]}/${it.kit.max}`;
      it.node.classList.toggle('owned', full);
      it.node.classList.toggle('poor', !full && p.credits < it.kit.price);
    }
    for (const it of this.buyEntries) {
      const owned = (it.def.slot && p.inv[it.def.slot]?.def.id === it.id) ||
        (it.id === 'light' && p.armor >= 25) || (it.id === 'heavy' && p.armor >= 50);
      const poor = !owned && p.credits < it.def.price;
      it.node.classList.toggle('owned', !!owned);
      it.node.classList.toggle('poor', poor);
      it.state.textContent = owned ? 'OWNED' : poor ? `NEED ¤ ${it.def.price - p.credits}` : '';
      // gun pictures in your equipped skin (rendered once per skin)
      if (it.thumb) {
        const sk = p.skins?.[it.id] || {};
        const key = `${it.id}|${sk.skin || 'factory'}`;
        if (it.thumbKey !== key) {
          it.thumbKey = key;
          this.thumbCache = this.thumbCache || {};
          if (!this.thumbCache[key]) {
            const cv = document.createElement('canvas');
            try { this.game.renderGunPreview(it.id, sk.skin || 'factory', sk.model, cv, 180, 70, 0.0); this.thumbCache[key] = cv.toDataURL(); } catch { this.thumbCache[key] = ''; }
          }
          it.thumb.style.backgroundImage = this.thumbCache[key] ? `url(${this.thumbCache[key]})` : '';
        }
      }
    }
  }

  showBuy(on) {
    this.el.buyMenu.classList.toggle('hidden', !on);
    if (on) {
      this.refreshBuyMenu();
      const p = this.game.player, cur = p?.inv.primary?.def || WEAPONS.talon;
      this.showDetail(cur.id, cur, describe(cur));
    }
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

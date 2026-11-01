// Everything drawn on top of the game: health, ammo, crosshair, hit markers,
// kill feed, damage numbers and the minimap.
import { drawMapTopDown } from './mapview.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(map) {
    this.map = map;
    this.root = $('hud');
    this.el = {
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      reloadbar: $('reloadbar'),
      reloadfill: $('reloadfill'),
      notice: $('notice'),
      vignette: $('vignette'),
      floaters: $('floaters'),
      feed: $('feed'),
      hpnum: $('hpnum'),
      hpfill: $('hpfill'),
      ammobox: $('ammobox'),
      slotbar: $('slotbar'),
      grenbox: $('grenbox'),
      grenname: $('grenname'),
      grenpips: $('grenpips'),
      grenregen: $('grenregen'),
      grenkey: $('grenkey'),
      flashfx: $('flashfx'),
      grenwarn: $('grenwarn'),
      abilbox: $('abilbox'),
      abilkey: $('abilkey'),
      abilname: $('abilname'),
      abilstate: $('abilstate'),
      abilfx: $('abilfx'),
      speedfx: $('speedfx'),
      healfx: $('healfx'),
      smokefx: $('smokefx'),
      scope: $('scope'),
      ammomag: $('ammomag'),
      ammores: $('ammores'),
      wname: $('wname'),
      wrarity: $('wrarity'),
      stats: $('stats'),
      minimap: $('minimap'),
      netnote: $('netnote'),
      kd: $('kd'),
      scoreboard: $('scoreboard'),
      sbbody: $('sbbody'),
      death: $('deathscreen'),
      deathby: $('deathby'),
      deathtimer: $('deathtimer'),
    };
    this.floaters = [];
    this.vignette = 0;
    this.noticeUntil = 0;
    this.showStats = true;
    this.showMinimap = true;
    this.lastStats = '';

    // Pre-draw the map once; the minimap just copies it and adds the player arrow.
    this.miniCtx = this.el.minimap.getContext('2d');
    this.miniSize = this.el.minimap.width;
    this.miniBg = document.createElement('canvas');
    this.miniBg.width = this.miniBg.height = this.miniSize;
    drawMapTopDown(this.miniBg.getContext('2d'), map, this.miniSize, { background: 'rgba(14,17,23,0.82)' });
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  /** A short line at the top of the screen (connecting, connection lost...). Empty text hides it. */
  setNetNote(text) {
    this.el.netnote.textContent = text || '';
    this.el.netnote.style.display = text ? 'block' : 'none';
  }

  /** Small kills / deaths line under the minimap (online only). */
  setKD(text) {
    this.el.kd.textContent = text || '';
  }

  /** The death screen. Pass null to hide it. */
  setDeath(info) {
    const d = this.el.death;
    if (!info) { d.classList.add('hidden'); return; }
    d.classList.remove('hidden');
    this.el.deathby.textContent = info.by ? 'Eliminated by ' + info.by : 'Eliminated';
    this.el.deathtimer.textContent = 'Respawning in ' + info.seconds.toFixed(1);
  }

  showScoreboard(on) { this.el.scoreboard.classList.toggle('hidden', !on); }

  /** rows: [{ name, kills, deaths, color, me }] */
  setScoreboard(rows) {
    const body = this.el.sbbody;
    body.textContent = '';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.me) tr.className = 'me';
      const cells = [String(i + 1), r.name, String(r.kills), String(r.deaths)];
      cells.forEach((txt, c) => {
        const td = document.createElement('td');
        td.textContent = txt;
        if (c === 1) {
          const sw = document.createElement('i');
          sw.style.background = r.color;
          td.prepend(sw);
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  setHealth(hp, max) {
    const pct = Math.max(0, Math.min(1, hp / max));
    this.el.hpnum.textContent = Math.max(0, Math.ceil(hp));
    this.el.hpfill.style.width = (pct * 100) + '%';
    this.el.hpfill.style.background = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#facc15' : '#ef4444';
  }

  setWeapon(name, rarityColor) {
    this.el.wname.textContent = name;
    this.el.wrarity.style.background = rarityColor;
    this.el.wrarity.style.color = rarityColor;
  }

  setAmmo(mag, reserve, magSize, melee) {
    const box = this.el.ammobox;
    box.classList.toggle('melee', !!melee);
    if (melee) {
      this.el.ammomag.textContent = '';
      this.el.ammores.textContent = '';
      box.classList.remove('low', 'empty');
      return;
    }
    this.el.ammomag.textContent = mag;
    this.el.ammores.textContent = reserve;
    box.classList.toggle('low', mag > 0 && mag <= Math.ceil(magSize * 0.3));
    box.classList.toggle('empty', mag === 0);
  }

  /** The three weapon slots at the bottom. items: [{ name, color }], cur = the one in hand. */
  setSlots(items, cur) {
    const sig = items.map((i) => i.name + i.color + i.key).join('|') + cur;
    if (sig === this.slotSig) return;
    this.slotSig = sig;
    const bar = this.el.slotbar;
    bar.textContent = '';
    items.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = 'slot' + (i === cur ? ' on' : '');
      d.style.setProperty('--c', it.color);
      const k = document.createElement('b');
      k.textContent = it.key || String(i + 1);
      const n = document.createElement('span');
      n.textContent = it.name;
      d.append(k, n);
      bar.appendChild(d);
    });
  }

  /** Godzilla's own controls: fire left, grab and stomp cooldowns. Pass null when you are not Godzilla. */
  setZilla(zl, Z, stompKey) {
    document.body.classList.toggle('zilla', !!zl);
    const box = document.getElementById('zbox');
    if (!zl) { box.hidden = true; return; }
    box.hidden = false;
    document.getElementById('zstompkey').textContent = stompKey || 'F';
    const set = (id, k, cd) => {
      const row = document.getElementById(id);
      row.querySelector('i').style.width = Math.max(0, Math.min(100, k * 100)).toFixed(0) + '%';
      row.classList.toggle('ready', cd <= 0 && k >= 0.99);
      row.classList.toggle('cool', cd > 0);
    };
    const fire = zl[0] / Z.BREATH.max;
    set('zfire', fire, 0);
    document.getElementById('zfire').classList.toggle('empty', zl[0] < Z.BREATH.min);
    set('zgrab', zl[1] > 0 ? 1 - zl[1] / Z.GRAB.cd : 1, zl[1]);
    set('zstomp', zl[2] > 0 ? 1 - zl[2] / Z.STOMP.cd : 1, zl[2]);
  }

  /** The big health bar at the top while a Godzilla is in the game. null hides it. */
  setBoss(hp, max) {
    const box = document.getElementById('zboss');
    if (hp === null) { box.hidden = true; return; }
    box.hidden = false;
    document.getElementById('zbhp').textContent = Math.max(0, Math.ceil(hp));
    document.getElementById('zbfill').style.width = Math.max(0, Math.min(100, hp / max * 100)).toFixed(1) + '%';
  }

  /** The grenade counter. regenLeft = seconds until the next one comes back (or 0). */
  setGrenade(name, color, count, max, regenLeft, keyLabel) {
    const sig = [name, color, count, max, regenLeft > 0 ? Math.ceil(regenLeft) : 0, keyLabel].join('|');
    if (sig === this.grenSig) return;
    this.grenSig = sig;
    const b = this.el.grenbox;
    b.style.setProperty('--c', color);
    b.classList.toggle('empty', count === 0);
    this.el.grenname.textContent = name;
    this.el.grenkey.textContent = keyLabel;
    this.el.grenpips.textContent = '';
    for (let i = 0; i < max; i++) {
      const p = document.createElement('i');
      if (i < count) p.className = 'on';
      this.el.grenpips.appendChild(p);
    }
    this.el.grenregen.textContent = count < max && regenLeft > 0 ? '+1 in ' + Math.ceil(regenLeft) + ' s' : '';
  }

  /**
   * The ability box. def = the ability, cd = seconds left (0 = ready), keyLabel = the key.
   * Passive abilities say ARMED when ready.
   */
  setAbility(def, color, cd, keyLabel) {
    const sig = [def.id, Math.ceil(cd * 4), keyLabel].join('|');
    if (sig === this.abilSig) return;
    this.abilSig = sig;
    const b = this.el.abilbox;
    b.style.setProperty('--c', color);
    b.style.setProperty('--p', cd > 0 ? Math.max(0, Math.min(100, (1 - cd / def.cd) * 100)).toFixed(1) : 100);
    b.classList.toggle('ready', cd <= 0);
    this.el.abilkey.textContent = def.passive ? '*' : keyLabel;
    this.el.abilname.textContent = def.name;
    this.el.abilstate.textContent = cd > 0 ? Math.ceil(cd) + ' s' : (def.passive ? 'ARMED' : 'READY');
  }

  /** Small coloured chips for effects that are active on you: [{ text, color }]. */
  setAbilityEffects(items) {
    const sig = items.map((i) => i.text).join('|');
    if (sig === this.fxSig) return;
    this.fxSig = sig;
    const box = this.el.abilfx;
    box.textContent = '';
    for (const it of items) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.style.background = it.color;
      c.textContent = it.text;
      box.appendChild(c);
    }
  }

  /** Screen effects: dash speed lines and the green glow of healing (0..1 each). */
  setAbilityScreenFx(speed, heal) {
    this.el.speedfx.style.opacity = speed > 0.005 ? speed.toFixed(3) : '0';
    this.el.healfx.style.opacity = heal > 0.005 ? heal.toFixed(3) : '0';
  }

  /** Red grenade icons. items = [{ x, y, on (on screen), angle, dist, close }], nearest first. */
  setGrenadeWarnings(items) {
    const root = this.el.grenwarn;
    if (!this.gwPool) this.gwPool = [];
    const SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="12" y="1" width="8" height="6" rx="1.5" fill="#ffffff"/><rect x="19" y="2" width="10" height="3.5" rx="1.7" fill="#ffffff" transform="rotate(22 19 4)"/><circle cx="29" cy="9" r="2.6" fill="none" stroke="#ffffff" stroke-width="1.6"/><circle cx="16" cy="19" r="11" fill="#e8281d" stroke="#ffffff" stroke-width="2"/><path d="M9 15 Q16 9 23 15" stroke="#ffb3ad" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
    while (this.gwPool.length < Math.min(6, items.length)) {
      const el = document.createElement('div');
      el.className = 'gw';
      el.innerHTML = '<div class="gwarrow"><i></i></div>' + SVG + '<span class="d"></span>';
      root.appendChild(el);
      this.gwPool.push({ el, arrow: el.querySelector('.gwarrow'), d: el.querySelector('.d') });
    }
    for (let i = 0; i < this.gwPool.length; i++) {
      const p = this.gwPool[i], it = items[i];
      if (!it || i >= 6) { if (p.shown) { p.el.style.display = 'none'; p.shown = false; } continue; }
      if (!p.shown) { p.el.style.display = 'flex'; p.shown = true; }
      p.el.style.transform = 'translate(' + it.x.toFixed(1) + 'px,' + it.y.toFixed(1) + 'px)';
      p.el.classList.toggle('close', it.close);
      p.arrow.style.display = it.on ? 'none' : 'block';
      if (!it.on) p.arrow.style.transform = 'rotate(' + (it.angle * 180 / Math.PI + 90).toFixed(0) + 'deg)';
      const txt = Math.round(it.dist) + ' m';
      if (p.d.textContent !== txt) p.d.textContent = txt;
    }
  }

  /** White-out from a flashbang (0 clear, 1 totally white) and grey-out inside smoke. */
  setScreenFx(flash, smoke) {
    this.el.flashfx.style.opacity = flash > 0.002 ? flash.toFixed(3) : '0';
    this.el.smokefx.style.opacity = smoke > 0.002 ? smoke.toFixed(3) : '0';
  }

  /** Scope overlay for the sniper and the rail cannon. amount 0..1 (fully aimed = 1). */
  setScope(amount, color) {
    const on = amount > 0.9;
    this.el.scope.classList.toggle('hidden', !on);
    if (on && color) this.el.scope.style.setProperty('--sc', color);
  }

  /** progress 0..1 while reloading, or null when not reloading */
  setReload(progress) {
    if (progress === null) {
      this.el.reloadbar.style.display = 'none';
    } else {
      this.el.reloadbar.style.display = 'block';
      this.el.reloadfill.style.width = (progress * 100) + '%';
    }
  }

  notice(text, seconds, now) {
    this.el.notice.textContent = text;
    this.noticeUntil = text ? now + (seconds || 1.2) : 0;
  }

  setCrosshair(gapPx, ads, sprinting) {
    this.el.crosshair.style.setProperty('--gap', gapPx.toFixed(1) + 'px');
    this.el.crosshair.classList.toggle('ads', ads);
    this.el.crosshair.classList.toggle('sprint', sprinting);
  }

  /** kind: 'body' | 'head' | 'kill' */
  hitMarker(kind) {
    const h = this.el.hitmarker;
    h.className = '';
    void h.offsetWidth;            // restart the animation
    h.className = 'show' + (kind === 'head' ? ' head' : kind === 'kill' ? ' kill' : '');
  }

  feed(text, color, now) {
    const line = document.createElement('div');
    line.className = 'line';
    line.textContent = text;
    if (color) line.style.borderRightColor = color;
    this.el.feed.appendChild(line);
    while (this.el.feed.children.length > 5) this.el.feed.removeChild(this.el.feed.firstChild);
    setTimeout(() => line.classList.add('fade'), 3500);
    setTimeout(() => line.remove(), 4200);
  }

  damageFlash(amount) {
    this.vignette = Math.min(1, this.vignette + amount);
  }

  /** Floating number at a screen position (pixels). */
  floater(text, color, x, y) {
    const el = document.createElement('div');
    el.className = 'fl';
    el.textContent = text;
    el.style.color = color;
    this.el.floaters.appendChild(el);
    this.floaters.push({ el, x: x + (Math.random() - 0.5) * 30, y, life: 0.8, age: 0 });
    while (this.floaters.length > 14) {
      const old = this.floaters.shift();
      old.el.remove();
    }
  }

  setStats(text) {
    if (!this.showStats) {
      if (this.lastStats !== '') { this.el.stats.textContent = ''; this.lastStats = ''; }
      return;
    }
    if (text !== this.lastStats) {
      this.el.stats.textContent = text;
      this.lastStats = text;
    }
  }

  toggleStats() { this.showStats = !this.showStats; }

  toggleMinimap() {
    this.showMinimap = !this.showMinimap;
    this.el.minimap.style.display = this.showMinimap ? 'block' : 'none';
  }

  drawMinimap(px, pz, yaw) {
    if (!this.showMinimap) return;
    const c = this.miniCtx, size = this.miniSize;
    c.clearRect(0, 0, size, size);
    c.drawImage(this.miniBg, 0, 0);
    const x = (px + this.map.width / 2) * size / this.map.width;
    const y = (pz + this.map.depth / 2) * size / this.map.depth;
    c.save();
    c.translate(x, y);
    c.rotate(-yaw);                     // yaw 0 looks north (up on the minimap)
    c.fillStyle = '#ffffff';
    c.strokeStyle = 'rgba(0,0,0,0.8)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(5, 5);
    c.lineTo(0, 2);
    c.lineTo(-5, 5);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  tick(dt, now) {
    // red damage vignette fades out
    if (this.vignette > 0) {
      this.vignette = Math.max(0, this.vignette - dt * 1.4);
      this.el.vignette.style.opacity = this.vignette.toFixed(3);
    }
    if (this.noticeUntil && now > this.noticeUntil) {
      this.el.notice.textContent = '';
      this.noticeUntil = 0;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      if (f.age >= f.life) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const k = f.age / f.life;
      f.el.style.transform = 'translate(' + (f.x).toFixed(1) + 'px,' + (f.y - 46 * k).toFixed(1) + 'px) translate(-50%,-50%)';
      f.el.style.left = '0';
      f.el.style.top = '0';
      f.el.style.opacity = (1 - k * k).toFixed(2);
    }
  }
}

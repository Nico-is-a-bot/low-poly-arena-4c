// The loadout screen: pick a primary, a secondary and a melee weapon, see their stats and
// turn a 3D model around. Everything is unlocked for now.
import * as THREE from 'three';
import { buildWeaponModel, buildGrenadeModel, buildAbilityIcon } from './weaponModels.js';

const $ = (id) => document.getElementById(id);

const BARS = [
  ['damage', 'Damage'], ['fireRate', 'Fire rate'], ['magazine', 'Magazine'], ['reserve', 'Reserve ammo'],
  ['reload', 'Reload speed'], ['recoil', 'Recoil', true], ['range', 'Range'], ['aimSpeed', 'Aim speed'], ['speed', 'Move speed'],
];
const ABILITY_BARS = [['cooldown', 'Quick cooldown'], ['power', 'Strength'], ['duration', 'Lasts']];
const GRENADE_BARS = [['damage', 'Damage'], ['radius', 'Radius'], ['fuse', 'Quick fuse'], ['duration', 'Lasts']];
const MELEE_BARS = [['damage', 'Damage'], ['fireRate', 'Swing speed'], ['range', 'Reach'], ['speed', 'Move speed']];

function describe(w) {
  if (isAbility(w)) return w.note + (w.passive ? ' (No button: it works by itself.)' : '') + ' Cooldown ' + w.cd + ' s.';
  if (w.kind) return w.note + ' You carry 2 and get 1 back every 30 s. Throw with G (hold to see the arc).';
  if (w.type === 'melee') {
    return w.damage + ' damage, ' + w.backstabDamage + ' from behind (instant kill). ' + (60 / w.swing).toFixed(0) + ' swings per minute, ' + w.range + ' m reach. ' +
      'Carrying it makes you ' + Math.round((w.weight - 1) * 100) + '% faster. Hold crouch + jump + sprint to bunny hop.';
  }
  const parts = [];
  parts.push(w.pellets > 1 ? w.pellets + ' pellets x ' + w.damage + ' damage' : w.damage + ' damage');
  parts.push(w.fireMode === 'burst' ? w.burst.count + '-round burst' : w.fireMode === 'pump' ? w.rpm + ' rpm, pump action' :
    w.fireMode === 'bolt' ? w.rpm + ' rpm, bolt action' : w.fireMode === 'semi' ? w.rpm + ' rpm, semi-auto' :
    w.fireMode === 'single' ? (60 / w.rpm).toFixed(0) + ' s between shots' : w.rpm + ' rpm, automatic');
  parts.push(w.mag + ' / ' + w.reserve + ' ammo');
  parts.push(w.reloadMode === 'shell' ? w.shellTime + ' s per shell' : w.reloadTime + ' s reload');
  let text = parts.join(', ') + '.';
  if (w.weight !== 1) text += ' Move speed ' + (w.weight > 1 ? '+' : '') + Math.round((w.weight - 1) * 100) + '%.';
  if (w.note) text += ' ' + w.note;
  return text;
}

const isAbility = (w) => w && w.cd !== undefined && !w.kind && w.type === undefined;
function abilityBars(a) {
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
  const power = { dash: 40, heal: 35, airdash: 45, armor: 50, scan: 55, grapple: 65, shield: 70, surge: 75, mine: 85, cloak: 90, orbital: 100, secondwind: 100 }[a.id] || 50;
  return { cooldown: clamp((1 - a.cd / 90) * 100), power, duration: clamp(((a.dur || a.boostDur || a.maxTime || 0.4) / 10) * 100) };
}

function grenadeBars(g) {
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
  return {
    damage: clamp((g.damage || (g.dps ? g.dps * 5 / 1.2 : 0)) / 0.8),
    radius: clamp((g.radius || (g.range ? g.range / 4 : 0)) * 20),
    fuse: clamp((1 - (g.fuse - 1) / 2) * 100),
    duration: clamp((g.duration || (g.maxBlind || 0.3)) * 12),
  };
}

export class LoadoutScreen {
  constructor(opts) {
    this.Weapons = opts.Weapons;
    this.get = opts.getLoadout;
    this.onChange = opts.onChange;
    this.onClose = opts.onClose;
    this.root = $('loadout');
    this.canvas = $('loPreview');
    this.shown = null;          // the weapon being previewed
    this.running = false;
    this.rot = 0.6;
    this.dragging = false;
    this.renderer = null;
    this.cache = new Map();
    this.build();
    $('loDone').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => { if (this.isOpen && e.code === 'Escape') this.close(); });
  }

  get isOpen() { return !this.root.classList.contains('hidden'); }

  build() {
    const W = this.Weapons;
    this.items = new Map();
    for (const col of this.root.querySelectorAll('.lo-col')) {
      const slot = col.dataset.slot;
      const list = col.querySelector('.lo-list');
      list.textContent = '';
      for (const w of (slot === 'grenade' ? W.allGrenades() : slot === 'ability' ? W.allAbilities() : W.forSlot(slot))) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lo-item';
        b.dataset.id = w.id;
        b.style.setProperty('--c', W.RARITY[w.rarity].color);
        const n = document.createElement('span'); n.className = 'n'; n.textContent = w.name;
        const r = document.createElement('span'); r.className = 'r'; r.textContent = W.RARITY[w.rarity].name;
        b.append(n, r);
        b.addEventListener('click', () => this.choose(slot, w.id));
        b.addEventListener('mouseenter', () => this.show(w));
        b.addEventListener('mouseleave', () => this.show(slot === 'grenade' ? W.grenade(this.get().grenade) : slot === 'ability' ? W.ability(this.get().ability) : W.get(this.get()[slot])));
        list.appendChild(b);
        this.items.set(w.id, b);
      }
    }
  }

  ensureRenderer() {
    if (this.renderer) return true;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    } catch (e) {
      this.renderer = null;
      return false;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.canvas.width, this.canvas.height, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, this.canvas.width / this.canvas.height, 0.1, 20);
    this.camera.position.set(0, 0.25, 3.4);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#445066', 2.2));
    const key = new THREE.DirectionalLight('#fff4e0', 2.4);
    key.position.set(2, 3, 3);
    this.scene.add(key);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => { if (this.dragging) { this.rot += (e.clientX - this.lastX) * 0.012; this.lastX = e.clientX; } });
    const stop = () => { this.dragging = false; };
    c.addEventListener('pointerup', stop);
    c.addEventListener('pointercancel', stop);
    return true;
  }

  modelFor(w) {
    let m = this.cache.get(w.id);
    if (!m) {
      const built = isAbility(w) ? buildAbilityIcon(w) : w.kind ? buildGrenadeModel(w) : buildWeaponModel(w, this.Weapons.RARITY[w.rarity].color, false);
      const holder = new THREE.Group();
      holder.add(built.group);
      const box = new THREE.Box3().setFromObject(built.group);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      built.group.position.sub(centre);
      const s = (isAbility(w) ? 1.3 : w.kind ? 1.3 : 2.6) / Math.max(size.x, size.y, size.z, 0.02);
      holder.scale.setScalar(s);
      holder.rotation.y = Math.PI / 2;          // side view, muzzle to the left
      const outer = new THREE.Group();
      outer.add(holder);
      m = outer;
      this.cache.set(w.id, m);
    }
    return m;
  }

  /** Show a weapon's model, stats and description. */
  show(w) {
    this.shown = w;
    const W = this.Weapons;
    $('loName').textContent = w.name;
    $('loRarity').textContent = W.RARITY[w.rarity].name;
    $('loRarity').style.color = W.RARITY[w.rarity].color;
    $('loInfo').textContent = describe(w);
    const bars = isAbility(w) ? abilityBars(w) : w.kind ? grenadeBars(w) : W.statBars(w);
    const box = $('loStats');
    box.textContent = '';
    for (const [key, label, bad] of (isAbility(w) ? ABILITY_BARS : w.kind ? GRENADE_BARS : w.type === 'melee' ? MELEE_BARS : BARS)) {
      const l = document.createElement('span'); l.className = 'lbl'; l.textContent = label;
      const bar = document.createElement('span'); bar.className = 'bar' + (bad ? ' bad' : '');
      const fill = document.createElement('i'); fill.style.width = bars[key] + '%';
      bar.appendChild(fill);
      box.append(l, bar);
    }
    if (this.ensureRenderer()) {
      while (this.pivot.children.length) this.pivot.remove(this.pivot.children[0]);
      this.pivot.add(this.modelFor(w));
    }
  }

  refresh() {
    const lo = this.get();
    for (const [id, el] of this.items) {
      el.classList.toggle('on', lo.primary === id || lo.secondary === id || lo.melee === id || lo.grenade === id || lo.ability === id);
    }
  }

  choose(slot, id) {
    const lo = Object.assign({}, this.get());
    lo[slot] = id;
    this.onChange(lo);
    this.refresh();
    this.show(this.Weapons.exists(id) ? this.Weapons.get(id) : this.Weapons.grenadeExists(id) ? this.Weapons.grenade(id) : this.Weapons.ability(id));
  }

  setNote(text) {
    const n = $('loNote');
    n.textContent = text || '';
    n.classList.toggle('hidden', !text);
  }

  open() {
    this.root.classList.remove('hidden');
    this.refresh();
    const lo = this.get();
    this.show(this.Weapons.get(lo.primary));
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (!this.renderer) return;
      if (!this.dragging) this.rot += 0.008;
      this.pivot.rotation.y = this.rot;
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  close() {
    this.running = false;
    this.root.classList.add('hidden');
    if (this.onClose) this.onClose();
  }
}

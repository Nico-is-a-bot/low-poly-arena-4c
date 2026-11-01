// Everything you see of grenades: the grenade in the air, the throw arc, explosions,
// flash bursts, smoke clouds and fire on the ground.
import * as THREE from 'three';
import { buildGrenadeModel } from './weaponModels.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const MAX_ZONES = 8;
const HEAT_HOT = new THREE.Color('#fff0a8'), HEAT_MID = new THREE.Color('#ff9d2b'), HEAT_COLD = new THREE.Color('#d63a14');

// Soft textures painted in code (no image files)
let smokeTex = null, flameTex = null, emberTex = null;
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function getSmokeTex() {
  if (!smokeTex) smokeTex = canvasTex(128, (g, s) => {
    // several soft blobs on top of each other make a lumpy puff instead of a perfect circle
    const blobs = [[0.5, 0.5, 0.46], [0.36, 0.44, 0.3], [0.64, 0.46, 0.3], [0.48, 0.64, 0.28], [0.5, 0.34, 0.26]];
    for (const [x, y, r] of blobs) {
      const gr = g.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(0.55, 'rgba(255,255,255,0.28)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    }
  });
  return smokeTex;
}
function getFlameTex() {
  if (!flameTex) flameTex = canvasTex(128, (g, s) => {
    g.translate(s / 2, s * 0.58);
    g.scale(0.62, 1);                                   // a tall teardrop
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.46);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, -s * 0.56);                             // the tip
    g.bezierCurveTo(s * 0.5, -s * 0.1, s * 0.4, s * 0.45, 0, s * 0.45);
    g.bezierCurveTo(-s * 0.4, s * 0.45, -s * 0.5, -s * 0.1, 0, -s * 0.56);
    g.fill();
  });
  return flameTex;
}
function getEmberTex() {
  if (!emberTex) emberTex = canvasTex(32, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  return emberTex;
}
function sprite(tex, color, opacity, additive) {
  const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const s = new THREE.Sprite(m);
  return s;
}
function disposeGroup(group) {
  group.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); });
}

export class GrenadeWorld {
  /**
   * scene: the world scene. Weapons: shared weapons module (for grenade definitions).
   * effects: the Effects object (sparks). shake(amount): optional camera shake callback.
   */
  constructor(scene, Weapons, effects, shake) {
    this.scene = scene;
    this.W = Weapons;
    this.effects = effects;
    this.shake = shake || (() => {});
    this.meshes = new Map();       // grenade id -> { group, target, flame, spin }
    this.zones = [];               // smoke clouds and fires
    this.bursts = [];              // short flashes and fireballs
    this.models = new Map();
    this.t = 0;

    // The throw preview: a straight line to where it lands, a circle around the landing spot,
    // and one short line for the bounce afterwards
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    this.arcLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthTest: false, fog: false }));
    this.arcLine.frustumCulled = false;
    this.arcLine.renderOrder = 8;
    this.arcLine.visible = false;
    scene.add(this.arcLine);
    this.arcDots = new THREE.Points(lineGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 6, sizeAttenuation: false, transparent: true, opacity: 1, depthTest: false, fog: false }));
    this.arcDots.frustumCulled = false;
    this.arcDots.renderOrder = 8;
    this.arcDots.visible = false;
    scene.add(this.arcDots);
  }

  // ------------------------------------------------------------ the grenade itself

  modelFor(type) {
    let m = this.models.get(type);
    if (!m) { m = buildGrenadeModel(this.W.grenade(type)); this.models.set(type, m); }
    return m;
  }

  /**
   * Show exactly these grenades. list = [{ id, type, x, y, z, stuck }].
   * smooth = true blends towards the new positions (network snapshots arrive 30 times a second).
   */
  sync(list, smoothMove) {
    const seen = new Set();
    for (const g of list) {
      seen.add(g.id);
      let e = this.meshes.get(g.id);
      if (!e) {
        const built = buildGrenadeModel(this.W.grenade(g.type));
        built.group.scale.setScalar(1.5);
        built.group.position.set(g.x, g.y, g.z);
        this.scene.add(built.group);
        e = { group: built.group, flame: built.flame, tx: g.x, ty: g.y, tz: g.z, stuck: false, spin: 8 + Math.random() * 6, type: g.type, blink: 0, born: this.t, mine: !!g.mine };
        this.meshes.set(g.id, e);
      }
      e.tx = g.x; e.ty = g.y; e.tz = g.z;
      e.stuck = !!g.stuck;
      e.mine = !!g.mine;
      e.snap = !smoothMove;
    }
    for (const [id, e] of this.meshes) {
      if (!seen.has(id)) { this.scene.remove(e.group); this.meshes.delete(id); }
    }
  }

  clear() {
    for (const e of this.meshes.values()) this.scene.remove(e.group);
    this.meshes.clear();
    for (const z of this.zones) { this.scene.remove(z.group); disposeGroup(z.group); }
    this.zones.length = 0;
    for (const b of this.bursts) this.scene.remove(b.mesh);
    this.bursts.length = 0;
    this.showArc(null);
  }

  // ------------------------------------------------------------ the throw preview

  /**
   * from = [x, y, z] (your hand), preview = { impact, after } from the shared previewImpact(),
   * color = CSS colour. Pass null to hide it. (radius is accepted but not drawn for now.)
   */
  showArc(from, preview, radius, color) {
    if (!from || !preview) {
      this.arcLine.visible = this.arcDots.visible = false;
      return;
    }
    const pos = this.arcLine.geometry.attributes.position;
    const im = preview.impact, af = preview.after;
    pos.setXYZ(0, from[0], from[1], from[2]);
    pos.setXYZ(1, im[0], im[1], im[2]);
    pos.needsUpdate = true;
    this.arcLine.geometry.setDrawRange(0, 2);      // one line: where it is going
    for (const m of [this.arcLine.material, this.arcDots.material]) m.color.set(color || '#ffffff');
    this.arcLine.visible = this.arcDots.visible = true;
  }

  // ------------------------------------------------------------ explosions and zones

  burst(color, from, to, seconds, y, shape) {
    const geo = shape === 'ring' ? new THREE.RingGeometry(0.8, 1, 28) : new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    if (shape === 'ring') mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 6;
    this.scene.add(mesh);
    const b = { mesh, from, to, seconds, age: 0, y };
    mesh.position.y = y;
    this.bursts.push(b);
    return b;
  }

  /** Something went off. type = grenade id, (x, y, z) where, radius and duration come from the server. */
  boom(type, x, y, z, radius, duration, distanceToCamera) {
    const def = this.W.grenade(type);
    const near = clamp(1 - distanceToCamera / 25, 0, 1);
    if (def.kind === 'frag' || def.kind === 'sticky') {
      const col = def.kind === 'sticky' ? '#7fb2ff' : '#ff9a2e';
      for (const [c, rad, secs] of [[col, radius * 0.42, 0.4], ['#fff1b0', radius * 0.24, 0.25]]) {
        const b = this.burst(c, 0.2, rad, secs, y);
        b.mesh.position.x = x; b.mesh.position.z = z;
      }
      const ring = this.burst('#ffd9a0', 0.4, radius, 0.4, Math.max(0.06, y - 0.05), 'ring');
      ring.mesh.position.x = x; ring.mesh.position.z = z;
      const p = new THREE.Vector3(x, y, z), n = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < 4; i++) this.effects.impact(p, n, i % 2 ? '#3a3f47' : '#ffb347', true);
      this.shake(near * 0.9);
      this.addPuff(x, y, z, '#3a3a3e', 1.4);
    } else if (def.kind === 'flash') {
      const b = this.burst('#ffffff', 0.3, 2.6, 0.3, y);
      b.mesh.position.x = x; b.mesh.position.z = z;
      this.shake(near * 0.3);
    } else if (def.kind === 'smoke') {
      this.addSmoke(x, y, z, radius, duration);
    } else if (def.kind === 'incendiary') {
      const b = this.burst('#ff8a1f', 0.3, radius * 0.35, 0.3, y);
      b.mesh.position.x = x; b.mesh.position.z = z;
      this.addFire(x, y, z, radius, duration);
      this.shake(near * 0.4);
    }
  }

  addPuff(x, y, z, color, size) {
    const b = this.burst(color, 0.3, size, 1.2, y + 0.3);
    b.mesh.position.x = x; b.mesh.position.z = z;
    b.mesh.material.opacity = 0.7;
    b.slow = true;
    b.rise = 1.2;
  }

  trimZones() {
    while (this.zones.length > MAX_ZONES) {
      const z = this.zones.shift();
      this.scene.remove(z.group);
      disposeGroup(z.group);
    }
  }

  addSmoke(x, y, z, radius, duration) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const tex = getSmokeTex();
    const tints = ['#c4c8ce', '#aab0b8', '#d6d9dd', '#9aa0a9'];
    const puffs = [];
    const count = 90;
    for (let i = 0; i < count; i++) {
      // spread over a squashed dome: wide and low, thinner towards the top
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * radius * 0.82;
      const h = (0.4 + Math.random() * 3.0) * (1 - (rr / radius) * 0.45);
      const sp = sprite(tex, tints[i % tints.length], 0.9, false);
      sp.material.rotation = Math.random() * 6.28;
      const size = 2.4 + Math.random() * 1.8;
      sp.position.set(0, 0.5, 0);
      group.add(sp);
      puffs.push({ sp, size, spin: (Math.random() - 0.5) * 0.35, delay: Math.random() * 0.45, home: new THREE.Vector3(Math.cos(a) * rr, h, Math.sin(a) * rr), phase: Math.random() * 10 });
    }
    this.scene.add(group);
    this.zones.push({ kind: 'smoke', group, puffs, x, y, z, r: radius, life: duration, age: 0 });
    this.trimZones();
  }

  addFire(x, y, z, radius, duration) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), new THREE.MeshBasicMaterial({ color: '#120905', transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.03;
    group.add(scorch);
    const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.92, 24), new THREE.MeshBasicMaterial({ color: '#ff5a1a', transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    glowDisc.rotation.x = -Math.PI / 2;
    glowDisc.position.y = 0.04;
    group.add(glowDisc);
    // flames: soft teardrop sprites that rise, shrink and cool from yellow to red
    const flames = [];
    const ftex = getFlameTex();
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * radius * 0.96;
      const sp = sprite(ftex, '#ffb347', 1, true);
      group.add(sp);
      flames.push({ sp, home: new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr), life: 0.7 + Math.random() * 0.6, off: Math.random() * 2, size: 0.9 + Math.random() * 0.9, rise: 1.0 + Math.random() * 0.9, sway: Math.random() * 6 });
    }
    // sparks
    const embers = [];
    const etex = getEmberTex();
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * radius * 0.9;
      const sp = sprite(etex, '#ffd27a', 1, true);
      group.add(sp);
      embers.push({ sp, home: new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr), life: 1.2 + Math.random() * 1.2, off: Math.random() * 3, rise: 2 + Math.random() * 2.5, sway: Math.random() * 6 });
    }
    // dark smoke drifting up from the fire
    const wisps = [];
    const stex = getSmokeTex();
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * radius * 0.7;
      const sp = sprite(stex, '#2b2b2e', 0.35, false);
      group.add(sp);
      wisps.push({ sp, home: new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr), life: 2 + Math.random(), off: Math.random() * 3, size: 1.6 + Math.random() * 1.2 });
    }
    this.scene.add(group);
    this.zones.push({ kind: 'fire', group, flames, embers, wisps, glowDisc, scorch, x, y, z, r: radius, life: duration, age: 0 });
    this.trimZones();
  }

  /** How thick the smoke is around a point (0 clear, 1 solid). Used to grey out your screen inside a cloud. */
  smokeAt(x, y, z) {
    let best = 0;
    for (const zn of this.zones) {
      if (zn.kind !== 'smoke') continue;
      const d = Math.hypot(x - zn.x, z - zn.z);
      if (d > zn.r || y > zn.y + 4.2) continue;
      const grow = smooth(0.2, 1.6, zn.age);
      const fade = 1 - smooth(zn.life - 2, zn.life, zn.age);
      best = Math.max(best, clamp(1.15 - d / zn.r * 0.8, 0, 1) * grow * fade);
    }
    return best;
  }

  // ------------------------------------------------------------ every frame

  update(dt) {
    this.t += dt;
    for (const e of this.meshes.values()) {
      const k = e.snap ? 1 : Math.min(1, dt * 22);
      const g = e.group;
      g.position.x += (e.tx - g.position.x) * k;
      g.position.y += (e.ty - g.position.y) * k;
      g.position.z += (e.tz - g.position.z) * k;
      if (!e.stuck) { g.rotation.x += e.spin * dt; g.rotation.z += e.spin * 0.6 * dt; }
      if (e.flame) e.flame.scale.y = 0.7 + 0.6 * Math.abs(Math.sin(this.t * 18));
      if (e.stuck) { e.blink += dt; g.scale.setScalar(1.5 + 0.12 * Math.sin(e.blink * 14)); }
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const k = b.age / b.seconds;
      if (k >= 1) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); this.bursts.splice(i, 1); continue; }
      const ease = 1 - (1 - k) * (1 - k);
      b.mesh.scale.setScalar(b.from + (b.to - b.from) * ease);
      b.mesh.material.opacity = (b.slow ? 0.7 : 1) * (1 - k * k);
      if (b.rise) b.mesh.position.y = b.y + b.rise * k;
    }

    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.age += dt;
      if (z.age >= z.life) {
        this.scene.remove(z.group);
        disposeGroup(z.group);
        this.zones.splice(i, 1);
        continue;
      }
      if (z.kind === 'smoke') {
        const fade = 1 - smooth(z.life - 2.2, z.life, z.age);
        for (const p of z.puffs) {
          const grow = smooth(0, 1.3, z.age - p.delay);
          const swirl = this.t * 0.25 + p.phase;
          p.sp.position.set(
            p.home.x * grow + Math.cos(swirl) * 0.25,
            0.4 + (p.home.y - 0.4) * grow + 0.12 * Math.sin(this.t * 0.6 + p.phase),
            p.home.z * grow + Math.sin(swirl) * 0.25);
          const s = p.size * (0.35 + 0.65 * grow) * (1 + 0.06 * Math.sin(this.t * 0.8 + p.phase));
          p.sp.scale.set(s, s, 1);
          p.sp.material.rotation += p.spin * dt;
          p.sp.material.opacity = 0.9 * fade * smooth(0, 0.5, z.age - p.delay);
        }
      } else {
        const fade = 1 - smooth(z.life - 1.2, z.life, z.age);
        const ramp = smooth(0, 0.7, z.age);
        z.glowDisc.material.opacity = 0.22 * fade * ramp * (0.8 + 0.2 * Math.sin(this.t * 11));
        z.scorch.material.opacity = 0.6 * fade;
        const col = this.tmpColor || (this.tmpColor = new THREE.Color());
        for (const f of z.flames) {
          const k = ((this.t + f.off) % f.life) / f.life;           // 0 at the bottom, 1 at the top
          const heat = col.copy(HEAT_HOT).lerp(k < 0.5 ? HEAT_MID : HEAT_COLD, smooth(0, 0.8, k));
          f.sp.material.color.copy(heat);
          const w = f.size * (0.6 + 0.5 * Math.sin(Math.PI * Math.min(1, k * 1.2)));
          f.sp.scale.set(w * 0.8, w * 1.5, 1);
          f.sp.position.set(f.home.x + Math.sin(this.t * 3 + f.sway) * 0.12 * k, 0.2 + f.rise * k, f.home.z + Math.cos(this.t * 2.6 + f.sway) * 0.12 * k);
          f.sp.material.opacity = (1 - k * k) * fade * ramp;
        }
        for (const e of z.embers) {
          const k = ((this.t + e.off) % e.life) / e.life;
          e.sp.position.set(e.home.x + Math.sin(this.t * 2 + e.sway) * 0.5 * k, 0.3 + e.rise * k, e.home.z + Math.cos(this.t * 1.7 + e.sway) * 0.5 * k);
          e.sp.scale.setScalar(0.12 * (1 - k * 0.6));
          e.sp.material.opacity = (1 - k) * fade * ramp;
        }
        for (const w of z.wisps) {
          const k = ((this.t + w.off) % w.life) / w.life;
          w.sp.position.set(w.home.x + Math.sin(this.t * 0.7 + w.off * 5) * 0.4, 1.0 + 2.6 * k, w.home.z);
          const s = w.size * (0.5 + k);
          w.sp.scale.set(s, s, 1);
          w.sp.material.opacity = 0.3 * Math.sin(Math.PI * k) * fade * ramp;
        }
      }
    }
  }
}

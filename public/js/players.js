// Other players: low-poly bodies, name tags, and smooth movement between server snapshots.
import * as THREE from 'three';
import { buildWeaponModel } from './weaponModels.js';
import { ZillaRig } from './zillaModel.js';

export const SLOT_COLORS = ['#e0533d', '#3b82f6', '#f2c230', '#43c06b'];
const BUFFER_MS = 1200;
const FALL_TIME = 0.4;
const LEAN_DIST = (window.ArenaShared && window.ArenaShared.Physics) ? window.ArenaShared.Physics.C.LEAN_DIST : 0.35;

const boxGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const GEO = {
  thigh: boxGeo(0.21, 0.4, 0.25),
  shin: boxGeo(0.19, 0.4, 0.23),
  boot: boxGeo(0.2, 0.1, 0.34),
  belt: boxGeo(0.54, 0.07, 0.32),
  torso: boxGeo(0.52, 0.64, 0.3),
  head: boxGeo(0.4, 0.4, 0.4),
  arm: boxGeo(0.14, 0.14, 0.52),
  visor: boxGeo(0.34, 0.1, 0.04),
};

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function makeTag(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = '700 30px ui-sans-serif, system-ui, Arial, sans-serif';
  const w = Math.min(244, g.measureText(name).width + 34);
  const x = (256 - w) / 2;
  g.fillStyle = 'rgba(8,10,14,0.7)';
  g.beginPath();
  g.roundRect(x, 8, w, 48, 12);
  g.fill();
  g.fillStyle = color;
  g.fillRect(x + 10, 24, 6, 16);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 256 / 2 + 6, 33, 200);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.1, 0.275, 1);
  sprite.position.y = 2.15;
  sprite.renderOrder = 5;
  return sprite;
}

export class RemotePlayers {
  constructor(scene, Weapons) {
    this.scene = scene;
    this.Weapons = Weapons;
    this.map = new Map();
  }

  /** The model of weapon `id` for player p (built once, then reused). */
  heldModel(p, id) {
    let m = p.models.get(id);
    if (!m) {
      const w = this.Weapons.get(id);
      const built = buildWeaponModel(w, this.Weapons.RARITY[w.rarity].color, false);
      built.group.scale.setScalar(0.8);
      const holder = new THREE.Group();
      holder.add(built.group);
      if (built.melee) holder.position.set(0.22, -0.3, -0.5);
      else holder.position.set(0.12, -0.2, -0.14);
      holder.visible = false;
      p.aim.add(holder);
      m = { holder, melee: built.melee };
      p.models.set(id, m);
    }
    return m;
  }

  /** Show the weapon player p has in hand. */
  showHeld(p, id) {
    if (p.heldId === id) return;
    if (p.heldId) { const old = p.models.get(p.heldId); if (old) old.holder.visible = false; }
    p.heldId = id;
    const m = this.heldModel(p, id);
    m.holder.visible = true;
  }

  setLoadout(id, lo) {
    const p = this.map.get(id);
    if (!p) return;
    p.lo = this.Weapons.loadoutIds(lo);
    p.heldId = '';
    for (const m of p.models.values()) m.holder.visible = false;
  }

  /** A swing animation on someone else's weapon. */
  swing(id) {
    const p = this.map.get(id);
    if (p) p.swingT = 0.32;
  }

  add(id, name, slot, lo, zil) {
    if (this.map.has(id)) return;
    const color = SLOT_COLORS[slot % SLOT_COLORS.length];
    const mats = {
      shirt: new THREE.MeshLambertMaterial({ color }),
      pants: new THREE.MeshLambertMaterial({ color: '#2b303a' }),
      skin: new THREE.MeshLambertMaterial({ color: '#d9a982' }),
      visor: new THREE.MeshLambertMaterial({ color: '#10141b' }),
      boot: new THREE.MeshLambertMaterial({ color: '#1b1e25' }),
    };
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    // Legs bend at the hip and the knee, so crouching looks like a real crouch
    const makeLeg = (x) => {
      const hip = new THREE.Group(); hip.position.set(x, 0.8, 0);
      const thigh = new THREE.Mesh(GEO.thigh, mats.pants); thigh.position.set(0, -0.2, 0);
      const knee = new THREE.Group(); knee.position.set(0, -0.4, 0);
      const shin = new THREE.Mesh(GEO.shin, mats.pants); shin.position.set(0, -0.2, 0);
      const boot = new THREE.Mesh(GEO.boot, mats.boot); boot.position.set(0, -0.37, -0.05);
      knee.add(shin, boot);
      hip.add(thigh, knee);
      return { hip, knee };
    };
    const lL = makeLeg(-0.13), lR = makeLeg(0.13);
    const legLG = lL.hip, legRG = lR.hip;

    // everything above the hips leans forward when crouching
    const upper = new THREE.Group();
    upper.position.set(0, 0.8, 0);
    const torso = new THREE.Mesh(GEO.torso, mats.shirt); torso.position.set(0, 0.32, 0);
    const belt = new THREE.Mesh(GEO.belt, mats.boot); belt.position.set(0, 0.02, 0);
    upper.add(torso, belt);

    // arms and head tilt up and down with the player's aim
    const aim = new THREE.Group();
    aim.position.set(0, 0.6, 0);
    const head = new THREE.Mesh(GEO.head, mats.skin); head.position.set(0, 0.2, 0);
    const visor = new THREE.Mesh(GEO.visor, mats.visor); visor.position.set(0, 0.22, -0.2);
    const armR = new THREE.Mesh(GEO.arm, mats.shirt); armR.position.set(0.2, -0.26, -0.22);
    const armL = new THREE.Mesh(GEO.arm, mats.shirt); armL.position.set(-0.14, -0.28, -0.3);
    aim.add(head, visor, armR, armL);
    upper.add(aim);

    root.add(legLG, legRG, upper);

    // glows for abilities other players can see: heal (green), armor (blue shell), surge (orange)
    const auraMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const armorShell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 1), auraMat('#60a5fa'));
    armorShell.position.y = 0.95; armorShell.scale.set(0.75, 1.1, 0.75); armorShell.visible = false;
    const healRing = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 6, 24), auraMat('#4ade80'));
    healRing.rotation.x = Math.PI / 2; healRing.visible = false;
    const surgeGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 2.0, 12, 1, true), auraMat('#fb923c'));
    surgeGlow.position.y = 1.0; surgeGlow.visible = false;
    const boostRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.03, 6, 24), auraMat('#f59e0b'));
    boostRing.rotation.x = Math.PI / 2; boostRing.visible = false;
    root.add(armorShell, healRing, surgeGlow, boostRing);
    const tag = makeTag(name, color);
    root.add(tag);
    root.visible = false;
    this.scene.add(root);

    // Godzilla: his own big body replaces the human one
    let zrig = null;
    if (zil) {
      zrig = new ZillaRig();
      root.add(zrig.root);
      legLG.visible = legRG.visible = upper.visible = false;
      tag.position.y = 5.0; tag.scale.set(2.4, 0.6, 1);
    }

    this.map.set(id, {
      zilla: !!zil, zrig, wasAlive: false,
      id, name, slot, color, root, aim, upper, armorShell, healRing, surgeGlow, boostRing, xray: false, legLG, legRG, kneeL: lL.knee, kneeR: lR.knee, tag, mats, crouchT: 0,
      buf: [], alive: true, fall: 0, hideAt: 0, flash: 0, walk: 0,
      models: new Map(), heldId: '', alpha: 1, lo: this.Weapons.loadoutIds(lo), cur: 0, swingT: 0,
      x: 0, y: 0, z: 0, height: 1.8, shown: false, lastX: null, lastZ: null,
    });
  }

  remove(id) {
    const e = this.map.get(id);
    if (!e) return;
    if (e.zrig) e.zrig.dispose();
    this.scene.remove(e.root);
    e.tag.material.map.dispose();
    e.tag.material.dispose();
    Object.values(e.mats).forEach((m) => m.dispose());
    this.map.delete(id);
  }

  clear() { for (const id of [...this.map.keys()]) this.remove(id); }

  get(id) { return this.map.get(id); }

  /** Save one snapshot entry: { i, x, y, z, a (yaw), b (pitch), c (crouch), l (alive) } at server time st. */
  push(st, e) {
    const p = this.map.get(e.i);
    if (!p) return;
    p.buf.push({ t: st, x: e.x, y: e.y, z: e.z, yaw: e.a, pitch: e.b, cr: e.c, al: e.l, w: e.w || 0, ln: e.n || 0, f: e.f || 0, h: e.h || 0 });
    while (p.buf.length > 2 && p.buf[0].t < st - BUFFER_MS) p.buf.shift();
  }

  /** Where this player is drawn at server time t. */
  sample(p, t) {
    const b = p.buf;
    if (!b.length) return null;
    if (t <= b[0].t) return b[0];
    const last = b[b.length - 1];
    if (t >= last.t) return last;
    for (let i = b.length - 1; i > 0; i--) {
      const a = b[i - 1], c = b[i];
      if (t >= a.t) {
        const k = (t - a.t) / (c.t - a.t || 1);
        return {
          x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k,
          yaw: lerpAngle(a.yaw, c.yaw, k), pitch: a.pitch + (c.pitch - a.pitch) * k,
          cr: c.cr, al: a.al && c.al, w: c.w, f: c.f, h: c.h, ln: a.ln + (c.ln - a.ln) * k,
        };
      }
    }
    return last;
  }

  /** Hit boxes of everyone alive, as drawn at server time t (used to predict where a shot lands). */
  targets(t) {
    const out = [];
    for (const p of this.map.values()) {
      const s = this.sample(p, t);
      if (!s || !s.al) continue;
      const sc = p.zilla ? 2.4 : 1;
      const d = LEAN_DIST * (s.ln || 0) * sc;
      out.push({ id: p.id, x: s.x, y: s.y, z: s.z, height: (s.cr ? 1.2 : 1.8) * sc, hox: Math.cos(s.yaw) * d, hoz: -Math.sin(s.yaw) * d, sc });
    }
    return out;
  }

  /** Scan Pulse: show these players through walls (those within range of (x, z)), or nobody with null. */
  setXray(origin, range) {
    this.xrayOrigin = origin;
    this.xrayRange = range;
  }

  applyXray(p) {
    let on = false;
    if (this.xrayOrigin && p.alive) on = Math.hypot(p.x - this.xrayOrigin.x, p.z - this.xrayOrigin.z) <= this.xrayRange;
    if (on === p.xray) return;
    p.xray = on;
    for (const m of Object.values(p.mats)) { m.depthTest = !on; m.needsUpdate = true; }
    p.root.traverse((o) => { if (o.isMesh && o.material && Object.values(p.mats).includes(o.material)) o.renderOrder = on ? 9 : 0; });
    p.tag.material.depthTest = !on;
    p.tag.material.needsUpdate = true;
    p.xrayTint = on ? 1 : 0;
  }

  flash(id) {
    const p = this.map.get(id);
    if (p) p.flash = 1;
  }

  /** Where to put a floating damage number for this player (the middle of the body). */
  center(id, out) {
    const p = this.map.get(id);
    if (!p) return false;
    out.set(p.x, p.y + p.height * 0.75, p.z);
    return true;
  }

  /** A move by Godzilla `id`: 'grab', 'whiff', 'stomp', 'quake', 'eat', 'roar'. */
  zillaEvent(id, kind) {
    const p = this.map.get(id);
    if (!p || !p.zrig) return;
    if (kind === 'grab') p.zrig.trigger('whiff'), p.zrig.timers.whiff = 0.25;
    else if (kind === 'eat') p.zrig.trigger('bite');
    else p.zrig.trigger(kind);
  }

  /** Where Godzilla's mouth is and where it points (for the fire), or false if he is gone. */
  zillaMouth(id, pos, dir) {
    const p = this.map.get(id);
    if (!p || !p.zrig) return false;
    p.root.updateMatrixWorld(true);
    p.zrig.mouthPose(pos, dir);
    return true;
  }

  updateZilla(p, s, dt, fl) {
    const z = p.zrig;
    const airborne = p.lastY !== undefined && Math.abs(s.y - p.lastY) / Math.max(dt, 1e-3) > 1.2;     // moving up or down quickly
    let speed = 0;
    if (p.lastX !== null) speed = Math.hypot(s.x - p.lastX, s.z - p.lastZ) / Math.max(dt, 1e-3);
    p.lastX = s.x; p.lastZ = s.z; p.lastY = s.y;
    p.zSpeed = p.zSpeed === undefined ? speed : p.zSpeed + (speed - p.zSpeed) * Math.min(1, dt * 10);
    if (p.alive && !p.wasAlive) z.trigger('roar');          // he roars when he appears
    p.wasAlive = p.alive;
    p.breathing = !!(fl & 128) && p.alive;
    z.update(dt, { speed: p.zSpeed, air: airborne, pitch: s.pitch, breathing: p.breathing, holding: !!(fl & 256) && p.alive, stompWind: !!(fl & 512) });
    if (p.flash > 0) { z.flash = Math.max(z.flash, p.flash); p.flash = 0; }
    p.hp = s.h || 0;
    p.tag.position.y = 5.0;
    p.tag.visible = p.alive;
    p.armorShell.visible = p.healRing.visible = p.surgeGlow.visible = p.boostRing.visible = false;
    p.root.rotation.x = p.fall * (Math.PI / 2) * 0.96;
  }

  update(dt, serverTime) {
    for (const p of this.map.values()) {
      const s = this.sample(p, serverTime);
      if (!s) continue;
      const wasAlive = p.alive;
      p.alive = !!s.al;
      if (p.alive && !wasAlive) { p.fall = 0; p.hideAt = 0; p.lastX = null; }
      if (!p.alive && wasAlive) { p.hideAt = performance.now() + 1800; }

      p.x = s.x; p.y = s.y; p.z = s.z;
      p.height = (s.cr ? 1.2 : 1.8) * (p.zilla ? 2.4 : 1);
      p.root.position.set(s.x, s.y, s.z);
      p.root.rotation.y = s.yaw;
      // smooth crouch amount 0..1
      p.crouchT += ((s.cr ? 1 : 0) - p.crouchT) * Math.min(1, dt * 12);
      const cr = p.crouchT;
      const lean = 0.75 * cr;
      p.aim.rotation.x = s.pitch + lean;      // the head keeps looking where the player looks
      p.upper.rotation.x = -lean;
      p.upper.rotation.z = -(s.ln || 0) * 0.42;          // leaning to the side (Q and E)

      // the weapon in hand
      const held = p.lo[s.w || 0] || p.lo[0];
      this.showHeld(p, held);
      const hm = p.models.get(held);
      if (p.swingT > 0) p.swingT = Math.max(0, p.swingT - dt);
      if (hm) {
        const k = 1 - p.swingT / 0.32;
        hm.holder.rotation.x = p.swingT > 0 ? -Math.sin(k * Math.PI) * 1.1 : (hm.melee ? 0.35 : 0);
      }

      // legs: swing when walking, and fold at hip and knee when crouching
      let swing = 0;
      if (p.lastX !== null) {
        const speed = Math.hypot(s.x - p.lastX, s.z - p.lastZ) / Math.max(dt, 1e-3);
        p.walk += Math.min(speed, 8) * dt * (2.2 - 0.9 * cr);
        swing = Math.sin(p.walk) * Math.min(1, speed / 4) * 0.7 * (1 - 0.55 * cr);
      }
      const th = 1.45 * cr, kn = 1.75 * cr;
      p.legLG.rotation.x = th + swing;
      p.legRG.rotation.x = th - swing;
      p.kneeL.rotation.x = -kn + Math.max(0, -swing) * 0.6;
      p.kneeR.rotation.x = -kn + Math.max(0, swing) * 0.6;
      const hipY = 0.4 * Math.cos(th) + 0.4 * Math.cos(th - kn);
      p.legLG.position.y = p.legRG.position.y = hipY;
      p.upper.position.y = hipY;
      p.upper.position.x = (s.ln || 0) * 0.06;
      p.tag.position.y = 2.15 - 0.62 * cr;
      p.lastX = s.x; p.lastZ = s.z;

      // falling over when eliminated
      p.fall = Math.min(1, Math.max(0, p.fall + (p.alive ? -1 : 1) * dt / FALL_TIME));
      p.root.rotation.x = p.fall * (Math.PI / 2) * 0.96;
      p.root.visible = !(p.hideAt && performance.now() > p.hideAt && !p.alive);
      p.tag.visible = p.alive;

      // ability glows (flags from the server: 1 heal, 2 armor, 4 surge, 16 second wind boost)
      const fl = s.f || 0;
      const tt = performance.now() / 1000;
      if (p.zilla) { this.updateZilla(p, s, dt, fl); continue; }
      // held in Godzilla's hand (bit 1024): struggling
      if (fl & 1024) {
        p.root.rotation.z = Math.sin(tt * 19) * 0.22;
        p.root.rotation.x = -0.25 + Math.sin(tt * 13) * 0.12;
        p.legLG.rotation.x = Math.sin(tt * 17) * 0.9; p.legRG.rotation.x = -Math.sin(tt * 17) * 0.9;
        p.struggling = true;
      } else if (p.struggling) { p.root.rotation.z = 0; p.struggling = false; }
      p.armorShell.visible = !!(fl & 2) && p.alive;
      if (p.armorShell.visible) { p.armorShell.material.opacity = 0.18 + 0.08 * Math.sin(tt * 4); p.armorShell.rotation.y = tt * 0.6; }
      p.healRing.visible = !!(fl & 1) && p.alive;
      if (p.healRing.visible) { const k = (tt * 0.8) % 1; p.healRing.position.y = 0.1 + k * 1.7; p.healRing.material.opacity = 0.8 * (1 - k); }
      p.surgeGlow.visible = !!(fl & 4) && p.alive;
      if (p.surgeGlow.visible) p.surgeGlow.material.opacity = 0.22 + 0.1 * Math.sin(tt * 9);
      p.boostRing.visible = !!(fl & 16) && p.alive;
      if (p.boostRing.visible) { const k = (tt * 1.4) % 1; p.boostRing.position.y = 0.1 + k * 1.8; p.boostRing.material.opacity = 0.85 * (1 - k); }
      this.applyXray(p);

      // Phase Cloak: nearly invisible (bit 32), fully visible for a second after shooting (bit 64); a scan sees through it
      const cloaked = !!(fl & 32) && !(fl & 64) && !p.xray;
      const wantAlpha = cloaked ? 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(tt * 7 + p.id)) : 1;
      p.alpha += (wantAlpha - p.alpha) * Math.min(1, dt * 12);
      const transparent = p.alpha < 0.99;
      for (const m of Object.values(p.mats)) { if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; } m.opacity = p.alpha; m.depthWrite = !transparent; }
      p.tag.visible = p.alive && !cloaked;
      if (cloaked) { p.armorShell.visible = p.healRing.visible = p.surgeGlow.visible = p.boostRing.visible = false; }
      for (const hm of p.models.values()) if (hm.holder.visible !== undefined && p.heldId) hm.holder.visible = (p.models.get(p.heldId) === hm) && !cloaked;

      // red flash when hit
      if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 5);
      const f = p.flash;
      // scanned players glow purple, hit players flash red
      const xr = p.xray ? 0.55 + 0.15 * Math.sin(tt * 8) : 0;
      p.mats.shirt.emissive.setRGB(f * 0.9 + xr * 0.7, f * 0.1 + xr * 0.2, f * 0.1 + xr);
      p.mats.skin.emissive.setRGB(f * 0.9 + xr * 0.7, f * 0.1 + xr * 0.2, f * 0.1 + xr);
      p.mats.pants.emissive.setRGB(f * 0.9 + xr * 0.7, f * 0.1 + xr * 0.2, f * 0.1 + xr);
    }
  }
}

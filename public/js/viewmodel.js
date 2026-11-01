// The weapon and hands you see in first person. It is drawn in its own scene on top of
// the world, so it never sinks into walls.
import * as THREE from 'three';
import { buildWeaponModel, buildGrenadeModel } from './weaponModels.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

const SCALE = 0.72;          // the whole weapon is drawn at this size so it is not huge on screen
const VM_FOV = 58;
const ADS_SHRINK = 0.8;     // the gun is drawn this much smaller while aiming

// Default poses: [x, y, z] position and [rx, ry, rz] rotation.
const GUN_HIP = { p: [0.15, -0.165, -0.4], r: [0, 0.03, 0] };
const GUN_SPRINT = { p: [0.11, -0.24, -0.34], r: [-0.28, 0.62, -0.22] };
const MELEE_HIP = { p: [0.2, -0.2, -0.42], r: [0.55, 0.2, 0.1] };
const MELEE_SPRINT = { p: [0.15, -0.26, -0.36], r: [0.3, 0.15, 0.5] };

export class Viewmodel {
  constructor(aspect) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(VM_FOV, aspect, 0.01, 10);
    this.scene.add(this.camera);

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#556070', 2.4));
    const key = new THREE.DirectionalLight('#fff4e0', 2.2);
    key.position.set(-1, 2, 1.5);
    this.scene.add(key);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.cache = new Map();
    this.model = null;
    this.gun = null;          // the group of the weapon in hand
    this.mag = null;          // its magazine part, if it has one
    this.flash = null;
    this.weaponId = '';

    // the grenade in your hand while you aim a throw
    this.grenRoot = new THREE.Group();
    this.grenRoot.visible = false;
    this.scene.add(this.grenRoot);
    this.grenId = '';
    this.grenModel = null;
    this.prep = 0;           // 0..1: how far the grenade is raised
    this.throwT = 1;         // 0..1 while the throw animation plays

    this.t = 0;
    this.kick = 0;
    this.kickT = 0;          // the kick waiting to be eased in
    this.flashTime = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.bobPhase = 0;
    this.bump = 0;
    this.swingT = 1;
    this.swingDur = 0.5;
    this.slideKick = 0;
    this.cylAngle = 0;
    this.cylTarget = 0;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Choose which grenade is shown in the hand. def comes from shared/weapons.js. */
  setGrenade(def) {
    if (this.grenId === def.id) return;
    this.grenId = def.id;
    if (this.grenModel) this.grenRoot.remove(this.grenModel);
    const built = buildGrenadeModel(def);
    const g = built.group;
    g.scale.setScalar(1.7);
    const hand = new THREE.Group();
    hand.add(g);
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.12), new THREE.MeshLambertMaterial({ color: '#17181c' }));
    glove.position.set(0.0, -0.07, 0.03);
    glove.scale.setScalar(0.75);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.4), new THREE.MeshLambertMaterial({ color: '#46523a' }));
    sleeve.position.set(0.05, -0.12, 0.25);
    sleeve.scale.setScalar(0.75);
    sleeve.rotation.x = 0.35;
    hand.add(glove, sleeve);
    this.grenModel = hand;
    this.grenRoot.add(hand);
  }

  /** The throw: the grenade flies out of the hand. */
  throwNow() {
    this.throwT = 0;
  }

  /** Take out another weapon. */
  setWeapon(weapon, rarityColor) {
    if (this.weaponId === weapon.id) return;
    let m = this.cache.get(weapon.id);
    if (!m) {
      m = buildWeaponModel(weapon, rarityColor, true);
      m.group.scale.setScalar(SCALE);
      m.magHome = m.parts.mag ? m.parts.mag.position.clone() : null;
      m.magRotX = m.parts.mag ? m.parts.mag.rotation.x : 0;
      m.pumpHome = m.parts.pump ? m.parts.pump.position.z : 0;
      m.boltHome = m.parts.bolt ? m.parts.bolt.position.clone() : null;
      m.slideHomeZ = m.parts.slide ? m.parts.slide.position.z : 0;
      m.weapon = weapon;
      // Parts behind the rear sight (stock, butt pad, forearms) are hidden while aiming, so they cannot block the view
      m.adsHide = [];
      const keep = new Set(Object.values(m.parts));
      if (m.flash) keep.add(m.flash);
      if (!m.melee) {
        m.group.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(m.group.matrixWorld).invert();
        for (const c of m.group.children) {
          if (keep.has(c) || c === m.flash) continue;
          const b = new THREE.Box3().setFromObject(c).applyMatrix4(inv);
          const cz = (b.min.z + b.max.z) / 2;
          if (cz > m.rearZ + 0.012 && b.max.y < m.sightY + 0.03) m.adsHide.push(c);
        }
        m.group.traverse((o) => { if (o.userData && o.userData.arm) m.adsHide.push(o); });
      }
      this.cache.set(weapon.id, m);
    }
    if (this.model) this.root.remove(this.model.group);
    this.model = m;
    this.weaponId = weapon.id;
    this.gun = m.group;
    this.mag = m.parts.mag || null;
    this.flash = m.flash;
    this.root.add(m.group);
    this.kick = 0; this.kickT = 0; this.flashTime = 0; this.swingT = 1; this.slideKick = 0;
    if (this.flash) this.flash.visible = false;
  }

  /** Call when a shot is fired. */
  fire() {
    const w = this.model && this.model.weapon;
    const heavy = w && (w.recoil.up >= 3);
    this.kickT = Math.min(heavy ? 2.6 : 1.4, this.kickT + (heavy ? 1.4 : 0.55));
    this.flashTime = 0.05;
    if (this.flash) {
      this.flash.rotation.z = Math.random() * Math.PI;
      const s = 0.8 + Math.random() * 0.5;
      this.flash.scale.set(s, s, s);
    }
    this.slideKick = 1;
    this.cylTarget += Math.PI / 3;
  }

  /** Start a melee swing that lasts `duration` seconds. */
  swing(duration) {
    this.swingT = 0;
    this.swingDur = Math.max(0.2, duration);
  }

  /** A small downward bump, for landing. */
  landBump(amount) {
    this.bump = Math.min(0.06, this.bump + amount);
  }

  /** The muzzle position as seen from the world camera, so tracers start at the visible muzzle. */
  muzzleInCameraSpace(out, worldFov) {
    this.root.updateMatrixWorld(true);
    out.copy(this.model.muzzle).applyMatrix4(this.gun.matrixWorld);
    const k = Math.tan(VM_FOV * Math.PI / 360) / Math.tan(worldFov * Math.PI / 360);
    out.x *= k; out.y *= k;
    return out;
  }

  /**
   * s = { ads 0..1, sprint 0..1, reload 0..1 or -1, shells (for shell reloads), equip 1..0,
   *       cycle 1..0 (pump or bolt moving), speed 0..1, onGround, lookX, lookY }
   * lookX/lookY are how far the view turned this frame (radians), used for weapon sway.
   */
  update(dt, s) {
    if (!this.model) return;
    const m = this.model;
    const w = m.weapon;
    const melee = m.melee;
    this.t += dt;

    // the gun eases back, then settles (a smooth push instead of a jerk)
    this.kick += (this.kickT - this.kick) * (1 - Math.exp(-42 * dt));
    this.kickT *= Math.exp(-13 * dt);
    this.bump *= Math.exp(-9 * dt);
    this.slideKick *= Math.exp(-18 * dt);
    this.swayX = clamp(this.swayX + s.lookX * 0.9, -0.12, 0.12);
    this.swayY = clamp(this.swayY + s.lookY * 0.9, -0.1, 0.1);
    const settle = Math.exp(-11 * dt);
    this.swayX *= settle;
    this.swayY *= settle;
    if (this.swingT < 1) this.swingT = Math.min(1, this.swingT + dt / this.swingDur);

    // Walking bob (nearly gone while aiming)
    const moving = s.onGround ? s.speed : 0;
    this.bobPhase += dt * (5 + moving * 8);
    const bobAmt = moving * (1 - s.ads * 0.9) * (1 - 0.35 * clamp(s.crouch || 0, 0, 1));
    const bobX = Math.sin(this.bobPhase) * 0.012 * bobAmt;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.012 * bobAmt;
    const breathe = Math.sin(this.t * 1.6) * 0.0015 * (1 - s.ads * 0.7);

    // Poses for this weapon
    const hip = melee ? MELEE_HIP : (m.hip || GUN_HIP);
    const spPose = melee ? MELEE_SPRINT : (m.sprint || GUN_SPRINT);
    // Aiming: the gun shrinks a little and moves forward so the sights sit about half a metre away,
    // which keeps the stock and receiver from filling the screen.
    const AS = SCALE * ADS_SHRINK;
    const adsPose = { p: [0, -(m.sightY * AS - 0.004), -0.52 - m.rearZ * AS], r: [0, 0, 0] };

    const ads = melee ? 0 : smooth(0, 1, s.ads);
    const spr = smooth(0, 1, s.sprint);
    const p = [0, 0, 0], r = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      let pv = lerp(hip.p[i], adsPose.p[i], ads);
      let rv = lerp(hip.r[i], adsPose.r[i], ads);
      pv = lerp(pv, spPose.p[i], spr);
      rv = lerp(rv, spPose.r[i], spr);
      p[i] = pv; r[i] = rv;
    }

    // Grenade: the weapon dips while you hold a grenade ready, and again as you throw
    if (s.grenadeHeld) this.prep = Math.min(1, this.prep + dt * 5); else this.prep = Math.max(0, this.prep - dt * 6);
    if (this.throwT < 1) this.throwT = Math.min(1, this.throwT + dt / 0.5);
    const prepE = smooth(0, 1, this.prep);
    const thr = this.throwT < 1 ? Math.sin(this.throwT * Math.PI) : 0;
    p[1] -= 0.16 * Math.max(prepE, thr);
    p[0] += 0.05 * Math.max(prepE, thr);
    r[0] -= 0.45 * Math.max(prepE, thr);
    const showG = this.prep > 0.02 || this.throwT < 0.55;
    this.grenRoot.visible = showG && !!this.grenModel;
    if (this.grenRoot.visible) {
      const k = this.throwT < 1 ? this.throwT : 0;
      const out = smooth(0.05, 0.4, k);
      const lift = prepE * (1 - smooth(0, 0.08, k));
      this.grenRoot.position.set(0.17 - 0.03 * out, -0.36 + 0.14 * Math.max(lift, this.throwT < 1 ? 1 : 0) + 0.05 * out, -0.38 - 0.38 * out);
      this.grenRoot.rotation.set(-0.5 * (1 - out) + 0.9 * out, 0, 0);
      this.grenRoot.scale.setScalar(1 - 0.0 * out);
      if (this.throwT < 1 && k > 0.3) this.grenModel.children[0].visible = false; else if (this.grenModel) this.grenModel.children[0].visible = true;
    }

    // Crouching: the weapon sits a little lower and closer, and steadier
    const cro = clamp(s.crouch || 0, 0, 1);
    p[1] -= 0.018 * cro * (1 - ads);
    p[2] += 0.02 * cro * (1 - ads);

    // Raising the weapon after a switch: it comes up from below
    if (s.equip > 0) {
      const e = smooth(0, 1, s.equip);
      p[1] -= 0.26 * e;
      p[0] += 0.06 * e;
      r[0] -= 0.8 * e;
    }

    // Reloading
    let magY = 0, magVisible = true, magTilt = 0;
    if (s.reload >= 0 && !melee) {
      const k = s.reload;
      if (w.reloadMode === 'shell') {
        // tilt the gun and push shells in one at a time
        const lower = smooth(0, 0.06, k) * (1 - smooth(0.94, 1, k));
        p[1] -= 0.05 * lower;
        r[0] += 0.25 * lower;
        r[2] += 0.3 * lower;
        const phase = ((k * (s.shells || 1)) % 1);
        p[1] -= 0.018 * Math.sin(phase * Math.PI) * lower;
        p[2] += 0.012 * Math.sin(phase * Math.PI) * lower;
      } else if (this.mag) {
        const lower = smooth(0, 0.16, k) * (1 - smooth(0.86, 1, k));
        p[1] -= 0.075 * lower;
        p[0] -= 0.03 * lower;
        r[0] -= 0.38 * lower;
        r[1] += 0.28 * lower;
        r[2] += 0.32 * lower;
        if (k < 0.3) {
          magY = -0.3 * smooth(0.18, 0.3, k);
          magTilt = 0.6 * smooth(0.18, 0.3, k);
        } else if (k < 0.55) {
          magVisible = false;
        } else {
          magY = -0.18 * (1 - smooth(0.55, 0.74, k));
        }
      } else {
        // revolver: tip the gun and spin the cylinder
        const lower = smooth(0, 0.15, k) * (1 - smooth(0.85, 1, k));
        p[1] -= 0.06 * lower;
        r[0] -= 0.25 * lower;
        r[2] += 0.7 * lower;
        this.cylTarget += dt * 14 * lower;
      }
    }
    if (this.mag && m.magHome) {
      this.mag.visible = magVisible;
      this.mag.position.set(m.magHome.x, m.magHome.y + magY, m.magHome.z);
      this.mag.rotation.x = m.magRotX + magTilt;
    }

    // Pump, bolt and slide
    const cyc = clamp(s.cycle || 0, 0, 1);
    const tc = 1 - cyc;
    if (m.parts.pump) {
      const amt = cyc > 0 ? smooth(0.12, 0.45, tc) - smooth(0.55, 0.88, tc) : 0;
      m.parts.pump.position.z = m.pumpHome + 0.13 * amt;
    }
    if (m.parts.bolt) {
      let lift = 0, back = 0;
      if (cyc > 0) {
        lift = smooth(0.1, 0.22, tc) - smooth(0.82, 0.94, tc);
        back = smooth(0.28, 0.5, tc) - smooth(0.58, 0.8, tc);
      }
      m.parts.bolt.rotation.z = -lift * 1.1;
      m.parts.bolt.position.z = m.boltHome.z + 0.09 * back;
    }
    if (m.parts.slide) m.parts.slide.position.z = m.slideHomeZ + 0.05 * this.slideKick;
    if (m.parts.cylinder) {
      this.cylAngle += (this.cylTarget - this.cylAngle) * Math.min(1, dt * 20);
      m.parts.cylinder.rotation.z = this.cylAngle;
    }

    // Melee swing
    if (melee && this.swingT < 1) {
      const k = this.swingT;
      const a = smooth(0, 0.22, k), b = smooth(0.22, 0.5, k), c = smooth(0.62, 1, k);
      p[0] += 0.12 * a - 0.38 * b + 0.26 * c;
      p[1] += 0.06 * a - 0.14 * b + 0.08 * c;
      p[2] += 0.05 * a - 0.20 * b + 0.15 * c;
      r[0] += 0.45 * a - 1.1 * b + 0.65 * c;
      r[1] += -0.35 * a + 1.5 * b - 1.15 * c;
      r[2] += 0.5 * a - 1.1 * b + 0.6 * c;
    }

    // Apply, with kick pushing the gun back and rolling it up
    const aimDamp = 1 - ads * 0.55;
    this.gun.scale.set(SCALE * lerp(1, ADS_SHRINK * 0.62, ads), SCALE * lerp(1, ADS_SHRINK, ads), SCALE * lerp(1, ADS_SHRINK, ads));   // slimmer from behind
    const hideNow = ads > 0.5;
    if (this.model.adsHide) for (const c of this.model.adsHide) c.visible = !hideNow;
    this.gun.position.set(
      p[0] + bobX + this.swayX * 0.25,
      p[1] + bobY + breathe - this.bump - this.swayY * 0.2,
      p[2] + this.kick * 0.045 * aimDamp
    );
    this.gun.rotation.set(
      r[0] + this.kick * 0.07 * aimDamp + this.swayY * 0.5,
      r[1] + this.swayX * 0.6,
      r[2]
    );

    // Muzzle flash
    if (this.flash) {
      if (this.flashTime > 0) {
        this.flashTime -= dt;
        this.flash.visible = this.flashTime > 0;
      } else {
        this.flash.visible = false;
      }
    }
  }
}

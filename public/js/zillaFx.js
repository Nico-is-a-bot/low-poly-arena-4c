// Effects for Godzilla: the fire breath, stomp shockwaves with dust, and the burst when someone is eaten.
import * as THREE from 'three';

function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const FIRE_COLORS = [[1.0, 0.72, 0.28], [1.0, 0.5, 0.1], [0.85, 0.28, 0.05], [0.4, 0.08, 0.03]];
function fireColor(k, out) {
  const f = Math.min(FIRE_COLORS.length - 1.001, k * (FIRE_COLORS.length - 1));
  const i = Math.floor(f), u = f - i;
  const a = FIRE_COLORS[i], b = FIRE_COLORS[i + 1];
  out.setRGB(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
}

class Pool {
  constructor(scene, tex, n, additive) {
    this.list = [];
    this.free = [];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.renderOrder = additive ? 6 : 5;
      scene.add(s);
      const p = { s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size0: 1, size1: 1, kind: 0, drag: 0, rise: 0 };
      this.list.push(p);
      this.free.push(p);
    }
  }
  spawn() {
    const p = this.free.pop();
    if (!p) return null;
    p.s.visible = true;
    return p;
  }
}

export class ZillaFx {
  constructor(scene) {
    this.scene = scene;
    const tex = softTexture();
    this.fire = new Pool(scene, tex, 260, true);
    this.smoke = new Pool(scene, tex, 160, false);
    this.rings = [];
    this.tmp = new THREE.Color();
    this.acc = new Map();           // emit leftovers per player id
  }

  /** Flames from the mouth of player `id` at `pos`, going along `dir` (unit). Call every frame while he breathes. */
  breath(id, pos, dir, dt) {
    const rate = 70;                                       // flames per second
    let n = (this.acc.get(id) || 0) + rate * dt;
    // two vectors across the direction, to spread the flames in a cone
    const ux = -dir.z, uz = dir.x;
    const ul = Math.hypot(ux, uz) || 1;
    const sx = ux / ul, sz = uz / ul;                      // sideways (flat)
    const tx = dir.y * sz, ty = dir.z * sx - dir.x * sz, tz = -dir.y * sx;            // the other way across the direction (dir x sideways)
    const tl = Math.hypot(tx, ty, tz) || 1;
    while (n >= 1) {
      n -= 1;
      const p = this.fire.spawn();
      if (!p) break;
      const sp = 14 + Math.random() * 8;
      const a = (Math.random() - 0.5) * 0.32, b = (Math.random() - 0.5) * 0.32;
      p.vx = (dir.x + sx * a + (tx / tl) * b) * sp;
      p.vy = (dir.y + (ty / tl) * b) * sp + 0.6;
      p.vz = (dir.z + sz * a + (tz / tl) * b) * sp;
      const jit = Math.random() * dt;                      // spread the flames of one frame along their path
      p.s.position.set(pos.x + dir.x * 0.2 + p.vx * jit, pos.y + dir.y * 0.2 + p.vy * jit, pos.z + dir.z * 0.2 + p.vz * jit);
      p.max = p.life = 0.55 + Math.random() * 0.45;
      p.size0 = 0.12 + Math.random() * 0.12; p.size1 = 1.5 + Math.random() * 1.3;
      p.kind = 1; p.drag = 0.6; p.rise = 1.4;
    }
    // the odd dark puff of smoke at the tip
    if (Math.random() < dt * 14) {
      const p = this.smoke.spawn();
      if (p) {
        const sp = 10 + Math.random() * 6;
        p.vx = dir.x * sp; p.vy = dir.y * sp + 1.2; p.vz = dir.z * sp;
        p.s.position.set(pos.x + dir.x * 0.5, pos.y + dir.y * 0.5, pos.z + dir.z * 0.5);
        p.max = p.life = 0.9 + Math.random() * 0.5;
        p.size0 = 0.6; p.size1 = 2.8; p.kind = 2; p.drag = 0.8; p.rise = 2.2;
        p.s.material.color.setRGB(0.16, 0.14, 0.13);
      }
    }
    this.acc.set(id, n);
  }

  stopBreath(id) { this.acc.delete(id); }

  /** The ground shockwave: an expanding ring and a ring of dust. */
  quake(x, y, z, radius) {
    this.quakes = (this.quakes || 0) + 1;            // (counted so the automatic tests can see it)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color: '#ffb35a', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.06, z);
    ring.renderOrder = 6;
    this.scene.add(ring);
    this.rings.push({ mesh: ring, t: 0, dur: 0.55, radius });
    const n = 26;
    for (let i = 0; i < n; i++) {
      const p = this.smoke.spawn();
      if (!p) break;
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const sp = radius / 0.55 * (0.55 + Math.random() * 0.4);
      p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = 1 + Math.random() * 2;
      p.s.position.set(x, y + 0.3, z);
      p.max = p.life = 0.8 + Math.random() * 0.5;
      p.size0 = 0.9; p.size1 = 3.2; p.kind = 2; p.drag = 3.2; p.rise = 0.6;
      p.s.material.color.setRGB(0.55, 0.5, 0.45);
    }
  }

  /** A burst when someone is eaten: sparks and bits flying out of the mouth. */
  chomp(x, y, z) {
    for (let i = 0; i < 22; i++) {
      const p = this.fire.spawn();
      if (!p) break;
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.2) * 1.2, sp = 3 + Math.random() * 6;
      p.vx = Math.cos(a) * Math.cos(e) * sp; p.vy = Math.sin(e) * sp + 2; p.vz = Math.sin(a) * Math.cos(e) * sp;
      p.s.position.set(x, y, z);
      p.max = p.life = 0.45 + Math.random() * 0.4;
      p.size0 = 0.25; p.size1 = 0.7; p.kind = 3; p.drag = 1.5; p.rise = -6;
      p.s.material.color.setRGB(0.9, 0.2, 0.15);
    }
  }

  /** cam = where the player's eyes are: flames right in front of the lens are faded out so they do not fill the screen. */
  update(dt, cam) {
    const C = this.tmp;
    const near = (p) => {
      if (!cam) return 1;
      const d = Math.hypot(p.s.position.x - cam.x, p.s.position.y - cam.y, p.s.position.z - cam.z);
      return d > 3.2 ? 1 : Math.max(0, (d - 1.2) / 2.0);
    };
    for (const p of this.fire.list) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; this.fire.free.push(p); continue; }
      const k = 1 - p.life / p.max;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vz *= d; p.vy = p.vy * d + p.rise * dt;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      const size = p.size0 + (p.size1 - p.size0) * Math.sqrt(k);
      p.s.scale.set(size, size, 1);
      if (p.kind === 1) { fireColor(k, C); p.s.material.color.copy(C); }
      p.s.material.opacity = (p.kind === 3 ? 1 - k : Math.min(1, (1 - k) * 1.6, k * 6 + 0.1) * 0.3) * near(p);
    }
    for (const p of this.smoke.list) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; this.smoke.free.push(p); continue; }
      const k = 1 - p.life / p.max;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vz *= d; p.vy = p.vy * d + p.rise * dt * 0.5;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      const size = p.size0 + (p.size1 - p.size0) * Math.sqrt(k);
      p.s.scale.set(size, size, 1);
      p.s.material.opacity = (1 - k) * 0.5 * near(p);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); this.rings.splice(i, 1); continue; }
      const s = 0.5 + r.radius * (1 - Math.pow(1 - k, 2));
      r.mesh.scale.set(s, s, 1);
      r.mesh.material.opacity = 0.9 * (1 - k);
    }
  }

  clear() {
    for (const pool of [this.fire, this.smoke]) for (const p of pool.list) if (p.life > 0) { p.life = 0; p.s.visible = false; pool.free.push(p); }
    for (const r of this.rings) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
    this.rings.length = 0;
    this.acc.clear();
  }
}

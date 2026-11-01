// Things the abilities leave in the world: shield domes, proximity mines and orbital strike markers.
import * as THREE from 'three';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class AbilityWorld {
  constructor(scene, shake) {
    this.scene = scene;
    this.shake = shake || (() => {});
    this.domes = new Map();
    this.mines = new Map();
    this.strikes = new Map();
    this.fx = [];          // short effects (ripples, explosions)
    this.t = 0;
    this.domeGeo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  }

  // ------------------------------------------------------------ domes
  syncDomes(list) {
    const seen = new Set();
    for (const d of list) {
      seen.add(d.id);
      let e = this.domes.get(d.id);
      if (!e) {
        const group = new THREE.Group();
        const fill = new THREE.Mesh(this.domeGeo, new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, fog: false }));
        const wire = new THREE.Mesh(this.domeGeo, new THREE.MeshBasicMaterial({ color: '#9be3ff', wireframe: true, transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
        wire.scale.setScalar(1.002);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 40), new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, fog: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
        fill.renderOrder = 4; wire.renderOrder = 5;
        group.add(fill, wire, ring);
        group.position.set(d.x, d.y, d.z);
        group.scale.setScalar(0.01);
        this.scene.add(group);
        e = { group, fill, wire, ring, r: d.r, born: this.t, left: d.left };
        this.domes.set(d.id, e);
      }
      e.left = d.left;
      e.group.position.set(d.x, d.y, d.z);
    }
    for (const [id, e] of this.domes) if (!seen.has(id)) { this.scene.remove(e.group); this.domes.delete(id); }
  }

  /** A ripple where a bullet hit a dome. point = [x, y, z], normal = [x, y, z] */
  ripple(point, normal) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 24), new THREE.MeshBasicMaterial({ color: '#c8f1ff', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    m.position.set(point[0], point[1], point[2]);
    m.lookAt(point[0] + normal[0], point[1] + normal[1], point[2] + normal[2]);
    m.renderOrder = 6;
    this.scene.add(m);
    this.fx.push({ mesh: m, age: 0, life: 0.45, step: (k) => { m.scale.setScalar(0.15 + k * 0.9); m.material.opacity = 0.9 * (1 - k); } });
  }

  // ------------------------------------------------------------ mines
  syncMines(list, myId) {
    const seen = new Set();
    for (const m of list) {
      seen.add(m.id);
      let e = this.mines.get(m.id);
      if (!e) {
        const group = new THREE.Group();
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.07, 10), new THREE.MeshLambertMaterial({ color: '#2a2e35' }));
        base.position.y = 0.035;
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#4b5563' }));
        dome.position.y = 0.07;
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3b30', fog: false }));
        lamp.position.y = 0.17;
        const halo = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.33, 20), new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false, fog: false }));
        halo.rotation.x = -Math.PI / 2; halo.position.y = 0.04;
        group.add(base, dome, lamp, halo);
        group.position.set(m.x, m.y, m.z);
        this.scene.add(group);
        e = { group, lamp, halo, armed: false, mine: m.owner === myId };
        this.mines.set(m.id, e);
      }
      e.armed = !!m.armed;
      e.mine = m.owner === myId;
    }
    for (const [id, e] of this.mines) if (!seen.has(id)) { this.scene.remove(e.group); this.mines.delete(id); }
  }

  mineBoom(x, y, z) {
    this.fireball(x, y + 0.3, z, 3.2, 0.45, '#ff9a2e');
    this.shake(0.5);
  }

  // ------------------------------------------------------------ orbital strikes
  syncStrikes(list) {
    const seen = new Set();
    for (const s of list) {
      seen.add(s.id);
      let e = this.strikes.get(s.id);
      if (!e) {
        const group = new THREE.Group();
        const mat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false, fog: false });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 56), mat('#ff5a3c', 0.95));
        const inner = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 56), mat('#ffd36b', 0.9));
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), mat('#ff3b30', 0.14));
        for (const m of [ring, inner, disc]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 6; }
        ring.position.y = 0.06; inner.position.y = 0.07; disc.position.y = 0.05;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 70, 12, 1, true), mat('#ff6a4a', 0.0));
        beam.position.y = 35;
        group.add(ring, inner, disc, beam);
        group.position.set(s.x, s.y, s.z);
        this.scene.add(group);
        e = { group, ring, inner, disc, beam, r: 6, total: Math.max(s.left, 2) };
        this.strikes.set(s.id, e);
      }
      e.left = s.left;
    }
    for (const [id, e] of this.strikes) if (!seen.has(id)) { this.scene.remove(e.group); this.strikes.delete(id); }
  }

  /** The strike lands. */
  strikeBoom(x, y, z, r, distance) {
    const near = clamp(1 - distance / 40, 0, 1);
    this.fireball(x, y + 1.5, z, r * 0.95, 0.8, '#ffb347');
    this.fireball(x, y + 1.2, z, r * 0.55, 0.5, '#fff3c2');
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 80, 14, 1, true), new THREE.MeshBasicMaterial({ color: '#fff0c0', transparent: true, opacity: 0.95, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    col.position.set(x, y + 40, z);
    col.renderOrder = 6;
    this.scene.add(col);
    this.fx.push({ mesh: col, age: 0, life: 0.6, step: (k) => { col.scale.set(1 + k * 1.5, 1, 1 + k * 1.5); col.material.opacity = 0.95 * (1 - k); } });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.1, z);
    this.scene.add(ring);
    this.fx.push({ mesh: ring, age: 0, life: 0.6, step: (k) => { ring.scale.setScalar(r * 1.25 * (1 - Math.pow(1 - k, 2))); ring.material.opacity = 0.95 * (1 - k); } });
    this.shake(near * 1.2);
  }

  fireball(x, y, z, radius, seconds, color) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, fog: false }));
    m.position.set(x, y, z);
    m.renderOrder = 6;
    this.scene.add(m);
    this.fx.push({ mesh: m, age: 0, life: seconds, step: (k) => { m.scale.setScalar(0.2 + radius * (1 - Math.pow(1 - k, 2))); m.material.opacity = 1 - k * k; } });
  }

  clear() {
    for (const e of this.domes.values()) this.scene.remove(e.group);
    for (const e of this.mines.values()) this.scene.remove(e.group);
    for (const e of this.strikes.values()) this.scene.remove(e.group);
    this.domes.clear(); this.mines.clear(); this.strikes.clear();
    for (const f of this.fx) this.scene.remove(f.mesh);
    this.fx.length = 0;
  }

  update(dt) {
    this.t += dt;
    for (const e of this.domes.values()) {
      const age = this.t - e.born;
      const grow = smooth(0, 0.3, age);
      e.group.scale.setScalar(Math.max(0.01, e.r * grow));
      const fade = e.left < 0.6 ? Math.max(0, e.left / 0.6) : 1;
      e.fill.material.opacity = (0.12 + 0.04 * Math.sin(this.t * 3)) * fade;
      e.wire.material.opacity = 0.35 * fade;
      e.ring.material.opacity = 0.8 * fade;
      e.ring.scale.setScalar(1);
    }
    for (const e of this.mines.values()) {
      const blink = e.armed ? (Math.sin(this.t * 10) > 0 ? 1 : 0.25) : 0.55 + 0.2 * Math.sin(this.t * 3);
      e.lamp.material.color.set(e.armed ? '#ff3b30' : '#ffb347');
      e.lamp.scale.setScalar(0.7 + 0.5 * blink);
      e.halo.material.opacity = e.armed ? 0.25 * blink : 0;
    }
    for (const e of this.strikes.values()) {
      const k = 1 - clamp(e.left / e.total, 0, 1);                     // 0 at the mark, 1 at the strike
      const pulse = 0.6 + 0.4 * Math.sin(this.t * (8 + 16 * k));
      e.ring.scale.setScalar(e.r);
      e.disc.scale.setScalar(e.r);
      e.disc.material.opacity = 0.1 + 0.18 * k * pulse;
      e.inner.scale.setScalar(Math.max(0.2, e.r * (1 - k)));
      e.beam.material.opacity = 0.1 + 0.65 * smooth(0.55, 1, k);
      e.beam.scale.set(0.6 + 1.6 * k, 1, 0.6 + 1.6 * k);
      e.ring.material.opacity = 0.5 + 0.45 * pulse;
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose(); f.mesh.material.dispose();
        this.fx.splice(i, 1);
        continue;
      }
      f.step(k);
    }
  }
}

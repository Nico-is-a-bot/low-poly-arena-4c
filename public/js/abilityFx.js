// What you see of abilities in the world: dash streaks, expanding scan rings, grapple ropes and bursts.
import * as THREE from 'three';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class AbilityFx {
  constructor(scene) {
    this.scene = scene;
    this.items = [];     // short-lived effects: { mesh, age, life, update(k) }
    this.ropes = [];     // grapple ropes that follow a moving start point
    this.t = 0;
  }

  /** An expanding ring on the ground (scan pulse, second wind burst). */
  ring(x, y, z, color, maxRadius, seconds, thickness) {
    const th = thickness || 0.35;
    const m = new THREE.Mesh(new THREE.RingGeometry(1 - th, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.06, z);
    m.renderOrder = 6;
    this.scene.add(m);
    this.items.push({ mesh: m, age: 0, life: seconds, step: (k) => { m.scale.setScalar(Math.max(0.01, maxRadius * (1 - Math.pow(1 - k, 2)))); m.material.opacity = 0.85 * (1 - k); } });
  }

  /** A tall pillar of light (second wind). */
  pillar(x, y, z, color, seconds) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    m.position.set(x, y + 3, z);
    m.renderOrder = 6;
    this.scene.add(m);
    this.items.push({ mesh: m, age: 0, life: seconds, step: (k) => { m.scale.set(1 + k * 0.6, 1, 1 + k * 0.6); m.material.opacity = 0.5 * (1 - k); } });
  }

  /** Streaks behind a dash: a few thin boxes trailing from (x, y, z) opposite to the direction (dx, dz). */
  streaks(x, y, z, dx, dz, color) {
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1.6 + Math.random()), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
      const side = (Math.random() - 0.5) * 0.9, up = 0.3 + Math.random() * 1.3;
      m.position.set(x - ux * 0.6 + -uz * side, y + up, z - uz * 0.6 + ux * side);
      m.rotation.y = Math.atan2(ux, uz);
      m.renderOrder = 6;
      this.scene.add(m);
      this.items.push({ mesh: m, age: 0, life: 0.35, step: (k) => { m.material.opacity = 0.8 * (1 - k); m.scale.z = 1 - k * 0.5; m.position.x -= ux * 0.04; m.position.z -= uz * 0.04; } });
    }
  }

  /** Rising green plus signs (heal pulse). */
  pluses(x, y, z) {
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.9, depthWrite: false, fog: false });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.08), mat), new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), mat));
      const a = Math.random() * 6.28, r = 0.3 + Math.random() * 0.4;
      g.position.set(x + Math.cos(a) * r, y + 0.5 + Math.random() * 0.8, z + Math.sin(a) * r);
      g.renderOrder = 6;
      this.scene.add(g);
      const y0 = g.position.y;
      this.items.push({ mesh: g, age: -i * 0.12, life: 1.1, step: (k) => { g.position.y = y0 + k * 1.2; mat.opacity = 0.9 * (1 - k); g.rotation.y += 0.05; } });
    }
  }

  /** A grapple rope from a moving start (a function returning [x, y, z]) to a fixed end. */
  rope(startFn, end, seconds, color) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color || '#f472b6', transparent: true, opacity: 1, depthTest: false, fog: false }));
    line.frustumCulled = false;
    line.renderOrder = 7;
    const hook = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), new THREE.MeshBasicMaterial({ color: color || '#f472b6', fog: false }));
    hook.position.set(end[0], end[1], end[2]);
    this.scene.add(line, hook);
    this.ropes.push({ line, hook, startFn, end, age: 0, life: seconds });
  }

  clear() {
    for (const it of this.items) this.scene.remove(it.mesh);
    this.items.length = 0;
    for (const r of this.ropes) this.scene.remove(r.line, r.hook);
    this.ropes.length = 0;
  }

  update(dt) {
    this.t += dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      if (it.age < 0) { it.mesh.visible = false; continue; }
      it.mesh.visible = true;
      const k = it.age / it.life;
      if (k >= 1) {
        this.scene.remove(it.mesh);
        it.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this.items.splice(i, 1);
        continue;
      }
      it.step(k);
    }
    for (let i = this.ropes.length - 1; i >= 0; i--) {
      const r = this.ropes[i];
      r.age += dt;
      if (r.age >= r.life) {
        this.scene.remove(r.line, r.hook);
        r.line.geometry.dispose(); r.line.material.dispose(); r.hook.geometry.dispose(); r.hook.material.dispose();
        this.ropes.splice(i, 1);
        continue;
      }
      const s = r.startFn();
      const pos = r.line.geometry.attributes.position;
      pos.setXYZ(0, s[0], s[1], s[2]);
      pos.setXYZ(1, r.end[0], r.end[1], r.end[2]);
      pos.needsUpdate = true;
      r.hook.rotation.y += dt * 8;
      const k = r.age / r.life;
      r.line.material.opacity = clamp(1.3 - k, 0, 1);
    }
  }
}

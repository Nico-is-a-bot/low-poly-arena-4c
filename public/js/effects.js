// Bullet tracers, impact sparks/chips and bullet holes. Everything is pooled
// (made once and reused), so firing never causes slowdowns from creating objects.
import * as THREE from 'three';

const FORWARD = new THREE.Vector3(0, 0, 1);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.low = false;

    // Tracers
    const tracerGeo = new THREE.BoxGeometry(0.014, 0.014, 1);
    this.tracers = [];
    for (let i = 0; i < 40; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffeeb0, transparent: true, opacity: 0.9, fog: false, depthWrite: false });
      const m = new THREE.Mesh(tracerGeo, mat);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0, max: 0.07, base: 0.9 });
    }
    this.tracerIndex = 0;

    // Particles
    const partGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    this.parts = [];
    for (let i = 0; i < 48; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const m = new THREE.Mesh(partGeo, mat);
      m.visible = false;
      scene.add(m);
      this.parts.push({ mesh: m, vel: new THREE.Vector3(), life: 0, max: 0.4 });
    }
    this.partIndex = 0;

    // Bullet holes
    const holeGeo = new THREE.CircleGeometry(0.055, 8);
    const holeMat = new THREE.MeshBasicMaterial({
      color: 0x0a0a0a, transparent: true, opacity: 0.75, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.holes = [];
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(holeGeo, holeMat);
      m.visible = false;
      scene.add(m);
      this.holes.push(m);
    }
    this.holeIndex = 0;
  }

  setLowQuality(low) { this.low = low; }

  /** A short streak of light. color is optional (a CSS colour); width makes thicker beams. */
  tracer(from, to, color, width) {
    const len = from.distanceTo(to);
    if (len < 2) return;
    const t = this.tracers[this.tracerIndex];
    this.tracerIndex = (this.tracerIndex + 1) % this.tracers.length;
    const m = t.mesh;
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.scale.set(width || 1, width || 1, len);
    m.lookAt(to);
    m.material.color.set(color || '#ffeeb0');
    m.visible = true;
    t.max = width > 1 ? 0.18 : 0.07;
    t.life = t.max;
    m.material.opacity = 0.9;
  }

  /** Chips and sparks where a bullet lands. color is a CSS colour string. */
  impact(point, normal, color, sparks) {
    const count = this.low ? 3 : 6;
    for (let i = 0; i < count; i++) {
      const p = this.parts[this.partIndex];
      this.partIndex = (this.partIndex + 1) % this.parts.length;
      const spark = sparks && i < 2;
      p.mesh.material.color.set(spark ? '#ffe39a' : color);
      p.mesh.position.copy(point);
      p.mesh.scale.setScalar(spark ? 0.6 : 0.7 + Math.random() * 0.7);
      p.vel.set((Math.random() - 0.5) * 3, (Math.random() - 0.1) * 3, (Math.random() - 0.5) * 3)
        .addScaledVector(normal, 1.5 + Math.random() * 2.5);
      p.life = p.max = 0.3 + Math.random() * 0.2;
      p.mesh.visible = true;
    }
  }

  hole(point, normal) {
    const m = this.holes[this.holeIndex];
    this.holeIndex = (this.holeIndex + 1) % this.holes.length;
    m.position.copy(point).addScaledVector(normal, 0.012);
    m.quaternion.setFromUnitVectors(FORWARD, normal);
    m.rotateZ(Math.random() * Math.PI);
    m.visible = true;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else t.mesh.material.opacity = 0.9 * (t.life / t.max);
    }
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.y -= 9 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.multiplyScalar(Math.max(0.2, 1 - 2.2 * dt));   // shrink as they fly
    }
  }
}

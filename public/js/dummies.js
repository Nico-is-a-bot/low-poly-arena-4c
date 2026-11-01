// Practice target dummies. They have 100 HP, use the SAME hitboxes as real players
// will (head and body, from shared/physics.js), fall over when killed and stand
// back up after 3 seconds. Some stand still, one walks back and forth.
import * as THREE from 'three';

const P = window.ArenaShared.Physics;
const MAX_HP = 100;
const RESPAWN_TIME = 3;
const BODY_W = P.BODY_HALF * 2;     // movement collider is as wide as the body hitbox

function buildModel(materials) {
  const { orange, dark, white, grey, red } = materials;
  const g = new THREE.Group();
  const part = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  part(0.2, 0.8, 0.24, grey, -0.12, 0.4, 0);        // legs
  part(0.2, 0.8, 0.24, grey, 0.12, 0.4, 0);
  part(0.52, 0.6, 0.28, orange, 0, 1.1, 0);          // torso
  part(0.14, 0.58, 0.16, orange, -0.34, 1.1, 0);     // arms
  part(0.14, 0.58, 0.16, orange, 0.34, 1.1, 0);
  part(0.3, 0.32, 0.3, white, 0, 1.58, 0);           // head
  part(0.34, 0.08, 0.34, orange, 0, 1.76, 0);        // helmet top
  part(0.31, 0.07, 0.02, dark, 0, 1.58, 0.15);       // visor
  part(0.24, 0.24, 0.01, white, 0, 1.12, 0.145);     // bullseye
  part(0.14, 0.14, 0.012, red, 0, 1.12, 0.15);
  part(0.06, 0.06, 0.014, white, 0, 1.12, 0.156);
  return g;
}

export class Dummies {
  constructor(scene, defs) {
    this.scene = scene;
    this.list = [];
    this.flashColor = new THREE.Color(0x888888);

    defs.forEach((def, i) => {
      const materials = {
        orange: new THREE.MeshLambertMaterial({ color: '#e8772e' }),
        dark: new THREE.MeshLambertMaterial({ color: '#23262c' }),
        white: new THREE.MeshLambertMaterial({ color: '#f0f0f0' }),
        grey: new THREE.MeshLambertMaterial({ color: '#4a5059' }),
        red: new THREE.MeshLambertMaterial({ color: '#d63a2f' }),
      };
      const group = new THREE.Group();
      group.rotation.order = 'YXZ';
      const model = buildModel(materials);
      group.add(model);

      // Health bar (always faces the camera)
      const bar = new THREE.Group();
      const bgGeo = new THREE.PlaneGeometry(0.8, 0.08);
      const fgGeo = new THREE.PlaneGeometry(0.76, 0.05);
      fgGeo.translate(0.38, 0, 0);                 // so it shrinks toward the left
      const bg = new THREE.Mesh(bgGeo, new THREE.MeshBasicMaterial({ color: 0x0b0d12, transparent: true, opacity: 0.75, depthTest: false }));
      const fg = new THREE.Mesh(fgGeo, new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false }));
      fg.position.set(-0.38, 0, 0.001);
      bg.renderOrder = 10; fg.renderOrder = 11;
      bar.add(bg, fg);
      bar.position.set(0, 2.15, 0);
      group.add(bar);

      group.position.set(def.x, def.y, def.z);
      scene.add(group);

      const d = {
        id: i,
        def,
        group, bar, fg,
        materials: Object.values(materials),
        x: def.x, y: def.y, z: def.z,
        hp: MAX_HP,
        alive: true,
        respawnAt: 0,
        flash: 0,
        fall: 0,            // 0 = standing, 1 = lying down
        pop: 1,             // grows from small to 1 after respawn
        facing: 0,
        pauseUntil: 0,
        target: def.patrol ? { x: def.patrol.x, z: def.patrol.z } : null,
        collider: P.makeBox(def.x, def.y, def.z, BODY_W, P.C.HEIGHT, BODY_W),
      };
      if (def.patrol) d.facing = Math.atan2(def.patrol.x - def.x, def.patrol.z - def.z);
      this.list.push(d);
    });
  }

  /** Practice mode shows the dummies; online play hides them. */
  setActive(on) {
    this.active = on;
    for (const d of this.list) d.group.visible = on;
  }

  /** Scan Pulse in practice mode: dummies within range show through walls. */
  setXray(origin, range) {
    for (const dm of this.list) {
      const on = !!origin && dm.alive && Math.hypot(dm.x - origin.x, dm.z - origin.z) <= range;
      if (on === dm.xray) continue;
      dm.xray = on;
      for (const m of dm.materials) { m.depthTest = !on; m.needsUpdate = true; }
      dm.group.traverse((o) => { if (o.isMesh && dm.materials.includes(o.material)) o.renderOrder = on ? 9 : 0; });
    }
  }

  /** Boxes that block the player's movement (only dummies that are standing). */
  colliders() {
    const out = [];
    if (this.active === false) return out;
    for (const d of this.list) if (d.alive) out.push(d.collider);
    return out;
  }

  /** Nearest dummy hit by a ray (no farther than maxT). Returns { dummy, t, head, nx, ny, nz } or null. */
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null;
    if (this.active === false) return null;
    for (const d of this.list) {
      if (!d.alive) continue;
      const r = P.rayVsBody(ox, oy, oz, dx, dy, dz, d.x, d.y, d.z, P.C.HEIGHT);
      if (r && r.t <= maxT && (!best || r.t < best.t)) {
        best = { dummy: d, t: r.t, head: r.head, nx: r.nx, ny: r.ny, nz: r.nz };
      }
    }
    return best;
  }

  /** Returns true if this hit killed it. */
  damage(d, amount, now) {
    if (!d.alive) return false;
    d.hp = Math.max(0, d.hp - amount);
    d.flash = 1;
    if (d.hp <= 0) {
      d.alive = false;
      d.respawnAt = now + RESPAWN_TIME;
      d.bar.visible = false;
      return true;
    }
    return false;
  }

  update(dt, now, camera, player) {
    const pxz = player ? { x: player.x, z: player.z } : null;

    for (const d of this.list) {
      // ---- dead: fall over, then stand back up
      if (!d.alive) {
        d.fall = Math.min(1, d.fall + dt * 2.4);
        if (now >= d.respawnAt) this.respawn(d);
      } else {
        d.pop = Math.min(1, d.pop + dt * 4);
      }

      // ---- walking back and forth
      if (d.alive && d.target) {
        if (now >= d.pauseUntil) {
          const dx = d.target.x - d.x, dz = d.target.z - d.z;
          const dist = Math.hypot(dx, dz);
          const step = d.def.speed * dt;
          if (dist <= step) {
            d.x = d.target.x; d.z = d.target.z;
            // swap targets and rest for a moment
            const other = (d.target.x === d.def.patrol.x && d.target.z === d.def.patrol.z)
              ? { x: d.def.x, z: d.def.z } : { x: d.def.patrol.x, z: d.def.patrol.z };
            d.target = other;
            d.pauseUntil = now + 0.8;
          } else {
            const nx = d.x + dx / dist * step, nz = d.z + dz / dist * step;
            // do not walk into the player
            const blocked = pxz && player.y < d.y + P.C.HEIGHT && player.y + P.C.HEIGHT > d.y &&
              Math.hypot(nx - pxz.x, nz - pxz.z) < P.C.RADIUS + BODY_W / 2 + 0.3;
            if (!blocked) { d.x = nx; d.z = nz; }
            d.facing = Math.atan2(dx, dz);
          }
          P.setBox(d.collider, d.x, d.y, d.z, BODY_W, P.C.HEIGHT, BODY_W);
        }
      } else if (d.alive && pxz) {
        // stationary dummies slowly turn to look at you
        const want = Math.atan2(pxz.x - d.x, pxz.z - d.z);
        let diff = want - d.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        d.facing += Math.max(-dt * 2.5, Math.min(dt * 2.5, diff));
      }

      // ---- pose and colour
      d.group.position.set(d.x, d.y, d.z);
      d.group.rotation.y = d.facing;
      const fallEase = d.fall * d.fall * (3 - 2 * d.fall);
      d.group.rotation.x = -Math.PI / 2 * fallEase;
      const s = 0.25 + 0.75 * (d.pop * d.pop * (3 - 2 * d.pop));
      d.group.scale.setScalar(d.alive ? s : 1);

      if (d.flash > 0) d.flash = Math.max(0, d.flash - dt * 6);
      for (const m of d.materials) {
        m.emissive.setScalar(d.flash * 0.5);
      }

      // health bar faces the camera
      if (d.alive && camera) {
        d.bar.quaternion.copy(camera.quaternion);
        // undo the group's own rotation so the bar stays screen-aligned
        d.bar.quaternion.premultiply(d.group.quaternion.clone().invert());
        const pct = d.hp / MAX_HP;
        d.fg.scale.x = Math.max(0.001, pct);
        d.fg.material.color.set(pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#facc15' : '#ef4444');
        d.bar.visible = d.hp < MAX_HP;
      }
    }
  }

  respawn(d) {
    d.alive = true;
    d.hp = MAX_HP;
    d.fall = 0;
    d.pop = 0;
    d.flash = 0;
    d.x = d.def.x; d.y = d.def.y; d.z = d.def.z;
    if (d.def.patrol) {
      d.target = { x: d.def.patrol.x, z: d.def.patrol.z };
      d.pauseUntil = 0;
    }
    P.setBox(d.collider, d.x, d.y, d.z, BODY_W, P.C.HEIGHT, BODY_W);
    d.bar.visible = false;
    if (this.onRespawn) this.onRespawn(d);
  }
}

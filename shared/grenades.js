/*
 * shared/grenades.js
 *
 * How grenades fly, bounce, stick and go off, and how much they hurt. The server runs this
 * for real; the browser runs the same code for the practice range and to draw the throw arc.
 *
 * The simulation only decides WHAT happens (it returns events). The host (the server room or
 * the practice mode) turns the events into damage, blindness and effects.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const physics = isNode ? require('./physics') : root.ArenaShared.Physics;
  const weapons = isNode ? require('./weapons') : root.ArenaShared.Weapons;
  const api = factory(physics, weapons);
  if (isNode) {
    module.exports = api;
  } else {
    root.ArenaShared = root.ArenaShared || {};
    root.ArenaShared.Grenades = api;
  }
})(typeof self !== 'undefined' ? self : this, function (P, W) {
  'use strict';

  const RADIUS = 0.12;        // size of a grenade for bouncing
  const GRAVITY = 20;
  const THROW_SPEED = 17;     // m/s
  const THROW_LIFT = 0.12;    // radians: grenades are thrown a little above where you look
  const BOUNCE = 0.45;        // how much speed survives a bounce
  const FRICTION = 0.75;      // sideways speed kept on a bounce
  const STEP = 1 / 60;
  const MAX_SPEED = 30;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------------------------------------------------------------- one body

  /** The position and velocity a grenade starts with when thrown from a player. */
  function launch(phys, yaw, pitch, eyeHeight, boxes) {
    const dir = P.forwardVector(yaw, clamp(pitch + THROW_LIFT, -1.4, 1.4));
    const ox = phys.x, oy = phys.y + eyeHeight, oz = phys.z;
    let reach = 0.5;
    if (boxes) {
      const wall = P.raycastWorld(ox, oy, oz, dir.x, dir.y, dir.z, reach + RADIUS, boxes);
      if (wall) reach = Math.max(0, wall.t - RADIUS - 0.02);       // thrown at a wall right in front of you
    }
    return {
      x: ox + dir.x * reach, y: oy + dir.y * reach - 0.1, z: oz + dir.z * reach,
      vx: dir.x * THROW_SPEED + (phys.vx || 0) * 0.5,
      vy: dir.y * THROW_SPEED,
      vz: dir.z * THROW_SPEED + (phys.vz || 0) * 0.5,
    };
  }

  /**
   * Moves a ball by dt seconds under gravity, bouncing off the floor and every box.
   * b = { x, y, z, vx, vy, vz, grounded }. Returns the number of surfaces it touched.
   */
  function stepBody(b, dt, boxes) {
    let touches = 0;
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const n = Math.max(1, Math.ceil(speed * dt / 0.08));          // small moves so it cannot skip through a wall
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      b.vy -= GRAVITY * h;
      b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
      b.grounded = false;

      // floor
      if (b.y < RADIUS) {
        b.y = RADIUS;
        if (b.vy < 0) {
          b.vy = -b.vy * BOUNCE;
          b.vx *= FRICTION; b.vz *= FRICTION;
          if (b.vy < 1.2) b.vy = 0;
          touches++;
        }
        if (b.vy === 0) {
          b.grounded = true;
          const k = Math.exp(-4 * h);                              // rolling to a stop
          b.vx *= k; b.vz *= k;
          if (Math.hypot(b.vx, b.vz) < 0.25) { b.vx = 0; b.vz = 0; }
        }
      }

      // boxes (sphere against box)
      for (let j = 0; j < boxes.length; j++) {
        const bx = boxes[j];
        const cx = clamp(b.x, bx.minX, bx.maxX), cy = clamp(b.y, bx.minY, bx.maxY), cz = clamp(b.z, bx.minZ, bx.maxZ);
        let dx = b.x - cx, dy = b.y - cy, dz = b.z - cz;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        let nx, ny, nz, pen;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          nx = dx / d; ny = dy / d; nz = dz / d; pen = RADIUS - d;
        } else {
          // the centre is inside the box: leave through the nearest face
          const faces = [
            [b.x - bx.minX, -1, 0, 0], [bx.maxX - b.x, 1, 0, 0],
            [b.y - bx.minY, 0, -1, 0], [bx.maxY - b.y, 0, 1, 0],
            [b.z - bx.minZ, 0, 0, -1], [bx.maxZ - b.z, 0, 0, 1],
          ];
          let best = faces[0];
          for (const f of faces) if (f[0] < best[0]) best = f;
          nx = best[1]; ny = best[2]; nz = best[3]; pen = best[0] + RADIUS;
        }
        b.x += nx * pen; b.y += ny * pen; b.z += nz * pen;
        const vn = b.vx * nx + b.vy * ny + b.vz * nz;
        if (vn < 0) {
          // keep the sideways part (slowed by friction), flip the part going into the surface
          const tx = b.vx - vn * nx, ty = b.vy - vn * ny, tz = b.vz - vn * nz;
          b.vx = tx * FRICTION - vn * nx * BOUNCE;
          b.vy = ty * FRICTION - vn * ny * BOUNCE;
          b.vz = tz * FRICTION - vn * nz * BOUNCE;
          if (ny > 0.7 && Math.abs(b.vy) < 1.2) { b.vy = 0; b.grounded = true; }
          touches++;
        }
      }
      if (Math.hypot(b.vx, b.vy, b.vz) > MAX_SPEED) {
        const k = MAX_SPEED / Math.hypot(b.vx, b.vy, b.vz);
        b.vx *= k; b.vy *= k; b.vz *= k;
      }
    }
    return touches;
  }

  /**
   * The path a thrown grenade will take (for the aiming arc). Returns a list of [x, y, z]
   * points about 1/10 s apart, ending when it has been still for a moment or after `seconds`.
   */
  function previewPath(start, boxes, seconds) {
    const b = { x: start.x, y: start.y, z: start.z, vx: start.vx, vy: start.vy, vz: start.vz, grounded: false };
    const pts = [[b.x, b.y, b.z]];
    let still = 0;
    const total = seconds || 3.5;
    for (let t = 0; t < total; t += 0.1) {
      stepBody(b, 0.05, boxes);
      stepBody(b, 0.05, boxes);
      pts.push([b.x, b.y, b.z]);
      if (b.grounded && Math.hypot(b.vx, b.vz) < 0.1) { still += 0.1; if (still > 0.2) break; } else still = 0;
    }
    return pts;
  }

  /**
   * What the throw preview shows: a straight line from your hand to the spot where the grenade first
   * lands, and (unless it sticks) one short line for where it goes after the first bounce.
   * Returns { impact: [x, y, z], after: [x, y, z] | null }.
   */
  function previewImpact(start, boxes, sticky) {
    const b = { x: start.x, y: start.y, z: start.z, vx: start.vx, vy: start.vy, vz: start.vz, grounded: false };
    let impact = null;
    for (let i = 0; i < 160 && !impact; i++) {          // up to 4 s
      if (stepBody(b, 1 / 40, boxes) > 0) impact = [b.x, b.y, b.z];
    }
    if (!impact) return { impact: [b.x, b.y, b.z], after: null };
    if (sticky) return { impact, after: null };
    // follow the bounce for a moment (until it touches again, stops, or half a second passes)
    let after = null;
    for (let i = 0; i < 20; i++) {
      const hit = stepBody(b, 1 / 40, boxes);
      after = [b.x, b.y, b.z];
      if (hit > 0 || (b.grounded && Math.hypot(b.vx, b.vz) < 0.2)) break;
    }
    const d = after ? Math.hypot(after[0] - impact[0], after[1] - impact[1], after[2] - impact[2]) : 0;
    return { impact, after: d > 0.3 ? after : null };
  }

  // ---------------------------------------------------------------- damage rules

  function bodyPoints(t) {
    return [
      [t.x, t.y + t.height * 0.55, t.z],     // chest
      [t.x, t.y + t.height * 0.9, t.z],      // head
      [t.x, t.y + 0.25, t.z],                // feet
    ];
  }

  /** True when nothing solid is between two points. */
  function clearLine(ax, ay, az, bx, by, bz, boxes) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    const hit = P.raycastWorld(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05, boxes);
    return !hit;
  }

  /** Can the point see this body (any of chest, head, feet)? */
  function canSeeBody(ox, oy, oz, t, boxes) {
    for (const p of bodyPoints(t)) if (clearLine(ox, oy, oz, p[0], p[1], p[2], boxes)) return true;
    return false;
  }

  /** Shortest distance from a point to a standing or crouching body. */
  function distanceToBody(x, y, z, t) {
    const cx = clamp(x, t.x - P.BODY_HALF, t.x + P.BODY_HALF);
    const cy = clamp(y, t.y, t.y + t.height);
    const cz = clamp(z, t.z - P.BODY_HALF, t.z + P.BODY_HALF);
    return Math.hypot(x - cx, y - cy, z - cz);
  }

  /**
   * Explosion damage (frag and sticky) to one body. center = { x, y, z }.
   * direct = true when the grenade is stuck to this body: full damage.
   */
  function blastDamage(def, center, t, boxes, direct) {
    const d = direct ? 0 : distanceToBody(center.x, center.y, center.z, t);
    if (d >= def.radius) return 0;
    if (!direct && !canSeeBody(center.x, Math.max(center.y, 0.15), center.z, t, boxes)) return 0;
    return Math.round(def.damage * (1 - d / def.radius));
  }

  /**
   * How long (seconds) a flashbang blinds this player: 0 if they are too far or it is behind a wall.
   * t = { x, y, z, height, yaw, pitch } (the player at the moment of the flash).
   */
  function flashDuration(def, center, t, boxes) {
    const eyeY = t.y + (t.height >= P.C.HEIGHT ? P.C.EYE : P.C.CROUCH_EYE);
    const dx = center.x - t.x, dy = center.y - eyeY, dz = center.z - t.z;
    const d = Math.hypot(dx, dy, dz);
    if (d >= def.range) return 0;
    if (!clearLine(center.x, center.y, center.z, t.x, eyeY, t.z, boxes)) return 0;
    const f = P.forwardVector(t.yaw || 0, t.pitch || 0);
    const dot = d > 1e-6 ? (f.x * dx + f.y * dy + f.z * dz) / d : 1;
    const look = 0.15 + 0.85 * Math.pow((dot + 1) / 2, 2);        // facing it: 1.0, side on: about 0.36, back turned: 0.15
    const secs = def.maxBlind * (1 - d / def.range) * look;
    return secs < 0.15 ? 0 : Math.round(secs * 10) / 10;
  }

  /** Is this body standing in a fire zone (a circle on the ground, not behind a wall)? */
  function inFire(zone, t, boxes) {
    const flat = Math.hypot(t.x - zone.x, t.z - zone.z);
    if (flat - 0.3 > zone.r) return false;
    if (t.y > zone.y + 2.2) return false;
    return clearLine(zone.x, zone.y + 0.35, zone.z, t.x, t.y + Math.min(0.9, t.height * 0.5), t.z, boxes);
  }

  // ---------------------------------------------------------------- the simulation

  class Sim {
    constructor(boxes) {
      this.boxes = boxes;
      this.list = [];        // grenades in the air or waiting to go off
      this.zones = [];       // smoke clouds and fire on the ground
      this.nextId = 1;
      this.acc = 0;
      this.time = 0;
    }

    /** Starts a grenade. from = the result of launch(). Returns the new grenade. */
    spawn(owner, type, from) {
      const def = W.grenade(type);
      const g = {
        id: this.nextId++, owner, type, def,
        x: from.x, y: from.y, z: from.z, vx: from.vx, vy: from.vy, vz: from.vz,
        grounded: false, age: 0,
        fuseLeft: def.sticky ? null : def.fuse,      // a sticky grenade starts counting when it sticks
        stuck: null,                                  // null, 'wall' or { id, ox, oy, oz } (on a player)
      };
      this.list.push(g);
      return g;
    }

    /**
     * Advance by dt seconds. targets = [{ id, x, y, z, height }] (everyone who can be stuck to).
     * Returns events: { kind: 'boom', g } | { kind: 'zoneEnd', zone }. Fire damage is asked for with fireDamage().
     */
    step(dt, targets) {
      const events = [];
      this.acc += dt;
      let guard = 0;
      while (this.acc >= STEP && guard++ < 12) {
        this.acc -= STEP;
        this.time += STEP;
        this.tick(STEP, targets || [], events);
      }
      if (guard >= 12) this.acc = 0;
      return events;
    }

    /**
     * Who gets burned right now by the fire zone. Call it every frame or server tick with the people alive.
     * Walking into the fire hurts at once for 2 ticks (12), then 1 tick (6) every half second while you stay in it.
     * Returns [{ id, dmg }].
     */
    fireDamage(zone, targets) {
      const def = zone.def;
      const perTick = Math.round(def.dps * def.tick);
      const out = [];
      const inside = new Set();
      for (const t of targets) {
        if (!inFire(zone, t, this.boxes)) continue;
        inside.add(t.id);
        if (!zone.victims.has(t.id)) {
          zone.victims.set(t.id, this.time + def.tick);
          out.push({ id: t.id, dmg: perTick * 2 });
        } else if (this.time >= zone.victims.get(t.id)) {
          zone.victims.set(t.id, zone.victims.get(t.id) + def.tick);
          out.push({ id: t.id, dmg: perTick });
        }
      }
      for (const id of [...zone.victims.keys()]) if (!inside.has(id)) zone.victims.delete(id);
      return out;
    }

    tick(dt, targets, events) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const g = this.list[i];
        g.age += dt;
        let boom = false;

        if (g.stuck && g.stuck !== 'wall') {
          const t = targets.find((q) => q.id === g.stuck.id);
          if (t) { g.x = t.x + g.stuck.ox; g.y = t.y + g.stuck.oy; g.z = t.z + g.stuck.oz; }
          else { g.stuck = null; g.vx = g.vy = g.vz = 0; }      // the player is gone: it drops
        }
        if (!g.stuck) {
          const touched = stepBody(g, dt, this.boxes);
          if (g.def.sticky) {
            if (touched > 0) { g.stuck = 'wall'; g.vx = g.vy = g.vz = 0; g.fuseLeft = g.def.fuse; }
            else {
              for (const t of targets) {
                if (g.owner === t.id && g.age < 0.3) continue;       // not your own hand as you throw it
                if (g.x > t.x - P.BODY_HALF && g.x < t.x + P.BODY_HALF && g.z > t.z - P.BODY_HALF && g.z < t.z + P.BODY_HALF &&
                    g.y > t.y && g.y < t.y + t.height) {
                  g.stuck = { id: t.id, ox: g.x - t.x, oy: g.y - t.y, oz: g.z - t.z };
                  g.vx = g.vy = g.vz = 0; g.fuseLeft = g.def.fuse;
                  break;
                }
              }
            }
            if (!g.stuck && g.age > g.def.maxFlight) boom = true;     // never found anything to stick to
          }
        }
        if (g.fuseLeft !== null) {
          g.fuseLeft -= dt;
          if (g.fuseLeft <= 0) boom = true;
        }
        if (boom) {
          this.list.splice(i, 1);
          const def = g.def;
          if (def.kind === 'smoke' || def.kind === 'incendiary') {
            const zone = {
              id: g.id, owner: g.owner, type: def.id, kind: def.kind, def,
              x: g.x, y: Math.max(0, g.y - RADIUS), z: g.z, r: def.radius,
              left: def.duration, victims: new Map(),     // victims: who is standing in the fire and when they burn next
            };
            this.zones.push(zone);
            events.push({ kind: 'boom', g, zone });
          } else {
            events.push({ kind: 'boom', g });
          }
        }
      }

      for (let i = this.zones.length - 1; i >= 0; i--) {
        const z = this.zones[i];
        z.left -= dt;
        if (z.left <= 0) { this.zones.splice(i, 1); events.push({ kind: 'zoneEnd', zone: z }); }
      }
    }
  }

  return {
    RADIUS, GRAVITY, THROW_SPEED, THROW_LIFT, BOUNCE, STEP,
    launch, stepBody, previewPath, previewImpact,
    clearLine, canSeeBody, distanceToBody, blastDamage, flashDuration, inFire,
    Sim,
  };
});

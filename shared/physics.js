/*
 * shared/physics.js
 *
 * Movement, collision and ray tests. This ONE file is used by the browser now
 * and by the Node server from Stage 2 on, so both always agree on what a wall is.
 *
 * Conventions
 *  - Units are metres, Y is up.
 *  - A box is { x, y, z, w, h, d }: x/z are the CENTRE, y is the BOTTOM,
 *    w = size along X, h = height, d = size along Z.
 *  - yaw 0 looks toward -Z. Forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw).
 *  - A player state is { x, y, z, vx, vy, vz, onGround, crouching, ... } where
 *    (x, y, z) is the point at the player's FEET.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ArenaShared = root.ArenaShared || {};
    root.ArenaShared.Physics = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = {
    RADIUS: 0.4,          // half width of the player's square footprint
    HEIGHT: 1.8,
    CROUCH_HEIGHT: 1.2,
    EYE: 1.62,            // eye height above the feet when standing
    CROUCH_EYE: 1.08,
    WALK: 5,
    SPRINT: 7.5,
    CROUCH: 2.5,
    GRAVITY: 20,
    JUMP_HEIGHT: 1.2,
    ZILLA_JUMP_MUL: 1.9,  // Godzilla jumps with 1.9x the speed, so about 3.6x as high (4.3 m)
    STEP: 0.55,           // highest ledge the player walks up without jumping
    GROUND_ACCEL: 60,
    GROUND_DECEL: 50,
    AIR_ACCEL: 12,
    BHOP_AIR_ACCEL: 20,   // steering in the air while bunny hopping
    BHOP_GAIN: 0.35,      // m/s gained on every hop
    BHOP_MAX: 11,         // top speed a bunny hop can reach, in m/s
    LEAN_DIST: 0.35,      // how far your head moves sideways at full lean, in metres
    LEAN_RATE: 7,         // lean goes from 0 to full in about 0.15 s
    GRAPPLE_SPEED: 24,    // m/s while the hook pulls you
    FIXED_DT: 1 / 60,     // movement is always simulated in steps this small
    EPS: 1e-4,
  };
  C.JUMP_VELOCITY = Math.sqrt(2 * C.GRAVITY * C.JUMP_HEIGHT);

  // ---------------------------------------------------------------- boxes

  /** Fill in minX/maxX/... on a box. Call again if you move or resize it. */
  function setBox(b, x, y, z, w, h, d) {
    b.x = x; b.y = y; b.z = z; b.w = w; b.h = h; b.d = d;
    b.minX = x - w / 2; b.maxX = x + w / 2;
    b.minY = y;         b.maxY = y + h;
    b.minZ = z - d / 2; b.maxZ = z + d / 2;
    return b;
  }

  function makeBox(x, y, z, w, h, d) {
    return setBox({}, x, y, z, w, h, d);
  }

  /** Make sure every box in a list has its min/max fields. */
  function prepareBoxes(boxes) {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.maxX === undefined) setBox(b, b.x, b.y, b.z, b.w, b.h, b.d);
    }
    return boxes;
  }

  function overlaps(s, h, b) {
    const R = C.RADIUS, E = C.EPS;
    return s.x - R < b.maxX - E && s.x + R > b.minX + E &&
           s.z - R < b.maxZ - E && s.z + R > b.minZ + E &&
           s.y < b.maxY - E && s.y + h > b.minY + E;
  }

  function firstOverlap(s, h, boxes) {
    for (let i = 0; i < boxes.length; i++) {
      if (overlaps(s, h, boxes[i])) return boxes[i];
    }
    return null;
  }

  // ------------------------------------------------------------- players

  function newPlayer(x, y, z) {
    return {
      x: x || 0, y: y || 0, z: z || 0,
      vx: 0, vy: 0, vz: 0,
      onGround: false,
      crouching: false,
      jumpLatch: false,
      lean: 0,         // -1 (full left) to 1 (full right)
      dashT: 0, dvx: 0, dvz: 0, dashLift: false,     // a dash or air dash in progress
      gT: 0, gx: 0, gy: 0, gz: 0,                    // a grapple pull in progress (time left, target point)
      // filled in by stepPlayer, handy for sounds and camera
      landed: 0,       // fastest downward speed of a landing this call (0 if none)
      stepRise: 0,     // total height climbed by stepping up this call
    };
  }

  function playerHeight(s) {
    return s.crouching ? C.CROUCH_HEIGHT : C.HEIGHT;
  }

  function canStand(s, boxes) {
    return firstOverlap(s, C.HEIGHT, boxes) === null;
  }

  /** Move out of anything we are stuck inside (for example a moving target). */
  function unstick(s, h, boxes) {
    for (let iter = 0; iter < 4; iter++) {
      const b = firstOverlap(s, h, boxes);
      if (!b) return;
      const R = C.RADIUS;
      const up = b.maxY - s.y;
      const pushes = [
        { d: s.x + R - b.minX, ax: 'x', v: b.minX - R },
        { d: b.maxX - (s.x - R), ax: 'x', v: b.maxX + R },
        { d: s.z + R - b.minZ, ax: 'z', v: b.minZ - R },
        { d: b.maxZ - (s.z - R), ax: 'z', v: b.maxZ + R },
      ];
      let best = null;
      for (const p of pushes) if (!best || p.d < best.d) best = p;
      if (up <= C.STEP && up < best.d) {
        s.y = b.maxY;
        s.vy = 0;
        s.onGround = true;
      } else if (best.ax === 'x') {
        s.x = best.v; s.vx = 0;
      } else {
        s.z = best.v; s.vz = 0;
      }
    }
  }

  function resolveHoriz(s, h, boxes, axis, delta) {
    const R = C.RADIUS;
    for (let iter = 0; iter < 6; iter++) {
      const b = firstOverlap(s, h, boxes);
      if (!b) return;
      // Low ledge? Step up onto it instead of stopping.
      const rise = b.maxY - s.y;
      if (rise > 0 && rise <= C.STEP && s.vy <= 0.01) {
        const oldY = s.y;
        s.y = b.maxY;
        if (!firstOverlap(s, h, boxes)) {
          s.stepRise += rise;
          s.vy = 0;
          s.onGround = true;
          continue;
        }
        s.y = oldY;
      }
      if (axis === 'x') {
        s.x = delta > 0 ? b.minX - R : b.maxX + R;
        s.vx = 0;
      } else {
        s.z = delta > 0 ? b.minZ - R : b.maxZ + R;
        s.vz = 0;
      }
    }
  }

  function subStep(s, inp, dt, boxes) {
    // ---- crouch (you can only stand up if there is room)
    if (inp.crouch) s.crouching = true;
    else if (s.crouching && canStand(s, boxes)) s.crouching = false;
    const h = playerHeight(s);

    // ---- lean (Q and E): only on the ground and not while sprinting, and never into a wall
    let leanTarget = inp.lean || 0;
    if (!s.onGround || inp.sprint) leanTarget = 0;
    if (leanTarget !== 0 || s.lean) {
      const step = C.LEAN_RATE * dt;
      let l = s.lean || 0;
      l += Math.max(-step, Math.min(step, leanTarget - l));
      if (l !== 0) {
        const side = l > 0 ? 1 : -1;
        const ey = s.y + (s.crouching ? C.CROUCH_EYE : C.EYE);
        const hit = raycastWorld(s.x, ey, s.z, Math.cos(inp.yaw || 0) * side, 0, -Math.sin(inp.yaw || 0) * side, C.LEAN_DIST + 0.4, boxes);
        if (hit) {
          const maxL = Math.max(0, (hit.t - 0.3) / C.LEAN_DIST);
          if (Math.abs(l) > maxL) l = side * maxL;
        }
      }
      s.lean = Math.abs(l) < 1e-4 ? 0 : l;
    }

    // ---- ability movement: a dash fixes your sideways speed for a moment, a grapple pulls you to a point
    let override = false;
    if (s.gT > 0) {
      const ex = s.gx - s.x, ey = s.gy - (s.y + 0.9), ez = s.gz - s.z;
      const dist = Math.hypot(ex, ey, ez);
      if (dist < 1.2) { s.gT = 0; s.vy = Math.min(s.vy, 3); s.vx *= 0.4; s.vz *= 0.4; }
      else {
        const sp = C.GRAPPLE_SPEED;
        s.vx = ex / dist * sp; s.vy = ey / dist * sp; s.vz = ez / dist * sp;
        s.gT -= dt;
        s.onGround = false;
        override = true;
        if (s.gT <= 0) { s.vx *= 0.4; s.vz *= 0.4; s.vy = Math.min(s.vy, 3); }
      }
    } else if (s.dashT > 0) {
      s.vx = s.dvx; s.vz = s.dvz;
      if (s.dashLift && s.vy < 1.0) s.vy = 1.0;          // an air dash floats you across gaps
      s.dashT -= dt;
      override = true;
    }

    // ---- wanted velocity from input
    const sin = Math.sin(inp.yaw || 0), cos = Math.cos(inp.yaw || 0);
    let mx = inp.moveX || 0, mz = inp.moveZ || 0;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const hasInput = len > 0.001;
    const wx = -sin * mz + cos * mx;
    const wz = -cos * mz - sin * mx;
    // Bunny hop: only when the caller says so (crouch + jump + sprint with a melee weapon out)
    // and the player is actually moving. It keeps your speed across landings instead of slowing you.
    const bhop = !!inp.bhop && hasInput;
    let speed = s.crouching ? C.CROUCH : (inp.sprint ? C.SPRINT : C.WALK);
    speed *= (inp.speedMult || 1);
    if (bhop) {
      const cur = Math.hypot(s.vx, s.vz);
      speed = Math.max(C.SPRINT * (inp.speedMult || 1), Math.min(cur, C.BHOP_MAX));
    }
    const tx = wx * speed, tz = wz * speed;

    let rate;
    if (s.onGround) rate = hasInput ? C.GROUND_ACCEL : C.GROUND_DECEL;
    else rate = hasInput ? (bhop ? C.BHOP_AIR_ACCEL : C.AIR_ACCEL) : 0;
    const dvx = tx - s.vx, dvz = tz - s.vz;
    const dl = Math.hypot(dvx, dvz);
    const maxd = rate * dt;
    if (override) { /* the dash or grapple decides the velocity */ }
    else if (dl <= maxd) { s.vx = tx; s.vz = tz; }
    else if (dl > 0) { s.vx += dvx / dl * maxd; s.vz += dvz / dl * maxd; }

    // ---- jump (hold the key and you will not bunny hop; release first, unless bhop is on)
    if (inp.jump && !override) {
      if (s.onGround && (!s.jumpLatch || bhop)) {
        s.vy = C.JUMP_VELOCITY * (inp.jumpMul || 1);
        s.onGround = false;
        s.jumpLatch = true;
        if (bhop) {
          // every hop adds a little speed along the way you are heading
          const cur = Math.hypot(s.vx, s.vz);
          if (cur > 0.01) {
            const nv = Math.min(C.BHOP_MAX, cur + C.BHOP_GAIN);
            s.vx *= nv / cur; s.vz *= nv / cur;
          }
        }
      }
    } else {
      s.jumpLatch = false;
    }

    // ---- horizontal move, one axis at a time so we slide along walls
    const dx = s.vx * dt, dz = s.vz * dt;
    if (dx !== 0) { s.x += dx; resolveHoriz(s, h, boxes, 'x', dx); }
    if (dz !== 0) { s.z += dz; resolveHoriz(s, h, boxes, 'z', dz); }

    // ---- vertical move (exact constant-acceleration step)
    const wasOnGround = s.onGround;
    const prevY = s.y;
    // no gravity while a grapple pulls you, and only a quarter of it during an air dash (that is what carries you over gaps)
    const grav = s.gT > 0 ? 0 : (s.dashT > 0 && s.dashLift ? C.GRAVITY * 0.25 : C.GRAVITY);
    s.y += s.vy * dt - 0.5 * grav * dt * dt;
    s.vy -= grav * dt;
    s.onGround = false;

    if (s.y <= 0 && s.vy <= 0) {
      if (!wasOnGround) s.landed = Math.max(s.landed, -s.vy);
      s.y = 0; s.vy = 0; s.onGround = true;
    }
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!overlaps(s, h, b)) continue;
      if (s.vy <= 0 && prevY >= b.maxY - 0.001) {
        if (!wasOnGround) s.landed = Math.max(s.landed, -s.vy);
        s.y = b.maxY; s.vy = 0; s.onGround = true;
      } else if (s.vy > 0 && prevY + h <= b.minY + 0.001) {
        s.y = b.minY - h; s.vy = 0;
      }
    }

    unstick(s, h, boxes);
  }

  /**
   * Advance one player by dt seconds.
   *   input = { moveX (-1..1, right is +), moveZ (-1..1, forward is +), yaw,
   *             jump, crouch, sprint, speedMult, bhop, lean (-1 left, 0, 1 right) }
   * Always simulated in steps of at most 1/60 s so results are repeatable.
   */
  function stepPlayer(s, input, dt, boxes) {
    s.landed = 0;
    s.stepRise = 0;
    const n = Math.max(1, Math.ceil(dt / C.FIXED_DT - 1e-6));
    const h = dt / n;
    for (let i = 0; i < n; i++) subStep(s, input, h, boxes);
  }

  // ----------------------------------------------------------------- rays

  /** Ray against one box. Returns { t, nx, ny, nz } or null. */
  function rayAabb(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
    let tNear = -Infinity, tFar = Infinity;
    let nx = 0, ny = 0, nz = 0;

    if (Math.abs(dx) < 1e-9) {
      if (ox < minX || ox > maxX) return null;
    } else {
      let t1 = (minX - ox) / dx, t2 = (maxX - ox) / dx, n = -1;
      if (t1 > t2) { const k = t1; t1 = t2; t2 = k; n = 1; }
      if (t1 > tNear) { tNear = t1; nx = n; ny = 0; nz = 0; }
      if (t2 < tFar) tFar = t2;
      if (tNear > tFar) return null;
    }
    if (Math.abs(dy) < 1e-9) {
      if (oy < minY || oy > maxY) return null;
    } else {
      let t1 = (minY - oy) / dy, t2 = (maxY - oy) / dy, n = -1;
      if (t1 > t2) { const k = t1; t1 = t2; t2 = k; n = 1; }
      if (t1 > tNear) { tNear = t1; nx = 0; ny = n; nz = 0; }
      if (t2 < tFar) tFar = t2;
      if (tNear > tFar) return null;
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz < minZ || oz > maxZ) return null;
    } else {
      let t1 = (minZ - oz) / dz, t2 = (maxZ - oz) / dz, n = -1;
      if (t1 > t2) { const k = t1; t1 = t2; t2 = k; n = 1; }
      if (t1 > tNear) { tNear = t1; nx = 0; ny = 0; nz = n; }
      if (t2 < tFar) tFar = t2;
      if (tNear > tFar) return null;
    }
    if (tFar < 0) return null;
    if (tNear < 0) return { t: 0, nx: 0, ny: 0, nz: 0 };   // started inside the box
    return { t: tNear, nx, ny, nz };
  }

  /**
   * Like rayAabb but returns both ends of the stretch inside the box: { t0, t1 }, or null.
   * Used to find where a shot that passes through a wall comes out the other side.
   */
  function raySpan(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
    let t0 = -Infinity, t1 = Infinity;
    const o = [ox, oy, oz], d = [dx, dy, dz], lo = [minX, minY, minZ], hi = [maxX, maxY, maxZ];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < lo[i] || o[i] > hi[i]) return null;
      } else {
        let a = (lo[i] - o[i]) / d[i], b = (hi[i] - o[i]) / d[i];
        if (a > b) { const k = a; a = b; b = k; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) return null;
      }
    }
    if (t1 < 0) return null;
    return { t0: Math.max(0, t0), t1 };
  }

  /**
   * Ray against the whole map (and the floor). The direction must be a unit vector.
   * Returns { t, nx, ny, nz, box } for the nearest hit within maxDist, or null.
   * box is null when the floor was hit.
   */
  function raycastWorld(ox, oy, oz, dx, dy, dz, maxDist, boxes) {
    let best = null;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const r = rayAabb(ox, oy, oz, dx, dy, dz, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
      if (r && r.t <= maxDist && (!best || r.t < best.t)) { best = r; r.box = b; }
    }
    if (dy < 0 && oy > 0) {
      const t = -oy / dy;
      if (t <= maxDist && (!best || t < best.t)) best = { t, nx: 0, ny: 1, nz: 0, box: null };
    }
    return best;
  }

  // ------------------------------------------------- body and head hitboxes

  const HEAD_HEIGHT = 0.42;
  const HEAD_HALF = 0.22;
  const BODY_HALF = 0.36;

  /**
   * Ray against a standing or crouching body whose feet are at (x, y, z).
   * Returns { t, head, nx, ny, nz } or null.
   */
  function rayVsBody(ox, oy, oz, dx, dy, dz, x, y, z, height, headDx, headDz, sc) {
    const S = sc || 1;                       // Godzilla's body is bigger (sc 2.4)
    const BH = BODY_HALF * S, HH = HEAD_HALF * S;
    const headBottom = y + height - HEAD_HEIGHT * S;
    const body = rayAabb(ox, oy, oz, dx, dy, dz,
      x - BH, y, z - BH, x + BH, headBottom, z + BH);
    const head = rayAabb(ox, oy, oz, dx, dy, dz,
      x + (headDx || 0) - HH, headBottom, z + (headDz || 0) - HH, x + (headDx || 0) + HH, y + height, z + (headDz || 0) + HH);
    if (head && (!body || head.t <= body.t)) { head.head = true; return head; }
    if (body) { body.head = false; return body; }
    return null;
  }

  // ---------------------------------------------------------------- misc

  /** How far to the side (x, z) the head is when leaning, for a given yaw and lean amount. */
  function leanShift(yaw, lean) {
    const d = C.LEAN_DIST * (lean || 0);
    return { x: Math.cos(yaw || 0) * d, z: -Math.sin(yaw || 0) * d };
  }

  function forwardVector(yaw, pitch) {
    const cp = Math.cos(pitch || 0);
    return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch || 0), z: -Math.cos(yaw) * cp };
  }

  return {
    C, HEAD_HEIGHT, HEAD_HALF, BODY_HALF,
    setBox, makeBox, prepareBoxes, overlaps, firstOverlap,
    newPlayer, playerHeight, canStand, stepPlayer,
    rayAabb, raySpan, raycastWorld, rayVsBody, forwardVector, leanShift,
  };
});

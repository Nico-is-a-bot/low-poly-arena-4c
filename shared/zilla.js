/*
 * shared/zilla.js
 *
 * Godzilla mode. Join with the name "godzilla" and you become him: a huge, slow-to-kill monster with
 *   - Fire Breath (hold left mouse): a cone of fire in front of you. It has a short supply.
 *   - Grab and Eat (right mouse): grab a player in front of you, then bite. They are eaten and you heal.
 *   - Stomp (F): a shockwave around your feet after a short wind-up.
 *   - a very high jump (Space).
 * The server decides everything. The browser only draws it and keeps the little numbers for the HUD.
 * Movement itself still uses the normal player body, so Godzilla fits through the same gaps.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const physics = isNode ? require('./physics') : root.ArenaShared.Physics;
  const api = factory(physics);
  if (isNode) module.exports = api;
  else { root.ArenaShared = root.ArenaShared || {}; root.ArenaShared.Zilla = api; }
})(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';

  const NAME = 'godzilla';
  const DEG = Math.PI / 180;

  const Z = {
    MAX_HP: 400,
    SCALE: 2.4,                 // how much bigger his body (hit box and picture) is
    EYE: 3.7,                   // eye height above the feet
    MOUTH: 3.5,                 // where the fire comes from
    BREATH: { range: 20, halfAngle: 14, dps: 60, tick: 0.2, max: 3.5, regen: 0.45, min: 0.4 },
    GRAB: { range: 4.5, halfAngle: 55, hold: 1.3, cd: 6, heal: 80, forward: 1.7, up: 2.3 },
    STOMP: { radius: 9, damage: 35, windup: 0.35, cd: 4, maxHeight: 2.5 },
  };

  function isName(raw) {
    return typeof raw === 'string' && raw.trim().toLowerCase() === NAME;
  }

  function newState() {
    return {
      breath: Z.BREATH.max,    // seconds of fire left
      breathing: false,
      acc: 0,                  // time since the last fire damage tick
      grab: 0,                 // id of the player in his hand (0 = none)
      grabT: 0,                // seconds the grab has lasted
      grabCd: 0, stompCd: 0,
      stompT: 0,               // > 0 while the stomp wind-up runs
      fire: false, aim: false, stomp: false,       // what the player is pressing right now
    };
  }

  /**
   * The command with every gun, grenade and ability action switched off. This is what the shared movement code
   * sees for Godzilla, so he never uses ammo and cannot crouch (his big body would not fit).
   */
  function maskCmd(cmd) {
    const c = Object.assign({}, cmd);
    c.fire = false; c.fresh = false; c.aim = false; c.reload = false; c.quick = false; c.throw = false;
    c.ability = false; c.crouch = false; c.slot = -1; c.zilla = true;
    return c;
  }

  /** The eye (and where the fire starts) of a Godzilla standing at phys. */
  function eye(phys) {
    return { x: phys.x, y: phys.y + Z.EYE, z: phys.z };
  }

  /** Where a player held in his hand is drawn and kept (feet position). */
  function handPos(phys, yaw) {
    return { x: phys.x - Math.sin(yaw) * Z.GRAB.forward, y: phys.y + Z.GRAB.up, z: phys.z - Math.cos(yaw) * Z.GRAB.forward };
  }

  /**
   * Is the target inside a cone that starts at (ox, oy, oz), looks along (yaw, pitch), reaches `range`
   * and is `halfDeg` wide on each side? The target is a body { x, y, z, height, sc }.
   * Returns the distance to the middle of the body, or -1.
   */
  function coneDistance(ox, oy, oz, yaw, pitch, t, range, halfDeg) {
    const f = P.forwardVector(yaw, pitch);
    const sc = t.sc || 1;
    const cy = t.y + t.height * 0.55;
    const dx = t.x - ox, dy = cy - oy, dz = t.z - oz;
    const d = Math.hypot(dx, dy, dz);
    const rad = P.BODY_HALF * 1.4 * sc;
    if (d > range + rad) return -1;
    if (d < 1e-6) return 0;
    const cos = (dx * f.x + dy * f.y + dz * f.z) / d;
    const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
    const slack = Math.atan2(rad + 0.25, Math.max(d, 0.5));        // a wide body counts if its edge is in the cone
    return ang <= halfDeg * DEG + slack ? d : -1;
  }

  /** Flat distance and the angle off to the side (radians) from Godzilla to a target. */
  function flatInfo(phys, yaw, t) {
    const dx = t.x - phys.x, dz = t.z - phys.z;
    const d = Math.hypot(dx, dz);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const cos = d < 1e-6 ? 1 : (dx * fx + dz * fz) / d;
    return { d, ang: Math.acos(Math.max(-1, Math.min(1, cos))) };
  }

  /** Can a grab reach this target? */
  function canGrab(phys, yaw, t) {
    const g = Z.GRAB;
    const info = flatInfo(phys, yaw, t);
    if (info.d > g.range) return false;
    if (Math.abs(t.y - phys.y) > 2.5) return false;
    return info.d < 0.9 || info.ang <= g.halfAngle * DEG;
  }

  /** Who is close enough for the stomp (flat distance, near the ground like him). */
  function stompReach(phys, t) {
    const d = Math.hypot(t.x - phys.x, t.z - phys.z);
    if (d > Z.STOMP.radius) return -1;
    if (t.y > phys.y + Z.STOMP.maxHeight) return -1;      // jumping over it works
    return d;
  }

  function stompDamage(d) {
    return Math.round(Z.STOMP.damage * (1 - 0.5 * d / Z.STOMP.radius));      // 35 close up, 18 at the edge
  }

  const r1 = (v) => Math.round(v * 10) / 10;

  /** Small form for the HUD: [fire left, grab cooldown, stomp cooldown, holding someone (0/1), grab time, stomp wind-up]. */
  function pack(st) {
    return [r1(st.breath), r1(st.grabCd), r1(st.stompCd), st.grab ? 1 : 0, r1(st.grabT), r1(st.stompT)];
  }

  return {
    NAME, ...Z, isName, newState, maskCmd, eye, handPos, coneDistance, canGrab, stompReach, stompDamage, pack,
  };
});

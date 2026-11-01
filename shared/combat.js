/*
 * shared/combat.js
 *
 * The rules that must be identical on the server and in the browser:
 *   - one fixed simulation tick for a player (movement + weapon)
 *   - weapon state: ammo, reloading, fire rate, aiming, bloom
 *   - bullet spread and the direction of each shot (repeatable random numbers)
 *   - tracing a shot against the map and against other players
 *   - the small packed "command" that the browser sends to the server every tick
 *
 * Because both sides run this exact code, the browser can predict what the
 * server will decide, and the server stays in charge of what really happens.
 */
(function (root, factory) {
  const physics = (typeof module === 'object' && module.exports)
    ? require('./physics')
    : root.ArenaShared.Physics;
  const weapons = (typeof module === 'object' && module.exports)
    ? require('./weapons')
    : root.ArenaShared.Weapons;
  const api = factory(physics, weapons);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ArenaShared = root.ArenaShared || {};
    root.ArenaShared.Combat = api;
  }
})(typeof self !== 'undefined' ? self : this, function (P, W) {
  'use strict';

  const FIXED = P.C.FIXED_DT;
  const MAX_HEALTH = 100;
  const RESPAWN_TIME = 3;          // seconds
  const SPAWN_PROTECTION = 1.5;    // seconds of invulnerability after a respawn
  const MAX_PLAYERS = 4;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------------------------------------------------------------- weapon state
  //
  // One player carries three weapons: slot 0 primary, 1 secondary, 2 melee.
  // Every slot keeps its own ammo and fire timer. Reloading, aiming and spread belong to
  // whichever weapon is in hand, and they reset when you switch.

  function newWeaponState(loadout) {
    const lo = Array.isArray(loadout)
      ? { primary: loadout[0], secondary: loadout[1], melee: loadout[2] }
      : loadout;
    const ids = W.loadoutIds(lo);
    const lo2 = W.validateLoadout(lo);
    return {
      ids,
      cur: 0,
      slots: ids.map((id) => {
        const w = W.get(id);
        return { mag: w.mag, reserve: w.reserve, cd: 0 };
      }),
      reloading: false, reloadLeft: 0,
      ads: 0,               // 0 = hip, 1 = fully aimed
      bloom: 0,             // extra spread (degrees) from firing
      sinceShot: 10,        // seconds since the last shot
      shots: 0,             // total shots fired (picks the random numbers)
      swings: 0,            // total melee swings
      emptyHandled: false,
      switchLeft: 0,        // seconds until the weapon in hand is ready
      burstLeft: 0,         // shots still to come in a burst
      quick: 0,             // quick knife: 0 none, 1 waiting to swing, 2 swung, will go back
      quickReturn: -1,      // slot to go back to after a quick knife
      grenade: lo2.grenade, // which grenade you carry
      gcount: W.GRENADE_MAX,
      gregen: 0,            // seconds towards the next grenade
      gcd: 0,               // seconds until you may throw again
      abl: lo2.ability,     // which ability you carry
      acd: 0,               // seconds until the ability is ready
      boost: 0,             // seconds of speed boost left (Second Wind)
    };
  }

  function copyWeaponState(from, to) {
    to.ids = from.ids.slice();
    if (!to.slots || to.slots.length !== from.slots.length) to.slots = from.slots.map(() => ({}));
    for (let i = 0; i < from.slots.length; i++) {
      to.slots[i].mag = from.slots[i].mag;
      to.slots[i].reserve = from.slots[i].reserve;
      to.slots[i].cd = from.slots[i].cd;
    }
    to.cur = from.cur;
    to.reloading = !!from.reloading; to.reloadLeft = from.reloadLeft;
    to.ads = from.ads; to.bloom = from.bloom;
    to.sinceShot = from.sinceShot; to.shots = from.shots; to.swings = from.swings;
    to.emptyHandled = !!from.emptyHandled;
    to.switchLeft = from.switchLeft; to.burstLeft = from.burstLeft;
    to.quick = from.quick; to.quickReturn = from.quickReturn;
    to.grenade = from.grenade; to.gcount = from.gcount; to.gregen = from.gregen; to.gcd = from.gcd;
    to.abl = from.abl; to.acd = from.acd; to.boost = from.boost;
    return to;
  }

  function copyPhysState(from, to) {
    to.x = from.x; to.y = from.y; to.z = from.z;
    to.vx = from.vx; to.vy = from.vy; to.vz = from.vz;
    to.onGround = !!from.onGround; to.crouching = !!from.crouching; to.jumpLatch = !!from.jumpLatch;
    to.lean = from.lean || 0;
    to.dashT = from.dashT || 0; to.dvx = from.dvx || 0; to.dvz = from.dvz || 0; to.dashLift = !!from.dashLift;
    to.gT = from.gT || 0; to.gx = from.gx || 0; to.gy = from.gy || 0; to.gz = from.gz || 0;
    return to;
  }

  /** Compact form of a weapon state for snapshots. */
  function packWeaponState(st) {
    return {
      c: st.cur,
      s: st.slots.map((sl) => [sl.mag, sl.reserve, sl.cd]),
      rl: st.reloading ? 1 : 0, rt: st.reloadLeft,
      ads: st.ads, bl: st.bloom, ss: st.sinceShot, sh: st.shots, sw: st.swings,
      eh: st.emptyHandled ? 1 : 0, sv: st.switchLeft, bu: st.burstLeft, q: st.quick, qr: st.quickReturn,
      gc: st.gcount, gr: st.gregen, gd: st.gcd, ac: st.acd, bo: st.boost,
    };
  }

  /** Copies a packed weapon state onto a live one (the loadout ids stay as they are). */
  function applyWeaponPacket(m, st) {
    st.cur = m.c;
    for (let i = 0; i < st.slots.length; i++) {
      st.slots[i].mag = m.s[i][0]; st.slots[i].reserve = m.s[i][1]; st.slots[i].cd = m.s[i][2];
    }
    st.reloading = !!m.rl; st.reloadLeft = m.rt;
    st.ads = m.ads; st.bloom = m.bl; st.sinceShot = m.ss; st.shots = m.sh; st.swings = m.sw;
    st.emptyHandled = !!m.eh; st.switchLeft = m.sv; st.burstLeft = m.bu; st.quick = m.q; st.quickReturn = m.qr;
    st.gcount = m.gc; st.gregen = m.gr; st.gcd = m.gd; st.acd = m.ac || 0; st.boost = m.bo || 0;
    return st;
  }

  /** The weapon definition in hand. */
  function curWeapon(st) { return W.get(st.ids[st.cur]); }
  /** The ammo entry of the weapon in hand: { mag, reserve, cd }. */
  function curSlot(st) { return st.slots[st.cur]; }

  /** Walking speed multiplier: lighter weapons are a bit faster, aiming slows you down. */
  function speedMult(st) {
    const w = curWeapon(st);
    const boost = st.boost > 0 ? W.ability('secondwind').boost : 1;      // Second Wind speed boost
    return w.weight * lerp(1, w.adsMoveMult, st.ads) * boost;
  }

  /** Current bullet spread cone in degrees. kin = { speed, crouching, onGround } */
  function spreadDeg(w, st, kin) {
    const sp = w.spread;
    const base = lerp(sp.hip, sp.ads, st.ads);
    // Moving blows the cone wide open: walking adds sp.move degrees, sprinting adds half again.
    // Aiming only softens it a little, so you have to stop to shoot straight.
    const moving = sp.move * Math.min(1.5, kin.speed / P.C.WALK) * (1 - 0.35 * st.ads);
    let total = base + moving + st.bloom * (1 - 0.5 * st.ads);
    if (kin.crouching) total *= 0.75;
    if (!kin.onGround) total += sp.air;
    return total;
  }

  function startReload(st) {
    const w = curWeapon(st), slot = curSlot(st);
    if (w.type !== 'gun') return false;
    if (st.reloading || st.switchLeft > 0 || slot.mag >= w.mag || slot.reserve <= 0) return false;
    st.reloading = true;
    st.reloadLeft = w.reloadMode === 'shell' ? w.shellTime : w.reloadTime;
    return true;
  }

  function doSwitch(st, slot, equipOverride) {
    if (slot === st.cur) return false;
    st.cur = slot;
    st.reloading = false; st.reloadLeft = 0;
    st.ads = 0; st.bloom = 0; st.burstLeft = 0;
    st.emptyHandled = false;
    const eq = curWeapon(st).equipTime;
    st.switchLeft = equipOverride !== undefined ? Math.min(eq, equipOverride) : eq;
    return true;
  }

  /**
   * Handles a weapon-switch request in a command (cmd.slot 0..2, or cmd.quick for the quick knife).
   * Returns { switched, reloadCancelled }.
   */
  function applySwitch(st, cmd) {
    const r = { switched: false, reloadCancelled: false };
    if (typeof cmd.slot === 'number' && cmd.slot >= 0 && cmd.slot < st.slots.length) {
      st.quick = 0; st.quickReturn = -1;
      if (cmd.slot !== st.cur) {
        r.reloadCancelled = st.reloading;
        doSwitch(st, cmd.slot);
        r.switched = true;
      }
    }
    if (cmd.quick && st.quick === 0) {
      if (st.cur !== 2) {
        st.quickReturn = st.cur;
        r.reloadCancelled = r.reloadCancelled || st.reloading;
        doSwitch(st, 2, 0.12);
        r.switched = true;
      }
      st.quick = 1;
    }
    return r;
  }

  /**
   * One tick of weapon logic for the weapon in hand.
   * cmd = { aim, fire, fresh, reload }, kin = { speed, crouching, onGround, sprint }.
   * Returns events: { fired, shotIndex, spreadDeg, slot, reloadStarted, reloadDone, reloadCancelled,
   *                   shellLoaded, swung, swingIndex, empty, switched }.
   */
  function stepWeapon(st, cmd, kin, dt) {
    const ev = {
      fired: false, shotIndex: 0, spreadDeg: 0, slot: st.cur,
      reloadStarted: false, reloadDone: false, reloadCancelled: false, shellLoaded: false,
      swung: false, swingIndex: 0, empty: false, switched: false,
    };
    const w = curWeapon(st), slot = curSlot(st);
    const isGun = w.type === 'gun';

    // fire-rate timers of every weapon run all the time, so switching never speeds up fire
    let carry = 0;
    for (let i = 0; i < st.slots.length; i++) {
      const sl = st.slots[i];
      if (sl.cd > 0) {
        const c = sl.cd - dt;
        if (c <= 1e-9) { if (i === st.cur) carry = Math.min(0, c); sl.cd = 0; } else sl.cd = c;
      }
    }
    if (st.switchLeft > 0) { st.switchLeft -= dt; if (st.switchLeft <= 1e-9) st.switchLeft = 0; }
    const ready = st.switchLeft <= 0;

    // reloading
    if (st.reloading) {
      st.reloadLeft -= dt;
      if (st.reloadLeft <= 1e-9) {
        if (w.reloadMode === 'shell') {
          slot.mag++; slot.reserve--;
          ev.shellLoaded = true;
          if (slot.mag < w.mag && slot.reserve > 0) {
            st.reloadLeft += w.shellTime;
          } else {
            st.reloading = false; st.reloadLeft = 0; ev.reloadDone = true;
          }
        } else {
          const take = Math.min(w.mag - slot.mag, slot.reserve);
          slot.mag += take;
          slot.reserve -= take;
          st.reloading = false;
          st.reloadLeft = 0;
          ev.reloadDone = true;
        }
      }
    }

    // aiming (guns only, not while reloading, sprinting or still raising the weapon)
    const wantAds = isGun && !!cmd.aim && !st.reloading && !kin.sprint && ready;
    st.ads = clamp(st.ads + (wantAds ? 1 : -1) * dt / w.adsTime, 0, 1);

    // bloom settles once you stop firing
    st.sinceShot += dt;
    if (st.sinceShot > w.spread.recoverDelay) st.bloom = Math.max(0, st.bloom - w.spread.decay * dt);

    if (isGun) {
      // manual reload key
      if (cmd.reload && startReload(st)) ev.reloadStarted = true;

      const shoot = () => {
        ev.spreadDeg = spreadDeg(w, st, kin);
        ev.fired = true;
        ev.shotIndex = st.shots++;
        slot.mag--;
        st.sinceShot = 0;
        st.bloom = Math.min(w.spread.max, st.bloom + w.spread.perShot);
      };

      // the rest of a burst keeps going even if you let go of the trigger
      if (st.burstLeft > 0) {
        if (st.reloading || slot.mag <= 0) st.burstLeft = 0;
        else if (slot.cd <= 0 && ready) {
          shoot();
          st.burstLeft--;
          slot.cd = (st.burstLeft > 0 ? W.burstInterval(w) : w.burst.delay) + carry;
        }
      }

      if (cmd.fire) {
        // a shell-by-shell reload can be cut short by a fresh click as long as there is a shell in
        if (st.reloading && w.reloadMode === 'shell' && slot.mag > 0 && ready && cmd.fresh) {
          st.reloading = false; st.reloadLeft = 0; ev.reloadCancelled = true;
        }
        if (!st.reloading && ready && !ev.fired) {
          if (slot.mag > 0) {
            if (slot.cd <= 0 && st.burstLeft <= 0 && (w.fireMode === 'auto' || cmd.fresh)) {
              shoot();
              if (w.fireMode === 'burst') {
                st.burstLeft = w.burst.count - 1;
                slot.cd = W.burstInterval(w) + carry;
              } else {
                slot.cd = W.shotInterval(w) + carry;
              }
            }
          } else if (slot.reserve > 0) {
            if (startReload(st)) ev.reloadStarted = true;
          } else if (!st.emptyHandled) {
            st.emptyHandled = true;
            ev.empty = true;
          }
        }
      }
      if (!cmd.fire) st.emptyHandled = false;
    } else {
      // melee: hold the button to keep swinging
      const want = cmd.fire || st.quick === 1;
      if (want && ready && slot.cd <= 0) {
        ev.swung = true;
        ev.swingIndex = st.swings++;
        slot.cd = w.swing + carry;
        if (st.quick === 1) st.quick = 2;
      }
    }

    // after a quick knife swing, go back to the weapon you had
    if (st.quick === 2 && slot.cd <= 0 && !ev.swung) {
      const back = st.quickReturn;
      st.quick = 0; st.quickReturn = -1;
      if (back >= 0 && back !== st.cur) {
        doSwitch(st, back, 0.2);
        ev.switched = true;
      }
    }
    return ev;
  }

  // ---------------------------------------------------------------- grenades

  /** Regrowing grenades and the throw itself. Sets ev.threw when a grenade leaves your hand. */
  function stepGrenade(st, cmd, ev, dt) {
    if (st.gcd > 0) st.gcd = Math.max(0, st.gcd - dt);
    if (st.gcount < W.GRENADE_MAX) {
      st.gregen += dt;
      if (st.gregen >= W.GRENADE_REGEN) { st.gcount++; st.gregen = st.gcount < W.GRENADE_MAX ? st.gregen - W.GRENADE_REGEN : 0; }
    } else {
      st.gregen = 0;
    }
    ev.threw = false;
    if (cmd.throw && st.gcount > 0 && st.gcd <= 0) {
      st.gcount--;
      st.gcd = W.GRENADE_COOLDOWN;
      ev.threw = true;
      ev.grenade = st.grenade;
    }
  }

  // ---------------------------------------------------------------- abilities

  /** Cooldown and speed boost timers. */
  function stepAbilityTimers(st, dt) {
    if (st.acd > 0) st.acd = Math.max(0, st.acd - dt);
    if (st.boost > 0) st.boost = Math.max(0, st.boost - dt);
  }

  /**
   * Pressing the ability key. Movement abilities (Dash, Air Dash, Grapple) change the player right here, so the
   * browser predicts them exactly. The others only start their cooldown; the server does the rest.
   * Returns { id, target? } when the ability fired, or null.
   */
  function useAbility(me, cmd, boxes) {
    const st = me.weapon;
    const def = W.ability(st.abl);
    if (def.passive || st.acd > 0) return null;
    const ph = me.phys;
    let fired = null;
    if (def.id === 'dash' || def.id === 'airdash') {
      if (def.airOnly && ph.onGround) return null;
      const sin = Math.sin(cmd.yaw), cos = Math.cos(cmd.yaw);
      let mx = cmd.moveX, mz = cmd.moveZ;
      if (Math.hypot(mx, mz) < 0.01) { mx = 0; mz = 1; }          // standing still: dash forward
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      ph.dvx = (-sin * mz + cos * mx) * def.speed;
      ph.dvz = (-cos * mz - sin * mx) * def.speed;
      ph.dashT = def.dur;
      ph.dashLift = def.id === 'airdash';
      if (def.id === 'dash' && !ph.onGround) ph.dashLift = false;
      fired = { id: def.id };
    } else if (def.id === 'grapple') {
      const eye = eyePos(ph, cmd.yaw);
      const dir = P.forwardVector(cmd.yaw, cmd.pitch);
      const hit = P.raycastWorld(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, def.range, boxes);
      if (!hit || !hit.box) return null;                           // the hook needs a wall or a crate, not the floor or the sky
      ph.gx = eye.x + dir.x * hit.t + hit.nx * 1.0;
      ph.gy = eye.y + dir.y * hit.t + hit.ny * 1.0 + 0.9;      // aim a little above the spot so you swing up over the edge
      ph.gz = eye.z + dir.z * hit.t + hit.nz * 1.0;
      ph.gT = def.maxTime;
      fired = { id: def.id, target: [eye.x + dir.x * hit.t, eye.y + dir.y * hit.t, eye.z + dir.z * hit.t] };
    } else if (def.id === 'shield') {
      // the dome goes just in front of you (so you stand inside it), not through a wall
      const dir = P.forwardVector(cmd.yaw, 0);
      const ey = ph.y + 1.0;
      const wall = P.raycastWorld(ph.x, ey, ph.z, dir.x, 0, dir.z, 3.0, boxes);
      const reach = wall ? Math.max(0, wall.t - 0.6) : 2.5;
      fired = { id: def.id, target: [ph.x + dir.x * reach, ph.y, ph.z + dir.z * reach] };
    } else if (def.id === 'mine') {
      fired = { id: def.id, target: [ph.x, ph.y, ph.z] };
    } else if (def.id === 'orbital') {
      const eye = eyePos(ph, cmd.yaw);
      const dir = P.forwardVector(cmd.yaw, cmd.pitch);
      const hit = P.raycastWorld(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, def.range, boxes);
      if (!hit) return null;                                       // nothing to mark (the sky)
      fired = { id: def.id, target: [eye.x + dir.x * hit.t, eye.y + dir.y * hit.t, eye.z + dir.z * hit.t] };
    } else {
      fired = { id: def.id };
    }
    st.acd = def.cd;
    return fired;
  }

  // ---------------------------------------------------------------- one player tick

  /**
   * Advance a player by exactly one fixed tick.
   * me = { phys, weapon }. cmd may carry slot (0..2 or -1) and quick (V key).
   * Returns the weapon events.
   */
  function stepTick(me, cmd, boxes) {
    const sw = applySwitch(me.weapon, cmd);
    const w = curWeapon(me.weapon);
    const sprint = !!cmd.sprint && cmd.moveZ > 0;
    const input = {
      moveX: cmd.moveX, moveZ: cmd.moveZ, yaw: cmd.yaw,
      jump: cmd.jump, crouch: cmd.crouch, sprint,
      speedMult: speedMult(me.weapon),
      lean: (cmd.leanR ? 1 : 0) - (cmd.leanL ? 1 : 0),
      bhop: !!(w.bunnyHop && cmd.crouch && cmd.jump && sprint),
      jumpMul: cmd.zilla ? P.C.ZILLA_JUMP_MUL : 1,
    };
    P.stepPlayer(me.phys, input, FIXED, boxes);
    const kin = {
      speed: Math.hypot(me.phys.vx, me.phys.vz), crouching: me.phys.crouching,
      onGround: me.phys.onGround, sprint,
    };
    const ev = stepWeapon(me.weapon, cmd, kin, FIXED);
    stepGrenade(me.weapon, cmd, ev, FIXED);
    stepAbilityTimers(me.weapon, FIXED);
    ev.ability = cmd.ability ? useAbility(me, cmd, boxes) : null;
    if (sw.switched) ev.switched = true;
    if (sw.reloadCancelled) ev.reloadCancelled = true;
    return ev;
  }

  function eyeHeight(phys) {
    return phys.crouching ? P.C.CROUCH_EYE : P.C.EYE;
  }

  /** Where your eyes (and your shots) are: leaning moves them sideways and down a little. */
  function eyePos(phys, yaw) {
    const l = phys.lean || 0;
    const sh = P.leanShift(yaw, l);
    return { x: phys.x + sh.x, y: phys.y + eyeHeight(phys) - 0.05 * Math.abs(l), z: phys.z + sh.z };
  }

  // ---------------------------------------------------------------- shots

  /** Repeatable random number in [0, 1) from a salt, a shot number and a slot. */
  function rand01(salt, n, k) {
    let h = ((salt | 0) ^ Math.imul(n + 1, 0x9E3779B1) ^ Math.imul(k + 1, 0x85EBCA6B)) | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /** Unit direction of a shot: where you look, plus a random point inside the spread cone. */
  function shotDirection(yaw, pitch, spreadDegrees, salt, shotIndex) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fx = -Math.sin(yaw) * cp, fy = sp, fz = -Math.cos(yaw) * cp;
    // right = forward x up (normalised), up = right x forward
    let rx = -fz, rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    const spreadRad = spreadDegrees * Math.PI / 180;
    const radius = Math.sqrt(rand01(salt, shotIndex, 0)) * Math.tan(spreadRad);
    const angle = rand01(salt, shotIndex, 1) * Math.PI * 2;
    const ca = Math.cos(angle) * radius, sa = Math.sin(angle) * radius;
    let dx = fx + rx * ca + ux * sa;
    let dy = fy + 0 * ca + uy * sa;
    let dz = fz + rz * ca + uz * sa;
    const l = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / l, y: dy / l, z: dz / l };
  }

  /** Number that picks the random numbers of one pellet (a shotgun fires several per shot). */
  function pelletSeed(shotIndex, pellet) { return shotIndex * 16 + pellet; }

  /** Nearest wall along a ray, skipping boxes already passed through. The floor is never skipped. */
  function nearestWall(ox, oy, oz, dir, maxDist, boxes, skip) {
    let best = null;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (skip && skip.indexOf(b) >= 0) continue;
      const r = P.rayAabb(ox, oy, oz, dir.x, dir.y, dir.z, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
      if (r && r.t <= maxDist && (!best || r.t < best.t)) { best = r; r.box = b; }
    }
    if (dir.y < 0 && oy > 0) {
      const t = -oy / dir.y;
      if (t <= maxDist && (!best || t < best.t)) best = { t, nx: 0, ny: 1, nz: 0, box: null };
    }
    return best;
  }

  /**
   * Follow a shot through the world.
   * targets = [{ id, x, y, z, height }] (other players, already at the right moment in time)
   * pierce = how many walls the shot may pass through (0 for most weapons, 1 for the Rail Cannon).
   * Returns null (hit nothing within range) or
   *   { kind: 'wall' | 'player', t, nx, ny, nz, box?, id?, head?, through? }
   * through lists the walls it went through: [{ t, exit }].
   */
  function traceShotCore(ox, oy, oz, dir, maxRange, boxes, targets, pierce) {
    const skip = [];
    const through = [];
    let wall = nearestWall(ox, oy, oz, dir, maxRange, boxes, skip);
    for (let k = 0; k < (pierce || 0) && wall && wall.box; k++) {
      const b = wall.box;
      const span = P.raySpan(ox, oy, oz, dir.x, dir.y, dir.z, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
      through.push({ t: wall.t, exit: span ? span.t1 : wall.t });
      skip.push(b);
      wall = nearestWall(ox, oy, oz, dir, maxRange, boxes, skip);
    }
    const limit = wall ? wall.t : maxRange;
    let best = null;
    for (let i = 0; i < targets.length; i++) {
      const q = targets[i];
      const h = P.rayVsBody(ox, oy, oz, dir.x, dir.y, dir.z, q.x, q.y, q.z, q.height, q.hox, q.hoz, q.sc);
      if (h && h.t <= limit && (!best || h.t < best.t)) {
        best = { kind: 'player', t: h.t, nx: h.nx, ny: h.ny, nz: h.nz, id: q.id, head: !!h.head };
      }
    }
    if (best) { if (through.length) best.through = through; return best; }
    if (wall) {
      const r = { kind: 'wall', t: wall.t, nx: wall.nx, ny: wall.ny, nz: wall.nz, box: wall.box || null };
      if (through.length) r.through = through;
      return r;
    }
    return null;
  }

  /**
   * Shield domes stop bullets that come from outside. Returns { t, nx, ny, nz } for the nearest dome the ray
   * enters from outside, or null. A shot that starts inside a dome is not stopped by it.
   */
  function domeHit(ox, oy, oz, dir, maxT, domes) {
    let best = null;
    if (!domes) return null;
    for (let i = 0; i < domes.length; i++) {
      const d = domes[i];
      const dx = ox - d.x, dy = oy - d.y, dz = oz - d.z;
      const c = dx * dx + dy * dy + dz * dz - d.r * d.r;
      if (c <= 0 && oy >= d.y) continue;                            // the shooter is inside
      const b = dx * dir.x + dy * dir.y + dz * dir.z;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > maxT) continue;
      const hy = oy + dir.y * t;
      if (hy < d.y) continue;                                       // only the upper half is a dome
      if (!best || t < best.t) {
        best = { t, nx: (ox + dir.x * t - d.x) / d.r, ny: (hy - d.y) / d.r, nz: (oz + dir.z * t - d.z) / d.r };
      }
    }
    return best;
  }

  /** Follows a shot through the world (walls, players and shield domes). */
  function traceShot(ox, oy, oz, dir, maxRange, boxes, targets, pierce, domes) {
    const res = traceShotCore(ox, oy, oz, dir, maxRange, boxes, targets, pierce);
    const dh = domeHit(ox, oy, oz, dir, res ? res.t : maxRange, domes);
    if (dh && (!res || dh.t < res.t)) return { kind: 'dome', t: dh.t, nx: dh.nx, ny: dh.ny, nz: dh.nz };
    return res;
  }

  /**
   * A melee swing. attacker = { x, y, z, yaw, height }, targets = [{ id, x, y, z, yaw, height }].
   * Hits the nearest target inside range and in front, if no wall is in the way.
   * Returns { id, backstab, dist } or null.
   */
  function meleeTarget(w, attacker, targets, boxes) {
    const eyeY = attacker.y + (attacker.height >= P.C.HEIGHT ? P.C.EYE : P.C.CROUCH_EYE);
    const fx = -Math.sin(attacker.yaw), fz = -Math.cos(attacker.yaw);
    const cosHalf = Math.cos(w.arc * Math.PI / 360);
    let best = null;
    for (let i = 0; i < targets.length; i++) {
      const q = targets[i];
      const dx = q.x - attacker.x, dz = q.z - attacker.z;
      const flat = Math.hypot(dx, dz);
      if (flat > w.range + P.BODY_HALF) continue;
      if (flat > 0.6 && (dx * fx + dz * fz) / flat < cosHalf) continue;
      // the swing must be at about the right height
      if (q.y > attacker.y + attacker.height || q.y + q.height < attacker.y) continue;
      // no hitting through walls
      const cy = q.y + q.height * 0.6;
      const vx = q.x - attacker.x, vy = cy - eyeY, vz = q.z - attacker.z;
      const vl = Math.hypot(vx, vy, vz) || 1;
      const wall = P.raycastWorld(attacker.x, eyeY, attacker.z, vx / vl, vy / vl, vz / vl, vl - 0.3, boxes);
      if (wall) continue;
      if (!best || flat < best.dist) {
        const qfx = -Math.sin(q.yaw || 0), qfz = -Math.cos(q.yaw || 0);
        best = { id: q.id, dist: flat, backstab: (fx * qfx + fz * qfz) > 0.4 };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- commands

  const FLAG = { JUMP: 1, CROUCH: 2, SPRINT: 4, AIM: 8, FIRE: 16, FRESH: 32, RELOAD: 64, QUICK: 128, THROW: 256, LEANL: 512, LEANR: 1024, ABILITY: 2048 };

  const r4 = (v) => Math.round(v * 10000) / 10000;

  /** Small form sent over the network. vt (view time) is only sent with a shot. */
  function packCmd(c) {
    let f = 0;
    if (c.jump) f |= FLAG.JUMP;
    if (c.crouch) f |= FLAG.CROUCH;
    if (c.sprint) f |= FLAG.SPRINT;
    if (c.aim) f |= FLAG.AIM;
    if (c.fire) f |= FLAG.FIRE;
    if (c.fresh) f |= FLAG.FRESH;
    if (c.reload) f |= FLAG.RELOAD;
    if (c.quick) f |= FLAG.QUICK;
    if (c.throw) f |= FLAG.THROW;
    if (c.leanL) f |= FLAG.LEANL;
    if (c.leanR) f |= FLAG.LEANR;
    if (c.ability) f |= FLAG.ABILITY;
    const out = { s: c.seq, e: c.epoch, x: c.moveX, z: c.moveZ, y: r4(c.yaw), p: r4(c.pitch), f };
    if (c.fire && c.vt !== undefined) out.v = Math.round(c.vt * 10) / 10;
    if (typeof c.slot === 'number' && c.slot >= 0) out.w = c.slot + 1;
    return out;
  }

  /** Checks and cleans an untrusted packed command. Returns null if it is nonsense. */
  function unpackCmd(m) {
    if (!m || typeof m !== 'object') return null;
    const num = (v) => (typeof v === 'number' && isFinite(v));
    if (!num(m.s) || !num(m.e) || !num(m.y) || !num(m.p) || !num(m.f)) return null;
    const f = m.f | 0;
    return {
      seq: m.s | 0,
      epoch: m.e | 0,
      moveX: clamp(num(m.x) ? m.x : 0, -1, 1),
      moveZ: clamp(num(m.z) ? m.z : 0, -1, 1),
      yaw: clamp(m.y, -1e5, 1e5),
      pitch: clamp(m.p, -1.55, 1.55),
      jump: !!(f & FLAG.JUMP), crouch: !!(f & FLAG.CROUCH), sprint: !!(f & FLAG.SPRINT),
      aim: !!(f & FLAG.AIM), fire: !!(f & FLAG.FIRE), fresh: !!(f & FLAG.FRESH), reload: !!(f & FLAG.RELOAD),
      quick: !!(f & FLAG.QUICK), throw: !!(f & FLAG.THROW), leanL: !!(f & FLAG.LEANL), leanR: !!(f & FLAG.LEANR), ability: !!(f & FLAG.ABILITY),
      slot: (num(m.w) && m.w >= 1 && m.w <= 3) ? (m.w | 0) - 1 : -1,
      vt: num(m.v) ? m.v : undefined,
    };
  }

  return {
    FIXED, MAX_HEALTH, RESPAWN_TIME, SPAWN_PROTECTION, MAX_PLAYERS,
    newWeaponState, copyWeaponState, copyPhysState, packWeaponState, applyWeaponPacket, curWeapon, curSlot,
    speedMult, spreadDeg, startReload, applySwitch, stepWeapon, stepGrenade, stepAbilityTimers, useAbility, stepTick, eyeHeight, eyePos,
    rand01, shotDirection, pelletSeed, traceShot, domeHit, meleeTarget,
    FLAG, packCmd, unpackCmd,
  };
});

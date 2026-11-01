/*
 * shared/abilities.js
 *
 * The timed effects of abilities that live on a player (healing, armor, damage surge, scan).
 * The server keeps one of these per player; practice mode keeps one for you. Movement abilities
 * (Dash, Air Dash, Grapple) are in physics.js and combat.js, because the browser predicts them.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const weapons = isNode ? require('./weapons') : root.ArenaShared.Weapons;
  const grenades = isNode ? require('./grenades') : root.ArenaShared.Grenades;
  const api = factory(weapons, grenades);
  if (isNode) module.exports = api;
  else { root.ArenaShared = root.ArenaShared || {}; root.ArenaShared.Abilities = api; }
})(typeof self !== 'undefined' ? self : this, function (W, G) {
  'use strict';

  function newState() {
    return { heal: 0, armor: 0, armorT: 0, surge: 0, scan: 0, cloak: 0, reveal: 0 };
  }

  /** Start the effect of an ability (the ones that have a timed effect on you). */
  function activate(st, id) {
    const def = W.ability(id);
    if (id === 'heal') st.heal = def.dur;
    else if (id === 'armor') { st.armor = def.amount; st.armorT = def.dur; }
    else if (id === 'surge') st.surge = def.dur;
    else if (id === 'scan') st.scan = def.dur;
    else if (id === 'cloak') { st.cloak = def.dur; st.reveal = 0; }
  }

  /** Run the timers for dt seconds. Returns how much health was healed in this step. */
  function step(st, dt) {
    let healed = 0;
    if (st.heal > 0) {
      const d = Math.min(dt, st.heal);
      const def = W.ability('heal');
      healed = def.amount / def.dur * d;
      st.heal -= d;
      if (st.heal < 1e-9) st.heal = 0;
    }
    if (st.armorT > 0) { st.armorT -= dt; if (st.armorT <= 0) { st.armorT = 0; st.armor = 0; } }
    if (st.surge > 0) st.surge = Math.max(0, st.surge - dt);
    if (st.scan > 0) st.scan = Math.max(0, st.scan - dt);
    if (st.cloak > 0) { st.cloak = Math.max(0, st.cloak - dt); if (st.cloak === 0) st.reveal = 0; }
    if (st.reveal > 0) st.reveal = Math.max(0, st.reveal - dt);
    return healed;
  }

  /** Damage on its way to you: armor soaks it up, and any damage cancels a heal. Returns what is left. */
  function mitigate(st, dmg) {
    if (dmg <= 0) return 0;
    st.heal = 0;
    if (st.armor > 0) {
      const soak = Math.min(st.armor, dmg);
      st.armor -= soak;
      dmg -= soak;
      if (st.armor <= 0) { st.armor = 0; st.armorT = 0; }
    }
    return dmg;
  }

  /** What your damage is multiplied by (Damage Surge). */
  function damageMult(st) {
    return st.surge > 0 ? W.ability('surge').mult : 1;
  }

  /** Compact form for the snapshot. */
  function pack(st) {
    return { hl: Math.round(st.heal * 100) / 100, ar: Math.round(st.armor * 10) / 10, at: Math.round(st.armorT * 100) / 100, sg: Math.round(st.surge * 100) / 100, sc: Math.round(st.scan * 100) / 100, cl: Math.round(st.cloak * 100) / 100, rv: Math.round(st.reveal * 100) / 100 };
  }
  function unpack(m, st) {
    st.heal = m.hl || 0; st.armor = m.ar || 0; st.armorT = m.at || 0; st.surge = m.sg || 0; st.scan = m.sc || 0; st.cloak = m.cl || 0; st.reveal = m.rv || 0;
    return st;
  }

  /** Called when you shoot, swing or throw: a cloaked player shows up for a second. */
  function revealCloak(st) {
    if (st.cloak > 0) st.reveal = W.ability('cloak').reveal;
  }

  /** How visible a player is to others: 0 = hidden, 1 = fully visible. */
  function visibility(st) {
    if (st.cloak <= 0) return 1;
    return st.reveal > 0 ? 1 : 0.08;
  }

  // ---------------------------------------------------------------- things placed in the world

  /**
   * Shield domes, proximity mines and orbital strike markers. The server keeps one of these, and practice
   * mode keeps one for you. step() returns events and the host turns them into damage and effects.
   */
  class World {
    constructor(boxes) {
      this.boxes = boxes;
      this.domes = [];      // { id, owner, x, y, z, r, left }
      this.mines = [];      // { id, owner, x, y, z, age }
      this.strikes = [];    // { id, owner, x, y, z, left }
      this.nextId = 1;
    }

    placeDome(owner, x, y, z) {
      const def = W.ability('shield');
      this.domes = this.domes.filter((d) => d.owner !== owner);          // one dome each
      const d = { id: this.nextId++, owner, x, y, z, r: def.radius, left: def.dur };
      this.domes.push(d);
      return d;
    }

    /** Places a mine. A third mine removes your oldest one. */
    placeMine(owner, x, y, z) {
      const def = W.ability('mine');
      const mine = { id: this.nextId++, owner, x, y, z, age: 0 };
      this.mines.push(mine);
      const mine_ = this.mines.filter((m) => m.owner === owner);
      while (mine_.length > def.max) { const old = mine_.shift(); this.mines.splice(this.mines.indexOf(old), 1); }
      return mine;
    }

    markStrike(owner, x, y, z) {
      const def = W.ability('orbital');
      const s = { id: this.nextId++, owner, x, y, z, left: def.delay };
      this.strikes.push(s);
      return s;
    }

    /** When someone dies or leaves their dome and mines go away (a strike already called in still lands). */
    removeOwner(owner) {
      this.domes = this.domes.filter((d) => d.owner !== owner);
      this.mines = this.mines.filter((m) => m.owner !== owner);
    }

    /**
     * Advance dt seconds. targets = [{ id, x, y, z, height }] (everyone alive).
     * Events: { kind: 'mine', mine, victims: [{ id, dmg }] } | { kind: 'strike', strike, victims } | { kind: 'domeEnd', dome }.
     */
    step(dt, targets) {
      const events = [];
      const mdef = W.ability('mine'), sdef = W.ability('orbital');
      for (let i = this.domes.length - 1; i >= 0; i--) {
        const d = this.domes[i];
        d.left -= dt;
        if (d.left <= 0) { this.domes.splice(i, 1); events.push({ kind: 'domeEnd', dome: d }); }
      }
      for (let i = this.mines.length - 1; i >= 0; i--) {
        const m = this.mines[i];
        m.age += dt;
        if (m.age < mdef.arm) continue;
        const near = targets.some((t) => t.id !== m.owner && Math.hypot(t.x - m.x, t.z - m.z) <= mdef.trigger && t.y < m.y + 2 && t.y + t.height > m.y - 0.3);
        if (!near) continue;
        this.mines.splice(i, 1);
        const victims = [];
        for (const t of targets) {
          if (t.id === m.owner) continue;                                   // your own mines never hurt you
          if (Math.hypot(t.x - m.x, t.z - m.z) > mdef.radius || t.y > m.y + 2.5) continue;
          if (!G.canSeeBody(m.x, m.y + 0.25, m.z, t, this.boxes)) continue;
          victims.push({ id: t.id, dmg: mdef.damage });
        }
        events.push({ kind: 'mine', mine: m, victims });
      }
      for (let i = this.strikes.length - 1; i >= 0; i--) {
        const s = this.strikes[i];
        s.left -= dt;
        if (s.left > 0) continue;
        this.strikes.splice(i, 1);
        const victims = [];
        for (const t of targets) {
          const d = Math.hypot(t.x - s.x, t.z - s.z);
          if (d - 0.3 > sdef.radius || t.y > s.y + sdef.radius) continue;
          victims.push({ id: t.id, dmg: sdef.damage });
        }
        events.push({ kind: 'strike', strike: s, victims });
      }
      return events;
    }
  }

  return { newState, activate, step, mitigate, damageMult, revealCloak, visibility, pack, unpack, World };
});

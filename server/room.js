/*
 * server/room.js
 *
 * One game room. It knows nothing about sockets: each player has a "conn" with
 * send(object) and close(), so the whole thing can be tested without a network.
 *
 * The server is in charge of:
 *   - movement (it re-runs every command the browser sends with the shared physics)
 *   - ammo, reloading and fire rate
 *   - what each bullet hits (with a small "lag compensation" so shots land where
 *     the shooter saw the target)
 *   - health, kills, deaths and respawns
 */
'use strict';

const P = require('../shared/physics');
const Weapons = require('../shared/weapons');
const Maps = require('../shared/maps');
const C = require('../shared/combat');
const G = require('../shared/grenades');
const Abil = require('../shared/abilities');
const Zilla = require('../shared/zilla');

const SNAPSHOT_HZ = 30;
const HISTORY_MS = 1000;        // how far back positions are remembered
const MAX_REWIND_MS = 300;      // most the server will rewind targets for one shot
const IDLE_KICK_MS = 20000;     // drop a connection that has been silent this long
const BUDGET_PER_SEC = 60 * 1.15;
const BUDGET_CAP = 24;
const MAX_CMDS_PER_MESSAGE = 24;
const METAL_KINDS = new Set(['container', 'platform', 'rail', 'post', 'stair']);

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const G_ORDER = Weapons.GRENADE_ORDER;

function cleanName(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw)
    .replace(/[^\p{L}\p{N} _.\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
  return s;
}

class Room {
  constructor(opts = {}) {
    this.map = Maps.get(opts.mapId || 'container_yard');
    this.boxes = P.prepareBoxes(this.map.boxes);
    this.maxPlayers = opts.maxPlayers || C.MAX_PLAYERS;
    this.clock = opts.clock || (() => performance.now());
    this.t0 = this.clock();
    this.players = new Map();
    this.nextId = 1;
    this.timer = null;
    this.log = opts.log || (() => {});
    this.world = new Abil.World(this.boxes);   // shield domes, proximity mines and orbital strike markers
    this.worldT = 0;
    this.sim = new G.Sim(this.boxes);      // grenades in flight, smoke clouds and fire
    this.grenT = 0;                         // server time (ms) the grenades were last moved to
  }

  /** Server time in milliseconds since the room was created. */
  now() { return this.clock() - this.t0; }

  start() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000 / SNAPSHOT_HZ);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------ joining and leaving

  addPlayer(conn, rawName, rawLoadout) {
    if (this.players.size >= this.maxPlayers) {
      conn.send({ t: 'error', msg: 'This room is full (' + this.maxPlayers + ' players). Try again when someone leaves.' });
      conn.close();
      return null;
    }
    const id = this.nextId++;
    let name = cleanName(rawName) || ('Player ' + id);
    const taken = (n) => [...this.players.values()].some((q) => q.name.toLowerCase() === n.toLowerCase());
    if (taken(name)) {
      let k = 2;
      while (taken(name + ' ' + k)) k++;
      name = name.slice(0, 11) + ' ' + k;
    }
    const zil = Zilla.isName(name);           // the name "godzilla" (only one at a time) makes you Godzilla
    const used = new Set([...this.players.values()].map((q) => q.slot));
    let slot = 0;
    while (used.has(slot)) slot++;

    const sp = this.pickSpawn(null);
    // The server checks the loadout: every slot must hold a real weapon of the right kind
    const loadout = Weapons.validateLoadout(rawLoadout);
    const p = {
      id, name, slot, conn, loadout, nextLoadout: null,
      abil: Abil.newState(), abilT: this.now(),
      salt: (Math.random() * 0x7fffffff) | 0,
      phys: P.newPlayer(sp.x, sp.y, sp.z),
      weapon: C.newWeaponState(loadout),
      yaw: sp.yaw, pitch: 0,
      hp: zil ? Zilla.MAX_HP : C.MAX_HEALTH, alive: true,
      zil: zil ? Zilla.newState() : null, grabbedBy: 0,
      epoch: 1, lastSeq: 0,
      kills: 0, deaths: 0,
      respawnAt: 0,
      invulnUntil: this.now() + C.SPAWN_PROTECTION * 1000,
      budget: BUDGET_CAP, budgetT: this.now(),
      lastMsgAt: this.now(),
      history: [],
    };
    this.players.set(id, p);

    conn.send({
      t: 'welcome', id, name, slot, salt: p.salt, st: this.now(),
      mapId: this.map.id, lo: loadout, epoch: p.epoch, z: zil ? 1 : 0,
      spawn: { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw },
      players: [...this.players.values()].filter((q) => q !== p).map((q) => ({ id: q.id, name: q.name, slot: q.slot, k: q.kills, d: q.deaths, lo: q.loadout, z: q.zil ? 1 : 0 })),
    });
    this.broadcast({ t: 'join', id, name, slot, lo: loadout, z: zil ? 1 : 0 }, p);
    this.log('+ ' + name + ' joined (' + this.players.size + '/' + this.maxPlayers + ')');
    return p;
  }

  removePlayer(p) {
    if (!this.players.delete(p.id)) return;
    this.world.removeOwner(p.id);
    this.broadcast({ t: 'leave', id: p.id });
    this.log('- ' + p.name + ' left (' + this.players.size + '/' + this.maxPlayers + ')');
  }

  broadcast(msg, except) {
    for (const q of this.players.values()) if (q !== except) q.conn.send(msg);
  }

  /** The spawn point farthest from everyone who is alive. */
  pickSpawn(forPlayer) {
    const others = [...this.players.values()].filter((q) => q !== forPlayer && q.alive);
    const scored = this.map.spawns.map((sp) => {
      let nearest = 1e9;
      for (const q of others) nearest = Math.min(nearest, Math.hypot(q.phys.x - sp.x, q.phys.z - sp.z));
      return { sp, nearest };
    });
    scored.sort((a, b) => b.nearest - a.nearest);
    const top = scored.slice(0, Math.min(3, scored.length));
    return top[Math.floor(Math.random() * top.length)].sp;
  }

  // ------------------------------------------------------------ messages from players

  handleMessage(p, msg) {
    if (!msg || typeof msg !== 'object') return;
    p.lastMsgAt = this.now();
    switch (msg.t) {
      case 'cmds': {
        if (!Array.isArray(msg.c)) return;
        const n = Math.min(msg.c.length, MAX_CMDS_PER_MESSAGE);
        for (let i = 0; i < n; i++) {
          const cmd = C.unpackCmd(msg.c[i]);
          if (cmd) this.processCmd(p, cmd);
        }
        break;
      }
      case 'loadout':           // a new loadout, used from the next respawn
        p.nextLoadout = Weapons.validateLoadout(msg.lo);
        break;
      case 'bye':               // the player pressed "Leave game"
        this.removePlayer(p);
        p.conn.close();
        break;
      case 'ping':
        if (typeof msg.c === 'number') p.conn.send({ t: 'pong', c: msg.c, s: this.now() });
        break;
      default: break;
    }
  }

  processCmd(p, cmd) {
    if (!p.alive || cmd.epoch !== p.epoch) return;
    if (cmd.seq <= p.lastSeq) return;
    p.lastSeq = cmd.seq;

    // Speed limit: a player can only run about 60 ticks per second
    const now = this.now();
    p.budget = Math.min(BUDGET_CAP, p.budget + (now - p.budgetT) / 1000 * BUDGET_PER_SEC);
    p.budgetT = now;
    if (p.budget < 1) return;
    p.budget -= 1;

    if (p.grabbedBy) {                      // held in Godzilla's hand: you can look around, nothing else
      p.yaw = cmd.yaw; p.pitch = cmd.pitch;
      return;
    }
    let ev;
    if (p.zil) {                            // Godzilla only walks and jumps here; his attacks are in stepZilla
      ev = C.stepTick(p, Zilla.maskCmd(cmd), this.boxes);
      p.zil.fire = !!cmd.fire; p.zil.aim = !!cmd.aim;
      if (cmd.ability) p.zil.stomp = true;
    } else ev = C.stepTick(p, cmd, this.boxes);
    p.yaw = cmd.yaw;
    p.pitch = cmd.pitch;
    if (ev.fired) this.resolveShot(p, ev, cmd);
    if (ev.swung) this.resolveSwing(p, ev, cmd);
    if (ev.threw) this.throwGrenade(p, ev, cmd);
    if (ev.fired || ev.swung || ev.threw) Abil.revealCloak(p.abil);      // a cloaked player shows up for a second
    if (ev.ability) this.useAbility(p, ev.ability);
  }

  // ------------------------------------------------------------ shooting

  /** Where another player was at server time t (from the saved snapshots). */
  positionAt(q, t) {
    const h = q.history;
    if (!h.length || t >= h[h.length - 1].t) return { x: q.phys.x, y: q.phys.y, z: q.phys.z, cr: q.phys.crouching, al: q.alive, ya: q.yaw, ln: q.phys.lean };
    if (t <= h[0].t) { const e = h[0]; return { x: e.x, y: e.y, z: e.z, cr: e.cr, al: e.al, ya: e.ya, ln: e.ln }; }
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (t >= a.t) {
        const k = (t - a.t) / (b.t - a.t || 1);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, cr: b.cr, al: a.al && b.al, ya: b.ya, ln: b.ln };
      }
    }
    return { x: q.phys.x, y: q.phys.y, z: q.phys.z, cr: q.phys.crouching, al: q.alive, ya: q.yaw, ln: q.phys.lean };
  }

  /** The other players as they were when the shooter fired (see lag compensation above). */
  rewoundTargets(p, cmd) {
    const now = this.now();
    let vt = typeof cmd.vt === 'number' ? cmd.vt : now;
    vt = Math.min(now, Math.max(now - MAX_REWIND_MS, vt));
    const targets = [];
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      const pos = this.positionAt(q, vt);
      if (!pos.al) continue;
      const sh = P.leanShift(pos.ya, pos.ln);
      const sc = q.zil ? Zilla.SCALE : 1;
      targets.push({ id: q.id, x: pos.x, y: pos.y, z: pos.z, yaw: pos.ya, height: (pos.cr ? P.C.CROUCH_HEIGHT : P.C.HEIGHT) * sc, hox: sh.x * sc, hoz: sh.z * sc, sc });
    }
    return targets;
  }

  /** Takes damage off a victim and tells everyone who needs to know. */
  applyDamage(p, q, dmg, head, backstab, point, ox, oz, melee) {
    const res = this.hurt(p, q, dmg);
    const killed = res.killed;
    const shown = Math.min(res.shown, 200);
    p.conn.send({ t: 'hit', v: q.id, d: shown, h: head, k: killed, bs: backstab ? 1 : 0, m: melee ? 1 : 0, p: point });
    q.conn.send({ t: 'dmg', d: shown, from: p.id, ax: r3(ox), az: r3(oz) });
    if (killed) this.kill(p, q, head);
  }

  resolveShot(p, ev, cmd) {
    const w = Weapons.get(p.weapon.ids[ev.slot]);
    const eye = C.eyePos(p.phys, cmd.yaw);          // leaning moves where your shots come from
    const eyeY = eye.y;
    const ox = eye.x, oz = eye.z;
    const targets = this.rewoundTargets(p, cmd);
    const now = this.now();

    const pellets = [];
    const perVictim = new Map();     // victim id -> { dmg, head, point }
    for (let k = 0; k < w.pellets; k++) {
      const dir = C.shotDirection(cmd.yaw, cmd.pitch, ev.spreadDeg, p.salt, C.pelletSeed(ev.shotIndex, k));
      const res = C.traceShot(ox, eyeY, oz, dir, w.maxRange, this.boxes, targets, w.pierceWalls || 0, this.world.domes);
      const len = res ? res.t : w.maxRange;
      const end = [r3(ox + dir.x * len), r3(eyeY + dir.y * len), r3(oz + dir.z * len)];
      let kind = 0;                 // 0 nothing, 1 metal wall, 2 other wall, 3 player
      let boxIndex = -1;
      if (res && res.kind === 'wall') {
        boxIndex = res.box ? this.boxes.indexOf(res.box) : -1;
        kind = res.box && METAL_KINDS.has(res.box.kind) ? 1 : 2;
      } else if (res && res.kind === 'dome') kind = 4;       // stopped by a shield dome
      else if (res) kind = 3;
      pellets.push({ e: end, n: res ? [r3(res.nx), r3(res.ny), r3(res.nz)] : [0, 1, 0], k: kind, b: boxIndex });

      if (res && res.kind === 'player') {
        const dmg = Weapons.damageFor(w, res.t, res.head);
        const cur = perVictim.get(res.id) || { dmg: 0, head: false, point: end };
        cur.dmg += dmg;
        cur.head = cur.head || res.head;
        perVictim.set(res.id, cur);
      }
    }

    this.broadcast({ t: 'shot', id: p.id, w: w.id, o: [r3(ox), r3(eyeY), r3(oz)], p: pellets }, p);

    for (const [id, v] of perVictim) {
      const q = this.players.get(id);
      if (!q || !q.alive || now < q.invulnUntil) continue;
      this.applyDamage(p, q, v.dmg, v.head, false, v.point, ox, oz, false);
    }
  }

  resolveSwing(p, ev, cmd) {
    const w = Weapons.get(p.weapon.ids[ev.slot]);
    const now = this.now();
    const targets = this.rewoundTargets(p, cmd);
    const attacker = { x: p.phys.x, y: p.phys.y, z: p.phys.z, yaw: cmd.yaw, height: P.playerHeight(p.phys) };
    const hit = C.meleeTarget(w, attacker, targets, this.boxes);
    const q = hit ? this.players.get(hit.id) : null;
    const valid = !!(q && q.alive && now >= q.invulnUntil);
    this.broadcast({ t: 'swing', id: p.id, w: w.id, h: valid ? 1 : 0, bs: valid && hit.backstab ? 1 : 0 }, p);
    if (!valid) return;
    const dmg = hit.backstab ? w.backstabDamage : w.damage;
    this.applyDamage(p, q, dmg, false, hit.backstab, [r3(q.phys.x), r3(q.phys.y + 1.1), r3(q.phys.z)], attacker.x, attacker.z, true);
  }

  // ------------------------------------------------------------ abilities

  useAbility(p, fired) {
    const def = Weapons.ability(fired.id);
    if (['heal', 'armor', 'surge', 'scan', 'cloak'].includes(fired.id)) Abil.activate(p.abil, fired.id);
    else if (fired.id === 'shield') this.world.placeDome(p.id, fired.target[0], fired.target[1], fired.target[2]);
    else if (fired.id === 'mine') this.world.placeMine(p.id, fired.target[0], fired.target[1], fired.target[2]);
    else if (fired.id === 'orbital') this.world.markStrike(p.id, fired.target[0], fired.target[1], fired.target[2]);
    const msg = { t: 'abl', i: p.id, a: fired.id, p: [r3(p.phys.x), r3(p.phys.y), r3(p.phys.z)] };
    if (fired.target) msg.tg = fired.target.map(r3);
    if (fired.id === 'dash' || fired.id === 'airdash') msg.d = [r3(p.phys.dvx), r3(p.phys.dvz)];
    this.broadcast(msg);
    this.log(p.name + ' used ' + def.name);
  }

  /**
   * Every bit of damage to a player goes through here: Damage Surge makes the attacker hit harder,
   * Armor Plate soaks it up, any hit cancels Heal Pulse, and Second Wind can save a fatal hit.
   * Returns { dealt, killed }.
   */
  hurt(attacker, q, dmg) {
    if (attacker && attacker.abil) dmg = Math.round(dmg * Abil.damageMult(attacker.abil));
    const before = dmg;
    dmg = Math.round(Abil.mitigate(q.abil, dmg));
    q.hp -= dmg;
    if (q.hp <= 0 && q.weapon.abl === 'secondwind' && q.weapon.acd <= 0) {
      const sw = Weapons.ability('secondwind');
      q.hp = sw.hp;
      q.weapon.acd = sw.cd;
      q.weapon.boost = sw.boostDur;
      this.broadcast({ t: 'abl', i: q.id, a: 'secondwind', p: [r3(q.phys.x), r3(q.phys.y), r3(q.phys.z)] });
      return { dealt: dmg, shown: before, killed: false };
    }
    return { dealt: dmg, shown: before, killed: q.hp <= 0 };
  }

  /** Shield domes, mines and orbital strikes, once per server tick. */
  stepWorldAbilities() {
    const now = this.now();
    const w = this.world;
    if (!w.domes.length && !w.mines.length && !w.strikes.length) { this.worldT = now; return; }
    const dt = Math.min(0.2, Math.max(0, (now - this.worldT) / 1000));
    this.worldT = now;
    const targets = this.grenadeTargets();
    for (const e of w.step(dt, targets)) {
      if (e.kind === 'mine') {
        const m = e.mine, owner = this.players.get(m.owner) || null;
        this.broadcast({ t: 'mine', i: m.id, p: [r3(m.x), r3(m.y), r3(m.z)] });
        for (const v of e.victims) { const q = this.players.get(v.id); if (q) this.grenadeHurt(owner, q, v.dmg, m, 'mine'); }
      } else if (e.kind === 'strike') {
        const s = e.strike, owner = this.players.get(s.owner) || null;
        this.broadcast({ t: 'orb', i: s.id, p: [r3(s.x), r3(s.y), r3(s.z)], r: Weapons.ability('orbital').radius });
        for (const v of e.victims) { const q = this.players.get(v.id); if (q) this.grenadeHurt(owner, q, v.dmg, s, 'orbital'); }
      }
    }
  }

  /** Healing and the timers of abilities, once per server tick. */
  stepAbilities(p, now) {
    const dt = Math.min(0.2, Math.max(0, (now - p.abilT) / 1000));
    p.abilT = now;
    if (!p.alive) return;
    const healed = Abil.step(p.abil, dt);
    if (healed > 0) p.hp = Math.min(C.MAX_HEALTH, p.hp + healed);
  }

  // ------------------------------------------------------------ Godzilla

  /** Lets go of whoever Godzilla holds (he died, or the victim did). Also frees a victim whose Godzilla is gone. */
  releaseGrab(p) {
    if (p.zil && p.zil.grab) {
      const q = this.players.get(p.zil.grab);
      if (q) q.grabbedBy = 0;
      p.zil.grab = 0; p.zil.grabT = 0;
    }
    if (p.grabbedBy) {
      const g = this.players.get(p.grabbedBy);
      if (g && g.zil && g.zil.grab === p.id) { g.zil.grab = 0; g.zil.grabT = 0; }
      p.grabbedBy = 0;
    }
  }

  /** Damage from Godzilla's fire, stomp or bite, with the normal hit message for the attacker. */
  zillaHurt(p, q, dmg, label) {
    const res = this.hurt(p, q, dmg);
    p.conn.send({ t: 'hit', v: q.id, d: Math.min(res.shown, 200), h: false, k: res.killed, bs: 0, m: 0, p: [r3(q.phys.x), r3(q.phys.y + 1.1), r3(q.phys.z)] });
    q.conn.send({ t: 'dmg', d: Math.min(res.shown, 200), from: p.id, ax: r3(p.phys.x), az: r3(p.phys.z) });
    if (res.killed) this.kill(p, q, false, label);
    return res;
  }

  /** Anyone Godzilla can hurt right now. */
  zillaVictims(p) {
    const now = this.now();
    const out = [];
    for (const q of this.players.values()) {
      if (q === p || !q.alive || now < q.invulnUntil) continue;
      out.push(q);
    }
    return out;
  }

  bodyOf(q) {
    return { id: q.id, x: q.phys.x, y: q.phys.y, z: q.phys.z, height: P.playerHeight(q.phys) * (q.zil ? Zilla.SCALE : 1), sc: q.zil ? Zilla.SCALE : 1 };
  }

  /** Fire breath, grab, bite and stomp for one Godzilla, once per server tick. */
  stepZilla(p, now) {
    // somebody held by a Godzilla that is gone is let go
    if (p.grabbedBy) {
      const g = this.players.get(p.grabbedBy);
      if (!g || !g.alive || !g.zil || g.zil.grab !== p.id || !p.alive) p.grabbedBy = 0;
    }
    const z = p.zil;
    if (!z) return;
    const dt = Math.min(0.2, Math.max(0, (now - (z.t || now)) / 1000));
    z.t = now;
    if (!p.alive) { z.breathing = false; z.stompT = 0; z.stomp = false; this.releaseGrab(p); return; }
    z.grabCd = Math.max(0, z.grabCd - dt);
    z.stompCd = Math.max(0, z.stompCd - dt);
    const B = Zilla.BREATH, GR = Zilla.GRAB, ST = Zilla.STOMP;

    // ---- stomp: wind-up, then the shockwave
    if (z.stomp) {
      z.stomp = false;
      if (z.stompCd <= 0 && z.stompT <= 0 && !z.grab) {
        z.stompT = ST.windup; z.stompCd = ST.cd;
        this.broadcast({ t: 'zil', k: 'stomp', z: p.id, p: [r3(p.phys.x), r3(p.phys.y), r3(p.phys.z)] });
      }
    }
    if (z.stompT > 0) {
      z.stompT -= dt;
      if (z.stompT <= 0) {
        z.stompT = 0;
        this.broadcast({ t: 'zil', k: 'quake', z: p.id, p: [r3(p.phys.x), r3(p.phys.y), r3(p.phys.z)], r: ST.radius });
        for (const q of this.zillaVictims(p)) {
          if (q.grabbedBy) continue;
          const d = Zilla.stompReach(p.phys, q.phys);
          if (d >= 0) this.zillaHurt(p, q, Zilla.stompDamage(d), 'stomp');
        }
      }
    }

    // ---- fire breath
    const wantBreath = z.fire && !z.grab && z.stompT <= 0 && z.breath > 0 && (z.breathing || z.breath >= B.min);
    if (wantBreath) {
      z.breathing = true;
      z.breath = Math.max(0, z.breath - dt);
      z.acc += dt;
      while (z.acc >= B.tick) {
        z.acc -= B.tick;
        const o = { x: p.phys.x, y: p.phys.y + Zilla.MOUTH, z: p.phys.z };
        for (const q of this.zillaVictims(p)) {
          if (q.grabbedBy) continue;
          const t = this.bodyOf(q);
          const d = Zilla.coneDistance(o.x, o.y, o.z, p.yaw, p.pitch, t, B.range, B.halfAngle);
          if (d < 0 || !G.canSeeBody(o.x, o.y, o.z, t, this.boxes)) continue;
          this.zillaHurt(p, q, Math.max(1, Math.round(B.dps * B.tick)), 'breath');
        }
      }
    } else {
      z.breathing = false; z.acc = 0;
      z.breath = Math.min(B.max, z.breath + B.regen * dt);
    }

    // ---- grab and bite
    if (z.grab) {
      const q = this.players.get(z.grab);
      if (!q || !q.alive) this.releaseGrab(p);
      else {
        const hp = Zilla.handPos(p.phys, p.yaw);
        q.phys.x = hp.x; q.phys.y = hp.y; q.phys.z = hp.z;
        q.phys.vx = q.phys.vy = q.phys.vz = 0; q.phys.onGround = false;
        z.grabT += dt;
        if (z.grabT >= GR.hold) {
          this.releaseGrab(p);
          p.hp = Math.min(Zilla.MAX_HP, p.hp + GR.heal);
          this.broadcast({ t: 'zil', k: 'eat', z: p.id, v: q.id, p: [r3(hp.x), r3(hp.y), r3(hp.z)] });
          this.kill(p, q, false, 'eaten');
        }
      }
    } else if (z.aim && z.grabCd <= 0 && z.stompT <= 0 && !z.breathing) {
      let best = null, bd = 1e9;
      for (const q of this.zillaVictims(p)) {
        if (q.grabbedBy || !Zilla.canGrab(p.phys, p.yaw, q.phys)) continue;
        const d = Math.hypot(q.phys.x - p.phys.x, q.phys.z - p.phys.z);
        if (d < bd) { bd = d; best = q; }
      }
      if (best) {
        z.grab = best.id; z.grabT = 0; z.grabCd = GR.cd;
        best.grabbedBy = p.id;
        const hp = Zilla.handPos(p.phys, p.yaw);
        best.phys.x = hp.x; best.phys.y = hp.y; best.phys.z = hp.z;
        best.phys.vx = best.phys.vy = best.phys.vz = 0;
        this.broadcast({ t: 'zil', k: 'grab', z: p.id, v: best.id });
        this.log(p.name + ' grabbed ' + best.name);
      } else {
        z.grabCd = 0.8;                                    // a swipe at nothing
        this.broadcast({ t: 'zil', k: 'whiff', z: p.id });
      }
    }
  }

  // ------------------------------------------------------------ grenades

  throwGrenade(p, ev, cmd) {
    if (this.sim.list.length === 0 && this.sim.zones.length === 0) this.grenT = this.now();   // nothing was running: start the clock now
    const from = G.launch(p.phys, cmd.yaw, cmd.pitch, C.eyeHeight(p.phys), this.boxes);
    this.sim.spawn(p.id, ev.grenade, from);
    this.broadcast({ t: 'thr', id: p.id, k: ev.grenade }, p);
  }

  /** Everyone a grenade could stick to or hurt, as they are right now. */
  grenadeTargets() {
    const out = [];
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      out.push({ id: q.id, x: q.phys.x, y: q.phys.y, z: q.phys.z, height: P.playerHeight(q.phys) * (q.zil ? Zilla.SCALE : 1), yaw: q.yaw, pitch: q.pitch });
    }
    return out;
  }

  /** Damage from an explosion or fire. owner can be null (they left) and can be the victim (self damage). */
  grenadeHurt(owner, q, dmg, at, type) {
    const now = this.now();
    if (!q.alive || now < q.invulnUntil || dmg <= 0) return;
    const res = this.hurt(owner && owner !== q ? owner : null, q, dmg);      // your own grenade is not boosted by your Damage Surge
    const killed = res.killed;
    q.conn.send({ t: 'dmg', d: res.shown, from: owner ? owner.id : 0, ax: r3(at.x), az: r3(at.z) });
    if (owner && owner !== q && owner.conn) {
      owner.conn.send({ t: 'hit', v: q.id, d: res.shown, h: false, k: killed, bs: 0, m: 0, gr: 1, p: [r3(q.phys.x), r3(q.phys.y + 1.0), r3(q.phys.z)] });
    }
    if (killed) this.kill(owner, q, false, type);
  }

  stepGrenades() {
    const now = this.now();
    if (!this.sim.list.length && !this.sim.zones.length) { this.grenT = now; return; }
    const dt = Math.min(0.1, Math.max(0, (now - this.grenT) / 1000));
    this.grenT = now;
    const targets = this.grenadeTargets();
    const events = this.sim.step(dt, targets);
    for (const e of events) {
      if (e.kind === 'boom') this.grenadeBoom(e, targets);
    }
    this.burnFires(this.grenadeTargets());
  }

  grenadeBoom(e, targets) {
    const g = e.g, def = g.def;
    const owner = this.players.get(g.owner) || null;
    const at = { x: g.x, y: g.y, z: g.z };
    this.broadcast({ t: 'boom', i: g.id, k: def.id, p: [r3(at.x), r3(at.y), r3(at.z)], r: def.radius || 0, d: def.duration || 0 });
    if (def.kind === 'frag' || def.kind === 'sticky') {
      for (const t of targets) {
        const q = this.players.get(t.id);
        if (!q) continue;
        const direct = !!(g.stuck && g.stuck !== 'wall' && g.stuck.id === t.id);
        const dmg = G.blastDamage(def, at, t, this.boxes, direct);
        this.grenadeHurt(owner, q, dmg, at, def.id);
      }
    } else if (def.kind === 'flash') {
      for (const t of targets) {
        const q = this.players.get(t.id);
        if (!q) continue;
        const secs = G.flashDuration(def, at, t, this.boxes);
        if (secs > 0) q.conn.send({ t: 'flash', d: secs });
      }
    }
  }

  /** Fire on the ground burns whoever is standing in it. */
  burnFires(targets) {
    for (const zone of this.sim.zones) {
      if (zone.kind !== 'incendiary') continue;
      const owner = this.players.get(zone.owner) || null;
      for (const hit of this.sim.fireDamage(zone, targets)) {
        const q = this.players.get(hit.id);
        if (q) this.grenadeHurt(owner, q, hit.dmg, zone, zone.type);
      }
    }
  }

  kill(killer, victim, head, weapon) {
    this.releaseGrab(victim);
    victim.hp = 0;
    victim.alive = false;
    this.world.removeOwner(victim.id);
    victim.deaths++;
    victim.respawnAt = this.now() + C.RESPAWN_TIME * 1000;
    const credit = killer && killer !== victim;            // blowing yourself up (or a thrower who left) earns no kill
    if (credit) killer.kills++;
    this.broadcast({ t: 'kill', k: killer ? killer.id : 0, v: victim.id, h: !!head, w: weapon || '' });
    this.log((killer ? killer.name : 'Someone') + (credit ? ' eliminated ' : ' blew up ') + victim.name + (head ? ' (headshot)' : ''));
  }

  respawn(p) {
    const sp = this.pickSpawn(p);
    p.phys = P.newPlayer(sp.x, sp.y, sp.z);
    if (p.nextLoadout) { p.loadout = p.nextLoadout; p.nextLoadout = null; }
    p.weapon = C.newWeaponState(p.loadout);
    p.abil = Abil.newState(); p.abilT = this.now();
    p.yaw = sp.yaw; p.pitch = 0;
    p.hp = p.zil ? Zilla.MAX_HP : C.MAX_HEALTH;
    if (p.zil) p.zil = Zilla.newState();
    p.grabbedBy = 0;
    p.alive = true;
    p.epoch++;
    p.invulnUntil = this.now() + C.SPAWN_PROTECTION * 1000;
    p.history.length = 0;
    this.broadcast({ t: 'lo', id: p.id, lo: p.loadout }, p);
  }

  // ------------------------------------------------------------ the 30 per second loop

  tick() {
    const now = this.now();
    for (const p of [...this.players.values()]) {
      if (now - p.lastMsgAt > IDLE_KICK_MS) {
        p.conn.send({ t: 'error', msg: 'You were disconnected because the connection went quiet.' });
        p.conn.close();
        this.removePlayer(p);
        continue;
      }
      if (!p.alive && now >= p.respawnAt) this.respawn(p);
      this.stepAbilities(p, now);
      this.stepZilla(p, now);
    }
    this.stepGrenades();
    this.stepWorldAbilities();
    if (!this.players.size) return;

    // Remember where everyone is (used to rewind targets for shots)
    for (const p of this.players.values()) {
      p.history.push({ t: now, x: p.phys.x, y: p.phys.y, z: p.phys.z, cr: p.phys.crouching, al: p.alive, ya: p.yaw, ln: p.phys.lean });
      while (p.history.length && p.history[0].t < now - HISTORY_MS) p.history.shift();
    }

    const list = [...this.players.values()].map((p) => ({
      i: p.id, x: r3(p.phys.x), y: r3(p.phys.y), z: r3(p.phys.z),
      a: r3(p.yaw), b: r3(p.pitch), c: p.phys.crouching ? 1 : 0, l: p.alive ? 1 : 0, w: p.weapon.cur, n: r2(p.phys.lean || 0),
      f: (p.abil.heal > 0 ? 1 : 0) | (p.abil.armor > 0 ? 2 : 0) | (p.abil.surge > 0 ? 4 : 0) | (p.abil.scan > 0 ? 8 : 0) | (p.weapon.boost > 0 ? 16 : 0) | (p.abil.cloak > 0 ? 32 : 0) | (p.abil.reveal > 0 ? 64 : 0)
        | (p.zil ? (p.zil.breathing ? 128 : 0) | (p.zil.grab ? 256 : 0) | (p.zil.stompT > 0 ? 512 : 0) : 0) | (p.grabbedBy ? 1024 : 0),
      k: p.kills, d: p.deaths, ...(p.zil ? { h: Math.round(p.hp) } : {}),
    }));
    const mdef = Weapons.ability('mine');
    const ds = this.world.domes.map((d) => [d.id, d.owner, r2(d.x), r2(d.y), r2(d.z), d.r, r2(d.left)]);
    const mn = this.world.mines.map((m) => [m.id, m.owner, r2(m.x), r2(m.y), r2(m.z), m.age >= mdef.arm ? 1 : 0]);
    const sk = this.world.strikes.map((s) => [s.id, s.owner, r2(s.x), r2(s.y), r2(s.z), r2(s.left)]);
    const gl = this.sim.list.map((g) => [g.id, G_ORDER.indexOf(g.type), r2(g.x), r2(g.y), r2(g.z), g.stuck ? 1 : 0, g.owner]);
    for (const p of this.players.values()) {
      const ph = p.phys;
      p.conn.send({
        t: 'snap', st: now, p: list, g: gl, ds, mn, sk,
        you: {
          ack: p.lastSeq, ep: p.epoch, hp: p.hp, al: p.alive ? 1 : 0,
          rt: p.alive ? 0 : Math.max(0, p.respawnAt - now),
          inv: Math.max(0, p.invulnUntil - now),
          ph: { x: ph.x, y: ph.y, z: ph.z, vx: ph.vx, vy: ph.vy, vz: ph.vz, g: ph.onGround ? 1 : 0, c: ph.crouching ? 1 : 0, j: ph.jumpLatch ? 1 : 0, ln: ph.lean || 0,
            dt: ph.dashT, dx: ph.dvx, dz: ph.dvz, dl: ph.dashLift ? 1 : 0, gt: ph.gT, gx: ph.gx, gy: ph.gy, gz: ph.gz },
          ab: Abil.pack(p.abil),
          ...(p.zil ? { zl: Zilla.pack(p.zil) } : {}), gb: p.grabbedBy ? 1 : 0,
          lo: p.loadout,
          wp: C.packWeaponState(p.weapon),
        },
      });
    }
  }
}

module.exports = { Room, cleanName, SNAPSHOT_HZ };

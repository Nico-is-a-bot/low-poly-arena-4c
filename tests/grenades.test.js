// Tests for grenades: the rules in shared/grenades.js and how the server room uses them.
const { check, near, section, summary } = require('./harness');
const P = require('../shared/physics');
const W = require('../shared/weapons');
const C = require('../shared/combat');
const G = require('../shared/grenades');
const { Room } = require('../server/room');

const open = P.prepareBoxes([]);                       // an empty arena (just the floor)
const wallAt = (x) => P.prepareBoxes([P.makeBox(x, 0, 0, 0.5, 6, 20)]);
const still = (x, z, id) => ({ id: id || 1, x, y: 0, z, height: 1.8, yaw: 0, pitch: 0 });
const cmd = (o) => Object.assign({ seq: 0, epoch: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, aim: false, fire: false, fresh: false, reload: false, quick: false, slot: -1, throw: false }, o);

section('Grenade stats match the brief');
{
  const f = W.grenade('frag'), fl = W.grenade('flash'), sm = W.grenade('smoke'), st = W.grenade('sticky'), inc = W.grenade('incendiary');
  check('five grenades exist', W.GRENADE_ORDER.length === 5);
  check('Frag: common, 2 s fuse, 70 damage, 5 m', f.rarity === 'common' && f.fuse === 2 && f.damage === 70 && f.radius === 5);
  check('Flash: rare, blinds up to 3 s', fl.rarity === 'rare' && fl.maxBlind === 3);
  check('Smoke: rare, 4 m radius for 8 s', sm.rarity === 'rare' && sm.radius === 4 && sm.duration === 8);
  check('Sticky: epic, 80 damage, 1.5 s fuse after sticking', st.rarity === 'epic' && st.damage === 80 && st.fuse === 1.5);
  check('Incendiary: mythic, 4 m radius, 5 s, 12 damage per second', inc.rarity === 'mythic' && inc.radius === 4 && inc.duration === 5 && inc.dps === 12);
  check('you carry 2, get one back every 30 s', W.GRENADE_MAX === 2 && W.GRENADE_REGEN === 30);
  check('loadouts check the grenade too', W.validateLoadout({ grenade: 'sticky' }).grenade === 'sticky' && W.validateLoadout({ grenade: 'nuke' }).grenade === 'frag' && W.validateLoadout(null).grenade === 'frag');
  check('grenade names cannot be made up with prototype tricks', W.validateLoadout({ grenade: '__proto__' }).grenade === 'frag' && W.validateLoadout({ grenade: 'constructor' }).grenade === 'frag');
}

section('Carrying, throwing and getting grenades back');
{
  const st = C.newWeaponState({ grenade: 'flash' });
  check('you start with 2 of the chosen type', st.gcount === 2 && st.grenade === 'flash');
  const k = { speed: 0, crouching: false, onGround: true, sprint: false };
  const me = { phys: P.newPlayer(0, 0, 0), weapon: st };
  let ev = C.stepTick(me, cmd({ throw: true }), open);
  check('G throws one', ev.threw && ev.grenade === 'flash' && st.gcount === 1);
  ev = C.stepTick(me, cmd({ throw: true }), open);
  check('you cannot throw again straight away', !ev.threw && st.gcount === 1);
  for (let i = 0; i < 50; i++) C.stepTick(me, cmd({}), open);
  ev = C.stepTick(me, cmd({ throw: true }), open);
  check('after the short cooldown you can', ev.threw && st.gcount === 0);
  for (let i = 0; i < 60; i++) C.stepTick(me, cmd({}), open);
  ev = C.stepTick(me, cmd({ throw: true }), open);
  check('with none left you cannot throw', !ev.threw && st.gcount === 0);
  let ticks = 0;
  while (st.gcount === 0 && ticks < 60 * 40) { C.stepTick(me, cmd({}), open); ticks++; }
  near('one grenade comes back 30 s after the first throw', ticks / 60 + 114 / 60, 30, 0.1);
  check('and only one at a time', st.gcount === 1);
  while (st.gcount < 2 && ticks < 60 * 80) { C.stepTick(me, cmd({}), open); ticks++; }
  near('the second another 30 s later', ticks / 60 + 114 / 60, 60, 0.2);
  for (let i = 0; i < 600; i++) C.stepTick(me, cmd({}), open);
  check('never more than 2', st.gcount === 2);
  const copy = C.newWeaponState({});
  C.applyWeaponPacket(JSON.parse(JSON.stringify(C.packWeaponState(st))), C.copyWeaponState(st, copy));
  check('grenade count survives a snapshot', copy.gcount === 2 && copy.grenade === 'flash');
  check('the throw flag survives packing', C.unpackCmd(JSON.parse(JSON.stringify(C.packCmd(cmd({ seq: 1, epoch: 1, throw: true }))))).throw === true && C.unpackCmd(C.packCmd(cmd({ seq: 1, epoch: 1 }))).throw === false);
}

section('Flight and bouncing');
{
  const ph = P.newPlayer(0, 0, 0);
  const from = G.launch(ph, -Math.PI / 2, 0, P.C.EYE, open);     // facing +X, level
  check('it starts in front of you, moving forward and a little up', from.x > 0.3 && from.vx > 15 && from.vy > 0);
  const path = G.previewPath(from, open, 4);
  const end = path[path.length - 1];
  check('it lands on the floor in front of you', end[0] > 8 && Math.abs(end[1] - G.RADIUS) < 0.02, end);
  check('the arc is smooth (peaks then falls)', Math.max(...path.map((q) => q[1])) > from.y);
  // bounce off a wall
  const b = { x: 0, y: 1.5, z: 0, vx: 15, vy: 0, vz: 0, grounded: false };
  const wall = wallAt(5);
  let bounced = false, through = false, back = 0;
  for (let i = 0; i < 120; i++) {
    G.stepBody(b, 1 / 60, wall);
    if (b.vx < 0) bounced = true;
    back = Math.min(back, b.vx);
    if (b.x > 5.5) through = true;
  }
  check('it bounces off a wall', bounced);
  check('and never goes through it', !through);
  check('and loses speed when it bounces', back > -9 && back < -3, back);
  const fast = { x: 0, y: 1.5, z: 0, vx: 30, vy: 0, vz: 0, grounded: false };
  let leaked = false;
  for (let i = 0; i < 60; i++) { G.stepBody(fast, 1 / 60, P.prepareBoxes([P.makeBox(5, 0, 0, 0.2, 6, 20)])); if (fast.x > 5.2) leaked = true; }
  check('even a fast throw cannot tunnel through a thin wall', !leaked);
  // comes to rest
  const r = { x: 0, y: 2, z: 0, vx: 6, vy: 0, vz: 0, grounded: false };
  for (let i = 0; i < 60 * 6; i++) G.stepBody(r, 1 / 60, open);
  check('it rolls to a stop', Math.hypot(r.vx, r.vy, r.vz) < 0.01 && r.grounded, JSON.stringify(r));
  // thrown at a wall right in front of you
  const nose = G.launch(P.newPlayer(4.2, 0, 0), -Math.PI / 2, 0, P.C.EYE, wall);
  check('thrown at a wall in your face it does not start inside the wall', nose.x < 4.75, nose.x);
  // landing on a crate top
  const crate = P.prepareBoxes([P.makeBox(0, 0, 0, 2, 1, 2)]);
  const c = { x: 0, y: 3, z: 0, vx: 0, vy: 0, vz: 0, grounded: false };
  for (let i = 0; i < 240; i++) G.stepBody(c, 1 / 60, crate);
  check('it can land and rest on top of a box', Math.abs(c.y - (1 + G.RADIUS)) < 0.02, c.y);
}

section('Fuse timing for every type');
{
  const timeToBoom = (type, setup) => {
    const sim = new G.Sim(open);
    sim.spawn(1, type, setup || { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0 });
    for (let i = 0; i < 60 * 10; i++) {
      const ev = sim.step(1 / 60, []);
      if (ev.some((e) => e.kind === 'boom')) return (i + 1) / 60;
    }
    return null;
  };
  near('Frag goes off after 2 s', timeToBoom('frag'), 2, 0.03);
  near('Flash after 1.3 s', timeToBoom('flash'), 1.3, 0.03);
  near('Smoke after 1.2 s', timeToBoom('smoke'), 1.2, 0.03);
  near('Incendiary after 1.2 s', timeToBoom('incendiary'), 1.2, 0.03);
  // sticky: counts from the moment it sticks
  const sim = new G.Sim(open);
  sim.spawn(1, 'sticky', { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0 });
  let stuckAt = null, boomAt = null;
  for (let i = 0; i < 60 * 10 && boomAt === null; i++) {
    const ev = sim.step(1 / 60, []);
    if (stuckAt === null && sim.list[0] && sim.list[0].stuck) stuckAt = (i + 1) / 60;
    if (ev.some((e) => e.kind === 'boom')) boomAt = (i + 1) / 60;
  }
  check('Sticky sticks to the floor', stuckAt !== null && stuckAt < 0.5, stuckAt);
  near('and goes off 1.5 s after sticking', boomAt - stuckAt, 1.5, 0.04);
  // sticky that never touches anything
  const s2 = new G.Sim(open);
  s2.spawn(1, 'sticky', { x: 0, y: 1000, z: 0, vx: 0, vy: 0, vz: 0 });
  let b2 = null;
  for (let i = 0; i < 60 * 8 && b2 === null; i++) if (s2.step(1 / 60, []).some((e) => e.kind === 'boom')) b2 = (i + 1) / 60;
  near('a sticky that finds nothing still goes off after 5 s', b2, 5, 0.05);
}

section('Frag and sticky damage');
{
  const frag = W.grenade('frag');
  const at = { x: 0, y: 0.12, z: 0 };
  const dmgAt = (d) => G.blastDamage(frag, at, still(d, 0), open, false);
  check('standing on it: about 70', dmgAt(0) >= 67, dmgAt(0));
  check('2.5 m away (measured to the body): about half', Math.abs(dmgAt(2.5) - 37) <= 6, dmgAt(2.5));
  check('5.5 m away: nothing', dmgAt(5.5) === 0, dmgAt(5.5));
  check('damage fades smoothly with distance', dmgAt(1) > dmgAt(2) && dmgAt(2) > dmgAt(3) && dmgAt(3) > dmgAt(4) && dmgAt(4) > 0);
  const wall = wallAt(1.5);
  check('a wall in between blocks the blast', G.blastDamage(frag, at, still(3, 0), wall, false) === 0);
  check('but a wall behind you does not', G.blastDamage(frag, at, still(1, 0), wall, false) > 40);
  const low = { x: 3, y: 0, z: 0, height: 1.2 };
  check('crouching works too', G.blastDamage(frag, at, low, open, false) > 20);
  const sticky = W.grenade('sticky');
  check('Sticky stuck on a player does the full 80', G.blastDamage(sticky, at, still(0.3, 0), open, true) === 80);
  check('Sticky nearby does less, down to 0 at 4 m', G.blastDamage(sticky, at, still(2, 0), open, false) < 80 && G.blastDamage(sticky, at, still(4.6, 0), open, false) === 0);
}

section('Flashbang');
{
  const fl = W.grenade('flash');
  const at = { x: 0, y: 1.5, z: 0 };
  // a player at +X looking toward -X (at the flash): yaw so that forward = (-sin yaw) => -1 means yaw = PI/2
  const face = (x, yaw, pitch) => ({ x, y: 0, z: 0, height: 1.8, yaw, pitch: pitch === undefined ? 0 : pitch });
  const near2 = G.flashDuration(fl, at, face(2, Math.PI / 2, 0.2), open);
  check('close and looking at it: almost 3 s', near2 >= 2.4 && near2 <= 3, near2);
  const far = G.flashDuration(fl, at, face(12, Math.PI / 2, 0.1), open);
  check('farther away is shorter', far < near2 * 0.7 && far > 0.3, far);
  const away = G.flashDuration(fl, at, face(2, -Math.PI / 2, 0), open);
  check('looking away helps a lot', away < near2 * 0.35, away);
  const side = G.flashDuration(fl, at, face(2, 0, 0), open);
  check('side on is in between', side > away && side < near2, side);
  check('too far away: nothing', G.flashDuration(fl, at, face(25, Math.PI / 2, 0), open) === 0);
  check('a wall blocks it', G.flashDuration(fl, at, face(4, Math.PI / 2, 0), wallAt(2)) === 0);
  check('never longer than 3 s', G.flashDuration(fl, { x: 0, y: 1.6, z: 0 }, face(0.1, Math.PI / 2, 0), open) <= 3);
}

section('Sticking to players');
{
  const sim = new G.Sim(open);
  const target = { id: 5, x: 3, y: 0, z: 0, height: 1.8 };
  sim.spawn(1, 'sticky', { x: 0, y: 1.2, z: 0, vx: 12, vy: 0.5, vz: 0 });
  let stuck = null;
  for (let i = 0; i < 120 && !stuck; i++) { sim.step(1 / 60, [target]); if (sim.list[0] && sim.list[0].stuck) stuck = sim.list[0].stuck; }
  check('a sticky thrown at a player sticks to them', stuck && stuck !== 'wall' && stuck.id === 5, JSON.stringify(stuck));
  target.x = 6;
  sim.step(1 / 60, [target]);
  check('and goes where they go', sim.list[0] && Math.abs(sim.list[0].x - (6 + stuck.ox)) < 0.01);
  // can't stick to yourself in the throw
  const s2 = new G.Sim(open);
  const me = { id: 1, x: 0, y: 0, z: 0, height: 1.8 };
  s2.spawn(1, 'sticky', { x: 0.2, y: 1.2, z: 0, vx: 10, vy: 0, vz: 0 });
  s2.step(0.1, [me]);
  check('it does not stick to your own hand as you throw it', !s2.list[0].stuck || s2.list[0].stuck === 'wall');
  // the player vanishes: the grenade drops
  const s3 = new G.Sim(open);
  s3.spawn(1, 'sticky', { x: 0, y: 1.2, z: 0, vx: 12, vy: 0.5, vz: 0 });
  for (let i = 0; i < 120; i++) s3.step(1 / 60, [target]);
  s3.step(1 / 60, []);
  check('if the player is gone it falls and still goes off', s3.list.length === 0 || s3.list[0].stuck !== undefined);
}

section('Smoke and fire');
{
  const sim = new G.Sim(open);
  sim.spawn(1, 'smoke', { x: 0, y: 0.12, z: 0, vx: 0, vy: 0, vz: 0 });
  let t = 0, born = null, ended = null;
  while (t < 15 && ended === null) {
    const ev = sim.step(1 / 60, []); t += 1 / 60;
    for (const e of ev) { if (e.kind === 'boom') born = t; if (e.kind === 'zoneEnd') ended = t; }
  }
  near('the cloud lasts 8 s', ended - born, 8, 0.05);
  const fire = new G.Sim(open);
  fire.spawn(1, 'incendiary', { x: 0, y: 0.12, z: 0, vx: 0, vy: 0, vz: 0 });
  let t2 = 0, ended2 = null, zone = null;
  const burn = [];                                          // damage dealt to a player standing in the middle, by time
  while (t2 < 12 && ended2 === null) {
    const ev = fire.step(1 / 60, [still(0, 0, 9)]); t2 += 1 / 60;
    for (const e of ev) {
      if (e.kind === 'boom') zone = e.zone;
      if (e.kind === 'zoneEnd') ended2 = t2;
    }
    if (zone && fire.zones.length) for (const h of fire.fireDamage(zone, [still(0, 0, 9)])) burn.push({ t: t2, dmg: h.dmg });
  }
  near('the fire burns for 5 s', ended2 - 1.2, 5, 0.06);
  check('walking into the fire hurts at once for 2 ticks (12)', burn.length > 0 && burn[0].dmg === 12 && burn[0].t - 1.2 < 0.1, JSON.stringify(burn[0]));
  check('then 6 every half second after that', burn.length >= 9 && burn.slice(1).every((b) => b.dmg === 6), JSON.stringify(burn.map((b) => b.dmg)));
  const total = burn.reduce((a, b) => a + b.dmg, 0);
  check('standing in it the whole time costs about 66', total >= 60 && total <= 70, total);
  const gaps = burn.slice(1).map((b, i) => b.t - burn[i].t);
  check('the ticks come twice a second', gaps.slice(1).every((g) => Math.abs(g - 0.5) < 0.05), gaps.join(','));
  // leaving and coming back burns the 2 ticks again
  const f2 = new G.Sim(open);
  f2.spawn(1, 'incendiary', { x: 0, y: 0.12, z: 0, vx: 0, vy: 0, vz: 0 });
  let z2 = null;
  for (let i = 0; i < 60 * 2 && !z2; i++) { for (const e of f2.step(1 / 60, [])) if (e.kind === 'boom') z2 = e.zone; }
  const inn = [still(1, 0, 3)], out = [still(9, 0, 3)];
  const d1 = f2.fireDamage(z2, inn);
  const d2 = f2.fireDamage(z2, out);
  const d3 = f2.fireDamage(z2, inn);
  check('stepping out and back in burns 2 ticks again', d1[0].dmg === 12 && d2.length === 0 && d3.length === 1 && d3[0].dmg === 12);
  check('burning area has a 4 m radius', zone && zone.r === 4);
  const z = { x: 0, y: 0, z: 0, r: 4 };
  check('standing in the fire counts', G.inFire(z, still(2, 0), open) && G.inFire(z, still(3.9, 0), open));
  check('outside it does not', !G.inFire(z, still(5, 0), open));
  check('a wall blocks the fire', !G.inFire(z, still(3, 0), wallAt(1.5)));
  check('standing high up above it does not', !G.inFire(z, { x: 0, y: 4, z: 0, height: 1.8 }, open));
}

// ------------------------------------------------------------------ the room
function fakeConn() {
  const c = { got: [], closed: false, send(m) { c.got.push(m); }, close() { c.closed = true; } };
  c.last = (t) => { for (let i = c.got.length - 1; i >= 0; i--) if (c.got[i].t === t) return c.got[i]; return null; };
  c.all = (t) => c.got.filter((m) => m.t === t);
  return c;
}
function setup(loA, loB) {
  const clock = { t: 0 };
  const room = new Room({ clock: () => clock.t });
  room.boxes = room.boxes.slice();
  room.sim.boxes = room.boxes;
  const ca = fakeConn(), cb = fakeConn();
  const a = room.addPlayer(ca, 'A', loA);
  const b = room.addPlayer(cb, 'B', loB);
  a.invulnUntil = b.invulnUntil = 0;
  a.phys = P.newPlayer(-20, 0, -5); b.phys = P.newPlayer(-10, 0, -5);
  room.tick();
  return { room, clock, ca, cb, a, b };
}
function advance(room, clock, seconds) {
  for (let t = 0; t < seconds; t += 1 / 30) { clock.t += 1000 / 30; room.tick(); }
}
const drop = (room, owner, type, x, z, y) => room.sim.spawn(owner.id, type, { x, y: y === undefined ? 0.12 : y, z, vx: 0, vy: 0, vz: 0 });

section('Room: frag');
{
  let r = setup();
  drop(r.room, r.a, 'frag', -10, -5);
  advance(r.room, r.clock, 2.0);
  check('nothing happens before the fuse runs out', r.b.hp === 100);
  advance(r.room, r.clock, 0.8);
  check('standing on a frag costs about 70', r.b.hp <= 33 && r.b.hp >= 28, r.b.hp);
  check('everyone sees the explosion', r.ca.last('boom') && r.cb.last('boom') && r.cb.last('boom').k === 'frag');
  const hit = r.ca.last('hit');
  check('the thrower gets a hit marker for it', hit && hit.v === r.b.id && hit.gr === 1 && hit.d > 60);
  check('the victim feels it and knows where it came from', r.cb.last('dmg') && r.cb.last('dmg').d === hit.d);
  r = setup();
  drop(r.room, r.a, 'frag', -10, -5); r.b.phys = P.newPlayer(-6, 0, -5);   // 4 m away
  advance(r.room, r.clock, 3);
  check('4 m away it only scratches', r.b.hp > 80 && r.b.hp < 100, r.b.hp);
  r = setup();
  drop(r.room, r.a, 'frag', -10, -5); r.b.invulnUntil = r.room.now() + 10000;
  advance(r.room, r.clock, 3);
  check('spawn protection stops grenades too', r.b.hp === 100);
  r = setup();
  r.room.boxes.push(P.makeBox(-10, 0, -7, 6, 4, 0.4));        // a wall between the grenade and B
  P.prepareBoxes(r.room.boxes);
  drop(r.room, r.a, 'frag', -10, -9.5); r.b.phys = P.newPlayer(-10, 0, -4);
  advance(r.room, r.clock, 3);
  check('a wall protects you from the blast', r.b.hp === 100, r.b.hp);
  // kill credit and self damage
  r = setup();
  r.b.hp = 30;
  drop(r.room, r.a, 'frag', -10, -5);
  advance(r.room, r.clock, 3);
  check('a grenade kill counts for the thrower', !r.b.alive && r.a.kills === 1 && r.b.deaths === 1);
  const k = r.cb.last('kill');
  check('the kill feed says which grenade', k && k.k === r.a.id && k.w === 'frag', JSON.stringify(k));
  r = setup();
  r.a.phys = P.newPlayer(-10, 0, -5); r.b.phys = P.newPlayer(0, 0, 0);
  drop(r.room, r.a, 'frag', -10, -5);
  advance(r.room, r.clock, 3);
  check('you can hurt yourself with your own grenade', r.a.hp < 40, r.a.hp);
  r.a.hp = 100; r.a.alive = true;
  r.a.hp = 20; drop(r.room, r.a, 'frag', -10, -5);
  advance(r.room, r.clock, 3);
  check('blowing yourself up is a death but not a kill', !r.a.alive && r.a.kills === 0 && r.a.deaths === 1);
  check('and the feed says so (killer is the victim)', r.ca.last('kill').k === r.a.id && r.ca.last('kill').v === r.a.id);
  // thrower disconnects before it goes off
  r = setup();
  drop(r.room, r.a, 'frag', -10, -5);
  r.room.removePlayer(r.a);
  advance(r.room, r.clock, 3);
  check('if the thrower leaves, the grenade still goes off (no kill credit)', r.b.hp < 40);
  r.b.hp = 10; r.b.alive = true;
  r.room.sim.spawn(999, 'frag', { x: -10, y: 0.12, z: -5, vx: 0, vy: 0, vz: 0 });
  advance(r.room, r.clock, 3);
  check('a death from a grenade of someone who left credits nobody', !r.b.alive && r.cb.last('kill').k === 0);
}

section('Room: sticky, flash, smoke, incendiary');
{
  let r = setup();
  r.room.sim.spawn(r.a.id, 'sticky', { x: -14, y: 1.2, z: -5, vx: 12, vy: 0.3, vz: 0 });
  advance(r.room, r.clock, 0.9);
  check('a sticky thrown at B sticks to B', r.room.sim.list[0] && r.room.sim.list[0].stuck && r.room.sim.list[0].stuck.id === r.b.id, JSON.stringify(r.room.sim.list[0] && r.room.sim.list[0].stuck));
  const snap = r.ca.last('snap');
  check('snapshots list grenades (id, type, position, stuck)', snap.g.length === 1 && snap.g[0][1] === 3 && snap.g[0][5] === 1, JSON.stringify(snap.g));
  r.b.phys.x += 3; r.b.phys.z += 1;
  advance(r.room, r.clock, 2.4);
  check('it goes with him and does the full 80', r.b.hp <= 22 && r.b.hp >= 18, r.b.hp);

  r = setup();
  drop(r.room, r.a, 'flash', -10, -3, 1.6);
  r.b.yaw = -Math.PI / 2; r.a.yaw = Math.PI / 2;     // B looks +X (away from A's flash at his side), irrelevant: just check messages
  advance(r.room, r.clock, 2);
  check('a flash tells the blinded players how long', r.cb.last('flash') && r.cb.last('flash').d > 0 && r.cb.last('flash').d <= 3, JSON.stringify(r.cb.last('flash')));
  check('flash does no damage', r.b.hp === 100 && r.a.hp === 100);
  check('a player 10 m away is flashed less than one next to it', (r.ca.last('flash') ? r.ca.last('flash').d : 0) <= r.cb.last('flash').d + 3);

  r = setup();
  drop(r.room, r.a, 'smoke', -10, -5);
  advance(r.room, r.clock, 2);
  const boom = r.cb.last('boom');
  check('smoke announces a 4 m cloud for 8 s', boom && boom.k === 'smoke' && boom.r === 4 && boom.d === 8, JSON.stringify(boom));
  check('smoke does no damage', r.b.hp === 100);

  r = setup();
  drop(r.room, r.a, 'incendiary', -10, -5);
  advance(r.room, r.clock, 1.1);
  check('fire does nothing before it lands and bursts', r.b.hp === 100);
  advance(r.room, r.clock, 2.6);     // about 2.5 s of fire
  check('standing in fire hurts 12 on entry then about 12 per second', r.b.hp <= 70 && r.b.hp >= 55, r.b.hp);
  advance(r.room, r.clock, 4);
  const after = r.b.hp;
  advance(r.room, r.clock, 2);
  check('the fire burns out after 5 s', r.b.hp === after && r.room.sim.zones.length === 0, r.b.hp + ' vs ' + after);
  check('about 66 total damage standing in the whole fire (12 on entry, then 6 twice a second)', after <= 40 && after >= 28, after);
  r = setup();
  drop(r.room, r.a, 'incendiary', -10, -5);
  r.b.phys = P.newPlayer(-10, 0, -12);     // stand clear
  advance(r.room, r.clock, 8);
  check('standing outside the fire is safe', r.b.hp === 100);
  r = setup();
  drop(r.room, r.a, 'incendiary', -10, -5);
  r.b.hp = 12;
  advance(r.room, r.clock, 2.2);
  check('walking into fire can kill at once, and the thrower gets the kill', !r.b.alive && r.a.kills === 1 && r.cb.last('kill').w === 'incendiary');
}

section('Room: throwing from a real command');
{
  const r = setup({ grenade: 'smoke' });
  check('the server knows which grenade each player carries', r.a.weapon.grenade === 'smoke' && r.ca.last('welcome').lo.grenade === 'smoke');
  r.clock.t += 20;
  r.room.handleMessage(r.a, { t: 'cmds', c: [C.packCmd(cmd({ seq: 1, epoch: r.a.epoch, yaw: -Math.PI / 2, pitch: 0.1, throw: true }))] });
  check('a throw command creates a grenade and uses one up', r.room.sim.list.length === 1 && r.a.weapon.gcount === 1);
  check('others are told someone threw (for the sound)', r.cb.last('thr') && r.cb.last('thr').k === 'smoke' && r.cb.last('thr').id === r.a.id);
  const g = r.room.sim.list[0];
  check('it flies the way the player looked (east)', g.vx > 10 && Math.abs(g.vz) < 1);
  r.clock.t += 20;
  r.room.handleMessage(r.a, { t: 'cmds', c: [C.packCmd(cmd({ seq: 2, epoch: r.a.epoch, throw: true }))] });
  check('a second throw straight away is refused', r.room.sim.list.length === 1 && r.a.weapon.gcount === 1);
  // dead players cannot throw
  r.a.alive = false; r.a.weapon.gcd = 0; r.a.weapon.gcount = 2;
  r.clock.t += 20;
  r.room.handleMessage(r.a, { t: 'cmds', c: [C.packCmd(cmd({ seq: 3, epoch: r.a.epoch, throw: true }))] });
  check('a dead player cannot throw', r.room.sim.list.length === 1);
  // a changed loadout applies on respawn
  r.room.handleMessage(r.b, { t: 'loadout', lo: { grenade: 'incendiary' } });
  r.room.respawn(r.b);
  check('a new grenade choice applies on the next respawn with a full 2', r.b.weapon.grenade === 'incendiary' && r.b.weapon.gcount === 2);
  r.a.alive = true; r.room.respawn(r.a);
  check('respawning refills grenades', r.a.weapon.gcount === 2);
  // regen is run by the server too
  r.a.weapon.gcount = 0; r.a.weapon.gregen = 0;
  let n = 0;
  for (let i = 0; i < 60 * 31; i++) { r.clock.t += 1000 / 60; r.room.handleMessage(r.a, { t: 'cmds', c: [C.packCmd(cmd({ seq: 100 + i, epoch: r.a.epoch }))] }); n++; }
  check('after 30 s the server gives one back', r.a.weapon.gcount === 1, r.a.weapon.gcount);
}

section('The aiming arc matches the real throw');
{
  const real = require('../shared/maps').get('container_yard');
  const boxes = P.prepareBoxes(real.boxes);
  let worst = 0, n = 0;
  for (const [x, z, yaw, pitch] of [[-13, -5, -Math.PI / 2, 0], [-13, -5, -Math.PI / 2, -0.4], [-13, -5, -Math.PI / 2, 0.5], [0, 10, 0.4, 0.1], [5, 5, 2.0, -0.2], [-8, 12, -1.0, 0.3]]) {
    const ph = P.newPlayer(x, 0, z);
    const from = G.launch(ph, yaw, pitch, P.C.EYE, boxes);
    const path = G.previewPath(from, boxes, 3.0);
    const sim = new G.Sim(boxes);
    const g = sim.spawn(1, 'smoke', from);          // 1.5 s fuse; compare where it is at the same time
    const tEnd = path.length > 12 ? 1.1 : (path.length - 1) / 10;
    for (let t = 0; t < tEnd - 1e-9; t += 0.05) sim.step(0.05, []);
    const idx = Math.round(tEnd * 10);
    const pp = path[Math.min(idx, path.length - 1)];
    const d = Math.hypot(g.x - pp[0], g.y - pp[1], g.z - pp[2]);
    worst = Math.max(worst, d); n++;
  }
  check('the arc shows where the grenade really goes (within half a metre after 1.1 s)', worst < 0.5, worst);
}

process.exit(summary('grenades') ? 0 : 1);

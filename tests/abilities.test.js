// Tests for abilities: Dash, Heal Pulse, Air Dash, Armor Plate, Scan Pulse, Grapple Hook, Damage Surge, Second Wind.
const { check, near, section, summary } = require('./harness');
const P = require('../shared/physics');
const W = require('../shared/weapons');
const C = require('../shared/combat');
const A = require('../shared/abilities');
const { Room } = require('../server/room');

const open = P.prepareBoxes([]);
const wallAt = (x) => P.prepareBoxes([P.makeBox(x, 0, 0, 0.5, 6, 20)]);
const cmd = (o) => Object.assign({ seq: 0, epoch: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, aim: false, fire: false, fresh: false, reload: false, quick: false, slot: -1, throw: false, leanL: false, leanR: false, ability: false }, o);
const mk = (id) => ({ phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({ ability: id }) });
const run = (me, n, make, boxes) => { let last; for (let i = 0; i < n; i++) last = C.stepTick(me, make(i), boxes || open); return last; };

section('Ability stats match the brief');
{
  const g = (id) => W.ability(id);
  check('Dash: common, 8 s', g('dash').rarity === 'common' && g('dash').cd === 8);
  check('Heal Pulse: common, 25 HP over 3 s, 30 s', g('heal').rarity === 'common' && g('heal').amount === 25 && g('heal').dur === 3 && g('heal').cd === 30);
  check('Air Dash: rare, 10 s', g('airdash').rarity === 'rare' && g('airdash').cd === 10);
  check('Armor Plate: rare, 30 damage within 10 s, 35 s', g('armor').rarity === 'rare' && g('armor').amount === 30 && g('armor').dur === 10 && g('armor').cd === 35);
  check('Scan Pulse: rare, 30 m for 3 s, 25 s', g('scan').rarity === 'rare' && g('scan').range === 30 && g('scan').dur === 3 && g('scan').cd === 25);
  check('Grapple Hook: epic, 25 m, 12 s', g('grapple').rarity === 'epic' && g('grapple').range === 25 && g('grapple').cd === 12);
  check('Damage Surge: epic, +30% for 8 s, 40 s', g('surge').rarity === 'epic' && g('surge').mult === 1.3 && g('surge').dur === 8 && g('surge').cd === 40);
  check('Second Wind: legendary, 50 HP, 60 s, passive', g('secondwind').rarity === 'legendary' && g('secondwind').hp === 50 && g('secondwind').cd === 60 && g('secondwind').passive);
  check('Dash is the default (owned at the start)', W.DEFAULT_LOADOUT.ability === 'dash' && W.validateLoadout(null).ability === 'dash');
  check('made-up abilities are replaced', W.validateLoadout({ ability: 'teleport' }).ability === 'dash' && W.validateLoadout({ ability: '__proto__' }).ability === 'dash' && W.validateLoadout({ ability: 'grapple' }).ability === 'grapple');
}

section('Dash');
{
  const me = mk('dash');
  const ev = run(me, 1, () => cmd({ moveZ: 1, ability: true }));
  check('pressing the key dashes', ev.ability && ev.ability.id === 'dash' && me.phys.dashT > 0);
  const speeds = [];
  for (let i = 0; i < 20; i++) { C.stepTick(me, cmd({ moveZ: 1 }), open); speeds.push(Math.hypot(me.phys.vx, me.phys.vz)); }
  check('you reach about 16 m/s (walking is 5)', Math.max(...speeds) > 15, Math.max(...speeds));
  check('the burst is short (about 0.2 s), then you slow down', speeds[18] < 14, speeds[18]);
  check('the cooldown is 8 s', Math.abs(me.weapon.acd - (8 - 20 / 60)) < 0.02);
  const ev2 = run(me, 1, () => cmd({ ability: true }));
  check('you cannot dash again until it is ready', !ev2.ability);
  run(me, 60 * 8, () => cmd({}));
  check('after 8 s it is ready', me.weapon.acd === 0);
  // direction: strafe right at yaw 0 (right = +X)
  const m2 = mk('dash');
  run(m2, 6, (i) => cmd({ moveX: 1, ability: i === 0 }));
  check('it goes the way you are moving (strafing right goes +X)', m2.phys.vx > 10 && Math.abs(m2.phys.vz) < 1, m2.phys.vx);
  const m3 = mk('dash');
  run(m3, 6, (i) => cmd({ yaw: Math.PI / 2, ability: i === 0 }));
  check('standing still it dashes where you look (yaw 90 degrees looks toward -X)', m3.phys.vx < -10, m3.phys.vx);
  // does not go through walls
  const wall = P.prepareBoxes([P.makeBox(0, 0, -3, 6, 4, 0.5)]);
  const m4 = mk('dash');
  run(m4, 40, (i) => cmd({ moveZ: 1, ability: i === 0 }), wall);
  check('a dash stops at a wall', m4.phys.z > -2.9, m4.phys.z);
  const pk = C.unpackCmd(JSON.parse(JSON.stringify(C.packCmd(cmd({ seq: 1, epoch: 1, ability: true })))));
  check('the ability key survives packing', pk.ability === true && C.unpackCmd(C.packCmd(cmd({ seq: 1, epoch: 1 }))).ability === false);
}

section('Air Dash');
{
  const me = mk('airdash');
  const ev = run(me, 1, () => cmd({ moveZ: 1, ability: true }));
  check('it does nothing on the ground (and costs no cooldown)', !ev.ability && me.weapon.acd === 0);
  run(me, 2, () => cmd({ moveZ: 1, jump: true }));
  run(me, 6, () => cmd({ moveZ: 1, jump: true }));
  check('now we are in the air', !me.phys.onGround);
  const ev2 = run(me, 1, () => cmd({ moveZ: 1, jump: true, ability: true }));
  check('in the air it fires', ev2.ability && ev2.ability.id === 'airdash' && me.weapon.acd > 9);
  const vy0 = me.phys.vy;
  const zs = []; for (let i = 0; i < 15; i++) { C.stepTick(me, cmd({ moveZ: 1 }), open); zs.push(me.phys.z); }
  check('it carries you sideways quickly (about 13 m/s)', Math.hypot(me.phys.vx, me.phys.vz) > 5 && zs[0] - zs[10] > 2, zs[0] - zs[10]);
  // crossing a gap: float over a 4 m wide gap in the floor? (there is no pit in this map: check it holds you up)
  const a = mk('airdash'), b = mk('dash');
  for (const m of [a, b]) run(m, 2, () => cmd({ moveZ: 1, jump: true }));
  const ya = [], yb = [];
  run(a, 6, () => cmd({ moveZ: 1, jump: true })); run(b, 6, () => cmd({ moveZ: 1, jump: true }));
  run(a, 1, () => cmd({ moveZ: 1, jump: true, ability: true }));
  for (let i = 0; i < 18; i++) { C.stepTick(a, cmd({ moveZ: 1 }), open); C.stepTick(b, cmd({ moveZ: 1 }), open); ya.push(a.phys.y); yb.push(b.phys.y); }
  check('the air dash holds you up longer than just jumping', ya[10] > yb[10] + 0.05, ya[10] + ' vs ' + yb[10]);
}

section('Grapple Hook');
{
  const wall = P.prepareBoxes([P.makeBox(0, 0, -15, 20, 8, 1)]);       // a wall 15 m in front, face at z = -14.5
  const me = mk('grapple');
  const ev = run(me, 1, () => cmd({ pitch: 0.2, ability: true }), wall);
  check('it fires at a wall in range', ev.ability && ev.ability.id === 'grapple' && ev.ability.target && Math.abs(ev.ability.target[2] + 14.5) < 0.05, JSON.stringify(ev.ability));
  run(me, 60, () => cmd({ pitch: 0.2 }), wall);
  check('and pulls you to the wall (within 3 m of it)', me.phys.z < -11 && me.phys.gT === 0, me.phys.z);
  const nope = mk('grapple');
  const e2 = run(nope, 1, () => cmd({ pitch: 0.2, ability: true }), open);
  check('it does nothing when it points at the floor or the sky (no cooldown spent)', !e2.ability && nope.weapon.acd === 0);
  const far = P.prepareBoxes([P.makeBox(0, 0, -40, 20, 8, 1)]);
  const e3 = run(mk('grapple'), 1, () => cmd({ ability: true }), far);
  check('nothing beyond 25 m', !e3.ability);
  // grapple to the top of a crate
  const crate = P.prepareBoxes([P.makeBox(0, 0, -8, 4, 1.2, 4)]);
  const m5 = mk('grapple');
  const e5 = run(m5, 1, () => cmd({ pitch: -0.12, ability: true }), crate);
  run(m5, 120, () => cmd({ pitch: -0.12 }), crate);
  check('you can hook onto the top of a crate and end up standing on it', e5.ability && m5.phys.y > 1.0 && m5.phys.onGround && m5.phys.z < -5.5, JSON.stringify([m5.phys.y, m5.phys.onGround, m5.phys.z]));
}

section('Heal Pulse, Armor Plate, Damage Surge, Scan: the timers');
{
  const st = A.newState();
  A.activate(st, 'heal');
  let total = 0; for (let i = 0; i < 60 * 4; i++) total += A.step(st, 1 / 60);
  near('Heal Pulse restores 25 HP in total', total, 25, 0.05);
  const s2 = A.newState(); A.activate(s2, 'heal');
  let t2 = 0; for (let i = 0; i < 60; i++) t2 += A.step(s2, 1 / 60);
  near('and about 8.3 HP per second', t2, 25 / 3, 0.1);
  A.mitigate(s2, 5);
  check('taking damage cancels it', s2.heal === 0 && A.step(s2, 1) === 0);
  const s3 = A.newState(); A.activate(s3, 'armor');
  near('Armor Plate soaks up to 30', 30, s3.armor, 0);
  check('20 damage is fully absorbed', A.mitigate(s3, 20) === 0 && s3.armor === 10);
  check('the next 25 only has the last 10 absorbed (15 gets through)', A.mitigate(s3, 25) === 15 && s3.armor === 0);
  check('then it is gone', A.mitigate(s3, 10) === 10);
  const s4 = A.newState(); A.activate(s4, 'armor');
  for (let i = 0; i < 60 * 10 + 5; i++) A.step(s4, 1 / 60);
  check('and it runs out after 10 s', s4.armor === 0 && A.mitigate(s4, 10) === 10);
  const s5 = A.newState(); A.activate(s5, 'surge');
  check('Damage Surge is x1.3 for 8 s', A.damageMult(s5) === 1.3);
  for (let i = 0; i < 60 * 8 + 3; i++) A.step(s5, 1 / 60);
  check('and then back to x1', A.damageMult(s5) === 1);
  const s6 = A.newState(); A.activate(s6, 'scan');
  near('Scan Pulse lasts 3 s', s6.scan, 3, 0);
  const copy = A.unpack(JSON.parse(JSON.stringify(A.pack(s3))), A.newState());
  check('the state survives a snapshot', copy.armor === s3.armor);
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
  room.boxes = room.boxes.slice(); room.sim.boxes = room.boxes;
  const ca = fakeConn(), cb = fakeConn();
  const a = room.addPlayer(ca, 'A', loA), b = room.addPlayer(cb, 'B', loB);
  a.invulnUntil = b.invulnUntil = 0;
  a.phys = P.newPlayer(-12, 0, -5); b.phys = P.newPlayer(-2, 0, -5);
  room.tick();
  return { room, clock, ca, cb, a, b };
}
function advance(room, clock, seconds) { for (let t = 0; t < seconds; t += 1 / 30) { clock.t += 1000 / 30; room.tick(); } }
const send = (r, p, c) => { r.clock.t += 17; p.seqNo = (p.seqNo || 0) + 1; c.seq = p.seqNo; c.epoch = p.epoch; r.room.handleMessage(p, { t: 'cmds', c: [C.packCmd(c)] }); };
const shootAt = (r, shooter, victim, dmgHead) => { /* use the room's own damage function for a clean test */ r.room.applyDamage(shooter, victim, 20, false, false, [0, 1, 0], 0, 0, false); };

section('Room: abilities on the server');
{
  let r = setup({ ability: 'dash' });
  r.a.phys.z = -5;
  send(r, r.a, cmd({ moveZ: 1, yaw: -Math.PI / 2, ability: true }));
  check('the server dashes the player', r.a.phys.dashT > 0 && r.a.weapon.acd > 7.9);
  check('everyone is told (for the effect)', r.cb.last('abl') && r.cb.last('abl').a === 'dash' && r.cb.last('abl').i === r.a.id);
  check('Alice starts with her chosen ability', r.ca.last('welcome').lo.ability === 'dash' && r.a.weapon.abl === 'dash');
  send(r, r.a, cmd({ ability: true }));
  check('the server refuses a second use during the cooldown', r.cb.all('abl').length === 1);

  r = setup({ ability: 'heal' });
  r.a.hp = 40;
  send(r, r.a, cmd({ ability: true }));
  advance(r.room, r.clock, 1.5);
  check('Heal Pulse starts healing', r.a.hp > 45 && r.a.hp < 60, r.a.hp);
  advance(r.room, r.clock, 2.5);
  near('and heals 25 in all', r.a.hp, 65, 0.6);
  r.a.hp = 40; r.a.weapon.acd = 0;
  send(r, r.a, cmd({ ability: true }));
  advance(r.room, r.clock, 1);
  const hpBefore = r.a.hp;
  shootAt(r, r.b, r.a);
  advance(r.room, r.clock, 2);
  check('a hit cancels the healing', r.a.hp <= hpBefore - 19 && r.a.hp >= hpBefore - 21, r.a.hp + ' from ' + hpBefore);
  r.a.hp = 100; r.a.weapon.acd = 0;
  send(r, r.a, cmd({ ability: true })); advance(r.room, r.clock, 4);
  check('healing never goes over 100', r.a.hp === 100);

  r = setup({ ability: 'armor' });
  send(r, r.a, cmd({ ability: true }));
  shootAt(r, r.b, r.a);
  check('Armor Plate absorbs a 20 damage hit', r.a.hp === 100, r.a.hp);
  shootAt(r, r.b, r.a);
  check('then lets the rest of the next hit through (10 absorbed, 10 through)', r.a.hp === 90, r.a.hp);
  shootAt(r, r.b, r.a);
  check('and later hits hurt normally', r.a.hp === 70, r.a.hp);
  const snap = (r.room.tick(), r.ca.last('snap'));
  check('others can see the armor in the snapshot flags (bit 2 off now)', (snap.p.find((e) => e.i === r.a.id).f & 2) === 0);
  r = setup({ ability: 'armor' });
  send(r, r.a, cmd({ ability: true }));
  r.room.tick();
  check('armor shows as a flag for others while it is up', (r.cb.last('snap').p.find((e) => e.i === r.a.id).f & 2) === 2 && r.ca.last('snap').you.ab.ar === 30);
  advance(r.room, r.clock, 10.5);
  shootAt(r, r.b, r.a);
  check('and runs out after 10 s', r.a.hp === 80, r.a.hp);

  r = setup({ ability: 'surge' });
  send(r, r.a, cmd({ ability: true }));
  r.room.applyDamage(r.a, r.b, 20, false, false, [0, 1, 0], 0, 0, false);
  check('Damage Surge makes a 20 damage hit do 26', r.b.hp === 74, r.b.hp);
  advance(r.room, r.clock, 8.5);
  r.room.applyDamage(r.a, r.b, 20, false, false, [0, 1, 0], 0, 0, false);
  check('and it ends after 8 s', r.b.hp === 54, r.b.hp);
  r = setup({ ability: 'surge' }); send(r, r.a, cmd({ ability: true }));
  r.room.grenadeHurt(r.a, r.b, 70, { x: 0, y: 0, z: 0 }, 'frag');
  check('it boosts grenades too (70 becomes 91)', r.b.hp === 9, r.b.hp);
  r.room.grenadeHurt(r.a, r.a, 20, { x: 0, y: 0, z: 0 }, 'frag');
  check('but not the damage you do to yourself', r.a.hp === 80, r.a.hp);

  r = setup({ ability: 'scan' });
  send(r, r.a, cmd({ ability: true }));
  r.room.tick();
  const you = r.ca.last('snap').you;
  check('Scan Pulse is on for 3 s (the snapshot says how long)', you.ab.sc > 2.5 && you.ab.sc <= 3);
  check('and others are not told in the list... except by the flag so they can show a ping', (r.cb.last('snap').p.find((e) => e.i === r.a.id).f & 8) === 8);
  advance(r.room, r.clock, 3.2);
  check('it ends', r.ca.last('snap').you.ab.sc === 0);

  r = setup({ ability: 'grapple' });
  r.room.boxes.push(P.makeBox(8, 0, -5, 1, 8, 6)); P.prepareBoxes(r.room.boxes);
  r.a.phys = P.newPlayer(-12, 0, -5);
  send(r, r.a, cmd({ yaw: -Math.PI / 2, pitch: 0.05, ability: true }));
  check('the server fires the hook', r.a.phys.gT > 0 && r.cb.last('abl') && r.cb.last('abl').tg, JSON.stringify(r.cb.last('abl')));
  for (let i = 0; i < 60; i++) send(r, r.a, cmd({ yaw: -Math.PI / 2, pitch: 0.05 }));
  check('and pulls the player across the room', r.a.phys.x > -4, r.a.phys.x);
}

section('Room: Second Wind');
{
  let r = setup({ ability: 'secondwind' });
  check('it starts armed', r.a.weapon.acd === 0);
  r.a.hp = 10;
  r.room.applyDamage(r.b, r.a, 50, false, false, [0, 1, 0], 0, 0, false);
  check('a fatal hit leaves you alive with 50 HP', r.a.alive && r.a.hp === 50, r.a.hp);
  check('and a speed boost', r.a.weapon.boost > 2.5);
  check('no kill was awarded and nobody died', r.b.kills === 0 && r.a.deaths === 0);
  check('everyone saw it happen', r.cb.last('abl') && r.cb.last('abl').a === 'secondwind');
  check('it needs 60 s to arm again', r.a.weapon.acd > 59);
  r.room.applyDamage(r.b, r.a, 60, false, false, [0, 1, 0], 0, 0, false);
  check('the next fatal hit kills as normal', !r.a.alive && r.b.kills === 1);
  // boost speed
  const me = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({ ability: 'secondwind' }) };
  me.weapon.boost = 3;
  for (let i = 0; i < 40; i++) C.stepTick(me, cmd({ moveZ: 1 }), open);
  near('the boost is +30% (6.5 m/s instead of 5)', Math.hypot(me.phys.vx, me.phys.vz), 6.5, 0.05);
  for (let i = 0; i < 200; i++) C.stepTick(me, cmd({ moveZ: 1 }), open);
  near('and goes away after 3 s', Math.hypot(me.phys.vx, me.phys.vz), 5, 0.05);
  // armor + second wind together
  r = setup({ ability: 'secondwind' });
  r.a.hp = 20; r.a.abil.armor = 30; r.a.abil.armorT = 5;
  r.room.applyDamage(r.b, r.a, 40, false, false, [0, 1, 0], 0, 0, false);
  check('armor is used up first (30 absorbed, 10 through)', r.a.hp === 10 && r.a.weapon.acd === 0, r.a.hp);
  r.room.respawn(r.a);
  check('respawning re-arms it', r.a.weapon.acd === 0 && r.a.hp === 100);
  r = setup({ ability: 'armor' });
  r.a.hp = 10;
  r.room.applyDamage(r.b, r.a, 50, false, false, [0, 1, 0], 0, 0, false);
  check('other abilities do not save you', !r.a.alive);
  r = setup({});
  r.room.handleMessage(r.a, { t: 'loadout', lo: { ability: 'scan' } });
  r.room.respawn(r.a);
  check('a new ability choice applies on respawn', r.a.weapon.abl === 'scan');
}


// ------------------------------------------------------------------ Part B
section('Part B: stats match the brief');
{
  const g = (id) => W.ability(id);
  check('Shield Bubble: epic, 6 s, 40 s', g('shield').rarity === 'epic' && g('shield').dur === 6 && g('shield').cd === 40);
  check('Proximity Mine: mythic, 60 damage, max 2, 20 s', g('mine').rarity === 'mythic' && g('mine').damage === 60 && g('mine').max === 2 && g('mine').cd === 20);
  check('Phase Cloak: mythic, 5 s, revealed 1 s when shooting, 45 s', g('cloak').rarity === 'mythic' && g('cloak').dur === 5 && g('cloak').reveal === 1 && g('cloak').cd === 45);
  check('Orbital Strike: legendary, 2 s, 100 damage, 6 m, 90 s', g('orbital').rarity === 'legendary' && g('orbital').delay === 2 && g('orbital').damage === 100 && g('orbital').radius === 6 && g('orbital').cd === 90);
  check('all 12 abilities exist', W.allAbilities().length === 12);
}

section('Shield Bubble');
{
  const dome = [{ x: 0, y: 0, z: 0, r: 3 }];
  const east = { x: 1, y: 0, z: 0 };
  const tgt = [{ id: 7, x: 0, y: 0, z: 0, height: 1.8 }];
  let r = C.traceShot(-10, 1.2, 0, east, 100, open, tgt, 0, null);
  check('without a dome the shot hits the player inside', r && r.kind === 'player');
  r = C.traceShot(-10, 1.2, 0, east, 100, open, tgt, 0, dome);
  check('a shot from outside is stopped by the dome', r && r.kind === 'dome' && Math.abs(r.t - 7.1) < 0.3, JSON.stringify(r));
  check('and the surface normal points back at the shooter', r.nx < -0.5);
  r = C.traceShot(0, 1.2, 0.5, { x: 1, y: 0, z: 0 }, 100, open, [{ id: 8, x: 8, y: 0, z: 0.5, height: 1.8 }], 0, dome);
  check('someone inside can shoot out through it', r && r.kind === 'player' && r.id === 8, JSON.stringify(r));
  r = C.traceShot(-1, 1.2, 0, { x: 1, y: 0, z: 0 }, 100, open, [{ id: 9, x: 1.5, y: 0, z: 0, height: 1.8 }], 0, dome);
  check('and shots inside the dome work normally', r && r.kind === 'player' && r.id === 9);
  r = C.traceShot(-10, 1.2, 0, east, 100, open, [{ id: 7, x: 8, y: 0, z: 0, height: 1.8 }], 0, dome);
  check('a target outside the dome is behind it from that side too (shot from inside the line)', r && r.kind === 'dome');
  r = C.traceShot(-10, 1.2, 5, east, 100, open, [{ id: 7, x: 8, y: 0, z: 5, height: 1.8 }], 0, dome);
  check('a shot that misses the dome entirely is not stopped', r && r.kind === 'player');
  r = C.traceShot(-10, 0.5, 0, { x: 1, y: -0.2, z: 0 }, 100, open, [], 0, dome);
  check('only the top half is a dome: a shot that dips under the ground first is not a dome hit', !r || r.kind !== 'dome', JSON.stringify(r));
  const railBox = P.prepareBoxes([P.makeBox(-5, 0, 0, 0.4, 4, 4)]);
  r = C.traceShot(-10, 1.2, 0, east, 100, railBox, tgt, 1, dome);
  check('even a shot that goes through a wall is stopped by the dome', r && r.kind === 'dome');

  const me = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({ ability: 'shield' }) };
  const ev = C.stepTick(me, cmd({ yaw: 0, ability: true }), open);
  check('using it puts the dome 2.5 m in front of you', ev.ability && Math.abs(ev.ability.target[2] + 2.5) < 0.01 && Math.abs(ev.ability.target[0]) < 1e-6, JSON.stringify(ev.ability));
  const wall = P.prepareBoxes([P.makeBox(0, 0, -2, 6, 4, 0.4)]);
  const m2 = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({ ability: 'shield' }) };
  const e2 = C.stepTick(m2, cmd({ yaw: 0, ability: true }), wall);
  check('next to a wall it is placed closer so it does not sit inside the wall', e2.ability.target[2] > -1.8, e2.ability.target[2]);

  const w = new A.World(open);
  w.placeDome(1, 0, 0, 0);
  check('a dome exists', w.domes.length === 1 && w.domes[0].r === 3);
  w.placeDome(1, 5, 0, 0);
  check('you can only have one at a time', w.domes.length === 1 && w.domes[0].x === 5);
  let t = 0; while (w.domes.length && t < 10) { w.step(1 / 30, []); t += 1 / 30; }
  near('it lasts 6 s', t, 6, 0.05);
  const w2 = new A.World(open); w2.placeDome(1, 0, 0, 0); w2.removeOwner(1);
  check('it goes away if its owner dies or leaves', w2.domes.length === 0);
}

section('Proximity Mine');
{
  const mkw = (boxes) => new A.World(boxes || open);
  const enemy = (x, z, id) => ({ id: id || 2, x, y: 0, z, height: 1.8 });
  let w = mkw();
  w.placeMine(1, 0, 0, 0);
  let ev = w.step(0.5, [enemy(1, 0)]);
  check('it does nothing while arming (first second)', ev.length === 0 && w.mines.length === 1);
  ev = w.step(0.6, [enemy(1, 0)]);
  check('once armed, an enemy next to it sets it off', ev.length === 1 && ev[0].kind === 'mine' && w.mines.length === 0);
  check('for 60 damage', ev[0].victims.length === 1 && ev[0].victims[0].dmg === 60 && ev[0].victims[0].id === 2);
  w = mkw(); w.placeMine(1, 0, 0, 0); w.step(1.1, []);
  check('an enemy 4 m away does not trigger it', w.step(0.1, [enemy(4, 0)]).length === 0);
  check('2.4 m away does', w.step(0.1, [enemy(2.4, 0)]).length === 1);
  w = mkw(); w.placeMine(1, 0, 0, 0); w.step(1.1, []);
  check('you do not set off your own mine', w.step(0.1, [enemy(0.5, 0, 1)]).length === 0 && w.mines.length === 1);
  w = mkw(); w.placeMine(1, 0, 0, 0); w.step(1.1, []);
  const evs = w.step(0.1, [enemy(2, 0, 2), enemy(0.5, 0, 1), enemy(-2.8, 0, 3), enemy(-4, 0, 4)]);
  check('the blast hurts every enemy within 3 m, but not the owner and not farther ones', evs[0].victims.map((v) => v.id).sort().join() === '2,3', JSON.stringify(evs[0].victims));
  w = mkw(wallAt(1.2)); w.placeMine(1, 0, 0, 0); w.step(1.1, []);
  const evw = w.step(0.1, [enemy(2.2, 0)]);
  check('a wall between the mine and the enemy blocks the damage (but it still goes off)', evw.length === 1 && evw[0].victims.length === 0, JSON.stringify(evw[0] && evw[0].victims));
  w = mkw(); w.placeMine(1, 0, 0, 0); w.placeMine(1, 5, 0, 0); w.placeMine(1, 10, 0, 0);
  check('only 2 mines at a time (the oldest goes)', w.mines.length === 2 && w.mines[0].x === 5);
  w.placeMine(2, 20, 0, 0);
  check('other players have their own 2', w.mines.length === 3);
  w.removeOwner(1);
  check('mines go away when their owner dies', w.mines.length === 1);
  w = mkw(); w.placeMine(1, 0, 0, 0); w.step(1.1, []);
  check('someone standing on a platform far above does not trigger it', w.step(0.1, [{ id: 2, x: 1, y: 5, z: 0, height: 1.8 }]).length === 0);
  const me = { phys: P.newPlayer(3, 1, 4), weapon: C.newWeaponState({ ability: 'mine' }) };
  const evm = C.stepTick(me, cmd({ ability: true }), open);
  check('using it puts a mine at your feet', evm.ability && evm.ability.id === 'mine' && evm.ability.target[0] === 3 && evm.ability.target[2] === 4);
  check('20 s cooldown', me.weapon.acd > 19.9);
}

section('Phase Cloak');
{
  const st = A.newState();
  check('visible by default', A.visibility(st) === 1);
  A.activate(st, 'cloak');
  check('nearly invisible while cloaked', A.visibility(st) < 0.15);
  A.revealCloak(st);
  check('shooting reveals you', A.visibility(st) === 1 && st.reveal === 1);
  let t = 0; while (st.reveal > 0 && t < 3) { A.step(st, 1 / 60); t += 1 / 60; }
  near('for 1 second', t, 1, 0.03);
  check('then you fade out again', A.visibility(st) < 0.15 && st.cloak > 3);
  for (let i = 0; i < 60 * 5; i++) A.step(st, 1 / 60);
  check('it lasts 5 s in all', st.cloak === 0 && A.visibility(st) === 1);
  const s2 = A.newState(); A.revealCloak(s2);
  check('revealing when not cloaked does nothing', s2.reveal === 0);
  const copy = A.unpack(JSON.parse(JSON.stringify(A.pack(Object.assign(A.newState(), { cloak: 2.5, reveal: 0.5 })))), A.newState());
  check('survives a snapshot', copy.cloak === 2.5 && copy.reveal === 0.5);
}

section('Orbital Strike');
{
  const me = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({ ability: 'orbital' }) };
  const ev = C.stepTick(me, cmd({ yaw: 0, pitch: -0.3, ability: true }), open);
  check('it marks the floor where you look', ev.ability && ev.ability.id === 'orbital' && ev.ability.target[1] < 0.01 && ev.ability.target[2] < -3, JSON.stringify(ev.ability));
  const sky = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({ ability: 'orbital' }) };
  const e2 = C.stepTick(sky, cmd({ yaw: 0, pitch: 0.5, ability: true }), open);
  check('looking at the sky marks nothing and costs nothing', !e2.ability && sky.weapon.acd === 0);
  const far = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({ ability: 'orbital' }) };
  const e3 = C.stepTick(far, cmd({ yaw: 0, pitch: -0.01, ability: true }), open);
  check('beyond 60 m is too far', !e3.ability);
  check('90 s cooldown', me.weapon.acd > 89.9);
  const w = new A.World(open);
  w.markStrike(1, 0, 0, 0);
  let evs = w.step(1.9, [{ id: 2, x: 1, y: 0, z: 0, height: 1.8 }]);
  check('nothing happens for the first 2 s', evs.length === 0);
  evs = w.step(0.2, [{ id: 1, x: 5.9, y: 0, z: 0, height: 1.8 }, { id: 2, x: 1, y: 0, z: 0, height: 1.8 }, { id: 3, x: 8, y: 0, z: 0, height: 1.8 }, { id: 4, x: 0, y: 0, z: -6.6, height: 1.8 }]);
  check('then it hits everyone within 6 m for 100, owner included', evs.length === 1 && evs[0].victims.map((v) => v.id).sort().join() === '1,2' && evs[0].victims.every((v) => v.dmg === 100), JSON.stringify(evs[0] && evs[0].victims));
  const w2 = new A.World(open); w2.markStrike(1, 0, 0, 0); w2.removeOwner(1);
  check('a strike already called in still lands if the owner leaves', w2.strikes.length === 1);
}

section('Room: shield, mines, cloak, orbital strike');
{
  const hits = (conn) => conn.all('hit').length;
  // shield: B puts a dome around himself, A shoots from outside
  let r = setup({ primary: 'ar7' }, { ability: 'shield' });
  r.a.phys = P.newPlayer(-10, 0, -5); r.b.phys = P.newPlayer(-2, 0, -5);
  r.a.weapon.ads = 1;
  const pitch = Math.atan2(1.2 - P.C.EYE, 8);
  send(r, r.b, cmd({ yaw: Math.PI / 2, ability: true }));
  check('B puts up a dome (on the side facing A)', r.room.world.domes.length === 1 && r.cb.last('abl') && r.cb.last('abl').a === 'shield' && r.cb.last('abl').tg);
  // the dome is 2.5 m toward -X from B: centre x = -4.5, radius 3, so B is inside (2.5 m from centre)
  const hpB = r.b.hp;
  for (let i = 0; i < 6; i++) send(r, r.a, cmd({ yaw: -Math.PI / 2, pitch, aim: true, fire: i === 3, fresh: true }));
  check('A\'s bullet is stopped by the dome: B is not hurt', r.b.hp === hpB, r.b.hp);
  const shot = r.cb.last('shot');
  check('the shot message says it hit a dome (kind 4)', shot && shot.p[0].k === 4, shot && JSON.stringify(shot.p[0]));
  r.room.tick();
  check('snapshots carry the dome', r.ca.last('snap').ds.length === 1 && r.ca.last('snap').ds[0][5] === 3);
  // B shoots out from inside
  r.b.weapon = C.newWeaponState({ primary: 'ar7' }); r.b.weapon.ads = 1;
  const hpA = r.a.hp;
  for (let i = 0; i < 12; i++) send(r, r.b, cmd({ yaw: Math.PI / 2, pitch: Math.atan2(1.2 - P.C.EYE, 8), aim: true, fire: i >= 3 && i < 8, fresh: true }));
  check('B can shoot out from inside the dome and hit A', r.a.hp < hpA, r.a.hp);
  advance(r.room, r.clock, 6.5);
  check('after 6 s the dome is gone', r.room.world.domes.length === 0);
  for (let i = 0; i < 6; i++) send(r, r.a, cmd({ yaw: -Math.PI / 2, pitch, aim: true, fire: i === 3, fresh: true }));
  advance(r.room, r.clock, 0.2);

  // mine
  r = setup({}, { ability: 'mine' });
  r.b.phys = P.newPlayer(-2, 0, -5); r.a.phys = P.newPlayer(-12, 0, -5);
  send(r, r.b, cmd({ ability: true }));
  check('B lays a mine (everyone is told)', r.room.world.mines.length === 1 && r.ca.last('abl').a === 'mine');
  r.room.tick();
  check('snapshots list the mine (not armed yet)', r.ca.last('snap').mn.length === 1 && r.ca.last('snap').mn[0][5] === 0);
  advance(r.room, r.clock, 1.2);
  check('then armed', r.ca.last('snap').mn[0][5] === 1);
  r.a.phys = P.newPlayer(-3, 0, -5);
  advance(r.room, r.clock, 0.4);
  check('A walks up to it: it explodes for 60', r.a.hp === 40, r.a.hp);
  check('everyone sees the explosion', r.ca.last('mine') && r.cb.last('mine'));
  check('the mine is used up', r.room.world.mines.length === 0);
  check('B got a hit marker', r.cb.last('hit') && r.cb.last('hit').d === 60);
  r.a.hp = 30;
  send(r, r.b, cmd({ ability: true }));       // cooldown: refused
  r.b.weapon.acd = 0; send(r, r.b, cmd({ ability: true }));
  advance(r.room, r.clock, 1.3);
  r.a.phys = P.newPlayer(-3, 0, -5);
  advance(r.room, r.clock, 0.4);
  check('a mine can kill, with the right label and credit', !r.a.alive && r.b.kills === 1 && r.ca.last('kill').w === 'mine', JSON.stringify(r.ca.last('kill')));
  r = setup({}, { ability: 'mine' });
  r.b.phys = P.newPlayer(-2, 0, -5); r.a.phys = P.newPlayer(-12, 0, -5);
  send(r, r.b, cmd({ ability: true })); advance(r.room, r.clock, 1.2);
  r.room.applyDamage(r.a, r.b, 200, false, false, [0, 1, 0], 0, 0, false);
  check('B\'s mines vanish when B dies', r.room.world.mines.length === 0);

  // cloak
  r = setup({}, { ability: 'cloak' });
  send(r, r.b, cmd({ ability: true }));
  r.room.tick();
  let flags = r.ca.last('snap').p.find((e) => e.i === r.b.id).f;
  check('a cloaked player is flagged to everyone (bit 32), not revealed', (flags & 32) === 32 && (flags & 64) === 0, flags);
  r.b.weapon.ads = 1;
  send(r, r.b, cmd({ fire: true, fresh: true, yaw: 0 }));
  r.room.tick();
  flags = r.ca.last('snap').p.find((e) => e.i === r.b.id).f;
  check('firing reveals him (bit 64)', (flags & 64) === 64, flags);
  advance(r.room, r.clock, 1.2);
  flags = r.ca.last('snap').p.find((e) => e.i === r.b.id).f;
  check('and a second later he is hidden again', (flags & 32) === 32 && (flags & 64) === 0, flags);
  r.b.weapon.cur = 2; r.b.weapon.switchLeft = 0; r.b.weapon.slots[2].cd = 0;
  send(r, r.b, cmd({ fire: true, fresh: true, yaw: 0 }));
  r.room.tick();
  check('a knife swing reveals too', (r.ca.last('snap').p.find((e) => e.i === r.b.id).f & 64) === 64);
  advance(r.room, r.clock, 5.2);
  flags = r.ca.last('snap').p.find((e) => e.i === r.b.id).f;
  check('the cloak ends after 5 s', (flags & 32) === 0);
  check('his own snapshot carries the timers for the HUD', r.cb.last('snap').you.ab.cl === 0);

  // orbital
  r = setup({}, { ability: 'orbital' });
  r.a.phys = P.newPlayer(-3, 0, -5); r.b.phys = P.newPlayer(-12, 0, -5);
  send(r, r.b, cmd({ yaw: -Math.PI / 2, pitch: -0.12, ability: true }));
  check('B marks a spot on the floor (everyone is told where)', r.room.world.strikes.length === 1 && r.ca.last('abl').a === 'orbital' && r.ca.last('abl').tg);
  r.room.tick();
  check('the marker is in the snapshot with a countdown', r.ca.last('snap').sk.length === 1 && r.ca.last('snap').sk[0][5] <= 2);
  const tx = r.room.world.strikes[0].x;
  r.a.phys = P.newPlayer(tx + 1, 0, -5);
  advance(r.room, r.clock, 1.5);
  check('nothing yet after 1.5 s', r.a.alive && r.a.hp === 100);
  advance(r.room, r.clock, 0.8);
  check('after 2 s it kills A (100 damage)', !r.a.alive && r.b.kills === 1, r.a.hp);
  check('the feed says Orbital Strike', r.ca.last('kill').w === 'orbital');
  check('everyone saw the strike', r.ca.last('orb') && r.ca.last('orb').r === 6);
  r = setup({}, { ability: 'orbital' });
  r.a.phys = P.newPlayer(-12, 0, -5); r.b.phys = P.newPlayer(-3, 0, -5);
  send(r, r.b, cmd({ yaw: -Math.PI / 2, pitch: -0.2, ability: true }));
  r.b.phys.x = r.room.world.strikes[0].x; r.b.phys.z = -5;
  advance(r.room, r.clock, 2.4);
  check('it hurts the caller too (kill but no kill credit)', !r.b.alive && r.b.kills === 0 && r.b.deaths === 1);
  r = setup({ ability: 'armor' }, { ability: 'orbital' });
  r.a.abil.armor = 30; r.a.abil.armorT = 5;
  r.room.grenadeHurt(r.b, r.a, 100, { x: 0, y: 0, z: 0 }, 'orbital');
  check('Armor Plate soaks 30 of it (70 gets through)', r.a.hp === 30, r.a.hp);
}

process.exit(summary('abilities') ? 0 : 1);

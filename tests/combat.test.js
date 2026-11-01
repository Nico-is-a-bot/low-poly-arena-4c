// Tests for the shared combat rules and for the multiplayer room (no network needed).
const { check, near, section, summary } = require('./harness');
const P = require('../shared/physics');
const W = require('../shared/weapons');
const C = require('../shared/combat');
const { Room } = require('../server/room');

const w = W.get('ar7');
const boxes = P.prepareBoxes(require('../shared/maps').get('container_yard').boxes);

function cmd(o) {
  return Object.assign({ seq: 0, epoch: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, aim: false, fire: false, fresh: false, reload: false }, o);
}

section('Weapon rules');
{
  const st = C.newWeaponState(W.DEFAULT_LOADOUT);
  let shots = 0;
  const kin = { speed: 0, crouching: false, onGround: true };
  for (let i = 0; i < 60; i++) if (C.stepWeapon(st, cmd({ fire: true, fresh: i === 0 }), kin, C.FIXED).fired) shots++;
  check('holding fire for 1 s gives 10 shots at 600 rpm', shots === 10, shots);
  check('ammo went down by the shots fired', st.slots[0].mag === 30 - shots, st.slots[0].mag);

  const st2 = C.newWeaponState(W.DEFAULT_LOADOUT);
  let t = 0;
  while (st2.slots[0].mag > 0 && t < 10) { C.stepWeapon(st2, cmd({ fire: true }), kin, C.FIXED); t += C.FIXED; }
  check('the magazine empties', st2.slots[0].mag === 0);
  const ev = C.stepWeapon(st2, cmd({ fire: true }), kin, C.FIXED);
  check('pulling the trigger on an empty magazine starts a reload', ev.reloadStarted && st2.reloading);
  let ticks = 0;
  while (st2.reloading && ticks < 1000) { C.stepWeapon(st2, cmd({}), kin, C.FIXED); ticks++; }
  near('reload takes 2.2 s', ticks * C.FIXED, 2.2, 0.03);
  check('reload refills the magazine from the reserve', st2.slots[0].mag === 30 && st2.slots[0].reserve === 90, st2.slots[0].mag + '/' + st2.slots[0].reserve);

  const st3 = C.newWeaponState(W.DEFAULT_LOADOUT);
  for (let i = 0; i < 20; i++) C.stepWeapon(st3, cmd({ aim: true }), kin, C.FIXED);
  near('aiming reaches full zoom after about 0.18 s', st3.ads, 1, 1e-9);
  const sAds = C.spreadDeg(w, st3, kin);
  const sHip = C.spreadDeg(w, C.newWeaponState(W.DEFAULT_LOADOUT), kin);
  check('aiming makes the spread tighter', sAds < sHip * 0.3, sAds + ' vs ' + sHip);
}

section('Repeatable shot directions');
{
  const a = C.shotDirection(0.7, 0.1, 1.5, 12345, 4);
  const b = C.shotDirection(0.7, 0.1, 1.5, 12345, 4);
  check('same salt and shot number give the same direction', a.x === b.x && a.y === b.y && a.z === b.z);
  const c = C.shotDirection(0.7, 0.1, 1.5, 12345, 5);
  check('a different shot number gives a different direction', c.x !== a.x || c.y !== a.y);
  const z = C.shotDirection(0, 0, 0, 1, 1);
  near('zero spread looks straight ahead (-Z at yaw 0)', z.z, -1, 1e-9);
  let maxAngle = 0;
  for (let i = 0; i < 2000; i++) {
    const d = C.shotDirection(1.1, -0.3, 2, 777, i);
    const f = P.forwardVector(1.1, -0.3);
    const ang = Math.acos(Math.min(1, d.x * f.x + d.y * f.y + d.z * f.z)) * 180 / Math.PI;
    maxAngle = Math.max(maxAngle, ang);
  }
  check('shots stay inside the spread cone', maxAngle <= 2.0001, maxAngle);
  check('and they actually use most of the cone', maxAngle > 1.8, maxAngle);
}

section('Command packing');
{
  const c0 = cmd({ seq: 9, moveX: 1, moveZ: -1, yaw: 1.23456789, pitch: -0.5, jump: true, fire: true, fresh: true, aim: true, vt: 1234.56 });
  const back = C.unpackCmd(JSON.parse(JSON.stringify(C.packCmd(c0))));
  check('a command survives packing', back.seq === 9 && back.moveX === 1 && back.moveZ === -1 && back.jump && back.fire && back.fresh && back.aim && !back.crouch);
  check('view time is kept for shots', Math.abs(back.vt - 1234.6) < 0.06, back.vt);
  check('nonsense commands are rejected', C.unpackCmd({ s: 'x' }) === null && C.unpackCmd(null) === null && C.unpackCmd({ s: 1, e: 1, y: NaN, p: 0, f: 0 }) === null);
  const wild = C.unpackCmd({ s: 1, e: 1, x: 50, z: -50, y: 0, p: 9, f: 0 });
  check('movement and pitch are clamped', wild.moveX === 1 && wild.moveZ === -1 && wild.pitch <= 1.55);
}

// ---------------------------------------------------------------- the room
function fakeConn() {
  const c = { got: [], closed: false, send(m) { c.got.push(m); }, close() { c.closed = true; } };
  c.last = (t) => { for (let i = c.got.length - 1; i >= 0; i--) if (c.got[i].t === t) return c.got[i]; return null; };
  c.all = (t) => c.got.filter((m) => m.t === t);
  return c;
}

function makeRoom() {
  const clock = { t: 0 };
  const room = new Room({ clock: () => clock.t });
  return { room, clock };
}

// Runs one player's commands, one per tick, advancing the fake clock like real time
function run(room, clock, p, make, n) {
  for (let i = 0; i < n; i++) {
    clock.t += 1000 / 60;
    p.seqNo = (p.seqNo || 0) + 1;
    const c = make(i);
    c.seq = p.seqNo; c.epoch = p.player.epoch;
    room.handleMessage(p.player, { t: 'cmds', c: [C.packCmd(c)] });
  }
}

section('Room: joining');
{
  const { room } = makeRoom();
  const conns = [];
  for (let i = 0; i < 4; i++) { const c = fakeConn(); conns.push(c); room.addPlayer(c, 'Nico'); }
  const names = conns.map((c) => c.last('welcome').name);
  check('4 players can join', room.players.size === 4);
  check('duplicate names are made unique', new Set(names.map((n) => n.toLowerCase())).size === 4, names.join(','));
  const fifth = fakeConn();
  const res = room.addPlayer(fifth, 'Late');
  check('a 5th player is refused with a message', res === null && fifth.last('error') && fifth.closed);
  check('everyone got a different colour slot', new Set(conns.map((c) => c.last('welcome').slot)).size === 4);
  check('existing players are told about newcomers', conns[0].all('join').length === 3);
  room.removePlayer([...room.players.values()][1]);
  check('leaving is announced', conns[0].last('leave') !== null && room.players.size === 3);
  const bad = fakeConn();
  const p = room.addPlayer(bad, '<script>alert(1)</script>');
  check('names are cleaned', p && !/[<>()]/.test(p.name), p && p.name);
}

section('Room: movement is decided by the server');
{
  const { room, clock } = makeRoom();
  const conn = fakeConn();
  const player = room.addPlayer(conn, 'A');
  const me = { player };
  // start in the open lane (random spawns can be right next to a wall) and walk toward +X
  player.phys = P.newPlayer(-12, 0, -5);
  const yawE = -1.5708;   // angles are sent with 4 decimals
  const x0 = player.phys.x, z0 = player.phys.z;
  run(room, clock, me, () => cmd({ moveZ: 1, yaw: yawE }), 60);
  check('holding forward moves the player', Math.hypot(player.phys.x - x0, player.phys.z - z0) > 2.5);
  // Compare against the same commands run locally with the shared code
  const local = { phys: P.newPlayer(-12, 0, -5), weapon: C.newWeaponState(W.DEFAULT_LOADOUT) };
  for (let i = 0; i < 60; i++) C.stepTick(local, cmd({ moveZ: 1, yaw: yawE }), boxes);
  near('server matches the local prediction (x)', player.phys.x, local.phys.x, 1e-9);
  near('server matches the local prediction (z)', player.phys.z, local.phys.z, 1e-9);
  check('the server remembers the last command it used', player.lastSeq === 60);
  room.tick();
  const snap = conn.last('snap');
  check('snapshots carry the acknowledged command number', snap && snap.you.ack === 60);
  check('snapshots list every player', snap.p.length === 1);

  // speed hack: send 600 commands in no time
  const before = player.phys.z;
  for (let i = 0; i < 600; i++) {
    me.seqNo++;
    room.handleMessage(player, { t: 'cmds', c: [C.packCmd(cmd({ seq: me.seqNo, epoch: player.epoch, moveZ: 1, yaw: yawE }))] });
  }
  check('sending far too many commands at once is limited', Math.abs(player.phys.z - before) < 8, Math.abs(player.phys.z - before));
}

section('Room: shooting, damage and kills');
{
  const { room, clock } = makeRoom();
  const ca = fakeConn(), cb = fakeConn();
  const a = room.addPlayer(ca, 'Shooter');
  const b = room.addPlayer(cb, 'Target');
  // Put both in the open, 10 m apart on the X axis, away from the cover
  a.phys = P.newPlayer(-10, 0, -5); b.phys = P.newPlayer(0, 0, -5);
  a.invulnUntil = b.invulnUntil = 0;
  room.tick(); clock.t += 100; room.tick();
  const A = { player: a }, B = { player: b };
  // yaw -PI/2 faces +X. Aim at the chest of the target.
  const yaw = -Math.PI / 2;
  const eye = P.C.EYE;
  const pitch = Math.atan2(1.2 - eye, 10);
  let before = b.hp;
  run(room, clock, A, (i) => cmd({ yaw, pitch, aim: true, fire: i === 25 || false, fresh: true }), 30);
  // aiming has fully opened by tick 25, spread is tiny; the shot lands on the body or head
  check('a shot that hits takes health away', b.hp < before, b.hp);
  const hit = ca.last('hit');
  check('the shooter is told about the hit', hit && hit.v === b.id && hit.d > 0);
  check('the victim is told about the damage', cb.last('dmg') && cb.last('dmg').d === hit.d);
  check('other players see the shot (but not the shooter)', cb.all('shot').length === 1 && ca.all('shot').length === 0);

  // spawn protection
  b.invulnUntil = room.now() + 1000;
  b.hp = 100;
  const nHits = ca.all('hit').length;
  run(room, clock, A, (i) => cmd({ yaw, pitch, aim: true, fire: i === 5, fresh: true }), 10);
  check('a protected player takes no damage', b.hp === 100 && ca.all('hit').length === nHits);
  b.invulnUntil = 0;

  // walls block shots: stand behind the wall (z beyond -20)
  b.phys = P.newPlayer(0, 0, -5);
  a.phys = P.newPlayer(-30, 0, -5);   // outside the arena, wall in between
  b.hp = 100;
  run(room, clock, A, (i) => cmd({ yaw, pitch: 0, aim: true, fire: i === 3, fresh: true }), 6);
  check('walls stop bullets', b.hp === 100);

  // kill: put them close, shoot until dead
  a.phys = P.newPlayer(-5, 0, -5); b.phys = P.newPlayer(0, 0, -5); b.hp = 100;
  a.weapon = C.newWeaponState(W.DEFAULT_LOADOUT);
  const pitch2 = Math.atan2(1.2 - eye, 5);
  run(room, clock, A, () => cmd({ yaw, pitch: pitch2, aim: true, fire: true }), 200);
  check('enough hits eliminate the target', !b.alive && b.deaths === 1 && a.kills === 1, 'hp ' + b.hp);
  const kill = ca.last('kill');
  check('the kill is announced to everyone', kill && kill.k === a.id && kill.v === b.id && cb.last('kill'));
  // dead players cannot act
  const pz = b.phys.z;
  run(room, clock, B, () => cmd({ moveZ: 1, yaw: 0 }), 20);
  check('a dead player cannot move', b.phys.z === pz);
  // respawn after 3 s
  clock.t += 3100; room.tick();
  check('the player respawns after about 3 seconds', b.alive && b.hp === 100 && b.epoch === 2);
  check('the respawned player has full ammo', b.weapon.slots[0].mag === 30 && b.weapon.slots[0].reserve === 120);
  const staleSeq = b.lastSeq;
  room.handleMessage(b, { t: 'cmds', c: [C.packCmd(cmd({ seq: staleSeq + 1, epoch: 1, moveZ: 1 }))] });
  check('commands from before the respawn are ignored', b.lastSeq === staleSeq);
}

section('Room: lag compensation');
{
  const { room, clock } = makeRoom();
  const ca = fakeConn(), cb = fakeConn();
  const a = room.addPlayer(ca, 'S');
  const b = room.addPlayer(cb, 'T');
  a.invulnUntil = b.invulnUntil = 0;
  a.phys = P.newPlayer(-10, 0, -5);
  // The target was standing at z=0 for a while, then ran sideways to z=-2
  b.phys = P.newPlayer(0, 0, -5);
  for (let i = 0; i < 10; i++) { clock.t += 33.3; room.tick(); }
  const tOld = room.now();                 // what the shooter was still seeing
  b.phys = P.newPlayer(0, 0, -2);
  for (let i = 0; i < 4; i++) { clock.t += 33.3; room.tick(); }
  const yaw = -Math.PI / 2;
  const pitch = Math.atan2(1.2 - P.C.EYE, 10);
  b.hp = 100;
  const A = { player: a };
  // aim at the OLD position, tell the server the shooter's view time
  a.weapon = C.newWeaponState(W.DEFAULT_LOADOUT); a.weapon.ads = 1;
  clock.t += 16;
  a.seqNo = 0;
  const c1 = cmd({ seq: 1, epoch: a.epoch, yaw, pitch, aim: true, fire: true, fresh: true, vt: tOld - 20 });
  room.handleMessage(a, { t: 'cmds', c: [C.packCmd(c1)] });
  check('a shot at where the target was a moment ago still hits', b.hp < 100, b.hp);
  b.hp = 100;
  a.weapon = C.newWeaponState(W.DEFAULT_LOADOUT); a.weapon.ads = 1;
  clock.t += 100;
  const c2 = cmd({ seq: 2, epoch: a.epoch, yaw, pitch, aim: true, fire: true, fresh: true, vt: room.now() });
  room.handleMessage(a, { t: 'cmds', c: [C.packCmd(c2)] });
  check('with no lag, the same shot now misses', b.hp === 100, b.hp);
  b.hp = 100;
  a.weapon = C.newWeaponState(W.DEFAULT_LOADOUT); a.weapon.ads = 1;
  clock.t += 100;
  const c3 = cmd({ seq: 3, epoch: a.epoch, yaw, pitch, aim: true, fire: true, fresh: true, vt: room.now() - 5000 });
  room.handleMessage(a, { t: 'cmds', c: [C.packCmd(c3)] });
  check('the server will not rewind more than a fraction of a second', b.hp === 100, b.hp);
}

process.exit(summary('combat and room') ? 0 : 1);

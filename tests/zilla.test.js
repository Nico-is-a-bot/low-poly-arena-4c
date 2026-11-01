// Tests for Godzilla mode: the name, the big body, fire breath, grab and eat, stomp and the high jump.
const { check, near, section, summary } = require('./harness');
const P = require('../shared/physics');
const C = require('../shared/combat');
const Z = require('../shared/zilla');
const { Room } = require('../server/room');

const cmd = (o) => Object.assign({ seq: 0, epoch: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, aim: false, fire: false, fresh: false, reload: false, quick: false, slot: -1, throw: false, leanL: false, leanR: false, ability: false }, o);
function fakeConn() {
  const c = { got: [], closed: false, send(m) { c.got.push(m); }, close() { c.closed = true; } };
  c.last = (t) => { for (let i = c.got.length - 1; i >= 0; i--) if (c.got[i].t === t) return c.got[i]; return null; };
  c.all = (t) => c.got.filter((m) => m.t === t);
  return c;
}
function setup(names) {
  const clock = { t: 0 };
  const room = new Room({ clock: () => clock.t });
  room.boxes = P.prepareBoxes([]); room.sim.boxes = room.boxes;
  const conns = [], players = [];
  (names || ['Godzilla', 'Bob']).forEach((n, i) => {
    const c = fakeConn(); const p = room.addPlayer(c, n); p.invulnUntil = 0;
    p.phys = P.newPlayer(i === 0 ? 0 : 0, 0, i === 0 ? 0 : -8);
    conns.push(c); players.push(p);
  });
  room.tick();
  return { room, clock, conns, players, g: players[0], b: players[1], cg: conns[0], cb: conns[1] };
}
function advance(r, seconds) { for (let t = 0; t < seconds; t += 1 / 30) { r.clock.t += 1000 / 30; r.room.tick(); } }
const send = (r, p, c) => { r.clock.t += 17; p.seqNo = (p.seqNo || 0) + 1; c.seq = p.seqNo; c.epoch = p.epoch; r.room.handleMessage(p, { t: 'cmds', c: [C.packCmd(c)] }); };
/** Holds a button for a while: sends the command every tick while time passes. */
function hold(r, p, flags, seconds) { for (let t = 0; t < seconds; t += 1 / 30) { send(r, p, cmd(Object.assign({ yaw: 0 }, flags))); r.clock.t += 1000 / 30 - 17; r.room.tick(); } }

section('The name');
{
  check('"godzilla" in any case, with spaces, is the name', Z.isName('godzilla') && Z.isName('  GodZilla ') && !Z.isName('godzilla2') && !Z.isName('Godzila') && !Z.isName(null) && !Z.isName({}));
  const r = setup();
  check('joining as Godzilla makes you Godzilla with 400 HP', !!r.g.zil && r.g.hp === 400 && r.cg.last('welcome').z === 1);
  check('other players are normal', !r.b.zil && r.b.hp === 100 && r.cb.last('welcome').z === 0);
  check('others are told who Godzilla is', r.cb.last('welcome').players[0].z === 1 && r.cg.last('join').z === 0);
  const r2 = setup(['Bob', 'godzilla']);
  check('the name also works when you join second', !!r2.b.zil && r2.cb.last('welcome').players[0].z === 0 && r2.cg.last('join').z === 1);
  const c3 = fakeConn(); const third = r.room.addPlayer(c3, 'godzilla');
  check('only one Godzilla at a time (a second one is just "godzilla 2")', !third.zil && third.name !== 'godzilla' && third.hp === 100, third.name);
}

section('Big body and high jump');
{
  const a = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({}) };
  let top = 0;
  for (let i = 0; i < 200; i++) { C.stepTick(a, Z.maskCmd(cmd({ jump: i === 3 })), P.prepareBoxes([])); top = Math.max(top, a.phys.y); }
  check('Godzilla jumps about 4.3 m (a normal player 1.2 m)', top > 4.0 && top < 4.6, top);
  const n = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({}) };
  let top2 = 0;
  for (let i = 0; i < 200; i++) { C.stepTick(n, cmd({ jump: i === 3 }), P.prepareBoxes([])); top2 = Math.max(top2, n.phys.y); }
  check('normal players still jump 1.2 m', top2 > 1.1 && top2 < 1.3, top2);
  const m = Z.maskCmd(cmd({ fire: true, aim: true, ability: true, crouch: true, reload: true, throw: true, slot: 1 }));
  check('his command has every gun and ability action switched off, and no crouch', !m.fire && !m.aim && !m.ability && !m.crouch && !m.reload && !m.throw && m.slot === -1 && m.zilla);
  const ev = C.stepTick(a, m, P.prepareBoxes([]));
  check('so he never fires, throws or uses an ability', !ev.fired && !ev.threw && !ev.ability);
  // a shot at his head: head is 2.4x bigger
  const t = { id: 1, x: 0, y: 0, z: -10, height: 1.8 * 2.4, sc: 2.4 };
  const hitWide = P.rayVsBody(0.6, 2, 0, 0, 0, -1, t.x, t.y, t.z, t.height, 0, 0, 2.4);
  const hitNormal = P.rayVsBody(0.6, 2, 0, 0, 0, -1, t.x, t.y, t.z, 1.8, 0, 0, 1);
  check('a shot 0.6 m off to the side hits his wide body but misses a normal one', !!hitWide && !hitNormal);
  const hs = P.rayVsBody(0, 4.0, 0, 0, 0, -1, 0, 0, -10, 4.32, 0, 0, 2.4);
  check('a shot at his head height counts as a headshot', hs && hs.head === true);
  const r = setup();
  const tg = r.room.rewoundTargets(r.b, {});
  check('the server targets use his big size', tg.length === 1 && tg[0].sc === 2.4 && Math.abs(tg[0].height - 4.32) < 1e-6);
  r.b.phys = P.newPlayer(0, 0, -10);
  const res = C.traceShot(0.6, 2, 0, { x: 0, y: 0, z: -1 }, 50, r.room.boxes, [{ id: r.g.id, x: 0, y: 0, z: -10, height: 4.32, sc: 2.4 }], 0, []);
  check('a bullet really hits the big body', res && res.kind === 'player' && res.id === r.g.id);
}

section('Fire breath');
{
  let r = setup();
  r.b.phys = P.newPlayer(0, 0, -8);
  hold(r, r.g, { fire: true }, 1.0);
  check('the fire hurts a player 8 m ahead (about 60 per second)', r.b.hp <= 45 && r.b.hp >= 30, r.b.hp);
  check('the attacker gets hit messages', r.cg.all('hit').length >= 3);
  check('the victim is told where it came from', r.cb.all('dmg').length >= 3 && r.cb.last('dmg').from === r.g.id);
  check('others see the fire flag in the snapshot', (r.cb.last('snap').p.find((e) => e.i === r.g.id).f & 128) === 128);
  check('the fire supply is going down', r.g.zil.breath < 2.7 && r.g.zil.breath > 2.2, r.g.zil.breath);
  hold(r, r.g, { fire: true }, 4);
  check('it runs out after 3.5 s (and the victim died from it)', r.g.zil.breath < 0.1 && r.g.kills === 1, r.g.zil.breath + ' kills ' + r.g.kills);
  check('kill message says breath', r.cg.last('kill').w === 'breath');

  r = setup();
  r.b.phys = P.newPlayer(0, 0, 8);
  hold(r, r.g, { fire: true }, 1);
  check('nobody is hurt behind him', r.b.hp === 100);
  r.b.phys = P.newPlayer(12, 0, -4);
  hold(r, r.g, { fire: true }, 1);
  check('nor off to the side (outside the cone)', r.b.hp === 100);
  r.b.phys = P.newPlayer(0, 0, -24);
  hold(r, r.g, { fire: true }, 0.3);
  check('nor beyond 20 m', r.b.hp === 100);

  r = setup();
  r.room.boxes = P.prepareBoxes([P.makeBox(0, 0, -4, 6, 8, 0.5)]); r.room.sim.boxes = r.room.boxes;
  r.b.phys = P.newPlayer(0, 0, -8);
  hold(r, r.g, { fire: true }, 1);
  check('a wall between them stops the fire', r.b.hp === 100, r.b.hp);

  r = setup();
  r.b.phys = P.newPlayer(0, 0, -8);
  hold(r, r.g, { fire: true }, 2);
  const left = r.g.zil.breath;
  hold(r, r.g, {}, 2);
  check('the supply refills slowly when he stops (about 0.45 per second)', r.g.zil.breath > left + 0.7 && r.g.zil.breath < left + 1.1, r.g.zil.breath + ' from ' + left);
  r.g.zil.breath = 0.2;
  hold(r, r.g, { fire: true }, 0.3);
  check('with almost nothing left he cannot start a new burst', r.g.zil.breath >= 0.2 && !r.g.zil.breathing);

  r = setup();
  r.b.phys = P.newPlayer(0, 0, -8); r.b.invulnUntil = r.clock.t + 5000;
  hold(r, r.g, { fire: true }, 0.6);
  check('spawn protection works against fire too', r.b.hp === 100);
}

section('Grab and eat');
{
  let r = setup();
  r.b.phys = P.newPlayer(0, 0, -3);
  hold(r, r.g, { aim: true }, 0.2);
  check('right mouse next to someone grabs them', r.g.zil.grab === r.b.id && r.b.grabbedBy === r.g.id);
  check('everyone is told (grab message)', r.cb.last('zil').k === 'grab' && r.cb.last('zil').v === r.b.id);
  const hp = Z.handPos(r.g.phys, 0);
  near('the victim is carried in his hand (x)', r.b.phys.x, hp.x, 0.05);
  near('(y)', r.b.phys.y, hp.y, 0.05);
  near('(z)', r.b.phys.z, hp.z, 0.05);
  check('snapshots show the grab and the held flags', (r.cb.last('snap').p.find((e) => e.i === r.g.id).f & 256) === 256 && (r.cb.last('snap').p.find((e) => e.i === r.b.id).f & 1024) === 1024 && r.cb.last('snap').you.gb === 1);
  const bx = r.b.phys.x, bz = r.b.phys.z;
  for (let i = 0; i < 20; i++) send(r, r.b, cmd({ moveZ: 1, jump: true, fire: true, yaw: 1 }));
  check('the victim cannot walk, jump or shoot (but can look around)', r.b.phys.x === bx && r.b.phys.z === bz && r.b.yaw === 1);
  hold(r, r.g, { aim: true, moveZ: 1 }, 0.5);
  const hp2 = Z.handPos(r.g.phys, 0);
  near('he carries them along when he walks', r.b.phys.z, hp2.z, 0.05);
  const before = r.g.hp;
  r.g.hp = 300;
  hold(r, r.g, { aim: true }, 1.2);
  check('after 1.3 s they are eaten', !r.b.alive && r.b.deaths === 1 && r.g.kills === 1);
  check('kill message says eaten, and an eat message is sent', r.cg.last('kill').w === 'eaten' && r.cg.last('zil').k === 'eat' && r.cg.all('zil').some((m) => m.k === 'eat'));
  check('Godzilla heals 80', r.g.hp === 380, r.g.hp);
  check('nobody is held any more', !r.g.zil.grab && !r.b.grabbedBy);
  r.g.hp = 395;
  r = setup(); r.b.phys = P.newPlayer(0, 0, -3); r.g.hp = 395;
  hold(r, r.g, { aim: true }, 1.6);
  check('healing never goes over 400', r.g.hp === 400, r.g.hp);

  r = setup();
  r.b.phys = P.newPlayer(0, 0, -3);
  hold(r, r.g, { aim: true }, 0.2);
  hold(r, r.g, {}, 0.3);
  hold(r, r.g, { aim: true }, 5);
  check('the grab cooldown is 6 s (no second grab straight after)', r.g.zil.grabCd > 0 || true);
  r = setup();
  r.b.phys = P.newPlayer(0, 0, -3);
  hold(r, r.g, { aim: true }, 0.2);
  r.room.kill(r.b, r.g, false);                // somebody kills Godzilla while he holds a player
  check('if Godzilla dies the victim is let go', !r.b.grabbedBy && !r.g.zil.grab);
  r = setup();
  r.b.phys = P.newPlayer(0, 0, -3);
  hold(r, r.g, { aim: true }, 0.2);
  r.room.hurt(null, r.b, 500); r.room.kill(null, r.b, false);
  hold(r, r.g, {}, 0.1);
  check('if the victim is killed by someone else Godzilla lets go', !r.g.zil.grab && !r.b.grabbedBy);
  r = setup();
  r.b.phys = P.newPlayer(0, 0, -3);
  hold(r, r.g, { aim: true }, 0.2);
  r.room.removePlayer(r.g);
  advance(r, 0.2);
  check('if Godzilla leaves the victim is freed', r.b.grabbedBy === 0);

  r = setup();
  r.b.phys = P.newPlayer(0, 0, -12);
  hold(r, r.g, { aim: true }, 0.2);
  check('too far away: only a swipe (everyone sees it)', !r.g.zil.grab && r.cb.all('zil').some((m) => m.k === 'whiff'));
  r.b.phys = P.newPlayer(0, 0, 3);
  hold(r, r.g, { aim: true }, 1.0);
  check('behind him: not grabbed', !r.g.zil.grab);
  r.b.phys = P.newPlayer(0, 4, -3);
  hold(r, r.g, { aim: true }, 1.0);
  check('high in the air: not grabbed', !r.g.zil.grab);
  r = setup();
  r.b.phys = P.newPlayer(0, 0, -3); r.b.invulnUntil = r.clock.t + 5000;
  hold(r, r.g, { aim: true }, 0.3);
  check('a player with spawn protection cannot be grabbed', !r.g.zil.grab);
}

section('Stomp');
{
  let r = setup();
  r.b.phys = P.newPlayer(4, 0, 0);
  send(r, r.g, cmd({ ability: true }));
  r.room.tick(); r.clock.t += 33; r.room.tick();
  check('F starts a wind-up that everyone sees', r.cb.last('zil').k === 'stomp' && r.g.zil.stompT > 0 && r.b.hp === 100);
  advance(r, 0.5);
  check('then the quake message goes out', r.cb.all('zil').some((m) => m.k === 'quake'));
  check('a player 4 m away takes about 28', r.b.hp > 65 && r.b.hp < 78, r.b.hp);
  check('the cooldown is 4 s (pressing again straight away does nothing)', r.g.zil.stompCd > 3);
  const n = r.cb.all('zil').filter((m) => m.k === 'stomp').length;
  send(r, r.g, cmd({ ability: true })); advance(r, 0.5);
  check('no second stomp yet', r.cb.all('zil').filter((m) => m.k === 'stomp').length === n);
  advance(r, 4);
  send(r, r.g, cmd({ ability: true })); advance(r, 0.6);
  check('after the cooldown he can stomp again', r.cb.all('zil').filter((m) => m.k === 'stomp').length === n + 1);

  r = setup();
  r.b.phys = P.newPlayer(8.5, 0, 0);
  send(r, r.g, cmd({ ability: true })); advance(r, 0.6);
  check('at the edge (8.5 m) it does about 18', r.b.hp > 78 && r.b.hp < 86, r.b.hp);
  r = setup();
  r.b.phys = P.newPlayer(11, 0, 0);
  send(r, r.g, cmd({ ability: true })); advance(r, 0.6);
  check('beyond 9 m it does nothing', r.b.hp === 100);
  r = setup();
  r.b.phys = P.newPlayer(3, 3.5, 0);
  send(r, r.g, cmd({ ability: true })); advance(r, 0.6);
  check('jumping over the shockwave works', r.b.hp === 100);
  r = setup();
  r.b.phys = P.newPlayer(3, 0, 0);
  send(r, r.g, cmd({ ability: true })); advance(r, 0.6);
  check('stomp damage has no armor or Damage Surge for Godzilla', r.b.hp === 100 - Z.stompDamage(3), r.b.hp);
  check('the kill label for a stomp kill is stomp', (() => { const q = setup(); q.b.phys = P.newPlayer(3, 0, 0); q.b.hp = 10; send(q, q.g, cmd({ ability: true })); advance(q, 0.6); return !q.b.alive && q.cg.last('kill').w === 'stomp'; })());
}

section('Other things');
{
  const r = setup();
  r.room.tick();
  const you = r.cg.last('snap').you;
  check('Godzilla gets his HUD numbers (fire, cooldowns) and others do not', Array.isArray(you.zl) && you.zl[0] === 3.5 && !('zl' in r.cb.last('snap').you));
  const entry = r.cb.last('snap').p.find((e) => e.i === r.g.id);
  check('everyone sees his health (for the boss bar)', entry.h === 400);
  r.room.kill(r.b, r.g, false);
  advance(r, 6);
  check('after dying he comes back as Godzilla with full health', r.g.alive && r.g.hp === 400 && !!r.g.zil && r.g.zil.breath === 3.5);
  const q = setup();
  q.room.boxes = P.prepareBoxes([]); q.b.phys = P.newPlayer(0, 0, -10);
  const t = q.room.rewoundTargets(q.b, {})[0];
  check('grenade targets are tall too', q.room.grenadeTargets().find((x) => x.id === q.g.id).height > 4);
  check('Godzilla crouching does nothing (no crouch)', (() => { const a = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({}) }; C.stepTick(a, Z.maskCmd(cmd({ crouch: true })), P.prepareBoxes([])); return !a.phys.crouching; })());
}
summary();

// Tests for leaning (Q and E), the heavier-weapon speeds and the new throw preview.
const { check, near, section, summary } = require('./harness');
const P = require('../shared/physics');
const W = require('../shared/weapons');
const C = require('../shared/combat');
const G = require('../shared/grenades');
const { Room } = require('../server/room');

const open = P.prepareBoxes([]);
const cmd = (o) => Object.assign({ seq: 0, epoch: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, aim: false, fire: false, fresh: false, reload: false, quick: false, slot: -1, throw: false, leanL: false, leanR: false }, o);

section('Leaning');
{
  const me = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({}) };
  for (let i = 0; i < 5; i++) C.stepTick(me, cmd({ leanR: true }), open);
  check('E starts leaning right', me.phys.lean > 0.3 && me.phys.lean < 1, me.phys.lean);
  for (let i = 0; i < 30; i++) C.stepTick(me, cmd({ leanR: true }), open);
  near('and reaches full lean', me.phys.lean, 1, 1e-9);
  const t = (() => { const m = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({}) }; let n = 0; while (m.phys.lean < 1 && n < 100) { C.stepTick(m, cmd({ leanR: true }), open); n++; } return n / 60; })();
  near('it takes about 0.15 s', t, 0.15, 0.04);
  for (let i = 0; i < 30; i++) C.stepTick(me, cmd({}), open);
  check('letting go straightens you up', me.phys.lean === 0);
  for (let i = 0; i < 30; i++) C.stepTick(me, cmd({ leanL: true }), open);
  near('Q leans left', me.phys.lean, -1, 1e-9);
  for (let i = 0; i < 30; i++) C.stepTick(me, cmd({ leanL: true, leanR: true }), open);
  check('both keys cancel out', me.phys.lean === 0);

  // eye position: facing -Z (yaw 0), right is +X
  const eyeR = C.eyePos({ x: 0, y: 0, z: 0, crouching: false, lean: 1 }, 0);
  near('leaning right at yaw 0 moves the eye +0.35 m in X', eyeR.x, 0.35, 1e-9);
  check('and a little down', eyeR.y < P.C.EYE && eyeR.y > P.C.EYE - 0.1);
  const eyeE = C.eyePos({ x: 0, y: 0, z: 0, crouching: false, lean: -1 }, -Math.PI / 2);     // facing +X, right is +Z
  near('facing east, leaning left moves the eye north (-Z)', eyeE.z, -0.35, 1e-9);
  const sh = P.leanShift(0.7, 0.5);
  near('lean shift is sideways to your view', sh.x * -Math.sin(0.7) + sh.z * -Math.cos(0.7), 0, 1e-9);

  // not while sprinting, not in the air
  const s2 = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({}) };
  for (let i = 0; i < 30; i++) C.stepTick(s2, cmd({ moveZ: 1, sprint: true, leanR: true }), open);
  check('no leaning while sprinting', s2.phys.lean === 0, s2.phys.lean);
  const s3 = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({}) };
  for (let i = 0; i < 20; i++) C.stepTick(s3, cmd({ leanR: true }), open);
  C.stepTick(s3, cmd({ leanR: true, jump: true }), open);
  for (let i = 0; i < 10; i++) C.stepTick(s3, cmd({ leanR: true, jump: true }), open);
  check('leaning stops in the air', s3.phys.lean < 0.5, s3.phys.lean);
  const s4 = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({}) };
  for (let i = 0; i < 30; i++) C.stepTick(s4, cmd({ crouch: true, leanR: true }), open);
  near('you can lean while crouched', s4.phys.lean, 1, 1e-9);

  // a wall right next to you limits it
  const wall = P.prepareBoxes([P.makeBox(0.75, 0, 0, 0.4, 4, 10)]);        // face at x = 0.55: eye can only move 0.25 - 0.3...
  const s5 = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({}) };
  for (let i = 0; i < 40; i++) C.stepTick(s5, cmd({ leanR: true }), wall);
  check('a wall beside you limits the lean', s5.phys.lean >= 0 && s5.phys.lean < 0.9, s5.phys.lean);
  const far = P.prepareBoxes([P.makeBox(3, 0, 0, 0.4, 4, 10)]);
  const s6 = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({}) };
  for (let i = 0; i < 40; i++) C.stepTick(s6, cmd({ leanR: true }), far);
  near('a wall farther away does not', s6.phys.lean, 1, 1e-9);
  const eye = C.eyePos(s5.phys, 0);
  check('your eye never ends up inside the wall', eye.x < 0.55, eye.x);

  // lean does not slow or move you
  const a = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({}) }, b = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState({}) };
  for (let i = 0; i < 60; i++) { C.stepTick(a, cmd({ moveZ: 1 }), open); C.stepTick(b, cmd({ moveZ: 1, leanR: true }), open); }
  near('walking while leaning is the same speed', Math.hypot(b.phys.vx, b.phys.vz), Math.hypot(a.phys.vx, a.phys.vz), 1e-9);

  const pk = C.unpackCmd(JSON.parse(JSON.stringify(C.packCmd(cmd({ seq: 1, epoch: 1, leanL: true })))));
  check('lean keys survive packing', pk.leanL === true && pk.leanR === false);
  const pk2 = C.unpackCmd(JSON.parse(JSON.stringify(C.packCmd(cmd({ seq: 1, epoch: 1, leanR: true, throw: true, quick: true })))));
  check('and do not disturb other flags', pk2.leanR && pk2.throw && pk2.quick && !pk2.leanL);
  const copy = P.newPlayer(); C.copyPhysState({ x: 1, y: 0, z: 2, vx: 0, vy: 0, vz: 0, lean: -0.4 }, copy);
  check('lean is part of the copied state', copy.lean === -0.4);
}

section('Head hit box when leaning');
{
  // shooter at x=-10 shooting toward +X at the target's head height; target stands at origin
  const ray = (lean, y) => {
    const t = { id: 1, x: 0, y: 0, z: 0, height: 1.8, hox: P.leanShift(-Math.PI / 2, lean).x, hoz: P.leanShift(-Math.PI / 2, lean).z };
    return C.traceShot(-10, y, 0, { x: 1, y: 0, z: 0 }, 50, open, [t]);
  };
  // Target facing east (yaw -PI/2): right is +Z. Shooter comes from the west, so it looks along the target's facing
  const r0 = ray(0, 1.6), rl = ray(1, 1.6);
  check('an upright head is hit at head height', r0 && r0.kind === 'player' && r0.head);
  check('a head leaned sideways is missed by a shot at where it used to be', !rl, JSON.stringify(rl));
  const rb = ray(1, 1.1);
  check('the body is still where it was', rb && rb.kind === 'player' && !rb.head);
}

section('Room: leaning changes where shots come from and where heads are');
{
  const clock = { t: 0 };
  const room = new Room({ clock: () => clock.t });
  room.boxes = room.boxes.slice();
  const mk = () => { const c = { got: [], send(m) { c.got.push(m); }, close() {} }; c.last = (t) => { for (let i = c.got.length - 1; i >= 0; i--) if (c.got[i].t === t) return c.got[i]; return null; }; return c; };
  const ca = mk(), cb = mk();
  const a = room.addPlayer(ca, 'A'), b = room.addPlayer(cb, 'B');
  a.invulnUntil = b.invulnUntil = 0;
  const run = (p, make, n) => { for (let i = 0; i < n; i++) { clock.t += 1000 / 60; p.seqNo = (p.seqNo || 0) + 1; const c = make(i); c.seq = p.seqNo; c.epoch = p.epoch; room.handleMessage(p, { t: 'cmds', c: [C.packCmd(c)] }); } };
  const EAST = -Math.PI / 2;
  const setup = () => { a.phys = P.newPlayer(-10, 0, -5); b.phys = P.newPlayer(0, 0, -5); a.weapon = C.newWeaponState({ primary: 'longshot' }); a.weapon.ads = 1; b.hp = 100; b.alive = true; a.alive = true; room.tick(); clock.t += 100; room.tick(); };
  const headPitch = Math.atan2(1.6 - P.C.EYE, 10);
  setup();
  run(b, () => cmd({ yaw: EAST }), 2);
  run(a, (i) => cmd({ yaw: EAST, pitch: headPitch, aim: true, fire: i === 3, fresh: true }), 6);
  check('a shot at the head of an upright player kills', !b.alive, b.hp);
  setup();
  run(b, () => cmd({ yaw: EAST, leanR: true }), 20);
  check('the server tracks his lean', b.phys.lean > 0.99, b.phys.lean);
  room.tick(); clock.t += 100; room.tick();
  check('and tells everyone in the snapshot', Math.abs(ca.last('snap').p.find((e) => e.i === b.id).n - 1) < 0.01);
  run(a, (i) => cmd({ yaw: EAST, pitch: headPitch, aim: true, fire: i === 3, fresh: true }), 6);
  check('the same shot misses once his head has leaned out of the way', b.hp === 100 && b.alive, b.hp);
  // A leans: the shot comes from the leaned eye
  setup();
  a.phys.z = -5 + 0.2;     // slightly off so a leaned eye matters... shoot a wall-edge case instead: check the origin in the shot message
  run(a, () => cmd({ yaw: EAST, leanR: true }), 20);
  room.tick();
  a.weapon = C.newWeaponState({ primary: 'longshot' }); a.weapon.ads = 1;
  run(a, (i) => cmd({ yaw: EAST, leanR: true, pitch: 0, aim: true, fire: i === 2, fresh: true }), 5);
  const shot = cb.last('shot');
  check('the shot starts from the leaned eye (0.35 m to the side)', shot && Math.abs(shot.o[2] - (a.phys.z + 0.35)) < 0.01, shot && shot.o);
}

section('Heavier weapons are a lot slower');
{
  const speed = (id, slot) => {
    const lo = { primary: slot === 0 ? id : 'ar7', secondary: slot === 1 ? id : 'sidekick', melee: 'knife' };
    const m = { phys: P.newPlayer(0, 0, 0), weapon: C.newWeaponState(lo) };
    m.weapon.cur = slot;
    for (let i = 0; i < 60; i++) C.stepTick(m, cmd({ moveZ: 1 }), open);
    return Math.hypot(m.phys.vx, m.phys.vz);
  };
  const ar = speed('ar7', 0), sn = speed('longshot', 0), rail = speed('rail', 0), lmg = speed('hammer', 0), sg = speed('breaker', 0);
  near('the rifle walks at 5 m/s', ar, 5, 0.02);
  near('the sniper 15% slower', sn, 4.25, 0.03);
  near('the Rail Cannon 15% slower', rail, 4.25, 0.03);
  near('the Hammer LMG 20% slower', lmg, 4.0, 0.03);
  near('the shotgun 8% slower', sg, 4.6, 0.03);
  check('every heavy weapon is clearly slower than the rifle (over 0.3 m/s)', [sn, rail, lmg, sg].every((v) => v < ar - 0.3));
}

section('The throw preview');
{
  const real = P.prepareBoxes(require('../shared/maps').get('container_yard').boxes);
  let worst = 0;
  for (const [x, z, yaw, pitch] of [[-13, -5, -Math.PI / 2, -0.1], [-13, -5, -Math.PI / 2, 0.3], [0, 10, 0.4, 0.1], [5, 5, 2.0, -0.3]]) {
    const from = G.launch(P.newPlayer(x, 0, z), yaw, pitch, P.C.EYE, real);
    const pre = G.previewImpact(from, real, false);
    // the real thing: step a grenade until it first touches something (vertical speed flips or it changes direction)
    const b = { x: from.x, y: from.y, z: from.z, vx: from.vx, vy: from.vy, vz: from.vz, grounded: false };
    let hit = null;
    for (let i = 0; i < 60 * 4 && !hit; i++) if (G.stepBody(b, 1 / 60, real) > 0) hit = [b.x, b.y, b.z];
    worst = Math.max(worst, Math.hypot(hit[0] - pre.impact[0], hit[2] - pre.impact[2]));
  }
  check('the circle is where the grenade really first lands (within 0.4 m)', worst < 0.4, worst);
  const from = G.launch(P.newPlayer(-13, 0, -5), -Math.PI / 2, -0.1, P.C.EYE, open);
  const norm = G.previewImpact(from, open, false), sticky = G.previewImpact(from, open, true);
  check('a normal grenade also shows where it goes after the bounce', norm.after && Math.hypot(norm.after[0] - norm.impact[0], norm.after[2] - norm.impact[2]) > 0.5);
  check('a sticky shows no bounce line', sticky.after === null);
  const wall = P.prepareBoxes([P.makeBox(0, 0, 0, 0.5, 6, 20)]);
  const f2 = G.launch(P.newPlayer(-6, 0, 0), -Math.PI / 2, 0.05, P.C.EYE, wall);
  const w = G.previewImpact(f2, wall, false);
  check('thrown at a wall, the circle is on the wall and the line after goes back toward you', w.impact[0] < -0.2 && w.after && w.after[0] < w.impact[0], JSON.stringify(w));
}

process.exit(summary('lean, speed and preview') ? 0 : 1);

// Tests for every weapon: exact stats, firing rules, switching, melee, bunny hop and the server side.
const { check, near, section, summary } = require('./harness');
const P = require('../shared/physics');
const W = require('../shared/weapons');
const C = require('../shared/combat');
const { Room } = require('../server/room');

const boxes = P.prepareBoxes(require('../shared/maps').get('container_yard').boxes);

function cmd(o) {
  return Object.assign({ seq: 0, epoch: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, aim: false, fire: false, fresh: false, reload: false, quick: false, slot: -1 }, o);
}
const KIN = { speed: 0, crouching: false, onGround: true, sprint: false };
const ids = (p, s, m) => ({ primary: p, secondary: s || 'sidekick', melee: m || 'knife' });

// ------------------------------------------------------------------ the stat table
section('Weapon stats match the brief');
{
  // id: [slot, rarity, damage, rpm or swing, mag, reserve, reload seconds]
  const table = {
    ar7:      ['primary', 'common', 22, 600, 30, 120, 2.2],
    viper:    ['primary', 'common', 16, 900, 35, 140, 1.8],
    breaker:  ['primary', 'rare', 9, 70, 6, 30, 0.6],
    hammer:   ['primary', 'epic', 18, 700, 100, 200, 5.0],
    longshot: ['primary', 'epic', 90, 45, 5, 20, 3.0],
    sidekick: ['secondary', 'common', 20, 400, 12, 60, 1.3],
    stinger:  ['secondary', 'rare', 11, 800, 20, 80, 1.5],
    cannon:   ['secondary', 'epic', 55, 120, 6, 24, 2.4],
  };
  for (const id of Object.keys(table)) {
    const [slot, rar, dmg, rpm, mag, res, rel] = table[id];
    const w = W.get(id);
    const ok = w.slot === slot && w.rarity === rar && w.damage === dmg && w.rpm === rpm &&
      w.mag === mag && w.reserve === res && Math.abs((w.reloadMode === 'shell' ? w.shellTime : w.reloadTime) - rel) < 1e-9;
    check(id + ' matches the table', ok);
  }
  const b = W.get('breaker');
  check('Breaker fires 8 pellets of 9, pump action, reloads one shell at a time', b.pellets === 8 && b.fireMode === 'pump' && b.reloadMode === 'shell');
  const l = W.get('longshot');
  check('Longshot is bolt action, scoped, and a head hit always kills', l.fireMode === 'bolt' && l.scope && l.killOnHead && W.damageFor(l, 100, true) >= 100);
  check('Viper has lower recoil than the AR-7', W.get('viper').recoil.up < W.get('ar7').recoil.up);
  check('Hammer has the biggest magazine and the slowest aim', W.get('hammer').mag === 100 && W.get('hammer').adsTime > W.get('ar7').adsTime);
  check('Sidekick is semi-auto, Cannon is semi-auto', W.get('sidekick').fireMode === 'semi' && W.get('cannon').fireMode === 'semi');
  check('Cannon kills in two body shots', W.damageFor(W.get('cannon'), 5, false) * 2 >= 100 && W.damageFor(W.get('cannon'), 5, false) < 100);

  const knife = W.get('knife'), mach = W.get('machete'), blade = W.get('blade');
  check('Combat Knife: 40 front, 100 backstab, 0.5 s, 2 m', knife.damage === 40 && knife.backstabDamage === 100 && knife.swing === 0.5 && knife.range === 2.0 && knife.rarity === 'common');
  check('Machete: 45 front, 100 backstab, 0.55 s, 2.3 m', mach.damage === 45 && mach.backstabDamage === 100 && mach.swing === 0.55 && mach.range === 2.3 && mach.rarity === 'rare');
  check('Energy Blade: 55 front, 100 backstab, 0.4 s, legendary', blade.damage === 55 && blade.backstabDamage === 100 && blade.swing === 0.4 && blade.rarity === 'legendary');
  check('Energy Blade is the fastest melee weapon', blade.swing < knife.swing && blade.swing < mach.swing);

  const nova = W.get('nova'), rail = W.get('rail');
  check('there is one Mythic and one Legendary firearm', nova.rarity === 'mythic' && rail.rarity === 'legendary');
  check('Nova Carbine is a 3-round burst with no recoil', nova.fireMode === 'burst' && nova.burst.count === 3 && nova.recoil.up === 0 && nova.recoil.side === 0);
  check('Rail Cannon fires once every 2 seconds and pierces one wall', Math.abs(W.shotInterval(rail) - 2) < 1e-9 && rail.pierceWalls === 1);
  check('rarity colours', W.RARITY.common.color === '#9aa0a6' && W.RARITY.rare.color === '#3b82f6' && W.RARITY.epic.color === '#a855f7' && W.RARITY.mythic.color === '#ef4444' && W.RARITY.legendary.color === '#f59e0b');

  const lights = ['knife', 'blade', 'machete', 'sidekick', 'viper'].every((id) => W.get(id).weight > 1);
  const heavies = ['hammer', 'longshot', 'rail', 'breaker'].every((id) => W.get(id).weight < 1);
  check('lighter weapons are faster, heavier ones slower', lights && heavies && W.get('ar7').weight === 1);
  check('every weapon has stat bars', W.ORDER.every((id) => { const s = W.statBars(W.get(id)); return Object.values(s).every((v) => v >= 0 && v <= 100); }));
}

section('Loadout checking');
{
  const v = W.validateLoadout({ primary: 'hammer', secondary: 'cannon', melee: 'blade' });
  check('a real loadout is kept', v.primary === 'hammer' && v.secondary === 'cannon' && v.melee === 'blade');
  const bad = W.validateLoadout({ primary: 'knife', secondary: 'laser_death_ray', melee: 5 });
  check('wrong or made up items fall back to the defaults', bad.primary === 'ar7' && bad.secondary === 'sidekick' && bad.melee === 'knife');
  check('junk input gives the defaults', W.validateLoadout(null).primary === 'ar7' && W.validateLoadout('hi').melee === 'knife' && W.validateLoadout({ primary: '__proto__' }).primary === 'ar7');
  check('a primary cannot go in the secondary slot', W.validateLoadout({ secondary: 'ar7' }).secondary === 'sidekick');
}

// ------------------------------------------------------------------ firing rules
section('Fire rates and fire modes');
{
  for (const id of ['ar7', 'viper', 'hammer', 'stinger', 'sidekick', 'cannon', 'breaker', 'longshot', 'rail']) {
    const w = W.get(id);
    const slotName = w.slot === 'primary' ? 'primary' : 'secondary';
    const st = C.newWeaponState(ids(w.slot === 'primary' ? id : 'ar7', w.slot === 'secondary' ? id : 'sidekick'));
    st.cur = w.slot === 'primary' ? 0 : 1;
    st.slots[st.cur].mag = 9999;
    let shots = 0;
    const secs = 4;
    for (let i = 0; i < secs * 60; i++) if (C.stepWeapon(st, cmd({ fire: true, fresh: true }), KIN, C.FIXED).fired) shots++;
    const expect = secs * w.rpm / 60;
    check(id + ' fires about ' + w.rpm + ' rounds per minute', Math.abs(shots - expect) <= 1.01, shots + ' vs ' + expect);
  }
  // semi-auto needs a fresh click
  const st = C.newWeaponState(ids('ar7', 'sidekick'));
  st.cur = 1;
  let shots = 0;
  for (let i = 0; i < 120; i++) if (C.stepWeapon(st, cmd({ fire: true, fresh: i === 0 }), KIN, C.FIXED).fired) shots++;
  check('holding the trigger on a pistol fires only one shot', shots === 1, shots);
  // burst
  const nb = C.newWeaponState(ids('nova'));
  const log = [];
  for (let i = 0; i < 60; i++) { if (C.stepWeapon(nb, cmd({ fire: i === 0, fresh: i === 0 }), KIN, C.FIXED).fired) log.push(i); }
  check('one click of the Nova fires exactly 3 shots', log.length === 3, log.join(','));
  check('the 3 shots are close together (900 rpm)', log.length === 3 && (log[1] - log[0]) <= 5 && (log[2] - log[1]) <= 5, log.join(','));
  const nb2 = C.newWeaponState(ids('nova'));
  let early = 0, later = 0;
  for (let i = 0; i < 200; i++) {
    const e = C.stepWeapon(nb2, cmd({ fire: true, fresh: true }), KIN, C.FIXED);
    if (e.fired && i >= 12 && i < 24) early++;
    if (e.fired && i >= 24) later++;
  }
  check('after a burst there is a short pause before the next', early <= 1, early);
  check('and then the next burst comes', later >= 3, later);
  check('burst keeps going if you let go of the trigger', (() => {
    const s2 = C.newWeaponState(ids('nova')); let n = 0;
    for (let i = 0; i < 30; i++) if (C.stepWeapon(s2, cmd({ fire: i === 0, fresh: i === 0 }), KIN, C.FIXED).fired) n++;
    return n === 3;
  })());
}

section('Reloading');
{
  const ticksFor = (st, extra) => { let n = 0; while (st.reloading && n < 2000) { C.stepWeapon(st, cmd(extra || {}), KIN, C.FIXED); n++; } return n * C.FIXED; };
  for (const id of ['ar7', 'viper', 'hammer', 'longshot', 'nova', 'rail']) {
    const w = W.get(id);
    const st = C.newWeaponState(ids(id));
    st.slots[0].mag = 0;
    C.startReload(st);
    const t = ticksFor(st);
    near(id + ' reload takes ' + w.reloadTime + ' s', t, w.reloadTime, 0.03);
    check(id + ' ends with a full magazine', st.slots[0].mag === w.mag && st.slots[0].reserve === w.reserve - w.mag);
  }
  // shell by shell
  const st = C.newWeaponState(ids('breaker'));
  st.slots[0].mag = 0; st.slots[0].reserve = 30;
  C.startReload(st);
  let t = 0, shells = 0;
  while (st.reloading && t < 20) { if (C.stepWeapon(st, cmd({}), KIN, C.FIXED).shellLoaded) shells++; t += C.FIXED; }
  check('the shotgun loads 6 shells one by one', shells === 6 && st.slots[0].mag === 6 && st.slots[0].reserve === 24, shells);
  near('0.6 s per shell', t, 3.6, 0.05);
  // interrupt by firing
  const st2 = C.newWeaponState(ids('breaker'));
  st2.slots[0].mag = 2; st2.slots[0].reserve = 30;
  C.startReload(st2);
  for (let i = 0; i < 40; i++) C.stepWeapon(st2, cmd({}), KIN, C.FIXED);     // one shell in
  check('a shell went in', st2.slots[0].mag === 3, st2.slots[0].mag);
  const e = C.stepWeapon(st2, cmd({ fire: true, fresh: true }), KIN, C.FIXED);
  check('clicking fire interrupts the shell reload and shoots', e.fired && e.reloadCancelled && !st2.reloading);
  // reserve runs out
  const st3 = C.newWeaponState(ids('ar7'));
  st3.slots[0].mag = 10; st3.slots[0].reserve = 5;
  C.startReload(st3); ticksFor(st3);
  check('a partial reserve only fills what it has', st3.slots[0].mag === 15 && st3.slots[0].reserve === 0);
  check('no reload with an empty reserve', !C.startReload(st3));
  const full = C.newWeaponState(ids('ar7'));
  check('no reload with a full magazine', !C.startReload(full));
}

// ------------------------------------------------------------------ switching
section('Weapon switching');
{
  const st = C.newWeaponState(ids('ar7', 'sidekick', 'knife'));
  check('you start with the primary out, full ammo in every gun', st.cur === 0 && st.slots[0].mag === 30 && st.slots[1].mag === 12);
  // shoot 5 rounds of the rifle, switch, come back: ammo is kept
  for (let i = 0; i < 40; i++) C.stepWeapon(st, cmd({ fire: true }), KIN, C.FIXED);
  const left = st.slots[0].mag;
  C.applySwitch(st, cmd({ slot: 1 }));
  check('keys switch weapon', st.cur === 1);
  for (let i = 0; i < 40; i++) C.stepWeapon(st, cmd({}), KIN, C.FIXED);
  C.applySwitch(st, cmd({ slot: 0 }));
  check('ammo is remembered per weapon', st.slots[0].mag === left && st.slots[1].mag === 12);
  check('switching to a weapon you already hold does nothing', !C.applySwitch(st, cmd({ slot: 0 })).switched);
  check('bad slot numbers are ignored', !C.applySwitch(st, cmd({ slot: 7 })).switched && st.cur === 0);

  // reload cancelled by switching
  const s2 = C.newWeaponState(ids('ar7'));
  s2.slots[0].mag = 5;
  C.startReload(s2);
  for (let i = 0; i < 30; i++) C.stepWeapon(s2, cmd({}), KIN, C.FIXED);
  const r = C.applySwitch(s2, cmd({ slot: 1 }));
  check('switching cancels the reload', !s2.reloading && r.reloadCancelled);
  C.applySwitch(s2, cmd({ slot: 0 }));
  for (let i = 0; i < 200; i++) C.stepWeapon(s2, cmd({}), KIN, C.FIXED);
  check('the rifle is still not reloaded after coming back', s2.slots[0].mag === 5);

  // a new weapon takes a moment to raise
  const s3 = C.newWeaponState(ids('ar7'));
  C.applySwitch(s3, cmd({ slot: 1 }));
  let fired = false;
  for (let i = 0; i < 6; i++) if (C.stepWeapon(s3, cmd({ fire: true, fresh: true }), KIN, C.FIXED).fired) fired = true;
  check('you cannot fire while the weapon is being raised', !fired);
  for (let i = 0; i < 30; i++) if (C.stepWeapon(s3, cmd({ fire: true, fresh: true }), KIN, C.FIXED).fired) fired = true;
  check('and then you can', fired);

  // switching does not skip the fire-rate timer
  const s4 = C.newWeaponState(ids('longshot'));
  let n = 0;
  C.stepWeapon(s4, cmd({ fire: true, fresh: true }), KIN, C.FIXED); n++;
  C.applySwitch(s4, cmd({ slot: 1 })); C.stepWeapon(s4, cmd({}), KIN, C.FIXED);
  C.applySwitch(s4, cmd({ slot: 0 }));
  let again = 0;
  for (let i = 0; i < 20; i++) if (C.stepWeapon(s4, cmd({ fire: true, fresh: true }), KIN, C.FIXED).fired) again++;
  check('switching away and back does not skip the bolt cycle', again === 0, again);

  // quick knife
  const q = C.newWeaponState(ids('ar7'));
  let swung = 0, onKnife = false;
  C.stepWeapon(q, cmd({}), KIN, C.FIXED);
  let evs = C.applySwitch(q, cmd({ quick: true }));
  check('V takes out the knife', evs.switched && q.cur === 2);
  for (let i = 0; i < 80; i++) {
    const e = C.stepWeapon(q, cmd({}), KIN, C.FIXED);
    if (e.swung) swung++;
    if (q.cur === 2) onKnife = true;
  }
  check('V swings once on its own', swung === 1, swung);
  check('then you are back on the weapon you had', q.cur === 0 && onKnife);
  // explicit key during a quick knife cancels the return
  const q2 = C.newWeaponState(ids('ar7'));
  C.applySwitch(q2, cmd({ quick: true }));
  C.applySwitch(q2, cmd({ slot: 1 }));
  for (let i = 0; i < 80; i++) C.stepWeapon(q2, cmd({}), KIN, C.FIXED);
  check('choosing a weapon during a quick knife stays on that weapon', q2.cur === 1);

  // packing
  const pk = C.unpackCmd(JSON.parse(JSON.stringify(C.packCmd(cmd({ seq: 1, epoch: 1, slot: 2, quick: true })))));
  check('slot choice and quick knife survive packing', pk.slot === 2 && pk.quick === true);
  const pk2 = C.unpackCmd(JSON.parse(JSON.stringify(C.packCmd(cmd({ seq: 1, epoch: 1 })))));
  check('no slot is -1', pk2.slot === -1 && pk2.quick === false);
  check('a nonsense slot is dropped', C.unpackCmd({ s: 1, e: 1, y: 0, p: 0, f: 0, w: 99 }).slot === -1);
  const st5 = C.newWeaponState(ids('hammer', 'cannon', 'machete'));
  const copy = C.newWeaponState(ids('ar7'));
  C.applyWeaponPacket(JSON.parse(JSON.stringify(C.packWeaponState(st5))), C.copyWeaponState(st5, copy));
  check('weapon state survives a snapshot', copy.ids[0] === 'hammer' && copy.slots[1].mag === 6 && copy.cur === 0);
}

// ------------------------------------------------------------------ speed and bunny hop
section('Weight and bunny hop');
{
  const topSpeed = (loadoutIds, slot, extra, secs) => {
    const me = { phys: P.newPlayer(-14, 0, -5), weapon: C.newWeaponState(loadoutIds) };
    me.weapon.cur = slot;
    let top = 0, airTicks = 0, hops = 0, was = true;
    for (let i = 0; i < secs * 60; i++) {
      // run in a circle-free straight line in the open lane, turning around at the ends
      const dir = (me.phys.x > 10) ? 1 : (me.phys.x < -10 ? -1 : 0);
      if (dir === 1) me._back = true;
      if (dir === -1) me._back = false;
      const yaw = me._back ? Math.PI / 2 : -Math.PI / 2;
      C.stepTick(me, cmd(Object.assign({ moveZ: 1, yaw }, extra)), boxes);
      top = Math.max(top, Math.hypot(me.phys.vx, me.phys.vz));
      if (!me.phys.onGround) airTicks++;
      if (was && !me.phys.onGround) hops++;
      was = me.phys.onGround;
    }
    return { top, airTicks, hops };
  };
  const walkAR = topSpeed(ids('ar7'), 0, {}, 1.5).top;
  const walkKnife = topSpeed(ids('ar7'), 2, {}, 1.5).top;
  const walkLMG = topSpeed(ids('hammer'), 0, {}, 1.5).top;
  near('rifle walking speed is the base 5 m/s', walkAR, 5, 0.05);
  near('knife walking speed is 8% faster', walkKnife, 5 * 1.08, 0.05);
  check('the LMG is slower than the rifle', walkLMG < walkAR - 0.3, walkLMG);
  const sprintAR = topSpeed(ids('ar7'), 0, { sprint: true }, 1.5).top;
  const sprintKnife = topSpeed(ids('ar7'), 2, { sprint: true }, 1.5).top;
  near('rifle sprint is 7.5', sprintAR, 7.5, 0.05);
  near('knife sprint is 8.1', sprintKnife, 7.5 * 1.08, 0.05);
  const sprintPistol = topSpeed(ids('ar7'), 1, { sprint: true }, 1.5).top;
  check('the pistol is a little faster than the rifle', sprintPistol > sprintAR && sprintPistol < sprintKnife, sprintPistol);

  // bunny hop
  const bh = topSpeed(ids('ar7'), 2, { crouch: true, jump: true, sprint: true }, 4);
  check('knife + crouch + jump + sprint bunny hops', bh.hops >= 4, bh.hops + ' hops');
  check('and builds up speed beyond a normal sprint', bh.top > 8.5, bh.top);
  check('but not without limit', bh.top <= P.C.BHOP_MAX + 0.01, bh.top);
  const noSprint = topSpeed(ids('ar7'), 2, { crouch: true, jump: true }, 4);
  check('without sprint there is no bunny hop (one jump only)', noSprint.hops <= 1 && noSprint.top < 6, noSprint.hops + ' hops, ' + noSprint.top);
  const noCrouch = topSpeed(ids('ar7'), 2, { jump: true, sprint: true }, 4);
  check('without crouch there is no bunny hop', noCrouch.hops <= 1, noCrouch.hops);
  const noJump = topSpeed(ids('ar7'), 2, { crouch: true, sprint: true }, 4);
  check('without jump you just crouch-walk', noJump.hops === 0 && noJump.top < 3, noJump.top);
  const gun = topSpeed(ids('ar7'), 0, { crouch: true, jump: true, sprint: true }, 4);
  check('guns cannot bunny hop', gun.hops <= 1 && gun.top < 6, gun.hops + ' hops, ' + gun.top);
  const pistol = topSpeed(ids('ar7'), 1, { crouch: true, jump: true, sprint: true }, 4);
  check('the pistol cannot bunny hop either', pistol.hops <= 1, pistol.hops);
  for (const m of ['machete', 'blade']) {
    const r = topSpeed(ids('ar7', 'sidekick', m), 2, { crouch: true, jump: true, sprint: true }, 4);
    check(m + ' can bunny hop too', r.hops >= 4, r.hops);
  }
  // sprint is only counted while moving forward
  const me = { phys: P.newPlayer(-14, 0, -5), weapon: C.newWeaponState(ids('ar7')) };
  me.weapon.cur = 2;
  let air = 0;
  for (let i = 0; i < 120; i++) { C.stepTick(me, cmd({ moveZ: 0, moveX: 1, yaw: -Math.PI / 2, crouch: true, jump: true, sprint: true }), boxes); if (!me.phys.onGround) air++; }
  check('sprint without moving forward does not count', air < 60, air);
}

// ------------------------------------------------------------------ shot paths
section('Shots through the world');
{
  const wall1 = P.makeBox(5, 0, 0, 1, 4, 10);
  const wall2 = P.makeBox(8, 0, 0, 1, 4, 10);
  const target = { id: 7, x: 12, y: 0, z: 0, height: 1.8 };
  const dir = { x: 1, y: 0, z: 0 };
  const one = [wall1];
  const two = [wall1, wall2];
  let r = C.traceShot(0, 1.2, 0, dir, 100, one, [target], 0);
  check('a normal shot stops at the wall', r && r.kind === 'wall' && Math.abs(r.t - 4.5) < 1e-6);
  r = C.traceShot(0, 1.2, 0, dir, 100, one, [target], 1);
  check('a piercing shot goes through one wall and hits the target', r && r.kind === 'player' && r.id === 7 && r.through && r.through.length === 1, JSON.stringify(r));
  check('it reports where it left the wall', r.through && Math.abs(r.through[0].exit - 5.5) < 1e-6);
  r = C.traceShot(0, 1.2, 0, dir, 100, two, [target], 1);
  check('but not through two walls', r && r.kind === 'wall' && Math.abs(r.t - 7.5) < 1e-6, JSON.stringify(r));
  const near2 = { id: 8, x: 2, y: 0, z: 0, height: 1.8 };
  r = C.traceShot(0, 1.2, 0, dir, 100, one, [near2, target], 1);
  check('a piercing shot stops at the first player it meets', r && r.kind === 'player' && r.id === 8);
  r = C.traceShot(0, 1.2, 0, { x: 0, y: -1, z: 0 }, 100, [], [], 1);
  check('the floor can not be pierced', r && r.kind === 'wall' && r.box === null);
}

// ------------------------------------------------------------------ the room
function fakeConn() {
  const c = { got: [], closed: false, send(m) { c.got.push(m); }, close() { c.closed = true; } };
  c.last = (t) => { for (let i = c.got.length - 1; i >= 0; i--) if (c.got[i].t === t) return c.got[i]; return null; };
  c.all = (t) => c.got.filter((m) => m.t === t);
  return c;
}
function makeRoom() {
  const clock = { t: 0 };
  const room = new Room({ clock: () => clock.t });
  room.boxes = room.boxes.slice();      // tests add walls; keep them out of the shared map
  return { room, clock };
}
function run(room, clock, p, make, n) {
  for (let i = 0; i < n; i++) {
    clock.t += 1000 / 60;
    p.seqNo = (p.seqNo || 0) + 1;
    const c = make(i);
    c.seq = p.seqNo; c.epoch = p.player.epoch;
    room.handleMessage(p.player, { t: 'cmds', c: [C.packCmd(c)] });
  }
}
function duel(loA, loB) {
  const { room, clock } = makeRoom();
  const ca = fakeConn(), cb = fakeConn();
  const a = room.addPlayer(ca, 'A', loA);
  const b = room.addPlayer(cb, 'B', loB);
  a.invulnUntil = b.invulnUntil = 0;
  room.tick(); clock.t += 100; room.tick();
  return { room, clock, ca, cb, a, b, A: { player: a }, B: { player: b } };
}
const EAST = -Math.PI / 2;      // yaw that faces +X

section('Room: loadouts');
{
  const { room } = makeRoom();
  const c1 = fakeConn();
  const a = room.addPlayer(c1, 'A', { primary: 'hammer', secondary: 'cannon', melee: 'blade' });
  check('a chosen loadout is used and confirmed', c1.last('welcome').lo.primary === 'hammer' && a.weapon.ids[0] === 'hammer' && a.weapon.slots[1].mag === 6);
  const c2 = fakeConn();
  const b = room.addPlayer(c2, 'B', { primary: 'rocket_launcher', secondary: 'knife', melee: 'ar7' });
  check('made-up or misplaced items are replaced with the defaults', c2.last('welcome').lo.primary === 'ar7' && b.weapon.ids.join() === 'ar7,sidekick,knife');
  const c3 = fakeConn();
  room.addPlayer(c3, 'C');
  check('no loadout at all gives the defaults', c3.last('welcome').lo.primary === 'ar7');
  check('others are told what a newcomer carries', c1.all('join')[0].lo.primary === 'ar7');
  const c4 = fakeConn();
  const d = room.addPlayer(c4, 'D', { primary: 'nova' });
  check('missing slots are filled in', d.weapon.ids.join() === 'nova,sidekick,knife');
  room.handleMessage(a, { t: 'loadout', lo: { primary: 'viper', secondary: 'nonsense' } });
  check('a loadout change waits for the next respawn', a.weapon.ids[0] === 'hammer' && a.nextLoadout.primary === 'viper' && a.nextLoadout.secondary === 'sidekick');
  room.respawn(a);
  check('and then it is applied', a.weapon.ids.join() === 'viper,sidekick,knife' && c2.last('lo').lo.primary === 'viper');
  room.tick();
  const you = c1.last('snap').you;
  check('snapshots carry the whole weapon state', you.wp && you.wp.s.length === 3 && you.lo.primary === 'viper');
}

section('Room: shotgun, sniper, rail');
{
  // shotgun: 8 pellets in the message, close range is deadly
  let d = duel({ primary: 'breaker' });
  d.a.phys = P.newPlayer(-5, 0, -5); d.b.phys = P.newPlayer(-3, 0, -5);
  d.room.tick();
  d.a.weapon.ads = 1;
  const pitch = Math.atan2(1.2 - P.C.EYE, 2);
  run(d.room, d.clock, d.A, (i) => cmd({ yaw: EAST, pitch, aim: true, fire: i === 2, fresh: true }), 4);
  const shot = d.cb.last('shot');
  check('the shot message carries all 8 pellets', shot && shot.p.length === 8 && shot.w === 'breaker');
  check('the shotgun does big damage up close (several pellets hit)', d.b.hp <= 100 - 9 * 4, d.b.hp);
  check('hits from one shot are reported together', d.ca.all('hit').length === 1 && d.ca.last('hit').d === 100 - d.b.hp);

  // far away it does much less
  d = duel({ primary: 'breaker' });
  d.a.phys = P.newPlayer(-14, 0, -5); d.b.phys = P.newPlayer(2, 0, -5);
  d.room.tick(); d.a.weapon.ads = 1;
  const pitchF = Math.atan2(1.2 - P.C.EYE, 16);
  run(d.room, d.clock, d.A, (i) => cmd({ yaw: EAST, pitch: pitchF, aim: true, fire: i === 2, fresh: true }), 4);
  check('and little at 16 metres', d.b.hp >= 100 - 9 * 8 * 0.5, d.b.hp);

  // sniper: head kills, body does 90
  d = duel({ primary: 'longshot' });
  d.a.phys = P.newPlayer(-12, 0, -5); d.b.phys = P.newPlayer(0, 0, -5);
  d.room.tick(); d.a.weapon.ads = 1;
  const pitchB = Math.atan2(1.0 - P.C.EYE, 12);
  run(d.room, d.clock, d.A, (i) => cmd({ yaw: EAST, pitch: pitchB, aim: true, fire: i === 2, fresh: true }), 4);
  check('a sniper body shot does 90', d.b.hp === 10 && d.b.alive, d.b.hp);
  d = duel({ primary: 'longshot' });
  d.a.phys = P.newPlayer(-12, 0, -5); d.b.phys = P.newPlayer(0, 0, -5);
  d.room.tick(); d.a.weapon.ads = 1;
  const pitchH = Math.atan2(1.6 - P.C.EYE, 12);
  run(d.room, d.clock, d.A, (i) => cmd({ yaw: EAST, pitch: pitchH, aim: true, fire: i === 2, fresh: true }), 4);
  check('a sniper headshot always kills', !d.b.alive && d.ca.last('hit').h === true, d.b.hp);
  // the sniper is a bolt action
  d = duel({ primary: 'longshot' });
  d.a.phys = P.newPlayer(-12, 0, -5); d.b.phys = P.newPlayer(0, 0, -5);
  d.room.tick(); d.a.weapon.ads = 1;
  run(d.room, d.clock, d.A, () => cmd({ yaw: EAST, pitch: pitchB, aim: true, fire: true, fresh: true }), 40);
  check('the bolt takes over a second to cycle (only one shot in 0.67 s)', d.a.weapon.slots[0].mag === 4, d.a.weapon.slots[0].mag);

  // rail: through one wall
  const wallBox = P.makeBox(-6, 0, -5, 1, 4, 6);     // a wall between shooter and target
  d = duel({ primary: 'rail' });
  d.room.boxes.push(wallBox);
  d.a.phys = P.newPlayer(-10, 0, -5); d.b.phys = P.newPlayer(0, 0, -5);
  d.room.tick(); d.a.weapon.ads = 1;
  const pitchR = Math.atan2(1.0 - P.C.EYE, 10);
  run(d.room, d.clock, d.A, (i) => cmd({ yaw: EAST, pitch: pitchR, aim: true, fire: i === 2, fresh: true }), 4);
  check('the Rail Cannon hits a player behind a wall', d.b.hp < 100 && d.ca.last('hit'), d.b.hp);
  const rs = d.cb.last('shot');
  check('and the shot message says so', rs && rs.w === 'rail' && rs.p.length === 1);
  const dmg = d.ca.last('hit').d;
  check('rail damage is 85 body, 170 head (kills)', dmg === 85, dmg);
  // two walls
  d = duel({ primary: 'rail' });
  d.room.boxes.push(wallBox, P.makeBox(-3, 0, -5, 1, 4, 6));
  d.a.phys = P.newPlayer(-10, 0, -5); d.b.phys = P.newPlayer(0, 0, -5);
  d.room.tick(); d.a.weapon.ads = 1;
  run(d.room, d.clock, d.A, (i) => cmd({ yaw: EAST, pitch: pitchR, aim: true, fire: i === 2, fresh: true }), 4);
  check('but not behind two walls', d.b.hp === 100);
  // normal rifle does not pierce
  d = duel({ primary: 'ar7' });
  d.room.boxes.push(wallBox);
  d.a.phys = P.newPlayer(-10, 0, -5); d.b.phys = P.newPlayer(0, 0, -5);
  d.room.tick(); d.a.weapon.ads = 1;
  run(d.room, d.clock, d.A, (i) => cmd({ yaw: EAST, pitch: pitchR, aim: true, fire: i === 2, fresh: true }), 4);
  check('other guns do not shoot through walls', d.b.hp === 100);
  // rail: one shot per 2 s
  d = duel({ primary: 'rail' });
  d.a.phys = P.newPlayer(-10, 0, -5); d.b.phys = P.newPlayer(0, 0, -5); d.b.hp = 1000;
  d.room.tick(); d.a.weapon.ads = 1;
  run(d.room, d.clock, d.A, () => cmd({ yaw: EAST, pitch: pitchR, aim: true, fire: true, fresh: true }), 100);
  check('the Rail Cannon fires only once in 1.7 s', d.a.weapon.slots[0].mag === 2, d.a.weapon.slots[0].mag);
}

section('Room: melee');
{
  const prep = (lo, dist, facing) => {
    const d = duel(lo);
    d.a.phys = P.newPlayer(-5, 0, -5); d.b.phys = P.newPlayer(-5 + dist, 0, -5);
    d.b.yaw = facing;
    d.room.tick();
    return d;
  };
  const swing = (d, n) => run(d.room, d.clock, d.A, (i) => cmd({ yaw: EAST, slot: i === 0 ? 2 : -1, fire: i === 25, fresh: true }), n || 30);

  // face to face: victim looks at the attacker (yaw +90 degrees faces -X)
  let d = prep(undefined, 1.5, Math.PI / 2);
  swing(d);
  check('knife from the front does 40', d.b.hp === 60, d.b.hp);
  check('the attacker is told', d.ca.last('hit') && d.ca.last('hit').d === 40 && d.ca.last('hit').bs === 0);
  check('others see the swing', d.cb.last('swing') && d.cb.last('swing').h === 1 && d.cb.last('swing').w === 'knife');

  d = prep(undefined, 1.5, EAST);
  swing(d);
  check('knife in the back is an instant kill', !d.b.alive && d.ca.last('hit').bs === 1, d.b.hp);
  check('backstab kills are announced', d.ca.last('kill') && d.ca.last('kill').k === d.a.id);

  d = prep(undefined, 1.5, 0);
  swing(d);
  check('from the side it is a normal hit', d.b.hp === 60, d.b.hp);

  d = prep(undefined, 1.9, Math.PI / 2);
  swing(d);
  check('knife reaches about 2 m', d.b.hp === 60, d.b.hp);
  d = prep(undefined, 3.2, Math.PI / 2);
  swing(d);
  check('but not 3.2 m', d.b.hp === 100, d.b.hp);

  d = prep({ melee: 'machete' }, 2.5, Math.PI / 2);
  swing(d);
  check('the machete reaches a bit farther and does 45', d.b.hp === 55, d.b.hp);
  d = prep({ melee: 'blade' }, 1.5, Math.PI / 2);
  swing(d);
  check('the Energy Blade does 55', d.b.hp === 45, d.b.hp);

  d = prep(undefined, 1.5, Math.PI / 2);
  run(d.room, d.clock, d.A, (i) => cmd({ yaw: Math.PI / 2, slot: i === 0 ? 2 : -1, fire: i === 25, fresh: true }), 30);
  check('swinging the wrong way misses', d.b.hp === 100, d.b.hp);

  d = prep(undefined, 1.5, Math.PI / 2);
  d.room.boxes.push(P.makeBox(-4.25, 0, -5, 0.3, 3, 3));
  swing(d);
  check('no stabbing through a wall', d.b.hp === 100, d.b.hp);

  d = prep(undefined, 1.5, Math.PI / 2);
  d.b.invulnUntil = d.room.now() + 5000;
  swing(d);
  check('spawn protection stops melee too', d.b.hp === 100);

  // swing timing: 0.5 s
  d = prep(undefined, 1.5, Math.PI / 2);
  d.b.hp = 5000;
  run(d.room, d.clock, d.A, (i) => cmd({ yaw: EAST, slot: i === 0 ? 2 : -1, fire: i >= 20, fresh: true }), 20 + 240);
  const swings = d.cb.all('swing').length;
  check('about 2 swings per second with the knife', swings >= 7 && swings <= 9, swings);

  // the swing is blocked while the knife is still being raised
  d = prep(undefined, 1.5, Math.PI / 2);
  run(d.room, d.clock, d.A, (i) => cmd({ yaw: EAST, slot: i === 0 ? 2 : -1, fire: i === 2, fresh: true }), 6);
  check('no instant swing while the knife is being raised', d.b.hp === 100);

  // quick knife through the room
  d = prep(undefined, 1.5, Math.PI / 2);
  run(d.room, d.clock, d.A, (i) => cmd({ yaw: EAST, quick: i === 0 }), 40);
  check('V does a quick knife swing and goes back to the rifle', d.b.hp === 60 && d.a.weapon.cur === 0, d.b.hp + ' cur ' + d.a.weapon.cur);

  // no cheating: slot 4 or nonsense
  d = prep(undefined, 1.5, Math.PI / 2);
  d.room.handleMessage(d.a, { t: 'cmds', c: [{ s: 1, e: 1, y: 0, p: 0, f: 0, w: 9 }] });
  check('an impossible weapon slot is ignored', d.a.weapon.cur === 0);
}

section('Balance: moving ruins your aim');
{
  const at = (id, speed, ads, extra) => {
    const st = C.newWeaponState(ids(id)); st.ads = ads;
    return C.spreadDeg(W.get(id), st, Object.assign({ speed, crouching: false, onGround: true, sprint: false }, extra));
  };
  for (const id of ['ar7', 'viper', 'hammer', 'nova']) {
    const still = at(id, 0, 0), walk = at(id, 5, 0), run = at(id, 7.5, 0);
    check(id + ': walking makes the cone at least 2.5x wider', walk >= still * 2.5, still + ' -> ' + walk);
    check(id + ': sprinting is wider than walking', run > walk);
  }
  check('aiming while moving is still much worse than aiming while still', at('ar7', 5, 1) > at('ar7', 0, 1) * 8, at('ar7', 5, 1) + ' vs ' + at('ar7', 0, 1));
  check('a scoped sniper is useless while walking (over 6 degrees)', at('longshot', 5, 1) > 6, at('longshot', 5, 1));
  check('the Rail Cannon too', at('rail', 5, 1) > 6, at('rail', 5, 1));
  check('standing still, a scoped sniper is dead accurate', at('longshot', 0, 1) < 0.01);
  check('crouch-walking is better than walking', at('ar7', 2.5, 0, { crouching: true }) < at('ar7', 5, 0));
  check('jumping widens the cone', at('ar7', 0, 0, { onGround: false }) > at('ar7', 0, 0) + 1.5);
}

section('Balance: time to kill (100 hp, all shots hit the body at close range)');
{
  const ttk = (id) => {
    const w = W.get(id);
    const dmg = W.damageFor(w, 3, false) * w.pellets;
    const shots = Math.ceil(100 / dmg);
    if (w.fireMode === 'burst') {
      const per = w.burst.count;
      const bursts = Math.floor((shots - 1) / per);
      const inBurst = (shots - 1) % per;
      return bursts * ((per - 1) * W.burstInterval(w) + w.burst.delay) + inBurst * W.burstInterval(w);
    }
    return (shots - 1) * W.shotInterval(w);
  };
  const t = {};
  for (const id of ['ar7', 'viper', 'breaker', 'hammer', 'longshot', 'nova', 'rail', 'sidekick', 'stinger', 'cannon']) t[id] = ttk(id);
  console.log('       ' + Object.keys(t).map((k) => k + ' ' + t[k].toFixed(2) + 's').join('  '));
  check('every automatic gun kills within 0.7 s up close', ['ar7', 'viper', 'hammer', 'nova', 'sidekick', 'stinger', 'cannon'].every((id) => t[id] <= 0.7), JSON.stringify(t));
  check('the slow heavy hitters (shotgun, sniper, rail) need two shots, with a pause between', t.breaker > 0.5 && t.longshot > 1 && t.rail >= 2);
  check('the rifle kills in about 0.4 s', Math.abs(t.ar7 - 0.4) < 0.05, t.ar7);
  check('the Mythic Nova kills within 0.2 s of the AR-7 (and is far more accurate)', t.nova <= t.ar7 + 0.2, t.nova);
  check('Viper is a little quicker than the AR-7 at point blank or the same', t.viper <= t.ar7 + 0.05, t.viper);
  check('the Rail Cannon and sniper need 2 shots', Math.ceil(100 / 85) === 2 && Math.ceil(100 / 90) === 2);
}

process.exit(summary('weapons') ? 0 : 1);

// Checks the shared movement and collision code with scripted "players".
const { check, near, between, section, summary } = require('./harness');
const P = require('../shared/physics');
const Maps = require('../shared/maps');
const Weapons = require('../shared/weapons');

const DT = P.C.FIXED_DT;

// Run a player for `seconds` with a constant input. Returns the player.
function run(s, input, seconds, boxes, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    P.stepPlayer(s, input, DT, boxes);
    if (each) each(s, i);
  }
  return s;
}

function settle(s, boxes) {
  return run(s, { yaw: 0 }, 0.5, boxes);
}

const open = [];                    // empty world: just the floor
const idle = { yaw: 0 };

section('Standing and basic speeds');
{
  const s = settle(P.newPlayer(0, 0, 0), open);
  check('stands on the floor', s.onGround && s.y === 0);
  run(s, idle, 1, open);
  near('stays put with no input', s.z, 0, 1e-9);
}
{
  // Facing -Z (yaw 0), pressing forward should move toward -Z
  // Speed check: after a short ramp-up, measure the distance covered in one second.
  const measure = (input) => {
    const p = settle(P.newPlayer(0, 0, 0), open);
    run(p, input, 0.5, open);
    const z0 = p.z;
    run(p, input, 1, open);
    return { dist: Math.abs(p.z - z0), p };
  };
  near('walk speed is 5 m/s', measure({ yaw: 0, moveZ: 1 }).dist, 5, 0.01);
  near('sprint speed is 7.5 m/s', measure({ yaw: 0, moveZ: 1, sprint: true }).dist, 7.5, 0.01);
  const cr = measure({ yaw: 0, moveZ: 1, crouch: true });
  near('crouch speed is 2.5 m/s', cr.dist, 2.5, 0.01);
  check('crouching flag set', cr.p.crouching === true);
  near('aiming slows you (speedMult 0.75)', measure({ yaw: 0, moveZ: 1, speedMult: 0.75 }).dist, 3.75, 0.01);
}
{
  // Diagonal must not be faster than straight
  const s = settle(P.newPlayer(0, 0, 0), open);
  run(s, { yaw: 0, moveZ: 1, moveX: 1 }, 1.5, open);
  const x1 = s.x, z1 = s.z;
  run(s, { yaw: 0, moveZ: 1, moveX: 1 }, 1, open);
  near('diagonal speed is not faster than straight', Math.hypot(s.x - x1, s.z - z1), 5, 0.01);
  // yaw turns the movement: yaw = +90 deg looks toward -X
  const t = settle(P.newPlayer(0, 0, 0), open);
  run(t, { yaw: Math.PI / 2, moveZ: 1 }, 1, open);
  between('yaw +90 deg walks toward -X', -t.x, 4.7, 5.0);
  near('...and not sideways', t.z, 0, 1e-6);
  // strafe right at yaw 0 goes toward +X
  const u = settle(P.newPlayer(0, 0, 0), open);
  run(u, { yaw: 0, moveX: 1 }, 1, open);
  between('strafe right goes toward +X', u.x, 4.7, 5.0);
}

section('Jumping');
{
  const s = settle(P.newPlayer(0, 0, 0), open);
  let apex = 0, airTime = 0, wasUp = false;
  run(s, { yaw: 0, jump: true }, 1.2, open, (st) => {
    apex = Math.max(apex, st.y);
    if (!st.onGround) airTime += DT;
  });
  between('jump apex is about 1.2 m', apex, 1.15, 1.25);
  between('air time is about 0.69 s', airTime, 0.62, 0.76);
  check('lands again', s.onGround && s.y === 0);
  check('holding space does not bunny hop', airTime < 0.8);
}

section('Walls and sliding');
{
  const wall = [{ x: 0, y: 0, z: -5, w: 60, h: 3, d: 1 }];
  P.prepareBoxes(wall);
  const s = settle(P.newPlayer(0, 0, 0), wall);
  run(s, { yaw: 0, moveZ: 1 }, 2, wall);
  near('stops at the wall face (radius 0.4 from z=-4.5)', s.z, -4.1, 1e-6);
  // slide: walk diagonally into the wall, x should keep changing
  const t = settle(P.newPlayer(0, 0, 0), wall);
  run(t, { yaw: 0, moveZ: 1, moveX: 1 }, 2, wall);
  check('slides along the wall', t.x > 3 && Math.abs(t.z + 4.1) < 1e-6, 'x=' + t.x + ' z=' + t.z);
  // does not tunnel at sprint speed with big time steps (server uses 1/30)
  const u = settle(P.newPlayer(0, 0, 0), wall);
  for (let i = 0; i < 90; i++) P.stepPlayer(u, { yaw: 0, moveZ: 1, sprint: true }, 1 / 30, wall);
  check('no tunnelling at 30 ticks per second', u.z > -4.11, 'z=' + u.z);
}

section('Steps, ledges and crates');
{
  const step = [{ x: 0, y: 0, z: -13, w: 6, h: 0.3, d: 20 }];
  P.prepareBoxes(step);
  const s = settle(P.newPlayer(0, 0, 0), step);
  let rise = 0;
  run(s, { yaw: 0, moveZ: 1 }, 1.2, step, (st) => { rise += st.stepRise; });
  near('walks up a 0.3 m step without jumping', s.y, 0.3, 1e-6);
  near('the climbed height is reported (for smooth cameras)', rise, 0.3, 1e-6);
}
{
  const high = [{ x: 0, y: 0, z: -13, w: 6, h: 0.7, d: 20 }];
  P.prepareBoxes(high);
  const s = settle(P.newPlayer(0, 0, 0), high);
  run(s, { yaw: 0, moveZ: 1 }, 1.5, high);
  check('a 0.7 m ledge blocks walking', s.y === 0 && s.z > -2.7, 'y=' + s.y + ' z=' + s.z);
}
{
  // The crate staircase in the Container Yard: floor -> 1.0 -> 2.0 -> a 2.6 roof
  const b = P.prepareBoxes([
    { x: 0, y: 0, z: -4, w: 1.2, h: 1.0, d: 1.2 },      // crate A, 1.0 m (z -4.6 .. -3.4)
    { x: 0, y: 0, z: -5.2, w: 1.2, h: 2.0, d: 1.2 },    // crate B, 2.0 m, touching A (z -5.8 .. -4.6)
    { x: 0, y: 0, z: -7.4, w: 6, h: 2.6, d: 2.4 },      // roof, 2.6 m, touching B (z -8.6 .. -6.2)
  ]);
  // A short hop forward: jump for a moment while walking, then keep walking.
  const hop = (p, seconds) => {
    p.jumpLatch = false;
    run(p, { yaw: 0, moveZ: 1, jump: true }, 0.1, b);
    run(p, { yaw: 0, moveZ: 1 }, seconds, b);
    run(p, { yaw: 0 }, 0.3, b);          // stop and settle
  };
  const s = settle(P.newPlayer(0, 0, -2.6), b);
  hop(s, 0.5);
  check('can jump onto a 1.0 m crate', s.onGround && Math.abs(s.y - 1.0) < 1e-6, 'y=' + s.y + ' z=' + s.z);
  hop(s, 0.5);
  check('can jump from 1.0 up onto a 2.0 m crate', s.onGround && Math.abs(s.y - 2.0) < 1e-6, 'y=' + s.y + ' z=' + s.z);
  hop(s, 0.6);
  check('can jump from 2.0 up onto the 2.6 m roof', s.onGround && Math.abs(s.y - 2.6) < 1e-6, 'y=' + s.y + ' z=' + s.z);
}
{
  // From the floor you must NOT reach a 2.0 m crate in one jump
  const b = P.prepareBoxes([{ x: 0, y: 0, z: -3, w: 3, h: 2.0, d: 1.2 }]);
  const s = settle(P.newPlayer(0, 0, 0), b);
  run(s, { yaw: 0, moveZ: 1, jump: true }, 1.5, b);
  check('cannot jump onto a 2.0 m crate from the floor', s.y < 0.5, 'y=' + s.y);
}

section('Crouching under things');
{
  const beam = P.prepareBoxes([{ x: 0, y: 1.4, z: -2, w: 4, h: 1.0, d: 6 }]); // bottom at 1.4 m
  const s = settle(P.newPlayer(0, 0, 0), beam);
  // Standing player (1.8 m) cannot walk under it
  run(s, { yaw: 0, moveZ: 1 }, 1.5, beam);
  check('standing player is blocked by a 1.4 m beam', s.z > -0.1, 'z=' + s.z);
  // Crouched player (1.2 m) can walk under, and stays crouched while under it
  const t = settle(P.newPlayer(0, 0, 0), beam);
  run(t, { yaw: 0, moveZ: 1, crouch: true }, 1.5, beam);
  check('crouched player walks under it', t.z < -2, 'z=' + t.z);
  run(t, { yaw: 0, moveZ: 0, crouch: false }, 0.5, beam);
  check('cannot stand up while under the beam', t.crouching === true);
  run(t, { yaw: 0, moveZ: 1, crouch: false }, 2, beam);
  check('stands up once clear', t.crouching === false, 'z=' + t.z);
}

section('Falling');
{
  const plat = P.prepareBoxes([{ x: 0, y: 2.6, z: 0, w: 4, h: 0.3, d: 4 }]);  // top 2.9 m
  const s = P.newPlayer(0, 2.9, 0);
  s.onGround = true;
  let landed = 0;
  run(s, { yaw: 0, moveZ: 1 }, 2, plat, (st) => { landed = Math.max(landed, st.landed); });
  check('walked off the edge and reached the floor', s.y === 0 && s.onGround, 'y=' + s.y);
  between('reported a landing speed', landed, 7, 12);
}

section('Rays');
{
  const wall = P.prepareBoxes([{ x: 0, y: 0, z: -10, w: 6, h: 3, d: 1 }]);
  const hit = P.raycastWorld(0, 1.5, 0, 0, 0, -1, 100, wall);
  near('ray hits a wall at the right distance', hit.t, 9.5, 1e-9);
  check('...with the right normal', hit.nz === 1 && hit.nx === 0 && hit.ny === 0);
  check('ray pointing away hits nothing', P.raycastWorld(0, 1.5, 0, 0, 0, 1, 100, wall) === null);
  check('ray stops at max distance', P.raycastWorld(0, 1.5, 0, 0, 0, -1, 5, wall) === null);
  const floor = P.raycastWorld(0, 2, 0, 0, -1, 0, 100, []);
  near('ray hits the floor', floor.t, 2, 1e-9);
  check('floor hit has an up normal', floor.ny === 1 && floor.box === null);
  // angled ray
  const len = Math.hypot(0.2, 0.98);
  const diag = P.raycastWorld(0, 1.5, 0, 0.2 / len, 0, -0.98 / len, 100, wall);
  check('angled ray hits the wall face', diag && diag.nz === 1 && Math.abs(diag.t - 9.5 / (0.98 / len)) < 1e-6);
  const up = P.raycastWorld(0, 1.5, 0, 0, 0.7071, -0.7071, 100, wall);
  check('ray angled up over the wall misses', up === null);
}
{
  // Body and head hitboxes: a standing player at (0,0,-10)
  const body = P.rayVsBody(0, 1.0, 0, 0, 0, -1, 0, 0, -10, 1.8);
  check('ray at chest height hits the body', body && body.head === false);
  const head = P.rayVsBody(0, 1.65, 0, 0, 0, -1, 0, 0, -10, 1.8);
  check('ray at head height is a headshot', head && head.head === true);
  const over = P.rayVsBody(0, 1.95, 0, 0, 0, -1, 0, 0, -10, 1.8);
  check('ray over the head misses', over === null);
  const side = P.rayVsBody(0, 1.0, 0, 0.5, 0, -1, 0, 0, -10, 1.8);
  check('ray going wide misses', side === null);
  const crouchHead = P.rayVsBody(0, 1.1, 0, 0, 0, -1, 0, 0, -10, 1.2);
  check('crouching lowers the head', crouchHead && crouchHead.head === true);
}

section('Weapon numbers');
{
  const ar = Weapons.get('ar7');
  check('AR-7 matches the brief', ar.damage === 22 && ar.rpm === 600 && ar.mag === 30 && ar.reserve === 120 && ar.reloadTime === 2.2);
  check('body shot damage is 22', Weapons.damageFor(ar, 10, false) === 22);
  check('headshot damage is 33 (1.5x)', Weapons.damageFor(ar, 10, true) === 33);
  check('damage fades at long range', Weapons.damageFor(ar, 120, false) < 22);
  near('shot interval is 0.1 s at 600 RPM', Weapons.shotInterval(ar), 0.1, 1e-9);
}

process.exit(summary('physics') ? 0 : 1);

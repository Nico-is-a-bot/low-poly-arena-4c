// Checks the map data: bounds, spawns, connectivity, stairs, and "can anyone get stuck?".
// Run with MAP_ASCII=1 to also print a top-down picture of the map.
const { check, near, between, section, summary } = require('./harness');
const P = require('../shared/physics');
const Maps = require('../shared/maps');

const DT = P.C.FIXED_DT;
const map = Maps.get('container_yard');
const boxes = P.prepareBoxes(map.boxes);
const half = map.width / 2;

function run(s, input, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    P.stepPlayer(s, input, DT, boxes);
    if (each) each(s);
  }
  return s;
}

// ------------------------------------------------------------ ASCII picture
if (process.env.MAP_ASCII) {
  const cell = 0.5;
  const cols = Math.round(map.width / cell), rows = Math.round(map.depth / cell);
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const x = -half + (c + 0.5) * cell, z = -map.depth / 2 + (r + 0.5) * cell;
      let top = 0;
      for (const b of boxes) {
        if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) top = Math.max(top, b.maxY);
      }
      let ch = ' ';
      if (top > 5.5) ch = '#';
      else if (top > 3.0) ch = 'H';
      else if (top > 2.5) ch = 'C';
      else if (top > 1.5) ch = 'B';
      else if (top > 0.55) ch = 'o';
      else if (top > 0) ch = '.';
      for (const sp of map.spawns) if (Math.abs(sp.x - x) <= cell && Math.abs(sp.z - z) <= cell) ch = 'S';
      for (const d of map.dummies) if (Math.abs(d.x - x) <= cell && Math.abs(d.z - z) <= cell) ch = 'D';
      line += ch;
    }
    lines.push(line);
  }
  console.log('\n' + lines.join('\n') + '\n');
  console.log('# wall   H taller than 3 m   C container roof   B 1.5-2.5 m   o low cover   . step   S spawn   D target\n');
}

section('Map data');
{
  check('map is 40 x 40 and called Small', map.width === 40 && map.depth === 40 && map.size === 'Small');
  check('every box has a positive size', boxes.every((b) => b.w > 0 && b.h > 0 && b.d > 0));
  const inside = boxes.every((b) => b.minX >= -half - 1.01 && b.maxX <= half + 1.01 && b.minZ >= -half - 1.01 && b.maxZ <= half + 1.01);
  check('every box is inside the outer walls', inside);
  check('has at least 8 spawn points', map.spawns.length >= 8);
  const walls = boxes.filter((b) => b.kind === 'wall');
  check('four outer walls', walls.length === 4);
  check('outer walls are taller than anything a player can jump from', walls.every((w) => w.h >= 6));
}

section('Spawn points');
{
  let allFree = true, allInside = true, allFacing = true, minGap = Infinity;
  map.spawns.forEach((sp, i) => {
    const s = P.newPlayer(sp.x, sp.y, sp.z);
    if (P.firstOverlap(s, P.C.HEIGHT, boxes)) allFree = false;
    if (Math.abs(sp.x) > half - 0.5 || Math.abs(sp.z) > half - 0.5) allInside = false;
    const f = P.forwardVector(sp.yaw, 0);
    const len = Math.hypot(sp.x, sp.z);
    if (-(sp.x * f.x + sp.z * f.z) / len < 0.99) allFacing = false;   // should look at the centre
    for (let j = i + 1; j < map.spawns.length; j++) {
      minGap = Math.min(minGap, Math.hypot(sp.x - map.spawns[j].x, sp.z - map.spawns[j].z));
    }
  });
  check('no spawn point is inside a box', allFree);
  check('all spawn points are inside the map', allInside);
  check('all spawn points face the middle', allFacing);
  between('spawn points are spread out (closest pair, metres)', minGap, 10, 100);
}

section('Walkable area (flood fill at floor level)');
{
  const cell = 0.25;
  const n = Math.round(map.width / cell);
  const grid = new Uint8Array(n * n);   // 1 = a player can stand here
  const low = boxes.filter((b) => b.maxY > P.C.STEP + 0.001);   // steps lower than 0.55 m can be walked over
  const probe = P.newPlayer(0, 0, 0);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      probe.x = -half + (c + 0.5) * cell;
      probe.z = -half + (r + 0.5) * cell;
      let blocked = false;
      for (const b of low) if (P.overlaps(probe, P.C.HEIGHT, b)) { blocked = true; break; }
      if (Math.abs(probe.x) > half - P.C.RADIUS || Math.abs(probe.z) > half - P.C.RADIUS) blocked = true;
      grid[r * n + c] = blocked ? 0 : 1;
    }
  }
  const seen = new Uint8Array(n * n);
  const flood = (r0, c0) => {
    const stack = [r0 * n + c0];
    let count = 0;
    seen[r0 * n + c0] = 1;
    while (stack.length) {
      const k = stack.pop();
      count++;
      const r = (k / n) | 0, c = k % n;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const kk = rr * n + cc;
        if (grid[kk] && !seen[kk]) { seen[kk] = 1; stack.push(kk); }
      }
    }
    return count;
  };
  const cellOf = (v) => Math.floor((v + half) / cell);
  const start = map.spawns[0];
  const mainArea = flood(cellOf(start.z), cellOf(start.x));
  let totalFree = 0;
  for (let i = 0; i < grid.length; i++) totalFree += grid[i];
  const reached = (sp) => seen[cellOf(sp.z) * n + cellOf(sp.x)] === 1;
  check('every spawn point can walk to every other one', map.spawns.every(reached));
  const sealed = totalFree - mainArea;
  check('no sealed-off floor pockets bigger than 1 square metre', sealed * cell * cell < 1, (sealed * cell * cell).toFixed(2) + ' m2 sealed');
  const freePct = 100 * totalFree * cell * cell / (map.width * map.depth);
  between('open floor is between 55% and 90% of the map', freePct, 55, 90);
  console.log('       (open floor: ' + freePct.toFixed(1) + '%, sealed: ' + (sealed * cell * cell).toFixed(2) + ' m2)');
  // Is there at least one narrow lane (a gap a player can squeeze through, under 2 m)?
  const narrow = (() => {
    // Look for places where a 2.0 m wide probe cannot fit but the 0.8 m player can.
    let found = 0;
    const wide = P.newPlayer(0, 0, 0);
    for (let r = 0; r < n; r += 2) {
      for (let c = 0; c < n; c += 2) {
        if (!grid[r * n + c]) continue;
        // count free cells to the left and right along X
        let l = 0, rt = 0;
        while (c - l - 1 >= 0 && grid[r * n + c - l - 1]) l++;
        while (c + rt + 1 < n && grid[r * n + c + rt + 1]) rt++;
        const width = (l + rt + 1) * cell + 2 * P.C.RADIUS;
        if (width > 0.8 && width < 2.0) found++;
      }
    }
    return found;
  })();
  check('has narrow lanes (gaps between 0.8 m and 2 m wide)', narrow > 20, narrow + ' cells');
}

section('Practice targets');
{
  let free = true;
  for (const d of map.dummies) {
    const s = P.newPlayer(d.x, d.y, d.z);
    if (P.firstOverlap(s, P.C.HEIGHT, boxes)) free = false;
  }
  check('no practice target is inside a box', free);
  const cat = map.dummies.find((d) => d.y > 2);
  const under = boxes.find((b) => cat && Math.abs(b.maxY - cat.y) < 1e-6 && cat.x > b.minX && cat.x < b.maxX && cat.z > b.minZ && cat.z < b.maxZ);
  check('the catwalk target stands on the catwalk', !!under && under.kind === 'platform');
}

section('Stairs and the catwalk');
{
  // Start at the bottom of the stairs, walk north.
  const s = P.newPlayer(17.5, 0, 14.8);
  run(s, { yaw: 0 }, 0.3);
  let rise = 0;
  run(s, { yaw: 0, moveZ: 1 }, 5, (st) => { rise += st.stepRise; });
  near('walking forward up the stairs reaches the catwalk (2.9 m)', s.y, 2.9, 1e-6);
  check('player is on the catwalk platform area', s.z < 7 && s.z > -7 && s.x > 16 && s.x < 19, 'x=' + s.x + ' z=' + s.z);
  near('total step height climbed matches', rise, 2.9, 1e-6);
  // Walk on and hit the north rail: should stop before the rail.
  run(s, { yaw: 0, moveZ: 1 }, 4);
  check('the north rail stops you', s.z > -7 && s.y === 2.9, 'z=' + s.z);
  // Jump over the inner rail (1.0 m) and fall to the yard. Yaw +90 deg faces -X.
  const u = P.newPlayer(16.7, 2.9, 0); u.onGround = true;
  run(u, { yaw: Math.PI / 2, moveZ: 1, jump: true }, 0.35);
  run(u, { yaw: Math.PI / 2, moveZ: 1 }, 1.2);
  check('you can vault the 1.0 m rail and drop to the yard', u.x < 15.5 && u.y === 0, 'x=' + u.x + ' y=' + u.y);
}

section('Crate stairs up to a container roof');
{
  // blue container at (-11.5, -8.5) roof 2.6; crates at (-11.2,-6.7) 1.0 m and (-10,-6.7) 2.0 m
  // A sensible player: jump, hold the direction until the feet are above the target top, then let go.
  const hopTo = (p, yaw, targetTop) => {
    p.jumpLatch = false;
    let released = false;
    const n = Math.round(1.2 / DT);
    for (let i = 0; i < n; i++) {
      if (p.y > targetTop + 0.1) released = true;
      P.stepPlayer(p, { yaw, moveZ: released ? 0 : 1, jump: i < 3 }, DT, boxes);
    }
  };
  const s = P.newPlayer(-11.2, 0, -5.0);
  run(s, { yaw: 0 }, 0.3);
  hopTo(s, 0, 1.0);
  check('hop onto the 1.0 m crate', s.onGround && Math.abs(s.y - 1.0) < 1e-6, 'y=' + s.y + ' x=' + s.x + ' z=' + s.z);
  hopTo(s, -Math.PI / 2, 2.0);   // face +X, toward the 2.0 m crate
  check('hop onto the 2.0 m crate', s.onGround && Math.abs(s.y - 2.0) < 1e-6, 'y=' + s.y + ' x=' + s.x + ' z=' + s.z);
  hopTo(s, 0, 2.6);              // face -Z, toward the container
  check('hop onto the container roof (2.6 m)', s.onGround && Math.abs(s.y - 2.6) < 1e-6, 'y=' + s.y + ' x=' + s.x + ' z=' + s.z);
  // ... and the roof is NOT reachable from the floor or from the 1.0 m crate alone
  const t = P.newPlayer(-12.5, 0, -5.0);
  run(t, { yaw: 0 }, 0.3);
  hopTo(t, 0, 2.6);
  check('the roof cannot be reached straight from the floor', t.y < 0.5, 'y=' + t.y);
}

process.exit(summary('map') ? 0 : 1);

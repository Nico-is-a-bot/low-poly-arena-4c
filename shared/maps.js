/*
 * shared/maps.js
 *
 * Map layouts stored as DATA: a list of boxes. The browser builds the 3D scene
 * from this list, and the same list is used for walking and for blocking bullets
 * (on the server too, from Stage 2). That is how collision always matches what
 * you see.
 *
 * A box is { x, y, z, w, h, d, c, kind }
 *   x, z = centre on the floor     y = bottom height
 *   w = size along X, h = height, d = size along Z
 *   c = colour (only used for drawing), kind = look of the box (only used for drawing)
 *
 * The map is centred on (0, 0). A 40 m map spans -20 to +20 on both X and Z.
 * North is -Z (top of the minimap), east is +X.
 *
 * Helpers such as stairs() just add normal boxes to the list, so stairs and
 * "ramps" are made of many small steps (the player walks up steps up to 0.55 m).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ArenaShared = root.ArenaShared || {};
    root.ArenaShared.Maps = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ helpers

  function makeBuilder() {
    const boxes = [];
    const add = (x, y, z, w, h, d, c, kind) => {
      const b = { x, y, z, w, h, d, c, kind: kind || 'block' };
      boxes.push(b);
      return b;
    };
    return { boxes, add };
  }

  /**
   * Stairs. (sx, sz) is the middle of the bottom edge, dir is the way you walk
   * while going up ('+x', '-x', '+z' or '-z'). Each step is a solid block from the
   * floor so there are no gaps underneath.
   */
  function stairs(add, sx, sz, dir, width, totalRise, steps, run, color) {
    const stepRise = totalRise / steps;
    for (let i = 0; i < steps; i++) {
      const along = (i + 0.5) * run;
      const h = (i + 1) * stepRise;
      let x = sx, z = sz, w, d;
      if (dir === '-z')      { z = sz - along; w = width; d = run; }
      else if (dir === '+z') { z = sz + along; w = width; d = run; }
      else if (dir === '-x') { x = sx - along; w = run; d = width; }
      else                   { x = sx + along; w = run; d = width; }
      add(x, 0, z, w, h, d, color, 'stair');
    }
  }

  // ------------------------------------------------------ Container Yard

  function buildContainerYard() {
    const { boxes, add } = makeBuilder();

    const COL = {
      red: '#b5483a', blue: '#3b6ea5', green: '#4f8a5b', yellow: '#d9a441',
      white: '#c9ccd1', orange: '#d9772b',
      wall: '#575c64', crate: '#a07a45', barrier: '#8d9198',
      steel: '#3a3f47', catwalk: '#6a707a', stair: '#5d636c',
    };
    const CL = 6, CW = 2.4, CH = 2.6;  // shipping container length, width, height

    // along: true = long side runs east-west (X); false = runs north-south (Z)
    const cont = (x, z, alongX, color, level) => {
      add(x, (level || 0) * CH, z, alongX ? CL : CW, CH, alongX ? CW : CL, color, 'container');
    };
    const crate = (x, z, size, h, level) => {
      add(x, level || 0, z, size, h === undefined ? size : h, size, COL.crate, 'crate');
    };
    const barrier = (x, z, w, d) => add(x, 0, z, w, 1.1, d, COL.barrier, 'barrier');

    // Outer walls (inside faces are at +-20, so the play area is exactly 40 x 40)
    add(0, 0, -20.5, 42, 6, 1, COL.wall, 'wall');
    add(0, 0, 20.5, 42, 6, 1, COL.wall, 'wall');
    add(-20.5, 0, 0, 1, 6, 40, COL.wall, 'wall');
    add(20.5, 0, 0, 1, 6, 40, COL.wall, 'wall');

    // North row
    cont(-14, -16.5, true, COL.red, 0);
    cont(-14, -16.5, true, COL.blue, 1);
    cont(-4, -17, true, COL.green, 0);
    cont(6, -16.5, true, COL.yellow, 0);
    cont(15, -14.5, false, COL.orange, 0);

    // North-middle row (note the narrow lane between the white and blue containers)
    cont(-17, -8, false, COL.white, 0);
    cont(-11.5, -8.5, true, COL.blue, 0);
    cont(-2, -9.5, false, COL.red, 0);
    cont(-2, -9.5, false, COL.yellow, 1);
    cont(8, -7.5, true, COL.green, 0);

    // Crate "stairs" to the roof of the blue container: jump 1.0 -> 2.0 -> roof (2.6)
    crate(-11.2, -6.7, 1.2, 1.0);
    crate(-10, -6.7, 1.2, 2.0);

    // Centre: low cover, nothing taller than a person
    crate(0, 0, 1.4, 1.4);
    crate(1.5, 0.9, 1.0, 1.0);
    crate(-1.4, -1.0, 1.2, 1.2);
    barrier(-7, 0.5, 3.5, 0.5);
    barrier(7, -0.5, 3.5, 0.5);

    // South-middle row
    cont(-16.5, 8.5, false, COL.orange, 0);
    cont(-9, 7.5, true, COL.white, 0);
    cont(-2, 9, false, COL.blue, 0);
    cont(6, 7.8, true, COL.red, 0);

    // South row (narrow lane between the red and blue containers on the right)
    cont(-14, 16.5, true, COL.yellow, 0);
    cont(-14, 16.5, true, COL.green, 1);
    cont(-4, 17, true, COL.white, 0);
    cont(5.5, 15, false, COL.red, 0);
    cont(11.5, 17, true, COL.blue, 0);

    // The raised catwalk on the east side: platform top is at 2.9 m
    add(17.5, 2.6, 0, 3, 0.3, 14, COL.catwalk, 'platform');
    for (const z of [-6.85, -3.5, 0, 3.5, 6.85]) {
      add(16.15, 0, z, 0.3, 2.6, 0.3, COL.steel, 'post');
      add(18.85, 0, z, 0.3, 2.6, 0.3, COL.steel, 'post');
    }
    // Railings 1.0 m tall (low enough to jump over)
    add(16.05, 2.9, 0, 0.1, 1.0, 14, COL.steel, 'rail');
    add(18.95, 2.9, 0, 0.1, 1.0, 14, COL.steel, 'rail');
    add(17.5, 2.9, -6.95, 3, 1.0, 0.1, COL.steel, 'rail');
    // Stairs up to the catwalk (10 steps of 0.29 m), walking north
    stairs(add, 17.5, 14, '-z', 2.6, 2.9, 10, 0.7, COL.stair);
    // Cover underneath
    crate(17.5, -3, 1.2, 1.2);

    // Spawn points: they face the middle of the map
    const spawnAt = (x, z) => ({ x, y: 0, z, yaw: Math.atan2(x, z) });
    const spawns = [
      spawnAt(-18, -18), spawnAt(18, -18), spawnAt(-18, 18), spawnAt(18, 18),
      spawnAt(0, -19), spawnAt(0, 19), spawnAt(-19, 0), spawnAt(12, 0),
    ];

    // Practice targets for the single-player stage (the server ignores these)
    const dummies = [
      { x: 3, y: 0, z: -3.5, yaw: Math.atan2(-3, 3.5) },                       // stands still
      { x: 2, y: 0, z: -11.5, patrol: { x: 12, z: -11.5 }, speed: 1.8 },       // walks back and forth
      { x: -9.5, y: 0, z: 12.5, yaw: 0 },                                      // waits in the south-west lane
      { x: 17.5, y: 2.9, z: -5, yaw: Math.PI / 2 },                            // on the catwalk
    ];

    return {
      id: 'container_yard',
      name: 'Container Yard',
      size: 'Small',
      width: 40,
      depth: 40,
      players: '2 to 4',
      description: 'Stacked shipping containers, narrow lanes and one raised catwalk. Best for SMGs and shotguns.',
      theme: {
        sky: '#b4c3cf', skyTop: '#6f93b8',
        fog: '#b4c3cf', fogNear: 35, fogFar: 120,
        ground: '#74777c', groundLine: '#62656a',
        hemiSky: '#dbe6f0', hemiGround: '#6a6258',
        sun: '#fff0d4',
        sunDir: [-0.45, 0.85, 0.35],
      },
      boxes,
      spawns,
      dummies,
    };
  }

  // ------------------------------------------------------------ registry

  const MAPS = {};
  MAPS.container_yard = buildContainerYard();

  function get(id) {
    const m = MAPS[id];
    if (!m) throw new Error('Unknown map: ' + id);
    return m;
  }

  function list() {
    return Object.keys(MAPS).map((k) => MAPS[k]);
  }

  return { get, list, MAPS };
});

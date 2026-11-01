// Test helper: starts the game server and lets a test script move players around or read
// their server-side state by sending one JSON command per line on stdin.
const { createServer } = require('../server');
const P = require('../shared/physics');

const port = parseInt(process.env.PORT, 10) || 3112;
const server = createServer();
server.listen(port, () => console.log(JSON.stringify({ ready: port })));
const room = server.room;

if (process.env.DEBUG_SHOTS) {
  const C = require('../shared/combat');
  const orig = room.resolveShot.bind(room);
  room.resolveShot = (p, ev, cmd) => {
    const eye = p.phys.y + C.eyeHeight(p.phys);
    const dir = C.shotDirection(cmd.yaw, cmd.pitch, ev.spreadDeg, p.salt, ev.shotIndex);
    const others = [...room.players.values()].filter((q) => q !== p).map((q) => [q.name, q.phys.x, q.phys.z, q.alive, q.invulnUntil - room.now()]);
    console.log(JSON.stringify({ dbg: 'shot', who: p.name, pos: [p.phys.x, eye, p.phys.z], yaw: cmd.yaw, pitch: cmd.pitch, spread: ev.spreadDeg, dir, vt: cmd.vt, now: room.now(), others }));
    return orig(p, ev, cmd);
  };
}

const byName = (n) => [...room.players.values()].find((p) => p.name === n);

require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
  let c;
  try { c = JSON.parse(line); } catch (e) { return; }
  let out = { ok: true };
  if (c.cmd === 'place') {
    const p = byName(c.name);
    if (p) { p.phys = P.newPlayer(c.x, c.y || 0, c.z); p.invulnUntil = 0; if (c.hp) p.hp = c.hp; }
    else out = { ok: false, error: 'no player ' + c.name };
  } else if (c.cmd === 'gren') {
    const p = byName(c.name);
    if (p) room.sim.spawn(p.id, c.type, { x: c.x, y: c.y === undefined ? 0.12 : c.y, z: c.z, vx: c.vx || 0, vy: c.vy || 0, vz: c.vz || 0 });
    else out = { ok: false, error: 'no player ' + c.name };
  } else if (c.cmd === 'respawn') {
    const p = byName(c.name);
    if (p) room.respawn(p); else out = { ok: false, error: 'no player ' + c.name };
  } else if (c.cmd === 'zgrab') {            // test helper: set how long Godzilla has held someone (negative = freeze the hold)
    const p = byName(c.name);
    if (p && p.zil) p.zil.grabT = c.v; else out = { ok: false };
  } else if (c.cmd === 'max') {
    room.maxPlayers = c.n;
  } else if (c.cmd === 'state') {
    out.gstuck = room.sim.list.map((g) => (g.stuck ? (g.stuck === 'wall' ? 'wall' : g.stuck.id) : null));
    out.ngren = room.sim.list.length; out.domes = room.world.domes.length; out.mines = room.world.mines.length; out.strikes = room.world.strikes.length; out.strikePos = room.world.strikes.map((q) => [q.x, q.z]); out.zones = room.sim.zones.length;
    out.players = [...room.players.values()].map((p) => ({
      name: p.name, id: p.id, hp: p.hp, alive: p.alive, kills: p.kills, deaths: p.deaths,
      x: p.phys.x, y: p.phys.y, z: p.phys.z, epoch: p.epoch, mag: p.weapon.slots[p.weapon.cur].mag, cur: p.weapon.cur, ids: p.weapon.ids, lastSeq: p.lastSeq, gcount: p.weapon.gcount, grenade: p.weapon.grenade, abl: p.weapon.abl, acd: p.weapon.acd, boost: p.weapon.boost, armor: p.abil.armor, heal: p.abil.heal, surge: p.abil.surge, scan: p.abil.scan, cloak: p.abil.cloak, reveal: p.abil.reveal, grabbedBy: p.grabbedBy, zil: p.zil ? { breath: p.zil.breath, grab: p.zil.grab, grabCd: p.zil.grabCd, stompCd: p.zil.stompCd } : null, y2: p.phys.y, speed: Math.hypot(p.phys.vx, p.phys.vz),
    }));
  }
  console.log(JSON.stringify({ id: c.id, ...out }));
});

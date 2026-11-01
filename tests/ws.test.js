// Talks to the real server over a real WebSocket, the way a browser does.
const WebSocket = require('ws');
const { check, section, summary } = require('./harness');
const { createServer } = require('../server');
const C = require('../shared/combat');

function client(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const c = { ws, msgs: [], closed: false };
    ws.on('message', (d) => c.msgs.push(JSON.parse(d.toString())));
    ws.on('close', () => { c.closed = true; });
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
    c.send = (o) => ws.send(JSON.stringify(o));
    c.all = (t) => c.msgs.filter((m) => m.t === t);
    c.last = (t) => { const a = c.all(t); return a.length ? a[a.length - 1] : null; };
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  section('WebSocket server');
  const a = await client(port);
  a.send({ t: 'join', name: 'Alice' });
  await wait(300);
  const welcome = a.last('welcome');
  check('joining gives a welcome', welcome && welcome.id === 1 && welcome.name === 'Alice');
  check('welcome tells the map and weapon', welcome.mapId === 'container_yard' && welcome.lo && welcome.lo.primary === 'ar7');
  const snaps = a.all('snap').length;
  check('snapshots arrive about 30 times a second', snaps >= 6 && snaps <= 14, snaps + ' in 0.3 s');

  a.send({ t: 'ping', c: 123.5 });
  await wait(100);
  const pong = a.last('pong');
  check('ping gets a pong with the same number and a server time', pong && pong.c === 123.5 && typeof pong.s === 'number');

  // the first message must be a join: anything else is ignored
  const sneaky = await client(port);
  sneaky.send({ t: 'cmds', c: [] });
  sneaky.send({ t: 'ping', c: 1 });
  await wait(150);
  check('messages before joining are ignored', sneaky.msgs.length === 0);

  // garbage does not crash anything
  sneaky.ws.send('this is not json');
  sneaky.ws.send(JSON.stringify([1, 2, 3]));
  sneaky.ws.send(JSON.stringify({ t: 'join', name: 12345 }));
  await wait(200);
  check('bad data is shrugged off and a later join still works', sneaky.last('welcome') && sneaky.last('welcome').name === '12345', JSON.stringify(sneaky.last('welcome')));
  sneaky.send({ t: 'cmds', c: [null, 5, 'x', { s: 1 }, { s: 1, e: 1, y: 'a', p: 0, f: 0 }] });
  sneaky.send({ t: 'cmds', c: 'nope' });
  await wait(100);
  check('bad commands are ignored', !sneaky.closed && a.last('snap'));

  // a real command moves a player
  const w = sneaky.last('welcome');
  const x0 = sneaky.last('snap').you.ph.x;
  for (let i = 1; i <= 30; i++) sneaky.send({ t: 'cmds', c: [C.packCmd({ seq: i, epoch: 1, moveX: 0, moveZ: 1, yaw: w.spawn.yaw, pitch: 0 })] });
  await wait(250);
  const s2 = sneaky.last('snap');
  check('commands are acknowledged', s2.you.ack === 30, s2.you.ack);
  check('and the player moved on the server', Math.hypot(s2.you.ph.x - w.spawn.x, s2.you.ph.z - w.spawn.z) > 0.5);
  check('other players show up in snapshots', s2.p.length === 2);

  // too big a message closes the connection
  const big = await client(port);
  big.send({ t: 'join', name: 'Big' });
  big.ws.send('x'.repeat(40000));
  await wait(300);
  check('oversized messages are refused', big.closed);

  // leaving with bye
  sneaky.send({ t: 'bye' });
  await wait(200);
  check('"bye" removes the player at once', a.last('leave') && a.last('leave').id === sneaky.last('welcome').id);

  // full room
  const extra = [];
  for (let i = 0; i < 3; i++) { const c = await client(port); c.send({ t: 'join', name: 'P' + i }); extra.push(c); await wait(60); }
  await wait(200);
  const fifth = await client(port);
  fifth.send({ t: 'join', name: 'Fifth' });
  await wait(300);
  check('the fifth connection is told the room is full and closed', fifth.last('error') && /full/i.test(fifth.last('error').msg) && fifth.closed);

  // closing the socket removes the player
  a.ws.close();
  await wait(300);
  check('a dropped connection frees the slot', server.room.players.size === 3, server.room.players.size);

  [...extra].forEach((c) => c.ws.close());
  server.close();
  server.room.stop();
  setTimeout(() => process.exit(summary('websocket') ? 0 : 1), 100);
})().catch((e) => { console.error(e); process.exit(1); });

// Starts the server on a random port and checks the basics.
const http = require('http');
const { check, section, summary } = require('./harness');
const { createServer } = require('../server');

function get(port, path) {
  return new Promise((resolve, reject) => {
    // Raw socket request so "../" is not tidied up before it reaches the server.
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  section('Server');
  let r = await get(port, '/');
  check('/ serves the game page', r.status === 200 && r.type.includes('text/html') && r.body.includes('Low-Poly'), r.status);
  r = await get(port, '/shared/physics.js');
  check('/shared/physics.js is JavaScript', r.status === 200 && r.type.includes('javascript'), r.type);
  r = await get(port, '/shared/maps.js');
  check('/shared/maps.js is JavaScript', r.status === 200 && r.type.includes('javascript'), r.type);
  r = await get(port, '/shared/weapons.js');
  check('/shared/weapons.js is JavaScript', r.status === 200 && r.type.includes('javascript'), r.type);
  r = await get(port, '/js/main.js');
  check('/js/main.js is JavaScript', r.status === 200 && r.type.includes('javascript'), r.type);
  r = await get(port, '/css/style.css');
  check('/css/style.css is CSS', r.status === 200 && r.type.includes('css'), r.type);
  r = await get(port, '/healthz');
  check('/healthz answers 200', r.status === 200, r.status);
  r = await get(port, '/nope.txt');
  check('unknown file gives 404', r.status === 404, r.status);
  r = await get(port, '/../server.js');
  check('path traversal is refused', r.status === 403 || r.status === 404, r.status);
  r = await get(port, '/%2e%2e/package.json');
  check('encoded path traversal is refused', (r.status === 403 || r.status === 404) && !r.body.includes('low-poly-arena'), r.status);
  r = await get(port, '/shared/../../etc/passwd');
  check('deep path traversal is refused', r.status === 403 || r.status === 404, r.status);

  server.close();
  process.exit(summary('server') ? 0 : 1);
})();

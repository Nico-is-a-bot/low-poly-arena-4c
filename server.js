/*
 * server.js
 *
 * A small web server: it serves the game page (public/) and the shared game
 * code (shared/), and runs the multiplayer room over WebSocket (path /ws).
 *
 * Start with:  npm install   then   npm start
 * The port comes from the PORT environment variable (hosts like Render set it
 * for you); on your own computer it defaults to 3000.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Room } = require('./server/room');
const { attach } = require('./server/ws');

const PUBLIC_DIR = path.join(__dirname, 'public');
const SHARED_DIR = path.join(__dirname, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

/** Turn a request path into a file path inside `root`, or null if it tries to escape. */
function resolveInside(root, relativePath) {
  const full = path.normalize(path.join(root, relativePath));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function handleRequest(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  } catch (e) {
    return send(res, 400, 'Bad request');
  }
  if (pathname.indexOf('\0') !== -1) return send(res, 400, 'Bad request');

  // Health check (hosts such as Render can ping this)
  if (pathname === '/healthz') return send(res, 200, 'ok');

  let file;
  if (pathname.startsWith('/shared/')) {
    file = resolveInside(SHARED_DIR, pathname.slice('/shared/'.length));
  } else {
    if (pathname === '/') pathname = '/index.html';
    file = resolveInside(PUBLIC_DIR, pathname.slice(1));
  }
  if (!file) return send(res, 403, 'Forbidden');

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not found');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function createServer(options) {
  const opts = options || {};
  const server = http.createServer(handleRequest);
  const room = new Room({ log: opts.log, maxPlayers: opts.maxPlayers });
  attach(server, room);
  server.room = room;
  server.on('listening', () => room.start());
  server.on('close', () => room.stop());
  return server;
}

if (require.main === module) {
  const port = parseInt(process.env.PORT, 10) || 3000;
  createServer({ log: (line) => console.log(line) }).listen(port, () => {
    console.log('Low-Poly Arena is running.');
    console.log('Open this in your browser:  http://localhost:' + port);
    const lan = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
    }
    if (lan.length) {
      console.log('Friends on the same Wi-Fi or network can join at:');
      lan.forEach((ip) => console.log('  http://' + ip + ':' + port));
    }
    console.log('(Press Ctrl+C in this window to stop it.)');
  });
}

module.exports = { createServer };

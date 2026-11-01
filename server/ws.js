// Connects real WebSocket clients to a Room.
'use strict';
const { WebSocketServer } = require('ws');

function attach(httpServer, room) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false });

  wss.on('connection', (socket) => {
    let player = null;
    const conn = {
      send(obj) { if (socket.readyState === 1) socket.send(JSON.stringify(obj)); },
      close() { try { socket.close(); } catch (e) { /* already closed */ } },
    };
    socket.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (!player) {
        if (msg.t === 'join') player = room.addPlayer(conn, msg.name, msg.lo);
        return;
      }
      room.handleMessage(player, msg);
    });
    socket.on('close', () => { if (player) room.removePlayer(player); });
    socket.on('error', () => { /* the close handler cleans up */ });
  });
  return wss;
}

module.exports = { attach };

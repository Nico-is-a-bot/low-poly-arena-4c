// The connection to the game server (WebSocket), plus a running estimate of the server's clock.
// The clock matters: other players are drawn a moment in the past, and shots tell the server
// which moment the shooter was looking at.

export class Net {
  /** handlers: { open, message(msg), close(reason) } */
  constructor(handlers) {
    this.h = handlers;
    this.socket = null;
    this.offset = 0;            // server time minus client time, in ms
    this.rtt = 0;               // round trip time, in ms
    this.samples = [];
    this.pingTimer = null;
    this.haveClock = false;
    this.closedByUs = false;
    // For testing: open the page as /?lag=120 to pretend the connection has 120 ms ping.
    const lag = parseInt(new URLSearchParams(location.search).get('lag'), 10);
    this.fakeDelay = lag > 0 ? Math.min(lag, 1000) / 2 : 0;
  }

  static url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws';
  }

  connect(name, loadout) {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.socket = new WebSocket(Net.url());
      } catch (e) {
        reject(new Error('Could not open a connection to the game server.'));
        return;
      }
      const ws = this.socket;
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'join', name, lo: loadout }));
        this.startPings();
        settled = true;
        resolve();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        const deliver = () => {
          if (msg.t === 'pong') { this.onPong(msg); return; }
          if (msg.t === 'welcome') this.setClockFromServer(msg.st);
          this.h.message(msg);
        };
        if (this.fakeDelay) setTimeout(deliver, this.fakeDelay); else deliver();
      };
      ws.onerror = () => {
        if (!settled) { settled = true; reject(new Error('Could not reach the game server. Is it running? (Start it with npm start.)')); }
      };
      ws.onclose = () => {
        this.stopPings();
        const tell = () => { if (!this.closedByUs) this.h.close('The connection to the server was lost.'); };
        if (this.fakeDelay) setTimeout(tell, this.fakeDelay + 20); else tell();
      };
    });
  }

  send(obj) {
    const text = JSON.stringify(obj);
    const go = () => { if (this.socket && this.socket.readyState === 1) this.socket.send(text); };
    if (this.fakeDelay) setTimeout(go, this.fakeDelay); else go();
  }

  close() {
    this.closedByUs = true;
    this.stopPings();
    this.send({ t: 'bye' });
    const shut = () => { try { if (this.socket) this.socket.close(); } catch (e) { /* ignore */ } };
    if (this.fakeDelay) setTimeout(shut, this.fakeDelay + 20); else shut();
  }

  get connected() { return !!this.socket && this.socket.readyState === 1; }

  /** Estimated server time right now, in ms. */
  serverNow() { return performance.now() + this.offset; }

  setClockFromServer(st) {
    // a rough first guess (assumes about 25 ms one way); pings refine it
    this.offset = st + 25 - performance.now();
    this.haveClock = true;
  }

  startPings() {
    const ping = () => this.send({ t: 'ping', c: performance.now() });
    [0, 120, 260, 420, 600].forEach((ms) => setTimeout(ping, ms));
    this.pingTimer = setInterval(ping, 2000);
  }

  stopPings() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  onPong(msg) {
    const now = performance.now();
    const rtt = now - msg.c;
    if (!(rtt >= 0) || rtt > 5000) return;
    const sample = { rtt, offset: msg.s + rtt / 2 - now };
    this.samples.push(sample);
    if (this.samples.length > 8) this.samples.shift();
    // trust the sample with the smallest round trip (least queuing delay)
    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    this.offset = this.haveClock && this.samples.length > 1 ? this.offset + (best.offset - this.offset) * 0.3 : best.offset;
    this.haveClock = true;
    this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
  }
}

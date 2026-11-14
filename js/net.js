// Conexión entre dos navegadores con PeerJS (WebRTC). Quien crea la sala recibe
// un código corto; el otro lo escribe para unirse. El servidor público de PeerJS
// solo los presenta: después los mensajes van directo de un equipo al otro.
SM.Net = (function () {
  const PREFIX = 'mercado-criaturas-v1-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I
  const CODE_LENGTH = 6;

  function available() { return typeof window.Peer === 'function'; }

  function randomCode() {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return code;
  }

  function cleanCode(text) {
    return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function describe(err) {
    switch (err && err.type) {
      case 'peer-unavailable': return 'No hay ninguna sala con ese código (o ya se cerró).';
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed': return 'No se pudo llegar al servidor de emparejamiento. Revisa la conexión a internet.';
      case 'browser-incompatible': return 'Este navegador no permite jugar en red.';
      default: return 'Error de conexión' + (err && err.type ? ` (${err.type})` : '') + '.';
    }
  }

  // handlers: onReady(code) solo anfitrión, onOpen(), onMessage(msg), onClose(), onError(texto)
  class Link {
    constructor(handlers) {
      this.h = handlers;
      this.peer = null;
      this.conn = null;
      this.done = false;
    }

    host(tries = 0) {
      const code = randomCode();
      const peer = this.peer = new window.Peer(PREFIX + code);
      peer.on('open', () => this.h.onReady && this.h.onReady(code));
      peer.on('connection', conn => {
        if (this.conn) { conn.on('open', () => conn.close()); return; } // la sala ya tiene dos
        this.attach(conn);
      });
      peer.on('error', err => {
        if (err.type === 'unavailable-id' && tries < 3) { peer.destroy(); this.host(tries + 1); return; }
        // Si ya hay partida, un fallo del servidor de emparejamiento no la corta.
        if (this.conn && this.conn.open && err.type !== 'peer-unavailable') return;
        this.fail(err);
      });
    }

    join(code) {
      const peer = this.peer = new window.Peer();
      peer.on('open', () => this.attach(peer.connect(PREFIX + cleanCode(code), { reliable: true })));
      peer.on('error', err => {
        if (this.conn && this.conn.open) return;
        this.fail(err);
      });
    }

    attach(conn) {
      this.conn = conn;
      conn.on('open', () => this.h.onOpen && this.h.onOpen());
      conn.on('data', msg => { if (!this.done && this.h.onMessage) this.h.onMessage(msg); });
      conn.on('close', () => this.lost());
      conn.on('error', () => this.lost());
    }

    send(msg) {
      if (this.conn && this.conn.open) this.conn.send(msg);
    }

    lost() {
      if (this.done) return;
      this.close();
      if (this.h.onClose) this.h.onClose();
    }

    fail(err) {
      if (this.done) return;
      this.close();
      if (this.h.onError) this.h.onError(describe(err));
    }

    close() {
      this.done = true;
      try { if (this.conn) this.conn.close(); } catch (e) { /* ya cerrada */ }
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* ya cerrado */ }
    }
  }

  return { available, cleanCode, Link, CODE_LENGTH };
})();

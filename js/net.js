// Conexión entre navegadores con PeerJS (WebRTC). Quien crea la sala recibe
// un código corto; los demás (hasta 3) lo escriben para unirse. El servidor público de PeerJS
// solo los presenta: después los mensajes van directo de un equipo al otro.
SM.Net = (function () {
  const PREFIX = 'mercado-criaturas-v2-'; // v2: salas de hasta 4 jugadores
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

  // Anfitrión: acepta hasta maxGuests invitados (cada uno con su id).
  //   handlers: onReady(code), onGuestOpen(id), onMessage(msg, id), onGuestLeft(id), onError(texto)
  // Invitado: una sola conexión, con el anfitrión.
  //   handlers: onOpen(), onMessage(msg), onClose(), onError(texto)
  class Link {
    constructor(handlers) {
      this.h = handlers;
      this.peer = null;
      this.conn = null;          // invitado: conexión con el anfitrión
      this.guests = new Map();   // anfitrión: id -> conexión
      this.maxGuests = 1;
      this.done = false;
    }

    host(maxGuests = 1, tries = 0) {
      this.maxGuests = maxGuests;
      const code = randomCode();
      const peer = this.peer = new window.Peer(PREFIX + code);
      peer.on('open', () => this.h.onReady && this.h.onReady(code));
      peer.on('connection', conn => {
        if (this.done || this.guests.size >= this.maxGuests) { conn.on('open', () => conn.close()); return; } // sala llena
        this.guests.set(conn.peer, conn);
        conn.on('open', () => { if (!this.done && this.h.onGuestOpen) this.h.onGuestOpen(conn.peer); });
        conn.on('data', msg => { if (!this.done && this.h.onMessage) this.h.onMessage(msg, conn.peer); });
        const left = () => {
          if (this.guests.get(conn.peer) !== conn) return;
          this.guests.delete(conn.peer);
          if (!this.done && this.h.onGuestLeft) this.h.onGuestLeft(conn.peer);
        };
        conn.on('close', left);
        conn.on('error', left);
      });
      peer.on('error', err => {
        if (err.type === 'unavailable-id' && tries < 3) { peer.destroy(); this.host(maxGuests, tries + 1); return; }
        // Con invitados conectados, un fallo del servidor de emparejamiento no corta la partida.
        if (this.guests.size && err.type !== 'peer-unavailable') return;
        this.fail(err);
      });
    }

    join(code) {
      const peer = this.peer = new window.Peer();
      peer.on('open', () => {
        const conn = this.conn = peer.connect(PREFIX + cleanCode(code), { reliable: true });
        conn.on('open', () => this.h.onOpen && this.h.onOpen());
        conn.on('data', msg => { if (!this.done && this.h.onMessage) this.h.onMessage(msg); });
        conn.on('close', () => this.lost());
        conn.on('error', () => this.lost());
      });
      peer.on('error', err => {
        if (this.conn && this.conn.open) return;
        this.fail(err);
      });
    }

    // Invitado: al anfitrión. Anfitrión: a todos los invitados, o solo a uno (to).
    send(msg, to = null) {
      if (this.conn) { if (this.conn.open) this.conn.send(msg); return; }
      this.guests.forEach((conn, id) => { if ((to == null || id === to) && conn.open) conn.send(msg); });
    }

    // Anfitrión: echa a un invitado (por ejemplo, si llega con la partida ya empezada).
    kick(id) {
      const conn = this.guests.get(id);
      this.guests.delete(id);
      try { if (conn) conn.close(); } catch (e) { /* ya cerrada */ }
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
      this.guests.forEach(conn => { try { conn.close(); } catch (e) { /* ya cerrada */ } });
      this.guests.clear();
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* ya cerrado */ }
    }
  }

  return { available, cleanCode, Link, CODE_LENGTH };
})();

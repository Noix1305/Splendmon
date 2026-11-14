// Animaciones de la partida. No cambia el juego: compara el estado antes y
// después de cada cambio y anima la diferencia (fichas y cartas que vuelan,
// cartas nuevas en la mesa, avisos de turno y evolución, confeti al final).
SM.Fx = (function () {
  const C = SM.Config;
  const FLIGHT_MS = 560;
  const MAX_GEMS_PER_COLOR = 6;

  let prev = null;
  let layer = null;
  let toastTimer = null;

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function getLayer() {
    if (!layer || !layer.isConnected) {
      layer = document.createElement('div');
      layer.className = 'fx-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.append(layer);
    }
    return layer;
  }

  // ---------- Estado resumido

  function summarize(g) {
    const ids = list => list.filter(Boolean).map(c => c.uid);
    const market = new Set();
    C.TIERS.forEach(t => g.market[t].forEach(c => { if (c) market.add(c.uid); }));
    return {
      game: g, current: g.current, phase: g.phase, finalRound: g.finalRound, market,
      players: g.players.map(p => ({
        tokens: Object.assign({}, p.tokens),
        cards: ids(p.cards), reserved: ids(p.reserved), under: ids(p.under),
        points: g.pointsOf(p),
      })),
    };
  }

  // Dónde estaba cada carta en pantalla antes de redibujar.
  function capture() {
    const root = document.getElementById('game');
    const cards = new Map();
    const decks = {};
    if (root && !root.hidden) {
      root.querySelectorAll('[data-uid]').forEach(n => cards.set(n.dataset.uid, { rect: n.getBoundingClientRect(), node: n }));
      root.querySelectorAll('[data-deck]').forEach(n => { decks[n.dataset.deck] = n.getBoundingClientRect(); });
    }
    return { cards, decks };
  }

  // ---------- Piezas de animación

  // Hace volar un nodo desde un rectángulo de pantalla hasta otro, en arco.
  function fly(node, from, to, delay, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'fx-fly';
    wrap.append(node);
    getLayer().append(wrap);
    wrap.style.left = from.left + 'px';
    wrap.style.top = from.top + 'px';
    const own = wrap.getBoundingClientRect();
    if (!own.width || !own.height) { wrap.remove(); return; }
    const s0 = from.width / own.width;
    const s1 = to.width / own.width;
    const dx = to.left - from.left + (to.width - own.width * s1) / 2;
    const dy = to.top - from.top + (to.height - own.height * s1) / 2;
    const spin = opts.spin || 0;
    const lift = opts.lift ?? 60;
    const peak = Math.max(s0, s1) * 1.08;
    wrap.animate([
      { transform: `translate(0, 0) scale(${s0}) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${dx / 2}px, ${dy / 2 - lift}px) scale(${peak}) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s1}) rotate(${spin}deg)`, opacity: opts.fade ? 0.2 : 1 },
    ], { duration: opts.duration || FLIGHT_MS, delay, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'both' })
      .finished.then(() => wrap.remove(), () => wrap.remove());
  }

  function rectAround(el, size) {
    const r = el.getBoundingClientRect();
    return { left: r.left + r.width / 2 - size / 2, top: r.top + r.height / 2 - size / 2, width: size, height: size };
  }

  // Oculta el destino hasta que llega lo que vuela, y luego lo hace "saltar".
  function landOn(target, at) {
    if (!target) return;
    target.animate([{ opacity: 0 }, { opacity: 0 }], { duration: at });
    target.animate([
      { transform: 'scale(.6)' }, { transform: 'scale(1.15)', offset: 0.6 }, { transform: 'scale(1)' },
    ], { duration: 320, delay: at, easing: 'ease-out' });
  }

  function bump(el, at) {
    if (!el) return;
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }],
      { duration: 260, delay: at, easing: 'ease-out' });
  }

  function gemNode(gem) {
    const n = document.createElement('span');
    n.className = 'gem fx-gem';
    n.style.setProperty('--gem', C.GEM_INFO[gem].color);
    n.style.setProperty('--gem-ink', C.GEM_INFO[gem].ink);
    if (C.GEM_INFO[gem].img) {
      n.classList.add('ball');
      const img = new Image();
      img.src = C.GEM_INFO[gem].img;
      img.alt = '';
      n.append(img);
    }
    return n;
  }

  function flyGem(gem, fromEl, toEl, delay) {
    if (!fromEl || !toEl) return;
    fly(gemNode(gem), rectAround(fromEl, 44), rectAround(toEl, 44), delay, { lift: 40, duration: 460 });
  }

  // Copia limpia de una carta para hacerla volar.
  function cardClone(node) {
    const c = node.cloneNode(true);
    c.classList.remove('clickable', 'affordable', 'small', 'big');
    c.querySelectorAll('.afford-tag').forEach(t => t.remove());
    c.removeAttribute('tabindex');
    c.removeAttribute('data-uid');
    c.style.removeProperty('--rx');
    c.style.removeProperty('--ry');
    return c;
  }

  function floatText(el, text, at, cls) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const n = document.createElement('div');
    n.className = 'fx-float ' + (cls || '');
    n.textContent = text;
    n.style.left = r.left + r.width / 2 + 'px';
    n.style.top = r.top + 'px';
    getLayer().append(n);
    n.animate([
      { transform: 'translate(-50%, 0) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%, -18px) scale(1.2)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -46px) scale(1)', opacity: 0 },
    ], { duration: 1200, delay: at, easing: 'ease-out', fill: 'both' })
      .finished.then(() => n.remove(), () => n.remove());
  }

  // Anillo y chispas alrededor de un elemento (evolución).
  function burst(el, at, color) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const ring = document.createElement('div');
    ring.className = 'fx-ring';
    ring.style.left = cx + 'px';
    ring.style.top = cy + 'px';
    ring.style.setProperty('--fx', color);
    getLayer().append(ring);
    ring.animate([
      { transform: 'translate(-50%, -50%) scale(.2)', opacity: 1 },
      { transform: 'translate(-50%, -50%) scale(3.2)', opacity: 0 },
    ], { duration: 800, delay: at, easing: 'ease-out', fill: 'both' }).finished.then(() => ring.remove(), () => ring.remove());

    for (let i = 0; i < 14; i++) {
      const s = document.createElement('div');
      s.className = 'fx-spark';
      s.style.left = cx + 'px';
      s.style.top = cy + 'px';
      s.style.setProperty('--fx', color);
      getLayer().append(s);
      const a = (i / 14) * Math.PI * 2;
      const d = 40 + Math.random() * 40;
      s.animate([
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.2)`, opacity: 0 },
      ], { duration: 700, delay: at, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' }).finished.then(() => s.remove(), () => s.remove());
    }
  }

  // Aviso grande en el centro (evolución, última ronda).
  function banner(text, at, cls) {
    const n = document.createElement('div');
    n.className = 'fx-banner ' + (cls || '');
    n.textContent = text;
    getLayer().append(n);
    n.animate([
      { transform: 'translate(-50%, -50%) scale(.5)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.08)', opacity: 1, offset: 0.15 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.8 },
      { transform: 'translate(-50%, -60%) scale(1)', opacity: 0 },
    ], { duration: 1700, delay: at, easing: 'ease-out', fill: 'both' }).finished.then(() => n.remove(), () => n.remove());
  }

  // Aviso pequeño arriba (cambio de turno). Uno nuevo reemplaza al anterior.
  function toast(text, at) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      const old = getLayer().querySelector('.fx-toast');
      if (old) old.remove();
      const n = document.createElement('div');
      n.className = 'fx-toast';
      n.textContent = text;
      getLayer().append(n);
      n.animate([
        { transform: 'translate(-50%, -30px)', opacity: 0 },
        { transform: 'translate(-50%, 0)', opacity: 1, offset: 0.15 },
        { transform: 'translate(-50%, 0)', opacity: 1, offset: 0.8 },
        { transform: 'translate(-50%, -30px)', opacity: 0 },
      ], { duration: 1600, easing: 'ease-out', fill: 'both' }).finished.then(() => n.remove(), () => n.remove());
    }, at);
  }

  function confetti() {
    const colors = Object.values(C.GEM_INFO).map(i => i.color);
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = 0; i < 90; i++) {
      const n = document.createElement('div');
      n.className = 'fx-confetti';
      n.style.background = colors[i % colors.length];
      n.style.left = Math.random() * w + 'px';
      getLayer().append(n);
      const drift = (Math.random() - 0.5) * 240;
      const turns = (Math.random() * 3 + 1) * 360;
      n.animate([
        { transform: 'translate(0, -20px) rotate(0deg)', opacity: 1 },
        { transform: `translate(${drift}px, ${h + 40}px) rotate(${turns}deg)`, opacity: 0.9 },
      ], { duration: 2200 + Math.random() * 1800, delay: Math.random() * 600, easing: 'cubic-bezier(.25,.6,.4,1)', fill: 'both' })
        .finished.then(() => n.remove(), () => n.remove());
    }
  }

  // Reparte las cartas de la mesa al empezar la partida.
  function dealMarket() {
    document.querySelectorAll('#market .card').forEach((n, i) => {
      n.animate([
        { transform: 'translateY(-40px) rotateY(90deg) scale(.85)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ], { duration: 480, delay: 80 + i * 55, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
  }

  // ---------- Comparación antes / después

  // me: índice del jugador que en esta pantalla es "Tú" (o null).
  function play(before, g, me = null) {
    const now = summarize(g);
    const old = prev;
    prev = now;
    if (reduced()) return;
    if (!old || old.game !== g) { dealMarket(); return; }

    const nameOf = uid => (g.cards.get(uid) || {}).name || '';
    const marketCard = uid => document.querySelector(`#market [data-uid="${uid}"]`);
    let gemDelay = 0;
    let landed = 0;

    g.players.forEach((p, i) => {
      const a = old.players[i];
      const b = now.players[i];
      const area = document.querySelector(`.player-area[data-player="${i}"]`);
      if (!a || !area) return;

      // Cartas capturadas o evolucionadas.
      const evolvedFrom = b.under.filter(u => !a.under.includes(u));
      b.cards.filter(u => !a.cards.includes(u)).forEach(uid => {
        const target = area.querySelector(`.mini[data-uid="${uid}"]`);
        const src = before.cards.get(uid);
        if (src && target) fly(cardClone(src.node), src.rect, target.getBoundingClientRect(), 0, { spin: -8 });
        landOn(target, FLIGHT_MS);
        landed = FLIGHT_MS;
        if (evolvedFrom.length) {
          const card = g.cards.get(uid);
          burst(target, FLIGHT_MS, card ? C.GEM_INFO[card.gem].color : '#fff');
          banner(`¡${nameOf(evolvedFrom[0])} evoluciona a ${nameOf(uid)}!`, FLIGHT_MS - 100, 'evolve');
        }
      });

      // Cartas reservadas (de la mesa o del mazo oculto).
      b.reserved.filter(u => !a.reserved.includes(u)).forEach(uid => {
        const target = area.querySelector(`.reserved [data-uid="${uid}"]`);
        if (!target) return;
        const src = before.cards.get(uid);
        const card = g.cards.get(uid);
        const deckRect = card && before.decks[card.tier];
        const from = src ? src.rect : deckRect;
        if (from) fly(cardClone(src ? src.node : target), from, target.getBoundingClientRect(), 0, { spin: 6 });
        landOn(target, FLIGHT_MS);
        landed = FLIGHT_MS;
      });

      // Fichas: del banco al jugador o de vuelta.
      const bankOf = gem => document.querySelector(`.bank-token[data-gem="${gem}"]`);
      [...C.GEMS, C.WILD].forEach(gem => {
        const diff = b.tokens[gem] - a.tokens[gem];
        if (!diff) return;
        const col = area.querySelector(`.gem-col[data-gem="${gem}"]`);
        const n = Math.min(Math.abs(diff), MAX_GEMS_PER_COLOR);
        for (let k = 0; k < n; k++) {
          const at = gemDelay;
          gemDelay += 90;
          if (diff > 0) flyGem(gem, bankOf(gem), col, at);
          else flyGem(gem, col, bankOf(gem), at);
        }
        bump(diff > 0 ? col && col.querySelector('.gem') : bankOf(gem), gemDelay + 400);
      });

      // Puntos ganados.
      if (b.points > a.points) {
        const pts = area.querySelector('.stat-points');
        floatText(pts, `+${b.points - a.points}`, FLIGHT_MS, 'points');
        bump(pts, FLIGHT_MS + 100);
      }
    });

    // Cartas nuevas en la mesa: llegan después de que se va la anterior.
    now.market.forEach(uid => {
      if (old.market.has(uid)) return;
      const n = marketCard(uid);
      if (!n) return;
      n.animate([
        { transform: 'translateY(-30px) rotateY(90deg) scale(.85)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ], { duration: 460, delay: 260, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });

    const settle = Math.max(landed, gemDelay + 300);
    if (!old.finalRound && now.finalRound && now.phase !== 'over') banner('¡Última ronda!', settle, 'final');
    if (now.phase === 'over' && old.phase !== 'over') {
      setTimeout(confetti, settle);
    } else if (now.current !== old.current && now.phase !== 'over') {
      toast(g.current === me ? 'Tu turno' : `Turno de ${g.currentPlayer.name}`, settle);
    }
  }

  function reset() {
    prev = null;
    clearTimeout(toastTimer);
    if (layer) layer.textContent = '';
  }

  // ---------- Inclinación 3D de las cartas al pasar el mouse

  let tilted = null;
  function clearTilt() {
    if (!tilted) return;
    tilted.style.removeProperty('--rx');
    tilted.style.removeProperty('--ry');
    tilted = null;
  }
  document.addEventListener('pointermove', e => {
    const card = e.target.closest ? e.target.closest('.card.clickable') : null;
    if (card !== tilted) clearTilt();
    if (!card || e.pointerType !== 'mouse' || reduced()) return;
    tilted = card;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--ry', ((x - 0.5) * 18).toFixed(1) + 'deg');
    card.style.setProperty('--rx', ((0.5 - y) * 18).toFixed(1) + 'deg');
    card.style.setProperty('--mx', (x * 100).toFixed(0) + '%');
    card.style.setProperty('--my', (y * 100).toFixed(0) + '%');
  });
  document.addEventListener('pointerleave', clearTilt);

  return { capture, play, reset };
})();

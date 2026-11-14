// Interfaz: muestra la partida y convierte los clics en acciones del juego.
(function () {
  const C = SM.Config;
  const $ = sel => document.querySelector(sel);

  // En red: role es 'host' (ejecuta la partida) o 'guest' (envía jugadas y recibe el estado).
  // local es el jugador que se controla desde este equipo y se dibuja abajo.
  const state = {
    cards: null, typeGroups: C.DEFAULT_TYPE_GEMS, setup: null, game: null, selection: [], aiTimer: null,
    net: null, role: null, local: 0,
    catalogTier: 'all',
    testMode: false,
  };

  // Modo prueba: solo en partidas locales (en red el invitado no puede cambiar el estado).
  const testing = () => state.testMode && !!state.game && !state.role;

  // Lo único que el invitado puede pedirle al anfitrión.
  const NET_ACTIONS = ['takeTokens', 'reserve', 'buy', 'pass', 'evolve', 'skipEvolution', 'returnToken',
    'buyItem', 'swapTokens', 'useLens', 'reservePeek', 'usePotion', 'sellNugget', 'useDowsing', 'useTicket'];

  // ---------- Piezas comunes

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function button(label, cls, onClick, disabled = false) {
    const b = el('button', cls, label);
    b.type = 'button';
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  function makeClickable(node, onClick, label) {
    node.classList.add('clickable');
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', onClick);
    node.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
    });
  }

  function gemEl(gem, count, small = false) {
    const info = C.GEM_INFO[gem];
    const e = el('span', 'gem' + (small ? ' small' : '') + (info.img ? ' ball' : ''));
    e.style.setProperty('--gem', info.color);
    e.style.setProperty('--gem-ink', info.ink);
    if (info.img) {
      const img = new Image();
      img.src = info.img;
      img.alt = '';
      img.draggable = false;
      e.append(img);
    }
    if (count != null) e.append(el('span', 'gem-count', String(count)));
    e.title = info.label;
    return e;
  }

  function initials(name) {
    return name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?';
  }

  function artEl(card) {
    const box = el('div', 'card-art');
    const placeholder = el('div', 'card-placeholder', initials(card.name));
    box.append(placeholder);
    // Usa el recorte ajustado si existe; si falla, la imagen original.
    const src = card.thumb || card.img;
    if (src) {
      const img = new Image();
      img.alt = card.name;
      img.referrerPolicy = 'no-referrer';
      img.onload = () => placeholder.remove();
      img.onerror = () => {
        if (card.thumb && card.img && img.src.indexOf(card.img) === -1) { img.src = card.img; box.classList.remove('cropped'); }
        else img.remove();
      };
      if (card.thumb) box.classList.add('cropped');
      img.src = src;
      box.append(img);
    }
    return box;
  }

  // Desde el punto de vista de quién se calcula lo que falta: el jugador de turno si
  // lo controla este equipo; si no, el jugador local.
  function costViewer() {
    const g = state.game;
    if (!g || g.phase === 'over') return null;
    return controls(g.currentPlayer) ? g.currentPlayer : g.players[state.local];
  }

  // Lo que falta de cada pokébola, después de bonificaciones y de las que tienes en mano.
  // La Master Ball cuenta aparte: aquí no se usa como comodín para cubrir otros tipos.
  function missingFor(p, card) {
    const g = state.game;
    const bonus = g.bonusOf(p);
    const out = {};
    C.GEMS.forEach(gem => { out[gem] = Math.max(0, (card.cost[gem] || 0) - bonus[gem] - p.tokens[gem]); });
    out[C.WILD] = Math.max(0, (card.cost[C.WILD] || 0) - p.tokens[C.WILD]);
    return out;
  }

  function cardEl(card, opts = {}) {
    const info = C.GEM_INFO[card.gem];
    const e = el('div', `card tier-${card.tier}` + (opts.size ? ' ' + opts.size : ''));
    e.dataset.uid = card.uid;
    e.style.setProperty('--gem', info.color);
    e.style.setProperty('--gem-ink', info.ink);

    const head = el('div', 'card-head');
    head.append(el('span', 'card-points', card.points ? String(card.points) : ''));
    const bonus = el('span', 'card-bonus');
    for (let i = 0; i < card.bonus; i++) bonus.append(gemEl(card.gem, null, true));
    head.append(bonus);
    // Evolución arriba al centro: miniatura de la criatura + pokébola con lo que pide.
    if (card.evolutions.length) {
      const n = card.evolutions.length;
      const thumbs = el('div', 'evo-thumbs' + (n > 2 ? ' many' : n === 2 ? ' two' : ''));
      card.evolutions.forEach(ev => {
        const t = el('div', 'evo-thumb');
        t.style.setProperty('--gem', C.GEM_INFO[ev.gem].color);
        t.style.setProperty('--gem-ink', C.GEM_INFO[ev.gem].ink);
        t.title = `Evoluciona a ${ev.name} con ${ev.count} bonificaciones de ${C.GEM_INFO[ev.gem].label}`;
        const pic = el('div', 'evo-pic');
        pic.append(artEl(ev));
        const req = gemEl(ev.gem, ev.count, true);
        req.classList.add('evo-req');
        t.append(pic, req);
        thumbs.append(t);
      });
      head.append(thumbs);
    }
    e.append(head, artEl(card), el('div', 'card-name', card.name));

    // En partida: cuántas pokébolas te faltan de cada tipo (✓ si ya lo cubres).
    // Fuera de partida (catálogo en el inicio): el costo completo.
    const foot = el('div', 'card-foot');
    const cost = el('div', 'card-cost');
    const viewer = opts.fullCost ? null : costViewer();
    const missing = viewer ? missingFor(viewer, card) : null;
    [...C.GEMS, C.WILD].forEach(g => {
      if (!card.cost[g]) return;
      if (!missing) { cost.append(gemEl(g, card.cost[g], true)); return; }
      const ball = gemEl(g, missing[g] ? missing[g] : '✓', true);
      ball.classList.add(missing[g] ? 'lacking' : 'met');
      ball.title = missing[g] ? `Te faltan ${missing[g]} ${C.GEM_INFO[g].label}` : `${C.GEM_INFO[g].label}: lo tienes cubierto`;
      cost.append(ball);
    });
    if (missing) cost.classList.add('as-missing');
    foot.append(cost);
    e.append(foot);

    // Se puede capturar ya: etiqueta dorada sobre la imagen (el borde verde se confundía con el Nivel 1).
    if (opts.affordable) {
      e.classList.add('affordable');
      e.querySelector(':scope > .card-art').append(el('span', 'afford-tag', '¡Captúralo!'));
    }
    if (opts.onClick) makeClickable(e, opts.onClick, card.name);
    return e;
  }

  // ---------- Reverso de los mazos: una pokébola distinta por nivel

  const BACK_BALL = { '1': 'poke', '2': 'great', '3': 'ultra', rare: 'premier', legend: 'master' };

  // Pokébola dibujada en SVG (nítida a cualquier tamaño). Los detalles van en la mitad de arriba.
  function ballSvg(kind) {
    const top = { poke: '#e3262f', great: '#2f6fd6', ultra: '#26272c', premier: '#f7f7f7', master: '#7b3fb3' }[kind];
    const band = kind === 'premier' ? '#e3262f' : '#1b1b1f';
    const extras = {
      great: '<path d="M8 22 Q13 9 25 6 L24 15 Q15 17 13 26Z M56 22 Q51 9 39 6 L40 15 Q49 17 51 26Z" fill="#e3262f"/>',
      ultra: '<path d="M15 6 h8 v13 h18 V6 h8 v26 h-8 v-6 H23 v6 h-8z" fill="#f5c518"/>',
      master: '<circle cx="15" cy="18" r="6.5" fill="#e05aa8"/><circle cx="49" cy="18" r="6.5" fill="#e05aa8"/>'
        + '<text x="32" y="22" font-size="15" font-weight="900" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif">M</text>',
    }[kind] || '';
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><clipPath id="bb-${kind}"><circle cx="32" cy="32" r="29"/></clipPath>`
      + `<radialGradient id="bs-${kind}" cx="35%" cy="28%" r="45%"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`
      + `<g clip-path="url(#bb-${kind})"><rect width="64" height="32" fill="${top}"/>${extras}<rect y="32" width="64" height="32" fill="#f4f4f4"/>`
      + `<rect y="28.5" width="64" height="7" fill="${band}"/><circle cx="32" cy="32" r="29" fill="url(#bs-${kind})"/></g>`
      + `<circle cx="32" cy="32" r="29" fill="none" stroke="${band}" stroke-width="3.5"/><circle cx="32" cy="32" r="10" fill="${band}"/>`
      + `<circle cx="32" cy="32" r="6.5" fill="#fafafa"/><circle cx="32" cy="32" r="3.5" fill="none" stroke="#c9c9c9" stroke-width="1.5"/></svg>`;
  }

  function backEl(tier, count) {
    const e = el('div', `card back tier-${tier}`);
    e.dataset.ball = BACK_BALL[tier] || 'poke';
    e.append(el('span', 'back-label', C.TIER_LABELS[tier]));
    const ball = el('span', 'back-ball');
    ball.innerHTML = ballSvg(BACK_BALL[tier] || 'poke'); // SVG fijo, sin datos del usuario
    e.append(ball);
    if (count != null) {
      // Pila de cartas detrás: más gruesa cuantas más quedan (0 a 4 capas).
      e.dataset.stack = String(count ? Math.min(4, Math.ceil(count / 12)) : 0);
      if (!count) e.classList.add('deck-empty');
      e.append(el('span', 'back-count', count ? `${count} ${count === 1 ? 'carta' : 'cartas'}` : 'Vacío'));
      e.append(el('span', 'back-hint', 'Reservar oculta'));
    } else {
      // Sin contador (reservas ocultas, guía): se guarda su espacio para que la pokébola quede centrada.
      const spacer = el('span', 'back-count', '·');
      spacer.style.visibility = 'hidden';
      e.append(spacer);
    }
    return e;
  }

  function miniEl(card) {
    const e = el('div', 'mini');
    e.dataset.uid = card.uid;
    e.style.setProperty('--gem', C.GEM_INFO[card.gem].color);
    e.style.setProperty('--gem-ink', C.GEM_INFO[card.gem].ink);
    // Ficha de criatura capturada: sprite completo, nombre, puntos y bonificación.
    e.append(artEl(card), el('span', 'mini-name', card.name));
    if (card.points) e.append(el('span', 'mini-pts', String(card.points)));
    const bonus = el('span', 'mini-bonus');
    for (let i = 0; i < card.bonus; i++) bonus.append(gemEl(card.gem, null, true));
    e.append(bonus);
    e.title = `${card.name} · ${card.points} pts · +${card.bonus} ${C.GEM_INFO[card.gem].label}`;
    makeClickable(e, () => openCard(card), card.name);
    return e;
  }

  // ---------- Pantalla inicial

  function initSetup() {
    const input = $('#file-input');
    input.addEventListener('change', () => { if (input.files[0]) readFile(input.files[0]); input.value = ''; });

    const drop = $('#drop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('over');
      if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
    });

    const sample = $('#use-sample');
    if (window.SAMPLE_MONSTERS) sample.addEventListener('click', () => loadData(window.SAMPLE_MONSTERS, 'criaturas de ejemplo'));
    else sample.hidden = true;

    const type = $('#p2-type');
    const name2 = $('#p2-name');
    type.addEventListener('change', () => {
      if (name2.value === 'Máquina' || name2.value === 'Jugador 2') name2.value = type.value === 'ai' ? 'Máquina' : 'Jugador 2';
      name2.disabled = type.value === 'online';
      $('#start').textContent = type.value === 'online' ? 'Crear sala' : 'Empezar partida';
    });

    initPlayerName();
    $('#start').addEventListener('click', startGame);
    $('#join').addEventListener('click', joinRoom);
    $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
    $('#quit').addEventListener('click', () => {
      const msg = state.role ? '¿Salir de la partida? Se cortará la conexión con el otro jugador.' : '¿Salir de la partida?';
      if (confirm(msg)) backToSetup();
    });

    initCatalog();
    initThemes();
    initBackgrounds();
    renderLegend();

    // Servido desde un servidor web, intenta cargar monsters.json junto a la página.
    if (location.protocol.startsWith('http')) {
      fetch('monsters.json')
        .then(r => (r.ok ? r.json() : null))
        .then(json => { if (json && !state.cards) loadData(json, 'monsters.json'); })
        .catch(() => {});
    }
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try { loadData(JSON.parse(reader.result), file.name); }
      catch (err) { showLoadError('No se pudo leer el JSON: ' + err.message); }
    };
    reader.readAsText(file);
  }

  function loadData(json, source) {
    try {
      const result = SM.Cards.build(json);
      state.cards = result.cards;
      state.typeGroups = result.typeGroups;
      renderLegend();
      const box = $('#data-summary');
      box.textContent = '';
      box.append(el('p', 'ok', `${result.cards.length} criaturas cargadas (${source}).`));
      const list = el('ul', 'tier-counts');
      C.TIERS.forEach(t => list.append(el('li', null, `${C.TIER_LABELS[t]}: ${result.cards.filter(c => c.tier === t).length}`)));
      box.append(list);
      result.warnings.forEach(w => box.append(el('p', 'warn', w)));
      $('#start').disabled = !!state.role;
      $('#catalog-open').disabled = false;
    } catch (err) {
      showLoadError(err.message);
    }
  }

  function showLoadError(msg) {
    const box = $('#data-summary');
    box.textContent = '';
    box.append(el('p', 'warn', msg));
    if (!state.cards) $('#start').disabled = true;
  }

  function renderLegend() {
    const box = $('#legend');
    box.textContent = '';
    C.GEMS.forEach(g => {
      const row = el('div', 'legend-row');
      row.append(gemEl(g), el('strong', null, C.GEM_INFO[g].label), el('span', 'muted', state.typeGroups[g].join(', ') || '—'));
      box.append(row);
    });
    const wild = el('div', 'legend-row');
    wild.append(gemEl(C.WILD), el('strong', null, C.GEM_INFO[C.WILD].label), el('span', 'muted', 'Comodín. Se recibe al reservar; los raros y legendarios exigen pagar al menos una.'));
    box.append(wild);
  }

  function startGame() {
    if ($('#p2-type').value === 'online') { hostRoom(); return; }
    leaveNetwork();
    state.testMode = $('#test-mode').checked;
    state.setup = [
      { name: $('#p1-name').value.trim() || 'Jugador 1', ai: false },
      { name: $('#p2-name').value.trim() || 'Jugador 2', ai: $('#p2-type').value === 'ai' },
    ];
    newGame();
  }

  // En red, solo el anfitrión crea partidas (también la revancha) y se las envía al invitado.
  function newGame() {
    const game = new SM.Game(state.cards, state.setup);
    if (state.role === 'host') {
      const link = state.net;
      game.onChange(() => link.send({ t: 'state', s: game.snapshot() }));
      link.send({ t: 'start', cards: state.cards, s: game.snapshot() });
    }
    showGame(game);
  }

  function showGame(game) {
    clearTimeout(state.aiTimer);
    state.aiTimer = null;
    state.selection = [];
    if ($('#card-dialog').open) closeDialog();
    if ($('#catalog-dialog').open) $('#catalog-dialog').close();
    state.game = game;
    game.onChange(() => { state.selection = []; state.bike = null; render(); });
    $('#setup').hidden = true;
    $('#game').hidden = false;
    render();
  }

  function backToSetup() {
    clearTimeout(state.aiTimer);
    state.aiTimer = null;
    state.game = null;
    leaveNetwork();
    if ($('#card-dialog').open) closeDialog();
    if ($('#catalog-dialog').open) $('#catalog-dialog').close();
    SM.Fx.reset();
    $('#game').hidden = true;
    $('#game-over').hidden = true;
    $('#setup').hidden = false;
  }

  // ---------- Jugar en red

  function netStatus(sel, text, opts = {}) {
    const box = $(sel);
    box.textContent = '';
    box.hidden = !text;
    if (!text) return;
    box.append(el('p', opts.cls || null, text));
    if (opts.code) {
      box.append(el('span', 'room-code', opts.code));
      if (navigator.clipboard) {
        box.append(button('Copiar', 'secondary small', () => navigator.clipboard.writeText(opts.code).catch(() => {})));
      }
    }
    if (opts.cancel) box.append(button('Cancelar', 'secondary small', leaveNetwork));
  }

  function lockSetup(locked) {
    $('#start').disabled = locked || !state.cards;
    $('#p2-type').disabled = locked;
    $('#join').disabled = locked;
  }

  function netAvailable(sel) {
    if (SM.Net.available()) return true;
    netStatus(sel, 'No se pudo cargar la librería de red (PeerJS). Jugar en red necesita conexión a internet.', { cls: 'warn' });
    return false;
  }

  function hostRoom() {
    if (!netAvailable('#host-status')) return;
    leaveNetwork();
    const myName = $('#p1-name').value.trim() || 'Jugador 1';
    const link = new SM.Net.Link({
      onReady: code => {
        if (state.net !== link) return;
        netStatus('#host-status', 'Pásale este código a la otra persona. Esperando a que se una…', { code, cancel: true });
      },
      onMessage: msg => hostMessage(link, msg, myName),
      onClose: () => connectionLost(link),
      onError: text => connectionLost(link, text),
    });
    state.net = link;
    state.role = 'host';
    state.local = 0;
    lockSetup(true);
    netStatus('#host-status', 'Creando sala…', { cancel: true });
    link.host();
  }

  function hostMessage(link, msg, myName) {
    if (state.net !== link || !msg) return;
    if (msg.t === 'hello' && !state.game) {
      let guest = String(msg.name || '').trim().slice(0, 20) || 'Jugador 2';
      if (guest === myName) guest += ' (2)';
      state.setup = [{ name: myName, ai: false }, { name: guest, ai: false }];
      newGame();
    } else if (msg.t === 'act') {
      // El anfitrión vuelve a comprobar todo: el juego rechaza lo que no sea legal.
      const g = state.game;
      if (!g || g.current !== 1 || !NET_ACTIONS.includes(msg.m)) return;
      const args = msg.m === 'pass' ? [] : (Array.isArray(msg.args) ? msg.args : []);
      try { g[msg.m](...args); } catch (err) { /* jugada mal formada: se ignora */ }
    }
  }

  function joinRoom() {
    if (!netAvailable('#join-status')) return;
    const code = SM.Net.cleanCode($('#join-code').value);
    if (code.length !== SM.Net.CODE_LENGTH) {
      netStatus('#join-status', `El código de sala tiene ${SM.Net.CODE_LENGTH} letras o números.`, { cls: 'warn' });
      return;
    }
    leaveNetwork();
    const name = $('#join-name').value.trim() || 'Jugador 2';
    const link = new SM.Net.Link({
      onOpen: () => {
        if (state.net !== link) return;
        link.send({ t: 'hello', name });
        netStatus('#join-status', 'Conectado. Esperando a que empiece la partida…', { cancel: true });
      },
      onMessage: msg => guestMessage(link, msg),
      onClose: () => connectionLost(link),
      onError: text => connectionLost(link, text),
    });
    state.net = link;
    state.role = 'guest';
    state.local = 1;
    lockSetup(true);
    netStatus('#join-status', 'Conectando…', { cancel: true });
    link.join(code);
  }

  function guestMessage(link, msg) {
    if (state.net !== link || !msg) return;
    if (msg.t === 'start') {
      const game = SM.Game.fromSnapshot(msg.cards, msg.s);
      // Las jugadas del invitado se envían al anfitrión; el resultado vuelve como 'state'.
      NET_ACTIONS.forEach(m => {
        game[m] = (...args) => { link.send({ t: 'act', m, args }); return { ok: true }; };
      });
      showGame(game);
    } else if (msg.t === 'state' && state.game) {
      state.game.applySnapshot(msg.s);
    }
  }

  function leaveNetwork() {
    const link = state.net;
    state.net = null;
    state.role = null;
    state.local = 0;
    if (link) link.close();
    netStatus('#host-status', '');
    netStatus('#join-status', '');
    lockSetup(false);
  }

  function connectionLost(link, text) {
    if (state.net !== link) return;
    const sel = state.role === 'host' ? '#host-status' : '#join-status';
    const wasPlaying = !!state.game;
    backToSetup();
    netStatus(sel, text || (wasPlaying ? 'Se perdió la conexión con el otro jugador. La partida terminó.' : 'Se cerró la conexión.'), { cls: 'warn' });
  }

  // ---------- Partida

  // Si este equipo maneja a ese jugador (en red, solo al propio).
  function controls(p) {
    return !p.ai && (!state.role || p.index === state.local);
  }

  function canAct() {
    const g = state.game;
    return !!g && g.phase === 'action' && controls(g.currentPlayer);
  }

  function render() {
    if (!state.game) return;
    const before = SM.Fx.capture();
    const players = state.game.players;
    renderStatus();
    renderPlayer($('#area-p2'), players[1 - state.local]);
    renderPlayer($('#area-p1'), players[state.local]);
    renderBank();
    renderMarket();
    renderPrompt();
    renderLog();
    renderGameOver();
    SM.Fx.play(before, state.game, meIndex());
    scheduleAi();
  }

  function renderStatus() {
    const g = state.game;
    const box = $('#status');
    box.textContent = '';
    box.append(el('span', 'round', `Ronda ${g.round}`));
    box.append(el('span', null, g.phase === 'over' ? 'Partida terminada'
      : isMe(g.currentPlayer) ? 'Tu turno' : `Turno de ${g.currentPlayer.name}`));
    if (g.finalRound && g.phase !== 'over') box.append(el('span', 'badge', 'Última ronda'));
    if (state.role) box.append(el('span', 'muted', `En red · tu oponente te ve como «${g.players[state.local].name}»`));
  }

  function stat(label, value) {
    const s = el('span', 'stat');
    s.append(el('span', null, label + ' '), el('b', null, String(value)));
    return s;
  }

  function renderPlayer(box, p) {
    const g = state.game;
    box.textContent = '';
    box.dataset.player = p.index;
    box.classList.toggle('active', g.currentPlayer === p && g.phase !== 'over');

    const head = el('div', 'player-head');
    const aiTag = p.ai && !/máquina/i.test(p.name) ? ' (máquina)' : '';
    head.append(el('h2', null, displayName(p) + aiTag));
    const stats = el('div', 'player-stats');
    const points = stat('Puntos', `${g.pointsOf(p)} / ${C.TARGET_POINTS}`);
    points.classList.add('stat-points');
    stats.append(
      points,
      stat('Pokébolas', `${g.tokenCount(p)} / ${C.MAX_TOKENS}`),
      stat('Evoluciones', p.under.length),
      stat('Reservas', `${p.reserved.length} / ${C.MAX_RESERVED}`),
    );
    head.append(stats);
    box.append(head);

    const body = el('div', 'player-body');
    // Recuento por pokébola: en mano, generadas por tus capturas (permanentes) y total.
    const gems = el('div', 'player-gems ball-table');
    const bonus = g.bonusOf(p);
    const discarding = g.phase === 'discard' && g.currentPlayer === p && controls(p);
    const all = [...C.GEMS, C.WILD];
    gems.append(el('span', 'bt-label', ''));
    all.forEach(gem => {
      const col = el('div', 'gem-col');
      col.dataset.gem = gem;
      const token = gemEl(gem, null);
      if (discarding && p.tokens[gem] > 0) {
        makeClickable(token, () => g.returnToken(gem), `Devolver una ${C.GEM_INFO[gem].label}`);
      }
      col.append(token);
      col.title = C.GEM_INFO[gem].label;
      gems.append(col);
    });
    const row = (label, cls, value, title) => {
      const l = el('span', 'bt-label', label);
      l.title = title;
      gems.append(l);
      all.forEach(gem => {
        const v = value(gem);
        gems.append(el('span', 'bt-cell ' + cls + (v == null || v === 0 ? ' zero' : ''), v == null ? '—' : String(v)));
      });
    };
    row('En mano', 'hand', gem => p.tokens[gem], 'Pokébolas que tienes ahora (se gastan al capturar).');
    row('Capturas', 'gen', gem => (gem === C.WILD ? null : bonus[gem]), 'Pokébolas que generan tus Pokémon capturados en cada captura (permanentes).');
    row('Total', 'total', gem => p.tokens[gem] + (gem === C.WILD ? 0 : bonus[gem]), 'Lo que puedes pagar de cada tipo.');
    body.append(gems);

    const items = playerItemsEl(p);
    if (items) body.append(items);

    const captured = el('div', 'captured');
    if (!p.cards.length) captured.append(el('span', 'muted', 'Aún sin criaturas.'));
    p.cards.slice()
      .sort((a, b) => C.GEMS.indexOf(a.gem) - C.GEMS.indexOf(b.gem))
      .forEach(c => captured.append(miniEl(c)));
    body.append(captured);

    if (p.reserved.length) {
      const reserved = el('div', 'reserved');
      const showFace = state.role
        ? p.index === state.local
        : !p.ai && (p === g.currentPlayer || g.players.some(o => o.ai));
      p.reserved.forEach(c => {
        if (!showFace) {
          const back = backEl(c.tier);
          back.dataset.uid = c.uid;
          reserved.append(back);
          return;
        }
        const mine = canAct() && p === g.currentPlayer;
        reserved.append(cardEl(c, { size: 'small', onClick: () => openCard(c), affordable: mine && g.checkBuy(c.uid).ok }));
      });
      body.append(reserved);
    }
    box.append(body);
  }

  // Pokébolas extra que da la Bicicleta activada (0 si no).
  function bikeExtra() {
    const g = state.game;
    const inst = state.bike && g.ownedItem(g.currentPlayer, state.bike, 'take');
    return inst ? g.itemDef(inst).extra : 0;
  }

  // Se puede agregar esta pokébola a la selección (mismas reglas que el juego).
  function canAddGem(gem) {
    const g = state.game;
    const sel = state.selection;
    if (sel.includes(gem) && !(sel.length === 1 && sel[0] === gem)) return false;
    return !g.takeProblem([...sel, gem], bikeExtra(), false);
  }

  function clickBank(gem) {
    if (!canAct()) return;
    const sel = state.selection;
    // Tocar otra vez la única elegida = tomar 2 iguales; tocar una ya elegida = quitarla.
    if (sel.length === 1 && sel[0] === gem && canAddGem(gem)) sel.push(gem);
    else if (sel.includes(gem)) state.selection = sel.filter(x => x !== gem);
    else if (canAddGem(gem)) sel.push(gem);
    render();
  }

  function renderBank() {
    const g = state.game;
    const box = $('#bank');
    box.textContent = '';
    box.append(el('h3', null, 'Pokébolas disponibles'));
    const active = canAct();
    const stacks = el('div', 'bank-stacks');
    const sel = state.selection;
    [...C.GEMS, C.WILD].forEach(gem => {
      const count = sel.filter(x => x === gem).length;
      // Las ya elegidas siguen en color (se pueden quitar); las que no se pueden elegir, en blanco y negro.
      const pickable = active && (count > 0 || canAddGem(gem));
      const b = button('', 'bank-token' + (count ? ' selected' : '') + (pickable ? '' : ' unavailable'), () => clickBank(gem), !pickable);
      b.dataset.gem = gem;
      b.append(gemEl(gem, g.bank[gem]));
      if (count) b.append(el('span', 'sel-mark', '×' + count));
      b.setAttribute('aria-label', `${C.GEM_INFO[gem].label}: quedan ${g.bank[gem]}` + (pickable ? '' : ' (no se puede elegir)'));
      stacks.append(b);
    });
    box.append(stacks);

    if (active) {
      const opts = bikeExtra() ? { bike: state.bike } : {};
      const check = g.checkTake(state.selection, opts);
      const bar = el('div', 'take-bar');
      bar.append(button('Tomar pokébolas', 'primary', () => g.takeTokens(state.selection.slice(), opts), !check.ok));
      // Bicicleta: se activa aquí y permite tomar 1 más.
      const bike = g.currentPlayer.items.find(i => g.itemDef(i).use === 'take');
      if (bike) {
        const on = !!bikeExtra();
        const b = button(on ? '🚲 Bicicleta activada (+1)' : '🚲 Usar Bicicleta (+1)', on ? 'item-toggle on' : 'item-toggle', () => {
          state.bike = on ? null : bike.uid;
          state.selection = [];
          render();
        });
        b.setAttribute('aria-pressed', String(on));
        bar.append(b);
      }
      if (state.selection.length) bar.append(button('Limpiar', 'secondary', () => { state.selection = []; render(); }));
      box.append(bar);
      const hint = state.selection.length
        ? (check.ok ? 'Listo para tomar.' : check.reason)
        : bikeExtra()
          ? `Con Bicicleta: 4 pokébolas distintas o, si quedan mínimo ${C.MIN_BANK_FOR_DOUBLE} de ese tipo, 2 iguales y 1 distinta.`
          : `Puedes elegir 3 pokébolas distintas o, si quedan mínimo ${C.MIN_BANK_FOR_DOUBLE} de ese tipo, puedes elegir 2 iguales.`;
      box.append(el('p', 'hint', hint));
    }
  }

  function renderMarket() {
    const g = state.game;
    const box = $('#market');
    box.textContent = '';
    [['legend', 'rare'], ['3'], ['2'], ['1']].forEach(tiers => {
      const row = el('div', 'market-row');
      tiers.forEach(tier => {
        if (!g.market[tier].some(Boolean) && !g.decks[tier].length) return;
        const group = el('div', 'market-group');
        const deck = backEl(tier, g.decks[tier].length);
        deck.dataset.deck = tier;
        if (canAct() && C.RESERVABLE_TIERS.includes(tier) && g.checkReserve({ type: 'deck', tier }).ok) {
          makeClickable(deck, () => openDeck(tier), `Reservar una carta oculta del ${C.TIER_LABELS[tier]}`);
        }
        group.append(deck);
        g.market[tier].forEach(card => {
          group.append(card
            ? cardEl(card, { onClick: () => openCard(card), affordable: canAct() && g.checkBuy(card.uid).ok })
            : el('div', 'card empty-slot'));
        });
        row.append(group);
      });
      if (tiers[0] === 'legend') row.append(shopEl());
      if (row.childElementCount) box.append(row);
    });
  }

  // ---------- Objetos

  // Sprite del objeto; si no carga, queda el emoji.
  function itemIconEl(def) {
    const box = el('span', 'item-icon');
    if (!def.img) { box.textContent = def.icon; return box; }
    const img = new Image();
    img.className = 'item-sprite';
    img.alt = '';
    img.onerror = () => { img.remove(); box.textContent = def.icon; };
    img.src = def.img;
    box.append(img);
    return box;
  }

  // Carta de objeto: icono, nombre, costo y si es de un uso o permanente.
  function itemEl(inst, opts = {}) {
    const def = SM.Items.def(inst.id);
    const e = el('div', 'item-card' + (def.kind === 'relic' ? ' relic' : '') + (opts.size ? ' ' + opts.size : ''));
    e.dataset.item = inst.uid;
    e.append(el('span', 'item-kind', def.kind === 'relic' ? 'Permanente' : 'Un uso'));
    e.append(itemIconEl(def), el('span', 'item-name', def.name));
    if (opts.showCost !== false) {
      const cost = el('div', 'item-cost');
      [...C.GEMS].forEach(g => { if (inst.cost[g]) cost.append(gemEl(g, inst.cost[g], true)); });
      e.append(cost);
    }
    if (opts.affordable) e.classList.add('affordable');
    if (opts.onClick) makeClickable(e, opts.onClick, def.name);
    e.title = def.text;
    return e;
  }

  function itemBackEl() {
    const e = el('div', 'item-card back');
    e.append(el('span', 'item-icon', '🎒'), el('span', 'item-name', 'Objeto'));
    return e;
  }

  // Tienda: mazo de objetos + los que están a la vista.
  function shopEl() {
    const g = state.game;
    const group = el('div', 'market-group shop');
    const deck = el('div', 'item-card shop-deck');
    deck.append(el('span', 'item-icon', '🏪'), el('span', 'item-name', 'Tienda'), el('span', 'back-count', `${g.itemDeck.length} en el mazo`));
    group.append(deck);
    g.itemShop.forEach((inst, slot) => {
      group.append(inst
        ? itemEl(inst, { onClick: () => openItem(inst, { slot }), affordable: canAct() && g.checkBuyItem(slot).ok })
        : el('div', 'item-card empty-slot'));
    });
    return group;
  }

  // Ventana de un objeto: qué hace, cuánto cuesta y, según dónde esté, comprar o usar.
  function openItem(inst, where = {}) {
    const g = state.game;
    const def = SM.Items.def(inst.id);
    const body = $('#card-dialog-body');
    body.textContent = '';
    const layout = el('div', 'dialog-layout');
    layout.append(itemEl(inst, { size: 'big', showCost: where.slot != null && !where.browse }));
    const info = el('div', 'dialog-info');
    info.append(el('h2', null, `${def.icon} ${def.name}`));
    info.append(el('p', 'muted', def.kind === 'relic' ? 'Permanente: funciona solo y no ocupa espacio de objeto.' : `De un solo uso. Puedes guardar hasta ${C.MAX_ITEMS}.`));
    info.append(el('p', null, def.text));
    const actions = el('div', 'dialog-actions');
    const p = g ? g.currentPlayer : null;

    if (where.browse) {
      // Desde el catálogo: solo información.
      info.append(el('p', 'muted', `Cuesta ${def.price} pokébola${def.price > 1 ? 's' : ''}; los tipos cambian en cada partida. Se compra en la tienda de la mesa.`));
    } else if (where.slot != null) {
      info.append(el('p', 'muted', 'Se paga con pokébolas de tu mano (las de tus capturas no descuentan). La Master Ball sirve de comodín. Comprar es tu acción del turno.'));
      if (canAct()) {
        const check = g.checkBuyItem(where.slot);
        if (check.ok) info.append(paymentEl(check.pay));
        else info.append(el('p', 'warn', check.reason));
        actions.append(button('Comprar', 'primary', () => { closeDialog(); g.buyItem(where.slot); }, !check.ok));
      }
      if (testing()) {
        g.players.forEach(pl => actions.append(button(isMe(pl) ? 'Obtenerlo yo (prueba)' : `Dar a ${pl.name} (prueba)`, 'secondary', () => {
          closeDialog(); g.giveItem(where.slot, pl.index);
        })));
      }
    } else if (where.owner === p && canAct()) {
      // Cómo se usa cada objeto que tienes.
      const how = {
        evolve: 'Se usa al final de tu turno: cuando puedas evolucionar con él, aparecerá la opción.',
        capture: 'Se usa al capturar: abre un Pokémon y elige «Capturar con Cupón».',
        take: 'Se usa al tomar pokébolas: activa «Usar Bicicleta» junto al botón de tomar.',
        reserve: 'Se usa al reservar: toca un mazo de Nivel 1, 2 o 3 y elige «Usar Lupa».',
        passive: 'Funciona solo.',
        market: 'Se usa desde una carta de la mesa: ábrela y elige «Cambiar con Ticket Barco».',
      }[def.use];
      if (how) info.append(el('p', 'note', how));
      if (def.id === 'swap') actions.append(button('Usar ahora', 'primary', () => openSwap(inst)));
      if (def.id === 'nugget') actions.append(button('Vender ahora', 'primary', () => openNugget(inst)));
      if (def.id === 'potion') {
        const check = g.checkPotion(inst.uid);
        const back = g.potionRecovery(p);
        if (check.ok) info.append(el('p', 'ok', 'Recuperas: ' + back.map(x => C.GEM_INFO[x].label).join(', ')));
        else info.append(el('p', 'warn', check.reason));
        actions.append(button('Usar ahora', 'primary', () => { closeDialog(); g.usePotion(inst.uid); }, !check.ok));
      }
      if (def.use === 'action') {
        const check = g.checkDowsing(inst.uid);
        if (!check.ok) info.append(el('p', 'warn', check.reason));
        info.append(el('p', 'muted', 'Usarlo es tu acción del turno.'));
        actions.append(button('Usar ahora', 'primary', () => { closeDialog(); g.useDowsing(inst.uid); }, !check.ok));
      }
    }
    actions.append(button('Cerrar', 'secondary', closeDialog));
    info.append(actions);
    layout.append(info);
    body.append(layout);
    if (!$('#card-dialog').open) $('#card-dialog').showModal();
  }

  // Intercambiador: elegir qué das y qué recibes (hasta 2).
  function openSwap(inst) {
    const g = state.game;
    const def = SM.Items.def(inst.id);
    const p = g.currentPlayer;
    const give = []; const take = [];
    const body = $('#card-dialog-body');
    const draw = () => {
      body.textContent = '';
      const info = el('div', 'dialog-info swap');
      info.append(el('h2', null, `${def.icon} ${def.name}`));
      info.append(el('p', 'muted', `Elige hasta ${def.max} pokébolas para dar y la misma cantidad para recibir. Toca una elegida para quitarla.`));
      const rowOf = (label, list, from) => {
        const r = el('div', 'swap-row');
        r.append(el('b', null, label));
        C.GEMS.forEach(gem => {
          const n = list.filter(x => x === gem).length;
          const left = from[gem] - n;
          const b = button('', 'bank-token' + (n ? ' selected' : '') + (left > 0 && list.length < def.max ? '' : (n ? '' : ' unavailable')), () => {
            if (n && (left <= 0 || list.length >= def.max)) list.splice(list.indexOf(gem), 1);
            else if (left > 0 && list.length < def.max) list.push(gem);
            else if (n) list.splice(list.indexOf(gem), 1);
            draw();
          });
          b.append(gemEl(gem, from[gem]));
          if (n) b.append(el('span', 'sel-mark', '×' + n));
          r.append(b);
        });
        return r;
      };
      info.append(rowOf('Das (de tu mano)', give, p.tokens), rowOf('Recibes (disponibles)', take, g.bank));
      const check = g.checkSwap(inst.uid, give, take);
      if (give.length || take.length) info.append(el('p', check.ok ? 'ok' : 'warn', check.ok ? 'Listo.' : check.reason));
      const actions = el('div', 'dialog-actions');
      actions.append(
        button('Intercambiar', 'primary', () => { closeDialog(); g.swapTokens(inst.uid, give.slice(), take.slice()); }, !check.ok),
        button('Cancelar', 'secondary', closeDialog),
      );
      info.append(actions);
      body.append(info);
    };
    draw();
    if (!$('#card-dialog').open) $('#card-dialog').showModal();
  }

  // Pepita: elegir las pokébolas que recibes (se pueden repetir).
  function openNugget(inst) {
    const g = state.game;
    const def = SM.Items.def(inst.id);
    const want = g.nuggetCount(inst);
    const take = [];
    const body = $('#card-dialog-body');
    const draw = () => {
      body.textContent = '';
      const info = el('div', 'dialog-info swap');
      info.append(el('h2', null, `${def.icon} ${def.name}`));
      info.append(el('p', 'muted', `Elige ${want} pokébola(s) de las disponibles. Puedes repetir. Toca una elegida para quitar una.`));
      const r = el('div', 'swap-row');
      C.GEMS.forEach(gem => {
        const n = take.filter(x => x === gem).length;
        const left = g.bank[gem] - n;
        const can = left > 0 && take.length < want;
        const b = button('', 'bank-token' + (n ? ' selected' : '') + (can || n ? '' : ' unavailable'), () => {
          if (can) take.push(gem); else if (n) take.splice(take.indexOf(gem), 1);
          draw();
        });
        b.append(gemEl(gem, g.bank[gem]));
        if (n) b.append(el('span', 'sel-mark', '×' + n));
        r.append(b);
      });
      info.append(r);
      const check = g.checkNugget(inst.uid, take);
      const actions = el('div', 'dialog-actions');
      if (take.length) actions.append(button('Quitar todas', 'secondary', () => { take.length = 0; draw(); }));
      actions.append(
        button('Vender', 'primary', () => { closeDialog(); g.sellNugget(inst.uid, take.slice()); }, !check.ok),
        button('Cancelar', 'secondary', closeDialog),
      );
      info.append(actions);
      body.append(info);
    };
    draw();
    if (!$('#card-dialog').open) $('#card-dialog').showModal();
  }

  // Objetos de un jugador en su tablero. Los del rival se ven tapados (solo la cantidad);
  // los permanentes siempre se ven.
  function playerItemsEl(p) {
    const g = state.game;
    if (!p.items.length && !p.relics.length) return null;
    const box = el('div', 'player-items');
    box.append(el('span', 'bt-label', `Objetos ${p.items.length} / ${g.itemLimit(p)}`));
    const row = el('div', 'player-items-row');
    const showFace = state.role ? p.index === state.local : !p.ai && (p === g.currentPlayer || g.players.some(o => o.ai));
    p.items.forEach(inst => row.append(showFace
      ? itemEl(inst, { size: 'small', showCost: false, onClick: () => openItem(inst, { owner: p }) })
      : itemBackEl()));
    p.relics.forEach(inst => row.append(itemEl(inst, { size: 'small', showCost: false, onClick: () => openItem(inst, { owner: p }) })));
    box.append(row);
    return box;
  }

  function renderPrompt() {
    const g = state.game;
    const box = $('#prompt');
    box.textContent = '';
    const p = g.currentPlayer;
    if (g.phase === 'over') { box.hidden = true; return; }
    box.hidden = false;
    if (g.phase === 'peek' && !controls(p)) { box.append(el('p', null, `${p.name} está mirando un mazo con la Lupa…`)); return; }
    if (p.ai) { box.append(el('p', null, `${p.name} está pensando…`)); return; }
    if (!controls(p)) { box.append(el('p', null, `Esperando a ${p.name}…`)); return; }

    if (g.phase === 'peek' && p.peek) {
      box.append(el('p', null, `🔍 Lupa: elige cuál reservar de las ${p.peek.uids.length} cartas de arriba del ${C.TIER_LABELS[p.peek.tier]}. Las demás quedan en el mazo.`));
      const list = el('div', 'peek-options');
      p.peek.uids.forEach(uid => {
        const card = g.cards.get(uid);
        list.append(cardEl(card, { size: 'small', onClick: () => g.reservePeek(uid) }));
      });
      box.append(list);
      return;
    }

    if (g.phase === 'action') {
      box.append(el('p', null, `${isMe(p) ? 'Tu turno' : p.name}: toma pokébolas, reserva una carta o captura un Pokémon. Los que tienen la etiqueta «¡Captúralo!» ya los puedes capturar.`));
      if (!g.hasLegalAction()) box.append(button('Pasar turno', 'secondary', () => g.pass()));
    } else if (g.phase === 'evolve') {
      box.append(el('p', null, 'Puedes hacer evolucionar una criatura (gratis, una por turno):'));
      const list = el('div', 'evo-options');
      g.availableEvolutions().forEach(o => {
        const using = o.item ? ` · usa ${SM.Items.def(o.item.id).icon} ${SM.Items.def(o.item.id).name}` : '';
        list.append(button(`${o.base.name} → ${o.target.name} (${o.target.points} pts)${using}`, o.item ? 'secondary' : 'primary',
          () => g.evolve(o.base.uid, o.target.uid, o.item ? o.item.uid : null)));
      });
      list.append(button('No evolucionar', 'secondary', () => g.skipEvolution()));
      box.append(list);
      const first = list.querySelector('button');
      if (first) setTimeout(() => first.focus(), 0);
    } else if (g.phase === 'discard') {
      const extra = g.tokenCount(p) - C.MAX_TOKENS;
      box.append(el('p', 'warn', `Tienes ${g.tokenCount(p)} pokébolas (máximo ${C.MAX_TOKENS}): haz clic en las tuyas para devolver ${extra}.`));
    }
  }

  function renderLog() {
    const list = $('#log');
    list.textContent = '';
    state.game.log.slice(0, 40).forEach(entry => {
      const li = el('li', null, logText(entry));
      if (typeof entry === 'object' && entry.who === meIndex()) li.classList.add('log-me');
      list.append(li);
    });
  }

  function renderGameOver() {
    const g = state.game;
    const box = $('#game-over');
    if (g.phase !== 'over') { box.hidden = true; return; }
    box.hidden = false;
    box.textContent = '';
    const panel = el('div', 'overlay-panel');
    const r = g.result;
    panel.append(el('h2', null, r.tie ? '¡Empate!' : isMe(r.ranking[0]) ? '¡Ganaste!' : `¡Gana ${r.ranking[0].name}!`));
    const list = el('ol', 'ranking');
    r.ranking.forEach(p => {
      list.append(el('li', null, `${displayName(p)}: ${g.pointsOf(p)} puntos · ${p.under.length} evoluciones · ${p.cards.length} criaturas`));
    });
    panel.append(list);
    const actions = el('div', 'dialog-actions');
    if (state.role === 'guest') {
      panel.append(el('p', 'muted', `Si ${g.players[0].name} pide la revancha, se abrirá aquí automáticamente.`));
      actions.append(button('Salir', 'secondary', backToSetup));
    } else {
      actions.append(button('Revancha', 'primary', newGame), button(state.role ? 'Salir' : 'Cambiar ajustes', 'secondary', backToSetup));
    }
    panel.append(actions);
    box.append(panel);
  }

  function scheduleAi() {
    const g = state.game;
    if (state.aiTimer || !g || g.phase === 'over' || !g.currentPlayer.ai) return;
    state.aiTimer = setTimeout(() => {
      state.aiTimer = null;
      if (state.game === g) SM.Ai.step(g);
    }, C.AI_DELAY_MS);
  }

  // ---------- Ventanas de carta

  function closeDialog() { $('#card-dialog').close(); }

  function paymentEl(pay) {
    const line = el('div', 'payment');
    line.append(el('span', null, 'Pagas: '));
    const gems = [...C.GEMS, C.WILD].filter(g => pay[g] > 0);
    if (!gems.length) line.append(el('strong', 'ok', 'gratis (te alcanzan las bonificaciones)'));
    gems.forEach(g => line.append(gemEl(g, pay[g], true)));
    return line;
  }

  // ---------- Tu nombre (lo ve el oponente; se guarda en este navegador)

  const NAME_KEY = 'splendmon.playerName';

  // Los dos campos "Tu nombre" (crear partida y unirse) muestran y guardan el mismo nombre.
  function initPlayerName() {
    const fields = [$('#p1-name'), $('#join-name')];
    let saved = '';
    try { saved = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* sin almacenamiento */ }
    fields.forEach(f => {
      f.value = saved;
      f.addEventListener('input', () => {
        fields.forEach(o => { if (o !== f) o.value = f.value; });
        try { localStorage.setItem(NAME_KEY, f.value.trim()); } catch (e) { /* sin guardar */ }
      });
    });
  }

  // Quién eres "Tú" en esta pantalla: en red, tu jugador; contra la máquina, el humano.
  // Con dos personas en el mismo equipo no hay un "Tú": se usan los nombres.
  function meIndex() {
    const g = state.game;
    if (!g) return null;
    if (state.role) return state.local;
    const humans = g.players.filter(p => !p.ai);
    return humans.length === 1 ? humans[0].index : null;
  }

  const isMe = p => !!p && p.index === meIndex();
  const displayName = p => (isMe(p) ? 'Tú' : p.name);

  // Línea del registro: en segunda persona si habla de ti.
  function logText(entry) {
    if (typeof entry === 'string') return entry;
    return entry.who === meIndex() && entry.you ? entry.you : entry.text;
  }

  // ---------- Temas de la interfaz (solo en este navegador, guardado en localStorage)

  const THEME_KEY = 'splendmon.theme';

  function setTheme(id, save = true) {
    if (!C.THEMES.some(t => t.id === id)) id = 'auto';
    const root = document.documentElement;
    if (id === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', id);
    if (save) { try { localStorage.setItem(THEME_KEY, id); } catch (e) { /* sin guardar */ } }
    document.querySelectorAll('#theme-picker .theme-option').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeId === id)));
    $('#theme-select').value = id;
  }

  function initThemes() {
    const picker = $('#theme-picker');
    const select = $('#theme-select');
    C.THEMES.forEach(t => {
      const b = button('', 'theme-option', () => setTheme(t.id));
      // data-theme-id (no data-theme): el botón y su nombre usan los colores del tema actual;
      // solo la muestra de adentro se pinta con los colores de su tema.
      b.dataset.themeId = t.id;
      // Muestra: un mini panel pintado con los colores de ese tema.
      const sw = el('span', 'theme-swatch' + (t.id === 'auto' ? ' auto' : ''));
      if (t.id !== 'auto') sw.setAttribute('data-theme', t.id);
      const r1 = el('span', 'ts-row'); r1.append(el('b', null, 'Aa'), el('span', 'ts-chip'));
      const r2 = el('span', 'ts-row'); r2.append(el('span', 'ts-accent'), el('span', 'ts-ok'), el('span', 'ts-chip'));
      sw.append(r1, r2);
      b.append(sw, el('span', null, t.label));
      picker.append(b);
      const opt = el('option', null, 'Tema: ' + t.label);
      opt.value = t.id;
      select.append(opt);
    });
    select.addEventListener('change', () => setTheme(select.value));
    let saved = 'auto';
    try { saved = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { /* sin almacenamiento */ }
    setTheme(saved, false);
  }

  // ---------- Fondos (solo en este navegador, guardado en localStorage)

  // BG_KEY guarda el id; BG_STYLE_KEY guarda cómo pintar un fondo de imagen, para que
  // el script del <head> lo aplique antes de cargar este archivo (sin parpadeo).
  const BG_KEY = 'splendmon.background';
  const BG_STYLE_KEY = 'splendmon.background.style';

  // Lista completa: imágenes de img/backgrounds (fondos.js) + degradados de config.
  let bgList = null;
  function backgrounds() {
    if (bgList) return bgList;
    const images = (window.SM.BACKGROUND_IMAGES || [])
      .map(b => Object.assign({}, b, (C.BACKGROUND_OVERRIDES || {})[b.img] || {}));
    bgList = [...images, ...C.BACKGROUNDS];
    return bgList;
  }
  const findBackground = id => backgrounds().find(b => b.id === id);

  let currentBg = null;

  function savedBackgroundId() {
    try { return localStorage.getItem(BG_KEY); } catch (e) { return null; /* almacenamiento bloqueado */ }
  }

  function savedBackground() {
    const id = savedBackgroundId();
    return findBackground(id) ? id : C.DEFAULT_BACKGROUND;
  }

  // Mismo id que genera tools/actualizar-fondos.ps1 a partir del nombre del archivo.
  function imageEntry(file) {
    const base = file.replace(/\.[^.]+$/, '');
    const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return { id: 'img-' + slug, label: base.replace(/[_-]+/g, ' ').trim(), img: 'img/backgrounds/' + file, fill: '#1d1f24' };
  }

  // Abierto desde un servidor (Live Server, etc.): lee la carpeta img/backgrounds/ directamente,
  // así las imágenes nuevas aparecen sin ejecutar tools/actualizar-fondos.bat.
  // Abierto con doble clic (file://) el navegador no deja leer carpetas: se usa fondos.js.
  async function discoverBackgrounds() {
    if (!location.protocol.startsWith('http')) return [];
    try {
      const res = await fetch('img/backgrounds/', { cache: 'no-store' });
      if (!res.ok) return [];
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const files = new Set();
      doc.querySelectorAll('a[href]').forEach(a => {
        const name = decodeURIComponent(a.getAttribute('href').split(/[?#]/)[0].split('/').filter(Boolean).pop() || '');
        if (/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(name)) files.add(name);
      });
      return [...files].map(imageEntry);
    } catch (e) {
      return [];
    }
  }

  // Si la lista no trae el tamaño de la imagen, se mide al usarla (para no estirarla de más).
  function measureBackground(bg, onReady) {
    if (!bg.img || bg.width > 0) return;
    const img = new Image();
    img.onload = () => { bg.width = img.naturalWidth; bg.height = img.naturalHeight; onReady(); };
    img.src = bg.img;
  }

  // Variables CSS de un fondo de imagen (las usa la clase .bg-image).
  // La ruta va completa: una ruta relativa dentro de una variable CSS se resolvería
  // desde css/ (donde se usa la variable) y no encontraría la imagen.
  // --bg-w / --bg-h: tamaño real de la imagen (de fondos.js) y --bg-up: cuánto se puede
  // agrandar. Con eso el CSS limita el estiramiento y rellena el resto con una copia desenfocada.
  function imageStyle(bg) {
    const style = {
      '--bg-img': `url("${new URL(bg.img, document.baseURI).href}")`,
      '--bg-fill': bg.fill || '#222',
      '--bg-pos': bg.position || 'center',
    };
    if (bg.width > 0 && bg.height > 0) {
      style['--bg-w'] = String(bg.width);
      style['--bg-ratio'] = String(bg.width / bg.height);
      style['--bg-up'] = String(C.BACKGROUND_MAX_UPSCALE || 1.8);
    }
    return style;
  }

  const BG_VARS = ['--bg-img', '--bg-fill', '--bg-pos', '--bg-w', '--bg-ratio', '--bg-up'];

  function paintBackground(node, bg) {
    BG_VARS.forEach(k => node.style.removeProperty(k));
    if (bg.img) {
      node.classList.add('bg-image');
      Object.entries(imageStyle(bg)).forEach(([k, v]) => node.style.setProperty(k, v));
    } else {
      node.classList.add('bg-' + bg.id);
    }
  }

  function setBackground(id, save = true) {
    const bg = findBackground(id) || findBackground(C.DEFAULT_BACKGROUND) || backgrounds()[0];
    id = bg.id;
    const root = document.documentElement;
    root.className = '';
    paintBackground(root, bg);
    if (save) {
      try {
        localStorage.setItem(BG_KEY, id);
        if (bg.img) localStorage.setItem(BG_STYLE_KEY, JSON.stringify(imageStyle(bg)));
        else localStorage.removeItem(BG_STYLE_KEY);
      } catch (e) { /* sin guardar: igual se aplica */ }
    }
    document.querySelectorAll('#bg-picker .bg-option').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bg === id)));
    $('#bg-select').value = id;
    currentBg = id;
    measureBackground(bg, () => { if (currentBg === id) setBackground(id, save); });
  }

  function renderBackgroundPicker() {
    const picker = $('#bg-picker');
    const select = $('#bg-select');
    picker.textContent = '';
    select.textContent = '';
    backgrounds().forEach(bg => {
      const b = button('', 'bg-option', () => setBackground(bg.id));
      b.title = bg.label;
      b.dataset.bg = bg.id;
      const swatch = el('span', 'bg-swatch');
      paintBackground(swatch, bg);
      b.append(swatch, el('span', null, bg.label));
      picker.append(b);
      const opt = el('option', null, 'Fondo: ' + bg.label);
      opt.value = bg.id;
      select.append(opt);
    });
  }

  async function initBackgrounds() {
    // Abierto con doble clic: la lista no se puede actualizar sola; se explica cómo abrirlo.
    $('#bg-file-hint').hidden = location.protocol !== 'file:';
    renderBackgroundPicker();
    $('#bg-select').addEventListener('change', () => setBackground($('#bg-select').value));
    const wanted = savedBackgroundId();
    // Si el fondo guardado ya está en la lista, se aplica al tiro (y se vuelve a guardar,
    // por si el estilo guardado tenía una ruta antigua).
    if (findBackground(wanted) || !wanted) setBackground(savedBackground(), true);

    const found = await discoverBackgrounds();
    const known = new Set(backgrounds().map(b => b.img));
    const extra = found.filter(b => !known.has(b.img))
      .map(b => Object.assign(b, (C.BACKGROUND_OVERRIDES || {})[b.img] || {}));
    if (extra.length) {
      const gradients = bgList.filter(b => !b.img);
      bgList = [...bgList.filter(b => b.img), ...extra].sort((a, b) => a.label.localeCompare(b.label)).concat(gradients);
      renderBackgroundPicker();
    }
    setBackground(findBackground(wanted) ? wanted : savedBackground(), true);
  }

  // ---------- Catálogo de criaturas

  // En partida se usan las cartas de la partida (el invitado en red no tiene state.cards).
  function catalogCards() {
    if (state.game) return [...state.game.cards.values()];
    return state.cards || [];
  }

  function initCatalog() {
    const dlg = $('#catalog-dialog');
    $('#catalog-open').addEventListener('click', () => openCatalog('pokemon'));
    $('#catalog-items').addEventListener('click', () => openCatalog('items'));
    $('#catalog-game').addEventListener('click', () => openCatalog());
    document.querySelectorAll('#catalog-tabs [data-view]').forEach(b => b.addEventListener('click', () => {
      state.catalogView = b.dataset.view;
      $('#catalog-search').value = '';
      renderCatalog();
    }));
    $('#catalog-close').addEventListener('click', () => dlg.close());
    $('#catalog-search').addEventListener('input', renderCatalog);
    // Clic fuera del contenido (en el fondo) cierra el catálogo.
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  }

  // view: 'pokemon' u 'items'. Sin Pokémon cargados, se abre en objetos.
  function openCatalog(view) {
    state.catalogView = view || (catalogCards().length ? 'pokemon' : 'items');
    if (state.catalogView === 'pokemon' && !catalogCards().length) state.catalogView = 'items';
    $('#catalog-search').value = '';
    renderCatalog();
    const dlg = $('#catalog-dialog');
    if (!dlg.open) dlg.showModal();
    $('#catalog-search').focus();
  }

  function renderCatalog() {
    const view = state.catalogView || 'pokemon';
    document.querySelectorAll('#catalog-tabs [data-view]').forEach(b => {
      const on = b.dataset.view === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.disabled = b.dataset.view === 'pokemon' && !catalogCards().length;
    });
    $('#catalog-search').placeholder = view === 'items' ? 'Buscar objeto por nombre o efecto' : 'Buscar por nombre, número o tipo';
    if (view === 'items') { renderItemCatalog(); return; }
    const cards = catalogCards();
    const tiers = $('#catalog-tiers');
    tiers.textContent = '';
    [['all', 'Todas'], ...C.TIERS.map(t => [t, C.TIER_LABELS[t]])].forEach(([tier, label]) => {
      const n = tier === 'all' ? cards.length : cards.filter(c => c.tier === tier).length;
      if (!n) return;
      const b = button(`${label} (${n})`, 'chip' + (state.catalogTier === tier ? ' selected' : ''), () => {
        state.catalogTier = tier;
        renderCatalog();
      });
      b.setAttribute('aria-pressed', String(state.catalogTier === tier));
      tiers.append(b);
    });

    const q = $('#catalog-search').value.trim().toLowerCase();
    const shown = cards.filter(c =>
      (state.catalogTier === 'all' || c.tier === state.catalogTier) &&
      (!q || c.name.toLowerCase().includes(q) || c.num.includes(q) ||
        c.types.some(t => String(t).toLowerCase().includes(q))));

    $('#catalog-count').textContent = `${shown.length} de ${cards.length}`;
    const grid = $('#catalog-grid');
    grid.textContent = '';
    grid.classList.remove('items-view');
    if (!shown.length) grid.append(el('p', 'muted', 'No hay criaturas que coincidan.'));
    shown.forEach(card => {
      const node = cardEl(card, { onClick: () => openCard(card, { browse: true }) });
      const owner = testing() && state.game.ownerOf(card.uid);
      if (owner) {
        node.classList.add('owned');
        node.append(el('span', 'owned-tag', displayName(owner)));
      }
      grid.append(node);
    });
  }

  // Catálogo de objetos: todos los objetos del juego, con filtros y búsqueda.
  // En partida se marca dónde está cada uno, sin revelar los objetos ocultos del rival.
  function renderItemCatalog() {
    const g = state.game;
    const filters = [['all', 'Todos'], ['consumable', 'Un uso'], ['relic', 'Permanentes']];
    if (!filters.some(f => f[0] === state.itemFilter)) state.itemFilter = 'all';
    const tiers = $('#catalog-tiers');
    tiers.textContent = '';
    filters.forEach(([kind, label]) => {
      const n = SM.Items.list.filter(d => kind === 'all' || d.kind === kind).length;
      const b = button(`${label} (${n})`, 'chip' + (state.itemFilter === kind ? ' selected' : ''), () => { state.itemFilter = kind; renderCatalog(); });
      b.setAttribute('aria-pressed', String(state.itemFilter === kind));
      tiers.append(b);
    });

    const q = $('#catalog-search').value.trim().toLowerCase();
    const shown = SM.Items.list.filter(d => (state.itemFilter === 'all' || d.kind === state.itemFilter) &&
      (!q || d.name.toLowerCase().includes(q) || d.text.toLowerCase().includes(q)));
    $('#catalog-count').textContent = `${shown.length} de ${SM.Items.list.length}`;

    // Dónde está cada objeto en la partida.
    const where = id => {
      if (!g) return null;
      const slot = g.itemShop.findIndex(i => i && i.id === id);
      if (slot >= 0) return { text: 'En la tienda', inst: g.itemShop[slot], slot };
      for (const p of g.players) {
        const relic = p.relics.find(i => i.id === id);
        if (relic) return { text: isMe(p) ? 'Lo tienes' : `Lo tiene ${p.name}`, inst: relic };
        const mine = p.items.find(i => i.id === id);
        if (mine && (isMe(p) || (!state.role && !p.ai && p === g.currentPlayer))) return { text: isMe(p) ? 'Lo tienes' : `Lo tiene ${p.name}`, inst: mine };
      }
      return null;
    };

    const grid = $('#catalog-grid');
    grid.textContent = '';
    grid.classList.add('items-view');
    if (!shown.length) grid.append(el('p', 'muted', 'No hay objetos que coincidan.'));
    shown.forEach(def => {
      const at = where(def.id);
      const inst = at ? at.inst : { uid: 'cat-' + def.id, id: def.id, cost: {} };
      const node = itemEl(inst, { showCost: false, onClick: () => openItem(inst, { browse: true }) });
      node.append(el('span', 'item-price', `${def.price} pokébola${def.price > 1 ? 's' : ''}`));
      if (at) node.append(el('span', 'item-where', at.text));
      grid.append(node);
    });
  }

  // Botones del modo prueba dentro del detalle de la carta.
  function testActions(card, info, actions) {
    const g = state.game;
    const owner = g.ownerOf(card.uid);
    if (owner) {
      info.append(el('p', 'note', isMe(owner) ? 'Modo prueba: ya la tienes tú.' : `Modo prueba: ya la tiene ${owner.name}.`));
      return;
    }
    info.append(el('p', 'note', 'Modo prueba: dásela a un jugador gratis, sin gastar turno.'));
    g.players.forEach(p => {
      actions.append(button(isMe(p) ? 'Atraparlo yo' : `Atrapar para ${p.name}`, p.index === state.local ? 'primary' : 'secondary', () => {
        closeDialog();
        g.giveCard(card.uid, p.index);
        if ($('#catalog-dialog').open) renderCatalog();
      }));
    });
  }

  // Tabla del detalle: costo completo y, en partida, tu cuenta (capturas, en mano, faltan).
  function costTable(card) {
    const viewer = costViewer();
    const box = el('div', 'cost-box');
    box.append(el('h3', null, !viewer ? 'Costo' : isMe(viewer) ? 'Costo y tu cuenta' : `Costo y cuenta de ${viewer.name}`));
    const table = el('table', 'cost-table');
    const head = el('tr');
    const cols = viewer ? ['Pokébola', 'Cuesta', 'Capturas', 'En mano', 'Faltan'] : ['Pokébola', 'Cuesta'];
    cols.forEach(c => head.append(el('th', null, c)));
    table.append(head);
    const bonus = viewer ? state.game.bonusOf(viewer) : null;
    const missing = viewer ? missingFor(viewer, card) : null;
    [...C.GEMS, C.WILD].forEach(gem => {
      if (!card.cost[gem]) return;
      const tr = el('tr');
      const name = el('td', 'cost-name');
      name.append(gemEl(gem, null, true), el('span', null, C.GEM_INFO[gem].label));
      tr.append(name, el('td', null, String(card.cost[gem])));
      if (viewer) {
        tr.append(
          el('td', null, gem === C.WILD ? '—' : String(bonus[gem])),
          el('td', null, String(viewer.tokens[gem])),
          el('td', missing[gem] ? 'warn' : 'ok', missing[gem] ? String(missing[gem]) : '✓'),
        );
      }
      table.append(tr);
    });
    box.append(table);
    if (viewer) {
      const pay = state.game.paymentFor(viewer, card);
      const totalLack = Object.values(missing).reduce((a, b) => a + b, 0);
      const wild = C.GEM_INFO[C.WILD].label;
      if (pay.ok && totalLack) box.append(el('p', 'ok', `Te alcanza usando tus ${wild} como comodín para lo que falta.`));
      else if (pay.ok) box.append(el('p', 'ok', 'Tienes todo lo necesario para capturarlo.'));
      else box.append(el('p', 'warn', `Te faltan ${pay.missing} pokébola(s) en total, contando tus ${wild} como comodín.`));
    }
    return box;
  }

  function openCard(card, opts = {}) {
    const g = state.game;
    const body = $('#card-dialog-body');
    body.textContent = '';
    const layout = el('div', 'dialog-layout');
    layout.append(cardEl(card, { size: 'big' }));

    const info = el('div', 'dialog-info');
    info.append(el('h2', null, card.name + (card.num ? ` #${card.num}` : '')));
    info.append(el('p', 'muted', `${C.TIER_LABELS[card.tier]} · ${card.types.join(' / ') || 'Sin tipo'}`));
    const size = [card.height, card.weight].filter(Boolean).join(' · ');
    if (size) info.append(el('p', 'muted', size));
    if (card.weaknesses.length) info.append(el('p', 'muted', 'Débil contra: ' + card.weaknesses.join(', ')));
    info.append(el('p', null, `Da ${card.points} punto(s) y ${card.bonus} de bonificación permanente de ${C.GEM_INFO[card.gem].label}.`));
    if (card.cost[C.WILD]) info.append(el('p', 'note', `Para capturarla hay que pagar al menos 1 ${C.GEM_INFO[C.WILD].label}.`));
    card.evolutions.forEach(ev => {
      info.append(el('p', null, `Evoluciona a ${ev.name} si tienes ${ev.count} bonificaciones de ${C.GEM_INFO[ev.gem].label} y esa carta está en la mesa o en tu reserva.`));
    });
    info.append(costTable(card));

    const actions = el('div', 'dialog-actions');
    // Desde el catálogo solo se mira la carta: no se captura ni se reserva.
    const loc = g && !opts.browse ? g.locate(card.uid) : null;
    const reachable = loc && (loc.where === 'market' || loc.player === g.currentPlayer);
    if (canAct() && reachable) {
      const buy = g.checkBuy(card.uid);
      if (buy.ok) info.append(paymentEl(buy.pay));
      else info.append(el('p', 'warn', buy.reason));
      actions.append(button('Capturar', 'primary', () => { closeDialog(); g.buy(card.uid); }, !buy.ok));
      // Ticket Barco: cambiar esta carta de la mesa por la de arriba de su mazo (gratis).
      const ticket = loc.where === 'market' && g.currentPlayer.items.find(i => g.itemDef(i).use === 'market');
      if (ticket) {
        const tc = g.checkTicket(ticket.uid, card.uid);
        actions.append(button('🎫 Cambiar con Ticket Barco', 'secondary', () => { closeDialog(); g.useTicket(ticket.uid, card.uid); }, !tc.ok));
      }
      // Cupón: otra forma de capturar, pagando menos.
      const coupon = g.currentPlayer.items.find(i => g.itemDef(i).use === 'capture');
      if (coupon) {
        const withCoupon = g.checkBuy(card.uid, { coupon: coupon.uid });
        if (withCoupon.ok) {
          const line = paymentEl(withCoupon.pay);
          line.firstChild.textContent = 'Con Cupón pagas: ';
          info.append(line);
        }
        actions.append(button('🎟️ Capturar con Cupón', buy.ok ? 'secondary' : 'primary',
          () => { closeDialog(); g.buy(card.uid, { coupon: coupon.uid }); }, !withCoupon.ok));
      }

      if (loc.where === 'market' && C.RESERVABLE_TIERS.includes(loc.tier)) {
        const source = { type: 'market', tier: loc.tier, slot: loc.slot };
        const res = g.checkReserve(source);
        actions.append(button('Reservar', 'secondary', () => { closeDialog(); g.reserve(source); }, !res.ok));
        if (!res.ok) info.append(el('p', 'muted', res.reason));
      }
    }
    if (testing() && opts.browse) testActions(card, info, actions);
    actions.append(button('Cerrar', 'secondary', closeDialog));
    info.append(actions);
    layout.append(info);
    body.append(layout);
    $('#card-dialog').showModal();
  }

  function openDeck(tier) {
    const g = state.game;
    const body = $('#card-dialog-body');
    body.textContent = '';
    const layout = el('div', 'dialog-layout');
    layout.append(backEl(tier, g.decks[tier].length));
    const info = el('div', 'dialog-info');
    info.append(el('h2', null, `Mazo del ${C.TIER_LABELS[tier]}`));
    info.append(el('p', null, `Puedes reservar la carta de arriba sin verla. Recibes una ${C.GEM_INFO[C.WILD].label} si quedan.`));
    const actions = el('div', 'dialog-actions');
    const source = { type: 'deck', tier };
    actions.append(button('Reservar carta oculta', 'primary', () => { closeDialog(); g.reserve(source); }, !g.checkReserve(source).ok));
    // Lupa: mirar las de arriba y elegir cuál reservar.
    const lens = g.currentPlayer.items.find(i => g.itemDef(i).use === 'reserve');
    if (lens) {
      const n = g.itemDef(lens).peek;
      actions.append(button(`🔍 Usar Lupa (ver ${n} de arriba)`, 'secondary', () => { closeDialog(); g.useLens(lens.uid, tier); }, !g.checkLens(lens.uid, tier).ok));
    }
    actions.append(button('Cerrar', 'secondary', closeDialog));
    info.append(actions);
    layout.append(info);
    body.append(layout);
    $('#card-dialog').showModal();
  }

  // Piezas de interfaz que reutiliza la guía de reglas (js/rules.js).
  SM.UI = {
    el, button, gemEl, cardEl, backEl, itemEl,
    typeGroups: () => state.typeGroups,
    cards: () => (state.game ? [...state.game.cards.values()] : state.cards || []),
  };

  document.addEventListener('DOMContentLoaded', initSetup);
})();

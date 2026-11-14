// Estado y reglas de la partida. No toca la página: la interfaz escucha onChange.
SM.Game = class Game {
  constructor(cards, setup) {
    const C = SM.Config;
    this.cards = new Map(cards.map(c => [c.uid, c]));
    this.players = setup.map((p, i) => ({
      index: i, name: p.name, ai: !!p.ai,
      tokens: Game.emptyTokens(), cards: [], reserved: [], under: [],
    }));

    const perGem = C.TOKENS_PER_GEM[this.players.length] || 7;
    this.bank = Game.emptyTokens();
    C.GEMS.forEach(g => { this.bank[g] = perGem; });
    this.bank[C.WILD] = C.WILD_TOKENS;

    this.decks = {};
    this.market = {};
    C.TIERS.forEach(t => {
      this.decks[t] = Game.shuffle(cards.filter(c => c.tier === t));
      this.market[t] = [];
      for (let i = 0; i < C.MARKET_SIZE[t]; i++) this.market[t].push(this.decks[t].pop() || null);
    });

    this.first = Math.floor(Math.random() * this.players.length);
    this.current = this.first;
    this.round = 1;
    this.phase = 'action'; // action -> evolve -> discard -> (siguiente turno) | over
    this.finalRound = false;
    this.result = null;
    this.log = [];
    this.listeners = [];
    this.addLog(`Empieza ${this.currentPlayer.name}.`, this.current, 'Empiezas tú.');
  }

  // ---------- Utilidades

  static emptyTokens() {
    const t = {};
    [...SM.Config.GEMS, SM.Config.WILD].forEach(g => { t[g] = 0; });
    return t;
  }

  static shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  static ok(extra) { return Object.assign({ ok: true }, extra); }
  static fail(reason) { return { ok: false, reason }; }

  get currentPlayer() { return this.players[this.current]; }

  onChange(fn) { this.listeners.push(fn); }
  emit() { this.listeners.forEach(fn => fn(this)); }

  // ---------- Copia del estado (para jugar en red)
  // Las cartas viajan por su uid; de los mazos solo se envía cuántas quedan.

  snapshot() {
    const ids = list => list.map(c => (c ? c.uid : null));
    const decks = {};
    const market = {};
    SM.Config.TIERS.forEach(t => { decks[t] = this.decks[t].length; market[t] = ids(this.market[t]); });
    return {
      players: this.players.map(p => ({
        name: p.name, ai: p.ai, tokens: Object.assign({}, p.tokens),
        cards: ids(p.cards), reserved: ids(p.reserved), under: ids(p.under),
      })),
      bank: Object.assign({}, this.bank),
      decks, market,
      first: this.first, current: this.current, round: this.round,
      phase: this.phase, finalRound: this.finalRound,
      result: this.result && { ranking: this.result.ranking.map(p => p.index), tie: this.result.tie },
      log: this.log.slice(),
    };
  }

  // Partida reconstruida a partir de una copia. Sus mazos solo tienen huecos
  // vacíos, así que sirve para mostrar y comprobar jugadas, no para hacerlas.
  static fromSnapshot(cards, snap) {
    const g = Object.create(Game.prototype);
    g.cards = new Map(cards.map(c => [c.uid, c]));
    g.listeners = [];
    g.applySnapshot(snap);
    return g;
  }

  applySnapshot(s) {
    const card = uid => (uid == null ? null : this.cards.get(uid));
    this.players = s.players.map((p, i) => ({
      index: i, name: p.name, ai: !!p.ai, tokens: Object.assign({}, p.tokens),
      cards: p.cards.map(card), reserved: p.reserved.map(card), under: p.under.map(card),
    }));
    this.bank = Object.assign({}, s.bank);
    this.decks = {};
    this.market = {};
    SM.Config.TIERS.forEach(t => {
      this.decks[t] = new Array(s.decks[t] || 0).fill(null);
      this.market[t] = (s.market[t] || []).map(card);
    });
    this.first = s.first;
    this.current = s.current;
    this.round = s.round;
    this.phase = s.phase;
    this.finalRound = s.finalRound;
    this.result = s.result && { ranking: s.result.ranking.map(i => this.players[i]), tie: s.result.tie };
    this.log = s.log.slice();
    this.emit();
  }

  // Cada línea guarda el texto con el nombre (lo que ven los demás) y, si habla de un
  // jugador, quién es y cómo se lee para ese jugador ("Tomas…" en vez de "Ana toma…").
  addLog(text, who = null, you = null) {
    const msg = who == null ? text : { text, who, you };
    this.log.unshift(msg);
    if (this.log.length > 80) this.log.pop();
  }

  gemLabel(g) { return SM.Config.GEM_INFO[g].label; }

  bonusOf(p) {
    const b = {};
    SM.Config.GEMS.forEach(g => { b[g] = 0; });
    p.cards.forEach(c => { b[c.gem] += c.bonus; });
    return b;
  }

  pointsOf(p) { return p.cards.reduce((s, c) => s + c.points, 0); }
  tokenCount(p) { return Object.values(p.tokens).reduce((a, b) => a + b, 0); }

  visibleCardsFor(p) {
    const list = [];
    SM.Config.TIERS.forEach(t => this.market[t].forEach(c => { if (c) list.push(c); }));
    return list.concat(p.reserved);
  }

  locate(uid) {
    for (const t of SM.Config.TIERS) {
      const slot = this.market[t].findIndex(c => c && c.uid === uid);
      if (slot >= 0) return { where: 'market', tier: t, slot };
    }
    for (const p of this.players) {
      const slot = p.reserved.findIndex(c => c.uid === uid);
      if (slot >= 0) return { where: 'reserved', player: p, slot };
    }
    return null;
  }

  takeFromMarket(tier, slot) {
    const card = this.market[tier][slot];
    this.market[tier][slot] = this.decks[tier].pop() || null;
    return card;
  }

  removeCard(loc) {
    if (loc.where === 'market') return this.takeFromMarket(loc.tier, loc.slot);
    return loc.player.reserved.splice(loc.slot, 1)[0];
  }

  // ---------- Acciones A y B: tomar fichas

  checkTake(gems) {
    const C = SM.Config;
    if (this.phase !== 'action') return Game.fail('Ahora no se pueden tomar pokébolas.');
    if (!gems.length) return Game.fail('Elige pokébolas de las disponibles.');
    if (gems.includes(C.WILD)) return Game.fail(`La ${this.gemLabel(C.WILD)} solo se consigue al reservar.`);
    if (gems.some(g => !C.GEMS.includes(g))) return Game.fail('Pokébola desconocida.');
    const distinct = new Set(gems);
    if (gems.length === 2 && distinct.size === 1) {
      return this.bank[gems[0]] >= C.MIN_BANK_FOR_DOUBLE
        ? Game.ok()
        : Game.fail(`Para tomar 2 iguales deben quedar al menos ${C.MIN_BANK_FOR_DOUBLE} en la reserva.`);
    }
    if (distinct.size !== gems.length) return Game.fail('Solo se repite pokébola al tomar exactamente 2 iguales.');
    if (gems.length > 3) return Game.fail('Como máximo 3 pokébolas.');
    if (gems.some(g => this.bank[g] < 1)) return Game.fail('No quedan pokébolas de ese tipo.');
    if (gems.length < 3) {
      const available = C.GEMS.filter(g => this.bank[g] > 0).length;
      if (available > gems.length) return Game.fail('Elige 3 pokébolas distintas, o 2 iguales.');
    }
    return Game.ok();
  }

  takeTokens(gems) {
    const check = this.checkTake(gems);
    if (!check.ok) return check;
    const p = this.currentPlayer;
    gems.forEach(g => { this.bank[g]--; p.tokens[g]++; });
    const taken = gems.map(g => this.gemLabel(g)).join(', ');
    this.addLog(`${p.name} toma ${taken}.`, p.index, `Tomas ${taken}.`);
    this.afterAction();
    this.emit();
    return check;
  }

  // ---------- Acción C: reservar

  checkReserve(source) {
    const C = SM.Config;
    if (this.phase !== 'action') return Game.fail('Ahora no se puede reservar.');
    const p = this.currentPlayer;
    if (!C.RESERVABLE_TIERS.includes(source.tier)) return Game.fail('Los raros y legendarios no se reservan.');
    if (p.reserved.length >= C.MAX_RESERVED) return Game.fail(`Ya tienes ${C.MAX_RESERVED} cartas reservadas.`);
    if (source.type === 'deck') {
      if (!this.decks[source.tier].length) return Game.fail('Ese mazo está vacío.');
    } else if (!this.market[source.tier][source.slot]) {
      return Game.fail('No hay carta en ese hueco.');
    }
    return Game.ok();
  }

  reserve(source) {
    const C = SM.Config;
    const check = this.checkReserve(source);
    if (!check.ok) return check;
    const p = this.currentPlayer;
    const card = source.type === 'deck' ? this.decks[source.tier].pop() : this.takeFromMarket(source.tier, source.slot);
    p.reserved.push(card);
    let gotWild = false;
    if (this.bank[C.WILD] > 0) { this.bank[C.WILD]--; p.tokens[C.WILD]++; gotWild = true; }
    const what = source.type === 'deck' ? `una carta oculta del ${C.TIER_LABELS[source.tier]}` : card.name;
    const wildName = this.gemLabel(C.WILD);
    this.addLog(`${p.name} reserva ${what}${gotWild ? ` y recibe una ${wildName}` : ''}.`, p.index,
      `Reservas ${what}${gotWild ? ` y recibes una ${wildName}` : ''}.`);
    this.afterAction();
    this.emit();
    return check;
  }

  // ---------- Acción D: capturar

  paymentFor(p, card) {
    const C = SM.Config;
    const bonus = this.bonusOf(p);
    const pay = Game.emptyTokens();
    let wildNeeded = card.cost[C.WILD] || 0;
    C.GEMS.forEach(g => {
      const need = Math.max(0, (card.cost[g] || 0) - bonus[g]);
      const use = Math.min(need, p.tokens[g]);
      pay[g] = use;
      wildNeeded += need - use;
    });
    pay[C.WILD] = wildNeeded;
    return { ok: p.tokens[C.WILD] >= wildNeeded, pay, missing: Math.max(0, wildNeeded - p.tokens[C.WILD]) };
  }

  checkBuy(uid) {
    if (this.phase !== 'action') return Game.fail('Ahora no se puede capturar.');
    const loc = this.locate(uid);
    if (!loc) return Game.fail('Esa carta no está disponible.');
    const p = this.currentPlayer;
    if (loc.where === 'reserved' && loc.player !== p) return Game.fail('Esa carta la reservó otro jugador.');
    const card = this.cards.get(uid);
    const payment = this.paymentFor(p, card);
    if (!payment.ok) {
      const wildOnly = (card.cost[SM.Config.WILD] || 0) > p.tokens[SM.Config.WILD];
      return Game.fail(wildOnly ? `Necesitas al menos 1 ${this.gemLabel(SM.Config.WILD)} para capturarla.` : `Te faltan ${payment.missing} pokébola(s).`);
    }
    return Game.ok({ pay: payment.pay });
  }

  buy(uid) {
    const check = this.checkBuy(uid);
    if (!check.ok) return check;
    const p = this.currentPlayer;
    const card = this.removeCard(this.locate(uid));
    Object.keys(check.pay).forEach(g => { p.tokens[g] -= check.pay[g]; this.bank[g] += check.pay[g]; });
    p.cards.push(card);
    const pts = card.points ? ` (+${card.points} pts)` : '';
    this.addLog(`${p.name} captura a ${card.name}${pts}.`, p.index, `Capturas a ${card.name}${pts}.`);
    this.afterAction();
    this.emit();
    return check;
  }

  // ---------- Modo prueba: dar una criatura sin pagar y sin gastar turno

  // Quién tiene la carta (capturada o bajo una evolución), o null.
  ownerOf(uid) {
    return this.players.find(p => p.cards.some(c => c.uid === uid) || p.under.some(c => c.uid === uid)) || null;
  }

  giveCard(uid, playerIndex) {
    const p = this.players[playerIndex];
    const card = this.cards.get(uid);
    if (!p || !card) return Game.fail('Carta o jugador desconocido.');
    if (this.ownerOf(uid)) return Game.fail('Esa criatura ya está capturada.');
    const loc = this.locate(uid);
    if (loc) {
      this.removeCard(loc);
    } else {
      const deck = this.decks[card.tier];
      const i = deck.findIndex(c => c && c.uid === uid);
      if (i < 0) return Game.fail('No se encontró la carta.');
      deck.splice(i, 1);
    }
    p.cards.push(card);
    this.addLog(`(Prueba) ${p.name} atrapa a ${card.name}.`, p.index, `(Prueba) Atrapas a ${card.name}.`);
    this.emit();
    return Game.ok();
  }

  // ---------- Sin acciones posibles

  hasLegalAction() {
    const C = SM.Config;
    const p = this.currentPlayer;
    if (C.GEMS.some(g => this.bank[g] > 0)) return true;
    if (p.reserved.length < C.MAX_RESERVED &&
        C.RESERVABLE_TIERS.some(t => this.decks[t].length || this.market[t].some(Boolean))) return true;
    return this.visibleCardsFor(p).some(c => this.checkBuy(c.uid).ok);
  }

  pass(force = false) {
    if (this.phase !== 'action') return Game.fail('Ahora no se puede pasar.');
    if (!force && this.hasLegalAction()) return Game.fail('Todavía tienes acciones posibles.');
    this.addLog(`${this.currentPlayer.name} pasa el turno.`, this.current, 'Pasas el turno.');
    this.afterAction();
    this.emit();
    return Game.ok();
  }

  // ---------- Final del turno: evolución

  availableEvolutions(p = this.currentPlayer) {
    const bonus = this.bonusOf(p);
    const options = [];
    p.cards.forEach(base => base.evolutions.forEach(ev => {
      if (bonus[ev.gem] < ev.count) return;
      const loc = this.locate(ev.uid);
      if (!loc) return;
      if (loc.where === 'reserved' && loc.player !== p) return;
      options.push({ base, target: this.cards.get(ev.uid), req: ev });
    }));
    return options;
  }

  evolve(baseUid, targetUid) {
    if (this.phase !== 'evolve') return Game.fail('Ahora no se puede evolucionar.');
    const option = this.availableEvolutions().find(o => o.base.uid === baseUid && o.target.uid === targetUid);
    if (!option) return Game.fail('Esa evolución no es posible.');
    const p = this.currentPlayer;
    const target = this.removeCard(this.locate(targetUid));
    p.cards.splice(p.cards.indexOf(option.base), 1, target);
    p.under.push(option.base);
    this.addLog(`¡${option.base.name} de ${p.name} evoluciona a ${target.name}!`, p.index,
      `¡Tu ${option.base.name} evoluciona a ${target.name}!`);
    this.afterEvolution();
    this.emit();
    return Game.ok();
  }

  skipEvolution() {
    if (this.phase !== 'evolve') return Game.fail('No hay evolución pendiente.');
    this.afterEvolution();
    this.emit();
    return Game.ok();
  }

  // ---------- Final del turno: límite de fichas

  returnToken(gem) {
    if (this.phase !== 'discard') return Game.fail('No tienes que devolver pokébolas.');
    const p = this.currentPlayer;
    if (p.tokens[gem] < 1) return Game.fail('No tienes pokébolas de ese tipo.');
    p.tokens[gem]--;
    this.bank[gem]++;
    if (this.tokenCount(p) <= SM.Config.MAX_TOKENS) {
      this.addLog(`${p.name} devuelve pokébolas hasta quedarse con ${SM.Config.MAX_TOKENS}.`, p.index,
        `Devuelves pokébolas hasta quedarte con ${SM.Config.MAX_TOKENS}.`);
      this.endTurn();
    }
    this.emit();
    return Game.ok();
  }

  // ---------- Flujo interno

  afterAction() {
    if (this.availableEvolutions().length) this.phase = 'evolve';
    else this.afterEvolution();
  }

  afterEvolution() {
    if (this.tokenCount(this.currentPlayer) > SM.Config.MAX_TOKENS) this.phase = 'discard';
    else this.endTurn();
  }

  endTurn() {
    const C = SM.Config;
    const p = this.currentPlayer;
    const points = this.pointsOf(p);
    if (!this.finalRound && points >= C.TARGET_POINTS) {
      this.finalRound = true;
      this.addLog(`¡${p.name} llega a ${points} puntos! Se juega hasta cerrar la ronda.`, p.index,
        `¡Llegas a ${points} puntos! Se juega hasta cerrar la ronda.`);
    }
    this.current = (this.current + 1) % this.players.length;
    if (this.current === this.first) {
      if (this.finalRound) { this.finish(); return; }
      this.round++;
    }
    this.phase = 'action';
    this.addLog(`Turno de ${this.currentPlayer.name}.`, this.current, 'Tu turno.');
  }

  finish() {
    this.phase = 'over';
    const compare = (a, b) =>
      this.pointsOf(b) - this.pointsOf(a) ||
      b.under.length - a.under.length ||
      a.cards.length - b.cards.length;
    const ranking = this.players.slice().sort(compare);
    const tie = ranking.length > 1 && compare(ranking[0], ranking[1]) === 0;
    this.result = { ranking, tie };
    if (tie) this.addLog('La partida termina en empate.');
    else this.addLog(`¡${ranking[0].name} gana la partida!`, ranking[0].index, '¡Ganas la partida!');
  }
};

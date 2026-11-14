// Estado y reglas de la partida. No toca la página: la interfaz escucha onChange.
SM.Game = class Game {
  // setup: [{ name, ai }]. opts.teams: 2 contra 2 (solo con 4 jugadores), alternados:
  // jugadores 0 y 2 son el equipo 0; 1 y 3, el equipo 1.
  constructor(cards, setup, opts = {}) {
    const C = SM.Config;
    this.cards = new Map(cards.map(c => [c.uid, c]));
    this.teams = !!opts.teams && setup.length === 4;
    this.players = setup.map((p, i) => ({
      index: i, name: p.name, ai: !!p.ai, team: this.teams ? i % 2 : null,
      tokens: Game.emptyTokens(), cards: [], reserved: [], under: [],
      items: [], relics: [], peek: null, extraPoints: 0, lastPaid: null,
    }));

    // Tienda de objetos: un mazo y algunos a la vista. Los usados van al descarte,
    // que se vuelve a barajar cuando el mazo se acaba.
    this.itemDeck = Game.shuffle(SM.Items.buildDeck());
    this.itemDiscard = [];
    this.itemShop = [];
    for (let i = 0; i < C.ITEM_SHOP_SIZE; i++) this.itemShop.push(this.drawItem());

    const perGem = C.TOKENS_PER_GEM[this.players.length] || 7;
    this.bank = Game.emptyTokens();
    C.GEMS.forEach(g => { this.bank[g] = perGem; });
    this.bank[C.WILD] = C.WILD_TOKENS[this.players.length] || 5;

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
      teams: this.teams,
      players: this.players.map(p => ({
        name: p.name, ai: p.ai, team: p.team, tokens: Object.assign({}, p.tokens),
        cards: ids(p.cards), reserved: ids(p.reserved), under: ids(p.under),
        items: p.items.slice(), relics: p.relics.slice(), peek: p.peek,
        extraPoints: p.extraPoints || 0, lastPaid: p.lastPaid,
      })),
      bank: Object.assign({}, this.bank),
      decks, market,
      itemShop: this.itemShop.slice(), itemDeck: this.itemDeck.length + this.itemDiscard.length,
      first: this.first, current: this.current, round: this.round,
      phase: this.phase, finalRound: this.finalRound,
      result: this.result && {
        ranking: this.result.ranking.map(p => p.index), tie: this.result.tie, winnerTeam: this.result.winnerTeam,
      },
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
    this.teams = !!s.teams;
    this.players = s.players.map((p, i) => ({
      index: i, name: p.name, ai: !!p.ai, team: p.team == null ? null : p.team, tokens: Object.assign({}, p.tokens),
      cards: p.cards.map(card), reserved: p.reserved.map(card), under: p.under.map(card),
      items: (p.items || []).slice(), relics: (p.relics || []).slice(), peek: p.peek || null,
      extraPoints: p.extraPoints || 0, lastPaid: p.lastPaid || null,
    }));
    this.bank = Object.assign({}, s.bank);
    this.itemShop = (s.itemShop || []).slice();
    this.itemDeck = new Array(s.itemDeck || 0).fill(null);
    this.itemDiscard = [];
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
    this.result = s.result && {
      ranking: s.result.ranking.map(i => this.players[i]), tie: s.result.tie,
      winnerTeam: s.result.winnerTeam == null ? null : s.result.winnerTeam,
    };
    this.log = s.log.slice();
    this.emit();
  }

  // ---------- Guardar y continuar una partida
  // Igual que snapshot(), pero con lo oculto (el orden de los mazos y de los objetos),
  // para poder seguir jugando exactamente donde se quedó.

  saveState() {
    const s = this.snapshot();
    s.deckOrder = {};
    SM.Config.TIERS.forEach(t => { s.deckOrder[t] = this.decks[t].map(c => (c ? c.uid : null)); });
    s.itemDeckFull = this.itemDeck.slice();
    s.itemDiscardFull = this.itemDiscard.slice();
    return s;
  }

  static restore(cards, saved) {
    const g = Game.fromSnapshot(cards, saved);
    SM.Config.TIERS.forEach(t => {
      g.decks[t] = (saved.deckOrder[t] || []).map(uid => g.cards.get(uid)).filter(Boolean);
    });
    g.itemDeck = (saved.itemDeckFull || []).slice();
    g.itemDiscard = (saved.itemDiscardFull || []).slice();
    return g;
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

  pointsOf(p) { return p.cards.reduce((s, c) => s + c.points, 0) + (p.extraPoints || 0); }
  tokenCount(p) { return Object.values(p.tokens).reduce((a, b) => a + b, 0); }

  // ---------- Equipos

  teamLabel(team) { return SM.Config.TEAMS[team].label; }
  teamMembers(team) { return this.players.filter(p => p.team === team); }
  teamPoints(team) { return this.teamMembers(team).reduce((s, p) => s + this.pointsOf(p), 0); }
  partnerOf(p) { return this.teams ? this.players.find(o => o.team === p.team && o !== p) || null : null; }
  targetPoints() { return this.teams ? SM.Config.TEAM_TARGET_POINTS : SM.Config.TARGET_POINTS; }

  // Pokebolas con las que puede pagar: las suyas y, en equipos, también las del compañero.
  spendableTokens(p) {
    const partner = this.partnerOf(p);
    const t = Object.assign({}, p.tokens);
    if (partner) Object.keys(t).forEach(g => { t[g] += partner.tokens[g]; });
    return t;
  }

  // Reparte un pago total entre el jugador (primero) y su compañero (lo que falte).
  splitPayment(p, total) {
    const partner = this.partnerOf(p);
    const own = Game.emptyTokens();
    const fromPartner = Game.emptyTokens();
    Object.keys(total).forEach(g => {
      own[g] = Math.min(total[g], p.tokens[g]);
      fromPartner[g] = total[g] - own[g];
    });
    return { own, fromPartner: partner ? fromPartner : null };
  }

  // Cobra un pago (de applyPayment / checkBuy): primero del jugador, luego del compañero.
  collectPayment(p, pay) {
    const { own, fromPartner } = this.splitPayment(p, pay);
    const partner = this.partnerOf(p);
    Object.keys(pay).forEach(g => {
      p.tokens[g] -= own[g];
      if (partner && fromPartner) partner.tokens[g] -= fromPartner[g];
      this.bank[g] += pay[g];
    });
    return fromPartner && Object.values(fromPartner).some(n => n > 0) ? fromPartner : null;
  }

  partnerNote(p, fromPartner) {
    if (!fromPartner) return '';
    const n = Object.values(fromPartner).reduce((a, b) => a + b, 0);
    return ` (${n} pokebola${n > 1 ? 's' : ''} de ${this.partnerOf(p).name})`;
  }

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

  // ---------- Objetos: utilidades

  itemDef(inst) { return inst && SM.Items.def(inst.id); }

  // Objeto de un solo uso que tiene el jugador (por uid), si es del uso pedido.
  ownedItem(p, uid, use) {
    const inst = p.items.find(i => i.uid === uid);
    const def = this.itemDef(inst);
    return def && (!use || def.use === use) ? inst : null;
  }

  hasRelic(p, id) { return p.relics.some(i => i.id === id); }

  // Cuántos objetos de un uso puede guardar (la Mochila suma espacios).
  itemLimit(p) {
    return SM.Config.MAX_ITEMS + p.relics.reduce((s, i) => s + (this.itemDef(i).slots || 0), 0);
  }

  // Gasta un objeto: sale de la mano del jugador y vuelve al mazo de la tienda,
  // en un lugar al azar. Mientras alguien lo tiene, no puede volver a salir.
  spendItem(p, uid) {
    const i = p.items.findIndex(x => x.uid === uid);
    if (i < 0) return null;
    const inst = p.items.splice(i, 1)[0];
    this.itemDeck.splice(Math.floor(Math.random() * (this.itemDeck.length + 1)), 0, inst);
    // Si la tienda tenía huecos (el mazo se había quedado sin objetos), se rellenan.
    this.itemShop.forEach((x, slot) => { if (!x) this.itemShop[slot] = this.drawItem(); });
    return inst;
  }

  // Siguiente objeto para la tienda: nunca uno que ya esté a la vista o que tenga
  // un jugador (los que se saltan se quedan en el mazo).
  drawItem() {
    const taken = new Set(this.itemShop.filter(Boolean).map(i => i.id));
    this.players.forEach(p => p.items.concat(p.relics).forEach(i => taken.add(i.id)));
    for (let k = this.itemDeck.length - 1; k >= 0; k--) {
      const inst = this.itemDeck[k];
      if (inst && !taken.has(inst.id)) return this.itemDeck.splice(k, 1)[0];
    }
    return null;
  }

  // ---------- Acciones A y B: tomar fichas

  // Problema de una selección de pokebolas, o '' si está bien. Con complete=false solo
  // revisa que se pueda seguir agregando (lo usa la interfaz para saber qué se puede elegir).
  // extra: pokebolas adicionales que permite la Bicicleta.
  takeProblem(gems, extra = 0, complete = true) {
    const C = SM.Config;
    if (gems.includes(C.WILD)) return `La ${this.gemLabel(C.WILD)} solo se consigue al reservar.`;
    if (gems.some(g => !C.GEMS.includes(g))) return 'Pokebola desconocida.';
    const count = {};
    gems.forEach(g => { count[g] = (count[g] || 0) + 1; });
    if (Object.keys(count).some(g => count[g] > this.bank[g])) return 'No quedan pokebolas de ese tipo.';
    const pairs = Object.keys(count).filter(g => count[g] === 2);
    if (Object.values(count).some(n => n > 2) || pairs.length > 1) return 'Solo se puede repetir un tipo, y solo 2 iguales.';
    if (pairs.length && this.bank[pairs[0]] < C.MIN_BANK_FOR_DOUBLE) {
      return `Para tomar 2 iguales deben quedar al menos ${C.MIN_BANK_FOR_DOUBLE} en la reserva.`;
    }
    const max = (pairs.length ? 2 : 3) + extra;
    if (gems.length > max) return extra ? `Con Bicicleta: ${3 + extra} distintas, o 2 iguales y ${extra} distinta.` : 'Como máximo 3 pokebolas distintas, o 2 iguales.';
    if (complete && gems.length < max) {
      const others = C.GEMS.filter(g => this.bank[g] > 0 && !count[g]).length;
      if (!gems.length) return 'Elige pokebolas de las disponibles.';
      if (others > 0) return extra
        ? `Con Bicicleta: elige ${3 + extra} distintas, o 2 iguales y ${extra} distinta.`
        : 'Elige 3 pokebolas distintas, o 2 iguales.';
    }
    return '';
  }

  // opts.bike: uid de una Bicicleta para tomar 1 pokebola más.
  checkTake(gems, opts = {}) {
    if (this.phase !== 'action') return Game.fail('Ahora no se pueden tomar pokebolas.');
    let extra = 0;
    if (opts.bike) {
      const bike = this.ownedItem(this.currentPlayer, opts.bike, 'take');
      if (!bike) return Game.fail('No tienes esa Bicicleta.');
      extra = this.itemDef(bike).extra;
    }
    const problem = this.takeProblem(gems, extra, true);
    return problem ? Game.fail(problem) : Game.ok();
  }

  takeTokens(gems, opts = {}) {
    const C = SM.Config;
    const check = this.checkTake(gems, opts);
    if (!check.ok) return check;
    const p = this.currentPlayer;
    gems.forEach(g => { this.bank[g]--; p.tokens[g]++; });
    const taken = gems.map(g => this.gemLabel(g)).join(', ');
    const bike = opts.bike ? ' (con Bicicleta)' : '';
    if (opts.bike) this.spendItem(p, opts.bike);
    this.addLog(`${p.name} toma ${taken}${bike}.`, p.index, `Tomas ${taken}${bike}.`);
    // Amuleto Moneda: al tomar 3 distintas o más, 1 extra de la que más quede.
    if (this.hasRelic(p, 'amulet-coin') && new Set(gems).size >= 3) {
      const bonus = [...new Set(gems)].filter(g => this.bank[g] > 0).sort((a, b) => this.bank[b] - this.bank[a])[0];
      if (bonus) {
        this.bank[bonus]--; p.tokens[bonus]++;
        this.addLog(`El Amuleto Moneda de ${p.name} le da 1 ${this.gemLabel(bonus)}.`, p.index, `Tu Amuleto Moneda te da 1 ${this.gemLabel(bonus)}.`);
      }
    }
    this.afterAction();
    this.emit();
    return check;
  }

  // ---------- Objetos: comprar en la tienda (usa la acción del turno)

  // Pago de un objeto: pokebolas de la mano; lo que falte, con Master Ball.
  // En equipos cuenta también lo del compañero (ver collectPayment).
  itemPayment(p, inst) {
    const C = SM.Config;
    const have = this.spendableTokens(p);
    const pay = Game.emptyTokens();
    let wild = 0;
    C.GEMS.forEach(g => {
      const need = inst.cost[g] || 0;
      pay[g] = Math.min(need, have[g]);
      wild += need - pay[g];
    });
    pay[C.WILD] = wild;
    return { ok: have[C.WILD] >= wild, pay, missing: Math.max(0, wild - have[C.WILD]) };
  }

  checkBuyItem(slot) {
    const C = SM.Config;
    if (this.phase !== 'action') return Game.fail('Ahora no se pueden comprar objetos.');
    const inst = this.itemShop[slot];
    if (!inst) return Game.fail('No hay objeto en ese lugar.');
    const p = this.currentPlayer;
    if (this.itemDef(inst).kind !== 'relic' && p.items.length >= this.itemLimit(p)) return Game.fail(`Ya tienes ${this.itemLimit(p)} objetos. Usa alguno primero.`);
    if (this.itemDef(inst).kind === 'relic' && this.hasRelic(p, inst.id)) return Game.fail('Ya tienes ese objeto permanente.');
    const payment = this.itemPayment(p, inst);
    if (!payment.ok) return Game.fail(`Te faltan ${payment.missing} pokebola(s).`);
    return Game.ok({ pay: payment.pay });
  }

  buyItem(slot) {
    const check = this.checkBuyItem(slot);
    if (!check.ok) return check;
    const p = this.currentPlayer;
    const inst = this.itemShop[slot];
    const helped = this.partnerNote(p, this.collectPayment(p, check.pay));
    const def = this.itemDef(inst);
    (def.kind === 'relic' ? p.relics : p.items).push(inst);
    this.itemShop[slot] = this.drawItem();
    this.addLog(`${p.name} compra ${def.name}${helped}.`, p.index, `Compras ${def.name}${helped}.`);
    this.afterAction();
    this.emit();
    return check;
  }

  // ---------- Objetos: Intercambiador (gratis, no gasta la acción)

  checkSwap(uid, give, take) {
    const C = SM.Config;
    if (this.phase !== 'action') return Game.fail('Ahora no se puede usar.');
    const p = this.currentPlayer;
    const inst = this.ownedItem(p, uid, 'free');
    if (!inst) return Game.fail('No tienes ese objeto.');
    const max = this.itemDef(inst).max;
    if (!give.length || give.length !== take.length) return Game.fail('Elige la misma cantidad para dar y recibir.');
    if (give.length > max) return Game.fail(`Como máximo ${max}.`);
    if ([...give, ...take].some(g => !C.GEMS.includes(g))) return Game.fail(`No sirve con ${this.gemLabel(C.WILD)}.`);
    const need = (list, from) => list.every(g => list.filter(x => x === g).length <= from[g]);
    if (!need(give, p.tokens)) return Game.fail('No tienes esas pokebolas.');
    if (!need(take, this.bank)) return Game.fail('No quedan esas pokebolas.');
    return Game.ok();
  }

  swapTokens(uid, give, take) {
    const check = this.checkSwap(uid, give, take);
    if (!check.ok) return check;
    const p = this.currentPlayer;
    give.forEach(g => { p.tokens[g]--; this.bank[g]++; });
    take.forEach(g => { this.bank[g]--; p.tokens[g]++; });
    this.spendItem(p, uid);
    const names = list => list.map(g => this.gemLabel(g)).join(', ');
    this.addLog(`${p.name} usa un Intercambiador: da ${names(give)} y recibe ${names(take)}.`, p.index,
      `Usas un Intercambiador: das ${names(give)} y recibes ${names(take)}.`);
    this.emit();
    return check;
  }

  // ---------- Objetos: Poción (recuperar pokebolas de la última captura; gratis)

  potionRecovery(p) {
    const C = SM.Config;
    const take = [];
    const paid = Object.assign({}, p.lastPaid || {});
    const bank = Object.assign({}, this.bank);
    for (let n = 0; n < 2; n++) {
      const g = C.GEMS.filter(x => (paid[x] || 0) > 0 && bank[x] > 0).sort((a, b) => paid[b] - paid[a])[0];
      if (!g) break;
      take.push(g); paid[g]--; bank[g]--;
    }
    return take;
  }

  checkPotion(uid) {
    if (this.phase !== 'action') return Game.fail('Ahora no se puede usar.');
    const p = this.currentPlayer;
    const inst = this.ownedItem(p, uid);
    if (!inst || this.itemDef(inst).id !== 'potion') return Game.fail('No tienes esa Poción.');
    if (!this.potionRecovery(p).length) return Game.fail('No hay pokebolas que recuperar de tu última captura.');
    return Game.ok();
  }

  usePotion(uid) {
    const check = this.checkPotion(uid);
    if (!check.ok) return check;
    const p = this.currentPlayer;
    const take = this.potionRecovery(p);
    take.forEach(g => { this.bank[g]--; p.tokens[g]++; p.lastPaid[g]--; });
    this.spendItem(p, uid);
    const names = take.map(g => this.gemLabel(g)).join(', ');
    this.addLog(`${p.name} usa una Poción y recupera ${names}.`, p.index, `Usas una Poción y recuperas ${names}.`);
    this.emit();
    return check;
  }

  // ---------- Objetos: Pepita (venderla por 3 pokebolas a elección; gratis)

  nuggetCount(inst) {
    return Math.min(this.itemDef(inst).sell, SM.Config.GEMS.reduce((s, g) => s + this.bank[g], 0));
  }

  checkNugget(uid, take) {
    const C = SM.Config;
    if (this.phase !== 'action') return Game.fail('Ahora no se puede usar.');
    const p = this.currentPlayer;
    const inst = this.ownedItem(p, uid);
    if (!inst || this.itemDef(inst).id !== 'nugget') return Game.fail('No tienes esa Pepita.');
    const want = this.nuggetCount(inst);
    if (take.some(g => !C.GEMS.includes(g))) return Game.fail(`No sirve con ${this.gemLabel(C.WILD)}.`);
    if (!take.every(g => take.filter(x => x === g).length <= this.bank[g])) return Game.fail('No quedan esas pokebolas.');
    if (take.length !== want) return Game.fail(`Elige ${want} pokebola(s).`);
    return Game.ok();
  }

  sellNugget(uid, take) {
    const check = this.checkNugget(uid, take);
    if (!check.ok) return check;
    const p = this.currentPlayer;
    take.forEach(g => { this.bank[g]--; p.tokens[g]++; });
    this.spendItem(p, uid);
    const names = take.map(g => this.gemLabel(g)).join(', ');
    this.addLog(`${p.name} vende una Pepita y recibe ${names}.`, p.index, `Vendes una Pepita y recibes ${names}.`);
    this.emit();
    return check;
  }

  // ---------- Objetos: Detector (captura gratis la de arriba del Nivel 1; es la acción)

  checkDowsing(uid) {
    if (this.phase !== 'action') return Game.fail('Ahora no se puede usar.');
    const p = this.currentPlayer;
    if (!this.ownedItem(p, uid, 'action')) return Game.fail('No tienes ese Detector.');
    if (!this.decks['1'].length) return Game.fail('El mazo de Nivel 1 está vacío.');
    return Game.ok();
  }

  useDowsing(uid) {
    const check = this.checkDowsing(uid);
    if (!check.ok) return check;
    const p = this.currentPlayer;
    const card = this.decks['1'].pop();
    p.cards.push(card);
    p.lastPaid = null;
    this.spendItem(p, uid);
    const pts = card.points ? ` (+${card.points} pts)` : '';
    this.addLog(`${p.name} usa el Detector y captura a ${card.name}${pts}.`, p.index, `Usas el Detector y capturas a ${card.name}${pts}.`);
    this.afterAction();
    this.emit();
    return check;
  }

  // ---------- Objetos: Ticket Barco (cambiar una carta de la mesa; gratis)

  checkTicket(uid, cardUid) {
    if (this.phase !== 'action') return Game.fail('Ahora no se puede usar.');
    const p = this.currentPlayer;
    if (!this.ownedItem(p, uid, 'market')) return Game.fail('No tienes ese Ticket Barco.');
    const loc = this.locate(cardUid);
    if (!loc || loc.where !== 'market') return Game.fail('Solo sirve con cartas de la mesa.');
    if (!this.decks[loc.tier].length) return Game.fail('Ese mazo está vacío: no hay con qué cambiarla.');
    return Game.ok();
  }

  useTicket(uid, cardUid) {
    const check = this.checkTicket(uid, cardUid);
    if (!check.ok) return check;
    const p = this.currentPlayer;
    const loc = this.locate(cardUid);
    const old = this.market[loc.tier][loc.slot];
    const fresh = this.decks[loc.tier].pop();
    this.market[loc.tier][loc.slot] = fresh;
    this.decks[loc.tier].unshift(old);
    this.spendItem(p, uid);
    this.addLog(`${p.name} usa un Ticket Barco: ${old.name} se va y llega ${fresh.name}.`, p.index,
      `Usas un Ticket Barco: ${old.name} se va y llega ${fresh.name}.`);
    this.emit();
    return check;
  }

  // ---------- Objetos: Lupa (mirar 3 del mazo y reservar una; es la acción del turno)

  checkLens(uid, tier) {
    const C = SM.Config;
    const p = this.currentPlayer;
    if (!this.ownedItem(p, uid, 'reserve')) return Game.fail('No tienes una Lupa.');
    return this.checkReserve({ type: 'deck', tier });
  }

  useLens(uid, tier) {
    const check = this.checkLens(uid, tier);
    if (!check.ok) return check;
    const p = this.currentPlayer;
    const n = this.itemDef(this.ownedItem(p, uid)).peek;
    const deck = this.decks[tier];
    p.peek = { tier, uids: deck.slice(-n).reverse().map(c => c.uid) };
    this.spendItem(p, uid);
    this.phase = 'peek';
    this.addLog(`${p.name} usa una Lupa en el mazo del ${SM.Config.TIER_LABELS[tier]}.`, p.index,
      `Usas una Lupa en el mazo del ${SM.Config.TIER_LABELS[tier]}.`);
    this.emit();
    return check;
  }

  reservePeek(uid) {
    const C = SM.Config;
    if (this.phase !== 'peek') return Game.fail('No estás mirando un mazo.');
    const p = this.currentPlayer;
    if (!p.peek || !p.peek.uids.includes(uid)) return Game.fail('Esa carta no es de las que miraste.');
    const deck = this.decks[p.peek.tier];
    const i = deck.findIndex(c => c && c.uid === uid);
    if (i < 0) return Game.fail('Esa carta ya no está en el mazo.');
    const card = deck.splice(i, 1)[0];
    p.reserved.push(card);
    let gotWild = false;
    if (this.bank[C.WILD] > 0) { this.bank[C.WILD]--; p.tokens[C.WILD]++; gotWild = true; }
    const tier = C.TIER_LABELS[p.peek.tier];
    p.peek = null;
    const wildName = this.gemLabel(C.WILD);
    this.addLog(`${p.name} reserva una carta oculta del ${tier}${gotWild ? ` y recibe una ${wildName}` : ''}.`, p.index,
      `Reservas a ${card.name}${gotWild ? ` y recibes una ${wildName}` : ''}.`);
    this.phase = 'action';
    this.afterAction();
    this.emit();
    return Game.ok();
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

  // discount: pokebolas que perdona un Cupón. Se descuentan primero las que habría que
  // pagar con Master Ball (las que no tienes), luego las de tu mano.
  // En equipos, "tus pokebolas" incluyen las del compañero (se cobran después de las tuyas).
  paymentFor(p, card, discount = 0) {
    const C = SM.Config;
    const bonus = this.bonusOf(p);
    const have = this.spendableTokens(p);
    const pay = Game.emptyTokens();
    const need = {};
    C.GEMS.forEach(g => { need[g] = Math.max(0, (card.cost[g] || 0) - bonus[g]); });
    let left = discount;
    const lackOf = g => Math.max(0, need[g] - have[g]);
    while (left > 0) {
      const g = C.GEMS.filter(x => need[x] > 0).sort((a, b) => lackOf(b) - lackOf(a) || need[b] - need[a])[0];
      if (!g) break;
      need[g]--; left--;
    }
    let wildNeeded = card.cost[C.WILD] || 0;
    C.GEMS.forEach(g => {
      const use = Math.min(need[g], have[g]);
      pay[g] = use;
      wildNeeded += need[g] - use;
    });
    pay[C.WILD] = wildNeeded;
    return { ok: have[C.WILD] >= wildNeeded, pay, missing: Math.max(0, wildNeeded - have[C.WILD]) };
  }

  // opts.coupon: uid de un Cupón para pagar menos.
  checkBuy(uid, opts = {}) {
    if (this.phase !== 'action') return Game.fail('Ahora no se puede capturar.');
    const loc = this.locate(uid);
    if (!loc) return Game.fail('Esa carta no está disponible.');
    const p = this.currentPlayer;
    if (loc.where === 'reserved' && loc.player !== p) return Game.fail('Esa carta la reservó otro jugador.');
    let discount = 0;
    if (opts.coupon) {
      const coupon = this.ownedItem(p, opts.coupon, 'capture');
      if (!coupon) return Game.fail('No tienes ese Cupón.');
      discount = this.itemDef(coupon).discount;
    }
    const card = this.cards.get(uid);
    const payment = this.paymentFor(p, card, discount);
    if (!payment.ok) {
      const wildOnly = (card.cost[SM.Config.WILD] || 0) > this.spendableTokens(p)[SM.Config.WILD];
      return Game.fail(wildOnly ? `Necesitas al menos 1 ${this.gemLabel(SM.Config.WILD)} para capturarla.` : `Te faltan ${payment.missing} pokebola(s).`);
    }
    return Game.ok({ pay: payment.pay });
  }

  buy(uid, opts = {}) {
    const check = this.checkBuy(uid, opts);
    if (!check.ok) return check;
    const p = this.currentPlayer;
    const card = this.removeCard(this.locate(uid));
    const helped = this.partnerNote(p, this.collectPayment(p, check.pay));
    if (opts.coupon) this.spendItem(p, opts.coupon);
    p.lastPaid = {};
    SM.Config.GEMS.forEach(g => { if (check.pay[g]) p.lastPaid[g] = check.pay[g]; });
    p.cards.push(card);
    const pts = card.points ? ` (+${card.points} pts)` : '';
    const coupon = opts.coupon ? ' con un Cupón' : '';
    this.addLog(`${p.name} captura a ${card.name}${pts}${coupon}${helped}.`, p.index, `Capturas a ${card.name}${pts}${coupon}${helped}.`);
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

  // Modo prueba: dar un objeto de la tienda gratis, sin gastar turno ni respetar el límite.
  giveItem(slot, playerIndex) {
    const p = this.players[playerIndex];
    const inst = this.itemShop[slot];
    if (!p || !inst) return Game.fail('Objeto o jugador desconocido.');
    const def = this.itemDef(inst);
    (def.kind === 'relic' ? p.relics : p.items).push(inst);
    this.itemShop[slot] = this.drawItem();
    this.addLog(`(Prueba) ${p.name} recibe ${def.name}.`, p.index, `(Prueba) Recibes ${def.name}.`);
    this.emit();
    return Game.ok();
  }

  // ---------- Sin acciones posibles

  hasLegalAction() {
    const C = SM.Config;
    const p = this.currentPlayer;
    if (C.GEMS.some(g => this.bank[g] > 0)) return true;
    if (this.itemShop.some((it, slot) => it && this.checkBuyItem(slot).ok)) return true;
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

  // Evoluciones posibles. Cada opción trae item: null (con tus capturas) o el objeto
  // que la permite (Caramelo Raro, o una piedra que suma pokebolas de su tipo).
  availableEvolutions(p = this.currentPlayer) {
    const bonus = this.bonusOf(p);
    const options = [];
    p.cards.forEach(base => base.evolutions.forEach(ev => {
      const loc = this.locate(ev.uid);
      if (!loc) return;
      if (loc.where === 'reserved' && loc.player !== p) return;
      const target = this.cards.get(ev.uid);
      if (bonus[ev.gem] >= ev.count) { options.push({ base, target, req: ev, item: null }); return; }
      const seen = new Set();
      p.items.forEach(inst => {
        const def = this.itemDef(inst);
        if (def.use !== 'evolve' || seen.has(def.id)) return;
        const works = def.candy || ((def.gem === ev.gem || def.gem === 'any') && bonus[ev.gem] + def.boost >= ev.count);
        if (works) { seen.add(def.id); options.push({ base, target, req: ev, item: inst }); }
      });
    }));
    return options;
  }

  evolve(baseUid, targetUid, itemUid = null) {
    if (this.phase !== 'evolve') return Game.fail('Ahora no se puede evolucionar.');
    const option = this.availableEvolutions().find(o => o.base.uid === baseUid && o.target.uid === targetUid
      && (o.item ? o.item.uid : null) === itemUid);
    if (!option) return Game.fail('Esa evolución no es posible.');
    const p = this.currentPlayer;
    const target = this.removeCard(this.locate(targetUid));
    p.cards.splice(p.cards.indexOf(option.base), 1, target);
    p.under.push(option.base);
    const using = option.item ? ` usando ${this.itemDef(option.item).name}` : '';
    if (option.item) {
      p.extraPoints = (p.extraPoints || 0) + (this.itemDef(option.item).points || 0);
      this.spendItem(p, option.item.uid);
    }
    this.addLog(`¡${option.base.name} de ${p.name} evoluciona a ${target.name}${using}!`, p.index,
      `¡Tu ${option.base.name} evoluciona a ${target.name}${using}!`);
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
    if (this.phase !== 'discard') return Game.fail('No tienes que devolver pokebolas.');
    const p = this.currentPlayer;
    if (p.tokens[gem] < 1) return Game.fail('No tienes pokebolas de ese tipo.');
    p.tokens[gem]--;
    this.bank[gem]++;
    if (this.tokenCount(p) <= SM.Config.MAX_TOKENS) {
      this.addLog(`${p.name} devuelve pokebolas hasta quedarse con ${SM.Config.MAX_TOKENS}.`, p.index,
        `Devuelves pokebolas hasta quedarte con ${SM.Config.MAX_TOKENS}.`);
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
    if (this.teams) {
      const points = this.teamPoints(p.team);
      if (!this.finalRound && points >= C.TEAM_TARGET_POINTS) {
        this.finalRound = true;
        this.addLog(`¡El ${this.teamLabel(p.team)} llega a ${points} puntos! Se juega hasta cerrar la ronda.`);
      }
    } else {
      const points = this.pointsOf(p);
      if (!this.finalRound && points >= C.TARGET_POINTS) {
        this.finalRound = true;
        this.addLog(`¡${p.name} llega a ${points} puntos! Se juega hasta cerrar la ronda.`, p.index,
          `¡Llegas a ${points} puntos! Se juega hasta cerrar la ronda.`);
      }
    }
    this.current = (this.current + 1) % this.players.length;
    if (this.current === this.first) {
      if (this.finalRound) { this.finish(); return; }
      this.round++;
    }
    this.phase = 'action';
    this.addLog(`Turno de ${this.currentPlayer.name}.`, this.current, 'Tu turno.');
    // Restos: si empieza con menos de 5 pokebolas en mano, recibe 1.
    const next = this.currentPlayer;
    if (this.hasRelic(next, 'leftovers') && this.tokenCount(next) < 5) {
      const g = C.GEMS.filter(x => this.bank[x] > 0).sort((a, b) => this.bank[b] - this.bank[a])[0];
      if (g) {
        this.bank[g]--; next.tokens[g]++;
        this.addLog(`Los Restos de ${next.name} le dan 1 ${this.gemLabel(g)}.`, next.index, `Tus Restos te dan 1 ${this.gemLabel(g)}.`);
      }
    }
  }

  finish() {
    this.phase = 'over';
    if (this.teams) {
      // Por equipos: puntos sumados; desempatan las evoluciones y luego tener menos criaturas.
      const sum = (team, f) => this.teamMembers(team).reduce((s, p) => s + f(p), 0);
      const score = t => [this.teamPoints(t), sum(t, p => p.under.length), -sum(t, p => p.cards.length)];
      const [a, b] = [score(0), score(1)];
      const diff = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      const winnerTeam = diff === 0 ? null : diff > 0 ? 0 : 1;
      const order = winnerTeam === 1 ? [1, 0] : [0, 1];
      const ranking = order.flatMap(t => this.teamMembers(t).sort((x, y) => this.pointsOf(y) - this.pointsOf(x)));
      this.result = { ranking, tie: winnerTeam == null, winnerTeam };
      this.addLog(winnerTeam == null ? 'La partida termina en empate.' : `¡Gana el ${this.teamLabel(winnerTeam)}!`);
      return;
    }
    const compare = (a, b) =>
      this.pointsOf(b) - this.pointsOf(a) ||
      b.under.length - a.under.length ||
      a.cards.length - b.cards.length;
    const ranking = this.players.slice().sort(compare);
    const tie = ranking.length > 1 && compare(ranking[0], ranking[1]) === 0;
    this.result = { ranking, tie, winnerTeam: null };
    if (tie) this.addLog('La partida termina en empate.');
    else this.addLog(`¡${ranking[0].name} gana la partida!`, ranking[0].index, '¡Ganas la partida!');
  }
};

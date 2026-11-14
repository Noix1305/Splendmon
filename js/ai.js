// Rival controlado por la máquina: elige jugadas sencillas y razonables.
// Cada llamada a step() hace un solo paso (acción, evolución o devolver una ficha).
SM.Ai = (function () {
  const C = SM.Config;
  const sum = obj => Object.values(obj).reduce((a, b) => a + b, 0);

  // Cuánto vale una carta para la máquina.
  function value(card) {
    return card.points * 3 + card.bonus * 1.2 + (card.evolutions.length ? 0.5 : 0);
  }

  // Lo que falta para pagar una carta, teniendo en cuenta bonificaciones, fichas y Amatistas.
  function shortfall(game, p, card) {
    const bonus = game.bonusOf(p);
    const need = {};
    let total = 0;
    C.GEMS.forEach(g => {
      need[g] = Math.max(0, (card.cost[g] || 0) - bonus[g] - p.tokens[g]);
      total += need[g];
    });
    const wildCost = card.cost[C.WILD] || 0;
    const spareWild = Math.max(0, p.tokens[C.WILD] - wildCost);
    const wildLack = Math.max(0, wildCost - p.tokens[C.WILD]);
    return { need, total: Math.max(0, total - spareWild) + wildLack, wildLack };
  }

  function reserveSource(game, card) {
    const loc = game.locate(card.uid);
    if (!loc || loc.where !== 'market' || !C.RESERVABLE_TIERS.includes(loc.tier)) return null;
    return { type: 'market', tier: loc.tier, slot: loc.slot };
  }

  function chooseAction(game) {
    const p = game.currentPlayer;
    const cards = game.visibleCardsFor(p);

    // 1. Capturar la mejor carta que se pueda pagar.
    let best = null;
    cards.forEach(card => {
      const check = game.checkBuy(card.uid);
      if (!check.ok) return;
      const score = value(card) - sum(check.pay) * 0.2;
      if (!best || score > best.score) best = { card, score };
    });
    if (best) return { type: 'buy', uid: best.card.uid };

    // 1b. Con un Cupón, capturar la mejor que alcance con el descuento.
    const coupon = p.items.find(i => SM.Items.def(i.id).use === 'capture');
    if (coupon) {
      cards.forEach(card => {
        const check = game.checkBuy(card.uid, { coupon: coupon.uid });
        if (!check.ok) return;
        const score = value(card);
        if (!best || score > best.score) best = { card, score };
      });
      if (best) return { type: 'buy', uid: best.card.uid, coupon: coupon.uid };
    }

    // 2. Elegir la carta a la que apuntar.
    let target = null;
    cards.forEach(card => {
      const s = shortfall(game, p, card);
      let score = value(card) / (1 + s.total);
      if (s.wildLack) score *= 0.4; // necesita Amatistas que solo llegan reservando
      if (!target || score > target.score) target = { card, s, score };
    });

    // 3. Con la mano casi llena, reservar el objetivo (da una Amatista).
    if (target && game.tokenCount(p) >= C.MAX_TOKENS - 1) {
      const src = reserveSource(game, target.card);
      if (src && game.checkReserve(src).ok) return { type: 'reserve', source: src };
    }

    // 3b. Con la mano casi llena, comprar un objeto útil en vez de tomar más pokébolas.
    if (game.tokenCount(p) >= C.MAX_TOKENS - 2) {
      const prefer = ['amulet-coin', 'leftovers', 'dowsing', 'rage-candy', 'rare-candy', 'bag', 'coupon', 'nugget', 'bike', 'potion',
        'sun-stone', 'ice-stone', 'fire-stone', 'water-stone', 'leaf-stone', 'thunder-stone', 'moon-stone'];
      const slot = game.itemShop
        .map((it, i) => ({ it, i }))
        .filter(x => x.it && prefer.includes(x.it.id) && game.checkBuyItem(x.i).ok && !game.itemPayment(p, x.it).pay[C.WILD])
        .sort((a, b) => prefer.indexOf(a.it.id) - prefer.indexOf(b.it.id))[0];
      if (slot) return { type: 'item', slot: slot.i };
    }

    // 4. Tomar las fichas que más falten.
    const need = target ? target.s.need : {};
    const globalNeed = {};
    C.GEMS.forEach(g => { globalNeed[g] = 0; });
    cards.forEach(card => {
      const s = shortfall(game, p, card);
      C.GEMS.forEach(g => { globalNeed[g] += s.need[g]; });
    });
    const neededColors = C.GEMS.filter(g => (need[g] || 0) > 0).length;
    const double = C.GEMS.find(g => (need[g] || 0) >= 2 && game.bank[g] >= C.MIN_BANK_FOR_DOUBLE);
    if (double && neededColors <= 2 && game.checkTake([double, double]).ok) {
      return { type: 'take', gems: [double, double] };
    }
    const ranked = C.GEMS
      .filter(g => game.bank[g] > 0)
      .sort((a, b) => (need[b] || 0) - (need[a] || 0) || globalNeed[b] - globalNeed[a] || game.bank[b] - game.bank[a]);
    // Con Bicicleta y espacio en la mano, se lleva una más.
    const bike = p.items.find(i => SM.Items.def(i.id).use === 'take');
    if (bike && game.tokenCount(p) + 4 <= C.MAX_TOKENS) {
      const four = ranked.slice(0, 4);
      if (four.length === 4 && game.checkTake(four, { bike: bike.uid }).ok) return { type: 'take', gems: four, bike: bike.uid };
    }
    const pick = ranked.slice(0, 3);
    if (pick.length && game.checkTake(pick).ok) return { type: 'take', gems: pick };

    // 5. Reservar lo que se pueda.
    const src = target && reserveSource(game, target.card);
    if (src && game.checkReserve(src).ok) return { type: 'reserve', source: src };
    for (const tier of C.RESERVABLE_TIERS) {
      const deck = { type: 'deck', tier };
      if (game.checkReserve(deck).ok) return { type: 'reserve', source: deck };
    }
    return { type: 'pass' };
  }

  function step(game) {
    const p = game.currentPlayer;
    if (game.phase === 'action') {
      // Objetos gratis primero (no gastan la acción): Poción y Pepita.
      const has = id => p.items.find(i => i.id === id);
      const potion = has('potion');
      if (potion && game.checkPotion(potion.uid).ok) { game.usePotion(potion.uid); return; }
      const nugget = has('nugget');
      if (nugget && game.tokenCount(p) + 3 <= C.MAX_TOKENS) {
        const pick = [];
        const bank = Object.assign({}, game.bank);
        for (let n = 0; n < game.nuggetCount(nugget); n++) {
          const g = C.GEMS.filter(x => bank[x] > 0).sort((a, b) => bank[b] - bank[a])[0];
          if (!g) break;
          pick.push(g); bank[g]--;
        }
        if (game.checkNugget(nugget.uid, pick).ok) { game.sellNugget(nugget.uid, pick); return; }
      }
      // Detector: captura gratis, es la acción del turno.
      const dowsing = has('dowsing');
      if (dowsing && game.checkDowsing(dowsing.uid).ok) { game.useDowsing(dowsing.uid); return; }

      const a = chooseAction(game);
      let result;
      if (a.type === 'buy') result = game.buy(a.uid, a.coupon ? { coupon: a.coupon } : {});
      else if (a.type === 'take') result = game.takeTokens(a.gems, a.bike ? { bike: a.bike } : {});
      else if (a.type === 'reserve') result = game.reserve(a.source);
      else if (a.type === 'item') result = game.buyItem(a.slot);
      else result = game.pass();
      if (!result.ok) {
        console.warn('La máquina no pudo jugar:', a, result.reason);
        game.pass(true);
      }
    } else if (game.phase === 'peek') {
      // Lupa: reservar la carta de más valor de las que miró.
      const seen = (p.peek ? p.peek.uids : []).map(uid => game.cards.get(uid)).sort((a, b) => value(b) - value(a));
      if (seen.length) game.reservePeek(seen[0].uid);
    } else if (game.phase === 'evolve') {
      // Sin objeto si se puede; con objeto solo si la evolución da al menos 2 puntos.
      const options = game.availableEvolutions().filter(o => !o.item || o.target.points >= 2);
      if (!options.length) { game.skipEvolution(); return; }
      options.sort((a, b) => b.target.points - a.target.points || (a.item ? 1 : 0) - (b.item ? 1 : 0));
      game.evolve(options[0].base.uid, options[0].target.uid, options[0].item ? options[0].item.uid : null);
    } else if (game.phase === 'discard') {
      const gems = C.GEMS.filter(g => p.tokens[g] > 0).sort((a, b) => p.tokens[b] - p.tokens[a]);
      game.returnToken(gems[0] || C.WILD);
    }
  }

  return { step };
})();

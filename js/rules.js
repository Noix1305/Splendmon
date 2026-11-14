// Guía de reglas interactiva. Usa las mismas piezas del juego (cartas, pokébolas,
// mazos) y los valores de js/config.js, así siempre coincide con lo que se juega.
(function () {
  const C = SM.Config;
  const $ = sel => document.querySelector(sel);
  let U = null; // SM.UI (se toma al iniciar, cuando ui.js ya cargó)
  let page = 0;
  let sampleCards = null;

  const ball = g => C.GEM_INFO[g].label;
  const WILD = () => ball(C.WILD);

  // ---------- Cartas de ejemplo: las cargadas, o las de ejemplo si aún no hay.
  function cards() {
    const loaded = U.cards();
    if (loaded.length) return loaded;
    if (!sampleCards && window.SAMPLE_MONSTERS) {
      try { sampleCards = SM.Cards.build(window.SAMPLE_MONSTERS).cards; } catch (e) { sampleCards = []; }
    }
    return sampleCards || [];
  }
  const costGems = card => C.GEMS.filter(g => card.cost[g]);
  const byUid = uid => cards().find(c => c.uid === uid);
  function pick(test) { return cards().find(test) || null; }

  function exampleBase() {
    return pick(c => c.tier === '1' && c.evolutions.length === 1 && costGems(c).length >= 2 && byUid(c.evolutions[0].uid))
      || pick(c => c.evolutions.length && byUid(c.evolutions[0].uid));
  }
  const examplePay = () => pick(c => c.tier === '2' && costGems(c).length >= 2) || pick(c => costGems(c).length >= 2);
  const exampleLegend = () => pick(c => c.tier === 'legend') || pick(c => c.tier === 'rare');

  // ---------- Piezas pequeñas
  function p(html) {
    const e = U.el('p');
    e.innerHTML = html; // solo texto fijo de esta guía, nunca datos del usuario
    return e;
  }
  function card(c, size) {
    if (!c) return U.el('p', 'muted', '(Carga criaturas para ver el ejemplo.)');
    const node = U.cardEl(c, { fullCost: true, size });
    addTips(node, c);
    return node;
  }

  // ---------- Explicación al pasar el mouse por cada parte de una carta
  let tipBox = null;
  function showTip(target, html) {
    const dlg = $('#rules-dialog');
    if (!tipBox || !dlg.contains(tipBox)) {
      tipBox = U.el('div', 'rules-tip');
      tipBox.setAttribute('role', 'tooltip');
      dlg.append(tipBox);
    }
    tipBox.innerHTML = html;
    tipBox.hidden = false;
    const r = target.getBoundingClientRect();
    const t = tipBox.getBoundingClientRect();
    let left = r.right + 10;
    if (left + t.width > window.innerWidth - 8) left = Math.max(8, r.left - t.width - 10);
    const top = Math.min(Math.max(8, r.top + r.height / 2 - t.height / 2), window.innerHeight - t.height - 8);
    tipBox.style.left = left + 'px';
    tipBox.style.top = top + 'px';
  }
  function hideTip() { if (tipBox) tipBox.hidden = true; }

  function tip(target, html) {
    if (!target) return;
    target.classList.add('has-tip');
    target.removeAttribute('title');
    target.addEventListener('mouseenter', e => { e.stopPropagation(); showTip(target, html); });
    target.addEventListener('mouseleave', hideTip);
  }

  const TIER_WORD = { '1': 'Nivel 1 (básico)', '2': 'Nivel 2 (primera evolución)', '3': 'Nivel 3 (evolución final)', rare: 'Raro', legend: 'Legendario' };

  function addTips(node, c) {
    node.querySelectorAll('[title]').forEach(n => n.removeAttribute('title'));
    tip(node.querySelector('.card-points'), c.points
      ? `<b>Puntos: ${c.points}</b><br>Al capturarlo suma ${c.points} punto(s) para llegar a ${C.TARGET_POINTS}.`
      : `<b>Puntos: 0</b><br>No suma puntos, pero sirve por la pokébola que genera.`);
    tip(node.querySelector('.card-bonus'),
      `<b>Genera ${c.bonus} ${ball(c.gem)} para siempre</b><br>Desde que lo capturas, cada captura te cuesta ${c.bonus} ${ball(c.gem)} menos. También cuenta para evolucionar.`);
    node.querySelectorAll('.evo-thumb').forEach((t, i) => {
      const ev = c.evolutions[i];
      if (ev) tip(t, `<b>Evoluciona a ${ev.name}</b><br>Necesitas ${ev.count} ${ball(ev.gem)} generadas por tus capturas, y que ${ev.name} esté en la mesa o en tus reservas. Es gratis y se hace al final del turno.`);
    });
    const about = `<b>${c.name}${c.num ? ' #' + c.num : ''}</b><br>${TIER_WORD[c.tier]} · ${c.types.join(' / ') || 'sin tipo'}.<br>El color del borde indica el mazo.`;
    tip(node.querySelector(':scope > .card-art'), about);
    tip(node.querySelector('.card-name'), about);
    const costBalls = node.querySelectorAll('.card-cost .gem');
    [...C.GEMS, C.WILD].filter(g => c.cost[g]).forEach((g, i) => {
      tip(costBalls[i], g === C.WILD
        ? `<b>Exige ${c.cost[g]} ${WILD()}</b><br>Obligatorio para Raros y Legendarios. Las ${WILD()} solo se consiguen reservando cartas.`
        : `<b>Cuesta ${c.cost[g]} ${ball(g)}</b><br>Se descuentan las ${ball(g)} que generan tus capturas; el resto lo pagas con las que tienes en mano o con ${WILD()}.`);
    });
  }
  function callout(text, cls = '') { const e = U.el('div', 'rules-callout ' + cls); e.innerHTML = text; return e; }
  function row(...kids) { const e = U.el('div', 'rules-row'); e.append(...kids); return e; }

  function stepper(label, value, min, max, onChange, gem) {
    const box = U.el('div', 'rules-stepper');
    if (gem) box.append(U.gemEl(gem, null, true));
    box.append(U.el('span', 'rules-stepper-label', label));
    const val = U.el('b', null, String(value));
    const set = v => { value = Math.max(min, Math.min(max, v)); val.textContent = String(value); onChange(value); };
    box.append(
      U.button('−', 'secondary small', () => set(value - 1)),
      val,
      U.button('+', 'secondary small', () => set(value + 1)),
    );
    return box;
  }

  // ---------- Páginas
  const PAGES = [
    {
      title: 'Objetivo', icon: '🏆',
      render(box) {
        box.append(
          p(`Eres un entrenador que <b>junta pokébolas</b>, <b>captura Pokémon</b> y los <b>hace evolucionar</b>.`),
          callout(`Gana quien tenga <b>${C.TARGET_POINTS} puntos o más</b> cuando se cierra la ronda.`, 'big'),
          p('Los puntos salen de los Pokémon que capturas (el número grande arriba a la izquierda de cada carta).'),
          p('Cada Pokémon capturado además te <b>genera una pokébola permanente</b>: un descuento para siempre en las próximas capturas. Así, cuanto más capturas, más fácil es capturar.'),
        );
        const leg = exampleLegend();
        if (leg) box.append(row(card(leg), callout(`Los legendarios como <b>${leg.name}</b> dan muchos puntos, pero exigen pagar ${WILD()}.`)));
      },
    },
    {
      title: 'Las pokébolas', icon: '🔴',
      render(box) {
        box.append(p('Son la moneda del juego. Hay cinco tipos normales; cada Pokémon genera la del tipo de su <b>primer tipo</b>:'));
        const groups = U.typeGroups();
        const list = U.el('div', 'rules-balls');
        C.GEMS.forEach(g => {
          const item = U.el('div', 'rules-ball');
          item.append(U.gemEl(g, null), U.el('b', null, ball(g)), U.el('span', 'muted', (groups[g] || []).join(', ') || '—'));
          list.append(item);
        });
        const wild = U.el('div', 'rules-ball wild');
        wild.append(U.gemEl(C.WILD, null), U.el('b', null, WILD()), U.el('span', null, 'Comodín: sirve como cualquier otra. Solo se consigue reservando.'));
        list.append(wild);
        box.append(list);
        box.append(callout(`En una partida de 2 hay <b>${C.TOKENS_PER_GEM[2]}</b> de cada tipo normal y <b>${C.WILD_TOKENS}</b> ${WILD()}.`));
      },
    },
    {
      title: 'La mesa', icon: '🃏',
      render(box) {
        box.append(p('Hay cinco mazos. De cada uno se dejan algunas cartas boca arriba: ese es el <b>mercado</b>.'));
        const grid = U.el('div', 'rules-decks');
        const info = {
          '1': 'Básicos. Baratos, casi no dan puntos.',
          '2': 'Primera evolución. Más caros, más puntos.',
          '3': 'Evolución final. Los que más puntos dan.',
          rare: `Sin evolución. Dan <b>2</b> pokébolas permanentes y piden 1 ${WILD()}.`,
          legend: `Los más valiosos. Dan <b>2</b> pokébolas permanentes y piden 1 ${WILD()}.`,
        };
        C.TIERS.forEach(t => {
          const item = U.el('div', 'rules-deck');
          const back = U.backEl(t);
          const txt = U.el('div');
          txt.append(U.el('b', null, `${C.TIER_LABELS[t]} · ${C.MARKET_SIZE[t]} a la vista`));
          const d = U.el('div', 'muted'); d.innerHTML = info[t];
          txt.append(d);
          item.append(back, txt);
          grid.append(item);
        });
        box.append(grid);
        box.append(callout('Cuando alguien se lleva una carta del mercado, se repone al tiro con una del mismo mazo.'));
      },
    },
    {
      title: 'Leer una carta', icon: '🔍',
      render(box) {
        const c = exampleBase();
        if (!c) { box.append(p('Carga criaturas para ver una carta de ejemplo.')); return; }
        const node = card(c, 'big');
        const wrap = U.el('div', 'rules-anatomy');
        wrap.append(node);
        const parts = [
          ['.card-points', 'Puntos', 'Lo que suma para llegar a la meta. Si no hay número, da 0.'],
          ['.card-bonus', 'Pokébola que genera', 'Al capturarlo, te da esta pokébola <b>para siempre</b> (descuento en cada captura).'],
          ['.evo-thumbs', 'Evolución', 'A quién evoluciona. La pokébola pequeña dice cuántas de ese tipo necesitas <b>generadas por tus capturas</b>.'],
          ['.card-art', 'El Pokémon', 'Haz clic en cualquier carta del juego para ver todos sus datos.'],
          ['.card-cost', 'Costo', 'Las pokébolas que hay que pagar. En la partida, aquí ves <b>cuántas te faltan</b> (✓ = cubierto).'],
        ];
        const list = U.el('ol', 'rules-parts');
        parts.forEach(([sel, name, text], i) => {
          const target = node.querySelector(sel);
          if (!target) return;
          target.classList.add('rules-part');
          target.append(U.el('span', 'rules-pin', String(i + 1)));
          const li = U.el('li');
          li.tabIndex = 0;
          li.innerHTML = `<b>${name}.</b> ${text}`;
          const on = () => { node.querySelectorAll('.rules-hl').forEach(x => x.classList.remove('rules-hl')); target.classList.add('rules-hl'); list.querySelectorAll('li').forEach(x => x.classList.toggle('active', x === li)); };
          li.addEventListener('mouseenter', on);
          li.addEventListener('focus', on);
          li.addEventListener('click', on);
          list.append(li);
        });
        wrap.append(list);
        box.append(p(`Pasa el mouse (o toca) cada punto para ver dónde está en la carta de <b>${c.name}</b>. En todas las cartas de esta guía, al pasar el mouse por una parte se explica qué es y para qué sirve.`), wrap);
      },
    },
    {
      title: 'Tu turno', icon: '🎯',
      render(box) {
        box.append(p('En tu turno haces <b>una sola</b> de estas acciones:'));
        const acts = U.el('div', 'rules-actions');
        [
          ['A', 'Tomar 3 pokébolas distintas', ''],
          ['B', 'Tomar 2 iguales', `Solo si quedan <b>${C.MIN_BANK_FOR_DOUBLE} o más</b> de ese tipo.`],
          ['C', 'Reservar una carta', `Te la guardas (máximo ${C.MAX_RESERVED}) y recibes 1 ${WILD()}. Solo Nivel 1, 2 o 3; puede ser la de arriba del mazo, sin verla.`],
          ['D', 'Capturar un Pokémon', 'De la mesa o de tus reservas, pagando su costo.'],
        ].forEach(([k, t, d]) => {
          const a = U.el('div', 'rules-action');
          a.append(U.el('span', 'rules-action-key', k));
          const txt = U.el('div'); txt.append(U.el('b', null, t));
          if (d) { const s = U.el('div', 'muted'); s.innerHTML = d; txt.append(s); }
          a.append(txt);
          acts.append(a);
        });
        box.append(acts);
        box.append(U.el('h3', null, 'Pruébalo: toma pokébolas'));
        box.append(takeSimulator());
      },
    },
    {
      title: 'Capturar y pagar', icon: '💰',
      render(box) {
        box.append(
          p('Para capturar pagas el costo de la carta. Antes de pagar se descuenta lo que <b>generan tus capturas</b>; lo que falte lo pagas con las pokébolas <b>en mano</b>, y si aún falta, con '
            + `${WILD()} (comodín).`),
        );
        const c = examplePay();
        if (!c) return;
        box.append(U.el('h3', null, `Pruébalo con ${c.name}`));
        box.append(paySimulator(c));
      },
    },
    {
      title: 'Evolucionar', icon: '✨',
      render(box) {
        const base = exampleBase();
        const ev = base && base.evolutions[0];
        const target = ev && byUid(ev.uid);
        box.append(
          p('Al final de tu turno puedes evolucionar <b>un</b> Pokémon, gratis, si:'),
        );
        const ul = U.el('ul', 'rules-list');
        ['su evolución está <b>en la mesa</b> o <b>en tus reservas</b>, y',
          'tus capturas generan suficientes pokébolas del tipo que pide (las de mano <b>no</b> cuentan).'].forEach(t => { const li = U.el('li'); li.innerHTML = t; ul.append(li); });
        box.append(ul);
        if (!target) return;
        const status = U.el('div', 'rules-callout');
        const pair = U.el('div', 'rules-evo');
        pair.append(card(base, 'small'), U.el('span', 'rules-arrow', '➜'), card(target, 'small'));
        box.append(pair);
        const update = n => {
          const ok = n >= ev.count;
          status.className = 'rules-callout ' + (ok ? 'good' : 'bad');
          status.innerHTML = ok
            ? `✓ ¡Puedes evolucionar ${base.name} a ${target.name}!`
            : `Te faltan <b>${ev.count - n}</b> ${ball(ev.gem)} generadas por capturas (necesitas ${ev.count}).`;
        };
        box.append(stepper(`${ball(ev.gem)} generadas por tus capturas:`, 0, 0, 6, update, ev.gem), status);
        update(0);
        box.append(callout('El Pokémon anterior queda debajo: ya no da puntos ni pokébolas, pero cuenta para el desempate.'));
      },
    },
    {
      title: 'Objetos', icon: '🎒',
      render(box) {
        box.append(
          p(`En la mesa hay una <b>tienda</b> con ${C.ITEM_SHOP_SIZE} objetos a la vista. Comprar uno es <b>tu acción del turno</b>.`),
          p(`Se pagan con pokébolas <b>de tu mano</b> (las generadas por tus capturas no descuentan); lo que falte, con ${WILD()}.`),
          p(`Puedes guardar hasta <b>${C.MAX_ITEMS}</b> objetos de un uso. Tu rival solo ve cuántos tienes, no cuáles. Los <b>permanentes</b> se ven y no ocupan espacio.`),
          p('Usar un objeto no gasta tu acción: se usa en el momento que corresponde (al capturar, al tomar, al evolucionar…).'),
          p('Cada objeto existe <b>una sola vez</b>. Mientras alguien lo tiene no aparece en la tienda; cuando lo usa, <b>vuelve al mazo</b> de la tienda.'),
        );
        const list = U.el('div', 'rules-items');
        SM.Items.list.forEach(def => {
          const row = U.el('div', 'rules-item');
          row.append(U.itemEl({ uid: 'demo-' + def.id, id: def.id, cost: {} }, { size: 'small', showCost: false }));
          const txt = U.el('div');
          txt.append(U.el('b', null, `${def.name} · ${def.price} pokébola${def.price > 1 ? 's' : ''}`));
          txt.append(U.el('div', 'muted', def.text));
          row.append(txt);
          list.append(row);
        });
        box.append(list);
      },
    },
    {
      title: 'Fin del turno y de la partida', icon: '🏁',
      render(box) {
        box.append(
          U.el('h3', null, `Máximo ${C.MAX_TOKENS} pokébolas en mano`),
          p(`Si terminas el turno con más de ${C.MAX_TOKENS} (contando ${WILD()}), devuelves las que elijas hasta quedar con ${C.MAX_TOKENS}. Las generadas por capturas no cuentan.`),
          U.el('h3', null, 'Última ronda'),
          p(`Cuando alguien llega a <b>${C.TARGET_POINTS} puntos</b>, se termina la ronda para que todos jueguen la misma cantidad de turnos.`),
          U.el('h3', null, 'Desempate'),
        );
        const ol = U.el('ol', 'rules-list');
        ['Más puntos.', 'Si empatan: más evoluciones hechas.', 'Si siguen empatados: menos Pokémon capturados.'].forEach(t => ol.append(U.el('li', null, t)));
        box.append(ol, callout('¡Listo! Ya sabes jugar. Puedes volver a esta guía desde el botón «Reglas» durante la partida.', 'good'));
      },
    },
  ];

  // ---------- Simulador: tomar pokébolas (mismas reglas que la partida)
  function takeSimulator() {
    const bank = {};
    C.GEMS.forEach((g, i) => { bank[g] = [4, 4, 2, 4, 3][i] ?? 4; });
    bank[C.WILD] = C.WILD_TOKENS;
    let sel = [];
    const box = U.el('div', 'rules-sim');
    const stacks = U.el('div', 'bank-stacks rules-bank');
    const msg = U.el('div', 'rules-callout');
    const canAdd = g => {
      if (g === C.WILD || !bank[g]) return false;
      if (sel.length === 1 && sel[0] === g) return bank[g] >= C.MIN_BANK_FOR_DOUBLE;
      if (sel.includes(g)) return false;
      return sel.length < 3 && !(sel.length === 2 && sel[0] === sel[1]);
    };
    const click = g => {
      if (sel.length === 1 && sel[0] === g && bank[g] >= C.MIN_BANK_FOR_DOUBLE) sel.push(g);
      else if (sel.includes(g)) sel = sel.filter(x => x !== g);
      else if (canAdd(g)) sel.push(g);
      render();
    };
    function render() {
      stacks.textContent = '';
      [...C.GEMS, C.WILD].forEach(g => {
        const n = sel.filter(x => x === g).length;
        const ok = n > 0 || canAdd(g);
        const b = U.button('', 'bank-token' + (n ? ' selected' : '') + (ok ? '' : ' unavailable'), () => click(g), !ok);
        b.append(U.gemEl(g, bank[g]));
        if (n) b.append(U.el('span', 'sel-mark', '×' + n));
        b.title = ball(g);
        stacks.append(b);
      });
      const distinct = new Set(sel).size;
      let text; let cls;
      if (!sel.length) { text = 'Toca las pokébolas para elegir. Las que se ven en blanco y negro no se pueden elegir.'; cls = ''; }
      else if (sel.length === 2 && distinct === 1) { text = `✓ Dos ${ball(sel[0])} iguales (había ${bank[sel[0]]}, al menos ${C.MIN_BANK_FOR_DOUBLE}).`; cls = 'good'; }
      else if (sel.length === 3) { text = '✓ Tres pokébolas distintas. ¡Jugada válida!'; cls = 'good'; }
      else { text = `Llevas ${sel.length}. Elige ${3 - sel.length} distinta(s) más` + (sel.length === 1 && bank[sel[0]] >= C.MIN_BANK_FOR_DOUBLE ? `, o toca otra vez la ${ball(sel[0])} para tomar 2 iguales.` : '.'); cls = ''; }
      const low = C.GEMS.find(g => bank[g] < C.MIN_BANK_FOR_DOUBLE);
      if (low && sel.length === 1 && sel[0] === low) text += ` (De ${ball(low)} quedan solo ${bank[low]}: no se pueden tomar 2.)`;
      msg.className = 'rules-callout ' + cls;
      msg.textContent = text;
    }
    box.append(stacks, msg, U.button('Empezar de nuevo', 'secondary small', () => { sel = []; render(); }));
    render();
    return box;
  }

  // ---------- Simulador: pagar una captura
  function paySimulator(c) {
    const gems = costGems(c);
    // Ejemplo inicial: una pokébola generada por capturas, casi todo en mano y
    // 1 Master Ball cubriendo lo último (así se ve el descuento y el comodín).
    const bonus = {}; const hand = {};
    gems.forEach((g, i) => {
      bonus[g] = i === 0 ? 1 : 0;
      hand[g] = Math.max(0, c.cost[g] - bonus[g] - (i === gems.length - 1 ? 1 : 0));
    });
    let wild = 1 + (c.cost[C.WILD] || 0);
    const box = U.el('div', 'rules-pay');
    box.append(card(c));
    const right = U.el('div', 'rules-pay-side');
    const table = U.el('table', 'cost-table');
    const result = U.el('div', 'rules-callout');
    function render() {
      table.textContent = '';
      const head = U.el('tr');
      ['Pokébola', 'Cuesta', 'Capturas', 'En mano', 'Pagas'].forEach(h => head.append(U.el('th', null, h)));
      table.append(head);
      let wildNeeded = c.cost[C.WILD] || 0;
      gems.forEach(g => {
        const need = Math.max(0, c.cost[g] - bonus[g]);
        const use = Math.min(need, hand[g]);
        wildNeeded += need - use;
        const tr = U.el('tr');
        const name = U.el('td', 'cost-name'); name.append(U.gemEl(g, null, true), U.el('span', null, ball(g)));
        tr.append(name, U.el('td', null, String(c.cost[g])), U.el('td', null, String(bonus[g])), U.el('td', null, String(hand[g])),
          U.el('td', need - use ? 'warn' : 'ok', need === 0 ? 'gratis' : `${use}` + (need - use ? ` (+${need - use} ${WILD()})` : '')));
        table.append(tr);
      });
      if (c.cost[C.WILD]) {
        const tr = U.el('tr');
        const name = U.el('td', 'cost-name'); name.append(U.gemEl(C.WILD, null, true), U.el('span', null, WILD()));
        tr.append(name, U.el('td', null, String(c.cost[C.WILD])), U.el('td', null, '—'), U.el('td', null, String(wild)), U.el('td', null, String(c.cost[C.WILD])));
        table.append(tr);
      }
      const ok = wild >= wildNeeded;
      result.className = 'rules-callout ' + (ok ? 'good' : 'bad');
      result.innerHTML = ok
        ? `✓ ¡Lo capturas!${wildNeeded ? ` Usas ${wildNeeded} ${WILD()}.` : ''}`
        : `Te faltan <b>${wildNeeded - wild}</b> pokébola(s). Consigue más o usa ${WILD()}.`;
    }
    // Una fila por pokébola: [icono nombre] [capturas −n+] [en mano −n+]
    const controls = U.el('div', 'rules-controls');
    const ctrlRow = (g, parts) => {
      const name = U.el('div', 'cost-name');
      name.append(U.gemEl(g, null, true), U.el('span', null, ball(g)));
      controls.append(name, ...parts);
    };
    gems.forEach(g => ctrlRow(g, [
      stepper('Capturas', bonus[g], 0, 6, v => { bonus[g] = v; render(); }),
      stepper('En mano', hand[g], 0, 6, v => { hand[g] = v; render(); }),
    ]));
    ctrlRow(C.WILD, [U.el('span'), stepper('En mano', wild, 0, 5, v => { wild = v; render(); })]);
    right.append(U.el('p', 'muted', 'Cambia los números y mira cómo cambia el pago:'), controls, table, result);
    box.append(right);
    render();
    return box;
  }

  // ---------- Ventana
  function build() {
    const dlg = $('#rules-dialog');
    dlg.textContent = '';
    const head = U.el('div', 'rules-head');
    const h = U.el('h2', null, 'Cómo se juega'); h.id = 'rules-title';
    head.append(h, U.button('Cerrar', 'secondary small', () => dlg.close()));
    const nav = U.el('nav', 'rules-nav');
    PAGES.forEach((pg, i) => {
      const b = U.button(`${pg.icon} ${pg.title}`, 'rules-tab' + (i === page ? ' active' : ''), () => go(i));
      if (i === page) b.setAttribute('aria-current', 'step');
      nav.append(b);
    });
    const body = U.el('section', 'rules-body');
    body.append(U.el('h2', null, `${PAGES[page].icon} ${PAGES[page].title}`));
    PAGES[page].render(body);
    const foot = U.el('div', 'rules-foot');
    foot.append(
      U.button('← Anterior', 'secondary', () => go(page - 1), page === 0),
      U.el('span', 'muted', `${page + 1} de ${PAGES.length}`),
      page < PAGES.length - 1 ? U.button('Siguiente →', 'primary', () => go(page + 1)) : U.button('¡A jugar!', 'primary', () => dlg.close()),
    );
    const main = U.el('div', 'rules-main');
    main.append(body, foot);
    dlg.append(head, nav, main);
  }

  function go(i) {
    hideTip();
    page = Math.max(0, Math.min(PAGES.length - 1, i));
    build();
    const body = $('#rules-dialog .rules-body');
    if (body) body.scrollTop = 0;
    const tab = $('#rules-dialog .rules-tab.active');
    if (tab) tab.focus();
  }

  function open() {
    build();
    const dlg = $('#rules-dialog');
    if (!dlg.open) dlg.showModal();
  }

  document.addEventListener('DOMContentLoaded', () => {
    U = SM.UI;
    $('#rules-open').addEventListener('click', open);
    $('#rules-game').addEventListener('click', open);
    const dlg = $('#rules-dialog');
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('keydown', e => {
      if (e.target.closest('button, input')) {
        if (!e.target.classList.contains('rules-tab')) return;
      }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(page + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(page - 1); }
    });
  });
})();

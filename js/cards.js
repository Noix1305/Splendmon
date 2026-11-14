// Convierte la lista de criaturas del JSON en cartas jugables.
// El JSON no trae costes ni puntos: se calculan de forma estable (siempre
// salen iguales) a partir de la cadena evolutiva, el tipo y el peso.
SM.Cards = (function () {
  const C = SM.Config;

  // Generador pseudoaleatorio con semilla (mulberry32).
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(list, random) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function parseMeasure(text) {
    const m = String(text ?? '').replace(',', '.').match(/\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }

  // Admite direcciones web, rutas relativas a index.html ("img/001.png") y rutas
  // completas de Windows ("C:/Users/.../001.png"), que pasan a file:///C:/...
  function imagePath(img) {
    if (typeof img !== 'string' || !img.trim()) return '';
    const path = img.trim().replace(/\\/g, '/');
    return /^[A-Za-z]:\//.test(path) ? 'file:///' + encodeURI(path) : path;
  }

  // Recorte ajustado al dibujo (img/pokemon/thumbs/NNN.png) para que todas las
  // criaturas se vean del mismo tamaño. Solo existe para las imágenes de img/pokemon/.
  function thumbPath(img) {
    return /(^|\/)img\/pokemon\/[^/]+\.png$/i.test(img) ? img.replace(/(img\/pokemon\/)([^/]+)$/i, '$1thumbs/$2') : '';
  }

  function numberOf(m, fallback) {
    const n = parseInt(m.id ?? m.num, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function typeGroups(json) {
    const groups = Object.assign({}, C.DEFAULT_TYPE_GEMS, (json && json.typeGems) || {});
    const clean = {};
    C.GEMS.forEach(g => { clean[g] = Array.isArray(groups[g]) ? groups[g] : []; });
    return clean;
  }

  function typeMap(groups) {
    const map = {};
    C.GEMS.forEach(g => groups[g].forEach(t => { map[String(t).toLowerCase()] = g; }));
    return map;
  }

  function gemFor(types, map, random) {
    for (const t of types) {
      const g = map[String(t).toLowerCase()];
      if (g) return g;
    }
    return C.GEMS[Math.floor(random() * C.GEMS.length)];
  }

  // Deduce las etapas y las evoluciones inmediatas desde "next_evolution".
  // Admite listas con todas las etapas siguientes (001 -> [002, 003]) o solo la inmediata.
  function analyseChains(list) {
    const byNum = new Map();
    const byName = new Map();
    list.forEach(m => {
      if (m.num != null) byNum.set(String(m.num), m);
      byName.set(String(m.name).toLowerCase(), m);
    });
    const find = ref => ref && (byNum.get(String(ref.num)) || byName.get(String(ref.name || '').toLowerCase()));

    const later = new Map();
    list.forEach(m => later.set(m, (m.next_evolution || []).map(find).filter(x => x && x !== m)));

    const isTarget = new Set();
    later.forEach(arr => arr.forEach(x => isTarget.add(x)));

    // Inmediatas: las siguientes que no son a su vez evolución de otra de la lista.
    const children = new Map();
    list.forEach(m => {
      const nexts = later.get(m);
      children.set(m, nexts.filter(n => !nexts.some(o => o !== n && later.get(o).includes(n))));
    });

    const stage = new Map();
    const queue = [];
    list.forEach(m => { if (!isTarget.has(m)) { stage.set(m, 1); queue.push(m); } });
    while (queue.length) {
      const m = queue.shift();
      children.get(m).forEach(c => {
        if (!stage.has(c)) { stage.set(c, Math.min(stage.get(m) + 1, 3)); queue.push(c); }
      });
    }
    list.forEach(m => { if (!stage.has(m)) stage.set(m, 1); });
    return { children, isTarget, stage };
  }

  function classify(list, chains) {
    const standalone = list.filter(m => !chains.isTarget.has(m) && chains.children.get(m).length === 0);
    const flagged = list.some(m => Object.prototype.hasOwnProperty.call(m, 'legendary'));
    let legends;
    if (flagged) {
      legends = new Set(standalone.filter(m => m.legendary === true));
    } else if (standalone.length > C.LEGEND_FALLBACK_COUNT) {
      const sorted = standalone.slice().sort((a, b) => numberOf(a, 0) - numberOf(b, 0));
      legends = new Set(sorted.slice(-C.LEGEND_FALLBACK_COUNT));
    } else {
      legends = new Set();
    }
    const standaloneSet = new Set(standalone);
    const tierOf = new Map();
    list.forEach(m => {
      if (legends.has(m)) tierOf.set(m, 'legend');
      else if (standaloneSet.has(m)) tierOf.set(m, 'rare');
      else tierOf.set(m, String(chains.stage.get(m)));
    });
    return tierOf;
  }

  function build(json) {
    const list = Array.isArray(json) ? json : json && json.monsters;
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('El archivo no tiene una lista "monsters" con criaturas.');
    }
    const warnings = [];
    const valid = list.filter(m => m && m.name);
    if (valid.length < list.length) warnings.push(`Se ignoraron ${list.length - valid.length} criaturas sin nombre.`);

    const groups = typeGroups(Array.isArray(json) ? null : json);
    const types = typeMap(groups);
    const chains = analyseChains(valid);
    const tierOf = classify(valid, chains);

    // Posición de cada criatura por peso dentro de su nivel (0 = la más ligera, 1 = la más pesada).
    const percentile = new Map();
    C.TIERS.forEach(tier => {
      const group = valid
        .filter(m => tierOf.get(m) === tier)
        .sort((a, b) => parseMeasure(a.weight) - parseMeasure(b.weight) || numberOf(a, 0) - numberOf(b, 0));
      group.forEach((m, i) => percentile.set(m, group.length > 1 ? i / (group.length - 1) : 0.5));
    });

    const cardOf = new Map();
    valid.forEach((m, index) => {
      const random = seededRandom(numberOf(m, index + 1) * 7919 + 13);
      const tier = tierOf.get(m);
      const monsterTypes = Array.isArray(m.type) ? m.type : (m.type ? [m.type] : []);
      const gem = gemFor(monsterTypes, types, random);
      const patterns = C.COST_PATTERNS[tier];
      const [points, counts] = patterns[Math.min(patterns.length - 1, Math.floor(percentile.get(m) * patterns.length))];
      const others = shuffled(C.GEMS.filter(g => g !== gem), random);
      const cost = {};
      counts.forEach((n, i) => { cost[others[i]] = n; });
      if (C.WILD_REQUIRED[tier]) cost[C.WILD] = C.WILD_REQUIRED[tier];

      cardOf.set(m, {
        uid: 'c' + index,
        num: m.num != null ? String(m.num) : '',
        name: String(m.name),
        img: imagePath(m.img),
        thumb: thumbPath(imagePath(m.img)),
        types: monsterTypes,
        height: m.height || '',
        weight: m.weight || '',
        weaknesses: Array.isArray(m.weaknesses) ? m.weaknesses : [],
        tier,
        gem,
        bonus: C.BONUS_AMOUNT[tier],
        points,
        cost,
        evolutions: [],
      });
    });

    // Requisitos de evolución: N bonificaciones del color de la evolución.
    valid.forEach(m => {
      const card = cardOf.get(m);
      const range = C.EVOLUTION_REQUIREMENT[card.tier];
      if (!range) return;
      chains.children.get(m).forEach(child => {
        const target = cardOf.get(child);
        const count = percentile.get(m) > 0.5 ? range[1] : range[0];
        card.evolutions.push({ uid: target.uid, name: target.name, img: target.img, thumb: target.thumb, gem: target.gem, count });
      });
    });

    const cards = [...cardOf.values()];
    C.TIERS.forEach(tier => {
      const n = cards.filter(c => c.tier === tier).length;
      if (n < C.MARKET_SIZE[tier]) {
        warnings.push(`${C.TIER_LABELS[tier]}: solo ${n} carta(s); el mercado muestra ${C.MARKET_SIZE[tier]}.`);
      }
    });
    return { cards, warnings, typeGroups: groups };
  }

  return { build };
})();

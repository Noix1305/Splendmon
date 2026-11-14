// Objetos: se compran en la tienda de la mesa con pokébolas de tu mano (las generadas
// por capturas NO descuentan; la Master Ball sirve de comodín).
//
// Cada objeto es un dato. Para agregar uno nuevo, se suma aquí y se programa su
// efecto en js/game.js según su "use". Pensado para crecer (por ejemplo, un modo
// roguelite con reliquias y recompensas entre combates).
//
// kind: 'consumable' -> se gasta al usarlo y ocupa uno de tus espacios de objeto.
//       'relic'      -> permanente: queda a la vista en tu zona y no ocupa espacio.
// use:  'evolve'  -> se usa al evolucionar (Caramelo Raro, piedras).
//       'capture' -> se usa al capturar (Cupón).
//       'take'    -> se usa al tomar pokébolas (Bicicleta).
//       'reserve' -> se usa al reservar del mazo (Lupa).
//       'free'    -> se usa cuando quieras en tu turno, sin gastar la acción (Intercambiador, Poción, Pepita).
//       'market'  -> se usa sobre una carta de la mesa, sin gastar la acción (Ticket Barco).
//       'action'  -> es tu acción del turno (Detector).
//       'passive' -> funciona solo (Amuleto Moneda, Mochila, Restos).
// price: cuántas pokébolas cuesta. Cada copia pide tipos distintos al azar.
// copies: cuántas copias hay en el mazo de objetos (1: cada objeto es único y la tienda nunca lo repite).
// img: sprite del objeto (PokéSprite, licencia MIT). icon: emoji de respaldo y para textos.
SM.Items = (function () {
  const DEFS = [
    {
      id: 'rare-candy', img: 'img/items/rare-candy.png', name: 'Caramelo Raro', icon: '🍬', kind: 'consumable', use: 'evolve', candy: true, price: 3, copies: 1,
      text: 'Evoluciona un Pokémon aunque no tengas las pokébolas generadas que pide. Su evolución tiene que estar en la mesa o en tus reservas.',
    },
    { id: 'fire-stone', img: 'img/items/fire-stone.png', name: 'Piedra Fuego', icon: '🔥', kind: 'consumable', use: 'evolve', gem: 'ruby', boost: 2, price: 2, copies: 1 },
    { id: 'water-stone', img: 'img/items/water-stone.png', name: 'Piedra Agua', icon: '💧', kind: 'consumable', use: 'evolve', gem: 'sapphire', boost: 2, price: 2, copies: 1 },
    { id: 'leaf-stone', img: 'img/items/leaf-stone.png', name: 'Piedra Hoja', icon: '🍃', kind: 'consumable', use: 'evolve', gem: 'emerald', boost: 2, price: 2, copies: 1 },
    { id: 'thunder-stone', img: 'img/items/thunder-stone.png', name: 'Piedra Trueno', icon: '⚡', kind: 'consumable', use: 'evolve', gem: 'topaz', boost: 2, price: 2, copies: 1 },
    { id: 'moon-stone', img: 'img/items/moon-stone.png', name: 'Piedra Lunar', icon: '🌙', kind: 'consumable', use: 'evolve', gem: 'onyx', boost: 2, price: 2, copies: 1 },
    {
      id: 'coupon', img: 'img/items/discount-coupon.png', name: 'Cupón', icon: '🎟️', kind: 'consumable', use: 'capture', discount: 2, price: 2, copies: 1,
      text: 'Al capturar, la captura cuesta 2 pokébolas menos (se descuentan primero las que te faltan). No reemplaza la Master Ball obligatoria de Raros y Legendarios.',
    },
    {
      id: 'bike', img: 'img/items/bicycle.png', name: 'Bicicleta', icon: '🚲', kind: 'consumable', use: 'take', extra: 1, price: 2, copies: 1,
      text: 'Al tomar pokébolas, tomas 1 más: 4 distintas, o 2 iguales y 1 distinta.',
    },
    {
      id: 'lens', img: 'img/items/scope-lens.png', name: 'Lupa', icon: '🔍', kind: 'consumable', use: 'reserve', peek: 3, price: 2, copies: 1,
      text: 'En vez de reservar a ciegas, miras las 3 cartas de arriba de un mazo (Nivel 1, 2 o 3) y reservas la que quieras. Recibes Master Ball como siempre. Es tu acción del turno.',
    },
    {
      id: 'swap', img: 'img/items/pokemon-box-link.png', name: 'Intercambiador', icon: '🔄', kind: 'consumable', use: 'free', max: 2, price: 1, copies: 1,
      text: 'Cambia hasta 2 pokébolas de tu mano por otras de las disponibles. No gasta tu acción del turno. No sirve con Master Ball.',
    },
    {
      id: 'amulet-coin', img: 'img/items/amulet-coin.png', name: 'Amuleto Moneda', icon: '💰', kind: 'relic', use: 'passive', price: 4, copies: 1,
      text: 'Permanente. Cada vez que tomas 3 pokébolas distintas o más, recibes 1 extra de una de ellas (si quedan).',
    },
    // Piedras comodín: sirven para cualquier tipo, pero suman menos.
    { id: 'sun-stone', img: 'img/items/sun-stone.png', name: 'Piedra Solar', icon: '☀️', kind: 'consumable', use: 'evolve', gem: 'any', boost: 1, price: 2, copies: 1 },
    { id: 'ice-stone', img: 'img/items/ice-stone.png', name: 'Piedra Hielo', icon: '❄️', kind: 'consumable', use: 'evolve', gem: 'any', boost: 1, price: 2, copies: 1 },
    {
      id: 'rage-candy', img: 'img/items/rage-candy-bar.png', name: 'Caramelo Ira', icon: '🍫', kind: 'consumable', use: 'evolve', candy: true, points: 1, price: 4, copies: 1,
      text: 'Como el Caramelo Raro: evoluciona un Pokémon aunque no tengas las pokébolas generadas que pide. Además ganas 1 punto extra.',
    },
    {
      id: 'potion', img: 'img/items/potion.png', name: 'Poción', icon: '🧪', kind: 'consumable', use: 'free', recover: 2, price: 1, copies: 1,
      text: 'Recuperas hasta 2 de las pokébolas que pagaste en tu última captura (si quedan disponibles; no la Master Ball). No gasta tu acción.',
    },
    {
      id: 'bag', img: 'img/items/forage-bag.png', name: 'Mochila', icon: '🎒', kind: 'relic', use: 'passive', slots: 1, price: 3, copies: 1,
      text: 'Permanente. Puedes guardar 1 objeto más (4 en vez de 3).',
    },
    {
      id: 'dowsing', img: 'img/items/dowsing-machine.png', name: 'Detector', icon: '📡', kind: 'consumable', use: 'action', price: 3, copies: 1,
      text: 'Capturas gratis la carta de arriba del mazo de Nivel 1, sin verla antes. Es tu acción del turno.',
    },
    {
      id: 'nugget', img: 'img/items/nugget.png', name: 'Pepita', icon: '💎', kind: 'consumable', use: 'free', sell: 3, price: 2, copies: 1,
      text: 'La vendes: recibes 3 pokébolas a tu elección de las disponibles (no Master Ball). No gasta tu acción.',
    },
    {
      id: 'ss-ticket', img: 'img/items/ss-ticket.png', name: 'Ticket Barco', icon: '🎫', kind: 'consumable', use: 'market', price: 1, copies: 1,
      text: 'Cambia un Pokémon de la mesa por la carta de arriba de su mazo; el que sale va al fondo del mazo. Se usa desde la carta. No gasta tu acción.',
    },
    {
      id: 'leftovers', img: 'img/items/leftovers.png', name: 'Restos', icon: '🍎', kind: 'relic', use: 'passive', price: 3, copies: 1,
      text: 'Permanente. Al empezar tu turno, si tienes menos de 5 pokébolas en mano, recibes 1 (de la que más quede).',
    },
  ];

  const LABELS = { ruby: 'Fuego', sapphire: 'Agua', emerald: 'Hoja', topaz: 'Trueno', onyx: 'Lunar' };
  DEFS.forEach(d => {
    if (!d.text && d.use === 'evolve' && d.gem === 'any') {
      d.text = `Al evolucionar, cuenta como ${d.boost} pokébola más generada por tus capturas, del tipo que pida la evolución. Su evolución tiene que estar en la mesa o en tus reservas.`;
    } else if (!d.text && d.use === 'evolve' && d.gem) {
      d.text = `Al evolucionar, cuenta como ${d.boost} ${SM.Config.GEM_INFO[d.gem].label} más generadas por tus capturas. Su evolución tiene que estar en la mesa o en tus reservas.`;
    }
  });

  const byId = new Map(DEFS.map(d => [d.id, d]));

  // Mazo de objetos: una carta por copia, cada una con su costo (tipos distintos al azar).
  function buildDeck() {
    const gems = SM.Config.GEMS;
    const deck = [];
    let n = 0;
    DEFS.forEach(d => {
      for (let i = 0; i < d.copies; i++) {
        const pool = gems.slice().sort(() => Math.random() - 0.5);
        const cost = {};
        for (let k = 0; k < d.price; k++) {
          const g = pool[k % pool.length];
          cost[g] = (cost[g] || 0) + 1;
        }
        deck.push({ uid: 'it' + (n++), id: d.id, cost });
      }
    });
    return deck;
  }

  return { list: DEFS, def: id => byId.get(id), buildDeck, stoneLabel: g => LABELS[g] };
})();

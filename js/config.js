// Configuración general del juego. Todo valor ajustable vive aquí.
window.SM = window.SM || {};

SM.Config = Object.freeze({
  // Versión del juego: se muestra en el pie de página. Súbela al publicar cambios
  // (1.0.1 arreglos, 1.1.0 algo nuevo, 2.0.0 cambios grandes).
  VERSION: '1.0.0',

  // Estadísticas con GoatCounter (gratis, sin cookies; ver js/stats.js). Pon aquí el código
  // de tu cuenta: si tu panel es https://pokesplendor.goatcounter.com, el código es 'pokesplendor'.
  // Vacío = no se cuenta nada. Abriendo el juego con doble clic tampoco se cuenta.
  GOATCOUNTER_CODE: 'noix',

  // Las cinco gemas normales y el comodín.
  GEMS: ['ruby', 'sapphire', 'emerald', 'topaz', 'onyx'],
  WILD: 'amethyst',
  GEM_INFO: {
    // img: sprite de pokebola (PokéSprite, licencia MIT, ver img/POKESPRITE-LICENSE.md).
    // label: nombre que se muestra en todos los textos del juego.
    ruby:     { label: 'Poké Ball',   color: '#d6453b', ink: '#ffffff', img: 'img/balls/poke.png' },
    sapphire: { label: 'Great Ball',  color: '#2f74d0', ink: '#ffffff', img: 'img/balls/great.png' },
    emerald:  { label: 'Nest Ball',   color: '#2c9a52', ink: '#ffffff', img: 'img/balls/nest.png' },
    topaz:    { label: 'Quick Ball',  color: '#f0c419', ink: '#3a2c00', img: 'img/balls/quick.png' },
    onyx:     { label: 'Heavy Ball',  color: '#4b4553', ink: '#ffffff', img: 'img/balls/heavy.png' },
    amethyst: { label: 'Master Ball', color: '#9a5bd3', ink: '#ffffff', img: 'img/balls/master.png' },
  },

  // Nombre en español de cada tipo, solo para mostrarlo. Por dentro (JSON, typeGems)
  // los tipos siguen en inglés; un tipo que no esté aquí se muestra tal cual.
  TYPE_LABELS: {
    normal: 'Normal', fire: 'Fuego', water: 'Agua', grass: 'Planta', electric: 'Eléctrico',
    ice: 'Hielo', fighting: 'Lucha', poison: 'Veneno', ground: 'Tierra', flying: 'Volador',
    psychic: 'Psíquico', bug: 'Bicho', rock: 'Roca', ghost: 'Fantasma', dragon: 'Dragón',
    dark: 'Siniestro', steel: 'Acero', fairy: 'Hada',
  },

  // Qué gema da cada tipo (se usa el primer tipo de la criatura).
  // El JSON puede cambiarlo con un bloque "typeGems" con esta misma forma.
  DEFAULT_TYPE_GEMS: {
    ruby:     ['Fire', 'Fighting', 'Dragon'],
    sapphire: ['Water', 'Ice'],
    emerald:  ['Grass', 'Bug', 'Poison'],
    topaz:    ['Electric', 'Normal', 'Fairy', 'Flying'],
    onyx:     ['Ground', 'Rock', 'Steel', 'Psychic', 'Ghost', 'Dark'],
  },

  // Mazos.
  TIERS: ['1', '2', '3', 'rare', 'legend'],
  RESERVABLE_TIERS: ['1', '2', '3'],
  TIER_LABELS: { '1': 'Nivel 1', '2': 'Nivel 2', '3': 'Nivel 3', rare: 'Raros', legend: 'Legendarios' },
  MARKET_SIZE: { '1': 4, '2': 4, '3': 4, rare: 1, legend: 1 },
  BONUS_AMOUNT: { '1': 1, '2': 1, '3': 1, rare: 2, legend: 2 },
  WILD_REQUIRED: { rare: 1, legend: 1 },

  // Costes por nivel: [puntos, cantidades por color], de más barato a más caro.
  // Cada criatura recibe uno según su peso dentro de su nivel.
  COST_PATTERNS: {
    '1': [[0, [2, 1]], [0, [1, 1, 1]], [0, [2, 2]], [0, [3]], [0, [1, 1, 1, 1]],
          [0, [2, 1, 1]], [0, [2, 2, 1]], [0, [3, 1, 1]], [0, [2, 1, 1, 1]], [1, [4]]],
    '2': [[1, [3, 2, 2]], [1, [3, 3, 2]], [2, [4, 2, 1]], [2, [5]], [2, [5, 3]], [3, [6]]],
    '3': [[3, [5, 3, 3, 3]], [4, [7]], [4, [6, 3, 3]], [5, [7, 3]]],
    rare: [[2, [3, 3]], [2, [4, 2]], [3, [3, 3, 2]], [3, [5, 2]]],
    legend: [[4, [4, 4]], [4, [5, 3, 2]], [5, [6, 3]], [5, [4, 4, 3]]],
  },

  // Bonificaciones del color de la evolución que hay que tener para evolucionar
  // [criaturas ligeras, criaturas pesadas], según el nivel de la carta base.
  EVOLUTION_REQUIREMENT: { '1': [2, 3], '2': [3, 4] },

  // Si el JSON no marca "legendary", las últimas criaturas sin evolución (por número) son legendarias.
  LEGEND_FALLBACK_COUNT: 5,

  // Temas de la interfaz. El id corresponde a [data-theme="<id>"] en css/style.css.
  // "auto" sigue el modo claro/oscuro del sistema.
  THEMES: [
    { id: 'auto',       label: 'Automático' },
    { id: 'light',      label: 'Claro' },
    { id: 'dark',       label: 'Oscuro' },
    { id: 'pokedex',    label: 'Pokédex' },
    { id: 'gengar',     label: 'Gengar' },
    { id: 'forest',     label: 'Bosque' },
    { id: 'ocean',      label: 'Océano' },
    { id: 'glass',      label: 'Cristal' },
    { id: 'glass-dark', label: 'Cristal oscuro' },
  ],

  // Fondo para quien todavía no eligió ninguno.
  DEFAULT_BACKGROUND: 'metal',

  // Cuánto se puede agrandar una imagen de fondo antes de que se note borrosa.
  // Si no alcanza para llenar la pantalla, el resto se rellena con la misma imagen desenfocada.
  // (Más alto = llena más pero se ve más borrosa. 1 = nunca se agranda.)
  BACKGROUND_MAX_UPSCALE: 1.8,

  // Fondos de imagen: se toman SOLOS de img/backgrounds/fondos.js, que genera
  // tools/actualizar-fondos.bat leyendo la carpeta. Aquí solo se ajustan algunos
  // (por ruta): nombre visible, color de relleno (fill) o encuadre (position).
  // Ejemplo: 'img/backgrounds/Sir\'fetch.jpg': { label: "Sirfetch'd", position: 'top' },
  BACKGROUND_OVERRIDES: {
    'img/backgrounds/Estanque.jpeg': { fill: '#2a2d5c' },
  },

  // Fondos de degradado (clase .bg-<id> de css/style.css). Van después de las imágenes.
  BACKGROUNDS: [
    { id: 'metal',    label: 'Plata' },
    { id: 'gold',     label: 'Oro' },
    { id: 'titanium', label: 'Titanio' },
    { id: 'forest',   label: 'Bosque' },
    { id: 'ocean',    label: 'Océano' },
    { id: 'sunset',   label: 'Atardecer' },
    { id: 'night',    label: 'Noche' },
    { id: 'plain',    label: 'Liso' },
  ],

  // Objetos (ver js/items.js).
  MAX_ITEMS: 3,        // objetos de un solo uso que puede guardar cada jugador
  ITEM_SHOP_SIZE: 3,   // objetos a la vista en la tienda

  // Reglas.
  TARGET_POINTS: 18,
  MAX_TOKENS: 10,
  MAX_RESERVED: 3,
  MIN_BANK_FOR_DOUBLE: 4,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,
  // Según el número de jugadores.
  TOKENS_PER_GEM: { 2: 4, 3: 5, 4: 7 },
  WILD_TOKENS: { 2: 5, 3: 5, 4: 7 },

  // Equipos (2 contra 2, solo con 4 jugadores): juegan alternados (1 y 3 contra 2 y 4),
  // suman los puntos de los dos y pueden pagar con las pokebolas del compañero
  // (no con sus objetos ni con las bonificaciones de sus capturas).
  TEAM_TARGET_POINTS: 30,
  TEAMS: [
    { label: 'Equipo A', color: '#e0533f' },
    { label: 'Equipo B', color: '#2f74d0' },
  ],

  // Pausa entre jugadas de la máquina, para poder seguirlas.
  AI_DELAY_MS: 1100,
});

// Estadísticas anónimas con GoatCounter: cuántas visitas tiene la página y cuántas partidas
// se empiezan, y de qué tipo. No guarda nombres ni nada que identifique a los jugadores.
// Solo funciona si SM.Config.GOATCOUNTER_CODE tiene un código y la página se abre desde
// internet (no con doble clic en index.html).
SM.Stats = (function () {
  const code = String(SM.Config.GOATCOUNTER_CODE || '').trim();
  const enabled = /^[a-z0-9-]+$/i.test(code) && location.protocol.startsWith('http');

  if (enabled) {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://gc.zgo.at/count.js';
    s.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
    document.head.append(s);
  }

  // Registra un evento (por ejemplo "partida/4-jugadores/equipos/red"). Si el script todavía
  // no cargó o lo bloquea el navegador, se ignora: el juego nunca depende de esto.
  function event(path, title) {
    if (!enabled) return;
    try {
      if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path, title, event: true });
    } catch (e) { /* sin estadísticas */ }
  }

  // Una partida nueva (también la revancha). En red la cuenta solo el anfitrión, así cada
  // partida cuenta una vez aunque jueguen 4 personas.
  function gameStarted({ players, teams, online, ai }) {
    const parts = [`${players}-jugadores`, teams ? 'equipos' : 'todos-contra-todos'];
    if (online) parts.push('red');
    else if (ai) parts.push('con-maquina');
    else parts.push('mismo-equipo');
    event('partida/' + parts.join('/'), 'Partida iniciada');
  }

  return { event, gameStarted };
})();

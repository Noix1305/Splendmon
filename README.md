# Mercado de Criaturas

Juego de cartas para 2 a 4 jugadores, solos o por equipos: se juntan gemas, se capturan criaturas que dan descuentos permanentes y se hacen evolucionar. Gana quien llegue a 18 puntos al cerrar la ronda.

## Cómo jugar

Abre `index.html` en el navegador (doble clic). No necesita instalar nada.

1. Carga un `.json` de criaturas, o pulsa **Usar las criaturas de ejemplo**.
2. Elige cuántos jugadores (2 a 4) y el modo: **Todos contra todos** o **Equipos: 2 contra 2** (solo con 4).
3. Para cada jugador, elige quién lo controla: la máquina, otra persona en el mismo equipo u otra persona por internet. Se pueden mezclar.
4. **Empezar partida** (o **Crear sala** si alguien juega por internet).

Las pokebolas cambian con el número de jugadores: 4, 5 o 7 de cada tipo y 5, 5 o 7 Master Ball (con 2, 3 o 4 jugadores). Se ajusta en `TOKENS_PER_GEM` y `WILD_TOKENS` de `js/config.js`.

### Equipos (2 contra 2)

- Juegan alternados: los jugadores 1 y 3 (Equipo A) contra los jugadores 2 y 4 (Equipo B).
- Cada equipo suma los puntos de sus dos jugadores. La última ronda empieza cuando un equipo llega a 30 (`TEAM_TARGET_POINTS`).
- Al capturar o comprar un objeto puedes pagar con las pokebolas de tu compañero: primero se usan las tuyas y lo que falte sale de las suyas. Sus objetos y las bonificaciones de sus capturas no te sirven.
- Ves las reservas y los objetos de tu compañero; los del otro equipo, boca abajo.

### Jugar en red

Hace falta conexión a internet en todos los equipos. No hay que instalar nada ni abrir puertos.

1. **Quien crea la partida:** carga las criaturas, pon **Otra persona, por internet** en los jugadores que se conectarán y pulsa **Crear sala**. Aparece un código de 6 letras.
2. **Quienes se unen:** abren el juego en su equipo, escriben su nombre y el código en **Únete a una partida en red** y pulsan **Unirse**. No necesitan cargar criaturas. Cada uno ocupa el siguiente asiento libre, en orden.
3. La partida empieza sola cuando están todos. Cada uno se ve abajo a la izquierda, y las reservas de los rivales se ven boca abajo.

El emparejamiento usa el servidor público gratuito de [PeerJS](https://peerjs.com); después, las jugadas van directamente de un navegador al otro. Algunas redes muy cerradas (de empresa o de universidad) bloquean este tipo de conexión. Si alguien se desconecta, la partida termina para todos.

Si sirves la carpeta con un servidor web, el juego carga solo el archivo `monsters.json` que esté junto a `index.html`.

## Formato del JSON

```json
{
  "monsters": [
    {
      "id": 1,
      "num": "001",
      "name": "Brotin",
      "img": "https://…/001.png",
      "type": ["Grass"],
      "height": "0.40 m",
      "weight": "5.0 kg",
      "weaknesses": ["Fire", "Ice"],
      "next_evolution": [{ "num": "002", "name": "Ramalón" }, { "num": "003", "name": "Bosquerón" }],
      "legendary": false
    }
  ]
}
```

Hay un ejemplo completo en `data/monsters.example.json`.

- `next_evolution` puede traer todas las etapas siguientes o solo la inmediata, y se admiten ramas (una criatura con varias evoluciones posibles).
- `legendary` es opcional. Si ninguna criatura lo trae, las 5 últimas sin evolución (por número) son legendarias.
- `img` es opcional. Sin imagen, la carta muestra las iniciales. Puede ser una dirección web o una ruta relativa a `index.html`, como `"img/001.png"`, que es la opción recomendada porque funciona también en red. Escribe las rutas con `/`: en JSON la barra `\` es un carácter especial y rompe el archivo.
- `typeGems` (opcional, junto a `monsters`) cambia qué tipos dan cada gema, con la misma forma que `DEFAULT_TYPE_GEMS` en `js/config.js`.

## Cómo salen las cartas

El JSON no trae costes ni puntos: se calculan siempre igual a partir de cada criatura.

| Dato de la carta | De dónde sale |
|---|---|
| Mazo | Primera etapa → Nivel 1; segunda → Nivel 2; tercera → Nivel 3; sin evolución → Raros; legendarias → Legendarios |
| Gema que da | El primer tipo (tabla en la pantalla inicial) |
| Coste y puntos | Un patrón del nivel, más caro cuanto más pesa la criatura dentro de su mazo |
| Requisito de evolución | 2 o 3 bonificaciones (Nivel 1) o 3 o 4 (Nivel 2) del color de la evolución |

Los valores se ajustan en `js/config.js`.

## Archivos

| Archivo | Qué hace |
|---|---|
| `js/config.js` | Gemas, reglas y tablas de coste |
| `js/cards.js` | Convierte el JSON en cartas |
| `js/game.js` | Estado y reglas de la partida |
| `js/ai.js` | Rival controlado por la máquina |
| `js/net.js` | Conexión en red entre dos navegadores (PeerJS) |
| `js/stats.js` | Estadísticas anónimas con GoatCounter (visitas y partidas iniciadas) |
| `js/ui.js` | Interfaz |
| `data/sample-monsters.js` | Criaturas de ejemplo (para abrir el juego sin servidor) |

## Estadísticas

Para saber cuántas personas entran y cuántas partidas se juegan, el juego puede usar [GoatCounter](https://www.goatcounter.com) (gratis, sin cookies). Pon el código de tu cuenta en `GOATCOUNTER_CODE` de `js/config.js`. Se registran las visitas y cada partida iniciada según su tipo (por ejemplo `partida/4-jugadores/equipos/red`), sin nombres ni datos personales. Con el código vacío, o abriendo el juego con doble clic, no se cuenta nada.

## Versión

El número de versión del pie de página está en `VERSION` de `js/config.js`.

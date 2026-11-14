# Mercado de Criaturas

Juego de cartas para dos jugadores: se juntan gemas, se capturan criaturas que dan descuentos permanentes y se hacen evolucionar. Gana quien llegue a 18 puntos al cerrar la ronda.

## Cómo jugar

Abre `index.html` en el navegador (doble clic). No necesita instalar nada.

1. Carga un `.json` de criaturas, o pulsa **Usar las criaturas de ejemplo**.
2. Elige si el jugador 2 lo controla la máquina u otra persona en el mismo equipo.
3. **Empezar partida.**

### Jugar en red con otra persona

Hace falta conexión a internet en los dos equipos. No hay que instalar nada ni abrir puertos.

1. **Quien crea la partida:** carga las criaturas, en «¿Quién controla al jugador 2?» elige **Otra persona, por internet** y pulsa **Crear sala**. Aparece un código de 6 letras.
2. **Quien se une:** abre el juego en su equipo, escribe su nombre y el código en **Únete a una partida en red** y pulsa **Unirse**. No necesita cargar criaturas.
3. La partida empieza sola. Cada uno ve sus fichas y reservas abajo, y las reservas del rival boca abajo.

El emparejamiento usa el servidor público gratuito de [PeerJS](https://peerjs.com); después, las jugadas van directamente de un navegador al otro. Algunas redes muy cerradas (de empresa o de universidad) bloquean este tipo de conexión. Si se corta la conexión, la partida termina.

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
| `js/ui.js` | Interfaz |
| `data/sample-monsters.js` | Criaturas de ejemplo (para abrir el juego sin servidor) |

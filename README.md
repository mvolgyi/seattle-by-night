# Seattle by Night — El Expediente Ward

Módulo de **Foundry VTT** para **Vampiro: La Mascarada 5ª edición** sobre el sistema
**wod5e**. Trae la ciudad de Seattle en noviembre de 2026, sus Vástagos y la aventura
*El Expediente Ward*, con la Segunda Inquisición (FIRSTLIGHT) jugable con reglas de
*Cazador: La Venganza*.

| | |
|---|---|
| Sistema | wod5e ≥ 5.3.0 |
| Foundry | v14 (verificado en 14.365) |
| Idioma | español |
| Mesa | coterie de 4–5 jugadores |
| Estado | 0.4.0 — fases 0–2, 4 y 8 hechas (la crónica importable, el Panel del Narrador y FIRSTLIGHT jugable); arte (retratos, tokens y mapas) en curso. Plan y fases en `SPEC.md` |

## Estructura del repositorio

```
module.json          manifest
src/module/          código del módulo (ES modules, ApplicationV2)
src/styles/sbn.css   CSS, todo prefijado con `sbn-`
templates/           plantillas Handlebars
lang/                es.json
content/             FUENTE ÚNICA: crónica, ciudad, documentos, PNJs, planos…
packs-src/           fuente versionable de los compendios (JSON generado)
packs/               compendios compilados (LevelDB) — GITIGNORED
assets/              mapas, retratos, tokens, tiles, handouts
tools/               build, verificación, arte local (ComfyUI), release
Seattle by Night - El Expediente Ward/   los documentos de origen (.docx)
```

```bash
npm install
npm run verificar     # _key, _id y assets de packs-src/
npm run e2e           # prueba contra un Foundry local (ver tools/e2e/prueba.mjs)
```

Cambiar `module.json` exige reiniciar el servidor de Foundry; cambiar JS/CSS/plantillas, F5.

### Desarrollo local

El repo se enlaza en los datos de Foundry y se prueba en el mundo `sbn-test`:

```bash
ln -s "$PWD" ~/.local/share/FoundryVTT/Data/modules/seattle-by-night
cd ~/FoundryVTT/app/resources/app && node main.js --port=30099 --noupnp --world=sbn-test
```

### La Guía del Narrador (`guia/`)

Una página local con toda la crónica, como la de DVV: el libro (la verdad y el esquema, cómo
usarlo, seguridad, la ficción de apertura, los PJs, los ganchos y el registro de IDs), la
aventura escena por escena con los interludios de FIRSTLIGHT, los desenlaces y el epílogo, el
Termómetro con sus umbrales y el Reloj noche por noche, las pistas, cada PJ y PNJ con su
retrato, los PNJs menores, la ciudad lugar por lugar con los mapas de las escenas, los
documentos y ayudas maquetados como en Foundry, FIRSTLIGHT con la Célula Puget y su arsenal,
la Pantalla del Narrador y cómo se usa el módulo en Foundry (con capturas de las pruebas e2e en
`assets/guia/capturas/`).

Se abre con doble clic en `guia/index.html`, sin internet y sin nada al lado: es un solo
archivo con el CSS (el de la guía y el del módulo), el JS, las fuentes y las imágenes reducidas
embebidas (un navegador Flatpak abre el archivo por el portal y no ve la carpeta). Guarda el
seguimiento de la partida en el navegador (escenas jugadas, Termómetro con su registro, noche
del Reloj, pistas, notas), con exportación a un archivo; los botones del Termómetro y de las
pistas que hay en el texto mueven esa mesa.

No va dentro del módulo: instalada en Foundry, cualquier jugador podría abrirla por URL. Se
publica como un archivo aparte de cada release (`guia-del-narrador.html`, lo arma
`tools/release.mjs` junto al zip) y `guia/index.html` no se commitea.

```bash
npm run contenido    # content/ → packs-src/ (la guía lee el HTML ya generado de los journals)
npm run guia         # packs-src/ + content/ → guia/index.html
node tools/construir-guia.mjs --enlazado   # sin embeber nada, para depurar el CSS y el JS
```

La guía no repite las reglas de los marcadores (`:::leer`, `@tirada`, `@termometro`,
`@pista`, `@reloj`, documentos por soporte): usa el HTML que ya generó
`tools/contenido/journals.mjs` y sólo cambia cada `@UUID[...]` por un enlace a su ancla en la
página. Al terminar avisa si queda algún enlace sin destino o algún marcador sin expandir. Las
imágenes reducidas quedan en `cache/guia/` (ignorado por git).

## Notas de versión

- **Avisos al Narrador sin spoilers.** Foundry manda todos los mensajes de chat a todos los
  clientes (el susurro sólo los oculta en la interfaz). Desde esta versión, los avisos del
  Termómetro, los umbrales, las pistas, el Reloj y el voto al azar guardan un texto neutro y
  sólo claves en un flag; el texto real lo arma el cliente de cada GM al mostrarlos. Los
  mensajes que ya estaban en un mundo conservan su contenido viejo (con el texto completo) y
  no se migran: si te preocupa, vaciá el chat.
- **Estado sin spoilers en los ajustes.** Foundry manda los ajustes del mundo, y cada cambio,
  a todos los jugadores. Los motivos del historial del Termómetro (y qué movimiento fue), las
  pruebas marcadas y los votos del Consejo ahora van sellados y sólo los abre el Narrador; el
  voto al azar tampoco dice quién votó. Las partidas empezadas se convierten solas la primera
  vez que entra el Narrador, sin perder el historial. Es ofuscación, no cifrado: quien lea el
  código del módulo a propósito puede abrirlo.
- **Límite de Foundry.** Foundry manda a cada jugador todos los journals, actores y escenas del
  mundo, aunque no tenga permiso para verlos; los permisos sólo los ocultan en la interfaz.
  Con la consola del navegador abierta, un jugador puede leer la crónica: pasa con cualquier
  aventura de Foundry, no sólo con ésta.

## Licencias

- **Código** (`src/`, `tools/`, `templates/`): MIT, ver `LICENSE`.
- **Contenido de World of Darkness.** Material no oficial de World of Darkness, publicado
  bajo el [Dark Pack](https://www.paradoxinteractive.com/games/world-of-darkness/community/dark-pack-agreement).
  Partes de estos materiales son copyright y marcas registradas de Paradox Interactive AB, y
  se usan con permiso. Todos los derechos reservados. Más información en
  [worldofdarkness.com](https://www.worldofdarkness.com).
  Es gratuito: no se vende. Se aceptan donaciones.
- **Arte.** Todo el arte (mapas, retratos, tokens) es original, generado en local con modelos
  de licencia abierta que permiten uso comercial (lista y licencias en `tools/MODELOS.md`).
  No contiene arte ni logos oficiales de Paradox o White Wolf. Cada imagen tiene su
  procedencia registrada en `assets/PROCEDENCIA.json`.

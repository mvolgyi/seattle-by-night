# Versión en inglés — *The Ward File*

Plan para que la crónica se pueda jugar en castellano o en inglés desde el mismo módulo.
Decidido con el autor el 2026-11-02.

## Decisiones

| Tema | Decisión |
|---|---|
| Título en inglés | **The Ward File — a Seattle chronicle (fan, unofficial)** |
| Cómo se traduce | Script `tools/traducir.mjs` con la API de Claude (Opus 5.5, en lote). Repetible: retraduce sólo lo que cambió en castellano |
| Nombres de lugares | Se traducen los que en la ficción son lugares de Seattle con nombre en inglés (Galería de Vidrio → The Glass Gallery). Los nombres propios reales (Colman Dock, Harbor Island, Capitol Hill) no cambian |
| Terminología | La oficial de V5 y H5 en inglés (Kindred, Elysium, Primogen, Touchstones, Creed, Drive, Edges…), fijada en el glosario |
| Fuente | El castellano sigue siendo la fuente única. El inglés es una traducción que se verifica contra ella |
| Versión | Sale como 2.0.0 |

## Cómo funciona en Foundry

- **Un solo módulo, dos idiomas.**
  - Al importar, el Narrador elige el idioma de la crónica. Por defecto, el que tenga puesto Foundry (`game.i18n.lang === "en"` → inglés).
  - Lo elegido queda en un setting de mundo, `sbn-idioma-cronica`, con valor `es` o `en`.
- **Mismos `_id` en los dos idiomas.**
  - Cambiar de idioma con la partida empezada es «Actualizar la crónica» en el otro idioma.
  - `conservarMundo` (src/module/importacion.mjs) conserva lo del mundo igual que en una actualización: PJs, ownership, handouts entregados, tokens, playlist.
- **Compendios.** Cada idioma tiene los suyos.
  - En castellano quedan los actuales, con su nombre de pack (no se rompen los mundos que ya los usan).
  - En inglés, los mismos con sufijo `-en` (`aventura-en`, `cronica-en`…), con label en inglés y su propia carpeta de compendios, «The Ward File».
  - La música y los assets son los mismos para los dos.
  - Los labels de compendio en Foundry son fijos (`CompendiumCollection#title` devuelve `metadata.label`), por eso van en dos packs separados y no en uno solo traducible.
- **Interfaz.**
  - `lang/en.json`, con las mismas claves que `lang/es.json`. Cada usuario ve los botones en el idioma de su Foundry, aparte del idioma de la crónica.
  - En `module.json`, `languages.en` pasa a apuntar a `lang/en.json`.
- **Datos del Panel.** `data/cronica.json` y `data/publico.json` se generan por idioma (`data/en/…`). El Panel lee los del idioma de la crónica.
- **Mensajes de chat.** Ya guardan sólo claves y los arma el cliente de cada GM (cambio de seguridad de 1.0.0), así que salen en el idioma de quien los lee.
- **Guía del Narrador.** Una por idioma: `guia-del-narrador.html` y `narrator-guide.html` (`construir-guia.mjs --idioma en`). Las capturas en inglés las saca el e2e con Foundry en inglés.

## Formato de `content/en/`

Espeja `content/` con las mismas rutas. Todo archivo traducido lleva la **huella** del castellano del que salió: sha256 de la unidad fuente, primeros 16 hex. Si el castellano cambia, `npm run verificar:traduccion` lo marca como desactualizado.

### Markdown (journals, personajes, documentos, ciudad, crónica)

- **Mismo archivo, misma ruta:** `content/en/cronica/aventura/11-prologo.md`.
- **Frontmatter:**
  - sólo `nombre` (traducido) y `fuente: <huella>`;
  - el resto (`id`, `carpeta`, `orden`, `jugadores`, `soporte`, `entrega`…) se hereda del castellano y no se repite;
  - `nota` (documentos) también va traducida.
- **Cuerpo:**
  - Traducción completa.
  - Las páginas `## ` se emparejan con las del castellano **por posición**: misma cantidad y mismo orden.
  - La clave de página (`clavePagina`, que sale del título) se toma **siempre del castellano**, así los `_id` de página son los mismos.
  - `{#ID}`, `{jugadores}` y `{narrador}` se conservan tal cual.
- **Marcadores:** no se tocan.
  - `@ID[PNJ-12]` sin texto queda igual.
  - En `@ID[PNJ-12|Krell]` se traduce el texto visible, si corresponde.
  - En `@tirada{ruta|dif|etiqueta}` se traduce sólo la etiqueta.
  - En `@termometro{+1|motivo}`, sólo el motivo.
  - `@pista{P-07}` y `@reloj{4}` quedan iguales.
  - En `:::leer`, `:::recuadro Título` y `:::secreto` se traduce el título del recuadro, no la palabra clave.

### JSON (pnjs, pjs, lugares, pistas, trackers, coteries, firstlight, planos, musica…)

- **Overlay:** `content/en/<misma ruta>.json` trae **sólo los campos de texto**, en la misma estructura, con las entidades identificadas por su `id`.
  - El build lo funde sobre el castellano por `id`. Los números, rutas, coordenadas y claves de wod5e nunca se duplican.
- **Campos traducibles:** los define una tabla única, `tools/traduccion/campos.mjs`, que usan el build, el script y la verificación.
  - Ejemplos: `nombre`, `apodo`, `cita`, `semblante`, `concepto`, `notas`, `texto`, `convicciones[]`, `piedrasDeToque[].nombre/descripcion`, `ventajas[]`, `defectos[]`, `equipo[]` y, en planos, `nombre`/`nota` de salas, muebles, puertas y figuras.
- **Huella:** una por entidad, en `"_fuente": { "<id>": "<huella>" }` dentro del overlay.

### Carpetas

`content/en/carpetas.json` mapea cada clave de carpeta del castellano (`"Seattle by Night/La ciudad"`) a su nombre visible en inglés. Las claves no cambian (de ellas salen los `_id` de las carpetas).

## Herramientas

| Archivo | Qué hace |
|---|---|
| `tools/traduccion/glosario.json` | Términos fijos castellano → inglés: reglas V5/H5, clanes, cargos, lugares, apodos, objetos de la trama. Fuente de verdad del vocabulario |
| `tools/traduccion/estilo.md` | Guía de estilo para el traductor: registro (noir, segunda persona al Narrador como en los libros de V5), qué no se traduce, formato de marcadores |
| `tools/traduccion/campos.mjs` | Campos traducibles de cada JSON |
| `tools/traducir.mjs` | Lee las unidades desactualizadas o faltantes y las manda a la API: Opus 5.5, glosario y estilo en el system cacheado, Batches API al 50 %. Valida que los marcadores, IDs y cantidad de páginas coincidan y escribe `content/en/` |
| `tools/contenido/verificar-traduccion.mjs` | Controla que no falte ninguna unidad, que ninguna esté desactualizada, que los marcadores e IDs sean idénticos y que no quede castellano suelto (heurística), y que se respete el glosario |

Las opciones de `traducir.mjs`:
- `--estimar` cuenta tokens y da el costo sin gastar.
- `--solo <glob>` limita las unidades.
- `--directo` va sin lote, para el piloto.
- `--forzar` retraduce aunque la huella coincida.

**La key:**
- Se lee de `.env`, de la variable `CLAUDE_CODE_API_KEY`, y se pasa explícita al cliente.
- Nunca se imprime ni se escribe en logs.
- `.env` sigue en `.gitignore`.

## Fases

1. **Glosario y estilo.** Borrador de `glosario.json` y `estilo.md`; el autor lo revisa.
2. **Piloto.** Con `traducir.mjs --directo`:
   - el prólogo (`content/cronica/aventura/11-prologo.md`);
   - la ciudad de Helen (`LUG` del apartamento);
   - la ficha de Helen (PNJ-04: prosa y JSON);
   - un documento con marcadores (DOC-05, SMS);
   - el plano `helen.json`.
   
   El autor lee el resultado y se ajustan glosario y estilo.
3. **Infraestructura del build**, en paralelo con 1–2:
   - lectura de `content/en/` y fusión;
   - packs `-en`, carpetas, `module.json`, `lang/en.json`, `data/en/`;
   - elección de idioma al importar y setting;
   - guía por idioma, `release.mjs` y `verificar-traduccion.mjs`.
   
   Con el castellano sin cambios, los packs en castellano quedan idénticos byte a byte.
4. **Traducción completa.** `--estimar` primero y el autor aprueba el costo; después el lote.
5. **Revisión.** `verificar:traduccion` sin errores, más una pasada de terminología del agente revisor sobre una muestra por tipo.
6. **Prueba.** e2e completo en castellano y en inglés (Foundry con `language: en`): importar en inglés, cambiar de idioma con la partida empezada, botones de tirada, Panel y chat.
7. **Publicación 2.0.0.** README bilingüe y notas de versión en los dos idiomas.

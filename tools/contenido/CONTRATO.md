# Contrato de la fase 2 (build → compendios → módulo)

Lo comparten los constructores de `tools/contenido/` y el código de `src/module/`. Si una
parte necesita cambiarlo, lo dice en su reporte; no lo cambia sola.

## Constructores

- Cada `tools/contenido/<parte>.mjs` exporta `async function construir(ctx)`.
- `ctx = { reg, actores, avisos, log }`: `reg` es el registro de `ids.mjs` (ID del libro →
  `{ uuid, nombre, tipo, pack }`), `avisos` un array donde se empujan advertencias.
- Ids: siempre con `ID.*` de `ids.mjs`. Nunca `idEstable` con una semilla propia para un
  documento que otro constructor enlaza.
- Escritura: `escribirDoc(pack, doc)` y `Carpetas` de `tools/util.mjs`; `_stats: STATS`.
- Todo documento generado lleva `flags["seattle-by-night"].origen` (lo usa
  `limpiarGenerados`) y, si viene de una entidad del libro, `flags["seattle-by-night"].id`
  con su ID (PNJ-12, LUG-05, A1-E01…).

| Parte | Escribe | Dueño |
|---|---|---|
| `journals.mjs` | packs `cronica`, `documentos` (incluye el journal generado «Pistas», id `PISTAS`, una página por pista con ancla = id) | agente journals |
| `actores.mjs` | packs `personajes`, `firstlight` | agente actores |
| `escenas.mjs`, `macros.mjs`, `aventura.mjs` | packs `escenas`, `macros`, `aventura` | agente escenas |

## HTML que el build genera y el módulo interpreta

| Marcador en content/ | HTML |
|---|---|
| `@tirada{paths\|dif\|texto}` | `<a class="sbn-tirada" data-sbn-tirada="attributes.wits skills.investigation" data-dificultad="3" data-label="texto"><i class="fa-solid fa-dice-d10"></i> texto</a>` (paths separados por espacio) |
| `@termometro{+1\|motivo}` (también `-2`, `=10`, `congelar`) | `<button type="button" class="sbn-termometro" data-sbn-termometro="+1" data-motivo="motivo">…</button>` |
| `@pista{P-07}` | `<button type="button" class="sbn-pista" data-sbn-pista="P-07">…nombre de la pista…</button>` |
| `@reloj{4}` | `<span class="sbn-reloj" data-sbn-reloj="4">Noche 4</span>` |
| `@ID[X]` / `@ID[X\|texto]` | `@UUID[<reg.get(X).uuid>]{texto o nombre}`; si no existe, texto plano + aviso |
| `:::leer` | `<section class="sbn-leer">…</section>` |
| `:::recuadro Título` | `<aside class="sbn-recuadro"><h4>Título</h4>…</aside>` |
| `:::recuadro Nota de edición` en una página que ve un jugador | el `<aside class="sbn-recuadro sbn-nota-edicion">` dentro de `<section class="secret" id="secret-<id estable>">` (semilla `nota:<journal>:<página>:<n>`) |
| `:::secreto` | `<section class="secret" id="secret-<id estable>">…</section>` (secreto nativo de Foundry: sólo lo ve quien es dueño) |
| documento (frontmatter `soporte`) | el cuerpo envuelto en `<div class="sbn-doc sbn-doc-<soporte>">…</div>` |

Visibilidad de páginas: `jugadores: si` o `{jugadores}` → `ownership.default = 2` (observador);
`no`/`{narrador}` → `ownership.default = 0`. Los documentos con `jugadores: si` se generan
igual con `0` en el journal y `2` en la página: se revelan al entregarlos.
`jugadores: paginas` → journal en `2` y páginas en `0` salvo las `{jugadores}` (COMO-USAR:
«Cómo usar este libro», «Convenciones» y «Aviso legal», ancla `AVISO-LEGAL`).

PJ (fichas con `pj: true`, las que puede poseer un jugador): sus `nota`, `provisional` y
`propuesto` NO van a `system.privatenotes` del actor (las ve su dueño) sino a la página
«Notas de edición» (`{narrador}`) que journals.mjs agrega a su perfil.

Ids de ítems embebidos: por nombre, no por posición (`ventaja:<slug del nombre>`,
`beneficio:<facultad>:<slug>`; repetidos, `:2`, `:3`… en el orden de content/).

Carpetas: `Carpetas.id(nombre, padre)` de util.mjs acepta rutas con `/` (claves `/X`, `X/Y`,
`X/Y/Z`). En la Aventura, la raíz «Seattle by Night» de cada pack se funde con la raíz
homónima de la Aventura (no se anida): Foundry no pasa de 4 niveles (`FOLDER_MAX_DEPTH`).

## API del módulo (src/module)

`game.modules.get("seattle-by-night").api`:

- `termometro(cambio, motivo)` — `cambio`: número (+1, −2), `"=10"` o `"congelar"`.
- `pista(id, obtenida = true)`
- `noche(n)` — fija la noche actual del Reloj de Halloway.
- `importarCronica({ silencioso })`
- `estado()` → `{ termometro: { valor, congelado, registro[] }, pistas: {…}, noche }`

Settings de mundo: `termometro`, `pistas`, `noche` (scope world, config false). Los botones
de journals y chat llaman a la API; sólo el Narrador modifica (a un jugador le avisa).

Importar / actualizar (importacion.mjs): lo ofrece sólo `game.users.activeGM`. Al reimportar,
el hook `preImportAdventure` ajusta `toUpdate`: conserva el `ownership` del mundo de todo
documento, el de cada página ya existente, `active`/`navigation` de las escenas y lo agregado
a mano (páginas, ítems, tokens, dibujos, notas sin flag `origen`); los actores con dueño
jugador (`hasPlayerOwner`) no se actualizan (sólo se crean si faltan). La portada se activa
sólo en la primera importación y si no hay escena activa.

Enlaces en journals y chat: para un jugador, los `a.content-link` a documentos que no puede
ver (`doc.visible === false`) o rotos se cambian por `<span class="sbn-sin-permiso">nombre</span>`
al renderizar (Botones.enlacesSinPermiso); al Narrador no se le toca nada.

## Flags de actores

`flags["seattle-by-night"] = { origen: "actor", id: "PNJ-12", journal: "<uuid del perfil>" }`.
La biografía del actor empieza con un enlace `@UUID[...]` a su perfil.

## Datos de tiempo de juego (fase 4)

- `tools/contenido/datos.mjs` escribe `data/cronica.json` (determinista, se commitea como
  packs-src): `termometro` (umbrales con textos, 40 movimientos, `evitar`, `condiciones`),
  `reloj` (8 noches con fecha, evento, escenas, horas, movimientos con id, variantes),
  `pistas`, `pruebas`, `tiradas` (A3-E04 y A4-E01 con valores, oponente, márgenes y
  votación), `uuids` (IDs del libro → UUID de mundo) y `actores`.
- Ids que el mundo guarda (registro del Termómetro, setting `pruebas`): derivados del
  contenido, no de la posición: `<tipo>-<escena o lugar o gancho>-<primeras 6 palabras del
  motivo>` (`sube-a0-e01-romper-a-golpes-la-camara-del`), `noche-<n>-<motivo>` para los de cada
  noche, `A4-E01-OTRO-<MOTIVO>` / `VALOR-<MOTIVO>` para las casillas sin pista ni prueba.
  Repetidos: `-2`, `-3`… en el orden de content/.
- Además escribe `data/publico.json`, lo único que carga un JUGADOR: `publico: true`,
  `termometro` (`inicio`, `min`, `max`, `umbrales[]` con `valor`, `icono`, `jugadores`),
  `reloj.noches[]` (`n`, `fecha`, `dia`) y `pistas[]` (`id`, `nombre`). Sin escenas, PNJs,
  movimientos, tiradas ni UUIDs.
- Los textos de la crónica (umbrales, noches, nombres de pistas) viven SÓLO en esos JSON;
  `lang/es.json` guarda sólo textos de interfaz. El módulo los pide con fetch en `setup`
  (necesita `game.user`): un GM, `data/cronica.json`; un jugador, `data/publico.json`. Ojo:
  los dos son archivos estáticos del módulo; esto evita que el cliente del jugador los tenga
  en memoria, no que alguien escriba la URL a mano.
- El zip de release tiene que incluir `data/` y `templates/`.

API agregada: `abrirPanel({ tab })`, `prueba(id, marcada)`, `Datos`, `Panel`;
`termometro(cambio, motivo, { movimiento })` (el tercer parámetro registra qué movimiento
de `data/cronica.json` se aplicó, para topes como el de las cámaras corporales, que se
cuenta por noche); `estado()` suma `pruebas` y `votos`. Settings de mundo nuevos:
`pruebas` (`{ id: true }`) y `votos`. Valores de `@termometro`: también `descongelar`.
Hook `sbnEstado(estado, detalle)`. El aviso emergente de umbral lo muestra cada GM en su
cliente desde ese hook (`Estado.notificarUmbrales(detalle)`); el susurro al chat lo manda el
que movió el Termómetro, a todos los GM.

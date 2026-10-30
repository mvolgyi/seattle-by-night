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
| `:::secreto` | `<section class="secret" id="secret-<id estable>">…</section>` (secreto nativo de Foundry: sólo lo ve quien es dueño) |
| documento (frontmatter `soporte`) | el cuerpo envuelto en `<div class="sbn-doc sbn-doc-<soporte>">…</div>` |

Visibilidad de páginas: `jugadores: si` o `{jugadores}` → `ownership.default = 2` (observador);
`no`/`{narrador}` → `ownership.default = 0`. Los documentos con `jugadores: si` se generan
igual con `0` en el journal y `2` en la página: se revelan al entregarlos.

## API del módulo (src/module)

`game.modules.get("seattle-by-night").api`:

- `termometro(cambio, motivo)` — `cambio`: número (+1, −2), `"=10"` o `"congelar"`.
- `pista(id, obtenida = true)`
- `noche(n)` — fija la noche actual del Reloj de Halloway.
- `importarCronica({ silencioso })`
- `estado()` → `{ termometro: { valor, congelado, registro[] }, pistas: {…}, noche }`

Settings de mundo: `termometro`, `pistas`, `noche` (scope world, config false). Los botones
de journals y chat llaman a la API; sólo el Narrador modifica (a un jugador le avisa).

## Flags de actores

`flags["seattle-by-night"] = { origen: "actor", id: "PNJ-12", journal: "<uuid del perfil>" }`.
La biografía del actor empieza con un enlace `@UUID[...]` a su perfil.

# Formato de `content/`

`content/` es la fuente única del módulo. El build (fase 2) la convierte en compendios. Este
archivo fija el formato para que varios agentes puedan escribir en paralelo sin chocar.

Punto de partida: `python3 tools/importar-docx.py` deja cada doc en `cache/docx/NN.md`
(Markdown crudo, fiel al docx). Nunca se edita a mano; se lee y se reescribe en `content/`.

**Regla de oro: no se pierde nada y no se inventa nada.** Todo el texto del doc termina en
algún archivo de `content/`. Si algo no encaja en el formato, va como prosa en la página que
corresponda. Las contradicciones e IDs huérfanos se reportan, no se corrigen.

## 1. Journals en Markdown

Un archivo = una entrada de diario. Cada `## ` es una página; lo anterior al primer `## ` es
la introducción.

```markdown
---
id: AVE-01-P1
nombre: "Parte 1 · Rastro de agua"
carpeta: "El Expediente Ward/Parte 1"
orden: 20
jugadores: no
origen: "10"
---

# Parte 1 · Rastro de agua

Texto de introducción.

## A1-E01 · Lo que se llevaron {#A1-E01}

## Ficción de apertura {jugadores}
```

- `id`: estable. Usá el ID del doc si existe (LUG-05, DOC-04, AVE-01…); si no, uno descriptivo
  con el prefijo del grupo (`AVE-01-P1`, `CIUDAD-HISTORIA`).
- `carpeta`: ruta de carpeta con `/`.
- `orden`: entero para ordenar dentro de la carpeta (de 10 en 10).
- `jugadores`: visibilidad por defecto (`si`/`no`). Una página puntual se marca con
  `{jugadores}` o `{narrador}` al final del título. Con `no`, el journal entero queda
  oculto y sus páginas `{jugadores}` sólo se ven si el Narrador lo comparte;
  `jugadores: paginas` deja el journal visible con SÓLO sus páginas `{jugadores}`
  (la introducción y el resto, para el Narrador).
- Un `:::recuadro Nota de edición` en una página que ven los jugadores sale como
  secreto (sólo lo ve el Narrador).
- `origen`: número del doc.
- `{#ID}` al final de un `## ` declara que esa página ES esa entidad (escena, lugar, pista…).
  Así los enlaces `@ID[...]` encuentran la página.

### Marcadores

| Marcador | Qué es |
|---|---|
| `:::leer` … `:::` | recuadro «Leer en voz alta» |
| `:::recuadro Título` … `:::` | recuadro lateral del libro (consejos, variantes, «Para una coterie») |
| `:::secreto` … `:::` | texto que sólo ve el Narrador dentro de una página de jugadores |
| `@ID[PNJ-12]` / `@ID[PNJ-12\|Krell]` | enlace a la entidad con ese ID (actor, página, escena, documento) |
| `@tirada{attributes.wits+skills.investigation\|3\|Astucia + Investigación (Dificultad 3)}` | botón de tirada; paths de wod5e; dificultad 0 si no la dice |
| `@termometro{+1\|motivo}` | botón que mueve el Termómetro de FIRSTLIGHT |
| `@pista{P-07}` | botón que marca la pista como obtenida |
| `@reloj{4}` | referencia a la noche 4 del Reloj de Halloway |

(En la tabla las barras van escapadas como `\|`; en los archivos se escriben `|` sin barra
invertida.)

Tiradas enfrentadas o con varias opciones: un `@tirada` por reserva. Si el doc da una reserva
que no es Atributo + Habilidad (por ejemplo «Manipulación + Dominación»), usá
`disciplines.dominate` como path y anotalo en el reporte.

Las tablas del doc quedan como tablas Markdown. Las celdas únicas que en el docx son
recuadros (`| **📢 Leer en voz alta**<br>… |`) se convierten en el marcador que corresponda,
con los `<br>` como párrafos.

## 2. Claves de wod5e

- Atributos: `strength dexterity stamina charisma manipulation composure intelligence wits resolve`.
- Habilidades: `athletics brawl craft drive firearms larceny melee stealth survival animalken
  etiquette insight intimidation leadership performance persuasion streetwise subterfuge
  academics awareness finance investigation medicine occult politics science technology`.
- Disciplinas: `animalism auspex celerity dominate fortitude obfuscate potence presence protean
  sorcery oblivion alchemy`; rituales `rituals`, ceremonias `ceremonies`. Poderes por su nombre
  en inglés de V5 (como los da el doc).
- Clanes: en minúsculas en inglés (`brujah gangrel malkavian nosferatu toreador tremere ventrue
  caitiff thinblood`).
- Facultades de cazador: `arsenal fleet ordnance library improvisedgear globalaccess
  dronejockey beastwhisperer sensetheunnatural repeltheunnatural thwarttheunnatural artifact
  turncoat experimentalmedicine cleansetheunnatural greatdestiny unnaturalchanges`.
- Tipos de actor: `vampire ghoul mortal hunter spc group`.

## 3. Personajes

Prosa y datos van separados: la prosa es una página de journal, los datos construyen el actor.

**Prosa:** `content/personajes/<ID>.md` (frontmatter `id`, `nombre`, `carpeta`, `orden`,
`jugadores`, `origen`). Las secciones del doc (Días mortales, Noches de Vástago, Planes,
Dominio y refugio, Siervos, Relaciones, Susurros, Máscara y semblante, Secreto…) como `## `.

**Datos de fichas completas:** `content/pnjs/<grupo>.json` → `{ "pnjs": [ … ] }`:

```json
{
  "id": "PNJ-12",
  "nombre": "August Krell",
  "apodo": "El otro hijo",
  "pj": false,
  "tipo": "vampire",
  "clan": "brujah",
  "generacion": 11,
  "potenciaSangre": 3,
  "humanidad": 5,
  "hambre": 2,
  "depredador": "nombre del tipo de depredador o null",
  "atributos": { "strength": 4, "dexterity": 3 },
  "habilidades": { "brawl": [5, "Guardia invertida"], "athletics": [3, null] },
  "disciplinas": { "potence": [3, ["Lethal Body", "Prowess", "Brutal Feed"]] },
  "salud": 7,
  "voluntad": 6,
  "convicciones": ["…"],
  "piedrasDeToque": [{ "nombre": "…", "descripcion": "…" }],
  "ventajas": ["Contactos 2 (puerto)"],
  "defectos": ["…"],
  "equipo": ["…"],
  "cita": "la frase en cursiva bajo el título",
  "semblante": "una línea, para el token",
  "provisional": ["dato marcado como provisional en el doc 16"]
}
```

Campos que no apliquen: se omiten. Un ghoul o mortal lleva lo que tenga (sin clan ni
disciplinas si no las tiene). Un cazador (`tipo: hunter`) suma `credo`, `impulso`,
`facultades: { "arsenal": [2, ["…"]] }`.

**PNJs menores** (reservas simplificadas): `content/pnjs/menores.json` → `{ "menores": [ … ] }`:

```json
{
  "id": "MEN-02",
  "nombre": "Equipo táctico de FIRSTLIGHT",
  "spcType": "mortal",
  "concepto": "…",
  "cantidad": 6,
  "estandar": { "physical": 6, "social": 2, "mental": 4 },
  "excepcionales": { "firearms": 7, "athletics": 5, "survival": [6, "alcantarillas"] },
  "salud": 7,
  "voluntad": 5,
  "potenciaSangre": null,
  "disciplinas": {},
  "notas": "Markdown: equipo, táctica, ganchos"
}
```

**Versiones de combate** (doc 14): `content/pnjs/combate.json` → `{ "PNJ-03": "markdown", … }`.

## 4. Otros datos

| Archivo | Forma |
|---|---|
| `content/pjs.json` | `{ "pjs": [ … ] }`, mismo esquema que una ficha completa con `pj: true`, más `concepto`, `foco` (de «Foco por personaje»), `secreto` (Markdown). Si el doc no da estadísticas, sólo lo que dé |
| `content/lugares.json` | `{ "lugares": [ { "id": "LUG-05", "nombre", "zona", "mapa": true, "niveles": ["…"], "escenas": ["A0-E01"], "pnjs": ["PNJ-04"] } ] }` |
| `content/pistas.json` | `{ "pistas": [ { "id": "P-07", "nombre", "escena": "A2-E01", "texto", "dados": "a qué tiradas suma y cuánto" } ] }` |
| `content/trackers.json` | `{ "termometro": { "inicio", "max", "umbrales": [{ "valor", "texto" }], "sube": [{ "motivo", "cantidad" }], "baja": [ … ] }, "reloj": { "noches": [{ "n", "fecha", "evento", "escena" }] } }` |
| `content/coteries.json` | `{ "coteries": [ { "id": "COT-01", "nombre", "lema", "tipo", "dominio", "miembros": ["PNJ-01"] } ] }` |
| `content/firstlight.json` | `{ "equipo": [ { "id", "nombre", "tipo": "weapon\|gear\|condition", "efecto", "dano", "bonos": [ … ] } ] }` |
| `content/arte-doc15.json` | `{ "retratos": [{ "id", "prompt" }], "mapas": [{ "id", "nivel", "prompt" }], "ayudas": [{ "id", "prompt" }], "plantillas": { "retrato", "mapa" } }`, textual del doc 15 |

## 5. Documentos del mundo y ayudas

`content/documentos/<ID>.md`, uno por DOC-xx y AYU-xx (AYU-09: una página por PJ).

```markdown
---
id: DOC-05
nombre: "SAFE: mensajes guardados"
soporte: sms
entrega: A0-E01
jugadores: si
nota: "La línea para el Narrador que el doc pone antes del documento."
origen: "04"
---
```

`soporte`: `transcripcion guion libro-registro mecanografiado sms foro correo carta
informe poema presentacion nota libreta marcador recorte tarjeta foto diagrama orden-del-dia
mapa`. El cuerpo es el texto del documento tal cual, con la estructura que tenga (mensajes,
fechas, firmas). El «Qué presagia» va como página `## Para el Narrador {narrador}` al final.

## 6. Reparto de archivos (fase 1)

Cada grupo escribe sólo lo suyo:

| Grupo | Docs | Escribe |
|---|---|---|
| A | 00, 01, 02, 03, 09 | `cronica/00-*` a `cronica/09-*` (cómo usar, la verdad, ficción, introducción, ganchos), `personajes/PJ-02…06.md`, `pjs.json`, `pistas.json`, `trackers.json` |
| B | 04, 15 | `documentos/*.md`, `arte-doc15.json` |
| C | 05, 08 | `ciudad/*.md` (uno por LUG + historia, política, rumores, leyes, coteries, loresheets), `lugares.json`, `coteries.json` |
| D1 | 06 | `personajes/PNJ-*.md` de la Camarilla, `pnjs/camarilla.json` |
| D2 | 07, 14 | `personajes/PNJ-*.md` y `PJ-01.md` de los de fuera y recuadros, `pnjs/fuera.json`, `pnjs/menores.json`, `pnjs/combate.json`, `firstlight.json`, `cronica/90-pantalla-del-narrador.md` |
| E | 10, 11 | `cronica/aventura/1*.md` (introducción, prólogo, parte 1, ajuste de las copias, parte 2) |
| F | 12, 13 | `cronica/aventura/2*.md` (parte 3, parte 4, desenlaces, epílogo) |

Si un grupo encuentra datos que pertenecen a otro (por ejemplo una pista nueva en la parte 3,
o un umbral del Termómetro en el doc 14), no los escribe: los lista en su reporte para
integrarlos.

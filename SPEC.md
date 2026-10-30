# Seattle by Night — Spec del módulo Foundry VTT

Módulo para **Vampiro: La Mascarada 5ª ed.** sobre el sistema **wod5e**, con la Segunda
Inquisición (FIRSTLIGHT) jugable con reglas de **Cazador: La Venganza**. Empaqueta el libro
*Seattle by Night* y su aventura central *El Expediente Ward* (AVE-01), lista para dirigir.
Se construye con el mismo pipeline que `del_velo_a_la_vigilia` (DVV), pero **todo el arte se
genera en local** con modelos de licencia comercial.

| | |
|---|---|
| id del módulo | `seattle-by-night` (prefijo de CSS, flags e ids: `sbn-`) |
| Sistema | `wod5e` ≥ 5.3 (local: 5.3.28) |
| Foundry | v14 (local: 14.365) |
| Idioma | español |
| Mesa | coterie de 4–5 (David PJ-01 + 3–4 PJs nuevos; Bear es PNJ). Variante de un jugador en una página aparte |
| Licencia de publicación | Dark Pack (no comercial). Se permiten donaciones/Patreon. Si no, uso personal |
| Fuente | `Seattle by Night - El Expediente Ward/*.docx` (docs 00–16) |

---

## 0. Decisiones tomadas (2026-10-30)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿Cómo se distribuye? | Dark Pack con donaciones; si no, uso personal. **No** Storytellers Vault: prohíbe arte IA |
| 2 | ¿Cuánto Cazador? | FIRSTLIGHT jugable: Termómetro, Célula Puget como actores cazador, su arsenal como ítems, interludios jugables con cazadores, y FIN-D abre una continuación H5 |
| 3 | ¿Cuántos jugadores? | Coterie de 4–5 (doc 02, versión 3). La variante de un jugador va como página aparte |
| 4 | ¿Dónde se genera el arte? | En local, ComfyUI (`~/ComfyUI`), RTX 5080 16 GB + 60 GB de RAM. Sólo modelos con licencia comercial (§4) |
| 5 | ¿De dónde sale el contenido? | De los `.docx`. El `seattle_by_night_manifest.json` que cita el doc 16 **no existe** (ni local ni en Drive); lo reemplaza `content/` |

**Por qué modelos comerciales si el módulo no se vende:** el Dark Pack cubre la IP de WoD,
no el arte. Mapas, tokens y retratos sin marcas de WoD son nuestros y quedan vendibles más
adelante (por ejemplo un pack de battlemaps "Seattle noir"), siempre que los modelos lo
permitan.

### Reglas del Dark Pack que condicionan el módulo

- Nada de venta del módulo; donaciones sí.
- Logo del Dark Pack y aviso legal en el README, en `module.json` y en la portada del journal.
- Ni arte ni logos oficiales de Paradox/White Wolf. Todo el arte es nuestro.
- Decir explícitamente que no es material oficial.

---

## 1. Qué hay en los docs y qué entra al módulo

| Doc | Contenido | Entra como |
|---|---|---|
| 00 | Pitch y decisiones | página del journal *Cómo usar este módulo* |
| 01 | Esquema, Termómetro, Reloj de Halloway, índice de IDs | journal del Narrador + datos de `content/trackers.json` |
| 02 | David y 5 conceptos de PJ, coterie COT-00 | actores plantilla + journal de PJs (páginas visibles al jugador) + AYU-09 |
| 03 | Ficción de apertura y capítulo 1 | journal (la ficción es visible al jugador) |
| 04 | DOC-01 a DOC-12 | handouts: un journal por documento, maquetados en HTML/CSS |
| 05 | La ciudad: historia, política, rumores, leyes, LUG-01 a LUG-16 | journals de *Lugares*, uno por LUG, enlazados a su escena |
| 06–07 | PNJs con ficha completa | actores + página de journal por PNJ |
| 08 | Coteries y Loresheets | journal (+ actores `group` para las coteries) |
| 09 | Ganchos GAN-01 a GAN-12 | journal |
| 10–13 | La aventura: prólogo, partes 1–4, desenlaces, epílogo | journal por parte, una página por escena (A0-E01…A4-E03), con botones de tirada |
| 14 | Estadísticas, PNJs menores, arsenal de FIRSTLIGHT, referencia rápida | actores `spc` y `hunter`, ítems, Pantalla del Narrador |
| 15 | AYU-01 a AYU-09 y prompts de imagen | handouts + `tools/arte.config.json` (los prompts se adaptan, ver §4.4) |
| 16 | Manifiesto para Foundry | la estructura de packs de §3 (el JSON no existe) |

### Inventario (para dimensionar)

- **PJs:** David (PJ-01) + Celeste Arden (Ventrue), Ezra «Estática» Lund (Nosferatu), Nadia
  Ferro (Toreador), Hal Brekke (Gangrel), Dra. Ruth Abernathy (Tremere, alternativa).
- **PNJs con ficha:** PNJ-01 a 05, 11 a 22 (Montgomery, Whitmore, Halloway, Helen, Bear,
  Rosa, Krell, Thornquist, Marchetti, Voight, Fry, O'Connor, Okafor, Gale, Jun, Hale, Grange).
- **PNJs menores:** MEN-01 a MEN-14 (Lonnie Barras, equipo táctico, Dutch Lindqvist, Dawson,
  Bas Okonjo y Tavi Mercer, Teo Vásquez, el superviviente del Larchmont, Pell, Marcos Delgado,
  Cole Ransom, Pike, Sal Medeiros, Corwin).
- **Trasfondo sin actor:** Vance, Duval, Panhard, Emily (REF-01), Danny Ruiz, Ray Dorsey…
- **Lugares:** LUG-01 a LUG-16. Con mapa: 01, 02, 03, 04, 05, 06, 07, 10, 11, 14, 15, 16 +
  MAP-00 regional.
- **Documentos:** DOC-01 a 12, AYU-01 a 09, pistas P-01 a P-15, desenlaces FIN-A a FIN-D.

---

## 2. Cómo se modela en wod5e

Lo que ya sabemos de DVV (leído del código de wod5e 5.3.28) más lo que hay que verificar:

- **Vampiros:** actor `vampire`. Disciplinas por poder, Potencia de Sangre, Humanidad,
  Hambre, Piedras de toque y Convicciones. Los docs dan las Disciplinas con nombre de poder en
  inglés justamente para buscarlos en el compendio del sistema. *Verificar el formato exacto de
  poderes en 5.3.28 antes de escribir el builder.*
- **Ghouls:** Bear (PNJ-05), Gale (PNJ-19), Pell, Dawson → actor `ghoul`.
- **Cazadores:** actor `hunter` (Credo, Impulso, Facultades, Desesperación en la Célula
  `group`). Lo usamos para la Célula Puget (§6).
- **PNJs menores:** actor `spc` con reservas simplificadas (Física/Social/Mental +
  excepcionales), que es el formato que ya traen los docs.
- **Coteries / Célula:** actor `group`.
- **Arsenal de FIRSTLIGHT:** ítems `weapon` y `gear`; los efectos con modificador de dados
  (linterna UV: −2 a todo) como `condition` con `bonuses`, igual que los Estados de DVV.
- **Termómetro y Reloj:** no existen en el sistema; los lleva el módulo (settings de mundo +
  panel ApplicationV2, como el panel de DVV).

---

## 3. Estructura del módulo

Se copia el esqueleto de DVV y se adapta. La fuente única es `content/`; los packs se
generan y compilan con `fvtt-cli`, y los compilados nunca se commitean.

```
module.json
src/module/           main.mjs, panel-narrador.mjs, termometro.mjs, reloj.mjs, pistas.mjs, cazadores.mjs
src/styles/sbn.css
templates/            panel, handouts (SMS, foro, informe forense, servilleta…)
lang/es.json
content/
  cronica/*.md        una por parte de la aventura, una página por escena
  ciudad/*.md         capítulo 3 y un archivo por LUG
  documentos/*.md     DOC-xx y AYU-xx
  pnjs.json pjs.json menores.json cazadores.json arsenal-firstlight.json
  pistas.json trackers.json escenas.json musica.json
  planos/*.json       planos vectoriales de los interiores (§5)
packs-src/            JSON generado
assets/mapas assets/retratos assets/tokens assets/tiles assets/handouts assets/portadas
tools/                comfy.mjs, generar-arte.mjs, pintar-planos.mjs, tokens.mjs, construir-*.mjs,
                      importar-docx.py, verificar.mjs, release.mjs, workflows/*.json
```

### Packs

| Pack | Tipo | Contenido |
|---|---|---|
| `aventura` | Adventure | importación en un click de todo lo de abajo, con carpetas |
| `cronica` | JournalEntry | la aventura, la ciudad, los PNJs, los ganchos, la Pantalla del Narrador |
| `documentos` | JournalEntry | DOC-01…12 y AYU-01…09, visibles al jugador al entregarlos |
| `personajes` | Actor | PJs plantilla, PNJs, menores, la Célula Puget, las coteries |
| `escenas` | Scene | MAP-00 + los mapas de §5 + escenas de ambiente |
| `firstlight` | Item | arsenal y condiciones de FIRSTLIGHT |
| `macros` | Macro | Panel del Narrador, Termómetro ±1, avanzar el Reloj, entregar handout |
| `playlists` | Playlist | ambientes por lugar (opcional, §8) |

### Mecánicas del módulo

- **Panel del Narrador** (ApplicationV2): Termómetro 0–10 con sus umbrales (3, 5, 7, 9, 10)
  y un registro de qué lo movió; Reloj de Halloway con las 8 noches fechadas (jueves 12 a
  jueves 19 de noviembre de 2026) y el evento de cada una; pistas P-01…P-15 marcables.
- **Dados por pistas:** en A3-E04 y en el Consejo (A4-E01), botón que arma la tirada con +1
  dado por cada pista P-07…P-12 marcada.
- **Botones de tirada** en los journals (mismo sistema que DVV).
- **Cámaras corporales:** botón «acción sobrenatural ante cámara» que sube el Termómetro, con
  el tope de +2 por escena.
- **Umbrales:** al cruzar uno, aviso al Narrador con lo que pasa en la ciudad y enlace a la
  escena correspondiente (en 9 ofrece activar A4-E02).

---

## 4. Pipeline de arte local

### 4.1 Qué hay instalado y qué se puede usar

| Modelo | Estado | Licencia | ¿Se usa? |
|---|---|---|---|
| Z-Image Turbo bf16 (+ `qwen_3_4b`, `z_image_ae`) | instalado | Apache 2.0 | **sí**: retratos, tokens, tiles, exteriores |
| FLUX.1-dev fp8 | instalado | FLUX.1 [dev] *Non-Commercial* | **no** |

### 4.2 Qué bajar

| Modelo | Para qué | Licencia | Tamaño aprox. |
|---|---|---|---|
| **Qwen-Image-Edit-2511** GGUF (Q4_K_M o Q5_K_M) + `qwen_2.5_vl_7b_fp8_scaled` + VAE de Qwen-Image | repintar el esquema de un plano conservando muros (reemplaza a Gemini en `pintar-planos`); pasar de retrato a token cenital del mismo personaje; referencia de estilo como segunda imagen | Apache 2.0 | 13–15 GB + 9 GB |
| **Z-Image-Turbo-Fun-ControlNet-Union 2.0** | camino B para planos: MLSD/canny/depth del esquema, más fiel en geometría | Apache 2.0 | ~3 GB |
| **FLUX.2 [klein] 4B** (usa el `qwen_3_4b` que ya está) | alternativa de edición multi-referencia, más liviana; A/B contra Qwen | Apache 2.0 (el 9B **no**) | ~8 GB |
| **SeedVR2** (3B; 7B si entra) | escalar los battlemaps a su resolución final | Apache 2.0 | 3–7 GB |
| **BiRefNet** | recorte de tokens y tiles con alfa limpio, sin depender del verde | MIT | ~1 GB |
| Nodo **ComfyUI-GGUF** | cargar los GGUF | Apache 2.0 | — |

Unos 45 GB en total; hay 423 GB libres.

**No usar:** FLUX.1-dev, FLUX.1 Kontext dev, FLUX.2 dev y klein 9B (no comerciales),
4x-UltraSharp (CC BY-NC-SA), RMBG-2.0 (CC BY-NC). Qwen-Image-2.1 se reportó con licencia de
investigación: no usarlo sin ver la licencia en su página. **Cualquier LoRA o nodo nuevo se
revisa antes de bajarlo** (los LoRA "Lightning" de aceleración también).

### 4.3 Cómo se integra

- `tools/comfy.mjs`: cliente de la API de ComfyUI en `localhost:8188` (`POST /prompt`, espera
  en `/history/{id}`, baja con `/view`). Reemplaza a las llamadas a Gemini de DVV.
- `tools/workflows/*.json`: workflows en formato API, uno por tarea (`t2i-zimage`,
  `editar-qwen`, `plano-controlnet`, `escalar-seedvr2`, `recortar-birefnet`), con marcadores
  que `comfy.mjs` reemplaza (prompt, semilla, imágenes de entrada, tamaño).
- `tools/arte.config.json`: el mismo contrato de estilo de DVV (prefijo + sufijo por estilo,
  el prompt de cada asset describe sólo su sujeto), más `flujo` y `semilla` por asset para que
  sea reproducible.
- **Procedencia:** `assets/PROCEDENCIA.json` anota por imagen modelo, licencia, workflow,
  semilla y prompt. Sirve para regenerar y para declarar el uso de IA donde se publique.
- **Memoria:** un modelo grande por vez. El escritorio ya usa 2,7 GB de VRAM; el codificador
  de Qwen va a RAM. Los lotes se agrupan por modelo para no recargar.

### 4.4 Estilo

El doc 15 define una plantilla de retratos (óleo oscuro, claroscuro, textura de grabado
victoriano; pizarra mojada, azul de puerto, naranja de sodio, negro y un solo acento carmesí).
**Se adopta para retratos.** Para battlemaps se toma su paleta, pero mandan las reglas de
`MAPS_SPEC` de DVV, que ya probamos en mesa:

- **Sin luces pintadas.** El doc 15 pide «night lighting baked in softly»; eso choca con las
  luces dinámicas de Foundry. Se pinta un tono ambiente parejo y las luces las pone el módulo.
- Sin puertas dibujadas, sin texto, sin cuadrícula, sin tokens.
- **Escala:** el doc 15 dice 70 px por casilla; se usa la de DVV (1 m = 100 px) para que
  los tokens no tapen habitaciones en interiores modernos.
- **Los documentos con texto no son imágenes.** Los modelos locales escriben mal; los DOC y
  AYU se maquetan en HTML/CSS y la imagen aporta sólo el soporte (papel, servilleta, pantalla
  del móvil de tapa, foto forense sin texto).

### 4.5 Prueba de calidad antes de producir

Los modelos locales están un escalón abajo de Gemini 3 Pro Image para repintar un esquema, así
que antes de generar en serie:

1. Plano de LUG-05 (el apartamento de Helen: chico, y es la primera escena).
2. Pintarlo por los dos caminos (Qwen-Edit y Z-Image + ControlNet) y con klein 4B.
3. Medir con el paso 3 de `pintar-planos` (deriva de muros tras corregir la escala).
4. Elegir camino y fijar ese mapa como **referencia de estilo** del set.

Lo mismo para tokens: retrato de Krell → token cenital por Qwen-Edit con el retrato de
referencia → BiRefNet → marco circular de `tokens.mjs`.

---

## 5. Mapas

Interiores desde plano vectorial (`content/planos/*.json` → esquema → repintado local →
corrección de escala → SeedVR2), igual que DVV. Exteriores y mapas de zona por texto a imagen.

| Mapa | Lugar | Nivel | Cómo | Escenas |
|---|---|---|---|---|
| MAP-00 | Seattle y el estrecho de Puget (AYU-01) | regional | datos de OpenStreetMap estilizados, como `malaga-mapa.py` (ODbL: lleva atribución) | sesión cero, A1-E03 |
| LUG-01 | El hangar de Harbor Island | combate | plano | A4-E02 |
| LUG-02 | La granja del Sheriff y su embarcadero | zona + combate | t2i (zona) + plano (casa y granero) | A1-E03, A4-E02 |
| LUG-03 | La Galería de Vidrio, el Elíseo | combate | plano | A2-E01 |
| LUG-04 | Las Galerías Selladas, subterráneo | combate | plano | A1-E04 |
| LUG-05 | El apartamento de Helen | combate | plano (**mapa de prueba**) | A0-E01, A1-E01 |
| LUG-06 | Torre Halloway: ático + bóveda | 2 niveles | plano | A4-E01 |
| LUG-07 | Gale Sentinel: campus + centro de datos | zona + combate | t2i + plano | A1-E05, A3-E02 |
| LUG-10 | Bar Salitre y el astillero | combate | plano + exterior | A2-E03 |
| LUG-11 | Edificio Larchmont: planta baja + sala de calderas | 2 niveles | plano | A2-E05 |
| LUG-14 | Northline Cyber Advisory, piso 11 | combate | plano | interludios de FIRSTLIGHT |
| LUG-15 | Terminal de ferris + el ferry | 2 niveles | plano | A4-E03 |
| LUG-16 | Elevador de grano de la Terminal 86 | combate | plano | A3-E03 |

Unas 17 imágenes de battlemap. Los lugares sin mapa (LUG-08 Pike Place, LUG-09 Club
Ceniza, LUG-12 la tumba de Emily, LUG-13 la Capilla del Observatorio) van como **escenas de
ambiente**: una ilustración a pantalla completa, sin cuadrícula.

Transiciones entre niveles con regiones `teleportToken` gemelas, derivadas del plano (como
en DVV).

---

## 6. FIRSTLIGHT jugable (el tinte de Cazador)

### 6.1 Lo que ya está en los docs

- Termómetro (AYU-03) y su referencia rápida, el arsenal de FIRSTLIGHT, Okafor (PNJ-18) con
  ficha completa, Hale (PNJ-21), el equipo táctico (MEN-02), Cole Ransom (MEN-11), ARQUERO
  (el topo de Halloway), Northline (LUG-14), la redada A4-E02 y FIN-D, que ya propone el
  cruce con H5.

### 6.2 Lo que hay que escribir (contenido nuevo)

- **La Célula Puget como cazadores H5:** Okafor, Hale, Ransom y tres operadores con nombre del
  equipo táctico, como actores `hunter` con Credo, Impulso, Facultades y la Célula como actor
  `group` con su Desesperación. Los otros operadores quedan como `spc`.
- **Interludios «Del otro lado»:** tres escenas cortas (30–45 min) donde los jugadores llevan
  a los cazadores. No cambian la trama de la coterie, pero muestran lo que el Termómetro mide:

  | Interludio | Cuándo | Qué se juega |
  |---|---|---|
  | I-1 · La furgoneta blanca | al cruzar el umbral 3 | vigilancia de Helen desde la furgoneta; los jugadores ven, desde afuera, la escena que sus vampiros acaban de jugar |
  | I-2 · SEA-0411 | noche 5 | Okafor y Hale reciben la entrega de ARQUERO en Northline y deciden si confiar en la fuente |
  | I-3 · Luz de día artificial | umbral 9, antes de A4-E02 | el briefing y la entrada de la redada, hasta el momento en que pasa a jugarse con la coterie |

  Lo que decidan los cazadores mueve el Termómetro o da una ventaja a FIRSTLIGHT en A4-E02.
- **Pregenerados:** las fichas de esos cazadores sirven de PJs de los interludios.
- **Continuación tras FIN-D:** un esbozo de crónica H5 («Marea roja»), con ganchos, no una
  aventura completa.
- **Del Velo a la Vigilia como recomendación opcional** (`relationships.recommends`): si está
  activo, los cazadores pueden tomar los Tres Caminos (Artefactos Iluminados encaja con
  Northline). Seattle by Night funciona sin él.

---

## 7. Retratos y tokens

| Grupo | Retratos | Tokens |
|---|---|---|
| PJs (David + 5 conceptos) | 6 | 6 |
| PNJs con ficha | ~17 | ~17 |
| PNJs menores con nombre | ~10 | ~10 |
| Genéricos (operador FIRSTLIGHT, ghoul de seguridad, cazarrecompensas, anarquista, ladrón) | — | ~6 |
| Vehículos (furgoneta de FIRSTLIGHT, pickup de Bear, lancha, dron, el ferry no: es mapa) | — | ~4 |

Flujo: retrato con Z-Image Turbo y la plantilla del doc 15 → token cenital con Qwen-Edit
usando el retrato como referencia (misma ropa, mismo pelo) → BiRefNet → `tokens.mjs`.

---

## 8. Música (opcional)

DVV generó la música con Lyria en la nube. Para mantener todo local, opciones a evaluar:
ACE-Step (verificar licencia) o pistas CC0. No bloquea nada: va al final.

---

## 9. Fases

| Fase | Entrega | Versión |
|---|---|---|
| 0 | Esqueleto copiado de DVV, `module.json`, `.gitignore`, aviso Dark Pack, módulo que carga vacío. ✓ hecho: e2e limpio en el mundo `sbn-test` | 0.0.1 |
| 1 | `tools/importar-docx.py`: docx → `content/` (Markdown y JSON con IDs del doc). Revisión a mano | 0.1.0 |
| 2 | Journals de la crónica, la ciudad, los documentos y la Pantalla del Narrador; Adventure importable | 0.2.0 |
| 3 | Actores: PJs plantilla, PNJs, menores, coteries; ítems del arsenal | 0.3.0 |
| 4 | Panel del Narrador: Termómetro, Reloj, pistas, dados por pistas | 0.4.0 |
| 5 | Pipeline local: modelos bajados, `comfy.mjs`, workflows, prueba de calidad de §4.5, referencia de estilo fijada | 0.5.0 |
| 6 | Retratos y tokens | 0.6.0 |
| 7 | Planos y mapas, escenas con muros, puertas, luces, transiciones y tokens colocados | 0.7.0 |
| 8 | FIRSTLIGHT jugable: cazadores, interludios, esbozo H5 | 0.8.0 |
| 9 | Guía del Narrador en HTML (como la de DVV), capturas e2e, release | 1.0.0 |

Las fases 1–4 no dependen del arte y se pueden hacer mientras se baja y prueba lo de la fase 5.

---

## 10. Pendientes y riesgos

- **Calidad de los mapas locales.** Es el mayor riesgo. Por eso la prueba de §4.5 va antes de
  producir. Si ningún camino llega, plan B: más peso en el esquema (materiales y muebles
  dibujados en el plano) y el modelo sólo texturiza.
- **Contradicciones entre docs.** Mandan los más nuevos: el clan de Whitmore es Toreador (doc
  02, no "pendiente" del 00); el incendio del Larchmont está decidido («David no llegó a
  tiempo»); la mesa es de 4–5.
- **Datos provisionales** (doc 16): Krell como chiquillo de Vance, la llegada de David en los
  80, LOR-01 a nivel 4, Anne Smith y la fecha de muerte de Emily. Quedan marcados en el journal
  del Narrador.
- **IDs que aparecen sólo en docs tardíos** (LUG-16, PNJ-21, PNJ-22, MEN-07…14, P-13…15): el
  importador los toma de donde estén y `verificar.mjs` comprueba que todo enlace apunte a un ID
  existente.
- **Dark Pack y módulos de VTT.** La lista de contenidos permitidos del Dark Pack no nombra
  los módulos de VTT (sí dados virtuales, generadores de personajes y bots). El sistema wod5e
  se publica bajo el Dark Pack, pero conviene confirmarlo con Paradox (Creators Discord) antes
  de publicar. Falta también bajar el logo del Dark Pack de su página de recursos gratuitos.
- **Formato de Disciplinas en wod5e 5.3.28:** verificar en el código antes del builder de actores.

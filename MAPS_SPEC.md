# MAPS_SPEC — Especificación de mapas de Seattle by Night

> **Escala:** los planos se escriben en **metros** y **1 m = 100 px = 1 casilla**, sin
> conversión (DVV dibujaba a 30 px/pie y la escena usaba 1 m = 100 px, con un 2 % de error;
> acá no hay error). Los radios de luz de `tools/iluminacion.mjs` también están en metros.

Contrato **obligatorio** para todo mapa y asset visual del módulo *Seattle by Night* y la
aventura *El Expediente Ward* (Vampiro 5e, Seattle, noviembre de 2026). El skill `battlemaps`
lee este archivo al empezar cualquier tarea de mapas y aplica su checklist antes de entregar.
Lo que dice acá gana sobre cualquier default del skill y sobre la plantilla de mapas del doc 15.

Adaptado del `MAPS_SPEC.md` de Del Velo a la Vigilia (DVV), que ya se probó en mesa: mismas
reglas, otra ciudad. Verificado contra Foundry v14.365, sistema wod5e 5.3.28.

---

## 1. Qué mapas tiene el módulo

Tres niveles (skill `battlemaps`): un mapa regional (MAP-00), mapas de zona para los lugares
abiertos y battlemaps de interior construidos desde un plano. La lista sale de SPEC.md §5.

| Mapa | Plano (`content/planos/`) | Lugar | Nivel | Cómo | Escenas | Oscuridad | Luces |
|---|---|---|---|---|---|---|---|
| MAP-00 | — | Seattle y el estrecho de Puget (AYU-01) | regional | OpenStreetMap estilizado (§8) | sesión cero, A1-E03 | Pendiente | ninguna |
| LUG-01 | Pendiente | El hangar de Harbor Island | combate | plano | A4-E02 | Pendiente | Pendiente |
| LUG-02 | Pendiente | La granja del Sheriff y su embarcadero | zona + combate | t2i (zona) + plano (casa y granero) | A1-E03, A4-E02 | Pendiente | Pendiente |
| LUG-03 | Pendiente | La Galería de Vidrio, el Elíseo | combate | plano | A2-E01 | Pendiente | Pendiente |
| LUG-04 | Pendiente | Las Galerías Selladas, subterráneo | combate | plano | A1-E04 | Pendiente | Pendiente |
| **LUG-05** | **`helen`** | **El apartamento de Helen Ward** | combate | plano (**mapa de prueba**, SPEC §4.5) | A0-E01, A1-E01, A3-E01 | 0.75 | 2 plafones de pasillo, 4 LED de timbre + el verde del 3B, lámpara del salón, pantalla del portátil, aplique de sodio del callejón, farola de Market Street |
| LUG-06 | Pendiente | Torre Halloway: ático + bóveda | 2 niveles | plano | A4-E01 | Pendiente | Pendiente |
| LUG-07 | Pendiente | Gale Sentinel: campus + centro de datos | zona + combate | t2i + plano | A1-E05, A3-E02 | Pendiente | Pendiente |
| LUG-10 | Pendiente | Bar Salitre y el astillero | combate | plano + exterior | A2-E03 | Pendiente | Pendiente |
| LUG-11 | Pendiente | Edificio Larchmont: planta baja + sala de calderas | 2 niveles | plano | A2-E05 | Pendiente | Pendiente |
| LUG-14 | Pendiente | Northline Cyber Advisory, piso 11 | combate | plano | interludios de FIRSTLIGHT | Pendiente | Pendiente |
| LUG-15 | Pendiente | Terminal de ferris + el ferry | 2 niveles | plano | A4-E03 | Pendiente | Pendiente |
| LUG-16 | Pendiente | Elevador de grano de la Terminal 86 | combate | plano | A3-E03 | Pendiente | Pendiente |

Sin mapa (escenas de ambiente: una ilustración a pantalla completa, sin cuadrícula): LUG-08 Pike
Place, LUG-09 Club Ceniza, LUG-12 la tumba de Emily, LUG-13 la Capilla del Observatorio.

### Coherencia entre mapas (obligatoria)

Las transiciones son regiones `teleportToken` gemelas, derivadas del plano. Si se mueve un
acceso en un plano, se mueve su gemelo: la orientación de un acceso en un mapa manda sobre el
mapa de destino. Lo que se deduce de los docs 05, 10–13 y 15:

```
helen (escalera de incendios, descanso del 3.º)  ⇄ helen (pie de la escalerilla, callejón)   HECHO, mismo mapa
helen (escalera común, portal)                   →  Market Street                              Pendiente: no hay mapa de calle
helen (rellano de la azotea, puerta cerrada)     →  azotea                                     Pendiente: no hay mapa del techo
helen (callejón de servicio, sale al sur)        →  Market Street                              Pendiente: no hay mapa de calle
LUG-06 ático (ascensor privado)                  ⇄ LUG-06 bóveda, nivel −3 (ascensor)          dos escenas o dos niveles
LUG-11 planta baja (hueco de escalera derrumbado) ⇄ LUG-11 sala de calderas (sótano)           dos escenas o dos niveles
LUG-15 terminal (rampa de vehículos/pasajeros)   ⇄ LUG-15 ferry (cubierta de coches)           dos escenas
LUG-07 campus (zona, t2i)                        ⇄ LUG-07 centro de datos (esclusa de entrada) zona → interior
LUG-02 zona (porche de la casa, granero)         ⇄ LUG-02 casa y granero (plano)              zona → interior
LUG-02 sótano de la casa (túnel de 300 m)        ⇄ LUG-02 embarcadero del río (en la zona)    Pendiente: ¿el sótano es plano propio?
LUG-01 trampilla al túnel de carga               →  salida a 200 m, junto a la Terminal 46     Pendiente: sin mapa del otro extremo
LUG-03 sala / vestíbulo                          ⇄ LUG-03 archivo de la Guardiana (sótano)     Pendiente: SPEC §5 lo da como un solo mapa
LUG-10 bar (trastienda)                          ⇄ LUG-10 astillero (exterior)                 Pendiente: ¿mismo mapa o dos?
LUG-04 puerta de hierro                          →  Pioneer Square                             Pendiente: sin mapa de calle
LUG-16 escalera de servicio en zigzag (exterior) →  fuera del mapa                             Pendiente
```

Un acceso cuyo mapa no existe va como región **sin destino** (`destino: null`) con el campo
`pendiente` diciendo qué falta: sale como marcador sin comportamiento y `construir-planos` lo
avisa. Cuando el mapa exista, se le pone destino y gemela.

---

## 2. Qué va en la imagen y qué NO

El Narrador recibe en Foundry, derivado del plano: muros, puertas, ventanas, vidrios, barandas,
regiones de transición y luces. El mapa se entrega **limpio**.

### Sí incluir (estructural e inamovible)

- Arquitectura, materiales de piso, exterior inmediato: asfalto mojado con charcos, vereda de
  hormigón, techos y medianeras de los vecinos. Llueve: las superficies se ven mojadas.
- **Mobiliario fijo**: escritorios, camas, mesadas, heladera, sanitarios, bañera, radiadores,
  estanterías, mueble de la tele, contenedores de basura, escaleras (madera o acero).
- Paños de **vidrio** y **ventanas** (perfil fino con montantes y alféizar): son muros, no
  puertas. Una ventana de guillotina se pinta igual abierta o cerrada, así que se pinta.
- **Barandas** (escaleras, escalera de incendios): pasamanos fino con parantes.
- Objetos que la trama cita pero no se mueven: los mapas con alfileres de Helen en las paredes
  (sin una sola letra), el cable pelado colgando del escritorio, la tele apagada, las cámaras
  de timbre como cajitas negras **sin LED pintado**.
- Suciedad permanente: mugre de zócalo, pisadas, manchas, óxido.
- **Tono ambiente uniforme** por paleta (el frío azul de noviembre): un lavado parejo.

> **Tolerancia (dressing).** Papeles y tazas *sobre* un mueble fijo se toleran como decoración.
> Lo que la trama usa (el portátil, el teléfono de tapa, el disco, la silla volcada de A3-E01)
> siempre va como tile, o no va: el repetidor adhesivo del marco del 3A no se pinta nunca
> porque es la recompensa de una tirada.

### NO incluir (nunca)

- **Puertas dibujadas**, abiertas o cerradas. El vano queda vacío con un umbral tenue; la hoja
  la pone Foundry (muro con `door`). Vale también para persianas metálicas, trampillas,
  puertas de vidrio y la puerta de la azotea.
- **Fuentes de luz pintadas**: ni pantallas encendidas, ni lámparas prendidas, ni el LED azul
  de los timbres, ni el charco naranja bajo la farola, ni halos. La plantilla del doc 15 pide
  «night lighting baked in softly»: **no se aplica** (SPEC §4.4). El naranja de sodio lo pone
  la luz de Foundry, no el mapa.
- **Lluvia dibujada** (cortinas, gotas en el aire). Charcos y brillo de mojado sí; la lluvia
  que cae es un efecto de clima de Foundry.
- **Texto de cualquier tipo**: carteles, rótulos de la ferretería, números de departamento
  (3A, 3B…), letras en los mapas de Helen, en la cinta «NO TOCAR» o en pantallas.
- **Tokens, personas, cadáveres, animales.**
- **Muebles móviles** (regla 9 del skill): sillas, sofás, mesas, lámparas, carros, el portátil,
  el cenicero. El renderer no los dibuja y la nota de la escena los lista para colocarlos como
  tiles.
- **Grid pintado.** Las juntas que caen sobre la casilla son válidas; líneas de grid, no.
- **Nada de fantasía** ni de marcas de WoD: ni runas ni brillos ni logos (Dark Pack).

---

## 3. Assets sueltos (tiles)

Mismos requisitos que el skill: alfa real, cenital estricto, mismo estilo, recortado, sin
sombra en el suelo, sin luz pintada, a **100 px por metro**. Eje largo horizontal y, en
asientos, respaldo arriba (el frente mira al sur); el plano dice `hacia` y el build los rota
(`s` 0°, `o` 90°, `n` 180°, `e` 270°) y los deja desbloqueados.

Pipeline: Z-Image Turbo (estilo `tile` de `tools/arte.config.json`) → recorte con **BiRefNet**
(SPEC §4.2) → `assets/tiles/tile-<nombre>[-<variante>].webp`. Pendiente: lo arma `arte-local`.

Prioridad (los móviles que los planos ya declaran):

| Plano | Tiles |
|---|---|
| `helen` | `tile-portatil`, `tile-silla-escritorio`, `tile-mesa-cocina`, `tile-silla-madera`, `tile-sofa-gastado`, `tile-lampara-pie`, `tile-cenicero` |
| Trama (varios) | teléfono de tapa, disco duro con cinta de pintor (sin letras), silla volcada, teléfono con pantalla rota, papel doblado con casquillo (A3-E01), bolsa gris de reparto |
| Horror | charco y salpicaduras de sangre, ceniza (A1-E02), vidrio roto |
| Puertas | Pendiente: sólo si alguna escena necesita una hoja vista (Foundry la dibuja) |

---

## 4. Grid y escala

- **Casilla:** 1 metro. Foundry: `grid.size 100`, `distance 1`, `units "m"`.
- **Resolución:** **100 px por metro**, fija (`PX_POR_M` en `tools/planos.mjs`).
- **Alineación:** muros, pasillos y vanos sobre múltiplos de 0,5 m cuando se pueda; puertas
  interiores de 0,8–0,9 m y paredes interiores sobre décimos de metro se toleran (un edificio
  de 1910 no está en grilla).
- **Tamaño:** cada lado entre **12 y 24 m** (1200 a 2400 px). Un lugar más grande se parte en
  varios planos unidos por regiones. Tope duro: 8192 px de lado. `helen` mide 21 × 20 m.
- **Escena:** padding 0.25, grid cuadrado de 100 px con `alpha 0` (el piso ya lee la
  retícula; el Narrador lo sube si quiere), visión de token y niebla de exploración
  activadas, oscuridad según la tabla de §1.
- **La escena mide exactamente `ancho × alto × 100` px.**
- **Una planta por mapa.** Lo que se ve «abajo» desde una planta alta (el callejón bajo la
  escalera de incendios, la vereda) es exterior a nivel de calle: se pinta, y se llega por
  regiones, no caminando. Las barandas lo separan.

---

## 5. Estilo visual

**Fuente única de verdad:** el bloque `estilos.battlemap` de `tools/arte.config.json` para lo
pintado (Pendiente: lo escribe `arte-local`) y las `PALETAS` de
[`tools/planos.mjs`](tools/planos.mjs) para el esquema. No se describe el estilo por mapa; el
plano sólo describe su sujeto (`exterior`, `desc` de muebles).

Canon (doc 15, adaptado por SPEC §4.4):

- **Medio:** fotorrealismo ilustrado — tinta oscura y firme en el canto de cada muro y objeto,
  materiales reales pintados por debajo, sombras proyectadas abajo-derecha. Estética de pack de
  battlemaps modernos publicado, no de óleo: la plantilla de óleo y grabado del doc 15 es para
  retratos.
- **Paleta:** Seattle lluviosa, noviembre de 2026. **Pizarra mojada** (muros, asfalto,
  techos), **azul de puerto** (el tinte frío de todo), **negro** (tinta, sombras),
  **naranja de sodio** (sólo como luz de Foundry, nunca pintado) y **un solo acento
  carmesí** por mapa (en LUG-05, los alfileres rojos de Helen). Desaturada; nunca cálida ni
  dorada, nada de musgo verde.
- **Paletas del renderer:** `apartamento` (tablas de abeto gastadas, revoque gris pizarra,
  tinte azul de puerto al 16 %, tono ambiente azul noche al 6 %). Pendiente: `oficina`
  (LUG-07, LUG-14, LUG-06), `industrial` (LUG-01, LUG-10, LUG-16), `subterraneo` (LUG-04,
  sótano de LUG-11), `galeria` (LUG-03); se definen con su primer plano.
- **Métricas** (`magick … -colorspace HSL`): saturación media **≤ 15 %**. Los rangos de
  luminancia y contraste se fijan con la referencia de estilo (SPEC §4.5): Pendiente.

  | Mapa | sat | lum | nota |
  |---|---|---|---|
  | `helen.esquema` | 8.8 | 26.3 | esquema vectorial; la luminancia baja la ponen los departamentos cerrados rayados |

- **Cenital estricto y a sangre**: ningún canto lateral de muro, sin borde, marco, viñeta ni
  margen.

**Referencia de set.** El primer mapa pintado que pase la prueba de SPEC §4.5 (`helen`) queda
como `referencia` en `arte.config.json`; los demás reciben un recorte suyo como segunda imagen,
sólo como referencia de render.

---

## 6. Pipeline y formatos

```
content/planos/<archivo>.json          fuente (metros): habitaciones, vanos, muebles, luces, regiones
   │  node tools/construir-planos.mjs    [--solo <id>] [--depurar <carpeta>]
   ▼
assets/mapas/<id>.esquema.webp          esquema vectorial, escala exacta (q92)
   │  repintado local en ComfyUI         Pendiente: pintar-planos se reescribe (SPEC §4.3)
   │  (Qwen-Image-Edit / Z-Image + ControlNet / FLUX.2 klein 4B, a elegir en §4.5)
   ▼
   │  corrección afín + SeedVR2
   ▼
assets/mapas/<id>.webp                  mapa pintado y corregido (q88)
   │  build de escenas                   Pendiente: construir-contenido de SBN
   ▼
packs-src/escenas/*.json                escena + muros + puertas + ventanas + vidrios + barandas + regiones + luces
```

- El **plano JSON es la fuente**; los `.webp` son artefactos.
- `construir-planos` nunca escribe `<id>.webp`, para no pisar un mapa pintado. Valida presets de
  luz y destinos de regiones. Con `--depurar` escribe, fuera de `assets/`, el esquema con los
  muros de Foundry por tipo (rojo muro, verde puerta, cian ventana/vidrio, amarillo baranda),
  regiones, radios de luz, móviles y una grilla de 1 m.
- Si falta el pintado, la escena usa el **esquema como fondo provisional** y el build lo avisa.
- **Corrección afín** (como DVV): registrar el repintado contra el esquema por perfiles de
  bordes, rechazar más de **3 %** de anisotropía o una superposición pobre (`calidad < 0.35`) y
  reescalar para que cada muro caiga sobre el plano.
- **Prompt por posición:** las habitaciones se describen al modelo por su posición en la imagen,
  nunca por nombre (con nombres, el modelo rotula las salas).
- **Retoque determinista permitido:** cerrar con `magick … -composite` un hueco que el modelo
  abrió donde el plano tiene muro, clonando un tramo del mismo muro pintado. Se anota en el
  reporte de entrega.
- **Procedencia:** cada mapa pintado se registra en `assets/PROCEDENCIA.json` (modelo,
  licencia, workflow, semilla, prompt). Sólo modelos permitidos por CLAUDE.md.
- **Nombres:** el id del plano ES el nombre del archivo y el id de la escena (`helen.webp`,
  `helen.esquema.webp`); el plano lleva el ID del doc en `lugar` (`LUG-05`).

### Formato del plano (resumen)

| Campo | Qué es |
|---|---|
| `id`, `lugar`, `escenas`, `nombre`, `orden` | id estable (archivo y escena), ID del doc (LUG-xx), escenas que pasan ahí, nombre de la escena, orden de navegación |
| `ancho`, `alto` | lienzo en metros |
| `paleta`, `fondo` | `apartamento` (otras: Pendiente); `fondo` pisa el exterior de la paleta (`asfalto`, `acera`, `edificio`, `roca`) |
| `exteriores[]` | `{ nombre, x, y, w, h, fondo }`: zonas de exterior sobre el fondo (callejón, vereda) |
| `oscuridad`, `luzGlobal` | darkness de la escena; luz global para escenas de día |
| `exterior` | texto para el modelo (inglés): qué rodea al edificio |
| `nota` | nota del Narrador (markdown; va a los flags de la escena, con la lista de móviles) |
| `habitaciones[]` | `{ nombre, x, y, w, h, piso, vetas?, limpio?, sinMuros? }` — piso: `tablas`, `tablas-alfombra`, `parquet`, `linoleo`, `baldosa`, `azulejo`, `terrazo`, `moqueta`, `tecnico`, `hormigon`, `piedra`, `tierra`, `grava`, `rejilla` (escalera de incendios), `macizo` (departamento cerrado, rayado); `vetas`: `h`·`v` (dirección de las tablas); `sinMuros`: sólo piso (p. ej. el linóleo de la cocina dentro del salón) |
| `vanos[]` | `{ x, y, w, eje, tipo, estado?, sonido?, sonoro?, nombre }` — `abierto`, `puerta`, `secreta`, `puerta-vidrio`, `ventana`, `vidrio`, `baranda`, `arcada`; `estado`: `cerrada`·`abierta`·`trabada`; `sonido`: clave de `CONFIG.Wall.doorSounds` (`woodBasic`, `woodCreaky`, `woodHeavy`, `metal`, `slidingWood`…) |
| `muebles[]` | `{ tipo, x, y, w, h, desc?, fijo?, luz?, cabecera?, frente?, contra?, tile?, hacia?, material? }` |
| `luces[]` | `{ x, y, preset, nombre? }` — presets en `tools/iluminacion.mjs`, radios en metros |
| `regiones[]` | `{ id, nombre, x, y, w, h, destino: "<plano>:<región>" \| null, llegada?, pendiente? }` — `llegada: true` sólo recibe; `destino: null` + `pendiente` = acceso a un mapa que todavía no existe |

En Foundry: `puerta` = `door 1`; `secreta` = `door 2` (se ve pared); `puerta-vidrio` y
`ventana` = `door 1` con `sight 0`, `light 0`, `sound 10` (cerrada se ve a través; abierta se
cruza); `vidrio` = `move 20`, `sight 0`, `light 0`, `sound 20` (`10` con `sonoro`); `baranda` =
`move 20`, `sight 0`, `light 0`, `sound 0` (sólo frena el paso).

Tipos de mueble fijos por defecto: `escritorio` (`monitor: false` sin pantalla, `cable: true`
con el cable colgando), `cama`, `heladera`, `mesada` (`bacha`/`anafe: false`), `estante`,
`mapas` (franja de mapas con alfileres rojos, azules y amarillos), `corcho`, `radiador`, `tv`
(apagada), `timbre` (cámara de timbre sin LED), `contenedor`, `escalera` (`hacia` = hacia
dónde baja; `material: "metal"`), `escalerilla`, `trampilla`, `inodoro` (`contra`), `lavabo`,
`ducha`, `banera`, `maquina`. Móviles por defecto: `silla`, `sofa`, `mesa`, `lampara`, `carro`,
`palet`, `camilla`, `tubos`, `portatil`, `cenicero`. `fijo: true/false` lo pisa.

---

## 7. Checklist de control de calidad

Se corre **antes de dar por terminado cualquier mapa**. Si algo falla, se rehace (o se deja el
esquema), no se entrega con la falla anotada.

- [ ] **Cenital 100 %.** Ningún canto lateral de muro, ningún objeto en perspectiva.
- [ ] **Alineación medida:** los muros del plano dibujados en rojo sobre el mapa final caen
      sobre los muros pintados (tolerancia ~5 px).
- [ ] **Nada horneado que sea del Narrador:** sin hojas de puerta, sin luz pintada (pantallas,
      lámparas, LED, farolas), sin lluvia cayendo, sin personas, sin muebles móviles
      inventados, **sin texto ni pseudo-texto** (ni en los mapas de Helen, ni números de puerta).
- [ ] **Sin muros inventados:** el modelo no subdividió salas ni agregó tabiques.
- [ ] **Huecos intactos:** cada vano del plano sigue abierto en el pintado; las barandas siguen
      siendo finas (no se volvieron muro).
- [ ] **A sangre:** sin margen, marco ni viñeta.
- [ ] **Escala:** mapa de `ancho × alto × 100` px exactos; 100 px por casilla de 1 m.
- [ ] **Estilo coherente** con la referencia: hoja de contactos y métricas de §5; un solo acento
      carmesí.
- [ ] **Transiciones:** cada región con destino tiene su gemela; las pendientes están anotadas.
- [ ] **Tiles:** alfa real, recortados, sin sombra en el suelo, sin luz pintada.
- [ ] **Capturas desde Foundry** (`tools/e2e/`, Pendiente en SBN): cada escena mirada en el
      canvas real.

```bash
# esquema y capa de depuración
node tools/construir-planos.mjs --solo helen --depurar "$TMPDIR/mapas"
# métricas de estilo
magick assets/mapas/<id>.webp -colorspace HSL -format "sat %[fx:mean.g*100] lum %[fx:mean.b*100]\n" info:
# hoja de contactos contra la referencia
magick montage assets/mapas/helen.webp assets/mapas/<id>.webp -tile 2x1 -geometry 900x857+8+8 hoja.jpg
```

---

## 8. Mapa regional (MAP-00)

`assets/mapas/seattle.webp` (Pendiente): Seattle y el estrecho de Puget, de Everett a Tacoma y
de Bainbridge a Bellevue y el valle del Snohomish (doc 15, MAP-00). No se pinta con el modelo:
se **renderiza desde OpenStreetMap** con un script como `tools/malaga-mapa.py` de DVV, así la
costa y las calles están donde están. Mismo contrato que los interiores, de noche: tierra
carbón y pizarra, agua azul marino oscuro, luces de la ciudad como puntos tenues sin halo. Sin
texto, sin leyenda (la leyenda de AYU-01 va aparte o en Foundry), sin grid. Bbox, escala y
métricas: Pendiente.

**Atribución obligatoria:** «© OpenStreetMap contributors (ODbL)» en la nota de la escena y
donde se muestre o redistribuya el mapa.

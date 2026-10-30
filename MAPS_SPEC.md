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

Los 21 planos de `content/planos/` (13 archivos; un archivo puede traer varias plantas). Medidas
en metros (= casillas); «luces» es lo que el plano declara (`luces[]` y muebles con `luz`), con
el preset que usa hoy la escena (el `presetIdeal` ya existe en todos los casos).

| LUG | Plano | Lugar | Medida | Paleta / fondo | Escenas | Oscuridad | Luces | Niveles |
|---|---|---|---|---|---|---|---|---|
| MAP-00 | — | Seattle y el estrecho de Puget (AYU-01) | regional | OpenStreetMap estilizado (§8) | sesión cero, A1-E03 | Pendiente | ninguna | — |
| LUG-01 | `hangar` | El hangar de Harbor Island | 24 × 23 | industrial / asfalto (agua de Elliott Bay y dársena) | A1-E01, A4-E02, AVE-01-EPI | 0.8 | 3 luces de obra, 4 lámparas tenues, fluorescente viejo, aplique de sodio, farola, **reflector de FIRSTLIGHT apagado** (11) | 1 |
| LUG-02 | `granja` | La granja del Sheriff: casa, granero, perreras, caravanas | 24 × 23 | rural / tierra (grava) | A1-E03, A3-E04, A4-E02 | 0.85 | 7 lámparas tenues, 2 lámparas, 2 apliques, pantalla de la tableta (12) | 2 (+ sótano) |
| LUG-02 | `granja-sotano` | La granja: el sótano y el túnel | 12 × 14 | subterraneo / roca | A4-E02 | 1 | lámpara tenue (1) | sótano |
| LUG-03 | `galeria` | La Galería de Vidrio, el Elíseo (pabellón curvo: `contorno`) | 24 × 17 | galeria / acera | A2-E01, A4-E01 | 0.6 | 3 vidrio-rojo + 4 vidrio-ambar (medusas), lámparas, vela, fluorescente, 2 pasillo, farola (14) | 2 (+ archivo) |
| LUG-03 | `galeria-archivo` | La Galería: el archivo de la Guardiana | 13 × 11 | subterraneo / roca | A2-E01 | 0.9 | 2 fluorescentes viejos, lámpara tenue (3) | sótano |
| LUG-04 | `subterraneo` | Las Galerías Selladas | 24 × 14 | subterraneo / roca | A1-E04 | 0.9 | 4 claraboyas violeta, carburo, 2 lámparas tenues, vela, LED de rack, pantalla (10) | 1 |
| **LUG-05** | **`helen`** | **El apartamento de Helen Ward** (referencia del set) | 21 × 20 | apartamento / edificio | A0-E01, A1-E01, A3-E01 | 0.75 | 2 plafones de pasillo, 4 LED de timbre + el verde del 3B, lámpara, pantalla, aplique del callejón, farola (11) | 1 |
| LUG-06 | `torre-atico` | Torre Halloway, el ático (piso 42) | 21 × 13 | oficina / vacío | A4-E01 | 0.7 | 2 lámparas, lámpara tenue, 2 pasillo, fluorescente (6) | 2 (ascensor) |
| LUG-06 | `torre-boveda` | Torre Halloway, la bóveda (nivel −3) | 11 × 8 | subterraneo / roca | A4-E01 | 0.9 | fluorescente, 2 pasillo (3) | bóveda |
| LUG-07 | `gale-sentinel` | Gale Sentinel: vestíbulo (planta baja) | 19 × 14 | oficina / asfalto | A1-E05, A3-E02 | 0.7 | 3 videopared, 2 pantallas, fluorescentes, aplique, 2 farolas (11) | 3 |
| LUG-07 | `gale-planta3` | Gale Sentinel: planta 3, despacho de Gale | 19 × 14 | oficina / asfalto | A1-E05, A3-E02 | 0.8 | fluorescentes, LED de rack, pantalla, 2 farolas (6) | planta 3 |
| LUG-07 | `gale-datos` | Gale Sentinel: el centro de datos | 23 × 20 | oficina / asfalto | A3-E02 | 0.85 | 3 neón (racks), 2 videopared (pared de caras), fluorescentes, 2 pantallas, aplique, 2 farolas (13) | edificio aparte |
| LUG-10 | `salitre` | Bar Salitre (y la cabecera de la grada) | 20 × 22 | industrial / grava | A2-E03 | 0.75 | neón, 2 lámparas, 2 tenues, 2 fluorescentes viejos, aplique, farola (9) | 1 |
| LUG-11 | `larchmont-planta` | Edificio Larchmont: planta baja quemada | 19 × 14 | apartamento / edificio | A2-E05 | 0.85 | farola de la calle (1) | 2 |
| LUG-11 | `larchmont-sotano` | Edificio Larchmont: sala de calderas | 19 × 11 | subterraneo / roca | A2-E05 | 1 | ninguna (las linternas son de los PJ) | sótano |
| LUG-14 | `northline` | Northline Cyber Advisory, piso 11 | 21 × 15 | oficina / vacío | interludios de FIRSTLIGHT | 0.8 | neón, lámpara tenue, fluorescentes, **2 UV apagadas** (6) | 1 |
| LUG-15 | `terminal-ferry` | Colman Dock, la terminal de ferris | 24 × 16 | naval / agua | A4-E03 | 0.55 | 3 fluorescentes, fluorescente viejo, parpadeo, pantalla, farola, aplique (8) | 1 |
| LUG-15 | `ferry` | El ferry: salón de pasajeros y cubierta de popa | 24 × 24 | naval / agua | A4-E03 | 0.6 | 5 fluorescentes, fluorescente viejo, 2 apliques (8) | 3 (+ coches, puente) |
| LUG-15 | `ferry-coches` | El ferry: cubierta de coches | 24 × 24 | naval / agua | A4-E03 | 0.65 | 4 fluorescentes, fluorescente viejo, aplique (6) | cubierta baja |
| LUG-15 | `ferry-puente` | El ferry: el puente | 13 × 24 | naval / agua | A4-E03 | 0.85 | 2 pantallas, 2 apliques (4) | cubierta alta |
| LUG-16 | `terminal86` | Elevador de grano de la Terminal 86 (galería de cintas sobre los silos) | 24 × 12 | industrial / agua (techo de silos de hormigón) | A3-E03 | 0.85 | farola, aplique (2) | 1 |

Todos los planos usan ya su paleta, sus pisos y sus tipos de mueble propios, y declaran su `sujeto`.

Sin mapa (escenas de ambiente: una ilustración a pantalla completa, sin cuadrícula): LUG-08 Pike
Place, LUG-09 Club Ceniza, LUG-12 la tumba de Emily, LUG-13 la Capilla del Observatorio.

### Coherencia entre mapas (obligatoria)

Las transiciones son regiones `teleportToken` gemelas, derivadas del plano. Si se mueve un
acceso en un plano, se mueve su gemelo: la orientación de un acceso en un mapa manda sobre el
mapa de destino. Lo que se deduce de los docs 05, 10–13 y 15:

```
helen (escalera de incendios, descanso del 3.º) ⇄ helen (pie de la escalerilla, callejón)       HECHO, mismo mapa
helen (escalera común, portal)                  →  Market Street                                 Pendiente: no hay mapa de calle
helen (rellano de la azotea, puerta cerrada)    →  azotea                                        Pendiente: no hay mapa del techo
helen (callejón de servicio, sale al sur)       →  Market Street                                 Pendiente: no hay mapa de calle
hangar (trampilla al túnel de carga)            →  salida junto a la Terminal 46 (200 m)         Pendiente: sin mapa del túnel
hangar (lancha, muelle oeste, patio)            →  bahía / muelle / patio de contenedores        Pendiente: sin mapas
granja (vestíbulo, escalera al sótano)          ⇄ granja-sotano (pie de la escalera)             HECHO
granja (camino de grava, sendero al río)        →  zona del valle del Snohomish (t2i)            Pendiente: mapa de zona
granja-sotano (túnel de 300 m)                  →  embarcadero del río (zona del valle)          Pendiente: mapa de zona
galeria (escalera de servicio)                  ⇄ galeria-archivo (pie de la escalera)           HECHO
galeria (puertas de vidrio, al sur)             →  plaza de Seattle Center                       Pendiente: sin mapa
subterraneo (escalera desde un sótano)          →  Pioneer Square                                Pendiente: sin mapa de calle
torre-atico (ascensor privado)                  ⇄ torre-boveda (cabina del ascensor)             HECHO
torre-atico (escalera de emergencia, 42 pisos)  →  la calle                                      Pendiente
gale-sentinel (escalera, ascensores A y B)      ⇄ gale-planta3 (escalera, rellano de ascensores) HECHO (los dos ascensores llegan al mismo rellano)
gale-sentinel (patio de servicio, norte)        ⇄ gale-datos (patio de servicio, sur)            HECHO
gale-sentinel / gale-datos (estacionamiento)    →  campus (zona t2i, LUG-07)                     Pendiente: mapa de zona
salitre (carretera, grada, astillero)           →  carretera / exterior del astillero (t2i)      Pendiente
larchmont-planta (escalera medio derrumbada)    ⇄ larchmont-sotano (pie de la escalera)          HECHO
larchmont-planta (hueco del piso)               →  larchmont-sotano (caída al pie del hueco)     HECHO (sólo baja)
larchmont-sotano (desagüe)                      →  el estrecho                                   Pendiente
northline (ascensores, escalera de emergencia)  →  vestíbulo de la torre / la calle              Pendiente
terminal-ferry (rampa de pasajeros)             ⇄ ferry (cubierta de popa, llega la pasarela)    HECHO (sólo amarrado)
terminal-ferry (rampa de vehículos)             ⇄ ferry-coches (popa abierta)                    HECHO (sólo amarrado)
terminal-ferry (escalera sala ⇄ explanada)      ⇄ terminal-ferry                                 HECHO, mismo mapa
terminal-ferry (Alaskan Way)                    →  la calle                                      Pendiente
ferry (escaleras de estribor y babor)           ⇄ ferry-coches (las mismas escaleras)            HECHO
ferry (escalera central)                        ⇄ ferry-puente (caseta de la escalera)           HECHO
ferry / ferry-coches (saltar por la popa)       →  el agua                                       Pendiente: lo resuelve el Narrador
terminal86 (escalera de servicio, silo vecino, compuerta) → patio, interior del silo, bahía      Pendiente
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
- **Tamaño:** hasta **24 m** por lado (2400 px); el lado lo da el lugar, no hay mínimo: la
  bóveda de la torre mide 11 × 8 m y el archivo de la Galería 13 × 11, y está bien. Un lugar más
  grande que 24 m se parte en varios planos unidos por regiones (el ferry: salón, coches y
  puente). Tope duro: 8192 px de lado. `helen` mide 21 × 20 m.
- **Escena:** padding **0** (como DVV: con padding, Foundry corre el rectángulo de la escena y
  las coordenadas del plano quedarían desplazadas), grid cuadrado de 100 px con `alpha 0` (el piso ya lee la
  retícula; el Narrador lo sube si quiere), visión de token y niebla de exploración
  activadas, oscuridad según la tabla de §1.
- **La escena mide exactamente `ancho × alto × 100` px.**
- **Una planta por mapa.** Lo que se ve «abajo» desde una planta alta (el callejón bajo la
  escalera de incendios, la vereda) es exterior a nivel de calle: se pinta, y se llega por
  regiones, no caminando. Las barandas lo separan.

---

## 5. Estilo visual

**Fuente única de verdad:** el bloque `estilos.battlemap` de `tools/arte.config.json` para lo
pintado (`materiales` con su `_breve`, `objetos`, `aclaraciones`, `paletas`) y las `PALETAS` de
[`tools/planos.mjs`](tools/planos.mjs) para el esquema. No se describe el estilo por mapa; el
plano sólo describe su sujeto (`exterior`, `sujeto`, nombres de habitación, `desc` de muebles).
Los prefijos y sufijos llevan marcadores que `pintar-planos` llena con lo de cada plano
(`{LUGAR}`, `{PISOS}`, `{MATERIALES}`, `{ALREDEDOR}`, `{AFUERA}`, `{MUROS}`, `{TOPES}`, `{ACENTO}`,
`{MADERA}`, `{TONO_MADERA}`, `{SUELO}`, `{MATERIALES_FUERA}`, `{SIN_AZUL}`, `{PASILLO}`, `{EN_MAPAS}`, `{PAPELES}`) y
los que dependen del tipo de lugar salen de `estilos.battlemap.paletas.<paleta>` (`{GRANO}`, `{GRANO_DETALLE}`,
`{DETALLE}`, `{NUMEROS}`; los de apartamento son los de helen y hacen de respaldo).

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
- **Paletas del renderer** (`PALETAS` de `tools/planos.mjs`; su texto para el modelo en
  `estilos.battlemap.paletas`). Todas dentro de la paleta del set: cambian el material de los
  muros, la cantidad de mugre (`suciedadK`) y los valores, nunca el tono de fondo.
  - `apartamento`: tablas de abeto, revoque gris pizarra, tinte azul de puerto al 16 %, tono
    ambiente azul noche al 6 % (helen, Larchmont).
  - `industrial`: bloque de hormigón y chapa acanalada, grasa y óxido pardo-gris, más mugre
    (hangar, Salitre, Terminal 86).
  - `subterraneo`: sillería de ladrillo y piedra húmedos, oscuro, humedad azul-gris (Galerías
    Selladas, sótanos, archivo, bóveda).
  - `oficina`: durlock gris pálido, limpio y frío, casi sin mugre (Northline, Torre Halloway,
    Gale Sentinel).
  - `galeria`: hormigón carbón y acero negro, pulido, sin mugre (la Galería de Vidrio).
  - `rural`: tablas oscuras de granero, barro (la granja).
  - `naval`: mamparos de acero gris pálido remachado, el agua alrededor (el ferry y su terminal).
  `construir-planos` avisa si un plano pide una paleta, piso, fondo, mueble o preset que no existe.
- **Grading.** Todo mapa pintado pasa por el grading determinista de `pintar-planos --grading`
  (`estilos.battlemap.grading`: tabla de color en OKLab): croma de la madera topada (nunca
  naranja), sin verde musgo, manchas azules del modelo topadas y el azul de puerto puesto como
  tinte de sombras; los rojos saturados (los alfileres) quedan fuera de los topes.
- **Métricas del set** (`magick … -colorspace HSL`, media sobre el mapa entero, macizos
  incluidos): **sat 9–15 %, lum 22–30 %**. Un mapa fuera de rango se revisa antes de entregar
  (no se corrige a mano: se ajusta el grading o el pintado). La referencia es `helen`.

  | Mapa | sat | lum | nota |
  |---|---|---|---|
  | `helen.esquema` | 8.8 | 26.3 | esquema vectorial; la luminancia baja la ponen los departamentos cerrados rayados |
  | `helen` (klein, sin detalle ni grading) | 6.5 | 27.9 | prueba de SPEC §4.5: casi gris, se descartó |
  | **`helen`** (klein + detalle + grading) | **9.9** | **26.2** | **referencia del set** (2026-10-30); los macizos (#1b1f23, ~40 % del mapa) pesan en la media |

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
   │  node tools/pintar-planos.mjs --solo <id>   (lo fijado en arte.config.json → mapas.<id>)
   │  1. repintado del plano entero a ~1,5 MP (helen: FLUX.2 klein 4B, semilla 11)
   │  2. SeedVR2 7B a 100 px/m + corrección afín contra el esquema
   │  3. --detalle: pasada por mosaicos a 200 px/m (Z-Image Turbo + ControlNet canny del
   │     propio mosaico, grano inyectado, prompt por recorte; interior y exterior aparte,
   │     compuestos con máscaras del plano), baja a 100 px/m y se vuelve a corregir
   │  4. --grading: tabla de color determinista (estilos.battlemap.grading)
   │  5. sellado de los bloques `macizo` + métricas (gate: calidad ≥ 0,45, ≥ 90 % de
   │     muro a ≤ 5 px, anisotropía ≤ 3 %)
   ▼
assets/mapas/<id>.webp                  mapa pintado y corregido (q88), 100 px/m
   │  node tools/construir-contenido.mjs (tools/contenido/escenas.mjs; sin pintado usa el esquema)
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
| `paleta`, `fondo` | `apartamento`, `industrial`, `subterraneo`, `oficina`, `galeria`, `rural`, `naval`; `fondo` pisa el exterior de la paleta: `asfalto`, `acera`, `edificio` (techos vecinos, rayado), `roca` y cualquier piso (`agua`, `grava`, `tierra`, `vacio`, `tablas`…) |
| `exteriores[]` | `{ nombre, x, y, w, h, fondo }`: zonas de exterior sobre el fondo (callejón, vereda, dársena). Si el nombre dice «planta baja» o «más abajo» y el plano no es la planta baja, el prompt la describe «muy abajo» |
| `oscuridad`, `luzGlobal` | darkness de la escena; luz global para escenas de día |
| `exterior` | texto para el modelo (inglés): qué rodea al edificio. Empieza por el sujeto («a 1962 glass-and-steel exhibition pavilion in Seattle Center seen from directly above…»): de ahí sale el lugar del prompt |
| `sujeto`, `sobreSuelo` | opcionales: el lugar en inglés para los prefijos (si no, sale de `exterior` o de la paleta) y los metros sobre el suelo de afuera (si no, se deduce de los nombres de `exteriores`) |
| `curvas[]` | `{ tipo, puntos, cerrada? }`: muros, vidrios o barandas sueltos como polilínea (ver `contorno`) |
| `nota` | nota del Narrador (markdown; va a los flags de la escena, con la lista de móviles) |
| `habitaciones[]` | `{ nombre, x, y, w, h, piso, vetas?, limpio?, sinMuros?, contorno? }` — piso: `tablas`, `tablas-alfombra`, `tablas-quemadas`, `parquet`, `linoleo`, `baldosa`, `azulejo`, `terrazo`, `marmol`, `moqueta`, `tecnico`, `hormigon`, `piedra`, `ladrillo`, `chapa` (plancha diamantada), `cubierta` (de barco), `goma` (pasarela), `ascensor` (cabina), `tierra`, `grava`, `agua`, `vacio` (hueco, caída), `rejilla` (escalera de incendios), `macizo` (departamento cerrado, rayado); `vetas`: `h`·`v`; `sinMuros`: sólo piso; `contorno`: polígono que reemplaza al rectángulo (puntos `[x, y]` o `[x, y, tipo]` = tipo del tramo que sale de ese punto, o arcos `{ arco: [cx, cy, r, desde°, hasta°], tipo? }`): el piso se recorta y los muros salen en segmentos rectos para Foundry. El nombre (en español) da el rol en el prompt («Porche», «Cubierta», «Sala de calderas»…) |
| `vanos[]` | `{ x, y, w, eje, tipo, estado?, sonido?, sonoro?, nombre }` — `abierto`, `puerta`, `secreta`, `puerta-vidrio`, `ventana`, `hueco` (ventana sin vidrio), `vidrio`, `baranda`, `arcada`; `estado`: `cerrada`·`abierta`·`trabada`; `sonido`: clave de `CONFIG.Wall.doorSounds` (`woodBasic`, `woodCreaky`, `woodHeavy`, `metal`, `industrial`, `slidingWood`…; por defecto, el de la paleta) |
| `muebles[]` | `{ tipo, x, y, w, h, desc?, fijo?, luz?, luzIdeal?, luzApagada?, cabecera?, frente?, contra?, tile?, hacia?, material?, anomaly? }` |
| `luces[]` | `{ x, y, preset, presetIdeal?, apagada?, nombre? }` — presets en `tools/iluminacion.mjs`, radios en metros; `presetIdeal` se usa si existe (si no, `preset` y `construir-planos` avisa); `apagada: true` crea la luz apagada (`hidden`) |
| `regiones[]` | `{ id, nombre, x, y, w, h, destino: "<plano>:<región>" \| null, llegada?, pendiente? }` — `llegada: true` sólo recibe; `destino: null` + `pendiente` = acceso a un mapa que todavía no existe |

En Foundry: `puerta` = `door 1`; `secreta` = `door 2` (se ve pared); `puerta-vidrio` y
`ventana` = `door 1` con `sight 0`, `light 0`, `sound 10` (cerrada se ve a través; abierta se
cruza); `hueco` = `door 1` con `sight 0`, `light 0`, `sound 0` y sin sonido de puerta (todo pasa;
para cruzar se «abre»: trepar); `vidrio` = `move 20`, `sight 0`, `light 0`, `sound 20` (`10` con `sonoro`); `baranda` =
`move 20`, `sight 0`, `light 0`, `sound 0` (sólo frena el paso).

Tipos de mueble fijos por defecto: `escritorio` (`monitor: false` sin pantalla, `cable: true`
con el cable colgando), `cama`, `heladera`, `mesada` (`bacha`/`anafe: false`; en el prompt es
cocina sólo si su `desc` habla de bacha u hornallas), `estante`, `mapas` (franja de mapas con
alfileres rojos, azules y amarillos), `corcho`, `radiador`, `tv` (apagada), `timbre` (cámara de
timbre sin LED; con `anomaly: true` es una `camara`), `contenedor`, `escalera` (`hacia` = hacia
dónde baja; `material: "metal"`), `escalerilla`, `trampilla`, `inodoro` (`contra`), `lavabo`,
`ducha`, `banera`, `maquina`; y `videopared` (o `pantallas`), `panel`, `rack`, `camara`, `lector`,
`banco` (`material: "hormigon"`·`"tapizado"`), `mostrador`, `barra`, `maquina-cafe`,
`expendedora`, `consola`, `timon`, `balsa`, `generador`, `enfriadora`, `chimenea` (`contra`),
`banco-trabajo`, `caja-fuerte` (o `cajafuerte`), `caseta`, `picadero`, `carril`, `grua`,
`tapiado`, `cable`, `carbon`, `escombros`, `canal`, `cinta`, `flores`, `pedestal`
(`material: "oscuro"`), `jardinera`, `maceta`, `lampara-uv`. Móviles por defecto: `silla`,
`sofa`, `mesa`, `lampara`, `carro`, `palet`, `camilla`, `tubos`, `portatil`, `cenicero`, `auto`
(o `coche`), `vehiculo` (o `lancha`), `bandeja`, `carpeta`, `maletin`, `catre`. `fijo: true/false`
lo pisa. Un tipo desconocido sale como caja genérica y `construir-planos` lo avisa.

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

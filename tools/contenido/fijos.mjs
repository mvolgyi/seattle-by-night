/**
 * Textos fijos del build (los que no vienen de content/: títulos de los
 * journals generados, filas de las fichas, etiquetas de los botones, nombres
 * de carpetas, de clanes y de Disciplinas…) en los dos idiomas.
 *
 * `T("Noche {n}", { n })`: la clave es el texto castellano tal cual lo escribía
 * el build, así el castellano sale idéntico; en inglés se busca en INGLES. Un
 * texto que falta en la tabla sale en castellano y se anota en `sinTraducir`
 * (el build lo avisa): mejor un hueco visible que un _id distinto.
 *
 * Los nombres visibles de carpetas: content/en/carpetas.json (TRADUCCION.md,
 * «Carpetas») y, para las que no salen de content/ (actores, escenas, ítems),
 * CARPETAS de acá. Las CLAVES de carpeta nunca cambian: de ellas sale el _id.
 */
import fs from "node:fs";
import path from "node:path";
import { escribirDoc } from "../util.mjs";
import { EN, DIR_EN, packDe } from "./idioma.mjs";

export const sinTraducir = new Set();

const sustituir = (texto, vars) => (vars ? texto.replace(/\{(\w+)\}/g, (todo, k) => (k in vars ? String(vars[k]) : todo)) : texto);

/** Texto fijo en el idioma del build. */
export function T(es, vars) {
  if (!EN) return sustituir(es, vars);
  const en = INGLES[es];
  if (en === undefined) { sinTraducir.add(es); return sustituir(es, vars); }
  return sustituir(en, vars);
}

/** El texto de un diccionario { clave: castellano } en el idioma del build (CLANES, DISCIPLINAS…). */
export const tabla = (es, en) => (EN ? { ...es, ...en } : es);

/** Escribe un documento en el pack del idioma (packs-src/<pack> o packs-src/<pack>-en). */
export const escribir = (pack, doc) => escribirDoc(packDe(pack), doc);

/* -------------------------------------------- */
/*  Carpetas                                    */
/* -------------------------------------------- */

/** Nombres visibles en inglés por nombre castellano (las que no vienen de content/en/carpetas.json). */
const CARPETAS = {
  "El Expediente Ward": "The Ward File",
  "Del prólogo al epílogo": "From Prologue to Epilogue",
  "Seattle by Night": "The Ward File",
  "La ciudad": "The City",
  "Lugares": "Locations",
  "Personajes jugadores": "Player Characters",
  "Vástagos": "Kindred",
  "Mortales y ghouls": "Mortals and Ghouls",
  "Trasfondo": "Background",
  "Sangre débil": "Thin-Blood",
  "Documentos del mundo": "In-World Documents",
  "Ayudas de juego": "Handouts",
  "Célula Puget": "Puget Cell",
  "Coteries": "Coteries",
  "Menores": "Minor NPCs",
  "Mortales": "Mortals",
  "Ghouls": "Ghouls",
  "Armas": "Weapons",
  "Protección": "Protection",
  "Equipo": "Gear",
  "Estados": "Conditions",
  "FIRSTLIGHT": "FIRSTLIGHT",
  "Brujah": "Brujah", "Gangrel": "Gangrel", "Malkavian": "Malkavian", "Nosferatu": "Nosferatu",
  "Toreador": "Toreador", "Tremere": "Tremere", "Ventrue": "Ventrue", "Caitiff": "Caitiff"
};

let CARPETAS_EN = null;
/**
 * content/en/carpetas.json (lo escribe tools/traducir.mjs):
 * { _fuente, carpetas: { "Seattle by Night/La ciudad": "The City", … } }. Vacío si no está.
 */
function carpetasEn() {
  if (CARPETAS_EN) return CARPETAS_EN;
  const ruta = path.join(DIR_EN, "carpetas.json");
  const json = fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, "utf8")) : {};
  CARPETAS_EN = json.carpetas ?? Object.fromEntries(Object.entries(json).filter(([k]) => !k.startsWith("_")));
  return CARPETAS_EN;
}

/**
 * Nombre visible de una carpeta. `clave` es la de Carpetas (util.mjs): «/X»
 * para una raíz, «X/Y» para sus hijas. `nombre`, el que ya tiene (en
 * castellano, o el de NOMBRE_CARPETA de journals.mjs). `fijo`: el nombre lo
 * pone el build (las raíces de cronica) y no se busca en carpetas.json, que
 * traduce las claves de content/ y no los nombres de NOMBRE_CARPETA.
 */
export function nombreCarpeta(clave, nombre, { fijo = false } = {}) {
  if (!EN) return nombre;
  if (fijo) {
    if (CARPETAS[nombre] === undefined) sinTraducir.add(`carpeta ${nombre}`);
    return CARPETAS[nombre] ?? nombre;
  }
  const mapa = carpetasEn();
  const k = clave.replace(/^\//, "");
  const ultimo = k.split("/").at(-1);
  // Las carpetas de actores repiten las de los journals sin «Seattle by Night/»: misma traducción.
  const sufijo = Object.keys(mapa).find(x => x.endsWith(`/${k}`));
  const v = mapa[k] ?? (sufijo ? mapa[sufijo] : undefined) ?? CARPETAS[nombre] ?? CARPETAS[ultimo];
  if (v === undefined) { sinTraducir.add(`carpeta ${k}`); return nombre; }
  // carpetas.json puede dar la ruta entera traducida: el nombre es el último tramo.
  return String(v).split("/").at(-1);
}

/**
 * Carpetas#escribir (util.mjs) con el nombre visible del idioma y en el pack
 * del idioma. Mismo orden y mismos campos que el original: en castellano
 * escribe exactamente lo mismo. `fijas`: claves que ya tienen su nombre final.
 */
export function escribirCarpetas(c, { fijas = new Set() } = {}) {
  if (c.orden) {
    const sueltas = [...c.mapa.values()].filter(x => !x.sort).sort((a, b) => a.name.localeCompare(b.name, "es"));
    sueltas.forEach((x, i) => { x.sort = 1000 + i * 10; });
  }
  for (const [clave, x] of c.mapa) {
    escribir(c.pack, { ...x, name: fijas.has(clave) ? x.name : nombreCarpeta(clave, x.name), _key: `!folders!${x._id}` });
  }
}

/* -------------------------------------------- */
/*  Tabla castellano → inglés                   */
/* -------------------------------------------- */

const INGLES = {
  // journals.mjs: marcadores
  "Congelar": "Freeze",
  "Noche {n}": "Night {n}",
  "Noche {n} · {dia} (madrugada del {fecha})": "Night {n} · {dia} (early hours of {fecha})",
  // journals.mjs: documentos y perfiles
  "Para el Narrador": "For the Storyteller",
  "Soporte": "Format",
  "Entrega": "Hand out",
  "Notas de edición": "Editor's notes",
  "Provisional (doc 16)": "Provisional (doc 16)",
  "Propuesto (no está en los docs)": "Proposed (not in the docs)",
  "Sesión cero": "Session zero",
  "Sólo para el Narrador": "Storyteller only",
  "Fuera de la aventura": "Outside the adventure",
  "Epílogo": "Epilogue",
  "Ficha": "Sheet",
  // journals.mjs: Pistas
  "Pistas": "Clues",
  "Principal": "Main", "Preludio": "Prelude", "Documento": "Document", "Relato": "Account",
  "Loresheet": "Loresheet", "Parcial": "Partial", "Alternativa": "Alternative", "Indicio": "Hint",
  "Refuerzo": "Reinforcement", "Adelantada": "Early",
  "doc {o}": "doc {o}",
  "Dónde se obtiene": "Where it's found",
  "Escena principal": "Main scene",
  "También en": "Also in",
  "Dados que aporta": "Dice it adds",
  "Efectos": "Effects",
  "Ayuda de juego": "Handout",
  "Nota": "Note",
  "En los docs": "In the docs",
  // journals.mjs: Termómetro y Reloj
  "El Termómetro y el Reloj": "The Thermometer and the Clock",
  "Cambio": "Change", "Motivo": "Reason", "Dónde": "Where",
  "por {x}": "by {x}",
  "máx. {x}": "max. {x}",
  "sólo {x}": "{x} only",
  "El Termómetro de FIRSTLIGHT": "The FIRSTLIGHT Thermometer",
  "Empieza en": "Starts at",
  "escala": "scale",
  "ayuda de juego:": "handout:",
  "Umbrales": "Thresholds",
  "Valor": "Value",
  "Qué pasa": "What happens",
  "Lo que ven los jugadores": "What the players see",
  "Inicio": "Start",
  "Interludio de FIRSTLIGHT": "FIRSTLIGHT interlude",
  "Condiciones": "Conditions",
  "Termómetro": "Thermometer",
  "Efecto": "Effect",
  "Fuentes: docs {x}": "Sources: docs {x}",
  "Movimientos del Termómetro": "Thermometer Moves",
  "Los botones mueven el Termómetro (sólo el Narrador).": "The buttons move the Thermometer (Storyteller only).",
  "Sube": "Goes up",
  "Baja": "Goes down",
  "Otros movimientos": "Other moves",
  "Cómo evitar que suba": "How to keep it from rising",
  "El Reloj de Halloway": "Halloway's Clock",
  "Noche": "Night",
  "Fecha": "Date",
  "Escenas": "Scenes",
  "Si la coterie…": "If the coterie…",
  "Si…": "If…",
  "Entonces…": "Then…",
  "Nota de edición": "Editor's note",
  "Versión del doc 01": "Doc 01 version",
  "Noche {n} · {dia}": "Night {n} · {dia}",
  "madrugada del {fecha}": "early hours of {fecha}",
  "Cambio fijo de la noche": "Fixed change for the night",
  "(si pasa)": "(if it happens)",
  "Hora a hora": "Hour by hour",
  "Hora": "Time",
  "Versiones de los docs": "Versions in the docs",
  // journals.mjs: documentos maquetados
  "Membrete": "Letterhead",
  "foto": "photo",
  "{n} puntos": "{n} points",
  // actores.mjs
  "El Expediente Ward": "The Ward File",
  "El libro no lo describe.": "The book doesn't describe it.",
  "{disciplina} {nivel}. Poder del manual básico de V5.": "{disciplina} {nivel}. Power from the V5 core rulebook.",
  "Convicciones": "Convictions",
  "Piedras de toque": "Touchstones",
  "Apodo": "Epithet",
  "Concepto": "Concept",
  "Clan": "Clan",
  "Secta": "Sect",
  "Sire": "Sire",
  "Nacimiento": "Born",
  "Abrazo": "Embraced",
  "Edad": "Age",
  "Depredador": "Predator Type",
  "Resonancia": "Resonance",
  "Ambición": "Ambition",
  "Deseo": "Desire",
  "Cantidad": "Number",
  "Reservas": "Dice pools",
  "Plantilla": "Template",
  "alternativa": "alternate",
  "Foco": "Spotlight",
  "Brilla en": "Shines in",
  "Coterie": "Coterie",
  "Perfil: {nombre}": "Profile: {nombre}",
  "Semblante": "Demeanor",
  "Daño": "Damage",
  "agravado": "aggravated",
  "agravado contra Vástagos": "aggravated against Kindred",
  "Blindaje": "Armor",
  "Estado": "Condition",
  "(máximo +{n} por escena)": "(maximum +{n} per scene)",
  "Célula": "Cell",
  "Credo": "Creed",
  "Desesperación": "Desperation",
  "Impulso": "Drive",
  "Redención": "Redemption",
  "Facultades": "Edges",
  "Cazador": "Hunter",
  "Pregenerado: {nombre}": "Pregen: {nombre}",
  "Base": "Base",
  "Cazadores": "Hunters",
  "Además": "Also",
  "Desesperación inicial": "Starting Desperation",
  "Peligro inicial": "Starting Danger",
  "{n} de {max}": "{n} of {max}",
  "Tipo": "Type",
  "Dominio": "Domain",
  "Lugar": "Location",
  "Miembros": "Members",
  "Aliados": "Allies",
  "Sustitutos": "Substitutes",
  "{b} si nadie juega {a}": "{b} if nobody plays {a}",
  "Ayuda": "Handout",
  "Caza (Chasse)": "Chasse",
  "Dominio según el doc 02:": "Domain according to doc 02:",
  "Trasfondos según el doc 02:": "Backgrounds according to doc 02:",
  "Alternativas:": "Alternatives:",
  // escenas.mjs
  "Suelo": "Ground",
  "oculto": "hidden",
  "Tokens colocados.": "Placed tokens.",
  "Los ocultos se revelan desde la capa de tokens; los que dependen de cómo vino la noche dicen cuándo.":
    "Hidden ones are revealed from the token layer; the ones that depend on how the night went say when.",
  "Los muebles móviles ({n}) son tiles desbloqueados: se pueden mover, tirar o usar de barricada.":
    "The movable furniture ({n}) are unlocked tiles: they can be moved, knocked over or used as a barricade.",
  "Muebles móviles sin pintar y todavía sin tile (colocarlos a mano): {lista}.":
    "Movable furniture not yet painted and without a tile (place it by hand): {lista}.",
  "Accesos sin mapa (región gris, no lleva a ningún lado):": "Exits without a map (grey region, leads nowhere):",
  "Portada de la crónica. Los pines abren cómo usar el módulo, la aventura y la Pantalla del Narrador.":
    "The chronicle's cover. The pins open how to use the module, the adventure and the Storyteller Screen.",
  // macros.mjs
  "El Expediente Ward: el módulo no está activo en este mundo.": "The Ward File: the module isn't active in this world.",
  "El Reloj de Halloway ya está en la última noche (": "Halloway's Clock is already on the last night (",
  "Panel del Narrador": "Storyteller Panel",
  "Termómetro +1": "Thermometer +1",
  "Termómetro −1": "Thermometer −1",
  "Macro «Termómetro +1»": "“Thermometer +1” macro",
  "Macro «Termómetro −1»": "“Thermometer −1” macro",
  "Marcar pista…": "Mark clue…",
  "Marcá las pistas que la coterie ya obtuvo; desmarcá para quitarla.": "Check the clues the coterie already has; uncheck one to remove it.",
  "Guardar": "Save",
  "Avanzar noche": "Next night",
  "Importar la crónica": "Import the chronicle",
  // musica.mjs
  "El Expediente Ward (portada)": "The Ward File (cover)",
  "Suena al activar: {escenas}": "Plays on activating: {escenas}",
  "Para lanzar a mano.": "To start by hand.",
  // aventura.mjs
  "El Expediente Ward — una crónica en Seattle (fan, no oficial)": "The Ward File — a Seattle chronicle (fan, unofficial)",
  "Seattle, noviembre de 2026. La crónica completa, lista para dirigir.": "Seattle, November 2026. The whole chronicle, ready to run.",
  "escena": "scene", "escenas": "scenes", "actor": "actor", "actores": "actors",
  "journal": "journal", "journals": "journals", "ítem": "item", "ítems": "items",
  "macro": "macro", "macros": "macros", "lista": "playlist", "listas": "playlists",
  "Importa al mundo {escenas}, {actores} (PJs, PNJs y la Célula Puget), {journals} (la aventura, la ciudad, los personajes y los documentos para entregar), {items} de FIRSTLIGHT, {macros} y {listas} de música (cada escena suena con su ambiente al activarla), con sus carpetas.":
    "Imports into the world {escenas}, {actores} (PCs, NPCs and the Puget Cell), {journals} (the adventure, the city, the characters and the documents to hand out), {items} of FIRSTLIGHT gear, {macros} and {listas} of music (each scene plays its ambience when activated), with their folders.",
  "Reimportar actualiza los documentos existentes sin duplicarlos.": "Importing again updates the existing documents without duplicating them."
};

/** Para verificar-traduccion y los tests: la tabla entera. */
export const TEXTOS_INGLES = INGLES;

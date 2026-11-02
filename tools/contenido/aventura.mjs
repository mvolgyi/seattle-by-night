/**
 * Todo lo generado → pack `aventura` (un Adventure). Va ÚLTIMO.
 *
 * Lee lo que escribieron los otros constructores en packs-src/ (cronica,
 * documentos, personajes, escenas, macros, firstlight, playlists) y lo empaqueta con sus
 * carpetas, para importar la crónica entera en un click desde el compendio o
 * desde el quickstart de Foundry 14. Adaptado de construirAventura de DVV.
 *
 * Dentro de un Adventure los documentos van como datos planos: HIERARCHY de
 * fvtt-cli no tiene entrada `adventures`, así que ningún documento contenido
 * (ni sus páginas, ítems, muros, luces, regiones…) lleva `_key`. Se quitan a
 * cualquier profundidad (ver el comentario de tools/verificar.mjs).
 *
 * La Aventura importa conservando los _id: los @UUID[JournalEntry.…] y
 * @UUID[Actor.…] de los journals y el Scene.journal de las escenas quedan
 * vivos en el mundo, y reimportar actualiza sin duplicar.
 */
import fs from "node:fs";
import path from "node:path";
import { RAIZ, MODULO, STATS, idEstable, escribirDoc } from "../util.mjs";
import { ID } from "./ids.mjs";

const PACK = "aventura";
const CLAVE = "sbn";
const NOMBRE = "El Expediente Ward — una crónica en Seattle (fan, no oficial)";
// Nombre VISIBLE de la carpeta raíz. Su _id sale de `aventura:raiz:<tipo>` y no
// del nombre, así que cambiarlo sólo la renombra al reimportar. Tiene que ser
// igual al nombre visible de la raíz de cronica (NOMBRE_CARPETA en journals.mjs).
const RAIZ_CARPETAS = "El Expediente Ward";

/** Pack de packs-src → campo del Adventure y tipo de documento. */
const FUENTES = [
  { pack: "cronica", campo: "journal", tipo: "JournalEntry" },
  { pack: "documentos", campo: "journal", tipo: "JournalEntry" },
  { pack: "personajes", campo: "actors", tipo: "Actor" },
  { pack: "escenas", campo: "scenes", tipo: "Scene" },
  { pack: "firstlight", campo: "items", tipo: "Item" },
  { pack: "macros", campo: "macros", tipo: "Macro" },
  { pack: "playlists", campo: "playlists", tipo: "Playlist" }
];

// El logo del Dark Pack lo exige el acuerdo (assets/legal/LEEME.md). La
// descripción de la Aventura la muestra también el diálogo de importación.
const AVISO_DARK_PACK =
  `<p><img class="sbn-logo-dark-pack" src="modules/${MODULO}/assets/legal/dark-pack-logo.webp" alt="Dark Pack" width="96" height="97"></p>` +
  "<p>Material no oficial de World of Darkness, publicado bajo el Dark Pack. Partes de estos " +
  "materiales son copyright y marcas registradas de Paradox Interactive AB, y se usan con permiso. Todos los " +
  "derechos reservados. Más información en worldofdarkness.com.</p>" +
  "<p>Portions of the materials are the copyrights and trademarks of Paradox Interactive AB, and are used with " +
  "permission. All rights reserved. For more information please visit worldofdarkness.com.</p>" +
  "<p>This is not official World of Darkness material.</p>";

/** Copia sin `_key` en ningún nivel. */
function sinClaves(v) {
  if (Array.isArray(v)) return v.map(sinClaves);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (k !== "_key") out[k] = sinClaves(x);
    return out;
  }
  return v;
}

function leerPack(pack) {
  const dir = path.join(RAIZ, "packs-src", pack);
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

export async function construir(ctx) {
  const aid = ID.aventura(CLAVE);
  const contenido = { actors: [], journal: [], scenes: [], items: [], macros: [], playlists: [] };
  const folders = [];
  const raices = {};
  const raiz = tipo => (raices[tipo] ??= {
    _id: idEstable(`aventura:raiz:${tipo}`), name: RAIZ_CARPETAS, type: tipo, folder: null,
    sorting: "m", sort: 0, color: "#1f3a4d", flags: { [MODULO]: { origen: "carpeta" } }, _stats: STATS
  });
  const vistos = new Map();
  const faltan = [];
  // Una carpeta raíz de un pack que se llama como la raíz de la Aventura
  // («El Expediente Ward» de cronica) no se anida dentro de ella: se funde. Si no,
  // «El Expediente Ward/El Expediente Ward/Vástagos/Brujah» se come un nivel de los
  // cuatro que permite Foundry (CONST.FOLDER_MAX_DEPTH, common/constants.mjs).
  const fundidas = new Map();
  const padreDe = (folder, tipo) => (folder ? fundidas.get(folder) ?? folder : raiz(tipo)._id);

  for (const { pack, campo, tipo } of FUENTES) {
    const docs = leerPack(pack);
    if (!docs?.length) { faltan.push(pack); continue; }
    const esCarpeta = d => d._key?.startsWith("!folders!");
    const carpetas = docs.filter(esCarpeta);
    for (const c of carpetas) {
      if (!c.folder && c.name === RAIZ_CARPETAS && c.type === tipo) fundidas.set(c._id, raiz(tipo)._id);
    }
    for (const c of carpetas) {
      if (c.type !== tipo) ctx.avisos.push(`aventura: carpeta «${c.name}» de ${pack} es de tipo ${c.type}, no ${tipo}`);
      if (fundidas.has(c._id)) continue;
      folders.push(sinClaves({ ...c, folder: padreDe(c.folder, tipo) }));
    }
    for (const d of docs.filter(d => !esCarpeta(d))) {
      const clave = `${tipo}.${d._id}`;
      if (vistos.has(clave)) { ctx.avisos.push(`aventura: _id repetido ${clave} (${pack} y ${vistos.get(clave)}); se queda el primero`); continue; }
      vistos.set(clave, pack);
      contenido[campo].push(sinClaves({ ...d, folder: padreDe(d.folder, tipo) }));
    }
  }
  if (!faltan.includes("cronica") && ![...fundidas.values()].includes(raices.JournalEntry?._id)) {
    ctx.avisos.push(`aventura: ninguna carpeta raíz de cronica se llama «${RAIZ_CARPETAS}»: no se fundió con la raíz (¿cambió NOMBRE_CARPETA en journals.mjs?)`);
  }
  if (faltan.length) ctx.avisos.push(`aventura: todavía no hay nada en packs-src/{${faltan.join(",")}}; se saltea (volvé a correr el build cuando estén)`);
  folders.unshift(...Object.values(raices));

  // Carpetas hermanas con el mismo nombre (dos packs que traen «Lugares» en la raíz):
  // se avisa; fundirlas cambiaría lo que el Narrador ve en el compendio.
  const hermanas = new Map();
  for (const f of folders) {
    const k = `${f.type}|${f.folder ?? ""}|${f.name}`;
    if (hermanas.has(k)) ctx.avisos.push(`aventura: dos carpetas «${f.name}» (${f.type}) en el mismo nivel`);
    hermanas.set(k, f._id);
  }
  // Profundidad: Foundry no deja crear más de CONST.FOLDER_MAX_DEPTH (4) niveles.
  const porId = new Map(folders.map(f => [f._id, f]));
  for (const f of folders) {
    let n = 1;
    for (let p = f.folder; p && porId.has(p); p = porId.get(p).folder) n++;
    if (n > 4) ctx.avisos.push(`aventura: la carpeta «${f.name}» queda a ${n} niveles (máximo 4)`);
  }

  // Carpetas colgando de una que no está (un pack que escribió hijos sin padre).
  const idsCarpeta = new Set(folders.map(f => f._id));
  for (const f of folders) {
    if (f.folder && !idsCarpeta.has(f.folder)) {
      ctx.avisos.push(`aventura: la carpeta «${f.name}» cuelga de ${f.folder}, que no existe; va a la raíz`);
      f.folder = raiz(f.type)._id;
    }
  }

  const { actors, journal, scenes, items, macros, playlists } = contenido;
  const portada = ["assets/portadas/portada.webp", "assets/mapas/portada.webp", "assets/mapas/helen.webp"]
    .find(rel => fs.existsSync(path.join(RAIZ, rel)));
  if (!portada || !portada.includes("portada")) ctx.avisos.push(`aventura: sin arte de portada; uso ${portada ?? "un icono del core"}`);
  const img = portada ? `modules/${MODULO}/${portada}` : "icons/svg/city.svg";

  const n = (k, uno, varios) => `<strong>${k.length} ${k.length === 1 ? uno : varios}</strong>`;
  escribirDoc(PACK, {
    _id: aid,
    _key: `!adventures!${aid}`,
    name: NOMBRE,
    img,
    caption: "<p>Seattle, noviembre de 2026. La crónica completa, lista para dirigir.</p>",
    description:
      `<p>Importa al mundo ${n(scenes, "escena", "escenas")}, ${n(actors, "actor", "actores")} (PJs, PNJs y la Célula Puget), ` +
      `${n(journal, "journal", "journals")} (la aventura, la ciudad, los personajes y los documentos para entregar), ` +
      `${n(items, "ítem", "ítems")} de FIRSTLIGHT, ${n(macros, "macro", "macros")} y ` +
      `${n(playlists, "lista", "listas")} de música (cada escena suena con su ambiente al activarla), con sus carpetas.</p>` +
      "<p>Reimportar actualiza los documentos existentes sin duplicarlos.</p>" +
      AVISO_DARK_PACK,
    actors, journal, scenes, items, macros, playlists, folders,
    tables: [], cards: [], combats: [],
    folder: null, sort: 0,
    flags: { [MODULO]: { origen: "aventura", aventura: CLAVE } },
    _stats: STATS
  });

  // El quickstart de module.json (clave = id del SISTEMA, así lo busca el
  // servidor) tiene que apuntar a este id. Sólo se comprueba: el manifiesto no
  // se reescribe desde el build.
  const manifiesto = JSON.parse(fs.readFileSync(path.join(RAIZ, "module.json"), "utf8"));
  const esperado = `Compendium.${MODULO}.${PACK}.Adventure.${aid}`;
  if (manifiesto.quickstart?.adventures?.[STATS.systemId]?.uuid !== esperado) {
    ctx.avisos.push(`aventura: module.json quickstart.adventures.${STATS.systemId}.uuid debería ser ${esperado}`);
  }

  console.log(`aventura: ${scenes.length} escenas, ${actors.length} actores, ${journal.length} journals, ` +
    `${items.length} ítems, ${macros.length} macros, ${playlists.length} playlists, ${folders.length} carpetas`);
}

/**
 * Todo lo generado → pack `aventura` (un Adventure). Va ÚLTIMO.
 *
 * Lee lo que escribieron los otros constructores en packs-src/ (cronica,
 * documentos, personajes, escenas, macros, firstlight) y lo empaqueta con sus
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
const NOMBRE = "Seattle by Night — El Expediente Ward";
const RAIZ_CARPETAS = "Seattle by Night";

/** Pack de packs-src → campo del Adventure y tipo de documento. */
const FUENTES = [
  { pack: "cronica", campo: "journal", tipo: "JournalEntry" },
  { pack: "documentos", campo: "journal", tipo: "JournalEntry" },
  { pack: "personajes", campo: "actors", tipo: "Actor" },
  { pack: "escenas", campo: "scenes", tipo: "Scene" },
  { pack: "firstlight", campo: "items", tipo: "Item" },
  { pack: "macros", campo: "macros", tipo: "Macro" }
];

const AVISO_DARK_PACK = "<p>Material no oficial de World of Darkness, publicado bajo el Dark Pack. Partes de estos " +
  "materiales son copyright y marcas registradas de Paradox Interactive AB, y se usan con permiso. Todos los " +
  "derechos reservados. Más información en worldofdarkness.com.</p>";

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
  const contenido = { actors: [], journal: [], scenes: [], items: [], macros: [] };
  const folders = [];
  const raices = {};
  const raiz = tipo => (raices[tipo] ??= {
    _id: idEstable(`aventura:raiz:${tipo}`), name: RAIZ_CARPETAS, type: tipo, folder: null,
    sorting: "m", sort: 0, color: "#1f3a4d", flags: { [MODULO]: { origen: "carpeta" } }, _stats: STATS
  });
  const vistos = new Map();
  const faltan = [];

  for (const { pack, campo, tipo } of FUENTES) {
    const docs = leerPack(pack);
    if (!docs?.length) { faltan.push(pack); continue; }
    const esCarpeta = d => d._key?.startsWith("!folders!");
    for (const c of docs.filter(esCarpeta)) {
      if (c.type !== tipo) ctx.avisos.push(`aventura: carpeta «${c.name}» de ${pack} es de tipo ${c.type}, no ${tipo}`);
      folders.push(sinClaves({ ...c, folder: c.folder ?? raiz(tipo)._id }));
    }
    for (const d of docs.filter(d => !esCarpeta(d))) {
      const clave = `${tipo}.${d._id}`;
      if (vistos.has(clave)) { ctx.avisos.push(`aventura: _id repetido ${clave} (${pack} y ${vistos.get(clave)}); se queda el primero`); continue; }
      vistos.set(clave, pack);
      contenido[campo].push(sinClaves({ ...d, folder: d.folder ?? raiz(tipo)._id }));
    }
  }
  if (faltan.length) ctx.avisos.push(`aventura: todavía no hay nada en packs-src/{${faltan.join(",")}}; se saltea (volvé a correr el build cuando estén)`);
  folders.unshift(...Object.values(raices));

  // Carpetas colgando de una que no está (un pack que escribió hijos sin padre).
  const idsCarpeta = new Set(folders.map(f => f._id));
  for (const f of folders) {
    if (f.folder && !idsCarpeta.has(f.folder)) {
      ctx.avisos.push(`aventura: la carpeta «${f.name}» cuelga de ${f.folder}, que no existe; va a la raíz`);
      f.folder = raiz(f.type)._id;
    }
  }

  const { actors, journal, scenes, items, macros } = contenido;
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
      `${n(items, "ítem", "ítems")} de FIRSTLIGHT y ${n(macros, "macro", "macros")}, con sus carpetas.</p>` +
      "<p>Reimportar actualiza los documentos existentes sin duplicarlos.</p>" +
      AVISO_DARK_PACK,
    actors, journal, scenes, items, macros, folders,
    playlists: [], tables: [], cards: [], combats: [],
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
    `${items.length} ítems, ${macros.length} macros, ${folders.length} carpetas`);
}

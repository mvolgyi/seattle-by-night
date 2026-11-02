/**
 * Núcleo compartido del build: ids estables, paginación y el registro de IDs
 * del libro (PNJ-12, LUG-05, A1-E01…) → documento de Foundry.
 *
 * Todos los constructores (journals, actores, escenas, aventura) usan estas
 * funciones. Si un constructor necesita un id, lo pide acá: así un @ID[...]
 * escrito en un journal apunta al mismo _id que después escribe el
 * constructor de actores, aunque corran en cualquier orden.
 *
 * Convención de enlaces: los journals enlazan a documentos del MUNDO
 * (JournalEntry.<id>…, Actor.<id>, Scene.<id>), no al compendio. La Aventura
 * importa conservando los _id, así que el enlace queda vivo en la mesa.
 */
import fs from "node:fs";
import path from "node:path";
import { RAIZ, idEstable, slug, archivosMd } from "../util.mjs";
import { EN, es, leerContenido, leerMd, emparejarPaginas, copia } from "./idioma.mjs";

/* -------------------------------------------- */
/*  Compendios                                  */
/* -------------------------------------------- */

/** Nombre corto → tipo de documento. El orden es el de module.json. */
export const PACKS = {
  aventura: "Adventure",
  cronica: "JournalEntry",
  documentos: "JournalEntry",
  personajes: "Actor",
  escenas: "Scene",
  firstlight: "Item",
  macros: "Macro",
  playlists: "Playlist"
};

/** Qué carpeta de content/ va a qué compendio de journals. */
export const JOURNALS_POR_PACK = {
  cronica: ["cronica", "ciudad", "personajes"],
  documentos: ["documentos"]
};

/* -------------------------------------------- */
/*  Ids estables                                */
/* -------------------------------------------- */

/**
 * Semillas de idEstable. Cambiar una semilla cambia el _id y rompe los
 * enlaces de un mundo ya importado: no se tocan.
 */
export const ID = {
  journal: id => idEstable(`journal:${id}`),
  /** Página: por su ancla {#X} si la tiene; si no, por su título. Nunca por índice. */
  pagina: (journalId, clave) => idEstable(`pagina:${journalId}:${clave}`),
  actor: id => idEstable(`actor:${id}`),
  item: id => idEstable(`item:${id}`),
  /** Ítem embebido en un actor (poder, ventaja, arma…). */
  itemDe: (actorId, clave) => idEstable(`item:${actorId}:${clave}`),
  escena: id => idEstable(`escena:${id}`),
  macro: id => idEstable(`macro:${id}`),
  /** Lista de música (content/musica.json) y su pista: mismas semillas que DVV. */
  lista: id => idEstable(`playlist:${id}`),
  pista: (lista, id) => idEstable(`pista:${lista}:${id}`),
  aventura: id => idEstable(`aventura:${id}`)
};

/* -------------------------------------------- */
/*  Títulos de página y paginación              */
/* -------------------------------------------- */

/**
 * «Título {jugadores} {#A1-E01}» → { nombre, ancla, visibilidad }.
 * Las marcas pueden venir en cualquier orden.
 */
export function parsearTitulo(linea) {
  let resto = linea.trim();
  let ancla = null;
  let visibilidad = null;
  for (;;) {
    const m = /\s*\{(#[^}]+|jugadores|narrador)\}\s*$/.exec(resto);
    if (!m) break;
    const marca = m[1];
    if (marca.startsWith("#")) ancla = marca.slice(1).trim();
    else visibilidad = marca;
    resto = resto.slice(0, m.index).trimEnd();
  }
  return { nombre: resto, ancla, visibilidad };
}

/**
 * Parte un cuerpo Markdown en páginas: una por `## `; lo anterior al primero
 * es la introducción (lleva el `# ` del journal, que se descarta). Ignora
 * los `## ` dentro de bloques de código.
 */
export function paginar(cuerpo) {
  const paginas = [];
  let actual = { titulo: null, nombre: null, ancla: null, visibilidad: null, md: [] };
  let enCodigo = false;
  for (const linea of cuerpo.split("\n")) {
    if (/^```/.test(linea)) enCodigo = !enCodigo;
    const h2 = !enCodigo && /^## (.+)$/.exec(linea);
    if (h2) {
      paginas.push(actual);
      const t = parsearTitulo(h2[1]);
      actual = { titulo: h2[1], ...t, md: [] };
      continue;
    }
    if (!enCodigo && /^# /.test(linea) && actual.titulo === null) continue;
    actual.md.push(linea);
  }
  paginas.push(actual);
  return paginas
    .map(p => ({ ...p, md: p.md.join("\n").trim() }))
    .filter((p, i) => i > 0 || p.md);
}

/**
 * Clave estable de una página dentro de su journal. En inglés la trae la
 * página (`clave`, la del castellano: idioma.mjs#emparejarPaginas), así el
 * título traducido no cambia el _id.
 */
export const clavePagina = p => p.clave ?? p.ancla ?? (p.nombre ? `t:${slug(p.nombre)}` : "intro");

/* -------------------------------------------- */
/*  Lectura de content/                         */
/* -------------------------------------------- */

const leer = rel => leerContenido(rel);
const existe = rel => fs.existsSync(path.join(RAIZ, rel));

/**
 * Todos los journals de content/ con su pack, metadatos y páginas. En inglés,
 * cada uno trae además `es`: el mismo journal en castellano (las páginas
 * inglesas llevan la clave, el ancla y la visibilidad de las castellanas).
 * Mismos objetos en cada llamada.
 */
let JOURNALS = null;
export function journals() {
  if (JOURNALS) return JOURNALS;
  const out = [];
  for (const [pack, carpetas] of Object.entries(JOURNALS_POR_PACK)) {
    for (const carpeta of carpetas) {
      for (const archivo of archivosMd(path.join(RAIZ, "content", carpeta))) {
        const rel = path.relative(RAIZ, archivo);
        const leido = leerMd(archivo);
        const { meta, cuerpo } = leido;
        const id = meta.id ?? slug(path.basename(archivo, ".md"));
        if (!EN) { out.push({ pack, rel, id, meta, cuerpo, paginas: paginar(cuerpo) }); continue; }
        const jes = { pack, rel, id, meta: leido.es.meta, cuerpo: leido.es.cuerpo, paginas: paginar(leido.es.cuerpo) };
        const pares = leido.traducido ? emparejarPaginas(rel, jes.paginas, paginar(cuerpo), clavePagina) : null;
        const j = pares && !pares.includes(null)
          ? { pack, rel, id, meta, cuerpo, paginas: pares, es: jes }
          : { pack, rel, id, meta: jes.meta, cuerpo: jes.cuerpo, paginas: jes.paginas, es: jes };
        out.push(j);
      }
    }
  }
  JOURNALS = out;
  return out;
}

/** El journal castellano de uno de journals() (el mismo en castellano). */
export const journalEs = j => j?.es ?? j;

/** Fichas con estadísticas (las que se vuelven actores). */
export function fichas() {
  const out = [];
  const dir = path.join(RAIZ, "content/pnjs");
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (!f.endsWith(".json") || f === "combate.json") continue;
    const d = leer(`content/pnjs/${f}`);
    for (const p of d.pnjs ?? []) out.push(copia(p, { _origen: `pnjs/${f}`, _clase: "ficha" }));
    for (const p of d.menores ?? []) out.push(copia(p, { _origen: `pnjs/${f}`, _clase: "menor" }));
  }
  if (existe("content/pjs.json")) {
    for (const p of leer("content/pjs.json").pjs ?? []) out.push(copia(p, { pj: true, _origen: "pjs.json", _clase: "ficha" }));
  }
  // Una ficha con `reemplaza: true` gana sobre las demás con el mismo id
  // (la versión de cazador de Okafor reemplaza a la de mortal sin borrarla).
  const ganadoras = new Set(out.filter(f => f.reemplaza).map(f => f.id));
  return out.filter(f => f.reemplaza || !ganadoras.has(f.id));
}

/**
 * Los planos de content/planos (como cargarPlanos de tools/construir-planos.mjs),
 * fundidos con content/en/planos en inglés: misma geometría, nombres y notas
 * del idioma. Lo que decide algo por texto (la sala de un pin) usa es().
 */
export function planos() {
  const dir = path.join(RAIZ, "content/planos");
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(f => f.endsWith(".json")).sort()
    .flatMap(f => leer(`content/planos/${f}`).planos ?? []);
}

/**
 * ¿La ficha se vuelve actor? Las de trasfondo sin estadísticas (Vance) son
 * sólo página de journal.
 */
export const tieneActor = f =>
  f._clase === "menor" || !!(f.atributos || f.estandar || f.habilidades || f.excepcionales || f.salud || f.pj);

/* -------------------------------------------- */
/*  Registro de IDs                             */
/* -------------------------------------------- */

/**
 * Mapa ID del libro → { uuid, nombre, tipo, pack }.
 *
 * Prioridad cuando un ID existe en varios lados (PNJ-12 es página Y actor):
 * página de journal > journal > actor > escena. El Narrador quiere el perfil;
 * la página del perfil enlaza a su vez al actor (con `actor`).
 */
export function registro() {
  const reg = new Map();
  const poner = (clave, valor) => { if (!reg.has(clave)) reg.set(clave, valor); };
  // En inglés, el nombre castellano al lado (datos.mjs lee apellidos en la prosa castellana).
  const conEs = (valor, nombreEs) => (EN ? { ...valor, nombreEs } : valor);
  const actores = new Map();

  for (const f of fichas().filter(tieneActor)) {
    actores.set(f.id, conEs({ uuid: `Actor.${ID.actor(f.id)}`, nombre: f.nombre, tipo: "actor", pack: "personajes" }, es(f).nombre));
  }

  for (const j of journals()) {
    const jid = ID.journal(j.id);
    for (const p of j.paginas) {
      if (!p.ancla) continue;
      poner(p.ancla, conEs({
        uuid: `JournalEntry.${jid}.JournalEntryPage.${ID.pagina(jid, clavePagina(p))}`,
        nombre: p.nombre, tipo: "pagina", pack: j.pack
      }, es(p).nombre));
    }
  }
  for (const j of journals()) {
    poner(j.id, conEs({ uuid: `JournalEntry.${ID.journal(j.id)}`, nombre: j.meta.nombre ?? j.id, tipo: "journal", pack: j.pack }, journalEs(j).meta.nombre ?? j.id));
  }
  for (const [k, v] of actores) poner(k, v);

  // Pistas: el constructor de journals genera un journal «Pistas» con una página por pista.
  if (existe("content/pistas.json")) {
    const jid = ID.journal("PISTAS");
    for (const p of leer("content/pistas.json").pistas ?? []) {
      poner(p.id, { uuid: `JournalEntry.${jid}.JournalEntryPage.${ID.pagina(jid, p.id)}`, nombre: p.nombre, tipo: "pagina", pack: "cronica" });
    }
  }

  // Escenas desde planos: por id de plano y como `ESCENA:<LUG>`.
  const dirPlanos = path.join(RAIZ, "content/planos");
  for (const f of fs.existsSync(dirPlanos) ? fs.readdirSync(dirPlanos).sort() : []) {
    if (!f.endsWith(".json")) continue;
    const d = leer(`content/planos/${f}`);
    for (const pl of d.planos ?? [d]) {
      if (!pl.id) continue;
      const v = { uuid: `Scene.${ID.escena(pl.id)}`, nombre: pl.nombre ?? pl.id, tipo: "escena", pack: "escenas" };
      poner(`ESCENA:${pl.id}`, v);
      if (pl.lugar) poner(`ESCENA:${pl.lugar}`, v);
    }
  }

  // Ítems de FIRSTLIGHT.
  if (existe("content/firstlight.json")) {
    for (const it of leer("content/firstlight.json").equipo ?? []) {
      poner(it.id, { uuid: `Item.${ID.item(it.id)}`, nombre: it.nombre, tipo: "item", pack: "firstlight" });
    }
  }

  // Alias: IDs del libro que no son una entidad propia sino parte de otra.
  for (const [alias, destino] of Object.entries(ALIAS)) {
    if (!reg.has(alias) && reg.has(destino)) reg.set(alias, reg.get(destino));
  }

  return { reg, actores };
}

/** MAP-00 es el mapa regional del doc 15: se entrega como la ayuda AYU-01. */
const ALIAS = { "MAP-00": "AYU-01" };

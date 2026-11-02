/**
 * Idioma del build: content/ (castellano, la fuente) o content/en/ fundido
 * encima (inglés). TRADUCCION.md, «Cómo funciona en Foundry» y «Formato de
 * content/en/».
 *
 * El build corre una vez por idioma (tools/construir-contenido.mjs lanza el
 * inglés como un proceso aparte con SBN_IDIOMA=en): los constructores leen
 * content/ en el nivel de módulo y así no hay que reescribirlos para dos
 * pasadas. En castellano todo lo de acá es la identidad: mismos archivos,
 * mismos objetos, mismas cadenas, y packs-src/<pack> queda byte a byte igual.
 *
 * En inglés:
 *   - los packs van a packs-src/<pack>-en (packDe) y los datos a data/en/;
 *   - un .md lee nombre/nota del frontmatter y el cuerpo de content/en/<ruta>;
 *     el resto del frontmatter y la ESTRUCTURA (anclas, visibilidad y clave de
 *     cada página) salen del castellano, emparejando las páginas por posición;
 *   - un .json se funde con su overlay (fundir de tools/traduccion/campos.mjs,
 *     o uno propio que sólo cambia cadenas si campos.mjs todavía no está);
 *   - lo que falta cae al castellano y se cuenta (aviso, no error).
 *
 * Todo lo que deriva un _id, una semilla o una decisión de un TEXTO (títulos de
 * página, nombres de rasgos, motivos del Termómetro, regex sobre la prosa) usa
 * `es(x)`: el objeto castellano del que salió `x`. En castellano, `es(x) === x`.
 */
import fs from "node:fs";
import path from "node:path";
import { RAIZ, separarFrontmatter } from "../util.mjs";

export const IDIOMAS = ["es", "en"];
export const IDIOMA = process.env.SBN_IDIOMA === "en" ? "en" : "es";
export const EN = IDIOMA === "en";

/** Sufijo de los packs y carpeta de los datos de cada idioma. */
export const SUFIJO = EN ? "-en" : "";
export const packDe = pack => `${pack}${SUFIJO}`;
export const dataDe = rel => (EN ? rel.replace(/^data\//, "data/en/") : rel);

/** content/en/ (con SBN_CONTENT_EN se prueba con otra carpeta sin tocar la del repo). */
export const DIR_EN = process.env.SBN_CONTENT_EN ? path.resolve(process.env.SBN_CONTENT_EN) : path.join(RAIZ, "content/en");

/** «content/pnjs/camarilla.json» → ruta absoluta del overlay en content/en/. */
export const rutaEn = rel => path.join(DIR_EN, rel.replace(/^content\//, ""));

/* -------------------------------------------- */
/*  El original castellano de cada objeto       */
/* -------------------------------------------- */

const ORIGINAL = new WeakMap();

/** El objeto castellano del que salió `x` (el mismo `x` en castellano o si no se fundió). */
export const es = x => (x && typeof x === "object" ? ORIGINAL.get(x) ?? x : x);

/** Recorre los dos en paralelo (misma forma) y anota cada objeto fundido con su original. */
function vincular(fundido, original) {
  if (!fundido || typeof fundido !== "object" || !original || typeof original !== "object") return;
  if (fundido === original) return;
  ORIGINAL.set(fundido, original);
  if (Array.isArray(fundido)) {
    if (!Array.isArray(original)) return;
    // Por id si las entradas lo tienen (como funde campos.mjs); si no, por posición.
    const porId = new Map(original.filter(o => o && typeof o === "object" && o.id != null).map(o => [o.id, o]));
    fundido.forEach((v, i) => vincular(v, v?.id != null && porId.has(v.id) ? porId.get(v.id) : original[i]));
    return;
  }
  for (const [k, v] of Object.entries(fundido)) vincular(v, original[k]);
}

/** Copia de un objeto (`{ ...f, extra }`) que conserva el vínculo con su original. */
export function copia(original, extra = {}) {
  const c = { ...original, ...extra };
  if (EN) ORIGINAL.set(c, es(original));
  return c;
}

/* -------------------------------------------- */
/*  Faltantes                                   */
/* -------------------------------------------- */

/** Lo que cayó al castellano en esta pasada: { md: Set, json: Set, entidades: Set, paginas: Set }. */
export const faltan = { md: new Set(), json: new Set(), entidades: new Set(), estructura: new Set() };
const vistos = { md: new Set(), json: new Set() };

/** Resumen para el aviso del build (vacío en castellano). */
export function resumenFaltantes() {
  if (!EN) return null;
  const n = k => faltan[k].size;
  return {
    md: `${n("md")} de ${vistos.md.size}`,
    json: `${n("json")} de ${vistos.json.size}`,
    entidades: n("entidades"),
    estructura: [...faltan.estructura]
  };
}

/* -------------------------------------------- */
/*  JSON                                        */
/* -------------------------------------------- */

/**
 * Fusión propia, por si tools/traduccion/campos.mjs todavía no existe: sólo
 * reemplaza CADENAS del castellano por las del overlay en la misma posición
 * (entradas de lista por `id` o por índice). Nunca cambia números, claves,
 * ni agrega o quita entradas: el overlay no puede romper la estructura.
 */
function fundirCadenas(base, over) {
  if (over === undefined || over === null) return base;
  if (typeof base === "string") return typeof over === "string" && over.trim() ? over : base;
  if (Array.isArray(base)) {
    if (!Array.isArray(over)) return base;
    const porId = new Map(over.filter(o => o && typeof o === "object" && o.id != null).map(o => [o.id, o]));
    return base.map((v, i) => fundirCadenas(v, v && typeof v === "object" && v.id != null ? porId.get(v.id) : over[i]));
  }
  if (base && typeof base === "object") {
    if (!over || typeof over !== "object" || Array.isArray(over)) return base;
    const out = {};
    for (const [k, v] of Object.entries(base)) out[k] = fundirCadenas(v, over[k]);
    return out;
  }
  return base;
}

let CAMPOS = undefined;
/** tools/traduccion/campos.mjs si existe (la tabla única de campos traducibles). */
async function campos() {
  if (CAMPOS !== undefined) return CAMPOS;
  const ruta = path.join(RAIZ, "tools/traduccion/campos.mjs");
  CAMPOS = fs.existsSync(ruta) ? await import(ruta).catch(err => {
    console.warn(`(no pude cargar tools/traduccion/campos.mjs: ${err.message}; uso la fusión propia)`);
    return null;
  }) : null;
  return CAMPOS;
}
// Top-level await: los constructores leen content/ al importarse.
const C = EN ? await campos() : null;

const cacheJson = new Map();

/**
 * content/<rel>.json, fundido con content/en/<rel>.json en inglés. Mismo
 * objeto en cada llamada (como el cache de musica.mjs): `es()` lo reconoce.
 */
export function leerContenido(rel) {
  if (cacheJson.has(rel)) return cacheJson.get(rel);
  const original = JSON.parse(fs.readFileSync(path.join(RAIZ, rel), "utf8"));
  let out = original;
  // Sólo cuenta lo que tiene algo que traducir (campos.mjs#reglaDe): arte-doc15.json no.
  const traducible = !C?.reglaDe || !!C.reglaDe(rel);
  if (EN && traducible) {
    vistos.json.add(rel);
    const over = rutaEn(rel);
    if (!fs.existsSync(over)) faltan.json.add(rel);
    else {
      const overlay = JSON.parse(fs.readFileSync(over, "utf8"));
      // campos.mjs#fundir(json, overlay) clona y sólo cambia cadenas por cadenas.
      out = C?.fundir ? C.fundir(original, overlay) : fundirCadenas(original, overlay);
      if (!out || typeof out !== "object") out = fundirCadenas(original, overlay);
      vincular(out, original);
      // Entidades con texto (campos.mjs#extraer) que el overlay no trae: van en castellano.
      if (C?.extraer) {
        const conHuella = overlay._fuente ?? {};
        for (const clave of Object.keys(C.extraer(rel, original))) if (!(clave in conHuella)) faltan.entidades.add(`${rel}#${clave}`);
      }
    }
  }
  cacheJson.set(rel, out);
  return out;
}

/* -------------------------------------------- */
/*  Markdown                                    */
/* -------------------------------------------- */

/** Campos del frontmatter que se traducen; el resto se hereda del castellano. */
export const META_TRADUCIBLE = ["nombre", "nota"];

/**
 * Un .md de content/ → { meta, cuerpo, es? }. En inglés, `meta` es el del
 * castellano con nombre/nota del inglés, y `cuerpo` el del inglés; `es` trae
 * el castellano entero (para emparejar páginas). Sin archivo en content/en/,
 * el castellano tal cual.
 */
export function leerMd(abs) {
  const texto = fs.readFileSync(abs, "utf8");
  const original = separarFrontmatter(texto);
  if (!EN) return original;
  const rel = path.relative(RAIZ, abs);
  vistos.md.add(rel);
  const over = rutaEn(rel);
  if (!fs.existsSync(over)) { faltan.md.add(rel); return { ...original, es: original }; }
  const t = separarFrontmatter(fs.readFileSync(over, "utf8"));
  const meta = { ...original.meta };
  for (const k of META_TRADUCIBLE) if (t.meta[k]) meta[k] = t.meta[k];
  return { meta, cuerpo: t.cuerpo, es: original, traducido: true };
}

/**
 * Empareja las páginas del inglés con las del castellano por posición. La
 * clave, el ancla y la visibilidad son siempre las del castellano (de ellas
 * salen los _id de páginas, secretos y notas). Si no coinciden en cantidad, el
 * journal entero va en castellano y se avisa: un _id que cambia rompe enlaces.
 */
export function emparejarPaginas(rel, paginasEs, paginasEn, clavePagina) {
  if (paginasEn.length !== paginasEs.length) {
    faltan.estructura.add(`${rel}: ${paginasEn.length} páginas en inglés y ${paginasEs.length} en castellano (va en castellano)`);
    faltan.md.add(rel);
    return null;
  }
  return paginasEn.map((p, i) => {
    const pe = paginasEs[i];
    const out = { ...p, ancla: pe.ancla, visibilidad: pe.visibilidad, clave: clavePagina(pe) };
    // Una página sin título (la introducción) tiene que seguir siéndolo.
    if ((p.titulo === null) !== (pe.titulo === null)) {
      faltan.estructura.add(`${rel}: la página ${i + 1} es introducción en un idioma y no en el otro (va en castellano)`);
      return null;
    }
    ORIGINAL.set(out, pe);
    return out;
  });
}

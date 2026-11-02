#!/usr/bin/env node
/**
 * Verifica content/en/ contra content/ y los packs en inglés contra los
 * castellanos (TRADUCCION.md, «Herramientas» y fases 4–5).
 *
 * Errores (salida 1): lo que rompe la mesa o los _id.
 *   - .md: marcadores (@ID, @tirada, @termometro, @pista, @reloj), bloques `:::`,
 *     cantidad y orden de páginas `## ` con sus {#ID} y {jugadores}/{narrador}
 *     (tools/traduccion/validar.mjs, el mismo control que tools/traducir.mjs);
 *     frontmatter sin `nombre`; archivo en content/en/ sin su castellano.
 *   - .json: overlay ilegible, entidad que no existe en el castellano, forma de los
 *     campos distinta (campos.mjs#compararForma) y marcadores de cada texto.
 *   - packs-src/<pack>-en contra packs-src/<pack>: los mismos documentos con los
 *     mismos _id a cualquier profundidad (páginas, ítems, tokens, notas, muros…),
 *     los mismos secretos (`id="secret-…"`), páginas en el mismo orden y con la
 *     misma visibilidad; data/en/*.json con los mismos ids y números que data/.
 * Avisos (salida 0, salvo --estricto):
 *   - faltantes (unidades sin traducir: van en castellano) y desactualizadas (la
 *     huella `fuente`/`_fuente` no es la del castellano actual);
 *   - castellano suelto (heurística: palabras frecuentes, ¿¡, tildes y eñes fuera
 *     de los nombres propios);
 *   - términos del glosario (tools/traduccion/glosario.json) que el castellano usa
 *     y el inglés no;
 *   - IDs sueltos en la prosa y filas de tabla distintas (validar.mjs).
 *
 * Los packs se comparan como estén: corré `npm run contenido` antes.
 *
 * Uso: node tools/contenido/verificar-traduccion.mjs [--estricto] [--detalle] [--solo <prefijo de ruta>]
 *   --estricto  faltantes y desactualizadas también son error (fase 4 en adelante)
 *   --detalle   lista cada aviso (si no, los primeros de cada tipo)
 */
import fs from "node:fs";
import path from "node:path";
import { RAIZ, archivosMd, separarFrontmatter } from "../util.mjs";
import { PACKS } from "./ids.mjs";

const args = process.argv.slice(2);
const ESTRICTO = args.includes("--estricto");
const DETALLE = args.includes("--detalle");
const iSolo = args.indexOf("--solo");
const SOLO = iSolo >= 0 ? args[iSolo + 1] : null;

const CONTENT = path.join(RAIZ, "content");
const EN = process.env.SBN_CONTENT_EN ? path.resolve(process.env.SBN_CONTENT_EN) : path.join(CONTENT, "en");
const rel = abs => path.relative(CONTENT, abs).split(path.sep).join("/");
const pasa = r => !SOLO || r.startsWith(SOLO);

const C = await import(path.join(RAIZ, "tools/traduccion/campos.mjs"));
const V = await import(path.join(RAIZ, "tools/traduccion/validar.mjs"));
const GLOSARIO = JSON.parse(fs.readFileSync(path.join(RAIZ, "tools/traduccion/glosario.json"), "utf8")).terminos ?? [];

/* -------------------------------------------- */
/*  Registro de resultados                      */
/* -------------------------------------------- */

const errores = [];
/** tipo → [mensaje] */
const avisos = new Map();
const aviso = (tipo, msg) => { if (!avisos.has(tipo)) avisos.set(tipo, []); avisos.get(tipo).push(msg); };
const cuenta = { md: 0, mdTraducidos: 0, json: 0, entidades: 0, entidadesTraducidas: 0 };

/* -------------------------------------------- */
/*  Castellano suelto                           */
/* -------------------------------------------- */

/** Palabras muy frecuentes en castellano que en inglés casi no aparecen. */
const PALABRAS_ES = new Set(["el", "los", "las", "que", "para", "con", "una", "del", "por", "pero", "está", "están",
  "también", "porque", "cuando", "entre", "sobre", "muy", "sus", "como", "más", "este", "esta", "eso", "esto",
  "hasta", "desde", "donde", "dónde", "qué", "quién", "nada", "todo", "todos", "ya", "le", "les", "lo", "se", "su", "y", "o", "en", "de", "la", "un", "es"]);
/** Las cortas que también son inglés (o sílabas de nombres) sólo cuentan acompañadas. */
const CORTAS = new Set(["y", "o", "en", "de", "la", "un", "es", "le", "lo", "se", "su", "ya"]);

/** Palabras con tilde que valen en inglés o son nombres propios de la crónica. */
const EXCEPCIONES = new Set(["café", "cafés", "cliché", "déjà", "naïve", "résumé", "façade", "fiancé", "fiancée", "née", "protégé", "protégée", "señor", "señora",
  "piñata", "jalapeño", "México", "Bogotá", "José", "Mónica", "Ramírez", "Rodríguez", "Martínez", "García", "Pérez", "Gómez", "Sánchez", "Hernández", "López"]);
// Los nombres de los personajes y los términos del glosario que quedan iguales.
for (const t of GLOSARIO) for (const w of String(t.en ?? "").match(/[\p{L}’'-]+/gu) ?? []) EXCEPCIONES.add(w);
for (const f of fs.readdirSync(path.join(CONTENT, "pnjs")).filter(f => f.endsWith(".json"))) {
  const d = JSON.parse(fs.readFileSync(path.join(CONTENT, "pnjs", f), "utf8"));
  for (const p of [...(d.pnjs ?? []), ...(d.menores ?? [])]) for (const w of String(p.nombre ?? "").match(/\p{Lu}[\p{L}’'-]+/gu) ?? []) EXCEPCIONES.add(w);
}
for (const p of JSON.parse(fs.readFileSync(path.join(CONTENT, "pjs.json"), "utf8")).pjs ?? []) {
  for (const w of String(p.nombre ?? "").match(/\p{Lu}[\p{L}’'-]+/gu) ?? []) EXCEPCIONES.add(w);
}

/** Texto sin marcadores, enlaces, IDs ni código: lo que se lee. */
const legible = t => String(t ?? "")
  .replace(/@\w+(?:\[[^\]]*\]|\{[^}]*\})/g, " ")
  .replace(/\{#[^}]+\}|\{(?:jugadores|narrador)\}/g, " ")
  .replace(/`[^`]*`/g, " ")
  .replace(/https?:\/\/\S+/g, " ")
  .replace(/^:::\S*.*$/gm, " ");

/**
 * ¿Suena a castellano? → motivo o null. `fuente`: el castellano de la misma
 * unidad; una palabra con tilde y mayúscula que está igual en la fuente es un
 * nombre propio que no se traduce (Tomás, Clémence).
 */
function castellano(texto, fuente = "") {
  const t = legible(texto);
  const frases = t.split(/(?<=[.!?:;])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 12);
  const malas = [];
  for (const f of frases) {
    if (/[¿¡]/.test(f)) { malas.push(f); continue; }
    const palabras = f.toLowerCase().match(/[\p{L}]+/gu) ?? [];
    if (palabras.length < 4) continue;
    const hits = palabras.filter(w => PALABRAS_ES.has(w));
    const largas = hits.filter(w => !CORTAS.has(w));
    if (largas.length >= 2 && hits.length / palabras.length > 0.18) malas.push(f);
  }
  const propio = w => /^\p{Lu}/u.test(w) && new RegExp(`(?<!\\p{L})${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\p{L})`, "u").test(fuente);
  const tildes = [...new Set((t.match(/[\p{L}’'-]*[áéíóúñÁÉÍÓÚÑ][\p{L}’'-]*/gu) ?? []).filter(w => !EXCEPCIONES.has(w) && !propio(w)))];
  if (!malas.length && !tildes.length) return null;
  return [
    malas.length ? `${malas.length} frase(s) como «${malas[0].slice(0, 70)}${malas[0].length > 70 ? "…" : ""}»` : "",
    tildes.length ? `tildes/eñes: ${tildes.slice(0, 6).join(", ")}${tildes.length > 6 ? "…" : ""}` : ""
  ].filter(Boolean).join("; ");
}

/* -------------------------------------------- */
/*  Glosario                                    */
/* -------------------------------------------- */

const limpiarTermino = s => s.replace(/\([^)]*\)/g, "").replace(/[«»“”"]/g, "").trim();
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Términos que se pueden controlar: nombres propios, apodos, lugares, coteries y objetos de la trama. */
const TERMINOS = GLOSARIO.flatMap(t => {
  const es = String(t.es ?? ""), en = String(t.en ?? "");
  if (/sin cambios|Nombre oficial/i.test(en) || /[:…,]/.test(es)) return [];
  const propio = /^\p{Lu}/u.test(es) || ["apodos", "coteries", "lugares", "objetos"].includes(t.categoria);
  if (!propio) return [];
  // Con un calificador entre paréntesis («Caza (dominio)»), la palabra suelta es ambigua: no se controla.
  if (/\(/.test(es)) return [];
  const formasEs = es.split(" / ").map(limpiarTermino).filter(s => s.length >= 4);
  const formasEn = en.split(" / ").map(s => limpiarTermino(s).replace(/^the\s+/i, "")).filter(Boolean);
  if (!formasEs.length || !formasEn.length) return [];
  // Si el término no cambia, no hay nada que controlar.
  if (formasEs.every(f => formasEn.some(g => g.toLowerCase() === f.toLowerCase()))) return [];
  return [{
    es: formasEs[0], en: formasEn[0],
    re: new RegExp(`(?<!\\p{L})(?:${formasEs.map(escRe).join("|")})(?!\\p{L})`, /^\p{Lu}/u.test(es) ? "u" : "iu"),
    enRe: formasEn.map(f => new RegExp(`(?<!\\p{L})${escRe(f)}`, "iu"))
  }];
});

function glosario(donde, es, en) {
  for (const t of TERMINOS) {
    if (!t.re.test(es)) continue;
    if (t.enRe.some(re => re.test(en))) continue;
    aviso("glosario", `${donde}: «${t.es}» → «${t.en}» no aparece en el inglés`);
  }
}

/* -------------------------------------------- */
/*  1. Markdown                                 */
/* -------------------------------------------- */

const mdEs = archivosMd(CONTENT).filter(p => !p.startsWith(EN + path.sep));
const relsEs = new Set(mdEs.map(rel));
for (const abs of mdEs) {
  const r = rel(abs);
  if (!pasa(r)) continue;
  cuenta.md++;
  const enAbs = path.join(EN, r);
  if (!fs.existsSync(enAbs)) { aviso("faltante", r); continue; }
  cuenta.mdTraducidos++;
  const textoEs = fs.readFileSync(abs, "utf8");
  const es = separarFrontmatter(textoEs);
  const en = separarFrontmatter(fs.readFileSync(enAbs, "utf8"));
  if (!en.meta.nombre) errores.push(`${r}: el frontmatter en inglés no tiene «nombre»`);
  if (es.meta.nota && !en.meta.nota) errores.push(`${r}: el castellano tiene «nota» y el inglés no`);
  const sobran = Object.keys(en.meta).filter(k => !["nombre", "nota", "fuente"].includes(k));
  if (sobran.length) aviso("frontmatter", `${r}: el inglés repite ${sobran.join(", ")} (se hereda del castellano y se ignora)`);
  if (!en.meta.fuente) aviso("desactualizado", `${r}: sin «fuente» (huella)`);
  else if (en.meta.fuente !== C.huella(textoEs)) aviso("desactualizado", `${r}: el castellano cambió desde la traducción`);

  const v = V.validarMarkdown(es.cuerpo, en.cuerpo);
  for (const e of v.errores) errores.push(`${r}: ${e}`);
  for (const a of v.avisos) aviso("marcadores", `${r}: ${a}`);
  for (const [campo, t, f] of [["nombre", en.meta.nombre, es.meta.nombre], ["nota", en.meta.nota, es.meta.nota], ["cuerpo", en.cuerpo, es.cuerpo]]) {
    if (!t) continue;
    const m = castellano(t, f ?? "");
    if (m) aviso("castellano", `${r} (${campo}): ${m}`);
  }
  if (en.meta.nota) for (const e of V.validarTexto(es.meta.nota ?? "", en.meta.nota, "nota").errores) errores.push(`${r}: ${e}`);
  glosario(r, [es.meta.nombre, es.meta.nota, es.cuerpo].join("\n"), [en.meta.nombre, en.meta.nota, en.cuerpo].join("\n"));
}
// content/en/*.md sin castellano: nadie los lee (y seguramente es un error de ruta).
for (const abs of archivosMd(EN)) {
  const r = path.relative(EN, abs).split(path.sep).join("/");
  if (!relsEs.has(r) && pasa(r)) errores.push(`content/en/${r}: no hay content/${r} (no lo lee nadie)`);
}

/* -------------------------------------------- */
/*  2. JSON                                     */
/* -------------------------------------------- */

function jsonEs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (p !== EN) jsonEs(p, out); } else if (e.name.endsWith(".json")) out.push(p);
  }
  return out.sort();
}

for (const abs of jsonEs(CONTENT)) {
  const r = rel(abs);
  if (!pasa(r) || !C.reglaDe(r)) continue;
  cuenta.json++;
  const json = JSON.parse(fs.readFileSync(abs, "utf8"));
  const campos = C.extraer(r, json);
  const huellas = C.huellas(r, json);
  cuenta.entidades += Object.keys(campos).length;
  const enAbs = path.join(EN, r);
  if (!fs.existsSync(enAbs)) {
    if (Object.keys(campos).length) aviso("faltante", `${r} (${Object.keys(campos).length} entidades)`);
    continue;
  }
  let overlay;
  try { overlay = JSON.parse(fs.readFileSync(enAbs, "utf8")); } catch (err) { errores.push(`content/en/${r}: JSON inválido (${err.message})`); continue; }
  const traducidas = C.entidadesDelOverlay(r, json, overlay);
  // Entidades del overlay que no existen en el castellano.
  const claves = new Set(C.entidades(r, json).map(e => e.clave));
  for (const [col, v] of Object.entries(overlay)) {
    if (col.startsWith("_")) continue;
    const regla = C.reglaDe(r).colecciones;
    if (regla["."]) { if (!claves.has(col)) errores.push(`content/en/${r}: «${col}» no está en el castellano`); continue; }
    if (!regla[col]) { errores.push(`content/en/${r}: la colección «${col}» no se traduce (campos.mjs)`); continue; }
    if (regla[col].tipo !== "unico") for (const k of Object.keys(v ?? {})) if (!claves.has(k)) errores.push(`content/en/${r}: ${col}.${k} no está en el castellano`);
  }
  const faltan = [];
  for (const [k, es] of Object.entries(campos)) {
    const en = traducidas[k];
    if (en === undefined) { faltan.push(k); continue; }
    cuenta.entidadesTraducidas++;
    const donde = `${r}#${k}`;
    if (overlay._fuente?.[k] !== huellas[k]) aviso("desactualizado", `${donde}: ${overlay._fuente?.[k] ? "el castellano cambió desde la traducción" : "sin huella en _fuente"}`);
    for (const e of C.compararForma(es, en)) errores.push(`${donde}: forma: ${e}`);
    const hojasEn = new Map(C.textos(en).map(t => [t.ruta, t.texto]));
    for (const t of C.textos(es)) {
      const tEn = hojasEn.get(t.ruta);
      if (typeof tEn !== "string") continue;
      const v = V.validarTexto(t.texto, tEn, `${donde}${t.ruta}`);
      for (const e of v.errores) errores.push(e);
      for (const a of v.avisos) aviso("marcadores", a);
      const m = castellano(tEn, t.texto);
      if (m) aviso("castellano", `${donde}${t.ruta}: ${m}`);
    }
    glosario(donde, C.textos(es).map(t => t.texto).join("\n"), [...hojasEn.values()].join("\n"));
  }
  if (faltan.length) aviso("faltante", `${r}: ${faltan.length} de ${Object.keys(campos).length} entidades (${faltan.slice(0, 5).join(", ")}${faltan.length > 5 ? "…" : ""})`);
}
if (!fs.existsSync(path.join(EN, "carpetas.json"))) aviso("faltante", "carpetas.json (nombres de carpetas: el build usa los suyos)");

/* -------------------------------------------- */
/*  3. Packs: mismos _id                        */
/* -------------------------------------------- */

/** Lo que identifica a un documento en el mundo: todos los _id con su ruta, secretos y páginas. */
function huellaIds(doc) {
  const ids = [];
  const ir = (v, ruta) => {
    if (Array.isArray(v)) { v.forEach(x => ir(x, `${ruta}[]`)); return; }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "_id" && typeof x === "string") ids.push(`${ruta}:${x}`);
        else if (k !== "_stats") ir(x, ruta ? `${ruta}.${k}` : k);
      }
      return;
    }
    if (typeof v === "string") for (const m of v.matchAll(/id="secret-([A-Za-z0-9]{16})"/g)) ids.push(`${ruta}#secreto:${m[1]}`);
  };
  ir(doc, "");
  return ids.sort();
}
/** [ruta, texto inglés legible, texto castellano en la misma ruta] de un documento (sin flags, código ni rutas). */
function textosVisibles(en, es) {
  const out = [];
  const html = s => String(s).replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  const ir = (a, b, ruta) => {
    if (Array.isArray(a)) { a.forEach((x, i) => ir(x, Array.isArray(b) ? b.find(y => y?._id && y._id === x?._id) ?? b[i] : undefined, `${ruta}[${x?.name ?? i}]`)); return; }
    if (a && typeof a === "object") {
      for (const [k, x] of Object.entries(a)) {
        if (["flags", "_stats", "command", "_key", "_id", "img", "src", "path", "texture", "sight", "light"].includes(k)) continue;
        ir(x, b?.[k], ruta ? `${ruta}.${k}` : k);
      }
      return;
    }
    if (typeof a !== "string" || a.length < 3 || /^(modules|icons|systems)\//.test(a) || /^[A-Za-z0-9]{16}$/.test(a)) return;
    out.push([ruta, html(a), typeof b === "string" ? html(b) : ""]);
  };
  ir(en, es, "");
  return out;
}
const paginasDe = d => (d.pages ?? []).map(p => `${p._id}:${p.sort}:${p.ownership?.default}:${p.title?.show}`).join("|");

let packsComparados = 0;
for (const pack of Object.keys(PACKS)) {
  const dirEs = path.join(RAIZ, "packs-src", pack), dirEn = path.join(RAIZ, "packs-src", `${pack}-en`);
  if (!fs.existsSync(dirEn)) { errores.push(`packs-src/${pack}-en no existe: corré npm run contenido`); continue; }
  const leer = dir => new Map(fs.readdirSync(dir).filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))).map(d => [d._key, d]));
  const es = leer(dirEs), en = leer(dirEn);
  for (const k of es.keys()) if (!en.has(k)) errores.push(`packs-src/${pack}-en: falta ${k} (${es.get(k).name})`);
  for (const k of en.keys()) if (!es.has(k)) errores.push(`packs-src/${pack}-en: sobra ${k} (${en.get(k).name})`);
  for (const [k, d] of es) {
    const e = en.get(k);
    if (!e) continue;
    const a = huellaIds(d), b = huellaIds(e);
    if (a.join() !== b.join()) {
      const sa = new Set(a), sb = new Set(b);
      const solo = [...a.filter(x => !sb.has(x)).map(x => `-${x}`), ...b.filter(x => !sa.has(x)).map(x => `+${x}`)];
      errores.push(`packs-src/${pack}-en: «${d.name}» (${k}): _id distintos: ${solo.slice(0, 4).join(" ")}${solo.length > 4 ? "…" : ""}`);
    }
    if (paginasDe(d) !== paginasDe(e)) errores.push(`packs-src/${pack}-en: «${d.name}»: páginas en otro orden o con otra visibilidad`);
    if (d.type !== e.type || d.folder !== e.folder) errores.push(`packs-src/${pack}-en: «${d.name}»: otro tipo o carpeta`);
    // Lo que se VE en Foundry (nombres, HTML de páginas, fichas, notas): castellano que quedó,
    // venga de content/en/ o de un texto fijo del build (tools/contenido/fijos.mjs).
    for (const [ruta, texto, fuente] of textosVisibles(e, d)) {
      const m = castellano(texto, fuente);
      if (m) aviso("castellanoPacks", `${pack}-en «${e.name}» ${ruta}: ${m}`);
    }
  }
  packsComparados++;
}

/* -------------------------------------------- */
/*  4. data/en                                  */
/* -------------------------------------------- */

/** Claves cuyo valor es un id, una referencia o un dato (no un texto): iguales en los dos idiomas. */
const NO_TEXTO = new Set(["id", "escena", "escenas", "pnj", "pj", "lugar", "documento", "gancho", "desenlace", "lor", "ayuda",
  "interludio", "pistas", "prueba", "uuid", "tipo", "fecha", "voto", "apoyos", "cambio", "icono", "a", "modulo", "rutas", "noche", "noches"]);
function compararDatos(a, b, ruta, out) {
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) { out.push(`${ruta}: ${Array.isArray(b) ? `${b.length} elementos en vez de ${a.length}` : "no es una lista"}`); return; }
    a.forEach((x, i) => compararDatos(x, b[i], `${ruta}[${i}]`, out));
    return;
  }
  if (a && typeof a === "object") {
    if (!b || typeof b !== "object") { out.push(`${ruta}: falta`); return; }
    const ka = Object.keys(a).filter(k => k !== "$generado"), kb = Object.keys(b).filter(k => k !== "$generado");
    if (ka.join() !== kb.join()) out.push(`${ruta}: claves distintas (${ka.filter(k => !kb.includes(k)).concat(kb.filter(k => !ka.includes(k))).join(", ")})`);
    for (const k of ka) if (k in b) compararDatos(a[k], b[k], `${ruta}.${k}`, out);
    return;
  }
  const clave = ruta.split(".").at(-1).replace(/\[\d+\]$/, "");
  if (typeof a !== "string" || NO_TEXTO.has(clave)) { if (a !== b) out.push(`${ruta}: ${JSON.stringify(b)} en vez de ${JSON.stringify(a)}`); }
}
for (const f of ["cronica.json", "publico.json"]) {
  const a = path.join(RAIZ, "data", f), b = path.join(RAIZ, "data/en", f);
  if (!fs.existsSync(b)) { errores.push(`data/en/${f} no existe: corré npm run contenido`); continue; }
  const out = [];
  compararDatos(JSON.parse(fs.readFileSync(a, "utf8")), JSON.parse(fs.readFileSync(b, "utf8")), f, out);
  for (const e of out.slice(0, 10)) errores.push(`data/en/${e}`);
  if (out.length > 10) errores.push(`data/en/${f}: … y ${out.length - 10} diferencias más`);
}

/* -------------------------------------------- */
/*  Resumen                                     */
/* -------------------------------------------- */

const n = t => avisos.get(t)?.length ?? 0;
console.log(`Traducción: ${cuenta.mdTraducidos} de ${cuenta.md} .md y ${cuenta.entidadesTraducidas} de ${cuenta.entidades} entidades de ${cuenta.json} .json en content/en/` +
  `${SOLO ? ` (--solo ${SOLO})` : ""}; ${packsComparados} packs comparados con su -en.`);
const TITULOS = {
  faltante: "faltantes (van en castellano)", desactualizado: "desactualizadas", castellano: "castellano suelto (heurística)",
  glosario: "glosario", marcadores: "IDs sueltos y tablas", frontmatter: "frontmatter",
  castellanoPacks: "castellano suelto en lo que se ve en Foundry (packs-src/*-en)"
};
for (const [tipo, lista] of avisos) {
  console.log(`\n⚠ ${TITULOS[tipo] ?? tipo}: ${lista.length}`);
  for (const a of lista.slice(0, DETALLE ? Infinity : 8)) console.log(`  ${a}`);
  if (!DETALLE && lista.length > 8) console.log(`  … (--detalle para verlos todos)`);
}
const duros = [...errores, ...(ESTRICTO ? [...(avisos.get("faltante") ?? []), ...(avisos.get("desactualizado") ?? [])].map(a => `(--estricto) ${a}`) : [])];
if (duros.length) {
  console.error(`\n✗ ${duros.length} error(es):`);
  for (const e of duros.slice(0, DETALLE ? Infinity : 40)) console.error(`  ${e}`);
  if (!DETALLE && duros.length > 40) console.error(`  … (--detalle para verlos todos)`);
  process.exit(1);
}
console.log(`\n✓ sin errores de formato · faltantes ${n("faltante")} · desactualizadas ${n("desactualizado")} · castellano suelto ${n("castellano")} (en los packs ${n("castellanoPacks")}) · glosario ${n("glosario")}`);

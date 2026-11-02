#!/usr/bin/env node
/**
 * content/ → packs-src/
 *
 * Orquestador: cada parte del build vive en tools/contenido/ y exporta
 * `construir(ctx)`. El núcleo compartido (ids estables, paginación, registro
 * de IDs del libro) está en tools/contenido/ids.mjs.
 *
 *   journals.mjs   content/{cronica,ciudad,personajes,documentos} → cronica, documentos
 *   actores.mjs    content/pnjs, pjs.json, firstlight.json      → personajes, firstlight
 *   escenas.mjs    content/planos                               → escenas
 *   macros.mjs     macros del módulo                             → macros
 *   musica.mjs     content/musica.json                          → playlists (las escenas ya enlazan su pista)
 *   datos.mjs      pistas, tiradas y trackers para el Panel      → data/cronica.json (lo lee el módulo)
 *   aventura.mjs   todo lo anterior                             → aventura (va último)
 *
 * Dos idiomas (TRADUCCION.md): primero el castellano (packs-src/<pack>, data/)
 * y después el inglés, con content/en/ fundido encima (packs-src/<pack>-en,
 * data/en/), en un proceso aparte con SBN_IDIOMA=en: los constructores leen
 * content/ al importarse (tools/contenido/idioma.mjs). Los _id son los mismos
 * en los dos. Lo que falta en content/en/ cae al castellano con un aviso.
 *
 * Uso: node tools/construir-contenido.mjs [--verbose] [--idioma es|en]
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { RAIZ, limpiarGenerados } from "./util.mjs";
import { PACKS, registro } from "./contenido/ids.mjs";
import { EN, packDe, resumenFaltantes } from "./contenido/idioma.mjs";
import { sinTraducir } from "./contenido/fijos.mjs";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const iIdioma = args.indexOf("--idioma");
const soloIdioma = iIdioma >= 0 ? args[iIdioma + 1] : null;
if (soloIdioma && !["es", "en"].includes(soloIdioma)) {
  console.error("Uso: node tools/construir-contenido.mjs [--verbose] [--idioma es|en]");
  process.exit(1);
}
// `--idioma en` desde la línea de comandos: se relanza con SBN_IDIOMA=en (idioma.mjs lo lee al importarse).
if (soloIdioma === "en" && !EN) process.exit(lanzarIngles());

const avisos = [];
const ctx = {
  ...registro(),
  avisos,
  log: (...a) => verbose && console.log(...a)
};

if (EN) console.log("\n── inglés: packs-src/<pack>-en y data/en/ ──");
for (const p of Object.keys(PACKS)) limpiarGenerados(path.join(RAIZ, "packs-src", packDe(p)));

// El orden importa sólo para la Aventura, que lee lo que escribieron los demás.
const PARTES = ["journals", "actores", "escenas", "macros", "musica", "datos", "aventura"];
for (const parte of PARTES) {
  const archivo = path.join(import.meta.dirname, "contenido", `${parte}.mjs`);
  if (!fs.existsSync(archivo)) {
    console.warn(`(falta tools/contenido/${parte}.mjs: se saltea)`);
    continue;
  }
  const mod = await import(archivo);
  await mod.construir(ctx);
}

// En inglés no se repiten los avisos que ya dio el castellano (son del contenido, no de la traducción).
const delCastellano = new Set(process.env.SBN_AVISOS_ES && fs.existsSync(process.env.SBN_AVISOS_ES)
  ? JSON.parse(fs.readFileSync(process.env.SBN_AVISOS_ES, "utf8")) : []);
const propios = avisos.filter(a => !delCastellano.has(a));
if (EN) {
  const r = resumenFaltantes();
  const nada = /^0 de/.test(r.md) && /^0 de/.test(r.json) && !r.entidades;
  if (!nada) propios.unshift(`traducción: faltan en content/en/ ${r.md} archivos .md y ${r.json} .json` +
    `${r.entidades ? ` (más ${r.entidades} entidades sin traducir en los .json que sí están)` : ""}: van en castellano` +
    " (npm run verificar:traduccion da el detalle)");
  for (const e of r.estructura) propios.push(`traducción: ${e}`);
  if (sinTraducir.size) propios.push(`traducción: ${sinTraducir.size} texto(s) fijo(s) del build sin inglés en tools/contenido/fijos.mjs: ${[...sinTraducir].slice(0, verbose ? Infinity : 12).map(s => `«${s}»`).join(", ")}${sinTraducir.size > 12 && !verbose ? "… (--verbose: todos)" : ""}`);
}
if (propios.length) {
  console.warn(`\n${propios.length} aviso(s)${EN ? " del inglés" : ""}:`);
  for (const a of propios) console.warn(`  ${a}`);
}

// Después del castellano, el inglés (salvo `--idioma es`).
if (!EN && soloIdioma !== "es") {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sbn-")), "avisos-es.json");
  fs.writeFileSync(tmp, JSON.stringify(avisos));
  const codigo = lanzarIngles(tmp);
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  process.exit(codigo);
}

function lanzarIngles(archivoAvisos) {
  const r = spawnSync(process.execPath, [import.meta.filename, ...args.filter((a, i) => a !== "--idioma" && args[i - 1] !== "--idioma")], {
    stdio: "inherit",
    env: { ...process.env, SBN_IDIOMA: "en", ...(archivoAvisos ? { SBN_AVISOS_ES: archivoAvisos } : {}) }
  });
  return r.status ?? 1;
}

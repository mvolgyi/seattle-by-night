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
 *   datos.mjs      pistas, tiradas y trackers para el Panel      → data/cronica.json (lo lee el módulo)
 *   aventura.mjs   todo lo anterior                             → aventura (va último)
 *
 * Uso: node tools/construir-contenido.mjs [--verbose]
 */
import path from "node:path";
import fs from "node:fs";
import { RAIZ, limpiarGenerados } from "./util.mjs";
import { PACKS, registro } from "./contenido/ids.mjs";

const verbose = process.argv.includes("--verbose");
const avisos = [];
const ctx = {
  ...registro(),
  avisos,
  log: (...a) => verbose && console.log(...a)
};

for (const p of Object.keys(PACKS)) limpiarGenerados(path.join(RAIZ, "packs-src", p));

// El orden importa sólo para la Aventura, que lee lo que escribieron los demás.
const PARTES = ["journals", "actores", "escenas", "macros", "datos", "aventura"];
for (const parte of PARTES) {
  const archivo = path.join(import.meta.dirname, "contenido", `${parte}.mjs`);
  if (!fs.existsSync(archivo)) {
    console.warn(`(falta tools/contenido/${parte}.mjs: se saltea)`);
    continue;
  }
  const mod = await import(archivo);
  await mod.construir(ctx);
}

if (avisos.length) {
  console.warn(`\n${avisos.length} aviso(s):`);
  for (const a of avisos) console.warn(`  ${a}`);
}

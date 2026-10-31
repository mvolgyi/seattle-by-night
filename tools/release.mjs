#!/usr/bin/env node
/**
 * Release: fija la versión y arma el zip que se sube a GitHub.
 *
 *   node tools/release.mjs v0.5.0             fija `version` y `download` y arma dist/module.zip
 *   node tools/release.mjs --zip              sólo el zip, con la versión que ya tiene module.json
 *   node tools/release.mjs ... --out <dir>    el zip (y una copia de module.json) en <dir>
 *
 * `manifest` queda apuntando a releases/latest/download/module.json (así el
 * auto-update de Foundry siempre ve la última), y `download` al zip del tag.
 *
 * El zip lleva SÓLO lo que el módulo carga en tiempo de juego: module.json,
 * README, LICENSE, src/ (código y estilos), templates/, lang/, data/
 * (cronica.json y publico.json, que se piden con fetch), los packs/ compilados
 * y assets/. Nada de content/, packs-src/, tools/, cache/, los .docx ni
 * node_modules. Hay que correr `npm run pack` antes: sin packs/ no hay zip.
 *
 * Después de armarlo lo lee de vuelta (unzip -Z1) y comprueba que esté todo
 * lo que nombra module.json (esmodules, scripts, styles, languages, packs,
 * license) y todo lo que el código y los packs piden por ruta
 * (`modules/seattle-by-night/…`, `SBN.ruta("…")`). Si falta algo, o se coló
 * algo que no va, sale con error y no deja el zip.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { RAIZ, MODULO } from "./util.mjs";

const args = process.argv.slice(2);
const tag = args.find(a => /^v\d+\.\d+\.\d+/.test(a));
const soloZip = args.includes("--zip");
const iOut = args.indexOf("--out");
const salida = path.resolve(iOut >= 0 && args[iOut + 1] ? args[iOut + 1] : path.join(RAIZ, "dist"));
if (!tag && !soloZip) {
  console.error("Uso: node tools/release.mjs v<major>.<minor>.<patch> [--out <dir>]\n" +
    "     node tools/release.mjs --zip [--out <dir>]   (sin tocar la versión)");
  process.exit(1);
}

const rutaManifest = path.join(RAIZ, "module.json");

/* -------------------------------------------- */
/*  Versión                                     */
/* -------------------------------------------- */

if (tag) {
  const version = tag.slice(1);
  const manifest = JSON.parse(fs.readFileSync(rutaManifest, "utf8"));
  manifest.version = version;
  manifest.download = `https://github.com/mvolgyi/${MODULO}/releases/download/${tag}/module.zip`;
  fs.writeFileSync(rutaManifest, JSON.stringify(manifest, null, 2) + "\n");

  const pkgRuta = path.join(RAIZ, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgRuta, "utf8"));
  pkg.version = version;
  fs.writeFileSync(pkgRuta, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`module.json → ${version} (${manifest.download})`);
}

const manifest = JSON.parse(fs.readFileSync(rutaManifest, "utf8"));

/* -------------------------------------------- */
/*  Qué entra                                   */
/* -------------------------------------------- */

/** Archivos y carpetas del zip (relativos a la raíz). Lista cerrada: lo que no está acá no entra. */
const INCLUIR = ["module.json", "README.md", "LICENSE", "src", "templates", "lang", "data", "packs", "assets"];

/** Dentro de lo incluido, lo que se deja afuera. */
const EXCLUIR = [
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.gitkeep$/,
  /\.lock$/,          // el bloqueo que deja Foundry al abrir un paquete en desarrollo
  /^assets\/[^/]+-crudo\//  // arte sin procesar (tokens-crudo/…): se regenera, no se publica
];

/** Lo que nunca puede aparecer en el zip (por si alguien amplía INCLUIR). */
const PROHIBIDO = [/^content\//, /^packs-src\//, /^tools\//, /^cache\//, /^node_modules\//, /^dist\//,
  /^scratch\//, /\.docx$/i, /^Seattle by Night - El Expediente Ward\//];

/** Lo que el módulo pide con fetch o por ruta sin que module.json lo nombre (constantes.mjs). */
const REQUERIDOS = ["data/cronica.json", "data/publico.json"];

function recorrer(rel, out = []) {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs)) return out;
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    for (const n of fs.readdirSync(abs).sort()) recorrer(rel ? `${rel}/${n}` : n, out);
  } else if (st.isFile() && !EXCLUIR.some(re => re.test(rel))) {
    out.push(rel);
  }
  return out;
}

const errores = [];
for (const p of manifest.packs ?? []) {
  if (!fs.existsSync(path.join(RAIZ, p.path, "CURRENT"))) errores.push(`falta el pack compilado ${p.path} (corré npm run pack)`);
}
if (errores.length) {
  for (const e of errores) console.error(`✗ ${e}`);
  process.exit(1);
}

const archivos = INCLUIR.flatMap(rel => recorrer(rel));

/* -------------------------------------------- */
/*  Zip                                         */
/* -------------------------------------------- */

fs.mkdirSync(salida, { recursive: true });
const zip = path.join(salida, "module.zip");
fs.rmSync(zip, { force: true }); // zip agrega a un archivo existente: se empieza de cero
// -X: sin atributos extra (uid/gid); -D: sin entradas de directorio; -@: la lista por stdin.
execFileSync("zip", ["-q", "-X", "-D", "-9", zip, "-@"], { cwd: RAIZ, input: archivos.join("\n") + "\n" });

/* -------------------------------------------- */
/*  Verificación: el zip leído de vuelta        */
/* -------------------------------------------- */

const enZip = new Set(execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(Boolean));
const hay = rel => enZip.has(rel);
const hayCarpeta = rel => [...enZip].some(f => f.startsWith(`${rel.replace(/\/$/, "")}/`));

// 1. Lo que nombra module.json.
const delManifest = [
  ...(manifest.esmodules ?? []).map(r => ["esmodules", r]),
  ...(manifest.scripts ?? []).map(r => ["scripts", r]),
  ...(manifest.styles ?? []).map(r => ["styles", r]),
  ...(manifest.languages ?? []).map(l => ["languages", l.path]),
  ...(manifest.license && !/^https?:/.test(manifest.license) ? [["license", manifest.license]] : []),
  ...(manifest.media ?? []).filter(m => m.url && !/^https?:/.test(m.url)).map(m => ["media", m.url])
];
for (const [campo, rel] of delManifest) if (!hay(rel)) errores.push(`module.json ${campo}: «${rel}» no está en el zip`);
for (const p of manifest.packs ?? []) {
  if (!hay(`${p.path}/CURRENT`)) errores.push(`module.json packs: «${p.path}» no está compilado en el zip`);
}
for (const rel of REQUERIDOS) if (!hay(rel)) errores.push(`«${rel}» (lo pide el módulo con fetch) no está en el zip`);

// 2. Lo que el código, las plantillas y los packs piden por ruta.
const PREFIJO = new RegExp(`modules/${MODULO}/([^"'\\s)<>\\\\]+)`, "g");
const RUTA = /SBN\.ruta\(\s*["'`]([^"'`$]+)["'`]\s*\)/g;
const pedidos = new Map(); // rel → primer archivo que lo pide
const fuentes = ["src", "templates", "lang", "data", "packs-src"].flatMap(rel => recorrer(rel))
  .filter(f => /\.(m?js|hbs|html|css|json)$/.test(f));
for (const f of fuentes) {
  const texto = fs.readFileSync(path.join(RAIZ, f), "utf8");
  for (const re of [PREFIJO, RUTA]) {
    for (const m of texto.matchAll(re)) {
      const rel = decodeURI(m[1]).replace(/[?#].*$/, "");
      if (!pedidos.has(rel)) pedidos.set(rel, f);
    }
  }
}
for (const [rel, f] of pedidos) {
  if (!hay(rel) && !hayCarpeta(rel)) errores.push(`«${rel}» (lo pide ${f}) no está en el zip`);
}

// 3. Lo que no va.
for (const f of enZip) if (PROHIBIDO.some(re => re.test(f))) errores.push(`se coló «${f}», que no va en el release`);

if (errores.length) {
  for (const e of errores) console.error(`✗ ${e}`);
  fs.rmSync(zip, { force: true });
  process.exit(1);
}

fs.copyFileSync(rutaManifest, path.join(salida, "module.json"));
const raiz = new Map();
for (const f of enZip) {
  const k = f.includes("/") ? f.split("/")[0] + "/" : f;
  raiz.set(k, (raiz.get(k) ?? 0) + 1);
}
const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1);
console.log(`✓ ${zip} · ${manifest.version} · ${enZip.size} archivos · ${mb} MB`);
console.log(`  ${[...raiz].map(([k, n]) => `${k} ${n}`).join(" · ")}`);
console.log(`  module.json: ${delManifest.length + (manifest.packs?.length ?? 0)} rutas · ${pedidos.size} rutas pedidas por src/, templates/ y packs: todas adentro`);

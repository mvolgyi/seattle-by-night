#!/usr/bin/env node
/**
 * Verifica la fuente de los compendios antes de empaquetar.
 *
 * Existe porque una ruta de icono inventada (`bell-alarm-red.webp` en vez de
 * `bell-alarm-red-purple.webp`) llega hasta la mesa como una imagen rota: ni
 * `pack` ni Foundry se quejan. Lo mismo con un `_key` faltante, que hace que
 * `fvtt package pack` descarte el documento en silencio.
 *
 * Uso:  node tools/verificar.mjs
 * Env:  FOUNDRY_APP  ruta a resources/app (por defecto ~/FoundryVTT/app/resources/app)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const RAIZ = path.resolve(import.meta.dirname, "..");
const APP = process.env.FOUNDRY_APP
  ?? path.join(os.homedir(), "FoundryVTT/app/resources/app");
const PUBLICO = path.join(APP, "public");
// Los assets de un sistema (systems/pf2e/icons/...) no viven con el core sino
// en el directorio de datos del usuario.
const DATOS = process.env.FOUNDRY_DATA
  ?? path.join(os.homedir(), ".local/share/FoundryVTT/Data");

/** Colecciones válidas para `_key`, según TYPE_COLLECTION_MAP de fvtt-cli. */
const COLECCIONES = new Set([
  "actors", "adventures", "cards", "effects", "folders", "items", "journal",
  "macros", "messages", "playlists", "scenes", "settings", "tables", "users"
]);

const problemas = [];
const avisos = [];

function archivosJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return archivosJson(p);
    return e.name.endsWith(".json") ? [p] : [];
  });
}

/** Recolecta todo valor de campos que apuntan a un asset. */
function rutasDeAsset(obj, ruta = []) {
  const CAMPOS = new Set(["img", "src", "texture", "background", "foreground", "thumb", "icon"]);
  const out = [];
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => out.push(...rutasDeAsset(v, [...ruta, i])));
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && CAMPOS.has(k) && v && !v.startsWith("data:")) {
        out.push({ campo: [...ruta, k].join("."), valor: v });
      } else {
        out.push(...rutasDeAsset(v, [...ruta, k]));
      }
    }
  }
  return out;
}

function existeAsset(rel) {
  if (/^https?:\/\//.test(rel)) return true; // remoto: no lo podemos comprobar
  const limpio = decodeURIComponent(rel.split("?")[0]);
  const candidatos = [
    path.join(PUBLICO, limpio),                 // icons/... del core
    path.join(DATOS, limpio),                   // systems/wod5e/... y otros módulos
    path.join(RAIZ, limpio),                    // rutas propias del módulo
    path.join(RAIZ, limpio.replace(/^modules\/seattle-by-night\//, ""))
  ];
  return candidatos.some(p => fs.existsSync(p));
}

/* -------------------------------------------- */

const archivos = archivosJson(path.join(RAIZ, "packs-src"));
if (!archivos.length) avisos.push("No se encontró ningún JSON en packs-src/.");

const clavesVistas = new Map();

for (const archivo of archivos) {
  const rel = path.relative(RAIZ, archivo);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(archivo, "utf8"));
  } catch (err) {
    problemas.push(`${rel}: JSON inválido — ${err.message}`);
    continue;
  }

  // _key: sin esto, `fvtt package pack` descarta el documento sin avisar.
  if (!doc._key) {
    problemas.push(`${rel}: falta _key. El documento se descartaría en silencio al empaquetar.`);
  } else {
    const m = /^!([a-z]+)!(.+)$/.exec(doc._key);
    if (!m) {
      problemas.push(`${rel}: _key "${doc._key}" no tiene el formato !<colección>!<id>.`);
    } else {
      const [, coleccion, id] = m;
      if (!COLECCIONES.has(coleccion)) {
        problemas.push(`${rel}: colección "${coleccion}" desconocida en _key.`);
      }
      if (doc._id && id !== doc._id) {
        problemas.push(`${rel}: _key termina en "${id}" pero _id es "${doc._id}".`);
      }
      if (clavesVistas.has(doc._key)) {
        problemas.push(`${rel}: _key duplicada, ya usada por ${clavesVistas.get(doc._key)}.`);
      }
      clavesVistas.set(doc._key, rel);
    }
  }

  if (doc._id && !/^[A-Za-z0-9]{16}$/.test(doc._id)) {
    problemas.push(`${rel}: _id "${doc._id}" debe ser alfanumérico de 16 caracteres.`);
  }

  // Los documentos embebidos también necesitan _key, con el formato
  // !<colección>.<subcolección>!<idPadre>.<idHijo>. Sin él, fvtt-cli aborta
  // con "Key cannot be null or undefined" en vez de descartarlo en silencio.
  // Dentro de un Adventure los documentos van como datos planos: HIERARCHY de
  // fvtt-cli no tiene entrada `adventures`, así que no se les asigna _key.
  const esAventura = doc._key?.startsWith("!adventures");
  const EMBEBIDOS = esAventura ? {} : { pages: "journal.pages", items: "actors.items",
                      effects: "actors.effects", results: "tables.results", sounds: "playlists.sounds" };
  if (doc._key?.startsWith("!scenes!")) {
    for (const col of ["walls", "lights", "levels", "regions", "tokens", "notes", "sounds", "tiles", "drawings"]) {
      EMBEBIDOS[col] = `scenes.${col}`;
    }
    // Comportamientos de región: un nivel más abajo.
    for (const rg of doc.regions ?? []) {
      for (const b of rg.behaviors ?? []) {
        const esperado = `!scenes.regions.behaviors!${doc._id}.${rg._id}.${b._id}`;
        if (b._key !== esperado) problemas.push(`${rel}: regions[${rg._id}].behaviors[${b._id}] tiene _key "${b._key}", se esperaba "${esperado}".`);
      }
    }
  }
  for (const [campo, sublevel] of Object.entries(EMBEBIDOS)) {
    for (const hijo of doc[campo] ?? []) {
      const esperado = `!${sublevel}!${doc._id}.${hijo._id}`;
      if (!hijo._key) {
        problemas.push(`${rel}: ${campo}[${hijo._id ?? "?"}] no tiene _key (esperado ${esperado}).`);
      } else if (hijo._key !== esperado) {
        problemas.push(`${rel}: ${campo}[${hijo._id}] tiene _key "${hijo._key}", se esperaba "${esperado}".`);
      }
    }
  }

  // Assets: la causa de la imagen rota.
  for (const { campo, valor } of rutasDeAsset(doc)) {
    if (!existeAsset(valor)) {
      problemas.push(`${rel}: ${campo} apunta a "${valor}", que no existe.`);
    }
  }
}

/* -------------------------------------------- */

if (!fs.existsSync(PUBLICO)) {
  avisos.push(`No encontré los assets del core en ${PUBLICO}. ` +
    `Las rutas icons/... no se pudieron verificar. Definí FOUNDRY_APP si Foundry está en otro lado.`);
}

for (const a of avisos) console.warn(`aviso: ${a}`);

if (problemas.length) {
  console.error(`\n✗ ${problemas.length} problema(s):\n`);
  for (const p of problemas) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`✓ ${archivos.length} documento(s) verificados: _key, _id y assets en orden.`);

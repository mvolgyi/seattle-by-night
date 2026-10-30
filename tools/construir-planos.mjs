#!/usr/bin/env node
/**
 * Rasteriza los planos vectoriales a un ESQUEMA (`<id>.esquema.webp`).
 *
 * El mapa final NO sale de acá: lo produce el repintado local (ComfyUI, ver
 * SPEC.md §4), que usa este mismo esquema como fuente de geometría. Este
 * script escribe `.esquema.webp` justamente para no pisar `<id>.webp`: si
 * escribiera el nombre final, cada build revertiría el mapa pintado al
 * vectorial y el trabajo de pintura desaparecería en silencio.
 *
 * Los muros, las regiones y las luces NO se escriben acá: los deriva el build
 * de escenas del mismo archivo. Así el mapa y la geometría que bloquea el paso
 * no pueden desincronizarse. Acá sólo se cuentan y se validan (presets de luz
 * que existen, regiones con destino que resuelve).
 *
 * Uso: node tools/construir-planos.mjs [--solo helen] [--depurar <carpeta>]
 *
 *   --depurar  además escribe `<id>.depurar.webp` en esa carpeta: el esquema
 *              con los muros de Foundry por tipo (rojo muro, verde puerta,
 *              cian vidrio/ventana, amarillo baranda), las regiones y las
 *              luces encima. Sirve para revisar el plano y, más adelante, para
 *              comparar contra el repintado. Nunca va a assets/.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { renderSvg, derivarMuros, mueblesMoviles, GRID_PX, PX_POR_M } from "./planos.mjs";
import { lucesDePlano } from "./iluminacion.mjs";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ENTRADA = path.join(RAIZ, "content/planos");
const SALIDA = path.join(RAIZ, "assets/mapas");

export function cargarPlanos() {
  if (!fs.existsSync(ENTRADA)) return [];
  return fs.readdirSync(ENTRADA)
    .filter(f => f.endsWith(".json"))
    .sort()
    .flatMap(f => JSON.parse(fs.readFileSync(path.join(ENTRADA, f), "utf8")).planos ?? []);
}

/** Problemas de un plano que no impiden rasterizar pero sí armar la escena. */
function validar(plano, todos) {
  const avisos = [];
  const ids = new Map(todos.map(p => [p.id, new Set((p.regiones ?? []).map(r => r.id))]));
  for (const rg of plano.regiones ?? []) {
    if (!rg.destino) {
      if (!rg.llegada) avisos.push(`región «${rg.id}» sin destino (pendiente: ${rg.pendiente ?? "?"})`);
      continue;
    }
    const [pd, rd] = rg.destino.split(":");
    if (!ids.has(pd)) avisos.push(`región «${rg.id}» → plano «${pd}» que no existe todavía`);
    else if (!ids.get(pd).has(rd)) avisos.push(`región «${rg.id}» → «${rg.destino}»: falta la región gemela`);
  }
  for (const v of plano.vanos ?? []) {
    if (!["abierto", "puerta", "secreta", "puerta-vidrio", "ventana", "vidrio", "baranda", "arcada"].includes(v.tipo)) {
      avisos.push(`vano de tipo desconocido «${v.tipo}»`);
    }
  }
  return avisos;
}

/** Capa de depuración: muros por tipo, regiones y luces sobre el esquema. */
function capaDepurar(plano) {
  const COLOR = { muro: "#ff2a2a", secreta: "#ff00ff", puerta: "#22dd44", "puerta-vidrio": "#22dd44",
    ventana: "#00e5ff", vidrio: "#00a0ff", baranda: "#ffd400" };
  const o = [];
  for (const m of derivarMuros(plano)) {
    const [x1, y1, x2, y2] = m.c;
    o.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLOR[m._tipo]}" stroke-width="4" opacity="0.95"/>`);
    o.push(`<circle cx="${x1}" cy="${y1}" r="4" fill="${COLOR[m._tipo]}"/><circle cx="${x2}" cy="${y2}" r="4" fill="${COLOR[m._tipo]}"/>`);
  }
  for (const rg of plano.regiones ?? []) {
    const c = rg.llegada ? "#2f7f8c" : rg.destino ? "#b23030" : "#9a9a9a";
    o.push(`<rect x="${rg.x * PX_POR_M}" y="${rg.y * PX_POR_M}" width="${rg.w * PX_POR_M}" height="${rg.h * PX_POR_M}" fill="${c}" fill-opacity="0.35" stroke="${c}" stroke-width="3" stroke-dasharray="10 6"/>`);
  }
  for (const l of lucesDePlano(plano, s => s)) {
    o.push(`<circle cx="${l.x}" cy="${l.y}" r="${l.config.dim * PX_POR_M}" fill="none" stroke="#ffb46b" stroke-width="2" stroke-dasharray="4 6" opacity="0.8"/>`);
    o.push(`<circle cx="${l.x}" cy="${l.y}" r="6" fill="#ffb46b" stroke="#000" stroke-width="1.5"/>`);
  }
  for (const m of mueblesMoviles(plano)) {
    o.push(`<rect x="${m.x * PX_POR_M}" y="${m.y * PX_POR_M}" width="${m.w * PX_POR_M}" height="${m.h * PX_POR_M}" fill="#ff8c00" fill-opacity="0.25" stroke="#ff8c00" stroke-width="2"/>`);
  }
  // Grid de 1 m, fino, sólo para revisar alineación.
  const W = plano.ancho * PX_POR_M, H = plano.alto * PX_POR_M;
  for (let x = 0; x <= W; x += GRID_PX) o.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#ffffff" stroke-width="1" opacity="0.18"/>`);
  for (let y = 0; y <= H; y += GRID_PX) o.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#ffffff" stroke-width="1" opacity="0.18"/>`);
  return o.join("");
}

function rasterizar(svg, destino, tmp) {
  fs.writeFileSync(tmp, svg);
  try {
    execFileSync("magick", ["-background", "none", tmp, "-quality", "92", destino], { stdio: "pipe" });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

if (import.meta.filename === process.argv[1]) {
  const argv = process.argv.slice(2);
  const opcion = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const solo = opcion("--solo");
  const depurar = opcion("--depurar");
  const todos = cargarPlanos();
  const planos = todos.filter(p => !solo || p.id === solo);
  if (!planos.length) {
    console.error(solo ? `No encontré el plano "${solo}".` : "No hay planos en content/planos/.");
    process.exit(1);
  }

  fs.mkdirSync(SALIDA, { recursive: true });
  if (depurar) fs.mkdirSync(depurar, { recursive: true });

  for (const plano of planos) {
    const svg = renderSvg(plano);
    const destino = path.join(SALIDA, `${plano.id}.esquema.webp`);
    rasterizar(svg, destino, path.join(SALIDA, `${plano.id}.svg`));
    if (depurar) {
      rasterizar(svg.replace(/<\/svg>$/, `${capaDepurar(plano)}</svg>`),
        path.join(depurar, `${plano.id}.depurar.webp`), path.join(depurar, `${plano.id}.svg`));
    }
    const muros = derivarMuros(plano);
    const cuenta = (...t) => muros.filter(m => t.includes(m._tipo)).length;
    const kb = Math.round(fs.statSync(destino).size / 1024);
    const moviles = mueblesMoviles(plano).length;
    const luces = lucesDePlano(plano, s => s).length;
    console.log(`  ${plano.id.padEnd(22)} ${String(kb).padStart(5)} KB  ${plano.ancho}×${plano.alto} m  ` +
      `${cuenta("muro")} muros · ${cuenta("puerta", "puerta-vidrio", "secreta")} puertas · ` +
      `${cuenta("ventana")} ventanas · ${cuenta("vidrio")} vidrios · ${cuenta("baranda")} barandas · ` +
      `${luces} luces · ${(plano.regiones ?? []).length} regiones · ${moviles} móvil(es) sin pintar · grid ${GRID_PX}px`);
    for (const a of validar(plano, todos)) console.log(`    ⚠ ${a}`);
  }
  console.log(`✓ ${planos.length} plano(s) → ${path.relative(RAIZ, SALIDA)}`);
}

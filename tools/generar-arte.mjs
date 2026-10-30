#!/usr/bin/env node
/**
 * Generador de arte de Seattle by Night (retratos, tokens, tiles). Port del
 * tools/generar-arte.mjs de DVV: los prompts viven versionados en
 * tools/arte.config.json (prefijo + sujeto + sufijo por estilo) para que el
 * estilo sea reproducible, pero todo se genera en local con ComfyUI
 * (tools/comfy.mjs): nada de APIs en la nube.
 *
 * Uso:
 *   node tools/generar-arte.mjs                    # genera lo que falte
 *   node tools/generar-arte.mjs --solo <id>,<id>   [--estilo retrato|token|tile]
 *   node tools/generar-arte.mjs --forzar           # regenera aunque exista
 *   node tools/generar-arte.mjs --listar
 *   node tools/generar-arte.mjs --solo PNJ-12 --estilo retrato --semillas 1201,1202,1203 --salida scratch/arte
 *       candidatas: una imagen por semilla en <salida>/<id>-s<semilla>.webp, para
 *       elegir a ojo y fijar después la elegida como `semilla` del asset.
 *   --candidatas     como --semillas, pero con la lista `candidatas` de cada asset.
 *   --liberar        al terminar, POST /free (descarga los modelos de la VRAM y la RAM).
 *   --salida <dir>   escribe ahí en vez de en assets/ (pruebas). La procedencia
 *                    va a <dir>/PROCEDENCIA.json, no a la del módulo.
 *   --sin-vigilar    no mira temperatura de GPU ni RAM entre trabajos.
 *
 * Assets (arte.config.json → assets[]):
 *   { id, estilo, semilla, prompt | fuente: "doc15", nota,
 *     flujo?   (pisa el del estilo: t2i-zimage, editar-qwen, editar-klein),
 *     retrato? (token: id del retrato que se usa como referencia de identidad),
 *     figura?, semilla_figura? (token genérico sin retrato: sujeto de una figura de
 *              referencia en estilo retrato, en assets/tokens-crudo/figura/),
 *     prefijo? (pisa el prefijo del estilo: p. ej. un animal en vez de una persona),
 *     ancho?, alto?, carpeta? }
 *   `fuente: "doc15"` toma el sujeto de content/arte-doc15.json (retratos[].prompt)
 *   tal cual; si no, el sujeto es `prompt`.
 *
 * Retrato: t2i-zimage → assets/retratos/<id>.webp.
 * Token:   editar-qwen (Picture 1 = el retrato) o el flujo del asset →
 *          assets/tokens-crudo/fondo/<id>.webp (sobre gris liso) → BiRefNet →
 *          assets/tokens-crudo/<id>.png (alfa) → tools/tokens.mjs →
 *          assets/tokens/<id>.webp (círculo con anillo).
 * Tile:    t2i-zimage → BiRefNet → assets/tiles/<id>.webp (con alfa).
 *
 * Cada imagen final queda registrada en assets/PROCEDENCIA.json (modelo,
 * licencia, workflow, semilla, prompt).
 *
 * Los INTERIORES y battlemaps no salen de acá: los pinta tools/pintar-planos.mjs
 * desde un plano.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { cargarWorkflow, ejecutar, guardar, registrarProcedencia, liberar } from "./comfy.mjs";
import { tokenCircular } from "./tokens.mjs";

const RAIZ = path.resolve(import.meta.dirname, "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(RAIZ, "tools/arte.config.json"), "utf8"));
const DOC15 = JSON.parse(fs.readFileSync(path.join(RAIZ, "content/arte-doc15.json"), "utf8"));
const CALIDAD_WEBP = 90;

/* --- modelos por workflow (tools/MODELOS.md) -------------------------------- */

const MODELOS = {
  "t2i-zimage": { modelos: ["z_image_turbo_bf16.safetensors", "qwen_3_4b.safetensors", "z_image_ae.safetensors"], licencia: "Apache 2.0" },
  "editar-qwen": { modelos: ["qwen-image-edit-2511-Q5_K_M.gguf", "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", "qwen_2.5_vl_7b_fp8_scaled.safetensors", "qwen_image_vae.safetensors"], licencia: "Apache 2.0" },
  "editar-klein": { modelos: ["flux-2-klein-4b.safetensors", "qwen_3_4b.safetensors", "flux2-vae.safetensors"], licencia: "Apache 2.0" },
  "recortar-birefnet": { modelos: ["birefnet.safetensors"], licencia: "MIT" }
};

/* --- argumentos ------------------------------------------------------------- */

const argv = process.argv.slice(2);
const tiene = f => argv.includes(f);
const valor = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const soloIds = valor("--solo")?.split(",").map(s => s.trim()).filter(Boolean) ?? null;
const forzar = tiene("--forzar");
const soloEstilo = valor("--estilo");
const semillasCli = valor("--semillas")?.split(",").map(Number).filter(n => Number.isInteger(n)) ?? null;
// --candidatas: usa la lista `candidatas` de cada asset (o su `semilla`) en vez de --semillas.
const usarCandidatas = tiene("--candidatas");
const semillasDe = a => semillasCli ?? (usarCandidatas ? (a.candidatas ?? [a.semilla]) : [a.semilla]);
const modoCandidatas = !!semillasCli || usarCandidatas;
const salidaCli = valor("--salida") ? path.resolve(valor("--salida")) : null;
const vigilar = !tiene("--sin-vigilar");

/* --- rutas y prompts -------------------------------------------------------- */

const estiloDe = a => {
  const e = CONFIG.estilos[a.estilo];
  if (!e) throw new Error(`${a.id}: estilo desconocido «${a.estilo}»`);
  return e;
};
const flujoDe = a => a.flujo ?? estiloDe(a).flujo;
const carpetaDe = a => path.join(RAIZ, a.carpeta ?? estiloDe(a).carpeta);
const rutaDe = a => path.join(carpetaDe(a), `${a.id}.webp`);
const CRUDO_TOKENS = path.join(RAIZ, "assets/tokens-crudo");

function sujetoDe(a) {
  if (a.fuente === "doc15") {
    const r = DOC15.retratos.find(x => x.id === (a.doc15 ?? a.id));
    if (!r) throw new Error(`${a.id}: no está en content/arte-doc15.json`);
    return r.prompt;
  }
  if (!a.prompt) throw new Error(`${a.id}: el asset no tiene prompt`);
  return a.prompt;
}

/** Prefijo + sujeto + sufijo. Un token generado sin retrato (t2i) usa `prefijo_t2i`. */
function promptDe(a) {
  const e = estiloDe(a);
  const prefijo = a.prefijo ?? (a.estilo === "token" && flujoDe(a) === "t2i-zimage" ? (e.prefijo_t2i ?? e.prefijo) : e.prefijo);
  return prefijo + sujetoDe(a) + e.sufijo;
}

/**
 * Referencia de identidad de un token de edición: el retrato publicado
 * (`retrato`), o, para los genéricos sin retrato, una FIGURA de referencia que
 * se pinta antes con el estilo retrato (`figura` = sujeto, `semilla_figura`) y
 * queda en assets/tokens-crudo/figura/ (no se publica). Así todos los tokens
 * salen del mismo camino retrato → Qwen-Edit y comparten estilo.
 */
const FIGURAS = path.join(RAIZ, "assets/tokens-crudo/figura");
const rutaReferencia = a => a.figura
  ? path.join(FIGURAS, `${a.id}-s${a.semilla_figura}.webp`)
  : path.join(RAIZ, CONFIG.estilos.retrato.carpeta, `${a.retrato ?? a.id}.webp`);

async function asegurarFigura(a) {
  const ruta = rutaReferencia(a);
  if (fs.existsSync(ruta)) return null;
  const r = CONFIG.estilos.retrato;
  const prompt = r.prefijo + a.figura + r.sufijo;
  const res = await ejecutar("t2i-zimage", { PROMPT: prompt, SEMILLA: a.semilla_figura, ANCHO: r.ancho, ALTO: r.alto, PREFIJO: `sbn/figura/${a.id}-s${a.semilla_figura}` });
  guardar(res.salidas[0].buffer, ruta, CALIDAD_WEBP);
  return { segundos: res.segundos, prompt };
}

/* --- vigilancia de la placa (condición del usuario) ------------------------- */

const LIMITE_GPU = 80, REANUDA_GPU = 70;      // °C
const LIMITE_RAM = 8, REANUDA_RAM = 12;       // GB disponibles
const pausas = [];

function estadoHardware() {
  const [t, mem] = execFileSync("nvidia-smi", ["--query-gpu=temperature.gpu,memory.used", "--format=csv,noheader,nounits"])
    .toString().trim().split(",").map(s => Number(s.trim()));
  const kb = Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync("/proc/meminfo", "utf8"))[1]);
  return { gpu: t, vram: mem, ram: kb / 1024 / 1024 };
}
const fmt = h => `GPU ${h.gpu} °C, VRAM ${(h.vram / 1024).toFixed(1)} GB, RAM disp. ${h.ram.toFixed(1)} GB`;

let trabajos = 0;
async function cuidarPlaca(etiqueta) {
  if (!vigilar) return;
  let h = estadoHardware();
  if (trabajos++ % 5 === 0) console.log(`    · ${fmt(h)}`);
  if (h.gpu <= LIMITE_GPU && h.ram >= LIMITE_RAM) return;
  const inicio = Date.now();
  console.log(`    ⏸ pausa antes de ${etiqueta}: ${fmt(h)}`);
  // Sin RAM, esperar no alcanza: la ocupa ComfyUI con los modelos cargados.
  if (h.ram < LIMITE_RAM) { await liberar(true); console.log("    · POST /free (descarga los modelos)"); }
  while (h.gpu >= REANUDA_GPU || h.ram <= REANUDA_RAM) {
    await new Promise(r => setTimeout(r, 15e3));
    h = estadoHardware();
  }
  const s = Math.round((Date.now() - inicio) / 1000);
  console.log(`    ▶ sigue tras ${s} s: ${fmt(h)}`);
  pausas.push({ etiqueta, segundos: s });
}

/* --- workflows -------------------------------------------------------------- */

/**
 * Workflow de edición con UNA sola referencia (el retrato), sin la imagen de
 * estilo, y sin escalar el retrato al tamaño de salida: el 2:3 vertical
 * deformado a 1:1 cambia la cara. El codificador de Qwen ya lo lleva a ~1 MP
 * sin cambiar la proporción; klein lo lleva a 1 MP con ImageScaleToTotalPixels.
 */
function workflowEdicion(flujo) {
  const wf = cargarWorkflow(flujo);
  if (flujo === "editar-qwen") {
    delete wf["8"]; delete wf["9"];
    for (const n of ["10", "11"]) { delete wf[n].inputs.image2; wf[n].inputs.image1 = ["7", 0]; }
  } else if (flujo === "editar-klein") {
    for (const n of ["5", "7", "9", "12"]) delete wf[n];
    wf["6"] = { class_type: "ImageScaleToTotalPixels", inputs: { image: ["4", 0], upscale_method: "lanczos", megapixels: 1, resolution_steps: 16 }, _meta: { title: "Retrato a 1 MP" } };
    wf["13"].inputs.conditioning = ["11", 0];
  } else throw new Error(`flujo de edición desconocido: ${flujo}`);
  return wf;
}

const tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "sbn-arte-"));
process.on("exit", () => fs.rmSync(tmpDir, { recursive: true, force: true }));

/** Una pasada de generación: devuelve el PNG crudo y los segundos. */
async function pasada(a, semilla) {
  const e = estiloDe(a), flujo = flujoDe(a);
  const valores = {
    PROMPT: promptDe(a), SEMILLA: semilla,
    ANCHO: a.ancho ?? e.ancho, ALTO: a.alto ?? e.alto,
    PREFIJO: `sbn/${a.estilo}/${a.id}-s${semilla}`
  };
  let wf = flujo;
  if (flujo.startsWith("editar-")) {
    if (a.figura) await asegurarFigura(a);
    const retrato = rutaReferencia(a);
    if (!fs.existsSync(retrato)) throw new Error(`falta el retrato ${path.relative(RAIZ, retrato)} (generalo antes)`);
    // LoadImage lee WebP, pero se sube PNG para no depender del soporte de PIL.
    const png = path.join(tmpDir, `ref-${path.basename(retrato, ".webp")}.png`);
    execFileSync("magick", [retrato, png]);
    valores.IMAGEN = png;
    wf = workflowEdicion(flujo);
  }
  const r = await ejecutar(wf, valores);
  return { png: r.salidas[0].buffer, segundos: r.segundos, valores };
}

/** BiRefNet sobre un PNG: devuelve el PNG con alfa. */
async function recortar(png, etiqueta) {
  const entrada = path.join(tmpDir, `${etiqueta}.png`);
  fs.writeFileSync(entrada, png);
  const r = await ejecutar("recortar-birefnet", { IMAGEN: entrada, PREFIJO: `sbn/recorte/${etiqueta}` });
  const rgba = r.salidas.find(s => !/mascara/.test(s.filename)) ?? r.salidas[0];
  return { png: rgba.buffer, segundos: r.segundos };
}

/**
 * Genera un asset con una semilla. `dir` = carpeta de salida (null = assets/).
 * Devuelve la ruta final.
 */
async function generar(a, semilla, dir) {
  const flujo = flujoDe(a);
  const sufijo = dir && modoCandidatas ? `-s${semilla}` : "";
  const nombre = `${a.id}${sufijo}`;
  const destino = dir ? path.join(dir, `${nombre}.webp`) : rutaDe(a);
  const { png, segundos, valores } = await pasada(a, semilla);
  let workflow = `tools/workflows/${flujo}.json`;
  const modelos = [...MODELOS[flujo].modelos];
  const licencias = new Set([MODELOS[flujo].licencia]);
  const extra = {};
  let total = segundos;

  if (a.estilo === "retrato") {
    guardar(png, destino, CALIDAD_WEBP);
  } else if (a.estilo === "token" || a.estilo === "tile") {
    // Crudo (sobre gris liso), recorte con alfa y, si es token, el círculo.
    const crudo = dir ? path.join(dir, "fondo", `${nombre}.webp`) : path.join(CRUDO_TOKENS, "fondo", `${a.id}.webp`);
    if (a.estilo === "token") guardar(png, crudo, CALIDAD_WEBP);
    const cut = await recortar(png, `${a.estilo}-${nombre}`);
    total += cut.segundos;
    workflow += " + tools/workflows/recortar-birefnet.json";
    modelos.push(...MODELOS["recortar-birefnet"].modelos);
    licencias.add(MODELOS["recortar-birefnet"].licencia);
    if (a.estilo === "token") {
      const alfa = dir ? path.join(dir, "alfa", `${nombre}.png`) : path.join(CRUDO_TOKENS, `${a.id}.png`);
      fs.mkdirSync(path.dirname(alfa), { recursive: true });
      fs.writeFileSync(alfa, cut.png);
      tokenCircular(alfa, destino);
      workflow += " + tools/tokens.mjs (círculo con anillo)";
      extra.crudo = path.relative(RAIZ, crudo);
      if (flujo.startsWith("editar-")) extra.referencia = path.relative(RAIZ, rutaReferencia(a));
      if (a.figura) {
        extra.figura = { workflow: "tools/workflows/t2i-zimage.json", modelos: MODELOS["t2i-zimage"].modelos, semilla: a.semilla_figura,
          prompt: CONFIG.estilos.retrato.prefijo + a.figura + CONFIG.estilos.retrato.sufijo };
        modelos.push(...MODELOS["t2i-zimage"].modelos);
        workflow = "tools/workflows/t2i-zimage.json (figura de referencia) + " + workflow;
      }
    } else {
      guardar(cut.png, destino, CALIDAD_WEBP);
    }
  } else throw new Error(`${a.id}: estilo «${a.estilo}» no soportado por generar-arte`);

  registrarProcedencia(destino, {
    id: a.id, estilo: a.estilo, modelos, licencia: [...licencias].join(" + "), workflow,
    semilla, parametros: { ancho: valores.ANCHO, alto: valores.ALTO }, ...extra,
    segundos: Math.round(total * 10) / 10, prompt: valores.PROMPT
  });
  return { destino, segundos: total };
}

/* --- main ------------------------------------------------------------------- */

const ASSETS = CONFIG.assets ?? [];

if (tiene("--listar")) {
  for (const a of ASSETS) {
    const p = rutaDe(a);
    const estado = fs.existsSync(p) ? "✓" : "·";
    console.log(`  ${estado} ${a.id.padEnd(18)} ${a.estilo.padEnd(8)} ${flujoDe(a).padEnd(13)} s${String(a.semilla ?? "?").padEnd(6)} ${a.nota ?? ""}`);
  }
  process.exit(0);
}

let cola = ASSETS;
if (soloIds) {
  const faltantes = soloIds.filter(id => !ASSETS.some(a => a.id === id));
  if (faltantes.length) { console.error(`Ids desconocidos: ${faltantes.join(", ")}`); process.exit(1); }
  cola = cola.filter(a => soloIds.includes(a.id));
}
if (soloEstilo) cola = cola.filter(a => a.estilo === soloEstilo);
if (!forzar && !salidaCli) cola = cola.filter(a => !fs.existsSync(rutaDe(a)));
// Los retratos primero: los tokens los usan de referencia. Agrupado por flujo
// para no recargar modelos (un modelo grande por vez).
const ORDEN = { retrato: 0, tile: 1, token: 2 };
cola = [...cola].sort((x, y) => (ORDEN[x.estilo] - ORDEN[y.estilo]) || flujoDe(x).localeCompare(flujoDe(y)));

if (!cola.length) {
  console.log("Nada que generar. Usá --forzar para regenerar, o --listar para ver el estado.");
  process.exit(0);
}

// Las figuras de referencia (Z-Image) se pintan todas antes que los tokens
// (Qwen-Edit): un modelo grande por vez, sin ir y venir entre los dos.
const figuras = cola.filter(a => a.figura && !fs.existsSync(rutaReferencia(a)));
if (figuras.length) {
  console.log(`Figuras de referencia: ${figuras.length}`);
  for (const a of figuras) {
    await cuidarPlaca(`figura ${a.id}`);
    const r = await asegurarFigura(a);
    console.log(`  figura ${a.id} s${a.semilla_figura} ✓ ${r.segundos.toFixed(1)} s  ${path.relative(RAIZ, rutaReferencia(a))}`);
  }
  if (cola.some(a => flujoDe(a) === "editar-qwen")) await liberar(true);
}

const n = cola.reduce((s, a) => s + semillasDe(a).length, 0);
console.log(`Generando ${n} imagen(es) en ComfyUI${salidaCli ? ` → ${salidaCli}` : ""}\n`);

let ok = 0, i = 0;
const fallos = [];
const t0 = Date.now();
for (const a of cola) {
  for (const semilla of semillasDe(a)) {
    i++;
    const etiqueta = `[${i}/${n}] ${a.estilo} ${a.id} s${semilla}`;
    try {
      if (!Number.isInteger(semilla)) throw new Error("el asset no tiene `semilla` fija");
      await cuidarPlaca(etiqueta);
      const r = await generar(a, semilla, salidaCli);
      const kb = Math.round(fs.statSync(r.destino).size / 1024);
      console.log(`${etiqueta.padEnd(40)} ✓ ${r.segundos.toFixed(1).padStart(5)} s ${String(kb).padStart(5)} KB  ${path.relative(RAIZ, r.destino)}`);
      ok++;
    } catch (err) {
      console.log(`${etiqueta.padEnd(40)} ✗ ${err.message}`);
      fallos.push({ id: a.id, error: err.message });
    }
  }
}

console.log(`\n${ok} generada(s), ${fallos.length} fallida(s) en ${Math.round((Date.now() - t0) / 1000)} s.`);
if (vigilar) console.log(`Estado final: ${fmt(estadoHardware())}. Pausas: ${pausas.length ? pausas.map(p => `${p.etiqueta} (${p.segundos} s)`).join("; ") : "ninguna"}.`);
if (tiene("--liberar")) { await liberar(true); console.log("VRAM liberada (POST /free)."); }
if (fallos.length) {
  for (const f of fallos) console.error(`  ${f.id}: ${f.error}`);
  console.error(`\nReintentá con: node tools/generar-arte.mjs --solo ${[...new Set(fallos.map(f => f.id))].join(",")}`);
  process.exit(1);
}

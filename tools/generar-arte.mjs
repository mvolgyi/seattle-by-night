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
 *   --gpu <lim>,<reanuda>  umbrales de temperatura en °C (por defecto 80,70).
 *   --ram <lim>,<reanuda>  umbrales de RAM disponible en GB (por defecto 8,12).
 *   --config <archivo>     tanda extra encima de arte.config.json sin tocarlo
 *       (p. ej. tools/arte.tanda2.json): `estilos` NUEVOS y `assets`; un asset con
 *       el mismo id y estilo que uno del config reemplaza al de base.
 *   --referencia <archivo> (tokens, sólo con --salida) usa esa imagen como retrato
 *       de referencia en vez de assets/retratos/<id>.webp, y nombra la salida como
 *       la referencia: así cada retrato candidato tiene su token al lado.
 *   --reanudar       con --salida, saltea las candidatas que ya existen.
 *   --simular        no llama a ComfyUI ni mira la placa: lista qué generaría
 *       (flujo, tamaño, semilla, destino, referencia y prompt completo).
 *   --px-por-m <n>   tiles con `metros`: escala final (por defecto 100, MAPS_SPEC §4).
 *   --fuerza X --fin X --denoise X   tiles con `esquema`: pisan strength y
 *       end_percent del ControlNet y el denoise (pruebas; lo fijo va en el asset).
 *       Con --simular y --salida, el esquema se dibuja en <salida>/esquema/ sin GPU.
 *
 * Un estilo puede declarar `tipo` (retrato, token o tile): así un estilo nuevo
 * (tile-vehiculo, portada…) reutiliza el camino de uno existente.
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
 * Tile:    t2i-zimage → BiRefNet → assets/tiles/<id>.webp (con alfa). Si el
 *          asset trae `metros: [ancho, alto]` (el rectángulo SIN rotar del tile,
 *          como lo arma tools/contenido/escenas.mjs), se recorta al contenido y
 *          se lleva a ancho×alto × 100 px, centrado sobre transparente.
 *          Con `esquema` (ver «esquemas de tiles» más abajo), en vez de t2i se
 *          dibuja un esquema cenital y se pinta con Z-Image Turbo + Fun ControlNet
 *          Union (plano-zimage); el estilo puede traer `prefijo_esquema`. Con
 *          `girar` (grados) el recorte se gira antes de escalar.
 *
 * El camino retrato (sin recorte) sirve también para la portada (`tipo: retrato`).
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

// --config <archivo>: estilos nuevos y assets encima de arte.config.json. Los
// estilos de base no se pisan (son el contrato del set); los assets con el mismo
// id+estilo sí: así se prueban prompts corregidos sin tocar los publicados.
{
  const i = process.argv.indexOf("--config");
  if (i >= 0) {
    const archivo = path.resolve(process.argv[i + 1] ?? "");
    const extra = JSON.parse(fs.readFileSync(archivo, "utf8"));
    for (const [k, v] of Object.entries(extra.estilos ?? {})) {
      if (CONFIG.estilos[k]) throw new Error(`${path.basename(archivo)}: el estilo «${k}» ya existe en arte.config.json; usá otro nombre`);
      CONFIG.estilos[k] = v;
    }
    const clave = a => `${a.id}|${a.estilo}`;
    const nuevos = new Map((extra.assets ?? []).map(a => [clave(a), a]));
    CONFIG.assets = [...(CONFIG.assets ?? []).filter(a => !nuevos.has(clave(a))), ...nuevos.values()];
  }
}

/* --- modelos por workflow (tools/MODELOS.md) -------------------------------- */

const MODELOS = {
  "t2i-zimage": { modelos: ["z_image_turbo_bf16.safetensors", "qwen_3_4b.safetensors", "z_image_ae.safetensors"], licencia: "Apache 2.0" },
  // Tiles con `esquema`: Z-Image Turbo + Fun ControlNet Union sobre el esquema cenital (el mismo workflow que los planos).
  "plano-zimage": { modelos: ["z_image_turbo_bf16.safetensors", "qwen_3_4b.safetensors", "z_image_ae.safetensors", "Z-Image-Turbo-Fun-Controlnet-Union-2.1-2602-8steps.safetensors"], licencia: "Apache 2.0" },
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
const simular = tiene("--simular");
const vigilar = !tiene("--sin-vigilar") && !simular;
const reanudar = tiene("--reanudar");
const referenciaCli = valor("--referencia") ? path.resolve(valor("--referencia")) : null;
const pxPorM = Number(valor("--px-por-m") ?? 100);
if (referenciaCli && !salidaCli) {
  console.error("--referencia va con --salida: no se escribe en assets/ un token de un retrato que no está publicado.");
  process.exit(1);
}

/* --- rutas y prompts -------------------------------------------------------- */

const estiloDe = a => {
  const e = CONFIG.estilos[a.estilo];
  if (!e) throw new Error(`${a.id}: estilo desconocido «${a.estilo}»`);
  return e;
};
/** Camino de generación: retrato (t2i tal cual), token o tile. Un estilo nuevo lo declara con `tipo`. */
const tipoDe = a => estiloDe(a).tipo ?? a.estilo;
const flujoDe = a => a.esquema ? "plano-zimage" : (a.flujo ?? estiloDe(a).flujo);
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
  const prefijo = a.prefijo
    ?? (a.esquema ? (e.prefijo_esquema ?? e.prefijo)
      : tipoDe(a) === "token" && flujoDe(a) === "t2i-zimage" ? (e.prefijo_t2i ?? e.prefijo) : e.prefijo);
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
const rutaReferencia = a => referenciaCli && tipoDe(a) === "token" ? referenciaCli
  : a.figura
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

const umbrales = (flag, def) => {
  const v = valor(flag)?.split(",").map(Number);
  if (!v) return def;
  if (v.length !== 2 || v.some(n => !Number.isFinite(n))) { console.error(`${flag} espera <límite>,<reanuda>`); process.exit(1); }
  return v;
};
const [LIMITE_GPU, REANUDA_GPU] = umbrales("--gpu", [80, 70]);   // °C: pausa por encima, sigue por debajo
const [LIMITE_RAM, REANUDA_RAM] = umbrales("--ram", [8, 12]);    // GB disponibles: pausa por debajo, sigue por encima
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
  if (a.esquema) {
    if (!a.metros) throw new Error(`${a.id}: un esquema necesita \`metros\``);
    // El esquema queda al lado de las candidatas (con --salida) para revisar el control.
    const dirEsq = salidaCli ? path.join(salidaCli, "esquema") : tmpDir;
    const r = dibujarEsquema(a, valores.ANCHO, valores.ALTO, dirEsq, a.id);
    const p = parametrosEsquema(a);
    valores._silueta = r.silueta;
    Object.assign(valores, { IMAGEN: r.dibujo, CONTROL: r.control, FUERZA: p.fuerza, FIN_CONTROL: p.fin, DENOISE: p.denoise, PASOS: 8 });
  } else if (flujo.startsWith("editar-")) {
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
/** Nombre y ruta de salida de una pasada (con --referencia, el nombre del retrato candidato). */
function salidaDe(a, semilla, dir) {
  const base = referenciaCli && tipoDe(a) === "token" ? path.basename(referenciaCli, path.extname(referenciaCli)) : a.id;
  const nombre = `${base}${dir && modoCandidatas ? `-s${semilla}` : ""}`;
  return { nombre, destino: dir ? path.join(dir, `${nombre}.webp`) : rutaDe(a) };
}

/**
 * Tile a escala: recorta al contenido (limpiando el velo de alfa de BiRefNet,
 * como tools/tokens.mjs) y lo lleva a ancho×alto metros × pxPorM, sin deformar,
 * centrado sobre transparente. Devuelve el tamaño y cuánto llena el objeto.
 */
function escalarTile(pngAlfa, destino, metros) {
  const [w, h] = metros.map(m => Math.max(8, Math.round(m * pxPorM)));
  const recortado = path.join(tmpDir, `escala-${path.basename(destino, ".webp")}.png`);
  execFileSync("magick", [pngAlfa, "-channel", "A", "-level", "8%,100%", "+channel",
    "-background", "none", "-alpha", "background", "-fuzz", "1%", "-trim", "+repage", recortado]);
  const [rw, rh] = execFileSync("magick", ["identify", "-format", "%w %h", recortado]).toString().trim().split(" ").map(Number);
  const k = Math.min(w / rw, h / rh);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  execFileSync("magick", [recortado, "-filter", "Lanczos", "-resize", `${w}x${h}`, "-background", "none",
    "-gravity", "center", "-extent", `${w}x${h}`, "-quality", String(CALIDAD_WEBP), destino]);
  return { px: [w, h], llena: [Math.round((rw * k / w) * 100), Math.round((rh * k / h) * 100)] };
}

/* --- esquemas de tiles (camino controlado, como los planos) ----------------- */

/**
 * Z-Image t2i no entiende «visto desde arriba» para muebles: pinta mesas de
 * perfil con patas, sillas de frente y les agrega un sofá o una caja detrás.
 * Un asset con `esquema` se pinta como los planos: un esquema vectorial cenital
 * de la pieza (a la escala de `metros`) → Z-Image Turbo + Fun ControlNet Union
 * (tools/workflows/plano-zimage.json: control = los cantos del esquema en blanco
 * sobre negro; latente = el esquema relleno, que sólo pesa con denoise < 1) →
 * BiRefNet → escala, igual que el resto de los tiles.
 *
 *   esquema: { tipo, ...parámetros, formas?: [...], fuerza?, fin?, denoise?, llenar? }
 *
 * Todo en METROS sobre el rectángulo SIN rotar del tile (0,0 arriba a la
 * izquierda; respaldo arriba, frente al sur). Tipos (los parámetros tienen
 * valores por defecto razonables):
 *   mesa       tablero: tablas (n de juntas a lo largo del eje largo), marco (m: borde
 *              interior, vidrio o canto cromado), r (radio de las esquinas)
 *   silla      asiento + listón del respaldo arriba: respaldo (m), brazos (m), listones (n)
 *   giratoria  silla de oficina: asiento, respaldo arriba, brazos (m), puntas de la estrella
 *              (estrella: false = sobre un pedestal, sin patas a la vista)
 *   taburete   asiento redondo + aro apoyapiés (aro: grosor en m = aro macizo, colorAro)
 *   sofa       respaldo arriba, brazos a los lados, plazas (n almohadones); sillon = 1 plaza
 *   mecedora   asiento, respaldo arriba y los dos patines finos a los lados
 *   lampara    pantalla vista desde arriba: aro, boca y pliegues radiales
 *   banco      tablas a lo largo; respaldo (m) opcional
 *   rejilla    filas × columnas de piezas iguales (forma circ|rect) sobre una base opcional
 *              (base: "palet" dibuja las tablas de un palé)
 *   libre      sólo `formas`
 * `formas` agrega primitivas a cualquier tipo:
 *   ["rect", x, y, w, h, {r, color, tablas, dir: "h"|"v"}]   ["circ", cx, cy, r, {color}]
 *   ["elipse", cx, cy, rx, ry, {color}]   ["linea", x1, y1, x2, y2]   ["poli", [[x, y], …], {color, abierta}]
 * Opciones de cualquier forma: sinRelleno (sólo el canto), hueco (agujero: fondo
 * en el dibujo, negro en la silueta).
 * `color` sólo tiñe el dibujo (latente); el control son sólo los cantos. `ruido`
 * (0–1) agrega grano al dibujo; pesa sólo con denoise < 1.
 */
// Prueba de 2026-10-31 (mesa-cocina, silla-madera, taburete, mecedora): fuerza 0.6
// pierde el control (pinta una mesita dentro de una bandeja); 0.8–1.0 lo siguen
// igual. Con 8 pasos, denoise 0.9 es lo mismo que 1 (ComfyUI hace int(8/0.9) = 8
// pasos y no saltea ninguno) y el modelo tiñe todo del gris pizarra del estilo;
// 0.85 (9 pasos, saltea 1) conserva el color del dibujo. El grano en el latente
// (ruido 0.2–0.5) inventa cuadrículas, figuritas y mapas: va en 0.
const ESQUEMA_DEFECTO = { fuerza: 0.85, fin: 1, denoise: 0.85, llenar: 0.8, ruido: 0 };
const ESQ_CLI = { fuerza: valor("--fuerza"), fin: valor("--fin"), denoise: valor("--denoise") };

function formasEsquema(es, [W, H]) {
  const f = [], m = Math.min(W, H);
  const rect = (x, y, w, h, o = {}) => f.push(["rect", x, y, w, h, o]);
  const circ = (cx, cy, r, o = {}) => f.push(["circ", cx, cy, r, o]);
  const linea = (x1, y1, x2, y2) => f.push(["linea", x1, y1, x2, y2]);
  const c = es.color;
  switch (es.tipo) {
    case "mesa": {
      rect(0, 0, W, H, { r: es.r ?? 0.02, color: c, tablas: es.tablas ?? 0 });
      if (es.marco) rect(es.marco, es.marco, W - 2 * es.marco, H - 2 * es.marco, { r: es.r ?? 0.02, sinRelleno: true });
      break;
    }
    case "silla": {
      const rb = es.respaldo ?? 0.07, ab = es.brazos ?? 0;
      rect(ab ? 0 : 0.02, rb * 0.6, ab ? W : W - 0.04, H - rb * 0.6, { r: 0.03, color: c, tablas: es.tablas ?? 0, dir: "v" });
      if (ab) { rect(0, rb, ab, H * 0.75 - rb, { r: 0.015, color: c }); rect(W - ab, rb, ab, H * 0.75 - rb, { r: 0.015, color: c }); }
      rect(0, 0, W, rb, { r: 0.015, color: es.colorRespaldo ?? c });
      for (let i = 1; i <= (es.listones ?? 0); i++) { const x = W * i / ((es.listones ?? 0) + 1); linea(x, 0, x, rb); }
      break;
    }
    case "giratoria": {
      const cx = W / 2, cy = H * 0.55, R = m * 0.49;
      for (let i = 0; i < (es.estrella === false ? 0 : 5); i++) {
        const t = -Math.PI / 2 + Math.PI / 5 + i * 2 * Math.PI / 5;
        const px = cx + Math.cos(t) * R * 0.88, py = cy + Math.sin(t) * R * 0.88;
        f.push(["poli", [[cx + Math.cos(t + 0.5) * R * 0.3, cy + Math.sin(t + 0.5) * R * 0.3], [px, py], [cx + Math.cos(t - 0.5) * R * 0.3, cy + Math.sin(t - 0.5) * R * 0.3]], { color: es.colorBase ?? "#3a3c40" }]);
        circ(px, py, m * 0.045, { color: "#222" });
      }
      const ab = es.brazos ?? 0;
      rect(W * 0.17, H * 0.28, W * 0.66, H * 0.6, { r: m * 0.1, color: c });
      if (ab) { rect(W * 0.17 - ab, H * 0.3, ab, H * 0.38, { r: ab / 2, color: es.colorBrazos ?? "#2a2a2a" }); rect(W * 0.83, H * 0.3, ab, H * 0.38, { r: ab / 2, color: es.colorBrazos ?? "#2a2a2a" }); }
      rect(W * 0.14, H * 0.04, W * 0.72, es.respaldo ?? H * 0.2, { r: m * 0.06, color: es.colorRespaldo ?? c });
      break;
    }
    case "taburete": {
      const R = m / 2;
      if (es.aro) {
        // Aro grueso y macizo (m): uno fino de dos líneas BiRefNet lo pierde.
        circ(W / 2, H / 2, R * 0.98, { color: es.colorAro ?? "#3a3c40" });
        circ(W / 2, H / 2, R * 0.98 - es.aro, { hueco: true });
      } else {
        circ(W / 2, H / 2, R * 0.98, { sinRelleno: true });
        circ(W / 2, H / 2, R * 0.9, { sinRelleno: true });
      }
      circ(W / 2, H / 2, R * (es.asiento ?? 0.72), { color: c });
      break;
    }
    case "sofa": case "sillon": {
      const rb = es.respaldo ?? Math.min(0.25, H * 0.26), ab = es.brazos ?? Math.min(0.2, W * 0.12);
      const n = es.plazas ?? (es.tipo === "sillon" ? 1 : 3), r = es.r ?? 0.05;
      rect(0, 0, W, H, { r, color: c });
      rect(0, 0, W, rb, { r, color: c });
      rect(0, 0, ab, H, { r, color: c });
      rect(W - ab, 0, ab, H, { r, color: c });
      const sw = (W - 2 * ab) / n;
      for (let i = 0; i < n; i++) {
        rect(ab + i * sw + 0.01, rb + 0.01, sw - 0.02, H - rb - 0.03, { r: 0.04, color: c });
        if (es.almohadonesRespaldo !== false) rect(ab + i * sw + 0.01, rb * 0.25, sw - 0.02, rb * 0.75, { r: 0.04, color: c });
      }
      break;
    }
    case "mecedora": {
      const pw = es.patin ?? 0.035, ab = es.brazos ?? 0.06;
      // Patines: más largos que la silla, de arriba abajo, finos.
      rect(0.01, 0, pw, H, { r: pw / 2, color: es.colorPatines ?? c });
      rect(W - 0.01 - pw, 0, pw, H, { r: pw / 2, color: es.colorPatines ?? c });
      const x0 = 0.01 + pw + 0.02, x1 = W - 0.01 - pw - 0.02;
      rect(x0 + ab * 0.6, H * 0.2, x1 - x0 - ab * 1.2, H * 0.55, { r: 0.04, color: es.colorAsiento ?? c });
      rect(x0, H * 0.16, ab, H * 0.48, { r: 0.02, color: c });
      rect(x1 - ab, H * 0.16, ab, H * 0.48, { r: 0.02, color: c });
      rect(x0 + 0.02, H * 0.1, x1 - x0 - 0.04, es.respaldo ?? 0.06, { r: 0.02, color: c });
      for (let i = 1; i <= (es.listones ?? 4); i++) { const x = x0 + 0.02 + (x1 - x0 - 0.04) * i / ((es.listones ?? 4) + 1); linea(x, H * 0.1, x, H * 0.1 + (es.respaldo ?? 0.06)); }
      break;
    }
    case "lampara": {
      const R = m / 2 * 0.96, cx = W / 2, cy = H / 2, boca = es.boca ?? 0.55;
      if (es.base) circ(cx, cy, R, { color: "#3a3a3a" });
      const Rp = es.base ? R * 0.88 : R;
      circ(cx, cy, Rp, { color: c });
      circ(cx, cy, Rp * boca, { color: es.colorInterior ?? "#2b2824" });
      circ(cx, cy, Rp * 0.14, { color: "#9a9a9a" });
      const n = es.pliegues ?? 24;
      for (let i = 0; i < n; i++) {
        const t = i * 2 * Math.PI / n;
        linea(cx + Math.cos(t) * Rp * boca, cy + Math.sin(t) * Rp * boca, cx + Math.cos(t) * Rp * 0.99, cy + Math.sin(t) * Rp * 0.99);
      }
      break;
    }
    case "banco": {
      const rb = es.respaldo ?? 0, g = rb ? 0.04 : 0;
      if (rb) rect(0, 0, W, rb, { r: 0.015, color: c, tablas: 1 });
      rect(0, rb + g, W, H - rb - g, { r: 0.015, color: c, tablas: es.tablas ?? 2 });
      break;
    }
    case "rejilla": {
      const filas = es.filas ?? 2, cols = es.columnas ?? 2, mg = es.margen ?? 0.04, hueco = es.hueco ?? 0.02;
      if (es.base === "palet") {
        rect(0, 0, W, H, { color: es.colorBase ?? "#8a6a45", tablas: es.tablasBase ?? 7, dir: "v" });
      } else if (es.base) rect(0, 0, W, H, { r: 0.02, color: es.colorBase });
      const cw = (W - 2 * mg - (cols - 1) * hueco) / cols, ch = (H - 2 * mg - (filas - 1) * hueco) / filas;
      for (let i = 0; i < filas; i++) for (let j = 0; j < cols; j++) {
        const x = mg + j * (cw + hueco), y = mg + i * (ch + hueco);
        if ((es.forma ?? "rect") === "circ") {
          const r = Math.min(cw, ch) / 2;
          circ(x + cw / 2, y + ch / 2, r, { color: c });
          if (es.aro !== false) circ(x + cw / 2, y + ch / 2, r * 0.86, { sinRelleno: true });
          if (es.tapon) circ(x + cw / 2 + r * 0.45, y + ch / 2 - r * 0.35, r * 0.1, { color: "#333" });
        } else {
          rect(x, y, cw, ch, { r: 0.01, color: c, tablas: es.tablas ?? 0, dir: es.dir });
          if (es.cinta) linea(x + cw / 2, y, x + cw / 2, y + ch);
        }
      }
      break;
    }
    case "libre": break;
    default: throw new Error(`esquema: tipo desconocido «${es.tipo}»`);
  }
  f.push(...(es.formas ?? []));
  return f;
}

/**
 * SVG del esquema. modo "dibujo" (relleno gris claro, cantos oscuros), "control"
 * (cantos blancos sobre negro) o "silueta" (lo macizo en blanco sobre negro; las
 * formas con `hueco: true` en negro, como el centro del aro de un taburete).
 */
function svgEsquema(es, metros, W, H, modo) {
  const [mw, mh] = metros;
  const k = Math.min((es.llenar ?? ESQUEMA_DEFECTO.llenar) * W / mw, (es.llenar ?? ESQUEMA_DEFECTO.llenar) * H / mh);
  const ox = (W - mw * k) / 2, oy = (H - mh * k) / 2;
  const X = v => (ox + v * k).toFixed(1), Y = v => (oy + v * k).toFixed(1), L = v => (v * k).toFixed(1);
  const ctl = modo === "control", sil = modo === "silueta";
  const trazo = sil ? "none" : ctl ? "#fff" : "#1c1c1c", grueso = Math.max(3, Math.round(Math.min(W, H) / 300)), fino = Math.max(2, grueso - 1);
  // En el control, relleno negro: cada forma tapa los cantos de las que tiene debajo.
  const pinta = o => o.sinRelleno ? "none" : o.hueco ? (ctl || sil ? "#000" : "#c8c8c8")
    : sil ? "#fff" : ctl ? "#000" : (o.color ?? "#6e7178");
  const o = [`<rect width="100%" height="100%" fill="${ctl || sil ? "#000" : "#c8c8c8"}"/>`];
  for (const [t, ...p] of formasEsquema(es, metros)) {
    if (t === "rect") {
      const [x, y, w, h, op = {}] = p;
      o.push(`<rect x="${X(x)}" y="${Y(y)}" width="${L(w)}" height="${L(h)}" rx="${L(op.r ?? 0)}" fill="${pinta(op)}" stroke="${trazo}" stroke-width="${grueso}"/>`);
      const n = op.tablas ?? 0;
      const vertical = op.dir ? op.dir === "v" : h > w;
      for (let i = 1; i <= n; i++) {
        if (vertical) { const xx = x + w * i / (n + 1); o.push(`<line x1="${X(xx)}" y1="${Y(y)}" x2="${X(xx)}" y2="${Y(y + h)}" stroke="${trazo}" stroke-width="${fino}"/>`); }
        else { const yy = y + h * i / (n + 1); o.push(`<line x1="${X(x)}" y1="${Y(yy)}" x2="${X(x + w)}" y2="${Y(yy)}" stroke="${trazo}" stroke-width="${fino}"/>`); }
      }
    } else if (t === "circ") {
      const [cx, cy, r, op = {}] = p;
      o.push(`<circle cx="${X(cx)}" cy="${Y(cy)}" r="${L(r)}" fill="${pinta(op)}" stroke="${trazo}" stroke-width="${grueso}"/>`);
    } else if (t === "elipse") {
      const [cx, cy, rx, ry, op = {}] = p;
      o.push(`<ellipse cx="${X(cx)}" cy="${Y(cy)}" rx="${L(rx)}" ry="${L(ry)}" fill="${pinta(op)}" stroke="${trazo}" stroke-width="${grueso}"/>`);
    } else if (t === "linea") {
      const [x1, y1, x2, y2] = p;
      if (sil) continue;
      o.push(`<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}" stroke="${trazo}" stroke-width="${fino}"/>`);
    } else if (t === "poli") {
      const [pts, op = {}] = p;
      const d = pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ");
      if (sil && op.abierta) continue;
      o.push(op.abierta ? `<polyline points="${d}" fill="none" stroke="${trazo}" stroke-width="${fino}"/>`
        : `<polygon points="${d}" fill="${pinta(op)}" stroke="${trazo}" stroke-width="${grueso}"/>`);
    } else throw new Error(`esquema: primitiva desconocida «${t}»`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${o.join("")}</svg>`;
}

/** Dibuja el esquema (dibujo + control) de un asset en `dir`. Devuelve las rutas. */
function dibujarEsquema(a, W, H, dir, nombre) {
  fs.mkdirSync(dir, { recursive: true });
  const rutas = {};
  for (const modo of ["dibujo", "control", "silueta"]) {
    const svg = path.join(tmpDir, `${nombre}-${modo}.svg`);
    fs.writeFileSync(svg, svgEsquema(a.esquema, a.metros, W, H, modo));
    rutas[modo] = path.join(dir, `${nombre}.${modo}.png`);
    // Al dibujo (latente con denoise < 1) se le inyecta grano, como a los mosaicos de
    // pintar-planos: sobre un relleno liso, Z-Image pinta superficies planas sin textura.
    const ruido = a.esquema.ruido ?? ESQUEMA_DEFECTO.ruido;
    execFileSync("magick", [svg, ...(modo !== "dibujo" ? ["-colorspace", "gray"]
      : ruido ? ["-seed", "1", "-attenuate", String(ruido), "+noise", "Gaussian"] : []), rutas[modo]]);
  }
  return rutas;
}

/**
 * BiRefNet deja semitransparente lo que se parece al fondo gris (un sofá de lana
 * gris claro, el almohadón de la mecedora) y pierde lo muy fino (el aro de un
 * taburete). El esquema es la silueta exacta (el ControlNet la sigue), así que
 * el alfa final es el máximo entre el de BiRefNet y la silueta erosionada un
 * poco (para no traer el borde del fondo). `macizo: false` lo apaga.
 */
function macizar(pngAlfa, silueta) {
  const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", pngAlfa]).toString().trim().split(" ").map(Number);
  const r = Math.max(2, Math.round(Math.min(w, h) / 200));
  const base = pngAlfa.replace(/\.png$/, "");
  execFileSync("magick", [pngAlfa, "-alpha", "extract", `${base}-a.png`]);
  execFileSync("magick", [`${base}-a.png`, "(", silueta, "-resize", `${w}x${h}!`, "-threshold", "50%", "-morphology", "Erode", `Disk:${r}`, ")",
    "-compose", "Lighten", "-composite", `${base}-a.png`]);
  execFileSync("magick", [pngAlfa, "-alpha", "off", `${base}-a.png`, "-compose", "CopyOpacity", "-composite", pngAlfa]);
  fs.rmSync(`${base}-a.png`, { force: true });
}

const parametrosEsquema = a => {
  const num = (cli, propio, def) => Number(cli ?? propio ?? def);
  return {
    fuerza: num(ESQ_CLI.fuerza, a.esquema.fuerza, ESQUEMA_DEFECTO.fuerza),
    fin: num(ESQ_CLI.fin, a.esquema.fin, ESQUEMA_DEFECTO.fin),
    denoise: num(ESQ_CLI.denoise, a.esquema.denoise, ESQUEMA_DEFECTO.denoise)
  };
};

async function generar(a, semilla, dir) {
  const flujo = flujoDe(a), tipo = tipoDe(a);
  const { nombre, destino } = salidaDe(a, semilla, dir);
  const { png, segundos, valores } = await pasada(a, semilla);
  let workflow = `tools/workflows/${flujo}.json`;
  const modelos = [...MODELOS[flujo].modelos];
  const licencias = new Set([MODELOS[flujo].licencia]);
  const extra = {};
  let total = segundos;

  if (tipo === "retrato") {
    guardar(png, destino, CALIDAD_WEBP);
  } else if (tipo === "token" || tipo === "tile") {
    // Crudo (sobre gris liso), recorte con alfa y, si es token, el círculo.
    const crudo = dir ? path.join(dir, "fondo", `${nombre}.webp`) : path.join(CRUDO_TOKENS, "fondo", `${a.id}.webp`);
    if (tipo === "token" || dir) guardar(png, crudo, CALIDAD_WEBP);
    const cut = await recortar(png, `${a.estilo}-${nombre}`);
    total += cut.segundos;
    workflow += " + tools/workflows/recortar-birefnet.json";
    modelos.push(...MODELOS["recortar-birefnet"].modelos);
    licencias.add(MODELOS["recortar-birefnet"].licencia);
    if (tipo === "token") {
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
    } else if (a.metros) {
      // El alfa a resolución de generación queda al lado (con --salida) por si
      // hay que reexportar a otra escala sin volver a pintar.
      const alfa = path.join(dir ?? tmpDir, "alfa", `${nombre}.png`);
      fs.mkdirSync(path.dirname(alfa), { recursive: true });
      fs.writeFileSync(alfa, cut.png);
      // `girar` (grados, horario): un vehículo horizontal sale mejor pintado en
      // vertical (frente abajo) y girado después (-90 → frente a la derecha).
      if (a.esquema && a.esquema.macizo !== false) macizar(alfa, valores._silueta);
      if (a.girar) execFileSync("magick", [alfa, "-background", "none", "-rotate", String(a.girar), "+repage", alfa]);
      const esc = escalarTile(alfa, destino, a.metros);
      workflow += `${a.girar ? ` + magick (giro ${a.girar}°)` : ""} + magick (recorte y escala a ${pxPorM} px/m)`;
      if (a.esquema) {
        extra.esquema = { ...a.esquema, ...parametrosEsquema(a), control: "cantos del esquema vectorial (generar-arte.mjs, svgEsquema)",
          alfa: a.esquema.macizo === false ? "BiRefNet" : "máx(BiRefNet, silueta del esquema erosionada)" };
        if (dir) extra.control = path.relative(RAIZ, path.join(dir, "esquema", `${a.id}.control.png`));
      }
      extra.metros = a.metros;
      extra.escala = { px_por_m: pxPorM, px: esc.px, llena_pct: esc.llena };
      if (dir) { extra.crudo = path.relative(RAIZ, crudo); extra.alfa = path.relative(RAIZ, alfa); }
    } else {
      guardar(cut.png, destino, CALIDAD_WEBP);
    }
  } else throw new Error(`${a.id}: tipo «${tipo}» no soportado por generar-arte`);

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
cola = [...cola].sort((x, y) => (ORDEN[tipoDe(x)] - ORDEN[tipoDe(y)]) || flujoDe(x).localeCompare(flujoDe(y)));

if (!cola.length) {
  console.log("Nada que generar. Usá --forzar para regenerar, o --listar para ver el estado.");
  process.exit(0);
}

// --simular: lo que se mandaría, sin ComfyUI ni vigilancia de la placa.
if (simular) {
  let n = 0;
  for (const a of cola) {
    const e = estiloDe(a), flujo = flujoDe(a);
    for (const semilla of semillasDe(a)) {
      n++;
      const { destino } = salidaDe(a, semilla, salidaCli);
      const ya = reanudar && salidaCli && fs.existsSync(destino) ? "  (ya existe: se saltea)" : "";
      console.log(`[${n}] ${a.estilo} ${a.id} s${semilla}  ${flujo}  ${a.ancho ?? e.ancho}×${a.alto ?? e.alto}` +
        `${a.metros ? `  → ${a.metros.join("×")} m = ${a.metros.map(m => Math.max(8, Math.round(m * pxPorM))).join("×")} px` : ""}${ya}`);
      console.log(`    destino: ${path.relative(RAIZ, destino)}`);
      if (a.esquema && salidaCli) {
        // Sin GPU: el esquema sí se dibuja, para revisarlo antes de pintar.
        const r = dibujarEsquema(a, a.ancho ?? e.ancho, a.alto ?? e.alto, path.join(salidaCli, "esquema"), a.id);
        console.log(`    esquema: ${a.esquema.tipo} ${JSON.stringify(parametrosEsquema(a))} → ${path.relative(RAIZ, r.control)}`);
      }
      if (flujo.startsWith("editar-")) {
        const ref = rutaReferencia(a);
        console.log(`    referencia: ${path.relative(RAIZ, ref)}${fs.existsSync(ref) ? "" : "  (todavía no existe)"}`);
      }
      console.log(`    prompt: ${promptDe(a).replace(/\n+/g, " ¶ ")}`);
    }
  }
  console.log(`\nSimulación: ${n} imagen(es); no se mandó nada a ComfyUI.`);
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
    if (reanudar && salidaCli && fs.existsSync(salidaDe(a, semilla, salidaCli).destino)) {
      console.log(`${etiqueta.padEnd(40)} = ya está (--reanudar)`);
      ok++;
      continue;
    }
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

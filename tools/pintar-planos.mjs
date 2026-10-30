#!/usr/bin/env node
/**
 * Pinta un plano vectorial con un modelo LOCAL (ComfyUI) sin perder la
 * geometría. Port de `pintar-planos.mjs` de DVV (que usaba Gemini).
 *
 *   1. Renderizar el esquema desde el plano (tools/planos.mjs) y llevarlo a un
 *      lienzo de ~1,5 MP con la proporción del plano (múltiplos de 16).
 *   2. Repintarlo por uno de tres caminos (SPEC.md §4.5):
 *        qwen        Qwen-Image-Edit-2511 (workflow plano-qwen): edición con el
 *                    esquema como referencia al tamaño exacto de salida.
 *        klein       FLUX.2 [klein] 4B (plano-klein): ídem, más liviano.
 *        controlnet  Z-Image Turbo + Fun ControlNet Union 2.1 (plano-zimage):
 *                    texto a imagen guiado por un control preprocesado
 *                    (`--control lineas|canny|gris`), opcionalmente partiendo
 *                    del latente del esquema (`--denoise` < 1).
 *   3. (opcional, `--escalar`) SeedVR2 al tamaño del plano.
 *   4. Detectar los muros en el resultado y reescalar para que caigan EXACTO
 *      sobre las coordenadas del plano (corrección afín por eje, como DVV).
 *   5. Medir: anisotropía y calidad de la superposición (DVV), deriva de cada
 *      muro tras corregir (px), contraste de los vanos (¿los cerró?) y
 *      saturación/luminancia (MAPS_SPEC §5).
 *
 * El paso 4 es lo que lo hace utilizable: el modelo deja deriva anisotrópica
 * y corre el encuadre; corregido, los muros de Foundry caen sobre los pintados.
 *
 * Consistencia del set: el mapa `referencia` de arte.config.json fija el look;
 * a los demás se les pasa un recorte suyo como segunda imagen (Qwen/klein).
 *
 * Uso:
 *   node tools/pintar-planos.mjs --solo helen --camino qwen --semilla 11
 *   node tools/pintar-planos.mjs --solo helen --camino controlnet --semilla 1,2,3 --salida /tmp/prueba
 *   node tools/pintar-planos.mjs --solo helen --camino qwen --semilla 11 --escalar --reusar-crudo --salida /tmp/prueba
 *
 * Opciones:
 *   --camino qwen|klein|controlnet   (default: el de `mapas.<id>.camino` en arte.config.json, o qwen)
 *   --semilla N[,N…]                 (default: `mapas.<id>.semilla`, o 1)
 *   --escalar                        SeedVR2 antes de corregir (--escalador 3b|7b, default 3b)
 *   --salida <carpeta>               pruebas: escribe <id>-<camino>-s<semilla><sufijo>.webp ahí
 *                                    (sin --salida escribe assets/mapas/<id>.webp)
 *   --sufijo <txt>                   para distinguir variantes en --salida
 *   --mp 1.5                         megapíxeles de la entrada al modelo
 *   --sin-lightning                  qwen: 20 pasos, cfg 4, sin el LoRA (≈7× más lento)
 *   --denoise X                      qwen/controlnet: < 1 parte del latente del esquema (img2img)
 *   --control lineas|canny|gris      controlnet: qué control se le pasa (default lineas)
 *   --fuerza X --fin X               controlnet: strength y end_percent del control
 *   --referencia <id>|no             mapa de referencia de estilo (default: arte.config.json)
 *   --macizo plano|rayado            cómo entran al modelo los bloques cerrados (default plano)
 *   --entrada esquema|lineas         qwen/klein: el esquema pintado o un dibujo de líneas desde el plano
 *   --no-sellar                      no tapa los bloques cerrados con el macizo liso (retoque determinista)
 *   --reusar-crudo                   no regenera si ya existe el crudo de esa salida
 *   --forzar                         pisa assets/mapas/<id>.webp
 *   --ver-prompt                     imprime el prompt y sale
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { renderSvg, normalizar, esMovil, derivarMuros, PX_POR_M } from "./planos.mjs";
import { cargarPlanos } from "./construir-planos.mjs";
import { cargarWorkflow, ejecutar, guardar, registrarProcedencia } from "./comfy.mjs";

const RAIZ = path.resolve(import.meta.dirname, "..");
const MAPAS = path.join(RAIZ, "assets/mapas");
const RUTA_CONFIG = path.join(RAIZ, "tools/arte.config.json");
const CONFIG = JSON.parse(fs.readFileSync(RUTA_CONFIG, "utf8"));
const E = CONFIG.estilos.battlemap;
const LIMITE_ANISOTROPIA = 3;     // % de deriva tolerable tras corregir
// Superposición mínima de perfiles de muro (1 = idéntico). DVV usaba 0,35, pero
// en helen un resultado basura (Qwen sin Lightning, semilla 22: pintó un mueble
// de TV en perspectiva) dio 0,39; los buenos dan 0,7–1,35 (0,53–0,56 después de
// SeedVR2, que afila los cantos y cambia los perfiles).
const CALIDAD_MINIMA = 0.45;
const DERIVA_MINIMA = 90;         // % de longitud de muro que cae a ≤ TOLERANCIA_PX
const TOLERANCIA_PX = 5;          // MAPS_SPEC §7: el muro pintado cae a ≤ 5 px del plano

/* -------------------------------------------- */
/*  Caminos                                     */
/* -------------------------------------------- */

const APACHE = "Apache 2.0";
const CAMINOS = {
  qwen: {
    workflow: "plano-qwen",
    modelos: ["qwen-image-edit-2511-Q5_K_M.gguf", "qwen_2.5_vl_7b_fp8_scaled.safetensors", "qwen_image_vae.safetensors"],
    lora: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"
  },
  klein: {
    workflow: "plano-klein",
    modelos: ["flux-2-klein-4b.safetensors", "qwen_3_4b.safetensors", "flux2-vae.safetensors"]
  },
  controlnet: {
    workflow: "plano-zimage",
    modelos: ["z_image_turbo_bf16.safetensors", "qwen_3_4b.safetensors", "z_image_ae.safetensors",
      "Z-Image-Turbo-Fun-Controlnet-Union-2.1-2602-8steps.safetensors"]
  }
};
const ESCALADOR = { workflow: "escalar-seedvr2", modelos: ["seedvr2_3b_fp16.safetensors", "seedvr2_ema_vae_fp16.safetensors"] };
const SEEDVR2 = { "3b": "seedvr2_3b_fp16.safetensors", "7b": "seedvr2_7b_fp8_e4m3fn.safetensors" };

/* -------------------------------------------- */
/*  Prompt: la planta habitación por habitación  */
/* -------------------------------------------- */

const MAT = E.materiales, OBJ = E.objetos;
const r1 = v => Math.round(v * 10) / 10;

/** Posición en palabras dentro del lienzo (3×3) y en porcentaje. */
function donde(xm, ym, marco) {
  const fx = (xm * PX_POR_M + marco.dx) / marco.W, fy = (ym * PX_POR_M + marco.dy) / marco.H;
  const h = fx < 1 / 3 ? "left" : fx < 2 / 3 ? "centre" : "right";
  const v = fy < 1 / 3 ? "upper" : fy < 2 / 3 ? "middle" : "lower";
  const zona = v === "middle" && h === "centre" ? "centre" : v === "middle" ? `middle-${h}` : h === "centre" ? `${v}-centre` : `${v}-${h}`;
  return `${zona} of the image, centred ${Math.round(fx * 100)}% from the left and ${Math.round(fy * 100)}% from the top`;
}

/** Dónde está un mueble dentro de su habitación, en palabras. */
function ubicacion(m, h) {
  const cx = (m.x + m.w / 2 - h.x) / h.w, cy = (m.y + m.h / 2 - h.y) / h.h;
  const pegado = [];
  if (m.y - h.y < 0.35) pegado.push("top");
  if (h.y + h.h - (m.y + m.h) < 0.35) pegado.push("bottom");
  if (m.x - h.x < 0.35) pegado.push("left");
  if (h.x + h.w - (m.x + m.w) < 0.35) pegado.push("right");
  if (m.w >= h.w * 0.8 && m.h >= h.h * 0.6) return `filling the whole room, ${r1(m.w)} × ${r1(m.h)} m`;
  if (pegado.length >= 3) {
    const largo = pegado.includes("top") && pegado.includes("bottom") ? (pegado.includes("left") ? "left" : "right") : (pegado.includes("top") ? "top" : "bottom");
    return `along the whole ${largo} wall, ${r1(m.w)} × ${r1(m.h)} m`;
  }
  const hx = cx < 0.33 ? "left" : cx < 0.67 ? "middle" : "right";
  const vy = cy < 0.33 ? "top" : cy < 0.67 ? "middle" : "bottom";
  const zona = hx === "middle" && vy === "middle" ? "in the middle" : `in the ${vy === "middle" ? "" : vy + "-"}${hx === "middle" ? "centre" : hx} part`;
  const contra = pegado.length ? `against the ${pegado.join(" and ")} wall${pegado.length > 1 ? "s" : ""}, ` : "";
  return `${contra}${zona}, ${r1(m.w)} × ${r1(m.h)} m`;
}

const dentro = (m, h) => {
  const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
  return cx >= h.x && cx <= h.x + h.w && cy >= h.y && cy <= h.y + h.h;
};

/** Qué es la habitación, deducido de su piso y de lo que tiene adentro. */
function rol(h, muebles) {
  const t = new Set(muebles.map(m => m.tipo));
  const area = h.w * h.h;
  if (h.piso === "rejilla") return "an exterior steel fire-escape landing bolted to the outside of the building wall";
  if (t.has("escalera") && !t.has("cama")) return "a stairwell";
  if (t.has("banera") || t.has("inodoro") || t.has("ducha")) return "a small bathroom";
  if (h.sinMuros && (t.has("mesada") || t.has("heladera"))) return "a kitchen strip with no walls of its own, part of the larger room around it";
  if (t.has("cama")) return t.has("escritorio") ? "a bedroom-study" : "a bedroom";
  if (t.has("tv") && (t.has("mesada") || t.has("heladera"))) return "a living room with a kitchen";
  if (t.has("tv")) return "a living room";
  if (t.has("mesada") || t.has("heladera")) return "a kitchen";
  if (h.piso === "tablas-alfombra" || Math.max(h.w, h.h) / Math.min(h.w, h.h) > 3.5) return "a long corridor";
  if (t.size && [...t].every(x => x === "estante")) return "a shallow built-in closet";
  if (area < 6) return "a small entrance hall";
  return "a room";
}

function textoMueble(m) {
  return m.desc ?? OBJ[m.tipo] ?? m.tipo;
}

/** Cuerpo del prompt: sale del plano, no del estilo. */
export function describirPlano(plano, marco, macizo = "plano", entrada = "esquema") {
  const L = entrada === "lineas";
  const pl = normalizar(plano);
  const fijos = (pl.muebles ?? []).filter(m => !esMovil(m));
  // Cada mueble va a la habitación más chica que lo contiene (la cocina sin
  // muros dentro del salón se lleva la mesada).
  const habs = pl.habitaciones.filter(h => h.piso !== "macizo");
  const asignado = new Map();
  for (const m of fijos) {
    const cand = habs.filter(h => dentro(m, h)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (cand) asignado.set(m, cand);
  }
  const lineas = [];
  for (const h of habs) {
    const ms = fijos.filter(m => asignado.get(m) === h);
    const cosas = [];
    const vistos = new Map();
    for (const m of ms) {
      const t = textoMueble(m);
      if (vistos.has(t)) { vistos.get(t).n++; continue; }
      const e = { t, u: ubicacion(m, h), n: 1 };
      vistos.set(t, e); cosas.push(e);
    }
    const lista = cosas.map(c => c.n > 1 ? `${c.t} (${c.n} pieces, exactly where the schematic draws them)` : `${c.t} (${c.u})`).join("; ");
    lineas.push(`- ${rol(h, ms)}, ${r1(h.w)} × ${r1(h.h)} m, in the ${donde(h.x + h.w / 2, h.y + h.h / 2, marco)}. ` +
      `Floor: ${MAT[h.piso] ?? h.piso}.` + (lista ? ` Fixed furniture: ${lista}.` : " Nothing else in it: an empty floor."));
  }

  const sellados = pl.habitaciones.filter(h => h.piso === "macizo");
  const exteriores = (pl.exteriores ?? []).map(z => {
    const ms = fijos.filter(m => !asignado.has(m) && dentro(m, z));
    ms.forEach(m => asignado.set(m, z));
    return `- an outdoor strip at street level, ${r1(z.w)} × ${r1(z.h)} m, in the ${donde(z.x + z.w / 2, z.y + z.h / 2, marco)}: ` +
      `${MAT[z.fondo] ?? z.fondo}` + (ms.length ? `, with ${[...new Set(ms.map(textoMueble))].join(" and ")}` : "") + ".";
  });
  const sueltos = fijos.filter(m => !asignado.has(m));

  const vanos = pl.vanos ?? [];
  const cuenta = (...t) => vanos.filter(v => t.includes(v.tipo)).length;
  const huecos = cuenta("puerta", "abierto", "puerta-vidrio", "secreta");
  const vidrios = cuenta("ventana", "vidrio");
  const barandas = cuenta("baranda");

  const partes = [];
  if (L) partes.push("Picture 1 is a plain black-and-white line drawing of the plan: the white areas are the rooms, the light-grey area is everything outside the building, the dark-grey rectangles are solid off-limits areas, black outlines are walls and the outlines of fixed furniture. Every surface must be painted with real materials and colour: no white and no flat grey may remain.");
  partes.push(`WHAT THE SCHEMATIC SHOWS, ROOM BY ROOM (rooms are described by their position; never write a room name or any label on the map):\n${lineas.join("\n")}`);
  if (sellados.length) {
    // No se las llama «apartments»: con esa palabra klein pinta departamentos enteros adentro.
    partes.push(`SOLID OFF-LIMITS AREAS: the ${sellados.length} large ${L ? "solid dark-grey rectangles" : macizo === "plano" ? "flat, featureless, near-black rectangles" : "rectangles filled with dark diagonal hatching"} ` +
      `(${sellados.map(h => `${r1(h.w)} × ${r1(h.h)} m in the ${donde(h.x + h.w / 2, h.y + h.h / 2, marco).split(",")[0]}`).join("; ")}) ` +
      "are solid, inaccessible masses with no interior, like the solid rock around a dungeon map. " +
      (macizo === "plano"
        ? "Keep each one a flat, featureless, near-black fill with at most a faint even grain, exactly as dark as in the schematic"
        : "Keep each one exactly as it is drawn: a flat, dark charcoal mass covered in fine diagonal hatching") +
      ". Paint NOTHING inside them: no floor, no floorboards, no furniture, no bed, no bathroom, no kitchen, no inner walls, no roof.");
  }
  partes.push(`OPENINGS: there are ${huecos} doorway openings in the walls, each drawn as a gap ${L ? "in the black wall outline" : "with a pale threshold strip and short dashed marks"}: ` +
    "every one stays an empty, open gap of the same width — never close it, never fill it with wall, never put a door leaf in it." +
    (vidrios ? ` The ${vidrios} ${L ? "thin double lines set into the outer walls" : "thin pale-blue strips set into the walls"} are WINDOWS, not lamps (${vanos.filter(v => ["ventana", "vidrio"].includes(v.tipo))
      .map(v => `${r1(v.w)} m wide in the ${donde(v.eje === "h" ? v.x + v.w / 2 : v.x, v.eje === "h" ? v.y : v.y + v.w / 2, marco).split(",")[0]}`).join("; ")}): ` +
      "render each one as a pane of dark, unlit glass in a thin painted wooden frame with a narrow sill, flush with the wall; no light comes through them." : "") +
    (barandas ? ` The ${barandas} ${L ? "thin single lines" : "thin dark lines with small square posts"} are railings (around the fire escape and between the two flights of stairs): keep them thin black iron or wooden railings, never thicken them into walls.` : ""));
  if (exteriores.length || pl.exterior) {
    // «night» enciende farolas y ventanas en los modelos: se saca del texto del plano.
    const fuera = (pl.exterior ?? "wet asphalt").replace(/\s*\bat night\b/gi, "").replace(/\bnight\b/gi, "evening");
    partes.push(`OUTSIDE THE APARTMENTS, continue to all four edges of the image with ${fuera}.` +
      (exteriores.length ? ` Specifically:\n${exteriores.join("\n")}` : "") +
      (sueltos.length ? `\nAlso: ${[...new Set(sueltos.map(textoMueble))].join("; ")}.` : "") +
      "\nNever leave paper, white space or a margin outside the walls.");
  }
  return partes.join("\n\n");
}

/** Prompt completo: prefijo del camino + plano + sufijo del estilo. */
export function prompt(plano, marco, camino, conReferencia, macizo, entrada) {
  const ref = conReferencia
    ? "Picture 2 is a finished map from the same product line, given ONLY as a rendering reference: match its ink line weight, desaturation, coolness, tonal contrast and how furniture is drawn as solid objects; do NOT copy its rooms, layout or props.\n\n"
    : "";
  const pre = camino === "controlnet" ? E.prefijo_control : E.prefijo + ref;
  let cuerpo = describirPlano(plano, marco, macizo, entrada);
  if (camino === "controlnet") cuerpo = cuerpo.replace(/the schematic/g, "the plan");
  return `${pre}${cuerpo}${E.sufijo}`;
}

/* -------------------------------------------- */
/*  Lienzo y entradas                           */
/* -------------------------------------------- */

/**
 * Lienzo que se le manda al modelo: el plano centrado y rellenado con el color
 * del borde hasta la proporción exacta del tamaño de salida (múltiplos de 16,
 * ~`mp` megapíxeles). Si se le manda otra proporción, la estira y eso es
 * anisotropía pura.
 */
export function lienzo(plano, mp = 1.5) {
  const W = plano.ancho * PX_POR_M, H = plano.alto * PX_POR_M, r = W / H;
  let mejor = null;
  for (let h = 512; h <= 2048; h += 16) {
    const w = Math.round((h * r) / 16) * 16;
    const err = Math.abs(Math.log((w / h) / r)) * 4 + Math.abs(w * h / (mp * 1e6) - 1);
    if (!mejor || err < mejor.err) mejor = { w, h, err };
  }
  const { w, h } = mejor;
  const MW = w / h >= r ? Math.round(H * (w / h)) : W;
  const MH = w / h >= r ? H : Math.round(W / (w / h));
  return { ancho: w, alto: h, W: MW, H: MH, dx: (MW - W) / 2, dy: (MH - H) / 2 };
}

function magick(args, opciones = {}) {
  return execFileSync("magick", args, { stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1 << 28, ...opciones });
}

/** Esquema rasterizado a escala del plano (PNG). */
function esquemaPng(plano, destino) {
  const svg = `${destino}.svg`;
  fs.writeFileSync(svg, renderSvg(plano));
  try { magick([svg, destino]); } finally { fs.rmSync(svg, { force: true }); }
  return destino;
}

/**
 * El esquema rellenado hasta la proporción del lienzo. Con `macizo: "plano"`
 * los departamentos cerrados (rayados en el esquema) entran al modelo como un
 * relleno oscuro liso: el rayado lo leen como «cuarto por pintar» e inventan
 * habitaciones adentro (klein lo hizo en la primera prueba).
 */
const COLOR_MACIZO = "#1b1f23";
function lienzoPng(esquema, marco, destino, plano, macizo = "plano") {
  const fondo = magick([esquema, "-format", "%[pixel:p{3,3}]", "info:"], { encoding: "utf8" }).trim();
  const dibujo = [];
  if (macizo === "plano") {
    const m = 15;   // medio muro (27 cm) + 1 px: el relleno no pisa el canto del muro
    for (const h of normalizar(plano).habitaciones.filter(h => h.piso === "macizo")) {
      dibujo.push("-draw", `rectangle ${h.x * PX_POR_M + m},${h.y * PX_POR_M + m} ${(h.x + h.w) * PX_POR_M - m},${(h.y + h.h) * PX_POR_M - m}`);
    }
  }
  magick([esquema, "-fill", COLOR_MACIZO, ...dibujo, "-gravity", "center", "-background", fondo, "-extent", `${marco.W}x${marco.H}`, destino]);
  return destino;
}

/**
 * Control de líneas para ControlNet, dibujado desde el plano (no desde el
 * esquema): bordes blancos sobre negro, a la escala del lienzo. El Canny del
 * esquema ve también las vetas, el rayado y el grano, y pierde los muebles
 * de gris claro; acá van sólo los cantos que importan: los dos lados de cada
 * muro, los vanos abiertos, ventanas y barandas finas, el contorno de cada
 * mueble fijo, los peldaños y el rayado ralo de los bloques sellados.
 */
function controlLineas(plano, marco, destino, macizo, { dibujo = false } = {}) {
  const pl = normalizar(plano);
  const g = 27, o = [];
  const tx = v => v + marco.dx, ty = v => v + marco.dy;
  const linea = (x1, y1, x2, y2, w = 3) => o.push(`<line x1="${tx(x1)}" y1="${ty(y1)}" x2="${tx(x2)}" y2="${ty(y2)}" stroke="#fff" stroke-width="${w}"/>`);
  const rect = (x, y, w, h, s = 3) => o.push(`<rect x="${tx(x)}" y="${ty(y)}" width="${w}" height="${h}" fill="none" stroke="#fff" stroke-width="${s}"/>`);
  // Bloques sellados: rayado diagonal ralo (que el modelo no invente cuartos),
  // salvo que entren lisos (`macizo: "plano"`): ahí el control queda vacío y
  // los sostiene el latente del esquema (DENOISE < 1).
  for (const h of pl.habitaciones.filter(h => h.piso === "macizo" && macizo !== "plano")) {
    const X = h.x * PX_POR_M, Y = h.y * PX_POR_M, Wb = h.w * PX_POR_M, Hb = h.h * PX_POR_M;
    o.push(`<clipPath id="c${X}-${Y}"><rect x="${tx(X)}" y="${ty(Y)}" width="${Wb}" height="${Hb}"/></clipPath><g clip-path="url(#c${X}-${Y})">`);
    for (let k = -Hb; k < Wb; k += 36) linea(X + k, Y + Hb, X + k + Hb, Y, 2);
    o.push("</g>");
  }
  // Zonas exteriores: el borde entre asfalto, vereda y techos vecinos.
  for (const z of pl.exteriores ?? []) rect(z.x * PX_POR_M, z.y * PX_POR_M, z.w * PX_POR_M, z.h * PX_POR_M, 2);
  for (const m of derivarMuros(pl)) {
    const [x1, y1, x2, y2] = m.c, hor = y1 === y2;
    if (m._tipo === "muro" || m._tipo === "secreta") {
      if (hor) rect(x1 - g / 2, y1 - g / 2, x2 - x1 + g, g, 4);
      else rect(x1 - g / 2, y1 - g / 2, g, y2 - y1 + g, 4);
    } else if (["ventana", "vidrio", "puerta-vidrio"].includes(m._tipo)) {
      if (hor) { linea(x1, y1 - 5, x2, y2 - 5, 2); linea(x1, y1 + 5, x2, y2 + 5, 2); }
      else { linea(x1 - 5, y1, x2 - 5, y2, 2); linea(x1 + 5, y1, x2 + 5, y2, 2); }
    } else if (m._tipo === "baranda") {
      linea(x1, y1, x2, y2, 3);
    }
  }
  for (const m of (pl.muebles ?? []).filter(m => !esMovil(m))) {
    const X = m.x * PX_POR_M, Y = m.y * PX_POR_M, Wm = m.w * PX_POR_M, Hm = m.h * PX_POR_M;
    rect(X, Y, Wm, Hm, 3);
    if (m.tipo === "escalera") {
      const vertical = ["n", "s"].includes(m.hacia ?? "s");
      const paso = 25;
      if (vertical) for (let yy = Y + paso; yy < Y + Hm; yy += paso) linea(X, yy, X + Wm, yy, 2);
      else for (let xx = X + paso; xx < X + Wm; xx += paso) linea(xx, Y, xx, Y + Hm, 2);
    }
  }
  // Variante «dibujo» (entrada lineas para Qwen/klein): negro sobre blanco,
  // cuartos en blanco, exterior gris claro, bloques cerrados gris oscuro.
  const fondos = [];
  if (dibujo) {
    fondos.push(`<rect width="100%" height="100%" fill="#c4c4c4"/>`);
    for (const h of pl.habitaciones.filter(h => !h.sinMuros)) {
      fondos.push(`<rect x="${tx(h.x * PX_POR_M)}" y="${ty(h.y * PX_POR_M)}" width="${h.w * PX_POR_M}" height="${h.h * PX_POR_M}" fill="${h.piso === "macizo" ? "#3a3a3a" : "#fff"}"/>`);
    }
  } else fondos.push(`<rect width="100%" height="100%" fill="#000"/>`);
  const trazo = o.join("").replaceAll('stroke="#fff"', `stroke="${dibujo ? "#000" : "#fff"}"`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${marco.W}" height="${marco.H}">${fondos.join("")}${trazo}</svg>`;
  const tmp = `${destino}.svg`;
  fs.writeFileSync(tmp, svg);
  try { magick(dibujo ? [tmp, destino] : [tmp, "-resize", `${marco.ancho}x${marco.alto}!`, destino]); } finally { fs.rmSync(tmp, { force: true }); }
  return destino;
}

function controlCanny(lienzoPath, marco, destino) {
  magick([lienzoPath, "-resize", `${marco.ancho}x${marco.alto}!`, "-colorspace", "gray", "-canny", "0x1.2+8%+25%", destino]);
  return destino;
}

function controlGris(lienzoPath, marco, destino) {
  magick([lienzoPath, "-resize", `${marco.ancho}x${marco.alto}!`, "-colorspace", "gray", "-normalize", destino]);
  return destino;
}

/** Recorte central de la referencia de estilo (para Qwen/klein). */
function referenciaEstilo(plano, refId, destino) {
  if (!refId || refId === "no" || refId === plano.id) return null;
  const ref = path.join(MAPAS, `${refId}.webp`);
  if (!fs.existsSync(ref)) return null;
  magick([ref, "-gravity", "center", "-crop", "1100x1000+0+0", "+repage", destino]);
  return destino;
}

/** Agrega la imagen de estilo como segunda referencia a un workflow de plano. */
function conEstilo(wf, camino) {
  if (camino === "qwen") {
    wf.r1 = { class_type: "LoadImage", inputs: { image: "{{IMAGEN_ESTILO}}" } };
    wf.r2 = { class_type: "ImageScaleToTotalPixels", inputs: { image: ["r1", 0], upscale_method: "lanczos", megapixels: 1, resolution_steps: 16 } };
    wf.r3 = { class_type: "VAEEncode", inputs: { pixels: ["r2", 0], vae: ["6", 0] } };
    wf["10"].inputs.image2 = ["r2", 0];
    wf["11"].inputs.image2 = ["r2", 0];
    wf.r4 = { class_type: "ReferenceLatent", inputs: { conditioning: ["12", 0], latent: ["r3", 0] } };
    wf.r5 = { class_type: "ReferenceLatent", inputs: { conditioning: ["13", 0], latent: ["r3", 0] } };
    wf["14"].inputs.conditioning = ["r4", 0];
    wf["15"].inputs.conditioning = ["r5", 0];
  } else if (camino === "klein") {
    wf.r1 = { class_type: "LoadImage", inputs: { image: "{{IMAGEN_ESTILO}}" } };
    wf.r2 = { class_type: "ImageScaleToTotalPixels", inputs: { image: ["r1", 0], upscale_method: "lanczos", megapixels: 1, resolution_steps: 16 } };
    wf.r3 = { class_type: "VAEEncode", inputs: { pixels: ["r2", 0], vae: ["3", 0] } };
    wf.r4 = { class_type: "ReferenceLatent", inputs: { conditioning: ["8", 0], latent: ["r3", 0] } };
    wf["9"].inputs.conditioning = ["r4", 0];
  }
  return wf;
}

/* -------------------------------------------- */
/*  Corrección afín (paso 3 de DVV)             */
/* -------------------------------------------- */

/**
 * Registra el repintado contra el esquema por PERFILES DE PROYECCIÓN: los
 * muros son líneas largas y rectas, así que la suma por columna de los bordes
 * verticales tiene picos donde hay muros verticales (y por fila para los
 * horizontales). Se busca la escala y el desplazamiento de cada eje que mejor
 * superponen el perfil del repintado sobre el del esquema. No depende del
 * color del exterior.
 */
function grises(ruta, tam) {
  const args = [ruta, "-colorspace", "gray"];
  if (tam) args.push("-resize", tam);
  args.push("-blur", "0x1.5");
  const [w, h] = magick([...args, "-format", "%w %h", "info:"], { encoding: "utf8" }).trim().split(/\s+/).map(Number);
  const px = magick([...args, "-depth", "8", "gray:-"]);
  return { w, h, px };
}

/** Perfil de bordes por columna (eje "x") o por fila (eje "y"), con paso alto. */
function perfil({ w, h, px }, eje) {
  const n = eje === "x" ? w : h;
  const p = new Float64Array(n);
  if (eje === "x") {
    for (let y = 0; y < h; y++) for (let x = 1; x < w - 1; x++) p[x] += Math.abs(px[y * w + x + 1] - px[y * w + x - 1]);
  } else {
    for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) p[y] += Math.abs(px[(y + 1) * w + x] - px[(y - 1) * w + x]);
  }
  const r = Math.max(4, Math.round(n / 60)), out = new Float64Array(n);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + p[i];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r), b = Math.min(n, i + r + 1);
    out[i] = Math.max(0, p[i] - (pre[b] - pre[a]) / (b - a));
    acc += out[i];
  }
  for (let i = 0; i < n; i++) out[i] /= acc || 1;
  return out;
}

function puntaje(P, Q, a, b, paso = 1) {
  let s = 0;
  for (let x = 0; x < P.length; x += paso) {
    if (!P[x]) continue;
    const u = a * x + b, i = Math.floor(u);
    if (i < 0 || i >= Q.length - 1) continue;
    const f = u - i;
    s += P[x] * (Q[i] * (1 - f) + Q[i + 1] * f);
  }
  return s;
}

function ajustarEje(P, Q, a0, b0) {
  let mejor = { a: a0, b: b0, s: -1 };
  const rangoB = Q.length * 0.06;
  for (let a = a0 * 0.95; a <= a0 * 1.05; a += a0 * 0.002) {
    for (let b = b0 - rangoB; b <= b0 + rangoB; b += 1.5) {
      const s = puntaje(P, Q, a, b, 2);
      if (s > mejor.s) mejor = { a, b, s };
    }
  }
  const g = { ...mejor };
  for (let a = g.a - a0 * 0.003; a <= g.a + a0 * 0.003; a += a0 * 0.0002) {
    for (let b = g.b - 3; b <= g.b + 3; b += 0.25) {
      const s = puntaje(P, Q, a, b, 1);
      if (s > mejor.s) mejor = { a, b, s };
    }
  }
  return mejor;
}

/**
 * Corrige `crudoPath` (lienzo `marco` a cualquier escala) contra el esquema
 * (`esquemaPath`, a escala del plano) y escribe `destino` a W×H exactos.
 * No tira por anisotropía o calidad: devuelve los números y el que llama
 * decide (en producción se rechaza; en la prueba se anota).
 */
export function corregir(crudoPath, plano, destino, marco, esquemaPath) {
  const W = plano.ancho * PX_POR_M, H = plano.alto * PX_POR_M;
  const ref = grises(esquemaPath);
  const crudo = grises(crudoPath);
  const a0 = (crudo.w / marco.W + crudo.h / marco.H) / 2;
  const Px = perfil(ref, "x"), Py = perfil(ref, "y");
  const x = ajustarEje(Px, perfil(crudo, "x"), a0, a0 * marco.dx);
  const y = ajustarEje(Py, perfil(crudo, "y"), a0, a0 * marco.dy);
  const anisotropia = Math.abs(x.a / y.a - 1) * 100;
  const calidad = Math.min(x.s / puntaje(Px, Px, 1, 0), y.s / puntaje(Py, Py, 1, 0));
  const esquinas = [[0, 0], [W, 0], [0, H], [W, H]]
    .map(([X, Y]) => `${(x.a * X + x.b).toFixed(2)},${(y.a * Y + y.b).toFixed(2)} ${X},${Y}`).join(" ");
  magick([crudoPath, "-virtual-pixel", "edge", "-filter", "Lanczos",
    "-define", `distort:viewport=${W}x${H}+0+0`, "-distort", "Affine", esquinas, "+repage",
    "-quality", "88", destino]);
  // Escala nominal sin corregir vs. la hallada: cuánto se había corrido el modelo.
  const desplaz = [x.b - a0 * marco.dx, y.b - a0 * marco.dy].map(v => v / a0);
  return { anisotropia, calidad, escala: [x.a / a0, y.a / a0], desplazamiento: desplaz };
}

/* -------------------------------------------- */
/*  Métricas tras corregir                      */
/* -------------------------------------------- */

/**
 * Deriva de cada muro: para cada tramo de muro del plano se promedia, a lo
 * largo del tramo, el perfil de gris perpendicular (±R px) en el esquema y en
 * el mapa corregido, y se busca el corrimiento que mejor superpone sus
 * gradientes. El resultado es cuántos px quedó corrido ESE muro en el mapa
 * final (0 = cae exacto). Tramos < 0,8 m no se miden (ruido).
 */
export function derivaMuros(finalPath, esquemaPath, plano) {
  const W = plano.ancho * PX_POR_M, H = plano.alto * PX_POR_M;
  const A = grises(esquemaPath, `${W}x${H}!`), B = grises(finalPath, `${W}x${H}!`);
  const R = 40, S = 25;
  const val = (img, x, y) => img.px[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  const prof = (img, m) => {
    const [x1, y1, x2, y2] = m.c, hor = y1 === y2;
    const out = new Float64Array(2 * R + 1);
    const ini = (hor ? x1 : y1) + 15, fin = (hor ? x2 : y2) - 15;
    let n = 0;
    for (let t = ini; t <= fin; t += 2) {
      n++;
      for (let d = -R; d <= R; d++) out[d + R] += hor ? val(img, t, y1 + d) : val(img, x1 + d, t);
    }
    for (let i = 0; i < out.length; i++) out[i] /= n || 1;
    const gr = new Float64Array(out.length);
    for (let i = 1; i < out.length - 1; i++) gr[i] = Math.abs(out[i + 1] - out[i - 1]);
    return gr;
  };
  const res = [];
  for (const m of derivarMuros(plano).filter(m => m._tipo === "muro")) {
    const [x1, y1, x2, y2] = m.c, largo = Math.hypot(x2 - x1, y2 - y1);
    if (largo < 80) continue;
    const ga = prof(A, m), gb = prof(B, m);
    let mejor = { s: 0, c: -1 };
    const norma = Math.sqrt(ga.reduce((s, v) => s + v * v, 0) * gb.reduce((s, v) => s + v * v, 0)) || 1;
    for (let s = -S; s <= S; s++) {
      let c = 0;
      for (let i = 0; i < ga.length; i++) { const j = i + s; if (j >= 0 && j < gb.length) c += ga[i] * gb[j]; }
      c /= norma;
      if (c > mejor.c) mejor = { s, c };
    }
    res.push({ largo: Math.round(largo), s: mejor.s, c: mejor.c });
  }
  const fiables = res.filter(r => r.c > 0.3);
  const abs = fiables.map(r => Math.abs(r.s)).sort((a, b) => a - b);
  const pesoTot = fiables.reduce((s, r) => s + r.largo, 0) || 1;
  return {
    tramos: res.length,
    medidos: fiables.length,
    mediana: abs.length ? abs[Math.floor(abs.length / 2)] : null,
    maxima: abs.length ? abs[abs.length - 1] : null,
    dentroTolerancia: fiables.length ? Math.round(100 * fiables.filter(r => Math.abs(r.s) <= TOLERANCIA_PX).reduce((s, r) => s + r.largo, 0) / pesoTot) : null,
    perdidos: res.length - fiables.length
  };
}

/**
 * Vanos (¿siguen abiertos?): contraste de luminancia entre el hueco y el muro
 * de al lado, en el mapa, relativo al mismo contraste en el esquema. Cerca de
 * 1 = el hueco se lee igual que en el plano; cerca de 0 = el modelo lo pintó
 * como muro (o puso una hoja de puerta del mismo tono). Heurística: se mira
 * a ojo igual.
 */
export function vanosAbiertos(finalPath, esquemaPath, plano) {
  const W = plano.ancho * PX_POR_M, H = plano.alto * PX_POR_M;
  const A = grises(esquemaPath, `${W}x${H}!`), B = grises(finalPath, `${W}x${H}!`);
  const media = (img, x, y, w, h) => {
    let s = 0, n = 0;
    for (let yy = Math.max(0, Math.round(y)); yy < Math.min(H, y + h); yy++)
      for (let xx = Math.max(0, Math.round(x)); xx < Math.min(W, x + w); xx++) { s += img.px[yy * W + xx]; n++; }
    return n ? s / n : 0;
  };
  const out = [];
  for (const v of normalizar(plano).vanos ?? []) {
    if (!["puerta", "abierto"].includes(v.tipo)) continue;
    const X = v.x * PX_POR_M, Y = v.y * PX_POR_M, L = v.w * PX_POR_M, g = 10;
    const [hx, hy, hw, hh] = v.eje === "h" ? [X + L * 0.25, Y - g, L * 0.5, 2 * g] : [X - g, Y + L * 0.25, 2 * g, L * 0.5];
    // Muro a ambos lados del vano (30 px más allá de cada extremo).
    const lados = v.eje === "h"
      ? [[X - 40, Y - g, 25, 2 * g], [X + L + 15, Y - g, 25, 2 * g]]
      : [[X - g, Y - 40, 2 * g, 25], [X - g, Y + L + 15, 2 * g, 25]];
    const c = img => Math.abs(media(img, hx, hy, hw, hh) - lados.reduce((s, l) => s + media(img, ...l), 0) / 2);
    const ca = c(A), cb = c(B);
    out.push({ nombre: v.nombre ?? v.tipo, ratio: ca > 4 ? cb / ca : null });
  }
  const sospechosos = out.filter(o => o.ratio !== null && o.ratio < 0.35);
  return { vanos: out.length, sospechosos: sospechosos.length, cuales: sospechosos.map(o => o.nombre) };
}

/**
 * Retoque determinista (MAPS_SPEC §6): los departamentos cerrados (`macizo`)
 * se rellenan con un macizo oscuro liso con grano, dentro del canto interior
 * de sus muros. Los modelos de edición (klein sobre todo) inventan cuartos
 * enteros adentro aunque el prompt lo prohíba; como esa zona está fuera de
 * juego y su aspecto es «macizo», taparla no cambia nada jugable y saca los
 * muros inventados. Devuelve cuántos bloques selló.
 */
function sellarMacizos(destino, plano) {
  const W = plano.ancho * PX_POR_M, H = plano.alto * PX_POR_M, m = 17;
  const bloques = normalizar(plano).habitaciones.filter(h => h.piso === "macizo");
  if (!bloques.length) return 0;
  const dibujo = bloques.flatMap(h => ["-draw",
    `rectangle ${h.x * PX_POR_M + m},${h.y * PX_POR_M + m} ${(h.x + h.w) * PX_POR_M - m},${(h.y + h.h) * PX_POR_M - m}`]);
  const tmp = `${destino}.sellado.png`;
  magick([destino,
    "(", "-size", `${W}x${H}`, `xc:${COLOR_MACIZO}`, "-attenuate", "0.25", "+noise", "Gaussian", "-blur", "0x0.7", ")",
    "(", "-size", `${W}x${H}`, "xc:black", "-fill", "white", ...dibujo, "-blur", "0x1.5", "-alpha", "off", ")",
    "-compose", "over", "-composite", tmp]);
  magick([tmp, "-quality", "88", destino]);
  fs.rmSync(tmp, { force: true });
  return bloques.length;
}

function satLum(ruta) {
  const [s, l] = magick([ruta, "-colorspace", "HSL", "-format", "%[fx:mean.g*100] %[fx:mean.b*100]", "info:"], { encoding: "utf8" })
    .trim().split(/\s+/).map(Number);
  return { sat: Math.round(s * 10) / 10, lum: Math.round(l * 10) / 10 };
}

/* -------------------------------------------- */
/*  Pintar                                       */
/* -------------------------------------------- */

async function escalar(crudo, marco, semilla, destino, plano, variante = "3b") {
  // SeedVR2 al primer tamaño (múltiplo de 16) que cubre el plano a 100 px/m
  // con la proporción del lienzo; la corrección después baja apenas.
  const k = Math.max((plano.ancho * PX_POR_M) / (marco.W - 2 * marco.dx), (plano.alto * PX_POR_M) / (marco.H - 2 * marco.dy)) * (marco.W / marco.ancho);
  const ancho = Math.ceil((marco.ancho * k) / 16) * 16, alto = Math.ceil((marco.alto * k) / 16) * 16;
  const wf = cargarWorkflow(ESCALADOR.workflow);
  wf["1"].inputs.unet_name = SEEDVR2[variante];
  const r = await ejecutar(wf, { IMAGEN: crudo, ANCHO: ancho, ALTO: alto, SEMILLA: semilla, PREFIJO: `sbn/${plano.id}-escalado` });
  fs.writeFileSync(destino, r.salidas[0].buffer);
  return { segundos: r.segundos, ancho, alto };
}

export async function pintar(plano, op) {
  const camino = op.camino;
  const def = CAMINOS[camino];
  if (!def) throw new Error(`camino desconocido «${camino}» (qwen|klein|controlnet)`);
  const marco = lienzo(plano, op.mp);
  const prueba = Boolean(op.salida);
  const carpeta = op.salida ?? MAPAS;
  fs.mkdirSync(carpeta, { recursive: true });
  const base = prueba ? `${plano.id}-${camino}-s${op.semilla}${op.sufijo ?? ""}` : plano.id;
  const destino = path.join(carpeta, `${base}.webp`);
  const tmp = fs.mkdtempSync(path.join(op.tmp, `${base}-`));
  const crudo = path.join(carpeta, prueba ? `${base}.crudo.png` : `.${base}.crudo.png`);

  const esquema = esquemaPng(plano, path.join(tmp, "esquema.png"));
  const lien = op.entrada === "lineas" && camino !== "controlnet"
    ? controlLineas(plano, marco, path.join(tmp, "lienzo.png"), "plano", { dibujo: true })
    : lienzoPng(esquema, marco, path.join(tmp, "lienzo.png"), plano, op.macizo);
  if (prueba) fs.copyFileSync(lien, path.join(carpeta, `${base}.entrada.png`));
  const refId = op.referencia ?? plano.referencia ?? CONFIG.referencia;
  const estilo = camino === "controlnet" ? null : referenciaEstilo(plano, refId, path.join(tmp, "estilo.png"));
  const texto = prompt(plano, marco, camino, Boolean(estilo), op.macizo, op.entrada);
  if (op.verPrompt) { console.log(texto); console.log(`\n(${texto.length} caracteres; lienzo ${marco.W}×${marco.H} → ${marco.ancho}×${marco.alto})`); return null; }

  const valores = { IMAGEN: lien, SEMILLA: op.semilla, ANCHO: marco.ancho, ALTO: marco.alto, PROMPT: texto, PREFIJO: `sbn/${base}` };
  const parametros = { ancho: marco.ancho, alto: marco.alto, macizo: op.macizo, entrada: op.entrada };
  let control = null;
  if (camino === "qwen") {
    const sin = op.sinLightning;
    Object.assign(valores, { LORA: sin ? 0 : 1, PASOS: sin ? 20 : 4, CFG: sin ? 4 : 1, DENOISE: op.denoise ?? 1, NEGATIVO: sin ? E.negativo : "" });
    Object.assign(parametros, { lightning: !sin, pasos: valores.PASOS, cfg: valores.CFG, denoise: valores.DENOISE });
  } else if (camino === "klein") {
    Object.assign(valores, { PASOS: 4 });
    Object.assign(parametros, { pasos: 4 });
  } else {
    const tipo = op.control ?? "lineas";
    control = path.join(prueba ? carpeta : tmp, `${base}.control.png`);
    if (tipo === "lineas") controlLineas(plano, marco, control, op.macizo);
    else if (tipo === "canny") controlCanny(lien, marco, control);
    else if (tipo === "gris") controlGris(lien, marco, control);
    else throw new Error(`control desconocido «${tipo}»`);
    Object.assign(valores, { CONTROL: control, FUERZA: op.fuerza ?? 0.9, FIN_CONTROL: op.fin ?? 1, PASOS: 8, DENOISE: op.denoise ?? 1 });
    Object.assign(parametros, { control: tipo, fuerza: valores.FUERZA, fin: valores.FIN_CONTROL, pasos: 8, denoise: valores.DENOISE });
  }

  const wf = cargarWorkflow(def.workflow);
  if (estilo) { conEstilo(wf, camino); valores.IMAGEN_ESTILO = estilo; parametros.referencia = refId; }

  let segundos = 0;
  if (op.reusarCrudo && fs.existsSync(crudo)) {
    segundos = null;
  } else {
    const r = await ejecutar(wf, valores);
    fs.writeFileSync(crudo, r.salidas.find(s => s.titulo === "Salida")?.buffer ?? r.salidas[0].buffer);
    segundos = r.segundos;
  }

  let paraCorregir = crudo, escalado = null;
  if (op.escalar) {
    const esc = path.join(tmp, "escalado.png");
    escalado = await escalar(crudo, marco, op.semilla, esc, plano, op.escalador);
    paraCorregir = esc;
  }

  if (!prueba && fs.existsSync(destino) && !op.forzar) throw new Error(`${path.relative(RAIZ, destino)} ya existe (usá --forzar)`);
  const corr = corregir(paraCorregir, plano, destino, marco, esquema);
  const retoques = [];
  if (op.sellar !== false) { const n = sellarMacizos(destino, plano); if (n) retoques.push(`${n} macizos sellados (relleno liso con grano)`); }
  const deriva = derivaMuros(destino, esquema, plano);
  const vanos = vanosAbiertos(destino, esquema, plano);
  const estiloMet = satLum(destino);
  const metricas = {
    anisotropia: +corr.anisotropia.toFixed(2), calidad: +corr.calidad.toFixed(3),
    escala: corr.escala.map(v => +v.toFixed(4)), desplazamiento: corr.desplazamiento.map(v => +v.toFixed(1)),
    deriva, vanos, ...estiloMet,
    aprobado: corr.anisotropia <= LIMITE_ANISOTROPIA && corr.calidad >= CALIDAD_MINIMA && (deriva.dentroTolerancia ?? 0) >= DERIVA_MINIMA
  };

  const modelos = [...def.modelos];
  if (camino === "qwen" && !op.sinLightning) modelos.push(def.lora);
  if (op.escalar) modelos.push(SEEDVR2[op.escalador ?? "3b"], ESCALADOR.modelos[1]);
  registrarProcedencia(destino, {
    plano: plano.id, lugar: plano.lugar, camino,
    modelos, licencia: APACHE,
    workflow: `tools/workflows/${def.workflow}.json` + (op.escalar ? ` + tools/workflows/${ESCALADOR.workflow}.json` : ""),
    semilla: op.semilla, parametros, escalado: escalado ? `SeedVR2 ${op.escalador ?? "3b"} a ${escalado.ancho}×${escalado.alto}` : null,
    correccion: "afín por eje (perfiles de muro, tools/pintar-planos.mjs)", retoques,
    metricas, prompt: texto
  });

  const fila = { archivo: destino, crudo, control, camino, semilla: op.semilla, sufijo: op.sufijo ?? "", parametros, retoques,
    segundos, segundosEscalado: escalado?.segundos ?? null, ...metricas };
  if (prueba) fs.appendFileSync(path.join(carpeta, "resultados.jsonl"), JSON.stringify(fila) + "\n");
  else fs.rmSync(crudo, { force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  return fila;
}

/* -------------------------------------------- */

if (import.meta.filename === process.argv[1]) await main();

async function main() {
  const argv = process.argv.slice(2);
  const opcion = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const num = n => (opcion(n) === undefined ? undefined : Number(opcion(n)));
  const solo = opcion("--solo");
  const planos = cargarPlanos().filter(p => !solo || p.id === solo);
  if (!planos.length) { console.error("No hay planos que pintar."); process.exit(1); }
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "sbn-pintar-"));
  let fallos = 0;
  for (const plano of planos) {
    const fijado = CONFIG.mapas?.[plano.id] ?? {};
    const semillas = String(opcion("--semilla") ?? fijado.semilla ?? 1).split(",").map(Number);
    for (const semilla of semillas) {
      const op = {
        camino: opcion("--camino") ?? fijado.camino ?? "qwen", semilla,
        escalar: argv.includes("--escalar") || (fijado.escalar && !opcion("--camino")),
        salida: opcion("--salida") ? path.resolve(opcion("--salida")) : undefined,
        sufijo: opcion("--sufijo"), mp: num("--mp") ?? fijado.mp ?? 1.5,
        sinLightning: argv.includes("--sin-lightning") || (fijado.lightning === false && !opcion("--camino")),
        denoise: num("--denoise") ?? fijado.denoise, control: opcion("--control") ?? fijado.control,
        fuerza: num("--fuerza") ?? fijado.fuerza, fin: num("--fin") ?? fijado.fin,
        referencia: opcion("--referencia"), macizo: opcion("--macizo") ?? fijado.macizo ?? "plano",
        entrada: opcion("--entrada") ?? fijado.entrada ?? "esquema", sellar: !argv.includes("--no-sellar"),
        escalador: opcion("--escalador") ?? fijado.escalador ?? "3b", reusarCrudo: argv.includes("--reusar-crudo"),
        forzar: argv.includes("--forzar"), verPrompt: argv.includes("--ver-prompt"), tmp
      };
      process.stdout.write(`  ${plano.id} · ${op.camino} · semilla ${semilla}${op.sufijo ?? ""} … `);
      try {
        const f = await pintar(plano, op);
        if (!f) continue;
        const d = f.deriva;
        console.log(`${f.aprobado ? "✓" : "✗"} ${f.segundos ? f.segundos.toFixed(1) + " s" : "(crudo reusado)"}` +
          `${f.segundosEscalado ? ` + ${f.segundosEscalado.toFixed(1)} s SeedVR2` : ""}  ` +
          `anisotropía ${f.anisotropia}% · calidad ${f.calidad} · deriva mediana ${d.mediana} px, máx ${d.maxima} px, ` +
          `${d.dentroTolerancia}% ≤ ${TOLERANCIA_PX} px (${d.medidos}/${d.tramos} tramos) · vanos dudosos ${f.vanos.sospechosos}/${f.vanos.vanos} · sat ${f.sat} lum ${f.lum}`);
        if (!f.aprobado) fallos++;
      } catch (err) {
        console.log(`✗ ${err.message}`);
        fallos++;
      }
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fallos ? 1 : 0);
}

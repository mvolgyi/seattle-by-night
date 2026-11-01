#!/usr/bin/env node
/**
 * Repinta SÓLO unas zonas de un mapa ya pintado (inpaint acotado), con el
 * resto del mapa como contexto. Para cuando el plano cambia en una parte (los
 * bloques `macizo` que pasaron a ser habitaciones, una franja que ahora es
 * cubierta) y el resto del mapa está bien: no se rehace el mapa entero.
 *
 *   1. El esquema nuevo (tools/planos.mjs) se pega sobre el mapa pintado dentro
 *      de las zonas (por dentro de la cara de sus muros, más los vanos que caen
 *      sobre su borde).
 *   2. Por cada zona, una ventana (zona + `contexto` m) va a FLUX.2 [klein] 4B
 *      (workflow plano-klein) con un prompt de edición: «el área esquemática se
 *      pinta como lo que la rodea»; la salida se registra contra la entrada
 *      (corrección afín por perfiles de muro, la misma de pintar-planos) y se
 *      compone sólo dentro de la máscara.
 *   3. Pasada de detalle por mosaicos (Z-Image Turbo + ControlNet canny, la de
 *      pintar-planos) sólo en los mosaicos que tocan las zonas, compuesta otra
 *      vez sólo dentro de la máscara.
 *   4. (opcional) grading de color del set sobre lo nuevo.
 *
 * Fuera de la máscara el mapa queda idéntico, píxel a píxel. Los parámetros van
 * en `tools/arte.config.json` → `mapas.<id>.parche`:
 *   { zonas: [{ x, y, w, h, margen? }], semilla, contexto?, mp?, grading?,
 *     detalle?: { …como mapas.<id>.detalle.interior } }
 * Cada zona puede fijar su `semilla` de klein (si no, semilla × 10 + índice).
 * `margen` (m, por defecto −0,14) agranda (+) o achica (−) la zona: −0,14 deja
 * afuera la mitad del muro que ya estaba pintado; una franja cuyo muro se
 * quitó lleva un margen positivo del lado del muro. `margenes: { n, s, e, o }`
 * lo fija por lado. En los planos de fondo sellado (roca, vacío) el lado que no
 * comparte muro con una habitación vieja lleva +0,16 (el sellado tapó ese muro).
 *
 * Uso:
 *   node tools/parchar-planos.mjs --solo helen [--semilla 7] [--salida <carpeta>] [--forzar]
 *   --base <archivo>   mapa de partida (por defecto assets/mapas/<id>.webp)
 *   --sin-detalle      sólo klein (pruebas)
 * Sin --salida pisa assets/mapas/<id>.webp (con --forzar) y suma la pasada a
 * `parches` en su entrada de assets/PROCEDENCIA.json (no la reemplaza).
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { normalizar, derivarMuros, PX_POR_M } from "./planos.mjs";
import { cargarPlanos } from "./construir-planos.mjs";
import { cargarWorkflow, ejecutar, liberar } from "./comfy.mjs";
import { vigilar, estilo, esquemaPng, corregir, describirRecorte, detallarMosaicos, gradingColor, satLum,
  derivaMuros, vanosAbiertos } from "./pintar-planos.mjs";

const RAIZ = path.resolve(import.meta.dirname, "..");
const MAPAS = path.join(RAIZ, "assets/mapas");
const CONFIG = JSON.parse(fs.readFileSync(path.join(RAIZ, "tools/arte.config.json"), "utf8"));
const E = CONFIG.estilos.battlemap;
const KLEIN = ["flux-2-klein-4b.safetensors", "qwen_3_4b.safetensors", "flux2-vae.safetensors"];
const ZIMAGE = ["z_image_turbo_bf16.safetensors", "qwen_3_4b.safetensors", "z_image_ae.safetensors",
  "Z-Image-Turbo-Fun-Controlnet-Union-2.1-2602-8steps.safetensors"];

const magick = (args, o = {}) => execFileSync("magick", args, { stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1 << 28, ...o });
const px = m => Math.round(m * PX_POR_M);
const r1 = v => Math.round(v * 100) / 100;

/** Rectángulos (m) que se repintan: cada zona con su margen, más los vanos sobre su borde. */
export function rectsZona(plano, z, { zonas = [z], sellado = false } = {}) {
  // Margen por lado: −0,14 (por dentro del muro, que ya estaba pintado). En los planos de
  // fondo sellado (roca, vacío), el muro que da al fondo o a otra zona quedó tapado por el
  // sellado: ese lado lleva +0,16 para volver a pintar el muro entero.
  const viejas = normalizar(plano).habitaciones.filter(h => !h.sinMuros && !["macizo", "vacio"].includes(h.piso) &&
    !zonas.some(o => h.x + h.w / 2 > o.x && h.x + h.w / 2 < o.x + o.w && h.y + h.h / 2 > o.y && h.y + h.h / 2 < o.y + o.h));
  const solapa = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const c = (a, b) => Math.abs(a - b) < 0.05;
  const compartido = lado => viejas.some(h => lado === "n" ? c(h.y + h.h, z.y) && solapa(h.x, h.x + h.w, z.x, z.x + z.w) >= z.w / 2
    : lado === "s" ? c(h.y, z.y + z.h) && solapa(h.x, h.x + h.w, z.x, z.x + z.w) >= z.w / 2
      : lado === "o" ? c(h.x + h.w, z.x) && solapa(h.y, h.y + h.h, z.y, z.y + z.h) >= z.h / 2
        : c(h.x, z.x + z.w) && solapa(h.y, h.y + h.h, z.y, z.y + z.h) >= z.h / 2);
  const m = Object.fromEntries(["n", "s", "e", "o"].map(l => [l,
    z.margenes?.[l] ?? z.margen ?? (sellado && !compartido(l) ? 0.16 : -0.14)]));
  const rects = [{ x: z.x - m.o, y: z.y - m.n, w: z.w + m.o + m.e, h: z.h + m.n + m.s }];
  const cerca = (a, b) => Math.abs(a - b) < 0.05;
  for (const v of normalizar(plano).vanos ?? []) {
    if (v.eje === "v") {
      const sobre = (cerca(v.x, z.x) || cerca(v.x, z.x + z.w)) && v.y < z.y + z.h && v.y + v.w > z.y;
      // Sólo el tramo del vano que toca la zona (una borda corre a lo largo de todo el barco).
      const y0 = Math.max(v.y, z.y - 0.3), y1 = Math.min(v.y + v.w, z.y + z.h + 0.3);
      if (sobre) rects.push({ x: v.x - 0.26, y: y0 - 0.06, w: 0.52, h: y1 - y0 + 0.12 });
    } else {
      const sobre = (cerca(v.y, z.y) || cerca(v.y, z.y + z.h)) && v.x < z.x + z.w && v.x + v.w > z.x;
      const x0 = Math.max(v.x, z.x - 0.3), x1 = Math.min(v.x + v.w, z.x + z.w + 0.3);
      if (sobre) rects.push({ x: x0 - 0.06, y: v.y - 0.26, w: x1 - x0 + 0.12, h: 0.52 });
    }
  }
  return rects;
}

/* ---- Igualar tonos: cada cuarto nuevo con los cuartos viejos del mismo piso ---- */

const s2l = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const l2s = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function aOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function deOklab(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
/** Si el mapa no tiene un cuarto viejo con el mismo piso, el material más parecido que sí tenga. */
const PARECIDOS = {
  chapa: ["cubierta", "hormigon"], cubierta: ["chapa", "hormigon"], baldosa: ["terrazo", "linoleo", "azulejo"],
  azulejo: ["baldosa", "linoleo", "terrazo"], linoleo: ["baldosa", "terrazo", "tecnico"], hormigon: ["tecnico", "piedra", "terrazo", "linoleo"],
  tecnico: ["hormigon", "linoleo"], tablas: ["parquet", "tablas-quemadas"]
  // escombros, relleno y cimiento no se igualan con un piso: son masas oscuras, no suelo pisado.
};
const percentil = (xs, p) => xs[Math.min(xs.length - 1, Math.max(0, Math.floor(p * xs.length)))];

/**
 * Retoque determinista (se usa dos veces: sobre el esquema pegado, antes de
 * klein, y sobre el resultado, antes de componer). klein tiende a pintar lo nuevo más claro que lo viejo
 * (el esquema es más claro que el pintado). Cada habitación nueva (su centro
 * cae en una zona) que tiene en el mapa una habitación vieja del mismo piso (o
 * de un material parecido, PARECIDOS) se
 * lleva a sus valores en OKLab: mediana de L y de a/b, y la dispersión de L
 * (rango intercuartil, topado a ×0,8–1,25). Se mide y se aplica por dentro de
 * las caras de los muros (0,15 m), con una rampa de 3 px; los muros y los
 * cuartos sin par quedan como salieron. Devuelve qué ajustó.
 */
export function igualarTonos(entrada, destino, plano, zonas, { ins = 15, rects = [] } = {}) {
  const W = plano.ancho * PX_POR_M, H = plano.alto * PX_POR_M;
  const rgb = magick([entrada, "-alpha", "off", "-depth", "8", "rgb:-"]);
  const habs = normalizar(plano).habitaciones.filter(h => !["macizo", "vacio", "rejilla", "agua"].includes(h.piso));
  const enZona = h => zonas.some(z => h.x + h.w / 2 > z.x && h.x + h.w / 2 < z.x + z.w && h.y + h.h / 2 > z.y && h.y + h.h / 2 < z.y + z.h);
  // Etiqueta por píxel: la habitación más chica que lo contiene (por dentro de 0,15 m).
  const etiqueta = new Int16Array(W * H).fill(-1);
  [...habs.keys()].sort((i, j) => habs[j].w * habs[j].h - habs[i].w * habs[i].h).forEach(i => {
    const h = habs[i];
    for (let y = Math.max(0, px(h.y) + ins); y < Math.min(H, px(h.y + h.h) - ins); y++)
      for (let x = Math.max(0, px(h.x) + ins); x < Math.min(W, px(h.x + h.w) - ins); x++) etiqueta[y * W + x] = i;
  });
  // Píxeles de la máscara que no son de ningún cuarto nuevo (muros nuevos, el muro que se
  // quitó, el borde por dentro de los muros): toman el ajuste del cuarto nuevo más cercano.
  const enMascara = new Uint8Array(W * H);
  for (const o of rects)
    for (let y = Math.max(0, px(o.y)); y < Math.min(H, px(o.y + o.h)); y++)
      for (let x = Math.max(0, px(o.x)); x < Math.min(W, px(o.x + o.w)); x++) enMascara[y * W + x] = 1;
  // Los muros (y ventanas) del plano no toman el ajuste de un piso: se oscurecerían.
  // Las barandas, puertas y huecos sí (son piso con una línea encima).
  const muro = new Uint8Array(W * H), g = 15;
  for (const m of derivarMuros(plano).filter(m => ["muro", "secreta", "ventana", "vidrio", "puerta-vidrio"].includes(m._tipo))) {
    const [x1, y1, x2, y2] = m.c;
    for (let y = Math.max(0, Math.min(y1, y2) - g); y < Math.min(H, Math.max(y1, y2) + g); y++)
      for (let x = Math.max(0, Math.min(x1, x2) - g); x < Math.min(W, Math.max(x1, x2) + g); x++) muro[y * W + x] = 1;
  }
  const lab = new Float32Array(W * H * 3);
  for (let o = 0; o < W * H; o++) {
    if (etiqueta[o] < 0 && !enMascara[o]) continue;
    const [L, a, b] = aOklab(s2l(rgb[o * 3] / 255), s2l(rgb[o * 3 + 1] / 255), s2l(rgb[o * 3 + 2] / 255));
    lab[o * 3] = L; lab[o * 3 + 1] = a; lab[o * 3 + 2] = b;
  }
  const stats = idxs => {
    const k = Math.max(1, Math.floor(idxs.length / 40000));
    const L = [], A = [], B = [];
    for (let n = 0; n < idxs.length; n += k) { const o = idxs[n]; L.push(lab[o * 3]); A.push(lab[o * 3 + 1]); B.push(lab[o * 3 + 2]); }
    [L, A, B].forEach(v => v.sort((p, q) => p - q));
    return { L: percentil(L, 0.5), iqr: percentil(L, 0.75) - percentil(L, 0.25), a: percentil(A, 0.5), b: percentil(B, 0.5) };
  };
  const pixeles = new Map();
  for (let o = 0; o < W * H; o++) { const e = etiqueta[o]; if (e >= 0) { if (!pixeles.has(e)) pixeles.set(e, []); pixeles.get(e).push(o); } }
  const ref = new Map();
  for (const [i, h] of habs.entries()) {
    if (enZona(h) || !pixeles.has(i)) continue;
    if (!ref.has(h.piso)) ref.set(h.piso, []);
    for (const o of pixeles.get(i)) ref.get(h.piso).push(o);
  }
  const refStats = new Map([...ref].map(([p, xs]) => [p, stats(xs)]));
  const ajustes = [], transf = new Map();
  for (const [i, h] of habs.entries()) {
    const par = [h.piso, ...(PARECIDOS[h.piso] ?? [])].find(q => refStats.has(q));
    if (!enZona(h) || !pixeles.has(i) || !par) continue;
    const r = refStats.get(par), n = stats(pixeles.get(i));
    const k = Math.min(1.25, Math.max(0.8, n.iqr > 1e-4 ? r.iqr / n.iqr : 1));
    transf.set(i, { n, r, k });
    ajustes.push({ habitacion: h.nombre, piso: h.piso, referencia: par, L: [+n.L.toFixed(3), +r.L.toFixed(3)], k: +k.toFixed(2) });
  }
  const aplicar = (o, t, w) => {
    const L = (lab[o * 3] - t.n.L) * t.k + t.r.L, a = lab[o * 3 + 1] - t.n.a + t.r.a, b = lab[o * 3 + 2] - t.n.b + t.r.b;
    const c = deOklab(L, a, b).map(v => Math.round(255 * Math.min(1, Math.max(0, l2s(Math.max(0, v))))));
    for (let q = 0; q < 3; q++) rgb[o * 3 + q] = Math.round(rgb[o * 3 + q] * (1 - w) + c[q] * w);
  };
  const nuevos = new Set(habs.map((h, i) => (enZona(h) ? i : -1)).filter(i => i >= 0));
  const conT = [...transf.keys()];
  const dist = (h, x, y) => Math.hypot(Math.max(px(h.x) - x, 0, x - px(h.x + h.w)), Math.max(px(h.y) - y, 0, y - px(h.y + h.h)));
  for (let o = 0; o < W * H; o++) {
    const e = etiqueta[o];
    if (e >= 0 && transf.has(e)) { aplicar(o, transf.get(e), 1); continue; }
    if (!enMascara[o] || muro[o] || (e >= 0 && nuevos.has(e)) || !conT.length) continue;
    const x = o % W, y = (o / W) | 0;
    let mejor = -1, d = Infinity;
    for (const i of conT) { const di = dist(habs[i], x, y); if (di < d) { d = di; mejor = i; } }
    if (d <= 60) aplicar(o, transf.get(mejor), 1);
  }
  magick(["-size", `${W}x${H}`, "-depth", "8", "rgb:-", destino], { input: rgb });
  return ajustes;
}

/**
 * Retoque determinista: los modelos siembran puntitos saturados (un LED rojo
 * en un gabinete, un piloto azul) que en mesa se leen como luces encendidas
 * (MAPS_SPEC §2). Dentro de `rects`, los píxeles con croma OKLab > `max` se
 * llevan a croma `max` / 3. El carmesí de los alfileres de Helen queda fuera
 * de las zonas. Devuelve cuántos píxeles tocó.
 */
export function apagarPuntos(entrada, destino, plano, rects, max = 0.11) {
  const W = plano.ancho * PX_POR_M, H = plano.alto * PX_POR_M;
  const rgb = magick([entrada, "-alpha", "off", "-depth", "8", "rgb:-"]);
  let n = 0;
  for (const o of rects)
    for (let y = Math.max(0, px(o.y)); y < Math.min(H, px(o.y + o.h)); y++)
      for (let x = Math.max(0, px(o.x)); x < Math.min(W, px(o.x + o.w)); x++) {
        const i = (y * W + x) * 3;
        const [L, a, b] = aOklab(s2l(rgb[i] / 255), s2l(rgb[i + 1] / 255), s2l(rgb[i + 2] / 255));
        const C = Math.hypot(a, b);
        if (C <= max) continue;
        const k = max / 3 / C;
        deOklab(L, a * k, b * k).forEach((v, q) => { rgb[i + q] = Math.round(255 * Math.min(1, Math.max(0, l2s(Math.max(0, v))))); });
        n++;
      }
  magick(["-size", `${W}x${H}`, "-depth", "8", "rgb:-", destino], { input: rgb });
  return n;
}

/** Máscara blanca sobre negro (PNG W×H a 100 px/m) de rectángulos en metros. */
function mascara(rects, W, H, destino, difuminado = 0) {
  magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
    ...rects.flatMap(o => ["-draw", `rectangle ${px(o.x)},${px(o.y)} ${px(o.x + o.w) - 1},${px(o.y + o.h) - 1}`]),
    ...(difuminado ? ["-blur", `0x${difuminado}`] : []), destino]);
  return destino;
}

/** `capa` sobre `fondo` donde `masc` es blanca. */
function componer(fondo, capa, masc, destino) {
  magick([fondo, "(", capa, "(", masc, "-alpha", "off", "-colorspace", "gray", ")", "-alpha", "off", "-compose", "copy_opacity", "-composite", ")",
    "-compose", "over", "-composite", "-alpha", "off", destino]);
  return destino;
}

/** Tamaño del lienzo de klein (múltiplos de 16, ~mp megapíxeles) para una ventana de w×h m. */
function tamKlein(w, h, mp) {
  const r = w / h;
  const alto = Math.round(Math.sqrt((mp * 1e6) / r) / 16) * 16;
  return { ancho: Math.round((alto * r) / 16) * 16, alto };
}

/** Dónde cae un rectángulo dentro de la ventana, en palabras y porcentajes. */
function enVentana(c, v) {
  const p = (a, b) => Math.round(((a - b) / (b === v.x ? v.w : v.h)) * 100);
  return `${p(c.x, v.x)}–${p(c.x + c.w, v.x)}% across and ${p(c.y, v.y)}–${p(c.y + c.h, v.y)}% down`;
}

function promptKlein(plano, v, zona) {
  const lugar = estilo("prefijo_detalle_control", plano).match(/part of (.*?), with its roof removed/)?.[1] ?? "a building";
  return `EDIT TASK. Picture 1 is a ${r1(v.w)} × ${r1(v.h)} m crop of a finished top-down battlemap: part of ${lugar}, seen strictly from directly above with the roof removed. ` +
    `Almost everything in it is already painted in its final style. ONE AREA is still a flat, simple vector schematic: the block covering ${enVentana(zona, v)} of the image. ` +
    "Repaint that area so it matches the painted surroundings exactly: the same illustrated photorealism of a published modern map pack, the same dark ink outline on every wall and object, " +
    "the same muted, cold, desaturated colours, the same grain, wear, dirt and soft contact shadows, the same flat dim ambient light. Keep everything that is already painted exactly as it is. " +
    "Change NOTHING of the layout: every wall, doorway gap, window and piece of furniture stays exactly where the schematic draws it, with the same size; do not add, move or remove walls, rooms or furniture, and do not re-frame the image.\n\n" +
    describirRecorte(plano, v, "interior") + estilo("sufijo", plano);
}

/** Corre klein sobre una ventana y devuelve el PNG registrado a 100 px/m (w×h m). */
async function kleinVentana(entradaVentana, plano, v, zona, semilla, mp, tmp, i) {
  const { ancho, alto } = tamKlein(v.w, v.h, mp);
  const texto = promptKlein(plano, v, zona);
  await vigilar(`${plano.id} parche klein ${i}`);
  const r = await ejecutar(cargarWorkflow("plano-klein"), { IMAGEN: entradaVentana, SEMILLA: semilla, ANCHO: ancho, ALTO: alto,
    PROMPT: texto, PREFIJO: `sbn/${plano.id}-parche-${i}`, PASOS: 4 });
  const crudo = path.join(tmp, `klein-${i}.png`);
  fs.writeFileSync(crudo, r.salidas.find(s => s.titulo === "Salida")?.buffer ?? r.salidas[0].buffer);
  // Registro contra la entrada (contexto pintado + esquema): misma corrección afín que pintar-planos.
  const reg = path.join(tmp, `klein-${i}-reg.png`);
  const Wv = px(v.w), Hv = px(v.h);
  const corr = corregir(crudo, { ancho: v.w, alto: v.h }, reg, { W: Wv, H: Hv, dx: 0, dy: 0, ancho, alto }, entradaVentana);
  return { reg, crudo, corr, segundos: r.segundos, prompt: texto, ancho, alto };
}

export async function parchar(plano, op) {
  const W = plano.ancho * PX_POR_M, H = plano.alto * PX_POR_M;
  const tmp = fs.mkdtempSync(path.join(op.tmp, `${plano.id}-`));
  const base = path.join(tmp, "base.png");
  magick([op.base, "-alpha", "off", base]);
  const esq = esquemaPng(plano, path.join(tmp, "esquema.png"));
  const zonas = op.zonas;
  const porZona = zonas.map(z => rectsZona(plano, z, { zonas, sellado: op.sellado }));
  const todos = porZona.flat();
  // 1. El esquema nuevo pegado en las zonas.
  const mDura = mascara(todos, W, H, path.join(tmp, "m-dura.png"));
  let actual = componer(base, esq, mDura, path.join(tmp, "c0.png"));
  // El esquema es más claro que lo pintado: se lo lleva a los tonos del mapa antes de klein
  // (si no, klein conserva esos valores y lo nuevo sale lavado).
  const informe = { klein: [], detalle: null };
  if (op.igualar !== false) {
    const c0b = path.join(tmp, "c0-igualado.png");
    informe.igualarEsquema = igualarTonos(actual, c0b, plano, zonas, { ins: 10, rects: todos });
    actual = componer(actual, c0b, mDura, path.join(tmp, "c0b.png"));
  }
  // 2. klein por zona.
  for (const [i, z] of zonas.entries()) {
    const c = op.contexto ?? 1.5;
    const x0 = Math.max(0, z.x - c), y0 = Math.max(0, z.y - c);
    const v = { x: x0, y: y0, w: Math.min(plano.ancho, z.x + z.w + c) - x0, h: Math.min(plano.alto, z.y + z.h + c) - y0 };
    const ventana = path.join(tmp, `ventana-${i}.png`);
    magick([actual, "-crop", `${px(v.w)}x${px(v.h)}+${px(v.x)}+${px(v.y)}`, "+repage", ventana]);
    if (op.salida) fs.copyFileSync(ventana, path.join(op.salida, `${plano.id}-z${i}.entrada.png`));
    const semillaZona = z.semilla ?? op.semilla * 10 + i;
    const k = await kleinVentana(ventana, plano, v, z, semillaZona, op.mp ?? 1.4, tmp, i);
    if (op.salida) fs.copyFileSync(k.reg, path.join(op.salida, `${plano.id}-z${i}-s${semillaZona}.klein.png`));
    // A tamaño del mapa: la ventana registrada en su lugar, compuesta sólo en la máscara de la zona.
    const lleno = path.join(tmp, `lleno-${i}.png`);
    magick([actual, k.reg, "-geometry", `+${px(v.x)}+${px(v.y)}`, "-compose", "over", "-composite", lleno]);
    const m = mascara(porZona[i], W, H, path.join(tmp, `m-${i}.png`), 2);
    actual = componer(actual, lleno, m, path.join(tmp, `c1-${i}.png`));
    informe.klein.push({ zona: z, ventana: v, semilla: semillaZona, lienzo: `${k.ancho}×${k.alto}`, segundos: +k.segundos.toFixed(1),
      anisotropia: +k.corr.anisotropia.toFixed(2), calidad: +k.corr.calidad.toFixed(3), prompt: k.prompt });
  }
  // 3. Detalle por mosaicos, sólo donde tocan las zonas.
  if (op.detalle) {
    const grande = path.join(tmp, "detalle.png"), chico = path.join(tmp, "detalle-100.png");
    const d = await detallarMosaicos(actual, plano, grande, { ...op.detalle, exterior: null, semilla: op.semilla, tmp, zonaInterior: todos });
    magick([grande, "-filter", "Lanczos", "-resize", `${W}x${H}!`, chico]);
    if (op.salida) fs.copyFileSync(chico, path.join(op.salida, `${plano.id}.detalle-100.png`));
    actual = componer(actual, chico, mascara(todos, W, H, path.join(tmp, "m-det.png"), 2), path.join(tmp, "c2.png"));
    informe.detalle = { segundos: +d.segundos.toFixed(1), mosaicos: d.repintados, ...op.detalle };
  }
  // 4. Grading de lo nuevo (opcional) y composición final sobre el mapa de partida.
  if (op.grading) {
    const g = path.join(tmp, "grading.png");
    gradingColor(actual, g, { ...E.grading, ...(typeof op.grading === "object" ? op.grading : {}) }, { tmp });
    actual = componer(actual, g, mascara(todos, W, H, path.join(tmp, "m-gr.png"), 2), path.join(tmp, "c3.png"));
  }
  if (op.igualar !== false) {
    const ig = path.join(tmp, "igualado.png");
    informe.igualar = igualarTonos(actual, ig, plano, zonas, { rects: todos });
    actual = ig;
  }
  {
    const ap = path.join(tmp, "apagado.png");
    informe.puntosApagados = apagarPuntos(actual, ap, plano, todos);
    actual = ap;
  }
  const final = componer(base, actual, mascara(todos, W, H, path.join(tmp, "m-fin.png"), 2), path.join(tmp, "final.png"));
  return { final, tmp, informe, esquema: esq, mascara: mDura, rects: todos };
}

/* -------------------------------------------- */

if (import.meta.filename === process.argv[1]) await main();

async function main() {
  const argv = process.argv.slice(2);
  const opcion = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const solo = opcion("--solo");
  const plano = cargarPlanos().find(p => p.id === solo);
  if (!plano) { console.error("Uso: node tools/parchar-planos.mjs --solo <id> [--semilla N] [--salida <carpeta>] [--forzar]"); process.exit(1); }
  const cfg = CONFIG.mapas?.[plano.id]?.parche;
  if (!cfg?.zonas?.length) { console.error(`mapas.${plano.id}.parche.zonas no está en arte.config.json`); process.exit(1); }
  const fijado = CONFIG.mapas?.[plano.id] ?? {};
  const salida = opcion("--salida") ? path.resolve(opcion("--salida")) : null;
  if (salida) fs.mkdirSync(salida, { recursive: true });
  const destino = salida ? path.join(salida, `${plano.id}-p${opcion("--semilla") ?? cfg.semilla}.webp`) : path.join(MAPAS, `${plano.id}.webp`);
  if (!salida && !argv.includes("--forzar")) { console.error(`${path.relative(RAIZ, destino)} ya existe (usá --forzar)`); process.exit(1); }
  const detalle = argv.includes("--sin-detalle") ? null : { ...(fijado.detalle ?? {}), interior: { ...(fijado.detalle?.interior ?? {}), ...(cfg.detalle ?? {}) } };
  delete detalle?.exterior;
  const op = {
    base: opcion("--base") ?? path.join(MAPAS, `${plano.id}.webp`), zonas: cfg.zonas, semilla: Number(opcion("--semilla") ?? cfg.semilla ?? 1),
    contexto: cfg.contexto, mp: cfg.mp, sellado: fijado.sellarFondo ?? ["roca", "vacio"].includes(plano.fondo), igualar: !argv.includes("--sin-igualar") && cfg.igualar !== false, // `parche.grading`: true = el grading del mapa; un objeto lo pisa (sólo para lo nuevo).
    grading: argv.includes("--sin-grading") || !cfg.grading ? null
      : typeof cfg.grading === "object" ? { ...(typeof fijado.grading === "object" ? fijado.grading : {}), ...cfg.grading } : (fijado.grading ?? true),
    detalle, salida, tmp: fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "sbn-parche-"))
  };
  const t0 = Date.now();
  process.stdout.write(`  ${plano.id} · parche · semilla ${op.semilla} … `);
  const r = await parchar(plano, op);
  magick([r.final, "-quality", "88", destino]);
  if (salida) magick([r.mascara, path.join(salida, `${plano.id}-p${op.semilla}.mascara.png`)]);
  const met = { deriva: derivaMuros(destino, r.esquema, plano), vanos: vanosAbiertos(destino, r.esquema, plano), ...satLum(destino) };
  const segundos = Math.round((Date.now() - t0) / 1000);
  console.log(`✓ ${segundos} s · deriva mediana ${met.deriva.mediana} px, ${met.deriva.dentroTolerancia}% ≤ 5 px · vanos dudosos ${met.vanos.sospechosos}/${met.vanos.vanos} (${met.vanos.cuales.join(", ")}) · sat ${met.sat} lum ${met.lum}`);
  const registro = {
    fecha: new Date().toISOString(), herramienta: "tools/parchar-planos.mjs (inpaint acotado)",
    modelos: [...KLEIN, ...(op.detalle ? ZIMAGE.filter(m => !KLEIN.includes(m)) : [])], licencia: "Apache 2.0",
    workflow: "tools/workflows/plano-klein.json" + (op.detalle ? " + tools/workflows/plano-zimage.json (detalle por mosaicos)" : ""),
    semilla: op.semilla, mascara: { zonas: op.zonas, rects: r.rects.map(o => ({ x: r1(o.x), y: r1(o.y), w: r1(o.w), h: r1(o.h) })), difuminado: "2 px" },
    klein: r.informe.klein, detalle: r.informe.detalle && { ...r.informe.detalle, prompts: "uno por mosaico: prefijo_detalle_control + describirRecorte() + sufijo_detalle" },
    grading: op.grading ? "estilos.battlemap.grading (+ mapas.<id>.grading)" : null,
    igualarTonos: r.informe.igualar ?? null, puntosApagados: r.informe.puntosApagados ?? 0, metricas: met, segundos
  };
  if (salida) {
    fs.appendFileSync(path.join(salida, "resultados.jsonl"), JSON.stringify({ archivo: destino, ...registro }) + "\n");
  } else {
    const archivo = path.join(RAIZ, "assets/PROCEDENCIA.json");
    const reg = JSON.parse(fs.readFileSync(archivo, "utf8"));
    const clave = path.relative(RAIZ, destino);
    reg.imagenes[clave] ??= {};
    (reg.imagenes[clave].parches ??= []).push(registro);
    fs.writeFileSync(archivo, JSON.stringify(reg, null, 2) + "\n");
  }
  fs.rmSync(op.tmp, { recursive: true, force: true });
  if (argv.includes("--liberar")) await liberar();
}

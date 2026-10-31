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
 *   3b. (opcional, `--detalle`) pasada de detalle por mosaicos solapados a
 *      200 px/m sobre el mapa corregido, con prompt por recorte; se baja a
 *      100 px/m y se vuelve a corregir. (`--grading`) grading de color.
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
 *   --detalle | --sin-detalle        pasada de detalle por mosaicos a 200 px/m (Z-Image + canny,
 *                                    interior y exterior por separado), después re-corrige
 *                                    (parámetros: mapas.<id>.detalle o DETALLE_DEFECTO)
 *   --grading | --sin-grading        grading de color determinista (estilos.battlemap.grading)
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
 *   --cache <carpeta>                guarda cada pasada de detalle (clave: base + parámetros + prompts)
 *                                    y la reusa si se repite igual (pruebas de exterior, reproducción)
 *
 * Vigilancia (SBN_LOG_TERMICA=<archivo.jsonl> para el registro): antes de cada
 * mapa, de SeedVR2 y cada 5 mosaicos mira la GPU y la RAM; > 80 °C o < 4 GB
 * disponibles (4 GB; ver VIGILANCIA) = pausa hasta < 70 °C / > 6 GB (POST /free si es por RAM).
 *   --forzar                         pisa assets/mapas/<id>.webp
 *   --ver-prompt                     imprime el prompt y sale
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { renderSvg, normalizar, esMovil, derivarMuros, tipoMueble, oblicuo, PX_POR_M } from "./planos.mjs";
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
/*  Vigilancia de temperatura y RAM              */
/* -------------------------------------------- */

/**
 * Condición del usuario para los lotes largos: antes de cada mapa y cada ~5
 * mosaicos se mira la GPU y la RAM. Si la GPU pasa de 80 °C o la RAM
 * disponible baja de 8 GB, se pausa (con POST /free si es por RAM) hasta
 * < 70 °C / > 12 GB. Todo queda en el registro (`SBN_LOG_TERMICA`, jsonl).
 */
// RAM: 4/6 GB (no 8/12): con 8 GB cada pausa hacía POST /free, la recarga de Z-Image + codificador +
// ControlNet (~27 GB) volvía a bajar la RAM a ~6 GB y se entraba en un bucle (pedido del coordinador, 2026-10-31).
const VIGILANCIA = { tempMax: 80, tempSigue: 70, ramMin: 4, ramSigue: 6, espera: 15000 };
const COMFY = process.env.COMFY_URL ?? "http://127.0.0.1:8188";
function leerSistema() {
  let temp = null, vram = null, ram = null;
  try {
    const [t, m] = execFileSync("nvidia-smi", ["--query-gpu=temperature.gpu,memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8" })
      .trim().split("\n")[0].split(",").map(s => Number(s.trim()));
    temp = t; vram = m;
  } catch { /* sin nvidia-smi: no se vigila la GPU */ }
  try {
    const libre = execFileSync("free", ["-g"], { encoding: "utf8" }).split("\n").find(l => l.startsWith("Mem:")).trim().split(/\s+/);
    ram = Number(libre[6]);
  } catch { /* sin free */ }
  return { temp, vram, ram };
}
function registrar(evento) {
  const linea = JSON.stringify({ t: new Date().toISOString(), ...evento });
  if (process.env.SBN_LOG_TERMICA) fs.appendFileSync(process.env.SBN_LOG_TERMICA, linea + "\n");
  if (evento.tipo !== "control") process.stderr.write(`\n  [vigilancia] ${linea}\n`);
}
export async function vigilar(motivo) {
  const V = VIGILANCIA;
  let s = leerSistema();
  registrar({ tipo: "control", motivo, ...s });
  const caliente = s.temp !== null && s.temp > V.tempMax, sinRam = s.ram !== null && s.ram < V.ramMin;
  if (!caliente && !sinRam) return;
  registrar({ tipo: "pausa", motivo, causa: [caliente && "temperatura", sinRam && "ram"].filter(Boolean).join("+"), ...s });
  const t0 = Date.now();
  if (sinRam) {
    try { await fetch(`${COMFY}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) }); } catch { /* sigue esperando */ }
  }
  for (;;) {
    await new Promise(r => setTimeout(r, V.espera));
    s = leerSistema();
    const okT = !caliente || s.temp === null || s.temp < V.tempSigue, okR = !sinRam || s.ram === null || s.ram > V.ramSigue;
    if (okT && okR) break;
  }
  registrar({ tipo: "reanuda", motivo, segundos: Math.round((Date.now() - t0) / 1000), ...s });
}

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
// Pasada de detalle por defecto (prueba de helen, 2026-10-30): Z-Image Turbo +
// ControlNet canny del propio mosaico, grano inyectado, interior y exterior por
// separado. Los mapas la fijan en arte.config.json (`mapas.<id>.detalle`).
const DETALLE_DEFECTO = {
  densidad: 200, mosaico: 1152, solape: 128,
  interior: { motor: "zimage", denoise: 0.6, ruido: 0.35, control: "canny", fuerza: 0.75, fin: 1, pasos: 8 },
  exterior: { motor: "zimage", denoise: 0.4, ruido: 0.35, control: "canny", fuerza: 0.75, fin: 1, pasos: 8 }
};
const ESCALADOR = { workflow: "escalar-seedvr2", modelos: ["seedvr2_3b_fp16.safetensors", "seedvr2_ema_vae_fp16.safetensors"] };
const SEEDVR2 = { "3b": "seedvr2_3b_fp16.safetensors", "7b": "seedvr2_7b_fp8_e4m3fn.safetensors" };

/* -------------------------------------------- */
/*  Prompt: la planta habitación por habitación  */
/* -------------------------------------------- */

const MAT = E.materiales, OBJ = E.objetos;
const BREVE = MAT._breve ?? {};
const r1 = v => Math.round(v * 10) / 10;

/* -------------------------------------------- */
/*  El lugar, desde el plano                    */
/* -------------------------------------------- */

/** Paleta del prompt (estilos.battlemap.paletas) del plano; la de apartamento si no existe. */
const paletaPrompt = pl => E.paletas?.[pl.paleta] ?? E.paletas?.apartamento ?? {};

/** Pisos de madera (para la advertencia de «nunca naranja»). */
const MADERAS = new Set(["tablas", "tablas-alfombra", "parquet", "tablas-quemadas"]);
/** Fondos que no son exterior abierto: una masa sólida o el vacío. */
const SOLIDOS = new Set(["roca", "macizo", "vacio"]);

/** Fondos de exterior del plano (el general y los de cada zona), sin repetir, en orden. */
function fondosDe(pl) {
  return [...new Set([...(pl.exteriores ?? []).map(z => z.fondo), pl.fondo ?? "edificio"].filter(Boolean))];
}

/**
 * Qué es el lugar, en inglés, para los prefijos: `plano.sujeto` si lo tiene; si
 * no, el sujeto del texto `exterior` («a 1962 glass-and-steel exhibition
 * pavilion in Seattle Center seen from directly above…» → lo que va antes de
 * «seen from», «, with», «:» o « — »; «solid earth… around a basement» → «a
 * basement»); si no, el `lugar` de la paleta.
 */
export function sujetoDe(pl) {
  if (pl.sujeto) return pl.sujeto;
  const ext = (pl.exterior ?? "").replace(/\s*\bat night\b/gi, "").trim();
  const rodea = /\b(?:all )?around (an? [^,:—]+?|the [^,:—]+?)(?:,|:|—| seen\b|$)/i.exec(ext);
  if (/^(solid|the empty|empty)\b/i.test(ext)) {
    if (rodea) return rodea[1].trim();
  } else if (ext) {
    const cortes = [" seen from", ", with ", ":", " —", " in November rain"].map(c => ext.indexOf(c)).filter(i => i > 8);
    const s = cortes.length ? ext.slice(0, Math.min(...cortes)) : ext;
    if (s.split(" ").length <= 22) return s.trim().replace(/[,;:\s]+$/, "");
  }
  return paletaPrompt(pl).lugar ?? "a building in Seattle";
}

/** Una lista en inglés: «a, b and c». */
const enumerar = xs => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Una zona de exterior está «muy abajo» si su nombre lo dice (planta baja, más
 * abajo) y el plano mismo no es la planta baja. Así helen (3.er piso) ve el
 * callejón muy abajo, y el vestíbulo de Gale Sentinel ve su plaza a nivel.
 */
function abajo(pl, z) {
  if (typeof pl.sobreSuelo === "number") return pl.sobreSuelo > 2 && !SOLIDOS.has(z.fondo);
  return /planta baja|m[aá]s abajo|\bm abajo/i.test(z.nombre ?? "") && !/planta baja/i.test(pl.nombre ?? "");
}

/**
 * Los valores de los marcadores de estilo para un plano. Los textos que
 * dependen del tipo de lugar (el grano de los materiales, cuánta mugre, cómo
 * se numeran las puertas) salen de `estilos.battlemap.paletas.<paleta>`, con
 * los de apartamento (los de helen) como respaldo.
 */
function marcadores(pl) {
  const pal = paletaPrompt(pl);
  const base = E.paletas?.apartamento ?? {};
  const deLaPaleta = k => pal[k] ?? base[k] ?? "";
  const hayMapas = (pl.muebles ?? []).some(m => m.tipo === "mapas");
  const pisos = [...new Set(pl.habitaciones.map(h => h.piso).filter(x => x && x !== "macizo"))];
  const fondos = fondosDe(pl);
  const fuera = fondos.filter(f => !SOLIDOS.has(f));
  const breve = k => BREVE[k] ?? MAT[k] ?? k;
  const lejos = (pl.exteriores ?? []).some(z => abajo(pl, z));
  const solido = fondos.find(f => SOLIDOS.has(f));
  const madera = pisos.some(x => MADERAS.has(x)) || fondos.some(x => MADERAS.has(x));
  return {
    LUGAR: sujetoDe(pl),
    ALREDEDOR: fuera.length
      ? `, and around it ${enumerar(fuera.map(breve))}${lejos ? " far below" : ""}`
      : solido ? `, surrounded by ${breve(solido)}` : "",
    MATERIALES: [...new Set([...pisos, ...fondos].map(breve))].join("; "),
    MATERIALES_FUERA: (fuera.length ? fuera : fondos).map(breve).join("; "),
    SUELO: fuera.includes("agua") && fuera.length === 1 ? "dark open water"
      : fuera.length ? `wet ground around ${sujetoDe(pl)}` : `the solid ground around ${sujetoDe(pl)}`,
    SIN_AZUL: fuera.includes("agua") ? "" : ", no blue paint",
    TOPES: pal.topes ?? "flat, matte slate-grey plaster tops",
    MUROS: pal.muros ?? "thick, solid, matte slate-grey plaster",
    MADERA: madera ? "old floorboards in a muted grey-brown (never orange, honey or golden wood, but still recognisably wood); " : "",
    TONO_MADERA: madera ? ", grey-brown wood" : "",
    GRANO: deLaPaleta("grano"),
    GRANO_DETALLE: deLaPaleta("granoDetalle"),
    DETALLE: deLaPaleta("detalle"),
    NUMEROS: deLaPaleta("numeros"),
    PASILLO: pl.habitaciones.some(h => /pasillo|corredor/i.test(h.nombre ?? "")) ? ", and the corridor is as dim as the rest" : "",
    EN_MAPAS: hayMapas ? " writing on the maps pinned to the walls," : "",
    PAPELES: hayMapas ? "the pinned maps or papers" : "papers or screens",
    ACENTO: (pl.muebles ?? []).some(m => m.tipo === "mapas") ? " (the red pins on the wall maps)" : pal.acento ? ` (${pal.acento})` : "",
    PISOS: enumerar(pisos.map(breve)),
    AFUERA: fuera.length ? `Outdoors everything is wet from the rain: ${fuera.map(breve).join(", ")}; but ` : "Everything here is out of the rain; "
  };
}

/** Un texto de estilo (prefijo, sufijo…) con los marcadores llenos para este plano. */
export function estilo(clave, plano) {
  const v = marcadores(normalizar(plano));
  return (typeof E[clave] === "string" ? E[clave] : "").replace(/\{([A-Z_]+)\}/g, (todo, k) => v[k] ?? todo);
}

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

/**
 * Qué es la habitación, en inglés, deducido de su nombre (que está en español),
 * de su piso y de lo que tiene adentro. Va por capas:
 *   1. lugares que mandan sobre los muebles (un porche con escalones no es una
 *      caja de escalera; una caravana con cama no es un dormitorio);
 *   2. los muebles (baño, cocina, dormitorio, escalera), como en helen;
 *   3. el resto de las palabras del nombre;
 *   4. la forma (pasillo largo, recibidor chico) y, al final, «a room».
 */
const ROL_LUGAR = [
  [/escalera de incendios/, "an exterior steel fire-escape landing bolted to the outside of the building wall"],
  [/^escalera.*exterior/, "an exterior steel stair of open grating clinging to the outside wall"],
  [/^(escalera|caja de escalera|caseta de la escalera)/, "a stairwell"],
  [/granero/, "the inside of an old wooden barn"],
  [/sal[oó]n de pasajeros/, "the passenger cabin of a car ferry, rows of fixed bench seats"],
  [/sala de espera/, "the waiting hall of a ferry terminal"],
  [/detr[aá]s de la barra/, "the narrow strip behind the bar counter, part of the bar room"],
  [/sala del bar|^bar\b/, "the main room of an old bar"],
  [/barber[ií]a/, "an old barber's shop turned into an office"],
  [/mercado/, "an underground market hall"],
  [/refugio|carbonera/, "a cramped underground shelter in an old coal cellar"],
  [/muelle/, "a pier deck on wooden piles over the water"],
  [/porche/, "a covered wooden porch along the outside of the house, open on its outer side"],
  [/terraza/, "an open outdoor terrace"],
  [/paseo exterior/, "an open outdoor promenade deck along the side of the ship"],
  [/aler[oó]n/, "an open bridge wing, an outdoor steel platform jutting from the side of the ship's bridge"],
  [/cubierta de veh[ií]culos/, "the enclosed vehicle deck of a car ferry, a long steel deck with painted lane lines"],
  [/cubierta/, "an open outdoor deck of the ship"],
  [/pasarela|rampa de pasajeros/, "a narrow gangway walkway"],
  [/grada de botadura|botadura/, "the concrete head of a boat slipway, sloping down towards the water"],
  [/caravana|tr[aá]iler/, "the cramped interior of a small trailer home"],
  [/perrera/, "an outdoor row of dog runs on a concrete slab"],
  [/acera de 18|vereda de 18/, "a buried old brick sidewalk under the city, now underground"],
  [/techo|azotea/, "a flat rooftop"],
  [/galer[ií]a de cintas/, "a long enclosed conveyor gallery on top of the silos"],
  [/boca del desag[uü]e/, "the mouth of an old brick storm drain"]
];
const ROL_NOMBRE = [
  [/ascensor.*cabina|cabina/, "a lift car"],
  [/hall de ascensores|vest[ií]bulo de ascensores|rellano de ascensores/, "a lift lobby"],
  [/ascensor/, "a lift car"],
  [/escalera/, "a stairwell"],
  [/sala de calderas|calderas/, "an old boiler room"],
  [/sala de servidores|racks|c[oó]mputo|nido de servidores/, "a server room"],
  [/sala de control/, "a control room"],
  [/sala de pruebas|entrenamiento/, "a test room full of equipment"],
  [/esclusa/, "a small security airlock vestibule between two doors"],
  [/archivo/, "an archive room"],
  [/armer[ií]a/, "an armoury"],
  [/sala blanca/, "a bare white interrogation room"],
  [/sala de reuniones|sala del consejo|reuniones/, "a meeting room"],
  [/sala de espera/, "a waiting hall"],
  [/sala del bar|\bbar\b/, "the main room of a bar"],
  [/trastienda/, "a back room"],
  [/barber[ií]a/, "an old barber's shop"],
  [/mercado/, "an underground market hall"],
  [/refugio|carbonera/, "a cramped underground shelter in an old coal cellar"],
  [/b[oó]veda/, "an underground vault"],
  [/antec[aá]mara/, "a bare antechamber"],
  [/t[uú]nel/, "a narrow underground tunnel"],
  [/c[aá]mara/, "a small hidden chamber"],
  [/s[oó]tano/, "a cellar"],
  [/losa/, "a patch of new concrete slab"],
  [/puente|timonera/, "the enclosed bridge of a ship"],
  [/sal[oó]n de pasajeros/, "the passenger cabin of a ferry"],
  [/despacho|oficina de seguridad|oficina/, "an office"],
  [/planta abierta|mesas abiertas/, "an open-plan office floor"],
  [/recepci[oó]n/, "a reception area"],
  [/vest[ií]bulo|hall/, "a lobby"],
  [/office|cocina|rinc[oó]n del caf[eé]/, "a small staff kitchen"],
  [/ba[nñ]o|aseo/, "a small bathroom"],
  [/cuarto de botas/, "a mudroom by the back door"],
  [/cuarto blindado/, "a small armoured room"],
  [/habitaci[oó]n|dormitorio/, "a bedroom"],
  [/nave/, "the open floor of a large hangar"],
  [/almac[eé]n|dep[oó]sito/, "a storeroom"],
  [/sal[oó]n privado|sal[oó]n/, "a lounge"],
  [/gran sala/, "a large hall"],
  [/^sala\b/, "a living room"],
  [/nicho/, "a small alcove"],
  [/pasillo|corredor/, "a corridor"],
  [/recibidor/, "a small entrance hall"],
  [/armario/, "a shallow built-in closet"],
  [/pie de la escalera/, "the landing at the foot of the stairs"]
];
const minus = t => (t ?? "").toLowerCase();

function rol(h, muebles) {
  const t = new Set(muebles.map(tipoMueble));
  const nombre = minus(h.nombre);
  // Una mesada es cocina si es de cocina (bacha, anafe); los mostradores, la
  // barra o el podio de seguridad también se escribieron como mesada.
  const cocina = t.has("heladera") || muebles.some(m => m.tipo === "mesada" && (!m.desc || /kitchen|sink|hob|stove|galley/i.test(m.desc)));
  const area = h.w * h.h;
  if (h.piso === "rejilla" && !nombre) return ROL_LUGAR[0][1];
  for (const [re, txt] of ROL_LUGAR) if (re.test(nombre)) return txt;
  if (h.piso === "rejilla") return "an open steel grating platform outside the building";
  if (t.has("escalera") && !t.has("cama")) return "a stairwell";
  if (t.has("banera") || t.has("inodoro") || t.has("ducha")) return "a small bathroom";
  if (h.sinMuros && cocina) return "a kitchen strip with no walls of its own, part of the larger room around it";
  if (t.has("cama")) return t.has("escritorio") ? "a bedroom-study" : "a bedroom";
  if (t.has("tv") && cocina) return "a living room with a kitchen";
  if (t.has("tv")) return "a living room";
  if (cocina) return "a kitchen";
  if (h.piso === "tablas-alfombra") return "a long corridor";
  for (const [re, txt] of ROL_NOMBRE) if (re.test(nombre)) return txt;
  if (Math.max(h.w, h.h) / Math.min(h.w, h.h) > 3.5) return "a long corridor";
  if (t.size && [...t].every(x => x === "estante")) return "a shallow built-in closet";
  if (area < 6) return "a small entrance hall";
  return "a room";
}

/** Aclaraciones vigentes: las de estilos.battlemap más las de mapas.<id>.aclaraciones (las pisa pintar()). */
let ACLARACIONES = E.aclaraciones ?? {};
function textoMueble(m) {
  const tipo = tipoMueble(m);
  const a = ACLARACIONES[tipo];
  return (m.desc ?? OBJ[tipo] ?? tipo) + (a ? ` (${a})` : "");
}

/**
 * Una zona de exterior en palabras: tira o área, de agua o de suelo, y a qué
 * altura queda respecto del plano (abajo, si el plano es una planta alta).
 */
function zonaExterior(pl, z) {
  const forma = Math.max(z.w, z.h) / Math.min(z.w, z.h) >= 3 ? "strip" : "area";
  const un = forma === "area" ? "an" : "a";
  const que = z.fondo === "agua" ? `${un} ${forma} of open water` : z.fondo === "edificio" ? `${un} ${forma} of flat rooftop`
    : SOLIDOS.has(z.fondo) ? `${un} ${forma} of solid ground` : `an outdoor ${forma}`;
  return que + (abajo(pl, z) ? (z.fondo === "agua" ? " far below" : " at street level far below") : "");
}

/**
 * Dónde están las barandas, en palabras, según lo que separan: la escalera de
 * incendios (piso de rejilla), una escalera (habitación con escalera), un
 * borde abierto (terraza, cubierta, porche, muelle) o, si no, «along open edges».
 */
function dondeBarandas(pl) {
  const toca = (v, h) => {
    const [x1, y1, x2, y2] = v.eje === "h" ? [v.x, v.y, v.x + v.w, v.y] : [v.x, v.y, v.x, v.y + v.w];
    const cerca = (a, b) => Math.abs(a - b) < 0.05;
    return v.eje === "h"
      ? (cerca(y1, h.y) || cerca(y1, h.y + h.h) || (y1 > h.y && y1 < h.y + h.h)) && x2 > h.x && x1 < h.x + h.w
      : (cerca(x1, h.x) || cerca(x1, h.x + h.w) || (x1 > h.x && x1 < h.x + h.w)) && y2 > h.y && y1 < h.y + h.h;
  };
  const conEscalera = h => (pl.muebles ?? []).some(m => m.tipo === "escalera" && dentro(m, h));
  const lugares = new Set();
  for (const v of (pl.vanos ?? []).filter(v => v.tipo === "baranda")) {
    const habs = pl.habitaciones.filter(h => toca(v, h));
    const rejilla = habs.find(h => h.piso === "rejilla");
    if (rejilla) lugares.add(/incendios/i.test(rejilla.nombre ?? "") ? "around the fire escape" : "around the open steel landing");
    else if (habs.some(conEscalera)) lugares.add("beside the stairs");
    else lugares.add("along open edges");
  }
  if ((pl.curvas ?? []).some(c => c.tipo === "baranda")) lugares.add("along open edges");
  return enumerar([...lugares]);
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
    // Un contorno con tramos oblicuos (el pabellón curvo): que no lo enderece.
    const curvo = h._puntos?.some((q, i, P) => { const n = P[(i + 1) % P.length]; return q.x !== n.x && q.y !== n.y; });
    lineas.push(`- ${rol(h, ms)}, ${r1(h.w)} × ${r1(h.h)} m${curvo ? ", its outline curved and angled exactly as drawn, not a rectangle" : ""}, in the ${donde(h.x + h.w / 2, h.y + h.h / 2, marco)}. ` +
      `Floor: ${MAT[h.piso] ?? h.piso}.` + (lista ? ` Fixed furniture: ${lista}.` : " Nothing else in it: an empty floor."));
  }

  const sellados = pl.habitaciones.filter(h => h.piso === "macizo");
  const exteriores = (pl.exteriores ?? []).map(z => {
    const ms = fijos.filter(m => !asignado.has(m) && dentro(m, z));
    ms.forEach(m => asignado.set(m, z));
    return `- ${zonaExterior(pl, z)}, ${r1(z.w)} × ${r1(z.h)} m, in the ${donde(z.x + z.w / 2, z.y + z.h / 2, marco)}: ` +
      `${MAT[z.fondo] ?? z.fondo}` + (ms.length ? `, with ${[...new Set(ms.map(textoMueble))].join(" and ")}` : "") + ".";
  });
  const sueltos = fijos.filter(m => !asignado.has(m));

  const vanos = pl.vanos ?? [];
  const cuenta = (...t) => vanos.filter(v => t.includes(v.tipo)).length;
  // Las secretas se pintan como muro: no cuentan como hueco. Las puertas que son
  // tramos de un contorno curvo (la Galería) también son huecos.
  const tramosCurvos = [...pl.habitaciones.flatMap(h => h._puntos ?? []), ...(pl.curvas ?? []).flatMap(c => c._puntos)];
  const huecos = cuenta("puerta", "abierto", "puerta-vidrio") + tramosCurvos.filter(q => ["puerta", "puerta-vidrio"].includes(q.tipo)).length;
  const vidrios = cuenta("ventana", "vidrio");
  const sinVidrio = cuenta("hueco");
  const barandas = cuenta("baranda") + (pl.curvas ?? []).filter(c => c.tipo === "baranda" || c._puntos.some(q => q.tipo === "baranda")).length;
  const vidrioCurvo = tramosCurvos.some(q => ["vidrio", "ventana"].includes(q.tipo));
  const marcoVentana = paletaPrompt(pl).marco ?? "a thin painted wooden frame with a narrow sill";

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
  partes.push("OPENINGS:" + (huecos ? ` there are ${huecos} doorway openings in the walls, each drawn as a gap ${L ? "in the black wall outline" : "with a pale threshold strip and short dashed marks"}: ` +
    "every one stays an empty, open gap of the same width — never close it, never fill it with wall, never put a door leaf in it." : "") +
    (vidrioCurvo ? ` The curved and angled glass walls follow the outline exactly as drawn, faceted panes of dark, unlit glass in ${marcoVentana}.` : "") +
    (vidrios ? ` The ${vidrios} ${L ? "thin double lines set into the outer walls" : "thin pale-blue strips set into the walls"} are WINDOWS, not lamps (${vanos.filter(v => ["ventana", "vidrio"].includes(v.tipo))
      .map(v => `${r1(v.w)} m wide in the ${donde(v.eje === "h" ? v.x + v.w / 2 : v.x, v.eje === "h" ? v.y : v.y + v.w / 2, marco).split(",")[0]}`).join("; ")}): ` +
      `render each one as a pane of dark, unlit glass in ${marcoVentana}, flush with the wall; no light comes through them.` : "") +
    (sinVidrio ? ` The ${sinVidrio} ${L ? "short dark slots in the walls" : "dark slots set into the walls"} are empty window openings with no glass and no frame left: a low broken sill and darkness beyond.` : "") +
    (barandas ? ` The ${barandas} ${L ? "thin single lines" : "thin dark lines with small square posts"} are railings (${dondeBarandas(pl)}): keep them thin black iron or wooden railings, never thicken them into walls.` : ""));
  if (exteriores.length || pl.exterior) {
    // «night» enciende farolas y ventanas en los modelos: se saca del texto del plano.
    const fuera = (pl.exterior ?? MAT[pl.fondo ?? "asfalto"] ?? "wet asphalt").replace(/\s*\bat night\b/gi, "").replace(/\bnight\b/gi, "evening");
    partes.push(`OUTSIDE THE WALLS, continue to all four edges of the image with ${fuera}.` +
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
  const pre = camino === "controlnet" ? estilo("prefijo_control", plano) : estilo("prefijo", plano) + ref;
  let cuerpo = describirPlano(plano, marco, macizo, entrada);
  if (camino === "controlnet") cuerpo = cuerpo.replace(/the schematic/g, "the plan");
  return `${pre}${cuerpo}${estilo("sufijo", plano)}`;
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
export function esquemaPng(plano, destino) {
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
    if (oblicuo(m.c)) {
      // Tramo oblicuo (curvas): los dos cantos de la banda, o una línea si es baranda.
      const L = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
      const d = m._tipo === "muro" || m._tipo === "secreta" ? g / 2 : m._tipo === "baranda" ? 0 : 5;
      if (d) { linea(x1 + nx * d, y1 + ny * d, x2 + nx * d, y2 + ny * d, 3); linea(x1 - nx * d, y1 - ny * d, x2 - nx * d, y2 - ny * d, 3); }
      else linea(x1, y1, x2, y2, 3);
      continue;
    }
    if (m._tipo === "muro" || m._tipo === "secreta") {
      if (hor) rect(x1 - g / 2, y1 - g / 2, x2 - x1 + g, g, 4);
      else rect(x1 - g / 2, y1 - g / 2, g, y2 - y1 + g, 4);
    } else if (["ventana", "vidrio", "puerta-vidrio", "hueco"].includes(m._tipo)) {
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
  for (const m of derivarMuros(plano).filter(m => m._tipo === "muro" && !oblicuo(m.c))) {
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
export function sellarMacizos(destino, plano, { fondo = false } = {}) {
  const W = plano.ancho * PX_POR_M, H = plano.alto * PX_POR_M, m = 17, e = 16;
  const habs = normalizar(plano).habitaciones;
  // Los huecos (`vacio`: el hueco de la escalera de Larchmont) también: el material pide un
  // relleno casi negro liso y la pasada de detalle pinta escombros y escaleras adentro.
  const bloques = habs.filter(h => h.piso === "macizo" || h.piso === "vacio");
  if (!bloques.length && !fondo) return 0;
  // Con `fondo` (planos de fondo `roca` o `vacio`): todo lo que queda fuera de las
  // habitaciones (más medio muro) también es macizo: la roca alrededor de un
  // sótano (o el vacío fuera de las ventanas de una torre) no se pisa, y los modelos
  // la pintan como una losa clara de hormigón.
  const fuera = fondo
    ? ["-fill", "black", ...habs.filter(h => h.piso !== "macizo" && h.piso !== "vacio").flatMap(h => ["-draw",
      `rectangle ${h.x * PX_POR_M - e},${h.y * PX_POR_M - e} ${(h.x + h.w) * PX_POR_M + e - 1},${(h.y + h.h) * PX_POR_M + e - 1}`])]
    : [];
  const dibujo = bloques.flatMap(h => ["-draw",
    `rectangle ${h.x * PX_POR_M + m},${h.y * PX_POR_M + m} ${(h.x + h.w) * PX_POR_M - m},${(h.y + h.h) * PX_POR_M - m}`]);
  const tmp = `${destino}.sellado.png`;
  magick([destino,
    "(", "-size", `${W}x${H}`, `xc:${COLOR_MACIZO}`, "-seed", "1", "-attenuate", "0.25", "+noise", "Gaussian", "-blur", "0x0.7", ")",
    "(", "-size", `${W}x${H}`, fondo ? "xc:white" : "xc:black", ...fuera, "-fill", "white", ...dibujo, "-blur", "0x1.5", "-alpha", "off", ")",
    "-compose", "over", "-composite", tmp]);
  magick([tmp, "-quality", "88", destino]);
  fs.rmSync(tmp, { force: true });
  return bloques.length + (fondo ? 1 : 0);
}

export function satLum(ruta) {
  const [s, l] = magick([ruta, "-colorspace", "HSL", "-format", "%[fx:mean.g*100] %[fx:mean.b*100]", "info:"], { encoding: "utf8" })
    .trim().split(/\s+/).map(Number);
  return { sat: Math.round(s * 10) / 10, lum: Math.round(l * 10) / 10 };
}

/* -------------------------------------------- */
/*  Pasada de detalle por mosaicos (--detalle)   */
/* -------------------------------------------- */

/**
 * El modelo pinta el plano entero a ~1,5 MP (≈ 60 px por metro): no le
 * alcanzan los píxeles para vetas, juntas, mugre y sombras de contacto, y el
 * resultado se ve como el esquema con una textura encima. Esta pasada toma el
 * mapa ya corregido, lo lleva a `densidad` px/m (200 = el doble), lo parte en
 * mosaicos solapados de ~1 MP y repinta cada uno con denoise parcial y un
 * prompt que describe SÓLO lo que cae en ese recorte (sale del plano). Las
 * costuras se mezclan con rampas lineales en todo el solape.
 */

/** Recorte de un rectángulo del plano (m) con la ventana `r`; null si no se tocan. */
function recortar(o, r) {
  const x0 = Math.max(o.x, r.x), y0 = Math.max(o.y, r.y);
  const x1 = Math.min(o.x + o.w, r.x + r.w), y1 = Math.min(o.y + o.h, r.y + r.h);
  return x1 - x0 > 0.05 && y1 - y0 > 0.05 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Dónde cae un rectángulo (ya recortado) dentro del mosaico, en palabras. */
function enMosaico(c, r) {
  const fx0 = (c.x - r.x) / r.w, fx1 = (c.x + c.w - r.x) / r.w;
  const fy0 = (c.y - r.y) / r.h, fy1 = (c.y + c.h - r.y) / r.h;
  const pct = `(${Math.round(fx0 * 100)}–${Math.round(fx1 * 100)}% across, ${Math.round(fy0 * 100)}–${Math.round(fy1 * 100)}% down)`;
  if (fx1 - fx0 > 0.85 && fy1 - fy0 > 0.85) return "the whole crop";
  if (fx1 - fx0 > 0.7 && fy1 - fy0 > 0.7) return `most of the crop ${pct}`;
  const h = fx1 - fx0 > 0.7 ? "" : (fx0 + fx1) / 2 < 0.36 ? "left" : (fx0 + fx1) / 2 > 0.64 ? "right" : "centre";
  const v = fy1 - fy0 > 0.7 ? "" : (fy0 + fy1) / 2 < 0.36 ? "top" : (fy0 + fy1) / 2 > 0.64 ? "bottom" : "middle";
  const franja = !h ? `a ${v === "middle" ? "horizontal band across the middle" : `band along the ${v}`}` : !v ? `a ${h === "centre" ? "vertical band down the centre" : `band down the ${h} side`}` : null;
  const zona = franja ?? (h === "centre" && v === "middle" ? "the centre" : `the ${v === "middle" ? "" : v + "-"}${h === "centre" ? "centre" : h}`);
  return `${zona} ${pct}`;
}

/** Muebles fijos asignados a la habitación más chica que los contiene. */
function asignarMuebles(pl) {
  const fijos = (pl.muebles ?? []).filter(m => !esMovil(m));
  const habs = pl.habitaciones.filter(h => h.piso !== "macizo");
  const de = new Map();
  for (const m of fijos) {
    const cand = habs.filter(h => dentro(m, h)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (cand) de.set(m, cand);
  }
  return { fijos, habs, de };
}

/** Muebles que la pasada de detalle no toca (quedan de la base, como la rejilla). */
const DE_BASE = new Set(["escalerilla"]);

/** Exterior del recorte: zonas a nivel de calle, el fondo y sus muebles fijos con posición. */
function exterioresRecorte(pl, r, fijos, de) {
  const lineas = (pl.exteriores ?? []).map(z => {
    const c = recortar(z, r);
    if (!c) return null;
    const ms = fijos.filter(m => !de.has(m) && !DE_BASE.has(m.tipo) && dentro(m, z) && recortar(m, r));
    return `- covering ${enMosaico(c, r)}: ${MAT[z.fondo] ?? z.fondo}` +
      (ms.length ? `, with ${ms.map(m => `${textoMueble(m)} in ${enMosaico(recortar(m, r), r).split(" (")[0]}`).join(" and ")}` : "") + ".";
  }).filter(Boolean);
  return lineas;
}

/**
 * Cuerpo del prompt de un mosaico: qué hay en la ventana `r` (metros) del
 * plano. `modo: "exterior"` describe sólo el suelo de afuera (la pasada de
 * exterior no ve el edificio: esos píxeles se descartan al componer).
 */
export function describirRecorte(plano, r, modo = "interior") {
  const pl = normalizar(plano);
  const { fijos, habs, de } = asignarMuebles(pl);
  const fondo = MAT[pl.fondo ?? "edificio"] ?? pl.exterior ?? "the ground around the building";
  const exteriores = exterioresRecorte(pl, r, fijos, de);
  // Qué es el afuera (suelo, techos, agua, roca) y si está muy abajo.
  const fondos = fondosDe(pl);
  const clases = [...new Set(fondos.map(f => f === "agua" ? "open water" : f === "edificio" ? "flat roofs" : SOLIDOS.has(f) ? "solid ground" : "open ground"))];
  const lejos = (pl.exteriores ?? []).some(z => abajo(pl, z));
  if (modo === "exterior") {
    return `WHAT THIS CROP SHOWS (all of it is ${enumerar(clases).replace(/ and /g, " or ")}${lejos ? " at street level, seen from high above" : ", seen from directly above"}):\n` +
      (exteriores.length ? exteriores.join("\n") + `\n- everything else: ${fondo}.` : `- the whole crop: ${fondo}.`) +
      "\n\nNothing else: no ladders, no stairs, no scaffolding, no walls, no windows, no brickwork, no furniture, no vehicles, no debris piles; only the ground surfaces and the objects listed.";
  }
  const partes = [];
  const salas = [];
  for (const h of habs) {
    const c = recortar(h, r);
    if (!c || c.w * c.h < 0.25) continue;
    const ms = fijos.filter(m => de.get(m) === h);
    const visibles = ms.filter(m => recortar(m, r));
    // Cada objeto con su lugar en el recorte: sin eso el modelo mezcla (pintó
    // un mapa con alfileres sobre la almohada de la cama).
    const cosas = [...new Set(visibles.map(m => `${textoMueble(m)} (in ${enMosaico(recortar(m, r), r).split(" (")[0]})`))];
    salas.push(`- part of ${rol(h, ms)}, covering ${enMosaico(c, r)}. Floor: ${MAT[h.piso] ?? h.piso}.` +
      (cosas.length ? ` In it: ${cosas.join("; ")}.` : " Nothing else on this floor: keep it empty."));
  }
  const macizos = pl.habitaciones.filter(h => h.piso === "macizo").map(h => recortar(h, r)).filter(Boolean);
  if (salas.length) partes.push(`WHAT THIS CROP SHOWS:\n${salas.join("\n")}`);
  if (exteriores.length) partes.push(`OUTSIDE THE WALLS${lejos ? ", at street level far below" : ""}:\n${exteriores.join("\n")}\n- anything else outside the outer walls: ${fondo}.`);
  else if (!salas.length && !macizos.length) partes.push(`The whole crop is ${fondo}.`);
  if (macizos.length) partes.push(`SOLID OFF-LIMITS MASS: ${macizos.map(c => enMosaico(c, r)).join("; ")} is a flat, featureless, near-black solid fill: keep it exactly as flat and dark, paint nothing inside it.`);
  const vanos = (pl.vanos ?? []).filter(v => {
    const c = v.eje === "h" ? { x: v.x, y: v.y - 0.2, w: v.w, h: 0.4 } : { x: v.x - 0.2, y: v.y, w: 0.4, h: v.w };
    return recortar(c, r);
  });
  const n = t => vanos.filter(v => t.includes(v.tipo)).length;
  const avisos = [];
  if (n(["puerta", "abierto", "puerta-vidrio", "arcada"])) avisos.push("every gap in a wall is an empty doorway: keep it open, at most a faint threshold strip, never a door leaf");
  if (n(["ventana", "vidrio"])) avisos.push("the thin strips set into the outer walls are windows of dark, unlit glass in a thin painted frame, no light through them");
  if (n(["hueco"])) avisos.push("the dark slots in the walls are empty window openings with no glass and no frame");
  if (n(["baranda"])) avisos.push("thin railings stay thin black iron railings, never thickened into walls");
  if (avisos.length) partes.push(`OPENINGS: ${avisos.join("; ")}.`);
  return partes.join("\n\n");
}

/** Prompt de un mosaico: prefijo de detalle (por motor y pasada) + recorte + sufijo. */
export function promptMosaico(plano, r, motor, modo = "interior") {
  const clave = modo === "exterior" ? "prefijo_detalle_exterior" : motor === "klein" ? "prefijo_detalle" : "prefijo_detalle_control";
  const pre = estilo(clave, plano).replaceAll("{W}", r1(r.w)).replaceAll("{H}", r1(r.h));
  return `${pre}${describirRecorte(plano, r, modo)}${estilo(E.sufijo_detalle ? "sufijo_detalle" : "sufijo", plano)}`;
}

/** Posiciones de los mosaicos sobre un eje: n mosaicos de `t` px, solape ≥ `solape`. */
function posiciones(L, t, solape) {
  if (L <= t) return [0];
  const n = Math.ceil((L - solape) / (t - solape));
  return Array.from({ length: n }, (_, i) => Math.round((i * (L - t)) / (n - 1)));
}

function crudoRgb(ruta) {
  return magick([ruta, "-alpha", "off", "-depth", "8", "rgb:-"]);
}

/** Rectángulos (m) de las zonas del plano para componer las pasadas. */
function zonasDetalle(plano, modo = "caja") {
  const pl = normalizar(plano);
  const dentroEdificio = pl.habitaciones.filter(h => h.piso !== "rejilla");
  const g = 0.15;   // medio muro exterior
  const x0 = Math.min(...dentroEdificio.map(h => h.x)) - g, y0 = Math.min(...dentroEdificio.map(h => h.y)) - g;
  const x1 = Math.max(...dentroEdificio.map(h => h.x + h.w)) + g, y1 = Math.max(...dentroEdificio.map(h => h.y + h.h)) + g;
  return {
    // «caja»: el rectángulo que envuelve todas las habitaciones (un edificio).
    // «habitaciones» (mapas.<id>.detalle.edificio): cada habitación con medio
    // muro, para los planos de varios edificios sueltos (la granja): así el
    // patio de grava entre ellos lo pinta la pasada de exterior, no la de interior.
    edificio: modo === "habitaciones"
      ? dentroEdificio.map(h => ({ x: h.x - g, y: h.y - g, w: h.w + 2 * g, h: h.h + 2 * g }))
      : [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }],
    // La rejilla de la escalera de incendios (y sus barandas) queda de la base:
    // repintada se llena de objetos de colores entre los barrotes.
    base: [...pl.habitaciones.filter(h => h.piso === "rejilla"), ...(pl.muebles ?? []).filter(m => DE_BASE.has(m.tipo))]
      .map(h => ({ x: h.x - 0.12, y: h.y - 0.12, w: h.w + 0.24, h: h.h + 0.24 })),
    macizos: pl.habitaciones.filter(h => h.piso === "macizo")
  };
}

/** `capa` sobre `fondo` donde `masc` es blanca (la máscara pasa a ser el alfa de la capa). */
function componer(fondo, capa, masc, destino) {
  magick([fondo, "(", capa, "(", masc, "-alpha", "off", "-colorspace", "gray", ")", "-alpha", "off", "-compose", "copy_opacity", "-composite", ")",
    "-compose", "over", "-composite", "-alpha", "off", destino]);
  return destino;
}

/** Máscara blanca sobre negro (PNG, W×H) de una lista de rectángulos en metros. */
function mascara(rects, W, H, D, destino, difuminado = 2) {
  magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
    ...rects.flatMap(o => ["-draw", `rectangle ${Math.round(o.x * D)},${Math.round(o.y * D)} ${Math.round((o.x + o.w) * D) - 1},${Math.round((o.y + o.h) * D) - 1}`]),
    ...(difuminado ? ["-blur", `0x${difuminado}`] : []), destino]);
  return destino;
}

/**
 * Una pasada sobre `grande` (PNG a la densidad de trabajo): repinta los
 * mosaicos que tocan `zona` (rectángulos en m) y mezcla las costuras. Los
 * mosaicos que no la tocan quedan de la base. Escribe `destino` (PNG).
 */
async function pasada(grande, plano, destino, zona, modo, p, ctx) {
  const { D, T, S, W, H, tmp } = ctx;
  // Caché (pruebas): misma base + mismos parámetros = misma pasada.
  const xs = posiciones(W, T, S), ys = posiciones(H, T, S);
  const textos = ys.flatMap(y0 => xs.map(x0 => promptMosaico(plano, { x: x0 / D, y: y0 / D, w: T / D, h: T / D }, p.motor, modo)));
  const clave = ctx.cache && path.join(ctx.cache, `${plano.id}-${modo}-${crypto.createHash("sha1")
    .update(fs.readFileSync(grande)).update(JSON.stringify({ p, D, T, S, s: ctx.semilla, textos, zona }))
    .digest("hex").slice(0, 12)}.png`);
  if (clave && fs.existsSync(clave)) { fs.copyFileSync(clave, destino); return { segundos: 0, repintados: 0, prompts: [], cache: true }; }
  const r = await pasadaGpu(grande, plano, destino, zona, modo, p, ctx);
  if (clave) { fs.mkdirSync(ctx.cache, { recursive: true }); fs.copyFileSync(destino, clave); }
  return r;
}

async function pasadaGpu(grande, plano, destino, zona, modo, p, ctx) {
  const { D, T, S, W, H, tmp } = ctx;
  const xs = posiciones(W, T, S), ys = posiciones(H, T, S);
  const acc = new Float32Array(W * H * 3), peso = new Float32Array(W * H);
  const wf = cargarWorkflow(p.motor === "klein" ? "detalle-klein" : "plano-zimage");
  if (p.motor !== "klein" && (p.control ?? "no") === "no") {
    // Z-Image sin ControlNet: el modelo va directo al muestreador.
    for (const k of ["4", "5", "6", "7"]) delete wf[k];
    wf["8"].inputs.model = ["1", 0];
  }
  if (p.motor === "klein" && p.referencia === false) wf["9"].inputs.conditioning = ["7", 0];
  let i = 0, segundos = 0;
  const prompts = [];
  for (const y0 of ys) for (const x0 of xs) {
    i++;
    const r = { x: x0 / D, y: y0 / D, w: T / D, h: T / D };
    const tile = path.join(tmp, `${modo}-m${i}.png`);
    magick([grande, "-crop", `${T}x${T}+${x0}+${y0}`, "+repage", tile]);
    let salida = tile;
    if (zona.some(z => recortar(z, r))) {
      if (prompts.length % 5 === 0) await vigilar(`${plano.id} ${modo} mosaico ${i}`);
      const texto = promptMosaico(plano, r, p.motor, modo);
      prompts.push({ modo, i, x0, y0, prompt: texto });
      // Grano: sin textura de partida el img2img devuelve rellenos lisos.
      let entrada = tile;
      if (p.ruido) {
        entrada = path.join(tmp, `${modo}-r${i}.png`);
        magick([tile, "-seed", String(ctx.semilla + i), "-attenuate", String(p.ruido), "+noise", "Gaussian", entrada]);
      }
      const valores = { IMAGEN: entrada, SEMILLA: ctx.semilla * 100 + i, ANCHO: T, ALTO: T, PROMPT: texto,
        PREFIJO: `sbn/${plano.id}-detalle-${modo}-${i}`, DENOISE: p.denoise, PASOS: p.pasos ?? 8 };
      if (p.motor !== "klein") {
        // El control sale del mosaico SIN grano: sólo los cantos de verdad.
        const ctl = path.join(tmp, `${modo}-c${i}.png`);
        magick(p.control === "canny"
          ? [tile, "-colorspace", "gray", "-canny", "0x1.5+10%+25%", ctl]
          : [tile, "-colorspace", "gray", "-normalize", ctl]);
        Object.assign(valores, { CONTROL: ctl, FUERZA: p.fuerza ?? 0.75, FIN_CONTROL: p.fin ?? 1 });
      }
      const res = await ejecutar(wf, valores);
      segundos += res.segundos;
      salida = path.join(tmp, `${modo}-p${i}.png`);
      fs.writeFileSync(salida, res.salidas[0].buffer);
    }
    // Mezcla: rampa lineal en todo el solape con el vecino (bordes del lienzo: peso 1).
    const px = crudoRgb(salida);
    const ix = xs.indexOf(x0), iy = ys.indexOf(y0);
    const izq = ix > 0 ? xs[ix - 1] + T - x0 : 0, der = ix < xs.length - 1 ? x0 + T - xs[ix + 1] : 0;
    const arr = iy > 0 ? ys[iy - 1] + T - y0 : 0, aba = iy < ys.length - 1 ? y0 + T - ys[iy + 1] : 0;
    const rampa = (t, a, b) => Math.min(a ? Math.min(1, (t + 0.5) / a) : 1, b ? Math.min(1, (T - t - 0.5) / b) : 1);
    const wx = Float32Array.from({ length: T }, (_, t) => rampa(t, izq, der));
    for (let yy = 0; yy < T; yy++) {
      const wy = rampa(yy, arr, aba);
      for (let xx = 0; xx < T; xx++) {
        const w = wx[xx] * wy, o = (y0 + yy) * W + x0 + xx, s = (yy * T + xx) * 3;
        acc[o * 3] += px[s] * w; acc[o * 3 + 1] += px[s + 1] * w; acc[o * 3 + 2] += px[s + 2] * w;
        peso[o] += w;
      }
    }
  }
  const out = Buffer.alloc(W * H * 3);
  for (let o = 0; o < W * H; o++) {
    const w = peso[o] || 1;
    out[o * 3] = acc[o * 3] / w; out[o * 3 + 1] = acc[o * 3 + 1] / w; out[o * 3 + 2] = acc[o * 3 + 2] / w;
  }
  magick(["-size", `${W}x${H}`, "-depth", "8", "rgb:-", destino], { input: out });
  return { segundos, repintados: prompts.length, prompts };
}

/**
 * Retoque determinista: puntos claros aislados (el modelo siembra «estrellas»,
 * reflejos y bolitas blancas que en mesa se leen como luces). Se reemplazan por
 * la apertura morfológica (la imagen sin rasgos claros menores que el disco)
 * donde la diferencia supera el umbral. Afuera con disco grande; adentro con
 * uno chico y nunca sobre muebles fijos, ventanas ni pisos de azulejo/linóleo
 * (que son claros a propósito).
 */
function quitarDestellos(actual, plano, ctx, ajustes = {}) {
  const { D, W, H, tmp } = ctx;
  const pl = normalizar(plano);
  const z = zonasDetalle(plano, ctx.edificio);
  const r = (o, g) => ({ x: o.x - g, y: o.y - g, w: o.w + 2 * g, h: o.h + 2 * g });
  const protegidos = [
    ...(pl.muebles ?? []).filter(m => !esMovil(m)).map(m => r(m, 0.1)),
    ...pl.habitaciones.filter(h => ["azulejo", "baldosa", "linoleo", "terrazo"].includes(h.piso)).map(h => r(h, 0.05)),
    ...(pl.vanos ?? []).filter(v => ["ventana", "vidrio", "puerta-vidrio"].includes(v.tipo))
      .map(v => r(v.eje === "h" ? { x: v.x, y: v.y, w: v.w, h: 0 } : { x: v.x, y: v.y, w: 0, h: v.w }, 0.2))
  ];
  const k = D / 200;
  // `ajustes` (mapas.<id>.detalle.destellos): { fuera: { disco, umbral }, dentro: { disco, umbral } },
  // disco en px a 200 px/m. Un disco más grande borra también los «focos» con halo.
  const pasadas = [
    { disco: Math.round((ajustes.fuera?.disco ?? 20) * k), umbral: ajustes.fuera?.umbral ?? "12%", zona: "fuera" },
    { disco: Math.round((ajustes.dentro?.disco ?? 7) * k), umbral: ajustes.dentro?.umbral ?? "15%", zona: "dentro" }
  ];
  for (const [i, p] of pasadas.entries()) {
    const abierta = path.join(tmp, `abierta${i}.png`), puntos = path.join(tmp, `puntos${i}.png`), donde = path.join(tmp, `donde${i}.png`);
    magick([actual, "-morphology", "Open", `Disk:${p.disco}`, abierta]);
    const edif = mascara(z.edificio, W, H, D, path.join(tmp, `m-edif-d${i}.png`), 0);
    const prot = mascara(protegidos.length ? protegidos : [{ x: -1, y: -1, w: 0.001, h: 0.001 }], W, H, D, path.join(tmp, `m-prot${i}.png`), 0);
    magick(p.zona === "fuera" ? [edif, "-negate", donde]
      : [edif, "(", prot, "-negate", ")", "-compose", "multiply", "-composite", donde]);
    magick([actual, abierta, "-colorspace", "gray", "-compose", "minus_dst", "-composite", "-threshold", p.umbral,
      "-morphology", "Dilate", `Disk:${Math.max(2, Math.round(p.disco / 4))}`, "-blur", "0x2",
      donde, "-compose", "multiply", "-composite", puntos]);
    actual = componer(actual, abierta, puntos, path.join(tmp, `comp-dest${i}.png`));
  }
  return actual;
}

/**
 * Repinta `base` (mapa ya corregido, a escala del plano, cualquier densidad)
 * a `op.densidad` px/m en dos pasadas por mosaicos y escribe `destino` (PNG a
 * esa densidad):
 *   interior  el edificio (muros, cuartos, muebles) con su prompt por recorte;
 *   exterior  el suelo de afuera (asfalto, vereda, techos vecinos, contenedores)
 *             con un prompt que sólo describe suelo (si no, inventa escaleras,
 *             ladrillos y ventanas sobre el asfalto liso).
 * Se componen con máscaras sacadas del plano (borde difuminado 2 px); la
 * rejilla de la escalera de incendios queda de la base.
 *   op = { densidad, mosaico, solape, semilla, alfombra, tmp,
 *          interior: { motor, denoise, ruido, control, fuerza, fin, pasos }, exterior: {…} | null }
 */
export async function detallarMosaicos(base, plano, destino, op) {
  const D = op.densidad ?? 200, T = op.mosaico ?? 1152, S = op.solape ?? 128;
  const W = plano.ancho * D, H = plano.alto * D;
  const tmp = fs.mkdtempSync(path.join(op.tmp, "mosaicos-"));
  const ctx = { D, T, S, W, H, tmp, semilla: op.semilla ?? 1, cache: op.cache, edificio: op.edificio };
  const grande = path.join(tmp, "base.png");
  magick([base, "-filter", "Lanczos", "-resize", `${W}x${H}!`, grande]);
  // Guía determinista desde el plano: el camino de alfombra de los pisos
  // `tablas-alfombra` (el pintado de base lo perdió y la pasada sola no lo
  // inventa): una franja oscura con grano en el eje largo.
  const alfombras = normalizar(plano).habitaciones.filter(h => h.piso === "tablas-alfombra").map(h => {
    const v = h.h >= h.w, a = (v ? h.w : h.h) * (op.alfombra ?? 0.45), m = 0.35;
    return v ? { x: h.x + (h.w - a) / 2, y: h.y + m, w: a, h: h.h - 2 * m } : { x: h.x + m, y: h.y + (h.h - a) / 2, w: h.w - 2 * m, h: a };
  });
  if (alfombras.length && op.alfombra !== 0) {
    const m = mascara(alfombras, W, H, D, path.join(tmp, "alfombra.png"), 3);
    magick([m, "-evaluate", "multiply", "0.85", m]);
    const capa = path.join(tmp, "alfombra-color.png");
    magick(["-size", `${W}x${H}`, `xc:${op.colorAlfombra ?? "#34363b"}`, "-seed", String(ctx.semilla), "-attenuate", "0.5", "+noise", "Gaussian", capa]);
    componer(grande, capa, m, path.join(tmp, "base-guia.png"));
    fs.renameSync(path.join(tmp, "base-guia.png"), grande);
  }
  const zonas = zonasDetalle(plano, op.edificio);
  const libres = normalizar(plano).habitaciones.filter(h => h.piso !== "macizo" && h.piso !== "rejilla");
  let segundos = 0;
  const prompts = [];
  let actual = grande;
  if (op.exterior) {
    // Exterior: todo menos el edificio; los mosaicos enteros dentro del edificio no se tocan.
    const exterior = path.join(tmp, "exterior.png");
    const e = zonas.edificio[0], A = plano.ancho, B = plano.alto;
    const fuera = op.edificio === "habitaciones" ? [{ x: 0, y: 0, w: A, h: B }]
      : [{ x: 0, y: 0, w: e.x, h: B }, { x: e.x + e.w, y: 0, w: A - e.x - e.w, h: B },
        { x: 0, y: 0, w: A, h: e.y }, { x: 0, y: e.y + e.h, w: A, h: B - e.y - e.h }].filter(z => z.w > 0.05 && z.h > 0.05);
    const r = await pasada(grande, plano, exterior, fuera, "exterior", op.exterior, ctx);
    segundos += r.segundos; prompts.push(...r.prompts);
    const mFuera = path.join(tmp, "m-fuera.png");
    magick([mascara(zonas.edificio, W, H, D, path.join(tmp, "m-edif.png"), 2), "-negate", mFuera]);
    const comp = componer(actual, exterior, mFuera, path.join(tmp, "comp-ext.png"));
    actual = comp;
  }
  if (op.interior) {
    const interior = path.join(tmp, "interior.png");
    const r = await pasada(grande, plano, interior, libres, "interior", op.interior, ctx);
    segundos += r.segundos; prompts.push(...r.prompts);
    const comp = componer(actual, interior, mascara(zonas.edificio, W, H, D, path.join(tmp, "m-edif.png"), 2), path.join(tmp, "comp-int.png"));
    actual = comp;
  }
  if (op.destellos !== false) actual = quitarDestellos(actual, plano, ctx, typeof op.destellos === "object" ? op.destellos : {});
  if (zonas.base.length) {
    const comp = componer(actual, grande, mascara(zonas.base, W, H, D, path.join(tmp, "m-base.png"), 2), path.join(tmp, "comp-base.png"));
    actual = comp;
  }
  fs.copyFileSync(actual, destino);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { segundos, repintados: prompts.length, ancho: W, alto: H, prompts };
}

/* -------------------------------------------- */
/*  Grading de color determinista (--grading)    */
/* -------------------------------------------- */

/**
 * Lleva el mapa a la paleta del set (MAPS_SPEC §5, doc 15): pizarra mojada,
 * azul de puerto en las sombras, sin naranja, un solo carmesí. Es una tabla
 * de color (Hald CLUT nivel 8, 16 bits) calculada en OKLab con los parámetros
 * de `estilos.battlemap.grading` y aplicada con `magick -hald-clut`: misma
 * entrada = misma salida, sin modelo.
 *
 *   croma          ganancia de croma global (sube la saturación)
 *   topes          [{ desde, hasta, max }]: bandas de tono OKLab (grados) en las
 *                  que la croma se topa en `max` (naranja: madera gris-parda,
 *                  nunca naranja; verde: nada de musgo)
 *   carmesi        { hasta, minimo, ganancia }: tonos rojos (< `hasta`°) con
 *                  croma ≥ `minimo` quedan fuera del tope y se refuerzan (alfileres)
 *   sombras/luces  { a, b, fuerza, pie }: tinte OKLab sumado con peso
 *                  min(1, L/pie)·(1−L)² en sombras y L² en luces
 *   negro, blanco, gamma, contraste: curva de luminancia (L de OKLab)
 */
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
const suave = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function colorGrading(rgb, g) {
  let [L, a, b] = aOklab(...rgb.map(s2l));
  // Curva de luminancia: niveles, gamma y una S suave alrededor de 0,5.
  L = Math.min(1, Math.max(0, (L - (g.negro ?? 0)) / ((g.blanco ?? 1) - (g.negro ?? 0))));
  L = L ** (g.gamma ?? 1);
  if (g.contraste) L = L + g.contraste * (L - 0.5) * (1 - Math.abs(2 * L - 1));
  let C = Math.hypot(a, b) * (g.croma ?? 1);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const rojo = g.carmesi && (h < g.carmesi.hasta || h > 350) && Math.hypot(a, b) >= g.carmesi.minimo;
  if (rojo) C *= g.carmesi.ganancia ?? 1;
  else for (const n of g.topes ?? []) {
    const dentroBanda = suave(h, n.desde - 10, n.desde) * (1 - suave(h, n.hasta, n.hasta + 10));
    if (C > n.max) C = C - (C - n.max) * dentroBanda;
  }
  const hr = Math.atan2(b, a);
  a = C * Math.cos(hr); b = C * Math.sin(hr);
  if (!rojo) {
    // El tinte de sombras se apaga hacia el negro (si no, los negros casi puros
    // quedan azules y la saturación HSL se dispara): pico en los medios-oscuros.
    const ws = Math.min(1, L / (g.sombras?.pie ?? 0.3)) * (1 - L) ** 2 * (g.sombras?.fuerza ?? 0), wl = L ** 2 * (g.luces?.fuerza ?? 0);
    a += (g.sombras?.a ?? 0) * ws + (g.luces?.a ?? 0) * wl;
    b += (g.sombras?.b ?? 0) * ws + (g.luces?.b ?? 0) * wl;
  }
  return deOklab(L, a, b).map(v => Math.min(1, Math.max(0, l2s(Math.max(0, v)))));
}

export function gradingColor(entrada, destino, g, { calidad = 88, tmp } = {}) {
  const N = 64, lado = 512;
  const buf = Buffer.alloc(lado * lado * 3 * 2);
  let k = 0;
  for (let bi = 0; bi < N; bi++) for (let gi = 0; gi < N; gi++) for (let ri = 0; ri < N; ri++) {
    const out = colorGrading([ri / (N - 1), gi / (N - 1), bi / (N - 1)], g);
    for (const v of out) { buf.writeUInt16BE(Math.round(v * 65535), k); k += 2; }
  }
  const hald = path.join(tmp ?? path.dirname(destino), `.hald-${process.pid}.png`);
  magick(["-size", `${lado}x${lado}`, "-depth", "16", "-endian", "MSB", "rgb:-", hald], { input: buf });
  try {
    magick([entrada, hald, "-hald-clut", ...(destino.endsWith(".png") ? [] : ["-quality", String(calidad)]), destino]);
  } finally { fs.rmSync(hald, { force: true }); }
  return destino;
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
  // Aclaraciones por mapa (mapas.<id>.aclaraciones): pisan las del estilo sólo en este plano
  // (salitre: las tiras de fotos enmarcadas del bar crecían como cajas y pseudo-texto).
  ACLARACIONES = { ...(E.aclaraciones ?? {}), ...(op.aclaraciones ?? {}) };
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
    await vigilar(`${plano.id} base s${op.semilla}`);
    const r = await ejecutar(wf, valores);
    fs.writeFileSync(crudo, r.salidas.find(s => s.titulo === "Salida")?.buffer ?? r.salidas[0].buffer);
    segundos = r.segundos;
  }

  let paraCorregir = crudo, escalado = null;
  if (op.escalar) {
    const esc = path.join(tmp, "escalado.png");
    await vigilar(`${plano.id} SeedVR2`);
    escalado = await escalar(crudo, marco, op.semilla, esc, plano, op.escalador);
    paraCorregir = esc;
  }

  if (!prueba && fs.existsSync(destino) && !op.forzar) throw new Error(`${path.relative(RAIZ, destino)} ya existe (usá --forzar)`);
  let corr = corregir(paraCorregir, plano, destino, marco, esquema);
  const retoques = [];
  let detalle = null;
  if (op.detalle) {
    // Pasada de detalle por mosaicos sobre el mapa ya corregido (a escala del
    // plano), a `densidad` px/m; se baja a 100 px/m y se vuelve a corregir.
    // Los bloques cerrados se sellan ANTES de la pasada: si no, la pasada
    // repinta con lujo los departamentos que el modelo de base inventó adentro.
    if (op.sellar !== false) sellarMacizos(destino, plano, { fondo: op.sellarFondo });
    const grande = path.join(tmp, "detalle.png"), chico = path.join(tmp, "detalle-100.png");
    const d = await detallarMosaicos(destino, plano, grande, { semilla: op.semilla, tmp, cache: op.cache, ...op.detalle });
    const W = plano.ancho * PX_POR_M, H = plano.alto * PX_POR_M;
    magick([grande, "-filter", "Lanczos", "-resize", `${W}x${H}!`, chico]);
    const corr1 = corr;
    corr = corregir(chico, plano, destino, { W, H, dx: 0, dy: 0, ancho: W, alto: H }, esquema);
    detalle = { segundos: d.segundos, mosaicos: d.repintados, densidad: op.detalle.densidad ?? 200, correccionPrevia: { anisotropia: +corr1.anisotropia.toFixed(2), calidad: +corr1.calidad.toFixed(3) } };
    retoques.push("guía del camino de alfombra (franja oscura desde el plano) antes de la pasada de detalle",
      "destellos aislados borrados (apertura morfológica: disco grande afuera, chico adentro fuera de muebles fijos, ventanas y azulejos)",
      "rejilla de la escalera de incendios y escalerilla conservadas del pintado de base");
    if (prueba) fs.copyFileSync(grande, path.join(carpeta, `${base}.detalle.png`));
  }
  if (op.grading) {
    // Pruebas: el mapa antes del grading, para ajustar el grading por mapa sin repintar.
    if (prueba) fs.copyFileSync(destino, path.join(carpeta, `${base}.pregrading.webp`));
    const g = { ...E.grading, ...(typeof op.grading === "object" ? op.grading : {}) };
    gradingColor(destino, destino, g, { tmp });
    retoques.push("grading de color determinista (estilos.battlemap.grading)");
  }
  if (op.sellar !== false) {
    const n = sellarMacizos(destino, plano, { fondo: op.sellarFondo });
    if (n) retoques.push(`${n} macizos sellados (relleno liso con grano)${op.sellarFondo ? ", con la roca de fuera de las habitaciones" : ""}`);
  }
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
  const motores = op.detalle ? [op.detalle.interior, op.detalle.exterior].filter(Boolean).map(p => p.motor) : [];
  if (motores.includes("zimage")) modelos.push(...CAMINOS.controlnet.modelos.filter(m => !modelos.includes(m)));
  if (motores.includes("klein")) modelos.push(...CAMINOS.klein.modelos.filter(m => !modelos.includes(m)));
  const wfDetalle = [...new Set(motores.map(m => m === "klein" ? "detalle-klein" : "plano-zimage"))];
  registrarProcedencia(destino, {
    plano: plano.id, lugar: plano.lugar, camino,
    modelos, licencia: APACHE,
    workflow: `tools/workflows/${def.workflow}.json` + (op.escalar ? ` + tools/workflows/${ESCALADOR.workflow}.json` : "") +
      wfDetalle.map(w => ` + tools/workflows/${w}.json (detalle por mosaicos)`).join(""),
    semilla: op.semilla, parametros, escalado: escalado ? `SeedVR2 ${op.escalador ?? "3b"} a ${escalado.ancho}×${escalado.alto}` : null,
    detalle: op.detalle ? { ...op.detalle, ...detalle, prompts: "uno por mosaico: estilos.battlemap.prefijo_detalle_control / prefijo_detalle_exterior + describirRecorte() + sufijo_detalle" } : null,
    grading: op.grading ? { ...E.grading, ...(typeof op.grading === "object" ? op.grading : {}), _comentario: undefined } : null,
    correccion: "afín por eje (perfiles de muro, tools/pintar-planos.mjs)", retoques,
    metricas, prompt: texto
  });

  const fila = { archivo: destino, crudo, control, camino, semilla: op.semilla, sufijo: op.sufijo ?? "", parametros, retoques,
    segundos, segundosEscalado: escalado?.segundos ?? null, segundosDetalle: detalle?.segundos ?? null, ...metricas };
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
        // La roca de fuera de un sótano y el vacío de fuera de una torre se sellan como los macizos
        // (mapas.<id>.sellarFondo pisa el default).
        sellarFondo: fijado.sellarFondo ?? ["roca", "vacio"].includes(plano.fondo),
        escalador: opcion("--escalador") ?? fijado.escalador ?? "3b", reusarCrudo: argv.includes("--reusar-crudo"),
        forzar: argv.includes("--forzar"), verPrompt: argv.includes("--ver-prompt"), tmp,
        cache: opcion("--cache") ? path.resolve(opcion("--cache")) : undefined,
        aclaraciones: fijado.aclaraciones,
        // Como `escalar`: lo fijado en arte.config.json vale cuando no se pide otro camino.
        detalle: argv.includes("--sin-detalle") ? null
          : argv.includes("--detalle") || (fijado.detalle && !opcion("--camino")) ? (fijado.detalle ?? DETALLE_DEFECTO) : null,
        grading: argv.includes("--sin-grading") ? null
          : argv.includes("--grading") || (fijado.grading && !opcion("--camino")) ? (fijado.grading ?? true) : null
      };
      process.stdout.write(`  ${plano.id} · ${op.camino} · semilla ${semilla}${op.sufijo ?? ""} … `);
      try {
        const f = await pintar(plano, op);
        if (!f) continue;
        const d = f.deriva;
        console.log(`${f.aprobado ? "✓" : "✗"} ${f.segundos ? f.segundos.toFixed(1) + " s" : "(crudo reusado)"}` +
          `${f.segundosEscalado ? ` + ${f.segundosEscalado.toFixed(1)} s SeedVR2` : ""}` +
          `${f.segundosDetalle ? ` + ${f.segundosDetalle.toFixed(1)} s detalle` : ""}  ` +
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

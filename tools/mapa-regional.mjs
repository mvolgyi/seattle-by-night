#!/usr/bin/env node
/**
 * Mapa regional de AYU-01 (MAP-00): Seattle y el estrecho de Puget, de Everett a
 * Tacoma y de Bainbridge al valle del Snohomish (doc 15, MAP-00; MAPS_SPEC §8).
 *
 * Z-Image sólo no sabe dibujar Puget Sound (inventa la costa y escribe rótulos),
 * así que la geografía sale de datos y el modelo sólo la pinta:
 *
 *   1. Costa, lagos, municipios y rutas de TIGER (U.S. Census Bureau, dominio
 *      público: 17 U.S.C. §105; se pide citar la fuente) → cache/tiger/.
 *   2. Esquema a color (agua azul marino, tierra carbón, municipios con puntos de
 *      luz, rutas en dorado tenue) y control (bordes de la costa, blanco sobre negro).
 *   3. plano-zimage: Z-Image Turbo + Fun ControlNet Union, img2img desde el
 *      esquema (DENOISE) con los bordes de la costa como control.
 *
 * Sin texto: los nombres, la leyenda y los ① … ⑯ los maqueta el HTML de AYU-01.
 *
 * Uso:
 *   node tools/mapa-regional.mjs --config tools/arte.tanda3.json            # → assets/handouts/MAP-00.webp
 *   node tools/mapa-regional.mjs --config … --candidatas --salida <dir>    # una por semilla
 *   node tools/mapa-regional.mjs --config … --esquema <dir>                # sólo el esquema y el control (sin GPU)
 *   --semillas a,b  --denoise X  --fuerza X  --fin X   pisan lo del config (pruebas)
 *
 * Parámetros (semilla, candidatas, prompt, denoise…) en `mapa_regional` del config.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ejecutar, guardar, registrarProcedencia } from "./comfy.mjs";

const RAIZ = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const valor = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const tiene = f => argv.includes(f);

const configRel = valor("--config") ?? "tools/arte.tanda3.json";
const CFG = JSON.parse(fs.readFileSync(path.resolve(RAIZ, configRel), "utf8")).mapa_regional;
if (!CFG) throw new Error(`${configRel}: falta «mapa_regional»`);

/* --- datos (cache/tiger, se bajan si faltan) --------------------------------- */

const CACHE = path.join(RAIZ, "cache/tiger");
const DATOS = {
  condados: "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip",
  municipios: "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_53_place_500k.zip",
  rutas: "https://www2.census.gov/geo/tiger/TIGER2024/PRISECROADS/tl_2024_53_prisecroads.zip",
  // Aguas interiores por condado: King, Pierce, Snohomish, Kitsap, Island.
  ...Object.fromEntries(["53033", "53053", "53061", "53035", "53029"].map(c =>
    [`agua-${c}`, `https://www2.census.gov/geo/tiger/TIGER2024/AREAWATER/tl_2024_${c}_areawater.zip`]))
};

function shp(clave) {
  const url = DATOS[clave], dir = path.join(CACHE, clave);
  const zip = path.join(CACHE, path.basename(url));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(CACHE, { recursive: true });
    console.log(`  bajando ${path.basename(url)}`);
    execFileSync("curl", ["-sSfL", "-C", "-", "-o", zip, url]);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync("unzip", ["-oq", zip, "-d", dir]);
  }
  return path.join(dir, fs.readdirSync(dir).find(f => f.endsWith(".shp")));
}

/* --- proyección (equirectangular con corrección de latitud media) ------------ */

const W = CFG.ancho, H = CFG.alto, SS = 2;
const { sur: LAT0, norte: LAT1, centro_lon: LONC } = CFG.encuadre;
const dLon = (LAT1 - LAT0) * (W / H) / Math.cos(((LAT0 + LAT1) / 2) * Math.PI / 180);
const LON0 = LONC - dLon / 2, LON1 = LONC + dLon / 2;
const X = lon => ((lon - LON0) / (LON1 - LON0)) * W * SS;
const Y = lat => ((LAT1 - lat) / (LAT1 - LAT0)) * H * SS;

/** Columna `campo` del .dbf de un .shp (una entrada por registro, en orden). */
function dbf(archivo, campo) {
  const b = fs.readFileSync(archivo.replace(/\.shp$/, ".dbf"));
  const n = b.readUInt32LE(4), cab = b.readUInt16LE(8), largo = b.readUInt16LE(10);
  let pos = 1, desde = -1, ancho = 0;
  for (let f = 32; b[f] !== 0x0d; f += 32) {
    const nombre = b.toString("latin1", f, f + 11).replace(/\0.*$/, "");
    if (nombre === campo) { desde = pos; ancho = b[f + 16]; }
    pos += b[f + 16];
  }
  return Array.from({ length: n }, (_, i) => b.toString("latin1", cab + i * largo + desde, cab + i * largo + desde + ancho).trim());
}

/** Lee un .shp (polígonos o polilíneas) y devuelve los `d` de SVG de lo que cae en el encuadre. */
function leer(archivo, { minArea = 0, filtro = null } = {}) {
  const b = fs.readFileSync(archivo), out = [];
  for (let o = 100, i = -1; o < b.length;) {
    i++;
    const r = o + 8; o = r + b.readInt32BE(o + 4) * 2;
    if (filtro && !filtro(i)) continue;
    const tipo = b.readInt32LE(r);
    if (tipo !== 5 && tipo !== 3) continue;
    const [xmin, ymin, xmax, ymax] = [0, 1, 2, 3].map(i => b.readDoubleLE(r + 4 + i * 8));
    if (xmax < LON0 || xmin > LON1 || ymax < LAT0 || ymin > LAT1) continue;
    if ((xmax - xmin) * (ymax - ymin) < minArea) continue;
    const np = b.readInt32LE(r + 36), npt = b.readInt32LE(r + 40), p0 = r + 44 + np * 4;
    let d = "";
    for (let i = 0; i < np; i++) {
      const a = b.readInt32LE(r + 44 + i * 4), z = i + 1 < np ? b.readInt32LE(r + 48 + i * 4) : npt;
      for (let j = a; j < z; j++) d += `${j === a ? "M" : "L"}${X(b.readDoubleLE(p0 + j * 16)).toFixed(1)},${Y(b.readDoubleLE(p0 + j * 16 + 8)).toFixed(1)}`;
      if (tipo === 5) d += "Z";
    }
    out.push(d);
  }
  return out;
}

/* --- esquema y control -------------------------------------------------------- */

function esquema(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const tierra = leer(shp("condados"));
  // Lagos y ríos anchos (descarta estanques: < ~0,4 km² de caja).
  const aguas = Object.keys(DATOS).filter(k => k.startsWith("agua-")).flatMap(k => leer(shp(k), { minArea: 4e-5 }));
  // Las ciudades grandes llevan luces densas; el resto, apenas unas pocas.
  const nombres = dbf(shp("municipios"), "NAME");
  const grande = i => CFG.ciudades.includes(nombres[i]);
  const ciudades = leer(shp("municipios"), { filtro: grande });
  const municipios = leer(shp("municipios"), { filtro: i => !grande(i) });
  const rutas = leer(shp("rutas"));
  const c = CFG.colores;
  const svg = (fondo, capas) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SS}" height="${H * SS}">
<defs><pattern id="luces" width="58" height="46" patternUnits="userSpaceOnUse">
<circle cx="5" cy="7" r="1.4" fill="${c.luz}"/><circle cx="38" cy="30" r="1.2" fill="${c.luz}"/></pattern>
<pattern id="ciudad" width="22" height="18" patternUnits="userSpaceOnUse">
<circle cx="3" cy="4" r="1.6" fill="${c.luz}"/><circle cx="13" cy="2" r="1.2" fill="${c.luz}"/><circle cx="18" cy="11" r="1.7" fill="${c.luz}"/>
<circle cx="8" cy="13" r="1.3" fill="${c.luz}"/><circle cx="15" cy="16" r="1" fill="${c.luz}"/></pattern>
<filter id="grano"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="4" seed="7"/><feColorMatrix type="saturate" values="0"/>
<feComponentTransfer><feFuncA type="linear" slope="0.22"/></feComponentTransfer></filter></defs>
<rect width="100%" height="100%" fill="${fondo}"/>${capas}</svg>`;
  const capa = (ds, attrs) => ds.map(d => `<path ${attrs} d="${d}"/>`).join("");
  // Máscara: tierra blanca, agua negra (el trazo tapa las costuras entre condados).
  const mascara = svg("#000", capa(tierra, `fill="#fff" stroke="#fff" stroke-width="3" fill-rule="evenodd"`) + capa(aguas, `fill="#000" fill-rule="evenodd"`));
  const color = svg(c.agua,
    capa(tierra, `fill="${c.tierra}" stroke="${c.tierra}" stroke-width="3" fill-rule="evenodd"`) +
    `<clipPath id="solo-tierra">${capa(tierra, `fill-rule="evenodd"`)}</clipPath>` +
    `<rect width="100%" height="100%" filter="url(#grano)" clip-path="url(#solo-tierra)"/>` +
    capa(municipios, `fill="url(#luces)" fill-opacity="0.6" fill-rule="evenodd"`) +
    capa(ciudades, `fill="${c.ciudad}" fill-opacity="0.8" fill-rule="evenodd"`) + capa(ciudades, `fill="url(#ciudad)" fill-rule="evenodd"`) +
    capa(aguas, `fill="${c.agua}" fill-rule="evenodd"`) +
    capa(rutas, `fill="none" stroke="${c.ruta}" stroke-width="1.6" stroke-opacity="0.45"`) +
    "");
  const rutasSvg = { mascara: path.join(dir, "MAP-00.mascara.svg"), color: path.join(dir, "MAP-00.esquema.svg") };
  fs.writeFileSync(rutasSvg.mascara, mascara);
  fs.writeFileSync(rutasSvg.color, color);
  const out = {
    mascara: path.join(dir, "MAP-00.mascara.png"),
    esquema: path.join(dir, "MAP-00.esquema.png"),
    control: path.join(dir, "MAP-00.control.png")
  };
  execFileSync("magick", [rutasSvg.mascara, "-alpha", "off", "-resize", `${W}x${H}!`, "-threshold", "50%", out.mascara]);
  // Control: sólo la línea de costa (blanco sobre negro), un poco suavizada.
  execFileSync("magick", [out.mascara, "-alpha", "off", "-colorspace", "Gray", "-morphology", "Edge", "Diamond:1", "-blur", "0x0.6", "-level", "0,60%", out.control]);
  // Esquema a color con la línea de costa fina encima, como en una carta (la misma del control, teñida).
  execFileSync("magick", [rutasSvg.color, "-alpha", "off", "-resize", `${W}x${H}!`, "-blur", "0x0.7",
    "(", out.control, "-fill", c.costa, "-colorize", "100", ")", "(", out.control, "-evaluate", "multiply", "0.7", ")",
    "-composite", out.esquema]);
  console.log(`  esquema: ${tierra.length} condados, ${aguas.length} aguas, ${ciudades.length} ciudades, ${municipios.length} municipios, ${rutas.length} rutas; lon ${LON0.toFixed(3)}…${LON1.toFixed(3)}, lat ${LAT0}…${LAT1}`);
  return out;
}

/* --- main -------------------------------------------------------------------- */

const num = (f, def) => valor(f) != null ? Number(valor(f)) : def;
const P = { denoise: num("--denoise", CFG.denoise), fuerza: num("--fuerza", CFG.fuerza), fin: num("--fin", CFG.fin), pasos: CFG.pasos };
const salida = valor("--salida") ? path.resolve(valor("--salida")) : null;
const soloEsquema = valor("--esquema") ? path.resolve(valor("--esquema")) : null;
const semillas = valor("--semillas")?.split(",").map(Number) ?? (tiene("--candidatas") ? CFG.candidatas : [CFG.semilla]);
const prompt = CFG.prefijo + CFG.prompt + CFG.sufijo;

const dirEsq = soloEsquema ?? (salida ? path.join(salida, "esquema") : fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "sbn-map00-")));
const e = esquema(dirEsq);
if (soloEsquema) { console.log(`Esquema en ${dirEsq} (sin GPU).`); process.exit(0); }

for (const semilla of semillas) {
  const r = await ejecutar("plano-zimage", {
    PROMPT: prompt, SEMILLA: semilla, ANCHO: W, ALTO: H, PREFIJO: `sbn/mapa/MAP-00-s${semilla}`,
    IMAGEN: e.esquema, CONTROL: e.control, DENOISE: P.denoise, FUERZA: P.fuerza, FIN_CONTROL: P.fin, PASOS: P.pasos
  });
  const destino = salida ? path.join(salida, `MAP-00-s${semilla}.webp`) : path.join(RAIZ, "assets/handouts/MAP-00.webp");
  guardar(r.salidas[0].buffer, destino, 90);
  if (!salida) {
    registrarProcedencia(destino, {
      id: "MAP-00", estilo: "mapa-regional",
      modelos: ["z_image_turbo_bf16.safetensors", "qwen_3_4b.safetensors", "z_image_ae.safetensors", "Z-Image-Turbo-Fun-Controlnet-Union-2.1-2602-8steps.safetensors"],
      licencia: "Apache 2.0",
      workflow: "tools/mapa-regional.mjs (esquema desde TIGER) + tools/workflows/plano-zimage.json",
      semilla, parametros: { ancho: W, alto: H, denoise: P.denoise, fuerza: P.fuerza, fin_control: P.fin, pasos: P.pasos, encuadre: CFG.encuadre },
      datos: "U.S. Census Bureau, 2024 TIGER/Line Shapefiles (AREAWATER, PRISECROADS) y Cartographic Boundary Files (county, place 1:500k). Dominio público (17 U.S.C. §105); el Census pide citar la fuente.",
      segundos: Math.round(r.segundos * 10) / 10, prompt
    });
  }
  console.log(`  MAP-00 s${semilla} ✓ ${r.segundos.toFixed(1)} s  ${path.relative(RAIZ, destino)}`);
}

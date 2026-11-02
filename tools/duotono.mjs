#!/usr/bin/env node
/**
 * Imágenes de la Guía del Narrador con el tratamiento de la crónica: Seattle de
 * noche bajo la lluvia. Copiado de DVV (tools/duotono.mjs) y llevado a nuestra
 * paleta. La foto pasa a blanco y negro y se vuelve a teñir por tabla (CLUT)
 * en tintas frías: sombras en el azul de puerto, medios en un pizarra azulado
 * y luces de hueso frío, casi blanco azulado. En las fotos (no en los mapas)
 * sobreviven dos colores del original, por máscara: el rojo vivo (la boya de la
 * portada, un neón, una copa, la sangre: el carmesí de la Mascarada) y el sodio,
 * sólo donde ya había la luz cálida de una farola o su reflejo; nunca en el
 * cielo ni en la piel, nunca de color plano. Así no se parece al naranja de la
 * web de World of Darkness. Grano de película y viñeta, como DVV. El nombre NO
 * va en la imagen: lo pone la guía encima en CSS.
 *
 *   assets/retratos/<id>.webp  → assets/guia/retratos/<id>.webp  (720 × 1080, encuadre arriba: la cara)
 *   assets/mapas/<id>.webp     → assets/guia/mapas/<id>.webp     (1200 × 1200, centrado; menos contraste)
 *   assets/lugares/<id>.webp   → assets/guia/lugares/<id>.webp   (1200 × 1080)
 *   assets/portadas/portada.webp → assets/guia/portada.webp      (1200 × 1080, las grúas y la boya)
 *   assets/handouts/MAP-00.webp  → assets/guia/seattle.webp      (el mapa regional, para «La ciudad»)
 *
 * Son derivadas de imágenes ya registradas en assets/PROCEDENCIA.json (como en
 * DVV, no llevan entrada propia: es un filtro de ImageMagick, sin modelos). No
 * van en el zip del módulo (tools/release.mjs excluye assets/guia/): sólo las
 * usa la guía, que las embebe. Sólo CPU (`magick`), sin GPU.
 *
 * construir-guia.mjs llama a tratar() antes de armar la guía, así que lo que
 * falta o cambió se rehace solo. A mano:
 *
 *   node tools/duotono.mjs [--solo <id>] [--forzar] [--salida <dir>]
 *     --solo     sólo esa imagen (id sin extensión: PNJ-12, galeria, portada…)
 *     --forzar   rehace todas aunque estén al día (después de tocar el CLUT)
 *     --salida   escribe en <dir>/<carpeta>/ en lugar de assets/guia/ (para calibrar)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const RAIZ = path.resolve(import.meta.dirname, "..");

/**
 * La tabla de color: de la sombra a la luz. Cada tramo es [desde, hasta, filas];
 * las filas reparten los 256 niveles de gris. El azul de puerto (#1f3a4d, el
 * --sbn-puerto del módulo) cae en el primer cuarto; los medios suben a un
 * pizarra azulado para que las caras se lean; las luces terminan en hueso frío
 * (#dfe6ea) y un blanco azulado. Sin sodio: ése lo pone la máscara SODIO.
 */
export const CLUT = [
  ["#05080b", "#1f3a4d", 64],
  ["#1f3a4d", "#5b7889", 100],
  ["#5b7889", "#dfe6ea", 80],
  ["#dfe6ea", "#eef2f4", 12]
];
/** Blanco y negro antes de teñir: retratos y fotos más duros; los mapas, apenas, que no queden barro. */
const GRIS = {
  foto: ["-colorspace", "Gray", "-normalize", "-gamma", "1.4", "-sigmoidal-contrast", "5x45%"],
  mapa: ["-colorspace", "Gray", "-normalize", "-gamma", "1.15", "-sigmoidal-contrast", "3x50%", "+level", "0%,86%"]
};
/** Máscara del rojo que se conserva: tono cerca de 0 y saturación alta, en las luces medias. */
/**
 * Máscara del sodio: sólo donde el original ya tenía la luz cálida de una farola
 * (tono naranja, saturado y claro): las farolas y sus reflejos, no el cielo ni la piel.
 */
const SODIO = "tt=u.hue; ss=u.saturation; ll=u.lightness; (tt>0.04)*(tt<0.16)*clamp((ss-0.3)*3)*clamp((ll-0.3)*3)";
const ROJO = "tt=u.hue; ss=u.saturation; ll=u.lightness; dd=min(tt,1-tt); (dd<0.035)*clamp((ss-0.45)*2.5)*clamp((ll-0.12)*4)";
/** Grano (desvío del ruido, 0–1) y viñeta (gris del borde: más oscuro, más viñeta). */
const GRANO = { foto: 0.5, mapa: 0.35 };
const VINETA = { foto: "#4a4a4a", mapa: "#7a7a7a" };

/** Trabajos: { origen, destino, W, H, id, tipo, gravedad }. */
function trabajos(base) {
  const out = [];
  const lista = (dir, re, sub, W, H, tipo, gravedad) => {
    const d = path.join(RAIZ, dir);
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d).filter(f => re.test(f)).sort()) {
      const id = f.replace(/\.webp$/, "");
      out.push({ origen: path.join(d, f), destino: path.join(base, sub, `${id}.webp`), W, H, id, tipo, gravedad });
    }
  };
  lista("assets/retratos", /\.webp$/, "retratos", 720, 1080, "foto", "north");
  lista("assets/mapas", /^(?!.*\.esquema\.)[^.]+\.webp$/, "mapas", 1200, 1200, "mapa", "center");
  lista("assets/lugares", /\.webp$/, "lugares", 1200, 1080, "foto", "center");
  // El mapa regional ilustrado (AYU-01): la banda de «La ciudad».
  const seattle = path.join(RAIZ, "assets/handouts/MAP-00.webp");
  if (fs.existsSync(seattle)) out.push({ origen: seattle, destino: path.join(base, "seattle.webp"), W: 1152, H: 1200, id: "seattle", tipo: "mapa", gravedad: "center" });
  const portada = path.join(RAIZ, "assets/portadas/portada.webp");
  // La portada es apaisada (1920 × 1080): la banda la muestra casi cuadrada, con las grúas y la boya roja.
  if (fs.existsSync(portada)) out.push({ origen: portada, destino: path.join(base, "portada.webp"), W: 1200, H: 1080, id: "portada", tipo: "foto", gravedad: "east" });
  return out;
}

/** Los argumentos de magick para un trabajo. */
function argumentos({ origen, destino, W, H, tipo, gravedad }) {
  const clut = CLUT.flatMap(([a, b, n]) => ["-size", `1x${n}`, `gradient:${a}-${b}`]);
  return [
    origen,
    "-resize", `${W}x${H}^`, "-gravity", gravedad, "-extent", `${W}x${H}`, "+gravity",
    "-write", "mpr:original",
    // 1. blanco y negro
    ...GRIS[tipo], "-set", "colorspace", "sRGB",
    // 2. tres tintas por tabla (los tramos apilados en una columna de 256 filas)
    "(", ...clut, "-append", ")", "-clut",
    // 2b. en las fotos, el rojo vivo sobrevive (la boya, una luz de freno, la sangre): la máscara
    //     es el rojo saturado del original, suavizada
    ...(tipo === "foto" ? ["mpr:original", "(", "mpr:original", "-fx", ROJO, "-blur", "0x1.2", ")", "-compose", "Over", "-composite"] : []),
    // 2c. y el sodio, sólo en las farolas y sus reflejos: un naranja pálido fijo, con la máscara de la luz cálida
    ...(tipo === "foto" ? ["(", "+clone", "-fill", "#f0b468", "-colorize", "100", ")", "(", "mpr:original", "-fx", SODIO, "-blur", "0x1.5", ")", "-compose", "Over", "-composite"] : []),
    // 3. grano de película: ruido gris en Overlay, fijo por semilla (la misma foto sale igual)
    "-seed", "7", "(", "-size", `${W}x${H}`, "xc:gray50", "-attenuate", String(GRANO[tipo]), "+noise", "Gaussian", "-colorspace", "Gray", ")",
    "-compose", "Overlay", "-composite",
    // 4. viñeta: los bordes caen a negro, como una calle mal iluminada
    "(", "-size", `${W}x${H}`, `radial-gradient:#ffffff-${VINETA[tipo]}`, ")",
    "-compose", "Multiply", "-composite",
    "-define", "webp:method=6", "-quality", "74",
    destino
  ];
}

/**
 * Trata lo que falta o cambió (o todo, con `forzar`). Devuelve cuántas rehizo.
 * `log`: función para informar cada imagen (por defecto, nada).
 */
export function tratar({ solo = null, forzar = false, base = path.join(RAIZ, "assets/guia"), log = () => {} } = {}) {
  let n = 0;
  for (const t of trabajos(base)) {
    if (solo && t.id !== solo) continue;
    if (!solo && !forzar && fs.existsSync(t.destino) && fs.statSync(t.destino).mtimeMs > fs.statSync(t.origen).mtimeMs) continue;
    fs.mkdirSync(path.dirname(t.destino), { recursive: true });
    execFileSync("magick", argumentos(t), { stdio: "pipe" });
    log(`✓ ${path.relative(RAIZ, t.destino).padEnd(40)} ${Math.round(fs.statSync(t.destino).size / 1024)} KB`);
    n++;
  }
  return n;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const valor = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const salida = valor("--salida");
  const n = tratar({ solo: valor("--solo"), forzar: argv.includes("--forzar"), base: salida ? path.resolve(salida) : undefined, log: console.log });
  console.log(n ? `${n} imagen(es)` : "Nada que tratar.");
}

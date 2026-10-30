#!/usr/bin/env node
/**
 * Tokens de Foundry a partir de la figura ya recortada (port de tools/tokens.mjs de DVV).
 *
 *   assets/tokens-crudo/<id>.png   (figura cenital con alfa de BiRefNet, de generar-arte)
 *     → assets/tokens/<id>.webp    (fondo transparente, recorte circular, anillo fino)
 *
 *   assets/tokens-crudo/vehiculos/<id>.png
 *     → assets/tokens/vehiculos/<id>.webp  (rectángulo 1:2 de 400×800, sin anillo:
 *       un coche ocupa 2×4 casillas, no un círculo)
 *
 * DVV generaba sobre verde y lo quitaba por clave de color. Acá no hay croma: la
 * transparencia ya viene de BiRefNet (tools/workflows/recortar-birefnet.json), así
 * que sólo se limpia el alfa (se apaga el velo de menos del 8 %), se recorta al
 * contenido, se centra en el lienzo y, en el modo PNJ, se aplica la máscara
 * circular con un anillo fino, el formato que Foundry espera para un token de 1
 * casilla.
 *
 * Uso: node tools/tokens.mjs [--solo <id>] [--tamano 512]
 *   --solo busca el id en ambos modos (PNJ y vehículos).
 *   --tamano sólo afecta a los tokens circulares.
 * generar-arte.mjs llama a tokenCircular() directamente al terminar cada token.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");
export const ENTRADA = path.join(RAIZ, "assets/tokens-crudo");
export const SALIDA = path.join(RAIZ, "assets/tokens");
const ANILLO = "#2b2b2b";
const VEH_ANCHO = 400, VEH_ALTO = 800, VEH_MARGEN = 8;

// Limpieza del alfa de BiRefNet: el velo casi transparente (< 8 %) que deja
// alrededor de la figura no cuenta para el recorte; a los píxeles del todo
// transparentes se les pone un RGB fijo para que -trim los vea iguales.
const LIMPIEZA = [
  "-channel", "A", "-level", "8%,100%", "+channel",
  "-background", "none", "-alpha", "background",
  "-fuzz", "1%", "-trim", "+repage"
];

function argsCircular(entrada, destino, tam) {
  // La figura entra al 88 % del círculo interior (margen para el anillo): a
  // tamaño completo, una figura cenital ancha de hombros o con mochila queda
  // cortada por el borde del círculo.
  const interior = Math.round((tam - 24) * 0.88);
  return [
    entrada,
    ...LIMPIEZA,
    // ajustar al círculo interior y centrar en lienzo cuadrado
    "-resize", `${interior}x${interior}`,
    "-background", "none", "-gravity", "center", "-extent", `${tam}x${tam}`,
    // máscara circular: DstIn conserva la transparencia del recorte y además
    // corta lo que queda fuera del círculo
    "(", "-size", `${tam}x${tam}`, "xc:none", "-fill", "white",
      "-draw", `circle ${tam / 2},${tam / 2} ${tam / 2},10`, ")",
    "-compose", "DstIn", "-composite",
    // anillo
    "-fill", "none", "-stroke", ANILLO, "-strokewidth", "8",
    "-draw", `circle ${tam / 2},${tam / 2} ${tam / 2},10`,
    "-define", "webp:lossless=false", "-define", "webp:alpha-quality=100", "-quality", "90",
    destino
  ];
}

function argsRectangular(entrada, destino) {
  return [
    entrada,
    ...LIMPIEZA,
    // Foundry asume que un token «mira» hacia ABAJO (rotación 0 = sur); el arte
    // se genera con el frente arriba, así que se rota 180°.
    "-rotate", "180",
    "-resize", `${VEH_ANCHO - 2 * VEH_MARGEN}x${VEH_ALTO - 2 * VEH_MARGEN}`,
    "-background", "none", "-gravity", "center", "-extent", `${VEH_ANCHO}x${VEH_ALTO}`,
    "-define", "webp:lossless=false", "-define", "webp:alpha-quality=100", "-quality", "90",
    destino
  ];
}

/** Figura con alfa → token circular con anillo. */
export function tokenCircular(entrada, destino, { tam = 512 } = {}) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  execFileSync("magick", argsCircular(entrada, destino, tam), { stdio: "pipe" });
  return destino;
}

/** Vehículo con alfa → token rectangular 400×800. */
export function tokenRectangular(entrada, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  execFileSync("magick", argsRectangular(entrada, destino), { stdio: "pipe" });
  return destino;
}

if (import.meta.filename === process.argv[1]) {
  const argv = process.argv.slice(2);
  const valor = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const solo = valor("--solo");
  const TAM = Number(valor("--tamano") ?? 512);
  const listar = dir => fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => /\.(png|webp)$/.test(f) && (!solo || f.replace(/\.\w+$/, "") === solo))
    : [];
  const trabajos = [
    ...listar(ENTRADA).map(f => ({ f, dir: ENTRADA, sal: SALIDA, hacer: (e, d) => tokenCircular(e, d, { tam: TAM }) })),
    ...listar(path.join(ENTRADA, "vehiculos"))
      .map(f => ({ f, dir: path.join(ENTRADA, "vehiculos"), sal: path.join(SALIDA, "vehiculos"), hacer: tokenRectangular }))
  ];
  if (solo && !trabajos.length) {
    console.error(`No encontré ${solo}.png en assets/tokens-crudo ni en assets/tokens-crudo/vehiculos.`);
    process.exit(1);
  }
  for (const { f, dir, sal, hacer } of trabajos) {
    const id = f.replace(/\.\w+$/, "");
    const destino = path.join(sal, `${id}.webp`);
    hacer(path.join(dir, f), destino);
    const kb = Math.round(fs.statSync(destino).size / 1024);
    const dims = execFileSync("magick", ["identify", "-format", "%wx%h", destino]).toString();
    console.log(`✓ ${id.padEnd(18)} ${dims.padEnd(8)} ${kb} KB`);
  }
}

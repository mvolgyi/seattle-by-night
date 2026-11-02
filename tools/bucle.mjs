#!/usr/bin/env node
/**
 * Convierte una pista generada en un bucle sin corte (adaptado de DVV).
 *
 * ACE-Step suele arrancar con una entrada (a veces un golpe o un silencio
 * corto) y cerrar con un remate o un fundido aunque el prompt pida lo
 * contrario. Para que Foundry la repita sin que se note:
 *
 *   1. busca el tramo estable: del primer al último momento en que el nivel
 *      (ventanas de 2 s) está cerca de la mediana de la pista; además salta
 *      siempre los primeros RECORTE_INI s y los últimos RECORTE_FIN s;
 *   2. estima el pulso por autocorrelación de la envolvente de ataques (si
 *      se sabe el bpm pedido, busca sólo cerca de él) y corta un múltiplo de
 *      4 pulsos (un compás), así el empalme cae a tiempo en la música con
 *      ritmo; en un ambiente sin pulso no molesta;
 *   3. funde los últimos FUNDIDO segundos sobre los primeros (potencia
 *      constante): la pista resultante termina exactamente donde empieza;
 *   4. normaliza a un volumen parejo entre pistas (ganancia FIJA hasta
 *      `lufs`, medida con ebur128, y un limitador a −1 dBTP), para no romper
 *      el empalme como haría loudnorm dinámico;
 *   5. codifica en Ogg Vorbis estéreo 48 kHz.
 *
 * Uso: node tools/bucle.mjs <entrada.flac> <salida.ogg> [--bpm 70] [--lufs -20]
 * generar-musica.mjs lo llama solo para cada pista.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const SR = 11025;          // muestreo del análisis (no del resultado)
const FUNDIDO = 4;         // segundos de cola fundidos sobre la cabeza
const MARGEN_DB = 4;       // cuánto por debajo de la mediana sigue siendo «estable»
const RECORTE_INI = 2;     // s que se saltan siempre al principio (ataque del modelo)
const RECORTE_FIN = 3;     // s que se saltan siempre al final (remate o fundido)
const SECCION_DB = 6;      // diferencia entre bloques de 8 s que ya es otra sección

function leerPcm(ruta) {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", ruta, "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"],
    { maxBuffer: 1 << 28 });
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1);
}

/** dB RMS de la ventana [ini, ini + largo) en muestras. */
function db(m, ini, largo) {
  let s = 0;
  const fin = Math.min(m.length, ini + largo);
  for (let i = ini; i < fin; i++) s += m[i] * m[i];
  return 10 * Math.log10(s / Math.max(1, fin - ini) / (32768 * 32768) + 1e-12);
}

/** Período del pulso (s) y fase del primer ataque fuerte (s). */
function pulso(m, bpm) {
  const hop = Math.round(SR / 100); // 10 ms
  const energia = [];
  for (let i = 0; i + hop <= m.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += m[j] * m[j];
    energia.push(Math.log(s / hop + 1));
  }
  const ataque = energia.map((e, i) => (i ? Math.max(0, e - energia[i - 1]) : 0));
  const media = ataque.reduce((a, b) => a + b, 0) / ataque.length;
  const o = ataque.map(a => a - media);
  // Con bpm conocido se busca ±8 % alrededor del pulso pedido (o su doble
  // si es muy rápido); si no, entre 0,4 y 1,2 s como DVV.
  let min = 40, max = 120;
  if (bpm) {
    let p = 6000 / bpm;
    while (p < 40) p *= 2;
    while (p > 120) p /= 2;
    min = Math.max(20, Math.floor(p * 0.92)); max = Math.ceil(p * 1.08);
  }
  let mejor = { lag: min, r: -Infinity };
  for (let lag = min; lag <= max; lag++) {
    let r = 0;
    for (let i = 0; i + lag < o.length; i++) r += o[i] * o[i + lag];
    r /= o.length - lag;
    if (r > mejor.r) mejor = { lag, r };
  }
  let fase = { p: 0, s: -Infinity };
  for (let p = 0; p < mejor.lag; p++) {
    let s = 0;
    for (let i = p; i < o.length; i += mejor.lag) s += o[i];
    if (s > fase.s) fase = { p, s };
  }
  return { periodo: mejor.lag / 100, fase: fase.p / 100 };
}

/** Sonoridad integrada (LUFS) y pico de muestra (dBFS) con ebur128 (ffmpeg lo escribe en stderr). */
export function medirSonoridad(ruta) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", ruta, "-af", "ebur128=peak=sample", "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 1 << 26 });
  const resumen = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(resumen)?.[1]);
  const pico = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(resumen)?.[1] ?? -Infinity);
  return { lufs, pico };
}

/**
 * Dónde cortar: tramo estable (y homogéneo), alineado a compases. No escribe nada.
 * generar-musica.mjs lo usa también para puntuar candidatos por el largo útil.
 * @returns {{ ini, fin, largo, compases, compas, dur, seccion: string|null }}
 */
export function planBucle(entrada, { bpm = null } = {}) {
  const m = leerPcm(entrada);
  const dur = m.length / SR;
  const v = 2 * SR, paso = Math.round(SR / 2);
  const niveles = [];
  for (let i = 0; i + v <= m.length; i += paso) niveles.push({ t: i / SR, db: db(m, i, v) });
  const mediana = [...niveles].sort((a, b) => a.db - b.db)[niveles.length >> 1].db;
  const estable = niveles.filter(n => n.db >= mediana - MARGEN_DB && n.t >= RECORTE_INI && n.t + 2 <= dur - RECORTE_FIN);
  if (!estable.length) throw new Error(`${path.basename(entrada)}: no hay tramo estable`);
  let ini0 = estable[0].t, fin0 = estable.at(-1).t + 2;

  // Si en el medio hay un cambio de sección (bloques de 8 s que difieren más
  // de SECCION_DB), el bucle se queda con el tramo homogéneo más largo: mejor
  // un bucle más corto que uno que salta de una sección a otra en el empalme.
  const bloques = [];
  for (let t = ini0; t + 8 <= fin0; t += 2) bloques.push({ t, db: db(m, Math.round(t * SR), 8 * SR) });
  let mejor = { a: 0, b: bloques.length - 1 }, seccion = null;
  const rango = (a, b) => { const x = bloques.slice(a, b + 1).map(k => k.db); return Math.max(...x) - Math.min(...x); };
  if (bloques.length > 1 && rango(0, bloques.length - 1) > SECCION_DB) {
    mejor = { a: 0, b: 0 };
    for (let a = 0; a < bloques.length; a++) {
      for (let b = a + mejor.b - mejor.a + 1; b < bloques.length; b++) if (rango(a, b) <= SECCION_DB) mejor = { a, b };
    }
    const [n0, n1] = [bloques[mejor.a].t, bloques[mejor.b].t + 8];
    seccion = `cambio de sección; uso el tramo homogéneo ${n0.toFixed(0)}–${n1.toFixed(0)} s de ${ini0.toFixed(0)}–${fin0.toFixed(0)} s`;
    ini0 = n0; fin0 = n1;
  }

  const { periodo, fase } = pulso(m, bpm);
  const compas = 4 * periodo;
  const ini = fase + Math.ceil((ini0 - fase) / periodo) * periodo;
  const compases = Math.floor((fin0 - ini - FUNDIDO) / compas);
  if (compases < 4) throw new Error(`${path.basename(entrada)}: tramo estable demasiado corto (${(fin0 - ini0).toFixed(1)} s)`);
  const nominal = compases * compas;

  // Ajuste fino: el pulso sale con resolución de 10 ms y un error de 1 % se
  // acumula a lo largo de 30 compases. Se busca, a ±medio pulso del largo
  // nominal, el largo con el que la envolvente de ataques de la cola
  // (ini + largo …) mejor coincide con la de la cabeza (ini …) durante el
  // fundido, para que los golpes de las dos caigan juntos.
  const hop = Math.round(SR / 500); // 2 ms
  const env = [];
  for (let i = 0; i + hop <= m.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += m[j] * m[j];
    env.push(Math.log(s / hop + 1));
  }
  const ata = env.map((e, i) => (i ? Math.max(0, e - env[i - 1]) : 0));
  const suave = ata.map((_, i) => (ata[i - 2] ?? 0) + (ata[i - 1] ?? 0) + ata[i] + (ata[i + 1] ?? 0) + (ata[i + 2] ?? 0));
  const k0 = Math.round(ini * 500), n = Math.round((FUNDIDO + 2) * 500);
  const correl = d => {
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) {
      const a = suave[k0 + i] ?? 0, b = suave[k0 + d + i] ?? 0;
      sab += a * b; saa += a * a; sbb += b * b;
    }
    return sab / Math.sqrt(saa * sbb + 1e-12);
  };
  const d0 = Math.round(nominal * 500), radio = Math.round(periodo * 250);
  const limite = Math.floor((dur - RECORTE_FIN - FUNDIDO - ini) * 500);
  let mejorD = d0, mejorR = correl(d0);
  for (let d = d0 - radio; d <= Math.min(d0 + radio, limite); d++) {
    const r = correl(d);
    if (r > mejorR) { mejorR = r; mejorD = d; }
  }
  const largo = mejorD / 500;
  const fin = ini + largo + FUNDIDO;
  return { ini, fin, largo, compases, compas, dur, seccion, ajuste: largo - nominal, correlacion: mejorR };
}

/**
 * Corta, empalma, normaliza y codifica.
 * @returns {{ ini, largo, compases, compas, lufs, pico, ganancia }}
 */
export function hacerBucle(entrada, salida, { bpm = null, lufs = -20, kbps = 112, log = console.log } = {}) {
  const { ini, fin, largo, compases, compas, dur, seccion, ajuste, correlacion } = planBucle(entrada, { bpm });
  if (seccion) log(`  ${path.basename(entrada)}: ${seccion}`);

  fs.mkdirSync(path.dirname(salida), { recursive: true });
  const tmp = `${salida}.bucle.wav`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", entrada, "-filter_complex",
    `[0:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[x][y];` +
    `[x]atrim=${(ini + FUNDIDO).toFixed(4)}:${fin.toFixed(4)},asetpts=PTS-STARTPTS[a];` +
    `[y]atrim=${ini.toFixed(4)}:${(ini + FUNDIDO).toFixed(4)},asetpts=PTS-STARTPTS[b];` +
    `[a][b]acrossfade=d=${FUNDIDO}:c1=qsin:c2=qsin[out]`,
    "-map", "[out]", "-c:a", "pcm_f32le", tmp]);

  // Ganancia fija hasta el objetivo; el limitador (−1 dBFS) sólo actúa en los
  // picos. Se limita el bucle repetido tres veces y se guarda la copia del
  // medio, muestra a muestra: así el limitador llega a la unión con el mismo
  // estado de los dos lados (con `latency` compensa su retardo de 5 ms; sin
  // eso corre la señal y deja muestras en cero al principio).
  const antes = medirSonoridad(tmp);
  const ganancia = Number.isFinite(antes.lufs) ? lufs - antes.lufs : 0;
  const n = Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration_ts",
    "-of", "csv=p=0", tmp], { encoding: "utf8" }).trim());
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-af",
    `aloop=loop=2:size=${n},volume=${ganancia.toFixed(2)}dB,` +
    `alimiter=limit=0.891:attack=5:release=50:level=false:latency=true,` +
    `atrim=start_sample=${n}:end_sample=${2 * n},asetpts=PTS-STARTPTS`,
    "-c:a", "libvorbis", "-b:a", `${kbps}k`, "-ar", "48000", "-ac", "2", salida]);
  fs.rmSync(tmp, { force: true });
  const despues = medirSonoridad(salida);
  log(`  bucle ${path.basename(salida)}: ${dur.toFixed(1)} s → ${largo.toFixed(1)} s ` +
    `(desde ${ini.toFixed(1)} s, ${compases} compases de ${compas.toFixed(2)} s ${ajuste >= 0 ? "+" : ""}${Math.round(ajuste * 1000)} ms, ` +
    `alineación ${correlacion.toFixed(2)}, fundido ${FUNDIDO} s), ` +
    `${antes.lufs.toFixed(1)} → ${despues.lufs.toFixed(1)} LUFS, pico ${despues.pico} dBFS`);
  return { ini, largo, compases, compas, ajuste, correlacion, lufs: despues.lufs, pico: despues.pico, ganancia };
}

if (import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  const opcion = f => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return Number(v); };
  const bpm = opcion("--bpm"), lufs = opcion("--lufs") ?? -20;
  if (args.length !== 2) { console.error("Uso: node tools/bucle.mjs <entrada.flac> <salida.ogg> [--bpm 70] [--lufs -20]"); process.exit(1); }
  hacerBucle(args[0], args[1], { bpm, lufs });
}

#!/usr/bin/env node
/**
 * Música de fondo (ambientes en bucle) en local con ACE-Step 1.5 vía ComfyUI.
 *
 * Adaptado del generar-musica.mjs de DVV (que usaba Lyria 3 en la nube). Acá
 * no sale nada de la máquina: el workflow es tools/workflows/musica-acestep.json
 * (ACE-Step 1.5 XL turbo + LM de 4B, nativos de ComfyUI) y los parámetros de
 * cada pista viven en tools/musica.config.json, keyed por el id de pista de
 * content/musica.json (ese archivo define QUÉ pistas hay; éste, CÓMO suenan).
 *
 * Por pista:
 *   1. genera un candidato por semilla (`semillas`) en cache/musica/<id>/<semilla>.flac
 *      (si ya está, no lo regenera: elegir otra semilla después es gratis);
 *   2. mide cada candidato (silencios, saltos de nivel, recorte digital) y deja
 *      su espectrograma al lado (<semilla>.png) para revisarlo a ojo: las
 *      voces cantadas se ven como pilas de armónicos ondulantes entre 200 Hz
 *      y 4 kHz;
 *   3. elige la semilla `elegida` (si la hay) o la de mejor puntaje entre las
 *      que no estén en `descartadas` (semilla → motivo, p. ej. voces), la pasa
 *      por tools/bucle.mjs (bucle, −20 LUFS, Ogg Vorbis 112 kbps) y la deja
 *      en assets/musica/<id>.ogg;
 *   4. registra la pista en assets/PROCEDENCIA.json (`musica`).
 *
 * Uso:
 *   node tools/generar-musica.mjs                 # lo que falte en assets/musica/
 *   node tools/generar-musica.mjs --solo id1,id2  # sólo esas
 *   node tools/generar-musica.mjs --forzar        # rehace el .ogg (los candidatos quedan en caché)
 *   node tools/generar-musica.mjs --regenerar     # además vuelve a generar los candidatos
 *   node tools/generar-musica.mjs --listar
 *   node tools/generar-musica.mjs --config otra.json --salida <dir>   # pruebas fuera del módulo
 *
 * Antes de cada trabajo mira la temperatura de la GPU y la RAM libre; si pasa
 * de 80 °C o quedan menos de 4 GB, espera. Al terminar llama a POST /free.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { cargarWorkflow, rellenar, encolar, esperar, bajar, liberar } from "./comfy.mjs";
import { hacerBucle, planBucle } from "./bucle.mjs";

const RAIZ = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const tiene = f => argv.includes(f);
const valor = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const RUTA_CONFIG = path.resolve(valor("--config") ?? path.join(RAIZ, "tools/musica.config.json"));
const CONFIG = JSON.parse(fs.readFileSync(RUTA_CONFIG, "utf8"));
const SALIDA = path.resolve(valor("--salida") ?? path.join(RAIZ, "assets/musica"));
const CACHE = path.resolve(valor("--cache") ?? path.join(RAIZ, "cache/musica"));
const soloIds = valor("--solo")?.split(",").map(s => s.trim()).filter(Boolean) ?? null;
const forzar = tiene("--forzar") || tiene("--regenerar");
const regenerar = tiene("--regenerar");
const D = CONFIG.defaults ?? {};
const LARGO_IDEAL = 125; // s de bucle a los que se apunta (~2 min)

/* -------------------------------------------- */
/*  Pistas                                      */
/* -------------------------------------------- */

/** Ids de content/musica.json (el formato lo define otro agente: se aceptan varias formas). */
function idsDelContenido() {
  const ruta = path.join(RAIZ, "content/musica.json");
  if (!fs.existsSync(ruta)) return null;
  const c = JSON.parse(fs.readFileSync(ruta, "utf8"));
  const lista = Array.isArray(c) ? c : c.pistas ?? c.listas?.flatMap(l => l.pistas) ?? [];
  return lista.map(p => p.id).filter(Boolean);
}

/** Prompt completo: prefijo del estilo + sujeto de la pista + sufijo del estilo (como arte.config.json). */
function promptDe(p) {
  const e = CONFIG.estilos?.[p.estilo] ?? {};
  return [e.prefijo, p.sujeto, e.sufijo, CONFIG.sufijo].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function parametrosDe(id, p) {
  const e = CONFIG.estilos?.[p.estilo] ?? {};
  const x = { ...D, ...e.parametros, ...p };
  return {
    tags: promptDe(p),
    letra: x.letra ?? "[Instrumental]",
    bpm: x.bpm ?? 70,
    tonalidad: x.tonalidad ?? "D minor",
    compas: String(x.compas ?? "4"),
    duracion: x.duracion ?? 130,
    cfgLm: x.cfg_lm ?? 2,
    temperatura: x.temperatura ?? 0.85,
    lufs: x.lufs ?? -20,
    kbps: x.kbps ?? 112,
    semillas: x.semillas ?? [1, 2, 3],
    descartadas: p.descartadas ?? {},
    elegida: p.elegida ?? null
  };
}

const pistas = Object.entries(CONFIG.pistas ?? {}).filter(([id]) => !id.startsWith("_"));
const destinoDe = id => path.join(SALIDA, `${id}.ogg`);

function duracion(ruta) {
  try {
    return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", ruta], { encoding: "utf8" }).trim());
  } catch { return null; }
}

if (tiene("--listar")) {
  const ids = idsDelContenido();
  for (const [id, p] of pistas) {
    const r = destinoDe(id), ok = fs.existsSync(r);
    console.log(`  ${ok ? "✓" : "·"} ${id.padEnd(26)} ${p.estilo ?? "-"}${ok ? `  ${duracion(r)?.toFixed(1)} s` : ""}${ids && !ids.includes(id) ? "  (no está en content/musica.json)" : ""}`);
  }
  for (const id of ids ?? []) if (!CONFIG.pistas?.[id]) console.log(`  ✗ ${id.padEnd(26)} sin parámetros en musica.config.json`);
  process.exit(0);
}

/* -------------------------------------------- */
/*  Vigilancia de temperatura y memoria         */
/* -------------------------------------------- */

function estadoMaquina() {
  let temp = null, vram = null;
  try {
    const [t, v] = execFileSync("nvidia-smi", ["--query-gpu=temperature.gpu,memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8" })
      .trim().split(",").map(Number);
    temp = t; vram = v;
  } catch { /* sin nvidia-smi */ }
  const mem = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync("/proc/meminfo", "utf8"));
  return { temp, vram, ramLibre: mem ? Number(mem[1]) / 1048576 : null };
}

async function esperarMaquina() {
  for (let aviso = true; ; aviso = false) {
    const e = estadoMaquina();
    if ((e.temp ?? 0) <= 80 && (e.ramLibre ?? 99) >= 4) return e;
    if (aviso) console.log(`  pausa: GPU ${e.temp} °C, RAM libre ${e.ramLibre?.toFixed(1)} GB`);
    await new Promise(r => setTimeout(r, 15000));
  }
}

/* -------------------------------------------- */
/*  Generación                                  */
/* -------------------------------------------- */

async function generarCandidato(id, prm, semilla, destino) {
  const wf = rellenar(cargarWorkflow("musica-acestep"), {
    TAGS: prm.tags, LETRA: prm.letra, SEMILLA: semilla, BPM: prm.bpm, DURACION: prm.duracion,
    COMPAS: prm.compas, TONALIDAD: prm.tonalidad, CFG_LM: prm.cfgLm, TEMPERATURA: prm.temperatura,
    PREFIJO: `sbn-musica/${id}-${semilla}`
  });
  const t0 = Date.now();
  let pico = 0;
  const vigia = setInterval(() => { pico = Math.max(pico, estadoMaquina().vram ?? 0); }, 2000);
  try {
    const hist = await esperar(await encolar(wf), { timeout: 20 * 60e3 });
    const audio = Object.values(hist.outputs ?? {}).flatMap(o => o.audio ?? []).find(a => a.type === "output");
    if (!audio) throw new Error("ComfyUI no devolvió audio");
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, await bajar(audio));
  } finally { clearInterval(vigia); }
  return { segundos: (Date.now() - t0) / 1000, vramPico: pico };
}

/* -------------------------------------------- */
/*  Análisis de un candidato                    */
/* -------------------------------------------- */

const SR = 11025;
function pcm(ruta) {
  const b = execFileSync("ffmpeg", ["-v", "error", "-i", ruta, "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  return new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
}
const dbv = (m, i, n) => {
  let s = 0; const f = Math.min(m.length, i + n);
  for (let k = i; k < f; k++) s += m[k] * m[k];
  return 10 * Math.log10(s / Math.max(1, f - i) / 2 ** 30 + 1e-12);
};

/**
 * Silencios (ventanas de 0,5 s 25 dB por debajo de la mediana o bajo −55 dBFS),
 * paradas cortas (≥ 0,4 s en ventanas de 100 ms),
 * cambios de sección (diferencia máxima entre niveles medios de bloques de 8 s
 * vecinos: una pausa de un compás no cuenta, que entre la batería a mitad de
 * pista sí), recorte digital (muestras a ±0,999 a 48 kHz) y nivel medio.
 * Se ignoran los 2 s del principio y los 3 s del final: bucle.mjs los corta igual.
 * Puntaje: menor es mejor.
 */
function analizar(ruta) {
  const m = pcm(ruta);
  const dur = m.length / SR;
  // ACE-Step suele terminar unos segundos antes de lo pedido (cola muda) y a
  // veces arranca con un silencio: eso lo recorta bucle.mjs, así que silencios
  // y paradas se cuentan sólo entre el primer y el último momento con sonido.
  const medio = Math.round(SR / 2), decima = Math.round(SR / 10); // ventanas enteras: SR es impar
  const cortas = [];
  for (let i = 0; i + medio <= m.length; i += medio) cortas.push(dbv(m, i, medio));
  const med = [...cortas].sort((a, b) => a - b)[cortas.length >> 1];
  const mudo = d => d < med - 25 || d < -55;
  const ini = Math.max(4, cortas.findIndex(d => !mudo(d)));                  // ≥ 2 s
  const fin = Math.min(cortas.length - 6, cortas.findLastIndex(d => !mudo(d))); // ≤ dur − 3 s
  let racha = 0, silencioMax = 0, silencioTotal = 0;
  for (let i = ini; i <= fin; i++) {
    const m0 = mudo(cortas[i]);
    racha = m0 ? racha + 0.5 : 0;
    if (m0) silencioTotal += 0.5;
    silencioMax = Math.max(silencioMax, racha);
  }
  // Paradas: cortes de ≥ 0,4 s (ventanas de 100 ms) 25 dB por debajo de la
  // mediana; en un bucle de fondo suenan a que se trabó el audio.
  const v100 = [];
  for (let i = ini * medio; i + decima <= (fin + 1) * medio; i += decima) v100.push(dbv(m, i, decima));
  const med100 = [...v100].sort((a, b) => a - b)[v100.length >> 1];
  let paradas = 0;
  for (let i = 0, run = 0; i <= v100.length; i++) {
    if (i < v100.length && v100[i] < med100 - 25) { run++; continue; }
    if (run >= 4) paradas++;
    run = 0;
  }
  const bloques = [];
  for (let i = 2 * SR; i + 8 * SR <= m.length - 3 * SR; i += 4 * SR) bloques.push(dbv(m, i, 8 * SR));
  let salto = 0;
  for (let i = 2; i < bloques.length; i++) salto = Math.max(salto, Math.abs(bloques[i] - bloques[i - 2]));
  const media = bloques.reduce((a, b) => a + b, 0) / bloques.length;
  const desvio = Math.sqrt(bloques.reduce((a, b) => a + (b - media) ** 2, 0) / bloques.length);
  const full = execFileSync("ffmpeg", ["-v", "error", "-i", ruta, "-f", "s16le", "-ac", "2", "-ar", "48000", "-"], { maxBuffer: 1 << 29 });
  const s16 = new Int16Array(full.buffer, full.byteOffset, full.length >> 1);
  let recorte = 0;
  for (const x of s16) if (x >= 32735 || x <= -32735) recorte++;
  const puntaje = silencioMax * 3 + silencioTotal + salto * 2 + desvio * 2 + paradas * 8 + (recorte > 50 ? 5 : 0);
  return { dur: +dur.toFixed(1), nivel: +media.toFixed(1), desvio: +desvio.toFixed(1), salto: +salto.toFixed(1),
    silencioMax, silencioTotal, paradas, recorte, puntaje: +puntaje.toFixed(1) };
}

function espectrograma(ruta, png) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", ruta, "-lavfi",
    "aformat=channel_layouts=mono,showspectrumpic=s=1600x500:legend=1:scale=log:stop=6000", png]);
}

/* -------------------------------------------- */
/*  Procedencia                                 */
/* -------------------------------------------- */

const MODELOS = CONFIG.modelo?.archivos ?? [];
const LICENCIA = CONFIG.modelo?.licencia ?? "";

function registrar(destino, datos) {
  const abs = path.resolve(destino);
  const dentro = abs.startsWith(RAIZ + path.sep);
  const archivo = dentro ? path.join(RAIZ, "assets/PROCEDENCIA.json") : path.join(path.dirname(abs), "PROCEDENCIA.json");
  const clave = dentro ? path.relative(RAIZ, abs) : path.basename(abs);
  const reg = fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, "utf8")) : {};
  reg.musica ??= {};
  reg.musica[clave] = { fecha: new Date().toISOString(), ...datos };
  reg.musica = Object.fromEntries(Object.entries(reg.musica).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(archivo, JSON.stringify(reg, null, 2) + "\n");
}

/* -------------------------------------------- */
/*  Principal                                   */
/* -------------------------------------------- */

let cola = pistas;
if (soloIds) cola = cola.filter(([id]) => soloIds.includes(id));
if (!forzar) cola = cola.filter(([id]) => !fs.existsSync(destinoDe(id)));
if (!cola.length) { console.log("Nada que generar. Usá --forzar o --listar."); process.exit(0); }

const ids = idsDelContenido();
if (ids) for (const [id] of cola) if (!ids.includes(id)) console.warn(`  aviso: ${id} no está en content/musica.json`);

console.log(`Generando ${cola.length} pista(s) → ${path.relative(RAIZ, SALIDA) || SALIDA}\n`);
const fallos = [];
const informe = {};
for (const [n, [id, p]] of cola.entries()) {
  const prm = parametrosDe(id, p);
  console.log(`[${n + 1}/${cola.length}] ${id}  (${prm.bpm} bpm, ${prm.tonalidad}, ${prm.duracion} s, semillas ${prm.semillas.join(",")})`);
  try {
    const candidatos = [];
    for (const semilla of prm.semillas) {
      const flac = path.join(CACHE, id, `${semilla}.flac`);
      const meta = flac.replace(/\.flac$/, ".json");
      let gen = null;
      if (regenerar || !fs.existsSync(flac)) {
        const e = await esperarMaquina();
        gen = await generarCandidato(id, prm, semilla, flac);
        fs.writeFileSync(meta, JSON.stringify({ ...gen, fecha: new Date().toISOString() }) + "\n");
        const d = estadoMaquina();
        console.log(`    semilla ${semilla}: ${gen.segundos.toFixed(1)} s, VRAM pico ${gen.vramPico} MiB, GPU ${d.temp} °C (antes ${e.temp} °C), RAM libre ${d.ramLibre?.toFixed(1)} GB`);
      }
      const a = analizar(flac);
      // El bucle sale del tramo homogéneo más largo: un candidato que cambia de
      // sección a mitad de camino da un bucle corto y repetitivo. Cada segundo
      // por debajo de LARGO_IDEAL suma un tercio de punto.
      try {
        const plan = planBucle(flac, { bpm: prm.bpm });
        a.bucle = +plan.largo.toFixed(1);
        a.puntaje = +(a.puntaje + Math.max(0, LARGO_IDEAL - plan.largo) / 3).toFixed(1);
      } catch (err) { a.bucle = 0; a.puntaje += 100; }
      const png = flac.replace(/\.flac$/, ".png");
      if (regenerar || !fs.existsSync(png)) espectrograma(flac, png);
      // Tiempo y VRAM de la generación: si salió de la caché, del .json de al lado.
      gen ??= fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, "utf8")) : null;
      candidatos.push({ semilla, flac, ...a, segundos: gen?.segundos ?? null, vramPico: gen?.vramPico ?? null });
      if (semilla in prm.descartadas) console.log(`      descartada: ${prm.descartadas[semilla]}`);
      console.log(`      ${a.dur} s, nivel ${a.nivel} dB ±${a.desvio}, cambio de sección ${a.salto} dB, silencio máx ${a.silencioMax} s (total ${a.silencioTotal} s), paradas ${a.paradas}, recorte ${a.recorte}, bucle ${a.bucle} s → puntaje ${a.puntaje}`);
    }
    const mejor = prm.elegida != null
      ? candidatos.find(c => c.semilla === prm.elegida) ?? (() => { throw new Error(`la semilla elegida ${prm.elegida} no está en semillas`); })()
      : [...candidatos].filter(c => !(c.semilla in prm.descartadas)).sort((a, b) => a.puntaje - b.puntaje)[0];
    if (!mejor) throw new Error("todas las semillas están descartadas");
    const destino = destinoDe(id);
    const b = hacerBucle(mejor.flac, destino, { bpm: prm.bpm, lufs: prm.lufs, kbps: prm.kbps, log: s => console.log(`  ${s}`) });
    const dur = duracion(destino);
    console.log(`  ✓ ${path.relative(RAIZ, destino)}  semilla ${mejor.semilla}${prm.elegida != null ? " (elegida)" : " (mejor puntaje)"}, ${dur?.toFixed(1)} s, ${Math.round(fs.statSync(destino).size / 1024)} KB\n`);
    informe[id] = { elegida: mejor.semilla, candidatos: candidatos.map(({ flac, ...c }) => c) };
    registrar(destino, {
      id,
      modelos: MODELOS,
      licencia: LICENCIA,
      workflow: "tools/workflows/musica-acestep.json",
      semilla: mejor.semilla,
      prompt: prm.tags,
      letra: prm.letra,
      parametros: { bpm: prm.bpm, tonalidad: prm.tonalidad, compas: prm.compas, duracion_pedida: prm.duracion,
        cfg_lm: prm.cfgLm, temperatura: prm.temperatura, pasos: 8, sampler: "euler/simple", shift: 3 },
      candidatos: prm.semillas,
      bucle: { desde: +b.ini.toFixed(3), largo: +b.largo.toFixed(3), compases: b.compases,
        ajuste_ms: Math.round(b.ajuste * 1000), alineacion: +b.correlacion.toFixed(2), fundido: 4 },
      duracion: dur != null ? +dur.toFixed(2) : null,
      sonoridad: { lufs: b.lufs, pico_dbfs: b.pico },
      formato: `Ogg Vorbis ${prm.kbps} kbps, estéreo, 48 kHz`,
      segundos: mejor.segundos,
      vram_pico_mib: mejor.vramPico
    });
  } catch (err) {
    console.log(`  ✗ ${err.message}\n`);
    fallos.push(id);
  }
}
fs.mkdirSync(CACHE, { recursive: true });
fs.writeFileSync(path.join(CACHE, "informe.json"), JSON.stringify(informe, null, 2) + "\n");
try { await liberar(); console.log("VRAM liberada (POST /free)."); } catch (err) { console.warn(`No pude liberar la VRAM: ${err.message}`); }
if (fallos.length) {
  console.error(`\nFallaron: ${fallos.join(", ")}. Reintentá con --solo ${fallos.join(",")}`);
  process.exit(1);
}

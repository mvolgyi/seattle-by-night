#!/usr/bin/env node
/**
 * Cliente de la API de ComfyUI (SPEC.md §4.3). Reemplaza a las llamadas a
 * Gemini de DVV: todo el arte del módulo se genera en local.
 *
 *   subirImagen()   POST /upload/image (multipart, overwrite)
 *   cargarWorkflow() lee tools/workflows/<nombre>.json (formato API)
 *   rellenar()      reemplaza los marcadores "{{NOMBRE}}" con valores TIPADOS
 *   encolar()       POST /prompt
 *   esperar()       sondea /history/{id} hasta que termina o falla
 *   bajar()         GET /view
 *   ejecutar()      todo junto: sube las imágenes, rellena, encola, espera y baja
 *
 * Marcadores (tools/MODELOS.md): si un string es SÓLO el marcador
 * (`"seed": "{{SEMILLA}}"`), se reemplaza por el valor con su tipo: un número
 * sigue siendo número (ComfyUI rechaza `"seed": "123"`). Si el marcador está
 * dentro de un string más largo (`"{{PREFIJO}}-control"`), se reemplaza como
 * texto. Un marcador sin valor es un error: nunca se manda un workflow con
 * `{{…}}` sin resolver.
 *
 * Sin dependencias: fetch, FormData y Blob nativos de Node.
 *
 * Uso suelto (pruebas):
 *   node tools/comfy.mjs t2i-zimage --PROMPT "…" --SEMILLA 7 --ANCHO 1024 --ALTO 1024 --salida /tmp/x.webp
 *   node tools/comfy.mjs escalar-seedvr2 --IMAGEN ruta.png --ANCHO 2048 --ALTO 1536 --SEMILLA 1 --salida y.webp
 * Los valores numéricos se pasan como número; los marcadores IMAGEN,
 * IMAGEN_ESTILO y CONTROL se toman como rutas locales y se suben.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");
export const SERVIDOR = process.env.COMFY_URL ?? "http://127.0.0.1:8188";
export const WORKFLOWS = path.join(RAIZ, "tools/workflows");

/** Marcadores que son archivos: el valor es una ruta local que se sube antes. */
export const MARCADORES_IMAGEN = new Set(["IMAGEN", "IMAGEN_ESTILO", "CONTROL"]);

const CLIENTE = `sbn-${crypto.randomUUID()}`;

async function pedir(ruta, opciones = {}) {
  let res;
  try {
    res = await fetch(`${SERVIDOR}${ruta}`, opciones);
  } catch (err) {
    throw new Error(`ComfyUI no responde en ${SERVIDOR} (${err.cause?.code ?? err.message}). ¿Está corriendo?`);
  }
  if (!res.ok) {
    const cuerpo = await res.text();
    const err = new Error(`${opciones.method ?? "GET"} ${ruta} → ${res.status}: ${cuerpo.slice(0, 2000)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

/** Sube una imagen local a input/ de ComfyUI y devuelve el nombre con el que quedó. */
export async function subirImagen(ruta, nombre) {
  const datos = fs.readFileSync(ruta);
  // El nombre lleva un hash del contenido: dos entradas distintas con el mismo
  // nombre de archivo no se pisan entre trabajos.
  const hash = crypto.createHash("sha1").update(datos).digest("hex").slice(0, 10);
  const ext = path.extname(ruta) || ".png";
  const final = nombre ?? `sbn-${path.basename(ruta, ext)}-${hash}${ext}`;
  const form = new FormData();
  form.append("image", new Blob([datos]), final);
  form.append("overwrite", "true");
  const res = await pedir("/upload/image", { method: "POST", body: form });
  const r = await res.json();
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}

/** Workflow en formato API, copia profunda (se puede modificar sin tocar el archivo). */
export function cargarWorkflow(nombre) {
  const archivo = nombre.endsWith(".json") ? nombre : path.join(WORKFLOWS, `${nombre}.json`);
  return JSON.parse(fs.readFileSync(archivo, "utf8"));
}

const MARCADOR_SOLO = /^\{\{([A-Z0-9_]+)\}\}$/;
const MARCADOR = /\{\{([A-Z0-9_]+)\}\}/g;

/** Reemplaza los marcadores con valores tipados. Devuelve un workflow nuevo. */
export function rellenar(workflow, valores) {
  const faltan = new Set();
  const visitar = v => {
    if (typeof v === "string") {
      const solo = MARCADOR_SOLO.exec(v);
      if (solo) {
        if (!(solo[1] in valores)) { faltan.add(solo[1]); return v; }
        return valores[solo[1]];
      }
      return v.replace(MARCADOR, (m, k) => {
        if (!(k in valores)) { faltan.add(k); return m; }
        return String(valores[k]);
      });
    }
    if (Array.isArray(v)) return v.map(visitar);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visitar(x)]));
    return v;
  };
  const lleno = visitar(workflow);
  if (faltan.size) throw new Error(`faltan valores para los marcadores: ${[...faltan].join(", ")}`);
  return lleno;
}

/** Marcadores que usa un workflow (para validar antes de mandar). */
export function marcadores(workflow) {
  return [...new Set([...JSON.stringify(workflow).matchAll(MARCADOR)].map(m => m[1]))];
}

/** Encola el workflow; devuelve el prompt_id. */
export async function encolar(workflow) {
  const res = await pedir("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: CLIENTE })
  }).catch(err => {
    // 400 con node_errors: el mensaje útil está en el cuerpo.
    throw new Error(`ComfyUI rechazó el workflow: ${err.message}`);
  });
  const r = await res.json();
  if (r.node_errors && Object.keys(r.node_errors).length) {
    throw new Error(`errores de nodos: ${JSON.stringify(r.node_errors).slice(0, 2000)}`);
  }
  return r.prompt_id;
}

/** Espera a que el trabajo termine. Devuelve la entrada de /history. */
export async function esperar(id, { timeout = 30 * 60e3, cada = 1000 } = {}) {
  const fin = Date.now() + timeout;
  while (Date.now() < fin) {
    const h = await (await pedir(`/history/${id}`)).json();
    const e = h[id];
    if (e?.status?.completed || e?.status?.status_str === "success") return e;
    if (e?.status?.status_str === "error") {
      const msj = (e.status.messages ?? []).filter(([t]) => t === "execution_error")
        .map(([, d]) => `${d.node_type ?? "?"} (nodo ${d.node_id}): ${d.exception_message}`).join("; ");
      throw new Error(`ComfyUI falló: ${msj || JSON.stringify(e.status).slice(0, 500)}`);
    }
    await new Promise(r => setTimeout(r, cada));
  }
  throw new Error(`timeout esperando ${id}`);
}

/** Baja un archivo de salida. */
export async function bajar({ filename, subfolder = "", type = "output" }) {
  const q = new URLSearchParams({ filename, subfolder, type });
  return Buffer.from(await (await pedir(`/view?${q}`)).arrayBuffer());
}

/** Libera la VRAM (y opcionalmente descarga los modelos). */
export async function liberar(descargar = true) {
  await pedir("/free", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unload_models: descargar, free_memory: true })
  });
}

/**
 * Ejecuta un workflow de punta a punta.
 *
 * @param {string|object} workflow  nombre en tools/workflows/ o el objeto ya cargado (y retocado)
 * @param {object} valores          marcadores → valor; los de MARCADORES_IMAGEN son rutas locales
 * @returns {{ id, segundos, salidas: [{ nodo, titulo, filename, buffer }] }}
 */
export async function ejecutar(workflow, valores, { timeout } = {}) {
  const wf = typeof workflow === "string" ? cargarWorkflow(workflow) : workflow;
  const finales = { ...valores };
  for (const k of marcadores(wf)) {
    if (MARCADORES_IMAGEN.has(k) && typeof finales[k] === "string" && fs.existsSync(finales[k])) {
      finales[k] = await subirImagen(finales[k]);
    }
  }
  const lleno = rellenar(wf, finales);
  const t0 = Date.now();
  const id = await encolar(lleno);
  const hist = await esperar(id, { timeout });
  const segundos = (Date.now() - t0) / 1000;
  const salidas = [];
  for (const [nodo, out] of Object.entries(hist.outputs ?? {})) {
    for (const img of out.images ?? []) {
      if (img.type !== "output") continue;
      salidas.push({ nodo, titulo: lleno[nodo]?._meta?.title ?? lleno[nodo]?.class_type,
        filename: img.filename, buffer: await bajar(img) });
    }
  }
  return { id, segundos, salidas };
}

/** Guarda un buffer (PNG) como WebP (o PNG si la extensión lo pide). */
export function guardar(buffer, destino, calidad = 90) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  if (destino.endsWith(".png")) { fs.writeFileSync(destino, buffer); return destino; }
  execFileSync("magick", ["png:-", "-quality", String(calidad), destino], { input: buffer, stdio: ["pipe", "pipe", "pipe"] });
  return destino;
}

/* -------------------------------------------- */
/*  Procedencia (assets/PROCEDENCIA.json)        */
/* -------------------------------------------- */

/**
 * Registra una imagen generada. Las imágenes del repo van a
 * assets/PROCEDENCIA.json con ruta relativa; las de fuera del repo (pruebas en
 * un directorio temporal) a un PROCEDENCIA.json en su propia carpeta, para no
 * llenar el del módulo de archivos que no se publican.
 */
export function registrarProcedencia(destino, datos) {
  const abs = path.resolve(destino);
  const dentro = abs.startsWith(RAIZ + path.sep);
  const archivo = dentro ? path.join(RAIZ, "assets/PROCEDENCIA.json") : path.join(path.dirname(abs), "PROCEDENCIA.json");
  const clave = dentro ? path.relative(RAIZ, abs) : path.basename(abs);
  let reg = { _comentario: "Procedencia de cada imagen generada (CLAUDE.md, Licencias): modelo, licencia, workflow, semilla y prompt. La clave es la ruta del archivo; regenerar pisa la entrada.", imagenes: {} };
  if (fs.existsSync(archivo)) reg = JSON.parse(fs.readFileSync(archivo, "utf8"));
  reg.imagenes ??= {};
  reg.imagenes[clave] = { fecha: new Date().toISOString(), ...datos };
  reg.imagenes = Object.fromEntries(Object.entries(reg.imagenes).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(archivo, JSON.stringify(reg, null, 2) + "\n");
  return archivo;
}

/* -------------------------------------------- */

if (import.meta.filename === process.argv[1]) {
  const argv = process.argv.slice(2);
  const nombre = argv[0];
  if (!nombre || nombre.startsWith("--")) {
    console.error("Uso: node tools/comfy.mjs <workflow> --MARCADOR valor … [--salida archivo.webp]");
    process.exit(1);
  }
  const valores = {};
  let salida = null;
  for (let i = 1; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, ""), v = argv[i + 1];
    if (k === "salida") { salida = v; continue; }
    valores[k] = v !== "" && !Number.isNaN(Number(v)) && !MARCADORES_IMAGEN.has(k) && k !== "PROMPT" ? Number(v) : v;
  }
  valores.PREFIJO ??= `sbn/cli-${Date.now()}`;
  const r = await ejecutar(nombre, valores);
  console.log(`✓ ${nombre} en ${r.segundos.toFixed(1)} s (${r.salidas.length} imagen/es)`);
  r.salidas.forEach((s, i) => {
    const dest = salida ? (i ? salida.replace(/(\.\w+)$/, `-${i}$1`) : salida) : null;
    if (dest) { guardar(s.buffer, dest); console.log(`  ${s.titulo} → ${dest}`); }
    else console.log(`  ${s.titulo}: ${s.filename}`);
  });
}

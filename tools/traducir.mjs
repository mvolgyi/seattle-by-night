#!/usr/bin/env node
/**
 * Traduce content/ al inglés en content/en/ con la API de Claude (TRADUCCION.md).
 *
 *   node tools/traducir.mjs [--estimar] [--directo] [--forzar] [--solo <glob>]… [--reanudar]
 *
 * Unidades:
 *   - un .md entero (frontmatter + cuerpo) → content/en/<ruta>.md con `nombre`, `nota` y `fuente`;
 *   - las entidades pendientes de un JSON (tabla de tools/traduccion/campos.mjs) → overlay
 *     content/en/<ruta>.json con `_fuente` por entidad;
 *   - las carpetas de los journals → content/en/carpetas.json.
 * Una unidad está pendiente si falta o si su huella (sha256 del castellano, 16 hex) no coincide.
 *
 * Opciones:
 *   --estimar   cuenta tokens (count_tokens) y da el costo, sin traducir.
 *   --directo   sin lote: una petición por unidad, en streaming (para el piloto).
 *   --forzar    retraduce aunque la huella coincida.
 *   --solo G    limita las unidades (se puede repetir). Glob sobre la ruta relativa a content/:
 *               «cronica/aventura/11-prologo.md», «planos/*.json», «pnjs/fuera.json#PNJ-04».
 *   --reanudar  retoma el lote en curso (tools/traduccion/lote-en-curso.json) si se cortó la espera.
 *
 * Por defecto va en lote (Batches API, 50 %). El system (estilo + glosario) va cacheado.
 * Cada respuesta se valida (validar.mjs); si falla, se reintenta una vez en directo.
 *
 * La key sale de .env (CLAUDE_CODE_API_KEY) y se pasa explícita al cliente. No se imprime nunca.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { RAIZ, archivosMd, separarFrontmatter } from "./util.mjs";
import * as C from "./traduccion/campos.mjs";
import { validarMarkdown, validarTexto } from "./traduccion/validar.mjs";

/* -------------------------------------------- */
/*  Configuración                               */
/* -------------------------------------------- */

const MODELO = "claude-opus-5-5";
const ESFUERZO = "high";
const MAX_SALIDA = 64000;
/** Una unidad más grande que esto no entra cómoda en una respuesta: habría que partirla por `## `. */
const MAX_ENTRADA_UNIDAD = 60000;
/** USD por millón de tokens (skill claude-api, Opus 5.5). Lote: 50 % de todo. */
const PRECIO = { entrada: 4, salida: 20, cacheLectura: 0.2, cacheEscritura5m: 5, cacheEscritura1h: 8 };
/** Salida estimada por token de entrada de la unidad (traducción + pensamiento). Medido en el piloto: 26.218 de salida / 16.383 de entrada ≈ 1,6. */
const FACTOR_SALIDA = 1.6;

const CONTENT = path.join(RAIZ, "content");
const EN = path.join(CONTENT, "en");
const DIR_TRAD = path.join(RAIZ, "tools", "traduccion");
const ESTADO_LOTE = path.join(DIR_TRAD, "lote-en-curso.json");

/* -------------------------------------------- */
/*  Argumentos y cliente                        */
/* -------------------------------------------- */

const args = process.argv.slice(2);
const opcion = n => args.includes(n);
const OPC = {
  estimar: opcion("--estimar"),
  directo: opcion("--directo"),
  forzar: opcion("--forzar"),
  reanudar: opcion("--reanudar"),
  solo: args.flatMap((a, i) => (a === "--solo" && args[i + 1] ? [args[i + 1]] : []))
};

function leerKey() {
  const archivo = path.join(RAIZ, ".env");
  if (!fs.existsSync(archivo)) throw new Error("falta .env con CLAUDE_CODE_API_KEY");
  for (const linea of fs.readFileSync(archivo, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?CLAUDE_CODE_API_KEY\s*=\s*(.*)\s*$/.exec(linea);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim();
  }
  throw new Error(".env no tiene CLAUDE_CODE_API_KEY");
}

let _cliente = null;
const cliente = () => (_cliente ??= new Anthropic({ apiKey: leerKey(), maxRetries: 4 }));

/* -------------------------------------------- */
/*  System: estilo + glosario (cacheado)        */
/* -------------------------------------------- */

function textoSystem() {
  const estilo = fs.readFileSync(path.join(DIR_TRAD, "estilo.md"), "utf8");
  const glosario = JSON.parse(fs.readFileSync(path.join(DIR_TRAD, "glosario.json"), "utf8"));
  const lineas = glosario.terminos.map(t => `- ${t.es} → ${t.en}${t.nota ? ` (${t.nota})` : ""}`);
  return `${estilo.trim()}\n\n## Glosario (obligatorio)\n\n${lineas.join("\n")}\n`;
}

const system = ttl => [{ type: "text", text: textoSystem(), cache_control: ttl ? { type: "ephemeral", ttl } : { type: "ephemeral" } }];

/* -------------------------------------------- */
/*  Esquemas de salida (structured outputs)     */
/* -------------------------------------------- */

const ESQUEMA_MD = {
  type: "object",
  properties: { nombre: { type: "string" }, nota: { type: "string" }, cuerpo: { type: "string" } },
  required: ["nombre", "nota", "cuerpo"],
  additionalProperties: false
};

const ESQUEMA_CAMPOS = {
  type: "object",
  properties: {
    traducciones: {
      type: "array",
      items: {
        type: "object",
        properties: { clave: { type: "string" }, texto: { type: "string" } },
        required: ["clave", "texto"],
        additionalProperties: false
      }
    }
  },
  required: ["traducciones"],
  additionalProperties: false
};

/* -------------------------------------------- */
/*  Unidades                                    */
/* -------------------------------------------- */

const posix = p => p.split(path.sep).join("/");
const relContent = abs => posix(path.relative(CONTENT, abs));

function globARegex(g) {
  const s = g.replace(/^content\//, "").replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, ".").replace(/\u0000/g, ".*");
  return new RegExp(`^${s}$`);
}

/** Filtro de --solo: { archivo → null (todo) | Set(entidades) } o null si no hay --solo. */
function filtroSolo() {
  if (!OPC.solo.length) return null;
  return OPC.solo.map(g => {
    const [archivo, ent] = g.split("#");
    return { re: globARegex(archivo), ent: ent ?? null };
  });
}

function pasaFiltro(filtro, rel, entidad = null) {
  if (!filtro) return true;
  return filtro.some(f => f.re.test(rel) && (!f.ent || !entidad || f.ent === entidad));
}

const leerJsonAbs = abs => JSON.parse(fs.readFileSync(abs, "utf8"));

/** Recorre content/ sin content/en/. */
function archivosFuente() {
  const md = archivosMd(CONTENT).filter(p => !p.startsWith(EN + path.sep));
  const json = [];
  const rec = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (p !== EN) rec(p); } else if (e.name.endsWith(".json")) json.push(p);
    }
  };
  rec(CONTENT);
  return { md, json: json.sort() };
}

/** Huella guardada en un .md traducido (frontmatter `fuente`). */
function fuenteMdTraducido(rel) {
  const p = path.join(EN, rel);
  if (!fs.existsSync(p)) return null;
  return separarFrontmatter(fs.readFileSync(p, "utf8")).meta.fuente ?? null;
}

function unidadMd(abs) {
  const rel = relContent(abs);
  const texto = fs.readFileSync(abs, "utf8");
  const { meta, cuerpo } = separarFrontmatter(texto);
  const huella = C.huella(texto);
  return {
    id: rel, tipo: "md", rel, huella,
    pendiente: OPC.forzar || fuenteMdTraducido(rel) !== huella,
    tieneNota: "nota" in meta,
    entrada: { nombre: meta.nombre ?? "", nota: meta.nota ?? "", cuerpo }
  };
}

/** Clave plana de un texto de una entidad: «PNJ-04.convicciones[0]». */
const clavePlana = (ent, ruta) => (ruta === "." ? ent : `${ent}${ruta}`);

/** Copia de `v` con cada hoja de texto reemplazada por fn(ruta). Mismo recorrido que C.textos. */
function mapearTextos(v, fn, r = "") {
  if (typeof v === "string") return fn(r || ".");
  if (Array.isArray(v)) return v.map((x, i) => mapearTextos(x, fn, `${r}[${i}]`));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapearTextos(x, fn, `${r}.${k}`)]));
  return v;
}

function unidadJson(abs, filtro) {
  const rel = relContent(abs);
  if (!C.reglaDe(rel)) return null;
  const json = leerJsonAbs(abs);
  const campos = C.extraer(rel, json);
  const huellas = C.huellas(rel, json);
  const destino = path.join(EN, rel);
  const actual = fs.existsSync(destino) ? leerJsonAbs(destino) : null;
  const pendientes = Object.keys(campos).filter(k =>
    pasaFiltro(filtro, rel, k) && (OPC.forzar || actual?._fuente?.[k] !== huellas[k]));
  if (!pendientes.length) return { id: rel, tipo: "json", rel, pendiente: false };
  const entrada = {};
  for (const ent of pendientes) for (const t of C.textos(campos[ent])) entrada[clavePlana(ent, t.ruta)] = t.texto;
  return {
    id: rel, tipo: "json", rel, pendiente: true,
    entidades: pendientes,
    huellas: Object.fromEntries(pendientes.map(k => [k, huellas[k]])),
    campos: Object.fromEntries(pendientes.map(k => [k, campos[k]])),
    entrada
  };
}

/**
 * Carpetas: las rutas de `carpeta:` de los .md (con todos sus prefijos) y las que el build
 * arma por su cuenta (tools/contenido: actores.mjs y journals.mjs). Valor: el nombre visible
 * del último tramo en castellano.
 */
const CARPETAS_DEL_BUILD = [
  "Lugares", "Coteries", "FIRSTLIGHT", "FIRSTLIGHT/Célula Puget", "Personajes jugadores",
  "Menores", "Menores/Vástagos", "Menores/Ghouls", "Menores/Mortales", "Menores/Otros",
  "Armas", "Protección", "Equipo", "Estados", "Del prólogo al epílogo", "El Expediente Ward"
];

function unidadCarpetas(mds) {
  const rutas = new Set(CARPETAS_DEL_BUILD);
  for (const abs of mds) {
    const c = separarFrontmatter(fs.readFileSync(abs, "utf8")).meta.carpeta;
    if (!c) continue;
    const partes = c.split("/").map(s => s.trim()).filter(Boolean);
    partes.forEach((_, i) => rutas.add(partes.slice(0, i + 1).join("/")));
  }
  const entrada = Object.fromEntries([...rutas].sort().map(r => [r, r.split("/").at(-1)]));
  const huella = C.huella(C.canonico(entrada));
  const destino = path.join(EN, "carpetas.json");
  const actual = fs.existsSync(destino) ? leerJsonAbs(destino) : null;
  return { id: "carpetas.json", tipo: "carpetas", rel: "carpetas.json", huella, entrada, pendiente: OPC.forzar || actual?._fuente !== huella };
}

function unidades() {
  const filtro = filtroSolo();
  const { md, json } = archivosFuente();
  const out = [];
  for (const abs of md) if (pasaFiltro(filtro, relContent(abs))) out.push(unidadMd(abs));
  for (const abs of json) {
    const rel = relContent(abs);
    if (!pasaFiltro(filtro, rel)) continue;
    const u = unidadJson(abs, filtro);
    if (u) out.push(u);
  }
  if (pasaFiltro(filtro, "carpetas.json")) out.push(unidadCarpetas(md));
  return out;
}

/* -------------------------------------------- */
/*  Peticiones                                  */
/* -------------------------------------------- */

const DESCRIPCION = [
  [/^cronica\/aventura\//, "capítulo de la aventura (escenas, tiradas, leer en voz alta)"],
  [/^cronica\/firstlight\//, "FIRSTLIGHT jugable (reglas de Hunter: The Reckoning 5e)"],
  [/^cronica\//, "capítulo de la crónica"],
  [/^ciudad\//, "la ciudad: lugares, política, coteries"],
  [/^personajes\//, "perfil de personaje (prosa para el Narrador)"],
  [/^documentos\/DOC/, "documento del mundo (handout que leen los jugadores tal cual)"],
  [/^documentos\/AYU/, "ayuda de juego (handout)"],
  [/^documentos\//, "documentos"],
  [/^pnjs\//, "fichas de PNJs (datos del actor de Foundry)"],
  [/^planos\//, "plano de un mapa: nombres de salas, puertas, regiones y notas del Narrador"],
  [/^carpetas\.json$/, "nombres de carpetas de Foundry"]
];
const describir = rel => DESCRIPCION.find(([re]) => re.test(rel))?.[1] ?? "datos de la crónica";

function mensajeUsuario(u) {
  if (u.tipo === "md") {
    return [
      `Archivo: content/${u.rel} (${describir(u.rel)}).`,
      "Traducí al inglés `nombre` (título visible), `nota` (nota para el Narrador; si viene vacía, devolvela vacía) y `cuerpo` (Markdown completo, con todos sus marcadores intactos).",
      "",
      "<entrada>",
      JSON.stringify(u.entrada, null, 1),
      "</entrada>"
    ].join("\n");
  }
  const extra = u.tipo === "carpetas"
    ? "Cada clave es la ruta de una carpeta y el valor, el nombre visible de su último tramo: traducí ese nombre (corto, Title Case)."
    : "Cada clave es «<id de la entidad>.<campo>». Traducí cada texto. Las claves que terminan en `._claves.<X>` son nombres visibles de una reserva o un campo: traducí el nombre. Si un texto ya está en inglés o es un nombre propio, devolvelo igual.";
  return [
    `Archivo: content/${u.rel} (${describir(u.rel)}).`,
    extra,
    "Devolvé en `traducciones` exactamente un elemento por clave de la entrada, con la misma clave y el texto en inglés.",
    "",
    "<entrada>",
    JSON.stringify(u.entrada, null, 1),
    "</entrada>"
  ].join("\n");
}

function params(u, { ttl = null } = {}) {
  return {
    model: MODELO,
    max_tokens: MAX_SALIDA,
    thinking: { type: "adaptive" },
    output_config: { effort: ESFUERZO, format: { type: "json_schema", schema: u.tipo === "md" ? ESQUEMA_MD : ESQUEMA_CAMPOS } },
    system: system(ttl),
    messages: [{ role: "user", content: mensajeUsuario(u) }]
  };
}

class ErrorUnidad extends Error {}

/** Lee el JSON de una respuesta, después de mirar stop_reason. */
function leerRespuesta(msg) {
  if (msg.stop_reason === "refusal") {
    throw new ErrorUnidad(`rechazo del modelo (${msg.stop_details?.category ?? "sin categoría"})`);
  }
  if (msg.stop_reason === "max_tokens") throw new ErrorUnidad(`salida cortada en max_tokens (${MAX_SALIDA})`);
  const texto = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
  try { return JSON.parse(texto); } catch { throw new ErrorUnidad("la respuesta no es JSON válido"); }
}

/* -------------------------------------------- */
/*  Aplicar: validar y escribir content/en/     */
/* -------------------------------------------- */

function escribir(abs, texto) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, texto);
}

/** Valor de frontmatter entre comillas, sin romper separarFrontmatter (no desescapa). */
function valorYaml(v) {
  const s = String(v).replace(/\r?\n/g, " ");
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return `"${s.replace(/"/g, "”")}"`;
}

/** Valida la salida de una unidad. → { errores, avisos } */
function validar(u, salida) {
  if (u.tipo === "md") {
    const r = validarMarkdown(u.entrada.cuerpo, salida.cuerpo);
    if (!salida.nombre?.trim()) r.errores.push("nombre vacío");
    if (u.tieneNota && u.entrada.nota.trim() && !salida.nota?.trim()) r.errores.push("nota vacía");
    const rn = validarTexto(u.entrada.nombre, salida.nombre, "nombre");
    r.errores.push(...rn.errores);
    return r;
  }
  const errores = [], avisos = [];
  const mapa = new Map();
  for (const t of salida.traducciones ?? []) {
    if (mapa.has(t.clave)) errores.push(`clave repetida: ${t.clave}`);
    mapa.set(t.clave, t.texto);
  }
  for (const k of Object.keys(u.entrada)) {
    if (!mapa.has(k)) { errores.push(`falta la clave ${k}`); continue; }
    const r = validarTexto(u.entrada[k], mapa.get(k), k);
    errores.push(...r.errores);
    avisos.push(...r.avisos);
  }
  for (const k of mapa.keys()) if (!(k in u.entrada)) errores.push(`clave que no estaba: ${k}`);
  return { errores, avisos, mapa };
}

function escribirUnidad(u, salida, mapa) {
  if (u.tipo === "md") {
    const fm = [`nombre: ${valorYaml(salida.nombre)}`];
    if (u.tieneNota) fm.push(`nota: ${valorYaml(salida.nota)}`);
    fm.push(`fuente: ${u.huella}`);
    const cuerpo = salida.cuerpo.endsWith("\n") ? salida.cuerpo : `${salida.cuerpo}\n`;
    escribir(path.join(EN, u.rel), `---\n${fm.join("\n")}\n---\n\n${cuerpo.replace(/^\n+/, "")}`);
    return;
  }
  if (u.tipo === "carpetas") {
    const carpetas = Object.fromEntries(Object.keys(u.entrada).map(k => [k, mapa.get(k)]));
    escribir(path.join(EN, "carpetas.json"), JSON.stringify({ _fuente: u.huella, carpetas }, null, 2) + "\n");
    return;
  }
  // JSON: rearmar los campos de cada entidad y fundir con el overlay que ya hubiera.
  const json = leerJsonAbs(path.join(CONTENT, u.rel));
  const destino = path.join(EN, u.rel);
  const actual = fs.existsSync(destino) ? leerJsonAbs(destino) : null;
  const traducidas = actual ? C.entidadesDelOverlay(u.rel, json, actual) : {};
  const fuentes = { ...(actual?._fuente ?? {}) };
  for (const ent of u.entidades) {
    traducidas[ent] = mapearTextos(u.campos[ent], ruta => mapa.get(clavePlana(ent, ruta)));
    fuentes[ent] = u.huellas[ent];
  }
  escribir(destino, JSON.stringify(C.armarOverlay(u.rel, json, traducidas, fuentes), null, 2) + "\n");
}

/* -------------------------------------------- */
/*  Uso y costo                                 */
/* -------------------------------------------- */

const USO = { entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura5m: 0, cacheEscritura1h: 0, costo: 0 };

function sumarUso(usage, factor) {
  if (!usage) return;
  const e5 = usage.cache_creation?.ephemeral_5m_input_tokens ?? (usage.cache_creation ? 0 : usage.cache_creation_input_tokens ?? 0);
  const e1 = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const u = {
    entrada: usage.input_tokens ?? 0, salida: usage.output_tokens ?? 0,
    cacheLectura: usage.cache_read_input_tokens ?? 0, cacheEscritura5m: e5, cacheEscritura1h: e1
  };
  for (const k of Object.keys(u)) USO[k] += u[k];
  USO.costo += factor * Object.entries(u).reduce((s, [k, n]) => s + n * PRECIO[k], 0) / 1e6;
}

const usd = n => `${n.toFixed(2)} USD`;
const informeUso = () =>
  `uso: entrada ${USO.entrada}, salida ${USO.salida}, cache leída ${USO.cacheLectura}, `
  + `cache escrita ${USO.cacheEscritura5m + USO.cacheEscritura1h} → ${usd(USO.costo)}`;

/* -------------------------------------------- */
/*  Directo (streaming)                         */
/* -------------------------------------------- */

/** Una petición en streaming. Con fallbacks del servidor si el modelo rechaza. */
async function pedirDirecto(u) {
  const p = params(u);
  const stream = cliente().beta.messages.stream({
    ...p, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default"
  });
  const msg = await stream.finalMessage();
  sumarUso(msg.usage, 1);
  if (msg.model !== MODELO) console.log(`  (lo respondió ${msg.model} por fallback)`);
  return msg;
}

/** Pide, valida y escribe; si falla, reintenta una vez. → true si quedó escrita. */
async function traducirDirecto(u, intentosPrevios = 0) {
  for (let intento = intentosPrevios; intento < 2; intento++) {
    try {
      const salida = leerRespuesta(await pedirDirecto(u));
      const { errores, avisos, mapa } = validar(u, salida);
      if (errores.length) {
        console.log(`  ✗ ${u.id}: ${errores.length} error(es) de validación${intento === 0 ? ", reintento" : ""}`);
        errores.slice(0, 8).forEach(e => console.log(`      ${e}`));
        continue;
      }
      escribirUnidad(u, salida, mapa);
      console.log(`  ✓ ${u.id}${avisos.length ? ` (${avisos.length} aviso(s))` : ""}`);
      avisos.slice(0, 8).forEach(a => console.log(`      aviso: ${a}`));
      return true;
    } catch (e) {
      if (e instanceof ErrorUnidad) {
        console.log(`  ✗ ${u.id}: ${e.message}${intento === 0 ? ", reintento" : ""}`);
        continue;
      }
      if (e instanceof Anthropic.BadRequestError) { console.log(`  ✗ ${u.id}: petición inválida (400): ${e.message}`); return false; }
      if (e instanceof Anthropic.AuthenticationError) throw new Error("la key de .env no es válida (401)");
      if (e instanceof Anthropic.RateLimitError) { console.log(`  ✗ ${u.id}: límite de uso (429) después de los reintentos del SDK`); return false; }
      if (e instanceof Anthropic.APIError) { console.log(`  ✗ ${u.id}: error de la API ${e.status ?? ""}: ${e.message}`); continue; }
      throw e;
    }
  }
  return false;
}

/* -------------------------------------------- */
/*  Lote (Batches API)                          */
/* -------------------------------------------- */

const idLote = (u, i) => `u${String(i).padStart(4, "0")}-${u.id.replace(/[^a-zA-Z0-9]+/g, "-")}`.slice(0, 64);

async function lanzarLote(pend) {
  // TTL de 5 min: en un lote las peticiones corren en paralelo y el cache casi no pega (en el lote
  // completo de 2026-11-02 leyó 0,17 M y escribió 1,3 M); una escritura a 1 h cuesta el doble.
  const requests = pend.map((u, i) => ({ custom_id: idLote(u, i), params: params(u) }));
  const lote = await cliente().messages.batches.create({ requests });
  const estado = { lote: lote.id, creado: new Date().toISOString(), unidades: Object.fromEntries(pend.map((u, i) => [idLote(u, i), u])) };
  escribir(ESTADO_LOTE, JSON.stringify(estado));
  console.log(`Lote ${lote.id}: ${requests.length} unidades. Estado en ${posix(path.relative(RAIZ, ESTADO_LOTE))}.`);
  return estado;
}

async function esperarLote(estado) {
  for (;;) {
    const b = await cliente().messages.batches.retrieve(estado.lote);
    const c = b.request_counts;
    console.log(`  ${new Date().toLocaleTimeString()} · ${b.processing_status}: ${c.succeeded} ok, ${c.errored} con error, ${c.processing} en proceso`);
    if (b.processing_status === "ended") return b;
    await new Promise(r => setTimeout(r, 60_000));
  }
}

async function aplicarLote(estado) {
  const fallidas = [];
  let ok = 0;
  for await (const r of await cliente().messages.batches.results(estado.lote)) {
    const u = estado.unidades[r.custom_id];
    if (!u) continue;
    if (r.result.type !== "succeeded") {
      console.log(`  ✗ ${u.id}: ${r.result.type}${r.result.type === "errored" ? ` (${r.result.error?.error?.type ?? r.result.error?.type ?? "?"})` : ""}`);
      fallidas.push(u);
      continue;
    }
    sumarUso(r.result.message.usage, 0.5);
    try {
      const salida = leerRespuesta(r.result.message);
      const { errores, avisos, mapa } = validar(u, salida);
      if (errores.length) {
        console.log(`  ✗ ${u.id}: ${errores.length} error(es) de validación`);
        errores.slice(0, 6).forEach(e => console.log(`      ${e}`));
        fallidas.push(u);
        continue;
      }
      escribirUnidad(u, salida, mapa);
      ok++;
      if (avisos.length) console.log(`  ✓ ${u.id} (${avisos.length} aviso(s): ${avisos.slice(0, 3).join("; ")})`);
    } catch (e) {
      if (!(e instanceof ErrorUnidad)) throw e;
      console.log(`  ✗ ${u.id}: ${e.message}`);
      fallidas.push(u);
    }
  }
  console.log(`Lote aplicado: ${ok} ok, ${fallidas.length} para reintentar. ${informeUso()}`);
  let recuperadas = 0;
  const definitivas = [];
  for (const u of fallidas) {
    // El reintento (uno) va en directo, en streaming.
    if (await traducirDirecto(u, 1)) recuperadas++;
    else definitivas.push(u.id);
  }
  fs.rmSync(ESTADO_LOTE, { force: true });
  return { ok: ok + recuperadas, fallidas: definitivas };
}

/* -------------------------------------------- */
/*  Estimación                                  */
/* -------------------------------------------- */

async function estimar(pend) {
  const c = cliente();
  const sys = (await c.messages.countTokens({ model: MODELO, system: system(null), messages: [{ role: "user", content: "." }] })).input_tokens;
  let entrada = 0, salida = 0;
  const filas = [];
  const cola = [...pend];
  const trabajar = async () => {
    for (let u = cola.shift(); u; u = cola.shift()) {
      const n = (await c.messages.countTokens({ model: MODELO, messages: [{ role: "user", content: mensajeUsuario(u) }] })).input_tokens;
      filas.push([u.id, n]);
      if (n > MAX_ENTRADA_UNIDAD) console.log(`  ⚠ ${u.id}: ${n} tokens de entrada, conviene partirla por páginas`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, trabajar));
  for (const [, n] of filas) { entrada += n; salida += Math.round(n * FACTOR_SALIDA); }
  const N = pend.length;
  const mayor = filas.sort((a, b) => b[1] - a[1]).slice(0, 5);
  const base = (entrada * PRECIO.entrada + salida * PRECIO.salida) / 1e6;
  const sysCache = (sys * PRECIO.cacheEscritura5m + (N - 1) * sys * PRECIO.cacheLectura) / 1e6;
  const sysSinCache = (N * sys * PRECIO.cacheEscritura5m) / 1e6;
  console.log(`Unidades pendientes: ${N}`);
  console.log(`System (estilo + glosario): ${sys} tokens por petición`);
  console.log(`Entrada de las unidades: ${entrada} tokens · salida estimada (×${FACTOR_SALIDA}, con pensamiento): ${salida} tokens`);
  console.log(`Las más grandes: ${mayor.map(([id, n]) => `${id} ${n}`).join(", ")}`);
  console.log(`Costo en lote (50 %): ${usd(0.5 * (base + sysCache))} si el cache pega; ${usd(0.5 * (base + sysSinCache))} si no pega (lo normal en lote)`);
  console.log(`Costo en directo: ${usd(base + sysCache)}`);
}

/* -------------------------------------------- */
/*  Principal                                   */
/* -------------------------------------------- */

async function main() {
  if (OPC.reanudar) {
    if (!fs.existsSync(ESTADO_LOTE)) throw new Error("no hay lote en curso");
    const estado = leerJsonAbs(ESTADO_LOTE);
    await esperarLote(estado);
    const r = await aplicarLote(estado);
    console.log(`Listo: ${r.ok} unidades ok${r.fallidas.length ? `; fallidas: ${r.fallidas.join(", ")}` : ""}. ${informeUso()}`);
    return;
  }
  const todas = unidades();
  const pend = todas.filter(u => u.pendiente);
  console.log(`${todas.length} unidades; ${pend.length} pendientes${OPC.solo.length ? ` (--solo ${OPC.solo.join(" ")})` : ""}.`);
  if (!pend.length) return;
  if (OPC.estimar) return estimar(pend);
  if (fs.existsSync(ESTADO_LOTE)) throw new Error("hay un lote en curso: corré con --reanudar (o borrá tools/traduccion/lote-en-curso.json)");

  if (OPC.directo) {
    let ok = 0;
    const fallidas = [];
    for (const u of pend) {
      console.log(`→ ${u.id}`);
      if (await traducirDirecto(u)) ok++; else fallidas.push(u.id);
    }
    console.log(`Listo: ${ok} ok${fallidas.length ? `; fallidas: ${fallidas.join(", ")}` : ""}. ${informeUso()}`);
    return;
  }
  const estado = await lanzarLote(pend);
  await esperarLote(estado);
  const r = await aplicarLote(estado);
  console.log(`Listo: ${r.ok} unidades ok${r.fallidas.length ? `; fallidas: ${r.fallidas.join(", ")}` : ""}. ${informeUso()}`);
}

main().catch(e => {
  // Nunca imprimir la key: los errores del SDK no la incluyen; los nuestros tampoco.
  console.error(`traducir: ${e.message}`);
  process.exit(1);
});

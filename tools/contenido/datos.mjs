/**
 * content/{trackers,pistas}.json → data/cronica.json
 *
 * Lo que el módulo necesita en tiempo de juego y no está en los compendios:
 * umbrales y movimientos del Termómetro, las noches del Reloj de Halloway,
 * las pistas con sus dados, las pruebas sin ID y las tiradas clave (A3-E04
 * y A4-E01). El módulo publicado no lleva content/: lee este archivo con
 * fetch al iniciar (src/module/datos.mjs).
 *
 * Los IDs del libro (A1-E02, PNJ-03, LUG-07…) quedan tal cual en cada
 * entrada; el mapa `uuids` los resuelve a UUIDs de MUNDO con ctx.reg (los
 * mismos que usan los @UUID de los journals importados). Un ID que no está
 * en el registro no se inventa: se avisa y el panel lo muestra como texto.
 *
 * Determinista: sin fechas ni nada que cambie entre dos builds iguales.
 */
import fs from "node:fs";
import path from "node:path";
import { RAIZ, MODULO, leerJson, slug } from "../util.mjs";

const SALIDA = "data/cronica.json";
/** Lo que pueden saber los jugadores: lo que cargan sus clientes (src/module/datos.mjs). */
const SALIDA_PUBLICA = "data/publico.json";

/** Texto sin marcas de Markdown (*cursiva*, **negrita**). */
const plano = t => (typeof t === "string" ? t.replace(/\*+([^*]+)\*+/g, "$1").trim() : t);

/** Copia `obj` con sólo las claves pedidas que tengan valor. */
function tomar(obj, claves) {
  const out = {};
  for (const k of claves) {
    const v = obj?.[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    out[k] = typeof v === "string" ? plano(v) : v;
  }
  return out;
}

/** `cantidad` de trackers.json (1, -2, "=10", "congelar", 0) → cambio de la API del módulo. */
function cambio(cantidad) {
  if (typeof cantidad === "number") return cantidad === 0 ? null : (cantidad > 0 ? `+${cantidad}` : String(cantidad));
  const s = String(cantidad ?? "").trim();
  return s || null;
}

/**
 * Ids estables para lo que el mundo guarda (el registro del Termómetro guarda
 * el id del movimiento; el setting `pruebas`, las filas de A4-E01): derivados
 * del contenido (escena + las primeras palabras del motivo), no de la
 * posición, para que agregar o reordenar en content/ no los mueva. Si dos
 * coinciden, el segundo lleva «-2», el tercero «-3»… en el orden de content/.
 */
function idsEstables() {
  const vistos = new Map();
  return (...partes) => {
    const base = partes.filter(Boolean).map(p => slug(String(p)).split("-").slice(0, 6).join("-")).filter(Boolean).join("-");
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

/** "attributes.manipulation+skills.persuasion" → ["attributes.manipulation", "skills.persuasion"] */
const rutas = paths => (Array.isArray(paths) ? paths : [paths]).filter(Boolean)
  .map(p => String(p).split(/[+\s]+/).filter(Boolean));

/* -------------------------------------------- */
/*  Termómetro                                  */
/* -------------------------------------------- */

const CAMPOS_MOV = ["motivo", "escena", "noche", "noches", "lugar", "pnj", "pj", "documento", "gancho",
  "desenlace", "lor", "por", "maximo", "alcance", "condicional"];

function termometro(t, ctx) {
  const umbrales = (t.umbrales ?? [])
    // El 2 es el valor inicial («Inicio.»), no un umbral.
    .filter(u => u.valor > (t.inicio ?? 0) && u.ciudad)
    // `interludio`: el interludio de FIRSTLIGHT que se juega al cruzar ese umbral (INT-01 en el 3,
    // INT-03 en el 9; content/cronica/firstlight/00-firstlight-jugable.md). Sólo para el Narrador.
    .map(u => tomar(u, ["valor", "icono", "texto", "ciudad", "jugadores", "escena", "pnj", "interludio", "nota"]));

  const movimientos = [];
  const idMov = idsEstables();
  for (const tipo of ["sube", "baja", "otros"]) {
    (t[tipo] ?? []).forEach(m => {
      const c = cambio(m.cantidad);
      if (!c) return; // «cantidad 0»: no mueve nada, queda como texto en el journal TRACKERS.
      // «GAN-01: la analista…» ya nombra su gancho: no se repite.
      const donde = m.escena ?? m.lugar ?? m.gancho;
      const id = idMov(tipo, donde && !slug(String(m.motivo ?? "")).startsWith(slug(donde)) ? donde : null, m.motivo);
      movimientos.push({ id, tipo, cambio: c, ...tomar(m, CAMPOS_MOV) });
    });
  }
  const sinMover = [...(t.otros ?? [])].filter(m => !cambio(m.cantidad)).length;
  ctx.log(`datos: ${movimientos.length} movimientos del Termómetro (${sinMover} sin cambio, fuera)`);

  return {
    inicio: t.inicio ?? 2,
    min: t.min ?? 0,
    max: t.max ?? 10,
    visibilidad: plano(t.visibilidad),
    ayuda: t.ayuda,
    umbrales,
    movimientos,
    evitar: (t.evitar ?? []).map(e => tomar(e, ["motivo", "escena", "noche", "lugar", "lor", "gancho"])),
    condiciones: (t.condiciones ?? []).map(c => tomar(c, ["valor", "efecto", "escena", "noche", "lor"]))
  };
}

/* -------------------------------------------- */
/*  Reloj                                       */
/* -------------------------------------------- */

function reloj(r) {
  return {
    descripcion: plano(r.descripcion),
    noches: (r.noches ?? []).map(n => {
      const idMov = idsEstables();
      return {
        n: Number(n.n),
        ...tomar(n, ["fecha", "dia", "evento", "escena", "escenas"]),
        horas: (n.horas ?? []).map(h => tomar(h, ["hora", "dia", "evento"])),
        // id: lo guarda el registro del Termómetro (el botón rápido del panel).
        movimientos: (n.movimientos ?? []).map(m => ({ cambio: cambio(m.cantidad), ...tomar(m, ["motivo", "condicional"]) }))
          .filter(m => m.cambio)
          .map(m => ({ id: idMov(`noche-${Number(n.n)}`, m.motivo), ...m }))
      };
    }).sort((a, b) => a.n - b.n),
    variantes: (r.variantes ?? []).map(v => tomar(v, ["si", "entonces", "escena", "noche"]))
  };
}

/* -------------------------------------------- */
/*  Pistas, pruebas y tiradas                   */
/* -------------------------------------------- */

/** [{ tirada, cantidad }] → { "A3-E04": 1, "A4-E01": 2 } */
function dados(lista) {
  const out = {};
  for (const d of lista ?? []) if (d.tirada) out[d.tirada] = (out[d.tirada] ?? 0) + Number(d.cantidad || 0);
  return out;
}

const efectos = lista => (lista ?? []).map(e => tomar(e, ["escena", "efecto", "pj", "pnj"]));

function pistas(p) {
  return (p.pistas ?? []).map(x => ({
    id: x.id,
    nombre: plano(x.nombre),
    escena: x.escena,
    escenas: [...new Set([x.escena, ...(x.otrasEscenas ?? [])].filter(Boolean))],
    obtencion: (x.obtencion ?? []).map(o => tomar(o, ["escena", "tipo", "como", "lugar", "pj", "documento"])),
    dados: dados(x.dados),
    efectos: efectos(x.efectos)
  }));
}

function pruebas(p) {
  return (p.pruebas ?? []).map(x => ({
    ...tomar(x, ["id", "nombre", "escena", "como", "pj", "pnj", "documento"]),
    dados: dados(x.valores),
    efectos: efectos(x.efectos)
  }));
}

/**
 * Márgenes de A4-E01 en números, para que el panel marque la fila que
 * corresponde. Se leen del texto del libro; si cambia de forma, se avisa.
 */
function margen(texto, ctx) {
  let m;
  if (/halloway gana/i.test(texto)) return { max: -1 };
  if ((m = /empate o (\d+)\s*[–-]\s*(\d+)/i.exec(texto))) return { min: 0, max: Number(m[2]) };
  if ((m = /^(\d+)\s*[–-]\s*(\d+)/.exec(texto))) return { min: Number(m[1]), max: Number(m[2]) };
  if ((m = /^(\d+) o más/i.exec(texto))) return { min: Number(m[1]) };
  ctx.avisos.push(`datos: no entiendo el margen «${texto}» de A4-E01`);
  return {};
}

/** «Sí…», «Abstención…», «Imprevisible…» → voto por defecto. */
function votoPorDefecto(texto) {
  // Sin \b: en una regex sin `u`, «í» no es carácter de palabra.
  if (/^s[ií](?![a-z])/i.test(texto)) return "si";
  if (/^no(?![a-z])/i.test(texto)) return "no";
  if (/^abst/i.test(texto)) return "abstencion";
  return "azar";
}

function tiradas(p, listaPistas, listaPruebas, ctx) {
  const out = {};
  const t3 = p.tiradas?.["A3-E04"];
  if (t3) {
    out["A3-E04"] = {
      ...tomar(t3, ["nombre", "tirada", "dificultad", "automatico", "nota"]),
      rutas: rutas(t3.paths),
      pistas: t3.pistas ?? [],
      porPista: t3.porPista ?? 1,
      pruebas: t3.pruebas ?? [],
      resultados: (t3.resultados ?? []).map(r => tomar(r, ["resultado", "efecto"]))
    };
  }

  const t4 = p.tiradas?.["A4-E01"];
  if (t4) {
    const pistaPorId = new Map(listaPistas.map(x => [x.id, x]));
    const pruebaPorId = new Map(listaPruebas.map(x => [x.id, x]));
    // Cada fila de la lista de comprobación: una pista, varias que cuentan juntas, o una prueba.
    // Una casilla sin pista ni prueba (la Galería de Vidrio) se guarda en el setting `pruebas`
    // con su id: «A4-E01-OTRO-<motivo>», estable (ver idsEstables).
    const idFila = idsEstables();
    const fila = (v, grupo) => {
      const ids = v.pistas ?? (v.pista ? [v.pista] : []);
      const f = { id: v.prueba ?? (ids.length ? ids.join("+") : `${grupo}-${idFila(v.motivo ?? v.efecto ?? "fila").toUpperCase()}`), cantidad: Number(v.cantidad || 0) };
      if (ids.length) f.pistas = ids;
      if (v.prueba) f.prueba = v.prueba;
      if (v.motivo) f.motivo = plano(v.motivo);
      if (v.a) f.a = v.a;
      if (v.efecto) f.efecto = plano(v.efecto);
      for (const id of ids) if (!pistaPorId.has(id)) ctx.avisos.push(`datos: A4-E01 cuenta ${id}, que no está en pistas`);
      if (v.prueba && !pruebaPorId.has(v.prueba)) ctx.avisos.push(`datos: A4-E01 cuenta ${v.prueba}, que no está en pruebas`);
      return f;
    };

    const votacion = t4.votacion ?? {};
    const necesita = /(\d+)\s+votos?.*?de\s+(\d+)/i.exec(votacion.necesita ?? "");
    const fuentes = [...listaPistas, ...listaPruebas];
    out["A4-E01"] = {
      ...tomar(t4, ["nombre", "tirada", "dificultad"]),
      rutas: rutas(t4.paths),
      oponente: tomar(t4.oponente ?? {}, ["pnj", "reserva", "texto"]),
      valores: (t4.valores ?? []).map(v => fila(v, "VALOR")),
      otros: (t4.otros ?? []).map(v => fila(v, "A4-E01-OTRO")),
      resultados: (t4.resultados ?? []).map(r => ({ ...tomar(r, ["margen", "efecto"]), ...margen(r.margen ?? "", ctx) })),
      votacion: {
        texto: plano(votacion.necesita),
        necesita: necesita ? Number(necesita[1]) : 3,
        total: necesita ? Number(necesita[2]) : (votacion.primogenitos ?? []).length,
        porDefecto: plano(votacion.porDefecto),
        automatico: plano(votacion.automatico),
        primogenitos: (votacion.primogenitos ?? []).map(pr => {
          // Qué pistas y pruebas pueden cambiar este voto: las que nombra el libro en
          // «cambia» y las que en sus efectos de A4-E01 dicen «Votación: <apellido> cambia».
          const apellido = (ctx.reg.get(pr.pnj)?.nombre ?? "").split(/\s+/).filter(w => w.length > 3).at(-1);
          const nombrados = String(pr.cambia ?? "").match(/\bP-\d{2}\b/g) ?? [];
          const porEfecto = apellido ? fuentes.filter(f => f.efectos.some(e =>
            e.escena === "A4-E01" && new RegExp(`^votaci[oó]n:\\s*${apellido}\\b`, "i").test(e.efecto ?? ""))).map(f => f.id) : [];
          return {
            pnj: pr.pnj,
            defecto: plano(pr.defecto),
            cambia: plano(pr.cambia),
            voto: votoPorDefecto(pr.defecto ?? ""),
            apoyos: [...new Set([...nombrados, ...porEfecto])]
          };
        })
      }
    };
  }
  return out;
}

/* -------------------------------------------- */
/*  IDs del libro → UUIDs de mundo              */
/* -------------------------------------------- */

/** Claves cuyo valor es un ID del libro (o una lista de IDs). */
const CLAVES_ID = new Set(["escena", "escenas", "pnj", "pj", "lugar", "documento", "gancho", "desenlace", "lor", "ayuda", "pistas", "interludio", "id"]);
/** Además, los IDs que aparecen sueltos en los textos («(A4-E02)», «LOR-01 a nivel 4»). */
const ID_EN_TEXTO = /\b(?:A\d-E\d{2}|(?:PNJ|PJ|MEN|LUG|DOC|AYU|GAN|LOR|COT|FIN|MAP)-[A-Z]?\d{1,2}|FIN-[A-D])\b/g;

function recolectarIds(obj, ids = new Set(), clave = null) {
  if (Array.isArray(obj)) obj.forEach(v => recolectarIds(v, ids, clave));
  else if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) recolectarIds(v, ids, k);
  else if (typeof obj === "string") {
    if (clave && CLAVES_ID.has(clave)) ids.add(obj);
    for (const m of obj.match(ID_EN_TEXTO) ?? []) ids.add(m);
  }
  return ids;
}

function uuids(datos, ctx) {
  const out = {};
  const faltan = [];
  for (const id of [...recolectarIds(datos)].sort()) {
    const r = ctx.reg.get(id);
    if (r) out[id] = { uuid: r.uuid, nombre: plano(r.nombre), tipo: r.tipo };
    else if (!/^(PRUEBA-|VALOR-|A4-E01-OTRO|P-\d{2}\+)|^(sube|baja|otros|noche)-/.test(id)) faltan.push(id);
  }
  // Los actores (PNJ con ficha) también por separado: el panel tira por Halloway con su actor.
  const actores = {};
  for (const id of Object.keys(out)) {
    const a = ctx.actores.get(id);
    if (a) actores[id] = a.uuid;
  }
  if (faltan.length) ctx.avisos.push(`datos: IDs sin documento en el registro (quedan como texto): ${faltan.join(", ")}`);
  return { uuids: out, actores };
}

/* -------------------------------------------- */

export async function construir(ctx) {
  const existe = rel => fs.existsSync(path.join(RAIZ, rel));
  if (!existe("content/trackers.json") || !existe("content/pistas.json")) {
    ctx.avisos.push("datos: faltan content/trackers.json o content/pistas.json; data/cronica.json no se escribe");
    return;
  }
  const t = leerJson("content/trackers.json");
  const p = leerJson("content/pistas.json");

  const listaPistas = pistas(p);
  const listaPruebas = pruebas(p);
  const cuerpo = {
    termometro: termometro(t.termometro ?? {}, ctx),
    reloj: reloj(t.reloj ?? {}),
    pistas: listaPistas,
    pruebas: listaPruebas,
    tiradas: tiradas(p, listaPistas, listaPruebas, ctx)
  };
  const { uuids: mapa, actores } = uuids(cuerpo, ctx);

  // Coherencia mínima: lo que las tiradas cuentan tiene que existir.
  const idsPistas = new Set(listaPistas.map(x => x.id));
  const idsPruebas = new Set(listaPruebas.map(x => x.id));
  for (const id of cuerpo.tiradas["A3-E04"]?.pistas ?? []) if (!idsPistas.has(id)) ctx.avisos.push(`datos: A3-E04 cuenta ${id}, que no está en pistas`);
  for (const id of cuerpo.tiradas["A3-E04"]?.pruebas ?? []) if (!idsPruebas.has(id)) ctx.avisos.push(`datos: A3-E04 cuenta ${id}, que no está en pruebas`);
  if (cuerpo.reloj.noches.length !== 8) ctx.avisos.push(`datos: el Reloj tiene ${cuerpo.reloj.noches.length} noches (se esperaban 8)`);

  const salida = {
    $generado: `tools/contenido/datos.mjs desde content/trackers.json y content/pistas.json. No editar a mano: npm run contenido.`,
    modulo: MODULO,
    ...cuerpo,
    uuids: mapa,
    actores
  };
  const ruta = path.join(RAIZ, SALIDA);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(salida, null, 1) + "\n");

  // Lo que carga un jugador (CONTRATO.md): sin textos del Narrador (qué pasa en la
  // ciudad, escenas, PNJs, movimientos, tiradas, UUIDs). Sólo lo que la mesa ya ve:
  // los nombres de las pistas, la fecha de cada noche y lo que perciben los
  // jugadores en cada umbral.
  const publico = {
    $generado: `tools/contenido/datos.mjs (subconjunto para jugadores de ${SALIDA}). No editar a mano: npm run contenido.`,
    modulo: MODULO,
    publico: true,
    termometro: {
      inicio: cuerpo.termometro.inicio, min: cuerpo.termometro.min, max: cuerpo.termometro.max,
      umbrales: cuerpo.termometro.umbrales.map(u => tomar(u, ["valor", "icono", "jugadores"]))
    },
    reloj: { noches: cuerpo.reloj.noches.map(n => ({ n: n.n, ...tomar(n, ["fecha", "dia"]) })) },
    pistas: listaPistas.map(x => ({ id: x.id, nombre: x.nombre }))
  };
  fs.writeFileSync(path.join(RAIZ, SALIDA_PUBLICA), JSON.stringify(publico, null, 1) + "\n");
  console.log(`datos: ${SALIDA} (${listaPistas.length} pistas, ${listaPruebas.length} pruebas, ` +
    `${cuerpo.reloj.noches.length} noches, ${cuerpo.termometro.umbrales.length} umbrales, ` +
    `${cuerpo.termometro.movimientos.length} movimientos, ${Object.keys(mapa).length} IDs con UUID) y ${SALIDA_PUBLICA}`);
}

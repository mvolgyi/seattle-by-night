/**
 * Campos traducibles de los JSON de content/ (TRADUCCION.md, «Formato de content/en/»).
 *
 * Es la tabla única que usan el build (fusión de content/en/ sobre el castellano),
 * tools/traducir.mjs (qué se manda a traducir) y la verificación (qué tiene que
 * estar traducido y con qué huella).
 *
 * ## Overlay
 *
 * `content/en/<misma ruta>.json` trae SÓLO los campos de texto, con la misma forma que
 * el castellano, y las entidades identificadas por su `id`:
 *
 * ```json
 * {
 *   "_fuente": { "PNJ-04": "3f9a…", "CEL-01": "…" },     // huella por entidad
 *   "pnjs":    { "PNJ-04": { "nombre": "…", "convicciones": ["…"], "habilidades": { "firearms": [null, "Pistol"] } } },
 *   "celula":  { "nombre": "…" },                          // colección «unico»: los campos directos
 *   "tiradas": { "A3-E04": { "nombre": "…" } }             // colección «mapa»: por clave
 * }
 * ```
 *
 * - Una colección `lista` (array de objetos con `id`) va en el overlay como objeto
 *   `{ <id>: campos }`; `fundir` la empareja por `id`, nunca por posición.
 * - Los arrays de adentro de una entidad (convicciones, obtencion[], habitaciones[]…)
 *   van por posición, con el mismo largo: `null` en las posiciones sin texto.
 * - `habilidades.firearms: [4, "Francotirador"]` → `[null, "Sniper"]`.
 * - Claves visibles (`reservas: { "Física": 2 }`) → `reservas: { "_claves": { "Física": "Physical" } }`:
 *   `fundir` renombra la clave y conserva el valor y el orden.
 * - Un archivo cuya raíz es un mapa de entidades (pnjs/combate.json: `{ "PNJ-12": "markdown" }`)
 *   lleva las entidades en la raíz del overlay: `{ "_fuente": {…}, "PNJ-12": "markdown en inglés" }`.
 *
 * Números, rutas, coordenadas, claves de wod5e, ids, `carpeta` y nombres de poderes
 * nunca entran: no están en la tabla.
 *
 * ## Patrones de campo (relativos a la entidad)
 *
 * - `nombre`: una hoja de texto.
 * - `convicciones[]`: cada elemento del array.
 * - `piedrasDeToque[].nombre`: un campo de cada elemento.
 * - `habilidades.*[1]`: `*` es cualquier clave; `[1]`, el índice 1 (la especialidad).
 * - `reservas{}`: las CLAVES del objeto son texto visible.
 * - `.`: la entidad entera es un texto (combate.json).
 * - Forma objeto `{ ruta, excepto: [...], sinSlugs: true }`: `excepto` deja afuera valores
 *   que son claves (`jugadores: "inicio"`); `sinSlugs` deja afuera los ids de equipo de
 *   FIRSTLIGHT (`linterna-uv`) mezclados con texto en `equipo[]`.
 *
 * ## Ojo con los _id
 *
 * Algunos textos sirven de semilla de _id o se parsean en castellano en el build
 * (ventajas[]/defectos[] → `semilla("ventaja", nombre)`, perks de `facultades`,
 * `habitaciones[].nombre` ↔ `escenas[].sala`). El build calcula esos _id y esa
 * estructura con el CASTELLANO y toma del inglés sólo el texto visible, por posición.
 * `fundir` ya resuelve el caso de las salas de los planos (ver `remapearSalas`).
 */
import crypto from "node:crypto";

/* -------------------------------------------- */
/*  Tabla                                       */
/* -------------------------------------------- */

const ESPECIALIDADES = ["habilidades.*[1]", "excepcionales.*[1]"];

/** Fichas completas (pnjs/*.json, pjs.json). */
const FICHA = [
  "nombre", "apodo", "alias[]", "concepto", "secta", "sire", "nacimiento", "abrazado", "estado",
  "chiquillos[]", "ambicion", "deseo", "depredador", "resonancia",
  "convicciones[]", "piedrasDeToque[].nombre", "piedrasDeToque[].descripcion",
  "ventajas[]", "defectos[]", { ruta: "equipo[]", sinSlugs: true },
  "cita", "semblante", "nota", "notas", "provisional[]", "propuesto[]", "nombreToken",
  ...ESPECIALIDADES, "reservas{}",
  // Cazadores (H5): Credo y claves de Impulso/Facultad son claves de wod5e; el texto, no.
  "impulso.nombre", "impulso.texto", "impulso.redencion", "facultades.*[1][]", "facultadesNotas.*",
  // PJs
  "brillaEn", "secreto"
];

/** PNJs menores (reservas simplificadas). `equipo[]` son ids de firstlight.json. */
const MENOR = ["nombre", "concepto", "notas", "nota", "nombreToken", ...ESPECIALIDADES, "reservas{}"];

/** La Célula de FIRSTLIGHT (pnjs/cazadores.json → celula). */
const CELULA = ["nombre", "lema", "concepto", "descripcion", "notas", "propuesto[]"];

const VARIANTES = "variantes.*";

/** Reglas por archivo (ruta relativa a content/). Gana la primera que coincide. */
export const REGLAS = [
  { archivo: "pnjs/combate.json", colecciones: { ".": { tipo: "mapa", campos: ["."] } } },
  {
    archivo: /^pnjs\/[^/]+\.json$/,
    colecciones: {
      pnjs: { tipo: "lista", campos: FICHA },
      menores: { tipo: "lista", campos: MENOR },
      celula: { tipo: "unico", campos: CELULA }
    }
  },
  { archivo: "pjs.json", colecciones: { pjs: { tipo: "lista", campos: FICHA } } },
  // `niveles[]` son claves de nivel de mapa; `escenas`/`pnjs`, ids.
  { archivo: "lugares.json", colecciones: { lugares: { tipo: "lista", campos: ["nombre", "zona"] } } },
  {
    archivo: "pistas.json",
    colecciones: {
      // `obtencion[].tipo` es clave (TIPO_OBTENCION en journals.mjs).
      pistas: {
        tipo: "lista", campos: [
          "nombre", "texto", "nota", "ayuda", "nombres.*", VARIANTES,
          "obtencion[].como", "obtencion[].nota", "efectos[].efecto", "dados[].texto"
        ]
      },
      pruebas: { tipo: "lista", campos: ["nombre", "como", "efectos[].efecto", "valores[].texto"] },
      // `paths` son rutas de wod5e: no se tocan.
      tiradas: {
        tipo: "mapa", campos: [
          "nombre", "tirada", "automatico", "nota", VARIANTES, "oponente.texto",
          "resultados[].resultado", "resultados[].margen", "resultados[].efecto",
          "valores[].efecto", "otros[].motivo", "otros[].a",
          "votacion.necesita", "votacion.porDefecto", "votacion.automatico",
          "votacion.primogenitos[].defecto", "votacion.primogenitos[].cambia"
        ]
      }
    }
  },
  {
    archivo: "trackers.json",
    colecciones: {
      // `cantidad` («congelar»), `noche` («siguiente») y `jugadores: "inicio"` son claves.
      termometro: {
        tipo: "unico", campos: [
          "descripcion", "visibilidad",
          "umbrales[].texto", { ruta: "umbrales[].jugadores", excepto: ["inicio"] }, "umbrales[].ciudad",
          "umbrales[].nota", "umbrales[].variantes.*", "umbrales[].efectos[].texto",
          "sube[].motivo", "sube[].nota", "sube[].por", "sube[].variantes.*",
          "baja[].motivo", "baja[].nota", "baja[].por",
          "otros[].motivo", "otros[].nota", "otros[].alcance",
          "evitar[].motivo",
          "condiciones[].valor", "condiciones[].efecto", "condiciones[].nota", "condiciones[].variantes.*"
        ]
      },
      reloj: {
        tipo: "unico", campos: [
          "descripcion", "convencionFechas", "nota",
          "noches[].dia", "noches[].evento", "noches[].variantes.*",
          "noches[].horas[].hora", "noches[].horas[].evento", "noches[].horas[].dia", "noches[].horas[].nota", "noches[].horas[].variantes.*",
          "noches[].movimientos[].motivo",
          "variantes[].si", "variantes[].entonces",
          "versionDoc01[].evento"
        ]
      }
    }
  },
  {
    archivo: "coteries.json",
    colecciones: {
      coteries: {
        tipo: "lista", campos: [
          "nombre", "lema", "tipo", "tipoNota", "dominio", "descripcion",
          "trasfondos[]", "trasfondosDoc02[]", "alternativas[]", "dominioNotas.*", "propuesto[]", "notas"
        ]
      }
    }
  },
  {
    archivo: "firstlight.json",
    colecciones: {
      // `estado`, `tipo` y `bonos[].selectores` son claves. `tiradas[]` son marcadores @tirada.
      equipo: {
        tipo: "lista", campos: [
          "nombre", "efecto", "bonos[].a", "bonos[].condicion", "tiradas[]", "termometro.motivo"
        ]
      }
    }
  },
  {
    archivo: /^planos\/[^/]+\.json$/,
    colecciones: {
      // `sujeto` y `exterior` son prompts de arte (en inglés): no se tocan. `muebles[].desc` es el
      // nombre visible del tile en Foundry (escenas.mjs) y a veces está en castellano: se traduce
      // (los que ya están en inglés vuelven iguales; pintar-planos lee el castellano).
      planos: {
        tipo: "lista", campos: [
          "nombre", "nota",
          "habitaciones[].nombre", "exteriores[].nombre", "vanos[].nombre", "muebles[].nombre", "muebles[].desc",
          "luces[].nombre", "regiones[].nombre", "regiones[].pendiente", "figuras[].nota"
        ]
      }
    }
  },
  {
    archivo: "musica.json",
    colecciones: {
      // `clima` es la consigna para generar la pista: no se ve en Foundry.
      listas: { tipo: "lista", campos: ["nombre", "descripcion", "pistas[].nombre"] }
    }
  }
];

/** JSON de content/ que NO se traducen (textuales del doc 15: prompts de arte). */
export const NO_SE_TRADUCE = ["arte-doc15.json"];

/* -------------------------------------------- */
/*  Utilidades                                  */
/* -------------------------------------------- */

/** Huella de una unidad fuente: sha256, primeros 16 hex (TRADUCCION.md). */
export const huella = texto => crypto.createHash("sha256").update(texto, "utf8").digest("hex").slice(0, 16);

/** JSON canónico (claves en el orden en que vienen; es determinista para el mismo archivo). */
export const canonico = valor => JSON.stringify(valor);

/** La regla de un archivo (`pnjs/camarilla.json`, con `/`), o null si no se traduce. */
export function reglaDe(archivoRel) {
  const rel = archivoRel.replace(/\\/g, "/").replace(/^content\//, "");
  if (NO_SE_TRADUCE.includes(rel)) return null;
  return REGLAS.find(r => (typeof r.archivo === "string" ? r.archivo === rel : r.archivo.test(rel))) ?? null;
}

const esObjeto = v => v !== null && typeof v === "object" && !Array.isArray(v);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** «a.b[].c[1]» → [{clave:"a"},{clave:"b"},{todos:true},{clave:"c"},{indice:1}]. «x{}» → claves. */
function compilar(ruta) {
  if (ruta === ".") return [];
  const pasos = [];
  for (const seg of ruta.split(".")) {
    const m = /^([^[{]+)?((?:\[\d*\])*)(\{\})?$/.exec(seg);
    if (!m) throw new Error(`campos.mjs: patrón inválido «${ruta}»`);
    if (m[1]) pasos.push(m[1] === "*" ? { comodin: true } : { clave: m[1] });
    for (const [, n] of m[2].matchAll(/\[(\d*)\]/g)) pasos.push(n === "" ? { todos: true } : { indice: Number(n) });
    if (m[3]) pasos.push({ claves: true });
  }
  return pasos;
}

const CACHE = new Map();
function patron(def) {
  const d = typeof def === "string" ? { ruta: def } : def;
  if (!CACHE.has(d)) CACHE.set(d, { ...d, pasos: compilar(d.ruta) });
  return CACHE.get(d);
}

/**
 * Hojas de texto de `valor` que coinciden con el patrón: [{ ruta: [k|i…], texto }].
 * Para `{}`, la ruta termina en "_claves", <clave> y el texto es la clave.
 */
function hojas(valor, p) {
  const out = [];
  const ir = (v, i, ruta) => {
    if (i === p.pasos.length) {
      if (typeof v !== "string" || !v.trim()) return;
      if (p.excepto?.includes(v)) return;
      if (p.sinSlugs && SLUG.test(v)) return;
      out.push({ ruta, texto: v });
      return;
    }
    const paso = p.pasos[i];
    if (paso.clave !== undefined) { if (esObjeto(v) && paso.clave in v) ir(v[paso.clave], i + 1, [...ruta, paso.clave]); }
    else if (paso.comodin) { if (esObjeto(v)) for (const k of Object.keys(v)) ir(v[k], i + 1, [...ruta, k]); }
    else if (paso.todos) { if (Array.isArray(v)) v.forEach((x, k) => ir(x, i + 1, [...ruta, k])); }
    else if (paso.indice !== undefined) { if (Array.isArray(v) && paso.indice < v.length) ir(v[paso.indice], i + 1, [...ruta, paso.indice]); }
    else if (paso.claves) { if (esObjeto(v)) for (const k of Object.keys(v)) if (i + 1 === p.pasos.length) out.push({ ruta: [...ruta, "_claves", k], texto: k }); }
  };
  ir(valor, 0, []);
  return out;
}

/** Pone `texto` en la ruta, creando arrays para índices y objetos para claves. */
function poner(raiz, ruta, texto) {
  if (!ruta.length) return texto;
  let r = raiz ?? (typeof ruta[0] === "number" ? [] : {});
  let n = r;
  ruta.forEach((k, i) => {
    if (i === ruta.length - 1) { n[k] = texto; return; }
    if (n[k] == null) n[k] = typeof ruta[i + 1] === "number" ? [] : {};
    n = n[k];
  });
  return r;
}

/** Rellena los huecos de los arrays con null (JSON.stringify ya lo haría; así es explícito). */
function sinHuecos(v) {
  if (Array.isArray(v)) return Array.from(v, x => (x === undefined ? null : sinHuecos(x)));
  if (esObjeto(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sinHuecos(x)]));
  return v;
}

/* -------------------------------------------- */
/*  API                                         */
/* -------------------------------------------- */

/**
 * Entidades traducibles de un archivo:
 * [{ clave, coleccion, tipo, valor, campos }] en el orden del archivo.
 * `clave` es el id (o la clave del mapa, o el nombre de la colección `unico` sin id).
 */
export function entidades(archivoRel, json) {
  const regla = reglaDe(archivoRel);
  if (!regla) return [];
  const out = [];
  for (const [col, def] of Object.entries(regla.colecciones)) {
    const fuente = col === "." ? json : json?.[col];
    if (fuente == null) continue;
    if (def.tipo === "lista") {
      if (!Array.isArray(fuente)) throw new Error(`${archivoRel}: «${col}» no es una lista`);
      for (const e of fuente) {
        if (!e?.id) throw new Error(`${archivoRel}: un elemento de «${col}» no tiene id`);
        out.push({ clave: e.id, coleccion: col, tipo: def.tipo, valor: e, campos: def.campos });
      }
    } else if (def.tipo === "mapa") {
      for (const [k, v] of Object.entries(fuente)) {
        if (k.startsWith("_")) continue;
        out.push({ clave: k, coleccion: col, tipo: def.tipo, valor: v, campos: def.campos });
      }
    } else {
      out.push({ clave: fuente.id ?? col, coleccion: col, tipo: def.tipo, valor: fuente, campos: def.campos });
    }
  }
  const vistas = new Set();
  for (const e of out) {
    if (vistas.has(e.clave)) throw new Error(`${archivoRel}: la clave de entidad «${e.clave}» está repetida`);
    vistas.add(e.clave);
  }
  return out;
}

/** Sólo los campos de texto de una entidad, con su forma (o undefined si no tiene texto). */
export function camposDe(valor, campos) {
  let r;
  for (const def of campos) {
    for (const h of hojas(valor, patron(def))) r = poner(r, h.ruta, h.texto);
  }
  return r === undefined ? undefined : sinHuecos(r);
}

/**
 * `extraer(archivoRel, json)` → `{ <clave>: campos }`: lo que se manda a traducir.
 * Las entidades sin texto no aparecen.
 */
export function extraer(archivoRel, json) {
  const out = {};
  for (const e of entidades(archivoRel, json)) {
    const c = camposDe(e.valor, e.campos);
    if (c !== undefined) out[e.clave] = c;
  }
  return out;
}

/** Huella de cada entidad: la de sus campos de texto en castellano (cambiar un número no la toca). */
export function huellas(archivoRel, json) {
  return Object.fromEntries(Object.entries(extraer(archivoRel, json)).map(([k, c]) => [k, huella(canonico(c))]));
}

/**
 * Arma el archivo overlay con la forma del castellano a partir de las entidades
 * traducidas (`{ <clave>: campos en inglés }`) y sus huellas.
 */
export function armarOverlay(archivoRel, json, traducidas, fuentes) {
  const overlay = { _fuente: {} };
  for (const e of entidades(archivoRel, json)) {
    if (!(e.clave in traducidas)) continue;
    overlay._fuente[e.clave] = fuentes[e.clave];
    const t = traducidas[e.clave];
    if (e.coleccion === ".") overlay[e.clave] = t;
    else if (e.tipo === "unico") overlay[e.coleccion] = t;
    else (overlay[e.coleccion] ??= {})[e.clave] = t;
  }
  return overlay;
}

/**
 * Inverso de `armarOverlay`: `{ <clave>: campos }` de un overlay ya escrito.
 */
export function entidadesDelOverlay(archivoRel, json, overlay) {
  const out = {};
  for (const e of entidades(archivoRel, json)) {
    const v = e.coleccion === "." ? overlay?.[e.clave]
      : e.tipo === "unico" ? overlay?.[e.coleccion]
        : overlay?.[e.coleccion]?.[e.clave];
    if (v !== undefined) out[e.clave] = v;
  }
  return out;
}

/** Funde `ov` sobre `dst` (ya clonado). Devuelve el valor nuevo. */
function fundirValor(dst, ov) {
  if (ov === null || ov === undefined) return dst;
  if (typeof ov === "string") return typeof dst === "string" ? ov : dst;
  if (Array.isArray(dst) && esObjeto(ov)) {
    // Colección por id.
    for (const [id, sub] of Object.entries(ov)) {
      const i = dst.findIndex(x => x?.id === id);
      if (i >= 0) dst[i] = fundirValor(dst[i], sub);
    }
    return dst;
  }
  if (Array.isArray(dst) && Array.isArray(ov)) {
    ov.forEach((x, i) => { if (i < dst.length) dst[i] = fundirValor(dst[i], x); });
    return dst;
  }
  if (esObjeto(dst) && esObjeto(ov)) {
    for (const [k, x] of Object.entries(ov)) {
      if (k === "_fuente") continue;
      if (k === "_claves") continue;
      if (k in dst) dst[k] = fundirValor(dst[k], x);
    }
    if (esObjeto(ov._claves)) {
      const nuevo = {};
      for (const [k, v] of Object.entries(dst)) nuevo[typeof ov._claves[k] === "string" ? ov._claves[k] : k] = v;
      return nuevo;
    }
    return dst;
  }
  return dst;
}

/**
 * Planos: `escenas[].sala` y `salaLugar` nombran una habitación por su `nombre`.
 * Si el overlay tradujo las habitaciones, las referencias siguen al nombre nuevo.
 */
function remapearSalas(original, fundido) {
  const ir = (a, b) => {
    if (Array.isArray(a)) { a.forEach((x, i) => ir(x, b?.[i])); return; }
    if (!esObjeto(a) || !esObjeto(b)) return;
    if (Array.isArray(a.habitaciones) && Array.isArray(b.habitaciones)) {
      const mapa = new Map(a.habitaciones.map((h, i) => [h?.nombre, b.habitaciones[i]?.nombre]));
      if (typeof b.salaLugar === "string" && mapa.has(a.salaLugar)) b.salaLugar = mapa.get(a.salaLugar);
      (b.escenas ?? []).forEach((e, i) => {
        const s = a.escenas?.[i]?.sala;
        if (esObjeto(e) && mapa.has(s)) e.sala = mapa.get(s);
      });
    }
    for (const k of Object.keys(a)) if (typeof a[k] === "object") ir(a[k], b[k]);
  };
  ir(original, fundido);
}

/**
 * `fundir(json, overlay)` → copia del castellano con los textos del inglés encima.
 * Sólo reemplaza strings por strings: un overlay viejo o con basura no puede
 * pisar números, rutas ni ids. Lo que el overlay no trae queda en castellano.
 */
export function fundir(json, overlay) {
  const copia = structuredClone(json);
  if (!overlay) return copia;
  const fundido = fundirValor(copia, overlay);
  remapearSalas(json, fundido);
  return fundido;
}

/**
 * Compara la forma de los campos traducidos con la del castellano: mismas claves,
 * mismos largos de array, null en los mismos lugares y strings donde había strings.
 * Devuelve la lista de diferencias (vacía si coinciden).
 */
export function compararForma(es, en, ruta = "") {
  const errores = [];
  const ir = (a, b, r) => {
    if (typeof a === "string") { if (typeof b !== "string") errores.push(`${r || "."}: falta el texto`); return; }
    if (a === null) { if (b !== null && b !== undefined) errores.push(`${r}: tenía que ser null`); return; }
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) { errores.push(`${r}: tenía que ser un array`); return; }
      if (a.length !== b.length) errores.push(`${r}: ${b.length} elementos en vez de ${a.length}`);
      a.forEach((x, i) => ir(x, b[i], `${r}[${i}]`));
      return;
    }
    if (!esObjeto(b)) { errores.push(`${r}: tenía que ser un objeto`); return; }
    for (const k of Object.keys(a)) if (!(k in b)) errores.push(`${r}.${k}: falta`);
    for (const k of Object.keys(b)) if (!(k in a)) errores.push(`${r}.${k}: sobra`);
    for (const k of Object.keys(a)) if (k in b) ir(a[k], b[k], `${r}.${k}`);
  };
  ir(es, en, ruta);
  return errores;
}

/** Todas las hojas de texto de unos campos, con su ruta («.pnjs.convicciones[0]»), para validar marcadores. */
export function textos(v, r = "") {
  if (typeof v === "string") return [{ ruta: r || ".", texto: v }];
  if (Array.isArray(v)) return v.flatMap((x, i) => textos(x, `${r}[${i}]`));
  if (esObjeto(v)) return Object.entries(v).flatMap(([k, x]) => textos(x, `${r}.${k}`));
  return [];
}

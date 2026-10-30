/**
 * Utilidades compartidas por las herramientas de build.
 */
import fs from "node:fs";
import path from "node:path";

export const RAIZ = path.resolve(import.meta.dirname, "..");
export const MODULO = "seattle-by-night";
export const STATS = { coreVersion: "14.365", systemId: "wod5e", systemVersion: "5.3.28" };

const ALFABETO = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Hash determinista de 16 caracteres alfanuméricos, el formato que exige
 * Foundry. Reconstruir el contenido no cambia identidades, así que
 * reimportar no duplica documentos y los @UUID siguen apuntando bien.
 */
export function idEstable(semilla) {
  let h1 = 0x12345678, h2 = 0x9abcdef0;
  for (let i = 0; i < semilla.length; i++) {
    const c = semilla.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761) >>> 0;
    h2 = Math.imul(h2 + c, 1597334677) >>> 0;
  }
  let out = "";
  let a = h1, b = h2;
  for (let i = 0; i < 16; i++) {
    a = Math.imul(a ^ (b >>> 7), 2246822519) >>> 0;
    b = Math.imul(b ^ (a >>> 11), 3266489917) >>> 0;
    // `a ^ b` es int32 CON SIGNO: sin >>>0 el módulo sale negativo.
    out += ALFABETO[((a ^ b) >>> 0) % ALFABETO.length];
  }
  return out;
}

/** Slug ascii: minúsculas, sin acentos, guiones. */
export function slug(texto) {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Mismo criterio de nombre de archivo que `fvtt package unpack`. */
export const nombreArchivo = (nombre, id) =>
  `${nombre.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "")}_${id}.json`;

/** UUID de compendio de este módulo. */
export const uuid = (pack, tipo, id) => `Compendium.${MODULO}.${pack}.${tipo}.${id}`;
export const enlace = (pack, tipo, id, etiqueta) => `@UUID[${uuid(pack, tipo, id)}]{${etiqueta}}`;

/** Borra solo lo que generó el build, para no pisar lo que baje de Foundry con unpack. */
export function limpiarGenerados(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const p = path.join(dir, f);
    try {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      if (d.flags?.[MODULO]?.origen) fs.rmSync(p);
    } catch { /* lo dejamos */ }
  }
}

/** Escribe un documento de compendio en packs-src/<pack>/. */
export function escribirDoc(pack, doc) {
  const dir = path.join(RAIZ, "packs-src", pack);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, nombreArchivo(doc.name, doc._id)), JSON.stringify(doc, null, 2) + "\n");
}

/**
 * Carpetas dentro de un compendio. Están tipadas: una carpeta de Item no
 * puede contener JournalEntry. Se crean a demanda y se escriben al final.
 */
export class Carpetas {
  constructor(pack, tipo) {
    this.pack = pack;
    this.tipo = tipo;
    this.mapa = new Map();
  }

  // Solo la carpeta raíz lleva color: módulos como Monk's Enhanced Journal
  // tiñen con él el fondo de las entradas y los títulos dejan de leerse.
  id(nombre, padre = null, color = null) {
    if (!nombre) return null;
    const clave = `${padre ?? ""}/${nombre}`;
    if (!this.mapa.has(clave)) {
      this.mapa.set(clave, {
        _id: idEstable(`carpeta:${this.pack}:${clave}`),
        name: nombre,
        type: this.tipo,
        folder: padre ? this.id(padre) : null,
        sorting: "m",
        sort: this.mapa.size * 10,
        color,
        flags: { [MODULO]: { origen: "carpeta" } },
        _stats: STATS
      });
    }
    return this.mapa.get(clave)._id;
  }

  escribir() {
    for (const c of this.mapa.values()) {
      escribirDoc(this.pack, { ...c, _key: `!folders!${c._id}` });
    }
  }
}

export function leerJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, rel), "utf8"));
}

export function archivosMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return archivosMd(p);
      return e.name.endsWith(".md") ? [p] : [];
    })
    .sort();
}

export function separarFrontmatter(texto) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(texto);
  if (!m) return { meta: {}, cuerpo: texto };
  const meta = {};
  for (const linea of m[1].split("\n")) {
    const mm = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(linea);
    if (mm) meta[mm[1]] = mm[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, cuerpo: texto.slice(m[0].length) };
}

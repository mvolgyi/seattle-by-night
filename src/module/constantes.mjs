/**
 * Constantes del módulo.
 *
 * Este archivo no importa nada a propósito: es la hoja del grafo de módulos.
 * El id se repite en flags, settings, rutas de plantillas y clases CSS, y un
 * typo en el scope de un setFlag produce «Invalid scope for flag» sin otro
 * síntoma. Se define una sola vez acá.
 */
export class SBN {
  static ID = "seattle-by-night";

  /** Prefijo de clases CSS, flags e ids propios. */
  static PREFIJO = "sbn-";

  static FLAGS = {
    /** id de origen (PNJ-12, LUG-05, A2-E03…) dentro de los documentos de compendio. */
    ORIGEN: "origen"
  };

  static SETTINGS = {};

  /** Compendios del módulo, por nombre corto. Se completan en las fases 2–3. */
  static PACKS = {};

  static pack(nombre) {
    return game.packs.get(`${this.ID}.${nombre}`);
  }

  static ruta(rel) {
    return `modules/${this.ID}/${rel}`;
  }

  static log(...args) {
    if (CONFIG.debug?.[this.ID]) console.log(this.ID, "|", ...args);
  }
}

/**
 * Constantes del módulo.
 *
 * Este archivo no importa nada a propósito: es la hoja del grafo de módulos.
 * El id se repite en flags, settings, rutas de plantillas y clases CSS, y un
 * typo en el scope de un setFlag produce «Invalid scope for flag» sin otro
 * síntoma. Se define una sola vez acá.
 *
 * Acá van sólo datos estructurales (valores, ids de escena). Los textos
 * viven en lang/es.json: el módulo publicado no lleva content/.
 */
export class SBN {
  static ID = "seattle-by-night";

  /** Prefijo de clases CSS, flags e ids propios. */
  static PREFIJO = "sbn-";

  static FLAGS = {
    /** Qué constructor generó el documento (journal, actor, escena…). Lo llevan todos. */
    ORIGEN: "origen",
    /** id del libro (PNJ-12, LUG-05, A1-E01…) dentro de los documentos generados. */
    ID_LIBRO: "id",
    /** En la escena que se activa al importar la crónica por primera vez. */
    LANDING: "landing"
  };

  static SETTINGS = {
    /** { valor, congelado, registro: [{ fecha, cambio, motivo, usuario, valorAntes, valorDespues }] } */
    TERMOMETRO: "termometro",
    /** { "P-07": true, … } */
    PISTAS: "pistas",
    /** Noche actual del Reloj de Halloway (1–8). */
    NOCHE: "noche",
    /** Si ya se le ofreció al Narrador importar la crónica en este mundo. */
    IMPORTACION_OFRECIDA: "importacion-ofrecida",
    /** Última versión del módulo para la que se ofreció actualizar la crónica importada. */
    VERSION_OFRECIDA: "version-ofrecida",
    /** Cliente: si se muestra el indicador del Narrador. */
    INDICADOR: "indicador",
    /** Cliente: si el indicador está plegado. */
    INDICADOR_PLEGADO: "indicador-plegado"
  };

  /** Hook que se dispara en todos los clientes cuando cambia el estado de la crónica. */
  static HOOK_ESTADO = "sbnEstado";

  /** Compendios del módulo, por nombre corto (los de module.json). */
  static PACKS = {
    AVENTURA: "aventura",
    CRONICA: "cronica",
    DOCUMENTOS: "documentos",
    PERSONAJES: "personajes",
    ESCENAS: "escenas",
    FIRSTLIGHT: "firstlight",
    MACROS: "macros"
  };

  /** Termómetro de la Segunda Inquisición (content/trackers.json). */
  static TERMOMETRO = {
    INICIO: 2,
    MIN: 0,
    MAX: 10,
    /** Umbrales; el texto está en SBN.termometro.umbrales.<valor>. */
    UMBRALES: [
      { valor: 3 },
      { valor: 5, pnj: "PNJ-18" },
      { valor: 7 },
      { valor: 9, escena: "A4-E02" },
      { valor: 10, escena: "FIN-D" }
    ],
    /** Cuántas entradas del registro se conservan. */
    REGISTRO_MAX: 300
  };

  /** Reloj de Halloway: 8 noches, jueves 12 a jueves 19 de noviembre de 2026. */
  static RELOJ = {
    NOCHES: 8,
    /** Escena principal de cada noche; los textos en SBN.reloj.noches.<n>. */
    ESCENAS: { 1: "A0-E01", 2: "A1-E02", 3: "A2-E01", 4: "A2-E02", 5: "A2-E06", 6: "A3-E01", 7: "A3-E04", 8: "A4-E01" }
  };

  /** Pistas P-01…P-15 (content/pistas.json); el nombre en SBN.pistas.nombres.<id>. */
  static PISTAS = Array.from({ length: 15 }, (_, i) => `P-${String(i + 1).padStart(2, "0")}`);

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

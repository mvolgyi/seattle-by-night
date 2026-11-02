/**
 * Constantes del módulo.
 *
 * Este archivo no importa nada a propósito: es la hoja del grafo de módulos.
 * El id se repite en flags, settings, rutas de plantillas y clases CSS, y un
 * typo en el scope de un setFlag produce «Invalid scope for flag» sin otro
 * síntoma. Se define una sola vez acá.
 *
 * Acá van sólo ids, settings y rutas. Los datos de la crónica (umbrales,
 * noches, pistas, tiradas) están en data/cronica.json (datos.mjs) y los
 * textos de la interfaz en lang/es.json: el módulo publicado no lleva content/.
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
    LANDING: "landing",
    /**
     * En los susurros al Narrador: las claves del aviso (`{ tipo: "umbral", valor: 3, sube: true }`).
     * El texto lo arma cada GM al renderizar; el mensaje, que llega a todos los clientes, no lo lleva.
     */
    AVISO: "aviso"
  };

  static SETTINGS = {
    /**
     * { valor, congelado, registro: [{ fecha, cambio, usuario, valorAntes, valorDespues, s? }] };
     * `s`: motivo, movimiento y noche, sellados (util.sellar). Estado los abre en el GM.
     */
    TERMOMETRO: "termometro",
    /** { "P-07": true, … } */
    PISTAS: "pistas",
    /** Noche actual del Reloj de Halloway (1–8). */
    NOCHE: "noche",
    /** Pruebas sin ID marcadas y casillas de mesa de las tiradas clave: { s: sello de { "PRUEBA-…": true } } */
    PRUEBAS: "pruebas",
    /** Votación del Consejo (A4-E01): { s: sello de { "PNJ-15": "no", … } }; lo que falta, el voto por defecto. */
    VOTOS: "votos",
    /** Si ya se le ofreció al Narrador importar la crónica en este mundo. */
    IMPORTACION_OFRECIDA: "importacion-ofrecida",
    /** Última versión del módulo para la que se ofreció actualizar la crónica importada. */
    VERSION_OFRECIDA: "version-ofrecida",
    /** Cliente: si se muestra el indicador del Narrador. */
    INDICADOR: "indicador",
    /** Cliente: si el indicador está plegado. */
    INDICADOR_PLEGADO: "indicador-plegado",
    /** Cliente del GM: aclarar la oscuridad de la escena cuando no mira por un token (vision.mjs). */
    VISTA_NARRADOR: "vista-narrador",
    /** Idioma de la crónica importada en el mundo: "es", "en" o "" (todavía no se eligió). idioma.mjs. */
    IDIOMA: "sbn-idioma-cronica"
  };

  /** Hook que se dispara en todos los clientes cuando cambia el estado de la crónica. */
  static HOOK_ESTADO = "sbnEstado";

  /** Hook que se dispara en todos los clientes cuando cambia el idioma de la crónica (con el idioma nuevo). */
  static HOOK_IDIOMA = "sbnIdioma";

  /**
   * Compendios del módulo, por nombre corto (los de module.json). Cada uno
   * tiene su gemelo en inglés con sufijo «-en» (idioma.mjs#packDe).
   */
  static PACKS = {
    AVENTURA: "aventura",
    CRONICA: "cronica",
    DOCUMENTOS: "documentos",
    PERSONAJES: "personajes",
    ESCENAS: "escenas",
    FIRSTLIGHT: "firstlight",
    MACROS: "macros"
  };

  /**
   * Datos de la crónica para el tiempo de juego (umbrales, noches, pistas,
   * tiradas): los genera tools/contenido/datos.mjs desde content/ y los lee
   * datos.mjs. Acá no se repiten. En inglés, los mismos en data/en/.
   */
  static DATOS = "data/cronica.json";

  /**
   * Lo que carga un jugador en vez de DATOS: nombres de pistas, fecha de cada
   * noche y lo que perciben los jugadores en cada umbral. data/cronica.json
   * tiene la crónica entera (qué pasa, quién, dónde): sólo la pide un GM.
   */
  static DATOS_PUBLICO = "data/publico.json";

  /** Cuántas entradas del registro del Termómetro se conservan. */
  static REGISTRO_MAX = 300;

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

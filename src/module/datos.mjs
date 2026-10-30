import { SBN } from "./constantes.mjs";

/**
 * Datos de la crónica para el tiempo de juego: data/cronica.json, que genera
 * tools/contenido/datos.mjs desde content/trackers.json y content/pistas.json.
 * Un jugador carga data/publico.json (el subconjunto que la mesa ya ve: ver
 * CONTRATO.md); el resto de los campos le quedan vacíos.
 *
 * Es la única copia en el módulo de los umbrales del Termómetro, las noches
 * del Reloj, las pistas y las tiradas clave (antes estaban repetidos a mano
 * en constantes.mjs y lang/es.json). Se pide con fetch en `init` y se espera
 * en `ready`; hasta entonces (o si el archivo no carga) se usan valores
 * vacíos con los topes del Termómetro, para que nada reviente.
 */

/** Lo mínimo para que el módulo funcione sin el archivo (y lo avise). */
const VACIO = {
  termometro: { inicio: 2, min: 0, max: 10, umbrales: [], movimientos: [], evitar: [], condiciones: [] },
  reloj: { noches: [], variantes: [] },
  pistas: [],
  pruebas: [],
  tiradas: {},
  uuids: {},
  actores: {}
};

export class Datos {
  static #datos = VACIO;
  static #carga = null;
  static #pistas = new Map();
  static #pruebas = new Map();
  static #noches = new Map();
  /** Si el archivo no cargó: el error, para mostrarlo al Narrador en `ready`. */
  static error = null;

  /**
   * Pide los datos (una sola vez): data/cronica.json si el usuario es GM,
   * data/publico.json si no. Necesita game.user: se llama desde `setup`.
   */
  static cargar() {
    if (!game.user) return Promise.resolve();
    const archivo = this.archivo;
    this.#carga ??= foundry.utils.fetchJsonWithTimeout(SBN.ruta(archivo))
      .then(json => this.#poner(json))
      .catch(err => {
        this.error = err;
        console.error(`${SBN.ID} | no pude cargar ${archivo}:`, err);
      });
    return this.#carga;
  }

  /** Qué archivo le toca a este usuario. */
  static get archivo() {
    return game.user?.isGM ? SBN.DATOS : SBN.DATOS_PUBLICO;
  }

  /** ¿Son los datos públicos (cliente de jugador)? */
  static get publicos() {
    return !!this.#datos.publico;
  }

  static #poner(json) {
    const d = foundry.utils.mergeObject(foundry.utils.deepClone(VACIO), json ?? {}, { inplace: false });
    d.termometro.umbrales = [...(d.termometro.umbrales ?? [])].sort((a, b) => a.valor - b.valor);
    this.#datos = d;
    this.#pistas = new Map(d.pistas.map(p => [p.id, p]));
    this.#pruebas = new Map(d.pruebas.map(p => [p.id, p]));
    this.#noches = new Map(d.reloj.noches.map(n => [Number(n.n), n]));
  }

  static get listos() {
    return this.#datos !== VACIO;
  }

  /* -------------------------------------------- */
  /*  Termómetro                                  */
  /* -------------------------------------------- */

  /** { inicio, min, max, umbrales[], movimientos[], evitar[], condiciones[] } */
  static get termometro() {
    return this.#datos.termometro;
  }

  static get umbrales() {
    return this.#datos.termometro.umbrales;
  }

  static umbral(valor) {
    return this.umbrales.find(u => u.valor === Number(valor)) ?? null;
  }

  static get movimientos() {
    return this.#datos.termometro.movimientos;
  }

  static movimiento(id) {
    return this.movimientos.find(m => m.id === id) ?? null;
  }

  /* -------------------------------------------- */
  /*  Reloj                                       */
  /* -------------------------------------------- */

  static get noches() {
    return this.#datos.reloj.noches;
  }

  /** Cuántas noches tiene el Reloj (8; 1 si los datos no cargaron, para que noche(1) valga). */
  static get totalNoches() {
    return this.noches.length || 1;
  }

  static noche(n) {
    return this.#noches.get(Number(n)) ?? null;
  }

  /** «Si la coterie… entonces…»: cómo cambia el Reloj según lo que haga la mesa. */
  static get variantesReloj() {
    return this.#datos.reloj.variantes ?? [];
  }

  /* -------------------------------------------- */
  /*  Pistas, pruebas y tiradas                   */
  /* -------------------------------------------- */

  static get pistas() {
    return this.#datos.pistas;
  }

  static pista(id) {
    return this.#pistas.get(id) ?? null;
  }

  static get pruebas() {
    return this.#datos.pruebas;
  }

  static prueba(id) {
    return this.#pruebas.get(id) ?? null;
  }

  static tirada(id) {
    return this.#datos.tiradas[id] ?? null;
  }

  /* -------------------------------------------- */
  /*  IDs del libro                               */
  /* -------------------------------------------- */

  /** { uuid, nombre, tipo } del documento de MUNDO que corresponde a un ID del libro. */
  static ref(id) {
    return this.#datos.uuids[id] ?? null;
  }

  /** UUID del actor de un PNJ/PJ con ficha (para tirar con él). */
  static actor(id) {
    return this.#datos.actores[id] ?? null;
  }

  /** Nombre legible de un ID del libro: pista, prueba, o lo que diga el registro. */
  static nombre(id) {
    return this.pista(id)?.nombre ?? this.prueba(id)?.nombre ?? this.ref(id)?.nombre ?? id;
  }
}

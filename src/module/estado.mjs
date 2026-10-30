import { SBN } from "./constantes.mjs";
import { Datos } from "./datos.mjs";
import { t, esc, exigirNarrador, susurrarNarrador, enlaceDelLibro } from "./util.mjs";

const { SETTINGS } = SBN;

/**
 * Estado de la crónica: Termómetro de la Segunda Inquisición, pistas
 * obtenidas, noche del Reloj de Halloway, y (para el Panel del Narrador)
 * pruebas sin ID marcadas y la votación del Consejo.
 *
 * Vive en settings de mundo (config false). Los datos fijos (umbrales,
 * noches, pistas) vienen de data/cronica.json (datos.mjs). Sólo el Narrador escribe;
 * cada escritura susurra un mensaje a los Narradores y, en todos los
 * clientes, dispara `Hooks.callAll("sbnEstado", estado, detalle)` desde el
 * onChange del setting (el detalle viaja en las opciones de la actualización).
 */
export class Estado {
  /** Las escrituras se encolan: dos clics seguidos no se pisan el valor. */
  static #cola = Promise.resolve();

  static registrarSettings() {
    const alCambiar = clave => (_valor, opciones = {}) => {
      Hooks.callAll(SBN.HOOK_ESTADO, this.estado(), opciones?.sbn ?? { clave });
    };
    game.settings.register(SBN.ID, SETTINGS.TERMOMETRO, {
      scope: "world",
      config: false,
      type: Object,
      // Sin valor: hasta el primer movimiento vale el `inicio` de data/cronica.json.
      default: { valor: null, congelado: false, registro: [] },
      onChange: alCambiar(SETTINGS.TERMOMETRO)
    });
    game.settings.register(SBN.ID, SETTINGS.PISTAS, {
      scope: "world",
      config: false,
      type: Object,
      default: {},
      onChange: alCambiar(SETTINGS.PISTAS)
    });
    game.settings.register(SBN.ID, SETTINGS.NOCHE, {
      scope: "world",
      config: false,
      type: Number,
      default: 1,
      onChange: alCambiar(SETTINGS.NOCHE)
    });
    game.settings.register(SBN.ID, SETTINGS.PRUEBAS, {
      scope: "world",
      config: false,
      type: Object,
      default: {},
      onChange: alCambiar(SETTINGS.PRUEBAS)
    });
    game.settings.register(SBN.ID, SETTINGS.VOTOS, {
      scope: "world",
      config: false,
      type: Object,
      default: {},
      onChange: alCambiar(SETTINGS.VOTOS)
    });
  }

  /* -------------------------------------------- */
  /*  Lectura                                     */
  /* -------------------------------------------- */

  static get termometroActual() {
    const d = game.settings.get(SBN.ID, SETTINGS.TERMOMETRO) ?? {};
    return {
      valor: Number.isFinite(d.valor) ? d.valor : Datos.termometro.inicio,
      congelado: !!d.congelado,
      registro: Array.isArray(d.registro) ? d.registro : []
    };
  }

  static get pistasActuales() {
    return { ...(game.settings.get(SBN.ID, SETTINGS.PISTAS) ?? {}) };
  }

  static get nocheActual() {
    const n = Number(game.settings.get(SBN.ID, SETTINGS.NOCHE));
    return Math.clamp(Number.isFinite(n) ? n : 1, 1, Datos.totalNoches);
  }

  static get pruebasActuales() {
    return { ...(game.settings.get(SBN.ID, SETTINGS.PRUEBAS) ?? {}) };
  }

  /** Votos de la votación del Consejo, con el voto por defecto donde el Narrador no tocó nada. */
  static get votosActuales() {
    const guardados = game.settings.get(SBN.ID, SETTINGS.VOTOS) ?? {};
    const out = {};
    for (const p of Datos.tirada("A4-E01")?.votacion?.primogenitos ?? []) out[p.pnj] = guardados[p.pnj] ?? p.voto;
    return out;
  }

  static obtenida(id) {
    return !!this.pistasActuales[id];
  }

  static marcada(id) {
    return !!this.pruebasActuales[id];
  }

  /** Copia del estado completo: `{ termometro, pistas, noche, pruebas, votos }`. */
  static estado() {
    return foundry.utils.deepClone({
      termometro: this.termometroActual,
      pistas: this.pistasActuales,
      noche: this.nocheActual,
      pruebas: this.pruebasActuales,
      votos: this.votosActuales
    });
  }

  /** Umbral de mayor valor alcanzado (o null por debajo del primero). */
  static umbralDe(valor) {
    return Datos.umbrales.filter(u => u.valor <= valor).at(-1) ?? null;
  }

  /** Campo de un umbral: texto, ciudad, jugadores, icono. */
  static textoUmbral(valor, campo = "texto") {
    return Datos.umbral(valor)?.[campo] ?? "";
  }

  static nombrePista(id) {
    return Datos.pista(id)?.nombre ?? id;
  }

  /** Campo de una noche del Reloj: dia, fecha, evento. */
  static textoNoche(n, campo = "dia") {
    return Datos.noche(n)?.[campo] ?? "";
  }

  /* -------------------------------------------- */
  /*  Escritura                                   */
  /* -------------------------------------------- */

  static #encolar(fn) {
    const p = this.#cola.then(fn);
    this.#cola = p.catch(() => {});
    return p;
  }

  /**
   * Mueve el Termómetro.
   * @param {number|string} cambio  +1, −2, "+1", "=10", "congelar" o "descongelar".
   * @param {string} [motivo]
   * @param {object} [opciones]
   * @param {string} [opciones.movimiento]  id del movimiento de data/cronica.json (los
   *   botones rápidos del panel): queda en el registro, con la noche, para contar los topes.
   * @returns {Promise<object|null>} el Termómetro resultante, o null si no se pudo.
   */
  static termometro(cambio, motivo = "", opciones = {}) {
    if (!exigirNarrador()) return Promise.resolve(null);
    return this.#encolar(() => this.#termometro(cambio, motivo, opciones ?? {}));
  }

  static async #termometro(cambio, motivo, { movimiento } = {}) {
    const { min, max } = Datos.termometro;
    const actual = this.termometroActual;
    const antes = actual.valor;
    const texto = String(cambio ?? "").trim().toLowerCase();
    motivo = String(motivo ?? "").trim();
    let despues = antes;
    let congelado = actual.congelado;
    let etiqueta;

    if (texto === "congelar" || texto === "descongelar") {
      congelado = texto === "congelar";
      if (congelado === actual.congelado) {
        ui.notifications.info(t(congelado ? "termometro.yaCongelado" : "termometro.yaDescongelado"));
        return actual;
      }
      etiqueta = texto;
    } else {
      const fijar = /^=\s*(-?\d+)$/.exec(texto);
      const delta = fijar ? null : Number(texto.replace(/^\+/, "").replace("−", "-"));
      if (!fijar && (!Number.isFinite(delta) || texto === "")) {
        ui.notifications.error(t("termometro.cambioInvalido", { cambio: String(cambio) }));
        return null;
      }
      if (actual.congelado) {
        ui.notifications.warn(t("termometro.estaCongelado"));
        return null;
      }
      despues = Math.clamp(fijar ? Number(fijar[1]) : antes + delta, min, max);
      etiqueta = fijar ? `=${despues}` : (delta > 0 ? `+${delta}` : String(delta));
      if (despues === antes) {
        ui.notifications.info(t("termometro.sinCambio", { valor: antes }));
        return actual;
      }
    }

    const entrada = {
      fecha: new Date().toISOString(),
      cambio: etiqueta,
      motivo,
      usuario: game.user.name,
      valorAntes: antes,
      valorDespues: despues
    };
    if (movimiento) Object.assign(entrada, { movimiento: String(movimiento), noche: this.nocheActual });
    const registro = [...actual.registro, entrada].slice(-SBN.REGISTRO_MAX);
    const nuevo = { valor: despues, congelado, registro };
    await game.settings.set(SBN.ID, SETTINGS.TERMOMETRO, nuevo, {
      sbn: { clave: SETTINGS.TERMOMETRO, ...entrada }
    });

    await this.#publicarTermometro(entrada);
    await this.#avisarUmbrales(antes, despues);
    return foundry.utils.deepClone(nuevo);
  }

  static async #publicarTermometro({ cambio, motivo, valorAntes, valorDespues }) {
    let titulo, cuerpo;
    if (cambio === "congelar" || cambio === "descongelar") {
      titulo = t(`termometro.chat.${cambio}`);
      cuerpo = `<p>${t("termometro.chat.valor", { valor: valorDespues })}</p>`;
    } else {
      titulo = t("termometro.chat.titulo", { antes: valorAntes, despues: valorDespues, cambio });
      cuerpo = `<div class="sbn-chat-escala">${this.#escala(valorDespues)}</div>`;
    }
    if (motivo) cuerpo += `<p class="sbn-chat-motivo">${esc(motivo)}</p>`;
    return susurrarNarrador(cuerpo, { titulo, clase: "sbn-chat-termometro" });
  }

  /** Diez segmentos, los encendidos hasta el valor, los umbrales marcados. */
  static #escala(valor) {
    const umbrales = new Set(Datos.umbrales.map(u => u.valor));
    let html = "";
    for (let i = 1; i <= Datos.termometro.max; i++) {
      const cls = ["sbn-seg", i <= valor ? "sbn-on" : "", umbrales.has(i) ? "sbn-umbral" : ""].filter(Boolean).join(" ");
      html += `<span class="${cls}"></span>`;
    }
    return html;
  }

  /** Umbrales que se cruzan al pasar de `antes` a `despues` (subiendo o bajando). */
  static cruzados(antes, despues) {
    const sube = despues > antes;
    return Datos.umbrales.filter(u => sube
      ? (u.valor > antes && u.valor <= despues)
      : (u.valor <= antes && u.valor > despues));
  }

  /**
   * Aviso emergente de cada umbral cruzado al subir. Lo llama el hook
   * `sbnEstado` en el cliente de CADA GM (main.mjs): el detalle del cambio
   * viaja en las opciones del setting, así que lo ven todos, no sólo el que
   * apretó el botón.
   */
  static notificarUmbrales(detalle) {
    if (detalle?.clave !== SETTINGS.TERMOMETRO) return;
    const { valorAntes: antes, valorDespues: despues } = detalle;
    if (!Number.isFinite(antes) || !Number.isFinite(despues) || despues <= antes) return;
    for (const u of this.cruzados(antes, despues)) {
      const icono = this.textoUmbral(u.valor, "icono");
      ui.notifications.warn(t("termometro.umbral.aviso", { icono, valor: u.valor, texto: this.textoUmbral(u.valor) }), { permanent: u.valor >= 9 });
    }
  }

  /** Al subir, un susurro por cada umbral cruzado; al bajar, una línea por cada uno que se deja atrás. */
  static async #avisarUmbrales(antes, despues) {
    const sube = despues > antes;
    for (const u of this.cruzados(antes, despues)) {
      const icono = this.textoUmbral(u.valor, "icono");
      if (sube) {
        const titulo = t("termometro.umbral.titulo", { icono, valor: u.valor, texto: this.textoUmbral(u.valor) });
        let cuerpo = `<p>${esc(this.textoUmbral(u.valor, "ciudad"))}</p>`;
        cuerpo += `<p class="sbn-chat-jugadores">${t("termometro.umbral.jugadores", { texto: esc(this.textoUmbral(u.valor, "jugadores")) })}</p>`;
        if (u.escena) cuerpo += `<p>${t("termometro.umbral.escena", { enlace: enlaceDelLibro(u.escena) })}</p>`;
        if (u.pnj) cuerpo += `<p>${t("termometro.umbral.pnj", { enlace: enlaceDelLibro(u.pnj) })}</p>`;
        await susurrarNarrador(cuerpo, { titulo, clase: "sbn-chat-umbral" });
      } else {
        await susurrarNarrador(`<p>${esc(this.textoUmbral(u.valor))}</p>`, {
          titulo: t("termometro.umbral.baja", { icono, valor: u.valor }), clase: "sbn-chat-umbral sbn-chat-baja"
        });
      }
    }
  }

  /**
   * Marca (o desmarca) una pista.
   * @param {string} id  P-01…P-15
   * @param {boolean} [obtenida=true]
   */
  static pista(id, obtenida = true) {
    if (!exigirNarrador()) return Promise.resolve(null);
    return this.#encolar(() => this.#pista(id, obtenida));
  }

  static async #pista(id, obtenida) {
    id = String(id ?? "").trim().toUpperCase();
    if (!Datos.pista(id)) {
      ui.notifications.error(t("pistas.invalida", { id }));
      return null;
    }
    obtenida = obtenida !== false;
    const pistas = this.pistasActuales;
    if (!!pistas[id] === obtenida) return pistas;
    if (obtenida) pistas[id] = true;
    else delete pistas[id];
    // Un Object setting se reemplaza entero: la clave borrada desaparece.
    await game.settings.set(SBN.ID, SETTINGS.PISTAS, pistas, {
      sbn: { clave: SETTINGS.PISTAS, id, obtenida, usuario: game.user.name }
    });
    const n = Object.keys(pistas).length;
    await susurrarNarrador(
      `<p>${enlaceDelLibro(id, `${id} · ${this.nombrePista(id)}`)}</p><p class="sbn-chat-motivo">${t("pistas.chat.cuenta", { n, total: Datos.pistas.length })}</p>`,
      { titulo: t(obtenida ? "pistas.chat.obtenida" : "pistas.chat.perdida"), clase: "sbn-chat-pista" }
    );
    return { ...pistas };
  }

  /**
   * Fija la noche actual del Reloj de Halloway.
   * @param {number} n  1–8
   */
  static noche(n) {
    if (!exigirNarrador()) return Promise.resolve(null);
    return this.#encolar(() => this.#noche(n));
  }

  static async #noche(n) {
    n = Number(n);
    if (!Number.isInteger(n) || n < 1 || n > Datos.totalNoches) {
      ui.notifications.error(t("reloj.invalida", { n: String(n), max: Datos.totalNoches }));
      return null;
    }
    const antes = this.nocheActual;
    if (n === antes) return n;
    await game.settings.set(SBN.ID, SETTINGS.NOCHE, n, {
      sbn: { clave: SETTINGS.NOCHE, antes, noche: n, usuario: game.user.name }
    });
    const escena = Datos.noche(n)?.escena;
    let cuerpo = `<p>${esc(this.textoNoche(n, "evento"))}</p>`;
    if (escena) cuerpo += `<p>${t("reloj.chat.escena", { enlace: enlaceDelLibro(escena) })}</p>`;
    await susurrarNarrador(cuerpo, {
      titulo: t("reloj.chat.titulo", { n, dia: this.textoNoche(n, "dia") }), clase: "sbn-chat-reloj"
    });
    return n;
  }

  /**
   * Marca (o desmarca) una prueba sin ID de pista (data/cronica.json → pruebas)
   * o una casilla de mesa de las tiradas clave (A4-E01-OTRO-EL-CONSEJO-SE-TRASLADA-A-LA, la Galería de Vidrio).
   * No susurra nada: es una casilla del panel, no un hallazgo de la mesa.
   */
  static prueba(id, marcada = true) {
    if (!exigirNarrador()) return Promise.resolve(null);
    return this.#encolar(() => this.#prueba(id, marcada));
  }

  static async #prueba(id, marcada) {
    id = String(id ?? "").trim();
    const otros = Datos.tirada("A4-E01")?.otros ?? [];
    if (!Datos.prueba(id) && !otros.some(o => o.id === id)) {
      ui.notifications.error(t("pruebas.invalida", { id }));
      return null;
    }
    marcada = marcada !== false;
    const pruebas = this.pruebasActuales;
    if (!!pruebas[id] === marcada) return pruebas;
    if (marcada) pruebas[id] = true;
    else delete pruebas[id];
    await game.settings.set(SBN.ID, SETTINGS.PRUEBAS, pruebas, {
      sbn: { clave: SETTINGS.PRUEBAS, id, marcada, usuario: game.user.name }
    });
    return { ...pruebas };
  }

  /**
   * Voto de un Primogénito en el Consejo (A4-E01).
   * @param {string} pnj  PNJ-03, PNJ-13…
   * @param {"si"|"no"|"abstencion"|"azar"} voto
   */
  static voto(pnj, voto) {
    if (!exigirNarrador()) return Promise.resolve(null);
    return this.#encolar(async () => {
      const validos = ["si", "no", "abstencion", "azar"];
      const existe = (Datos.tirada("A4-E01")?.votacion?.primogenitos ?? []).some(p => p.pnj === pnj);
      if (!existe || !validos.includes(voto)) {
        ui.notifications.error(t("votacion.invalido", { pnj: String(pnj), voto: String(voto) }));
        return null;
      }
      const votos = { ...(game.settings.get(SBN.ID, SETTINGS.VOTOS) ?? {}), [pnj]: voto };
      await game.settings.set(SBN.ID, SETTINGS.VOTOS, votos, { sbn: { clave: SETTINGS.VOTOS, pnj, voto } });
      return this.votosActuales;
    });
  }
}

import { SBN } from "./constantes.mjs";
import { t, esc, exigirNarrador, susurrarNarrador, enlaceDelLibro } from "./util.mjs";

const { TERMOMETRO, RELOJ, SETTINGS } = SBN;

/**
 * Estado de la crónica: Termómetro de la Segunda Inquisición, pistas
 * obtenidas y noche del Reloj de Halloway.
 *
 * Vive en tres settings de mundo (config false). Sólo el Narrador escribe;
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
      default: { valor: TERMOMETRO.INICIO, congelado: false, registro: [] },
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
  }

  /* -------------------------------------------- */
  /*  Lectura                                     */
  /* -------------------------------------------- */

  static get termometroActual() {
    const d = game.settings.get(SBN.ID, SETTINGS.TERMOMETRO) ?? {};
    return {
      valor: Number.isFinite(d.valor) ? d.valor : TERMOMETRO.INICIO,
      congelado: !!d.congelado,
      registro: Array.isArray(d.registro) ? d.registro : []
    };
  }

  static get pistasActuales() {
    return { ...(game.settings.get(SBN.ID, SETTINGS.PISTAS) ?? {}) };
  }

  static get nocheActual() {
    const n = Number(game.settings.get(SBN.ID, SETTINGS.NOCHE));
    return Math.clamp(Number.isFinite(n) ? n : 1, 1, RELOJ.NOCHES);
  }

  static obtenida(id) {
    return !!this.pistasActuales[id];
  }

  /** Copia del estado completo: `{ termometro, pistas, noche }`. */
  static estado() {
    return foundry.utils.deepClone({
      termometro: this.termometroActual,
      pistas: this.pistasActuales,
      noche: this.nocheActual
    });
  }

  /** Umbral de mayor valor alcanzado (o null por debajo de 3). */
  static umbralDe(valor) {
    return TERMOMETRO.UMBRALES.filter(u => u.valor <= valor).at(-1) ?? null;
  }

  static textoUmbral(valor, campo = "texto") {
    return t(`termometro.umbrales.${valor}.${campo}`);
  }

  static nombrePista(id) {
    const k = `SBN.pistas.nombres.${id}`;
    return game.i18n.has(k) ? game.i18n.localize(k) : id;
  }

  static textoNoche(n, campo = "dia") {
    return t(`reloj.noches.${n}.${campo}`);
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
   * @returns {Promise<object|null>} el Termómetro resultante, o null si no se pudo.
   */
  static termometro(cambio, motivo = "") {
    if (!exigirNarrador()) return Promise.resolve(null);
    return this.#encolar(() => this.#termometro(cambio, motivo));
  }

  static async #termometro(cambio, motivo) {
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
      despues = Math.clamp(fijar ? Number(fijar[1]) : antes + delta, TERMOMETRO.MIN, TERMOMETRO.MAX);
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
    const registro = [...actual.registro, entrada].slice(-TERMOMETRO.REGISTRO_MAX);
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
    const umbrales = new Set(TERMOMETRO.UMBRALES.map(u => u.valor));
    let html = "";
    for (let i = 1; i <= TERMOMETRO.MAX; i++) {
      const cls = ["sbn-seg", i <= valor ? "sbn-on" : "", umbrales.has(i) ? "sbn-umbral" : ""].filter(Boolean).join(" ");
      html += `<span class="${cls}"></span>`;
    }
    return html;
  }

  /** Al subir, un aviso por cada umbral cruzado; al bajar, una línea por cada uno que se deja atrás. */
  static async #avisarUmbrales(antes, despues) {
    const sube = despues > antes;
    const cruzados = TERMOMETRO.UMBRALES.filter(u => sube
      ? (u.valor > antes && u.valor <= despues)
      : (u.valor <= antes && u.valor > despues));
    for (const u of cruzados) {
      const icono = this.textoUmbral(u.valor, "icono");
      if (sube) {
        const titulo = t("termometro.umbral.titulo", { icono, valor: u.valor, texto: this.textoUmbral(u.valor) });
        let cuerpo = `<p>${esc(this.textoUmbral(u.valor, "ciudad"))}</p>`;
        cuerpo += `<p class="sbn-chat-jugadores">${t("termometro.umbral.jugadores", { texto: esc(this.textoUmbral(u.valor, "jugadores")) })}</p>`;
        if (u.escena) cuerpo += `<p>${t("termometro.umbral.escena", { enlace: enlaceDelLibro(u.escena) })}</p>`;
        if (u.pnj) cuerpo += `<p>${t("termometro.umbral.pnj", { enlace: enlaceDelLibro(u.pnj) })}</p>`;
        ui.notifications.warn(t("termometro.umbral.aviso", { icono, valor: u.valor, texto: this.textoUmbral(u.valor) }), { permanent: u.valor >= 9 });
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
    if (!SBN.PISTAS.includes(id)) {
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
      `<p>${enlaceDelLibro(id, `${id} · ${this.nombrePista(id)}`)}</p><p class="sbn-chat-motivo">${t("pistas.chat.cuenta", { n, total: SBN.PISTAS.length })}</p>`,
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
    if (!Number.isInteger(n) || n < 1 || n > RELOJ.NOCHES) {
      ui.notifications.error(t("reloj.invalida", { n: String(n), max: RELOJ.NOCHES }));
      return null;
    }
    const antes = this.nocheActual;
    if (n === antes) return n;
    await game.settings.set(SBN.ID, SETTINGS.NOCHE, n, {
      sbn: { clave: SETTINGS.NOCHE, antes, noche: n, usuario: game.user.name }
    });
    const escena = RELOJ.ESCENAS[n];
    let cuerpo = `<p>${esc(this.textoNoche(n, "evento"))}</p>`;
    if (escena) cuerpo += `<p>${t("reloj.chat.escena", { enlace: enlaceDelLibro(escena) })}</p>`;
    await susurrarNarrador(cuerpo, {
      titulo: t("reloj.chat.titulo", { n, dia: this.textoNoche(n, "dia") }), clase: "sbn-chat-reloj"
    });
    return n;
  }
}

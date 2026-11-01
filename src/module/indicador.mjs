import { SBN } from "./constantes.mjs";
import { Estado } from "./estado.mjs";
import { Datos } from "./datos.mjs";
import { Panel } from "./panel.mjs";
import { t, esc } from "./util.mjs";

const { ApplicationV2 } = foundry.applications.api;

/**
 * Indicador del Narrador: una barrita sobre la hotbar con el Termómetro y la
 * noche del Reloj, con +/−. Plegable a una píldora. No es el Panel del
 * Narrador: sólo lo justo para no tener que abrir nada en mesa, y un botón
 * (o clic en el número) que abre el panel.
 *
 * Sin plantilla: el HTML se arma acá (es poco) y vive en #ui-bottom.
 */
export class Indicador extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "sbn-indicador",
    tag: "aside",
    classes: ["sbn-indicador"],
    window: { frame: false, positioned: false },
    actions: {
      plegar: Indicador.#onPlegar,
      termometro: Indicador.#onTermometro,
      congelar: Indicador.#onCongelar,
      noche: Indicador.#onNoche,
      panel: Indicador.#onPanel
    }
  };

  static #instancia = null;

  static registrarSettings() {
    game.settings.register(SBN.ID, SBN.SETTINGS.INDICADOR, {
      name: "SBN.settings.indicador.Name",
      hint: "SBN.settings.indicador.Hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => this.sincronizar()
    });
    game.settings.register(SBN.ID, SBN.SETTINGS.INDICADOR_PLEGADO, {
      scope: "client",
      config: false,
      type: Boolean,
      default: false
    });
  }

  /** Abre o cierra según el usuario y el setting. */
  static sincronizar() {
    const mostrar = game.user.isGM && game.settings.get(SBN.ID, SBN.SETTINGS.INDICADOR);
    if (mostrar) {
      this.#instancia ??= new this();
      this.#instancia.render({ force: true });
    } else if (this.#instancia?.rendered) {
      this.#instancia.close();
    }
    return this.#instancia;
  }

  static refrescar() {
    if (this.#instancia?.rendered) this.#instancia.render();
  }

  static get plegado() {
    return !!game.settings.get(SBN.ID, SBN.SETTINGS.INDICADOR_PLEGADO);
  }

  /* -------------------------------------------- */

  async _prepareContext() {
    const e = Estado.estado();
    const umbral = Estado.umbralDe(e.termometro.valor);
    const ultimo = e.termometro.registro.at(-1);
    return { ...e, umbral, ultimo, pistasN: Object.keys(e.pistas).length };
  }

  async _renderHTML(c) {
    const { termometro: tm, noche } = c;
    const plegado = Indicador.plegado;
    const icono = c.umbral ? Estado.textoUmbral(c.umbral.valor, "icono") : "";

    // Tooltip del Termómetro: umbral alcanzado y último movimiento.
    const lineas = [t("indicador.termometroValor", { valor: tm.valor, max: Datos.termometro.max })];
    if (c.umbral) lineas.push(`${icono} ${Estado.textoUmbral(c.umbral.valor)}`);
    const proximo = Datos.umbrales.find(u => u.valor > tm.valor);
    if (proximo) lineas.push(t("indicador.proximo", { valor: proximo.valor, texto: Estado.textoUmbral(proximo.valor) }));
    if (tm.congelado) lineas.push(t("indicador.congelado"));
    if (c.ultimo) lineas.push(t("indicador.ultimo", { cambio: c.ultimo.cambio, motivo: c.ultimo.motivo || "—" }));
    const ttTermo = esc(lineas.join("\n"));
    const ttNoche = esc(`${t("reloj.tooltip", { n: noche, dia: Estado.textoNoche(noche, "dia") })}\n${Estado.textoNoche(noche, "evento")}`);

    const panel = `<button type="button" class="sbn-ind-panel" data-action="panel"
      data-tooltip-text="${t("indicador.abrirPanel")}" aria-label="${t("indicador.abrirPanel")}"><i class="fa-solid fa-book-skull"></i></button>`;

    const plegar = `<button type="button" class="sbn-ind-plegar" data-action="plegar"
      data-tooltip-text="${t(plegado ? "indicador.desplegar" : "indicador.plegar")}" aria-label="${t(plegado ? "indicador.desplegar" : "indicador.plegar")}">
      <i class="fa-solid ${plegado ? "fa-chevron-up" : "fa-chevron-down"}"></i></button>`;

    if (plegado) {
      return `<div data-tooltip-class="sbn-tooltip" class="sbn-ind-barra sbn-ind-plegado${tm.congelado ? " sbn-congelado" : ""}">
        ${plegar}
        <span class="sbn-ind-resumen" data-tooltip-text="${ttTermo}"><i class="fa-solid fa-temperature-half"></i> ${tm.valor}</span>
        <span class="sbn-ind-resumen" data-tooltip-text="${ttNoche}"><i class="fa-solid fa-moon"></i> ${noche}</span>
        ${panel}
      </div>`;
    }

    const { min, max } = Datos.termometro;
    const umbrales = new Set(Datos.umbrales.map(u => u.valor));
    let escala = "";
    for (let i = 1; i <= max; i++) {
      const cls = ["sbn-seg", i <= tm.valor ? "sbn-on" : "", umbrales.has(i) ? "sbn-umbral" : ""].filter(Boolean).join(" ");
      escala += `<span class="${cls}"></span>`;
    }
    const bajar = tm.congelado || tm.valor <= min ? "disabled" : "";
    const subir = tm.congelado || tm.valor >= max ? "disabled" : "";

    return `<div data-tooltip-class="sbn-tooltip" class="sbn-ind-barra${tm.congelado ? " sbn-congelado" : ""}">
      ${plegar}
      <div class="sbn-ind-grupo sbn-ind-termometro">
        <span class="sbn-ind-etiqueta">${t("indicador.termometro")}</span>
        <button type="button" class="sbn-ind-boton" data-action="termometro" data-delta="-1" ${bajar} aria-label="${t("indicador.bajar")}"><i class="fa-solid fa-minus"></i></button>
        <span class="sbn-ind-valor" data-tooltip-text="${ttTermo}">
          <span class="sbn-ind-numero">${tm.valor}</span>
          <span class="sbn-escala">${escala}</span>
          ${icono ? `<span class="sbn-ind-icono">${icono}</span>` : ""}
        </span>
        <button type="button" class="sbn-ind-boton" data-action="termometro" data-delta="+1" ${subir} aria-label="${t("indicador.subir")}"><i class="fa-solid fa-plus"></i></button>
        <button type="button" class="sbn-ind-boton sbn-ind-congelar${tm.congelado ? " sbn-activo" : ""}" data-action="congelar"
          data-tooltip-text="${t(tm.congelado ? "indicador.descongelar" : "indicador.congelar")}" aria-pressed="${tm.congelado}"><i class="fa-solid fa-snowflake"></i></button>
      </div>
      <div class="sbn-ind-grupo sbn-ind-noche">
        <span class="sbn-ind-etiqueta">${t("indicador.noche")}</span>
        <button type="button" class="sbn-ind-boton" data-action="noche" data-delta="-1" ${noche <= 1 ? "disabled" : ""} aria-label="${t("indicador.nocheAnterior")}"><i class="fa-solid fa-minus"></i></button>
        <span class="sbn-ind-valor" data-tooltip-text="${ttNoche}">
          <span class="sbn-ind-numero">${noche}</span>
          <span class="sbn-ind-dia">${esc(Estado.textoNoche(noche, "dia"))}</span>
        </span>
        <button type="button" class="sbn-ind-boton" data-action="noche" data-delta="+1" ${noche >= Datos.totalNoches ? "disabled" : ""} aria-label="${t("indicador.nocheSiguiente")}"><i class="fa-solid fa-plus"></i></button>
      </div>
      <div class="sbn-ind-grupo sbn-ind-pistas" data-tooltip-text="${esc(t("indicador.pistasTooltip"))}">
        <i class="fa-solid fa-magnifying-glass"></i> ${c.pistasN}/${Datos.pistas.length}
      </div>
      ${panel}
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  /** En #ui-bottom, encima de la hotbar. */
  _insertElement(element) {
    const existente = document.getElementById(element.id);
    if (existente) return existente.replaceWith(element);
    const destino = document.getElementById("ui-bottom") ?? document.getElementById("interface") ?? document.body;
    destino.prepend(element);
  }

  /* -------------------------------------------- */
  /*  Acciones                                    */
  /* -------------------------------------------- */

  static async #onPlegar() {
    await game.settings.set(SBN.ID, SBN.SETTINGS.INDICADOR_PLEGADO, !Indicador.plegado);
    this.render();
  }

  static async #onTermometro(_event, target) {
    await Estado.termometro(Number(target.dataset.delta), t("indicador.motivo"));
  }

  static async #onCongelar() {
    await Estado.termometro(Estado.termometroActual.congelado ? "descongelar" : "congelar", t("indicador.motivo"));
  }

  static async #onNoche(_event, target) {
    await Estado.noche(Estado.nocheActual + Number(target.dataset.delta));
  }

  static #onPanel() {
    Panel.abrir();
  }
}

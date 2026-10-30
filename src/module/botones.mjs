import { SBN } from "./constantes.mjs";
import { Estado } from "./estado.mjs";
import { Datos } from "./datos.mjs";
import { actorActual } from "./actores.mjs";
import { t, exigirNarrador } from "./util.mjs";

/**
 * Botones que el build pone en los journals (tools/contenido/CONTRATO.md):
 *
 *   .sbn-tirada      data-sbn-tirada="attributes.wits skills.investigation" data-dificultad data-label
 *   .sbn-termometro  data-sbn-termometro="+1" | "=10" | "congelar"  data-motivo
 *   .sbn-pista       data-sbn-pista="P-07"
 *   .sbn-reloj       data-sbn-reloj="4"
 *
 * Un solo listener delegado en el documento: los journals se renderizan en
 * muchos contextos (hoja, popout, «mostrar a jugadores», chat) y
 * engancharse a cada uno sería frágil.
 */
export class Botones {
  static instalar() {
    document.addEventListener("click", ev => this.#onClick(ev));
    // El TooltipManager escucha pointerenter en body (captura); el documento llega antes.
    document.addEventListener("pointerenter", ev => {
      const reloj = ev.target?.closest?.("[data-sbn-reloj]");
      if (reloj) this.#tooltipReloj(reloj);
    }, { capture: true, passive: true });
  }

  static async #onClick(event) {
    const el = event.target?.closest?.("[data-sbn-tirada], [data-sbn-termometro], [data-sbn-pista], [data-sbn-reloj]");
    // Dentro del editor (ProseMirror) el botón se edita, no se aprieta.
    if (!el || el.isContentEditable) return;
    event.preventDefault();
    event.stopPropagation();
    if (el.dataset.sbnOcupado) return;
    el.dataset.sbnOcupado = "1";
    try {
      if ("sbnTirada" in el.dataset) return await this.tirada(el.dataset);
      if ("sbnTermometro" in el.dataset) return await this.#termometro(el);
      if ("sbnPista" in el.dataset) return await this.#pista(el);
      if ("sbnReloj" in el.dataset) return await this.#reloj(el);
    } catch (err) {
      console.error(`${SBN.ID} | botón:`, err);
    } finally {
      delete el.dataset.sbnOcupado;
    }
  }

  /** Botón @tirada: reserva por paths de wod5e, con dificultad (como DVV). */
  static async tirada({ sbnTirada, dificultad, label }) {
    if (!globalThis.WOD5E?.api?.RollFromDataset) {
      ui.notifications.error(t("tirada.sinSistema"));
      return;
    }
    const actor = await actorActual();
    if (!actor) return;
    const paths = String(sbnTirada ?? "").split(/[\s+]+/).filter(Boolean);
    if (!paths.length) return;
    await this.tirar({ actor, paths, dificultad, label });
  }

  /**
   * Tira con WOD5E.api.RollFromDataset (systems/wod5e/system/api/wod5e-api.js →
   * _onConfirmRoll en system/actor/scripts/roll.js): `valuePaths` suma los
   * valores del actor, `flatMod` los dados extra, `selectors` activa los
   * modificadores situacionales del actor. Con `absoluto` la reserva es ese
   * número fijo (useAbsoluteValue + absoluteValue), sin mirar la ficha.
   *
   * @param {object} o
   * @param {Actor} o.actor
   * @param {string[]} [o.paths]   "attributes.manipulation", "skills.persuasion"…
   * @param {number} [o.dificultad]
   * @param {string} [o.label]
   * @param {number} [o.dados]     dados extra (pistas, pruebas): puede ser negativo
   * @param {number} [o.absoluto]  reserva fija (Halloway: 10 dados)
   * @param {string} [o.flavor]    texto bajo el título en el chat (el desglose)
   */
  static async tirar({ actor, paths = [], dificultad = 0, label = "", dados = 0, absoluto = null, flavor = "" }) {
    if (!globalThis.WOD5E?.api?.RollFromDataset) {
      ui.notifications.error(t("tirada.sinSistema"));
      return false;
    }
    if (!actor) {
      ui.notifications.warn(t("tirada.sinActor"));
      return false;
    }
    const selectors = paths.flatMap(p => [p, ...p.split(".")]);
    const dataset = {
      label: label || t("tirada.titulo"),
      selectors: [...new Set(selectors)].join(" "),
      difficulty: Number(dificultad) || 0
    };
    if (Number.isFinite(absoluto)) Object.assign(dataset, { useAbsoluteValue: true, absoluteValue: absoluto, valuePaths: "" });
    else dataset.valuePaths = paths.map(p => `${p}.value`).join(" ");
    if (dados) dataset.flatMod = Number(dados);
    if (flavor) dataset.flavor = flavor;
    await WOD5E.api.RollFromDataset({ dataset, actor });
    return true;
  }

  static async #termometro(el) {
    if (!exigirNarrador()) return;
    const r = await Estado.termometro(el.dataset.sbnTermometro, el.dataset.motivo ?? "");
    if (r) el.classList.add("sbn-usado");
  }

  static async #pista(el) {
    if (!exigirNarrador()) return;
    const id = el.dataset.sbnPista;
    if (Estado.obtenida(id)) {
      const si = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("pistas.desmarcarTitulo") },
        classes: ["sbn-dialogo"],
        content: `<p>${t("pistas.desmarcarPregunta", { id, nombre: Estado.nombrePista(id) })}</p>`
      });
      if (si) await Estado.pista(id, false);
    } else {
      await Estado.pista(id, true);
    }
    // El hook sbnEstado refresca todos los botones; éste por si el render llegó antes.
    this.refrescar(el.ownerDocument);
  }

  static async #reloj(el) {
    if (!game.user.isGM) {
      this.#tooltipReloj(el);
      return;
    }
    const n = Number(el.dataset.sbnReloj);
    if (n === Estado.nocheActual) return;
    const si = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("reloj.fijarTitulo") },
      classes: ["sbn-dialogo"],
      content: `<p>${t("reloj.fijarPregunta", { n, dia: Estado.textoNoche(n, "dia"), actual: Estado.nocheActual })}</p>`
    });
    if (si) await Estado.noche(n);
  }

  static #tooltipReloj(el) {
    const n = Number(el.dataset.sbnReloj);
    if (!(n >= 1 && n <= Datos.totalNoches)) return;
    // El build pone un `title` con la fecha: se pasa al tooltip de Foundry para no tener dos.
    if (el.title) {
      el.dataset.sbnTitulo = el.title;
      el.removeAttribute("title");
    }
    let texto = el.dataset.sbnTitulo || t("reloj.tooltip", { n, dia: Estado.textoNoche(n, "dia") });
    if (n === Estado.nocheActual) texto += ` · ${t("reloj.esLaActual")}`;
    else if (game.user.isGM) texto += ` · ${t("reloj.clicParaFijar")}`;
    el.dataset.tooltipText = texto;
  }

  /**
   * Enlaces que un jugador no puede abrir (el actor de otro PJ, un journal del
   * Narrador, COT-00 antes de compartirlo): texto plano. Foundry los dibuja
   * igual que cualquier enlace si el documento está en el cliente
   * (TextEditor._createContentLink → toAnchor, client/applications/ux/text-editor.mjs)
   * y al clic la hoja falla por permisos; si no está, como enlace roto
   * (`.broken`, ícono fa-link-slash). Para el jugador, las dos cosas son ruido:
   * queda el nombre. Al Narrador no se le toca nada (un roto le avisa de un
   * error del build). Se reevalúa en cada render: si el Narrador le da
   * permiso, el enlace vuelve.
   */
  static enlacesSinPermiso(raiz = document) {
    if (game.user.isGM) return;
    const root = raiz instanceof HTMLElement || raiz instanceof Document ? raiz : raiz?.[0];
    if (!root) return;
    for (const a of root.querySelectorAll("a.content-link")) {
      const uuid = a.dataset.uuid;
      let bloqueado = a.classList.contains("broken");
      if (!bloqueado && uuid && !uuid.startsWith("Compendium.")) {
        const doc = fromUuidSync(uuid, { strict: false });
        bloqueado = !doc || doc.visible === false;
      }
      if (!bloqueado) continue;
      const span = document.createElement("span");
      span.className = "sbn-sin-permiso";
      span.textContent = a.textContent.trim();
      a.replaceWith(span);
    }
  }

  /**
   * Aspecto de los botones según el estado: pistas obtenidas, noche actual
   * o pasada del Reloj, Termómetro congelado. Se llama al renderizar
   * journals y chat, y en cada `sbnEstado`.
   */
  static refrescar(raiz = document) {
    const root = raiz instanceof HTMLElement || raiz instanceof Document ? raiz : raiz?.[0] ?? document;
    const pistas = Estado.pistasActuales;
    for (const b of root.querySelectorAll("[data-sbn-pista]")) {
      const si = !!pistas[b.dataset.sbnPista];
      b.classList.toggle("sbn-obtenida", si);
      b.setAttribute("aria-pressed", String(si));
      b.dataset.tooltipText = si ? t("pistas.tooltipObtenida") : t("pistas.tooltipMarcar");
    }
    const noche = Estado.nocheActual;
    for (const r of root.querySelectorAll("[data-sbn-reloj]")) {
      const n = Number(r.dataset.sbnReloj);
      r.classList.toggle("sbn-actual", n === noche);
      r.classList.toggle("sbn-pasada", n < noche);
      this.#tooltipReloj(r);
    }
    const congelado = Estado.termometroActual.congelado;
    for (const b of root.querySelectorAll("[data-sbn-termometro]")) {
      const v = String(b.dataset.sbnTermometro).trim().toLowerCase();
      b.classList.toggle("sbn-bloqueado", congelado && v !== "congelar" && v !== "descongelar");
      if (b.dataset.motivo && !b.dataset.tooltipText) b.dataset.tooltipText = b.dataset.motivo;
    }
    for (const b of root.querySelectorAll("[data-sbn-tirada]")) {
      if (!b.dataset.tooltipText && b.dataset.dificultad) b.dataset.tooltipText = t("tirada.tooltip", { dif: b.dataset.dificultad });
    }
  }
}

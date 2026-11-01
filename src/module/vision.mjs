/**
 * Vista del Narrador en escenas oscuras.
 *
 * Sin un token seleccionado, Foundry le muestra al GM la escena entera, pero
 * la tiñe con el color de la oscuridad (CONFIG.Canvas.darknessColor, 0x303030):
 * con oscuridad 0,85–1 (los sótanos) el mapa casi no se lee. La luz global o
 * bajar la oscuridad lo arreglarían para todos, también para los jugadores.
 *
 * Acá se aclara ese color SÓLO en el cliente del GM y SÓLO mientras no
 * controla un token con visión: al seleccionar un PNJ, el Narrador ve por sus
 * ojos, igual que sin este ajuste. Hook: configureCanvasEnvironment
 * (client/canvas/groups/environment.mjs, EnvironmentCanvasGroup#initialize).
 */

import { SBN } from "./constantes.mjs";

/** Color de la oscuridad para el Narrador: gris azulado claro, las luces se siguen destacando. */
const OSCURIDAD_NARRADOR = 0x8c8c99;

export class Vision {
  static registrarSettings() {
    game.settings.register(SBN.ID, SBN.SETTINGS.VISTA_NARRADOR, {
      name: "SBN.settings.vistaNarrador.Name",
      hint: "SBN.settings.vistaNarrador.Hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => this.#refrescar()
    });
  }

  static instalar() {
    Hooks.on("configureCanvasEnvironment", config => {
      if (this.#aclarar()) config.darknessColor ??= OSCURIDAD_NARRADOR;
    });
    // Seleccionar o soltar un token cambia quién mira: se rearma el entorno.
    const refrescar = foundry.utils.debounce(() => this.#refrescar(), 50);
    Hooks.on("controlToken", () => { if (game.user.isGM) refrescar(); });
  }

  /** ¿Toca aclarar? GM, ajuste prendido, escena con visión y ningún token con visión seleccionado. */
  static #aclarar() {
    if (!game.user?.isGM || !canvas.scene?.tokenVision) return false;
    if (!game.settings.get(SBN.ID, SBN.SETTINGS.VISTA_NARRADOR)) return false;
    return !canvas.tokens?.controlled.some(t => t.hasSight);
  }

  static #refrescar() {
    if (canvas.ready) canvas.environment.initialize();
  }
}

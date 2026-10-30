/**
 * Seattle by Night — punto de entrada del módulo.
 *
 * Sólo cablea: las constantes viven en constantes.mjs y cada mecánica
 * (Termómetro, Reloj de Halloway, pistas, cazadores) va en su propio archivo.
 */

import { SBN } from "./constantes.mjs";

export { SBN };

Hooks.once("init", () => {
  console.log(`${SBN.ID} | Inicializando Seattle by Night`);
});

Hooks.once("ready", () => {
  // API pública, para macros y otros módulos. Crece con cada fase.
  game.modules.get(SBN.ID).api = { SBN };

  console.log(`${SBN.ID} | Listo. Foundry ${game.version} · ${game.system.id} ${game.system.version}`);
});

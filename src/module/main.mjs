/**
 * Seattle by Night — punto de entrada del módulo.
 *
 * Sólo cablea: las constantes viven en constantes.mjs y cada mecánica en su
 * propio archivo.
 *
 *   importacion.mjs   ofrecer e importar la Aventura del compendio
 *   estado.mjs        Termómetro, pistas y Reloj de Halloway (settings de mundo)
 *   botones.mjs       botones de los journals (.sbn-tirada, -termometro, -pista, -reloj)
 *   indicador.mjs     barrita del Narrador con el Termómetro y la noche
 *   textos.mjs        respaldo de lang/es.json si el cliente no está en español
 */

import { SBN } from "./constantes.mjs";
import { Estado } from "./estado.mjs";
import { Botones } from "./botones.mjs";
import { Indicador } from "./indicador.mjs";
import * as Importacion from "./importacion.mjs";
import { asegurarTextos, textosListos } from "./textos.mjs";

export { SBN, Estado, Botones, Indicador };

Hooks.once("init", () => {
  console.log(`${SBN.ID} | Inicializando Seattle by Night`);
  Importacion.registrarSettings();
  Estado.registrarSettings();
  Indicador.registrarSettings();
});

// Las traducciones ya están cargadas en setup; si no hay SBN.*, se traen.
Hooks.once("setup", () => asegurarTextos());

Hooks.once("ready", async () => {
  await textosListos();

  // API pública (tools/contenido/CONTRATO.md), para macros, journals y otros módulos.
  game.modules.get(SBN.ID).api = {
    SBN, Estado, Botones, Indicador,
    termometro: (cambio, motivo) => Estado.termometro(cambio, motivo),
    pista: (id, obtenida = true) => Estado.pista(id, obtenida),
    noche: n => Estado.noche(n),
    estado: () => Estado.estado(),
    importarCronica: opciones => Importacion.importarCronica(opciones),
    tirada: dataset => Botones.tirada(dataset),
    indicador: () => Indicador.sincronizar()
  };

  Botones.instalar();
  Indicador.sincronizar();

  console.log(`${SBN.ID} | Listo. Foundry ${game.version} · ${game.system.id} ${game.system.version}`);

  if (game.user.isGM) Importacion.ofrecerImportacion().catch(err => console.warn(`${SBN.ID} | importación:`, err));
});

/* -------------------------------------------- */
/*  Refrescos                                   */
/* -------------------------------------------- */

/** Cualquier cambio de estado (en cualquier cliente): botones visibles e indicador. */
Hooks.on(SBN.HOOK_ESTADO, () => {
  Botones.refrescar(document);
  Indicador.refrescar();
});

/**
 * Al renderizar journals (la hoja y cada página, que se renderiza por su
 * cuenta) y mensajes de chat, el aspecto de los botones según el estado.
 */
for (const hook of ["renderJournalEntrySheet", "renderJournalEntryPageSheet"]) {
  Hooks.on(hook, (_app, element) => Botones.refrescar(element));
}
Hooks.on("renderChatMessageHTML", (_msg, html) => Botones.refrescar(html));

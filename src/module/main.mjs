/**
 * Seattle by Night — punto de entrada del módulo.
 *
 * Sólo cablea: las constantes viven en constantes.mjs y cada mecánica en su
 * propio archivo.
 *
 *   importacion.mjs   ofrecer e importar la Aventura del compendio
 *   datos.mjs         data/cronica.json: umbrales, noches, pistas, tiradas (lo genera el build)
 *   estado.mjs        Termómetro, pistas, Reloj, pruebas y votos (settings de mundo)
 *   botones.mjs       botones de los journals (.sbn-tirada, -termometro, -pista, -reloj)
 *   indicador.mjs     barrita del Narrador con el Termómetro y la noche
 *   panel.mjs         Panel del Narrador (Termómetro, Reloj, pistas, tiradas clave)
 *   textos.mjs        respaldo de lang/es.json si el cliente no está en español
 */

import { SBN } from "./constantes.mjs";
import { Datos } from "./datos.mjs";
import { Estado } from "./estado.mjs";
import { Botones } from "./botones.mjs";
import { Indicador } from "./indicador.mjs";
import { Panel } from "./panel.mjs";
import * as Importacion from "./importacion.mjs";
import { asegurarTextos, textosListos } from "./textos.mjs";

export { SBN, Datos, Estado, Botones, Indicador, Panel };

Hooks.once("init", () => {
  console.log(`${SBN.ID} | Inicializando Seattle by Night`);
  Importacion.registrarSettings();
  Estado.registrarSettings();
  Indicador.registrarSettings();
  Importacion.instalar();
});

// Las traducciones ya están cargadas en setup; si no hay SBN.*, se traen.
// Los datos se piden acá y no en init: hace falta game.user (GM: la crónica
// entera; jugador: data/publico.json). `ready` los espera.
Hooks.once("setup", () => {
  asegurarTextos();
  Datos.cargar();
});

Hooks.once("ready", async () => {
  await Promise.all([textosListos(), Datos.cargar()]);
  if (Datos.error && game.user.isGM) ui.notifications.error(game.i18n.localize("SBN.panel.sinDatos"), { permanent: true });

  // API pública (tools/contenido/CONTRATO.md), para macros, journals y otros módulos.
  game.modules.get(SBN.ID).api = {
    SBN, Datos, Estado, Botones, Indicador, Panel,
    termometro: (cambio, motivo, opciones) => Estado.termometro(cambio, motivo, opciones),
    pista: (id, obtenida = true) => Estado.pista(id, obtenida),
    prueba: (id, marcada = true) => Estado.prueba(id, marcada),
    noche: n => Estado.noche(n),
    estado: () => Estado.estado(),
    importarCronica: opciones => Importacion.importarCronica(opciones),
    tirada: dataset => Botones.tirada(dataset),
    indicador: () => Indicador.sincronizar(),
    abrirPanel: opciones => Panel.abrir(opciones)
  };

  Botones.instalar();
  Indicador.sincronizar();

  console.log(`${SBN.ID} | Listo. Foundry ${game.version} · ${game.system.id} ${game.system.version}`);

  // Con varios GM conectados, sólo uno (el GM activo de Foundry) ofrece importar.
  if (game.user === game.users.activeGM) Importacion.ofrecerImportacion().catch(err => console.warn(`${SBN.ID} | importación:`, err));
});

/* -------------------------------------------- */
/*  Refrescos                                   */
/* -------------------------------------------- */

/**
 * Cualquier cambio de estado (en cualquier cliente): botones visibles,
 * indicador y panel. El aviso emergente de umbral lo ve cada GM en su
 * cliente (el susurro al chat ya va a todos los GM desde quien lo movió).
 */
Hooks.on(SBN.HOOK_ESTADO, (_estado, detalle) => {
  Botones.refrescar(document);
  Indicador.refrescar();
  Panel.refrescar();
  if (game.user.isGM) Estado.notificarUmbrales(detalle);
});

/**
 * El panel muestra la Célula y los valores de los actores que tiran, y lo que
 * mueve el Termómetro en el mapa abierto. No con cualquier actor: sólo los que
 * le importan (Panel.actorDelPanel).
 */
for (const hook of ["createActor", "updateActor", "deleteActor"]) {
  Hooks.on(hook, actor => { if (Panel.actorDelPanel(actor)) Panel.refrescar(); });
}
Hooks.on("canvasReady", () => Panel.refrescar());

/** Botón del panel en la barra de controles de escena (sólo el Narrador), en el grupo de tokens. */
Hooks.on("getSceneControlButtons", controls => {
  const tokens = controls.tokens;
  if (!tokens?.tools) return;
  tokens.tools.sbnPanel = {
    name: "sbnPanel",
    title: "SBN.panel.control",
    icon: "fa-solid fa-book-skull",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: game.user.isGM,
    onChange: () => Panel.abrir()
  };
});

/**
 * Al renderizar journals (la hoja y cada página, que se renderiza por su
 * cuenta) y mensajes de chat, el aspecto de los botones según el estado.
 */
for (const hook of ["renderJournalEntrySheet", "renderJournalEntryPageSheet"]) {
  Hooks.on(hook, (_app, element) => {
    Botones.refrescar(element);
    Botones.enlacesSinPermiso(element);
  });
}
Hooks.on("renderChatMessageHTML", (_msg, html) => {
  Botones.refrescar(html);
  Botones.enlacesSinPermiso(html);
});

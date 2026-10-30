import { SBN } from "./constantes.mjs";
import { t, esc } from "./util.mjs";

/**
 * Importar la crónica al mundo desde la Aventura del compendio `aventura`
 * (journals, actores, escenas, macros y carpetas). Copiado de DVV.
 *
 * Reimportar («Actualizar la crónica») usa el mismo Adventure#import, que para
 * los documentos que ya existen hace updateDocuments con diff:false y
 * recursive:false (Adventure#importContent, client/documents/adventure.mjs):
 * el documento se REEMPLAZA entero. Sin tocar nada, eso le quitaba a los
 * jugadores sus PJ, reseteaba hambre, daño y PX, y volvía a ocultar los
 * handouts entregados. El hook `preImportAdventure` recibe los mismos objetos
 * `toCreate` / `toUpdate` que después se importan, así que se ajustan ahí
 * (conservarMundo): ownership de todo, páginas reveladas, actores con dueño
 * jugador fuera del update, y lo que el Narrador agregó a mano.
 */

/** Settings internos de la importación. */
export function registrarSettings() {
  game.settings.register(SBN.ID, SBN.SETTINGS.IMPORTACION_OFRECIDA, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  game.settings.register(SBN.ID, SBN.SETTINGS.VERSION_OFRECIDA, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
}

/**
 * Engancha el preImportAdventure. Vale también si el Narrador importa a mano
 * desde la hoja de la Aventura en el compendio, no sólo por importarCronica.
 */
export function instalar() {
  Hooks.on("preImportAdventure", (adventure, _opciones, toCreate, toUpdate) => {
    if (!esNuestra(adventure)) return;
    const resumen = conservarMundo(toCreate, toUpdate);
    ultimoResumen = resumen;
    SBN.log("importación: se conserva", resumen);
  });
}

/** Lo que conservó la última importación (para el aviso al Narrador). */
let ultimoResumen = null;

const esNuestra = adventure => adventure?.collection?.metadata?.packageName === SBN.ID
  || adventure?.pack === `${SBN.ID}.${SBN.PACKS.AVENTURA}`;

/** Colecciones embebidas que el Narrador suele tocar en mesa y la Aventura no trae. */
const EMBEBIDOS = {
  Actor: ["items", "effects"],
  JournalEntry: ["pages"],
  Scene: ["tokens", "drawings", "notes", "templates"]
};

/**
 * Ajusta, en el lugar, los datos que la Aventura va a escribir sobre
 * documentos que ya existen en el mundo:
 *
 *   - `ownership` del mundo, en todos (quién ve qué lo decide el Narrador);
 *   - Actor con dueño jugador (hasPlayerOwner): no se actualiza (ni su
 *     system: hambre, daño, PX); si falta en el mundo, se crea igual;
 *   - páginas de journal: su `ownership` del mundo (una página revelada sigue
 *     revelada); las que no vienen en la Aventura (agregadas a mano) se quedan;
 *   - escenas: `active` y `navigation` del mundo, y los tokens, dibujos y
 *     notas que no son de la Aventura;
 *   - actores e ítems embebidos agregados a mano, igual.
 *
 * @returns {{ conservados: string[], documentos: number }}
 */
export function conservarMundo(toCreate, toUpdate) {
  const conservados = [];
  let documentos = 0;
  for (const [documentName, lista] of Object.entries(toUpdate)) {
    const coleccion = game.collections.get(documentName);
    const quedan = [];
    for (const datos of lista) {
      const existente = coleccion?.get(datos._id);
      if (!existente) { quedan.push(datos); continue; }
      if (documentName === "Actor" && existente.hasPlayerOwner) {
        conservados.push(existente.name);
        continue;
      }
      const fuente = existente.toObject();
      // Las carpetas no tienen ownership.
      if (fuente.ownership) datos.ownership = foundry.utils.deepClone(fuente.ownership);
      if (documentName === "Scene") {
        datos.active = fuente.active;
        datos.navigation = fuente.navigation;
      }
      if (documentName === "JournalEntry") {
        const paginas = new Map(fuente.pages.map(p => [p._id, p]));
        for (const p of datos.pages ?? []) {
          const vieja = paginas.get(p._id);
          if (vieja) p.ownership = foundry.utils.deepClone(vieja.ownership);
        }
      }
      for (const campo of EMBEBIDOS[documentName] ?? []) {
        if (!Array.isArray(datos[campo]) || !Array.isArray(fuente[campo])) continue;
        const nuevos = new Set(datos[campo].map(e => e._id));
        datos[campo].push(...fuente[campo].filter(e => !nuevos.has(e._id) && !e.flags?.[SBN.ID]?.origen));
      }
      documentos++;
      quedan.push(datos);
    }
    if (quedan.length) toUpdate[documentName] = quedan;
    else delete toUpdate[documentName];
  }
  return { conservados, documentos };
}

/** La Aventura del compendio: el único documento del pack. */
export async function aventura() {
  const pack = SBN.pack(SBN.PACKS.AVENTURA);
  if (!pack) return null;
  const indice = await pack.getIndex();
  const entrada = indice.contents[0];
  return entrada ? pack.getDocument(entrada._id) : null;
}

/** ¿Hay en el mundo algo generado por el build? (todo lleva el flag `origen`). */
export function cronicaImportada() {
  const generado = d => !!d.getFlag(SBN.ID, SBN.FLAGS.ORIGEN);
  return game.journal.some(generado) || game.scenes.some(generado) || game.actors.some(generado);
}

/** Importa (o actualiza) todo el contenido de la crónica en el mundo. */
export async function importarCronica({ silencioso = false } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(t("soloNarrador"));
    return null;
  }
  const doc = await aventura();
  if (!doc) {
    ui.notifications.error(t("importar.sinAventura"));
    return null;
  }
  const primeraVez = !cronicaImportada();
  ultimoResumen = null;
  const resultado = await doc.import({ dialog: false });
  await game.settings.set(SBN.ID, SBN.SETTINGS.IMPORTACION_OFRECIDA, true);
  await game.settings.set(SBN.ID, SBN.SETTINGS.VERSION_OFRECIDA, game.modules.get(SBN.ID).version);

  // La portada queda como escena activa sólo la primera vez y si el mundo no
  // tenía ya una activa: después manda el Narrador.
  // La escena de bienvenida que crea el core en un mundo nuevo
  // (client/nue/nue-manager.mjs, id NUEDEFAULTSCENE0) no cuenta como «del Narrador».
  const landing = game.scenes.find(s => s.getFlag(SBN.ID, SBN.FLAGS.LANDING));
  const activa = game.scenes.active;
  if (landing && primeraVez && (!activa || activa.id === "NUEDEFAULTSCENE0")) await landing.activate();

  const contar = grupo => Object.values(grupo ?? {}).reduce((a, b) => a + (b?.length ?? 0), 0);
  if (!silencioso) {
    ui.notifications.info(t("importar.hecho", { creados: contar(resultado?.created), actualizados: contar(resultado?.updated) }));
    const conservados = ultimoResumen?.conservados ?? [];
    if (conservados.length) {
      ui.notifications.info(t("importar.conservados", { n: conservados.length, nombres: conservados.map(esc).join(", ") }));
    }
  }
  return resultado;
}

/** Versión del módulo con la que se importó la crónica por última vez (la anota Foundry). */
export function versionImportada(doc) {
  return game.settings.get("core", "adventureImports")?.[doc.uuid]?.moduleVersion ?? "";
}

/**
 * Al entrar por primera vez a un mundo sin la crónica, se ofrece importarla.
 * Si ya está importada pero con otra versión del módulo, se ofrece
 * actualizarla, una vez por versión. Lo llama sólo game.users.activeGM
 * (main.mjs): con dos GM conectados, el diálogo sale una vez.
 */
export async function ofrecerImportacion() {
  if (!game.user.isGM) return;
  const doc = await aventura();
  if (!doc) return;
  const version = game.modules.get(SBN.ID).version;
  const dialogo = foundry.applications.api.DialogV2;

  if (cronicaImportada()) {
    const importada = versionImportada(doc);
    const ofrecida = game.settings.get(SBN.ID, SBN.SETTINGS.VERSION_OFRECIDA);
    if (!importada || importada === version || ofrecida === version) return;
    // Por defecto «No»: actualizar reescribe documentos; con Enter no se hace sin querer.
    const si = await dialogo.confirm({
      window: { title: t("importar.actualizarTitulo") },
      classes: ["sbn-dialogo"],
      position: { width: 520 },
      content: `<p>${t("importar.actualizarPregunta", { importada: esc(importada), version: esc(version) })}</p>`
        + `<p><strong>${t("importar.actualizarSeActualiza")}</strong> ${t("importar.actualizarQueSe")}</p>`
        + `<p><strong>${t("importar.actualizarSeConserva")}</strong> ${t("importar.actualizarQueNo")}</p>`
        + `<p class="hint">${t("importar.actualizarAviso")}</p>`,
      yes: { label: t("importar.actualizarSi"), default: false },
      no: { label: t("importar.no"), default: true }
    });
    await game.settings.set(SBN.ID, SBN.SETTINGS.VERSION_OFRECIDA, version);
    if (si) await importarCronica();
    return;
  }

  if (game.settings.get(SBN.ID, SBN.SETTINGS.IMPORTACION_OFRECIDA)) return;
  const si = await dialogo.confirm({
    window: { title: t("importar.titulo") },
    classes: ["sbn-dialogo"],
    content: `<p>${t("importar.pregunta")}</p>${doc.description ?? ""}`,
    yes: { label: t("importar.si"), default: true },
    no: { label: t("importar.no"), default: false }
  });
  await game.settings.set(SBN.ID, SBN.SETTINGS.IMPORTACION_OFRECIDA, true);
  if (si) await importarCronica();
}

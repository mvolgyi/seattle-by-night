import { SBN } from "./constantes.mjs";
import { t, esc } from "./util.mjs";
import { IDIOMAS, idiomaCronica, idiomaPorDefecto, cronicaImportada, packDe, idiomaDePack, nombreIdioma } from "./idioma.mjs";

export { cronicaImportada };

/**
 * Importar la crónica al mundo desde la Aventura del compendio `aventura`
 * (castellano) o `aventura-en` (inglés): journals, actores, escenas, macros y
 * carpetas. Copiado de DVV.
 *
 * Las dos Aventuras traen los MISMOS _id (TRADUCCION.md): cambiar de idioma con
 * la partida empezada es importar la otra, que actualiza los documentos con
 * conservarMundo igual que una actualización de versión. El idioma elegido
 * queda en el setting `sbn-idioma-cronica` (idioma.mjs).
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
  // También si el Narrador importa a mano la Aventura del otro idioma desde su compendio.
  Hooks.on("importAdventure", adventure => {
    if (!esNuestra(adventure) || !game.user.isGM) return;
    const idioma = idiomaDeAventura(adventure);
    if (game.settings.get(SBN.ID, SBN.SETTINGS.IDIOMA) !== idioma) {
      game.settings.set(SBN.ID, SBN.SETTINGS.IDIOMA, idioma).catch(err => console.error(`${SBN.ID} | idioma:`, err));
    }
  });
}

/** Lo que conservó la última importación (para el aviso al Narrador). */
let ultimoResumen = null;

/** Las dos Aventuras del módulo (castellano e inglés). */
const esNuestra = adventure => adventure?.collection?.metadata?.packageName === SBN.ID
  || IDIOMAS.some(i => adventure?.pack === `${SBN.ID}.${packDe(SBN.PACKS.AVENTURA, i)}`);

/** El idioma de una de nuestras Aventuras: el flag que pone el build o el nombre del pack. */
const idiomaDeAventura = adventure => adventure.getFlag?.(SBN.ID, "idioma")
  ?? idiomaDePack(adventure.collection?.metadata?.name ?? adventure.pack?.split(".").at(-1));

/** Colecciones embebidas que el Narrador suele tocar en mesa y la Aventura no trae. */
const EMBEBIDOS = {
  Actor: ["items", "effects"],
  JournalEntry: ["pages"],
  Playlist: ["sounds"],
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
 *   - playlists: lo que está sonando, el volumen de cada pista y los sonidos
 *     agregados a mano;
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
      if (documentName === "Playlist") {
        // Lo que suena y los volúmenes que tocó el Narrador no se pisan.
        datos.playing = fuente.playing;
        const sonidos = new Map(fuente.sounds.map(s => [s._id, s]));
        for (const s of datos.sounds ?? []) {
          const viejo = sonidos.get(s._id);
          if (!viejo) continue;
          s.volume = viejo.volume;
          s.playing = viejo.playing;
          s.pausedTime = viejo.pausedTime;
        }
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

/** La Aventura del compendio de un idioma (por defecto, el de la crónica): el único documento del pack. */
export async function aventura(idioma = idiomaCronica()) {
  const pack = SBN.pack(packDe(SBN.PACKS.AVENTURA, idioma));
  if (!pack) return null;
  const indice = await pack.getIndex();
  const entrada = indice.contents[0];
  return entrada ? pack.getDocument(entrada._id) : null;
}

/**
 * Importa (o actualiza) todo el contenido de la crónica en el mundo, en un
 * idioma (por defecto, el que ya tiene el mundo). Con el otro idioma, cambia el
 * de la crónica conservando lo del mundo (conservarMundo).
 */
export async function importarCronica({ silencioso = false, idioma = idiomaCronica() } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(t("soloNarrador"));
    return null;
  }
  if (!IDIOMAS.includes(idioma)) idioma = idiomaCronica();
  const doc = await aventura(idioma);
  if (!doc) {
    ui.notifications.error(t("importar.sinAventura", { pack: packDe(SBN.PACKS.AVENTURA, idioma) }));
    return null;
  }
  const primeraVez = !cronicaImportada();
  const cambiaIdioma = !primeraVez && idioma !== idiomaCronica();
  ultimoResumen = null;
  const resultado = await doc.import({ dialog: false });
  // El hook importAdventure ya lo puso; acá se espera a que quede guardado.
  await game.settings.set(SBN.ID, SBN.SETTINGS.IDIOMA, idioma);
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
    if (cambiaIdioma) ui.notifications.info(t("idioma.cambiado", { idioma: nombreIdioma(idioma) }));
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

/** El selector de idioma de los diálogos de importación (un <select name="idioma">). */
function selectorIdioma(elegido) {
  const opciones = IDIOMAS.map(i => `<option value="${i}"${i === elegido ? " selected" : ""}>${esc(nombreIdioma(i))}</option>`).join("");
  return `<div class="form-group sbn-idioma"><label for="sbn-idioma-cronica">${t("idioma.etiqueta")}</label>`
    + `<div class="form-fields"><select id="sbn-idioma-cronica" name="idioma">${opciones}</select></div>`
    + `<p class="hint">${t("idioma.hint")}</p></div>`;
}

/** Botón «sí» de un diálogo con selector: devuelve el idioma elegido. */
const idiomaDelFormulario = (_evento, boton) => {
  const v = boton.form?.elements?.idioma?.value;
  return IDIOMAS.includes(v) ? v : idiomaCronica();
};

/**
 * Al entrar por primera vez a un mundo sin la crónica, se ofrece importarla
 * eligiendo el idioma (por defecto, el de Foundry). Si ya está importada pero
 * con otra versión del módulo, se ofrece actualizarla (en su idioma o en el
 * otro), una vez por versión. Lo llama sólo game.users.activeGM (main.mjs):
 * con dos GM conectados, el diálogo sale una vez.
 */
export async function ofrecerImportacion() {
  if (!game.user.isGM) return;
  const version = game.modules.get(SBN.ID).version;
  const dialogo = foundry.applications.api.DialogV2;

  if (cronicaImportada()) {
    const actual = idiomaCronica();
    const doc = await aventura(actual);
    if (!doc) return;
    const importada = versionImportada(doc);
    const ofrecida = game.settings.get(SBN.ID, SBN.SETTINGS.VERSION_OFRECIDA);
    if (!importada || importada === version || ofrecida === version) return;
    // Por defecto «No»: actualizar reescribe documentos; con Enter no se hace sin querer.
    const idioma = await dialogo.confirm({
      window: { title: t("importar.actualizarTitulo") },
      classes: ["sbn-dialogo"],
      position: { width: 520 },
      content: `<p>${t("importar.actualizarPregunta", { importada: esc(importada), version: esc(version) })}</p>`
        + `<p><strong>${t("importar.actualizarSeActualiza")}</strong> ${t("importar.actualizarQueSe")}</p>`
        + `<p><strong>${t("importar.actualizarSeConserva")}</strong> ${t("importar.actualizarQueNo")}</p>`
        + `<p class="hint">${t("importar.actualizarAviso")}</p>`
        + selectorIdioma(actual),
      yes: { label: t("importar.actualizarSi"), default: false, callback: idiomaDelFormulario },
      no: { label: t("importar.no"), default: true }
    });
    await game.settings.set(SBN.ID, SBN.SETTINGS.VERSION_OFRECIDA, version);
    if (IDIOMAS.includes(idioma)) await importarCronica({ idioma });
    return;
  }

  if (game.settings.get(SBN.ID, SBN.SETTINGS.IMPORTACION_OFRECIDA)) return;
  const idioma = await preguntarImportacion();
  await game.settings.set(SBN.ID, SBN.SETTINGS.IMPORTACION_OFRECIDA, true);
  if (IDIOMAS.includes(idioma)) await importarCronica({ idioma });
}

/**
 * El diálogo de la primera importación, con el selector de idioma y la
 * descripción de la Aventura (con el aviso del Dark Pack). Devuelve el idioma
 * elegido, o false/null si no se importa. Lo usa también tools/e2e/capturas-guia.mjs.
 */
export async function preguntarImportacion(propuesto = idiomaPorDefecto()) {
  const doc = await aventura(propuesto) ?? await aventura("es");
  if (!doc) return null;
  return foundry.applications.api.DialogV2.confirm({
    window: { title: t("importar.titulo") },
    classes: ["sbn-dialogo"],
    content: `<p>${t("importar.pregunta")}</p>${selectorIdioma(propuesto)}${doc.description ?? ""}`,
    yes: { label: t("importar.si"), default: true, callback: idiomaDelFormulario },
    no: { label: t("importar.no"), default: false }
  });
}

/**
 * «Idioma de la crónica» en la configuración del módulo (sólo el Narrador):
 * importa la crónica en el idioma elegido. Con la partida empezada, es cambiar
 * de idioma conservando el mundo (los PJ de los jugadores no se tocan).
 */
export class MenuIdioma extends foundry.applications.api.DialogV2 {
  constructor(options = {}) {
    const actual = idiomaCronica();
    const importada = cronicaImportada();
    super(foundry.utils.mergeObject({
      window: { title: t("idioma.menu.titulo"), icon: "fa-solid fa-language" },
      classes: ["sbn-dialogo"],
      position: { width: 520 },
      content: `<p>${importada ? t("idioma.menu.actual", { idioma: esc(nombreIdioma(actual)) }) : t("idioma.menu.sinCronica")}</p>`
        + selectorIdioma(actual)
        + (importada ? `<p><strong>${t("importar.actualizarSeConserva")}</strong> ${t("importar.actualizarQueNo")}</p><p class="hint">${t("idioma.menu.aviso")}</p>` : ""),
      buttons: [
        { action: "importar", label: importada ? t("idioma.menu.cambiar") : t("importar.si"), icon: "fa-solid fa-language", default: true, callback: idiomaDelFormulario },
        { action: "cancelar", label: t("importar.no"), icon: "fa-solid fa-xmark" }
      ],
      submit: async resultado => {
        if (IDIOMAS.includes(resultado)) await importarCronica({ idioma: resultado });
      }
    }, options));
  }
}

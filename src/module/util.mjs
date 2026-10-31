import { SBN } from "./constantes.mjs";
import { Datos } from "./datos.mjs";

/** game.i18n.localize / format con el prefijo SBN. */
export function t(clave, datos) {
  const k = clave.startsWith("SBN.") ? clave : `SBN.${clave}`;
  return datos ? game.i18n.format(k, datos) : game.i18n.localize(k);
}

/** ¿Existe la clave en lang/es.json? (localize devuelve la clave si no está). */
export function hayTexto(clave) {
  const k = clave.startsWith("SBN.") ? clave : `SBN.${clave}`;
  return game.i18n.has(k);
}

export const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** Los ids de todos los GM del mundo (para los susurros). */
export const idsNarradores = () => game.users.filter(u => u.isGM).map(u => u.id);

/**
 * Publica un aviso de chat que sólo ven los Narradores.
 *
 * Foundry manda TODOS los ChatMessage a TODOS los clientes: el `whisper` sólo
 * los oculta en la interfaz (ChatMessage#visible, client/documents/chat-message.mjs),
 * pero cualquier jugador los tiene en `game.messages`. Por eso el mensaje no lleva
 * el contenido: `content` es un texto neutro y el aviso va en el flag `aviso`
 * sólo como claves (`{ tipo: "umbral", valor: 3, sube: true }`, `{ tipo: "pista",
 * id: "P-07", … }`), nada que esté sólo en data/cronica.json. El cliente de cada
 * Narrador arma el HTML real al renderizar (Estado.renderizarAviso, desde el
 * hook renderChatMessageHTML de main.mjs) con sus datos.
 *
 * @param {{ tipo: string }} aviso  claves del aviso (sin textos de la crónica)
 */
export function susurrarNarrador(aviso) {
  return ChatMessage.create({
    content: `<div class="sbn-chat sbn-chat-aviso"><p>${esc(t("chat.avisoNarrador"))}</p></div>`,
    speaker: { alias: t("titulo") },
    whisper: idsNarradores(),
    flags: { [SBN.ID]: { [SBN.FLAGS.ORIGEN]: "estado", [SBN.FLAGS.AVISO]: aviso } }
  });
}

/** Sólo el Narrador modifica el estado de la crónica; a un jugador se le avisa. */
export function exigirNarrador() {
  if (game.user.isGM) return true;
  ui.notifications.warn(t("soloNarrador"));
  return false;
}

/**
 * Documento del mundo que viene de una entidad del libro (flag `id`).
 * Prioridad igual que el registro del build: página > journal > actor > escena.
 */
export function documentoDelLibro(id) {
  if (!id) return null;
  const tiene = d => d.getFlag?.(SBN.ID, SBN.FLAGS.ID_LIBRO) === id;
  for (const j of game.journal) {
    const p = j.pages.find(tiene);
    if (p) return p;
  }
  return game.journal.find(tiene) ?? game.actors.find(tiene) ?? game.scenes.find(tiene) ?? null;
}

/**
 * Documento del mundo de un ID del libro: primero el UUID de data/cronica.json
 * (el mismo que usan los @UUID de los journals), si no por el flag `id`.
 */
export function documentoPorId(id) {
  const ref = Datos.ref(id);
  const doc = ref ? fromUuidSync(ref.uuid, { strict: false }) : null;
  return doc ?? documentoDelLibro(id);
}

/**
 * Enlace ya renderizado a un ID del libro: el mismo `<a class="content-link">` que
 * produce TextEditor.enrichHTML con `@UUID[…]{texto}` (TextEditor._createContentLink
 * → ClientDocument#toAnchor), pero síncrono, para armar HTML dentro de un hook de
 * render. Si el documento no está en el mundo, el texto sin enlace.
 */
export function anclaDelLibro(id, texto) {
  const doc = documentoPorId(id);
  return doc?.toAnchor ? doc.toAnchor({ name: texto ?? doc.name }).outerHTML : esc(texto ?? id);
}

/**
 * Enlace HTML ya armado (como el que produce TextEditor.enrichHTML con @UUID)
 * para plantillas: un `<a class="content-link">` que Foundry abre al clic.
 * Sin `texto`, el nombre del registro (o del documento). Si el documento no
 * está en el mundo, el texto sin enlace.
 */
export function enlaceHTML(id, texto) {
  const doc = id ? documentoPorId(id) : null;
  const etiqueta = esc(texto ?? Datos.ref(id)?.nombre ?? doc?.name ?? id ?? "");
  if (!doc) return `<span class="sbn-sin-enlace" data-tooltip-text="${esc(t("panel.noImportado"))}">${etiqueta}</span>`;
  return `<a class="content-link" draggable="true" data-link data-uuid="${doc.uuid}" data-id="${doc.id}" data-type="${doc.documentName}" data-tooltip-text="${esc(doc.name)}"><i class="fa-solid ${ICONOS[doc.documentName] ?? "fa-file"}" inert></i>${etiqueta}</a>`;
}

const ICONOS = { JournalEntry: "fa-book-open", JournalEntryPage: "fa-file-lines", Actor: "fa-user", Scene: "fa-map", Item: "fa-suitcase" };

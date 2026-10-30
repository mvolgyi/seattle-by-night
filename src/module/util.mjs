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
 * Publica un mensaje de chat que sólo ven los Narradores.
 * `contenido` es HTML ya escapado; se enriquece al renderizar (@UUID funciona).
 */
export function susurrarNarrador(contenido, { titulo = "", clase = "" } = {}) {
  return ChatMessage.create({
    content: `<div class="sbn-chat ${clase}">${titulo ? `<h4>${titulo}</h4>` : ""}${contenido}</div>`,
    speaker: { alias: t("titulo") },
    whisper: idsNarradores(),
    flags: { [SBN.ID]: { origen: "estado" } }
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

/** `@UUID[…]{nombre}` si el documento está en el mundo; si no, el id en texto plano. */
export function enlaceDelLibro(id, texto) {
  const doc = documentoPorId(id);
  return doc ? `@UUID[${doc.uuid}]{${texto ?? doc.name}}` : esc(texto ?? id);
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

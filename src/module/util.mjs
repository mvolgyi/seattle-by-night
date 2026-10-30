import { SBN } from "./constantes.mjs";

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

/** `@UUID[…]{nombre}` si el documento está en el mundo; si no, el id en texto plano. */
export function enlaceDelLibro(id, texto) {
  const doc = documentoDelLibro(id);
  return doc ? `@UUID[${doc.uuid}]{${texto ?? doc.name}}` : esc(texto ?? id);
}

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

/* -------------------------------------------- */
/*  Sello de lo secreto en datos sincronizados  */
/* -------------------------------------------- */

/*
 * Foundry no tiene dónde guardar algo que vean todos los GM y ningún jugador: los
 * settings de mundo (y los de usuario), los journals y los mensajes se le mandan
 * enteros a cada cliente al entrar (dist/packages/world.mjs: `Setting.dump()`,
 * `JournalEntry.dump()` sin filtro por usuario) y cada cambio se reenvía a todos
 * con sus opciones (dist/database/backend/server-backend.mjs: `broadcast.emit
 * ("modifyDocument", …)` con la `operation` del pedido).
 *
 * Lo que el estado guarda y no debe leer un jugador (motivos del Termómetro, qué
 * movimiento de la crónica fue, pruebas marcadas, votos del Consejo) se «sella»:
 * JSON → UTF-8 → XOR con un flujo pseudoaleatorio (mulberry32 sembrado con FNV-1a
 * de una clave fija + un nonce por sello) → base64. Es OFUSCACIÓN, no cifrado: la
 * clave está en este archivo, que baja cualquier cliente. Alcanza para que en
 * game.settings, game.messages y el socket no haya nada legible; no frena a quien
 * lea el código a propósito (que igual podría pedir data/cronica.json por URL).
 * Sólo un GM abre los sellos (Estado); el cliente de un jugador nunca los abre.
 */

const SELLO_PREFIJO = "~1.";
const SELLO_CLAVE = "seattle-by-night|sello|1";

/** FNV-1a de 32 bits. */
function fnv1a(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** XOR de los bytes con el flujo mulberry32 de la clave y el nonce (la misma operación sella y abre). */
function mezclar(bytes, nonce) {
  let a = fnv1a(SELLO_CLAVE + nonce);
  return bytes.map(b => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), a | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return b ^ (((x ^ (x >>> 14)) >>> 0) & 0xff);
  });
}

/** ¿Es un valor sellado por `sellar`? */
export const esSello = s => typeof s === "string" && s.startsWith(SELLO_PREFIJO);

/**
 * Sella un valor serializable a JSON: `"~1.<nonce>.<base64>"`. Dos sellos del mismo
 * valor no se parecen (nonce aleatorio).
 */
export function sellar(valor) {
  const nonce = foundry.utils.randomID(8);
  const bytes = mezclar(new TextEncoder().encode(JSON.stringify(valor ?? null)), nonce);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `${SELLO_PREFIJO}${nonce}.${btoa(bin)}`;
}

/** Los sellos ya abiertos (son únicos por el nonce): el panel lee el registro en cada render. */
const abiertos = new Map();

/**
 * Abre un sello de `sellar`. `undefined` si no es un sello o está roto. Devuelve
 * siempre una copia nueva (el caché no se toca desde afuera).
 */
export function abrirSello(sello) {
  if (!esSello(sello)) return undefined;
  if (!abiertos.has(sello)) {
    let valor;
    try {
      const [nonce, datos] = sello.slice(SELLO_PREFIJO.length).split(".");
      const bytes = mezclar(Uint8Array.from(atob(datos ?? ""), c => c.charCodeAt(0)), nonce ?? "");
      valor = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      valor = undefined;
    }
    if (abiertos.size > 2000) abiertos.clear();
    abiertos.set(sello, valor);
  }
  return foundry.utils.deepClone(abiertos.get(sello));
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

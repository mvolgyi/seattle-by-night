import { t, esc } from "./util.mjs";

/** Tipos de actor de wod5e que tiran dados (system.json → documentTypes.Actor, sin `group`). */
const TIPOS_QUE_TIRAN = new Set(["vampire", "ghoul", "hunter", "mortal", "werewolf", "spc"]);

/**
 * Con qué actor se tira un botón de journal.
 *
 * Orden: el token seleccionado, el personaje del usuario, y si no hay
 * ninguno un diálogo para elegir entre los actores que el usuario controla
 * (el Narrador, entre los de los jugadores y los que tenga en escena).
 */
export async function actorActual({ permitirDialogo = true } = {}) {
  const valido = a => a && TIPOS_QUE_TIRAN.has(a.type) && a.isOwner;

  const token = canvas?.tokens?.controlled?.find(tk => valido(tk.actor));
  if (token) return token.actor;

  if (valido(game.user.character)) return game.user.character;

  if (!permitirDialogo) return null;
  return elegirActor();
}

export function actoresElegibles() {
  const propios = game.actors.filter(a => TIPOS_QUE_TIRAN.has(a.type) && a.isOwner);
  if (!game.user.isGM) return propios;
  // Al Narrador le ofrecemos primero los de los jugadores y los de la escena.
  const enEscena = new Set(canvas?.scene?.tokens.map(tk => tk.actorId) ?? []);
  const primero = propios.filter(a => a.hasPlayerOwner || enEscena.has(a.id));
  return primero.length ? primero : propios;
}

export async function elegirActor(lista = actoresElegibles()) {
  if (!lista.length) {
    ui.notifications.warn(t("tirada.sinActor"));
    return null;
  }
  if (lista.length === 1) return lista[0];

  const opciones = lista
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
    .map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
  const resultado = await foundry.applications.api.DialogV2.input({
    window: { title: t("tirada.elegirActor") },
    classes: ["sbn-dialogo"],
    content: `<div class="form-group"><label>${t("tirada.actor")}</label><select name="actor">${opciones}</select></div>`,
    ok: { label: t("tirada.tirar"), icon: "fa-solid fa-dice-d10" }
  }).catch(() => null);
  return resultado?.actor ? game.actors.get(resultado.actor) : null;
}

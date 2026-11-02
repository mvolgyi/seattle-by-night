import { SBN } from "./constantes.mjs";

/**
 * Idioma de la CRÓNICA (journals, actores, escenas y data/): castellano o
 * inglés (The Ward File). Es del mundo, no del usuario: cada Narrador y cada
 * jugador ven los botones en el idioma de su Foundry (lang/es.json o
 * lang/en.json), pero la crónica importada es una sola. TRADUCCION.md.
 *
 * El setting queda vacío hasta la primera importación. Mientras tanto:
 *   - un mundo que ya tiene la crónica de antes de 2.0.0 la tiene en castellano;
 *   - si no, se propone el idioma de Foundry (inglés si game.i18n.lang es "en").
 */
export const IDIOMAS = ["es", "en"];

export function registrarSettings() {
  game.settings.register(SBN.ID, SBN.SETTINGS.IDIOMA, {
    scope: "world",
    config: false,
    type: String,
    default: "",
    // Lo cambia la importación (importacion.mjs): todos recargan los datos del Panel.
    onChange: () => Hooks.callAll(SBN.HOOK_IDIOMA, idiomaCronica())
  });
}

/** El idioma que se propone si el mundo todavía no eligió. */
export const idiomaPorDefecto = () => (game.i18n.lang === "en" ? "en" : "es");

/** ¿El mundo ya eligió (importó al menos una vez con 2.0.0 o posterior)? */
export const idiomaElegido = () => IDIOMAS.includes(game.settings.get(SBN.ID, SBN.SETTINGS.IDIOMA));

/** ¿Hay en el mundo algo generado por el build? (todo lleva el flag `origen`). */
export function cronicaImportada() {
  const generado = d => !!d.getFlag(SBN.ID, SBN.FLAGS.ORIGEN);
  return game.journal.some(generado) || game.scenes.some(generado) || game.actors.some(generado);
}

/**
 * Idioma de la crónica de este mundo. Sin setting y con documentos del módulo,
 * son de una versión que sólo tenía castellano.
 */
export function idiomaCronica() {
  const v = game.settings.get(SBN.ID, SBN.SETTINGS.IDIOMA);
  if (IDIOMAS.includes(v)) return v;
  return game.journal && cronicaImportada() ? "es" : idiomaPorDefecto();
}

/** Nombre del idioma de la crónica, en el idioma de la interfaz. */
export const nombreIdioma = idioma => game.i18n.localize(`SBN.idioma.${idioma}`);

/** El nombre de un compendio en un idioma: «aventura» o «aventura-en». */
export const packDe = (nombre, idioma) => (idioma === "en" ? `${nombre}-en` : nombre);

/** «data/cronica.json» → «data/en/cronica.json» en inglés. */
export const datosDe = (rel, idioma) => (idioma === "en" ? rel.replace(/^data\//, "data/en/") : rel);

/** ¿De qué idioma es este compendio del módulo? («aventura-en» → "en"). */
export const idiomaDePack = nombre => (/-en$/.test(nombre ?? "") ? "en" : "es");

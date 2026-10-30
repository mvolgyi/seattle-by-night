import { SBN } from "./constantes.mjs";
import { t } from "./util.mjs";

/**
 * Importar la crónica al mundo desde la Aventura del compendio `aventura`
 * (journals, actores, escenas, macros y carpetas). Copiado de DVV.
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
  const resultado = await doc.import({ dialog: false });
  await game.settings.set(SBN.ID, SBN.SETTINGS.IMPORTACION_OFRECIDA, true);
  await game.settings.set(SBN.ID, SBN.SETTINGS.VERSION_OFRECIDA, game.modules.get(SBN.ID).version);

  // La portada queda como escena activa la primera vez (después el Narrador manda).
  const landing = game.scenes.find(s => s.getFlag(SBN.ID, SBN.FLAGS.LANDING));
  if (landing && (primeraVez || !game.scenes.active?.getFlag(SBN.ID, SBN.FLAGS.ORIGEN))) await landing.activate();

  const contar = grupo => Object.values(grupo ?? {}).reduce((a, b) => a + (b?.length ?? 0), 0);
  if (!silencioso) {
    ui.notifications.info(t("importar.hecho", { creados: contar(resultado?.created), actualizados: contar(resultado?.updated) }));
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
 * actualizarla, una vez por versión.
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
    const si = await dialogo.confirm({
      window: { title: t("importar.actualizarTitulo") },
      classes: ["sbn-dialogo"],
      content: `<p>${t("importar.actualizarPregunta", { importada, version })}</p>`,
      yes: { label: t("importar.actualizarSi"), default: true },
      no: { label: t("importar.no") }
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
    no: { label: t("importar.no") }
  });
  await game.settings.set(SBN.ID, SBN.SETTINGS.IMPORTACION_OFRECIDA, true);
  if (si) await importarCronica();
}

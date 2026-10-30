import { SBN } from "./constantes.mjs";

/**
 * El módulo trae sólo lang/es.json, y Foundry carga las traducciones de un
 * paquete únicamente si coinciden con el idioma del cliente
 * (client/helpers/localization.mjs). Con Foundry en inglés, todas las
 * cadenas SBN.* saldrían como claves. Si faltan, se cargan acá los textos en
 * español como respaldo, sin pisar nada que ya exista.
 */
let pendiente = Promise.resolve();

export function asegurarTextos() {
  if (game.i18n.has("SBN.titulo", false)) return pendiente;
  pendiente = foundry.utils.fetchJsonWithTimeout(SBN.ruta("lang/es.json"))
    .then(json => {
      foundry.utils.mergeObject(game.i18n.translations, json, { inplace: true, overwrite: false });
      console.log(`${SBN.ID} | idioma «${game.i18n.lang}»: textos del módulo en español como respaldo`);
    })
    .catch(err => console.error(`${SBN.ID} | no pude cargar lang/es.json:`, err));
  return pendiente;
}

export const textosListos = () => pendiente;

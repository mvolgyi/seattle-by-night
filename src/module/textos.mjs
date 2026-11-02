import { SBN } from "./constantes.mjs";

/**
 * El módulo trae lang/es.json y lang/en.json. Foundry carga las traducciones
 * del idioma del cliente y, si no es inglés, las inglesas como respaldo
 * (client/helpers/localization.mjs, `_fallback`). Con otro idioma (fr, de…)
 * las cadenas SBN.* salen así en inglés. Sólo si tampoco está el inglés (un
 * paquete roto) se cargan acá los textos en español, sin pisar nada.
 */
let pendiente = Promise.resolve();

export function asegurarTextos() {
  if (game.i18n.has("SBN.titulo", true)) return pendiente;
  pendiente = foundry.utils.fetchJsonWithTimeout(SBN.ruta("lang/es.json"))
    .then(json => {
      foundry.utils.mergeObject(game.i18n.translations, json, { inplace: true, overwrite: false });
      console.log(`${SBN.ID} | idioma «${game.i18n.lang}»: textos del módulo en español como respaldo`);
    })
    .catch(err => console.error(`${SBN.ID} | no pude cargar lang/es.json:`, err));
  return pendiente;
}

export const textosListos = () => pendiente;

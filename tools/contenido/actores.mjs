/**
 * content/pnjs, pjs.json, coteries.json, firstlight.json → packs `personajes` y `firstlight`.
 *
 * Adaptado de construirPersonajes / construirArsenal / construirEstados de DVV
 * (tools/construir-contenido.mjs). Diferencias:
 *
 *   - Las fichas completas (atributos + habilidades) son actores `vampire`,
 *     `ghoul` o `mortal` según `tipo`; las de reservas simplificadas
 *     (estandar/excepcionales) y los menores son `spc`, como los PNJ de DVV.
 *   - wod5e no trae compendio de Disciplinas: cada poder es un ítem `power`
 *     embebido (system.discipline, level, cost, dicepool). Sólo con lo que dice
 *     content/: el nombre en inglés de la ficha, el nivel de V5 y, para los
 *     poderes homebrew de David, su descripción del perfil.
 *   - Especialidades: bonuses de la habilidad, con la forma que usa wod5e al
 *     migrar especialidades (system/scripts/migration/migrate-specialties.js).
 *   - Ventajas y defectos: ítems `feature` (featuretype background/merit/flaw).
 *   - Coteries: actores `group` (groupType coterie, chasse/lien/portillon).
 *   - Cazadores (`tipo: "hunter"`, content/pnjs/cazadores.json): actores
 *     `hunter` con el Credo (ítem `creed`, con sus campos de Desesperación),
 *     el Impulso (ítem `drive`, con la redención), las Facultades
 *     (system.edges.<id>) y sus Beneficios (ítems `perk` con system.edge).
 *     La Célula (`celula` en el mismo archivo) es un actor `group` con
 *     groupType cell, Desesperación y Peligro; cada cazador la lleva en
 *     system.group, de donde wod5e toma la Desesperación (actor/actor.js).
 *
 * Modelo de datos (wod5e 5.3.28, ~/.local/share/FoundryVTT/Data/systems/wod5e):
 *   actor   system/actor/data-models/{base-actor-model,spc-actor-model,group-actor-model}.js
 *           fields/{attribute,skill,vampire,coterie,setting,hunter,cell}-fields.js
 *   ítems   system/item/data-models/{base-item-model,vtm/*,shared/*,htr/*}.js
 *   defs    system/api/def/{disciplines,edges,features,itemtypes,weapons}.js
 */
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { RAIZ, MODULO, STATS, escribirDoc, Carpetas, leerJson, slug } from "../util.mjs";
import { ID, fichas, tieneActor, journals, clavePagina } from "./ids.mjs";

const existe = rel => fs.existsSync(path.join(RAIZ, rel));

/** Retrato y token generados en la fase 6 (assets/retratos, assets/tokens), si existen. */
const RUTA_MODULO = `modules/${MODULO}/`;
const arteDe = (carpeta, id) => existe(`assets/${carpeta}/${id}.webp`) ? `${RUTA_MODULO}assets/${carpeta}/${id}.webp` : null;
const retratoDe = id => arteDe("retratos", id) ?? arteDe("tokens", id) ?? ICONO_ACTOR;
const tokenDe = id => arteDe("tokens", id) ?? ICONO_ACTOR;
const md2html = md => marked.parse(md ?? "", { async: false }).trim();
const md2inline = md => marked.parseInline(md ?? "", { async: false });

const CRONICA = "Seattle by Night";
const ICONO_ACTOR = "icons/svg/mystery-man.svg";
const ICONO_ITEM = "systems/wod5e/assets/icons/items/item-default.svg";
const ICONO_RASGO = "systems/wod5e/assets/icons/items/feature.svg";   // api/def/itemtypes.js#feature
const ICONO_PODER = "systems/wod5e/assets/icons/items/discipline.png"; // api/def/itemtypes.js#power
const ICONO = {
  weapon: "icons/weapons/guns/gun-pistol-brass.webp",
  rifle: "icons/weapons/guns/rifle-assault-carbine.webp",
  gear: "icons/containers/bags/pack-leather-black-brown.webp",
  armor: "icons/equipment/chest/breastplate-banded-leather-brown.webp",
  condition: ICONO_ITEM
};

/* -------------------------------------------- */
/*  Tablas                                      */
/* -------------------------------------------- */

const NOMBRE_CLAN = {
  brujah: "Brujah", gangrel: "Gangrel", malkavian: "Malkavian", nosferatu: "Nosferatu",
  toreador: "Toreador", tremere: "Tremere", ventrue: "Ventrue", caitiff: "Caitiff", thinblood: "Sangre débil"
};

const NOMBRE_DISCIPLINA = {
  animalism: "Animalismo", auspex: "Auspex", celerity: "Celeridad", dominate: "Dominación",
  fortitude: "Fortaleza", obfuscate: "Ofuscación", potence: "Potencia", presence: "Presencia",
  protean: "Protean", sorcery: "Hechicería de sangre", oblivion: "Oblivion",
  alchemy: "Alquimia de sangre débil", rituals: "Rituales", ceremonies: "Ceremonias"
};

/** Claves válidas (system/api/def/disciplines.js). */
const DISCIPLINAS = new Set(Object.keys(NOMBRE_DISCIPLINA));

/**
 * Nivel de V5 de cada poder que aparece en content/ (dato de juego, no texto
 * del manual). Lo usa la hoja para ordenar los poderes. Un poder que no esté
 * acá y que el perfil no gradúe queda en nivel 0 con un aviso.
 */
const NIVEL_V5 = {
  alchemy: { "Far Reach": 1 },
  animalism: { "Bond Famulus": 1, "Sense the Beast": 1, "Feral Whispers": 2, "Quell the Beast": 3 },
  auspex: { "Heightened Senses": 1, "Premonition": 2, "Scry the Soul": 3, "Share the Senses": 3 },
  celerity: { "Cat's Grace": 1, "Rapid Reflexes": 1, "Fleetness": 2, "Blink": 3, "Lightning Strike": 5 },
  dominate: { "Cloud Memory": 1, "Compel": 1, "Mesmerize": 2, "Forgetful Mind": 3, "Rationalize": 4 },
  fortitude: { "Resilience": 1, "Unswayable Mind": 1, "Toughness": 2, "Defy Bane": 3 },
  obfuscate: { "Cloak of Shadows": 1, "Unseen Passage": 2, "Mask of a Thousand Faces": 3, "Vanish": 4 },
  potence: { "Lethal Body": 1, "Soaring Leap": 1, "Prowess": 2, "Spark of Rage": 3, "Uncanny Grip": 3, "Draught of Might": 4 },
  presence: { "Awe": 1, "Daunt": 1, "Lingering Kiss": 2, "Dread Gaze": 3, "Entrancement": 3, "Irresistible Voice": 4, "Majesty": 5 },
  protean: { "Eyes of the Beast": 1, "Feral Weapons": 2, "Earth Meld": 3 },
  sorcery: { "Corrosive Vitae": 1, "Extinguish Vitae": 2, "Blood of Potency": 3, "Theft of Vitae": 4 },
  rituals: { "Blood Walk": 1, "Ward against Ghouls": 1, "Communicate with Kindred Sire": 2 }
};

/**
 * Reservas de poderes que content/ da explícitas (system.dicepool, como
 * {d1: {path}}: system/actor/scripts/item-roll.js). Se cita la fuente.
 */
const RESERVAS_PODER = {
  // content/personajes/PJ-01.md, Bala Cinética: «Ataque: Destreza + Atletismo + Potencia».
  "PJ-01|potence|Bala Cinética": ["attributes.dexterity", "skills.athletics", "disciplines.potence"],
  // content/pnjs/combate.json, PNJ-03: «Dominación: Manipulación + Dominación. Usa Obligar y Mente olvidadiza».
  "PNJ-03|dominate|Compel": ["attributes.manipulation", "disciplines.dominate"],
  "PNJ-03|dominate|Forgetful Mind": ["attributes.manipulation", "disciplines.dominate"],
  // content/pnjs/combate.json, PNJ-03: «Mirada aterradora (Presencia 3): Carisma + Intimidación».
  "PNJ-03|presence|Dread Gaze": ["attributes.charisma", "skills.intimidation"]
};

/** Disposición del token: −1 hostil, 0 neutral, 1 amistosa. */
const HOSTILES = new Set(["PNJ-12", "PNJ-03", "PNJ-19", "PNJ-18", "PNJ-21", "MEN-02", "MEN-11", "MEN-04", "MEN-04-DAWSON",
  "CAZ-01", "CAZ-02", "CAZ-03"]);

/**
 * Credos de H5 → [nombre, campos de Desesperación]. Copiado de DVV
 * (construirPersonajes, CAMPOS_CREDO). El texto va a creed.system.desperationFields
 * (item/data-models/htr/creed-item-model.js) y a headers.creedfields.
 */
export const CAMPOS_CREDO = {
  underground: ["Clandestinos", "Sigilo y subterfugio en servicio de la Caza."],
  entrepreneurial: ["Emprendedores", "Construir, inventar, aumentar o reparar durante la Caza."],
  faithful: ["Fieles", "Cualquier conflicto directo (físico, social o mental) con lo sobrenatural durante la Caza."],
  inquisitive: ["Inquisitivos", "Obtener información durante la Caza: documentación, allanamiento de morada e interrogatorio."],
  martial: ["Marciales", "Conflicto físico durante la Caza (no necesita ser con la presa ni con lo sobrenatural)."]
};

/** Facultades (system/api/def/edges.js), con la etiqueta de lang/es/hunter-es.json; las que no la traen (turncoat, experimentalmedicine, cleansetheunnatural, greatdestiny, unnaturalchanges), traducción propia. */
export const NOMBRE_FACULTAD = {
  arsenal: "Arsenal", fleet: "Flota", ordnance: "Artillería", library: "Biblioteca",
  improvisedgear: "Equipamiento improvisado", globalaccess: "Acceso global", dronejockey: "Piloto de drones",
  beastwhisperer: "Encantador de bestias", sensetheunnatural: "Sentir lo antinatural",
  repeltheunnatural: "Repeler lo antinatural", thwarttheunnatural: "Frustrar lo antinatural",
  artifact: "Artefacto", turncoat: "Desertor", experimentalmedicine: "Medicina experimental",
  cleansetheunnatural: "Purificar lo antinatural", greatdestiny: "Gran destino", unnaturalchanges: "Cambios antinaturales"
};

/** «Nombre: descripción» de un Beneficio → { nombre, descripcion }. */
export function parsearBeneficio(texto) {
  const i = texto.indexOf(":");
  return i < 0 ? { nombre: texto.trim(), descripcion: "" } : { nombre: texto.slice(0, i).trim(), descripcion: texto.slice(i + 1).trim() };
}
const AMISTOSOS = new Set(["PNJ-04", "PNJ-05"]);

/** Ventajas que son Trasfondos de V5; el resto de las ventajas son Méritos. */
const TRASFONDO = /^(Aliados?|Contactos|Fama|Influencia|Refugio|Rebaño|Recursos|Máscara|Mawla|Estatus)\b/i;

/* -------------------------------------------- */
/*  Marcadores de content/ (CONTRATO.md)        */
/* -------------------------------------------- */

const escapar = s => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** @ID, @tirada, @termometro, @pista, @reloj → HTML del contrato. */
function expandir(md, ctx, origen) {
  if (!md) return "";
  return String(md)
    .replace(/@ID\[([^\]|]+)(?:\|([^\]]+))?\]/g, (_, id, texto) => {
      const r = ctx.reg.get(id.trim());
      if (!r) {
        ctx.avisos.push(`actores: ${origen}: @ID[${id}] no está en el registro (queda como texto).`);
        return texto ?? id;
      }
      return `@UUID[${r.uuid}]{${texto ?? r.nombre}}`;
    })
    .replace(/@tirada\{([^|}]*)\|([^|}]*)\|([^}]*)\}/g, (_, paths, dif, texto) =>
      `<a class="sbn-tirada" data-sbn-tirada="${escapar(paths.split(/[+\s]+/).filter(Boolean).join(" "))}" data-dificultad="${escapar(dif || 0)}" data-label="${escapar(texto)}"><i class="fa-solid fa-dice-d10"></i> ${texto}</a>`)
    .replace(/@termometro\{([^|}]*)(?:\|([^}]*))?\}/g, (_, cambio, motivo = "") =>
      `<button type="button" class="sbn-termometro" data-sbn-termometro="${escapar(cambio)}" data-motivo="${escapar(motivo)}"><i class="fa-solid fa-temperature-half"></i> Termómetro ${escapar(cambio)}</button>`)
    .replace(/@pista\{([^}]+)\}/g, (_, id) => {
      const r = ctx.reg.get(id.trim());
      if (!r) ctx.avisos.push(`actores: ${origen}: @pista{${id}} no está en el registro.`);
      return `<button type="button" class="sbn-pista" data-sbn-pista="${escapar(id)}"><i class="fa-solid fa-magnifying-glass"></i> ${r?.nombre ?? id}</button>`;
    })
    .replace(/@reloj\{(\d+)\}/g, (_, n) => `<span class="sbn-reloj" data-sbn-reloj="${n}">Noche ${n}</span>`);
}

const html = (md, ctx, origen) => md2html(expandir(md, ctx, origen));
const inline = (md, ctx, origen) => md2inline(expandir(md, ctx, origen));

/** «… (PNJ-09)» o «PNJ-03» → texto legible, sin @UUID (los headers son StringField). */
function textoPlano(s, ctx) {
  if (!s) return "";
  const r = ctx.reg.get(String(s).trim());
  return r ? r.nombre : String(s);
}

/* -------------------------------------------- */
/*  Ítems embebidos                             */
/* -------------------------------------------- */

const SISTEMA_ITEM = (extra = {}) => ({
  description: "", macroid: "", bonuses: [], dataItemId: "",
  source: { book: CRONICA, page: "" }, ...extra
});

/**
 * Semillas de ítems embebidos por nombre, no por posición (reordenar la lista
 * en content/ no cambia los _id del mundo). Si dos se llaman igual, el segundo
 * lleva «:2», el tercero «:3»… en el orden de content/.
 */
function semillas() {
  const vistas = new Map();
  return (prefijo, nombre) => {
    const base = `${prefijo}:${slug(String(nombre ?? "")) || "sin-nombre"}`;
    const n = (vistas.get(base) ?? 0) + 1;
    vistas.set(base, n);
    return n === 1 ? base : `${base}:${n}`;
  };
}

function embebido(aid, clave, doc) {
  const iid = ID.itemDe(aid, clave);
  return { effects: [], sort: 0, flags: {}, ...doc, _id: iid, _key: `!actors.items!${aid}.${iid}` };
}

/**
 * «Recursos 3 (presupuesto federal)» → { nombre: "Recursos", puntos: 3 }.
 * La descripción siempre lleva el texto entero: no se pierde nada.
 */
function parsearRasgo(texto) {
  // «Contactos (finanzas) 2», «Sueños de guerra (trauma del Abrazo) 2: …»
  let m = /^([^(:]+?) (\([^)]+\)) (\d)(?=$|[\s:.,;])/.exec(texto);
  if (m) return { nombre: `${m[1]} ${m[2]}`, puntos: Number(m[3]) };
  m = /^([^(:.]+?) (\d)(?=$|\s*[(:.,;])/.exec(texto);                   // «Ira contenida 2: …»
  if (m) return { nombre: m[1].trim(), puntos: Number(m[2]) };
  let nombre = texto.split(/ \(|:|\. /)[0].trim();
  if (nombre.length > 48) nombre = nombre.slice(0, 45).replace(/\s+\S*$/, "") + "…";
  return { nombre, puntos: 0 };
}

/** «Rebaño 1 y Aliados 1 (los chicos…)» → dos rasgos con la misma descripción. */
function partirRasgos(texto) {
  const m = /^([^\d(]+? \d) y ([^\d(]+? \d)(.*)$/.exec(texto);
  if (m && TRASFONDO.test(m[1]) && TRASFONDO.test(m[2])) return [m[1] + m[3], m[2] + m[3]].map(t => ({ t, original: texto }));
  return [{ t: texto, original: texto }];
}

function rasgos(aid, lista, tipoDefecto, prefijo, ctx, origen) {
  const out = [];
  const semilla = semillas();
  (lista ?? []).forEach(texto => {
    partirRasgos(texto).forEach(({ t, original }) => {
      const { nombre, puntos } = parsearRasgo(t);
      const featuretype = tipoDefecto === "flaw" ? "flaw" : (TRASFONDO.test(t) ? "background" : "merit");
      out.push(embebido(aid, semilla(prefijo, nombre), {
        name: nombre, type: "feature", img: ICONO_RASGO,
        system: SISTEMA_ITEM({
          description: `<p>${inline(original, ctx, origen)}</p>`,
          uses: { current: 0, max: 0, enabled: false },
          points: puntos, featuretype
        }),
        flags: { [MODULO]: { origen: "actor", rasgo: original } }
      }));
    });
  });
  return out;
}

/* -------------------------------------------- */
/*  Poderes                                     */
/* -------------------------------------------- */

/**
 * Lee del perfil (content/personajes/<id>.md) las viñetas de poderes:
 *   - **Español** (Disciplina N[ homebrew]; *English*): descripción
 * y sus sub-viñetas. Devuelve índices por nombre inglés y por nombre español.
 */
function poderesDelPerfil(journal) {
  const porIngles = new Map(), porEspanol = new Map();
  if (!journal) return { porIngles, porEspanol };
  const lineas = journal.cuerpo.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    const m = /^- \*\*(.+?)\*\* \(([^)]*)\)(?::\s*(.*))?$/.exec(lineas[i]);
    if (!m) continue;
    const [, es, parentesis, resto = ""] = m;
    const en = /\*([^*]+)\*/.exec(parentesis)?.[1] ?? null;
    const nivelTxt = /(\d)|(•+)/.exec(parentesis);
    const nivel = nivelTxt ? (nivelTxt[1] ? Number(nivelTxt[1]) : nivelTxt[2].length) : null;
    const sub = [];
    for (let k = i + 1; k < lineas.length && /^\s{2,}- /.test(lineas[k]); k++) sub.push(lineas[k]);
    // Sin texto propio, las sub-viñetas suben un nivel (si no, Markdown las anida bajo la primera).
    if (!resto) for (let k = 0; k < sub.length; k++) sub[k] = sub[k].replace(/^\s{2}/, "");
    const desc = [resto, ...sub].filter(Boolean).join("\n").trim();
    const p = { es, en, nivel, desc, homebrew: /homebrew/i.test(parentesis) };
    porEspanol.set(es, p);
    if (en) porIngles.set(en, p);
  }
  return { porIngles, porEspanol };
}

/** «Bala Cinética (homebrew, amalgama Celeridad 2)» → { nombre, homebrew, nota }. */
function parsearPoder(texto) {
  const m = /^(.+?)\s*\((homebrew)(?:,\s*([^)]*))?\)$/i.exec(texto);
  if (!m) return { nombre: texto, homebrew: false, nota: "" };
  return { nombre: m[1].trim(), homebrew: true, nota: m[3]?.trim() ?? "" };
}

function poderes(f, aid, journal, ctx) {
  const items = [];
  const perfil = poderesDelPerfil(journal);
  for (const [disc, [valor, lista]] of Object.entries(f.disciplinas ?? {})) {
    if (!DISCIPLINAS.has(disc)) {
      ctx.avisos.push(`actores: ${f.id}: disciplina «${disc}» no existe en wod5e (system/api/def/disciplines.js).`);
      continue;
    }
    for (const texto of lista ?? []) {
      const { nombre, homebrew, nota } = parsearPoder(texto);
      const delPerfil = perfil.porIngles.get(nombre) ?? perfil.porEspanol.get(nombre);
      let nivel = delPerfil?.nivel ?? NIVEL_V5[disc]?.[nombre] ?? null;
      const nivelV5 = NIVEL_V5[disc]?.[nombre];
      if (delPerfil?.nivel != null && nivelV5 != null && delPerfil.nivel !== nivelV5) {
        ctx.avisos.push(`actores: ${f.id}: el perfil pone «${delPerfil.es}» (${nombre}) a nivel ${delPerfil.nivel}; en V5 es ${nivelV5}. Manda el perfil.`);
      }
      if (nivel == null) {
        ctx.avisos.push(`actores: ${f.id}: «${texto}» (${disc}) sin nivel en content/ ni en la tabla V5: queda en 0.`);
        nivel = 0;
      }
      if (valor != null && nivel > valor) {
        ctx.avisos.push(`actores: ${f.id}: «${nombre}» es de nivel ${nivel} y ${NOMBRE_DISCIPLINA[disc]} está a ${valor}.`);
      }
      const nombreFinal = delPerfil && !homebrew && delPerfil.es !== nombre ? `${nombre} · ${delPerfil.es}` : nombre;

      // Descripción: sólo lo que dice content/. Homebrew: la viñeta del perfil
      // y, si el perfil le dedica una página (`## Nombre`), un enlace a ella.
      const partes = [];
      if (homebrew) partes.push(`<p><em>Homebrew${nota ? ` (${nota})` : ""}.</em></p>`);
      if (delPerfil?.desc) partes.push(html(delPerfil.desc, ctx, f.id));
      const pagina = journal?.paginas.find(p => p.nombre === nombre);
      if (pagina) {
        const jid = ID.journal(journal.id);
        partes.push(`<p>@UUID[JournalEntry.${jid}.JournalEntryPage.${ID.pagina(jid, clavePagina(pagina))}]{${nombre}}</p>`);
        partes.push(html(pagina.md, ctx, `${f.id}#${nombre}`));
      }
      if (homebrew && !delPerfil?.desc && !pagina) {
        partes.push(`<p>El libro no lo describe.</p>`);
        ctx.avisos.push(`actores: ${f.id}: el poder homebrew «${nombre}» no tiene descripción en content/.`);
      }
      if (!homebrew) partes.push(`<p><em>${NOMBRE_DISCIPLINA[disc]} ${nivel || ""}. Poder del manual básico de V5.</em></p>`);
      const descripcion = partes.join("");

      // Coste en Enardecimientos: sólo si content/ lo da.
      const textoCoste = [delPerfil?.desc ?? "", pagina?.md ?? ""].join("\n");
      const mc = /Coste:?\**:?[\s\S]{0,40}?(\d+)\s+(?:tirada de )?Enardecimiento/i.exec(textoCoste);
      const cost = mc ? Number(mc[1]) : 0;

      const reserva = RESERVAS_PODER[`${f.id}|${disc}|${nombre}`] ?? [];
      items.push(embebido(aid, `poder:${disc}:${nombre}`, {
        name: nombreFinal, type: "power", img: ICONO_PODER, sort: nivel * 100,
        system: SISTEMA_ITEM({
          description: descripcion,
          source: { book: CRONICA, page: f.id },
          level: nivel, cost,
          dicepool: Object.fromEntries(reserva.map((p, j) => [`d${j + 1}`, { path: p }])),
          discipline: disc, selected: false
        }),
        flags: { [MODULO]: { origen: "actor", poder: texto, homebrew } }
      }));
    }
  }
  return items;
}

/** system.disciplines (ObjectField libre: system/actor/vtm/scripts/prepare-data.js). */
function disciplinas(f) {
  return Object.fromEntries(Object.entries(f.disciplinas ?? {})
    .filter(([d]) => DISCIPLINAS.has(d))
    .map(([d, [valor]]) => [d, { value: valor ?? 0, visible: true, description: "", selected: false }]));
}

/* -------------------------------------------- */
/*  Habilidades y especialidades                */
/* -------------------------------------------- */

/** Forma de MigrateSpecialties: activa a mano desde el diálogo de tirada. */
const especialidad = (skill, texto) => ({
  source: texto, value: 1, paths: [`skills.${skill}`],
  displayWhenInactive: true, activeWhen: { check: "never" }
});

const valorYEspecialidad = v => Array.isArray(v) ? [v[0], v[1] ?? null] : [v, null];

function habilidades(lista, { activa = false } = {}) {
  return Object.fromEntries(Object.entries(lista ?? {}).map(([k, v]) => {
    const [valor, esp] = valorYEspecialidad(v);
    return [k, { value: valor, active: activa, description: "", macroid: "", bonuses: esp ? [especialidad(k, esp)] : [] }];
  }));
}

/* -------------------------------------------- */
/*  Textos del actor                            */
/* -------------------------------------------- */

function piedrasYConvicciones(f, ctx) {
  const partes = [];
  if (f.convicciones?.length) {
    partes.push(`<h3>Convicciones</h3><ul>${f.convicciones.map(c => `<li>${inline(c, ctx, f.id)}</li>`).join("")}</ul>`);
  }
  if (f.piedrasDeToque?.length) {
    partes.push(`<h3>Piedras de toque</h3><ul>${f.piedrasDeToque.map(p => {
      const desc = p.descripcion ?? "";
      const texto = desc.toLowerCase().startsWith(String(p.nombre).toLowerCase())
        ? inline(desc, ctx, f.id)
        : `<strong>${inline(p.nombre, ctx, f.id)}</strong>${desc ? `: ${inline(desc, ctx, f.id)}` : ""}`;
      return `<li>${texto}</li>`;
    }).join("")}</ul>`);
  }
  return partes.join("");
}

function equipoHtml(f, ctx, idsFirstlight) {
  const libres = (f.equipo ?? []).filter(e => !idsFirstlight.has(e));
  return libres.length ? `<ul>${libres.map(e => `<li>${inline(e, ctx, f.id)}</li>`).join("")}</ul>` : "";
}

function biografia(f, ctx, { perfil, coteries }) {
  const filas = [];
  const fila = (k, v) => v != null && v !== "" && filas.push(`<tr><th>${k}</th><td>${v}</td></tr>`);
  fila("Apodo", f.apodo && inline(f.apodo, ctx, f.id));
  fila("Concepto", f.concepto && inline(f.concepto, ctx, f.id));
  fila("Clan", f.clan && NOMBRE_CLAN[f.clan]);
  fila("Secta", f.secta && inline(f.secta, ctx, f.id));
  fila("Sire", f.sire && (ctx.reg.has(f.sire) ? inline(`@ID[${f.sire}]`, ctx, f.id) : inline(f.sire, ctx, f.id)));
  fila("Nacimiento", f.nacimiento);
  fila("Abrazo", f.abrazado);
  fila("Edad", f.edad);
  fila("Depredador", f.depredador && inline(f.depredador, ctx, f.id));
  fila("Resonancia", f.resonancia);
  fila("Ambición", f.ambicion && inline(f.ambicion, ctx, f.id));
  fila("Deseo", f.deseo && inline(f.deseo, ctx, f.id));
  if ((f.cantidad ?? 1) > 1) fila("Cantidad", f.cantidad);
  if (f.reservas) fila("Reservas", Object.entries(f.reservas).map(([k, v]) => `${k} ${v}`).join(" · "));
  if (f.alternativa) fila("Plantilla", "alternativa");
  if (f.foco?.length) fila("Foco", f.foco.map(e => inline(`@ID[${e}]`, ctx, f.id)).join(", "));
  fila("Brilla en", f.brillaEn && inline(f.brillaEn, ctx, f.id));
  if (coteries.length) fila("Coterie", coteries.map(c => inline(`@ID[${c.id}|${c.nombre}]`, ctx, f.id)).join(", "));

  const partes = [];
  if (perfil) partes.push(`<p>@UUID[${perfil.uuid}]{Perfil: ${perfil.nombre}}</p>`);
  if (f.cita) partes.push(`<blockquote><p><em>${inline(f.cita, ctx, f.id)}</em></p></blockquote>`);
  if (filas.length) partes.push(`<table class="sbn-ficha"><tbody>${filas.join("")}</tbody></table>`);
  if (f.semblante) partes.push(`<h3>Semblante</h3><p>${inline(f.semblante, ctx, f.id)}</p>`);
  if (f.notas) partes.push(html(f.notas, ctx, f.id));
  const combate = ctx.combate[f.id];
  if (combate) partes.push(`<section class="sbn-combate">${html(combate, ctx, `combate.json#${f.id}`)}</section>`);
  return partes.join("");
}

/**
 * Notas del Narrador: notas de edición y datos provisionales del doc 16.
 * Un PJ no las lleva: las notas privadas las ve el dueño del actor (el
 * jugador). Van a la página {narrador} «Notas de edición» de su perfil
 * (journals.mjs, notasDeEdicionPJ).
 */
function notasPrivadas(f, ctx) {
  if (f.pj) return "";
  const partes = [];
  if (f.nota) partes.push(html(f.nota, ctx, f.id));
  if (f.provisional?.length) partes.push(`<h3>Provisional (doc 16)</h3><ul>${f.provisional.map(p => `<li>${inline(p, ctx, f.id)}</li>`).join("")}</ul>`);
  return partes.join("");
}

/* -------------------------------------------- */
/*  FIRSTLIGHT                                  */
/* -------------------------------------------- */

/** Ítem de firstlight.json (pack o embebido). Armadura si el content da blindaje. */
function itemFirstlight(e, ctx) {
  const tipo = e.blindaje != null ? "armor" : e.tipo;
  const partes = [`<p>${inline(e.efecto, ctx, `firstlight.json#${e.id}`)}</p>`];
  const filas = [];
  if (e.dano != null) filas.push(["Daño", `${e.dano}${e.agravado ? " agravado" : ""}`]);
  else if (e.agravado) filas.push(["Daño", "agravado contra Vástagos"]);
  if (e.blindaje != null) filas.push(["Blindaje", e.blindaje]);
  if (filas.length) partes.unshift(`<table class="sbn-ficha"><tbody>${filas.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</tbody></table>`);
  if (e.estado) {
    const r = ctx.reg.get(e.estado);
    partes.push(`<p>Estado: ${r ? `@UUID[${r.uuid}]{${r.nombre}}` : e.estado}</p>`);
  }
  for (const t of e.tiradas ?? []) partes.push(`<p>${inline(t, ctx, `firstlight.json#${e.id}`)}</p>`);
  if (e.termometro) partes.push(`<p>${expandir(`@termometro{+${e.termometro.cantidad}|${e.termometro.motivo}}`, ctx, e.id)} (máximo +${e.termometro.maximoPorEscena} por escena)</p>`);

  const bonuses = (e.bonos ?? []).map(b => ({
    source: e.nombre, value: b.valor, paths: b.selectores,
    displayWhenInactive: true, activeWhen: { check: "always", path: "", value: "" }
  }));
  const base = SISTEMA_ITEM({ description: partes.join(""), bonuses, source: { book: CRONICA, page: `FIRSTLIGHT (doc ${e.origen})` } });
  let system;
  if (tipo === "weapon") {
    // Reserva de armas de fuego de V5; content/ la usa igual (dron-termico: «Destreza + Armas de fuego»).
    system = { ...base, weaponType: "ranged", weaponvalue: e.dano ?? 0, uses: { current: 0, max: 0, enabled: false }, quantity: 1,
      dicepool: { d1: { path: "attributes.dexterity" }, d2: { path: "skills.firearms" } } };
  } else if (tipo === "armor") {
    system = { ...base, armorvalue: e.blindaje, quantity: 1 };
  } else if (tipo === "condition") {
    system = { ...base, suppressed: false, effects: {} };
  } else {
    system = { ...base, uses: { current: 0, max: 0, enabled: false }, quantity: 1, dicepool: {} };
  }
  const img = tipo === "weapon" ? (/fusil/i.test(e.nombre) ? ICONO.rifle : ICONO.weapon) : ICONO[tipo] ?? ICONO_ITEM;
  return { name: e.nombre, type: tipo, img, system, flags: { [MODULO]: { origen: "firstlight", id: e.id, agravado: !!e.agravado } } };
}

function construirFirstlight(ctx) {
  const carpetas = new Carpetas("firstlight", "Item");
  const CARPETA = { weapon: "Armas", armor: "Protección", gear: "Equipo", condition: "Estados" };
  let n = 0;
  for (const [i, e] of ctx.firstlight.entries()) {
    const id = ID.item(e.id);
    const doc = itemFirstlight(e, ctx);
    escribirDoc("firstlight", {
      _id: id, _key: `!items!${id}`, ...doc,
      folder: carpetas.id(CARPETA[doc.type]), sort: i * 10,
      effects: [], ownership: { default: 0 },
      _stats: STATS
    });
    n++;
  }
  carpetas.escribir();
  return n;
}

/* -------------------------------------------- */
/*  Cazadores y Célula (H5)                     */
/* -------------------------------------------- */

/** La Célula de la ficha: la primera `celula` de content/pnjs/*.json que la lista como miembro. */
const celulaDe = (f, ctx) => ctx.celulas.find(c => c.miembros.includes(f.id)) ?? null;

/**
 * Completa `system` e `items` de un actor hunter:
 *   creed   ítem (item/data-models/htr/creed-item-model.js: edges, drives, desperationFields)
 *   drive   ítem (htr/drive-item-model.js: redemption)
 *   perk    ítems (htr/perk-item-model.js: edge, selected), uno por Beneficio
 *   system.edges.<id> = { value, visible, description, selected } (ObjectField libre,
 *           actor/data-models/fields/hunter-fields.js; forma de actor/htr/scripts/prepare-data.js)
 *   system.headers.creedfields / cellname (base-actor-model.js), system.despair (hunter-fields.js)
 *   system.group = id del actor de la Célula (actor/actor.js lee de ahí la Desesperación)
 */
function aplicarCazador(f, ctx, aid, system, items) {
  const [credoNombre, campos] = CAMPOS_CREDO[f.credo] ?? [f.credo ?? "", ""];
  if (f.credo && !CAMPOS_CREDO[f.credo]) ctx.avisos.push(`actores: ${f.id}: credo «${f.credo}» desconocido.`);
  if (f.credo) {
    items.push(embebido(aid, "credo", {
      name: credoNombre, type: "creed", img: ICONO_ITEM,
      system: SISTEMA_ITEM({ edges: "", drives: "", desperationFields: campos }),
      flags: { [MODULO]: { origen: "actor", credo: f.credo } }
    }));
  }
  if (f.impulso) {
    items.push(embebido(aid, "impulso", {
      name: f.impulso.nombre, type: "drive", img: ICONO_ITEM,
      system: SISTEMA_ITEM({
        description: f.impulso.texto ? html(f.impulso.texto, ctx, f.id) : "",
        redemption: f.impulso.redencion ? html(f.impulso.redencion, ctx, f.id) : ""
      }),
      flags: { [MODULO]: { origen: "actor", impulso: f.impulso.clave ?? f.impulso.nombre } }
    }));
  }

  system.edges = {};
  const semilla = semillas();
  for (const [edge, [valor, beneficios = []]] of Object.entries(f.facultades ?? {})) {
    if (!NOMBRE_FACULTAD[edge]) {
      ctx.avisos.push(`actores: ${f.id}: Facultad «${edge}» no existe en wod5e (system/api/def/edges.js).`);
      continue;
    }
    system.edges[edge] = {
      value: valor ?? 0, visible: true, selected: false,
      description: f.facultadesNotas?.[edge] ? html(f.facultadesNotas[edge], ctx, f.id) : ""
    };
    beneficios.forEach((texto, i) => {
      const { nombre, descripcion } = parsearBeneficio(texto);
      items.push(embebido(aid, semilla(`beneficio:${edge}`, nombre), {
        name: nombre, type: "perk", img: ICONO_ITEM, sort: i * 100,
        system: SISTEMA_ITEM({ description: descripcion ? html(descripcion, ctx, f.id) : "", source: { book: CRONICA, page: f.id }, edge, selected: false }),
        flags: { [MODULO]: { origen: "actor", beneficio: texto } }
      }));
    });
  }

  const celula = celulaDe(f, ctx);
  system.group = celula ? ID.actor(celula.id) : "";
  system.headers.creedfields = campos;
  system.headers.cellname = celula?.nombre ?? "";
  system.despair = { value: 0 };

  // Biografía: Credo, Impulso y Facultades a la vista; el pregenerado, enlazado.
  const filas = [];
  const fila = (k, v) => v && filas.push(`<tr><th>${k}</th><td>${v}</td></tr>`);
  fila("Célula", celula && inline(`@ID[${celula.id}|${celula.nombre}]`, ctx, f.id));
  fila("Credo", credoNombre && `${credoNombre}. <em>Desesperación:</em> ${campos}`);
  fila("Impulso", f.impulso && `${f.impulso.nombre}${f.impulso.redencion ? `. <em>Redención:</em> ${inline(f.impulso.redencion, ctx, f.id)}` : ""}`);
  fila("Facultades", Object.entries(f.facultades ?? {}).map(([e, [, b = []]]) =>
    `${NOMBRE_FACULTAD[e] ?? e}${b.length ? ` (${b.map(t => parsearBeneficio(t).nombre).join(", ")})` : ""}`).join(" · "));
  const bloque = [`<h3>Cazador</h3><table class="sbn-ficha"><tbody>${filas.join("")}</tbody></table>`];
  if (f.impulso?.texto) bloque.push(`<p>${inline(f.impulso.texto, ctx, f.id)}</p>`);
  system.biography += bloque.join("");
  const pre = f.pregenerado && ctx.reg.get(f.pregenerado);
  if (f.pregenerado && !pre) ctx.avisos.push(`actores: ${f.id}: pregenerado ${f.pregenerado} no está en el registro.`);
  if (pre) system.biography += `<p>@UUID[${pre.uuid}]{Pregenerado: ${pre.nombre}}</p>`;

  // Lo inventado para el módulo, a la vista del Narrador (de un PJ, en su perfil: ver notasPrivadas).
  if (f.propuesto?.length && !f.pj) {
    system.privatenotes += `<h3>Propuesto (no está en los docs)</h3><ul>${f.propuesto.map(p => `<li>${inline(p, ctx, f.id)}</li>`).join("")}</ul>`;
  }
}

/** Actor group/cell (system/actor/data-models/group-actor-model.js + fields/cell-fields.js). */
function construirCelula(c, ctx, carpetas) {
  const aid = ID.actor(c.id);
  const perfil = ["journal", "pagina"].includes(ctx.reg.get(c.id)?.tipo) ? ctx.reg.get(c.id) : null;
  const enlaces = ids => (ids ?? []).map(id => inline(`@ID[${id}]`, ctx, c.id)).join(", ");
  const fila = (k, v) => v ? `<tr><th>${k}</th><td>${v}</td></tr>` : "";
  const partes = [];
  if (perfil) partes.push(`<p>@UUID[${perfil.uuid}]{Perfil: ${c.nombre}}</p>`);
  if (c.lema) partes.push(`<blockquote><p><em>${inline(c.lema, ctx, c.id)}</em></p></blockquote>`);
  partes.push(`<table class="sbn-ficha"><tbody>${[
    fila("Concepto", c.concepto && inline(c.concepto, ctx, c.id)),
    fila("Base", c.lugar && enlaces([c.lugar])),
    fila("Cazadores", enlaces(c.miembros)),
    fila("Además", enlaces(c.otros)),
    fila("Desesperación inicial", String(c.desesperacion ?? 0)),
    fila("Peligro inicial", `${c.peligro ?? 0} de ${c.peligroMax ?? 5}`)
  ].join("")}</tbody></table>`);
  if (c.descripcion) partes.push(`<p>${inline(c.descripcion, ctx, c.id)}</p>`);
  const privadas = [];
  if (c.notas) privadas.push(html(c.notas, ctx, c.id));
  if (c.propuesto?.length) privadas.push(`<h3>Propuesto (no está en los docs)</h3><ul>${c.propuesto.map(p => `<li>${inline(p, ctx, c.id)}</li>`).join("")}</ul>`);
  for (const m of c.miembros) if (!ctx.actores.has(m)) ctx.avisos.push(`actores: ${c.id}: miembro ${m} no tiene actor.`);

  return {
    _id: aid,
    _key: `!actors!${aid}`,
    name: c.nombre,
    type: "group",
    img: ICONO_ACTOR,
    folder: carpetas.id("Célula Puget", "FIRSTLIGHT"),
    sort: 0,
    prototypeToken: { name: c.nombre, actorLink: true, disposition: -1, lockRotation: true, texture: { src: ICONO_ACTOR } },
    system: {
      groupType: "cell",
      members: c.miembros.filter(id => ctx.actores.has(id)).map(id => `Actor.${ID.actor(id)}`),
      headers: { concept: c.concepto ?? "", chronicle: CRONICA, tenets: c.lema ? `<p>${inline(c.lema, ctx, c.id)}</p>` : "" },
      desperation: { value: c.desesperacion ?? 0 },
      danger: { value: c.peligro ?? 0, max: c.peligroMax ?? 5 },
      biography: partes.join(""),
      notes: "",
      privatenotes: privadas.join("")
    },
    items: [],
    effects: [],
    ownership: { default: 0 },
    flags: { [MODULO]: { origen: "actor", id: c.id, journal: perfil?.uuid ?? null, lema: c.lema ?? "" } },
    _stats: STATS
  };
}

/* -------------------------------------------- */
/*  Actores                                     */
/* -------------------------------------------- */

const SPC =f => f._clase === "menor" || (!f.atributos && !f.habilidades && !f.pj);

function carpetaDe(f, journal, carpetas) {
  let ruta;
  if (journal?.meta.carpeta) ruta = journal.meta.carpeta.replace(/^Seattle by Night\//, "");
  else if (f.pj) ruta = "Personajes jugadores";
  else {
    const tipo = f.spcType ?? f.tipo;
    ruta = `Menores/${{ vampire: "Vástagos", ghoul: "Ghouls", mortal: "Mortales" }[tipo] ?? "Otros"}`;
  }
  const [a, b] = ruta.split("/");
  if (b) return carpetas.id(b, a);
  return carpetas.id(a);
}

function token(f, tipoActor) {
  const vampiro = (tipoActor === "spc" ? f.spcType : tipoActor) === "vampire";
  const disposicion = HOSTILES.has(f.id) ? -1 : (f.pj || AMISTOSOS.has(f.id)) ? 1 : 0;
  return {
    name: f.nombre,
    actorLink: (f.cantidad ?? 1) <= 1,
    disposition: disposicion,
    lockRotation: true,
    sight: { enabled: vampiro },
    texture: { src: tokenDe(f.id) }
  };
}

function construirActor(f, ctx, carpetas) {
  const aid = ID.actor(f.id);
  const journal = ctx.journalPorId.get(f.id) ?? null;
  const perfil = ["journal", "pagina"].includes(ctx.reg.get(f.id)?.tipo) ? ctx.reg.get(f.id) : null;
  const coteries = ctx.coteries.filter(c => c.miembros.includes(f.id));
  const spc = SPC(f);
  const tipoActor = spc ? "spc" : f.tipo;
  const tipoSangre = spc ? (f.spcType ?? f.tipo) : f.tipo;
  const items = [];

  // Clan, depredador y resonancia: ítems de tipo único (api/def/itemtypes.js: limitOnePerActor).
  if (f.clan && tipoActor === "vampire") {
    items.push(embebido(aid, "clan", { name: NOMBRE_CLAN[f.clan] ?? f.clan, type: "clan", img: ICONO_ITEM,
      system: SISTEMA_ITEM({ bane: "" }), flags: { [MODULO]: { origen: "actor", clan: f.clan } } }));
  }
  if (f.depredador && tipoActor === "vampire") {
    items.push(embebido(aid, "depredador", { name: f.depredador, type: "predatorType", img: ICONO_ITEM,
      system: SISTEMA_ITEM({ dicepool: {} }) }));
  }
  if (f.resonancia && tipoActor === "vampire") {
    items.push(embebido(aid, "resonancia", { name: f.resonancia, type: "resonance", img: ICONO_ITEM, system: SISTEMA_ITEM() }));
  }
  if (tipoSangre === "vampire" || tipoSangre === "ghoul") items.push(...poderes(f, aid, journal, ctx));
  else if (Object.keys(f.disciplinas ?? {}).length) ctx.avisos.push(`actores: ${f.id}: ${tipoSangre} con disciplinas; no se cargan.`);
  items.push(...rasgos(aid, f.ventajas, "ventaja", "ventaja", ctx, f.id));
  items.push(...rasgos(aid, f.defectos, "flaw", "defecto", ctx, f.id));

  // Equipo de FIRSTLIGHT: los ids que la ficha lista y los ítems con `usadoPor`.
  const idsEquipo = new Set([
    ...(f.equipo ?? []).filter(e => ctx.firstlightPorId.has(e)),
    ...ctx.firstlight.filter(e => e.usadoPor?.includes(f.id)).map(e => e.id)
  ]);
  for (const id of idsEquipo) {
    items.push(embebido(aid, `item:${id}`, itemFirstlight(ctx.firstlightPorId.get(id), ctx)));
  }

  const system = {
    group: coteries[0] ? ID.actor(coteries[0].id) : "",
    headers: {
      concept: f.concepto ? textoPlano(f.concepto, ctx).replace(/[*_]/g, "") : "",
      chronicle: CRONICA,
      ambition: f.ambicion ?? "",
      desire: f.deseo ?? "",
      touchstones: piedrasYConvicciones(f, ctx),
      sire: f.sire ? textoPlano(f.sire, ctx) : "",
      generation: f.generacion != null ? String(f.generacion) : ""
    },
    bio: {
      age: { trueage: f.edad != null ? String(f.edad) : "", apparent: "" },
      dateof: { birth: f.nacimiento ?? "", death: f.abrazado ?? "" },
      history: ""
    },
    biography: biografia(f, ctx, { perfil, coteries }),
    appearance: f.semblante ? `<p>${inline(f.semblante, ctx, f.id)}</p>` : "",
    equipment: equipoHtml(f, ctx, ctx.firstlightPorId),
    notes: "",
    privatenotes: notasPrivadas(f, ctx)
  };
  if (f.salud != null) system.health = { max: f.salud, value: f.salud, aggravated: 0, superficial: 0 };
  if (f.voluntad != null) system.willpower = { max: f.voluntad, value: f.voluntad, aggravated: 0, superficial: 0 };
  // `voluntad: null` explícito (los perros): sin Voluntad, no el 5 por defecto del modelo.
  else if ("voluntad" in f) system.willpower = { max: 0, value: 0, aggravated: 0, superficial: 0 };
  if (tipoSangre === "vampire") {
    if (f.potenciaSangre != null || f.generacion != null) {
      system.blood = { potency: f.potenciaSangre ?? 0, generation: f.generacion != null ? String(f.generacion) : "" };
    }
    if (f.humanidad != null) system.humanity = { value: f.humanidad, stains: 0 };
    if (f.hambre != null) system.hunger = { value: f.hambre, max: 5 };
  }
  if (tipoSangre === "vampire" || tipoSangre === "ghoul") system.disciplines = disciplinas(f);

  if (spc) {
    Object.assign(system, {
      spcType: tipoSangre,
      standarddicepools: {
        // Sin reservas en content/ (perros, Pike): 0, no el 1 por defecto del modelo.
        physical: { value: f.estandar?.physical ?? 0 },
        social: { value: f.estandar?.social ?? 0 },
        mental: { value: f.estandar?.mental ?? 0 }
      },
      // `active: true`: la hoja de PNJ sólo muestra las reservas excepcionales activas.
      exceptionaldicepools: habilidades(f.excepcionales, { activa: true }),
      power: { value: 0 },
      generaldifficulty: { normal: 0, strongest: 0 },
      settings: { enableDisciplines: tipoSangre === "vampire" || tipoSangre === "ghoul" }
    });
  } else {
    system.attributes = Object.fromEntries(Object.entries(f.atributos ?? {}).map(([k, v]) => [k, { value: v, active: false }]));
    system.skills = habilidades(f.habilidades);
  }

  // Cazadores: Credo, Impulso, Facultades y la Célula. Sólo esta rama; el resto no cambia.
  const cazador = tipoActor === "hunter";
  if (cazador) aplicarCazador(f, ctx, aid, system, items);

  return {
    _id: aid,
    _key: `!actors!${aid}`,
    name: f.nombre,
    type: tipoActor,
    img: retratoDe(f.id),
    folder: cazador ? carpetas.id("Célula Puget", "FIRSTLIGHT") : carpetaDe(f, journal, carpetas),
    // Cazadores: por su lugar en la Célula, sin tocar el contador del resto.
    sort: cazador ? ((celulaDe(f, ctx)?.miembros.indexOf(f.id) ?? 0) + 1) * 10 : Number(journal?.meta.orden ?? 0) || ctx.orden++ * 10,
    prototypeToken: token(f, tipoActor),
    system,
    items,
    effects: [],
    ownership: { default: 0 },
    flags: { [MODULO]: {
      origen: "actor", id: f.id, journal: perfil?.uuid ?? null,
      doc: f.origen ?? null, cantidad: f.cantidad ?? 1, pj: !!f.pj
    } },
    _stats: STATS
  };
}

function construirCoterie(c, ctx, carpetas) {
  const aid = ID.actor(c.id);
  const perfil = ctx.reg.get(c.id) ?? null;
  const fila = (k, v) => v ? `<tr><th>${k}</th><td>${v}</td></tr>` : "";
  const enlaces = ids => (ids ?? []).map(id => inline(`@ID[${id}]`, ctx, c.id)).join(", ");
  const partes = [];
  if (perfil) partes.push(`<p>@UUID[${perfil.uuid}]{Perfil: ${c.nombre}}</p>`);
  if (c.lema) partes.push(`<blockquote><p><em>${inline(c.lema, ctx, c.id)}</em></p></blockquote>`);
  partes.push(`<table class="sbn-ficha"><tbody>${[
    fila("Tipo", c.tipo),
    fila("Dominio", c.dominio && inline(c.dominio, ctx, c.id)),
    fila("Lugar", c.lugar && enlaces([c.lugar])),
    fila("Miembros", enlaces(c.miembros)),
    fila("Aliados", enlaces(c.aliados)),
    fila("Sustitutos", c.sustitutos && Object.entries(c.sustitutos).map(([a, b]) => `${enlaces([b])} si nadie juega ${enlaces([a])}`).join("; ")),
    fila("Ayuda", c.ayuda && enlaces([c.ayuda]))
  ].join("")}</tbody></table>`);
  if (c.descripcion) partes.push(`<p>${inline(c.descripcion, ctx, c.id)}</p>`);
  if (c.tipoNota) partes.push(`<p>${inline(c.tipoNota, ctx, c.id)}</p>`);
  if (c.dominioNotas) {
    const NOM = { caza: "Caza (Chasse)", lien: "Lien", portillon: "Portillon" };
    partes.push(`<h3>Dominio</h3><ul>${Object.entries(c.dominioNotas).map(([k, v]) => `<li><strong>${NOM[k] ?? k} ${c[k] ?? ""}:</strong> ${inline(v, ctx, c.id)}</li>`).join("")}</ul>`);
  }
  const privadas = [];
  if (c.dominioDoc02) privadas.push(`<p><strong>Dominio según el doc 02:</strong> ${Object.entries(c.dominioDoc02).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>`);
  if (c.trasfondosDoc02?.length) privadas.push(`<p><strong>Trasfondos según el doc 02:</strong></p><ul>${c.trasfondosDoc02.map(t => `<li>${inline(t, ctx, c.id)}</li>`).join("")}</ul>`);
  if (c.alternativas?.length) privadas.push(`<p><strong>Alternativas:</strong></p><ul>${c.alternativas.map(t => `<li>${inline(t, ctx, c.id)}</li>`).join("")}</ul>`);

  return {
    _id: aid,
    _key: `!actors!${aid}`,
    name: c.nombre,
    type: "group",
    img: ICONO_ACTOR,
    folder: carpetas.id("Coteries"),
    sort: ctx.orden++ * 10,
    prototypeToken: { name: c.nombre, actorLink: true, disposition: 0, lockRotation: true, texture: { src: ICONO_ACTOR } },
    system: {
      groupType: "coterie",
      // Mundo, no compendio (ids.mjs): la Aventura importa conservando los _id.
      members: c.miembros.filter(id => ctx.actores.has(id)).map(id => `Actor.${ID.actor(id)}`),
      headers: { concept: c.tipo ?? "", chronicle: CRONICA, tenets: "" },
      chasse: { value: c.caza ?? 0 },
      lien: { value: c.lien ?? 0 },
      portillon: { value: c.portillon ?? 0 },
      biography: partes.join(""),
      notes: "",
      privatenotes: privadas.join("")
    },
    items: rasgos(aid, c.trasfondos, "ventaja", "trasfondo", ctx, c.id)
      .map(it => ({ ...it, system: { ...it.system, featuretype: "background" } })),
    effects: [],
    ownership: { default: 0 },
    flags: { [MODULO]: { origen: "actor", id: c.id, journal: perfil?.uuid ?? null, lema: c.lema ?? "" } },
    _stats: STATS
  };
}

/* -------------------------------------------- */

/** Las `celula` de content/pnjs/*.json (hoy, la Célula Puget en cazadores.json). */
export function celulas() {
  const dir = path.join(RAIZ, "content/pnjs");
  return (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [])
    .filter(f => f.endsWith(".json") && f !== "combate.json")
    .flatMap(f => {
      const c = leerJson(`content/pnjs/${f}`).celula;
      return c ? [{ ...c, _origen: `pnjs/${f}` }] : [];
    });
}

export async function construir(ctx) {
  const local = {
    ...ctx,
    orden: 1,
    combate: existe("content/pnjs/combate.json") ? leerJson("content/pnjs/combate.json") : {},
    coteries: existe("content/coteries.json") ? leerJson("content/coteries.json").coteries : [],
    firstlight: existe("content/firstlight.json") ? leerJson("content/firstlight.json").equipo : [],
    journalPorId: new Map(journals().filter(j => j.rel.startsWith("content/personajes/")).map(j => [j.id, j])),
    celulas: celulas()
  };
  local.firstlightPorId = new Map(local.firstlight.map(e => [e.id, e]));

  // Ids de equipo que no están en firstlight.json: quedan como texto.
  for (const f of fichas()) for (const e of f.equipo ?? []) {
    if (/^[a-z0-9-]+$/.test(e) && !local.firstlightPorId.has(e)) ctx.avisos.push(`actores: ${f.id}: equipo «${e}» no está en firstlight.json.`);
  }

  const carpetas = new Carpetas("personajes", "Actor");
  const cuenta = {};
  for (const f of fichas().filter(tieneActor)) {
    const doc = construirActor(f, local, carpetas);
    escribirDoc("personajes", doc);
    const clave = doc.type === "spc" ? `spc/${doc.system.spcType}` : doc.type;
    cuenta[clave] = (cuenta[clave] ?? 0) + 1;
  }
  for (const c of local.coteries) {
    for (const m of c.miembros) if (!ctx.actores.has(m)) ctx.avisos.push(`actores: ${c.id}: miembro ${m} no tiene actor.`);
    escribirDoc("personajes", construirCoterie(c, local, carpetas));
    cuenta.group = (cuenta.group ?? 0) + 1;
  }
  for (const c of local.celulas) {
    escribirDoc("personajes", construirCelula(c, local, carpetas));
    cuenta["group/cell"] = (cuenta["group/cell"] ?? 0) + 1;
  }
  carpetas.escribir();
  const nItems = construirFirstlight(local);
  console.log(`personajes: ${Object.entries(cuenta).map(([k, v]) => `${v} ${k}`).join(", ")} · firstlight: ${nItems} ítems`);
}

#!/usr/bin/env node
/**
 * Compara content/ con lo que escribió actores.mjs en packs-src/personajes y
 * packs-src/firstlight: que cada ficha con estadísticas tenga actor y que no
 * se haya perdido ningún atributo, habilidad, especialidad, Disciplina, poder,
 * ventaja, defecto, piedra de toque, convicción, equipo ni texto.
 *
 * También falla si una ficha trae un campo que este chequeo no conoce: así un
 * dato nuevo en content/ no se pierde en silencio por no tener destino.
 *
 * Uso: node tools/contenido/verificar-actores.mjs   (después de construir-contenido)
 */
import fs from "node:fs";
import path from "node:path";
import { RAIZ, MODULO, leerJson } from "../util.mjs";
import { ID, fichas, tieneActor, registro, journals } from "./ids.mjs";
import { CAMPOS_CREDO, NOMBRE_FACULTAD, parsearBeneficio, celulas } from "./actores.mjs";

const { reg } = registro();
const errores = [];
const mal = (id, msg) => errores.push(`${id}: ${msg}`);

function leerPack(pack) {
  const dir = path.join(RAIZ, "packs-src", pack);
  const out = new Map();
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith(".json")) continue;
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!d._key?.startsWith("!folders!")) out.set(d._id, d);
  }
  return out;
}
const actores = leerPack("personajes");
const items = leerPack("firstlight");

/** Texto comparable: sin HTML, sin Markdown, sin marcadores, espacios colapsados. */
const ENT = { "&amp;": "&", "&quot;": "\"", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
function norm(s) {
  return String(s ?? "")
    .replace(/@ID\[([^\]|]+)(?:\|([^\]]+))?\]/g, (_, id, t) => t ?? reg.get(id)?.nombre ?? id)
    .replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, "$1")
    .replace(/@(tirada|termometro)\{(?:[^|}]*\|){1,2}([^}]*)\}/g, "$2")
    .replace(/@reloj\{(\d+)\}/g, "Noche $1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, e => ENT[e] ?? e)
    .replace(/^#+ /gm, "")
    .replace(/^\s*[-*] /gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([).,;:])/g, "$1")
    .replace(/([(«])\s+/g, "$1")
    .trim();
}
const contiene = (haystack, needle) => norm(haystack).includes(norm(needle));

/* -------------------------------------------- */

const CONOCIDOS = new Set([
  "id", "nombre", "apodo", "pj", "tipo", "clan", "concepto", "secta", "sire", "nacimiento", "abrazado",
  "ambicion", "deseo", "generacion", "potenciaSangre", "humanidad", "hambre", "atributos", "habilidades",
  "disciplinas", "salud", "voluntad", "convicciones", "piedrasDeToque", "ventajas", "defectos", "equipo",
  "cita", "semblante", "provisional", "nota", "origen", "edad", "depredador", "resonancia", "spcType",
  "cantidad", "estandar", "excepcionales", "reservas", "notas", "foco", "brillaEn", "secreto", "alternativa",
  "_origen", "_clase",
  // Cazadores (content/pnjs/cazadores.json): se chequean en chequearCazador.
  "credo", "impulso", "facultades", "facultadesNotas", "pregenerado", "propuesto", "reemplaza"
]);

const combate = leerJson("content/pnjs/combate.json");
const firstlight = leerJson("content/firstlight.json").equipo;
const flPorId = new Map(firstlight.map(e => [e.id, e]));
const perfiles = new Map(journals().map(j => [j.id, j]));
const journalsCronica = leerPack("cronica");
/** HTML de la página «Notas de edición» ({narrador}, ownership 0) del perfil de un PJ (journals.mjs). */
function notasDelPerfil(id) {
  const j = journalsCronica.get(ID.journal(id));
  const p = j?.pages?.find(x => x.name === "Notas de edición");
  return p && p.ownership?.default === 0 ? p.text?.content ?? "" : null;
}

let nFichas = 0, nSinActor = 0;
for (const f of fichas()) {
  if (!tieneActor(f)) { nSinActor++; continue; }
  for (const k of Object.keys(f)) if (!CONOCIDOS.has(k)) mal(f.id, `campo «${k}» sin destino en el actor (agregalo a actores.mjs y a este chequeo).`);
  nFichas++;
  const a = actores.get(ID.actor(f.id));
  if (!a) { mal(f.id, "no tiene actor en packs-src/personajes."); continue; }
  const s = a.system;
  const its = a.items ?? [];
  const fl = a.flags?.[MODULO] ?? {};

  // Tipo y flags.
  const spc = f._clase === "menor" || (!f.atributos && !f.habilidades && !f.pj);
  const tipo = spc ? "spc" : f.tipo;
  if (a.type !== tipo) mal(f.id, `tipo ${a.type}, se esperaba ${tipo}.`);
  if (spc && s.spcType !== (f.spcType ?? f.tipo)) mal(f.id, `spcType ${s.spcType}, se esperaba ${f.spcType ?? f.tipo}.`);
  if (fl.origen !== "actor" || fl.id !== f.id) mal(f.id, "flags origen/id incorrectos.");
  const perfil = ["journal", "pagina"].includes(reg.get(f.id)?.tipo) ? reg.get(f.id) : null;
  if (perfil) {
    if (fl.journal !== perfil.uuid) mal(f.id, `flags.journal ${fl.journal} ≠ ${perfil.uuid}.`);
    if (!s.biography?.startsWith(`<p>@UUID[${perfil.uuid}]`)) mal(f.id, "la biografía no empieza con el enlace al perfil.");
  }

  // Atributos y habilidades / reservas.
  for (const [k, v] of Object.entries(f.atributos ?? {})) {
    if (s.attributes?.[k]?.value !== v) mal(f.id, `atributo ${k}: ${s.attributes?.[k]?.value} ≠ ${v}.`);
  }
  for (const [k, v] of Object.entries(s.attributes ?? {})) if (!(k in (f.atributos ?? {}))) mal(f.id, `atributo ${k}=${v.value} que no está en content/.`);
  const chequearHabilidades = (fuente, destino, campo) => {
    for (const [k, v] of Object.entries(fuente ?? {})) {
      const [valor, esp] = Array.isArray(v) ? v : [v, null];
      const d = destino?.[k];
      if (d?.value !== valor) mal(f.id, `${campo}.${k}: ${d?.value} ≠ ${valor}.`);
      if (esp && !d?.bonuses?.some(b => b.source === esp && b.paths?.includes(`skills.${k}`))) mal(f.id, `${campo}.${k}: falta la especialidad «${esp}».`);
      if (campo === "exceptionaldicepools" && d && d.active !== true) mal(f.id, `${campo}.${k} no está activa (la hoja no la mostraría).`);
    }
    for (const k of Object.keys(destino ?? {})) if (!(k in (fuente ?? {}))) mal(f.id, `${campo}.${k} que no está en content/.`);
  };
  chequearHabilidades(f.habilidades, s.skills, "skills");
  chequearHabilidades(f.excepcionales, s.exceptionaldicepools, "exceptionaldicepools");
  for (const k of ["physical", "social", "mental"]) {
    if (f.estandar?.[k] != null && s.standarddicepools?.[k]?.value !== f.estandar[k]) mal(f.id, `standarddicepools.${k} ≠ ${f.estandar[k]}.`);
  }
  if (f.reservas && !Object.entries(f.reservas).every(([k, v]) => contiene(s.biography, `${k} ${v}`))) mal(f.id, "faltan las reservas en la biografía.");

  // Rasgos numéricos.
  const eq = (campo, real, esperado) => { if (esperado != null && real !== esperado) mal(f.id, `${campo}: ${real} ≠ ${esperado}.`); };
  eq("health.max", s.health?.max, f.salud);
  eq("willpower.max", s.willpower?.max, f.voluntad);
  if ("voluntad" in f && f.voluntad === null) eq("willpower.max (voluntad null)", s.willpower?.max, 0);
  eq("blood.potency", s.blood?.potency, f.potenciaSangre);
  eq("humanity.value", s.humanity?.value, f.humanidad);
  eq("hunger.value", s.hunger?.value, f.hambre);
  if (f.generacion != null) {
    eq("headers.generation", s.headers?.generation, String(f.generacion));
    eq("blood.generation", s.blood?.generation, String(f.generacion));
  }

  // Clan, depredador, resonancia.
  if (f.clan && !its.some(i => i.type === "clan" && i.flags?.[MODULO]?.clan === f.clan)) mal(f.id, `falta el clan ${f.clan}.`);
  if (f.depredador && !its.some(i => i.type === "predatorType" && i.name === f.depredador)) mal(f.id, "falta el tipo de depredador.");
  if (f.resonancia && !its.some(i => i.type === "resonance" && i.name === f.resonancia)) mal(f.id, "falta la resonancia.");

  // Disciplinas y poderes.
  for (const [d, [valor, poderes]] of Object.entries(f.disciplinas ?? {})) {
    const sd = s.disciplines?.[d];
    if (!sd) { mal(f.id, `falta la Disciplina ${d}.`); continue; }
    if (sd.value !== (valor ?? 0)) mal(f.id, `disciplines.${d}: ${sd.value} ≠ ${valor}.`);
    if (!sd.visible) mal(f.id, `disciplines.${d} no visible.`);
    for (const p of poderes ?? []) {
      const it = its.find(i => i.type === "power" && i.flags?.[MODULO]?.poder === p);
      if (!it) mal(f.id, `falta el poder «${p}» (${d}).`);
      else if (it.system.discipline !== d) mal(f.id, `«${p}» está en ${it.system.discipline}, no en ${d}.`);
    }
  }
  const nPoderes = Object.values(f.disciplinas ?? {}).reduce((n, [, ps]) => n + (ps?.length ?? 0), 0);
  const nItemsPoder = its.filter(i => i.type === "power").length;
  if (nItemsPoder !== nPoderes) mal(f.id, `${nItemsPoder} ítems de poder para ${nPoderes} poderes en content/.`);

  // Ventajas y defectos.
  for (const [campo, tipoRasgo] of [["ventajas", null], ["defectos", "flaw"]]) {
    for (const t of f[campo] ?? []) {
      const r = its.filter(i => i.type === "feature" && i.flags?.[MODULO]?.rasgo === t);
      if (!r.length) mal(f.id, `${campo}: falta «${t}».`);
      if (tipoRasgo && r.some(i => i.system.featuretype !== tipoRasgo)) mal(f.id, `${campo}: «${t}» no es ${tipoRasgo}.`);
      if (r.some(i => !contiene(i.system.description, t))) mal(f.id, `${campo}: la descripción de «${t}» no tiene el texto completo.`);
    }
  }

  // Convicciones y piedras de toque.
  for (const c of f.convicciones ?? []) if (!contiene(s.headers?.touchstones, c)) mal(f.id, `falta la convicción «${c}».`);
  for (const p of f.piedrasDeToque ?? []) {
    if (!contiene(s.headers?.touchstones, p.descripcion ?? p.nombre)) mal(f.id, `falta la piedra de toque «${p.nombre}».`);
  }

  // Equipo.
  const esperados = new Set([...(f.equipo ?? []).filter(e => flPorId.has(e)), ...firstlight.filter(e => e.usadoPor?.includes(f.id)).map(e => e.id)]);
  for (const id of esperados) if (!its.some(i => i.flags?.[MODULO]?.id === id)) mal(f.id, `falta el ítem de FIRSTLIGHT ${id}.`);
  for (const e of (f.equipo ?? []).filter(e => !flPorId.has(e))) if (!contiene(s.equipment, e)) mal(f.id, `equipo sin destino: «${e}».`);

  // Textos.
  const texto = (campo, valor, donde) => { if (valor && !contiene(donde, valor)) mal(f.id, `${campo} no aparece en el actor.`); };
  texto("concepto", f.concepto, s.headers?.concept + " " + s.biography);
  texto("apodo", f.apodo, s.biography);
  texto("cita", f.cita, s.biography);
  texto("semblante", f.semblante, s.appearance);
  texto("semblante (biografía)", f.semblante, s.biography);
  texto("secta", f.secta, s.biography);
  texto("ambición", f.ambicion, s.headers?.ambition);
  texto("deseo", f.deseo, s.headers?.desire);
  texto("nacimiento", f.nacimiento, s.bio?.dateof?.birth);
  texto("abrazo", f.abrazado, s.bio?.dateof?.death);
  texto("edad", f.edad != null ? String(f.edad) : null, s.bio?.age?.trueage);
  texto("brilla en", f.brillaEn, s.biography);
  texto("notas", f.notas, s.biography);
  if (f.pj) {
    // Un PJ lo puede poseer un jugador, que ve las notas privadas: van al perfil, página {narrador}.
    const notas = notasDelPerfil(f.id);
    const enPerfil = [f.nota, ...(f.provisional ?? []), ...(f.propuesto ?? [])].filter(Boolean);
    if (enPerfil.length && notas === null) mal(f.id, "es PJ con notas de edición y su perfil no tiene la página «Notas de edición» del Narrador.");
    for (const t of enPerfil) {
      if (notas !== null && !contiene(notas, t)) mal(f.id, `«${String(t).slice(0, 40)}…» no está en la página «Notas de edición» del perfil.`);
      if (contiene(s.privatenotes, t)) mal(f.id, "una nota de edición quedó en las notas privadas del actor: la vería el jugador.");
    }
  } else {
    texto("nota de edición", f.nota, s.privatenotes);
    for (const p of f.provisional ?? []) texto("provisional", p, s.privatenotes);
  }
  if (f.sire) texto("sire", reg.get(f.sire)?.nombre ?? f.sire, s.headers?.sire);
  for (const e of f.foco ?? []) texto(`foco ${e}`, reg.get(e)?.nombre ?? e, s.biography);
  if (f.cantidad > 1) texto("cantidad", String(f.cantidad), s.biography);
  if (combate[f.id] && !contiene(s.biography, combate[f.id])) mal(f.id, "falta la versión de combate (combate.json).");
  // El secreto de un PJ no va en el actor (su dueño lo vería): tiene que estar en su perfil.
  if (f.secreto) {
    const j = perfiles.get(f.id);
    // pjs.json escribe los IDs como texto y el perfil como @ID[…]: se comparan las primeras palabras.
    const sinIds = t => norm(String(t)
      .replace(/\s*\(@ID\[[^\]]+\]\)|\s*\([A-Z0-9]{1,4}-[A-Z0-9]+\)/g, "")
      .replace(/@ID\[([^\]|]+)[^\]]*\]/g, "$1"));
    if (!j || !sinIds(j.cuerpo).includes(sinIds(f.secreto))) mal(f.id, "el secreto no está en el perfil y no va en el actor.");
    if (contiene(s.biography + s.privatenotes, f.secreto)) mal(f.id, "el secreto quedó en el actor: lo vería el jugador.");
  }

  if (f.tipo === "hunter") chequearCazador(f, a);

  // Token.
  const t = a.prototypeToken;
  if (t?.name !== f.nombre) mal(f.id, "el token no lleva el nombre.");
  if (t?.actorLink !== ((f.cantidad ?? 1) <= 1)) mal(f.id, `actorLink ${t?.actorLink} con cantidad ${f.cantidad ?? 1}.`);
  const vampiro = (spc ? (f.spcType ?? f.tipo) : f.tipo) === "vampire";
  if (!!t?.sight?.enabled !== vampiro) mal(f.id, "visión del token: encendida sólo para vampiros.");

  // _key de los embebidos.
  for (const i of its) if (i._key !== `!actors.items!${a._id}.${i._id}`) mal(f.id, `ítem ${i.name}: _key incorrecta.`);
}

/* Cazadores */
function chequearCazador(f, a) {
  const s = a.system, its = a.items ?? [];
  // Credo: ítem creed con los campos de Desesperación (htr/creed-item-model.js).
  const [credo, campos] = CAMPOS_CREDO[f.credo] ?? [];
  if (!credo) mal(f.id, `credo «${f.credo}» desconocido.`);
  const ic = its.filter(i => i.type === "creed");
  if (ic.length !== 1) mal(f.id, `${ic.length} ítems creed (se esperaba 1).`);
  else if (ic[0].name !== credo || ic[0].system.desperationFields !== campos) mal(f.id, "el creed no coincide con el credo de content/.");
  if (s.headers?.creedfields !== campos) mal(f.id, "headers.creedfields no coincide con el credo.");
  // Impulso: ítem drive con la redención (htr/drive-item-model.js).
  const id = its.filter(i => i.type === "drive");
  if (f.impulso) {
    if (id.length !== 1 || id[0].name !== f.impulso.nombre) mal(f.id, `falta el drive «${f.impulso.nombre}».`);
    else {
      if (f.impulso.redencion && !contiene(id[0].system.redemption, f.impulso.redencion)) mal(f.id, "la redención del Impulso no está en el drive.");
      if (f.impulso.texto && !contiene(id[0].system.description, f.impulso.texto)) mal(f.id, "el texto del Impulso no está en el drive.");
    }
  }
  // Facultades (system.edges) y Beneficios (ítems perk con system.edge).
  const fac = f.facultades ?? {};
  for (const [edge, [valor, beneficios = []]] of Object.entries(fac)) {
    const e = s.edges?.[edge];
    if (!NOMBRE_FACULTAD[edge]) { mal(f.id, `Facultad «${edge}» no existe en wod5e.`); continue; }
    if (!e) { mal(f.id, `falta la Facultad ${edge}.`); continue; }
    if (e.value !== (valor ?? 0) || e.visible !== true) mal(f.id, `edges.${edge}: value ${e.value}, visible ${e.visible}.`);
    if (f.facultadesNotas?.[edge] && !contiene(e.description, f.facultadesNotas[edge])) mal(f.id, `edges.${edge}: falta la descripción.`);
    for (const b of beneficios) {
      const it = its.find(i => i.type === "perk" && i.flags?.[MODULO]?.beneficio === b);
      const { nombre, descripcion } = parsearBeneficio(b);
      if (!it) mal(f.id, `falta el Beneficio «${nombre}» (${edge}).`);
      else if (it.system.edge !== edge || it.name !== nombre || (descripcion && !contiene(it.system.description, descripcion))) mal(f.id, `el Beneficio «${nombre}» no coincide.`);
    }
  }
  for (const k of Object.keys(s.edges ?? {})) if (!(k in fac)) mal(f.id, `edges.${k} que no está en content/.`);
  const nPerks = Object.values(fac).reduce((n, [, b = []]) => n + b.length, 0);
  if (its.filter(i => i.type === "perk").length !== nPerks) mal(f.id, "cantidad de perks distinta de los Beneficios de content/.");
  // Célula, pregenerado, propuesto.
  const c = celulas().find(x => x.miembros.includes(f.id));
  if (c) {
    if (s.group !== ID.actor(c.id)) mal(f.id, `system.group ${s.group} ≠ la Célula ${c.id}.`);
    if (s.headers?.cellname !== c.nombre) mal(f.id, "headers.cellname ≠ nombre de la Célula.");
  }
  if (f.pregenerado) {
    const pre = reg.get(f.pregenerado);
    if (!pre) mal(f.id, `el pregenerado ${f.pregenerado} no existe.`);
    else if (!s.biography?.includes(`@UUID[${pre.uuid}]`)) mal(f.id, "la biografía no enlaza al pregenerado.");
  }
  if (!f.pj) for (const p of f.propuesto ?? []) if (!contiene(s.privatenotes, p)) mal(f.id, "falta un «propuesto» en las notas privadas.");
}

/* Células */
const listaCelulas = celulas();
for (const c of listaCelulas) {
  const a = actores.get(ID.actor(c.id));
  if (!a) { mal(c.id, "no tiene actor group."); continue; }
  if (a.type !== "group" || a.system.groupType !== "cell") mal(c.id, "no es group/cell.");
  const esperado = c.miembros.map(m => `Actor.${ID.actor(m)}`);
  if (JSON.stringify(a.system.members) !== JSON.stringify(esperado)) mal(c.id, "miembros distintos de content/.");
  for (const m of c.miembros) {
    const h = actores.get(ID.actor(m));
    if (h?.type !== "hunter") mal(c.id, `miembro ${m} no es un actor hunter.`);
  }
  if (a.system.desperation?.value !== (c.desesperacion ?? 0)) mal(c.id, `desperation ${a.system.desperation?.value} ≠ ${c.desesperacion}.`);
  if (a.system.danger?.value !== (c.peligro ?? 0) || a.system.danger?.max !== (c.peligroMax ?? 5)) mal(c.id, "danger distinto de content/.");
  for (const [k, donde] of [["lema", a.system.biography], ["descripcion", a.system.biography], ["concepto", a.system.biography], ["notas", a.system.privatenotes]]) {
    if (c[k] && !contiene(donde, c[k])) mal(c.id, `${k} no aparece.`);
  }
  for (const p of c.propuesto ?? []) if (!contiene(a.system.privatenotes, p)) mal(c.id, "falta un «propuesto» en las notas privadas.");
}

/* Coteries */
const coteries = leerJson("content/coteries.json").coteries;
for (const c of coteries) {
  const a = actores.get(ID.actor(c.id));
  if (!a) { mal(c.id, "no tiene actor group."); continue; }
  if (a.type !== "group" || a.system.groupType !== "coterie") mal(c.id, "no es group/coterie.");
  const esperado = c.miembros.map(m => `Actor.${ID.actor(m)}`);
  if (JSON.stringify(a.system.members) !== JSON.stringify(esperado)) mal(c.id, "miembros distintos de content/.");
  for (const [k, campo] of [["caza", "chasse"], ["lien", "lien"], ["portillon", "portillon"]]) {
    if (c[k] != null && a.system[campo]?.value !== c[k]) mal(c.id, `${campo}: ${a.system[campo]?.value} ≠ ${c[k]}.`);
  }
  for (const t of c.trasfondos ?? []) if (!a.items.some(i => i.flags?.[MODULO]?.rasgo === t)) mal(c.id, `falta el trasfondo «${t}».`);
  for (const [k, donde] of [["lema", a.system.biography], ["descripcion", a.system.biography], ["tipoNota", a.system.biography], ["dominio", a.system.biography]]) {
    if (c[k] && !contiene(donde, c[k])) mal(c.id, `${k} no aparece.`);
  }
  for (const v of Object.values(c.dominioNotas ?? {})) if (!contiene(a.system.biography, v)) mal(c.id, "falta una nota de dominio.");
  for (const t of [...(c.trasfondosDoc02 ?? []), ...(c.alternativas ?? [])]) if (!contiene(a.system.privatenotes, t)) mal(c.id, `falta «${t}» en notas.`);
}

/* FIRSTLIGHT */
for (const e of firstlight) {
  const it = items.get(ID.item(e.id));
  if (!it) { mal(e.id, "no está en packs-src/firstlight."); continue; }
  const tipo = e.blindaje != null ? "armor" : e.tipo;
  if (it.type !== tipo) mal(e.id, `tipo ${it.type}, se esperaba ${tipo}.`);
  if (!contiene(it.system.description, e.efecto)) mal(e.id, "falta el efecto.");
  if (e.blindaje != null && it.system.armorvalue !== e.blindaje) mal(e.id, "armorvalue ≠ blindaje.");
  if ((e.bonos ?? []).length !== (it.system.bonuses ?? []).length) mal(e.id, "bonuses distintos de bonos.");
  for (const [j, b] of (e.bonos ?? []).entries()) {
    const x = it.system.bonuses[j];
    if (x?.value !== b.valor || JSON.stringify(x?.paths) !== JSON.stringify(b.selectores)) mal(e.id, `bonus ${j} distinto.`);
  }
  for (const t of e.tiradas ?? []) if (!contiene(it.system.description, t)) mal(e.id, "falta una tirada.");
}

if (errores.length) {
  console.error(`✗ ${errores.length} diferencia(s) entre content/ y los actores:\n`);
  for (const e of errores) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`✓ actores: ${nFichas} fichas con actor (${nSinActor} sin estadísticas, sólo perfil), ${coteries.length} coteries, ${listaCelulas.length} célula(s) y ${firstlight.length} ítems de FIRSTLIGHT coinciden con content/.`);

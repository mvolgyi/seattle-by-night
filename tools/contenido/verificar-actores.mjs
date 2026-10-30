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
  "_origen", "_clase"
]);

const combate = leerJson("content/pnjs/combate.json");
const firstlight = leerJson("content/firstlight.json").equipo;
const flPorId = new Map(firstlight.map(e => [e.id, e]));
const perfiles = new Map(journals().map(j => [j.id, j]));

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
  texto("nota de edición", f.nota, s.privatenotes);
  for (const p of f.provisional ?? []) texto("provisional", p, s.privatenotes);
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

  // Token.
  const t = a.prototypeToken;
  if (t?.name !== f.nombre) mal(f.id, "el token no lleva el nombre.");
  if (t?.actorLink !== ((f.cantidad ?? 1) <= 1)) mal(f.id, `actorLink ${t?.actorLink} con cantidad ${f.cantidad ?? 1}.`);
  const vampiro = (spc ? (f.spcType ?? f.tipo) : f.tipo) === "vampire";
  if (!!t?.sight?.enabled !== vampiro) mal(f.id, "visión del token: encendida sólo para vampiros.");

  // _key de los embebidos.
  for (const i of its) if (i._key !== `!actors.items!${a._id}.${i._id}`) mal(f.id, `ítem ${i.name}: _key incorrecta.`);
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
console.log(`✓ actores: ${nFichas} fichas con actor (${nSinActor} sin estadísticas, sólo perfil), ${coteries.length} coteries y ${firstlight.length} ítems de FIRSTLIGHT coinciden con content/.`);

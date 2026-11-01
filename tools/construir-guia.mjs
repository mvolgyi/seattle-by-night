#!/usr/bin/env node
/**
 * packs-src/ → guia/index.html: la Guía del Narrador, una página local.
 *
 * Copiado de DVV (tools/construir-guia.mjs) y adaptado. Toda la crónica (el
 * libro, la aventura escena por escena, los interludios de FIRSTLIGHT, los
 * desenlaces y el epílogo), los PJs y PNJs con su retrato, la ciudad con sus
 * lugares y sus mapas, los documentos y ayudas maquetados, el Termómetro y el
 * Reloj, las pistas, la Pantalla del Narrador y cómo se usa el módulo en
 * Foundry, en un solo HTML que se abre desde el disco (file://) sin internet.
 * El seguimiento de la partida (escenas jugadas, Termómetro, noche, pistas,
 * notas) lo guarda guia.js en el navegador.
 *
 * De dónde sale el texto: del HTML que el build de journals YA generó a partir
 * de content/ (packs-src/cronica y packs-src/documentos, ver
 * tools/contenido/journals.mjs). Así la guía usa exactamente los mismos
 * expansores de marcadores (:::leer, @tirada, @termometro, @pista, @reloj,
 * documentos por soporte) que los journals de Foundry, sin una segunda copia
 * de las reglas. Lo único que se reescribe acá son los @UUID[...]{…}: cada uno
 * se vuelve un enlace a su ancla dentro de la guía. Los datos que no son
 * journals (fichas, lugares, planos, trackers, arsenal) se leen de content/.
 * Si content/ cambió, primero `npm run contenido`.
 *
 * El HTML es AUTOCONTENIDO: CSS (el de la guía y el del módulo, para que los
 * documentos se vean igual que en Foundry), JS, fuentes e imágenes reducidas
 * van embebidos en base64. Un navegador Flatpak abre el archivo por el portal
 * de documentos y no ve la carpeta de al lado; con todo adentro, la guía se
 * abre con doble clic en cualquier máquina. Cada imagen va UNA vez, como
 * clase CSS (`.ft-…`), aunque se use en varias secciones.
 *
 * Uso: node tools/construir-guia.mjs [--enlazado]   (--enlazado: sin embeber, para depurar)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { RAIZ, MODULO, leerJson } from "./util.mjs";
import { ID, journals, fichas } from "./contenido/ids.mjs";

const SALIDA = path.join(RAIZ, "guia/index.html");
const A = "../assets";
const ENLAZADO = process.argv.includes("--enlazado");
const CACHE = path.join(RAIZ, "cache/guia");
/** Ancho máximo al embeber, por carpeta: los mapas no necesitan 2400 px para leerse en la guía. */
const ANCHO = { mapas: 1400, lugares: 1400, retratos: 560, tokens: 320, handouts: 1200, portadas: 1920, "guia/capturas": 1200 };
const existe = rel => fs.existsSync(path.join(RAIZ, rel));
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const avisos = [];

/* ---------------------------------------------------------------- datos */
/** Documentos de un pack de packs-src/ cuyo _key empieza con `prefijo`. */
function leerPack(pack, prefijo) {
  const dir = path.join(RAIZ, "packs-src", pack);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    Object.defineProperty(d, "archivo", { value: path.join(dir, f) });
    return d;
  }).filter(d => d._key?.startsWith(prefijo));
}
const idDe = d => d.flags?.[MODULO]?.id ?? null;
const JDOCS = [...leerPack("cronica", "!journal!"), ...leerPack("documentos", "!journal!")]
  .filter(d => d.flags?.[MODULO]?.origen === "journal");
const J = new Map(JDOCS.map(d => [idDe(d), d]));
const ACTORES = leerPack("personajes", "!actors!").filter(d => idDe(d));
const ACTOR = new Map(ACTORES.map(a => [idDe(a), a]));
const FICHA = new Map(fichas().map(f => [f.id, f]));
const LUGARES = existe("content/lugares.json") ? leerJson("content/lugares.json").lugares : [];
const PISTAS = existe("content/pistas.json") ? leerJson("content/pistas.json").pistas : [];
const TRACKERS = leerJson("content/trackers.json");
const ARSENAL = existe("content/firstlight.json") ? leerJson("content/firstlight.json").equipo : [];
const PLANOS = fs.readdirSync(path.join(RAIZ, "content/planos")).filter(f => f.endsWith(".json")).sort()
  .flatMap(f => { const d = leerJson(`content/planos/${f}`); return d.planos ?? [d]; })
  .filter(p => p.id).sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));

// packs-src tiene que estar al día con content/ (lo escribe `npm run contenido`).
{
  const fuentes = journals();
  const faltan = fuentes.filter(j => !J.has(j.id)).map(j => j.id);
  if (faltan.length) {
    console.error(`✗ packs-src no tiene ${faltan.join(", ")}. Corré antes: npm run contenido`);
    process.exit(1);
  }
  const viejos = fuentes.filter(j => fs.statSync(path.join(RAIZ, j.rel)).mtimeMs > fs.statSync(J.get(j.id).archivo).mtimeMs + 1000);
  if (viejos.length) avisos.push(`content/ es más nuevo que packs-src en ${viejos.map(j => j.id).join(", ")}: corré npm run contenido`);
}

const paginas = d => [...d.pages].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
/** Una página introductoria es la que no muestra título (ids.mjs: la parte antes del primer `## `). */
const esIntro = p => p.title?.show === false;

/* ------------------------------------------------------------ anclas */
/** uuid de Foundry → id del elemento en la guía. Se reservan TODAS antes de renderizar. */
const ANCLA = new Map();
/** id del libro (A1-E01, PNJ-12, COT-03…) → id del elemento. */
const ANCLA_LIBRO = new Map();
const usados = new Set();
function unico(base) {
  let id = base, n = 2;
  while (usados.has(id)) id = `${base}-${n++}`;
  usados.add(id);
  return id;
}
for (const d of JDOCS) {
  const bid = idDe(d);
  const a = unico(bid ?? `j-${d._id}`);
  ANCLA.set(`JournalEntry.${d._id}`, a);
  if (bid) ANCLA_LIBRO.set(bid, a);
  for (const p of paginas(d)) {
    const pid = idDe(p);
    const ap = unico(pid && !usados.has(pid) ? pid : `p-${p._id}`);
    ANCLA.set(`JournalEntry.${d._id}.JournalEntryPage.${p._id}`, ap);
    if (pid && !ANCLA_LIBRO.has(pid)) ANCLA_LIBRO.set(pid, ap);
  }
}
for (const pl of PLANOS) ANCLA.set(`Scene.${ID.escena(pl.id)}`, unico(`mapa-${pl.id}`));
for (const it of ARSENAL) ANCLA.set(`Item.${ID.item(it.id)}`, unico(`item-${it.id}`));
/** Actores sin perfil propio (menores, la Célula): llevan una ficha con ancla `ficha-<ID>`. */
const SIN_PERFIL = ACTORES.filter(a => !ANCLA_LIBRO.has(idDe(a)));
for (const a of SIN_PERFIL) ANCLA_LIBRO.set(idDe(a), unico(`ficha-${idDe(a)}`));
for (const a of ACTORES) ANCLA.set(`Actor.${a._id}`, ANCLA_LIBRO.get(idDe(a)));
const ancla = id => ANCLA_LIBRO.get(id) ?? null;
const enlaceLibro = (id, texto) => ancla(id) ? `<a class="enlace" href="#${ancla(id)}">${esc(texto ?? id)}</a>` : esc(texto ?? id);

/* --------------------------------------------------------------- HTML de los journals */
const ROTOS = [];
/** HTML de un journal de Foundry → HTML de la guía: enlaces a anclas, rutas de assets, sin Font Awesome. */
function limpiar(html) {
  return String(html ?? "")
    .replace(/@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g, (_, uuid, etiqueta) => {
      const texto = etiqueta ?? uuid;
      const a = ANCLA.get(uuid);
      if (!a) {
        ROTOS.push(`${uuid} {${texto}}`);
        return `<span class="enlace roto" title="Sin destino en la guía">${texto}</span>`;
      }
      return `<a class="enlace" href="#${a}">${texto}</a>`;
    })
    // Imágenes del módulo (retratos, handouts de los documentos…) → ../assets, que embeber() mete en base64.
    // Si el archivo no está, la imagen se quita (rota en la guía no sirve) y se avisa.
    .replace(/<img\b[^>]*\bsrc="modules\/seattle-by-night\/(assets\/[^"]+)"[^>]*>/g, (img, rel) => {
      if (!existe(rel)) { avisos.push(`imagen de journal que no existe: ${rel}`); return ""; }
      return img.replace(`modules/${MODULO}/${rel}`, `${A}/${rel.slice("assets/".length)}`);
    })
    .replace(/<i class="fa-[^"]*"><\/i>\s?/g, "");
}
const anclaPagina = (d, p) => ANCLA.get(`JournalEntry.${d._id}.JournalEntryPage.${p._id}`);
const anclaJournal = d => ANCLA.get(`JournalEntry.${d._id}`);
// La ilustración del lugar va en la banda de foto, no repetida en el texto.
const htmlPagina = p => limpiar(p.text?.content)?.replace(/<img class="sbn-lugar-imagen"[^>]*>\s*/g, "");

function hecho(id, etiqueta = "Jugada") {
  return `<label class="hecho"><input type="checkbox" data-hecho="${esc(id)}"><span>${esc(etiqueta)}</span></label>`;
}

/** Una página como subsección (título + cuerpo). `plegada`: dentro de un <details>. */
function subpagina(d, p, { plegada = false, abierta = false } = {}) {
  const id = anclaPagina(d, p);
  if (esIntro(p)) return `<div class="intro" id="${id}">${htmlPagina(p)}</div>`;
  if (plegada) return `<details class="sub" id="${id}"${abierta ? " open" : ""}><summary><h4>${esc(p.name)}</h4></summary><div class="sub-cuerpo">${htmlPagina(p)}</div></details>`;
  return `<section class="subpagina" id="${id}"><h3>${esc(p.name)}</h3>${htmlPagina(p)}</section>`;
}

/** Un journal entero como acordeón (para el libro, la ciudad, FIRSTLIGHT…). */
function journalPlegado(bid, { kicker = "", abierto = false, paginasPlegadas = false } = {}) {
  const d = J.get(bid);
  if (!d) { avisos.push(`falta el journal ${bid} en packs-src`); return ""; }
  const ps = paginas(d);
  return `<details class="regla" id="${anclaJournal(d)}"${abierto ? " open" : ""}><summary>${kicker ? `<span class="regla-kicker">${esc(kicker)}</span>` : ""}<h3>${esc(d.name)}</h3></summary><div class="cuerpo">${
    ps.map(p => subpagina(d, p, { plegada: paginasPlegadas })).join("")}</div></details>`;
}

/* --------------------------------------------------------------- fotos */
/**
 * Las imágenes van como fondo de una clase CSS (`.ft-<hash>`), una sola vez en
 * el <style> aunque el mismo mapa se use en la crónica y en la ciudad. El visor
 * lee la URL del fondo para ampliarla.
 */
const FOTOS = new Map();
function foto(rel) {
  if (!rel || !existe(`assets/${rel}`)) return null;
  if (!FOTOS.has(rel)) FOTOS.set(rel, `ft-${crypto.createHash("md5").update(rel).digest("hex").slice(0, 8)}`);
  return FOTOS.get(rel);
}
const retrato = id => foto(`retratos/${id}.webp`);
const mapaDe = id => foto(`mapas/${id}.webp`);
/** Lo que no tiene imagen en assets/: se lista al final del build (es arte que falta, no un error de la guía). */
const SIN_ARTE = [];
/**
 * Imagen de un actor: su retrato o, si no tiene (los grupos de PNJs menores:
 * equipo táctico, cazarrecompensas, perros…), la que usa en Foundry (`img`, el
 * token cenital). `token: true` para maquetarla cuadrada y entera.
 */
function imagenActor(a) {
  const id = idDe(a);
  const r = id ? retrato(id) : null;
  if (r) return { clase: r, token: false };
  const rel = String(a?.img ?? "").match(new RegExp(`^modules/${MODULO}/assets/(.+)$`))?.[1];
  const c = rel ? foto(rel) : null;
  if (c) return { clase: c, token: rel.startsWith("tokens/") };
  return null;
}

/* --------------------------------------------------------------- piezas */
const CLAN = { brujah: "Brujah", gangrel: "Gangrel", malkavian: "Malkavian", nosferatu: "Nosferatu", toreador: "Toreador", tremere: "Tremere", ventrue: "Ventrue", caitiff: "Caitiff", thinblood: "Sangre débil" };
const TIPO = { vampire: "Vampiro", ghoul: "Ghoul", mortal: "Mortal", hunter: "Cazador" };
const CREDO = { faithful: "Fiel", inquisitive: "Inquisitivo", martial: "Marcial", underground: "Clandestino", entrepreneurial: "Emprendedor" };
const HAB = { athletics: "Atletismo", brawl: "Pelea", craft: "Artesanía", drive: "Conducir", firearms: "Armas de fuego", larceny: "Latrocinio", melee: "Cuerpo a cuerpo", stealth: "Sigilo", survival: "Supervivencia", animalken: "Trato con animales", etiquette: "Etiqueta", insight: "Perspicacia", intimidation: "Intimidación", leadership: "Liderazgo", performance: "Interpretación", persuasion: "Persuasión", streetwise: "Callejeo", subterfuge: "Subterfugio", academics: "Academicismo", awareness: "Alerta", finance: "Finanzas", investigation: "Investigación", medicine: "Medicina", occult: "Ocultismo", politics: "Política", science: "Ciencia", technology: "Tecnología" };
const DISC = { animalism: "Animalismo", auspex: "Auspex", celerity: "Celeridad", dominate: "Dominación", fortitude: "Fortaleza", obfuscate: "Ofuscación", potence: "Potencia", presence: "Presencia", protean: "Protean", sorcery: "Hechicería de Sangre", oblivion: "Olvido", alchemy: "Alquimia de Sangre débil" };

/** Línea de datos bajo el nombre: tipo, clan, generación, Potencia de Sangre… */
function kickerFicha(f) {
  if (!f) return "Trasfondo";
  const t = f.tipo ?? f.spcType;
  return [
    f.pj ? "Personaje jugador" : null,
    TIPO[t] ?? t,
    CLAN[f.clan] ?? f.clan,
    f.generacion ? `${f.generacion}.ª generación` : null,
    f.potenciaSangre != null ? `Potencia de Sangre ${f.potenciaSangre}` : null,
    f.humanidad != null ? `Humanidad ${f.humanidad}` : null,
    f.credo ? `Credo ${CREDO[f.credo] ?? f.credo}` : null
  ].filter(Boolean).map(esc).join(" · ");
}
const valor = v => Array.isArray(v) ? `${v[0]}${v[1] ? ` (${v[1]})` : ""}` : v;
function reservas(f) {
  if (!f) return "";
  const out = [];
  const e = f.estandar ?? {};
  if (e.physical != null) out.push(`Física ${e.physical}`, `Social ${e.social}`, `Mental ${e.mental}`);
  for (const [k, v] of Object.entries(f.excepcionales ?? {})) out.push(`${HAB[k] ?? k} ${valor(v)}`);
  for (const [k, v] of Object.entries(f.disciplinas ?? {})) out.push(`${DISC[k] ?? k} ${Array.isArray(v) ? v[0] : v}`);
  if (f.salud) out.push(`Salud ${f.salud}`);
  if (f.voluntad) out.push(`Voluntad ${f.voluntad}`);
  return out.length ? `<div class="reservas">${out.map(s => `<span>${esc(s)}</span>`).join("")}</div>` : "";
}
const sinRetrato = html => html.replace(/<img class="sbn-retrato"[^>]*>\s*/g, "").replace(/<p class="sbn-enlace-actor">[\s\S]*?<\/p>\s*/, "");

/* ---------------------------------------------------------- 1. cabecera */
const NAV = [["libro", "El libro"], ["cronica", "La aventura"], ["termometro", "Termómetro y Reloj"], ["dramatis", "Personajes"], ["ciudad", "La ciudad"], ["documentos", "Documentos"], ["firstlight", "FIRSTLIGHT"], ["pantalla", "Pantalla"], ["foundry", "En Foundry"]];
const navLinks = NAV.map(([id, t]) => `<a href="#${id}">${t}</a>`).join("");
const portada = foto("portadas/portada.webp");
const cabecera = `
<header class="tablero" id="inicio">
  <div class="fila">
    <a class="t-logo" href="#inicio" aria-label="Inicio">SbN</a>
    <nav class="t-nav" aria-label="Secciones">${navLinks}</nav>
    <button class="t-accion" type="button" data-abrir-mesa>La mesa</button>
  </div>
  <div class="hero ${portada ?? ""}" role="img" aria-label="Un hombre de abrigo mira los muelles de Seattle bajo la lluvia">
    <div class="hero-texto">
      <p class="kicker">Vampiro: La Mascarada 5ª · Guía del Narrador</p>
      <h1><span>Seattle by Night</span><small>El Expediente Ward</small></h1>
      <p>Noviembre de 2026. Alguien robó de un apartamento de Ballard el archivo de una periodista que lleva años contando historias de gente que no envejece. Desde esa noche, la ciudad cobra deudas viejas: un hermano que nadie conocía, un Primogénito que quiere el trono y una agencia federal que ya no se conforma con mirar.</p>
      <p>Esta guía tiene el libro, la aventura escena por escena, los interludios de FIRSTLIGHT, cada personaje con su retrato, la ciudad con sus mapas y los documentos para entregar. Se abre desde el disco y guarda la partida en este navegador.</p>
      <button class="cta" type="button" data-abrir-mesa>Abrir la mesa <span aria-hidden="true">→</span></button>
    </div>
  </div>
</header>`;

/* ------------------------------------------------------- 2. el libro */
const LIBRO = ["VERDAD", "COMO-USAR", "SEGURIDAD", "CAP-00", "CAP-01", "PJS-COTERIE", "GANCHOS", "TONO-DAVID", "INDICE-IDS"];
const libro = `
<section class="pagina" id="libro">
  <p class="kicker">Antes de empezar</p>
  <h2>El libro</h2>
  <p class="standfirst">Lo que el Narrador tiene que saber antes de la primera noche: la verdad detrás de la aventura y su esquema, cómo usar el libro, las herramientas de seguridad, la ficción de apertura, los personajes y la coterie, los ganchos y el registro de IDs.</p>
  ${LIBRO.map((id, i) => journalPlegado(id, { abierto: i === 0 })).join("")}
</section>`;

/* ------------------------------------------------------- 3. la aventura */
const AVENTURA = ["AVE-01", "AVE-01-P0", "AVE-01-P1", "AVE-01-AJUSTE", "AVE-01-P2", "AVE-01-P3", "AVE-01-P4", "AVE-01-FIN", "AVE-01-EPI", "AVE-01-CONS", "FIRSTLIGHT-INTERLUDIOS"];
const IMAGEN_PARTE = {
  "AVE-01": "portadas/portada.webp", "AVE-01-P0": "mapas/helen.webp", "AVE-01-P1": "mapas/hangar.webp",
  "AVE-01-AJUSTE": "mapas/subterraneo.webp", "AVE-01-P2": "mapas/galeria.webp", "AVE-01-P3": "mapas/terminal86.webp",
  "AVE-01-P4": "mapas/ferry.webp", "AVE-01-FIN": "mapas/torre-atico.webp", "AVE-01-EPI": "mapas/granja.webp",
  "AVE-01-CONS": "mapas/salitre.webp", "FIRSTLIGHT-INTERLUDIOS": "mapas/northline.webp"
};
const partes = AVENTURA.map(id => J.get(id)).filter(Boolean);
const corto = n => n.split(" · ")[0];
const largo = n => n.includes(" · ") ? n.split(" · ").slice(1).join(" · ") : "";
const pestanas = partes.map((d, i) =>
  `<button type="button" class="tab${i === 0 ? " activa" : ""}" data-tab="${anclaJournal(d)}"><span>${esc(idDe(d) === "FIRSTLIGHT-INTERLUDIOS" ? "Interludios" : corto(d.name))}</span><small>${esc(idDe(d) === "FIRSTLIGHT-INTERLUDIOS" ? "FIRSTLIGHT" : largo(d.name))}</small></button>`).join("");
const paneles = partes.map((d, i) => {
  const ps = paginas(d);
  const intro = ps.filter(esIntro);
  const resto = ps.filter(p => !esIntro(p));
  const conAncla = resto.some(p => idDe(p));
  const img = foto(IMAGEN_PARTE[idDe(d)]);
  if (!img) avisos.push(`${idDe(d)}: falta assets/${IMAGEN_PARTE[idDe(d)] ?? "(sin imagen asignada en IMAGEN_PARTE)"}`);
  const bandas = resto.map(p => {
    const id = anclaPagina(d, p);
    const marca = idDe(p) ? hecho(id) : "";
    return `<div class="banda${idDe(p) ? " escena" : ""}" id="${id}"><div class="banda-cab"><h3>${esc(p.name)}</h3>${marca}</div><div class="banda-cuerpo">${htmlPagina(p)}</div></div>`;
  }).join("");
  return `<div class="panel${i === 0 ? " activa" : ""}" data-panel="${anclaJournal(d)}" id="${anclaJournal(d)}">
    <article class="banda-foto acto">
      <figure class="bf-foto ${img ?? ""}"><figcaption>${esc(corto(d.name))}</figcaption></figure>
      <div class="bf-texto"><p class="kicker">${esc(corto(d.name))}</p><h3 class="panel-titulo">${esc(largo(d.name) || d.name)}</h3>${conAncla ? "" : hecho(anclaJournal(d), "Leída")}${intro.map(p => `<div id="${anclaPagina(d, p)}">${htmlPagina(p)}</div>`).join("")}</div>
    </article>
    ${bandas}
  </div>`;
}).join("");
const cronica = `
<section class="agenda" id="cronica">
  <div class="agenda-cab"><div><p class="kicker">Capítulo 7</p><h2>El Expediente Ward</h2><p class="standfirst">El prólogo, las cuatro partes, los desenlaces y el epílogo, escena por escena, con los interludios de FIRSTLIGHT al final. Marcá cada escena cuando se juegue; los botones del Termómetro y de las pistas mueven la mesa de esta guía.</p></div><p class="progreso" data-progreso="cronica" aria-live="polite"></p></div>
  <div class="agenda-grid"><div class="tabs" role="tablist">${pestanas}</div><div class="paneles">${paneles}</div></div>
</section>`;

/* ------------------------------------------------- 4. Termómetro y Reloj */
const T = TRACKERS.termometro, R = TRACKERS.reloj;
const UMBRAL = new Map((T.umbrales ?? []).map(u => [Number(u.valor), u]));
const escala = (chica = false) => `<ol class="escala${chica ? " chica" : ""}" data-escala aria-label="Termómetro de ${T.min ?? 0} a ${T.max ?? 10}">${
  Array.from({ length: (T.max ?? 10) - (T.min ?? 0) + 1 }, (_, k) => (T.min ?? 0) + k).map(v => {
    const u = UMBRAL.get(v);
    const destino = u && (u.interludio ?? u.escena);
    return `<li data-v="${v}" class="${u && u.jugadores !== "inicio" ? "umbral" : ""}"><b>${v}</b>${u && !chica && u.jugadores !== "inicio" ? `<span class="icono">${esc(u.icono ?? "")}</span><span class="txt">${esc(u.texto)}</span>${destino ? `<span class="dest">${enlaceLibro(destino)}</span>` : ""}` : ""}</li>`;
  }).join("")}</ol>`;
const trackers = J.get("TRACKERS"), pistasJ = J.get("PISTAS");
const termometro = `
<section class="pagina" id="termometro">
  <p class="kicker">FIRSTLIGHT y Halloway</p>
  <h2>El Termómetro y el Reloj</h2>
  <p class="standfirst">${esc(T.descripcion ?? "Cuánto sabe la Segunda Inquisición de los Vástagos de Seattle.")}</p>
  ${escala()}
  <p class="chica">La escala marca el valor de <strong>La mesa</strong>. Los umbrales 3 y 9 abren un interludio de FIRSTLIGHT.</p>
  ${trackers ? `<div id="${anclaJournal(trackers)}">${paginas(trackers).map((p, i) => subpagina(trackers, p, { plegada: true, abierta: i === 0 })).join("")}</div>` : ""}
  <h3>Las pistas</h3>
  <p class="chica">Tocá el botón de una pista para marcarla como obtenida (o desmarcarla) en La mesa.</p>
  ${pistasJ ? `<div id="${anclaJournal(pistasJ)}">${paginas(pistasJ).map(p => subpagina(pistasJ, p, { plegada: true })).join("")}</div>` : ""}
</section>`;

/* ----------------------------------------------------- 5. personajes */
const GRUPOS = [
  ["Personajes jugadores", /Personajes jugadores$/, "La coterie: David y los conceptos nuevos. Las fichas están en el compendio de personajes."],
  ["Vástagos", /Vástagos/, "La Camarilla de Seattle y los que vienen de fuera."],
  ["Mortales y ghouls", /Mortales y ghouls$/, ""],
  ["FIRSTLIGHT", /FIRSTLIGHT$/, "La Segunda Inquisición en Seattle. La Célula Puget y su arsenal están en la sección FIRSTLIGHT."],
  ["Trasfondo", /Trasfondo$/, "Nombres que pesan en la historia aunque no salgan a escena."]
];
const perfiles = journals().filter(j => j.rel.startsWith("content/personajes/"));
let alterna = 0;
function perfil(j) {
  const d = J.get(j.id);
  const ps = paginas(d);
  const f = FICHA.get(j.id);
  const img = retrato(j.id) ?? (ACTOR.has(j.id) ? imagenActor(ACTOR.get(j.id))?.clase : null);
  if (!img) SIN_ARTE.push(`${j.id} (${d.name}): retrato`);
  const intro = ps.filter(esIntro).map(p => `<div id="${anclaPagina(d, p)}">${sinRetrato(htmlPagina(p))}</div>`).join("");
  const resto = ps.filter(p => !esIntro(p)).map(p => subpagina(d, p, { plegada: true })).join("");
  return `
  <article class="banda-foto pnj${alterna++ % 2 ? " invertido" : ""}${img ? "" : " sin-imagen"}" id="${anclaJournal(d)}">
    ${img ? `<figure class="bf-foto alta ${img}"><figcaption>${esc(d.name)}</figcaption></figure>` : ""}
    <div class="bf-texto">
      <p class="kicker">${kickerFicha(f)}</p>
      <h2>${esc(d.name)}</h2>
      ${intro}
      ${reservas(f)}
      <div class="subs">${resto}</div>
    </div>
  </article>`;
}
/** Ficha corta de un actor sin perfil propio (menores, Célula): la biografía del actor (system.biography). */
function fichaCorta(a) {
  const id = idDe(a);
  const f = FICHA.get(id);
  const img = imagenActor(a);
  if (!img) SIN_ARTE.push(`${id} (${a.name}): retrato y token`);
  const kick = f?._clase === "menor" ? [TIPO[f.spcType] ?? f.spcType, f.cantidad > 1 ? `${f.cantidad} individuos` : null].filter(Boolean).map(esc).join(" · ") : kickerFicha(f);
  return `<article class="ficha" id="${ancla(id)}">
    ${img ? `<div class="ficha-foto${img.token ? " token" : ""} ${img.clase}" role="img" aria-label="${esc(a.name)}"></div>` : ""}
    <div class="ficha-cuerpo"><p class="kicker">${kick}</p><h4>${esc(f?.nombre ?? a.name)}</h4>${limpiar(a.system?.biography)}${reservas(f)}</div>
  </article>`;
}
const dramatisGrupos = GRUPOS.map(([nombre, re, texto]) => {
  const js = perfiles.filter(j => re.test(j.meta.carpeta ?? "")).sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }));
  if (!js.length) return "";
  return `<div class="grupo" id="grupo-${nombre.toLowerCase().replace(/\s+/g, "-")}"><div class="seccion-cab chica-cab"><p class="kicker">Personajes</p><h2>${esc(nombre)}</h2>${texto ? `<p class="standfirst">${esc(texto)}</p>` : ""}</div>${js.map(perfil).join("")}</div>`;
}).join("");
const sinGrupo = perfiles.filter(j => !GRUPOS.some(([, re]) => re.test(j.meta.carpeta ?? "")));
if (sinGrupo.length) avisos.push(`perfiles sin grupo en la guía: ${sinGrupo.map(j => j.id).join(", ")}`);
const MENORES = SIN_PERFIL.filter(a => a.type === "spc");
const CELULA = SIN_PERFIL.filter(a => a.type === "hunter");
const otrosSinPerfil = SIN_PERFIL.filter(a => a.type !== "spc" && a.type !== "hunter");
if (otrosSinPerfil.length) avisos.push(`actores sin perfil ni ficha en la guía: ${otrosSinPerfil.map(idDe).join(", ")}`);
const ordenId = (a, b) => idDe(a).localeCompare(idDe(b), "es", { numeric: true });
const todosPerfiles = GRUPOS.flatMap(([, re]) => perfiles.filter(j => re.test(j.meta.carpeta ?? "")));
const dramatis = `
<section class="bandas" id="dramatis">
  <div class="seccion-cab">
    <p class="kicker">Dramatis personae</p>
    <h2>Quién es quién en Seattle</h2>
    <p class="standfirst">Cada personaje con su retrato, su historia, lo que quiere y lo que sabe. Las secciones largas están plegadas; abrilas cuando las necesites.</p>
    <nav class="indice" aria-label="Personajes">${todosPerfiles.map(j => `<a href="#${ancla(j.id)}"><b>${esc(j.id)}</b>${esc(J.get(j.id).name)}</a>`).join("")}<a href="#menores"><b>MEN</b>PNJs menores</a></nav>
  </div>
  ${dramatisGrupos}
  <div class="grupo" id="menores"><div class="seccion-cab chica-cab"><p class="kicker">Personajes</p><h2>PNJs menores</h2><p class="standfirst">Reservas simplificadas (Física, Social, Mental y las excepcionales), como en el doc 14.</p></div>
    <div class="fichas">${MENORES.sort(ordenId).map(fichaCorta).join("")}</div>
  </div>
</section>`;

/* --------------------------------------------------------- 6. la ciudad */
const CIUDAD = ["CIUDAD-HISTORIA", "CIUDAD-POLITICA", "CIUDAD-RUMORES", "CIUDAD-LEYES", "CIUDAD-DISTRITOS"];
const planosDe = lug => PLANOS.filter(p => p.lugar === lug);
const figuraPlano = (pl, grande = false) => {
  const img = mapaDe(pl.id);
  if (!img) { avisos.push(`plano ${pl.id} sin mapa pintado en assets/mapas/`); return ""; }
  const escenas = (pl.escenas ?? []).map(e => enlaceLibro(typeof e === "string" ? e : e.id)).join(" · ");
  return `<figure class="plano${grande ? " grande" : ""}" id="${ANCLA.get(`Scene.${ID.escena(pl.id)}`)}">
    <button type="button" class="ampliar ${img}" data-ampliar="${esc(pl.nombre)}" style="aspect-ratio: ${pl.ancho ?? 4} / ${pl.alto ?? 3}" aria-label="Ampliar el mapa: ${esc(pl.nombre)}"><span class="lupa">Ampliar</span></button>
    <figcaption><b>${esc(pl.nombre)}</b>${escenas ? `<span>${escenas}</span>` : ""}</figcaption>
  </figure>`;
};
const lugaresHtml = LUGARES.map((l, i) => {
  const d = J.get(l.id);
  if (!d) { avisos.push(`lugar ${l.id} sin journal`); return ""; }
  const pls = planosDe(l.id);
  // Con mapa, el primero; sin mapa (Pike Place, el Club Ceniza…), su ilustración.
  const img = (pls.length ? mapaDe(pls[0].id) : null) ?? foto(`lugares/${l.id}.webp`);
  if (!img) SIN_ARTE.push(`${l.id} (${d.name}): ${l.mapa === false ? "ilustración del lugar (no lleva mapa)" : "mapa"}`);
  const ps = paginas(d);
  const datos = [
    l.escenas?.length ? `<dt>Escenas</dt><dd>${l.escenas.map(e => enlaceLibro(e)).join(" · ")}</dd>` : "",
    l.pnjs?.length ? `<dt>Quién</dt><dd>${l.pnjs.map(p => enlaceLibro(p, J.get(p)?.name ?? FICHA.get(p)?.nombre ?? p)).join(" · ")}</dd>` : ""
  ].join("");
  return `
  <article class="lugar" id="${anclaJournal(d)}">
    <div class="banda-foto${i % 2 ? " invertido" : ""}${img ? "" : " sin-imagen"}">
      ${img ? `<figure class="bf-foto ${img}"><figcaption><b>${esc(l.id)}</b>${esc(d.name)}</figcaption></figure>` : ""}
      <div class="bf-texto">
        <p class="kicker">${esc(l.id)}${l.zona ? ` · ${esc(l.zona)}` : ""}</p>
        <h3>${esc(d.name)}</h3>
        ${datos ? `<dl class="datos">${datos}</dl>` : ""}
        ${ps.map(p => subpagina(d, p, { plegada: !esIntro(p) && ps.length > 2, abierta: false })).join("")}
      </div>
    </div>
    ${pls.length ? `<div class="planos">${pls.map(pl => figuraPlano(pl)).join("")}</div>` : ""}
  </article>`;
}).join("");
const huerfanos = PLANOS.filter(p => !LUGARES.some(l => l.id === p.lugar));
if (huerfanos.length) avisos.push(`planos sin lugar: ${huerfanos.map(p => p.id).join(", ")}`);
const ciudad = `
<section class="bandas" id="ciudad">
  <div class="seccion-cab">
    <p class="kicker">Seattle, noviembre de 2026</p>
    <h2>La ciudad</h2>
    <p class="standfirst">La historia reciente, la política de la Camarilla, los rumores, las leyes del Elíseo y los distritos; después, lugar por lugar, con los mapas de las escenas de Foundry.</p>
  </div>
  <div class="pagina sin-arriba">${CIUDAD.map(id => journalPlegado(id)).join("")}</div>
  <div class="seccion-cab chica-cab"><p class="kicker">Lugares</p><h2>LUG-01 a LUG-${String(LUGARES.length).padStart(2, "0")}</h2>
    <nav class="indice" aria-label="Lugares">${LUGARES.map(l => `<a href="#${ancla(l.id)}"><b>${esc(l.id)}</b>${esc(J.get(l.id)?.name ?? l.nombre)}</a>`).join("")}</nav>
  </div>
  ${lugaresHtml}
  <div class="pagina">${["CIUDAD-COTERIES", "CIUDAD-LORESHEETS"].map(id => journalPlegado(id, { kicker: "La ciudad" })).join("")}</div>
</section>`;

/* --------------------------------------------------------- 7. documentos */
const SOPORTE = { transcripcion: "Transcripción", guion: "Guion", "libro-registro": "Libro de registro", mecanografiado: "Copia mecanografiada", sms: "Mensajes de texto", foro: "Foro", correo: "Correo", carta: "Carta", informe: "Informe", poema: "Poema", presentacion: "Presentación", nota: "Nota", libreta: "Libreta", marcador: "Marcador", recorte: "Recorte", tarjeta: "Tarjeta", foto: "Fotografía", diagrama: "Diagrama", "orden-del-dia": "Orden del día", mapa: "Mapa" };
const ENTREGA = { "sesion-cero": "Sesión cero", narrador: "Sólo para el Narrador", fuera: "Fuera de la aventura", epilogo: "Epílogo" };
const docs = JDOCS.filter(d => /^(DOC|AYU)-\d+$/.test(idDe(d))).sort((a, b) => idDe(a).localeCompare(idDe(b), "es", { numeric: true }));
{
  const dir = path.join(RAIZ, "content/documentos");
  const pedidas = fs.readdirSync(dir).filter(f => f.endsWith(".md")).flatMap(f => {
    const m = fs.readFileSync(path.join(dir, f), "utf8").match(/^imagen:\s*(\S+)\s*$/m);
    return m ? [[path.basename(f, ".md"), m[1]]] : [];
  });
  const doc15 = existe("content/arte-doc15.json") ? leerJson("content/arte-doc15.json").ayudas ?? [] : [];
  for (const a of doc15) if (a.para && !pedidas.some(([, img]) => img === a.id)) pedidas.push([a.para, a.id]);
  for (const [doc, img] of pedidas) if (!existe(`assets/handouts/${img}.webp`)) SIN_ARTE.push(`${img} (imagen de ${doc}): assets/handouts/${img}.webp`);
}
const documentoHtml = d => {
  const fl = d.flags[MODULO];
  const entrega = (fl.entrega ?? []).map(e => ancla(e) ? enlaceLibro(e) : esc(ENTREGA[e] ?? e)).join(" · ");
  return `<details class="regla doc" id="${anclaJournal(d)}"><summary><span class="regla-kicker">${esc(idDe(d))}</span><h3>${esc(d.name)}</h3></summary>
    <div class="cuerpo"><p class="doc-meta">${fl.soporte ? `<span>${esc(SOPORTE[fl.soporte] ?? fl.soporte)}</span>` : ""}${entrega ? `<span>Entrega: ${entrega}</span>` : ""}</p>
    ${paginas(d).map(p => subpagina(d, p)).join("")}</div></details>`;
};
const documentos = `
<section class="pagina" id="documentos">
  <p class="kicker">Para entregar</p>
  <h2>Documentos del mundo y ayudas de juego</h2>
  <p class="standfirst">DOC-01 a DOC-12 son objetos de la ficción (notas de voz, mensajes, diarios, informes); AYU-01 a AYU-09, ayudas de juego. Están maquetados igual que en Foundry, donde se entregan al jugador desde el journal. Cada uno cierra con su nota para el Narrador.</p>
  ${journalPlegado("DOCUMENTOS-RESUMEN", { kicker: "Resumen" })}
  <h3>Documentos</h3>
  ${docs.filter(d => idDe(d).startsWith("DOC")).map(documentoHtml).join("")}
  <h3>Ayudas de juego</h3>
  ${docs.filter(d => idDe(d).startsWith("AYU")).map(documentoHtml).join("")}
</section>`;

/* --------------------------------------------------------- 8. FIRSTLIGHT */
const TIPO_ITEM = { weapon: "Arma", gear: "Equipo", condition: "Estado" };
const arsenal = ARSENAL.map(it => `<div class="item" id="${ANCLA.get(`Item.${ID.item(it.id)}`)}"><p class="kicker">${esc(TIPO_ITEM[it.tipo] ?? it.tipo)}${it.dano != null ? ` · daño ${esc(it.dano)}${it.agravado ? " agravado" : ""}` : ""}</p><h4>${esc(it.nombre)}</h4><p>${esc(it.efecto ?? "")}</p>${it.usadoPor?.length ? `<p class="chica">Lo usa: ${it.usadoPor.map(p => enlaceLibro(p, FICHA.get(p)?.nombre ?? p)).join(" · ")}</p>` : ""}</div>`).join("");
const celula = CELULA.sort(ordenId).map((a, i) => {
  const id = idDe(a), f = FICHA.get(id), img = imagenActor(a)?.clase;
  if (!img) SIN_ARTE.push(`${id} (${a.name}): retrato`);
  return `<article class="banda-foto pnj${i % 2 ? " invertido" : ""}${img ? "" : " sin-imagen"}" id="${ancla(id)}">
    ${img ? `<figure class="bf-foto alta ${img}"><figcaption>${esc(f?.nombre ?? a.name)}</figcaption></figure>` : ""}
    <div class="bf-texto"><p class="kicker">${kickerFicha(f)}</p><h2>${esc(f?.nombre ?? a.name)}</h2>${limpiar(a.system?.biography)}</div>
  </article>`;
}).join("");
const firstlight = `
<section class="bandas" id="firstlight">
  <div class="seccion-cab">
    <p class="kicker">La Segunda Inquisición</p>
    <h2>FIRSTLIGHT jugable</h2>
    <p class="standfirst">La Célula Puget con reglas de Cazador: La Venganza: cómo se juega, los pregenerados, el arsenal y la continuación tras FIN-D. Los interludios están al final de la aventura.</p>
  </div>
  <div class="pagina sin-arriba">${["FIRSTLIGHT-JUGABLE", "FIRSTLIGHT-PREGENERADOS", "FIRSTLIGHT-MAREA-ROJA"].map(id => journalPlegado(id, { kicker: "FIRSTLIGHT" })).join("")}</div>
  ${celula ? `<div class="seccion-cab chica-cab"><p class="kicker">FIRSTLIGHT</p><h2>La Célula Puget</h2></div>${celula}` : ""}
  <div class="pagina"><h3>El arsenal</h3><p class="chica">Ítems del compendio «FIRSTLIGHT — Arsenal».</p><div class="arsenal">${arsenal}</div></div>
</section>`;

/* ------------------------------------------------- 9. pantalla */
const pantallaJ = J.get("PANTALLA");
const pantalla = pantallaJ ? `
<section class="pagina" id="pantalla">
  <p class="kicker">En la mesa</p>
  <h2>Pantalla del Narrador</h2>
  <div class="cuerpo ancho" id="${anclaJournal(pantallaJ)}">${paginas(pantallaJ).map(p => subpagina(pantallaJ, p)).join("")}</div>
</section>` : "";

/* ------------------------------------------------- 10. en Foundry */
const captura = (archivo, alt, pie) => existe(`assets/guia/capturas/${archivo}`)
  ? `<figure class="captura"><img src="${A}/guia/capturas/${archivo}" alt="${esc(alt)}" loading="lazy"><figcaption>${pie}</figcaption></figure>` : "";
const foundry = `
<section class="pagina" id="foundry">
  <p class="kicker">El módulo</p>
  <h2>Cómo usar el módulo en Foundry</h2>
  <div class="pasos">
    <div class="paso"><div class="paso-texto"><h3>1. Importar la crónica</h3><p>Activá <strong>Seattle by Night</strong> en un mundo de <em>wod5e</em>. La primera vez que entra el Narrador, el módulo ofrece importar la aventura entera con sus carpetas: journals, actores, escenas, ítems de FIRSTLIGHT y macros. Si lo dejás para después, está en el compendio «Importar la crónica». Reimportar actualiza sin duplicar y sin pisar los PJ de los jugadores ni lo que hayas revelado.</p></div>${captura("importar.webp", "El diálogo «Importar la crónica»", "El diálogo de importación, con el aviso del Dark Pack.")}</div>
    <div class="paso"><div class="paso-texto"><h3>2. El indicador</h3><p>Sobre la barra de macros, sólo para el Narrador: el Termómetro con sus diez segmentos, la noche del Reloj de Halloway y las pistas obtenidas, con botones de más y menos. Se pliega a una píldora y abre el Panel del Narrador.</p></div>${captura("indicador.webp", "El indicador del Narrador", "Termómetro 2, noche 1 (jueves 12 de noviembre), 0 de 15 pistas.")}</div>
    <div class="paso"><div class="paso-texto"><h3>3. El Panel del Narrador</h3><p>Cuatro pestañas: <strong>Termómetro</strong> (valor, umbrales, fijar, congelar, lo que lo mueve esta noche e historial), <strong>Reloj</strong> (las ocho noches con su evento y sus escenas), <strong>Pistas</strong> (P-01 a P-15 y las pruebas sin ID) y <strong>Tiradas clave</strong> (A3-E04 y A4-E01, con la reserva calculada según las pistas y la votación del Consejo). Al cruzar un umbral, el Narrador recibe un aviso y un susurro con lo que pasa en la ciudad; en 3 y 9, con el interludio de FIRSTLIGHT que toca.</p></div>${captura("panel-termometro.webp", "El Panel del Narrador en la pestaña Termómetro", "Termómetro en 3: el panel avisa que toca el interludio INT-01.")}${captura("susurro.webp", "Susurro al Narrador al cruzar el umbral 3", "El susurro del umbral, sólo para el Narrador.")}${captura("panel-tiradas.webp", "La pestaña Tiradas clave en el Consejo", "Tiradas clave: márgenes y votación del Consejo de Primogenitura.")}</div>
    <div class="paso"><div class="paso-texto"><h3>4. Los botones de los journals</h3><p>En las escenas hay botones de tirada (tiran con el token seleccionado o el personaje del jugador), del Termómetro (con el motivo; el de las cámaras corporales respeta su tope), de pistas (marcan la pista como obtenida) y de noches del Reloj. Los enlaces llevan a la escena, el lugar, el PNJ o el documento. En esta guía, los mismos botones mueven La mesa.</p></div>${captura("journal.webp", "Un journal con botones del Termómetro y de pistas", "Ajuste a la Parte 1: botones del Termómetro, pistas y enlaces.")}</div>
    <div class="paso"><div class="paso-texto"><h3>5. Los interludios de FIRSTLIGHT</h3><p>Cuando el Termómetro cruza el 3 o el 9, los jugadores pueden llevar a la Célula Puget en un interludio corto (INT-01 a INT-03). Lo que salga deja ventajas o fisuras para la redada (INT-00).</p></div>${captura("interludio.webp", "El journal de FIRSTLIGHT jugable con INT-00", "INT-00: ventajas y fisuras para la redada.")}</div>
  </div>
  <p class="chica">Las escenas traen los mapas de esta guía con muros, puertas, luces y los tokens colocados. Las macros del compendio abren el panel, mueven el Termómetro, marcan pistas y avanzan la noche.</p>
</section>`;

/* --------------------------------------------------------- 11. la mesa */
const trackersJid = trackers?._id;
const anclaNoche = n => trackersJid ? ANCLA.get(`JournalEntry.${trackersJid}.JournalEntryPage.${ID.pagina(trackersJid, `noche-${n}`)}`) ?? null : null;
const plano = s => String(s ?? "").replace(/[*_`]/g, "");
const DATOS = {
  inicio: Number(T.inicio ?? 0), min: Number(T.min ?? 0), max: Number(T.max ?? 10),
  umbrales: (T.umbrales ?? []).filter(u => u.jugadores !== "inicio").map(u => ({
    valor: Number(u.valor), icono: u.icono ?? "", texto: plano(u.ciudad ?? u.texto),
    destino: [u.escena, u.interludio].filter(Boolean).map(id => ({ id, ancla: ancla(id) }))
  })),
  noches: (R.noches ?? []).map(n => ({ n: Number(n.n), dia: n.dia ?? n.fecha, evento: plano(n.evento), ancla: anclaNoche(n.n) })),
  pistas: PISTAS.map(p => ({ id: p.id, nombre: plano(p.nombre), ancla: ancla(p.id) }))
};
for (const n of DATOS.noches) if (!n.ancla) avisos.push(`noche ${n.n} sin página en el journal TRACKERS`);
const mesa = `
<aside class="mesa" id="mesa" role="dialog" aria-labelledby="mesa-titulo" hidden>
  <div class="mesa-cab"><h2 id="mesa-titulo">La mesa</h2><button type="button" data-cerrar-mesa aria-label="Cerrar">Cerrar</button></div>
  <div class="mesa-cuerpo">
    <h3>Termómetro</h3>
    <div class="termo"><button type="button" data-termo="-1" aria-label="Bajar">−</button><b data-termo-valor>${DATOS.inicio}</b><button type="button" data-termo="+1" aria-label="Subir">+</button><button type="button" class="congelar" data-termo-congelar aria-pressed="false">Congelar</button></div>
    ${escala(true)}
    <p class="umbral-actual" data-termo-umbral aria-live="polite"></p>
    <details class="registro"><summary>Lo que lo movió</summary><ol data-termo-registro></ol></details>
    <h3>Reloj de Halloway</h3>
    <div class="contador" data-noche><span>Noche</span><button type="button" data-menos aria-label="Noche anterior">−</button><b>1</b><button type="button" data-mas aria-label="Noche siguiente">+</button></div>
    <p class="noche-texto" data-noche-texto></p>
    <h3>Pistas <span class="cuenta" data-pistas-cuenta></span></h3>
    <div class="pistas-mesa">${DATOS.pistas.map(p => `<label><input type="checkbox" data-pista-mesa="${esc(p.id)}"><span><b>${esc(p.id)}</b> ${esc(p.nombre)}</span></label>`).join("")}</div>
    <h3>Avance</h3>
    <p class="progreso" data-progreso="todo" aria-live="polite"></p>
    <h3>Notas de la sesión</h3>
    <label class="etiqueta-notas" for="notas-sesion">Lo que pasó, lo pendiente, a quién vieron</label><textarea id="notas-sesion" name="notas-sesion" data-notas="sesion" rows="8" autocomplete="off" placeholder="Ej.: Helen les dio la lista; Krell vio la camioneta de Bear…"></textarea>
    <div class="mesa-acciones"><button type="button" data-exportar>Exportar</button><label class="boton">Importar<input type="file" accept="application/json" data-importar hidden></label><button type="button" data-reiniciar>Reiniciar</button></div>
  </div>
</aside>`;

/* --------------------------------------------------------------- HTML */
const LEGAL = "Seattle by Night es material no oficial de World of Darkness, publicado bajo el Dark Pack. Partes de estos materiales son copyright y marcas registradas de Paradox Interactive AB, y se usan con permiso. Todos los derechos reservados. Más información en worldofdarkness.com.";
let html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Seattle by Night — Guía del Narrador</title>
<meta name="description" content="Seattle by Night y la aventura El Expediente Ward para Vampiro: La Mascarada 5ª edición, completa y con seguimiento de la partida.">
<meta name="theme-color" content="#0d0f12">
<link rel="stylesheet" href="../src/styles/sbn.css">
<link rel="stylesheet" href="../src/styles/sbn-ui.css">
<link rel="stylesheet" href="guia.css">
<style>
@@FOTOS@@
</style>
</head>
<body>
<a class="saltar" href="#libro">Saltar al contenido</a>
${cabecera}
<nav class="barra" aria-label="Navegación fija" data-barra>
  <a class="barra-logo" href="#inicio" aria-label="Volver a la portada">SbN</a>
  <div class="barra-links">${navLinks}</div>
  <form class="buscar" role="search" data-buscar><label for="buscar" class="visualmente-oculto">Ir a una escena, un personaje o un lugar</label><input id="buscar" name="buscar" type="search" list="destinos" placeholder="Ir a… (escena, PNJ, lugar, ID)" autocomplete="off" spellcheck="false"><datalist id="destinos"></datalist></form>
  <button class="t-accion" type="button" data-abrir-mesa>La mesa</button>
</nav>
<main id="contenido">
${libro}
${cronica}
${termometro}
${dramatis}
${ciudad}
${documentos}
${firstlight}
${pantalla}
${foundry}
</main>
<footer class="pie"><p>${esc(LEGAL)}</p><p>No es material oficial. Todo el arte (retratos, mapas, portada) se generó en local con modelos de licencia comercial; ni arte ni logos de Paradox o White Wolf. Fuentes Oswald, IBM Plex Sans y Amiri (OFL).</p></footer>
${mesa}
<div class="aviso" data-aviso role="status" aria-live="polite" hidden></div>
<button type="button" class="arriba" data-arriba hidden aria-label="Volver arriba">▲</button>
<dialog class="visor" data-visor><div class="visor-cab"><span data-visor-titulo></span><button type="button" data-visor-cerrar>Cerrar</button></div><div class="visor-cuerpo"><img src="" alt=""></div></dialog>
<script type="application/json" id="datos-guia">${JSON.stringify(DATOS).replace(/</g, "\\u003c")}</script>
<script src="guia.js"></script>
</body>
</html>
`;
html = html.replace("@@FOTOS@@", [...FOTOS].map(([rel, clase]) => `.${clase}{background-image:url("${A}/${rel}")}`).join("\n"));

/* --------------------------------------------------------------- verificación */
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const repetidos = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).filter((x, i, arr) => arr.indexOf(x) !== i);
if (repetidos.length) avisos.push(`ids repetidos: ${[...new Set(repetidos)].join(", ")}`);
const sinDestino = [...new Set([...html.matchAll(/href="#([^"]+)"/g)].map(m => m[1]).filter(h => !ids.has(h)))];
const crudos = [...new Set(html.match(/@(?:ID\[|UUID\[|tirada\{|termometro\{|pista\{|reloj\{)[^\s<]{0,40}/g) ?? [])];

/* --------------------------------------------------------------- embeber */
/** Reduce la imagen (magick, cacheado por hash) y la devuelve como data URI. */
function dataUri(rel) {
  const abs = path.join(RAIZ, rel);
  const carpeta = Object.keys(ANCHO).sort((a, b) => b.length - a.length).find(k => rel.startsWith(`assets/${k}/`));
  const ancho = carpeta ? ANCHO[carpeta] : 1200;
  fs.mkdirSync(CACHE, { recursive: true });
  const clave = crypto.createHash("md5").update(`${rel}:${ancho}:${fs.statSync(abs).mtimeMs}`).digest("hex").slice(0, 12);
  const out = path.join(CACHE, `${path.basename(rel, path.extname(rel))}-${clave}.webp`);
  if (!fs.existsSync(out)) execFileSync("magick", [abs, "-resize", `${ancho}x${ancho}>`, "-quality", "76", "-define", "webp:method=5", out], { stdio: "pipe" });
  return `data:image/webp;base64,${fs.readFileSync(out).toString("base64")}`;
}
function embeber(html) {
  const css = (rel, base) => fs.readFileSync(path.join(RAIZ, rel), "utf8")
    .replace(/url\(fonts\/([^)]+)\)/g, (_, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(base, "fonts", f)).toString("base64")})`);
  const js = fs.readFileSync(path.join(RAIZ, "guia/guia.js"), "utf8");
  for (const [link, rel] of [["../src/styles/sbn.css", "src/styles/sbn.css"], ["../src/styles/sbn-ui.css", "src/styles/sbn-ui.css"], ["guia.css", "guia/guia.css"]]) {
    html = html.replace(`<link rel="stylesheet" href="${link}">`, () => `<style>\n${css(rel, path.join(RAIZ, "guia"))}\n</style>`);
  }
  html = html.replace('<script src="guia.js"></script>', () => `<script>\n${js.replace(/<\/script/g, "<\\/script")}\n</script>`);
  const vistas = new Map();
  const uri = rel => { if (!vistas.has(rel)) vistas.set(rel, dataUri(rel)); return vistas.get(rel); };
  html = html.replace(/src="\.\.\/(assets\/[^"]+)"/g, (_, rel) => `src="${uri(rel)}"`);
  html = html.replace(/url\("\.\.\/(assets\/[^"]+)"\)/g, (_, rel) => `url("${uri(rel)}")`);
  return html;
}
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
const final = ENLAZADO ? html : embeber(html);
if (!ENLAZADO) {
  const sueltas = [...new Set(final.match(/(?:modules\/seattle-by-night\/|\.\.\/)assets\/[^"')\s]+/g) ?? [])];
  if (sueltas.length) avisos.push(`imágenes sin embeber: ${sueltas.join(", ")}`);
}
fs.writeFileSync(SALIDA, final);
const kb = Math.round(fs.statSync(SALIDA).size / 1024);
console.log(`✓ guia/index.html (${kb} KB${ENLAZADO ? ", enlazado" : ", autocontenido"}): ${partes.length} partes, ${todosPerfiles.length} perfiles, ${MENORES.length} menores, ${CELULA.length} de la Célula, ${LUGARES.length} lugares, ${PLANOS.length} mapas, ${docs.length} documentos, ${PISTAS.length} pistas, ${FOTOS.size} imágenes`);
const problemas = [
  ...avisos,
  ...(ROTOS.length ? [`${ROTOS.length} @UUID sin destino en la guía: ${[...new Set(ROTOS)].join("; ")}`] : []),
  ...(sinDestino.length ? [`enlaces internos sin destino: ${sinDestino.join(", ")}`] : []),
  ...(crudos.length ? [`marcadores sin expandir: ${crudos.join(", ")}`] : [])
];
if (SIN_ARTE.length) {
  console.log(`\nArte que falta en assets/ (${SIN_ARTE.length}; la guía lo maqueta sin imagen):`);
  for (const s of SIN_ARTE) console.log(`  ${s}`);
}
if (problemas.length) {
  console.warn(`\n${problemas.length} aviso(s):`);
  for (const p of problemas) console.warn(`  ${p}`);
}

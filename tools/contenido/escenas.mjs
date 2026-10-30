/**
 * content/planos → pack `escenas`.
 *
 * Una escena por plano (tools/construir-planos.mjs#cargarPlanos) y una
 * portada. Muros, puertas, ventanas, vidrios, barandas, regiones y luces salen
 * del MISMO archivo que el mapa (tools/planos.mjs, tools/iluminacion.mjs): lo
 * que se ve y lo que bloquea el paso no pueden desincronizarse.
 *
 * Adaptado de docEscena / conClaves / tilesDe / escenasDePlanos de DVV
 * (tools/construir-contenido.mjs). Diferencias:
 *
 *   - Los planos están en METROS y 1 m = 100 px = 1 casilla: no hay
 *     conversión de pies ni de radios de luz.
 *   - fog.mode (v14) en vez de fog.exploration (deprecado desde v14).
 *   - Las regiones con `destino: null` (o con un destino que no resuelve) no se
 *     descartan: quedan como marcadores inertes, como prevé planos.mjs.
 *   - Los pines (Note) van a las páginas de las escenas del libro que pasan en
 *     el plano (`plano.escenas`) y al journal del lugar (`plano.lugar`), que
 *     además queda como journal de la escena (Scene.journal).
 *
 * padding 0, como DVV: Foundry corre el rectángulo de la escena por el padding
 * y las coordenadas del plano (px del mapa) quedarían desplazadas.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { marked } from "marked";
import { RAIZ, MODULO, STATS, idEstable, escribirDoc, Carpetas } from "../util.mjs";
import { ID } from "./ids.mjs";
import { cargarPlanos } from "../construir-planos.mjs";
import { derivarMuros, derivarRegiones, mueblesMoviles, GRID_PX, PX_POR_M } from "../planos.mjs";
import { lucesDePlano } from "../iluminacion.mjs";

const PACK = "escenas";
const existe = rel => fs.existsSync(path.join(RAIZ, rel));
const md2html = md => marked.parse(md ?? "", { async: false });
const px = m => Math.round(m * PX_POR_M);
const flags = (origen, extra = {}) => ({ [MODULO]: { origen, ...extra } });

/** Color de fondo de la portada mientras no haya arte: el tono ambiente de la paleta. */
const COLOR_PORTADA = "#1c2a36";

/* -------------------------------------------- */
/*  Utilidades                                  */
/* -------------------------------------------- */

function dimensiones(rutaAbs) {
  const salida = execFileSync("magick", ["identify", "-format", "%w %h", rutaAbs], { encoding: "utf8" });
  const [w, h] = salida.trim().split(/\s+/).map(Number);
  return { w, h };
}

/** «JournalEntry.<j>[.JournalEntryPage.<p>]» → { entryId, pageId }. */
function idsDeUuid(uuid) {
  const m = /^JournalEntry\.([A-Za-z0-9]{16})(?:\.JournalEntryPage\.([A-Za-z0-9]{16}))?$/.exec(uuid ?? "");
  return m ? { entryId: m[1], pageId: m[2] ?? null } : null;
}

/** _key de los documentos embebidos: fvtt-cli los guarda como entradas propias. */
function conClaves(escena) {
  const sid = escena._id;
  for (const col of ["walls", "lights", "levels", "tokens", "notes", "sounds", "tiles", "drawings", "regions"]) {
    for (const d of escena[col] ?? []) {
      d._key = `!scenes.${col}!${sid}.${d._id}`;
      if (col === "regions") {
        for (const b of d.behaviors ?? []) b._key = `!scenes.regions.behaviors!${sid}.${d._id}.${b._id}`;
      }
    }
  }
  return escena;
}

const textura = src => ({
  src, anchorX: 0.5, anchorY: 0.5, fit: "contain", scaleX: 1, scaleY: 1,
  offsetX: 0, offsetY: 0, rotation: 0, tint: "#ffffff", alphaThreshold: 0.75
});

/** Escena base: compartida por los planos y la portada. */
function docEscena({ id, nombre, carpeta, orden, w, h, sinGrid = false, oscuridad = 0, luzGlobal = false,
  fondo = null, colorFondo = "#000000", walls = [], lights = [], regions = [], notes = [], tiles = [],
  journal = null, visionToken = true, extra = {} }) {
  const sid = ID.escena(id);
  return conClaves({
    _id: sid,
    _key: `!scenes!${sid}`,
    name: nombre,
    folder: carpeta ?? null,
    navigation: true,
    navOrder: orden ?? 0,
    width: w,
    height: h,
    padding: 0,
    // Casillas de 1 m = 100 px (MAPS_SPEC §4). alpha 0: el piso ya lee la retícula.
    grid: { type: sinGrid ? 0 : 1, size: GRID_PX, style: "solidLines", thickness: 1, color: "#000000",
      alpha: 0, distance: 1, units: "m" },
    tokenVision: visionToken,
    fog: { mode: visionToken ? 1 : 0 },
    environment: { darknessLevel: oscuridad, globalLight: { enabled: Boolean(luzGlobal) } },
    // En v14 el fondo vive en un Level embebido, no en la escena.
    levels: [{
      _id: idEstable(`nivel:${id}`),
      name: "Suelo",
      elevation: { bottom: 0, top: 20 },
      background: { src: fondo ? `modules/${MODULO}/${fondo}` : null, color: colorFondo },
      sort: 0
    }],
    journal,
    journalEntryPage: null,
    walls, lights, regions, notes, tiles,
    tokens: [], sounds: [], drawings: [],
    playlist: null, playlistSound: null,
    ownership: { default: 0 },
    flags: flags("escena", { escena: id, ...extra }),
    _stats: STATS
  });
}

/* -------------------------------------------- */
/*  Tiles (muebles móviles)                     */
/* -------------------------------------------- */

/**
 * Muebles móviles del plano → tiles. El arte (assets/tiles) va con el eje
 * largo horizontal y, en asientos, el frente al sur; `hacia` lo rota. En v14
 * x/y es el CENTRO del tile (anchor 0,5) y width/height son del rectángulo
 * sin rotar: a 90°/270° se intercambian para caer sobre la huella del plano.
 * Desbloqueados: son para moverlos.
 */
const ROTACION_HACIA = { s: 0, o: 90, n: 180, e: 270 };

function tilesDe(plano, ctx) {
  const tiles = [], sinTile = [], faltan = [];
  mueblesMoviles(plano).forEach((m, i) => {
    if (!m.tile) { sinTile.push(m); return; }
    if (!existe(`assets/tiles/${m.tile}.webp`)) { faltan.push(m.tile); sinTile.push(m); return; }
    const horizontal = m.w >= m.h;
    const rotacion = m.hacia ? ROTACION_HACIA[m.hacia] : (horizontal ? 0 : 90);
    if (rotacion === undefined) ctx.avisos.push(`plano ${plano.id}: hacia «${m.hacia}» inválido en ${m.tipo}`);
    const girado = rotacion === 90 || rotacion === 270;
    tiles.push({
      _id: idEstable(`tile:${plano.id}:${i}`),
      name: m.desc ?? m.tile.replace(/^tile-/, "").replace(/-/g, " "),
      texture: textura(`modules/${MODULO}/assets/tiles/${m.tile}.webp`),
      x: px(m.x + m.w / 2), y: px(m.y + m.h / 2),
      width: px(girado ? m.h : m.w), height: px(girado ? m.w : m.h),
      elevation: 0, levels: [idEstable(`nivel:${plano.id}`)], sort: i, rotation: rotacion ?? 0,
      alpha: 1, hidden: false, locked: false,
      restrictions: { light: false, weather: false },
      occlusion: { modes: [], alpha: 0 },
      video: { loop: true, autoplay: true, volume: 0 },
      flags: flags("tile", { escena: plano.id, tipo: m.tipo })
    });
  });
  if (faltan.length) {
    ctx.avisos.push(`plano ${plano.id}: faltan ${faltan.length} tile(s) en assets/tiles (${[...new Set(faltan)].join(", ")}); ` +
      "se omiten y la nota de la escena los lista para colocarlos a mano");
  }
  return { tiles, sinTile };
}

/* -------------------------------------------- */
/*  Pines (Note)                                */
/* -------------------------------------------- */

/**
 * Puntos (metros) para `n` pines dentro de una habitación, libres de muebles,
 * luces y de los otros pines, del más cercano al centro hacia afuera.
 */
function puntosLibres(plano, hab, n) {
  const R = 0.35, SEP = 0.9, PASO = 0.25;
  const libreDe = (x, y) =>
    !(plano.muebles ?? []).some(m => x + R > m.x && x - R < m.x + (m.w ?? 0.1) && y + R > m.y && y - R < m.y + (m.h ?? 0.1)) &&
    !(plano.luces ?? []).some(l => Math.hypot(l.x - x, l.y - y) < R + 0.2);
  const cx = hab.x + hab.w / 2, cy = hab.y + hab.h / 2;
  const candidatos = [];
  for (let y = hab.y + R; y <= hab.y + hab.h - R + 1e-9; y += PASO) {
    for (let x = hab.x + R; x <= hab.x + hab.w - R + 1e-9; x += PASO) {
      if (libreDe(x, y)) candidatos.push({ x, y, d: Math.hypot(x - cx, y - cy) });
    }
  }
  candidatos.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);

  // Preferido: los n pines en fila o en columna (se leen como un grupo), la
  // más cercana al centro de la sala.
  const libre = new Set(candidatos.map(c => `${c.x.toFixed(2)},${c.y.toFixed(2)}`));
  const esLibre = (x, y) => libre.has(`${x.toFixed(2)},${y.toFixed(2)}`);
  const pasos = Math.round(SEP / PASO);
  let mejor = null;
  for (const c of candidatos) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const fila = Array.from({ length: n }, (_, i) => ({ x: c.x + dx * i * pasos * PASO, y: c.y + dy * i * pasos * PASO }));
      if (!fila.every(p => esLibre(p.x, p.y))) continue;
      const mx = fila.reduce((s, p) => s + p.x, 0) / n, my = fila.reduce((s, p) => s + p.y, 0) / n;
      const d = Math.hypot(mx - cx, my - cy);
      if (!mejor || d < mejor.d - 1e-9) mejor = { d, fila };
    }
  }
  if (mejor) return mejor.fila;

  const elegidos = [];
  for (const c of candidatos) {
    if (elegidos.length >= n) break;
    if (elegidos.every(e => Math.hypot(e.x - c.x, e.y - c.y) >= SEP)) elegidos.push(c);
  }
  // Orden de lectura: de arriba abajo, de izquierda a derecha.
  return elegidos.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Habitación por defecto para los pines: la más grande que se recorre (no `macizo`). */
const salaDePines = plano => [...plano.habitaciones]
  .filter(h => h.piso !== "macizo" && !h.sinMuros)
  .sort((a, b) => b.w * b.h - a.w * a.h)[0];

function nota({ id, entryId, pageId, x, y, texto, icono, tam = 40, extra = {} }) {
  return {
    _id: id, entryId, pageId,
    x: Math.round(x), y: Math.round(y), elevation: 0, sort: 0, locked: false,
    texture: textura(icono),
    iconSize: tam, text: texto, fontFamily: "Signika", fontSize: 24, textAnchor: 1, textColor: "#ffffff",
    global: false, flags: flags("pin", extra)
  };
}

/**
 * Pines de un plano: uno al journal del lugar y uno por escena del libro que
 * pasa ahí. `plano.escenas` admite "A1-E01" o { id, sala } para elegir la
 * habitación del pin; sin sala van todos juntos a la habitación más grande.
 */
function pinesDe(plano, ctx) {
  const pedidos = [];
  if (plano.lugar) pedidos.push({ clave: plano.lugar, icono: "icons/svg/house.svg", sala: plano.salaLugar });
  for (const e of plano.escenas ?? []) {
    const def = typeof e === "string" ? { id: e } : e;
    pedidos.push({ clave: def.id, icono: "icons/svg/book.svg", sala: def.sala });
  }
  const porSala = new Map();
  for (const p of pedidos) {
    const ent = ctx.reg.get(p.clave);
    const ids = idsDeUuid(ent?.uuid);
    if (!ids) { ctx.avisos.push(`plano ${plano.id}: «${p.clave}» no resuelve a un journal o página; sin pin`); continue; }
    let hab = p.sala ? plano.habitaciones.find(h => h.nombre === p.sala) : null;
    if (p.sala && !hab) ctx.avisos.push(`plano ${plano.id}: la sala «${p.sala}» del pin ${p.clave} no existe`);
    hab ??= salaDePines(plano);
    if (!porSala.has(hab)) porSala.set(hab, []);
    porSala.get(hab).push({ ...p, ...ids, nombre: ent.nombre });
  }
  const notes = [];
  for (const [hab, lista] of porSala) {
    const puntos = puntosLibres(plano, hab, lista.length);
    if (puntos.length < lista.length) ctx.avisos.push(`plano ${plano.id}: no hay lugar libre para ${lista.length} pines en «${hab.nombre}»`);
    lista.forEach((p, i) => {
      const pt = puntos[i] ?? { x: hab.x + hab.w / 2, y: hab.y + hab.h / 2 };
      notes.push(nota({
        id: idEstable(`nota:${plano.id}:${p.clave}`), entryId: p.entryId, pageId: p.pageId,
        x: px(pt.x), y: px(pt.y), texto: p.clave, icono: p.icono,
        extra: { escena: plano.id, id: p.clave }
      }));
    });
  }
  return notes;
}

/* -------------------------------------------- */
/*  Escenas desde planos                        */
/* -------------------------------------------- */

function escenasDePlanos(ctx, carpetas) {
  const planos = cargarPlanos();
  const regionesDe = new Map(planos.map(p => [p.id, new Set((p.regiones ?? []).map(r => r.id))]));
  const uuidDeRegion = (idPlano, idRegion) =>
    `Scene.${ID.escena(idPlano)}.Region.${idEstable(`region:${idPlano}:${idRegion}`)}`;
  const resumen = [];

  for (const plano of planos) {
    // Fondo: el mapa pintado; si no está, el esquema (provisional).
    const pintado = `assets/mapas/${plano.id}.webp`;
    const esquema = `assets/mapas/${plano.id}.esquema.webp`;
    let fondo = pintado;
    if (!existe(pintado)) {
      if (!existe(esquema)) { ctx.avisos.push(`plano ${plano.id}: no hay mapa ni esquema; corré npm run planos`); continue; }
      fondo = esquema;
      ctx.avisos.push(`plano ${plano.id}: sin mapa pintado, uso el esquema como fondo provisional (npm run pintar)`);
    }
    const W = px(plano.ancho), H = px(plano.alto);
    const { w, h } = dimensiones(path.join(RAIZ, fondo));
    if (w !== W || h !== H) ctx.avisos.push(`plano ${plano.id}: el fondo mide ${w}×${h} y el plano ${W}×${H}; manda el plano`);

    // Muros (el _tipo es sólo para el renderer).
    const walls = derivarMuros(plano).map(({ _tipo, ...m }, i) => ({ _id: idEstable(`muro:${plano.id}:${i}`), ...m, flags: {} }));

    // Regiones: un destino que no resuelve se vuelve marcador inerte (como `destino: null`).
    const regiones = (plano.regiones ?? []).map(rg => {
      if (!rg.destino) return rg;
      const [pd, rd] = rg.destino.split(":");
      if (regionesDe.get(pd)?.has(rd)) return rg;
      ctx.avisos.push(`plano ${plano.id}: la región «${rg.id}» apunta a «${rg.destino}», que no existe; queda inerte`);
      return { ...rg, destino: null, pendiente: rg.pendiente ?? `falta ${rg.destino}` };
    });
    const regions = derivarRegiones({ ...plano, regiones }, idEstable, uuidDeRegion);
    for (const [i, rg] of regions.entries()) {
      const def = regiones[i];
      const estado = def.llegada ? "llegada" : def.destino ? "transicion" : "pendiente";
      rg.flags = flags("region", { escena: plano.id, region: def.id, estado, ...(def.pendiente ? { pendiente: def.pendiente } : {}) });
    }

    const lights = lucesDePlano(plano, idEstable);
    const { tiles, sinTile } = tilesDe(plano, ctx);
    const notes = pinesDe(plano, ctx);

    // Journal del lugar (Scene.journal) y nota del Narrador.
    const lugar = plano.lugar ? ctx.reg.get(plano.lugar) : null;
    const idsLugar = idsDeUuid(lugar?.uuid);
    if (plano.lugar && !idsLugar) ctx.avisos.push(`plano ${plano.id}: el lugar ${plano.lugar} no está en el registro`);
    const enlaces = [];
    if (idsLugar) enlaces.push(`<strong>Lugar:</strong> @UUID[${lugar.uuid}]{${lugar.nombre}}`);
    const escenasLibro = (plano.escenas ?? []).map(e => (typeof e === "string" ? e : e.id))
      .map(e => ctx.reg.get(e)).filter(Boolean);
    if (escenasLibro.length) enlaces.push(`<strong>Escenas:</strong> ${escenasLibro.map(e => `@UUID[${e.uuid}]{${e.nombre}}`).join(" · ")}`);
    const cuenta = sinTile.reduce((acc, m) => ({ ...acc, [m.tipo]: (acc[m.tipo] ?? 0) + 1 }), {});
    const textoMoviles = [
      tiles.length ? `Los muebles móviles (${tiles.length}) son tiles desbloqueados: se pueden mover, tirar o usar de barricada.` : "",
      sinTile.length ? `Muebles móviles sin pintar y todavía sin tile (colocarlos a mano): ${Object.entries(cuenta)
        .map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(", ")}.` : ""
    ].filter(Boolean).join(" ");
    const pendientes = regiones.filter(r => !r.destino && !r.llegada);
    const htmlNota = [
      enlaces.length ? `<p>${enlaces.join("<br>")}</p>` : "",
      md2html(plano.nota),
      textoMoviles ? `<p class="sbn-moviles">${textoMoviles}</p>` : "",
      pendientes.length ? `<p class="sbn-pendientes"><strong>Accesos sin mapa (región gris, no lleva a ningún lado):</strong> ${pendientes.map(r => r.nombre).join(" · ")}.</p>` : ""
    ].filter(Boolean).join("\n");

    escribirDoc(PACK, docEscena({
      id: plano.id, nombre: plano.nombre ?? plano.id, carpeta: carpetas.id(plano.carpeta ?? "Lugares"),
      orden: plano.orden ?? 10, w: W, h: H,
      oscuridad: plano.oscuridad ?? 0.5, luzGlobal: plano.luzGlobal,
      fondo, walls, lights, regions, notes, tiles,
      journal: idsLugar?.entryId ?? null,
      extra: {
        ...(plano.lugar ? { id: plano.lugar } : {}), plano: plano.id, provisional: fondo === esquema,
        nota: htmlNota, moviles: sinTile.map(m => ({ tipo: m.tipo, tile: m.tile ?? null, x: m.x, y: m.y, w: m.w, h: m.h }))
      }
    }));

    const n = t => walls.filter(m => t(m)).length;
    resumen.push(`  ${plano.id.padEnd(16)} ${W}×${H}  ${n(m => !m.door && m.move === undefined)} muros · ` +
      `${n(m => m.door && m.sight === undefined)} puertas · ${n(m => m.door && m.sight === 0)} puertas/ventanas de vidrio · ` +
      `${n(m => !m.door && m.move === 20 && m.sound !== 0)} vidrios · ${n(m => !m.door && m.sound === 0)} barandas · ` +
      `${lights.length} luces · ${regions.length} regiones (${regions.filter(r => r.behaviors.length).length} activas) · ` +
      `${notes.length} pines · ${tiles.length} tiles${fondo === esquema ? " · ESQUEMA" : ""}`);
  }
  for (const r of resumen) ctx.log(r);
  return resumen.length;
}

/* -------------------------------------------- */
/*  Portada (landing)                           */
/* -------------------------------------------- */

/**
 * La escena que se activa al importar (flag `landing`, como DVV): sin
 * cuadrícula ni visión, con pines a los journals de entrada.
 */
function portada(ctx) {
  const W = 1920, H = 1080;
  const arte = ["assets/portadas/portada.webp", "assets/mapas/portada.webp"].find(existe) ?? null;
  if (!arte) ctx.avisos.push(`portada: sin arte todavía (assets/portadas/portada.webp); fondo sólido ${COLOR_PORTADA}`);
  const { w, h } = arte ? dimensiones(path.join(RAIZ, arte)) : { w: W, h: H };

  const PINES = [
    { clave: "COMO-USAR", icono: "icons/svg/book.svg" },
    { clave: "AVE-01", icono: "icons/svg/city.svg" },
    { clave: "PANTALLA", icono: "icons/svg/eye.svg" },
    // Dark Pack: el aviso legal también desde la portada.
    { clave: "AVISO-LEGAL", icono: "icons/svg/padlock.svg" }
  ].filter(p => {
    const ok = idsDeUuid(ctx.reg.get(p.clave)?.uuid);
    if (!ok) ctx.avisos.push(`portada: «${p.clave}» no está en el registro; sin pin`);
    return ok;
  });
  const paso = 260, x0 = w / 2 - ((PINES.length - 1) * paso) / 2;
  const notes = PINES.map((p, i) => {
    const ent = ctx.reg.get(p.clave);
    return nota({
      id: idEstable(`nota:portada:${p.clave}`), ...idsDeUuid(ent.uuid),
      x: x0 + i * paso, y: h * 0.62, texto: ent.nombre, icono: p.icono, tam: 64,
      extra: { escena: "portada", id: p.clave }
    });
  });

  escribirDoc(PACK, docEscena({
    id: "portada", nombre: "Seattle by Night — El Expediente Ward", carpeta: null, orden: -10,
    w, h, sinGrid: true, oscuridad: 0, luzGlobal: true, visionToken: false,
    fondo: arte, colorFondo: COLOR_PORTADA, notes,
    extra: { landing: true, provisional: !arte, nota: "<p>Portada de la crónica. Los pines abren cómo usar el módulo, la aventura y la Pantalla del Narrador.</p>" }
  }));
}

/* -------------------------------------------- */

export async function construir(ctx) {
  const carpetas = new Carpetas(PACK, "Scene");
  portada(ctx);
  const n = escenasDePlanos(ctx, carpetas) + 1;
  carpetas.escribir();
  console.log(`escenas: ${n} (portada + ${n - 1} de planos)`);
}

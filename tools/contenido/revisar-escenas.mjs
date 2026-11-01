#!/usr/bin/env node
/**
 * Revisión de las escenas que salen de un plano: luces, pines, tokens, tiles.
 *
 * Lee lo que de verdad va a Foundry (packs-src/escenas/*.json, el resultado de
 * `npm run contenido`) y lo cruza con su plano (content/planos) para:
 *
 *   1. Dibujar una imagen de revisión por plano, `<salida>/<plano>.jpg`: el mapa
 *      pintado (o el esquema, si es lo que usa la escena) a ~2000 px de ancho
 *      con los muros (puertas y ventanas en otros colores), el nombre de cada
 *      habitación, cada luz con su radio bright (lleno) y dim (línea), en el
 *      color del preset (las apagadas, punteadas), cada pin con su texto, cada
 *      token con su nombre (los ocultos, punteados), los tiles como rectángulo,
 *      las regiones, una grilla de 1 m con las coordenadas en los bordes y, en
 *      rojo rayado, las habitaciones a las que no llega ninguna luz. Abajo, la
 *      leyenda y una banda con la oscuridad de la escena y la luz global.
 *
 *   2. Correr chequeos automáticos e imprimirlos por plano, con ERROR y AVISO:
 *      - pin fuera de la habitación que declara (`sala` / `salaLugar`), pin sin
 *        `sala` (cayó en la habitación más grande por descarte), pin sobre un
 *        muro, un mueble o un token;
 *      - luz fuera del mapa, en un macizo, fuera de toda habitación sobre un
 *        fondo sin piso (techos vecinos, roca), a menos de 0,3 m de un muro que
 *        corta la luz, o encimada con otra;
 *      - habitación transitable a la que no llega ninguna luz encendida (radio
 *        dim, cortado por los muros como en Foundry), salvo `oscura: true` en
 *        la habitación (o `sinLuces: true` en el plano: las linternas son de los
 *        PJ);
 *      - escena con oscuridad ≥ 0,9 y pocas luces encendidas.
 *
 * La geometría de las habitaciones es la de tools/planos.mjs (normalizar,
 * dentroDeHabitacion), así que vale también para los contornos (la Galería).
 *
 * Uso:
 *   node tools/contenido/revisar-escenas.mjs [--solo helen,granja] [--salida <carpeta>]
 *        [--sin-imagen] [--detalle] [--json <archivo>] [--ancho 2000] [--estricto]
 *
 *   --salida     carpeta de las imágenes (por defecto $TMPDIR/sbn-revision). Nunca assets/.
 *   --sin-imagen sólo los chequeos.
 *   --detalle    además lista cada luz (con su sala y coordenadas) y la cobertura
 *                de luz de cada habitación.
 *   --json       vuelca todos los hallazgos (y las luces, pines y coberturas) a un JSON.
 *   --estricto   sale con código 1 si hay algún ERROR.
 *
 * Requisitos: ImageMagick 7 (`magick`) con el delegado rsvg, como construir-planos.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { RAIZ, MODULO, idEstable } from "../util.mjs";
import { cargarPlanos } from "../construir-planos.mjs";
import { normalizar, dentroDeHabitacion, PX_POR_M } from "../planos.mjs";
import { presetDe, PRESETS } from "../iluminacion.mjs";

/* -------------------------------------------- */
/*  Umbrales                                    */
/* -------------------------------------------- */

export const UMBRAL = {
  luzMuro: 0.3,          // m: luz centrada más cerca de un muro que corta la luz → ERROR
  luzChica: 1.0,         // m de dim: un LED pegado a la pared es normal → sólo AVISO
  luzDoble: 0.3,         // m: dos luces encendidas así de juntas → AVISO
  pinMuro: 0.25,         // m: pin a menos de esto de cualquier muro o vano → ERROR
  pinMueble: 0.1,        // m: margen del mueble para «pin encima»
  oscuridadAlta: 0.9,    // darkness desde la que se cuentan las luces
  pocasLuces: 3,         // menos luces encendidas que esto con oscuridad alta → AVISO
  paso: 0.5,             // m: muestreo de la cobertura de luz
  margenSala: 0.2        // m: no se muestrea pegado a la pared
};

/** Pisos que no se recorren: no se les pide luz. */
const NO_TRANSITABLE = new Set(["macizo", "vacio", "agua"]);
/** Fondos que no son suelo: una luz encima flota sobre nada. */
const FONDO_SIN_PISO = new Set(["edificio", "roca", "macizo", "vacio"]);
/** Fondo por paleta (tools/planos.mjs → PALETAS[*].fondo). */
const FONDO_PALETA = { apartamento: "edificio", industrial: "asfalto", subterraneo: "roca", oficina: "edificio",
  galeria: "acera", rural: "tierra", naval: "agua" };

const m = v => v / PX_POR_M;          // px → m
const r2 = v => Math.round(v * 100) / 100;
const fmt = (x, y) => `(${r2(x)}, ${r2(y)})`;

/* -------------------------------------------- */
/*  Geometría                                   */
/* -------------------------------------------- */

/** Distancia (m) de un punto a un segmento [x0, y0, x1, y1] (m). */
function distSegmento(x, y, [x0, y0, x1, y1]) {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}

/** ¿Se cruzan (propiamente) los segmentos p→q y a→b? */
function cruza(px0, py0, qx, qy, [ax, ay, bx, by]) {
  const d = (qx - px0) * (by - ay) - (qy - py0) * (bx - ax);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((ax - px0) * (by - ay) - (ay - py0) * (bx - ax)) / d;
  const u = ((ax - px0) * (qy - py0) - (ay - py0) * (qx - px0)) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9;
}

const areaHab = h => h.w * h.h;

/** Tipo de un muro de la escena, leído de sus campos (como lo ve Foundry). */
export function tipoMuro(w) {
  if (w.door === 2) return "secreta";
  if (w.door === 1) {
    if (w.sight === 0 && w.sound === 0) return "hueco";
    if (w.sight === 0) return "ventana";
    return "puerta";
  }
  if (w.move === 20) return w.sound === 0 ? "baranda" : "vidrio";
  return "muro";
}

/** ¿Este muro corta la luz? (light 0 = no; una puerta abierta, tampoco). */
const cortaLuz = w => (w.light ?? 20) !== 0 && !(w.door > 0 && w.ds === 1);

/* -------------------------------------------- */
/*  Carga                                       */
/* -------------------------------------------- */

/** Escenas de packs-src/escenas que vienen de un plano, por id de plano. */
export function cargarEscenas() {
  const dir = path.join(RAIZ, "packs-src", "escenas");
  const out = new Map();
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith(".json")) continue;
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const plano = d.flags?.[MODULO]?.plano;
    if (d._key?.startsWith("!scenes!") && plano) out.set(plano, { ...d, _archivo: f });
  }
  return out;
}

/** Origen de cada luz de la escena (las de `plano.luces` y las de muebles con `luz`). */
function fuentesDeLuz(plano) {
  const porId = new Map();
  (plano.luces ?? []).forEach((l, i) => {
    porId.set(idEstable(`luz:${plano.id}:l${i}`), { origen: `luces[${i}]`, nombre: l.nombre ?? null, preset: presetDe(l) });
  });
  (plano.muebles ?? []).forEach((mb, i) => {
    const preset = presetDe({ preset: mb.luz ?? (mb.tipo === "vela" ? "vela" : null), presetIdeal: mb.luzIdeal });
    if (!preset) return;
    porId.set(idEstable(`luz:${plano.id}:m${i}`), { origen: `muebles[${i}] (${mb.tipo})`, nombre: mb.desc ?? mb.tipo, preset, mueble: true });
  });
  return porId;
}

/* -------------------------------------------- */
/*  Revisión de un plano                        */
/* -------------------------------------------- */

/**
 * Revisa una escena contra su plano. Devuelve los hallazgos y los datos ya
 * resueltos (en metros) que usa el dibujo.
 */
export function revisarPlano(planoCrudo, escena) {
  const plano = normalizar(planoCrudo);
  const errores = [], avisos = [];
  const W = plano.ancho, H = plano.alto;
  const habs = plano.habitaciones;
  const fondo = plano.fondo ?? FONDO_PALETA[plano.paleta] ?? "edificio";

  // Muros de la escena en metros.
  const muros = (escena.walls ?? []).map(w => ({ c: w.c.map(m), tipo: tipoMuro(w), cortaLuz: cortaLuz(w), ds: w.ds ?? 0 }));
  const murosLuz = muros.filter(w => w.cortaLuz);

  /** La habitación más chica que contiene el punto (o null). */
  const salaDe = (x, y, filtro = () => true) => habs.filter(h => filtro(h) && dentroDeHabitacion(h, x, y))
    .sort((a, b) => areaHab(a) - areaHab(b))[0] ?? null;
  /** La habitación con muros más chica (sin las `sinMuros`, que son sólo piso). */
  const salaConMuros = (x, y) => salaDe(x, y, h => !h.sinMuros) ?? salaDe(x, y);
  const zonaDe = (x, y) => (plano.exteriores ?? []).find(z => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) ?? null;
  const dondeEs = (x, y) => {
    const s = salaDe(x, y);
    if (s) return s.nombre;
    const z = zonaDe(x, y);
    return z ? `exterior «${z.nombre}»` : `fondo «${fondo}»`;
  };

  /* ---------- Luces ---------- */
  const fuentes = fuentesDeLuz(planoCrudo);
  const luces = (escena.lights ?? []).map((l, i) => {
    const f = fuentes.get(l._id) ?? { origen: "?", nombre: l.name ?? null, preset: null };
    return {
      n: i + 1, id: l._id, x: m(l.x), y: m(l.y), bright: l.config.bright, dim: l.config.dim, color: l.config.color,
      apagada: Boolean(l.hidden), nombre: l.name ?? f.nombre, preset: f.preset, origen: f.origen, mueble: Boolean(f.mueble)
    };
  });
  for (const l of luces) {
    l.sala = dondeEs(l.x, l.y);
    const etiqueta = `luz L${l.n} «${l.nombre ?? l.preset}» [${l.preset}] ${fmt(l.x, l.y)}`;
    if (l.x < 0 || l.y < 0 || l.x > W || l.y > H) { errores.push(`${etiqueta}: fuera del mapa (${W} × ${H} m)`); continue; }
    const s = salaDe(l.x, l.y);
    if (s?.piso === "macizo") errores.push(`${etiqueta}: dentro de «${s.nombre}», que es macizo`);
    else if (!s && !zonaDe(l.x, l.y) && FONDO_SIN_PISO.has(fondo)) {
      avisos.push(`${etiqueta}: fuera de toda habitación y exterior, sobre el fondo «${fondo}» (sin piso)`);
    }
    // Pegada a un muro que corta la luz.
    let cerca = null, dmin = Infinity;
    for (const w of murosLuz) {
      const d = distSegmento(l.x, l.y, w.c);
      if (d < dmin) { dmin = d; cerca = w; }
    }
    l.distMuro = dmin;
    if (cerca && dmin < UMBRAL.luzMuro - 1e-6) {
      const msg = `${etiqueta}: centrada a ${r2(dmin)} m de un ${cerca.tipo} (${cerca.c.map(r2).join(", ")})` +
        (dmin < 0.135 ? ", dentro del grosor del muro pintado" : "");
      (l.dim <= UMBRAL.luzChica ? avisos : errores).push(msg + (l.dim <= UMBRAL.luzChica ? " (luz chica: si es un LED de pared, está bien)" : ""));
    }
  }
  for (let i = 0; i < luces.length; i++) {
    for (let j = i + 1; j < luces.length; j++) {
      const a = luces[i], b = luces[j];
      if (!a.apagada && !b.apagada && a.dim > UMBRAL.luzChica && b.dim > UMBRAL.luzChica && Math.hypot(a.x - b.x, a.y - b.y) < UMBRAL.luzDoble) {
        avisos.push(`luces L${a.n} y L${b.n} encimadas en ${fmt(a.x, a.y)}`);
      }
    }
  }

  /* ---------- Cobertura de luz por habitación ---------- */
  const encendidas = luces.filter(l => !l.apagada && l.dim > 0);
  const iluminado = (x, y, radio) => encendidas.some(l => {
    const r = radio(l);
    if (Math.hypot(l.x - x, l.y - y) > r) return false;
    return !murosLuz.some(w => cruza(l.x, l.y, x, y, w.c));
  });
  const global = Boolean(escena.environment?.globalLight?.enabled);
  const coberturas = [];
  for (const h of habs) {
    if (NO_TRANSITABLE.has(h.piso)) continue;
    const pts = [];
    const M = UMBRAL.margenSala, P = UMBRAL.paso;
    for (let y = h.y + M; y <= h.y + h.h - M + 1e-9; y += P) {
      for (let x = h.x + M; x <= h.x + h.w - M + 1e-9; x += P) {
        if (!dentroDeHabitacion(h, x, y)) continue;
        // Un punto que cae en una habitación con muros más chica es de esa otra.
        const otra = habs.find(o => o !== h && !o.sinMuros && areaHab(o) < areaHab(h) && dentroDeHabitacion(o, x, y));
        if (otra) continue;
        pts.push([x, y]);
      }
    }
    if (!pts.length) pts.push([h.x + h.w / 2, h.y + h.h / 2]);
    const dim = pts.filter(([x, y]) => iluminado(x, y, l => l.dim)).length / pts.length;
    const bright = pts.filter(([x, y]) => iluminado(x, y, l => l.bright)).length / pts.length;
    const exenta = Boolean(h.oscura || plano.sinLuces);
    coberturas.push({ sala: h.nombre, dim, bright, exenta, sinMuros: Boolean(h.sinMuros), hab: h });
    if (dim === 0 && !exenta && !global) {
      avisos.push(`habitación «${h.nombre}»${h.sinMuros ? " (sólo piso)" : ""}: no le llega ninguna luz encendida ` +
        `(si es a propósito, "oscura": true)`);
    }
  }

  /* ---------- Oscuridad ---------- */
  const oscuridad = escena.environment?.darknessLevel ?? 0;
  if (oscuridad >= UMBRAL.oscuridadAlta && !global && encendidas.length < UMBRAL.pocasLuces && !plano.sinLuces) {
    avisos.push(`oscuridad ${oscuridad} con ${encendidas.length} luz(es) encendida(s): casi todo depende de la visión de los PJ ` +
      `(si es a propósito, "sinLuces": true en el plano)`);
  }

  /* ---------- Pines ---------- */
  const declarada = new Map();
  if (planoCrudo.lugar) declarada.set(planoCrudo.lugar, planoCrudo.salaLugar ?? null);
  for (const e of planoCrudo.escenas ?? []) {
    const def = typeof e === "string" ? { id: e } : e;
    declarada.set(def.id, def.sala ?? null);
  }
  const tokens = (escena.tokens ?? []).map(t => ({
    nombre: t.name, x: m(t.x), y: m(t.y), w: t.width, h: t.height, oculto: Boolean(t.hidden)
  }));
  const pines = (escena.notes ?? []).map(nt => {
    const clave = nt.flags?.[MODULO]?.id ?? nt.text;
    const x = m(nt.x), y = m(nt.y);
    const sala = declarada.get(clave) ?? null;
    const cae = salaConMuros(x, y);
    const p = { clave, texto: nt.text, x, y, tam: nt.iconSize ?? 40, fuente: nt.fontSize ?? 24,
      salaDeclarada: sala, salaReal: cae?.nombre ?? dondeEs(x, y), error: false };
    const etiqueta = `pin ${clave} ${fmt(x, y)}`;
    if (sala) {
      const hab = habs.find(h => h.nombre === sala);
      if (!hab) { errores.push(`${etiqueta}: declara la sala «${sala}», que no existe en el plano`); p.error = true; }
      else if (!dentroDeHabitacion(hab, x, y)) { errores.push(`${etiqueta}: declara «${sala}» pero cae en «${p.salaReal}»`); p.error = true; }
      // Sólo cuenta una sala con muros MÁS CHICA que la declarada (anidada en
      // ella). Si la declarada es un piso `sinMuros` dentro de una sala grande
      // (la losa de la cisterna en la sala de calderas), caer en la grande está bien.
      else if (cae && cae !== hab && !cae.sinMuros && areaHab(cae) < areaHab(hab)) { errores.push(`${etiqueta}: declara «${sala}» pero cae dentro de «${cae.nombre}», que está adentro`); p.error = true; }
    } else {
      avisos.push(`${etiqueta}: sin \`sala\`, cayó por descarte en «${p.salaReal}»`);
      p.sinSala = true;
    }
    const muro = muros.find(w => distSegmento(x, y, w.c) < UMBRAL.pinMuro);
    if (muro) { errores.push(`${etiqueta}: sobre un ${muro.tipo} (${muro.c.map(r2).join(", ")})`); p.error = true; }
    const mb = (planoCrudo.muebles ?? []).find(o => {
      const M = UMBRAL.pinMueble, w = o.w ?? 0.1, h = o.h ?? 0.1;
      return x > o.x - M && x < o.x + w + M && y > o.y - M && y < o.y + h + M;
    });
    if (mb) avisos.push(`${etiqueta}: encima del mueble ${mb.tipo}${mb.desc ? ` («${mb.desc.slice(0, 50)}»)` : ""}`);
    const tk = tokens.find(t => x > t.x && x < t.x + t.w && y > t.y && y < t.y + t.h);
    if (tk) avisos.push(`${etiqueta}: debajo del token ${tk.nombre}${tk.oculto ? " (oculto)" : ""}`);
    return p;
  });
  // Rótulos: Foundry escribe el texto debajo del ícono, centrado (≈ 0,55 em por carácter).
  const caja = p => {
    const w = m(p.texto.length * p.fuente * 0.55), h = m(p.fuente * 1.2), a = m(p.tam / 2);
    return { x0: p.x - Math.max(w / 2, a), x1: p.x + Math.max(w / 2, a), y0: p.y - a, y1: p.y + a + h };
  };
  for (let i = 0; i < pines.length; i++) {
    for (let j = i + 1; j < pines.length; j++) {
      const a = caja(pines[i]), b = caja(pines[j]);
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
        avisos.push(`pines ${pines[i].clave} y ${pines[j].clave}: el ícono o el rótulo se pisan`);
      }
    }
  }

  return { plano, escena, errores, avisos, luces, coberturas, pines, tokens, muros, oscuridad, global, fondo };
}

/* -------------------------------------------- */
/*  Dibujo                                      */
/* -------------------------------------------- */

const COLOR_MURO = { muro: "#ff2a2a", secreta: "#ff00ff", puerta: "#22dd44", ventana: "#00e5ff",
  hueco: "#ff9a3c", vidrio: "#3aa0ff", baranda: "#ffd400" };
const FUENTE = "Liberation Sans, DejaVu Sans, sans-serif";
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texto con halo negro, para que se lea sobre cualquier mapa. */
function texto(x, y, cad, { tam = 14, color = "#ffffff", ancla = "middle", peso = "bold", estilo = "normal", lineas = null } = {}) {
  const ls = lineas ?? [cad];
  const y0 = y - ((ls.length - 1) * tam * 1.15) / 2;
  const tspans = ls.map((l, i) => `<tspan x="${x.toFixed(1)}" y="${(y0 + i * tam * 1.15).toFixed(1)}">${esc(l)}</tspan>`).join("");
  return `<text font-family="${FUENTE}" font-size="${tam}" font-weight="${peso}" font-style="${estilo}" fill="${color}" ` +
    `text-anchor="${ancla}" dominant-baseline="middle" stroke="#000" stroke-width="${Math.max(2.5, tam / 4.5)}" ` +
    `stroke-linejoin="round" paint-order="stroke">${tspans}</text>`;
}

/** Corta un texto en líneas de a lo sumo `max` caracteres. */
function partir(cad, max) {
  const out = [];
  let linea = "";
  for (const p of cad.split(/\s+/)) {
    if (!linea) linea = p;
    else if ((linea + " " + p).length <= max) linea += " " + p;
    else { out.push(linea); linea = p; }
  }
  if (linea) out.push(linea);
  return out;
}

/** Centro visual de una habitación (el centroide de su contorno si cae adentro; si no, el del rectángulo). */
function centroDe(h) {
  if (h._puntos) {
    const cx = h._puntos.reduce((s, p) => s + p.x, 0) / h._puntos.length;
    const cy = h._puntos.reduce((s, p) => s + p.y, 0) / h._puntos.length;
    if (dentroDeHabitacion(h, cx, cy)) return [cx, cy];
  }
  return [h.x + h.w / 2, h.y + h.h / 2];
}

function svgRevision(rev, k, alto) {
  const { plano, escena, luces, pines, tokens, muros, coberturas } = rev;
  const W = plano.ancho * PX_POR_M * k, H = plano.alto * PX_POR_M * k;
  const S = v => (v * PX_POR_M * k).toFixed(1);        // m → px de la imagen
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W)}" height="${alto}" viewBox="0 0 ${Math.round(W)} ${alto}">`];
  o.push(`<defs><pattern id="sinluz" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="14" height="14" fill="#ff0000" fill-opacity="0.08"/><line x1="0" y1="0" x2="0" y2="14" stroke="#ff3030" stroke-width="3" stroke-opacity="0.45"/></pattern></defs>`);

  // Grilla de 1 m (más marcada cada 5 m) y coordenadas en los bordes.
  for (let x = 0; x <= plano.ancho; x++) {
    o.push(`<line x1="${S(x)}" y1="0" x2="${S(x)}" y2="${H.toFixed(1)}" stroke="#ffffff" stroke-width="${x % 5 ? 0.6 : 1.4}" opacity="${x % 5 ? 0.13 : 0.3}"/>`);
    if (x < plano.ancho) o.push(texto(+S(x + 0.5), 9, String(x), { tam: 11, color: "#d8d8d8", peso: "normal" }));
  }
  for (let y = 0; y <= plano.alto; y++) {
    o.push(`<line x1="0" y1="${S(y)}" x2="${W.toFixed(1)}" y2="${S(y)}" stroke="#ffffff" stroke-width="${y % 5 ? 0.6 : 1.4}" opacity="${y % 5 ? 0.13 : 0.3}"/>`);
    if (y < plano.alto) o.push(texto(4, +S(y + 0.5), String(y), { tam: 11, color: "#d8d8d8", peso: "normal", ancla: "start" }));
  }

  // Habitaciones sin luz (rayado rojo).
  for (const c of coberturas) {
    if (c.dim > 0 || c.exenta || rev.global) continue;
    const h = c.hab;
    if (h._puntos) o.push(`<polygon points="${h._puntos.map(p => `${S(p.x)},${S(p.y)}`).join(" ")}" fill="url(#sinluz)"/>`);
    else o.push(`<rect x="${S(h.x)}" y="${S(h.y)}" width="${S(h.w)}" height="${S(h.h)}" fill="url(#sinluz)"/>`);
  }

  // Regiones.
  for (const rg of escena.regions ?? []) {
    for (const sh of rg.shapes ?? []) {
      if (sh.type !== "rectangle") continue;
      o.push(`<rect x="${(sh.x * k).toFixed(1)}" y="${(sh.y * k).toFixed(1)}" width="${(sh.width * k).toFixed(1)}" height="${(sh.height * k).toFixed(1)}" ` +
        `fill="${rg.color}" fill-opacity="0.18" stroke="${rg.color}" stroke-width="2" stroke-dasharray="8 5"/>`);
    }
  }

  // Tiles (rectángulo rotado sobre su centro).
  for (const t of escena.tiles ?? []) {
    const cx = t.x * k, cy = t.y * k, w = t.width * k, h = t.height * k;
    o.push(`<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ` +
      `transform="rotate(${t.rotation ?? 0} ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="#ff8c00" fill-opacity="0.12" stroke="#ff8c00" ` +
      `stroke-width="2"${t.hidden ? ` stroke-dasharray="5 4"` : ""}/>`);
  }

  // Muros.
  for (const w of muros) {
    const [x1, y1, x2, y2] = w.c.map(S);
    const g = w.tipo === "muro" ? 3 : 5;
    o.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLOR_MURO[w.tipo]}" stroke-width="${g}" stroke-linecap="round" opacity="0.9"` +
      `${w.ds === 1 ? ` stroke-dasharray="6 5"` : ""}/>`);
  }

  // Luces: bright lleno, dim en línea; apagadas, punteadas.
  for (const l of luces) {
    const dash = l.apagada ? ` stroke-dasharray="3 6"` : "";
    if (l.dim > 0) o.push(`<circle cx="${S(l.x)}" cy="${S(l.y)}" r="${S(l.dim)}" fill="${l.color}" fill-opacity="${l.apagada ? 0 : 0.05}" stroke="${l.color}" stroke-width="2"${dash} opacity="0.9"/>`);
    if (l.bright > 0) o.push(`<circle cx="${S(l.x)}" cy="${S(l.y)}" r="${S(l.bright)}" fill="${l.color}" fill-opacity="${l.apagada ? 0 : 0.18}" stroke="${l.color}" stroke-width="2.5"${dash}/>`);
  }
  for (const l of luces) {
    const cx = +S(l.x), cy = +S(l.y);
    o.push(`<circle cx="${cx}" cy="${cy}" r="6" fill="${l.apagada ? "#555" : l.color}" stroke="#000" stroke-width="2"/>`);
    const nombre = (l.nombre ?? "").length > 34 ? `${l.nombre.slice(0, 33)}…` : (l.nombre ?? "");
    // Cerca del borde derecho, el rótulo va a la izquierda del punto.
    const izq = cx + 9 + Math.max(nombre.length * 6, 120) > W;
    const tx = izq ? cx - 9 : cx + 9, ancla = izq ? "end" : "start";
    o.push(texto(tx, cy - 8, `L${l.n} ${l.preset ?? "?"}${l.apagada ? " (apagada)" : ""}`, { tam: 13, color: l.color, ancla }));
    if (nombre) o.push(texto(tx, cy + 7, nombre, { tam: 11, color: "#f0f0f0", ancla, peso: "normal" }));
  }

  // Nombres de las habitaciones.
  for (const h of plano.habitaciones) {
    const [cx, cyCentro] = centroDe(h);
    const anchoPx = h.w * PX_POR_M * k, altoPx = h.h * PX_POR_M * k;
    let tam = 15;
    let lineas = partir(h.nombre, Math.max(8, Math.floor(anchoPx / (tam * 0.55))));
    while (tam > 10 && lineas.length * tam * 1.15 > altoPx) {
      tam -= 1;
      lineas = partir(h.nombre, Math.max(8, Math.floor(anchoPx / (tam * 0.55))));
    }
    // Arriba de la sala (las luces y los pines suelen ir al centro), salvo en
    // las salas bajas, o si es un contorno (su centroide).
    const altoTexto = (lineas.length * tam * 1.15) / (PX_POR_M * k);
    const cy = h._puntos || h.h < 1.6 ? cyCentro : h.y + 0.3 + altoTexto / 2;
    const color = h.piso === "macizo" ? "#9aa3ad" : h.sinMuros ? "#c9e3ff" : "#ffffff";
    o.push(texto(+S(cx), +S(cy), h.nombre, { tam, color, lineas, estilo: h.sinMuros ? "italic" : "normal" }));
  }
  for (const z of plano.exteriores ?? []) {
    o.push(texto(+S(z.x + z.w / 2), +S(z.y + Math.min(z.h, 1) / 2), z.nombre, { tam: 12, color: "#b9c4cf", estilo: "italic", peso: "normal" }));
  }

  // Tokens.
  for (const t of tokens) {
    const cx = +S(t.x + t.w / 2), cy = +S(t.y + t.h / 2), r = +S(Math.min(t.w, t.h) / 2) * 0.9;
    const c = t.oculto ? "#c58cff" : "#7dff6a";
    o.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="3"${t.oculto ? ` stroke-dasharray="7 5"` : ""}/>`);
    o.push(texto(cx, cy + r + 9, `${t.nombre}${t.oculto ? " (oculto)" : ""}`, { tam: 12, color: c }));
  }

  // Pines.
  // Como los dibuja Foundry: ícono de iconSize px y el texto (24 px) centrado
  // debajo (textAnchor 1). Así se ve si dos rótulos se pisan en la mesa.
  for (const p of pines) {
    const cx = +S(p.x), cy = +S(p.y), a = (p.tam * k) / 2;
    const c = p.error ? "#ff3030" : p.sinSala ? "#ffd400" : (/^LUG-/.test(p.clave) ? "#d08cff" : "#4fc3ff");
    o.push(`<polygon points="${cx},${cy - a} ${cx + a},${cy} ${cx},${cy + a} ${cx - a},${cy}" fill="${c}" stroke="#000" stroke-width="2.5"/>`);
    const tam = Math.max(12, p.fuente * k);
    o.push(texto(cx, cy + a + tam * 0.65, p.texto, { tam, color: c }));
  }
  return o;
}

/** Leyenda y banda de abajo (en coordenadas de la imagen). */
function svgBanda(rev, W, y0, alto) {
  const o = [`<rect x="0" y="${y0}" width="${W}" height="${alto - y0}" fill="#15181b"/>`,
    `<line x1="0" y1="${y0}" x2="${W}" y2="${y0}" stroke="#555" stroke-width="2"/>`];
  const { plano, oscuridad, global, luces, pines, tokens, errores, avisos, escena } = rev;
  const enc = luces.filter(l => !l.apagada).length;
  const t1 = `${plano.id} · ${plano.nombre ?? ""} · ${plano.ancho} × ${plano.alto} m`;
  o.push(texto(16, y0 + 22, t1, { tam: 18, ancla: "start" }));
  // Oscuridad: barra 0→1 con la marca.
  const bx = 16, by = y0 + 44, bw = Math.min(360, W * 0.3), bh = 16;
  o.push(`<defs><linearGradient id="oscu"><stop offset="0" stop-color="#e8e8e8"/><stop offset="1" stop-color="#000"/></linearGradient></defs>`);
  o.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="url(#oscu)" stroke="#888"/>`);
  o.push(`<rect x="${bx + bw * oscuridad - 3}" y="${by - 4}" width="6" height="${bh + 8}" fill="#ff3030" stroke="#000"/>`);
  o.push(texto(bx + bw + 12, by + bh / 2, `oscuridad ${oscuridad} · luz global ${global ? "SÍ" : "no"} · ` +
    `${enc} luces encendidas, ${luces.length - enc} apagadas · ${pines.length} pines · ${tokens.length} tokens ` +
    `(${tokens.filter(t => t.oculto).length} ocultos) · ${(escena.tiles ?? []).length} tiles`, { tam: 14, ancla: "start", peso: "normal" }));
  o.push(texto(16, by + bh + 20, `${errores.length} ERROR(ES) · ${avisos.length} AVISO(S)`, {
    tam: 16, ancla: "start", color: errores.length ? "#ff5050" : avisos.length ? "#ffd400" : "#7dff6a" }));

  // Leyenda.
  const items = [
    ...Object.entries(COLOR_MURO).map(([t, c]) => ["linea", c, t]),
    ["linea-dash", "#22dd44", "puerta abierta"],
    ["luz", "#ffb46b", "luz: bright lleno, dim línea"],
    ["luz-off", "#ffb46b", "luz apagada"],
    ["pin", "#4fc3ff", "pin de escena"], ["pin", "#d08cff", "pin del lugar"],
    ["pin", "#ffd400", "pin sin sala"], ["pin", "#ff3030", "pin con error"],
    ["token", "#7dff6a", "token"], ["token-off", "#c58cff", "token oculto"],
    ["tile", "#ff8c00", "tile"], ["region", "#b23030", "región"], ["sinluz", "", "sala sin luz"]
  ];
  const col = 190, fila = 22, ix = 16, iy = y0 + 112;
  const porFila = Math.max(1, Math.floor((W - 32) / col));
  items.forEach(([forma, c, nombre], i) => {
    const x = ix + (i % porFila) * col, y = iy + Math.floor(i / porFila) * fila;
    if (forma === "linea" || forma === "linea-dash") o.push(`<line x1="${x}" y1="${y}" x2="${x + 26}" y2="${y}" stroke="${c}" stroke-width="5"${forma === "linea-dash" ? ` stroke-dasharray="6 5"` : ""}/>`);
    if (forma === "luz") o.push(`<circle cx="${x + 13}" cy="${y}" r="8" fill="${c}" fill-opacity="0.3" stroke="${c}" stroke-width="2"/>`);
    if (forma === "luz-off") o.push(`<circle cx="${x + 13}" cy="${y}" r="8" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="2 3"/>`);
    if (forma === "pin") o.push(`<polygon points="${x + 13},${y - 8} ${x + 21},${y} ${x + 13},${y + 8} ${x + 5},${y}" fill="${c}" stroke="#000" stroke-width="1.5"/>`);
    if (forma === "token" || forma === "token-off") o.push(`<circle cx="${x + 13}" cy="${y}" r="8" fill="${c}" fill-opacity="0.2" stroke="${c}" stroke-width="2.5"${forma === "token-off" ? ` stroke-dasharray="4 3"` : ""}/>`);
    if (forma === "tile") o.push(`<rect x="${x + 3}" y="${y - 7}" width="20" height="14" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="2"/>`);
    if (forma === "region") o.push(`<rect x="${x + 3}" y="${y - 7}" width="20" height="14" fill="${c}" fill-opacity="0.2" stroke="${c}" stroke-width="2" stroke-dasharray="4 3"/>`);
    if (forma === "sinluz") o.push(`<rect x="${x + 3}" y="${y - 7}" width="20" height="14" fill="url(#sinluz)" stroke="#ff3030"/>`);
    o.push(texto(x + 32, y, nombre, { tam: 13, ancla: "start", peso: "normal" }));
  });
  return o;
}

/** Fondo de la escena (lo que de verdad carga Foundry). */
function fondoDe(escena, plano) {
  const src = escena.levels?.[0]?.background?.src ?? null;
  const rel = src ? src.replace(`modules/${MODULO}/`, "") : null;
  for (const c of [rel, `assets/mapas/${plano.id}.webp`, `assets/mapas/${plano.id}.esquema.webp`]) {
    if (c && fs.existsSync(path.join(RAIZ, c))) return c;
  }
  return null;
}

export function imagenRevision(rev, salida, { ancho = 2000 } = {}) {
  const { plano, escena } = rev;
  const Wpx = plano.ancho * PX_POR_M, Hpx = plano.alto * PX_POR_M;
  const k = Math.min(ancho / Wpx, 2600 / Hpx);
  const W = Math.round(Wpx * k), H = Math.round(Hpx * k);
  const banda = 112 + Math.ceil(19 / Math.max(1, Math.floor((W - 32) / 190))) * 22 + 10;
  const alto = H + banda;
  const svg = [...svgRevision(rev, k, alto), ...svgBanda(rev, W, H, alto), "</svg>"].join("\n");
  const tmp = path.join(salida, `${plano.id}.revision.svg`);
  fs.writeFileSync(tmp, svg);
  const destino = path.join(salida, `${plano.id}.jpg`);
  const fondo = fondoDe(escena, plano);
  const base = fondo ? [path.join(RAIZ, fondo), "-resize", `${W}x${H}!`] : ["-size", `${W}x${H}`, "xc:#222"];
  try {
    execFileSync("magick", [...base, "-background", "#15181b", "-gravity", "north", "-extent", `${W}x${alto}`,
      "-gravity", "northwest", "(", "-background", "none", tmp, ")", "-composite", "-quality", "86", destino], { stdio: "pipe" });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return { destino, fondo };
}

/* -------------------------------------------- */
/*  CLI                                         */
/* -------------------------------------------- */

function imprimir(rev, detalle) {
  const { plano, errores, avisos, luces, coberturas, pines } = rev;
  console.log(`\n■ ${plano.id} — ${plano.nombre ?? ""} (${plano.ancho} × ${plano.alto} m, oscuridad ${rev.oscuridad}` +
    `${rev.global ? ", luz global" : ""}) · ${errores.length} error(es), ${avisos.length} aviso(s)`);
  for (const e of errores) console.log(`  ERROR  ${e}`);
  for (const a of avisos) console.log(`  AVISO  ${a}`);
  if (!detalle) return;
  console.log("  · luces");
  for (const l of luces) {
    console.log(`    L${String(l.n).padEnd(3)} ${fmt(l.x, l.y).padEnd(15)} ${(l.preset ?? "?").padEnd(19)} b${l.bright}/d${l.dim}` +
      `${l.apagada ? " APAGADA" : ""}  «${l.nombre ?? ""}» en ${l.sala}  [${l.origen}]`);
  }
  console.log("  · cobertura (dim / bright)");
  for (const c of coberturas) {
    console.log(`    ${String(Math.round(c.dim * 100)).padStart(3)} % / ${String(Math.round(c.bright * 100)).padStart(3)} %  ${c.sala}` +
      `${c.sinMuros ? " (sólo piso)" : ""}${c.exenta ? " (oscura a propósito)" : ""}`);
  }
  console.log("  · pines");
  for (const p of pines) console.log(`    ${p.clave.padEnd(11)} ${fmt(p.x, p.y).padEnd(15)} en «${p.salaReal}»${p.salaDeclarada ? ` (declara «${p.salaDeclarada}»)` : " (sin sala)"}`);
}

if (import.meta.filename === process.argv[1]) {
  const argv = process.argv.slice(2);
  const opcion = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const solo = opcion("--solo")?.split(",").map(s => s.trim()).filter(Boolean) ?? null;
  const salida = path.resolve(opcion("--salida") ?? path.join(process.env.TMPDIR || os.tmpdir(), "sbn-revision"));
  const sinImagen = argv.includes("--sin-imagen");
  const detalle = argv.includes("--detalle");
  const json = opcion("--json");
  const ancho = Number(opcion("--ancho") ?? 2000);
  if (salida.startsWith(path.join(RAIZ, "assets"))) { console.error("La revisión no se escribe en assets/."); process.exit(1); }

  const planos = cargarPlanos().filter(p => !solo || solo.includes(p.id));
  const escenas = cargarEscenas();
  if (!escenas.size) { console.error("No hay escenas en packs-src/escenas: corré npm run contenido."); process.exit(1); }
  if (!planos.length) { console.error(`No encontré ${solo ? `los planos ${solo.join(", ")}` : "planos"}.`); process.exit(1); }
  if (!sinImagen) fs.mkdirSync(salida, { recursive: true });

  const todo = [];
  let nErr = 0, nAv = 0;
  for (const plano of planos) {
    const escena = escenas.get(plano.id);
    if (!escena) { console.log(`\n■ ${plano.id}: no tiene escena en packs-src/escenas (¿npm run contenido?)`); continue; }
    const rev = revisarPlano(plano, escena);
    nErr += rev.errores.length; nAv += rev.avisos.length;
    imprimir(rev, detalle);
    let img = null;
    if (!sinImagen) {
      const { destino, fondo } = imagenRevision(rev, salida, { ancho });
      img = destino;
      console.log(`  → ${destino}${fondo ? `  (fondo: ${fondo})` : "  (sin fondo)"}`);
    }
    todo.push({
      plano: plano.id, imagen: img, oscuridad: rev.oscuridad, luzGlobal: rev.global, errores: rev.errores, avisos: rev.avisos,
      luces: rev.luces.map(({ id, ...l }) => ({ ...l, x: r2(l.x), y: r2(l.y), distMuro: r2(l.distMuro) })),
      cobertura: rev.coberturas.map(({ hab, ...c }) => ({ ...c, dim: r2(c.dim), bright: r2(c.bright) })),
      pines: rev.pines.map(p => ({ ...p, x: r2(p.x), y: r2(p.y) }))
    });
  }
  if (json) fs.writeFileSync(path.resolve(json), JSON.stringify(todo, null, 2));
  console.log(`\n${todo.length} escena(s) revisada(s): ${nErr} ERROR(ES), ${nAv} AVISO(S)${sinImagen ? "" : ` · imágenes en ${salida}`}`);
  if (argv.includes("--estricto") && nErr) process.exit(1);
}

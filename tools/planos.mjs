/**
 * Motor de planos vectoriales — Seattle by Night.
 *
 * Adaptado del de Del Velo a la Vigilia (DVV), que a su vez venía de La Cruzada
 * Escarlata. Cambia la unidad: DVV escribía los planos en PIES (30 px/pie) y
 * la escena usaba casillas de 1 m = 100 px, con un 2 % de error. Acá el plano
 * se escribe directamente en METROS y 1 m = 100 px = 1 casilla, sin error.
 *
 * Un interior se define en metros (habitaciones, vanos, muebles) y de ese
 * único archivo salen las dos cosas que Foundry necesita:
 *
 *   1. El mapa (esquema SVG rasterizado; después se repinta con el modelo
 *      local, ver SPEC.md §4).
 *   2. Los MUROS, PUERTAS, VENTANAS, VIDRIOS y BARANDAS, en coordenadas exactas.
 *
 * Así lo que se ve y lo que bloquea el paso son la misma geometría.
 *
 * Reglas duras (MAPS_SPEC.md §2): las puertas NUNCA se dibujan (vano vacío con
 * umbral tenue; la hoja la pone Foundry), no hay texto, no hay grid pintado, no
 * hay luz pintada, y los muebles MÓVILES no se pintan: quedan como nota para el
 * Narrador y se colocan como tiles.
 *
 * Convención: el eje de un vano es el del MURO que perfora. "h" = muro
 * horizontal (corre en X a Y constante), "v" = muro vertical.
 *
 * Tipos de vano:
 *   abierto        hueco libre (arco, paso sin hoja)
 *   puerta         muro con door=1 (Foundry dibuja y abre la hoja)
 *   secreta        muro con door=2; en el mapa se ve como pared maciza
 *   puerta-vidrio  puerta (door=1) que deja pasar la vista y la luz cerrada
 *   ventana        ventana de guillotina que se puede abrir y cruzar (door=1,
 *                  se ve a través). Se dibuja como vidrio: la guillotina sube
 *                  en vertical, así que desde arriba abierta y cerrada se ven
 *                  igual y pintarla no congela ningún estado.
 *   vidrio         paño de vidrio fijo: bloquea el paso, no la visión
 *   baranda        baranda o barandilla: bloquea el paso, no la vista, la luz
 *                  ni el sonido (escalera, escalera de incendios)
 *   arcada         se expande en huecos abiertos separados por pilares
 */

export const PX_POR_M = 100;           // 1 m = 100 px
export const M_POR_CASILLA = 1;
export const GRID_PX = PX_POR_M * M_POR_CASILLA;

const px = m => Math.round(m * PX_POR_M);

/**
 * Las densidades de suciedad y detritos se calibraron en DVV por pie
 * cuadrado. Para conservar el mismo aspecto por superficie real se cuentan
 * en «pies cuadrados equivalentes».
 */
const PIES2_POR_M2 = 10.7639;
const area = (w, h) => w * h * PIES2_POR_M2;

/* -------------------------------------------- */
/*  Aleatoriedad determinista                   */
/* -------------------------------------------- */

/**
 * Las variaciones (valor de cada tabla, manchas, rayones) tienen que ser
 * IGUALES en cada build: si cambian, cada build produce un mapa distinto y el
 * diff del repo es ruido puro.
 */
function azar(semilla) {
  let s = 2166136261;
  for (let i = 0; i < semilla.length; i++) s = Math.imul(s ^ semilla.charCodeAt(i), 16777619) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* -------------------------------------------- */
/*  Normalización                               */
/* -------------------------------------------- */

/**
 * Expande los atajos del plano (arcadas) a vanos simples. Puro e idempotente:
 * todos los consumidores (render, muros, prompt) ven la misma planta.
 */
export function normalizar(plano) {
  if (plano._normalizado) return plano;
  const vanos = [];
  for (const v of plano.vanos ?? []) {
    if (v.tipo !== "arcada") { vanos.push(v); continue; }
    const paso = v.paso ?? 1.5, pilar = v.pilar ?? 0.3;
    for (let t = 0; t < v.w - 1e-9; t += paso) {
      const ini = t + pilar / 2, fin = Math.min(t + paso, v.w) - pilar / 2;
      if (fin - ini < 0.15) continue;
      vanos.push({ ...v, tipo: "abierto", x: v.eje === "h" ? v.x + ini : v.x,
        y: v.eje === "v" ? v.y + ini : v.y, w: fin - ini, _arcada: true });
    }
  }
  return { ...plano, vanos, _normalizado: true };
}

/** Un mueble es móvil si su tipo lo es por defecto, salvo que el plano diga `fijo`. */
const MOVILES = new Set(["silla", "sofa", "mesa", "camilla", "tubos", "lampara", "carro", "palet",
  "portatil", "cenicero"]);
export const esMovil = m => (m.fijo === undefined ? MOVILES.has(m.tipo) : !m.fijo);

/** Los muebles que NO se pintan: van como tiles, y el Narrador los tiene que conocer. */
export function mueblesMoviles(plano) {
  return (plano.muebles ?? []).filter(esMovil);
}

/* -------------------------------------------- */
/*  Geometría de muros                          */
/* -------------------------------------------- */

/**
 * Une intervalos solapados o contiguos.
 * Dos habitaciones vecinas comparten pared: sin esto saldrían dos muros
 * encimados y las puertas quedarían perforando sólo uno de los dos.
 */
function unir(intervalos) {
  const orden = [...intervalos].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [ini, fin] of orden) {
    const ult = out[out.length - 1];
    if (ult && ini <= ult[1] + 1e-9) ult[1] = Math.max(ult[1], fin);
    else out.push([ini, fin]);
  }
  return out;
}

/** Resta huecos de un intervalo. Un vano no «tapa» el muro: lo parte en dos. */
function restar(intervalos, huecos) {
  let actual = intervalos;
  for (const [hi, hf] of huecos) {
    const siguiente = [];
    for (const [ini, fin] of actual) {
      if (hf <= ini || hi >= fin) { siguiente.push([ini, fin]); continue; }
      if (hi > ini) siguiente.push([ini, hi]);
      if (hf < fin) siguiente.push([hf, fin]);
    }
    actual = siguiente;
  }
  return actual.filter(([a, b]) => b - a > 1e-9);
}

/** Sonido de puerta por defecto de cada paleta (claves de CONFIG.Wall.doorSounds). */
const SONIDO_PUERTA = { apartamento: "woodBasic" };
const ESTADO_PUERTA = { cerrada: 0, abierta: 1, trabada: 2 };   // CONST.WALL_DOOR_STATES

/** Una coordenada en metros, redondeada al px. Clave estable para agrupar rectas. */
const fijo = m => Math.round(m * PX_POR_M) / PX_POR_M;

const coordsVano = v => v.eje === "h"
  ? [px(v.x), px(v.y), px(v.x + v.w), px(v.y)]
  : [px(v.x), px(v.y), px(v.x), px(v.y + v.w)];

/**
 * Deriva los muros a partir de las habitaciones y los vanos.
 *
 * Agrupa todas las aristas por recta (orientación + coordenada fija), une los
 * tramos de esa recta, y recién entonces resta los vanos. Hacerlo en ese orden
 * es lo que permite que un vano caiga sobre la pared compartida por dos
 * habitaciones y perfore las dos de una vez.
 *
 * Cada muro sale con `_tipo` ("muro" | "puerta" | "secreta" | "puerta-vidrio" |
 * "ventana" | "vidrio" | "baranda") para el renderer; el build de escenas lo
 * quita antes de escribir.
 */
export function derivarMuros(planoCrudo) {
  const plano = normalizar(planoCrudo);
  const rectas = new Map();
  const clave = (eje, f) => `${eje}:${fijo(f)}`;

  const agregar = (eje, f, ini, fin) => {
    const k = clave(eje, f);
    if (!rectas.has(k)) rectas.set(k, []);
    rectas.get(k).push([Math.min(ini, fin), Math.max(ini, fin)]);
  };

  for (const h of plano.habitaciones) {
    if (h.sinMuros) continue;
    agregar("h", h.y,       h.x, h.x + h.w);
    agregar("h", h.y + h.h, h.x, h.x + h.w);
    agregar("v", h.x,       h.y, h.y + h.h);
    agregar("v", h.x + h.w, h.y, h.y + h.h);
  }

  const huecos = new Map();
  for (const v of plano.vanos ?? []) {
    const f = v.eje === "h" ? v.y : v.x;
    const ini = v.eje === "h" ? v.x : v.y;
    const k = clave(v.eje, f);
    if (!huecos.has(k)) huecos.set(k, []);
    huecos.get(k).push([ini, ini + v.w]);
  }

  const muros = [];
  for (const [k, tramos] of rectas) {
    const [eje, fijaStr] = k.split(":");
    const f = Number(fijaStr);
    for (const [ini, fin] of restar(unir(tramos), huecos.get(k) ?? [])) {
      muros.push(eje === "h"
        ? { c: [px(ini), px(f), px(fin), px(f)], _tipo: "muro" }
        : { c: [px(f), px(ini), px(f), px(fin)], _tipo: "muro" });
    }
  }

  // Las puertas son muros con door=1: Foundry dibuja la hoja y la abre al
  // clickearla. Por eso el mapa NO trae ninguna puerta pintada.
  const sonidoBase = SONIDO_PUERTA[plano.paleta] ?? "woodBasic";
  for (const v of plano.vanos ?? []) {
    const c = coordsVano(v);
    const ds = ESTADO_PUERTA[v.estado] ?? 0;
    switch (v.tipo) {
      case "puerta":
        muros.push({ c, door: 1, ds, doorSound: v.sonido ?? sonidoBase, _tipo: "puerta" });
        break;
      case "secreta":
        muros.push({ c, door: 2, ds, doorSound: v.sonido ?? "woodHeavy", _tipo: "secreta" });
        break;
      case "puerta-vidrio":
        // Cerrada se ve a través: la vista y la luz pasan, el paso no.
        muros.push({ c, door: 1, ds, doorSound: v.sonido ?? "slidingModern",
          sight: 0, light: 0, sound: 10, _tipo: "puerta-vidrio" });
        break;
      case "ventana":
        // Guillotina: se abre como una puerta y deja pasar la vista cerrada.
        muros.push({ c, door: 1, ds, doorSound: v.sonido ?? "slidingWood",
          sight: 0, light: 0, sound: 10, _tipo: "ventana" });
        break;
      case "vidrio":
        // Vidrio fijo: se ve, no se pasa. Insonorizado salvo `sonoro`.
        muros.push({ c, move: 20, sight: 0, light: 0, sound: v.sonoro ? 10 : 20, _tipo: "vidrio" });
        break;
      case "baranda":
        // Barandilla: sólo frena el paso.
        muros.push({ c, move: 20, sight: 0, light: 0, sound: 0, _tipo: "baranda" });
        break;
      default: break;   // abierto: solo hueco
    }
  }

  return muros;
}

/* -------------------------------------------- */
/*  Paletas                                     */
/* -------------------------------------------- */

/**
 * Cada paleta es la expresión vectorial del contrato de estilo (MAPS_SPEC.md
 * §5): pizarra mojada, azul de puerto, negro y, como acento, el carmesí; el
 * naranja de sodio lo pone la luz de Foundry, no el mapa. Seattle en
 * noviembre: nada de musgo verde ni calidez dorada; la mugre es urbana y la
 * humedad, gris.
 *
 * `tono` es el tono ambiente uniforme de la escena: un lavado parejo, NUNCA un
 * charco ni un halo. Las fuentes de luz las pone Foundry (tools/iluminacion.mjs).
 *
 * Paletas previstas para los otros lugares (oficina, industrial, subterráneo):
 * Pendiente, se definen con su primer plano.
 */
const PALETAS = {
  // Edificio de ladrillo viejo de Ballard: tablas de abeto gastadas, revoque
  // gris pizarra, el frío azul de puerto metido en todo.
  apartamento: {
    fondo: "edificio", exterior: "#33383d", exteriorDetalle: "#24282c",
    muroEstilo: "revoque", muro: "#5a6066", muroSombra: "#12161a", tinta: "#101317",
    umbral: "#8b939a", vidrio: "#9fb6c4", marco: "#3a434b", metal: "#2a2f34",
    tinte: "#5f7a8c", tinteK: 0.16, suciedad: "mugre", mugre: "#3a3f44",
    tono: "#1c2a36", tonoK: 0.06
  }
};

/**
 * Materiales de piso. `lado` en metros: las juntas caen en divisores de la
 * casilla de 1 m, que es como el piso «lee» el grid sin dibujarlo.
 */
const PISOS = {
  linoleo:  { base: "#b4babd", junta: "#8c9397", var: 0.05, lado: 0.5, rayones: true },
  baldosa:  { base: "#c6c8c3", junta: "#8a8e8b", var: 0.07, lado: 1 / 3 },
  azulejo:  { base: "#cdd5d7", junta: "#93a0a3", var: 0.05, lado: 0.25 },
  terrazo:  { base: "#a7a397", junta: "#77746b", var: 0.07, lado: 0.5, motas: true, rayones: true },
  moqueta:  { base: "#5b646d", junta: "#49515a", var: 0.05, lado: 0.5, moqueta: true },
  tecnico:  { base: "#a2a8ac", junta: "#6b7276", var: 0.04, lado: 0.5, perforado: true },
  hormigon: { base: "#8b8c88", junta: "#636460", var: 0.04, lado: 3, hormigon: true },
  parquet:  { base: "#8b7657", junta: "#4f4232", veta: "#6e5c42", tabla: 0.2, largo: [0.6, 1.5] },
  // Tablas de abeto de 1910, anchas, largas y grises de tanto fregarlas.
  tablas:   { base: "#7d6f5c", junta: "#3f372d", veta: "#62574a", tabla: 0.2, largo: [1.2, 3.2] },
  piedra:   { base: "#999488", junta: "#5c5952", var: 0.18, lado: 0.5, losa: true },
  tierra:   { base: "#6b5d49", junta: "#55493a", tierra: true },
  grava:    { base: "#8f8a7e", junta: "#6f6a60", grava: true },
  // Entablonado con un camino de alfombra gastado al medio (pasillo de edificio viejo).
  "tablas-alfombra": { base: "#7d6f5c", junta: "#3f372d", veta: "#62574a", tabla: 0.2, largo: [1.2, 3.2],
    alfombra: "#46403d", guarda: "#2a2624", margen: 0.3 },
  // Rejilla de acero de la escalera de incendios: se ve el suelo de abajo.
  rejilla:  { base: "#2c3135", junta: "#4c5359", rejilla: true },
  // Departamento vecino cerrado: macizo rayado, como el edificio de al lado.
  macizo:   { macizo: true }
};

/* -------------------------------------------- */
/*  Utilidades de dibujo                        */
/* -------------------------------------------- */

/** Un borde con temblor: la línea recta perfecta es lo que delata al vector. */
function bordeTembloroso(x, y, w, h, r, amp = 2.2) {
  const p = [];
  const paso = 26;
  const punto = (px_, py_) => `${(px_ + (r() - 0.5) * amp).toFixed(1)},${(py_ + (r() - 0.5) * amp).toFixed(1)}`;
  for (let t = 0; t <= w; t += paso) p.push(punto(x + Math.min(t, w), y));
  for (let t = 0; t <= h; t += paso) p.push(punto(x + w, y + Math.min(t, h)));
  for (let t = 0; t <= w; t += paso) p.push(punto(x + w - Math.min(t, w), y + h));
  for (let t = 0; t <= h; t += paso) p.push(punto(x, y + h - Math.min(t, h)));
  return `M${p.join("L")}Z`;
}

const mezclar = (hex, hacia, k) => {
  const c = n => parseInt(hex.slice(1 + n * 2, 3 + n * 2), 16);
  const d = n => parseInt(hacia.slice(1 + n * 2, 3 + n * 2), 16);
  return "#" + [0, 1, 2].map(n => Math.round(c(n) + (d(n) - c(n)) * k)
    .toString(16).padStart(2, "0")).join("");
};
const variar = (hex, v) => mezclar(hex, v > 0 ? "#ffffff" : "#000000", Math.abs(v));

/** El material del piso, teñido por la paleta del lugar. */
function material(nombre, p) {
  const m = PISOS[nombre] ?? PISOS.linoleo;
  const t = c => (c && p.tinte ? mezclar(c, p.tinte, p.tinteK) : c);
  return { ...m, base: t(m.base), junta: t(m.junta), alterno: t(m.alterno), veta: t(m.veta) };
}

/** Rayado de corte de arquitectura (edificio vecino, departamento cerrado). */
const defRayado = p => `<pattern id="rayado" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
  `<rect width="18" height="18" fill="${p.exterior}"/>` +
  `<line x1="0" y1="0" x2="0" y2="18" stroke="${p.exteriorDetalle}" stroke-width="5"/></pattern>`;

/* -------------------------------------------- */
/*  Pisos                                       */
/* -------------------------------------------- */

/** Losetas regulares (linóleo, baldosa, terrazo, moqueta, piso técnico). */
function pisoLosetas(h, m, p, r) {
  const out = [];
  const lado = m.lado;
  let fila = 0;
  for (let y = h.y; y < h.y + h.h - 0.01; y += lado, fila++) {
    let col = 0;
    for (let x = h.x; x < h.x + h.w - 0.01; x += lado, col++) {
      const w = Math.min(lado, h.x + h.w - x), alto = Math.min(lado, h.y + h.h - y);
      const v = (r() - 0.5) * 2 * m.var;
      const relleno = variar(m.base, v);
      const d = m.losa
        ? bordeTembloroso(px(x), px(y), px(w), px(alto), r, 2.6)
        : `M${px(x)},${px(y)}h${px(w)}v${px(alto)}h${-px(w)}Z`;
      out.push(`<path d="${d}" fill="${relleno}" stroke="${m.junta}" stroke-width="${m.losa ? 2 : 1.3}" stroke-linejoin="round"/>`);
      if (m.moqueta) {        // moqueta en losetas a cuarto de vuelta
        const vert = (fila + col) % 2 === 0;
        for (let k = 1; k < 6; k++) {
          const t = k / 6;
          out.push(vert
            ? `<line x1="${px(x) + px(w) * t}" y1="${px(y) + 3}" x2="${px(x) + px(w) * t}" y2="${px(y + alto) - 3}" stroke="${m.junta}" stroke-width="1" opacity="0.35"/>`
            : `<line x1="${px(x) + 3}" y1="${px(y) + px(alto) * t}" x2="${px(x + w) - 3}" y2="${px(y) + px(alto) * t}" stroke="${m.junta}" stroke-width="1" opacity="0.35"/>`);
        }
      }
      if (m.perforado && r() < 0.5) {   // placa de piso técnico ventilada
        for (let a = 1; a < 5; a++) for (let b = 1; b < 5; b++) {
          out.push(`<circle cx="${px(x) + px(w) * a / 5}" cy="${px(y) + px(alto) * b / 5}" r="1.6" fill="${m.junta}" opacity="0.7"/>`);
        }
      }
      if (m.motas) {
        for (let k = 0; k < 10; k++) {
          out.push(`<circle cx="${(px(x) + r() * px(w)).toFixed(1)}" cy="${(px(y) + r() * px(alto)).toFixed(1)}" r="${(0.8 + r() * 1.6).toFixed(1)}" fill="${r() < 0.5 ? m.junta : variar(m.base, 0.25)}" opacity="0.7"/>`);
        }
      }
      if (m.losa && r() < 0.1) {        // grieta
        const cx = px(x) + px(w) * 0.3, cy = px(y) + px(alto) * 0.4;
        out.push(`<path d="M${cx},${cy}l${px(w) * 0.4},${px(alto) * 0.25}" stroke="${m.junta}" stroke-width="1.6" fill="none" opacity="0.8"/>`);
      }
    }
  }
  if (m.rayones) {                       // marcas de ruedas y suelas
    for (let i = 0; i < Math.round(area(h.w, h.h) * 0.04); i++) {
      const x = px(h.x + r() * h.w), y = px(h.y + r() * h.h);
      out.push(`<path d="M${x},${y}q${8 + r() * 14},${(r() - 0.5) * 10} ${16 + r() * 30},${(r() - 0.5) * 6}" ` +
        `stroke="${p.tinta}" stroke-width="1.2" fill="none" opacity="0.18"/>`);
    }
  }
  return out;
}

function pisoHormigon(h, m, p, r) {
  const out = [`<rect x="${px(h.x)}" y="${px(h.y)}" width="${px(h.w)}" height="${px(h.h)}" fill="${m.base}"/>`];
  for (let i = 0; i < Math.round(area(h.w, h.h) * 0.03); i++) {
    out.push(`<ellipse cx="${px(h.x + r() * h.w)}" cy="${px(h.y + r() * h.h)}" rx="${10 + r() * 40}" ry="${8 + r() * 26}" ` +
      `fill="${r() < 0.6 ? m.junta : variar(m.base, 0.12)}" opacity="${(0.12 + r() * 0.2).toFixed(2)}"/>`);
  }
  for (let x = h.x + m.lado; x < h.x + h.w - 0.01; x += m.lado) {
    out.push(`<line x1="${px(x)}" y1="${px(h.y)}" x2="${px(x)}" y2="${px(h.y + h.h)}" stroke="${m.junta}" stroke-width="2.2" opacity="0.8"/>`);
  }
  for (let y = h.y + m.lado; y < h.y + h.h - 0.01; y += m.lado) {
    out.push(`<line x1="${px(h.x)}" y1="${px(y)}" x2="${px(h.x + h.w)}" y2="${px(y)}" stroke="${m.junta}" stroke-width="2.2" opacity="0.8"/>`);
  }
  for (let i = 0; i < Math.round(area(h.w, h.h) * 0.006); i++) {   // manchas de aceite
    out.push(`<ellipse cx="${px(h.x + 0.3 + r() * (h.w - 0.6))}" cy="${px(h.y + 0.3 + r() * (h.h - 0.6))}" rx="${12 + r() * 22}" ry="${9 + r() * 14}" fill="${p.tinta}" opacity="0.22"/>`);
  }
  return out;
}

/**
 * Tablas (parquet o entablonado): tablitas de largo variable, con veta. Corren
 * a lo largo del lado mayor de la habitación, salvo que el plano diga
 * `vetas: "h" | "v"`.
 */
function pisoTablas(h, m, p, r) {
  const out = [];
  const ancho = m.tabla;
  const [lMin, lMax] = m.largo;
  const horizontal = (h.vetas ?? (h.w >= h.h ? "h" : "v")) === "h";
  // En coordenadas «a lo largo» (u) y «a lo ancho» (v) de las tablas.
  const U0 = horizontal ? h.x : h.y, UL = horizontal ? h.w : h.h;
  const V0 = horizontal ? h.y : h.x, VL = horizontal ? h.h : h.w;
  const rect = (u, v, lu, lv, attrs) => horizontal
    ? `<rect x="${px(u)}" y="${px(v)}" width="${px(lu)}" height="${px(lv)}" ${attrs}/>`
    : `<rect x="${px(v)}" y="${px(u)}" width="${px(lv)}" height="${px(lu)}" ${attrs}/>`;
  for (let v = V0; v < V0 + VL - 0.01; v += ancho) {
    const lv = Math.min(ancho, V0 + VL - v);
    let u = U0 - r() * lMax;
    while (u < U0 + UL - 0.01) {
      const ini = Math.max(u, U0);
      const largo = Math.min(lMin + r() * (lMax - lMin), U0 + UL - ini);
      const d = (r() - 0.5) * 0.18;
      out.push(rect(ini, v, largo, lv, `fill="${variar(m.base, d)}" stroke="${m.junta}" stroke-width="1.2"`));
      if (r() < 0.5) {
        const a = px(ini) + 4, b = px(v) + px(lv) / 2, l = px(largo) - 8;
        out.push(horizontal
          ? `<path d="M${a},${b}q${l / 2},${(r() - 0.5) * 4} ${l},0" stroke="${m.veta}" stroke-width="1" fill="none" opacity="0.6"/>`
          : `<path d="M${b},${a}q${(r() - 0.5) * 4},${l / 2} 0,${l}" stroke="${m.veta}" stroke-width="1" fill="none" opacity="0.6"/>`);
      }
      u = ini + largo;
    }
  }
  // Desgaste en el tránsito: zonas más claras y opacas.
  for (let i = 0; i < Math.round(area(h.w, h.h) * 0.02); i++) {
    out.push(`<ellipse cx="${px(h.x + r() * h.w)}" cy="${px(h.y + r() * h.h)}" rx="${20 + r() * 40}" ry="${14 + r() * 24}" fill="${variar(m.base, 0.25)}" opacity="0.16"/>`);
  }
  return out;
}

/** Camino de alfombra sobre las tablas: centrado en el lado corto, con guarda y desgaste. */
function caminoAlfombra(h, m, p, r) {
  const horizontal = h.w >= h.h;
  const mg = m.margen;
  const [x, y, w, hh] = horizontal ? [h.x, h.y + mg, h.w, h.h - 2 * mg] : [h.x + mg, h.y, h.w - 2 * mg, h.h];
  const out = [`<rect x="${px(x)}" y="${px(y)}" width="${px(w)}" height="${px(hh)}" fill="${m.alfombra}" stroke="${p.tinta}" stroke-width="1.6"/>`];
  const g = 7;
  out.push(`<rect x="${px(x) + (horizontal ? -2 : g)}" y="${px(y) + (horizontal ? g : -2)}" width="${px(w) - (horizontal ? -4 : 2 * g)}" height="${px(hh) - (horizontal ? 2 * g : -4)}" fill="none" stroke="${m.guarda}" stroke-width="4"/>`);
  for (let i = 0; i < Math.round(area(w, hh) * 0.05); i++) {      // pisadas y manchas
    out.push(`<ellipse cx="${px(x + r() * w)}" cy="${px(y + r() * hh)}" rx="${(10 + r() * 26).toFixed(0)}" ry="${(8 + r() * 16).toFixed(0)}" fill="${r() < 0.5 ? variar(m.alfombra, 0.12) : p.mugre}" opacity="0.22"/>`);
  }
  return out;
}

/** Tierra o grava: suelo natural, sin retícula. */
function pisoNatural(h, m, p, r) {
  const out = [`<rect x="${px(h.x)}" y="${px(h.y)}" width="${px(h.w)}" height="${px(h.h)}" fill="${m.base}"/>`];
  const n = Math.round(area(h.w, h.h) * (m.grava ? 2.2 : 0.5));
  for (let i = 0; i < n; i++) {
    const x = px(h.x + r() * h.w), y = px(h.y + r() * h.h);
    if (m.grava) {
      out.push(`<ellipse cx="${x}" cy="${y}" rx="${(1.5 + r() * 3).toFixed(1)}" ry="${(1.2 + r() * 2.2).toFixed(1)}" ` +
        `fill="${variar(m.base, (r() - 0.5) * 0.4)}" stroke="${m.junta}" stroke-width="0.8" opacity="0.9"/>`);
    } else {
      out.push(`<ellipse cx="${x}" cy="${y}" rx="${8 + r() * 26}" ry="${6 + r() * 16}" ` +
        `fill="${m.junta}" opacity="${(0.18 + r() * 0.25).toFixed(2)}"/>`);
    }
  }
  return out;
}

/** Rejilla de acero: planchuelas paralelas al lado corto, óxido gris en los bordes. */
function pisoRejilla(h, m, p, r) {
  const out = [`<rect x="${px(h.x)}" y="${px(h.y)}" width="${px(h.w)}" height="${px(h.h)}" fill="${m.base}"/>`];
  const largoX = h.w >= h.h;
  const paso = 0.07;
  if (largoX) {
    for (let x = h.x + paso / 2; x < h.x + h.w; x += paso) {
      out.push(`<line x1="${px(x)}" y1="${px(h.y) + 2}" x2="${px(x)}" y2="${px(h.y + h.h) - 2}" stroke="${m.junta}" stroke-width="2"/>`);
    }
  } else {
    for (let y = h.y + paso / 2; y < h.y + h.h; y += paso) {
      out.push(`<line x1="${px(h.x) + 2}" y1="${px(y)}" x2="${px(h.x + h.w) - 2}" y2="${px(y)}" stroke="${m.junta}" stroke-width="2"/>`);
    }
  }
  for (let i = 0; i < Math.round(area(h.w, h.h) * 0.08); i++) {      // óxido apagado
    out.push(`<ellipse cx="${px(h.x + r() * h.w)}" cy="${px(h.y + r() * h.h)}" rx="${(4 + r() * 12).toFixed(0)}" ry="${(3 + r() * 8).toFixed(0)}" fill="#4a3f38" opacity="0.35"/>`);
  }
  return out;
}

function piso(h, p, r) {
  const m = material(h.piso ?? "linoleo", p);
  if (m.macizo) return [`<rect x="${px(h.x)}" y="${px(h.y)}" width="${px(h.w)}" height="${px(h.h)}" fill="url(#rayado)"/>`];
  if (m.rejilla) return pisoRejilla(h, m, p, r);
  if (m.tierra || m.grava) return pisoNatural(h, m, p, r);
  if (m.hormigon) return pisoHormigon(h, m, p, r);
  if (m.alfombra) return [...pisoTablas(h, m, p, r), ...caminoAlfombra(h, m, p, r)];
  if (m.tabla) return pisoTablas(h, m, p, r);
  return pisoLosetas(h, m, p, r);
}

/* -------------------------------------------- */
/*  Exterior                                    */
/* -------------------------------------------- */

/**
 * El exterior del lienzo. `plano.fondo` (o el de la paleta) cubre todo, y
 * `plano.exteriores[]` ({ x, y, w, h, fondo }) pisa zonas: el callejón, la
 * acera, el edificio de enfrente. Fondos: asfalto, acera, edificio, roca.
 */
function exterior(plano, p, r, W, H) {
  const o = [`<rect width="${W}" height="${H}" fill="${p.exterior}"/>`];
  o.push(...zonaExterior(plano.fondo ?? p.fondo, p, r, 0, 0, W, H));
  for (const z of plano.exteriores ?? []) {
    o.push(...zonaExterior(z.fondo, p, r, px(z.x), px(z.y), px(z.w), px(z.h)));
  }
  return o;
}

function zonaExterior(fondo, p, r, X, Y, W, H) {
  const o = [];
  const sup = (W / PX_POR_M) * (H / PX_POR_M);    // m²
  const enX = () => X + r() * W, enY = () => Y + r() * H;
  if (fondo === "asfalto") {
    o.push(`<rect x="${X}" y="${Y}" width="${W}" height="${H}" fill="${p.exterior}"/>`);
    for (let i = 0; i < Math.round(area(sup, 1) * 1.4); i++) {         // árido
      o.push(`<circle cx="${enX().toFixed(0)}" cy="${enY().toFixed(0)}" r="${(0.8 + r() * 1.6).toFixed(1)}" fill="${r() < 0.5 ? p.exteriorDetalle : variar(p.exterior, 0.2)}" opacity="0.7"/>`);
    }
    for (let i = 0; i < Math.round(area(sup, 1) * 0.009); i++) {       // charcos (llueve)
      const rx = 18 + r() * 45, ry = 12 + r() * 22;
      const cx = Math.min(Math.max(enX(), X + rx), X + W - rx), cy = Math.min(Math.max(enY(), Y + ry), Y + H - ry);
      o.push(`<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="#1b2128" opacity="${(0.3 + r() * 0.2).toFixed(2)}"/>`);
    }
    for (let i = 0; i < Math.round(area(sup, 1) * 0.01); i++) {        // grietas
      const x = enX(), y = enY();
      o.push(`<path d="M${x.toFixed(0)},${y.toFixed(0)}l${(r() - 0.5) * 60},${(r() - 0.5) * 60}l${(r() - 0.5) * 40},${(r() - 0.5) * 40}" stroke="${p.tinta}" stroke-width="1.4" fill="none" opacity="0.5"/>`);
    }
  } else if (fondo === "acera") {
    // Vereda de hormigón en paños de 1,5 m, mojada.
    const base = variar(p.exterior, 0.22);
    o.push(`<rect x="${X}" y="${Y}" width="${W}" height="${H}" fill="${base}"/>`);
    for (let x = X; x < X + W; x += 150) {
      o.push(`<rect x="${x}" y="${Y}" width="${Math.min(150, X + W - x)}" height="${H}" fill="${variar(base, (r() - 0.5) * 0.12)}" stroke="${p.exteriorDetalle}" stroke-width="2"/>`);
    }
    for (let i = 0; i < Math.round(area(sup, 1) * 0.015); i++) {
      o.push(`<ellipse cx="${enX().toFixed(0)}" cy="${enY().toFixed(0)}" rx="${(14 + r() * 30).toFixed(0)}" ry="${(8 + r() * 14).toFixed(0)}" fill="#1b2128" opacity="0.3"/>`);
    }
  } else if (fondo === "edificio") {
    // El edificio vecino: macizo, rayado como corte de arquitectura.
    o.push(`<rect x="${X}" y="${Y}" width="${W}" height="${H}" fill="url(#rayado)" opacity="0.9"/>`);
  } else {   // roca
    for (let i = 0; i < Math.round(area(sup, 1) * 0.08); i++) {
      o.push(`<ellipse cx="${enX().toFixed(0)}" cy="${enY().toFixed(0)}" rx="${30 + r() * 70}" ry="${20 + r() * 50}" fill="${r() < 0.5 ? p.exteriorDetalle : variar(p.exterior, 0.08)}" opacity="0.6"/>`);
    }
  }
  return o;
}

/* -------------------------------------------- */
/*  Suciedad y detritos                         */
/* -------------------------------------------- */

/** Lo que hace que un interior no se lea como diagrama: mugre gris contra los zócalos. */
function suciedad(plano, p, r) {
  const out = [];
  for (const h of plano.habitaciones) {
    if (h.sinMuros || h.piso === "macizo" || h.piso === "rejilla") continue;
    const bordes = [
      [h.x, h.y, h.w, 0], [h.x, h.y + h.h, h.w, 0],
      [h.x, h.y, 0, h.h], [h.x + h.w, h.y, 0, h.h]
    ];
    for (const [bx, by, bw, bh] of bordes) {
      const largo = bw || bh;
      const cuantos = Math.max(1, Math.round(largo / 2.7));
      for (let i = 0; i < cuantos; i++) {
        if (r() > 0.5) continue;
        const t = r() * largo;
        const cx = px(bx + (bw ? t : 0)), cy = px(by + (bh ? t : 0));
        const rx = 10 + r() * 30, ry = 8 + r() * 12;
        out.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${p.mugre}" opacity="0.16"/>`);
      }
    }
  }
  return out;
}

function detritos(plano, p, r) {
  const out = [];
  for (const h of plano.habitaciones) {
    if (h.piso === "macizo" || h.piso === "rejilla") continue;
    const dens = h.limpio ? 0.03 : 0.07;
    for (let i = 0; i < Math.round(area(h.w, h.h) * dens); i++) {
      const x = px(h.x + 0.12 + r() * (h.w - 0.24)), y = px(h.y + 0.12 + r() * (h.h - 0.24));
      const d = r();
      if (d < 0.35) out.push(`<circle cx="${x}" cy="${y}" r="${(1 + r() * 1.6).toFixed(1)}" fill="${p.tinta}" opacity="0.25"/>`);
      else if (d < 0.6) {         // papel, envoltorio, colilla
        const w = 4 + r() * 7, hh = 3 + r() * 5;
        out.push(`<rect x="${x}" y="${y}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" transform="rotate(${(r() * 90).toFixed(0)} ${x} ${y})" fill="#d8d6cf" stroke="${p.tinta}" stroke-width="0.8" opacity="0.55"/>`);
      } else out.push(`<ellipse cx="${x}" cy="${y}" rx="${(6 + r() * 16).toFixed(0)}" ry="${(4 + r() * 9).toFixed(0)}" fill="${p.mugre}" opacity="0.13"/>`);
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Muebles                                     */
/* -------------------------------------------- */

/** Colores de los alfileres de Helen: rojo (muertes), azul (desapariciones), amarillo (sin clasificar). */
const ALFILERES = ["#b0222b", "#b0222b", "#b0222b", "#2f5f9e", "#2f5f9e", "#c9a227"];

/**
 * Sólo los FIJOS llegan acá (escritorios, camas, mesadas, sanitarios,
 * escaleras…). Los móviles van como tiles: ver mueblesMoviles().
 *
 * Convención de cabecera: `m.cabecera` = "n" | "s" | "e" | "o" (lado donde va
 * la almohada). Por defecto, el lado corto de la izquierda o de arriba.
 * `m.frente` (escritorio, tv) = lado desde donde se usa.
 */
function mueble(m, p, r) {
  const x = px(m.x), y = px(m.y), w = px(m.w), h = px(m.h);
  const tinta = `stroke="${p.tinta}" stroke-width="2.6" stroke-linejoin="round"`;
  const fina = `stroke="${p.tinta}" stroke-width="1.5"`;
  const caja = (cx, cy, cw, ch, fill, rx = 3, extra = tinta) =>
    `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="${rx}" fill="${fill}" ${extra}/>`;
  const horizontal = w >= h;
  const cab = m.cabecera ?? (horizontal ? "o" : "n");

  /** Rectángulo de la cabecera de una cama, de profundidad `prof` px. */
  const cabecera = (prof, margen = 5) => {
    switch (cab) {
      case "e": return [x + w - prof - margen, y + margen, prof, h - margen * 2];
      case "s": return [x + margen, y + h - prof - margen, w - margen * 2, prof];
      case "n": return [x + margen, y + margen, w - margen * 2, prof];
      default:  return [x + margen, y + margen, prof, h - margen * 2];
    }
  };

  switch (m.tipo) {
    case "escritorio": {
      // Escritorio de madera vieja. Sin pantalla encendida: la luz la pone Foundry.
      const piezas = [caja(x, y, w, h, "#5d5146", 2)];
      piezas.push(caja(x + 4, y + 4, w - 8, h - 8, "#6e6153", 1, fina));
      const atras = m.frente ?? (horizontal ? "s" : "e");   // el frente mira hacia la silla
      // Cajonera a la derecha de quien se sienta.
      const cajon = (() => {
        const cw = Math.min(px(0.42), (horizontal ? w : h) * 0.3);
        switch (atras) {
          case "s": return [x + w - cw - 4, y + 4, cw, h - 8];
          case "n": return [x + 4, y + 4, cw, h - 8];
          case "e": return [x + 4, y + h - cw - 4, w - 8, cw];
          default:  return [x + 4, y + 4, w - 8, cw];
        }
      })();
      piezas.push(caja(...cajon, "#655849", 1, fina));
      if (m.monitor !== false) {
        const mw = Math.min(px(0.55), w * 0.4), mh = 7;
        const mx = x + w / 2 - mw / 2, my = atras === "n" ? y + h - mh - 6 : y + 6;
        piezas.push(caja(mx, my, mw, mh, "#1d2226", 1, fina));
      }
      // Papeles sueltos y tazas frías: rectángulos de valor, nada legible.
      for (let i = 0; i < 4; i++) {
        const pw = 10 + r() * 14, ph = 8 + r() * 10;
        const fx = x + 8 + r() * Math.max(1, w - pw - 16), fy = y + 8 + r() * Math.max(1, h - ph - 16);
        piezas.push(`<rect x="${fx.toFixed(1)}" y="${fy.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" transform="rotate(${((r() - 0.5) * 30).toFixed(0)} ${fx.toFixed(1)} ${fy.toFixed(1)})" fill="#c9c6bb" stroke="${p.tinta}" stroke-width="0.8" opacity="0.85"/>`);
      }
      piezas.push(`<circle cx="${(x + w * 0.8).toFixed(1)}" cy="${(y + h * 0.35).toFixed(1)}" r="5" fill="#3a2f28" stroke="#d6d2c6" stroke-width="2"/>`);
      if (m.cable) {
        // El cable pelado que cuelga «enchufado a nada» desde el borde del escritorio.
        const cx0 = x + w * 0.45, cy0 = atras === "s" ? y + h - 2 : y + 2;
        const dir = atras === "s" ? 1 : -1;
        piezas.push(`<path d="M${cx0.toFixed(1)},${(cy0 - dir * 14).toFixed(1)}C${(cx0 + 10).toFixed(1)},${(cy0).toFixed(1)} ${(cx0 - 6).toFixed(1)},${(cy0 + dir * 14).toFixed(1)} ${(cx0 + 4).toFixed(1)},${(cy0 + dir * 20).toFixed(1)}" stroke="#15181b" stroke-width="2.4" fill="none"/>`);
        piezas.push(`<circle cx="${(cx0 + 4).toFixed(1)}" cy="${(cy0 + dir * 20).toFixed(1)}" r="2" fill="#a77a52"/>`);
      }
      return piezas.join("");
    }
    case "silla":
      return caja(x, y, w, h, "#3d454c", 6) + caja(x + 3, y + 3, w - 6, h * 0.25, "#2b3237", 3, fina);
    case "cama": {
      const piezas = [caja(x, y, w, h, "#4f463c", 3)];
      piezas.push(caja(x + 5, y + 5, w - 10, h - 10, "#b9b6aa", 3, fina));
      const [ax, ay, aw, ah] = cabecera(px(0.37), 8);
      piezas.push(caja(ax, ay, aw, ah, "#d3d0c4", 6, fina));
      // Frazada a medio abrir
      piezas.push(horizontal
        ? caja(x + w * 0.42, y + 5, w * 0.58 - 5, h - 10, "#4b5763", 3, fina)
        : caja(x + 5, y + h * 0.42, w - 10, h * 0.58 - 5, "#4b5763", 3, fina));
      return piezas.join("");
    }
    case "sofa":
      return caja(x, y, w, h, "#4a4d4f", 6) + caja(x + 8, y + 10, w - 16, h - 14, "#5a5e60", 4, fina);
    case "heladera": {
      const piezas = [caja(x, y, w, h, "#cfd2cf", 3)];
      piezas.push(caja(x + 4, y + 4, w - 8, h - 8, "#dcdeda", 2, fina));
      piezas.push(`<line x1="${x + 4}" y1="${y + h * 0.4}" x2="${x + w - 4}" y2="${y + h * 0.4}" stroke="${p.tinta}" stroke-width="1.5"/>`);
      return piezas.join("");
    }
    case "mesa":
      return caja(x, y, w, h, "#6f604c", 3) + caja(x + 5, y + 5, w - 10, h - 10, "#7e6e58", 2, fina);
    case "estante": {
      const piezas = [caja(x, y, w, h, "#5c5550", 2)];
      const largo = horizontal ? w : h;
      let t = 4;
      while (t < largo - 6) {
        const l = Math.min(6 + r() * 14, largo - 4 - t);
        const c = ["#a59a86", "#5f6870", "#c0c4bd", "#6e5f4a", "#8e9a9b"][Math.floor(r() * 5)];
        piezas.push(horizontal
          ? caja(x + t, y + 4, l, h - 8, c, 1, `stroke="${p.tinta}" stroke-width="1"`)
          : caja(x + 4, y + t, w - 8, l, c, 1, `stroke="${p.tinta}" stroke-width="1"`));
        t += l + 2;
      }
      return piezas.join("");
    }
    case "mapas": {
      // Mapas impresos de la ciudad clavados a la pared, encimados, con
      // alfileres. Visto desde arriba es una franja contra el muro: hojas de
      // valor claro con trazos de calles (nunca letras) y puntos de color.
      const piezas = [];
      const largo = horizontal ? w : h, prof = horizontal ? h : w;
      let t = 0;
      while (t < largo - 2) {
        const l = Math.min(px(0.28) + r() * px(0.2), largo - t);
        const c = ["#d9d6cb", "#cfccc0", "#e2dfd4", "#c6c9c4"][Math.floor(r() * 4)];
        const [fx, fy, fw, fh] = horizontal ? [x + t, y, l, prof] : [x, y + t, prof, l];
        piezas.push(caja(fx, fy, fw, fh, c, 0, `stroke="${p.tinta}" stroke-width="0.9"`));
        // Calles: dos o tres trazos finos, como un plano visto de canto.
        for (let k = 0; k < 3; k++) {
          piezas.push(horizontal
            ? `<line x1="${(fx + 2 + r() * (fw - 4)).toFixed(1)}" y1="${fy + 1}" x2="${(fx + 2 + r() * (fw - 4)).toFixed(1)}" y2="${fy + fh - 1}" stroke="#8a8f94" stroke-width="0.8" opacity="0.8"/>`
            : `<line x1="${fx + 1}" y1="${(fy + 2 + r() * (fh - 4)).toFixed(1)}" x2="${fx + fw - 1}" y2="${(fy + 2 + r() * (fh - 4)).toFixed(1)}" stroke="#8a8f94" stroke-width="0.8" opacity="0.8"/>`);
        }
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const ax = horizontal ? fx + 3 + r() * (fw - 6) : fx + fw / 2;
          const ay = horizontal ? fy + fh / 2 : fy + 3 + r() * (fh - 6);
          piezas.push(`<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="2.3" fill="${ALFILERES[Math.floor(r() * ALFILERES.length)]}" stroke="${p.tinta}" stroke-width="0.6"/>`);
        }
        if (t + l >= largo - 2) break;
        t += l - 3;       // se enciman un poco
      }
      return piezas.join("");
    }
    case "corcho": {
      // Panel de corcho contra la pared: fotos y recortes, sin texto.
      const piezas = [caja(x, y, w, h, "#7a6a55", 1)];
      const n = Math.round((horizontal ? w : h) / 9);
      for (let i = 0; i < n; i++) {
        const fx = horizontal ? x + 3 + r() * (w - 12) : x + 2 + r() * (w - 8);
        const fy = horizontal ? y + 2 + r() * (h - 8) : y + 3 + r() * (h - 12);
        const c = ["#d8d4c8", "#bfb8a6", "#9aa3a8", "#e4e0d2"][Math.floor(r() * 4)];
        piezas.push(caja(fx, fy, horizontal ? 7 : Math.min(7, w - 4), horizontal ? Math.min(7, h - 4) : 7, c, 0, `stroke="${p.tinta}" stroke-width="0.8"`));
      }
      return piezas.join("");
    }
    case "radiador": {
      // Radiador de hierro fundido bajo la ventana: columnas apretadas.
      const piezas = [caja(x, y, w, h, "#4b4f52", 2)];
      const n = Math.max(4, Math.round((horizontal ? w : h) / 7));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        piezas.push(horizontal
          ? `<line x1="${(x + w * t).toFixed(1)}" y1="${y + 2}" x2="${(x + w * t).toFixed(1)}" y2="${y + h - 2}" stroke="${p.tinta}" stroke-width="1.4"/>`
          : `<line x1="${x + 2}" y1="${(y + h * t).toFixed(1)}" x2="${x + w - 2}" y2="${(y + h * t).toFixed(1)}" stroke="${p.tinta}" stroke-width="1.4"/>`);
      }
      return piezas.join("");
    }
    case "tv": {
      // Mueble bajo con la tele apagada encima (la dejaron: no valía nada para ellos).
      const piezas = [caja(x, y, w, h, "#4a3f35", 2)];
      const frente = m.frente ?? (horizontal ? "s" : "o");
      const t = 6;
      const [tx, ty, tw, th] = horizontal
        ? [x + w * 0.1, frente === "s" ? y + 3 : y + h - t - 3, w * 0.8, t]
        : [frente === "o" ? x + w - t - 3 : x + 3, y + h * 0.1, t, h * 0.8];
      piezas.push(caja(tx, ty, tw, th, "#111417", 1, fina));
      return piezas.join("");
    }
    case "timbre":
      // Cámara de timbre Gale Sentinel: cajita negra con la lente. Su lucecita
      // azul NO se pinta: es una luz de Foundry (preset «led-timbre»).
      return caja(x, y, Math.max(w, 10), Math.max(h, 10), "#16191c", 2, fina) +
        `<circle cx="${x + Math.max(w, 10) / 2}" cy="${y + Math.max(h, 10) / 2}" r="2.6" fill="#3b4752"/>`;
    case "contenedor":
      return caja(x, y, w, h, "#3c4a44", 2) + caja(x + 5, y + 5, w - 10, h - 10, "#45554e", 1, fina) +
        `<line x1="${x + w / 2}" y1="${y + 5}" x2="${x + w / 2}" y2="${y + h - 5}" stroke="${p.tinta}" stroke-width="1.6"/>`;
    case "escalera": {
      // Peldaños que se oscurecen hacia donde baja (`hacia`), sin perspectiva.
      const hacia = m.hacia ?? (horizontal ? "e" : "s");
      const largoEje = (hacia === "e" || hacia === "o") ? w : h;
      const pasos = Math.max(4, Math.round(largoEje / px(0.26)));
      const metal = m.material === "metal";
      const piezas = [caja(x, y, w, h, metal ? "#2c3135" : "#6f665a", 1)];
      for (let i = 0; i < pasos; i++) {
        const t = i / pasos;
        const fondo = (hacia === "s" || hacia === "e") ? (i + 1) / pasos : (pasos - i) / pasos;
        const fill = mezclar(metal ? "#4a5056" : "#857b6d", "#141414", fondo * 0.75);
        piezas.push((hacia === "e" || hacia === "o")
          ? caja(x + w * t, y, w / pasos, h, fill, 0, fina)
          : caja(x, y + h * t, w, h / pasos, fill, 0, fina));
      }
      return piezas.join("");
    }
    case "escalerilla": {
      // Escalera de mano (la de caída de la escalera de incendios): dos
      // largueros y travesaños, vista desde arriba como una rejilla angosta.
      const piezas = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${p.metal ?? p.tinta}" stroke-width="3"/>`];
      const n = Math.max(3, Math.round((horizontal ? w : h) / 9));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        piezas.push(horizontal
          ? `<line x1="${x + w * t}" y1="${y}" x2="${x + w * t}" y2="${y + h}" stroke="${p.metal ?? p.tinta}" stroke-width="2"/>`
          : `<line x1="${x}" y1="${y + h * t}" x2="${x + w}" y2="${y + h * t}" stroke="${p.metal ?? p.tinta}" stroke-width="2"/>`);
      }
      return piezas.join("");
    }
    case "trampilla":
      // Igual que una puerta: no se dibuja la hoja, sólo el marco en el piso.
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${p.tinta}" stroke-width="2" stroke-dasharray="8 6" opacity="0.6"/>`;
    case "inodoro": {
      // Tanque contra la pared de `m.contra` (n por defecto), taza hacia el otro lado.
      const contra = m.contra ?? "n";
      const vertical = contra === "n" || contra === "s";
      const tq = vertical ? h * 0.35 : w * 0.35;
      const [tx, ty, tw, th] = contra === "n" ? [x, y, w, tq] : contra === "s" ? [x, y + h - tq, w, tq]
        : contra === "o" ? [x, y, tq, h] : [x + w - tq, y, tq, h];
      const [cx, cy, rx, ry] = contra === "n" ? [x + w / 2, y + h * 0.65, w / 2 - 1, h * 0.33]
        : contra === "s" ? [x + w / 2, y + h * 0.35, w / 2 - 1, h * 0.33]
        : contra === "o" ? [x + w * 0.65, y + h / 2, w * 0.33, h / 2 - 1] : [x + w * 0.35, y + h / 2, w * 0.33, h / 2 - 1];
      return caja(tx, ty, tw, th, "#d0d4d1", 2) +
        `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#dde0dd" ${tinta}/>`;
    }
    case "lavabo":
      return caja(x, y, w, h, "#d0d4d1", 4) + `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 3}" ry="${h / 3}" fill="#b3bbbb" ${fina}/>`;
    case "ducha":
      return caja(x, y, w, h, "#bcc5c8", 2) + `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="4" fill="#59646a"/>` +
        `<line x1="${x + 6}" y1="${y + 6}" x2="${x + w - 6}" y2="${y + h - 6}" stroke="#93a0a3" stroke-width="1.2"/>`;
    case "banera": {
      // Bañera de patas vieja: cuerpo esmaltado y desagüe hacia `m.desague` (o por defecto).
      const piezas = [caja(x, y, w, h, "#c9cdca", Math.min(w, h) / 3)];
      piezas.push(caja(x + 7, y + 7, w - 14, h - 14, "#b4bdbf", Math.min(w, h) / 4, fina));
      const dx = horizontal ? x + 20 : x + w / 2, dy = horizontal ? y + h / 2 : y + 20;
      piezas.push(`<circle cx="${dx}" cy="${dy}" r="3.4" fill="#59646a"/>`);
      return piezas.join("");
    }
    case "mesada": {       // mesada de cocina: bacha y anafe
      const piezas = [caja(x, y, w, h, "#a9aaa3", 2)];
      const L = horizontal ? w : h, A = horizontal ? h : w;
      const bacha = horizontal ? [x + L * 0.12, y + 5, L * 0.22, A - 10] : [x + 5, y + h * 0.12, A - 10, L * 0.22];
      if (m.bacha !== false) piezas.push(caja(...bacha, "#858e91", 3, fina));
      for (let i = 0; i < (m.anafe === false ? 0 : 4); i++) {
        const a = 0.62 + (i % 2) * 0.17, b = 0.3 + Math.floor(i / 2) * 0.4;
        piezas.push(horizontal
          ? `<circle cx="${x + L * a}" cy="${y + A * b}" r="${Math.min(A * 0.17, 9)}" fill="#2f3234" ${fina}/>`
          : `<circle cx="${x + A * b}" cy="${y + L * a}" r="${Math.min(A * 0.17, 9)}" fill="#2f3234" ${fina}/>`);
      }
      return piezas.join("");
    }
    case "maquina": {      // caldera / tablero eléctrico
      const piezas = [caja(x, y, w, h, "#5d6264", 3)];
      piezas.push(`<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) / 3}" fill="#4f5456" ${fina}/>`);
      return piezas.join("");
    }
    default:
      return caja(x, y, w, h, "#6f6b64", 3);
  }
}

/** Sombra proyectada abajo-derecha. Se dibujan todas antes que los objetos. */
function sombraMueble(m, p) {
  if (["trampilla", "escalera", "escalerilla", "mapas", "timbre"].includes(m.tipo)) return "";
  const x = px(m.x), y = px(m.y), w = px(m.w), h = px(m.h);
  const alto = ["estante", "heladera", "maquina", "contenedor"].includes(m.tipo) ? 9 : 5;
  return `<rect x="${x + alto}" y="${y + alto + 1}" width="${w}" height="${h}" rx="4" fill="${p.muroSombra}" opacity="0.42"/>`;
}

/* -------------------------------------------- */
/*  Render                                      */
/* -------------------------------------------- */

/** Grosor de muro: 27 cm (tabique revocado de un edificio de 1910). */
const GROSOR_M = 0.27;

export function renderSvg(planoCrudo) {
  const plano = normalizar(planoCrudo);
  const p = PALETAS[plano.paleta] ?? PALETAS.apartamento;
  const r = azar(plano.id);
  const W = px(plano.ancho), H = px(plano.alto);
  const o = [];

  o.push(`<defs>
    <filter id="grano" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="7"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
    ${defRayado(p)}
  </defs>`);

  o.push(...exterior(plano, p, r, W, H));

  for (const h of plano.habitaciones) o.push(...piso(h, p, r));
  o.push(...suciedad(plano, p, r));

  // Sombra interior contra los muros: oclusión ambiental, no luz.
  for (const h of plano.habitaciones) {
    if (h.sinMuros || h.piso === "macizo" || h.piso === "rejilla") continue;
    o.push(`<rect x="${px(h.x)}" y="${px(h.y)}" width="${px(h.w)}" height="${px(h.h)}" ` +
      `fill="none" stroke="${p.muroSombra}" stroke-width="18" opacity="0.2"/>`);
  }

  o.push(...detritos(plano, p, r));

  const fijos = (plano.muebles ?? []).filter(m => !esMovil(m));
  for (const m of fijos) o.push(sombraMueble(m, p));
  for (const m of fijos) o.push(mueble(m, p, r));

  // Muros: los mismos tramos que se le entregan a Foundry, así que lo que se ve
  // y lo que bloquea el paso son literalmente la misma geometría. Se dibujan
  // macizos los muros y las puertas secretas; las puertas normales y las de
  // vidrio dejan el vano, y los vidrios, ventanas y barandas se dibujan aparte.
  const g = Math.round(GROSOR_M * PX_POR_M);
  const todos = derivarMuros(plano);
  const muros = todos.filter(m => m._tipo === "muro" || m._tipo === "secreta");

  for (const m of muros) {
    const [x1, y1, x2, y2] = m.c;
    o.push(`<line x1="${x1 + 6}" y1="${y1 + 7}" x2="${x2 + 6}" y2="${y2 + 7}" stroke="${p.muroSombra}" stroke-width="${g}" stroke-linecap="square" opacity="0.5"/>`);
  }

  for (const m of muros) {
    const [x1, y1, x2, y2] = m.c;
    const horizontal = y1 === y2;
    const largo = horizontal ? x2 - x1 : y2 - y1;
    // Tabique revocado: una banda continua con canto de tinta, como corte de
    // arquitectura. Los extremos se extienden medio espesor para que las
    // esquinas cierren.
    const bx = x1 - g / 2, by = y1 - g / 2;
    const bw = horizontal ? largo + g : g;
    const bh = horizontal ? g : largo + g;
    o.push(`<path d="${bordeTembloroso(bx, by, bw, bh, r, 1.2)}" fill="${variar(p.muro, (r() - 0.5) * 0.08)}" ` +
      `stroke="${p.tinta}" stroke-width="2.6" stroke-linejoin="round"/>`);
    o.push(horizontal
      ? `<line x1="${bx + 3}" y1="${by + 5}" x2="${bx + bw - 3}" y2="${by + 5}" stroke="${variar(p.muro, 0.18)}" stroke-width="2" opacity="0.6"/>`
      : `<line x1="${bx + 5}" y1="${by + 3}" x2="${bx + 5}" y2="${by + bh - 3}" stroke="${variar(p.muro, 0.18)}" stroke-width="2" opacity="0.6"/>`);
  }

  // Vidrios y ventanas: perfil fino con montantes cada metro. Es estructura
  // (no una hoja de puerta): una guillotina se ve igual abierta o cerrada.
  for (const m of todos.filter(m => m._tipo === "vidrio" || m._tipo === "ventana")) {
    const [x1, y1, x2, y2] = m.c;
    const horizontal = y1 === y2;
    const gv = Math.round(g * 0.42);
    const bx = horizontal ? x1 : x1 - gv / 2, by = horizontal ? y1 - gv / 2 : y1;
    const bw = horizontal ? x2 - x1 : gv, bh = horizontal ? gv : y2 - y1;
    // Alféizar: el muro sigue debajo de la ventana, más bajo.
    o.push(`<rect x="${horizontal ? bx : x1 - g / 2}" y="${horizontal ? y1 - g / 2 : by}" width="${horizontal ? bw : g}" height="${horizontal ? g : bh}" fill="${variar(p.muro, 0.12)}" stroke="${p.tinta}" stroke-width="1.6" opacity="0.9"/>`);
    o.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${p.vidrio}" opacity="0.85" stroke="${p.marco}" stroke-width="2"/>`);
    o.push(horizontal
      ? `<line x1="${bx}" y1="${y1}" x2="${bx + bw}" y2="${y1}" stroke="${mezclar(p.vidrio, "#ffffff", 0.4)}" stroke-width="1.4"/>`
      : `<line x1="${x1}" y1="${by}" x2="${x1}" y2="${by + bh}" stroke="${mezclar(p.vidrio, "#ffffff", 0.4)}" stroke-width="1.4"/>`);
    const largo = horizontal ? bw : bh;
    const tramos = Math.max(1, Math.round(largo / GRID_PX));
    for (let i = 0; i <= tramos; i++) {
      const t = largo * i / tramos;
      const mx = horizontal ? bx + t : x1, my = horizontal ? y1 : by + t;
      o.push(`<rect x="${mx - 5}" y="${my - 5}" width="10" height="10" fill="${p.marco}" stroke="${p.tinta}" stroke-width="1.4"/>`);
    }
  }

  // Barandas: pasamanos de hierro con parantes cada medio metro. Bloquean el
  // paso, no la vista: en el mapa se ven finas, para que no se lean como muro.
  for (const m of todos.filter(m => m._tipo === "baranda")) {
    const [x1, y1, x2, y2] = m.c;
    const horizontal = y1 === y2;
    const largo = horizontal ? x2 - x1 : y2 - y1;
    o.push(`<line x1="${x1 + 3}" y1="${y1 + 4}" x2="${x2 + 3}" y2="${y2 + 4}" stroke="${p.muroSombra}" stroke-width="5" opacity="0.4"/>`);
    o.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${p.tinta}" stroke-width="6" stroke-linecap="round"/>`);
    o.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${p.metal ?? "#2a2f34"}" stroke-width="3" stroke-linecap="round"/>`);
    const n = Math.max(1, Math.round(largo / (GRID_PX / 2)));
    for (let i = 0; i <= n; i++) {
      const t = largo * i / n;
      const cx = horizontal ? x1 + t : x1, cy = horizontal ? y1 : y1 + t;
      o.push(`<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" fill="${p.metal ?? "#2a2f34"}" stroke="${p.tinta}" stroke-width="1.4"/>`);
    }
  }

  // Umbral: marca discreta en el piso. La hoja de la puerta la dibuja Foundry.
  for (const v of plano.vanos ?? []) {
    if (v.tipo !== "puerta" && v.tipo !== "puerta-vidrio") continue;
    const [x1, y1, x2, y2] = coordsVano(v);
    o.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${p.umbral}" stroke-width="${Math.round(g * 0.5)}" opacity="0.5"/>`);
    o.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${p.tinta}" stroke-width="2" opacity="0.5" stroke-dasharray="7 9"/>`);
  }

  // Tono ambiente uniforme (el frío azul de la noche de noviembre): lavado
  // parejo, sin gradiente ni foco. Las fuentes de luz las pone Foundry.
  if (p.tono && p.tonoK) o.push(`<rect width="${W}" height="${H}" fill="${p.tono}" opacity="${p.tonoK}"/>`);

  // Grano, para que no se lea como vector limpio. Sin viñeta: a sangre.
  o.push(`<rect width="${W}" height="${H}" filter="url(#grano)" opacity="0.05"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${o.join("")}</svg>`;
}

/* -------------------------------------------- */
/*  Regiones de transición                      */
/* -------------------------------------------- */

/**
 * Las regiones de escalera/pasaje. El comportamiento `teleportToken` es nativo
 * de v14: parado sobre la región, el token aparece en la región gemela de la
 * otra escena (o de la misma: la escalera de incendios baja al callejón del
 * mismo mapa). Es la transición limpia entre plantas o edificios, en vez de
 * dibujar dos lugares en la misma imagen.
 *
 * Una región con `llegada: true` sólo recibe (no lleva a ningún lado: así el
 * token que llega no rebota). Una con `destino: null` es un acceso cuyo mapa
 * todavía no existe (`pendiente` dice cuál): sale sin comportamiento, como un
 * marcador, hasta que se haga ese mapa.
 */
export function derivarRegiones(plano, idEstable, uuidDeRegion) {
  return (plano.regiones ?? []).map(rg => {
    const rid = idEstable(`region:${plano.id}:${rg.id}`);
    const activa = rg.destino && !rg.llegada;
    const behaviors = [];
    if (activa) {
      const [planoDestino, regionDestino] = rg.destino.split(":");
      behaviors.push({
        _id: idEstable(`comportamiento:${plano.id}:${rg.id}`),
        name: rg.nombre,
        type: "teleportToken",
        system: {
          destinations: [uuidDeRegion(planoDestino, regionDestino)],
          placement: "center",
          snap: true,
          choice: false
        },
        disabled: false,
        flags: {}
      });
    }
    return {
      _id: rid,
      name: rg.nombre,
      color: rg.color ?? (rg.llegada ? "#2f7f8c" : activa ? "#b23030" : "#7a7a7a"),
      shapes: [{
        type: "rectangle",
        x: px(rg.x), y: px(rg.y),
        width: px(rg.w), height: px(rg.h),
        rotation: 0, hole: false
      }],
      elevation: { bottom: null, top: null },
      behaviors,
      visibility: 2,
      locked: false,
      flags: {}
    };
  });
}

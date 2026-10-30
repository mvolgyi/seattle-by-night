/**
 * content/{cronica,ciudad,personajes,documentos} → packs-src/{cronica,documentos}
 *
 * Un JournalEntry por archivo .md; una página por `## ` (paginar() de ids.mjs).
 * Además genera dos journals que no tienen archivo propio:
 *
 *   PISTAS    «Pistas»: una página por pista de content/pistas.json (ancla = id)
 *   TRACKERS  «El Termómetro y el Reloj»: umbrales, movimientos y el Reloj noche
 *             por noche, desde content/trackers.json
 *
 * Los marcadores de CONTENIDO.md §1 se expanden ANTES de pasar a HTML: los `|`
 * de `@tirada{a|3|b}` viven dentro de tablas Markdown y romperían las celdas.
 * Cada marcador se cambia por una ficha alfanumérica (SBNMARCA12X) que Marked
 * deja intacta en cualquier contexto (tabla, lista, énfasis); al final la ficha
 * se reemplaza por su HTML. Los bloques `:::` hacen lo mismo con un párrafo
 * propio, así su HTML no queda dentro de un <p>.
 *
 * HTML que genera: ver tools/contenido/CONTRATO.md.
 */
import fs from "node:fs";
import path from "node:path";
import { Marked } from "marked";
import { RAIZ, MODULO, STATS, idEstable, slug, escribirDoc, Carpetas, leerJson } from "../util.mjs";
import { ID, journals, clavePagina } from "./ids.mjs";

const marked = new Marked({ gfm: true });
const md2html = texto => marked.parse(texto, { async: false });
const md2inline = texto => marked.parseInline(texto, { async: false });

const existe = rel => fs.existsSync(path.join(RAIZ, rel));
const PISTAS = existe("content/pistas.json") ? leerJson("content/pistas.json").pistas ?? [] : [];
const TRACKERS = existe("content/trackers.json") ? leerJson("content/trackers.json") : null;
const NOCHES = new Map((TRACKERS?.reloj?.noches ?? []).map(n => [Number(n.n), n]));
const PISTA = new Map(PISTAS.map(p => [p.id, p]));

const OBSERVADOR = 2;
const NINGUNO = 0;

/* -------------------------------------------- */
/*  Utilidades de texto                         */
/* -------------------------------------------- */

const escapar = s => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texto plano para un atributo o una etiqueta de @UUID: sin marcas de Markdown. */
const plano = s => String(s ?? "").replace(/[*`]/g, "").replace(/(^|\s)_([^_]+)_(?=\s|$|[.,;:])/g, "$1$2").trim();

/** «[sesion-cero, A1-E03]» → ["sesion-cero", "A1-E03"]; un valor suelto → [valor]. */
function lista(valor) {
  if (valor == null || valor === "") return [];
  if (Array.isArray(valor)) return valor;
  const m = /^\[(.*)\]$/.exec(String(valor).trim());
  return (m ? m[1].split(",") : [valor]).map(s => String(s).trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/** Claves válidas de wod5e para @tirada (CONTENIDO.md §2). */
const CLAVES_TIRADA = {
  attributes: "strength dexterity stamina charisma manipulation composure intelligence wits resolve",
  skills: "athletics brawl craft drive firearms larceny melee stealth survival animalken etiquette insight intimidation leadership performance persuasion streetwise subterfuge academics awareness finance investigation medicine occult politics science technology",
  disciplines: "animalism auspex celerity dominate fortitude obfuscate potence presence protean sorcery oblivion alchemy rituals ceremonies"
};
const PATH_VALIDO = new Set(Object.entries(CLAVES_TIRADA).flatMap(([g, ks]) => ks.split(" ").map(k => `${g}.${k}`)));

/** «2026-11-15» → «15/11/2026». */
const fechaCorta = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? "");
};
const tituloNoche = n => {
  const noche = NOCHES.get(Number(n));
  if (!noche) return null;
  return `Noche ${n} · ${noche.dia ?? ""} (madrugada del ${fechaCorta(noche.fecha)})`.replace(/\s+/g, " ");
};

/** Etiqueta de un movimiento del Termómetro: +1, −2, = 10, Congelar. */
function etiquetaCambio(cambio) {
  const c = String(cambio).trim();
  if (/^congelar$/i.test(c)) return "Congelar";
  if (/^=/.test(c)) return `= ${c.slice(1).trim()}`;
  const n = Number(c);
  if (Number.isFinite(n)) return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0";
  return c;
}
/** Valor normalizado para data-sbn-termometro: "+1", "-2", "=10", "congelar". */
function valorCambio(cambio) {
  const c = String(cambio).trim().replace("−", "-");
  if (/^congelar$/i.test(c)) return "congelar";
  if (/^=\s*\d+$/.test(c)) return `=${c.replace(/[=\s]/g, "")}`;
  const n = Number(c);
  if (Number.isFinite(n)) return n > 0 ? `+${n}` : `${n}`;
  return null;
}

/* -------------------------------------------- */
/*  HTML de los marcadores (CONTRATO.md)        */
/* -------------------------------------------- */

function htmlTirada(paths, dif, texto) {
  const t = texto.trim();
  return `<a class="sbn-tirada" data-sbn-tirada="${escapar(paths.join(" "))}" data-dificultad="${dif}" data-label="${escapar(plano(t))}"><i class="fa-solid fa-dice-d10"></i> ${md2inline(t)}</a>`;
}

/** `corto`: sólo el cambio a la vista (en tablas, donde el motivo ya está en otra columna). */
function htmlTermometro(cambio, motivo, { corto = false } = {}) {
  const m = (motivo ?? "").trim();
  return `<button type="button" class="sbn-termometro" data-sbn-termometro="${cambio}" data-motivo="${escapar(plano(m))}">`
    + `<span class="sbn-termometro-cambio">${escapar(etiquetaCambio(cambio))}</span>`
    + (m && !corto ? ` <span class="sbn-termometro-motivo">${md2inline(m)}</span>` : "")
    + `</button>`;
}

function htmlPista(id, etiqueta) {
  const p = PISTA.get(id);
  const nombre = etiqueta?.trim() || p?.nombre || id;
  return `<button type="button" class="sbn-pista" data-sbn-pista="${escapar(id)}">`
    + `<span class="sbn-pista-id">${escapar(id)}</span> `
    + `<span class="sbn-pista-nombre">${md2inline(nombre)}</span></button>`;
}

function htmlReloj(n, etiqueta) {
  const t = tituloNoche(n);
  return `<span class="sbn-reloj" data-sbn-reloj="${n}"${t ? ` title="${escapar(t)}"` : ""}>${escapar(etiqueta?.trim() || `Noche ${n}`)}</span>`;
}

/* -------------------------------------------- */
/*  Render: Markdown con marcadores → HTML      */
/* -------------------------------------------- */

/**
 * Un renderizador por journal: sabe de qué archivo viene (para los avisos) y
 * numera los secretos de cada página de forma estable.
 */
function crearRender(ctx, rel, jid) {
  const fichas = [];
  const ficha = html => `SBNMARCA${fichas.push(html) - 1}X`;
  const avisados = new Set();
  const avisar = msg => { if (!avisados.has(msg)) { avisados.add(msg); ctx.avisos.push(`${rel}: ${msg}`); } };
  let clave = "intro";
  let nSecreto = 0;

  /** @ID[X] / @ID[X|texto] → @UUID[...]{...}; si no existe, texto plano. */
  function enlaceId(id, texto) {
    const e = ctx.reg.get(id);
    if (!e) {
      avisar(`@ID[${id}] no está en el registro`);
      return texto?.trim() || id;
    }
    return ficha(`@UUID[${e.uuid}]{${escapar(plano(texto?.trim() || e.nombre || id))}}`);
  }

  function inlineMarcadores(md) {
    md = md.replace(/@tirada\{([^}]*)\}/g, (todo, cuerpo) => {
      const partes = cuerpo.split("|");
      const paths = partes[0].split("+").map(s => s.trim()).filter(Boolean);
      let dif = 0;
      let texto;
      if (partes.length >= 3) { dif = Number(partes[1]) || 0; texto = partes.slice(2).join("|"); }
      else if (partes.length === 2 && /^\s*\d+\s*$/.test(partes[1])) dif = Number(partes[1]);
      else if (partes.length === 2) texto = partes[1];
      if (!paths.length) { avisar(`tirada sin reserva: ${todo}`); return texto ?? ""; }
      for (const p of paths) if (!PATH_VALIDO.has(p)) avisar(`@tirada con un path que wod5e no conoce: ${p}`);
      return ficha(htmlTirada(paths, dif, texto ?? paths.join(" + ")));
    });
    md = md.replace(/@termometro\{([^}]*)\}/g, (todo, cuerpo) => {
      const i = cuerpo.indexOf("|");
      const cambio = valorCambio(i < 0 ? cuerpo : cuerpo.slice(0, i));
      if (!cambio) { avisar(`@termometro con un cambio que no entiendo: ${todo}`); return i < 0 ? "" : cuerpo.slice(i + 1); }
      return ficha(htmlTermometro(cambio, i < 0 ? "" : cuerpo.slice(i + 1)));
    });
    md = md.replace(/@pista\{([^}|]+)(?:\|([^}]*))?\}/g, (_, id, etiqueta) => {
      id = id.trim();
      if (!PISTA.has(id)) avisar(`@pista{${id}} no está en content/pistas.json`);
      return ficha(htmlPista(id, etiqueta));
    });
    md = md.replace(/@reloj\{\s*(\d+)\s*(?:\|([^}]*))?\}/g, (_, n, etiqueta) => {
      if (!NOCHES.has(Number(n))) avisar(`@reloj{${n}}: la noche no está en content/trackers.json`);
      return ficha(htmlReloj(Number(n), etiqueta));
    });
    md = md.replace(/@ID\[([^\]|]+)(?:\|([^\]]*))?\]/g, (_, id, texto) => enlaceId(id.trim(), texto));
    for (const resto of md.match(/@(?:tirada|termometro|pista|reloj)\{|@ID\[/g) ?? []) avisar(`marcador mal formado: ${resto}`);
    return md;
  }

  function bloques(md) {
    return md.replace(/^:::(leer|recuadro|secreto)[ \t]*(.*)$\n([\s\S]*?)^:::[ \t]*$/gm, (_, tipo, titulo, interior) => {
      const html = bloque(interior.trim());
      let out;
      if (tipo === "leer") out = `<section class="sbn-leer">${html}</section>`;
      else if (tipo === "secreto") {
        const sid = idEstable(`secreto:${jid}:${clave}:${nSecreto++}`);
        out = `<section class="secret" id="secret-${sid}">${html}</section>`;
      } else {
        const t = titulo.trim();
        const clase = /^nota de edici[oó]n/i.test(t) ? "sbn-recuadro sbn-nota-edicion" : "sbn-recuadro";
        out = `<aside class="${clase}">${t ? `<h4>${md2inline(inlineMarcadores(t))}</h4>` : ""}${html}</aside>`;
      }
      return `\n\n${ficha(out)}\n\n`;
    });
  }

  const resolver = html => {
    let antes;
    do {
      antes = html;
      html = html
        .replace(/<p>\s*SBNMARCA(\d+)X\s*<\/p>/g, (_, i) => fichas[i])
        .replace(/SBNMARCA(\d+)X/g, (_, i) => fichas[i]);
    } while (html !== antes);
    return html;
  };

  /** Markdown de bloque → HTML (sin resolver fichas: lo hace `pagina`). */
  function bloque(md) {
    return md2html(inlineMarcadores(bloques(md)));
  }

  return {
    /** Empieza una página nueva: los secretos se numeran por página. */
    pagina(c) { clave = c; nSecreto = 0; },
    html: md => tablas(resolver(bloque(md))),
    inline: md => resolver(md2inline(inlineMarcadores(md))),
    /** Para texto generado: vuelve marcadores los IDs del libro que aparecen sueltos. */
    enlazar: texto => enlazarIds(ctx, texto),
    avisar
  };
}

/**
 * Tablas de dos columnas «clave | texto» (Opciones de la coterie: Escapar,
 * Manipular…): el Markdown del docx no tiene encabezado, así que Marked usa
 * la primera fila de datos como <thead>. Se la devuelve al cuerpo.
 */
function tablas(html) {
  return html.replace(/<table>\s*<thead>\s*(<tr>[\s\S]*?<\/tr>)\s*<\/thead>\s*(?:<tbody>([\s\S]*?)<\/tbody>)?\s*<\/table>/g, (todo, fila, cuerpo = "") => {
    const celdas = [...fila.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1].trim());
    const textoLargo = celdas.slice(1).some(c => c.replace(/<[^>]+>/g, "").length > 60);
    if (!/^<strong>[^<]+<\/strong>$/.test(celdas[0] ?? "") || !textoLargo) return todo;
    const td = fila.replace(/<th([^>]*)>/g, "<td$1>").replace(/<\/th>/g, "</td>");
    return `<table class="sbn-tabla sbn-tabla-claves"><tbody>${td}${cuerpo}</tbody></table>`;
  }).replace(/<table>/g, '<table class="sbn-tabla">');
}

/** Une los IDs del registro en una regex (los más largos primero: AVE-01-P1 antes que AVE-01). */
let REGEX_IDS = null;
function enlazarIds(ctx, texto) {
  if (!REGEX_IDS) {
    const claves = [...ctx.reg.keys()].filter(k => /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/.test(k)).sort((a, b) => b.length - a.length);
    REGEX_IDS = new RegExp(`(?<![\\w\\-\\[|])(${claves.map(k => k.replace(/[-]/g, "\\-")).join("|")})(?![\\w\\-\\]])`, "g");
  }
  // La etiqueta es el ID mismo: dentro de una frase, «(A2-E02)» no debe volverse el título entero de la escena.
  return String(texto ?? "").replace(REGEX_IDS, id => `@ID[${id}|${id}]`);
}

/* -------------------------------------------- */
/*  Documentos: convenciones por soporte        */
/* -------------------------------------------- */

/** Clase de una anotación manuscrita según lo que dice su acotación. */
function varianteManuscrito(texto) {
  if (/adhesiva|post-?it/i.test(texto)) return "postit";
  if (/cinta/i.test(texto)) return "cinta";
  if (/l[aá]piz/i.test(texto)) return "lapiz";
  if (/bol[ií]grafo|boli\b/i.test(texto)) return "boligrafo";
  return "tinta";
}

const ACOTACION = /^\[[^\]]*\]$/;

/** Reglas comunes a todos los soportes (HTML de Marked → HTML con clases). */
function maquetarComun(html, soporte) {
  // Anotaciones a mano: blockquote → aside manuscrito. La primera acotación dice de qué es.
  html = html.replace(/<blockquote>\s*([\s\S]*?)\s*<\/blockquote>/g, (_, interior) => {
    const pista = (/<em>([^<]*)<\/em>/.exec(interior) ?? [, ""])[1];
    let dentro = interior
      // Acotación al principio de un párrafo: «*[Al pie, con otra tinta:]*» o «*En una esquina, a lápiz:*».
      .replace(/<p><em>(\[[^<\]]*\]|[^<]*:\]?)<\/em>\s*/g, '<p><span class="sbn-acotacion">$1</span> ')
      .replace(/<em>(\[[^<\]]*\])<\/em>/g, '<span class="sbn-acotacion">$1</span>')
      .replace(/<p><span class="sbn-acotacion">([^<]*)<\/span>\s*<\/p>/g, '<p class="sbn-acotacion">$1</p>');
    return `<aside class="sbn-manuscrito sbn-manuscrito-${varianteManuscrito(pista)}">${dentro}</aside>`;
  });

  // Sello de goma: «*[sello de goma, tinta violeta:] COPIA 2 DE 3*».
  html = html.replace(/<p><em>\[(sello[^\]]*)\]\s*([^<]+)<\/em><\/p>/gi,
    '<p class="sbn-sello"><span class="sbn-acotacion">[$1]</span> <span class="sbn-sello-texto">$2</span></p>');
  // Membrete: «*[Membrete: …]*».
  html = html.replace(/<p><em>\[Membrete:\s*([^\]]*)\]<\/em><\/p>/gi,
    '<p class="sbn-membrete"><span class="sbn-acotacion">[Membrete]</span> $1</p>');
  // Párrafo que es sólo una acotación: [lluvia.], *[SINTONÍA…]*, **[ PANTALLA ]**.
  html = html.replace(/<p>(?:<(em|strong)>)?(\[[^<\]]*\])(?:<\/\1>)?<\/p>/g, (_, _tag, t) => {
    const extra = /^\[nota de/i.test(t) ? " sbn-nota-margen" : "";
    return `<p class="sbn-acotacion${extra}">${t}</p>`;
  });
  // Acotación dentro de un párrafo.
  html = html.replace(/<em>(\[[^<\]]*\])<\/em>/g, '<span class="sbn-acotacion">$1</span>');
  // Firma: «— M. V.», «*— W.*».
  html = html.replace(/<p>(<em>)?(—\s[^<]{1,40})(<\/em>)?<\/p>/g, '<p class="sbn-firma">$2</p>');
  // Encabezado del documento: un párrafo todo en negrita y en mayúsculas.
  html = html.replace(/<p><strong>([^<]+)<\/strong><\/p>/g, (todo, t) =>
    /\p{Ll}/u.test(t.replace(/\b(min|s|h|a\. m\.|p\. m\.)\b/g, "")) ? todo : `<p class="sbn-doc-titulo">${t}</p>`);
  // Tablas: una clase por soporte para que el CSS las vista (formulario, escala, ramas).
  html = html.replace(/<table class="([^"]*)">/g, `<table class="$1 sbn-doc-tabla sbn-${soporte}-tabla">`);
  return html;
}

const SOPORTES = {
  sms(html) {
    const re = /<p><strong>\[([^\]]+)\]\s*([^<:]+):<\/strong>\s*([\s\S]*?)<\/p>/g;
    const primero = html.search(/<p><strong>\[[^\]]+\][^<]*:<\/strong>/);
    if (primero < 0) return `<div class="sbn-pantalla">${html}</div>`;
    const cabecera = html.slice(0, primero)
      .replace(/<p>([^<]+)<\/p>/, '<p class="sbn-sms-contacto">$1</p>')
      .replace(/<p><em>(\([^<]*\))<\/em><\/p>/, '<p class="sbn-sms-contador">$1</p>');
    let mensajes = html.slice(primero).replace(re, (_, cuando, quien, texto) => {
      const [fecha, hora] = cuando.split("·").map(s => s.trim());
      return `<div class="sbn-sms-mensaje sbn-sms-recibido">`
        + `<p class="sbn-sms-texto">${texto.trim()}</p>`
        + `<p class="sbn-sms-meta"><span class="sbn-sms-remitente">${quien.trim()}</span> · `
        + `<time class="sbn-sms-fecha">${fecha ?? ""}</time>${hora ? ` <time class="sbn-sms-hora">${hora}</time>` : ""}</p></div>`;
    });
    return `<div class="sbn-pantalla"><header class="sbn-sms-cabecera">${cabecera}</header>`
      + `<div class="sbn-sms-hilo">${mensajes}</div></div>`;
  },

  tarjeta(html) {
    // La pantalla del móvil de tapa; lo escrito a mano (la cinta de la tapa) queda fuera.
    const notas = [];
    html = html.replace(/<aside class="sbn-manuscrito[\s\S]*?<\/aside>/g, m => { notas.push(m); return ""; });
    html = html.replace(/<p class="sbn-acotacion">(\[Bater[ií]a[^<]*)<\/p>/i, '<p class="sbn-pantalla-estado">$1</p>');
    html = html.replace(/<p>(─+)<\/p>/g, '<hr class="sbn-pantalla-raya">');
    return `<div class="sbn-pantalla">${html}</div>${notas.join("")}`;
  },

  correo(html) {
    const campos = [];
    const re = /^\s*<p><strong>([^<]+?):<\/strong>\s*([\s\S]*?)<\/p>\s*/;
    let m;
    while ((m = re.exec(html))) {
      campos.push([m[1].trim(), m[2].trim()]);
      html = html.slice(m[0].length);
    }
    if (!campos.length) return html;
    const dl = campos.map(([k, v]) => {
      const clase = /clasificaci/i.test(k) ? ' class="sbn-correo-clasificacion"' : "";
      return `<dt>${k}</dt><dd${clase}>${v}</dd>`;
    }).join("");
    return `<dl class="sbn-correo-cabecera">${dl}</dl><div class="sbn-correo-cuerpo">${html}</div>`;
  },

  guion(html) {
    return html
      .replace(/<p><strong>([^<]+?):<\/strong>\s*([\s\S]*?)<\/p>/g,
        '<p class="sbn-guion-linea"><span class="sbn-guion-personaje">$1</span> <span class="sbn-guion-texto">$2</span></p>')
      .replace(/<p class="sbn-acotacion">(\[(?!nota de)[^<]*)<\/p>/gi, '<p class="sbn-acotacion sbn-guion-direccion">$1</p>');
  },

  "libro-registro"(html) {
    return html.replace(/<p><strong>([^<]+)<\/strong>\s*([\s\S]*?)<\/p>/g, (todo, fecha, texto) =>
      /^noche/i.test(fecha)
        ? `<p class="sbn-registro-entrada"><span class="sbn-registro-fecha">${fecha}</span> ${texto}</p>`
        : todo);
  },

  carta(html) {
    // La firma de una carta: un nombre en negrita, solo.
    return html.replace(/<p><strong>([^<]+)<\/strong><\/p>/g, '<p class="sbn-firma">$1</p>');
  },

  informe(html) {
    return html.replace(/<p>Firma:\s*<em>([^<]+)<\/em><\/p>/g,
      '<p class="sbn-informe-firma">Firma: <span class="sbn-firma-manuscrita">$1</span></p>');
  },

  foto(html, { imagen }) {
    html = html.replace(/<p><strong>\[FOTO\]<\/strong>\s*([\s\S]*?)<\/p>/, (_, desc) =>
      `<div class="sbn-foto-imagen">${imagen ?? ""}<p class="sbn-foto-descripcion"><span class="sbn-acotacion">[foto]</span> ${desc}</p></div>`);
    return html.replace(/<p><strong>Pie de foto:<\/strong>\s*([\s\S]*?)<\/p>/, '<p class="sbn-foto-pie">$1</p>');
  },

  diagrama(html) {
    return html.replace(/<p>([│|┃]+)<\/p>/g, '<p class="sbn-diagrama-conector">$1</p>');
  }
};

/** Foro y presentación se parten en Markdown, antes de convertir. */
const SOPORTES_MD = {
  foro(md, render) {
    const [post, ...resto] = md.split(/^— — —\s*$/m);
    const comentarios = resto.join("\n").split(/^### /m).map(s => s.trim()).filter(Boolean);
    let htmlPost = render.html(post.trim())
      .replace(/^\s*<p>([\s\S]*?Publicado por[\s\S]*?)<\/p>/, '<header class="sbn-foro-meta">$1</header>')
      .replace(/(<\/header>)\s*<p><strong>([^<]+)<\/strong><\/p>/, '$1<h3 class="sbn-foro-titulo">$2</h3>')
      .replace(/<p><em>\[imagen:\s*([^\]]*)\]<\/em><\/p>/g,
        '<div class="sbn-foro-imagen"><i class="fa-regular fa-image"></i> <span>$1</span></div>');
    const op = (/Publicado por \*\*([^*]+)\*\*/.exec(post) ?? [])[1];
    const htmlComentarios = comentarios.map(c => {
      const [linea, ...cuerpo] = c.split("\n");
      const m = /^(.+?)\s*·\s*(-?\d+)\s*puntos?\s*$/.exec(linea.trim());
      const usuario = m ? m[1] : linea.trim();
      const eliminado = /eliminado/i.test(usuario) ? " sbn-foro-eliminado" : usuario === op ? " sbn-foro-op" : "";
      return `<div class="sbn-foro-comentario${eliminado}"><header class="sbn-foro-autor">`
        + `<span class="sbn-foro-usuario">${escapar(usuario)}</span>`
        + (m ? ` <span class="sbn-foro-puntos">${m[2]} puntos</span>` : "")
        + `</header><div class="sbn-foro-texto">${render.html(cuerpo.join("\n").trim())}</div></div>`;
    }).join("");
    return `<article class="sbn-foro-post">${htmlPost}</article>`
      + (htmlComentarios ? `<section class="sbn-foro-comentarios">${htmlComentarios}</section>` : "");
  },

  presentacion(md, render) {
    const [portada, ...diapos] = md.split(/^### /m);
    const out = [];
    if (portada.trim()) out.push(`<header class="sbn-diapositiva sbn-diapositiva-portada">${render.html(portada.trim())}</header>`);
    for (const d of diapos) {
      const [titulo, ...cuerpo] = d.split("\n");
      let html = render.html(cuerpo.join("\n").trim());
      html = html.replace(/<p><em>Pie de página:\s*([\s\S]*?)<\/em><\/p>/, '<footer class="sbn-diapositiva-pie">$1</footer>');
      out.push(`<section class="sbn-diapositiva"><h3>${render.inline(titulo.trim())}</h3>${html}</section>`);
    }
    return out.join("");
  }
};

/** La imagen de un documento, si ya está pintada en assets/handouts/<ID>.webp. */
function imagenDe(id) {
  if (!id) return null;
  const rel = `assets/handouts/${id}.webp`;
  return existe(rel) ? `<img class="sbn-doc-imagen" src="modules/${MODULO}/${rel}" alt="">` : null;
}

/** Imágenes de doc 15 que van a una página concreta (AYU-09-PJ-01-IMG → página AYU-09-PJ-01). */
const IMAGEN_PARA = new Map(
  (existe("content/arte-doc15.json") ? leerJson("content/arte-doc15.json").ayudas ?? [] : [])
    .filter(a => a.para).map(a => [a.para, a.id])
);

function maquetarDocumento(soporte, md, render, { imagen } = {}) {
  let html = SOPORTES_MD[soporte] ? SOPORTES_MD[soporte](md, render) : render.html(md);
  html = maquetarComun(html, soporte);
  if (SOPORTES[soporte]) html = SOPORTES[soporte](html, { imagen });
  else if (imagen) html = imagen + html;
  return `<div class="sbn-doc sbn-doc-${soporte}">${html}</div>`;
}

/* -------------------------------------------- */
/*  Carpetas con ruta                           */
/* -------------------------------------------- */

/**
 * `Carpetas.id(nombre, padre)` de util.mjs resuelve el padre por nombre desde
 * la raíz, así que no llega al tercer nivel («Seattle by Night/Vástagos/Brujah»).
 * Esta subclase arma la ruta completa con la misma clave y la misma semilla
 * de _id que la base (raíz «/X», hijos «X/Y», nietos «X/Y/Z»).
 */
const ORDEN_CARPETAS = [
  "Seattle by Night", "El Expediente Ward", "Documentos del mundo", "Ayudas de juego",
  "La ciudad", "Lugares", "Personajes jugadores", "Vástagos", "Mortales y ghouls", "FIRSTLIGHT", "Trasfondo"
];
const COLOR_RAIZ = {
  "Seattle by Night": "#1f3a4d",
  "El Expediente Ward": "#8f1d24",
  "Documentos del mundo": "#2b3036",
  "Ayudas de juego": "#6b4a1f"
};

class CarpetasRuta extends Carpetas {
  ruta(ruta) {
    if (!ruta) return null;
    const partes = ruta.split("/").map(s => s.trim()).filter(Boolean);
    let padre = null;
    let rutaPadre = "";
    for (const nombre of partes) {
      const clave = `${rutaPadre}/${nombre}`;
      if (!this.mapa.has(clave)) {
        const i = ORDEN_CARPETAS.indexOf(nombre);
        this.mapa.set(clave, {
          _id: idEstable(`carpeta:${this.pack}:${clave}`),
          name: nombre,
          type: this.tipo,
          folder: padre,
          sorting: "m",
          sort: i >= 0 ? (i + 1) * 10 : 0,
          // Sólo la raíz lleva color (ver util.mjs).
          color: padre ? null : (COLOR_RAIZ[nombre] ?? null),
          flags: { [MODULO]: { origen: "carpeta" } },
          _stats: STATS
        });
      }
      padre = this.mapa.get(clave)._id;
      rutaPadre = rutaPadre ? `${rutaPadre}/${nombre}` : nombre;
    }
    return padre;
  }

  escribir() {
    // Las que no están en ORDEN_CARPETAS (los clanes) van después y por nombre.
    const sueltas = [...this.mapa.values()].filter(c => !c.sort).sort((a, b) => a.name.localeCompare(b.name, "es"));
    sueltas.forEach((c, i) => { c.sort = 1000 + i * 10; });
    super.escribir();
  }
}

/* -------------------------------------------- */
/*  Documentos de Foundry                       */
/* -------------------------------------------- */

const flags = (origen, extra = {}) => ({ [MODULO]: { origen, ...extra } });

function docPagina(jid, { clave, nombre, html, nivel, mostrarTitulo, orden, id }) {
  const pid = ID.pagina(jid, clave);
  return {
    _id: pid,
    _key: `!journal.pages!${jid}.${pid}`,
    name: nombre,
    type: "text",
    title: { show: mostrarTitulo, level: 1 },
    text: { format: 1, content: html },
    sort: (orden + 1) * 100000,
    ownership: { default: nivel },
    flags: flags("pagina", id ? { id } : {}),
    _stats: STATS
  };
}

function docJournal({ id, nombre, folder, orden, nivel, paginas, extra = {} }) {
  const jid = ID.journal(id);
  return {
    _id: jid,
    _key: `!journal!${jid}`,
    name: nombre,
    folder,
    sort: Number(orden ?? 0),
    ownership: { default: nivel },
    flags: flags("journal", { id, ...extra }),
    pages: paginas,
    categories: [],
    _stats: STATS
  };
}

const ENTREGA = {
  "sesion-cero": "Sesión cero",
  narrador: "Sólo para el Narrador",
  fuera: "Fuera de la aventura",
  epilogo: "Epílogo"
};

/** Un journal desde un archivo de content/. */
function construirJournal(ctx, j, carpetas) {
  const { meta, rel } = j;
  const jid = ID.journal(j.id);
  const render = crearRender(ctx, rel, jid);
  const esDocumento = j.pack === "documentos" && !!meta.soporte;
  const jugadores = meta.jugadores === "si";
  const nivelDe = p => {
    if (p.visibilidad === "jugadores") return OBSERVADOR;
    if (p.visibilidad === "narrador") return NINGUNO;
    return jugadores ? OBSERVADOR : NINGUNO;
  };

  const paginas = [...j.paginas];
  const entrega = lista(meta.entrega);

  // «nota» del frontmatter → página «Para el Narrador», salvo que el archivo ya la tenga.
  if (esDocumento && meta.nota && !paginas.some(p => /^para el narrador$/i.test(p.nombre ?? ""))) {
    const donde = entrega.map(e => ctx.reg.has(e) ? `@ID[${e}]` : (ENTREGA[e] ?? e)).join(" · ");
    paginas.push({
      titulo: "Para el Narrador {narrador}", nombre: "Para el Narrador", ancla: null, visibilidad: "narrador",
      md: [`**Soporte:** ${meta.soporte}.${donde ? ` **Entrega:** ${donde}.` : ""}`, `*${meta.nota}*`].join("\n\n")
    });
  }

  const actor = j.pack === "cronica" && rel.startsWith("content/personajes/") ? ctx.actores?.get(j.id) : null;
  const vistas = new Set();

  const docs = paginas.map((p, i) => {
    let clave = clavePagina(p);
    if (vistas.has(clave)) {
      ctx.avisos.push(`${rel}: dos páginas con la misma clave «${clave}»; la segunda lleva sufijo`);
      clave = `${clave}:${i}`;
    }
    vistas.add(clave);
    render.pagina(clave);

    const esIntro = p.titulo === null;
    const paraNarrador = /^para el narrador$/i.test(p.nombre ?? "");
    let html;
    if (esDocumento && !paraNarrador) {
      const imagen = imagenDe(p.ancla && IMAGEN_PARA.get(p.ancla)) ?? (esIntro ? imagenDe(meta.imagen) : null);
      html = maquetarDocumento(meta.soporte, p.md, render, { imagen });
    } else {
      html = render.html(p.md);
      if (paraNarrador && esDocumento) html = `<div class="sbn-para-narrador">${html}</div>`;
    }
    if (actor && i === 0) {
      html = `<p class="sbn-enlace-actor"><i class="fa-solid fa-user"></i> Ficha: @UUID[${actor.uuid}]{${escapar(plano(actor.nombre))}}</p>\n${html}`;
    }
    return docPagina(jid, {
      clave,
      nombre: plano(p.nombre ?? meta.nombre ?? j.id),
      html,
      // Los documentos con jugadores: si se revelan página a página, al entregarlos.
      nivel: nivelDe(p),
      mostrarTitulo: !esIntro,
      orden: i,
      id: p.ancla
    });
  });

  const extra = { archivo: rel };
  if (esDocumento) Object.assign(extra, { soporte: meta.soporte, entrega });
  if (actor) extra.actor = actor.uuid;

  return docJournal({
    id: j.id,
    nombre: plano(meta.nombre ?? j.id),
    folder: carpetas.ruta(meta.carpeta),
    orden: meta.orden,
    // Un documento siempre arranca oculto: el Narrador lo entrega.
    nivel: esDocumento ? NINGUNO : (jugadores ? OBSERVADOR : NINGUNO),
    paginas: docs,
    extra
  });
}

/* -------------------------------------------- */
/*  Journal generado: Pistas                    */
/* -------------------------------------------- */

const TIPO_OBTENCION = {
  principal: "Principal", preludio: "Preludio", documento: "Documento", relato: "Relato",
  loresheet: "Loresheet", parcial: "Parcial", alternativa: "Alternativa", indicio: "Indicio",
  refuerzo: "Refuerzo", adelantada: "Adelantada"
};

const origenDoc = o => o ? ` <span class="sbn-origen">doc ${escapar(o)}</span>` : "";

function construirPistas(ctx, carpetas) {
  if (!PISTAS.length) return null;
  const jid = ID.journal("PISTAS");
  const render = crearRender(ctx, "content/pistas.json", jid);
  const L = t => render.inline(render.enlazar(t));
  const enlace = id => ctx.reg.has(id) ? render.inline(`@ID[${id}]`) : escapar(id);

  const paginas = PISTAS.map((p, i) => {
    render.pagina(p.id);
    const h = [];
    h.push(`<p class="sbn-pista-cabecera">${htmlPista(p.id)}</p>`);
    if (p.texto) h.push(`<p>${L(p.texto)}</p>`);

    const escenas = [p.escena, ...(p.otrasEscenas ?? [])].filter(Boolean);
    h.push(`<h3>Dónde se obtiene</h3>`);
    if (escenas.length) {
      h.push(`<p><strong>Escena principal:</strong> ${enlace(escenas[0])}`
        + (escenas.length > 1 ? ` · <strong>También en:</strong> ${escenas.slice(1).map(enlace).join(", ")}` : "") + `</p>`);
    }
    if (p.obtencion?.length) {
      h.push(`<ul class="sbn-lista-obtencion">${p.obtencion.map(o => {
        const vinculos = [o.pj, o.lugar, o.documento].filter(Boolean).map(enlace);
        return `<li><strong>${enlace(o.escena)}</strong> · <em>${escapar(TIPO_OBTENCION[o.tipo] ?? o.tipo ?? "")}</em>`
          + (vinculos.length ? ` (${vinculos.join(", ")})` : "")
          + `: ${L(o.como ?? "")}${o.nota ? ` <span class="sbn-nota">${L(o.nota)}</span>` : ""}${origenDoc(o.origen)}</li>`;
      }).join("")}</ul>`);
    }

    if (p.dados?.length) {
      h.push(`<h3>Dados que aporta</h3><ul class="sbn-lista-dados">${p.dados.map(d =>
        `<li><span class="sbn-dados">+${escapar(d.cantidad)}</span> ${enlace(d.tirada)}: ${L(d.texto ?? "")}${origenDoc(d.origen)}</li>`
      ).join("")}</ul>`);
    }
    if (p.efectos?.length) {
      h.push(`<h3>Efectos</h3><ul>${p.efectos.map(e =>
        `<li>${e.escena ? `<strong>${enlace(e.escena)}</strong>: ` : ""}${L(e.efecto ?? e.texto ?? "")}`
        + `${e.pj ? ` (${enlace(e.pj)})` : ""}${origenDoc(e.origen)}</li>`).join("")}</ul>`);
    }
    if (p.ayuda) h.push(`<h3>Ayuda de juego</h3><p>${L(p.ayuda)}</p>`);
    if (p.nota) h.push(`<aside class="sbn-recuadro sbn-nota-edicion"><h4>Nota</h4><p>${L(p.nota)}</p></aside>`);
    const nombres = Object.entries(p.nombres ?? {});
    const variantes = Object.entries(p.variantes ?? {});
    if (nombres.length || variantes.length) {
      h.push(`<h3>En los docs</h3><ul class="sbn-lista-variantes">`
        + nombres.map(([doc, n]) => `<li><span class="sbn-origen">doc ${escapar(doc)}</span> «${L(n)}»</li>`).join("")
        + variantes.map(([doc, v]) => `<li><span class="sbn-origen">doc ${escapar(doc)}</span> ${L(v)}</li>`).join("")
        + `</ul>`);
    }
    return docPagina(jid, {
      clave: p.id, // el registro (ids.mjs) ya espera esta clave
      nombre: `${p.id} · ${plano(p.nombre)}`,
      html: h.join("\n"),
      nivel: NINGUNO,
      mostrarTitulo: true,
      orden: i,
      id: p.id
    });
  });

  return docJournal({
    id: "PISTAS", nombre: "Pistas", folder: carpetas.ruta("El Expediente Ward"), orden: 900,
    nivel: NINGUNO, paginas, extra: { archivo: "content/pistas.json" }
  });
}

/* -------------------------------------------- */
/*  Journal generado: Termómetro y Reloj        */
/* -------------------------------------------- */

function construirTrackers(ctx, carpetas) {
  if (!TRACKERS) return null;
  const jid = ID.journal("TRACKERS");
  const render = crearRender(ctx, "content/trackers.json", jid);
  const L = t => render.inline(render.enlazar(t));
  const enlace = id => ctx.reg.has(id) ? render.inline(`@ID[${id}]`) : escapar(id);
  const { termometro: T = {}, reloj: R = {} } = TRACKERS;
  const paginas = [];
  const pagina = (clave, nombre, partes) => {
    paginas.push(docPagina(jid, { clave, nombre, html: partes.filter(Boolean).join("\n"), nivel: NINGUNO, mostrarTitulo: true, orden: paginas.length }));
  };
  const nochesDe = x => [...(x.noches ?? []), ...(x.noche != null ? [x.noche] : [])];
  const variantes = v => {
    const e = Object.entries(v ?? {});
    return e.length ? `<ul class="sbn-lista-variantes">${e.map(([d, t]) => `<li><span class="sbn-origen">doc ${escapar(d)}</span> ${L(t)}</li>`).join("")}</ul>` : "";
  };
  /** Dónde ocurre un movimiento: escena, lugar, noche, gancho… */
  const donde = x => {
    const out = [];
    for (const k of ["escena", "lugar", "documento", "pnj", "pj", "gancho", "desenlace", "lor"]) if (x[k]) out.push(enlace(x[k]));
    for (const n of nochesDe(x)) out.push(htmlReloj(n));
    if (x.por) out.push(`por ${escapar(x.por)}`);
    if (x.maximo != null) out.push(`máx. ${escapar(x.maximo)}`);
    if (x.alcance) out.push(`sólo ${escapar(x.alcance)}`);
    return out.join(" · ");
  };
  const tablaMovimientos = filas => `<table class="sbn-tabla sbn-tabla-movimientos"><thead><tr><th>Cambio</th><th>Motivo</th><th>Dónde</th></tr></thead><tbody>${
    filas.map(x => {
      const cambio = valorCambio(x.cantidad);
      const boton = cambio && cambio !== "+0" && cambio !== "0" ? htmlTermometro(cambio, plano(x.motivo), { corto: true }) : `<span class="sbn-termometro-cambio">${escapar(etiquetaCambio(x.cantidad))}</span>`;
      const notas = [x.nota ? `<span class="sbn-nota">${L(x.nota)}</span>` : "", variantes(x.variantes)].join("");
      return `<tr><td>${boton}</td><td>${L(x.motivo)}${notas}${origenDoc(x.origen)}</td><td>${donde(x)}</td></tr>`;
    }).join("")}</tbody></table>`;

  // 1. El Termómetro: qué es y sus umbrales.
  render.pagina("termometro");
  pagina("termometro", "El Termómetro de FIRSTLIGHT", [
    T.descripcion && `<p>${L(T.descripcion)}</p>`,
    `<p><strong>Empieza en</strong> ${escapar(T.inicio ?? "")} · <strong>escala</strong> ${escapar(T.min ?? 0)}–${escapar(T.max ?? 10)}`
      + (T.ayuda ? ` · <strong>ayuda de juego:</strong> ${enlace(T.ayuda)}` : "") + `</p>`,
    T.visibilidad && `<p><em>${L(T.visibilidad)}</em></p>`,
    `<h3>Umbrales</h3>`,
    `<table class="sbn-tabla sbn-tabla-umbrales"><thead><tr><th>Valor</th><th>Qué pasa</th><th>Lo que ven los jugadores</th></tr></thead><tbody>${
      (T.umbrales ?? []).map(u => `<tr><td class="sbn-umbral-valor">${escapar(u.icono ?? "")} <strong>${escapar(u.valor)}</strong></td>`
        + `<td>${L(u.ciudad ?? u.texto ?? "")}${u.ciudad && u.texto && u.ciudad !== u.texto ? `<br><span class="sbn-nota">${L(u.texto)}</span>` : ""}`
        + `${u.escena ? ` → ${enlace(u.escena)}` : ""}${u.pnj ? ` (${enlace(u.pnj)})` : ""}</td>`
        + `<td>${L(u.jugadores === "inicio" ? "Inicio" : (u.jugadores ?? ""))}</td></tr>`).join("")
    }</tbody></table>`,
    ...(T.umbrales ?? []).filter(u => u.efectos?.length || u.nota || Object.keys(u.variantes ?? {}).length).map(u =>
      `<h4>${escapar(u.icono ?? "")} ${escapar(u.valor)} · ${L(u.texto ?? "")}</h4>`
      + (u.efectos?.length ? `<ul>${u.efectos.map(e => `<li>${L(e.texto)}${e.lugar ? ` (${enlace(e.lugar)})` : ""}${e.pnj ? ` (${enlace(e.pnj)})` : ""}${origenDoc(e.origen)}</li>`).join("")}</ul>` : "")
      + (u.nota ? `<p class="sbn-nota">${L(u.nota)}</p>` : "")
      + variantes(u.variantes)),
    T.condiciones?.length && `<h3>Condiciones</h3><table class="sbn-tabla sbn-tabla-condiciones"><thead><tr><th>Termómetro</th><th>Efecto</th><th>Dónde</th></tr></thead><tbody>${
      T.condiciones.map(c => `<tr><td><strong>${escapar(c.valor)}</strong></td><td>${L(c.efecto)}`
        + `${c.nota ? `<br><span class="sbn-nota">${L(c.nota)}</span>` : ""}${variantes(c.variantes)}${origenDoc(c.origen)}</td>`
        + `<td>${[...(c.escenas ?? (c.escena ? [c.escena] : [])).map(enlace), c.lor ? enlace(c.lor) : "", c.noche != null ? htmlReloj(c.noche) : ""].filter(Boolean).join(" · ")}</td></tr>`).join("")
    }</tbody></table>`,
    T.origen && `<p class="sbn-origen">Fuentes: docs ${escapar(T.origen)}</p>`
  ]);

  // 2. Movimientos: sube, baja, otros y cómo evitar que suba.
  render.pagina("termometro-movimientos");
  pagina("termometro-movimientos", "Movimientos del Termómetro", [
    `<p>Los botones mueven el Termómetro (sólo el Narrador).</p>`,
    T.sube?.length && `<h3>Sube</h3>${tablaMovimientos(T.sube)}`,
    T.baja?.length && `<h3>Baja</h3>${tablaMovimientos(T.baja)}`,
    T.otros?.length && `<h3>Otros movimientos</h3>${tablaMovimientos(T.otros)}`,
    T.evitar?.length && `<h3>Cómo evitar que suba</h3><ul>${T.evitar.map(e =>
      `<li>${L(e.motivo)}${donde(e) ? ` · ${donde(e)}` : ""}${origenDoc(e.origen)}</li>`).join("")}</ul>`
  ]);

  // 3. El Reloj: resumen y variantes condicionales.
  const noches = R.noches ?? [];
  render.pagina("reloj");
  pagina("reloj", "El Reloj de Halloway", [
    R.descripcion && `<p>${L(R.descripcion)}</p>`,
    R.convencionFechas && `<p class="sbn-nota">${L(R.convencionFechas)}</p>`,
    `<table class="sbn-tabla sbn-tabla-reloj"><thead><tr><th>Noche</th><th>Fecha</th><th>Qué pasa</th><th>Escenas</th></tr></thead><tbody>${
      noches.map(n => `<tr><td>${htmlReloj(n.n)}</td><td>${escapar(n.dia ?? fechaCorta(n.fecha))}</td><td>${L(n.evento)}</td>`
        + `<td>${(n.escenas ?? (n.escena ? [n.escena] : [])).map(enlace).join(", ")}</td></tr>`).join("")
    }</tbody></table>`,
    R.variantes?.length && `<h3>Si la coterie…</h3><table class="sbn-tabla sbn-tabla-variantes"><thead><tr><th>Si…</th><th>Entonces…</th><th>Dónde</th></tr></thead><tbody>${
      R.variantes.map(v => `<tr><td>${L(v.si)}</td><td>${L(v.entonces)}${origenDoc(v.origen)}</td><td>${donde(v)}</td></tr>`).join("")
    }</tbody></table>`,
    R.nota && `<aside class="sbn-recuadro sbn-nota-edicion"><h4>Nota de edición</h4><p>${L(R.nota)}</p></aside>`,
    R.versionDoc01?.length && `<h3>Versión del doc 01</h3><ul class="sbn-lista-variantes">${R.versionDoc01.map(v =>
      `<li>${htmlReloj(v.n)} ${L(v.evento)}</li>`).join("")}</ul>`
  ]);

  // 4. Una página por noche.
  for (const n of noches) {
    const clave = `noche-${n.n}`;
    render.pagina(clave);
    const movs = n.movimientos ?? [];
    pagina(clave, `Noche ${n.n} · ${n.dia ?? fechaCorta(n.fecha)}`, [
      `<p class="sbn-noche-fecha">${htmlReloj(n.n)} · madrugada del ${escapar(fechaCorta(n.fecha))}</p>`,
      `<p>${L(n.evento)}</p>`,
      (n.escenas ?? (n.escena ? [n.escena] : [])).length
        && `<p><strong>Escenas:</strong> ${(n.escenas ?? [n.escena]).map(enlace).join(", ")}</p>`,
      (n.termometro != null || movs.length) && `<h3>Termómetro</h3>`
        + (n.termometro != null ? `<p>Cambio fijo de la noche: <strong>${escapar(etiquetaCambio(n.termometro))}</strong>.</p>` : "")
        + (movs.length ? `<ul>${movs.map(m => {
          const c = valorCambio(m.cantidad);
          return `<li>${c ? htmlTermometro(c, plano(m.motivo)) : `${escapar(m.cantidad)} ${L(m.motivo)}`}`
            + `${m.condicional ? ` <em>(si pasa)</em>` : ""}${origenDoc(m.origen)}</li>`;
        }).join("")}</ul>` : ""),
      n.horas?.length && `<h3>Hora a hora</h3><table class="sbn-tabla sbn-tabla-horas"><thead><tr><th>Hora</th><th>Qué pasa</th></tr></thead><tbody>${
        n.horas.map(h => `<tr><td class="sbn-hora">${escapar(h.hora)}${h.dia ? `<br><span class="sbn-nota">${escapar(h.dia)}</span>` : ""}</td>`
          + `<td>${L(h.evento)}${h.nota ? `<br><span class="sbn-nota">${L(h.nota)}</span>` : ""}${variantes(h.variantes)}${origenDoc(h.origen)}</td></tr>`).join("")
      }</tbody></table>`,
      Object.keys(n.variantes ?? {}).length && `<h3>Versiones de los docs</h3>${variantes(n.variantes)}`,
      (R.variantes ?? []).some(v => Number(v.noche) === Number(n.n))
        && `<h3>Si la coterie…</h3><ul>${R.variantes.filter(v => Number(v.noche) === Number(n.n)).map(v =>
          `<li>${L(v.si)} → ${L(v.entonces)}${origenDoc(v.origen)}</li>`).join("")}</ul>`
    ]);
  }

  return docJournal({
    id: "TRACKERS", nombre: "El Termómetro y el Reloj", folder: carpetas.ruta("El Expediente Ward"), orden: 910,
    nivel: NINGUNO, paginas, extra: { archivo: "content/trackers.json" }
  });
}

/* -------------------------------------------- */
/*  Entrada                                     */
/* -------------------------------------------- */

export async function construir(ctx) {
  const carpetas = { cronica: new CarpetasRuta("cronica", "JournalEntry"), documentos: new CarpetasRuta("documentos", "JournalEntry") };
  const cuenta = { cronica: { j: 0, p: 0 }, documentos: { j: 0, p: 0 } };
  const escribir = (pack, doc) => {
    if (!doc) return;
    escribirDoc(pack, doc);
    cuenta[pack].j++;
    cuenta[pack].p += doc.pages.length;
    ctx.log(`${pack}: ${doc.name} (${doc.pages.length} páginas)`);
  };

  for (const j of journals()) escribir(j.pack, construirJournal(ctx, j, carpetas[j.pack]));
  escribir("cronica", construirPistas(ctx, carpetas.cronica));
  escribir("cronica", construirTrackers(ctx, carpetas.cronica));

  for (const c of Object.values(carpetas)) c.escribir();
  for (const [pack, n] of Object.entries(cuenta)) {
    console.log(`${pack}: ${n.j} journals, ${n.p} páginas, ${carpetas[pack].mapa.size} carpetas`);
  }
}

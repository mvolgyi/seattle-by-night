/**
 * Validación de una traducción contra su castellano (TRADUCCION.md): lo que no
 * se puede tocar tiene que seguir igual. La usan tools/traducir.mjs (después de
 * cada respuesta) y la verificación del build.
 *
 * Errores (la traducción no sirve):
 *   - `{#ID}`, `{jugadores}`/`{narrador}` y cantidad/orden de páginas `## `;
 *   - marcadores `@ID[...]`, `@tirada{ruta|dif|…}`, `@termometro{n|…}`, `@pista{…}`,
 *     `@reloj{…}` con las mismas rutas, IDs y números (como multiconjunto: dentro
 *     de una frase el orden puede cambiar);
 *   - bloques `:::` balanceados y con las mismas palabras clave.
 * Avisos (se escribe igual, pero se informa):
 *   - IDs sueltos en la prosa (`PNJ-04`, `A1-E03`) que no coinciden;
 *   - cantidad de filas de tabla distinta.
 */

/** Patrón de los IDs de los docs, para los IDs sueltos en la prosa. */
const ID_SUELTO = /\b(?:PJ|PNJ|MEN|LUG|DOC|AYU|GAN|LOR|INT|FIN|CAP|REF|COT|CEL|PRE|CAZ|AVE|P|A\d)-[0-9A-Z]+(?:-[0-9A-Z]+)*\b/g;

const multiconjunto = lista => {
  const m = new Map();
  for (const x of lista) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};

/** Diferencias entre dos listas tomadas como multiconjuntos: «falta X», «sobra Y». */
function diferencias(nombre, es, en) {
  const a = multiconjunto(es), b = multiconjunto(en);
  const out = [];
  for (const [k, n] of a) if ((b.get(k) ?? 0) < n) out.push(`${nombre}: falta ${k}${n - (b.get(k) ?? 0) > 1 ? ` (×${n - (b.get(k) ?? 0)})` : ""}`);
  for (const [k, n] of b) if ((a.get(k) ?? 0) < n) out.push(`${nombre}: sobra ${k}`);
  return out;
}

/** Lo intocable de un texto (Markdown o un campo suelto). */
export function marcadores(texto) {
  const t = texto ?? "";
  return {
    ids: [...t.matchAll(/@ID\[([^\]|]+)(?:\|[^\]]*)?\]/g)].map(m => m[1].trim()),
    tiradas: [...t.matchAll(/@tirada\{([^|}]*)\|([^|}]*)\|[^}]*\}/g)].map(m => `${m[1].trim()}|${m[2].trim()}`),
    termometro: [...t.matchAll(/@termometro\{([^|}]*)(?:\|[^}]*)?\}/g)].map(m => m[1].trim()),
    pistas: [...t.matchAll(/@pista\{([^}]*)\}/g)].map(m => m[1].trim()),
    relojes: [...t.matchAll(/@reloj\{([^}]*)\}/g)].map(m => m[1].trim()),
    // Sin los marcadores, para no contar dos veces los IDs de adentro.
    sueltos: [...t.replace(/@\w+(?:\[[^\]]*\]|\{[^}]*\})/g, " ").replace(/\{#[^}]+\}/g, " ").matchAll(ID_SUELTO)].map(m => m[0])
  };
}

/** Bloques `:::`: la secuencia de aperturas (palabra clave) y si cierran todos. */
function bloques(texto) {
  const aperturas = [];
  let abiertos = 0;
  const errores = [];
  for (const linea of (texto ?? "").split("\n")) {
    const m = /^:::(\S*)/.exec(linea.trim());
    if (!m) continue;
    if (m[1]) { aperturas.push(m[1]); abiertos++; }
    else if (abiertos > 0) abiertos--;
    else errores.push("`:::` de cierre sin apertura");
  }
  if (abiertos) errores.push(`${abiertos} bloque(s) \`:::\` sin cerrar`);
  return { aperturas, errores };
}

/** Páginas `## ` fuera de bloques de código: [{ ancla, flag }]. */
function paginas(texto) {
  const out = [];
  let enCodigo = false;
  for (const linea of (texto ?? "").split("\n")) {
    if (/^```/.test(linea)) enCodigo = !enCodigo;
    if (enCodigo) continue;
    const m = /^## (.+)$/.exec(linea);
    if (!m) continue;
    const t = m[1];
    out.push({
      ancla: /\{#([^}]+)\}/.exec(t)?.[1] ?? null,
      flag: /\{(jugadores|narrador)\}/.exec(t)?.[1] ?? null
    });
  }
  return out;
}

/** Valida un texto suelto (campo de JSON, etiqueta…). → { errores, avisos } */
export function validarTexto(es, en, donde = "") {
  const pre = donde ? `${donde}: ` : "";
  const a = marcadores(es), b = marcadores(en);
  const errores = [
    ...diferencias(`${pre}@ID`, a.ids, b.ids),
    ...diferencias(`${pre}@tirada`, a.tiradas, b.tiradas),
    ...diferencias(`${pre}@termometro`, a.termometro, b.termometro),
    ...diferencias(`${pre}@pista`, a.pistas, b.pistas),
    ...diferencias(`${pre}@reloj`, a.relojes, b.relojes)
  ];
  const ba = bloques(es), bb = bloques(en);
  errores.push(...bb.errores.filter(e => !ba.errores.includes(e)).map(e => pre + e));
  if (ba.aperturas.join(",") !== bb.aperturas.join(",")) {
    errores.push(`${pre}bloques ::: distintos: ${ba.aperturas.join(",") || "-"} → ${bb.aperturas.join(",") || "-"}`);
  }
  const avisos = diferencias(`${pre}ID suelto`, a.sueltos, b.sueltos);
  if (typeof en !== "string" || (typeof es === "string" && es.trim() && !en.trim())) errores.push(`${pre}texto vacío`);
  return { errores, avisos };
}

/** Valida un cuerpo Markdown entero: lo de `validarTexto` más las páginas. */
export function validarMarkdown(es, en) {
  const { errores, avisos } = validarTexto(es, en);
  const pa = paginas(es), pb = paginas(en);
  if (pa.length !== pb.length) errores.push(`páginas ##: ${pb.length} en vez de ${pa.length}`);
  pa.forEach((p, i) => {
    const q = pb[i];
    if (!q) return;
    if (p.ancla !== q.ancla) errores.push(`página ${i + 1}: ancla {#${p.ancla ?? "-"}} → {#${q.ancla ?? "-"}}`);
    if (p.flag !== q.flag) errores.push(`página ${i + 1}: marca {${p.flag ?? "-"}} → {${q.flag ?? "-"}}`);
  });
  const filas = t => (t.match(/^\|.*\|\s*$/gm) ?? []).length;
  if (filas(es) !== filas(en)) avisos.push(`filas de tabla: ${filas(en)} en vez de ${filas(es)}`);
  return { errores, avisos };
}

/**
 * Macros del módulo → pack `macros`.
 *
 * Son atajos de la API pública (`game.modules.get("seattle-by-night").api`,
 * ver tools/contenido/CONTRATO.md): la lógica vive en src/module, acá sólo se
 * la llama. Adaptado de construirMacros de DVV.
 *
 * «Marcar pista…» lleva la lista de pistas de content/pistas.json horneada en
 * el comando (id y nombre): la macro no depende de que el journal de pistas
 * esté importado.
 */
import fs from "node:fs";
import path from "node:path";
import { RAIZ, MODULO, STATS, escribirDoc } from "../util.mjs";
import { ID } from "./ids.mjs";

const PACK = "macros";

/** Preámbulo común: la API tiene que estar (el módulo activo y `ready`). */
const API = `const api = game.modules.get("${MODULO}")?.api;
if (!api) return ui.notifications.error("Seattle by Night: el módulo no está activo en este mundo.");`;

/** Nombre de pista sin marcas de Markdown (*cursiva*, **negrita**). */
const plano = t => t.replace(/\*+([^*]+)\*+/g, "$1").trim();

function pistas(ctx) {
  const rel = "content/pistas.json";
  if (!fs.existsSync(path.join(RAIZ, rel))) {
    ctx.avisos.push(`macros: falta ${rel}; «Marcar pista…» sale sin pistas`);
    return [];
  }
  return (JSON.parse(fs.readFileSync(path.join(RAIZ, rel), "utf8")).pistas ?? [])
    .map(p => ({ id: p.id, nombre: plano(p.nombre) }));
}

/**
 * Diálogo con una casilla por pista, marcadas según `api.estado().pistas`;
 * al confirmar sólo se llama `api.pista` en las que cambiaron. El estado de
 * cada pista puede venir como booleano o como objeto ({ obtenida }): se
 * aceptan los dos.
 */
const comandoPistas = lista => `${API}
const PISTAS = ${JSON.stringify(lista)};
const estado = (await api.estado())?.pistas ?? {};
const marcada = v => (v && typeof v === "object") ? Boolean(v.obtenida ?? v.marcada ?? v.valor) : Boolean(v);
const esc = foundry.utils.escapeHTML ?? (s => s);
const filas = PISTAS.map(p => \`<label class="sbn-macro-pista" style="display:flex;gap:.5em;align-items:baseline;margin:.15em 0">
  <input type="checkbox" name="\${p.id}" \${marcada(estado[p.id]) ? "checked" : ""}>
  <span><strong>\${p.id}</strong> · \${esc(p.nombre)}</span></label>\`).join("");
const datos = await foundry.applications.api.DialogV2.input({
  window: { title: "Marcar pista…", icon: "fa-solid fa-magnifying-glass" },
  position: { width: 520 },
  content: \`<p>Marcá las pistas que la coterie ya obtuvo; desmarcá para quitarla.</p><div class="sbn-macro-pistas">\${filas}</div>\`,
  ok: { label: "Guardar", icon: "fa-solid fa-check" }
});
if (!datos) return;
for (const p of PISTAS) {
  const nueva = Boolean(datos[p.id]);
  if (nueva !== marcada(estado[p.id])) await api.pista(p.id, nueva);
}`;

/** Reloj de Halloway: 8 noches (jueves 12 a jueves 19 de noviembre de 2026). */
const comandoNoche = `${API}
const NOCHES = api.Datos?.totalNoches ?? 8;
const actual = Number((await api.estado())?.noche) || 0;
if (actual >= NOCHES) return ui.notifications.warn("El Reloj de Halloway ya está en la última noche (" + NOCHES + ").");
await api.noche(actual + 1);`;

export async function construir(ctx) {
  const macros = [
    { id: "panel", nombre: "Panel del Narrador", icono: "icons/svg/book.svg",
      comando: `${API}\napi.abrirPanel();` },
    { id: "termometro-mas", nombre: "Termómetro +1", icono: "icons/svg/upgrade.svg",
      comando: `${API}\nawait api.termometro(+1, "Macro «Termómetro +1»");` },
    { id: "termometro-menos", nombre: "Termómetro −1", icono: "icons/svg/downgrade.svg",
      comando: `${API}\nawait api.termometro(-1, "Macro «Termómetro −1»");` },
    { id: "pista", nombre: "Marcar pista…", icono: "icons/svg/eye.svg", comando: comandoPistas(pistas(ctx)) },
    { id: "noche", nombre: "Avanzar noche", icono: "icons/svg/clockwork.svg", comando: comandoNoche },
    { id: "importar", nombre: "Importar la crónica", icono: "icons/svg/down.svg",
      comando: `${API}\nawait api.importarCronica();` }
  ];
  macros.forEach((m, i) => {
    const id = ID.macro(m.id);
    escribirDoc(PACK, {
      _id: id,
      _key: `!macros!${id}`,
      name: m.nombre,
      type: "script",
      scope: "global",
      img: m.icono,
      command: m.comando,
      folder: null,
      sort: (i + 1) * 100,
      ownership: { default: 0 },
      flags: { [MODULO]: { origen: "macro", macro: m.id } },
      _stats: STATS
    });
  });
  console.log(`macros: ${macros.length}`);
}

#!/usr/bin/env node
/**
 * Capturas de la Guía del Narrador (sección «En Foundry») contra un Foundry local:
 * las mismas siete que usa tools/construir-guia.mjs (importar, indicador,
 * panel-termometro, susurro, panel-tiradas, journal, interludio), con el mismo
 * encuadre que las castellanas de assets/guia/capturas/.
 *
 * Con `--idioma en` (por defecto) el cliente del GM va en inglés (core.language) y
 * la crónica del mundo se importa en inglés (aventura-en); salen en
 * assets/guia/capturas/en/. Con `--idioma es`, en assets/guia/capturas/.
 * Al terminar, el mundo vuelve a la crónica en castellano y el estado al inicio.
 *
 * Requisitos: los del e2e (tools/e2e/prueba.mjs): wod5e, el mundo `sbn-test` con
 * el módulo y los packs compilados, el servidor corriendo, y `magick` para el webp.
 *
 *   SBN_FOUNDRY_URL=http://localhost:30199 node tools/e2e/capturas-guia.mjs [--idioma en|es]
 */
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const URL = process.env.SBN_FOUNDRY_URL ?? "http://localhost:30099";
const MOD = "seattle-by-night";
const i = process.argv.indexOf("--idioma");
const IDIOMA = i >= 0 ? process.argv[i + 1] : "en";
if (!["es", "en"].includes(IDIOMA)) { console.error("Uso: node tools/e2e/capturas-guia.mjs [--idioma en|es]"); process.exit(1); }
const RAIZ = path.resolve(import.meta.dirname, "../..");
const SALIDA = path.join(RAIZ, "assets/guia/capturas", IDIOMA === "en" ? "en" : "");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sbn-capturas-"));
fs.mkdirSync(SALIDA, { recursive: true });

function buscarChrome() {
  const base = path.join(os.homedir(), ".cache/ms-playwright");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
    const p = path.join(base, d, rel);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: buscarChrome(), args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errores = [];
page.on("pageerror", e => errores.push(e.message));

const listo = async () => {
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120000 });
  await page.waitForFunction(id => !!game.modules.get(id)?.api, MOD, { timeout: 30000 });
};
async function idiomaCliente(lang) {
  if (await page.evaluate(() => game.i18n.lang) === lang) return;
  await page.evaluate(lang => game.settings.set("core", "language", lang), lang);
  await page.reload({ waitUntil: "networkidle" });
  await listo();
}
/** Limpia lo que tapa: notificaciones y ventanas abiertas. */
const despejar = () => page.evaluate(async () => {
  ui.notifications.clear();
  for (const app of [...foundry.applications.instances.values()]) if (app.id !== "sbn-indicador" && app.rendered && app.options?.window?.frame !== false) await app.close();
});
const hechas = [];
/** Recorte de la página alrededor de un elemento, con margen (las castellanas lo llevan). */
async function alrededor(locator, png, dx, dy) {
  const b = await locator.boundingBox();
  await page.screenshot({ path: png, clip: { x: b.x - dx, y: b.y - dy, width: b.width + 2 * dx, height: b.height + 2 * dy } });
}
/** PNG (de un elemento o de un recorte) → webp en SALIDA. */
async function guardar(nombre, captura) {
  const png = path.join(TMP, `${nombre}.png`);
  await captura(png);
  const webp = path.join(SALIDA, `${nombre}.webp`);
  execFileSync("magick", [png, "-quality", "82", "-define", "webp:method=6", webp]);
  const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", webp], { encoding: "utf8" }).split(" ").map(Number);
  hechas.push(`${path.relative(RAIZ, webp)} (${w}×${h})`);
}

await page.goto(`${URL}/join`, { waitUntil: "networkidle" });
const gm = await page.$eval("select[name=userid] option:not([value=''])", o => o.value);
await page.selectOption("select[name=userid]", gm);
await page.click("button[name=join]");
await listo();
await idiomaCliente(IDIOMA);
// La crónica en el idioma de las capturas y el estado al inicio.
await page.evaluate(async ([MOD, idioma]) => {
  const api = game.modules.get(MOD).api;
  if (api.idioma() !== idioma) await api.importarCronica({ idioma, silencioso: true });
  await game.settings.set(MOD, "termometro", { valor: 2, congelado: false, registro: [] });
  await game.settings.set(MOD, "pistas", {});
  await game.settings.set(MOD, "pruebas", {});
  await game.settings.set(MOD, "votos", {});
  await game.settings.set(MOD, "noche", 1);
  await game.settings.set(MOD, "indicador-plegado", false);
  await ChatMessage.implementation.deleteDocuments([], { deleteAll: true });
}, [MOD, IDIOMA]);
await page.waitForFunction(([MOD, idioma]) => game.modules.get(MOD).api.Datos.listos
  && game.modules.get(MOD).api.Datos.archivo === (idioma === "en" ? "data/en/cronica.json" : "data/cronica.json"), [MOD, IDIOMA], { timeout: 15000 });
await despejar();

// 1. El diálogo de la primera importación (el mismo que ofrece el módulo; no importa nada).
await page.evaluate(([MOD, idioma]) => { import(`/modules/${MOD}/src/module/importacion.mjs`).then(m => m.preguntarImportacion(idioma)); }, [MOD, IDIOMA]);
const dialogo = await page.waitForSelector(".application.sbn-dialogo", { timeout: 10000 });
await page.waitForTimeout(500);
await page.evaluate(() => ui.notifications.clear());
await guardar("importar", png => dialogo.screenshot({ path: png }));
await page.click(".application.sbn-dialogo button[data-action=no]");

// 2. El indicador: Termómetro 2, noche 1, 0 pistas.
await page.evaluate(MOD => game.modules.get(MOD).api.Indicador.refrescar(), MOD);
await page.waitForSelector("#sbn-indicador .sbn-ind-termometro", { timeout: 5000 });
await page.mouse.move(800, 300);
await page.waitForTimeout(500);
await guardar("indicador", png => alrededor(page.locator("#sbn-indicador"), png, 8, 6));

// 3. El susurro del umbral 3 (sólo el contenido del aviso, como en el chat).
await page.evaluate(async MOD => {
  ui.sidebar.expand();
  ui.sidebar.changeTab("chat", "primary");
  await game.modules.get(MOD).api.termometro(+1, "Guide");
}, MOD);
await page.waitForFunction(() => [...document.querySelectorAll("#chat .message .sbn-chat h4")].some(h => /3/.test(h.textContent)), null, { timeout: 10000 });
await page.waitForTimeout(800);
await page.evaluate(() => ui.notifications.clear());
const susurro = page.locator("#chat .message .sbn-chat").filter({ has: page.locator("h4", { hasText: /3:/ }) }).last();
await susurro.scrollIntoViewIfNeeded();
await guardar("susurro", png => alrededor(susurro, png, 4, 5));
await page.evaluate(() => ui.sidebar.collapse());

// 4. El Panel en la pestaña Termómetro (en 3): la parte de arriba del contenido.
await page.evaluate(MOD => game.modules.get(MOD).api.abrirPanel({ tab: "termometro" }), MOD);
await page.waitForSelector("#sbn-panel .sbn-panel-termometro.active", { timeout: 5000 });
await page.waitForTimeout(600);
await page.evaluate(() => ui.notifications.clear());
// Desde la fila del resumen (TERMÓMETRO 3/10 · NOCHE · PISTAS), como la castellana.
const contenido = await page.locator("#sbn-panel .window-content").boundingBox();
const resumen = await page.locator("#sbn-panel .sbn-res-item").first().boundingBox();
await guardar("panel-termometro", png => page.screenshot({ path: png, clip: { x: contenido.x, y: resumen.y - 8, width: 780, height: 268 } }));

// 5. Tiradas clave en el Consejo: márgenes con la fila 3–4 marcada (5 contra 2) y la votación.
await page.click('#sbn-panel nav [data-tab="tiradas"]');
await page.waitForTimeout(500);
for (const [lado, n] of [["coterie", "5"], ["halloway", "2"]]) {
  await page.fill(`#sbn-panel [data-sbn-cambio=exitos][data-lado=${lado}]`, n);
  await page.locator(`#sbn-panel [data-sbn-cambio=exitos][data-lado=${lado}]`).dispatchEvent("change");
  await page.waitForTimeout(400);
}
const voto = page.locator('#sbn-panel select[data-sbn-cambio=voto][data-pnj="PNJ-15"]');
if (await voto.count()) { await voto.selectOption("no"); await page.waitForTimeout(500); }
const margenes = page.locator("#sbn-panel .sbn-tc-margenes").locator("xpath=preceding-sibling::h4[1]");
await margenes.evaluate(h => h.scrollIntoView({ block: "start" }));
await page.waitForTimeout(400);
await page.evaluate(() => ui.notifications.clear());
const cab = await margenes.boundingBox();
const panel = await page.locator("#sbn-panel .window-content").boundingBox();
await guardar("panel-tiradas", png => page.screenshot({ path: png, clip: { x: panel.x + 10, y: cab.y - 4, width: 760, height: 275 } }));
await page.evaluate(() => foundry.applications.instances.get("sbn-panel")?.close());

/**
 * Abre un journal del módulo en una página. Las castellanas son el CONTENIDO de la
 * ventana (sin la barra de título): la ventana se dimensiona para que el contenido
 * mida `ancho` × `alto` + `arriba` (lo que se recorta por arriba) y se devuelve el recorte.
 */
async function journal(id, pagina, ancho, alto, arriba = 0) {
  await despejar();
  await page.evaluate(async ([MOD, id, pagina, ancho, alto]) => {
    const j = game.journal.find(x => x.getFlag(MOD, "id") === id);
    const p = typeof pagina === "number" ? j.pages.contents.sort((a, b) => a.sort - b.sort)[pagina] : j.pages.find(x => x.getFlag(MOD, "id") === pagina);
    await j.sheet.render({ force: true, pageId: p.id, position: { left: 300, top: 40, width: ancho, height: alto } });
    const cabecera = j.sheet.element.querySelector(".window-header")?.offsetHeight ?? 0;
    j.sheet.setPosition({ height: alto + cabecera });
  }, [MOD, id, pagina, ancho, alto + arriba]);
  await page.waitForTimeout(1200);
  const c = await page.locator(".application.journal-entry .window-content").last().boundingBox();
  return { x: c.x, y: c.y + arriba, width: ancho, height: alto };
}

// 6. Ajuste a la Parte 1, página 3 (erratas): botones del Termómetro, pistas y enlaces; con el motivo a la vista.
const aj = await journal("AVE-01-AJUSTE", 3, 960, 770);
const boton = page.locator(".application.journal-entry .journal-entry-page button.sbn-termometro").first();
if (await boton.count()) { await boton.hover(); await page.waitForTimeout(900); }
await guardar("journal", png => page.screenshot({ path: png, clip: aj }));

// 7. FIRSTLIGHT jugable, INT-00: ventajas y fisuras para la redada.
// Como la castellana: sin la barra de búsqueda de arriba (un recorte de 70 px).
const fl = await journal("FIRSTLIGHT-JUGABLE", "INT-00", 960, 730, 70);
await page.mouse.move(10, 990);
await page.waitForTimeout(400);
await guardar("interludio", png => page.screenshot({ path: png, clip: fl }));

// Dejar el mundo como estaba: la crónica en castellano, el estado al inicio y el cliente en castellano.
await despejar();
await page.evaluate(async MOD => {
  const api = game.modules.get(MOD).api;
  await game.settings.set(MOD, "termometro", { valor: 2, congelado: false, registro: [] });
  await ChatMessage.implementation.deleteDocuments([], { deleteAll: true });
  if (api.idioma() !== "es") await api.importarCronica({ idioma: "es", silencioso: true });
}, MOD);
await idiomaCliente("es");
await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });

for (const h of hechas) console.log(`✓ ${h}`);
const propios = errores.filter(e => !/^Actor id \[\w+\] does not exist|^You must provide an _id/.test(e));
if (propios.length) { console.error(`✗ errores de página:\n  ${propios.join("\n  ")}`); process.exit(1); }

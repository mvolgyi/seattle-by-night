/**
 * Prueba end-to-end del módulo contra un Foundry local.
 *
 * Requisitos: wod5e instalado, un mundo con id `sbn-test`, el módulo enlazado
 * en Data/modules, y el servidor corriendo con el mundo abierto:
 *
 *   cd ~/FoundryVTT/app/resources/app && node main.js --port=30099 --noupnp --world=sbn-test
 *
 * Después: npm run e2e   (usa playwright-core y el Chromium de ~/.cache/ms-playwright)
 *
 * Qué prueba (crece con cada fase): que el módulo cargue activo, exponga su API
 * y no deje errores de consola.
 */
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const URL = process.env.SBN_FOUNDRY_URL ?? "http://localhost:30099";
const MOD = "seattle-by-night";
const CAPTURAS = path.resolve(import.meta.dirname, "capturas");
fs.mkdirSync(CAPTURAS, { recursive: true });

/** El Chromium que Playwright deja en ~/.cache/ms-playwright, el más nuevo. */
function buscarChrome() {
  const base = path.join(os.homedir(), ".cache/ms-playwright");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort() : [];
  for (const d of dirs.reverse()) {
    for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const p = path.join(base, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error("No encontré Chromium de Playwright; definí SBN_CHROME o corré `npx playwright install chromium`.");
}

const browser = await chromium.launch({
  executablePath: process.env.SBN_CHROME ?? buscarChrome(),
  headless: true,
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"]
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errores = [];
page.on("console", msg => {
  const t = msg.text();
  if (msg.type() === "error" || /seattle-by-night \|/i.test(t)) console.log(`[${msg.type()}] ${t.slice(0, 400)}`);
  if (msg.type() === "error") { const l = msg.location(); errores.push(`${t} @ ${l.url?.split("/").slice(-2).join("/")}:${l.lineNumber}`); }
});
page.on("pageerror", err => { console.log(`[pageerror] ${err.message}`); errores.push(err.message); });

async function listo() {
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120000 });
}

async function entrar() {
  await page.goto(`${URL}/join`, { waitUntil: "networkidle" });
  await page.waitForSelector("select[name=userid]", { timeout: 60000 });
  const valor = await page.$eval("select[name=userid] option:not([value=''])", o => o.value);
  await page.selectOption("select[name=userid]", valor);
  await page.click("button[name=join]");
  await listo();
  console.log("· sesión iniciada como", await page.evaluate(() => game.user.name));
}

await entrar();

// Activar el módulo si hace falta (un mundo nuevo lo tiene apagado).
if (await page.evaluate(id => game.modules.get(id)?.active ?? null, MOD) === false) {
  await page.evaluate(async id => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
    cfg[id] = true;
    await game.settings.set("core", "moduleConfiguration", cfg);
  }, MOD);
  await page.waitForTimeout(1500);
  errores.length = 0;
  await page.reload({ waitUntil: "networkidle" });
  await listo();
  console.log("· módulo activado y mundo recargado");
}

const r = await page.evaluate(MOD => {
  const m = game.modules.get(MOD);
  return {
    foundry: game.version,
    sistema: `${game.system.id} ${game.system.version}`,
    activo: m?.active ?? null,
    version: m?.version,
    api: Object.keys(m?.api ?? {})
  };
}, MOD);
console.log(JSON.stringify(r, null, 2));
await page.screenshot({ path: path.join(CAPTURAS, "inicio.png") });

const fallos = [];
if (!r.activo) fallos.push("el módulo no está activo");
if (!r.api.includes("SBN")) fallos.push("la API no expone SBN");
if (errores.length) fallos.push(`${errores.length} error(es) de consola`);

for (const e of errores.slice(0, 15)) console.log("  -", e.slice(0, 300));
await browser.close();

if (fallos.length) {
  console.error(`\n✗ ${fallos.join("; ")}`);
  process.exit(1);
}
console.log("\n✓ el módulo carga limpio");

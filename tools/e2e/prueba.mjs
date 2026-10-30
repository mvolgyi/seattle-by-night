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
 * Qué prueba:
 *   1. que el módulo cargue activo, con su API (CONTRATO.md) y sus textos;
 *   2. la API de estado: Termómetro (números, =N, congelar, topes, umbrales),
 *      pistas, noche, el hook sbnEstado y los susurros al Narrador;
 *   3. el indicador del Narrador (+/− y plegado);
 *   4. si los packs están compilados: importar la Aventura (por el diálogo
 *      de bienvenida o por la API), que haya journals/actores/escenas, un
 *      botón de Termómetro y uno de pista apretados desde un journal real,
 *      y la escena de Helen (LUG-05) abierta.
 * Si los packs todavía no existen, lo dice y prueba sólo la API.
 * Capturas en tools/e2e/capturas/.
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

const fallos = [];
const comprobar = (ok, texto) => {
  console.log(`  ${ok ? "✓" : "✗"} ${texto}`);
  if (!ok) fallos.push(texto);
};
const captura = async nombre => {
  await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`) });
  console.log(`  · captura ${nombre}.png`);
};

async function listo() {
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120000 });
}

async function entrar() {
  await page.goto(`${URL}/join`, { waitUntil: "networkidle" });
  await page.waitForSelector("select[name=userid]", { timeout: 60000 });
  // El primer usuario: en sbn-test es el Gamemaster.
  const valor = await page.$eval("select[name=userid] option:not([value=''])", o => o.value);
  await page.selectOption("select[name=userid]", valor);
  await page.click("button[name=join]");
  await listo();
  console.log("· sesión iniciada como", await page.evaluate(() => `${game.user.name} (GM: ${game.user.isGM})`));
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
await page.waitForFunction(id => !!game.modules.get(id)?.api, MOD, { timeout: 30000 });

/* -------------------------------------------- */
/*  1. Carga                                    */
/* -------------------------------------------- */

const r = await page.evaluate(async MOD => {
  const m = game.modules.get(MOD);
  const packs = {};
  for (const p of game.packs.filter(p => p.metadata.packageName === MOD)) {
    try { packs[p.metadata.name] = (await p.getIndex()).size; } catch { packs[p.metadata.name] = null; }
  }
  return {
    foundry: game.version,
    sistema: `${game.system.id} ${game.system.version}`,
    idioma: game.i18n.lang,
    activo: m?.active ?? null,
    version: m?.version,
    gm: game.user.isGM,
    api: Object.keys(m?.api ?? {}),
    textos: game.i18n.has("SBN.termometro.umbrales.9.texto"),
    packs
  };
}, MOD);
console.log(JSON.stringify(r, null, 2));
console.log("\n1. Carga");
comprobar(r.activo, "el módulo está activo");
comprobar(r.gm, "la sesión es de un GM");
comprobar(["termometro", "pista", "noche", "estado", "importarCronica"].every(k => r.api.includes(k)), "la API expone termometro, pista, noche, estado e importarCronica");
comprobar(r.textos, `lang/es.json cargado (idioma ${r.idioma})`);

const hayPacks = (r.packs.aventura ?? 0) > 0;
if (!hayPacks) {
  console.log(`\n⚠ Los packs no están compilados (aventura: ${r.packs.aventura ?? "sin índice"}). Se prueba sólo la API.`);
}

// El diálogo de bienvenida aparece solo si el mundo no tiene la crónica.
let importadoPorDialogo = false;
if (hayPacks) {
  const dialogo = await page.waitForSelector(".sbn-dialogo button[data-action=yes]", { timeout: 6000 }).catch(() => null);
  if (dialogo) {
    console.log("· apareció el diálogo de importación: «Importar»");
    await captura("dialogo-importar");
    await dialogo.click();
    await page.waitForFunction(id => game.journal.some(j => j.getFlag(id, "origen")), MOD, { timeout: 120000 });
    importadoPorDialogo = true;
  }
}

/* -------------------------------------------- */
/*  2. API de estado                            */
/* -------------------------------------------- */

console.log("\n2. API de estado");
const a = await page.evaluate(async MOD => {
  const api = game.modules.get(MOD).api;
  const espera = ms => new Promise(r => setTimeout(r, ms));
  // Estado limpio.
  await game.settings.set(MOD, "termometro", { valor: 2, congelado: false, registro: [] });
  await game.settings.set(MOD, "pistas", {});
  await game.settings.set(MOD, "noche", 1);
  await espera(200);

  const hooks = [];
  const h = Hooks.on("sbnEstado", (estado, detalle) => hooks.push({ clave: detalle?.clave, cambio: detalle?.cambio, valor: estado.termometro.valor }));
  const mensajesAntes = game.messages.size;
  const out = {};

  out.mas1 = (await api.termometro(+1, "e2e: prueba"))?.valor;           // 2 → 3, umbral 3
  out.mas1str = (await api.termometro("+1", "e2e: string"))?.valor;      // 3 → 4
  await api.termometro("congelar", "e2e");
  out.congelado = api.estado().termometro.congelado;
  out.trasCongelar = await api.termometro(+3, "e2e: no debería");        // null
  out.valorCongelado = api.estado().termometro.valor;                    // 4
  await api.termometro("descongelar", "e2e");
  out.igual10 = (await api.termometro("=10", "e2e: purga"))?.valor;     // 4 → 10, umbrales 5 7 9 10
  out.tope = (await api.termometro(+1, "e2e: tope"))?.valor;             // 10
  out.piso = (await api.termometro(-15, "e2e: piso"))?.valor;            // 0
  out.invalido = await api.termometro("hola");                           // null
  await api.termometro("=2", "e2e: vuelta al inicio");

  await api.pista("P-07");
  out.pistaSi = api.estado().pistas["P-07"] === true;
  await api.pista("P-07", false);
  out.pistaNo = !("P-07" in api.estado().pistas);
  await api.pista("P-11");
  out.pistaInvalida = await api.pista("P-99");

  await api.noche(4);
  out.noche = api.estado().noche;
  out.nocheInvalida = await api.noche(9);

  await espera(500);
  Hooks.off("sbnEstado", h);
  const est = api.estado();
  out.registro = est.termometro.registro.map(e => `${e.cambio}:${e.valorAntes}→${e.valorDespues}`);
  out.camposRegistro = Object.keys(est.termometro.registro[0] ?? {});
  out.hooks = hooks.length;
  const nuevos = game.messages.contents.slice(mensajesAntes).filter(m => m.getFlag(MOD, "origen") === "estado");
  out.mensajes = nuevos.length;
  out.todosSusurrados = nuevos.every(m => m.whisper.length && m.whisper.every(id => game.users.get(id)?.isGM));
  out.umbrales = nuevos.filter(m => m.content.includes("sbn-chat-umbral") && !m.content.includes("sbn-chat-baja")).map(m => m.content.match(/<h4>(.*?)<\/h4>/)?.[1]);
  return out;
}, MOD);
console.log(JSON.stringify(a, null, 2));
comprobar(a.mas1 === 3 && a.mas1str === 4, "termometro(+1) y termometro(\"+1\") suben");
comprobar(a.congelado && a.trasCongelar === null && a.valorCongelado === 4, "congelado no se mueve");
comprobar(a.igual10 === 10 && a.tope === 10 && a.piso === 0, "\"=10\", tope 10 y piso 0");
comprobar(a.invalido === null, "un cambio inválido se rechaza");
comprobar(a.camposRegistro.join() === "fecha,cambio,motivo,usuario,valorAntes,valorDespues", "el registro tiene { fecha, cambio, motivo, usuario, valorAntes, valorDespues }");
comprobar(a.umbrales.length === 5, `al subir se avisa cada umbral cruzado (${a.umbrales.length}: 3, 5, 7, 9, 10)`);
comprobar(a.pistaSi && a.pistaNo && a.pistaInvalida === null, "pista(id) marca y pista(id, false) desmarca");
comprobar(a.noche === 4 && a.nocheInvalida === null, "noche(4) fija; noche(9) se rechaza");
comprobar(a.hooks >= 10, `el hook sbnEstado se dispara (${a.hooks} veces)`);
comprobar(a.mensajes >= 10 && a.todosSusurrados, `los cambios se susurran sólo a los GM (${a.mensajes} mensajes)`);

/* -------------------------------------------- */
/*  3. Indicador del Narrador                   */
/* -------------------------------------------- */

console.log("\n3. Indicador");
await page.evaluate(MOD => game.settings.set(MOD, "indicador-plegado", false), MOD);
await page.evaluate(MOD => game.modules.get(MOD).api.Indicador.refrescar(), MOD);
await page.waitForSelector("#sbn-indicador .sbn-ind-termometro", { timeout: 5000 }).catch(() => null);
const enIndicador = await page.locator("#sbn-indicador .sbn-ind-termometro .sbn-ind-numero").textContent().catch(() => null);
comprobar(enIndicador?.trim() === "2", `el indicador muestra el Termómetro (${enIndicador})`);
await page.click("#sbn-indicador .sbn-ind-termometro [data-delta='+1']");
await page.waitForFunction(MOD => game.modules.get(MOD).api.estado().termometro.valor === 3, MOD, { timeout: 5000 }).catch(() => null);
await page.waitForTimeout(400);
const trasMas = await page.locator("#sbn-indicador .sbn-ind-termometro .sbn-ind-numero").textContent().catch(() => null);
comprobar(trasMas?.trim() === "3", `el + del indicador sube el Termómetro y se refresca (${trasMas})`);
await page.click("#sbn-indicador .sbn-ind-noche [data-delta='+1']");
await page.waitForFunction(MOD => game.modules.get(MOD).api.estado().noche === 5, MOD, { timeout: 5000 }).catch(() => null);
comprobar(await page.evaluate(MOD => game.modules.get(MOD).api.estado().noche, MOD) === 5, "el + de la noche avanza el Reloj");
await page.hover("#sbn-indicador .sbn-ind-termometro .sbn-ind-valor");
await page.waitForTimeout(900);
await captura("indicador");
await page.click("#sbn-indicador .sbn-ind-plegar");
await page.waitForSelector("#sbn-indicador .sbn-ind-plegado", { timeout: 3000 }).catch(() => null);
comprobar(await page.locator("#sbn-indicador .sbn-ind-plegado").count() === 1, "el indicador se pliega");
await page.mouse.move(800, 400);
await captura("indicador-plegado");
await page.click("#sbn-indicador .sbn-ind-plegar");

/* -------------------------------------------- */
/*  4. Importación y journals reales            */
/* -------------------------------------------- */

if (hayPacks) {
  console.log("\n4. Importación");
  if (!importadoPorDialogo) {
    console.log("· importando por la API (el mundo ya tenía la crónica o no hubo diálogo)");
    await page.evaluate(MOD => game.modules.get(MOD).api.importarCronica({ silencioso: true }), MOD);
  }
  const imp = await page.evaluate(MOD => {
    const gen = d => !!d.getFlag(MOD, "origen");
    return {
      journals: game.journal.filter(gen).length,
      actores: game.actors.filter(gen).length,
      escenas: game.scenes.filter(gen).length,
      macros: game.macros.filter(gen).length,
      activa: game.scenes.active?.name ?? null,
      landing: game.scenes.find(s => s.getFlag(MOD, "landing"))?.name ?? null,
      version: game.settings.get("core", "adventureImports")?.[Object.keys(game.settings.get("core", "adventureImports") ?? {}).find(k => k.includes(MOD)) ?? ""]?.moduleVersion ?? null
    };
  }, MOD);
  console.log(JSON.stringify(imp, null, 2));
  comprobar(imp.journals > 0, `hay journals importados (${imp.journals})`);
  comprobar(imp.actores > 0, `hay actores importados (${imp.actores})`);
  comprobar(imp.escenas > 0, `hay escenas importadas (${imp.escenas})`);
  if (imp.landing) comprobar(imp.activa === imp.landing || !importadoPorDialogo, `la escena «landing» quedó activa (${imp.activa})`);
  else console.log("  · (ninguna escena con flag landing)");

  // Journal real con botones de Termómetro y de pista.
  const buscar = async marcador => page.evaluate(([MOD, marcador]) => {
    for (const j of game.journal) {
      for (const p of j.pages) {
        if (p.type === "text" && p.text?.content?.includes(marcador)) {
          return { journal: j.id, pagina: p.id, nombre: `${j.name} › ${p.name}`, uuid: p.uuid };
        }
      }
    }
    return null;
  }, [MOD, marcador]);

  const abrir = async ({ journal, pagina }) => {
    await page.evaluate(async ([jid, pid]) => {
      ui.notifications.clear();
      for (const app of foundry.applications.instances.values()) if (app.document?.documentName === "JournalEntry") await app.close();
      await game.journal.get(jid).sheet.render({ force: true, pageId: pid });
    }, [journal, pagina]);
    await page.waitForTimeout(1500);
  };

  const conTermometro = await buscar("data-sbn-termometro");
  if (conTermometro) {
    console.log(`· Termómetro desde «${conTermometro.nombre}»`);
    await abrir(conTermometro);
    const boton = page.locator(".journal-entry-page [data-sbn-termometro]").first();
    const datos = await boton.evaluate(b => ({ cambio: b.dataset.sbnTermometro, motivo: b.dataset.motivo, texto: b.textContent.trim() })).catch(() => null);
    const antes = await page.evaluate(MOD => game.modules.get(MOD).api.estado().termometro, MOD);
    if (datos) {
      // Si el botón no movería nada (congelado, =N igual), se parte de un valor distinto.
      if (/^=/.test(datos.cambio) && Number(datos.cambio.slice(1)) === antes.valor) await page.evaluate(MOD => game.modules.get(MOD).api.termometro("=2", "e2e"), MOD);
      const registroAntes = await page.evaluate(MOD => game.modules.get(MOD).api.estado().termometro.registro.length, MOD);
      await boton.scrollIntoViewIfNeeded();
      await boton.click();
      await page.waitForTimeout(1200);
      const despues = await page.evaluate(MOD => game.modules.get(MOD).api.estado().termometro, MOD);
      const ultimo = despues.registro.at(-1);
      console.log(`  botón ${JSON.stringify(datos)} → ${JSON.stringify(ultimo)}`);
      comprobar(despues.registro.length === registroAntes + 1 && ultimo?.motivo === (datos.motivo ?? ""), "el botón de Termómetro del journal mueve el Termómetro con su motivo");
      await captura("journal-termometro");
    } else comprobar(false, "el botón de Termómetro se ve en el journal abierto");
  } else console.log("  · (ningún journal tiene botones de Termómetro todavía)");

  const conPista = await buscar("data-sbn-pista");
  if (conPista) {
    console.log(`· Pista desde «${conPista.nombre}»`);
    await abrir(conPista);
    const boton = page.locator(".journal-entry-page [data-sbn-pista]").first();
    const id = await boton.getAttribute("data-sbn-pista").catch(() => null);
    if (id) {
      await page.evaluate(([MOD, id]) => game.modules.get(MOD).api.pista(id, false), [MOD, id]);
      await boton.scrollIntoViewIfNeeded();
      await boton.click();
      await page.waitForFunction(([MOD, id]) => game.modules.get(MOD).api.estado().pistas[id] === true, [MOD, id], { timeout: 5000 }).catch(() => null);
      await page.waitForTimeout(500);
      const obtenida = await page.evaluate(([MOD, id]) => game.modules.get(MOD).api.estado().pistas[id] === true, [MOD, id]);
      const clase = await boton.evaluate(b => b.classList.contains("sbn-obtenida"));
      comprobar(obtenida && clase, `el botón de pista ${id} la marca y cambia a «obtenida»`);
      await captura("journal-pista");
      // Reabrir: el aspecto se recupera al renderizar.
      await abrir(conPista);
      const claseReabierto = await page.locator(`.journal-entry-page [data-sbn-pista="${id}"]`).first().evaluate(b => b.classList.contains("sbn-obtenida")).catch(() => false);
      comprobar(claseReabierto, "al volver a renderizar el journal la pista sigue «obtenida»");
    } else comprobar(false, "el botón de pista se ve en el journal abierto");
  } else console.log("  · (ningún journal tiene botones de pista todavía)");

  const conReloj = await buscar("data-sbn-reloj");
  if (conReloj) {
    await abrir(conReloj);
    const reloj = page.locator(".journal-entry-page [data-sbn-reloj]").first();
    await reloj.scrollIntoViewIfNeeded();
    await reloj.hover();
    await page.waitForTimeout(900);
    const tip = await page.locator("#tooltip").textContent().catch(() => "");
    comprobar(/Noche \d/.test(tip ?? ""), `el reloj muestra la fecha al pasar («${tip?.trim()}»)`);
    await captura("journal-reloj");
  }
  await page.evaluate(() => { for (const app of foundry.applications.instances.values()) if (app.document?.documentName === "JournalEntry") app.close(); });

  // La escena de Helen (LUG-05).
  const helen = await page.evaluate(MOD => {
    const s = game.scenes.find(s => s.getFlag(MOD, "id") === "LUG-05" || s.getFlag(MOD, "lugar") === "LUG-05")
      ?? game.scenes.find(s => /helen/i.test(s.name));
    return s ? { id: s.id, nombre: s.name } : null;
  }, MOD);
  if (helen) {
    console.log(`· escena de Helen: «${helen.nombre}»`);
    await page.evaluate(() => ui.notifications.clear());
    await page.evaluate(id => game.scenes.get(id).view(), helen.id);
    await page.waitForFunction(id => canvas.ready && canvas.scene?.id === id, helen.id, { timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(2500);
    comprobar(await page.evaluate(id => canvas.scene?.id === id, helen.id), "la escena de Helen se abre");
    await captura("escena-helen");
  } else comprobar(false, "hay una escena de Helen (LUG-05)");
}

/* -------------------------------------------- */
/*  Cierre                                      */
/* -------------------------------------------- */

// Dejar el estado de la crónica como al empezar.
await page.evaluate(async MOD => {
  await game.settings.set(MOD, "termometro", { valor: 2, congelado: false, registro: [] });
  await game.settings.set(MOD, "pistas", {});
  await game.settings.set(MOD, "noche", 1);
}, MOD);
await captura("inicio");

await page.waitForTimeout(500);
// Los tres rechazos de la API avisan con ui.notifications.error, que también va a la consola: son esperados.
for (const esperado of ["«hola»", "«P-99»", "«9»"]) {
  const i = errores.findIndex(e => e.includes(esperado));
  if (i >= 0) errores.splice(i, 1);
}
// Ruido conocido de wod5e al importar: su prepareDerivedData hace this.update() de salud y
// Voluntad en cada actor recién construido, antes de que esté en game.actors
// (systems/wod5e/system/actor/actor.js, «Prepare derived health and willpower values»).
const ruidoWod5e = errores.filter(e => /^Actor id \[\w+\] does not exist in the Actors collection/.test(e));
if (ruidoWod5e.length) {
  console.log(`  · ${ruidoWod5e.length} error(es) «Actor id [...] does not exist» de wod5e durante la importación (no son del módulo)`);
  for (const e of ruidoWod5e) errores.splice(errores.indexOf(e), 1);
}
comprobar(errores.length === 0, `sin errores de consola (${errores.length})`);
for (const e of errores.slice(0, 15)) console.log("  -", e.slice(0, 300));
await browser.close();

if (fallos.length) {
  console.error(`\n✗ ${fallos.length} fallo(s):\n  - ${fallos.join("\n  - ")}`);
  process.exit(1);
}
console.log(`\n✓ todo en orden${hayPacks ? "" : " (sólo API: faltan los packs compilados)"}`);

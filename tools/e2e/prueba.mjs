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
 *      y la escena de Helen (LUG-05) abierta;
 *   5. el Panel del Narrador: se abre desde la API, el indicador y la barra
 *      de controles; un movimiento rápido del Termómetro, fijar la noche,
 *      marcar pistas y pruebas, que la reserva de A3-E04 (y A4-E01) cambie
 *      con ellas, y tirar A3-E04 con WOD5E (sin mirar el resultado);
 *   6. reimportar como actualización conserva lo del mundo (ownership y
 *      system de un PJ con dueño jugador, ownership de un PNJ, un handout
 *      revelado, la escena activa); el panel no pierde los <details>
 *      abiertos ni se repinta con un actor ajeno; el voto al azar de Fry se
 *      susurra; y un JUGADOR (se crea «Jugador e2e») carga data/publico.json
 *      y nunca pide data/cronica.json, y ve como texto los enlaces que no
 *      puede abrir.
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
    textos: game.i18n.has("SBN.panel.titulo"),
    datos: !!m?.api?.Datos?.listos,
    umbrales: m?.api?.Datos?.umbrales?.map(u => u.valor) ?? [],
    noches: m?.api?.Datos?.noches?.length ?? 0,
    pistasDatos: m?.api?.Datos?.pistas?.length ?? 0,
    packs
  };
}, MOD);
console.log(JSON.stringify(r, null, 2));
console.log("\n1. Carga");
comprobar(r.activo, "el módulo está activo");
comprobar(r.gm, "la sesión es de un GM");
comprobar(["termometro", "pista", "noche", "estado", "importarCronica"].every(k => r.api.includes(k)), "la API expone termometro, pista, noche, estado e importarCronica");
comprobar(r.textos, `lang/es.json cargado (idioma ${r.idioma})`);
comprobar(r.datos && r.umbrales.join() === "3,5,7,9,10" && r.noches === 8 && r.pistasDatos === 15,
  `data/cronica.json cargado (umbrales ${r.umbrales.join(",")}, ${r.noches} noches, ${r.pistasDatos} pistas)`);
comprobar(r.api.includes("abrirPanel") && r.api.includes("prueba"), "la API expone abrirPanel y prueba");

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
  // ¿Es la primera importación de este mundo? (entonces la portada tiene que quedar activa)
  const primeraImportacion = importadoPorDialogo || await page.evaluate(MOD => !game.journal.some(j => j.getFlag(MOD, "origen")), MOD);
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
  if (imp.landing) {
    if (primeraImportacion) comprobar(imp.activa === imp.landing, `primera importación: la escena «landing» quedó activa (${imp.activa})`);
    else console.log(`  · (no es la primera importación: la escena activa no se toca: ${imp.activa})`);
  }
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
/*  5. Panel del Narrador                       */
/* -------------------------------------------- */

console.log("\n5. Panel del Narrador");
await page.evaluate(async MOD => {
  ui.notifications.clear();
  await game.settings.set(MOD, "termometro", { valor: 2, congelado: false, registro: [] });
  await game.settings.set(MOD, "pistas", {});
  await game.settings.set(MOD, "pruebas", {});
  await game.settings.set(MOD, "votos", {});
  await game.settings.set(MOD, "noche", 1);
  for (const app of foundry.applications.instances.values()) if (app.document?.documentName === "JournalEntry") await app.close();
}, MOD);

// Desde la barra de controles de escena: la herramienta existe para el GM.
const control = await page.evaluate(() => {
  const t = ui.controls?.controls?.tokens?.tools?.sbnPanel;
  return t ? { visible: t.visible, button: t.button } : null;
});
comprobar(control?.visible === true && control?.button === true, "hay un botón del panel en los controles de escena (tokens)");
const botonControl = page.locator('#scene-controls button[data-tool="sbnPanel"]');
if (await botonControl.count()) {
  await botonControl.first().click();
  await page.waitForSelector("#sbn-panel", { timeout: 5000 }).catch(() => null);
  comprobar(await page.locator("#sbn-panel").count() === 1, "el botón de los controles abre el panel");
  await page.evaluate(() => foundry.applications.instances.get("sbn-panel")?.close());
  await page.waitForTimeout(400);
} else console.log("  · (el botón de controles no se ve: no hay escena activa)");

// Desde el indicador.
await page.click("#sbn-indicador .sbn-ind-panel");
await page.waitForSelector("#sbn-panel .sbn-panel-termometro", { timeout: 5000 }).catch(() => null);
comprobar(await page.locator("#sbn-panel").count() === 1, "el botón del indicador abre el panel");
await page.evaluate(() => foundry.applications.instances.get("sbn-panel")?.close());
await page.waitForTimeout(400);

// Desde la API (lo que usa la macro).
await page.evaluate(MOD => game.modules.get(MOD).api.abrirPanel({ tab: "termometro" }), MOD);
await page.waitForSelector("#sbn-panel .sbn-panel-termometro.active", { timeout: 5000 }).catch(() => null);
const pt = await page.evaluate(() => ({
  numero: document.querySelector("#sbn-panel .sbn-tm-numero")?.textContent.trim(),
  umbrales: document.querySelectorAll("#sbn-panel .sbn-tm-umbrales tbody tr").length,
  grupos: [...document.querySelectorAll("#sbn-panel .sbn-tm-grupo[data-grupo]")].map(d => d.dataset.grupo),
  movimientos: document.querySelectorAll("#sbn-panel [data-action=movimiento]").length
}));
console.log("  ", JSON.stringify(pt));
comprobar(pt.numero === "2" && pt.umbrales === 5, `la pestaña Termómetro muestra el valor y los 5 umbrales (${pt.numero}, ${pt.umbrales})`);
comprobar(pt.grupos.includes("noche") && pt.movimientos > 0, `hay movimientos rápidos, con los de la noche actual (${pt.movimientos})`);

// Un movimiento rápido de la noche 1: queda en el historial con su id y la noche.
const mov = page.locator('#sbn-panel .sbn-tm-grupo[data-grupo="noche"] [data-action=movimiento]:not([disabled])').first();
const datosMov = await mov.evaluate(b => ({ ...b.dataset })).catch(() => null);
if (datosMov) {
  await mov.click();
  await page.waitForFunction(MOD => game.modules.get(MOD).api.estado().termometro.registro.length === 1, MOD, { timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(400);
  const ult = await page.evaluate(MOD => game.modules.get(MOD).api.estado().termometro.registro.at(-1), MOD);
  comprobar(ult?.movimiento === datosMov.movimiento && ult?.motivo === datosMov.motivo && ult?.noche === 1,
    `el botón rápido «${datosMov.cambio} ${datosMov.motivo?.slice(0, 40)}…» mueve el Termómetro y queda en el historial`);
  const filas = await page.locator("#sbn-panel .sbn-tm-historial tbody tr").count();
  comprobar(filas === 1, `el historial del panel se refresca (${filas} fila)`);
} else comprobar(false, "hay un movimiento rápido habilitado para la noche 1");

// ± y fijar desde el panel, con el motivo escrito.
await page.fill("#sbn-panel [name=sbn-motivo]", "e2e: motivo del panel");
await page.click('#sbn-panel .sbn-tm-controles [data-action=termometro][data-delta="1"]');
await page.waitForTimeout(500);
await page.fill("#sbn-panel [name=sbn-fijar]", "6");
await page.click("#sbn-panel [data-action=fijar]");
await page.waitForFunction(MOD => game.modules.get(MOD).api.estado().termometro.valor === 6, MOD, { timeout: 5000 }).catch(() => null);
const tmPanel = await page.evaluate(MOD => game.modules.get(MOD).api.estado().termometro, MOD);
comprobar(tmPanel.valor === 6 && tmPanel.registro.at(-1)?.motivo === "e2e: motivo del panel" && tmPanel.registro.at(-1)?.usuario,
  `+1 y «fijar 6» del panel, con motivo y usuario (${tmPanel.registro.map(r => r.cambio).join(" ")})`);
await page.evaluate(() => ui.notifications.clear());
await page.mouse.move(5, 500);
await page.waitForTimeout(600);
await captura("panel-termometro");

// Reloj: pasar a la noche 7 desde su fila.
await page.click('#sbn-panel nav [data-tab="reloj"]');
await page.waitForSelector("#sbn-panel .sbn-panel-reloj.active", { timeout: 3000 }).catch(() => null);
const nochesPanel = await page.locator("#sbn-panel .sbn-noche").count();
comprobar(nochesPanel === 8, `el Reloj muestra las 8 noches (${nochesPanel})`);
await page.click('#sbn-panel .sbn-noche[data-n="7"] [data-action=noche]');
await page.waitForFunction(MOD => game.modules.get(MOD).api.estado().noche === 7, MOD, { timeout: 5000 }).catch(() => null);
await page.waitForTimeout(400);
const actualPanel = await page.evaluate(() => document.querySelector("#sbn-panel .sbn-noche.sbn-actual")?.dataset.n);
comprobar(actualPanel === "7", `«Pasar a esta noche» fija la 7 y el panel la marca (${actualPanel})`);
await captura("panel-reloj");

// Tiradas: la reserva antes de marcar nada.
const reserva = async id => Number(await page.locator(`#sbn-panel [data-sbn-reserva="${id}"]`).textContent().catch(() => "NaN"));
await page.click('#sbn-panel nav [data-tab="tiradas"]');
await page.waitForSelector("#sbn-panel .sbn-panel-tiradas.active", { timeout: 3000 }).catch(() => null);
const actorTirada = await page.evaluate(() => {
  const s = document.querySelector('#sbn-panel select[data-tirada="A3-E04"]');
  return s ? { id: s.value, nombre: s.selectedOptions[0]?.textContent, opciones: s.options.length } : null;
});
console.log("   actor de A3-E04:", JSON.stringify(actorTirada));
const a3Antes = await reserva("A3-E04");
const a4Antes = await reserva("A4-E01");
const hallowayAntes = await reserva("halloway");

// Pistas: marcar P-07, P-08 y P-12 desde la pestaña.
await page.click('#sbn-panel nav [data-tab="pistas"]');
await page.waitForSelector("#sbn-panel .sbn-panel-pistas.active", { timeout: 3000 }).catch(() => null);
for (const id of ["P-07", "P-08", "P-12"]) {
  await page.click(`#sbn-panel .sbn-pistas-tabla [data-action=pista][data-id="${id}"]`);
  await page.waitForFunction(([MOD, id]) => game.modules.get(MOD).api.estado().pistas[id] === true, [MOD, id], { timeout: 5000 }).catch(() => null);
}
await page.waitForTimeout(400);
const marcadas = await page.evaluate(MOD => Object.keys(game.modules.get(MOD).api.estado().pistas).sort().join(), MOD);
const filasOn = await page.locator("#sbn-panel .sbn-pistas-tabla tr.sbn-obtenida").count();
comprobar(marcadas === "P-07,P-08,P-12" && filasOn === 3, `las casillas del panel marcan las pistas (${marcadas}; ${filasOn} filas)`);
// Una prueba sin ID desde la misma pestaña.
await page.click('#sbn-panel .sbn-pruebas-tabla [data-action=prueba][data-id="PRUEBA-KRELL-PRESENTE"]');
await page.waitForFunction(MOD => game.modules.get(MOD).api.estado().pruebas["PRUEBA-KRELL-PRESENTE"] === true, MOD, { timeout: 5000 }).catch(() => null);
await page.waitForTimeout(300);
await page.evaluate(() => { const t = document.querySelector("#sbn-panel .sbn-panel-pistas"); if (t) t.scrollTop = 0; });
await captura("panel-pistas");

// De vuelta a Tiradas: A3-E04 suma +1 por pista (3) y +2 por Krell presente.
await page.click('#sbn-panel nav [data-tab="tiradas"]');
await page.waitForTimeout(400);
const a3Despues = await reserva("A3-E04");
const a4Despues = await reserva("A4-E01");
comprobar(a3Despues === a3Antes + 5, `la reserva de A3-E04 cambia con las pistas y Krell presente (${a3Antes} → ${a3Despues}, +5)`);
comprobar(a4Despues === a4Antes + 5, `la reserva de A4-E01 suma P-07 +1, P-08 +1 y P-12 +3 (${a4Antes} → ${a4Despues})`);
// −2 por la mentira en A1-E03, desde la casilla de la tarjeta de A3-E04.
await page.click('#sbn-panel [data-tirada="A3-E04"] [data-action=prueba][data-id="PRUEBA-MENTIRA-A1-E03"]');
await page.waitForFunction(MOD => game.modules.get(MOD).api.estado().pruebas["PRUEBA-MENTIRA-A1-E03"] === true, MOD, { timeout: 5000 }).catch(() => null);
await page.waitForTimeout(400);
const a3Mentira = await reserva("A3-E04");
comprobar(a3Mentira === a3Despues - 2, `la mentira en A1-E03 resta 2 (${a3Despues} → ${a3Mentira})`);
// La Galería de Vidrio le quita 2 dados a Halloway (su id sale del motivo: se busca en los datos).
const idGaleria = await page.evaluate(MOD => game.modules.get(MOD).api.Datos.tirada("A4-E01")?.otros?.find(o => o.a === "Halloway")?.id, MOD);
comprobar(/^A4-E01-OTRO-[A-Z]/.test(idGaleria ?? ""), `la casilla de la Galería tiene id estable (${idGaleria})`);
await page.click(`#sbn-panel [data-tirada="A4-E01"] [data-action=prueba][data-id="${idGaleria}"]`);
await page.waitForTimeout(500);
const hallowayGaleria = await reserva("halloway");
comprobar(hallowayAntes === 10 && hallowayGaleria === 8, `Halloway tira 10 dados, 8 en la Galería de Vidrio (${hallowayAntes} → ${hallowayGaleria})`);
// Márgenes: 5 éxitos contra 2 → la fila «3–4».
await page.fill('#sbn-panel [data-sbn-cambio=exitos][data-lado=coterie]', "5");
await page.locator('#sbn-panel [data-sbn-cambio=exitos][data-lado=coterie]').dispatchEvent("change");
await page.waitForTimeout(300);
await page.fill('#sbn-panel [data-sbn-cambio=exitos][data-lado=halloway]', "2");
await page.locator('#sbn-panel [data-sbn-cambio=exitos][data-lado=halloway]').dispatchEvent("change");
await page.waitForTimeout(400);
const filaMargen = await page.locator("#sbn-panel .sbn-tc-margenes tr.sbn-actual th").textContent().catch(() => null);
comprobar(/3\s*[–-]\s*4/.test(filaMargen ?? ""), `el margen +3 marca la fila «${filaMargen?.trim()}»`);
// Votación: Voight (PNJ-15) a «no».
await page.selectOption('#sbn-panel select[data-sbn-cambio=voto][data-pnj="PNJ-15"]', "no");
await page.waitForFunction(MOD => game.modules.get(MOD).api.estado().votos["PNJ-15"] === "no", MOD, { timeout: 5000 }).catch(() => null);
const votos = await page.evaluate(MOD => game.modules.get(MOD).api.estado().votos, MOD);
comprobar(votos["PNJ-15"] === "no" && votos["PNJ-03"] === "si", `el voto se guarda (${JSON.stringify(votos)})`);
await page.waitForTimeout(300);
await captura("panel-tiradas-a4");
await page.evaluate(() => { const t = document.querySelector("#sbn-panel .sbn-panel-tiradas"); if (t) t.scrollTop = 0; });
await page.waitForTimeout(200);
await captura("panel-tiradas-a3");

// Tirar A3-E04 con el actor elegido: el diálogo de wod5e trae la reserva calculada.
if (actorTirada?.id) {
  const mensajesAntes = await page.evaluate(() => game.messages.size);
  await page.click('#sbn-panel [data-action=tirar][data-tirada="A3-E04"]');
  const dialogo = await page.waitForSelector(".roll-dialog", { timeout: 8000 }).catch(() => null);
  if (dialogo) {
    const enDialogo = await page.evaluate(() => {
      const d = document.querySelector(".roll-dialog");
      const n = sel => d.querySelector(sel)?.valueAsNumber ?? 0;
      return n("#inputBasicDice") + n("#inputAdvancedDice");
    });
    // Los modificadores situacionales del actor (selectors) podrían sumar: se compara sin ellos.
    comprobar(enDialogo === a3Mentira, `el diálogo de wod5e trae la reserva del panel (${enDialogo} = ${a3Mentira})`);
    await captura("panel-tirada-dialogo");
    await page.click('.roll-dialog button[data-action="roll"]');
  } else console.log("  · (sin diálogo de wod5e: quickRoll o el sistema tiró directo)");
  await page.waitForFunction(n => game.messages.size > n && game.messages.contents.at(-1).rolls?.length > 0, mensajesAntes, { timeout: 10000 }).catch(() => null);
  const msg = await page.evaluate(() => {
    const m = game.messages.contents.at(-1);
    // wod5e guarda título y descripción en las opciones de la tirada (system/scripts/system-rolls.js).
    const o = m?.rolls?.[0]?.options ?? {};
    return { rolls: m?.rolls?.length ?? 0, titulo: o.title ?? "", flavor: o.flavor ?? "", dificultad: o.difficulty, speaker: m?.speaker?.alias ?? "" };
  });
  console.log("  ", JSON.stringify(msg));
  comprobar(msg.rolls > 0 && /A3-E04/.test(msg.titulo) && /Reserva/.test(msg.flavor) && Number(msg.dificultad) === 4,
    `la tirada sale al chat con título, dificultad 4 y desglose (${msg.speaker})`);
} else console.log("  · (no hay actores para tirar: falta la crónica importada)");

await page.evaluate(() => foundry.applications.instances.get("sbn-panel")?.close());

/* -------------------------------------------- */
/*  6. Reimportar, panel y jugador              */
/* -------------------------------------------- */

if (hayPacks) {
  console.log("\n6. Reimportar sin perder el mundo");
  // Un usuario jugador para las pruebas (sin contraseña).
  const jugadorId = await page.evaluate(async () => {
    const u = game.users.getName("Jugador e2e") ?? await User.create({ name: "Jugador e2e", role: CONST.USER_ROLES.PLAYER });
    return u.id;
  });
  const antes6 = await page.evaluate(async ([MOD, jugadorId]) => {
    const porId = id => game.actors.find(a => a.getFlag(MOD, "id") === id);
    const pj = porId("PJ-01");
    const pnj = porId("PNJ-03");
    const hambre = (pj.system.hunger?.value ?? 1) === 4 ? 3 : 4;
    await pj.update({ ownership: { [jugadorId]: 3 }, "system.hunger.value": hambre, "system.exp.value": 7 });
    await pnj.update({ [`ownership.${jugadorId}`]: 2 });
    // Un handout «entregado»: el journal y su primera página a la vista de todos.
    const handout = game.journal.find(j => j.getFlag(MOD, "soporte"));
    await handout.update({ "ownership.default": 2 });
    await handout.pages.contents[0].update({ "ownership.default": 2 });
    // Una página agregada a mano a un journal del módulo.
    const conAgregada = game.journal.find(j => j.getFlag(MOD, "id") === "COMO-USAR");
    const [agregada] = await conAgregada.createEmbeddedDocuments("JournalEntryPage", [{ name: "e2e: nota de mesa", type: "text", ownership: { default: 0 }, text: { content: "<p>a mano</p>" } }]);
    return {
      pj: pj.id, pnj: pnj.id, hambre, handout: handout.id, pagina: handout.pages.contents[0].id,
      agregada: agregada.id, journalAgregada: conAgregada.id, activa: game.scenes.active?.id ?? null
    };
  }, [MOD, jugadorId]);
  // Reimportar: la API hace lo mismo que el botón «Actualizar» del diálogo.
  await page.evaluate(MOD => game.modules.get(MOD).api.importarCronica({ silencioso: true }), MOD);
  await page.waitForTimeout(1500);
  const despues6 = await page.evaluate(([MOD, a, jugadorId]) => {
    const pj = game.actors.get(a.pj);
    const handout = game.journal.get(a.handout);
    return {
      pjDueño: pj.ownership[jugadorId],
      hambre: pj.system.hunger?.value,
      exp: pj.system.exp?.value,
      pnjObservador: game.actors.get(a.pnj).ownership[jugadorId],
      handout: handout.ownership.default,
      pagina: handout.pages.get(a.pagina)?.ownership.default,
      agregada: !!game.journal.get(a.journalAgregada).pages.get(a.agregada),
      activa: game.scenes.active?.id ?? null
    };
  }, [MOD, antes6, jugadorId]);
  console.log("  ", JSON.stringify(despues6));
  comprobar(despues6.pjDueño === 3, "el PJ sigue siendo del jugador después de actualizar");
  comprobar(despues6.hambre === antes6.hambre && despues6.exp === 7, `el system del PJ se conserva (Hambre ${despues6.hambre}, PX ${despues6.exp})`);
  comprobar(despues6.pnjObservador === 2, "el ownership de un PNJ se conserva");
  comprobar(despues6.handout === 2 && despues6.pagina === 2, "el handout entregado sigue revelado (journal y página)");
  comprobar(despues6.agregada, "la página agregada a mano a un journal del módulo se conserva");
  comprobar(despues6.activa === antes6.activa, "la escena activa no cambia al actualizar");

  // Panel: los <details> abiertos sobreviven a un cambio; un actor ajeno no lo repinta.
  await page.evaluate(MOD => game.modules.get(MOD).api.abrirPanel({ tab: "termometro" }), MOD);
  await page.waitForSelector('#sbn-panel .sbn-tm-grupo[data-grupo="resto"]', { timeout: 5000 }).catch(() => null);
  await page.evaluate(() => { document.querySelector('#sbn-panel .sbn-tm-grupo[data-grupo="resto"]').open = true; });
  await page.waitForTimeout(200);
  await page.evaluate(MOD => game.modules.get(MOD).api.termometro(+1, "e2e: details"), MOD);
  await page.waitForTimeout(800);
  const sigueAbierto = await page.evaluate(() => document.querySelector('#sbn-panel .sbn-tm-grupo[data-grupo="resto"]')?.open);
  comprobar(sigueAbierto === true, "el grupo «resto» del panel sigue abierto después de mover el Termómetro");
  const repintadas = await page.evaluate(async () => {
    let n = 0;
    const h = Hooks.on("renderPanel", () => n++);
    const ajeno = await Actor.create({ name: "e2e: ajeno", type: "mortal" });
    await ajeno.update({ "system.exp.value": 1 });
    await ajeno.delete();
    await new Promise(r => setTimeout(r, 500));
    Hooks.off("renderPanel", h);
    return n;
  });
  comprobar(repintadas === 0, `crear/cambiar/borrar un actor ajeno no repinta el panel (${repintadas})`);

  // El voto al azar (Fry): la tirada se susurra a los GM.
  await page.click('#sbn-panel nav [data-tab="tiradas"]');
  await page.waitForTimeout(400);
  const azar = page.locator("#sbn-panel [data-action=azar]").first();
  if (await azar.count()) {
    const n = await page.evaluate(() => game.messages.size);
    await azar.click();
    await page.waitForFunction(n => game.messages.size > n, n, { timeout: 5000 }).catch(() => null);
    const m = await page.evaluate(() => { const m = game.messages.contents.at(-1); return { whisper: m.whisper, gm: m.whisper.every(id => game.users.get(id)?.isGM), rolls: m.rolls.length }; });
    comprobar(m.rolls > 0 && m.whisper.length > 0 && m.gm, `la tirada al azar del voto sale sólo para los GM (${m.whisper.length} destinatarios)`);
  } else console.log("  · (ningún voto al azar en la votación)");
  await page.evaluate(() => foundry.applications.instances.get("sbn-panel")?.close());

  // Un jugador: carga data/publico.json, nunca data/cronica.json.
  console.log("\n6b. Jugador");
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const jp = await ctx2.newPage();
  const pedidos = [];
  jp.on("request", req => { if (/\/data\/(cronica|publico)\.json/.test(req.url())) pedidos.push(req.url().split("/").pop()); });
  const erroresJugador = [];
  jp.on("pageerror", err => erroresJugador.push(err.message));
  await jp.goto(`${URL}/join`, { waitUntil: "networkidle" });
  await jp.waitForSelector("select[name=userid]", { timeout: 60000 });
  await jp.selectOption("select[name=userid]", jugadorId);
  await jp.click("button[name=join]");
  await jp.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120000 });
  await jp.waitForFunction(id => !!game.modules.get(id)?.api, MOD, { timeout: 30000 });
  const vj = await jp.evaluate(MOD => {
    const D = game.modules.get(MOD).api.Datos;
    return { gm: game.user.isGM, publicos: D.publicos, pistas: D.pistas.length, nombre: D.pista("P-07")?.nombre ?? null,
      noches: D.noches.length, dia: D.noche(1)?.dia ?? null, umbral3: D.umbral(3)?.jugadores ?? null, ciudad: D.umbral(3)?.ciudad ?? null,
      movimientos: D.movimientos.length, tiradas: !!D.tirada("A3-E04"), uuids: !!D.ref("PNJ-03") };
  }, MOD);
  console.log("  ", JSON.stringify(vj), "pedidos:", pedidos.join(", "));
  comprobar(!vj.gm && pedidos.includes("publico.json") && !pedidos.includes("cronica.json"), `el jugador pide data/publico.json y no data/cronica.json (${pedidos.join(", ")})`);
  comprobar(vj.publicos && vj.pistas === 15 && !!vj.nombre && vj.noches === 8 && !!vj.dia && !!vj.umbral3,
    "el jugador tiene nombres de pistas, días de las noches y lo que perciben los jugadores en cada umbral");
  comprobar(!vj.ciudad && vj.movimientos === 0 && !vj.tiradas && !vj.uuids, "el jugador no tiene textos del Narrador (ciudad, movimientos, tiradas, UUIDs)");

  // Enlaces sin permiso: COMO-USAR (visible, con «Aviso legal») enlaza documentos que el jugador no ve.
  const enlaces = await jp.evaluate(async MOD => {
    const j = game.journal.find(x => x.getFlag(MOD, "id") === "COMO-USAR");
    if (!j?.visible) return { visible: false };
    const aviso = j.pages.find(p => p.getFlag(MOD, "id") === "AVISO-LEGAL");
    const paginaConvenciones = j.pages.find(p => /cómo usar este libro/i.test(p.name));
    await j.sheet.render({ force: true, pageId: paginaConvenciones?.id });
    await new Promise(r => setTimeout(r, 1500));
    const el = j.sheet.element;
    const out = {
      visible: true,
      aviso: !!aviso?.visible,
      paginasVisibles: j.pages.filter(p => p.visible).map(p => p.name),
      bloqueados: el.querySelectorAll(".sbn-sin-permiso").length,
      // Un enlace que siga vivo tiene que ser a algo que el jugador puede ver.
      vivosSinPermiso: [...el.querySelectorAll("a.content-link[data-uuid]")].filter(a => fromUuidSync(a.dataset.uuid, { strict: false })?.visible === false).length,
      rotos: el.querySelectorAll("a.content-link.broken").length
    };
    await j.sheet.close();
    // El perfil de su PJ: el enlace a la ficha sigue (es suyo); el de otro PJ, texto.
    const perfil = id => game.journal.find(x => x.getFlag(MOD, "id") === id);
    const fichaDe = async id => {
      const pj = perfil(id);
      if (!pj?.visible) return null;
      await pj.sheet.render({ force: true, pageId: pj.pages.contents[0].id });
      await new Promise(r => setTimeout(r, 1200));
      const e = pj.sheet.element.querySelector(".sbn-enlace-actor");
      const r = e ? { enlace: !!e.querySelector("a.content-link"), texto: !!e.querySelector(".sbn-sin-permiso") } : null;
      await pj.sheet.close();
      return r;
    };
    out.propio = await fichaDe("PJ-01");
    out.ajeno = await fichaDe("PJ-02");
    return out;
  }, MOD);
  console.log("  ", JSON.stringify(enlaces));
  comprobar(enlaces.visible && enlaces.aviso, "el jugador ve el journal «Cómo usar» y su página «Aviso legal»");
  comprobar(enlaces.paginasVisibles?.length === 3, `sólo ve las 3 páginas {jugadores} de COMO-USAR (${enlaces.paginasVisibles?.join(" · ")})`);
  comprobar(enlaces.bloqueados > 0 && enlaces.vivosSinPermiso === 0 && enlaces.rotos === 0, `los enlaces que no puede abrir quedan como texto (${enlaces.bloqueados})`);
  comprobar(enlaces.propio?.enlace === true, "en el perfil de su PJ, el enlace a la ficha sigue vivo");
  comprobar(enlaces.ajeno?.texto === true, "en el perfil de otro PJ, la ficha queda como texto");
  await jp.screenshot({ path: path.join(CAPTURAS, "jugador.png") });
  comprobar(erroresJugador.length === 0, `sin errores de página en el cliente del jugador (${erroresJugador.length})`);
  for (const e of erroresJugador.slice(0, 5)) console.log("  -", e.slice(0, 300));
  await ctx2.close();

  // Dejar al PJ como estaba (sin dueño).
  await page.evaluate(async ([a, jugadorId]) => {
    // Sin el jugador: ownership entero, sin fusionar (recursive: false).
    for (const id of [a.pj, a.pnj]) {
      const actor = game.actors.get(id);
      const ownership = { ...actor._source.ownership };
      delete ownership[jugadorId];
      await actor.update({ ownership }, { recursive: false, diff: false });
    }
    await game.journal.get(a.journalAgregada).pages.get(a.agregada)?.delete();
  }, [antes6, jugadorId]);
}

/* -------------------------------------------- */
/*  Cierre                                      */
/* -------------------------------------------- */

// Dejar el estado de la crónica como al empezar.
await page.evaluate(async MOD => {
  await game.settings.set(MOD, "termometro", { valor: 2, congelado: false, registro: [] });
  await game.settings.set(MOD, "pistas", {});
  await game.settings.set(MOD, "pruebas", {});
  await game.settings.set(MOD, "votos", {});
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
// Lo mismo con el Actor.create de la prueba 6 (el actor todavía no tiene _id): «You must provide an _id…».
const ruidoWod5e = errores.filter(e => /^Actor id \[\w+\] does not exist in the Actors collection|^You must provide an _id for every object in the update data Array/.test(e));
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

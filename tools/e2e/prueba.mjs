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
 *      de bienvenida o por la API), que haya journals/actores/escenas, que
 *      cada escena con pista en content/musica.json quede con su
 *      playlist/playlistSound (y el .ogg se sirva), un
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
 *      puede abrir;
 *   7. (4b) los susurros al Narrador: el mensaje guarda un texto neutro y
 *      claves en un flag; el GM los ve igual que antes (mismo HTML que el
 *      contenido viejo enriquecido, enlace al interludio que abre) y en el
 *      cliente del jugador NINGÚN mensaje de game.messages (contenido, flavor
 *      ni flags) tiene textos de umbral, escenas, interludios, UUIDs ni
 *      textos de data/cronica.json. Al empezar se vacía el chat del mundo;
 *   8. (6b) del lado del jugador, además de game.messages, todos los settings del
 *      módulo y lo que recibe por el socket mientras el GM mueve el estado: ni
 *      motivos, ni ids de movimientos, pruebas, escenas o PNJ, ni votos; y su API
 *      no abre los sellos;
 *   9. (7) la migración: un estado en el formato viejo (todo a la vista) se lee
 *      igual, el GM lo sella al recargar, es idempotente y el panel lo muestra;
 *  10. (8) la crónica en inglés (TRADUCCION.md): el menú «Idioma de la crónica»,
 *      importar la Aventura de aventura-en con lo que haya en content/en/ (lo
 *      traducido sale en inglés, lo que falta en castellano), los mismos _id
 *      (sin duplicados), data/en/cronica.json en el Panel, el PJ con dueño, el
 *      handout entregado y la escena activa conservados, los avisos al Narrador
 *      con la interfaz en inglés, y la vuelta al castellano.
 * Las secciones 1–7 leen textos de la interfaz en castellano: el cliente del GM
 * se pone en castellano (core.language) al empezar.
 * Si los packs todavía no existen, lo dice y prueba sólo la API.
 * Capturas en tools/e2e/capturas/.
 */
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { idEstable } from "../util.mjs";

const URL = process.env.SBN_FOUNDRY_URL ?? "http://localhost:30099";
const MOD = "seattle-by-night";
const CAPTURAS = path.resolve(import.meta.dirname, "capturas");
const RAIZ_REPO = path.resolve(import.meta.dirname, "../..");
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

/** Idioma de la interfaz de este cliente (setting de cliente core.language, pide recargar). */
async function idiomaCliente(pagina, lang) {
  if (await pagina.evaluate(() => game.i18n.lang) === lang) return;
  await pagina.evaluate(lang => game.settings.set("core", "language", lang), lang);
  await pagina.reload({ waitUntil: "networkidle" });
  await pagina.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120000 });
  await pagina.waitForFunction(id => !!game.modules.get(id)?.api, MOD, { timeout: 30000 });
}
// Las comprobaciones de 1–7 leen textos de lang/es.json (la sección 8 prueba el inglés).
await idiomaCliente(page, "es");
// Si una corrida anterior quedó a mitad de la sección 8, la crónica vuelve al castellano.
if (await page.evaluate(MOD => game.settings.get(MOD, "sbn-idioma-cronica"), MOD) === "en") {
  await page.evaluate(MOD => game.modules.get(MOD).api.importarCronica({ idioma: "es", silencioso: true }), MOD);
  console.log("· la crónica estaba en inglés (corrida anterior): vuelve al castellano");
}

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
  // Estado limpio. El chat también: la prueba del jugador (6b) revisa TODO game.messages,
  // y los mensajes de corridas viejas (anteriores a los avisos con flag) traen el texto.
  await ChatMessage.implementation.deleteDocuments([], { deleteAll: true });
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
  // Lo guardado (lo que le llega a cualquier cliente): sin motivo a la vista, sellado en `s`.
  const crudo = game.settings.get(MOD, "termometro").registro;
  out.crudo = {
    entradas: crudo.length,
    aLaVista: crudo.filter(e => "motivo" in e || "movimiento" in e).length,
    sellados: crudo.filter(e => typeof e.s === "string" && e.s.startsWith("~1.")).length,
    texto: JSON.stringify(crudo).includes("e2e:")
  };
  out.hooks = hooks.length;
  const nuevos = game.messages.contents.slice(mensajesAntes).filter(m => m.getFlag(MOD, "origen") === "estado");
  out.mensajes = nuevos.length;
  out.todosSusurrados = nuevos.every(m => m.whisper.length && m.whisper.every(id => game.users.get(id)?.isGM));
  // El texto ya no está en el mensaje: el tipo va en el flag `aviso` y el título sale al renderizar.
  const subidas = nuevos.filter(m => m.getFlag(MOD, "aviso")?.tipo === "umbral" && m.getFlag(MOD, "aviso").sube);
  out.umbrales = [];
  for (const m of subidas) out.umbrales.push((await m.renderHTML()).querySelector(".message-content h4")?.textContent);
  return out;
}, MOD);
console.log(JSON.stringify(a, null, 2));
comprobar(a.mas1 === 3 && a.mas1str === 4, "termometro(+1) y termometro(\"+1\") suben");
comprobar(a.congelado && a.trasCongelar === null && a.valorCongelado === 4, "congelado no se mueve");
comprobar(a.igual10 === 10 && a.tope === 10 && a.piso === 0, "\"=10\", tope 10 y piso 0");
comprobar(a.invalido === null, "un cambio inválido se rechaza");
comprobar(a.camposRegistro.join() === "fecha,cambio,motivo,usuario,valorAntes,valorDespues", "el registro tiene { fecha, cambio, motivo, usuario, valorAntes, valorDespues }");
comprobar(a.crudo.entradas === a.registro.length && a.crudo.aLaVista === 0 && a.crudo.sellados === a.crudo.entradas && !a.crudo.texto,
  `el setting guarda los motivos sellados, no a la vista (${a.crudo.sellados}/${a.crudo.entradas} sellados)`);
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

  // Música (content/musica.json): cada escena con pista quedó enlazada a una
  // Playlist y un PlaylistSound que existen en el mundo, con el audio servido.
  const musica = JSON.parse(fs.readFileSync(path.join(RAIZ_REPO, "content/musica.json"), "utf8"));
  const esperadas = musica.listas.flatMap(l => l.pistas.flatMap(p => (p.escenas ?? []).map(escena => ({
    escena, pista: p.id, nombre: p.nombre, playlist: idEstable(`playlist:${l.id}`), sound: idEstable(`pista:${l.id}:${p.id}`),
    audio: fs.existsSync(path.join(RAIZ_REPO, `assets/musica/${p.id}.ogg`))
  }))));
  const sinAudio = [...new Set(esperadas.filter(e => !e.audio).map(e => e.pista))];
  comprobar(!sinAudio.length, `todas las pistas con escena tienen su .ogg en assets/musica${sinAudio.length ? ` (faltan: ${sinAudio.join(", ")})` : ""}`);
  const mus = await page.evaluate(async ([MOD, esperadas]) => {
    const malas = [];
    const rutas = new Set();
    for (const e of esperadas.filter(x => x.audio)) {
      const s = game.scenes.find(x => x.getFlag(MOD, "escena") === e.escena);
      if (!s) { malas.push(`${e.escena}: no está en el mundo`); continue; }
      const pl = s.playlist, snd = s.playlistSound;
      if (pl?.id !== e.playlist) malas.push(`${e.escena}: playlist ${pl?.id ?? "null"} (esperaba ${e.playlist})`);
      else if (snd?.id !== e.sound || snd.parent !== pl) malas.push(`${e.escena}: playlistSound ${snd?.id ?? "null"} (esperaba ${e.sound}, «${e.nombre}»)`);
      else if (!snd.repeat || !snd.path?.endsWith(`/assets/musica/${e.pista}.ogg`)) malas.push(`${e.escena}: el sonido no repite o apunta a ${snd.path}`);
      else rutas.add(snd.path);
    }
    // El audio se sirve (no basta con que el pack lo nombre).
    for (const r of rutas) {
      const res = await fetch(r, { method: "HEAD" }).catch(() => null);
      if (!res?.ok) malas.push(`${r}: HTTP ${res?.status ?? "error"}`);
    }
    return { listas: game.playlists.filter(p => p.getFlag(MOD, "origen")).length, enlazadas: esperadas.filter(x => x.audio).length, malas };
  }, [MOD, esperadas]);
  comprobar(mus.listas > 0, `hay playlists importadas (${mus.listas})`);
  comprobar(!mus.malas.length, `cada escena con pista suena con su playlist/playlistSound (${mus.enlazadas} escenas)` +
    (mus.malas.length ? `: ${mus.malas.join("; ")}` : ""));

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

    // Visión (MAPS_SPEC §4.1). Datos: todos los tokens ven, con el alcance del prototipo; los
    // poderes y aparatos dan darkvision; los perros huelen (feelTremor); las linternas, apagadas.
    const vis = await page.evaluate(MOD => {
      const porId = id => game.actors.find(a => a.getFlag(MOD, "id") === id)?.prototypeToken;
      const escenas = game.scenes.filter(s => s.getFlag(MOD, "origen") === "escena" && s.tokens.size);
      const tokens = escenas.flatMap(s => s.tokens.contents);
      const distintos = tokens.filter(t => {
        const p = t.actor?.prototypeToken;
        return !p || t.sight.visionMode !== p.sight.visionMode || t.sight.range !== p.sight.range;
      }).map(t => t.name);
      const modo = id => { const s = porId(id)?.sight; return s ? `${s.visionMode} ${s.range}` : null; };
      return {
        escenas: game.scenes.filter(s => s.getFlag(MOD, "origen") === "escena" && !s.getFlag(MOD, "landing"))
          .filter(s => !s.tokenVision || s.fog.mode !== CONST.FOG_EXPLORATION_MODES.INDIVIDUAL).map(s => s.name),
        tokens: tokens.length,
        sinVision: tokens.filter(t => !t.sight.enabled || !(t.sight.range > 0)).map(t => t.name),
        distintos,
        perros: tokens.filter(t => t.actor?.getFlag(MOD, "id") === "PERROS-MONTGOMERY").every(t => t.detectionModes.feelTremor?.range === 50),
        modos: { "PNJ-01": modo("PNJ-01"), "PNJ-03": modo("PNJ-03"), "CAZ-01": modo("CAZ-01"), "PJ-01": modo("PJ-01"), "PJ-02": modo("PJ-02") },
        linternas: ["PJ-02", "CAZ-01"].map(porId).every(p => p && p.light.dim === 0 && p.light.bright === 0 && p.light.color)
      };
    }, MOD);
    console.log("  visión:", JSON.stringify(vis.modos));
    comprobar(!vis.escenas.length, `las escenas de planos tienen visión de token y niebla individual${vis.escenas.length ? ` (no: ${vis.escenas.join(", ")})` : ""}`);
    comprobar(vis.tokens > 0 && !vis.sinVision.length && !vis.distintos.length,
      `los ${vis.tokens} tokens colocados ven, con la visión de su prototipo${vis.sinVision.length + vis.distintos.length ? ` (mal: ${[...vis.sinVision, ...vis.distintos].join(", ")})` : ""}`);
    comprobar(vis.modos["PNJ-01"] === "darkvision 30" && vis.modos["PNJ-03"] === "basic 3" && vis.modos["CAZ-01"] === "darkvision 20" &&
      vis.modos["PJ-01"] === "darkvision 10" && vis.modos["PJ-02"] === "basic 3",
      "visión por tipo: a tientas 3 m; Ojos de la Bestia 30, gafas térmicas 20 y Sentidos Agudizados 10 en darkvision");
    comprobar(vis.perros && vis.linternas, "los perros huelen (feelTremor 50 m) y las linternas de PJ y cazadores vienen apagadas");

    // En el lienzo: el Narrador sin token ve todo el mapa (sin máscara de visión); con un PNJ
    // controlado ve por sus ojos.
    const lienzo = await page.evaluate(async MOD => {
      const t = canvas.tokens.placeables.find(t => t.document.getFlag(MOD, "id"));
      if (!t) return null;
      canvas.tokens.releaseAll();
      await new Promise(r => setTimeout(r, 300));
      const color = () => canvas.environment.colors.ambientDarkness.css;
      const libre = { mascara: canvas.visibility.visible, fuentes: canvas.effects.visionSources.filter(s => s.active).length, oscuridad: color() };
      t.control({ releaseOthers: true });
      await new Promise(r => setTimeout(r, 600));
      const conToken = { mascara: canvas.visibility.visible, fuentes: canvas.effects.visionSources.filter(s => s.active).length, oscuridad: color() };
      canvas.tokens.releaseAll();
      return { nombre: t.name, libre, conToken };
    }, MOD);
    comprobar(lienzo && !lienzo.libre.mascara && lienzo.libre.fuentes === 0 && lienzo.conToken.mascara && lienzo.conToken.fuentes === 1,
      `el Narrador sin token ve el mapa entero; con «${lienzo?.nombre}» controlado, sólo lo que ve ese token`);
    comprobar(lienzo?.libre.oscuridad === "#8c8c99" && lienzo?.conToken.oscuridad !== "#8c8c99",
      `sin token, la oscuridad del Narrador se aclara (${lienzo?.libre.oscuridad}); con un token vuelve a la de Foundry (${lienzo?.conToken.oscuridad})`);
  } else comprobar(false, "hay una escena de Helen (LUG-05)");
}

/* -------------------------------------------- */
/*  4b. Avisos al Narrador (sin spoilers)       */
/* -------------------------------------------- */

console.log("\n4b. Avisos al Narrador");
const av = await page.evaluate(async MOD => {
  const api = game.modules.get(MOD).api;
  const D = api.Datos;
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const t = (k, d) => d ? game.i18n.format(`SBN.${k}`, d) : game.i18n.localize(`SBN.${k}`);
  const esc = x => foundry.utils.escapeHTML(String(x ?? ""));
  await game.settings.set(MOD, "termometro", { valor: 2, congelado: false, registro: [] });
  await game.settings.set(MOD, "pistas", {});
  await game.settings.set(MOD, "noche", 1);
  await espera(200);
  const antes = game.messages.size;
  await api.termometro(+1, "e2e: avisos 2→3");      // umbral 3 (INT-01)
  await api.termometro("=8", "e2e: avisos a 8");     // umbrales 5 y 7
  await api.termometro(+1, "e2e: avisos 8→9");      // umbral 9 (A4-E02, INT-03)
  await api.termometro(-1, "e2e: avisos 9→8");      // baja del 9
  await api.termometro("congelar", "e2e: avisos");
  await api.termometro("descongelar", "e2e: avisos");
  await api.pista("P-07");
  await api.noche(4);
  await espera(500);

  // El contenido VIEJO (lo que hacía estado.mjs antes de los flags), enriquecido como lo
  // enriquecía Foundry: si el HTML nuevo es igual, el Narrador ve exactamente lo mismo.
  const enlace = (id, texto) => {
    const ref = D.ref(id);
    const doc = ref ? fromUuidSync(ref.uuid, { strict: false }) : null;
    return doc ? `@UUID[${doc.uuid}]{${texto ?? doc.name}}` : esc(texto ?? id);
  };
  const escala = v => Array.from({ length: D.termometro.max }, (_, k) => k + 1).map(i =>
    `<span class="${["sbn-seg", i <= v ? "sbn-on" : "", D.umbrales.some(u => u.valor === i) ? "sbn-umbral" : ""].filter(Boolean).join(" ")}"></span>`).join("");
  const registro = api.estado().termometro.registro;
  const viejo = a => {
    let titulo, cuerpo, clase;
    if (a.tipo === "termometro") {
      clase = "sbn-chat-termometro";
      if (a.cambio === "congelar" || a.cambio === "descongelar") {
        titulo = t(`termometro.chat.${a.cambio}`);
        cuerpo = `<p>${t("termometro.chat.valor", { valor: a.despues })}</p>`;
      } else {
        titulo = t("termometro.chat.titulo", { antes: a.antes, despues: a.despues, cambio: a.cambio });
        cuerpo = `<div class="sbn-chat-escala">${escala(a.despues)}</div>`;
      }
      const motivo = registro.find(e => e.fecha === a.fecha)?.motivo;
      if (motivo) cuerpo += `<p class="sbn-chat-motivo">${esc(motivo)}</p>`;
    } else if (a.tipo === "umbral") {
      const u = D.umbral(a.valor);
      if (a.sube) {
        clase = "sbn-chat-umbral";
        titulo = t("termometro.umbral.titulo", { icono: u.icono, valor: u.valor, texto: u.texto });
        cuerpo = `<p>${esc(u.ciudad)}</p><p class="sbn-chat-jugadores">${t("termometro.umbral.jugadores", { texto: esc(u.jugadores) })}</p>`;
        if (u.escena) cuerpo += `<p>${t("termometro.umbral.escena", { enlace: enlace(u.escena) })}</p>`;
        if (u.pnj) cuerpo += `<p>${t("termometro.umbral.pnj", { enlace: enlace(u.pnj) })}</p>`;
        if (u.interludio) cuerpo += `<p>${t("termometro.umbral.interludio", { enlace: enlace(u.interludio) })}</p>`;
      } else {
        clase = "sbn-chat-umbral sbn-chat-baja";
        titulo = t("termometro.umbral.baja", { icono: u.icono, valor: u.valor });
        cuerpo = `<p>${esc(u.texto)}</p>`;
      }
    } else if (a.tipo === "pista") {
      clase = "sbn-chat-pista";
      titulo = t(a.obtenida ? "pistas.chat.obtenida" : "pistas.chat.perdida");
      cuerpo = `<p>${enlace(a.id, `${a.id} · ${D.pista(a.id).nombre}`)}</p><p class="sbn-chat-motivo">${t("pistas.chat.cuenta", { n: a.n, total: D.pistas.length })}</p>`;
    } else if (a.tipo === "noche") {
      const n = D.noche(a.n);
      clase = "sbn-chat-reloj";
      titulo = t("reloj.chat.titulo", { n: a.n, dia: n.dia });
      cuerpo = `<p>${esc(n.evento)}</p>`;
      if (n.escena) cuerpo += `<p>${t("reloj.chat.escena", { enlace: enlace(n.escena) })}</p>`;
    }
    return `<div class="sbn-chat ${clase}">${titulo ? `<h4>${titulo}</h4>` : ""}${cuerpo}</div>`;
  };
  const normal = html => { const d = document.createElement("div"); d.innerHTML = html; return d.innerHTML.replace(/>\s+</g, "><").trim(); };

  const out = { mensajes: [] };
  for (const m of game.messages.contents.slice(antes)) {
    const aviso = m.getFlag(MOD, "aviso");
    if (!aviso) continue;
    const html = await m.renderHTML();
    const c = html.querySelector(".message-content");
    const esperado = normal(await foundry.applications.ux.TextEditor.implementation.enrichHTML(viejo(aviso), { secrets: true }));
    out.mensajes.push({
      id: m.id, aviso, content: m.content,
      gm: m.whisper.length > 0 && m.whisper.every(id => game.users.get(id)?.isGM),
      h4: c.querySelector(".sbn-chat h4")?.textContent ?? null,
      enlaces: [...c.querySelectorAll("a.content-link")].map(a => a.dataset.uuid),
      igual: normal(c.innerHTML) === esperado,
      nuevo: normal(c.innerHTML).slice(0, 600), viejo: esperado.slice(0, 600)
    });
  }
  const uuid = id => { const r = D.ref(id); return r && fromUuidSync(r.uuid, { strict: false }) ? r.uuid : null; };
  out.uuids = { "INT-01": uuid("INT-01"), "INT-03": uuid("INT-03"), "A4-E02": uuid("A4-E02"), "P-07": uuid("P-07"), noche4: uuid(D.noche(4)?.escena) };
  return out;
}, MOD);
const porTipo = (tipo, f = () => true) => av.mensajes.filter(m => m.aviso.tipo === tipo && f(m.aviso));
const u3 = porTipo("umbral", a => a.valor === 3 && a.sube)[0];
const u9 = porTipo("umbral", a => a.valor === 9 && a.sube)[0];
const baja9 = porTipo("umbral", a => a.valor === 9 && !a.sube)[0];
console.log("  ", av.mensajes.map(m => `${m.aviso.tipo}${m.aviso.valor ?? m.aviso.cambio ?? m.aviso.id ?? m.aviso.n ?? ""}${m.aviso.sube === false ? "↓" : ""}`).join(" "));
comprobar(av.mensajes.length === 13, `cada cambio susurra su aviso (${av.mensajes.length} = 6 de Termómetro, umbrales 3 5 7 9 y 9↓, pista y noche)`);
comprobar(av.mensajes.every(m => m.gm), "todos los avisos van sólo a los GM");
const neutro = await page.evaluate(() => game.i18n.localize("SBN.chat.avisoNarrador"));
comprobar(av.mensajes.every(m => m.content.includes(neutro) && !/<h4|@UUID|A4-E02|INT-0|sbn-chat-escala/.test(m.content)),
  "el content de los mensajes es neutro (sin título, enlaces ni escena)");
const distintos = av.mensajes.filter(m => !m.igual);
comprobar(distintos.length === 0, `el Narrador ve cada aviso con el mismo HTML que el contenido viejo enriquecido (${av.mensajes.length - distintos.length}/${av.mensajes.length})`);
for (const m of distintos.slice(0, 3)) console.log(`  - ${JSON.stringify(m.aviso)}\n    nuevo: ${m.nuevo}\n    viejo: ${m.viejo}`);
comprobar(/Termómetro 3/.test(u3?.h4 ?? "") && /Termómetro 9/.test(u9?.h4 ?? "") && /baja del umbral 9/.test(baja9?.h4 ?? ""),
  `umbral 3, umbral 9 y la bajada del 9 con su título («${u9?.h4}»)`);
if (hayPacks) {
  comprobar(!!av.uuids["INT-01"] && u3?.enlaces.includes(av.uuids["INT-01"]), "el aviso del umbral 3 enlaza el interludio INT-01");
  comprobar(!!av.uuids["INT-03"] && u9?.enlaces.includes(av.uuids["INT-03"]) && u9?.enlaces.includes(av.uuids["A4-E02"]), "el aviso del umbral 9 enlaza A4-E02 y el interludio INT-03");
  comprobar(porTipo("pista")[0]?.enlaces.includes(av.uuids["P-07"]) && porTipo("noche")[0]?.enlaces.includes(av.uuids.noche4), "los avisos de pista y de noche enlazan la pista y la escena");
  // En el log del chat (no sólo renderHTML): el contenido real, y el enlace al interludio abre su journal.
  await page.evaluate(() => { ui.notifications.clear(); ui.sidebar.expand(); ui.sidebar.changeTab("chat", "primary"); });
  await page.waitForTimeout(800);
  const sel = await page.evaluate(([id, uuid]) => {
    const li = ui.chat.element.querySelector(`.message[data-message-id="${id}"]`);
    li?.scrollIntoView();
    return li?.querySelector(`a.content-link[data-uuid="${uuid}"]`) ? `#${ui.chat.element.id} .message[data-message-id="${id}"] a.content-link[data-uuid="${uuid}"]` : null;
  }, [u9?.id, av.uuids["INT-03"]]);
  comprobar(!!sel, "en el log del chat, el aviso del umbral 9 muestra el enlace al interludio");
  if (sel) {
    await page.waitForTimeout(300);
    await captura("chat-avisos");
    await page.locator(sel).first().click();
    const journal = av.uuids["INT-03"].split(".").slice(0, 2).join(".");
    await page.waitForFunction(j => [...foundry.applications.instances.values()].some(a => a.document?.uuid === j && a.rendered), journal, { timeout: 8000 }).catch(() => null);
    const abierto = await page.evaluate(j => [...foundry.applications.instances.values()].some(a => a.document?.uuid === j && a.rendered), journal);
    comprobar(abierto, "el clic en el enlace del interludio abre su journal");
    await page.evaluate(() => { for (const app of foundry.applications.instances.values()) if (app.document?.documentName === "JournalEntry") app.close(); });
  }
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
    // Playlist: un volumen tocado por el Narrador y un sonido agregado a mano.
    const lista = game.playlists.find(p => p.getFlag(MOD, "origen") === "playlist");
    let musica = null;
    if (lista?.sounds.size) {
      const sonido = lista.sounds.contents[0];
      await sonido.update({ volume: 0.11 });
      const [mano] = await lista.createEmbeddedDocuments("PlaylistSound", [{ name: "e2e: a mano", path: sonido.path }]);
      musica = { lista: lista.id, sonido: sonido.id, mano: mano.id };
    }
    return {
      musica,
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
      activa: game.scenes.active?.id ?? null,
      musica: a.musica ? {
        volumen: game.playlists.get(a.musica.lista)?.sounds.get(a.musica.sonido)?.volume,
        mano: !!game.playlists.get(a.musica.lista)?.sounds.get(a.musica.mano)
      } : null
    };
  }, [MOD, antes6, jugadorId]);
  console.log("  ", JSON.stringify(despues6));
  comprobar(despues6.pjDueño === 3, "el PJ sigue siendo del jugador después de actualizar");
  comprobar(despues6.hambre === antes6.hambre && despues6.exp === 7, `el system del PJ se conserva (Hambre ${despues6.hambre}, PX ${despues6.exp})`);
  comprobar(despues6.pnjObservador === 2, "el ownership de un PNJ se conserva");
  comprobar(despues6.handout === 2 && despues6.pagina === 2, "el handout entregado sigue revelado (journal y página)");
  comprobar(despues6.agregada, "la página agregada a mano a un journal del módulo se conserva");
  comprobar(despues6.activa === antes6.activa, "la escena activa no cambia al actualizar");
  if (antes6.musica) {
    comprobar(despues6.musica?.volumen === 0.11 && despues6.musica?.mano, "la playlist conserva el volumen tocado y el sonido agregado a mano");
  } else console.log("  · (sin pistas en la playlist: falta el audio)");

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
    const m = await page.evaluate(async MOD => {
      const m = game.messages.contents.at(-1);
      const flavor = (await m.renderHTML()).querySelector(".flavor-text")?.textContent ?? "";
      return { whisper: m.whisper, gm: m.whisper.every(id => game.users.get(id)?.isGM), rolls: m.rolls.length,
        crudo: m.flavor, aviso: m.getFlag(MOD, "aviso"), flavor, neutro: game.i18n.localize("SBN.chat.avisoNarrador") };
    }, MOD);
    comprobar(m.rolls > 0 && m.whisper.length > 0 && m.gm, `la tirada al azar del voto sale sólo para los GM (${m.whisper.length} destinatarios)`);
    comprobar(m.crudo === m.neutro && m.aviso?.tipo === "azar" && /Voto de .+: (Sí|No)/.test(m.flavor),
      `el flavor guardado es neutro y el GM ve «${m.flavor}»`);
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
  // Todo lo que le llega por el socket (socket.io sobre WebSocket: «42["modifyDocument",{…}]»).
  const tramas = [];
  jp.on("websocket", ws => ws.on("framereceived", ({ payload }) => tramas.push(typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8"))));
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
  comprobar(vj.publicos && vj.pistas === 15 && vj.nombre === null && vj.noches === 8 && !!vj.dia && !!vj.umbral3,
    "el jugador tiene los ids de las pistas (sin nombres), días de las noches y lo que perciben los jugadores en cada umbral");
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
  // Lo que el cliente del jugador TIENE (no lo que ve): todo game.messages, con content,
  // flavor, flags y tiradas; todos los settings del módulo; y lo que recibe por el socket.
  // Los textos prohibidos salen de data/cronica.json del GM.
  const prohibidos = await page.evaluate(MOD => {
    const D = game.modules.get(MOD).api.Datos;
    const votacion = D.tirada("A4-E01")?.votacion?.primogenitos ?? [];
    const azar = votacion.filter(p => p.voto === "azar")
      .flatMap(p => ["si", "no"].map(v => game.i18n.format("SBN.panel.votacion.tiradaAzar", { nombre: D.nombre(p.pnj), voto: game.i18n.localize(`SBN.panel.votacion.votos.${v}`) })));
    const largos = l => l.filter(x => typeof x === "string" && x.length >= 6);
    // Mensajes: los textos de siempre, los motivos libres de la prueba («e2e: …») y quién vota al azar.
    const mensajes = [
      ...largos([
        "A4-E02", "INT-0", "@UUID", "JournalEntry",
        ...D.umbrales.flatMap(u => [u.texto, u.ciudad, u.nota]),
        ...D.noches.map(n => n.evento),
        ...D.movimientos.map(m => m.motivo),
        ...azar
      ]),
      "e2e:", ...votacion.filter(p => p.voto === "azar").map(p => p.pnj)
    ];
    // Settings y socket, además: ids de movimientos, pruebas y casillas, sus nombres y los Primogénitos.
    const t4 = D.tirada("A4-E01");
    const ajustes = [
      ...mensajes,
      ...largos([
        ...D.movimientos.map(m => m.id),
        ...D.noches.flatMap(n => (n.movimientos ?? []).flatMap(m => [m.id, m.motivo])),
        ...D.pruebas.flatMap(p => [p.id, p.nombre]),
        ...(t4?.otros ?? []).flatMap(o => [o.id, o.motivo]),
        ...(t4?.valores ?? []).map(v => v.prueba)
      ]),
      ...votacion.map(p => p.pnj)
    ];
    return { mensajes: [...new Set(mensajes)], ajustes: [...new Set(ajustes)] };
  }, MOD);
  // Ids legibles de escenas, lugares, interludios, pruebas o PNJ: en ningún setting ni trama.
  const IDS_LEGIBLES = String(/\b(A\d-E\d{2}|LUG-\d|INT-\d|PRUEBA-|PNJ-\d|noche-\d-|sube-|baja-)/i.source);

  // Con el jugador conectado, el GM mueve el estado: lo que le llegue por el socket desde
  // ahora se revisa. Lo de antes (los datos del mundo al entrar) trae TODOS los journals,
  // actores y escenas, también los que el jugador no puede ver: eso es de Foundry, no de
  // los settings (que ya se revisaron arriba, tal como llegaron).
  const desde = tramas.length;
  const accionesGM = await page.evaluate(async MOD => {
    const api = game.modules.get(MOD).api;
    const D = api.Datos;
    const mov = D.movimientos.find(m => m.id && /^[+-]?\d+$/.test(m.cambio)) ?? D.movimientos[0];
    if (api.estado().termometro.congelado) await api.termometro("descongelar", "e2e: socket");
    if (api.estado().termometro.valor >= D.termometro.max) await api.termometro("=5", "e2e: socket");
    await api.termometro(mov.cambio, mov.motivo, { movimiento: mov.id });
    await api.termometro(-1, "e2e: motivo libre por el socket");
    await api.prueba("PRUEBA-KRELL-PRESENTE", false);
    await api.prueba("PRUEBA-KRELL-PRESENTE", true);
    await api.Estado.voto("PNJ-14", "no");
    await new Promise(r => setTimeout(r, 300));
    return { movimiento: mov.id };
  }, MOD);
  // Y el voto al azar desde el panel (el mensaje con el flag `aviso` sellado).
  await page.evaluate(MOD => game.modules.get(MOD).api.abrirPanel({ tab: "tiradas" }), MOD);
  await page.waitForSelector("#sbn-panel [data-action=azar]", { timeout: 5000 }).catch(() => null);
  if (await page.locator("#sbn-panel [data-action=azar]").count()) await page.locator("#sbn-panel [data-action=azar]").first().click();
  await jp.waitForTimeout(1500);
  await page.evaluate(() => foundry.applications.instances.get("sbn-panel")?.close());

  const fuga = await jp.evaluate(([MOD, prohibidos, idsLegibles]) => {
    const re = new RegExp(idsLegibles, "i");
    const out = { total: game.messages.size, avisos: 0, visibles: 0, fugas: [], ajustes: 0, fugasAjustes: [] };
    for (const m of game.messages) {
      if (m.getFlag(MOD, "aviso")) out.avisos++;
      if (m.getFlag(MOD, "aviso") && m.visible && !m.isRoll) out.visibles++;
      const crudo = JSON.stringify(m.toObject());
      for (const p of prohibidos.mensajes) if (crudo.includes(p)) out.fugas.push(`${m.id} · «${p.slice(0, 50)}»`);
    }
    // Todos los settings del módulo: los documentos Setting tal como llegaron y su valor leído.
    const valores = [];
    for (const doc of game.settings.storage.get("world")) {
      if (doc.key?.startsWith(`${MOD}.`)) valores.push([doc.key, JSON.stringify(doc.toObject())]);
    }
    for (const [clave, cfg] of game.settings.settings) {
      if (cfg.namespace !== MOD) continue;
      try { valores.push([clave, JSON.stringify(game.settings.get(MOD, cfg.key))]); } catch { /* sin valor */ }
    }
    out.ajustes = valores.length;
    for (const [clave, texto] of valores) {
      for (const p of prohibidos.ajustes) if (texto.includes(p)) out.fugasAjustes.push(`${clave} · «${p.slice(0, 50)}»`);
      const m = re.exec(texto);
      if (m) out.fugasAjustes.push(`${clave} · id legible «${m[0]}»`);
    }
    // La API del jugador tampoco abre los sellos.
    const e = game.modules.get(MOD).api.estado();
    out.api = { motivos: e.termometro.registro.filter(r => r.motivo || r.movimiento).length, pruebas: Object.keys(e.pruebas).length, votos: Object.keys(e.votos).length, registro: e.termometro.registro.length };
    return out;
  }, [MOD, prohibidos, IDS_LEGIBLES]);
  // Las tramas del socket: las de documentos (modifyDocument), contra la lista de los settings.
  const reIds = new RegExp(IDS_LEGIBLES, "i");
  const nuevas = tramas.slice(desde);
  const deDocumentos = nuevas.filter(t => t.includes("modifyDocument"));
  const fugasSocket = [];
  for (const t of nuevas) {
    for (const p of prohibidos.ajustes) if (t.includes(p)) fugasSocket.push(`«${p.slice(0, 50)}» en ${t.slice(0, 120)}`);
    const m = reIds.exec(t);
    if (m) fugasSocket.push(`id legible «${m[0]}» en ${t.slice(0, 160)}`);
  }
  // Un update de Setting llega como { type: "Setting", result: [{ _id, value }], operation }.
  const deSettings = deDocumentos.filter(t => t.includes('"type":"Setting"')).length;
  console.log("  ", JSON.stringify({ ...fuga, fugas: fuga.fugas.length, fugasAjustes: fuga.fugasAjustes.length }),
    `· ${prohibidos.mensajes.length} textos prohibidos en mensajes, ${prohibidos.ajustes.length} en settings y socket`,
    `· ${nuevas.length} tramas después de entrar (${deDocumentos.length} de documentos, ${deSettings} de settings)`);
  const ejemplo = deDocumentos.find(t => t.includes('"type":"Setting"') && t.includes('"sbn"'));
  if (ejemplo) console.log("   una trama de Setting (con el detalle `sbn` de las opciones):", ejemplo.slice(0, 400));
  comprobar(fuga.avisos >= 13, `el jugador recibe los avisos al Narrador en game.messages (${fuga.avisos} de ${fuga.total} mensajes)…`);
  comprobar(fuga.fugas.length === 0, `…pero ningún mensaje (content, flavor, flags) tiene textos de umbral, A4-E02, INT-0, @UUID, JournalEntry, motivos ni de data/cronica.json (${fuga.fugas.length} fugas, ${prohibidos.mensajes.length} cadenas)`);
  for (const f of fuga.fugas.slice(0, 10)) console.log("  -", f);
  comprobar(fuga.visibles === 0, "ningún aviso es visible para el jugador");
  comprobar(fuga.ajustes >= 5 && fuga.fugasAjustes.length === 0,
    `ningún setting del módulo que tiene el jugador lleva motivos, ids de movimientos/pruebas/escenas ni votos (${fuga.ajustes} valores, ${prohibidos.ajustes.length} cadenas, ${fuga.fugasAjustes.length} fugas)`);
  for (const f of fuga.fugasAjustes.slice(0, 10)) console.log("  -", f);
  comprobar(deSettings >= 5 && fugasSocket.length === 0,
    `nada legible en lo que recibe por el socket mientras el GM mueve el estado (${deSettings} cambios de settings, ${fugasSocket.length} fugas)`);
  for (const f of fugasSocket.slice(0, 10)) console.log("  -", f);
  comprobar(fuga.api.registro > 0 && fuga.api.motivos === 0 && fuga.api.pruebas === 0 && fuga.api.votos === 0,
    `la API del jugador no abre los sellos (${fuga.api.registro} entradas sin motivo, sin pruebas ni votos)`);
  const trasSocket = await page.evaluate(([MOD, mov]) => {
    const e = game.modules.get(MOD).api.estado();
    const r = e.termometro.registro;
    return { mov: r.at(-2)?.movimiento === mov, libre: r.at(-1)?.motivo === "e2e: motivo libre por el socket", krell: e.pruebas["PRUEBA-KRELL-PRESENTE"] === true, voto: e.votos["PNJ-14"] === "no" };
  }, [MOD, accionesGM.movimiento]);
  comprobar(Object.values(trasSocket).every(Boolean), `el GM sigue leyendo motivo, movimiento, prueba y voto (${JSON.stringify(trasSocket)})`);
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
/*  7. Migración del formato viejo del estado   */
/* -------------------------------------------- */

console.log("\n7. Migración del estado viejo");
// Una partida empezada antes de 0.4.x: motivos, movimiento, pruebas y votos a la vista.
const viejo = await page.evaluate(async MOD => {
  const D = game.modules.get(MOD).api.Datos;
  const mov = D.movimientos.find(m => m.id) ?? null;
  const galeria = D.tirada("A4-E01")?.otros?.find(o => o.a === "Halloway")?.id ?? null;
  const estado = {
    termometro: { valor: 5, congelado: false, registro: [
      { fecha: "2026-10-01T03:00:00.000Z", cambio: "+1", motivo: "e2e: motivo viejo a la vista", usuario: game.user.name, valorAntes: 3, valorDespues: 4 },
      { fecha: "2026-10-01T03:05:00.000Z", cambio: "+1", motivo: mov?.motivo ?? "e2e: mov", usuario: game.user.name, valorAntes: 4, valorDespues: 5, movimiento: mov?.id ?? "e2e-mov", noche: 2 },
      { fecha: "2026-10-01T03:10:00.000Z", cambio: "congelar", motivo: "", usuario: game.user.name, valorAntes: 5, valorDespues: 5 },
      { fecha: "2026-10-01T03:15:00.000Z", cambio: "descongelar", motivo: "e2e: descongelar viejo", usuario: game.user.name, valorAntes: 5, valorDespues: 5 }
    ] },
    pruebas: { "PRUEBA-KRELL-PRESENTE": true, ...(galeria ? { [galeria]: true } : {}) },
    votos: { "PNJ-15": "no", "PNJ-16": "si" }
  };
  for (const [k, v] of Object.entries(estado)) await game.settings.set(MOD, k, v);
  // El voto al azar de antes, con el PNJ a la vista en el flag: el GM lo sigue leyendo.
  const roll = await new Roll("1d10").evaluate();
  const msg = await roll.toMessage({
    flavor: foundry.utils.escapeHTML(game.i18n.localize("SBN.chat.avisoNarrador")),
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    flags: { [MOD]: { origen: "panel", aviso: { tipo: "azar", pnj: "PNJ-16" } } }
  }, { messageMode: "gm" });
  // Antes de migrar, el formato viejo se lee igual.
  const e = game.modules.get(MOD).api.estado();
  return { estado, mov: mov?.id ?? "e2e-mov", galeria, msg: msg.id,
    leidoAntes: e.termometro.registro.map(r => r.motivo).join("|") === estado.termometro.registro.map(r => r.motivo).join("|")
      && e.termometro.registro[1].movimiento === (mov?.id ?? "e2e-mov") && e.pruebas["PRUEBA-KRELL-PRESENTE"] === true && e.votos["PNJ-15"] === "no" };
}, MOD);
comprobar(viejo.leidoAntes, "sin migrar, el estado en formato viejo se lee igual (motivos, movimiento, pruebas, votos)");
// Recargar el GM: en `ready`, el GM activo migra (main.mjs → Estado.migrar).
await page.reload({ waitUntil: "networkidle" });
await listo();
await page.waitForFunction(id => !!game.modules.get(id)?.api, MOD, { timeout: 30000 });
await page.waitForFunction(MOD => typeof game.settings.get(MOD, "votos")?.s === "string", MOD, { timeout: 10000 }).catch(() => null);
const mig = await page.evaluate(async ([MOD, viejo]) => {
  const api = game.modules.get(MOD).api;
  const crudo = { termometro: game.settings.get(MOD, "termometro"), pruebas: game.settings.get(MOD, "pruebas"), votos: game.settings.get(MOD, "votos") };
  const texto = JSON.stringify(crudo);
  const e = api.estado();
  const r = e.termometro.registro;
  const out = {
    sellado: crudo.termometro.registro.every(x => !("motivo" in x) && !("movimiento" in x) && !("noche" in x))
      && crudo.termometro.registro.filter(x => x.s).length === 3
      && typeof crudo.pruebas.s === "string" && Object.keys(crudo.pruebas).length === 1
      && typeof crudo.votos.s === "string" && Object.keys(crudo.votos).length === 1,
    legible: ["e2e:", "PRUEBA-", "PNJ-", viejo.mov, viejo.galeria].filter(Boolean).filter(x => texto.includes(x)),
    valores: crudo.termometro.valor === 5 && crudo.termometro.registro.map(x => `${x.fecha}${x.cambio}${x.valorAntes}${x.valorDespues}`).join()
      === viejo.estado.termometro.registro.map(x => `${x.fecha}${x.cambio}${x.valorAntes}${x.valorDespues}`).join(),
    motivos: r.map(x => x.motivo).join("|") === viejo.estado.termometro.registro.map(x => x.motivo).join("|"),
    movimiento: r[1]?.movimiento === viejo.mov && r[1]?.noche === 2 && !r[0].movimiento,
    campos: Object.keys(r[0] ?? {}).join(),
    pruebas: JSON.stringify(Object.keys(e.pruebas).sort()) === JSON.stringify(Object.keys(viejo.estado.pruebas).sort()),
    votos: e.votos["PNJ-15"] === "no" && e.votos["PNJ-16"] === "si",
    otraVez: await api.Estado.migrar()
  };
  // El voto al azar viejo: el GM ve quién votó.
  const m = game.messages.get(viejo.msg);
  out.azarViejo = (await m.renderHTML()).querySelector(".flavor-text")?.textContent ?? "";
  await m.delete();
  return out;
}, [MOD, viejo]);
console.log("  ", JSON.stringify(mig));
comprobar(mig.sellado && mig.legible.length === 0, `al cargar, el GM migra el estado viejo: motivos, pruebas y votos sellados (legibles: ${mig.legible.join(", ") || "ninguno"})`);
comprobar(mig.valores, "la migración conserva valores, cambios y fechas del registro");
comprobar(mig.motivos && mig.movimiento && mig.campos === "fecha,cambio,motivo,usuario,valorAntes,valorDespues", "el GM lee los motivos, el movimiento y la noche migrados");
comprobar(mig.pruebas && mig.votos, "pruebas y votos migrados se leen igual");
comprobar(Array.isArray(mig.otraVez) && mig.otraVez.length === 0, "migrar otra vez no reescribe nada (idempotente)");
comprobar(/Voto de .+: (Sí|No)/.test(mig.azarViejo), `un voto al azar viejo (PNJ a la vista) se sigue leyendo («${mig.azarViejo}»)`);
// El panel muestra el historial migrado con sus motivos, las pruebas y los votos.
await page.evaluate(MOD => game.modules.get(MOD).api.abrirPanel({ tab: "termometro" }), MOD);
await page.waitForSelector("#sbn-panel .sbn-tm-historial", { timeout: 5000 }).catch(() => null);
const panelMig = await page.evaluate(() => {
  const filas = [...document.querySelectorAll("#sbn-panel .sbn-tm-historial tbody tr")].map(tr => tr.textContent);
  return { filas: filas.length, viejo: filas.some(f => f.includes("e2e: motivo viejo a la vista")), noche: filas.some(f => /Noche 2/.test(f)) };
});
await page.click('#sbn-panel nav [data-tab="tiradas"]');
await page.waitForTimeout(400);
const panelMig2 = await page.evaluate(() => ({
  krell: document.querySelector('#sbn-panel [data-tirada="A3-E04"] [data-action=prueba][data-id="PRUEBA-KRELL-PRESENTE"]')?.getAttribute("aria-pressed"),
  voto15: document.querySelector('#sbn-panel select[data-sbn-cambio=voto][data-pnj="PNJ-15"]')?.value ?? null
}));
console.log("  ", JSON.stringify({ ...panelMig, ...panelMig2 }));
comprobar(panelMig.filas === 4 && panelMig.viejo && panelMig.noche, `el panel muestra el historial migrado con sus motivos (${panelMig.filas} filas)`);
comprobar(panelMig2.krell === "true" && panelMig2.voto15 === "no", `y las pruebas y votos migrados (Krell ${panelMig2.krell}, PNJ-15 ${panelMig2.voto15})`);
await page.evaluate(() => foundry.applications.instances.get("sbn-panel")?.close());

/* -------------------------------------------- */
/*  8. Crónica en inglés (The Ward File)        */
/* -------------------------------------------- */

if (hayPacks && r.packs["aventura-en"] > 0) {
  console.log("\n8. Crónica en inglés");
  // Lo que hay en content/en/: los journals traducidos (id y nombre inglés) y uno que falta.
  const leerMeta = abs => {
    const m = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(abs, "utf8"));
    return Object.fromEntries((m?.[1] ?? "").split("\n").map(l => /^(\w+):\s*"?(.*?)"?\s*$/.exec(l)).filter(Boolean).map(x => [x[1], x[2]]));
  };
  const mdDe = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith(".md")).map(f => path.join(dir, f)) : [];
  const CONTENT = path.join(RAIZ_REPO, "content");
  const traducidos = mdDe(path.join(CONTENT, "en")).map(abs => {
    const rel = path.relative(path.join(CONTENT, "en"), abs);
    const es = leerMeta(path.join(CONTENT, rel));
    return { id: es.id, es: es.nombre, en: leerMeta(abs).nombre };
  }).filter(t => t.id && t.en);
  const sinTraducir = mdDe(path.join(CONTENT, "ciudad")).map(abs => ({ rel: path.relative(CONTENT, abs), ...leerMeta(abs) }))
    .find(m => !fs.existsSync(path.join(CONTENT, "en", m.rel)));
  console.log(`  · content/en/: ${traducidos.length} journal(es) traducido(s)${sinTraducir ? `; sin traducir, p. ej. ${sinTraducir.id}` : ", todos"}`);

  // El menú de la configuración ofrece los dos idiomas.
  const menu = await page.evaluate(async MOD => {
    const m = game.settings.menus.get(`${MOD}.sbn-idioma-menu`);
    if (!m) return null;
    const app = new m.type();
    await app.render(true);
    const opciones = [...app.element.querySelectorAll("select[name=idioma] option")].map(o => o.value);
    const elegido = app.element.querySelector("select[name=idioma]")?.value;
    await app.close();
    return { opciones, elegido, restringido: m.restricted };
  }, MOD);
  comprobar(menu?.opciones?.join() === "es,en" && menu.elegido === "es" && menu.restringido,
    `el menú «Idioma de la crónica» ofrece castellano e inglés y propone el actual (${JSON.stringify(menu)})`);

  // Antes: un PJ con dueño jugador, un handout entregado, la escena activa.
  const antes8 = await page.evaluate(async MOD => {
    const jugador = game.users.getName("Jugador e2e") ?? await User.create({ name: "Jugador e2e", role: CONST.USER_ROLES.PLAYER });
    const pj = game.actors.find(a => a.getFlag(MOD, "id") === "PJ-01");
    if (pj.ownership[jugador.id] !== 3) await pj.update({ ownership: { [jugador.id]: 3 } });
    const handout = game.journal.find(j => j.getFlag(MOD, "soporte"));
    await handout.update({ "ownership.default": 2 });
    await handout.pages.contents[0].update({ "ownership.default": 2 });
    const gen = d => !!d.getFlag(MOD, "origen");
    return {
      jugador: jugador.id, pj: pj.id, pjNombre: pj.name, pjBio: pj.system.biography, hambre: pj.system.hunger?.value,
      handout: handout.id, pagina: handout.pages.contents[0].id, activa: game.scenes.active?.id ?? null,
      cuenta: { j: game.journal.filter(gen).length, a: game.actors.filter(gen).length, e: game.scenes.filter(gen).length, c: game.folders.filter(gen).length }
    };
  }, MOD);

  const pedidosDatos = [];
  const anotar = req => { const m = /\/modules\/seattle-by-night\/(data\/[^?]+)/.exec(req.url()); if (m) pedidosDatos.push(m[1]); };
  page.on("request", anotar);
  await page.evaluate(MOD => game.modules.get(MOD).api.importarCronica({ idioma: "en", silencioso: true }), MOD);
  await page.waitForFunction(MOD => game.modules.get(MOD).api.Datos.archivo === "data/en/cronica.json" && game.modules.get(MOD).api.Datos.listos, MOD, { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(1500);
  const en8 = await page.evaluate(async ([MOD, a, ids, sinId, raizId]) => {
    const api = game.modules.get(MOD).api;
    const porId = id => game.journal.find(j => j.getFlag(MOD, "id") === id);
    const gen = d => !!d.getFlag(MOD, "origen");
    const pj = game.actors.get(a.pj);
    const handout = game.journal.get(a.handout);
    const helen = game.actors.find(x => x.getFlag(MOD, "id") === "PNJ-04");
    return {
      idioma: api.idioma(), setting: game.settings.get(MOD, "sbn-idioma-cronica"),
      archivo: api.Datos.archivo, listos: api.Datos.listos, umbrales: api.Datos.umbrales.length,
      traducidos: ids.map(id => porId(id)?.name ?? null),
      paginasEn: porId(ids[0])?.pages.contents.map(p => p.name) ?? [],
      sinTraducir: porId(sinId)?.name ?? null,
      helen: helen ? { nombre: helen.name, perfil: /Profile:/.test(helen.system.biography ?? "") } : null,
      raiz: game.folders.get(raizId)?.name ?? null,
      cuenta: { j: game.journal.filter(gen).length, a: game.actors.filter(gen).length, e: game.scenes.filter(gen).length, c: game.folders.filter(gen).length },
      pj: { dueño: pj.ownership[a.jugador], nombre: pj.name, bio: pj.system.biography === a.pjBio, hambre: pj.system.hunger?.value },
      handout: handout.ownership.default, pagina: handout.pages.get(a.pagina)?.ownership.default,
      activa: game.scenes.active?.id ?? null,
      importada: Object.keys(game.settings.get("core", "adventureImports") ?? {}).filter(k => k.includes(`${MOD}.aventura-en`)).length
    };
  }, [MOD, antes8, traducidos.map(t => t.id), sinTraducir?.id, idEstable("aventura:raiz:JournalEntry")]);
  page.off("request", anotar);
  console.log("  ", JSON.stringify({ ...en8, pjBio: undefined }));
  comprobar(en8.idioma === "en" && en8.setting === "en", `importar aventura-en deja la crónica en inglés (sbn-idioma-cronica = ${en8.setting})`);
  comprobar(en8.archivo === "data/en/cronica.json" && en8.listos && en8.umbrales === 5 && pedidosDatos.includes("data/en/cronica.json"),
    `el Panel recarga data/en/cronica.json (${pedidosDatos.join(", ") || "sin pedidos"}; ${en8.umbrales} umbrales)`);
  const limpio = s => String(s ?? "").replace(/[*`]/g, "").replace(/\\(.)/g, "$1").trim();
  const distintos8 = traducidos.filter((t, i) => limpio(en8.traducidos[i]) !== limpio(t.en));
  comprobar(traducidos.length > 0 && !distintos8.length,
    `lo traducido sale en inglés (${traducidos.length} journals: ${en8.traducidos.slice(0, 4).join(" · ")}…)${distintos8.length ? ` · distintos: ${distintos8.slice(0, 3).map(t => `${t.id} «${t.en}»`).join(", ")}` : ""}`);
  comprobar(en8.paginasEn.length > 0 && !en8.paginasEn.some(n => /Notas del Narrador|Leer en voz alta/.test(n)), `y sus páginas también (${en8.paginasEn.join(" · ")})`);
  if (sinTraducir) comprobar(en8.sinTraducir === sinTraducir.nombre, `lo que falta en content/en/ sigue en castellano («${en8.sinTraducir}»)`);
  else console.log("  · (content/en/ tiene todo: no hay nada que caiga al castellano)");
  if (fs.existsSync(path.join(CONTENT, "en/pnjs/fuera.json"))) comprobar(en8.helen?.perfil, `la ficha traducida de Helen (PNJ-04) está en inglés (${JSON.stringify(en8.helen)})`);
  comprobar(en8.raiz === "The Ward File", `la carpeta raíz se llama «${en8.raiz}»`);
  comprobar(JSON.stringify(en8.cuenta) === JSON.stringify(antes8.cuenta),
    `mismos _id: no se duplicó nada (antes ${JSON.stringify(antes8.cuenta)}, después ${JSON.stringify(en8.cuenta)})`);
  comprobar(en8.pj.dueño === 3 && en8.pj.nombre === antes8.pjNombre && en8.pj.bio && en8.pj.hambre === antes8.hambre,
    `el PJ con dueño jugador no se toca al cambiar de idioma («${en8.pj.nombre}», Hambre ${en8.pj.hambre})`);
  comprobar(en8.handout === 2 && en8.pagina === 2, "el handout entregado sigue revelado al cambiar de idioma");
  comprobar(en8.activa === antes8.activa, "la escena activa no cambia al cambiar de idioma");
  comprobar(en8.importada === 1, "Foundry anota la importación de aventura-en");

  // Muestra amplia de lo que se ve: un journal de cada carpeta (nombre, páginas y su HTML), un PNJ
  // con ventajas y poderes (Krell, PNJ-12), y una escena con salas (Helen: escena, regiones, luces).
  // Heurística de tools/contenido/verificar-traduccion.mjs: frases con palabras frecuentes del
  // castellano. Los nombres de los tiles (muebles[].desc) no se traducen todavía: no entran.
  const muestra = await page.evaluate(MOD => {
    const ES = new Set(["el", "los", "las", "que", "para", "con", "una", "del", "por", "pero", "está", "están", "también", "porque",
      "cuando", "entre", "sobre", "muy", "sus", "como", "más", "este", "esta", "eso", "esto", "hasta", "desde", "donde", "dónde", "qué", "nada", "todo", "todos"]);
    const CORTAS = ["y", "o", "en", "de", "la", "un", "es", "le", "lo", "se", "su", "ya"];
    const legible = s => String(s ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
    const malas = [];
    let revisados = 0;
    const revisar = (donde, s) => {
      revisados++;
      for (const f of legible(s).split(/(?<=[.!?:;])\s+|\n+/).map(x => x.trim()).filter(x => x.length > 12)) {
        const p = f.toLowerCase().match(/\p{L}+/gu) ?? [];
        const hits = p.filter(w => ES.has(w) || CORTAS.includes(w)).length, largas = p.filter(w => ES.has(w)).length;
        if (/[¿¡]/.test(f) || (p.length >= 4 && largas >= 2 && hits / p.length > 0.18)) { malas.push(`${donde}: «${f.slice(0, 80)}»`); return; }
      }
    };
    const gen = d => !!d.getFlag(MOD, "origen");
    const porCarpeta = new Map();
    for (const j of game.journal.filter(gen)) if (!porCarpeta.has(j.folder?.id ?? null)) porCarpeta.set(j.folder?.id ?? null, j);
    for (const j of porCarpeta.values()) {
      revisar(`journal ${j.name}`, j.name);
      for (const p of j.pages) { revisar(`${j.name} › ${p.name}`, p.name); revisar(`${j.name} › ${p.name}`, p.text?.content); }
    }
    const krell = game.actors.find(a => a.getFlag(MOD, "id") === "PNJ-12");
    revisar("Krell", krell.system.biography);
    revisar("Krell (piedras de toque)", krell.system.headers?.touchstones);
    const ventajas = krell.items.filter(i => i.type === "feature"), poderes = krell.items.filter(i => i.type === "power");
    for (const i of krell.items) { revisar(`Krell › ${i.name}`, i.name); revisar(`Krell › ${i.name}`, i.system.description); }
    const helen = game.scenes.find(s => s.getFlag(MOD, "plano") === "helen");
    revisar("escena Helen", helen.name);
    revisar("escena Helen (nota)", helen.getFlag(MOD, "nota"));
    for (const r of helen.regions) revisar(`escena Helen › región`, r.name);
    return { carpetas: porCarpeta.size, revisados, malas, ventajas: ventajas.map(i => i.name), poderes: poderes.map(i => i.name),
      regiones: helen.regions.contents.slice(0, 3).map(r => r.name) };
  }, MOD);
  console.log("  ", JSON.stringify({ ...muestra, malas: muestra.malas.slice(0, 8) }));
  comprobar(muestra.carpetas >= 10 && muestra.ventajas.length > 0 && muestra.poderes.length > 0 && muestra.malas.length === 0,
    `muestra en inglés sin castellano suelto: ${muestra.carpetas} carpetas, ${muestra.revisados} textos (Krell: ${muestra.ventajas.join(", ")} · ${muestra.poderes.join(", ")}; Helen: ${muestra.regiones.join(" · ")})${muestra.malas.length ? ` · ${muestra.malas.length} sospechosos` : ""}`);

  // Los avisos al Narrador con la interfaz en inglés (el cliente arma el texto con lang/en.json).
  await idiomaCliente(page, "en");
  const chatEn = await page.evaluate(async MOD => {
    const api = game.modules.get(MOD).api;
    const espera = ms => new Promise(r => setTimeout(r, ms));
    await game.settings.set(MOD, "termometro", { valor: 2, congelado: false, registro: [] });
    await espera(200);
    const n = game.messages.size;
    await api.termometro(+1, "e2e: inglés");
    await espera(800);
    const nuevos = game.messages.contents.slice(n);
    const html = [];
    for (const m of nuevos) html.push((await m.renderHTML()).querySelector(".sbn-chat h4")?.textContent ?? "");
    for (const m of nuevos) await m.delete();
    await game.settings.set(MOD, "termometro", { valor: 2, congelado: false, registro: [] });
    return { lang: game.i18n.lang, titulos: html.filter(Boolean), indicador: game.i18n.localize("SBN.indicador.termometro") };
  }, MOD);
  console.log("  ", JSON.stringify(chatEn));
  comprobar(chatEn.lang === "en" && chatEn.titulos.some(t => /Thermometer 3/.test(t)) && chatEn.indicador === "Thermometer",
    `con Foundry en inglés, los avisos y la interfaz salen en inglés («${chatEn.titulos.join(" | ")}»)`);
  await captura("ingles");

  // De vuelta al castellano: la misma operación con la otra Aventura.
  await page.evaluate(MOD => game.modules.get(MOD).api.importarCronica({ idioma: "es", silencioso: true }), MOD);
  await page.waitForTimeout(1500);
  const es8 = await page.evaluate(([MOD, ids, a]) => ({
    idioma: game.modules.get(MOD).api.idioma(),
    archivo: game.modules.get(MOD).api.Datos.archivo,
    nombres: ids.map(id => game.journal.find(j => j.getFlag(MOD, "id") === id)?.name ?? null),
    pj: game.actors.get(a.pj).ownership[a.jugador]
  }), [MOD, traducidos.map(t => t.id), antes8]);
  const distintosEs = traducidos.filter((t, i) => limpio(es8.nombres[i]) !== limpio(t.es));
  comprobar(es8.idioma === "es" && es8.archivo === "data/cronica.json" && !distintosEs.length && es8.pj === 3,
    `volver a importar en castellano deja todo como estaba (${es8.nombres.slice(0, 4).join(" · ")}…)${distintosEs.length ? ` · distintos: ${distintosEs.slice(0, 3).map(t => t.id).join(", ")}` : ""}`);
  await idiomaCliente(page, "es");
} else if (hayPacks) {
  console.log("\n8. (sin el compendio aventura-en compilado: se saltea el inglés)");
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

// Recargar el GM: el chat se dibuja antes de que llegue data/cronica.json; los avisos ya
// en pantalla se repintan en `ready` con el contenido real (main.mjs, repintarAvisos).
await page.reload({ waitUntil: "networkidle" });
await listo();
await page.waitForFunction(id => !!game.modules.get(id)?.api, MOD, { timeout: 30000 });
await page.waitForTimeout(1500);
const recarga = await page.evaluate(MOD => {
  const lis = [...ui.chat.element.querySelectorAll(".message[data-message-id]")]
    .filter(li => game.messages.get(li.dataset.messageId)?.getFlag(MOD, "aviso")?.tipo !== "azar")
    .filter(li => game.messages.get(li.dataset.messageId)?.getFlag(MOD, "aviso"));
  return { avisos: lis.length, conTitulo: lis.filter(li => li.querySelector(".message-content .sbn-chat h4")).length };
}, MOD);
comprobar(recarga.avisos > 0 && recarga.conTitulo === recarga.avisos, `al recargar, los avisos del log se ven con su contenido real (${recarga.conTitulo}/${recarga.avisos})`);

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

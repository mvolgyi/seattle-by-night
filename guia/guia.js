/* Guía del Narrador de El Expediente Ward — seguimiento de la partida.
   Copiado de la guía de DVV. Todo vive en localStorage ("sbn-guia"): escenas
   jugadas, Termómetro (valor, congelado, registro), noche del Reloj, pistas y
   notas; se exporta e importa como JSON. Los botones del módulo que vienen en
   el texto (.sbn-termometro, .sbn-pista, .sbn-reloj) mueven esta mesa, no la
   de Foundry. Los datos fijos (umbrales, noches, pistas) los pone el build en
   <script id="datos-guia">, con `textos` (castellano → inglés) en la guía en
   inglés (tools/construir-guia.mjs --idioma en). */
(() => {
  const CLAVE = "sbn-guia";
  const DATOS = JSON.parse(document.getElementById("datos-guia")?.textContent || "{}");
  /** Texto fijo de la mesa en el idioma de la guía: T("Noche {n}", { n: 3 }). */
  const T = (es, vars = {}) => (DATOS.textos?.[es] ?? es).replace(/\{(\w+)\}/g, (todo, k) => (k in vars ? String(vars[k]) : todo));
  const MIN = DATOS.min ?? 0, MAX = DATOS.max ?? 10, NOCHES = DATOS.noches ?? [], UMBRALES = DATOS.umbrales ?? [];
  const nuevo = () => ({ hecho: {}, termometro: { valor: DATOS.inicio ?? 0, congelado: false, registro: [] }, noche: 1, pistas: {}, notas: {}, tab: null });
  let estado = nuevo();
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) || "{}");
    estado = { ...estado, ...guardado, termometro: { ...estado.termometro, ...(guardado.termometro ?? {}) } };
  } catch { /* sin almacenamiento: la página funciona igual */ }
  const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch { /* navegación privada */ } };

  /* ---- aviso efímero ---- */
  const aviso = document.querySelector("[data-aviso]");
  let tAviso;
  const avisar = texto => {
    if (!aviso) return;
    aviso.textContent = texto; aviso.hidden = false;
    clearTimeout(tAviso); tAviso = setTimeout(() => { aviso.hidden = true; }, 4200);
  };

  /* ---- casillas «Jugada» ---- */
  const casillas = [...document.querySelectorAll("input[data-hecho]")];
  const pintarCasilla = c => {
    c.checked = !!estado.hecho[c.dataset.hecho];
    c.closest(".banda, .banda-foto")?.classList.toggle("lista", c.checked);
  };
  for (const c of casillas) {
    pintarCasilla(c);
    c.addEventListener("change", () => { if (c.checked) estado.hecho[c.dataset.hecho] = true; else delete estado.hecho[c.dataset.hecho]; pintarCasilla(c); guardar(); progreso(); });
  }
  function progreso() {
    const hechas = casillas.filter(c => c.checked).length;
    for (const p of document.querySelectorAll("[data-progreso]")) {
      p.textContent = p.dataset.progreso === "cronica"
        ? T("{n} de {total} jugadas", { n: hechas, total: casillas.length })
        : T("{n} de {total} escenas y partes jugadas ({pct} %)", { n: hechas, total: casillas.length, pct: casillas.length ? Math.round(hechas / casillas.length * 100) : 0 });
    }
  }
  progreso();

  /* ---- Termómetro ---- */
  const umbralDe = v => UMBRALES.filter(u => u.valor <= v).at(-1) ?? null;
  const enlaceDestino = d => d.ancla ? `<a href="#${d.ancla}">${d.id}</a>` : d.id;
  function pintarTermometro() {
    const { valor, congelado, registro } = estado.termometro;
    for (const b of document.querySelectorAll("[data-termo-valor]")) b.textContent = valor;
    for (const esc of document.querySelectorAll("[data-escala]")) {
      esc.classList.toggle("congelado", congelado);
      for (const li of esc.children) {
        const v = Number(li.dataset.v);
        li.classList.toggle("on", v <= valor && v > MIN);
        li.classList.toggle("actual", v === valor);
      }
    }
    const boton = document.querySelector("[data-termo-congelar]");
    if (boton) { boton.setAttribute("aria-pressed", String(congelado)); boton.textContent = congelado ? T("Congelado") : T("Congelar"); }
    const u = umbralDe(valor), p = document.querySelector("[data-termo-umbral]");
    if (p) {
      p.innerHTML = "";
      if (u) {
        const b = document.createElement("b"); b.textContent = `${u.icono} ${u.valor} · `;
        p.append(b, document.createTextNode(u.texto));
        if (u.destino.length) { const s = document.createElement("span"); s.innerHTML = ` → ${u.destino.map(enlaceDestino).join(" · ")}`; p.append(s); }
      } else p.textContent = T("Ningún umbral cruzado todavía.");
      if (congelado) p.append(document.createTextNode(T(" (congelado: no sube)")));
    }
    const ol = document.querySelector("[data-termo-registro]");
    if (ol) {
      ol.innerHTML = "";
      for (const r of [...registro].reverse().slice(0, 40)) {
        const li = document.createElement("li");
        li.textContent = `${r.de} → ${r.a}${r.motivo ? `: ${r.motivo}` : ""}${r.noche ? T(" (noche {n})", { n: r.noche }) : ""}`;
        ol.append(li);
      }
    }
  }
  /** cambio: "+1", "-2", "=10", "congelar", "descongelar". */
  function moverTermometro(cambio, motivo = "") {
    const t = estado.termometro, de = t.valor;
    if (cambio === "congelar" || cambio === "descongelar") {
      t.congelado = cambio === "congelar";
      t.registro.push({ de, a: de, motivo: `${t.congelado ? T("Congelado") : T("Descongelado")}${motivo ? `: ${motivo}` : ""}`, noche: estado.noche });
      guardar(); pintarTermometro(); avisar(t.congelado ? T("Termómetro congelado: no sube hasta que lo descongeles.") : T("Termómetro descongelado."));
      return;
    }
    let a = de;
    if (/^=\s*\d+$/.test(cambio)) a = Number(cambio.replace(/[=\s]/g, ""));
    else if (Number.isFinite(Number(cambio))) a = de + Number(cambio);
    a = Math.max(MIN, Math.min(MAX, a));
    if (t.congelado && a > de) { avisar(T("El Termómetro está congelado: no sube.")); return; }
    if (a === de) { avisar(T("El Termómetro ya está en {n}: no cambia.", { n: de })); return; }
    t.valor = a;
    t.registro.push({ de, a, motivo, noche: estado.noche });
    guardar(); pintarTermometro();
    const cruzado = UMBRALES.filter(u => (a > de ? u.valor > de && u.valor <= a : u.valor <= de && u.valor > a)).at(-1);
    avisar(`${T("Termómetro")} ${de} → ${a}${motivo ? ` · ${motivo}` : ""}${cruzado && a > de ? ` · ${T("Umbral {n}", { n: cruzado.valor })}: ${cruzado.texto}` : ""}`);
  }
  for (const b of document.querySelectorAll("[data-termo]")) b.addEventListener("click", () => moverTermometro(b.dataset.termo, T("a mano")));
  document.querySelector("[data-termo-congelar]")?.addEventListener("click", () => moverTermometro(estado.termometro.congelado ? "descongelar" : "congelar"));
  pintarTermometro();

  /* ---- Reloj ---- */
  function pintarNoche() {
    const caja = document.querySelector("[data-noche]");
    if (caja) caja.querySelector("b").textContent = estado.noche;
    const n = NOCHES.find(x => x.n === estado.noche), p = document.querySelector("[data-noche-texto]");
    if (p) {
      p.innerHTML = "";
      if (n) {
        const b = document.createElement("b"); b.textContent = `${T("Noche {n}", { n: n.n })} · ${n.dia} `;
        p.append(b, document.createTextNode(n.evento));
        if (n.ancla) { const a = document.createElement("a"); a.href = `#${n.ancla}`; a.textContent = T(" Ver la noche →"); p.append(a); }
      }
    }
    for (const s of document.querySelectorAll(".sbn-reloj[data-sbn-reloj]")) {
      const v = Number(s.dataset.sbnReloj);
      s.classList.toggle("sbn-actual", v === estado.noche);
      s.classList.toggle("sbn-pasada", v < estado.noche);
    }
  }
  const caja = document.querySelector("[data-noche]");
  const maxNoche = NOCHES.length || 8;
  caja?.querySelector("[data-mas]").addEventListener("click", () => { estado.noche = Math.min(maxNoche, estado.noche + 1); guardar(); pintarNoche(); });
  caja?.querySelector("[data-menos]").addEventListener("click", () => { estado.noche = Math.max(1, estado.noche - 1); guardar(); pintarNoche(); });
  pintarNoche();

  /* ---- pistas ---- */
  function pintarPistas() {
    for (const b of document.querySelectorAll("button.sbn-pista[data-sbn-pista]")) b.classList.toggle("sbn-obtenida", !!estado.pistas[b.dataset.sbnPista]);
    for (const c of document.querySelectorAll("[data-pista-mesa]")) c.checked = !!estado.pistas[c.dataset.pistaMesa];
    const n = Object.keys(estado.pistas).length, cuenta = document.querySelector("[data-pistas-cuenta]");
    if (cuenta) cuenta.textContent = T("{n} de {total}", { n, total: (DATOS.pistas ?? []).length });
  }
  const marcarPista = (id, si) => {
    if (si) estado.pistas[id] = true; else delete estado.pistas[id];
    guardar(); pintarPistas();
    const p = (DATOS.pistas ?? []).find(x => x.id === id);
    avisar(`${id}${p ? ` · ${p.nombre}` : ""}: ${si ? T("obtenida") : T("desmarcada")}`);
  };
  for (const c of document.querySelectorAll("[data-pista-mesa]")) c.addEventListener("change", () => marcarPista(c.dataset.pistaMesa, c.checked));
  pintarPistas();

  /* ---- los botones del módulo dentro del texto ---- */
  document.addEventListener("click", e => {
    const termo = e.target.closest("button.sbn-termometro[data-sbn-termometro]");
    if (termo) { e.preventDefault(); moverTermometro(termo.dataset.sbnTermometro, termo.dataset.motivo ?? ""); return; }
    const pista = e.target.closest("button.sbn-pista[data-sbn-pista]");
    if (pista) { e.preventDefault(); marcarPista(pista.dataset.sbnPista, !estado.pistas[pista.dataset.sbnPista]); return; }
    const reloj = e.target.closest(".sbn-reloj[data-sbn-reloj]");
    if (reloj) {
      const n = NOCHES.find(x => x.n === Number(reloj.dataset.sbnReloj));
      if (n?.ancla) { location.hash = n.ancla; }
    }
  });
  for (const t of document.querySelectorAll(".sbn-tirada")) t.title = T("Tirada: {label}. Se tira desde el journal en Foundry.", { label: t.dataset.label ?? "" });
  for (const t of document.querySelectorAll("button.sbn-termometro")) t.title = T("Mueve el Termómetro de La mesa");
  for (const t of document.querySelectorAll("button.sbn-pista")) t.title = T("Marca o desmarca la pista en La mesa");

  /* ---- cambio de idioma: la otra guía, en el mismo punto (las anclas son las mismas) ---- */
  for (const a of document.querySelectorAll("a[data-idioma]")) {
    a.addEventListener("click", () => { a.href = a.getAttribute("href").split("#")[0] + location.hash; });
  }

  /* ---- notas ---- */
  for (const t of document.querySelectorAll("textarea[data-notas]")) {
    t.value = estado.notas[t.dataset.notas] ?? "";
    t.addEventListener("input", () => { estado.notas[t.dataset.notas] = t.value; guardar(); });
  }

  /* ---- pestañas de la aventura ---- */
  const tabs = [...document.querySelectorAll(".tab")], paneles = [...document.querySelectorAll(".panel")];
  const activar = (id, recordar = true) => {
    for (const t of tabs) t.classList.toggle("activa", t.dataset.tab === id);
    for (const p of paneles) p.classList.toggle("activa", p.dataset.panel === id);
    if (recordar) { estado.tab = id; guardar(); }
    // En el teléfono las pestañas son una fila con scroll: que la activa quede a la vista.
    const t = tabs.find(x => x.dataset.tab === id), fila = t?.parentElement;
    if (t && fila && fila.scrollWidth > fila.clientWidth) fila.scrollLeft = t.offsetLeft - 16;
  };
  for (const t of tabs) t.addEventListener("click", () => {
    activar(t.dataset.tab);
    history.replaceState(null, "", `#${t.dataset.tab}`);
    document.getElementById("cronica")?.scrollIntoView({ block: "start" });
  });
  if (estado.tab && tabs.some(t => t.dataset.tab === estado.tab)) activar(estado.tab, false);
  /** Un enlace a algo dentro de una pestaña inactiva o de un desplegable cerrado lo abre. */
  const abrirDestino = () => {
    const el = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (!el) return;
    const panel = el.closest(".panel");
    if (panel && !panel.classList.contains("activa")) activar(panel.dataset.panel);
    for (let d = el.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
    if (el.tagName === "DETAILS") el.open = true;
    requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
  };
  window.addEventListener("hashchange", abrirDestino);
  abrirDestino();

  /* ---- la mesa ---- */
  const mesa = document.getElementById("mesa");
  const abrir = () => { mesa.hidden = false; mesa.querySelector("button").focus(); };
  const cerrar = () => { mesa.hidden = true; };
  for (const b of document.querySelectorAll("[data-abrir-mesa]")) b.addEventListener("click", abrir);
  for (const b of document.querySelectorAll("[data-cerrar-mesa]")) b.addEventListener("click", cerrar);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !mesa.hidden) cerrar(); });

  document.querySelector("[data-exportar]")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ ...estado, exportado: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `seattle-by-night-partida-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
  });
  document.querySelector("[data-importar]")?.addEventListener("change", async e => {
    const f = e.target.files?.[0]; if (!f) return;
    if (!confirm(T("Importar reemplaza el seguimiento guardado en este navegador. ¿Seguir?"))) { e.target.value = ""; return; }
    try {
      const d = JSON.parse(await f.text());
      if (!d || typeof d !== "object" || !d.termometro) throw new Error();
      const base = nuevo();
      estado = { hecho: d.hecho ?? {}, termometro: { ...base.termometro, ...d.termometro }, noche: d.noche ?? 1, pistas: d.pistas ?? {}, notas: d.notas ?? {}, tab: d.tab ?? null };
      guardar(); location.reload();
    } catch { alert(T("Ese archivo no es una partida exportada desde esta guía. Exportá una desde La mesa y volvé a intentarlo.")); }
  });
  document.querySelector("[data-reiniciar]")?.addEventListener("click", () => {
    if (!confirm(T("¿Borrar el seguimiento (escenas jugadas, Termómetro, noche, pistas y notas)?"))) return;
    estado = nuevo(); guardar(); location.reload();
  });

  /* ---- barra fija: aparece al dejar atrás la portada ---- */
  const barra = document.querySelector("[data-barra]"), arriba = document.querySelector("[data-arriba]"), portada = document.getElementById("inicio");
  if (barra && portada && "IntersectionObserver" in window) {
    new IntersectionObserver(([en]) => { barra.classList.toggle("visible", !en.isIntersecting); if (arriba) arriba.hidden = en.isIntersecting; }, { threshold: 0.05 }).observe(portada);
  }
  arriba?.addEventListener("click", () => window.scrollTo({ top: 0 }));

  /* ---- buscador: ir a una escena, un PNJ, un lugar, un ID ---- */
  const lista = document.getElementById("destinos"), buscar = document.getElementById("buscar");
  const destinos = [];
  for (const el of document.querySelectorAll("main [id]")) {
    const t = el.querySelector(":scope > .banda-cab h3, :scope > summary h3, :scope > summary h4, :scope > .bf-texto > h2, :scope > .bf-texto > h3, :scope > .banda-foto > .bf-texto > h3, :scope > .ficha-cuerpo > h4, :scope > figcaption > b, :scope > h3");
    const nombre = (t?.textContent ?? "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
    if (nombre && nombre.length < 100 && !destinos.some(d => d.nombre === nombre)) destinos.push({ id: el.id, nombre: /^[A-Z]+-\d/.test(el.id) && !nombre.startsWith(el.id) ? `${el.id} · ${nombre}` : nombre });
  }
  if (lista) lista.innerHTML = destinos.map(d => `<option value="${d.nombre.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></option>`).join("");
  const irA = texto => {
    const q = texto.trim().toLowerCase(); if (!q) return;
    const d = destinos.find(x => x.nombre.toLowerCase() === q) ?? destinos.find(x => x.id.toLowerCase() === q) ?? destinos.find(x => x.nombre.toLowerCase().includes(q));
    if (!d) return;
    if (location.hash.slice(1) === d.id) abrirDestino(); else location.hash = d.id;
  };
  buscar?.form?.addEventListener("submit", e => { e.preventDefault(); irA(buscar.value); });
  buscar?.addEventListener("change", () => irA(buscar.value));

  /* ---- visor de mapas: la imagen es el fondo del botón ---- */
  const visor = document.querySelector("[data-visor]");
  if (visor) {
    const img = visor.querySelector("img"), titulo = visor.querySelector("[data-visor-titulo]"), cuerpo = visor.querySelector(".visor-cuerpo");
    for (const b of document.querySelectorAll("[data-ampliar]")) b.addEventListener("click", () => {
      const m = /url\(["']?(.*?)["']?\)$/.exec(getComputedStyle(b).backgroundImage);
      if (!m) return;
      img.src = m[1]; img.alt = `${T("Mapa")}: ${b.dataset.ampliar}`; titulo.textContent = b.dataset.ampliar;
      cuerpo.classList.add("encajar"); visor.showModal();
    });
    // Un toque alterna entre «encajar» y tamaño real.
    cuerpo.addEventListener("click", e => { if (e.target === img) cuerpo.classList.toggle("encajar"); });
    visor.querySelector("[data-visor-cerrar]").addEventListener("click", () => visor.close());
    visor.addEventListener("click", e => { if (e.target === visor) visor.close(); });
  }

  /* ---- entradas por sección (una vez, en orden de lectura) ---- */
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
    const partes = document.querySelectorAll("main .seccion-cab, main > section > h2, .banda-foto, .regla, .ficha, .plano, .item, .paso");
    partes.forEach(el => el.classList.add("entra"));
    const io = new IntersectionObserver(entradas => {
      for (const en of entradas) {
        if (!en.isIntersecting) continue;
        const hermanos = [...en.target.parentElement.children].filter(h => h.classList.contains("entra") && !h.classList.contains("visible"));
        en.target.style.transitionDelay = `${Math.min(Math.max(0, hermanos.indexOf(en.target)), 6) * 60}ms`;
        en.target.classList.add("visible");
        io.unobserve(en.target);
      }
    }, { rootMargin: "0px 0px -6% 0px" });
    partes.forEach(el => io.observe(el));
  }
})();

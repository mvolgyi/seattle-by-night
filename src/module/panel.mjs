import { SBN } from "./constantes.mjs";
import { Datos } from "./datos.mjs";
import { Estado } from "./estado.mjs";
import { Botones } from "./botones.mjs";
import { TIPOS_QUE_TIRAN } from "./actores.mjs";
import { t, esc, exigirNarrador, enlaceHTML, documentoPorId, idsNarradores } from "./util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Panel del Narrador (SPEC §3, «Mecánicas del módulo»).
 *
 * Cuatro pestañas sobre el estado de la crónica (estado.mjs) y los datos
 * fijos de data/cronica.json (datos.mjs):
 *
 *   termometro  valor, umbrales, ±/fijar/congelar, movimientos de la noche, historial
 *   reloj       las 8 noches con su evento y escena; la actual marcada
 *   pistas      P-01…P-15 y las pruebas sin ID, marcables
 *   tiradas     A3-E04 y A4-E01: la reserva calculada, el desglose y la tirada
 *
 * Arriba, siempre visible, un resumen (y la Célula Puget si hay un actor
 * `group` de tipo `cell` en el mundo). El panel no guarda estado propio salvo
 * lo efímero de la mesa (qué actor tira, los éxitos anotados): todo lo demás
 * va a los settings vía Estado, y el hook `sbnEstado` lo vuelve a pintar.
 */
export class Panel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sbn-panel",
    tag: "div",
    classes: ["sbn-panel"],
    window: { title: "SBN.panel.titulo", icon: "fa-solid fa-book-skull", resizable: true },
    position: { width: 780, height: 760 },
    actions: {
      termometro: Panel.#onTermometro,
      fijar: Panel.#onFijar,
      congelar: Panel.#onCongelar,
      movimiento: Panel.#onMovimiento,
      noche: Panel.#onNoche,
      pista: Panel.#onPista,
      prueba: Panel.#onPrueba,
      tirar: Panel.#onTirar,
      tirarHalloway: Panel.#onTirarHalloway,
      azar: Panel.#onAzar,
      abrirActor: Panel.#onAbrirActor
    }
  };

  static PARTS = {
    resumen: { template: SBN.ruta("templates/panel-resumen.hbs") },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    termometro: { template: SBN.ruta("templates/panel-termometro.hbs"), scrollable: [""] },
    reloj: { template: SBN.ruta("templates/panel-reloj.hbs"), scrollable: [""] },
    pistas: { template: SBN.ruta("templates/panel-pistas.hbs"), scrollable: [""] },
    tiradas: { template: SBN.ruta("templates/panel-tiradas.hbs"), scrollable: [""] }
  };

  static TABS = {
    primary: {
      initial: "termometro",
      labelPrefix: "SBN.panel.tabs",
      tabs: [
        { id: "termometro", icon: "fa-solid fa-temperature-half" },
        { id: "reloj", icon: "fa-solid fa-moon" },
        { id: "pistas", icon: "fa-solid fa-magnifying-glass" },
        { id: "tiradas", icon: "fa-solid fa-dice-d10" }
      ]
    }
  };

  static #instancia = null;

  /** Abre el panel (o lo trae al frente). `tab`: termometro, reloj, pistas o tiradas. */
  static abrir({ tab } = {}) {
    if (!exigirNarrador()) return null;
    this.#instancia ??= new this();
    this.#instancia.render({ force: true, ...(tab ? { tab } : {}) });
    return this.#instancia;
  }

  static get instancia() {
    return this.#instancia;
  }

  static refrescar() {
    if (this.#instancia?.rendered) this.#instancia.render();
  }

  /**
   * ¿Un cambio en este actor cambia lo que muestra el panel? La Célula (resumen),
   * los actores del módulo (PJ, Halloway, los que tiran) y los de jugadores
   * (que aparecen en «quién tira»). El resto de los updateActor no repinta.
   */
  static actorDelPanel(actor) {
    if (!actor || !this.#instancia?.rendered) return false;
    if (actor.type === "group" && actor.system?.groupType === "cell") return true;
    return !!actor.getFlag?.(SBN.ID, SBN.FLAGS.ORIGEN) || !!actor.hasPlayerOwner;
  }

  /* -------------------------------------------- */
  /*  Estado efímero de la mesa                   */
  /* -------------------------------------------- */

  /** Qué actor tira cada tirada clave, la ruta de A4-E01 y los éxitos anotados. */
  #mesa = {
    motivo: "",
    actor: { "A3-E04": null, "A4-E01": null },
    ruta: 0,
    exitos: { coterie: null, halloway: null }
  };

  /* -------------------------------------------- */
  /*  Contexto                                    */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const e = Estado.estado();
    return {
      tabs: this._prepareTabs("primary"),
      estado: e,
      cargado: Datos.listos,
      resumen: this.#resumen(e),
      termometro: this.#termometro(e),
      reloj: this.#reloj(e),
      pistas: this.#pistas(e),
      tiradas: this.#tiradas(e)
    };
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.tab = context.tabs?.[partId];
    return context;
  }

  #resumen(e) {
    const umbral = Estado.umbralDe(e.termometro.valor);
    const celula = Panel.celula();
    return {
      termometro: e.termometro.valor,
      max: Datos.termometro.max,
      congelado: e.termometro.congelado,
      icono: umbral?.icono ?? "",
      umbral: umbral?.texto ?? "",
      noche: e.noche,
      dia: Estado.textoNoche(e.noche, "dia"),
      pistas: Object.keys(e.pistas).length,
      totalPistas: Datos.pistas.length,
      celula: celula ? {
        id: celula.id,
        nombre: celula.name,
        img: celula.img,
        desesperacion: celula.system.desperation?.value ?? 0,
        peligro: celula.system.danger?.value ?? 0,
        peligroMax: celula.system.danger?.max || 5
      } : null
    };
  }

  /**
   * La Célula Puget, si existe: un actor `group` con `system.groupType === "cell"`
   * (systems/wod5e/system/actor/data-models/group-actor-model.js y fields/cell-fields.js:
   * desperation.value, danger.value/max). El panel no depende de ella.
   */
  static celula() {
    const celulas = game.actors.filter(a => a.type === "group" && a.system?.groupType === "cell");
    return celulas.find(a => a.getFlag(SBN.ID, SBN.FLAGS.ORIGEN)) ?? celulas[0] ?? null;
  }

  /* -------------------------------------------- */

  #termometro(e) {
    const tm = e.termometro;
    const { min, max } = Datos.termometro;
    const marcas = new Set(Datos.umbrales.map(u => u.valor));
    const escala = Array.from({ length: max }, (_, i) => ({ n: i + 1, on: i + 1 <= tm.valor, umbral: marcas.has(i + 1) }));
    const actual = Estado.umbralDe(tm.valor);
    const umbrales = Datos.umbrales.map(u => ({
      ...u,
      alcanzado: u.valor <= tm.valor,
      actual: u.valor === actual?.valor,
      escenaHTML: u.escena ? enlaceHTML(u.escena, u.escena) : "",
      pnjHTML: u.pnj ? enlaceHTML(u.pnj) : ""
    }));

    return {
      valor: tm.valor, min, max, congelado: tm.congelado, escala, umbrales,
      motivo: this.#mesa.motivo,
      bajar: tm.congelado || tm.valor <= min,
      subir: tm.congelado || tm.valor >= max,
      grupos: this.#movimientosRapidos(e),
      evitar: Datos.termometro.evitar.map(x => ({ ...x, escenaHTML: x.escena ? enlaceHTML(x.escena, x.escena) : "" })),
      condiciones: Datos.termometro.condiciones,
      registro: tm.registro.slice().reverse().map(r => ({
        ...r,
        fechaCorta: new Date(r.fecha).toLocaleString(game.i18n.lang, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
        sube: r.valorDespues > r.valorAntes,
        baja: r.valorDespues < r.valorAntes
      }))
    };
  }

  /**
   * Botones rápidos: lo que el libro dice que mueve el Termómetro, agrupado por
   * lo que importa en mesa ahora: la noche actual (sus movimientos y los de sus
   * escenas), el mapa abierto (por lugar) y lo que vale en cualquier escena.
   * El resto, plegado.
   */
  #movimientosRapidos(e) {
    const noche = Datos.noche(e.noche);
    const escenasNoche = new Set(noche?.escenas ?? []);
    const lugar = canvas?.scene?.getFlag(SBN.ID, SBN.FLAGS.ID_LIBRO) ?? null;
    const usados = new Set();
    const congelado = e.termometro.congelado;
    const registro = e.termometro.registro;

    const boton = m => {
      // Tope «por escena» (cámaras corporales: +2): se cuenta por noche, que es lo que el módulo sabe.
      const veces = m.id ? registro.filter(r => r.movimiento === m.id && r.noche === e.noche).length : 0;
      const tope = Number(m.maximo) || null;
      const esCongelar = /^(des)?congelar$/.test(m.cambio);
      return {
        ...m,
        clase: esCongelar ? "sbn-mov-congelar" : (String(m.cambio).startsWith("-") ? "sbn-mov-baja" : "sbn-mov-sube"),
        escenaHTML: m.escena ? enlaceHTML(m.escena, m.escena) : "",
        tope, veces,
        topeTexto: tope ? t("panel.termometro.tope", { veces, tope }) : "",
        deshabilitado: (congelado && !esCongelar) || (tope && veces >= tope)
      };
    };
    const tomar = (lista, filtro) => lista.filter(m => !usados.has(m.id) && filtro(m)).map(m => {
      usados.add(m.id);
      return boton(m);
    });

    const todos = Datos.movimientos;
    // id estable de data/cronica.json («noche-5-la-subasta-de…»): lo guarda el registro.
    const propiosNoche = (noche?.movimientos ?? []).map((m, i) => ({ ...m, id: m.id ?? `noche-${e.noche}-${i + 1}`, noche: e.noche }));
    // «Cada entrega de ARQUERO (Noches 2 y 5)» ya está en los movimientos de esas noches.
    const delaNoche = [
      ...propiosNoche.map(boton),
      ...tomar(todos, m => !(m.noches && propiosNoche.length) && (
        m.noche === e.noche || m.noches?.includes(e.noche) || escenasNoche.has(m.escena)))
    ];
    const delMapa = lugar ? tomar(todos, m => m.lugar === lugar) : [];
    const siempre = tomar(todos, m => !m.escena && !m.noche && !m.noches && !m.lugar && !m.gancho && !m.desenlace);
    const resto = tomar(todos, () => true);

    return [
      { id: "noche", titulo: t("panel.termometro.grupoNoche", { n: e.noche, dia: noche?.dia ?? "" }), movimientos: delaNoche, abierto: true },
      ...(lugar ? [{ id: "mapa", titulo: t("panel.termometro.grupoMapa", { lugar: Datos.nombre(lugar) }), movimientos: delMapa, abierto: true }] : []),
      { id: "siempre", titulo: t("panel.termometro.grupoSiempre"), movimientos: siempre, abierto: true },
      { id: "resto", titulo: t("panel.termometro.grupoResto"), movimientos: resto, abierto: false }
    ].filter(g => g.movimientos.length);
  }

  /* -------------------------------------------- */

  #reloj(e) {
    return {
      actual: e.noche,
      total: Datos.totalNoches,
      primera: e.noche <= 1,
      ultima: e.noche >= Datos.totalNoches,
      noches: Datos.noches.map(n => ({
        ...n,
        actual: n.n === e.noche,
        pasada: n.n < e.noche,
        escenaHTML: n.escena ? enlaceHTML(n.escena) : "",
        otrasHTML: (n.escenas ?? []).filter(x => x !== n.escena).map(x => enlaceHTML(x, x)),
        fechaLarga: n.fecha ? new Date(`${n.fecha}T12:00:00`).toLocaleDateString(game.i18n.lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""
      })),
      variantes: Datos.variantesReloj.map(v => ({ ...v, escenaHTML: v.escena ? enlaceHTML(v.escena, v.escena) : "" }))
    };
  }

  /* -------------------------------------------- */

  #pistas(e) {
    const chips = d => Object.entries(d ?? {}).filter(([, v]) => v).map(([tirada, v]) => ({ tirada, texto: `${tirada} ${v > 0 ? "+" : ""}${v}` }));
    const pistas = Datos.pistas.map(p => ({
      ...p,
      obtenida: !!e.pistas[p.id],
      nombreHTML: enlaceHTML(p.id, p.nombre),
      escenaHTML: p.escena ? enlaceHTML(p.escena, p.escena) : "",
      otrasHTML: p.escenas.filter(x => x !== p.escena).map(x => enlaceHTML(x, x)),
      chips: chips(p.dados)
    }));
    const pruebas = Datos.pruebas.map(p => ({
      ...p,
      marcada: !!e.pruebas[p.id],
      escenaHTML: p.escena ? enlaceHTML(p.escena, p.escena) : "",
      chips: chips(p.dados)
    }));
    return { pistas, pruebas, obtenidas: pistas.filter(p => p.obtenida).length, total: pistas.length };
  }

  /* -------------------------------------------- */
  /*  Tiradas clave                               */
  /* -------------------------------------------- */

  /**
   * Actores que pueden tirar: los PJ del libro (PJ-01…), los de jugadores y
   * los que tienen token en la escena; si no hay ninguno, todos los que el
   * Narrador controla. Primero los PJ.
   */
  static actoresParaTirar() {
    const tiran = game.actors.filter(a => TIPOS_QUE_TIRAN.has(a.type) && a.isOwner);
    const esPJ = a => String(a.getFlag(SBN.ID, SBN.FLAGS.ID_LIBRO) ?? "").startsWith("PJ-");
    const enEscena = new Set(canvas?.scene?.tokens.map(tk => tk.actorId) ?? []);
    const cerca = tiran.filter(a => esPJ(a) || a.hasPlayerOwner || enEscena.has(a.id));
    const lista = cerca.length ? cerca : tiran;
    return lista.sort((a, b) => (esPJ(b) - esPJ(a)) || (b.hasPlayerOwner - a.hasPlayerOwner) || a.name.localeCompare(b.name, game.i18n.lang));
  }

  #actorDe(tirada, lista) {
    const elegido = lista.find(a => a.id === this.#mesa.actor[tirada]);
    if (elegido) return elegido;
    const token = canvas?.tokens?.controlled?.find(tk => lista.includes(tk.actor))?.actor;
    return token ?? lista.find(a => a.id === game.user.character?.id) ?? lista[0] ?? null;
  }

  /** «Manipulación + Persuasión» con los nombres del sistema (systems/wod5e/system/api/def/*). */
  static etiquetaRuta(paths) {
    return paths.map(p => {
      const [tipo, clave] = p.split(".");
      try {
        const lista = tipo === "attributes" ? WOD5E.Attributes.getList({}) : WOD5E.Skills.getList({});
        const def = lista?.[clave];
        if (def) return game.i18n.localize(def.displayName ?? def.label);
      } catch { /* sin wod5e: el nombre de la clave */ }
      return clave;
    }).join(" + ");
  }

  /** Base de la reserva: la suma de los valores del actor en esos paths (como getBasicDice de wod5e). */
  static base(actor, paths) {
    if (!actor) return { total: 0, partes: [] };
    const partes = paths.map(p => ({ path: p, etiqueta: Panel.etiquetaRuta([p]), valor: Number(foundry.utils.getProperty(actor.system, `${p}.value`)) || 0 }));
    return { total: partes.reduce((a, b) => a + b.valor, 0), partes };
  }

  #tiradas(e) {
    const lista = Panel.actoresParaTirar();
    const opciones = sel => lista.map(a => ({ id: a.id, nombre: a.name, sel: a.id === sel?.id }));
    return {
      a3: this.#a3(e, lista, opciones),
      a4: this.#a4(e, lista, opciones),
      hayActores: lista.length > 0
    };
  }

  /**
   * A3-E04 · La jauría duda. Manipulación + Persuasión (Dificultad 4) de quien
   * hable por la coterie, +1 por cada pista de P-07 a P-15 obtenida, más los
   * modificadores de las pruebas de la tirada (Krell presente +2, favor del
   * Sheriff +2, mentira en A1-E03 −2, honestidad de David +1…).
   */
  static calcularA3(estado, actor) {
    const d = Datos.tirada("A3-E04");
    if (!d) return null;
    const paths = d.rutas[0] ?? [];
    const base = Panel.base(actor, paths);
    const pistas = d.pistas.map(id => ({ id, nombre: Datos.nombre(id), activa: !!estado.pistas[id], cantidad: d.porPista }));
    const pruebas = d.pruebas.map(id => {
      const p = Datos.prueba(id);
      return { id, nombre: p?.nombre ?? id, activa: !!estado.pruebas[id], cantidad: p?.dados?.["A3-E04"] ?? 0, escena: p?.escena };
    });
    const porPistas = pistas.filter(p => p.activa).reduce((a, p) => a + p.cantidad, 0);
    const porPruebas = pruebas.filter(p => p.activa).reduce((a, p) => a + p.cantidad, 0);
    const extra = porPistas + porPruebas;
    return { d, paths, base, pistas, pruebas, porPistas, porPruebas, extra, total: Math.max(base.total + extra, 0), dificultad: d.dificultad };
  }

  #a3(e, lista, opciones) {
    const actor = this.#actorDe("A3-E04", lista);
    const c = Panel.calcularA3(e, actor);
    if (!c) return null;
    return {
      ...c,
      actor: actor ? { id: actor.id, nombre: actor.name } : null,
      actores: opciones(actor),
      ruta: Panel.etiquetaRuta(c.paths),
      escenaHTML: enlaceHTML("A3-E04"),
      pruebas: c.pruebas.map(p => ({ ...p, signo: p.cantidad > 0 ? `+${p.cantidad}` : String(p.cantidad), negativa: p.cantidad < 0 })),
      pistasObtenidas: c.pistas.filter(p => p.activa).length,
      desglose: Panel.#desglose(c.base, [
        { texto: t("panel.tiradas.porPistas", { n: c.pistas.filter(p => p.activa).length }), valor: c.porPistas },
        ...c.pruebas.filter(p => p.activa && p.cantidad).map(p => ({ texto: p.nombre, valor: p.cantidad }))
      ])
    };
  }

  /**
   * A4-E01 · El caso ante el Consejo. Manipulación o Carisma + Política
   * (Dificultad 4), +N dados por cada fila de la lista de comprobación que la
   * coterie tenga (pista obtenida o prueba marcada; P-13 y P-14 cuentan juntas
   * un dado), enfrentada con Halloway (10 dados; −2 si el Consejo se muda a la
   * Galería de Vidrio).
   */
  static calcularA4(estado, actor, ruta = 0) {
    const d = Datos.tirada("A4-E01");
    if (!d) return null;
    const paths = d.rutas[ruta] ?? d.rutas[0] ?? [];
    const base = Panel.base(actor, paths);
    const fila = v => {
      const pistas = (v.pistas ?? []).map(id => ({ id, nombre: Datos.nombre(id), activa: !!estado.pistas[id] }));
      const prueba = v.prueba ? { id: v.prueba, nombre: Datos.nombre(v.prueba), activa: !!estado.pruebas[v.prueba] } : null;
      const casilla = !v.pistas && !v.prueba ? { id: v.id, nombre: v.motivo ?? v.id, activa: !!estado.pruebas[v.id] } : null;
      const activa = pistas.some(p => p.activa) || !!prueba?.activa || !!casilla?.activa;
      return { ...v, pistas, prueba, casilla, activa, contra: v.a === "Halloway" };
    };
    const valores = d.valores.map(fila);
    const otros = d.otros.map(fila);
    const aFavor = [...valores, ...otros].filter(f => f.activa && !f.contra);
    const extra = aFavor.reduce((a, f) => a + f.cantidad, 0);
    const contraHalloway = otros.filter(f => f.activa && f.contra).reduce((a, f) => a + f.cantidad, 0);
    const halloway = Math.max((Number(d.oponente?.reserva) || 0) + contraHalloway, 0);
    return { d, paths, base, valores, otros, extra, total: Math.max(base.total + extra, 0), halloway, contraHalloway, dificultad: d.dificultad };
  }

  #a4(e, lista, opciones) {
    const actor = this.#actorDe("A4-E01", lista);
    const c = Panel.calcularA4(e, actor, this.#mesa.ruta);
    if (!c) return null;
    const signo = n => (n > 0 ? `+${n}` : String(n));
    const filas = l => l.map(f => ({ ...f, signo: signo(f.cantidad), etiqueta: f.prueba?.nombre ?? f.casilla?.nombre ?? f.pistas.map(p => p.nombre).join(" · ") }));

    // Margen: éxitos de la coterie menos los de Halloway, si el Narrador los anotó.
    const { coterie, halloway } = this.#mesa.exitos;
    const hayMargen = Number.isFinite(coterie) && Number.isFinite(halloway);
    const margen = hayMargen ? coterie - halloway : null;
    const resultados = c.d.resultados.map(r => ({
      ...r,
      marcado: hayMargen && (r.min === undefined || margen >= r.min) && (r.max === undefined || margen <= r.max)
    }));

    return {
      ...c,
      actor: actor ? { id: actor.id, nombre: actor.name } : null,
      actores: opciones(actor),
      rutas: c.d.rutas.map((p, i) => ({ i, etiqueta: Panel.etiquetaRuta(p), sel: i === this.#mesa.ruta })),
      ruta: Panel.etiquetaRuta(c.paths),
      escenaHTML: enlaceHTML("A4-E01"),
      oponente: { ...c.d.oponente, nombreHTML: enlaceHTML(c.d.oponente?.pnj), actor: !!Panel.actorHalloway() },
      valores: filas(c.valores),
      otros: filas(c.otros),
      desglose: Panel.#desglose(c.base, [...c.valores, ...c.otros]
        .filter(f => f.activa && !f.contra && f.cantidad)
        .map(f => ({ texto: f.prueba?.nombre ?? f.casilla?.nombre ?? f.pistas.filter(p => p.activa).map(p => p.id).join(" + "), valor: f.cantidad }))),
      exitos: { coterie: coterie ?? "", halloway: halloway ?? "" },
      margen: hayMargen ? signo(margen) : "",
      resultados,
      votacion: this.#votacion(e, c.d.votacion)
    };
  }

  #votacion(e, v) {
    if (!v) return null;
    const votos = e.votos;
    const tiene = id => !!(e.pistas[id] || e.pruebas[id]);
    const opciones = ["si", "no", "abstencion", "azar"];
    const primogenitos = v.primogenitos.map(p => ({
      ...p,
      nombreHTML: enlaceHTML(p.pnj),
      voto: votos[p.pnj],
      opciones: opciones.map(o => ({ valor: o, texto: t(`panel.votacion.votos.${o}`), sel: o === votos[p.pnj] })),
      azar: votos[p.pnj] === "azar",
      // Pistas por su número; pruebas por su nombre (su id es interno).
      apoyos: p.apoyos.map(id => ({ id, etiqueta: Datos.pista(id) ? id : Datos.nombre(id), nombre: Datos.nombre(id), tiene: tiene(id) })),
      cambiaria: p.apoyos.some(tiene) && votos[p.pnj] !== "no"
    }));
    const cuenta = o => primogenitos.filter(p => p.voto === o).length;
    const si = cuenta("si");
    const pendientes = cuenta("azar");
    let veredicto;
    if (si >= v.necesita) veredicto = "aprobada";
    else if (si + pendientes >= v.necesita) veredicto = "pendiente";
    else veredicto = "rechazada";
    return {
      ...v, primogenitos,
      cuenta: { si, no: cuenta("no"), abstencion: cuenta("abstencion"), azar: pendientes },
      veredicto, veredictoTexto: t(`panel.votacion.veredicto.${veredicto}`, { necesita: v.necesita, total: v.total })
    };
  }

  static #desglose(base, extras) {
    const lineas = [
      ...base.partes.map(p => ({ texto: p.etiqueta, valor: p.valor, base: true })),
      ...extras.filter(x => x.valor).map(x => ({ texto: x.texto, valor: x.valor > 0 ? `+${x.valor}` : String(x.valor) }))
    ];
    return lineas;
  }

  /** El actor de Halloway (PNJ-03) en el mundo, si se importó. */
  static actorHalloway() {
    const pnj = Datos.tirada("A4-E01")?.oponente?.pnj ?? "PNJ-03";
    const uuid = Datos.actor(pnj);
    const doc = uuid ? fromUuidSync(uuid, { strict: false }) : null;
    if (doc instanceof Actor) return doc;
    return game.actors.find(a => a.getFlag(SBN.ID, SBN.FLAGS.ID_LIBRO) === pnj) ?? null;
  }

  /* -------------------------------------------- */
  /*  Render: selects, inputs y <details>         */
  /* -------------------------------------------- */

  /** Qué <details> abrió o cerró el Narrador: cada movimiento repinta el panel y no se pierden. */
  #plegados = new Map();

  /** Clave de un <details> que sobrevive al re-render: parte, noche y grupo (o el texto del summary). */
  static #claveDetails(d) {
    const parte = d.closest("[data-application-part]")?.dataset.applicationPart ?? "";
    const noche = d.closest(".sbn-noche[data-n]")?.dataset.n ?? "";
    const nombre = d.dataset.grupo ?? d.querySelector(":scope > summary")?.firstChild?.textContent?.trim() ?? "";
    return `${parte}|${noche}|${nombre}`;
  }

  async _onRender(context, options) {
    await super._onRender?.(context, options);
    for (const d of this.element.querySelectorAll("details")) {
      const abierto = this.#plegados.get(Panel.#claveDetails(d));
      if (abierto !== undefined) d.open = abierto;
    }
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // `toggle` no burbujea: se escucha en captura. Lee el estado al dispararse (ya aplicado).
    this.element.addEventListener("toggle", ev => {
      if (ev.target instanceof HTMLDetailsElement) this.#plegados.set(Panel.#claveDetails(ev.target), ev.target.open);
    }, true);
    // Un solo listener delegado para lo que no es un clic (selects y números).
    this.element.addEventListener("change", ev => this.#onCambio(ev));
    // El motivo escrito sobrevive a los re-render (cada movimiento repinta el panel).
    this.element.addEventListener("input", ev => {
      if (ev.target.name === "sbn-motivo") this.#mesa.motivo = ev.target.value;
    });
  }

  async #onCambio(event) {
    const el = event.target.closest("[data-sbn-cambio]");
    if (!el) return;
    const tipo = el.dataset.sbnCambio;
    if (tipo === "actor") {
      this.#mesa.actor[el.dataset.tirada] = el.value || null;
      this.render({ parts: ["tiradas"] });
    } else if (tipo === "ruta") {
      this.#mesa.ruta = Number(el.value) || 0;
      this.render({ parts: ["tiradas"] });
    } else if (tipo === "exitos") {
      const v = el.value === "" ? null : Number(el.value);
      this.#mesa.exitos[el.dataset.lado] = Number.isFinite(v) ? v : null;
      this.render({ parts: ["tiradas"] });
    } else if (tipo === "voto") {
      await Estado.voto(el.dataset.pnj, el.value);
    }
  }

  /* -------------------------------------------- */
  /*  Acciones                                    */
  /* -------------------------------------------- */

  #motivo() {
    const v = this.element.querySelector("[name=sbn-motivo]")?.value?.trim();
    return v || t("panel.termometro.motivoManual");
  }

  static async #onTermometro(_event, target) {
    await Estado.termometro(Number(target.dataset.delta), this.#motivo());
  }

  static async #onFijar() {
    const v = Number(this.element.querySelector("[name=sbn-fijar]")?.value);
    if (!Number.isFinite(v)) return;
    await Estado.termometro(`=${v}`, this.#motivo());
  }

  static async #onCongelar() {
    await Estado.termometro(Estado.termometroActual.congelado ? "descongelar" : "congelar", this.#motivo());
  }

  static async #onMovimiento(_event, target) {
    const { cambio, motivo, movimiento } = target.dataset;
    await Estado.termometro(cambio, motivo, { movimiento });
  }

  static async #onNoche(_event, target) {
    const n = target.dataset.n ? Number(target.dataset.n) : Estado.nocheActual + Number(target.dataset.delta);
    await Estado.noche(n);
  }

  static async #onPista(_event, target) {
    const id = target.dataset.id;
    await Estado.pista(id, !Estado.obtenida(id));
  }

  static async #onPrueba(_event, target) {
    const id = target.dataset.id;
    await Estado.prueba(id, !Estado.marcada(id));
  }

  /** Tira A3-E04 o A4-E01 con el actor elegido, la reserva calculada y el desglose en el chat. */
  static async #onTirar(_event, target) {
    const id = target.dataset.tirada;
    const lista = Panel.actoresParaTirar();
    const actor = this.#actorDe(id, lista);
    if (!actor) return ui.notifications.warn(t("tirada.sinActor"));
    const e = Estado.estado();
    const c = id === "A3-E04" ? Panel.calcularA3(e, actor) : Panel.calcularA4(e, actor, this.#mesa.ruta);
    if (!c) return;
    const lineas = id === "A3-E04"
      ? [t("panel.tiradas.porPistas", { n: c.pistas.filter(p => p.activa).length }) + ` ${c.porPistas >= 0 ? "+" : ""}${c.porPistas}`,
        ...c.pruebas.filter(p => p.activa && p.cantidad).map(p => `${p.nombre} ${p.cantidad > 0 ? "+" : ""}${p.cantidad}`)]
      : [...c.valores, ...c.otros].filter(f => f.activa && !f.contra && f.cantidad)
        .map(f => `${f.prueba?.nombre ?? f.casilla?.nombre ?? f.pistas.filter(p => p.activa).map(p => p.id).join(" + ")} +${f.cantidad}`);
    const flavor = `${t("panel.tiradas.flavor", { base: c.base.total, extra: `${c.extra >= 0 ? "+" : ""}${c.extra}`, total: c.total })}${lineas.length ? ` (${lineas.join("; ")})` : ""}`;
    await Botones.tirar({
      actor,
      paths: c.paths,
      dificultad: c.dificultad,
      dados: c.extra,
      label: `${id} · ${c.d.nombre ?? ""} — ${Panel.etiquetaRuta(c.paths)}`,
      flavor: esc(flavor)
    });
  }

  /** La reserva de Halloway en A4-E01: número fijo (10, u 8 en la Galería de Vidrio). */
  static async #onTirarHalloway() {
    const actor = Panel.actorHalloway();
    if (!actor) return ui.notifications.warn(t("panel.tiradas.sinHalloway"));
    const c = Panel.calcularA4(Estado.estado(), null, this.#mesa.ruta);
    await Botones.tirar({
      actor,
      paths: c.d.rutas[0] ?? [],
      absoluto: c.halloway,
      dificultad: 0,
      label: t("panel.tiradas.tiradaHalloway", { texto: c.d.oponente?.texto ?? "", n: c.halloway }),
      flavor: c.contraHalloway ? esc(t("panel.tiradas.hallowayMenos", { n: c.contraHalloway })) : ""
    });
  }

  /** Fry (o quien tenga voto «imprevisible»): 1 dado, par sí, impar no. */
  static async #onAzar(_event, target) {
    const pnj = target.dataset.pnj;
    const roll = await new Roll("1d10").evaluate();
    const voto = roll.total % 2 === 0 ? "si" : "no";
    // v14: el modo va en las opciones (client/dice/roll.mjs, toMessage(messageData, { messageMode })).
    // Sin él, toMessage aplica el modo del chat del Narrador y ChatMessage.applyMode
    // (client/documents/chat-message.mjs) vacía el whisper si es «public».
    await roll.toMessage({
      flavor: t("panel.votacion.tiradaAzar", { nombre: esc(Datos.nombre(pnj)), voto: t(`panel.votacion.votos.${voto}`) }),
      whisper: idsNarradores()
    }, { messageMode: "gm" });
    await Estado.voto(pnj, voto);
  }

  static #onAbrirActor(_event, target) {
    const doc = target.dataset.actor ? game.actors.get(target.dataset.actor) : documentoPorId(target.dataset.id);
    doc?.sheet?.render(true);
  }
}

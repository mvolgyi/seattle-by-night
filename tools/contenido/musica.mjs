/**
 * content/musica.json → pack `playlists`, y el ambiente de cada escena.
 *
 * Adaptado de ambienteDe / AMBIENTE_POR_ESCENA / construirPlaylists de DVV
 * (tools/construir-contenido.mjs). Diferencias:
 *
 *   - El audio es assets/musica/<id>.ogg (lo genera tools/generar-musica.mjs
 *     con ACE-Step 1.5, en local); no hay campo `archivo`.
 *   - Una pista puede sonar en varias escenas: `escenas: [...]` (ids de plano
 *     de content/planos, y «portada»), en vez de un único `escena`. Dos
 *     escenas con la misma pista (los tres pisos de Gale Sentinel) no la
 *     cortan al pasar de una a otra: Playlists#_onChangeScene
 *     (client/documents/collections/playlists.mjs) sólo cambia el sonido si
 *     cambió el par playlist/playlistSound.
 *
 * Si falta el .ogg de una pista: aviso (no error), la pista no entra a la
 * lista y su escena queda sin ambiente. Así se puede construir antes de que
 * esté el audio, y nunca queda una escena apuntando a un sonido que no existe.
 *
 * Campos de Foundry v14 (common/documents/playlist.mjs, playlist-sound.mjs):
 * Playlist { name, description, sounds, channel, mode, playing, fade, folder,
 * sorting, seed, sort, ownership, flags, _stats }; PlaylistSound { name,
 * description, path, channel, playing, pausedTime, repeat, volume, fade,
 * sort, flags }. Scene { playlist, playlistSound } (common/documents/scene.mjs):
 * al activarla, Scene#_onUpdate llama a game.playlists._onChangeScene, que
 * reproduce el playlistSound.
 */
import fs from "node:fs";
import path from "node:path";
import { RAIZ, MODULO, STATS, escribirDoc } from "../util.mjs";
import { ID } from "./ids.mjs";
import { cargarPlanos } from "../construir-planos.mjs";

const PACK = "playlists";
const FUENTE = "content/musica.json";
export const DIR_MUSICA = "assets/musica";

/** CONST.PLAYLIST_MODES (common/constants.mjs). */
const MODOS = { sequential: 0, shuffle: 1, simultaneous: 2, soundboard: -1 };

const existe = rel => fs.existsSync(path.join(RAIZ, rel));
export const archivoDe = pista => `${DIR_MUSICA}/${pista.id}.ogg`;

let cache = null;
/** content/musica.json (o vacío si no está). */
export function cargarMusica() {
  if (!cache) cache = existe(FUENTE) ? JSON.parse(fs.readFileSync(path.join(RAIZ, FUENTE), "utf8")) : { listas: [] };
  return cache;
}

/**
 * { escena → { lista, pista } } con TODAS las pistas que nombran escenas,
 * tengan o no audio. La primera que la nombra gana (la repetición se avisa en
 * construir()).
 */
export function pistasPorEscena() {
  const mapa = new Map();
  for (const lista of cargarMusica().listas ?? []) {
    for (const pista of lista.pistas ?? []) {
      for (const e of pista.escenas ?? []) if (!mapa.has(e)) mapa.set(e, { lista, pista });
    }
  }
  return mapa;
}

/**
 * Ambiente de una escena (id de plano o «portada») para Scene.playlist /
 * Scene.playlistSound. Vacío si no tiene pista o si falta el .ogg.
 */
export function ambienteDe(escenaId) {
  const e = pistasPorEscena().get(escenaId);
  if (!e || !existe(archivoDe(e.pista))) return { playlist: null, playlistSound: null };
  return { playlist: ID.lista(e.lista.id), playlistSound: ID.pista(e.lista.id, e.pista.id) };
}

export async function construir(ctx) {
  const musica = cargarMusica();
  if (!existe(FUENTE)) { ctx.avisos.push(`musica: no hay ${FUENTE}; sin playlists`); return; }

  // Coherencia con las escenas: ids que existen, una pista por escena, toda escena con pista.
  const planos = cargarPlanos();
  const nombreDe = new Map([["portada", "El Expediente Ward (portada)"], ...planos.map(p => [p.id, p.nombre ?? p.id])]);
  const escenas = new Set(nombreDe.keys());
  const asignada = new Map();
  const idsPista = new Set();
  for (const lista of musica.listas ?? []) {
    if (!((lista.modo ?? "soundboard") in MODOS)) ctx.avisos.push(`musica: la lista ${lista.id} tiene modo «${lista.modo}» desconocido; va como soundboard`);
    for (const pista of lista.pistas ?? []) {
      const clave = `${lista.id}:${pista.id}`;
      if (idsPista.has(clave)) ctx.avisos.push(`musica: pista repetida ${clave}`);
      idsPista.add(clave);
      for (const e of pista.escenas ?? []) {
        if (!escenas.has(e)) ctx.avisos.push(`musica: la pista ${pista.id} nombra la escena «${e}», que no existe`);
        if (asignada.has(e)) ctx.avisos.push(`musica: la escena «${e}» está en ${asignada.get(e)} y en ${pista.id}; suena ${asignada.get(e)}`);
        else asignada.set(e, pista.id);
      }
    }
  }
  const sinPista = [...escenas].filter(e => !asignada.has(e));
  if (sinPista.length) ctx.avisos.push(`musica: escenas sin pista de ambiente: ${sinPista.join(", ")}`);

  let listas = 0, sonidos = 0;
  const faltan = [];
  for (const lista of musica.listas ?? []) {
    const pid = ID.lista(lista.id);
    const sounds = [];
    for (const [i, pista] of (lista.pistas ?? []).entries()) {
      const archivo = archivoDe(pista);
      if (!existe(archivo)) { faltan.push(pista.id); continue; }
      const sid = ID.pista(lista.id, pista.id);
      const en = pista.escenas ?? [];
      sounds.push({
        _id: sid,
        _key: `!playlists.sounds!${pid}.${sid}`,
        name: pista.nombre,
        description: en.length ? `Suena al activar: ${en.map(e => nombreDe.get(e) ?? e).join(" · ")}` : "Para lanzar a mano.",
        path: `modules/${MODULO}/${archivo}`,
        channel: "",
        playing: false,
        pausedTime: null,
        repeat: pista.repetir ?? true,
        volume: pista.volumen ?? 0.35,
        fade: pista.fundido ?? 2000,
        sort: i * 1000,
        flags: { [MODULO]: { origen: "pista", pista: pista.id, escenas: en } }
      });
    }
    escribirDoc(PACK, {
      _id: pid,
      _key: `!playlists!${pid}`,
      name: lista.nombre,
      description: lista.descripcion ?? "",
      sounds,
      channel: "music",
      mode: MODOS[lista.modo ?? "soundboard"] ?? MODOS.soundboard,
      playing: false,
      fade: 2000,
      folder: null,
      sorting: "m",
      seed: 0,
      sort: 0,
      ownership: { default: 0 },
      flags: { [MODULO]: { origen: "playlist", lista: lista.id } },
      _stats: STATS
    });
    listas++;
    sonidos += sounds.length;
  }
  if (faltan.length) {
    ctx.avisos.push(`musica: faltan ${faltan.length} audio(s) en ${DIR_MUSICA}/ (${faltan.join(", ")}): ` +
      "esas pistas no entran y sus escenas quedan sin ambiente (corré la generación de música)");
  }
  const conAmbiente = [...asignada.keys()].filter(e => ambienteDe(e).playlist).length;
  console.log(`playlists: ${listas} lista(s), ${sonidos} pista(s) con audio de ${idsPista.size}; ${conAmbiente} escena(s) con ambiente`);
}

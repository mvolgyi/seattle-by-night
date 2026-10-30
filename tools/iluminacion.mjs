/**
 * Pre-iluminación de escenas desde el plano.
 *
 * La luz NO se pinta en el mapa (MAPS_SPEC.md §2): se coloca como objetos
 * AmbientLight de Foundry. Un plano declara sus luces de dos formas:
 *
 *   - `plano.luces`: [{ x, y, preset, nombre? }] en metros (la lámpara del
 *     pasillo, la farola de la calle, el LED de una cámara de timbre).
 *   - `mueble.luz`: "<preset>" en un mueble (la lámpara de pie, el portátil
 *     abierto). La luz va al centro del mueble.
 *
 * Los radios bright/dim están en METROS: la escena mide en casillas de 1 m
 * (grid.distance 1, units "m"), así que no hay conversión. (DVV los tenía en
 * pies y los convertía al armar la escena; acá no.)
 */

import { PX_POR_M } from "./planos.mjs";

export const PRESETS = {
  // Lámpara de pie o de mesa, cálida. La «única ventana iluminada» de Market Street.
  lampara: {
    bright: 2.4, dim: 6, color: "#ffc77a", alpha: 0.45,
    animation: { type: null, speed: 5, intensity: 5 }
  },
  // Lámpara vieja en un cuarto a oscuras: un charco cálido y corto.
  "lampara-tenue": {
    bright: 0.9, dim: 3.4, color: "#ffb35c", alpha: 0.4, luminosity: 0.3, attenuation: 0.85,
    animation: { type: "torch", speed: 1, intensity: 1 }
  },
  // Plafón de pasillo de edificio viejo: bombita amarilla, floja. «El pasillo
  // estaba vacío y amarillo.» No llega al rellano de la azotea.
  pasillo: {
    bright: 1.2, dim: 4.2, color: "#e8c46a", alpha: 0.4, luminosity: 0.35, attenuation: 0.8,
    animation: { type: null, speed: 5, intensity: 5 }
  },
  // Pantalla de un portátil abierto (en pausa): frío, cortito.
  pantalla: {
    bright: 0, dim: 1.6, color: "#a9c8e6", alpha: 0.35,
    animation: { type: null, speed: 5, intensity: 5 }
  },
  // La lucecita azul de una cámara de timbre Gale Sentinel, encendida toda la noche.
  "led-timbre": {
    bright: 0, dim: 0.5, color: "#3d7bff", alpha: 0.6, luminosity: 0.2,
    animation: { type: null, speed: 5, intensity: 5 }
  },
  // La segunda luz, verde e intermitente, de una cámara que transmite en directo (3B).
  "led-transmision": {
    bright: 0, dim: 0.3, color: "#3fe07a", alpha: 0.6, luminosity: 0.2,
    animation: { type: "pulse", speed: 3, intensity: 5 }
  },
  // Tubo fluorescente frío.
  fluorescente: {
    bright: 3, dim: 6, color: "#dbe6ee", alpha: 0.3,
    animation: { type: null, speed: 5, intensity: 5 }
  },
  // Fluorescente que falla: frío, flojo y parpadeando.
  "fluorescente-viejo": {
    bright: 0.6, dim: 3.7, color: "#cfe3ee", alpha: 0.25, luminosity: 0.25, attenuation: 0.8,
    animation: { type: "flame", speed: 8, intensity: 4 }
  },
  // Farola de vapor de sodio: naranja, 4 m brillante y 12 m tenue.
  farola: {
    bright: 4, dim: 12, color: "#ffb46b", alpha: 0.45,
    animation: { type: null, speed: 5, intensity: 5 }
  },
  // Aplique de sodio en la pared de un callejón: más corto que una farola.
  "farola-pared": {
    bright: 1.5, dim: 6, color: "#ffa95a", alpha: 0.45, attenuation: 0.7,
    animation: { type: null, speed: 5, intensity: 5 }
  },
  // Neón o escaparate: frío, corto, con un leve parpadeo.
  neon: {
    bright: 2, dim: 6, color: "#7fd1ff", alpha: 0.4,
    animation: { type: "pulse", speed: 1, intensity: 1 }
  },
  // Vela.
  vela: {
    bright: 0.9, dim: 3.7, color: "#ffc547", alpha: 0.5,
    animation: { type: "torch", speed: 4, intensity: 1 }
  }
};

/** Construye un documento AmbientLight de Foundry a partir de un preset. */
export function luz(idEstable, semilla, xM, yM, preset, nombre) {
  const p = PRESETS[preset];
  if (!p) throw new Error(`preset de luz desconocido: ${preset}`);
  return {
    _id: idEstable(`luz:${semilla}`),
    ...(nombre ? { name: nombre } : {}),
    x: Math.round(xM * PX_POR_M),
    y: Math.round(yM * PX_POR_M),
    elevation: 0,
    rotation: 0,
    walls: true,
    vision: false,
    config: {
      negative: false, priority: 0, alpha: p.alpha, angle: 360,
      bright: p.bright, dim: p.dim, color: p.color, coloration: 1,
      attenuation: p.attenuation ?? 0.6, luminosity: p.luminosity ?? 0.5, saturation: 0, contrast: 0, shadows: 0,
      animation: { type: p.animation.type, speed: p.animation.speed, intensity: p.animation.intensity, reverse: false },
      darkness: { min: 0, max: 1 }
    },
    hidden: false,
    locked: false,
    flags: {}
  };
}

/** Todas las luces de un plano: las declaradas y las de los muebles con `luz`. */
export function lucesDePlano(plano, idEstable) {
  const luces = [];
  for (const [i, l] of (plano.luces ?? []).entries()) {
    luces.push(luz(idEstable, `${plano.id}:l${i}`, l.x, l.y, l.preset, l.nombre));
  }
  for (const [i, m] of (plano.muebles ?? []).entries()) {
    const preset = m.luz ?? (m.tipo === "vela" ? "vela" : null);
    if (!preset) continue;
    const cx = m.x + (m.w ?? 0.1) / 2, cy = m.y + (m.h ?? 0.1) / 2;
    luces.push(luz(idEstable, `${plano.id}:m${i}`, cx, cy, preset));
  }
  return luces;
}

# Seattle by Night — El Expediente Ward

Módulo de **Foundry VTT** para **Vampiro: La Mascarada 5ª edición** sobre el sistema
**wod5e**. Trae la ciudad de Seattle en noviembre de 2026, sus Vástagos y la aventura
*El Expediente Ward*, con la Segunda Inquisición (FIRSTLIGHT) jugable con reglas de
*Cazador: La Venganza*.

| | |
|---|---|
| Sistema | wod5e ≥ 5.3.0 |
| Foundry | v14 (verificado en 14.365) |
| Idioma | español |
| Mesa | coterie de 4–5 jugadores |
| Estado | 0.4.0 — fases 0–2, 4 y 8 hechas (la crónica importable, el Panel del Narrador y FIRSTLIGHT jugable); arte (retratos, tokens y mapas) en curso. Plan y fases en `SPEC.md` |

## Estructura del repositorio

```
module.json          manifest
src/module/          código del módulo (ES modules, ApplicationV2)
src/styles/sbn.css   CSS, todo prefijado con `sbn-`
templates/           plantillas Handlebars
lang/                es.json
content/             FUENTE ÚNICA: crónica, ciudad, documentos, PNJs, planos…
packs-src/           fuente versionable de los compendios (JSON generado)
packs/               compendios compilados (LevelDB) — GITIGNORED
assets/              mapas, retratos, tokens, tiles, handouts
tools/               build, verificación, arte local (ComfyUI), release
Seattle by Night - El Expediente Ward/   los documentos de origen (.docx)
```

```bash
npm install
npm run verificar     # _key, _id y assets de packs-src/
npm run e2e           # prueba contra un Foundry local (ver tools/e2e/prueba.mjs)
```

Cambiar `module.json` exige reiniciar el servidor de Foundry; cambiar JS/CSS/plantillas, F5.

### Desarrollo local

El repo se enlaza en los datos de Foundry y se prueba en el mundo `sbn-test`:

```bash
ln -s "$PWD" ~/.local/share/FoundryVTT/Data/modules/seattle-by-night
cd ~/FoundryVTT/app/resources/app && node main.js --port=30099 --noupnp --world=sbn-test
```

## Licencias

- **Código** (`src/`, `tools/`, `templates/`): MIT, ver `LICENSE`.
- **Contenido de World of Darkness.** Material no oficial de World of Darkness, publicado
  bajo el [Dark Pack](https://www.paradoxinteractive.com/games/world-of-darkness/community/dark-pack-agreement).
  Partes de estos materiales son copyright y marcas registradas de Paradox Interactive AB, y
  se usan con permiso. Todos los derechos reservados. Más información en
  [worldofdarkness.com](https://www.worldofdarkness.com).
  Es gratuito: no se vende. Se aceptan donaciones.
- **Arte.** Todo el arte (mapas, retratos, tokens) es original, generado en local con modelos
  de licencia abierta que permiten uso comercial (lista y licencias en `tools/MODELOS.md`).
  No contiene arte ni logos oficiales de Paradox o White Wolf. Cada imagen tiene su
  procedencia registrada en `assets/PROCEDENCIA.json`.

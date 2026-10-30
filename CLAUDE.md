# Seattle by Night — reglas del proyecto

Módulo de Foundry VTT v14 para Vampiro: La Mascarada 5e (sistema `wod5e` 5.3.28) con
FIRSTLIGHT jugable con reglas de Cazador: La Venganza. El plan completo está en `SPEC.md`:
leelo antes de trabajar. Mapas: `MAPS_SPEC.md` cuando exista.

## Referencias locales

- Módulo modelo: `/var/home/mvolgyi/Git/WoD/del_velo_a_la_vigilia` (DVV). Antes de escribir un
  script o un formato, buscá cómo lo resolvió DVV y copialo/adaptalo.
- Código del sistema: `~/.local/share/FoundryVTT/Data/systems/wod5e` (la verdad sobre el
  modelo de datos; no adivines campos).
- Foundry: `~/FoundryVTT/app/resources/app`. Datos: `~/.local/share/FoundryVTT/Data`.
- Fuente de la historia: `Seattle by Night - El Expediente Ward/*.docx` (docs 00–16). Si dos
  docs se contradicen, manda el más nuevo (número más alto o «decisiones actualizadas»).
- ComfyUI: `~/ComfyUI` (venv en `.venv`, API en `localhost:8188`).

## Convenciones

- Idioma: español rioplatense con voseo, como los docs («elegí», «tirá»). Código y
  comentarios en español, como DVV.
- id del módulo `seattle-by-night`; prefijo `sbn-` en CSS, flags, settings e ids.
- Los IDs de los docs (PJ-01, PNJ-12, LUG-05, A2-E03, P-07, DOC-04, AYU-03…) son estables y se
  usan tal cual en `content/` y como base de los `_id` de Foundry.
- `content/` es la fuente única. `packs-src/` se genera; `packs/` compilado nunca se commitea.
- Imágenes en WebP. Los documentos con texto (DOC, AYU) se maquetan en HTML/CSS, no se pintan.

## Licencias (no negociable)

- Publicación bajo Dark Pack: no comercial; donaciones permitidas. Nada de arte ni logos
  oficiales de Paradox/White Wolf.
- Arte: sólo modelos y nodos con licencia que permita uso comercial. Permitidos: Z-Image Turbo,
  Qwen-Image-Edit-2511, Z-Image-Turbo-Fun-ControlNet-Union, FLUX.2 [klein] **4B**, SeedVR2,
  BiRefNet, ComfyUI-GGUF. **Prohibidos:** FLUX.1-dev (está instalado: no usarlo), FLUX.1
  Kontext dev, FLUX.2 dev, FLUX.2 klein 9B, 4x-UltraSharp, RMBG-2.0. Cualquier modelo, LoRA o
  nodo nuevo: leer su licencia en la fuente antes de bajarlo y anotarla.
- Cada imagen generada se registra en `assets/PROCEDENCIA.json` (modelo, licencia, workflow,
  semilla, prompt).

## Trabajo en paralelo

- La GPU es una sola (RTX 5080, 16 GB). Sólo un agente a la vez lanza trabajos a ComfyUI; los
  demás preparan prompts, planos o código.
- No commitees: el que integra es el agente principal.
- Cada agente toca sólo los archivos de su tarea; si necesita cambiar algo compartido
  (`module.json`, `tools/util.mjs`, `lang/es.json`), lo dice en su reporte en vez de editarlo,
  salvo que la tarea lo pida.

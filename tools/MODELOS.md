# Modelos de arte local (ComfyUI)

Inventario de los modelos y nodos que usa el pipeline de arte (SPEC §4). Cada archivo tiene
la licencia leída en su página el 2026-10-30 y el sha256 verificado contra el que publica
Hugging Face (LFS). ComfyUI: `~/ComfyUI` (commit 19ae172, v0.42.0), venv `.venv`, API en
`http://127.0.0.1:8188`.

## Marcadores de los workflows (`tools/workflows/*.json`)

Los workflows están en **formato API** (el que acepta `POST /prompt` dentro de `{"prompt": …}`).
Los valores que cambian por asset son strings con la forma `"{{NOMBRE}}"`:

- Si el string es **sólo** el marcador (`"seed": "{{SEMILLA}}"`), se reemplaza el valor entero
  por el valor tipado: número para `SEMILLA`, `ANCHO` y `ALTO`; string para el resto. No dejar
  el número entre comillas: ComfyUI rechaza `"seed": "123"`.
- Si el marcador está dentro de un string más largo (`"{{PREFIJO}}-control"`), se hace un
  reemplazo de texto.
- Las imágenes de entrada se suben antes con `POST /upload/image` (multipart, campo `image`,
  `overwrite=true`) y el marcador se reemplaza por el `name` que devuelve.

| Marcador | Tipo | Qué es | Workflows |
|---|---|---|---|
| `{{PROMPT}}` | string | Prompt positivo completo (prefijo + sujeto + sufijo de `arte.config.json`) | todos menos `escalar-seedvr2`, `recortar-birefnet` |
| `{{SEMILLA}}` | entero | Semilla fija por asset | todos menos `recortar-birefnet` |
| `{{ANCHO}}`, `{{ALTO}}` | entero | Tamaño de salida en px (múltiplo de 16) | todos menos `recortar-birefnet` |
| `{{IMAGEN}}` | archivo subido | Imagen principal: esquema a repintar, imagen a escalar o a recortar | `editar-qwen`, `editar-klein`, `escalar-seedvr2`, `recortar-birefnet` |
| `{{IMAGEN_ESTILO}}` | archivo subido | Segunda imagen: referencia de estilo (en el prompt: «Picture 2» en Qwen, «image 2» en klein) | `editar-qwen`, `editar-klein` |
| `{{CONTROL}}` | archivo subido | Imagen de control (esquema del plano); el workflow le pasa Canny | `plano-controlnet` |
| `{{PREFIJO}}` | string | `filename_prefix` de SaveImage (puede llevar subcarpeta: `sbn/lug-05`) | todos |
| `{{NEGATIVO}}` | string | Prompt negativo (sólo pesa con CFG > 1) | `plano-qwen` |
| `{{LORA}}`, `{{PASOS}}`, `{{CFG}}` | número | Lightning sí/no: `1`/`4`/`1`; sin Lightning: `0`/`20`/`4` | `plano-qwen` (`PASOS` también en `plano-klein`, `plano-zimage`) |
| `{{DENOISE}}` | número | `1` = desde ruido; `< 1` = parte del latente del esquema (img2img) | `plano-qwen`, `plano-zimage` |
| `{{FUERZA}}`, `{{FIN_CONTROL}}` | número | `strength` y `end_percent` del ControlNet | `plano-zimage` |
| `{{DENOISE}}` (klein) | número | fracción final de los `PASOS` que se corren (`SplitSigmasDenoise`) | `detalle-klein` |

`tools/comfy.mjs` reemplaza cualquier marcador «solo» por el valor con el tipo que se le pase:
un número de JS queda número en el JSON.

Salida: PNG (SaveImage) en `~/ComfyUI/output/`; se baja con `GET /view?filename=…&subfolder=…&type=output`
y se convierte a WebP del lado de `comfy.mjs`. `plano-controlnet` guarda también el Canny usado
(`{{PREFIJO}}-control`) y `recortar-birefnet` la máscara (`{{PREFIJO}}-mascara`), para revisar.

### Qué hace cada workflow
| `musica-acestep.json` | ACE-Step 1.5 XL turbo + LM 4B (nativos: `DualCLIPLoader` tipo `ace`, `TextEncodeAceStepAudio1.5`, `EmptyAceStep1.5LatentAudio`, `VAEDecodeAudio`) | 8 pasos, cfg 1, `euler`/`simple`, shift 3 (AuraFlow), LM cfg `CFG_LM` 2, temperatura 0,85, top_p 0,9 | Calcado del template oficial `audio_ace_step1_5_xl_turbo` de ComfyUI. Marcadores propios: `TAGS` (prompt), `LETRA` (`[Instrumental]`: sin eso canta), `BPM`, `DURACION` (s), `TONALIDAD` («D minor»), `COMPAS` («4»), `CFG_LM`, `TEMPERATURA`. Antes de guardar baja 12 dB (`AudioAdjustVolume`): el decodificador da picos de hasta +3,5 dBFS y el FLAC de 16 bits de `SaveAudio` los recorta. Sale FLAC 48 kHz estéreo; `generar-musica.mjs` lo pasa por `bucle.mjs` (bucle, −20 LUFS, Ogg Vorbis 112 kbps). |

| Workflow | Modelo | Ajustes fijos | Notas |
|---|---|---|---|
| `t2i-zimage.json` | Z-Image Turbo bf16 | 8 pasos, cfg 1, `res_multistep`/`simple`, shift 3 | Retratos, tokens, tiles, exteriores. Negativo = ConditioningZeroOut. |
| `editar-qwen.json` | Qwen-Image-Edit-2511 GGUF **Q5_K_M** + LoRA Lightning 4 pasos | 4 pasos, cfg 1, `euler`/`simple`, shift 3.1, CFGNorm | Imagen 1 se escala a ANCHO×ALTO; imagen 2 entra tal cual (el codificador la lleva a ~1 MP). Para ir sin Lightning: nodo 2 `strength_model` 0 y nodo 15 `steps` 20, `cfg` 4 (unas 7× más lento). Q4_K_M instalado como alternativa (nodo 1). |
| `plano-controlnet.json` | Z-Image Turbo + Fun ControlNet Union 2.1 (2602, 8 pasos) | 8 pasos, cfg 1, strength 0.9 | Nodo 7 (Canny 0.4/0.8) se puede saltear si el control ya viene preprocesado (MLSD, HED, depth, gris). Canny no ve bloques gris claro: los muebles del esquema conviene dibujarlos con borde oscuro. |
| `editar-klein.json` | FLUX.2 [klein] 4B destilado | 4 pasos, `euler`, Flux2Scheduler, BasicGuider (cfg 1) | Dos ReferenceLatent encadenados (esquema + estilo). |
| `escalar-seedvr2.json` | SeedVR2 3B fp16 (nativo) | 1 paso, cfg 1, VAE en tiles 512/128, corrección de color `lab` | Escala con lanczos a ANCHO×ALTO y SeedVR2 restaura el detalle. Para el 7B: nodo 1 `seedvr2_7b_fp8_e4m3fn.safetensors`. |
| `recortar-birefnet.json` | BiRefNet (nativo) | — | Sale RGBA (JoinImageWithAlpha con la máscara invertida, como el blueprint oficial). |
| `plano-qwen.json` | Qwen-Image-Edit-2511 Q5_K_M (+ Lightning opcional) | shift 3.1, CFGNorm, `euler`/`simple` | Para `pintar-planos`. El esquema entra por `ReferenceLatent` al tamaño EXACTO de salida (el `TextEncodeQwenImageEditPlus` va sin VAE: sólo visión), porque el nodo de texto escala la referencia a 1 MP y la salida es de ~1,5 MP: así referencia y salida tienen el mismo tamaño (deriva medida en helen: 0–1 px). El mismo latente es el punto de partida (`DENOISE`). La referencia de estilo la agrega `pintar-planos` en código. |
| `plano-klein.json` | FLUX.2 [klein] 4B | 4 pasos, Flux2Scheduler | Para `pintar-planos`: una sola referencia (el esquema, al tamaño de salida). |
| `plano-zimage.json` | Z-Image Turbo + Fun ControlNet Union 2.1 | 8 pasos, cfg 1 | Para `pintar-planos`: control YA preprocesado (sin nodo Canny: `pintar-planos` arma líneas desde el plano, Canny o gris con ImageMagick) y latente inicial del esquema con `DENOISE`. **También es el workflow de la pasada de detalle** (`pintar-planos --detalle`): img2img por mosaico con `IMAGEN` = el mosaico con grano inyectado, `CONTROL` = Canny del mosaico sin grano (`magick -canny 0x1.5+10%+25%`), `DENOISE` 0,6 interior / 0,4 exterior, `FUERZA` 0,75, `FIN_CONTROL` 1. Sin ControlNet, `pintar-planos` borra los nodos 4–7 y conecta el modelo directo. |
| `detalle-klein.json` | FLUX.2 [klein] 4B | `Flux2Scheduler` (`PASOS`, 8 recomendado) + `SplitSigmasDenoise` (`DENOISE`) + `SamplerCustomAdvanced` sobre el latente del mosaico | img2img con denoise parcial. El mismo latente entra como `ReferenceLatent` (modo edición); para img2img puro, `pintar-planos` conecta el guía al prompt sin referencia (`referencia: false`). Probado en helen y **descartado** para la pasada de detalle: con referencia copia el mosaico casi idéntico aun a denoise 0,75 (RMSE 2 %) y a 1,0 inventa objetos; sin referencia, a 0,5 sólo suma veta y a 0,7 rompe muros. |

## Modelos

Rutas relativas a `~/ComfyUI/models/`. Tamaño en bytes.

| Archivo | Ruta | Repo (origen de la descarga) | Licencia | Tamaño | sha256 | Para qué |
|---|---|---|---|---|---|---|
| `z_image_turbo_bf16.safetensors` | `diffusion_models/` | [Comfy-Org/z_image_turbo](https://huggingface.co/Comfy-Org/z_image_turbo) (original [Tongyi-MAI/Z-Image-Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)) | Apache 2.0 ([página](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)) | 12309866400 | `2407613050b809ffdff18a4ac99af83ea6b95443ecebdf80e064a79c825574a6` | t2i y base del ControlNet (ya estaba instalado; hash coincide con Comfy-Org) |
| `qwen_3_4b.safetensors` | `text_encoders/` | [Comfy-Org/z_image_turbo](https://huggingface.co/Comfy-Org/z_image_turbo) | Apache 2.0 | 8044982048 | `6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a` | Codificador de Z-Image (`lumina2`) **y** de klein 4B (`flux2`): es el mismo archivo, mismo hash en [Comfy-Org/flux2-klein-4B](https://huggingface.co/Comfy-Org/flux2-klein-4B) (ya estaba) |
| `z_image_ae.safetensors` | `vae/` | [Comfy-Org/z_image_turbo](https://huggingface.co/Comfy-Org/z_image_turbo) (`ae.safetensors` renombrado) | Apache 2.0 | 335304388 | `afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38` | VAE de Z-Image (ya estaba) |
| `qwen-image-edit-2511-Q5_K_M.gguf` | `diffusion_models/` | [unsloth/Qwen-Image-Edit-2511-GGUF](https://huggingface.co/unsloth/Qwen-Image-Edit-2511-GGUF) (original [Qwen/Qwen-Image-Edit-2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511)) | Apache 2.0 (ambas páginas) | 15395662432 | `7e5bf7f00b5e219a855641e7a10d5a8b2668423409718e92dfddd6542828f9b6` | Edición: repintar esquemas, retrato → token, referencia de estilo. Default de `editar-qwen` |
| `qwen-image-edit-2511-Q4_K_M.gguf` | `diffusion_models/` | ídem | Apache 2.0 | 12842830432 | `07951f61941a81e236cbd4a9b6f250d49626b3ba518f260135bf2e01a87cf1c8` | Alternativa más liviana al Q5_K_M |
| `qwen_2.5_vl_7b_fp8_scaled.safetensors` | `text_encoders/` | [Comfy-Org/Qwen-Image_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI) (original [Qwen/Qwen2.5-VL-7B-Instruct](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct)) | Apache 2.0 (ambas páginas) | 9384670680 | `cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4` | Codificador de texto+visión de Qwen-Image-Edit (`qwen_image`) |
| `qwen_image_vae.safetensors` | `vae/` | [Comfy-Org/Qwen-Image_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI) | Apache 2.0 | 253806246 | `a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f` | VAE de Qwen-Image / Edit |
| `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` | `loras/` | [lightx2v/Qwen-Image-Edit-2511-Lightning](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning) | Apache 2.0 ([página](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning)) | 849608296 | `22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f` | LoRA de destilación: Qwen-Edit en 4 pasos (≈20 s en vez de ≈140 s) |
| `Z-Image-Turbo-Fun-Controlnet-Union-2.1-2602-8steps.safetensors` | `model_patches/` | [alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1](https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1) | Apache 2.0 | 6712485600 | `d1251cc7bc3486bc61d25c3be498ef394c31c85ddf4ee9137d2e933411f4a689` | Camino B de planos: Canny/MLSD/HED/depth/gris del esquema. Se carga con `ModelPatchLoader` + `ZImageFunControlnet` (nativos) |
| `flux-2-klein-4b.safetensors` | `diffusion_models/` | [Comfy-Org/flux2-klein-4B](https://huggingface.co/Comfy-Org/flux2-klein-4B) (original [black-forest-labs/FLUX.2-klein-4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)) | Apache 2.0 ([LICENSE.md](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/blob/main/LICENSE.md)) | 7751105712 | `ec3d4e733a771f61c052fb4856c48b336c55eaf2c65487c2a1faeb9bbda7a343` | Edición multi-referencia liviana (A/B contra Qwen). Mismo hash que el de BFL |
| `flux2-vae.safetensors` | `vae/` | [Comfy-Org/flux2-klein-4B](https://huggingface.co/Comfy-Org/flux2-klein-4B) | Apache 2.0 | 336211292 | `868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3` | VAE de FLUX.2 (bajado del repo Apache de klein, **no** del de FLUX.2 dev) |
| `seedvr2_3b_fp16.safetensors` | `diffusion_models/` | [Comfy-Org/SeedVR2](https://huggingface.co/Comfy-Org/SeedVR2) (original [ByteDance-Seed/SeedVR2-3B](https://huggingface.co/ByteDance-Seed/SeedVR2-3B)) | Apache 2.0 | 6784268336 | `98669fd2c06df5eca88baf68cd5c478775c8e61fc110e598c52b350145ea2660` | Escalar battlemaps a resolución final (default) |
| `seedvr2_7b_fp8_e4m3fn.safetensors` | `diffusion_models/` | [Comfy-Org/SeedVR2](https://huggingface.co/Comfy-Org/SeedVR2) (original [ByteDance-Seed/SeedVR2-7B](https://huggingface.co/ByteDance-Seed/SeedVR2-7B)) | Apache 2.0 | 8240979248 | `5065e77d647dd553d9090a81e20d6de590d931a61df79d785e008433926ee418` | Alternativa 7B: más suave/limpio, menos textura de pincel que el 3B |
| `seedvr2_ema_vae_fp16.safetensors` | `vae/` | [Comfy-Org/SeedVR2](https://huggingface.co/Comfy-Org/SeedVR2) | Apache 2.0 | 501324814 | `20678548f420d98d26f11442d3528f8b8c94e57ee046ef93dbb7633da8612ca1` | VAE de SeedVR2 |
| `birefnet.safetensors` | `background_removal/` | [Comfy-Org/BiRefNet](https://huggingface.co/Comfy-Org/BiRefNet) (original [ZhengPeng7/BiRefNet](https://huggingface.co/ZhengPeng7/BiRefNet)) | MIT (ambas páginas) | 444473596 | `9ab37426bf4de0567af6b5d21b16151357149139362e6e8992021b8ce356a154` | Recorte con alfa de tokens y tiles. Nodos nativos `LoadBackgroundRemovalModel` + `RemoveBackground` |
| `acestep_v1.5_xl_turbo_bf16.safetensors` | `diffusion_models/` | [Comfy-Org/ACE-Step-1.5](https://huggingface.co/Comfy-Org/ACE-Step-1.5) (antes `Comfy-Org/ace_step_1.5_ComfyUI_files`, que redirige; original [ACE-Step/acestep-v15-xl-turbo](https://huggingface.co/ACE-Step/acestep-v15-xl-turbo)) | MIT (original; la tarjeta dice «Generated music can be used for commercial purposes») + Apache 2.0 (reempaquetado). Código: MIT ([LICENSE](https://github.com/ace-step/ACE-Step-1.5/blob/main/LICENSE)). Leído el 2026-11-01 | 9974719892 | `86a1afb0a1f711f0e3304ff65d874df3ae6783db683dcf982513fb9b6d14ae71` | Música: DiT de ACE-Step 1.5 XL destilado a 8 pasos (`musica-acestep`) |
| `qwen_4b_ace15.safetensors` | `text_encoders/` | [Comfy-Org/ACE-Step-1.5](https://huggingface.co/Comfy-Org/ACE-Step-1.5) (original [ACE-Step/acestep-5Hz-lm-4B](https://huggingface.co/ACE-Step/acestep-5Hz-lm-4B)) | MIT + Apache 2.0 (reempaquetado) | 8379154232 | `ffe5ffb855086c2ab55e467e9859fb01894781020a0376484dd19de166b79873` | LM de ACE-Step que planifica la pieza (códigos de audio a 5 Hz); el más grande y el que mejor sigue el prompt |
| `qwen_0.6b_ace15.safetensors` | `text_encoders/` | [Comfy-Org/ACE-Step-1.5](https://huggingface.co/Comfy-Org/ACE-Step-1.5) (original: `Qwen3-Embedding-0.6B` dentro de [ACE-Step/Ace-Step1.5](https://huggingface.co/ACE-Step/Ace-Step1.5); base [Qwen/Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)) | MIT (ACE-Step) / Apache 2.0 (Qwen y reempaquetado) | 1191588248 | `fd4590c82153b8ddb67e15a2e7aaa8afa8b83a858c8a9b82a4831063156aa7a7` | Codificador del texto (tags) y de la letra de ACE-Step |
| `ace_1.5_vae.safetensors` | `vae/` | [Comfy-Org/ACE-Step-1.5](https://huggingface.co/Comfy-Org/ACE-Step-1.5) (original: `vae/` de [ACE-Step/Ace-Step1.5](https://huggingface.co/ACE-Step/Ace-Step1.5)) | MIT + Apache 2.0 (reempaquetado) | 337431732 | `6de92e3a862acd287e08b024ac90f0783a8635451b728721a33ff03565bcb2bb` | VAE de audio de ACE-Step 1.5 (48 kHz estéreo) |

Instalado y **prohibido**: `checkpoints/flux1-dev-fp8.safetensors` (FLUX.1 [dev] Non-Commercial).
No se usa ni se borra.

## Nodos y paquetes

| Nodo / paquete | Dónde | Origen | Licencia | Versión | Para qué |
|---|---|---|---|---|---|
| ComfyUI-GGUF (city96) | `~/ComfyUI/custom_nodes/ComfyUI-GGUF` | [github.com/city96/ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) | Apache 2.0 ([LICENSE](https://github.com/city96/ComfyUI-GGUF/blob/main/LICENSE)) | commit `6ea2651e7df66d7585f6ffee804b20e92fb38b8a` (2026-01-12) | `UnetLoaderGGUF` para el Qwen-Edit GGUF |
| `gguf` (PyPI, de llama.cpp) | venv de ComfyUI | [pypi.org/project/gguf](https://pypi.org/project/gguf/) | MIT | 0.19.0 | Dependencia de ComfyUI-GGUF |

Nativos en este ComfyUI (no hizo falta instalar nada): SeedVR2 (`comfy_extras/nodes_seedvr.py`),
BiRefNet (`comfy_extras/nodes_bg_removal.py`, carpeta `models/background_removal/`), Fun ControlNet
de Z-Image (`comfy_extras/nodes_model_patch.py`: `ModelPatchLoader` detecta el archivo por sus
claves; la 2.0 tiene el refiner en cero y ComfyUI la marca como `broken`), FLUX.2 klein
(`CLIPLoader` tipo `flux2`, `Flux2Scheduler`, `EmptyFlux2LatentImage`).

## Música (ACE-Step 1.5) y análisis de audio

`tools/generar-musica.mjs` genera las pistas de `content/musica.json` con los parámetros de
`tools/musica.config.json` (ver los comentarios de esos archivos). Por qué XL turbo + LM 4B: es la
combinación de más calidad que publica ACE-Step; según su tarjeta el XL pide ≥ 20 GB sin
descarga a RAM, pero con la DynamicVRAM de ComfyUI anda en los 16 GB (LM de 8,4 GB y DiT de 10 GB no entran juntos:
ComfyUI descarga a RAM lo que no entra). No se bajaron el turbo común (`acestep_v1.5_turbo`) ni el LM 1.7B.

Para revisar las pistas sin escucharlas (la elección de semilla y la detección de voces) se usó
un clasificador de AudioSet. **No genera nada que se publique**; vive fuera de ComfyUI, en
`cache/modelos/ast-audioset/` (ignorado por git):

| Archivo | Repo | Licencia | Tamaño | sha256 | Para qué |
|---|---|---|---|---|---|
| `model.safetensors` (+ `config.json`, `preprocessor_config.json`), revisión `f826b80d` | [MIT/ast-finetuned-audioset-10-10-0.4593](https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593) (código [YuanGongND/ast](https://github.com/YuanGongND/ast)) | BSD 3-Clause (ambas páginas; leído el 2026-11-01) | 346404948 | `ae0c1e2ad4e1381d851fa9bf298ba13ebc9c5a914cdee2dbe427a6583869924d` | Detector de voces: probabilidad por tramo de 10 s de «Singing», «Choir», «Vocal music», «Humming»… Control positivo (ACE-Step con letra cantada): 0,25; pistas instrumentales: ≤ 0,05. Corre con `transformers` del venv de ComfyUI, en CPU |


## Datos geográficos

`tools/mapa-regional.mjs` (MAP-00, el mapa regional de AYU-01) no le pide la costa al modelo:
la dibuja desde datos y Z-Image + Fun ControlNet (`plano-zimage`) sólo la pinta. Se bajan solos a
`cache/tiger/` (fuera del repo) con `curl -L -C -`.

| Datos | Archivos | Origen | Licencia | Para qué |
|---|---|---|---|---|
| U.S. Census Bureau, 2024 Cartographic Boundary Files 1:500k | `cb_2024_us_county_500k.zip` (11,6 MB), `cb_2024_53_place_500k.zip` (0,5 MB) | [census.gov/geographies/mapping-files](https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html) | Dominio público (obra del gobierno de EE. UU., 17 U.S.C. §105); el Census pide citarlo como fuente ([TIGER/Line 2024, cap. 1](https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2024/TGRSHP2024_TechDoc.pdf)). Leído el 2026-11-01. | Tierra recortada a la costa (condados) y municipios (dónde van las luces) |
| U.S. Census Bureau, 2024 TIGER/Line | `tl_2024_{53033,53053,53061,53035,53029}_areawater.zip`, `tl_2024_53_prisecroads.zip` (3,9 MB) | [www2.census.gov/geo/tiger/TIGER2024](https://www2.census.gov/geo/tiger/TIGER2024/) | Ídem | Lagos y ríos anchos (King, Pierce, Snohomish, Kitsap, Island) y rutas principales |

«TIGER/Line» es marca del Census: no se usa en nombres de producto. El mapa no lleva texto; la cita
va en `assets/PROCEDENCIA.json` (`datos`).

## Qué quedó afuera y por qué

- **Z-Image-Turbo-Fun-Controlnet-Union 2.0**: el repo `alibaba-pai/…-Union-2.0` ahora redirige
  a `…-Union-2.1`. Según el README, la 2.0 tiene un error (`control_layers` en lugar de
  `control_noise_refiner`) que hace la pasada doble y más lenta, y no está destilada. Se bajó
  la **2.1-2602-8steps** (misma licencia, mismo repo, 8 pasos, suma control «Gray»).
- **`qwen_2.5_vl_7b_fp8_scaled` del repo `Comfy-Org/HunyuanVideo_1.5_repackaged`** (el que cita el
  blueprint de ComfyUI): ese repo está etiquetado con la licencia *Tencent Hunyuan Community*
  (excluye UE, Reino Unido y Corea del Sur). Se bajó el mismo codificador desde
  `Comfy-Org/Qwen-Image_ComfyUI`, Apache 2.0.
- **`flux2-vae` del repo `Comfy-Org/flux2-dev`**: ese repo está etiquetado como FLUX dev
  *Non-Commercial*. Se bajó el VAE desde `Comfy-Org/flux2-klein-4B` (Apache 2.0).
- **klein base 4B y klein 9B**: el base no hace falta (el destilado es el de 4 pasos); el 9B
  no es comercial.
- **QuantStack/Qwen-Image-Edit-2511-GGUF**: el repo devuelve 401 (privado o borrado); se usó el
  de unsloth (Apache 2.0, hecho con las herramientas de ComfyUI-GGUF).
- **`lucida.safetensors`** (en `Comfy-Org/BiRefNet`, base `egeorcun/lucida`): no hace falta y no
  se revisó la licencia de su origen.
- **Qwen-Image-Edit-2511 fp8/int8 de Comfy-Org (20,5 GB)**: no se probó; el GGUF Q5_K_M anda bien.

## Rendimiento medido (RTX 5080 16 GB, 2026-10-30)

ComfyUI corre con DynamicVRAM (default): llena la VRAM libre y descarga a RAM lo que no entra,
así que el pico de `nvidia-smi` siempre ronda 15 GB; lo que importa es el tiempo. «Frío» =
después de `POST /free` (modelos fuera de VRAM, pero en caché de disco/RAM).

| Workflow | Tamaño | Frío | Caliente | VRAM pico total (base escritorio ≈3,2 GB) |
|---|---|---|---|---|
| `t2i-zimage` | 768×768 / 1024×1024 | 22,6 s (primera carga) / 10,5 s | 5,1 s (1024²) | 15,7 GB |
| `editar-qwen` Q4_K_M + Lightning | 1024×768, 2 refs | 24,1 s | 20,5 s (3,74 s/paso; 1,6 GB del modelo en RAM) | 15,3 GB |
| `editar-qwen` Q5_K_M + Lightning | 1024×768, 2 refs | 23,2 s | 17,2 s (4,05 s/paso; 4,2 GB en RAM) | 15,2 GB |
| `editar-qwen` Q4_K_M sin Lightning (20 pasos, cfg 4) | 1024×768 | 143 s | — | 15,2 GB |
| `plano-controlnet` | 1024×768 | 13,6 s | — | 15,7 GB |
| `editar-klein` | 1024×768, 2 refs | 9,0 s | 4,7 s | 15,4 GB |
| `escalar-seedvr2` 3B fp16 | 1024×768 → 2048×1536 / → 4096×3072 | 3,5 s / 10,0 s | — | 11,0 / 13,3 GB |
| `escalar-seedvr2` 7B fp8 | → 2048×1536 / → 4096×3072 | 4,5 s / 12,0 s | — | 12,1 / 14,8 GB |
| `recortar-birefnet` | 768×1024 | 1,5 s | — | 5,1 GB |
| `generar-arte` retrato (`t2i-zimage`, 8 pasos) | 832×1248 | 12 s | 8 s por imagen (≈8 min por 60 imágenes con la descarga y el WebP) | 12,4 GB; RAM disponible baja a ≈15 GB con Z-Image + qwen_3_4b cargados |
| `generar-arte` token (`editar-qwen` Q5_K_M + Lightning, 1 referencia, + BiRefNet + `tokens.mjs`) | 1024×1024 | 38 s | 16–28 s por token | GPU 43–54 °C en lotes de 45; RAM disponible ≈33 GB |
| `plano-zimage` como pasada de detalle (canny, 8 pasos) | mosaico 1152×1152 | — | 8–16 s por mosaico | ≈15 GB |
| `detalle-klein` (8 pasos, denoise 0,4–0,75) | mosaico 1152×1152 | — | 4–12 s por mosaico | ≈15 GB |
| `pintar-planos --solo helen` completo (klein + SeedVR2 7B + detalle 16+12 mosaicos + grading) | 21×20 m | — | ≈400 s (16 + 8 + ≈300 s de detalle) | — |
| `musica-acestep` (XL turbo + LM 4B, 8 pasos) + `generar-musica` | 150 s de audio, 48 kHz estéreo (2026-11-01/02) | ≈ 20 s (la primera de cada tanda) | 17,6–22,6 s, mediana 17,9 s por candidato (≈ 8× tiempo real); 102 candidatos = 31 min de GPU, ≈ 1 h con análisis | 15,5–15,8 GB (base escritorio ≈ 3,1–3,5 GB). GPU 37–50 °C; RAM disponible ≥ 22 GB |

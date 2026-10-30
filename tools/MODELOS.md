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

`tools/comfy.mjs` reemplaza cualquier marcador «solo» por el valor con el tipo que se le pase:
un número de JS queda número en el JSON.

Salida: PNG (SaveImage) en `~/ComfyUI/output/`; se baja con `GET /view?filename=…&subfolder=…&type=output`
y se convierte a WebP del lado de `comfy.mjs`. `plano-controlnet` guarda también el Canny usado
(`{{PREFIJO}}-control`) y `recortar-birefnet` la máscara (`{{PREFIJO}}-mascara`), para revisar.

### Qué hace cada workflow

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
| `plano-zimage.json` | Z-Image Turbo + Fun ControlNet Union 2.1 | 8 pasos, cfg 1 | Para `pintar-planos`: control YA preprocesado (sin nodo Canny: `pintar-planos` arma líneas desde el plano, Canny o gris con ImageMagick) y latente inicial del esquema con `DENOISE`. |

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

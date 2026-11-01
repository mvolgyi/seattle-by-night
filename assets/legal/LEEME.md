# assets/legal

## dark-pack-logo.webp — logo del Dark Pack

Es la **única** imagen oficial de Paradox / White Wolf que lleva el módulo, y está porque el
[acuerdo del Dark Pack](https://www.paradoxinteractive.com/games/world-of-darkness/community/dark-pack-agreement)
pide mostrarlo en el material publicado bajo él. No es arte generado: no va en
`assets/PROCEDENCIA.json`.

- **Origen:** la carpeta oficial de Dropbox que enlaza la página del acuerdo,
  <https://www.dropbox.com/scl/fo/yyn4a7mwo913xe1f8vzs7/AKX0VWS23y5f5CWL-WlPuzU?rlkey=2x2fn5ic3tfp1zzublmmtkqca&dl=0>.
  Dentro: `World of Darkness Community Assets.zip` → `World of Darkness Community Assets/Dark Pack/DarkPack_Logo_Color.png`
  (3000 × 3008, PNG con transparencia; es el mismo archivo que `WoD-Logos-and-Symbols.zip` →
  `Dark Pack Logos/DarkPack_Logo2.png`).
  SHA-256 del PNG original: `285e20a71753bbce12e21a18b5812d62586a809b6d4dff5b4daeb2dd9b1afce0`.
- **Fecha de descarga:** 2026-11-01.
- **Versión elegida:** la de color (aro rojo y disco negro), porque el aro la separa del fondo
  oscuro del módulo y de la guía; la blanco y negro se pierde sobre negro.
- **Conversión:** recortado el borde transparente y reducido a 595 × 600, WebP con canal alfa
  (`magick DarkPack_Logo_Color.png -trim +repage -resize 600x600 -quality 90 -define webp:alpha-quality=100`).
  Sin otros cambios: ni colores, ni proporciones, ni recortes del dibujo.
- **Condiciones:** la carpeta de Dropbox no trae ningún texto de condiciones de uso (sólo los
  logos e ilustraciones). Se usa según el acuerdo del Dark Pack: junto al aviso legal, en
  material fan, gratuito y no oficial.

### Dónde se usa

- `README.md`, arriba de todo.
- El journal «Cómo usar este módulo» (`content/cronica/00-como-usar.md`), página «Aviso legal».
- La descripción de la Aventura (`tools/contenido/aventura.mjs`), que muestra también el
  diálogo de importación.
- El pie de la Guía del Narrador (`tools/construir-guia.mjs`).

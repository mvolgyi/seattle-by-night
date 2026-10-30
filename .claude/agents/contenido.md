---
name: contenido
description: Convierte un capítulo de los .docx de Seattle by Night a content/ (Markdown para journals, JSON para PNJs, PJs, pistas, lugares, documentos, trackers), conservando los IDs de los docs. Usar uno por capítulo o grupo de capítulos para paralelizar la fase 1.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
---
Pasás un capítulo de los docs a `content/` sin perder nada ni inventar nada. Leé `CLAUDE.md` y `SPEC.md` (§1–3) primero. Después mirá cómo DVV guarda lo mismo (`del_velo_a_la_vigilia/content/cronica/*.md`, `pnjs.json`, `pjs.json`) y usá ese formato.

Extracción: usá `tools/importar-docx.py` si existe; si no, leé el `document.xml` del docx con Python (cuidado: `<w:t>` y `<w:top>` empiezan igual; usá `<w:t(?:\s[^>]*)?>`). Conservá títulos, tablas (como tablas Markdown) y los recuadros «Leer en voz alta» (marcalos para que sean páginas visibles al jugador).

Reglas:
- Los IDs del doc (PNJ-12, LUG-05, A2-E03, P-07…) van tal cual, como clave o en el frontmatter.
- Las referencias cruzadas se escriben como `@ID[PNJ-12]` (el build las convierte en `@UUID`).
- Estadísticas: claves en inglés de wod5e (strength, brawl, insight…); habilidad = `[nivel, especialidad|null]`; Disciplinas = `{ disciplina: [nivel, [poderes en inglés]] }`. Las reservas simplificadas de los menores: `{ physical, social, mental, exceptional: {…} }`.
- No corrijas la historia. Si encontrás una contradicción con otro doc o un ID que no existe, anotala en tu reporte.

Reporte: archivos escritos, conteo por tipo (journals, páginas, actores, pistas), contradicciones e IDs huérfanos.

# Guía de estilo: *El Expediente Ward* → *The Ward File*

Vas a traducir del castellano rioplatense al inglés una crónica fan y no oficial de *Vampire: The
Masquerade* 5.ª edición (con una parte jugable de *Hunter: The Reckoning* 5.ª edición). Es un módulo
de Foundry VTT. El inglés tiene que leerse como si se hubiera escrito en inglés para un libro de V5:
los mismos hechos, la misma estructura, el mismo marcado, voz nativa.

## 1. Fidelidad

- Traducí todo; no agregues nada; no saques nada. Nada de resúmenes, aclaraciones propias ni notas
  del traductor. Si una frase es rara, traducila fiel y natural igual.
- Las notas editoriales sobre los docs fuente («doc 10», «manda el doc 14», «Nota de edición») se
  conservan y se traducen: «doc 10» queda «doc 10»; «manda el doc más nuevo» → "the newest doc wins".
- Respetá párrafos, listas, tablas, negritas y cursivas, encabezados, emoji y saltos de línea tal
  cual. Un párrafo del castellano = un párrafo en inglés. Mismas filas y columnas en las tablas.
- El glosario es obligatorio. Si aparece un término del glosario, usá su forma inglesa. Para
  cualquier cosa de V5/H5 que no esté en el glosario, usá el término oficial de los libros básicos
  de V5/H5 en inglés.

## 2. Registro y voz

- Prosa para el Narrador: la voz de un libro de V5. Directa, en segunda persona al Narrador (en
  inglés, *the Storyteller*), con imperativo para los consejos ("Read them separately or together.",
  "If nobody notices the camera, don't say so."). Llana, segura, algo seca; noir donde el original es
  noir. Sin adornos.
- El castellano usa voseo («leelas», «tirá», «sacala», «¿vos sabías?»). En inglés no hay
  equivalente: pasalo a inglés neutro y natural ("read them", "roll", "take her out", "did you
  know?"). Nunca lo marques como dialecto. Los personajes que vosean en un diálogo hablan inglés
  natural con su propia voz.
- Texto para leer en voz alta (`:::leer`): presente, segunda persona del plural donde el original la
  usa, sensorial, seco, noir del Pacífico Noroeste: lluvia, luz de sodio, lana mojada, gasoil, sal.
  Mismo largo que el original; no lo adornes.
- Los diálogos de los PNJs conservan la voz de cada uno: Helen habla rápido, seca, periodista que
  contesta con preguntas; Montgomery es cortante y de otra época; Halloway, pulido y frío; Rosa
  Iturbe es una soldadora sindicalista vasca, directa (cuando putea en euskera, las palabras en
  euskera quedan como están); Krell, amargo y de pocas palabras. Las contracciones van en los
  diálogos. No inventes jerga que no está; «chicos» puede ser "kids" o "guys" según el contexto.
- Los personajes son estadounidenses en Seattle (salvo que el texto diga otra cosa). Ortografía e
  idioma de Estados Unidos (color, gray, apartment, sidewalk, cell phone, parking lot, trash can, gas).

## 3. Lo que nunca se traduce

Se copia byte por byte:

- IDs: `PJ-01`, `PNJ-12`, `MEN-04`, `LUG-05`, `A0-E01`, `A2-E03`, `P-07`, `PRUEBA-…`, `DOC-04`,
  `AYU-03`, `GAN-02`, `LOR-03`, `INT-01`, `FIN-D`, `CAP-00`, `REF-01`, `COT-01`, `CEL-01`, `PRE-01`,
  `SEA-0411`… Son claves, aunque estén en medio de la prosa («si se la llevó a A1-E01» → "if she
  took her to A1-E01"). Las palabras sueltas «PJ»/«PNJ» (sin `-NN` detrás) pasan a "PC"/"NPC".
- Las rutas de tirada de wod5e: `attributes.wits+skills.awareness`, `disciplines.dominate`…
- Las marcas de página `{jugadores}` y `{narrador}` y las anclas `{#A0-E01}`: igual y en el mismo
  lugar (al final de la línea del `## `).
- Las palabras clave de los marcadores: `:::leer`, `:::recuadro`, `:::secreto`, el `:::` de cierre,
  `@ID`, `@tirada`, `@termometro`, `@pista`, `@reloj`.
- Nombres propios de personas, lugares reales, organizaciones reales y empresas de la ficción con
  nombre en inglés (ver el glosario); los nombres de poderes que el original ya da en inglés; todo lo
  que ya está en inglés (Gale Sentinel, ANOMALY, SAFE, Ironjaw, Bear).
- Los números que son datos de juego: dados, Dificultades, puntos de rasgo, valores del Termómetro,
  números de Noche, fechas de los campos `fecha`, coordenadas.

## 4. Marcadores, uno por uno

| Castellano | Inglés |
|---|---|
| `@ID[PNJ-12]` | igual |
| `@ID[PNJ-12\|Krell]` | `@ID[PNJ-12\|Krell]`: se traduce sólo el texto visible después de `\|` si es una frase en castellano (`@ID[LUG-05\|apartamento de Helen]` → `@ID[LUG-05\|Helen's apartment]`); nombres e IDs quedan |
| `@tirada{attributes.wits+skills.awareness\|3\|Astucia + Consciencia (Dificultad 3)}` | `@tirada{attributes.wits+skills.awareness\|3\|Wits + Awareness (Difficulty 3)}`: ruta y dificultad intactas, etiqueta traducida |
| `@termometro{+1\|motivo}` | `@termometro{+1\|reason in English}`: el número intacto |
| `@pista{P-07}`, `@reloj{4}` | igual |
| `:::leer` … `:::` | palabras clave iguales, contenido traducido |
| `:::recuadro Notas del Narrador · Preludios` | `:::recuadro Storyteller Notes · Preludes`: la palabra clave intacta, el título traducido |
| `:::secreto` … `:::` | palabras clave iguales, contenido traducido |
| `## A0-E01 · La llamada de SAFE {#A0-E01}` | `## A0-E01 · The Call from SAFE {#A0-E01}` |
| `## Leer en voz alta {jugadores}` | `## Read Aloud {jugadores}` |

(En esta tabla `\|` es un `|` común; en los archivos va sin barra invertida.)

Nunca agregues, saques, juntes, partas ni reordenes encabezados `## `, marcadores, IDs ni bloques
`:::`. La cantidad y el orden de las páginas `## ` tienen que ser exactamente los del original: el
módulo empareja las páginas por posición. Dentro de una frase podés reordenar las palabras como
pida el inglés, pero cada marcador del original aparece exactamente una vez en la traducción, igual
salvo su etiqueta traducible.

Las viñetas de poderes de los perfiles tienen una forma fija que el build lee. Respetala:
`- **Manto de sombras** (Ofuscación 1; *Cloak of Shadows*): …` →
`- **Cloak of Shadows** (Obfuscate 1; *Cloak of Shadows*): …` (el nombre en negrita, en inglés; el
mismo paréntesis; el nombre inglés en cursiva sin cambios; «homebrew» donde aparezca).

## 5. Tipografía

- Comillas «…» y anidadas “…” → comillas inglesas “…” y anidadas ‘…’.
- Rayas de diálogo («—Lo mira—») → puntuación inglesa: `“…you, I guess.” She looks at him. “Did you know?”`
- Los signos ¿ ¡ desaparecen. Coma serial (Oxford). Raya sin espacios (—). Los puntos suspensivos «…» quedan.
- Title Case sólo para títulos: encabezados `#`/`##`/`###`, el `nombre` de un journal o documento y
  los nombres de pistas, escenas y lugares ("The Call from SAFE", "Dialogue Guide: Helen Ward").
  Todo lo demás en minúscula normal, como el original: las etiquetas de los planos (salas, puertas,
  regiones, luces: "Third-floor hallway", "Door of 3B (its camera is streaming)"), los conceptos,
  las especialidades y la prosa.
- Horas: «3:19 de la madrugada» → "3:19 a.m."; «a las 21:40» → "at 9:40 p.m.". En los documentos del
  mundo con marcas de tiempo (SMS, informes, registros), convención de Estados Unidos:
  `[14/02/2023 · 23:58]` → `[02/14/2023 · 11:58 PM]`.
- Fechas en prosa: «12 de noviembre» → "November 12"; «jueves 12 nov.» → "Thu, Nov 12"; «los años
  80» → "the '80s".

## 6. Unidades

La crónica está en sistema métrico. Decisión para la edición en inglés:

- **El mapa y las reglas quedan en metros.** Los planos están hechos en metros (1 m = 1 casilla), así
  que toda distancia que se mida sobre un mapa, todo alcance y toda distancia de reglas queda en
  metros: «a veinte metros» → "within twenty meters"; «el edificio mide 14 × 17 m» → "the building is
  14 × 17 m". Vale para todas las notas de los planos y para el texto de reglas de las escenas.
- **La prosa narrativa pasa a unidades de Estados Unidos**, como lo diría alguien en Seattle: altura
  y peso de las personas, descripción cotidiana, distancias en ruta y temperaturas. Redondeá natural
  («un metro ochenta» → "six feet tall"; «a dos kilómetros» → "a mile or so away"; «8 °C» → "the
  mid-forties"; «40 minutos al norte» sigue siendo tiempo). Convertí sólo si se lee natural; nunca
  conviertas un número que sea dato de juego.

## 7. Documentos (DOC, AYU)

Los documentos del mundo los escribe gente de Seattle (o están traducidos dentro de la ficción del
francés o del alemán, si el original lo dice): que sean documentos auténticos en inglés de su tipo:
SMS, informes de policía y del médico forense, cartas sindicales, diarios mecanografiados, hilos de
Reddit, órdenes del día. Respetá su maquetación (etiquetas en negrita, marcas de tiempo, firmas)
línea por línea.

## 8. Salida

Recibís un JSON con el texto en castellano. Devolvé sólo el JSON que pide el esquema, con el texto en
inglés, las mismas claves y la misma estructura. El Markdown dentro de los strings sigue siendo
Markdown. No traduzcas las claves. Respetá los saltos de línea `\n` donde los tiene el original.

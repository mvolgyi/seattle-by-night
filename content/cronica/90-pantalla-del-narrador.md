---
id: PANTALLA
nombre: "Pantalla del Narrador"
carpeta: "Seattle by Night"
orden: 90
jugadores: no
origen: "14"
---

# Pantalla del Narrador

Este capítulo reúne todo lo que el Narrador necesita tener a mano en combate o en una tirada enfrentada: los antagonistas principales listos para la mesa, los PNJs menores con reservas simplificadas, el equipo de la Segunda Inquisición y una hoja de referencia rápida del Termómetro y de ANOMALY.

Las fichas completas de los Vástagos (Krell, Halloway y el resto de la ciudad) están en el capítulo 4. Aquí aparecen solo en versión de combate, con su táctica.

## El Termómetro de FIRSTLIGHT

Empieza en 2. Máximo 10.

| Sube | Cuánto | Baja | Cuánto |
|---|---|---|---|
| Cada entrega de ARQUERO (Noches 2 y 5) | +1 | Interceptar el informe forense @ID[DOC-09] antes de la Noche 3 | −1 |
| Un Vástago registrado por ANOMALY (por escena) | +1 | Retirar la sangre marcada (@ID[GAN-03]) | −1 |
| Teo contesta a *nrthln_research* (@reloj{4}) | +1 | Destruir pruebas en la redada | −1 |
| La USB de Pike queda en la cadena de custodia | +1 | Borrar la base de datos de sujetos fríos (@ID[A3-E02]) | −2 |
| La subasta de Thornquist se celebra | +2 | Halloway cae como ARQUERO (@ID[FIN-A]) | −2 |
| FIRSTLIGHT se queda con Lonnie y la USB 3 | +2 | El Expediente se destruye (@ID[FIN-C]) | −3 |
| Asalto ruidoso a Gale Sentinel | +2 |  |  |
| Abrir la cisterna del Larchmont | +2 |  |  |
| Brecha visible en el ferry o en el Denny's | +2 o +3 |  |  |
| Escena del almacén de Sal sin limpiar | +1 |  |  |
| Cada informe falso más firmado por «R. A.» | +1 |  |  |

**Botones para mover el Termómetro:**

- @termometro{+1|Entrega de ARQUERO}
- @termometro{-1|Interceptar el informe forense DOC-09}
- @termometro{+1|Vástago registrado por ANOMALY}
- @termometro{-1|Retirar la sangre marcada}
- @termometro{+1|Teo contesta a nrthln_research}
- @termometro{-1|Destruir pruebas en la redada}
- @termometro{+1|La USB de Pike en la cadena de custodia}
- @termometro{-2|Borrar la base de datos de sujetos fríos}
- @termometro{+2|La subasta de Thornquist}
- @termometro{-2|Halloway cae como ARQUERO}
- @termometro{+2|FIRSTLIGHT se queda con Lonnie y la USB 3}
- @termometro{-3|El Expediente se destruye}
- @termometro{+2|Asalto ruidoso a Gale Sentinel}
- @termometro{+2|Abrir la cisterna del Larchmont}
- @termometro{+2|Brecha visible en el ferry o en el Denny's}
- @termometro{+3|Brecha visible en el ferry o en el Denny's}
- @termometro{+1|Escena del almacén de Sal sin limpiar}
- @termometro{+1|Informe falso firmado por «R. A.»}

| Umbral | Efecto |
|---|---|
| 3 | Vigilancia pasiva sobre Helen. |
| 5 | Okafor contacta a Helen. |
| 7 | Investigación activa de un activo de la coterie. Visita a la forense «R. A.». |
| 9 | Redada (@ID[A4-E02]). |
| 10 | Purga (@ID[FIN-D]). |

## ANOMALY, en una caja

:::recuadro ANOMALY
- Está activo en los 412.000 timbres Gale Sentinel del área metropolitana y en los accesos del campus de Gale.
- Marca como COLD_SUBJECT a cualquier figura con temperatura corporal anormalmente baja. Ofuscación no lo engaña, porque no mira a la persona: mira el calor.
- Se engaña con @ID[LOR-03] a nivel 4, con ropa térmica preparada (@tirada{attributes.intelligence+skills.technology|4|Inteligencia + Tecnología (Dificultad 4)}, por escena), o desactivando el módulo localmente (@tirada{attributes.intelligence+skills.technology|4|Inteligencia + Tecnología (Dificultad 4)}).
- Northline recibe todos los registros en tiempo real desde septiembre de 2026.
:::

## Reservas de los PNJs principales, de un vistazo

| ID | Nombre | Salud | FdV | Ataque | Defensa | Social clave | Mental clave |
|---|---|---|---|---|---|---|---|
| @ID[PNJ-01] | Montgomery | 8 | 8 | 8 (Pelea) / 8 (Fuego) | 7 | Intimidación 6 | Rastreo 9 |
| @ID[PNJ-02] | Whitmore | 6 | 5 | — | 6 | Persuasión 9 | Política 7 |
| @ID[PNJ-03] | Halloway | 6 | 8 | — | 6 | Política 10 | Perspicacia 8 |
| @ID[PNJ-11] | Rosa Iturbe | 6 | 7 | 6 | 5 | Liderazgo 8 | Perspicacia 6 |
| @ID[PNJ-12] | Krell | 7 | 6 | 10 | 8 | Intimidación 6 | Consciencia 7 |
| @ID[PNJ-13] | Thornquist | 7 | 7 | 7 | 5 | Persuasión 7 | Perspicacia 8 |
| @ID[PNJ-14] | Marchetti | 5 | 7 | — | 5 | Etiqueta 7 | Investigación 7 |
| @ID[PNJ-15] | Voight | 5 | 8 | — | 5 | — | Investigación 9 |
| @ID[PNJ-16] | Fry | 5 | 5 | — | 4 | Interpretación 7 | Perspicacia 9 |
| @ID[PNJ-17] | O'Connor | 7 | 7 | 10 | 6 | Liderazgo 8 | Perspicacia 5 |
| @ID[PNJ-18] | Okafor | 6 | 9 | 7 (Fuego) | 5 | Intimidación 6 | Investigación 9 |
| @ID[PNJ-20] | Jun Takeda | 5 | 4 | 3 | 8 | — | Callejeo 6 |

:::recuadro Nota de edición
Defensa recalculada como Destreza + Atletismo desde las fichas: Krell 8 (el doc 14 decía 7) y Jun 8 (decía 6).
:::

## Cómo leer las reservas simplificadas

Siguiendo el formato de V5 para PNJs menores, cada uno tiene tres **reservas generales** (Física, Social, Mental) para cualquier acción sin especialidad, y una lista de **reservas excepcionales** para lo que sabe hacer bien. Si una acción no encaja en ninguna, usá la reserva general menos 1.

Los antagonistas en versión de combate: @ID[PNJ-12|August Krell] y @ID[PNJ-03|Charles Halloway]. Los PNJs menores, por grupo:

- **Del círculo de Halloway:** @ID[PNJ-19|Preston Gale], @ID[MEN-09|el señor Pell], @ID[MEN-04|Dawson y los ghouls de seguridad], @ID[PNJ-10|Julian Ashby] *(solo si nadie juega a Celeste Arden)*.
- **De FIRSTLIGHT:** @ID[PNJ-21|la analista S. Hale], @ID[MEN-02|el equipo táctico], @ID[MEN-11|Cole Ransom].
- **De los Lobos de Whitmore:** @ID[MEN-03|los cazarrecompensas de Montgomery] (y Dutch Lindqvist), los perros de Montgomery.
- **De Salitre:** @ID[MEN-05|los Anarquistas de Salitre] (Bas Okonjo, Tavi Mercer).
- **De la calle y el puerto:** @ID[MEN-01|Lonnie Barras], @ID[MEN-13|Sal Medeiros], @ID[MEN-14|Corwin], @ID[MEN-06|Teo Vásquez], @ID[MEN-07|el Dr. Marek Kowalski], @ID[MEN-10|Marcos Delgado].
- **De Tacoma:** @ID[MEN-08|el superviviente del Larchmont].

## El arsenal de FIRSTLIGHT

Reglas para el equipo que la Célula Puget usa contra los Vástagos.

| Equipo | Efecto |
|---|---|
| **Munición incendiaria** | El daño de las armas de fuego contra Vástagos es agravado en lugar de superficial. Cada impacto obliga a una tirada de Terror Rojo (Dificultad 2). |
| **Linterna UV de alta intensidad** | Un Vástago iluminado directamente sufre 1 de daño agravado por turno y −2 dados a todas sus acciones. Fortaleza (Desafiar la perdición) reduce el daño. |
| **Generador de luz solar artificial** (en la furgoneta) | Ilumina una zona de 20 metros. Dentro: 2 de daño agravado por turno y Terror Rojo automático (Dificultad 3) al entrar. Tarda dos turnos en encenderse. |
| **Gafas térmicas** | Anulan Ofuscación de nivel 1 y 2. A los Vástagos se los ve como siluetas frías, y eso los delata. |
| **Dron con cámara térmica** | Ve a toda la zona y coordina al equipo: +2 dados a sus tiradas de Consciencia y emboscada. Derribarlo: Fuerza + Atletismo (Dificultad 4) con un objeto lanzado, o un disparo con Destreza + Armas de fuego (Dificultad 4). |
| **Cámaras corporales** | Todo lo que ven va a Northline en tiempo real. Cada acción sobrenatural visible delante de una cámara: Termómetro +1 (máximo +2 por escena). |

## Registro de IDs de los capítulos 4 (parte 2) y 8

**Capítulo 4, parte 2: los de fuera.** No todos los Vástagos de Seattle se sientan en la Galería de Vidrio. Estos cuatro viven en los márgenes: un hermano que nadie conocía, una baronesa con una deuda vieja, un Sheriff caído y una mensajera que no sabe lo que lleva. Al final del capítulo hay recuadros resumen de David, Helen y Bear, que ya tienen documentos propios.

- **@ID[PNJ-12]** · August Krell: **chiquillo de Vance desde 1972**, hermano de sangre de David.
- **@ID[REF-03]** · Ray Dorsey, el Anarquista que mató a Emily en 1996 (destruido por David).
- **Piedras de toque PNJ:** Dani Okeke (O'Connor), Joe Barrientos (Rosa), Haruko Takeda (Jun).
- **Objeto:** el abrigo de Vance, que llegó a Halloway en el mismo lote que los diarios.
- **Objeto:** la memoria USB de Jun, con la copia parcial del Expediente de 2019 a 2022.

**Capítulo 8: estadísticas.**

- **@ID[PNJ-10]** · Julian Ashby, chiquillo de Halloway (sustituto de Celeste si no se juega)
- **@ID[PNJ-18]** · Dana Okafor: ficha completa
- **@ID[PNJ-21]** · Sasha Hale: nombre completo fijado
- **MEN-01 a MEN-14** · Todas las reservas simplificadas
- Los perros de Montgomery, Dutch Lindqvist, Bas Okonjo y Tavi Mercer, con reservas propias

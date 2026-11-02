---
nombre: "Storyteller Screen"
fuente: 793866c777ed3d8f
---

# Storyteller Screen

This chapter gathers everything the Storyteller needs at hand during combat or a contested test: the main antagonists ready for the table, the minor NPCs with simplified dice pools, the Second Inquisition's gear, and a quick-reference sheet for the Thermometer and ANOMALY.

The full character sheets for the Kindred (Krell, Halloway, and the rest of the city) are in Chapter 4. Here they appear only in combat form, with their tactics.

## FIRSTLIGHT's Thermometer

Starts at 2. Maximum 10.

| Raises | By | Lowers | By |
|---|---|---|---|
| Each ARCHER delivery (Nights 2 and 5) | +1 | Intercepting the medical examiner's report @ID[DOC-09] before Night 3 | −1 |
| A Kindred logged by ANOMALY (per scene) | +1 | Removing the marked blood (@ID[GAN-03]) | −1 |
| Teo answers *nrthln_research* (@reloj{4}) | +1 | Destroying evidence during the raid | −1 |
| The Pike USB drive stays in the chain of custody | +1 | Wiping the cold subject database (@ID[A3-E02]) | −2 |
| Thornquist's auction goes ahead | +2 | Halloway goes down as ARCHER (@ID[FIN-A]) | −2 |
| FIRSTLIGHT keeps Lonnie and USB drive 3 | +2 | The File is destroyed (@ID[FIN-C]) | −3 |
| Loud assault on Gale Sentinel | +2 |  |  |
| Opening the Larchmont cistern | +2 |  |  |
| Visible breach on the ferry or at the Denny's | +2 or +3 |  |  |
| Sal's warehouse scene left uncleaned | +1 |  |  |
| Each additional false report signed by “R. A.” | +1 |  |  |

**Buttons to move the Thermometer:**

- @termometro{+1|ARCHER delivery}
- @termometro{-1|Intercepting the medical examiner's report DOC-09}
- @termometro{+1|Kindred logged by ANOMALY}
- @termometro{-1|Removing the marked blood}
- @termometro{+1|Teo answers nrthln_research}
- @termometro{-1|Destroying evidence during the raid}
- @termometro{+1|The Pike USB drive in the chain of custody}
- @termometro{-2|Wiping the cold subject database}
- @termometro{+2|Thornquist's auction}
- @termometro{-2|Halloway goes down as ARCHER}
- @termometro{+2|FIRSTLIGHT keeps Lonnie and USB drive 3}
- @termometro{-3|The File is destroyed}
- @termometro{+2|Loud assault on Gale Sentinel}
- @termometro{+2|Opening the Larchmont cistern}
- @termometro{+2|Visible breach on the ferry or at the Denny's}
- @termometro{+3|Visible breach on the ferry or at the Denny's}
- @termometro{+1|Sal's warehouse scene left uncleaned}
- @termometro{+1|False report signed by “R. A.”}

| Threshold | Effect |
|---|---|
| 3 | Passive surveillance on Helen. |
| 5 | Okafor contacts Helen. |
| 7 | Active investigation of one of the coterie's assets. A visit to the medical examiner “R. A.” |
| 9 | Raid (@ID[A4-E02]). |
| 10 | Purge (@ID[FIN-D]). |

## ANOMALY, in a Box

:::recuadro ANOMALY
- It's active on the 412,000 Gale Sentinel doorbells in the metro area and at the access points of the Gale campus.
- It flags as COLD_SUBJECT any figure with an abnormally low body temperature. Obfuscate doesn't fool it, because it isn't looking at the person: it's looking at the heat.
- It can be fooled with @ID[LOR-03] at level 4, with prepared thermal clothing (@tirada{attributes.intelligence+skills.technology|4|Intelligence + Technology (Difficulty 4)}, per scene), or by disabling the module locally (@tirada{attributes.intelligence+skills.technology|4|Intelligence + Technology (Difficulty 4)}).
- Northline has received every log in real time since September 2026.
:::

## Major NPC Pools at a Glance

| ID | Name | Health | WP | Attack | Defense | Key Social | Key Mental |
|---|---|---|---|---|---|---|---|
| @ID[PNJ-01] | Montgomery | 8 | 8 | 8 (Brawl) / 8 (Firearms) | 7 | Intimidation 6 | Tracking 9 |
| @ID[PNJ-02] | Whitmore | 6 | 5 | — | 6 | Persuasion 9 | Politics 7 |
| @ID[PNJ-03] | Halloway | 6 | 8 | — | 6 | Politics 10 | Insight 8 |
| @ID[PNJ-11] | Rosa Iturbe | 6 | 7 | 6 | 5 | Leadership 8 | Insight 6 |
| @ID[PNJ-12] | Krell | 7 | 6 | 10 | 8 | Intimidation 6 | Awareness 7 |
| @ID[PNJ-13] | Thornquist | 7 | 7 | 7 | 5 | Persuasion 7 | Insight 8 |
| @ID[PNJ-14] | Marchetti | 5 | 7 | — | 5 | Etiquette 7 | Investigation 7 |
| @ID[PNJ-15] | Voight | 5 | 8 | — | 5 | — | Investigation 9 |
| @ID[PNJ-16] | Fry | 5 | 5 | — | 4 | Performance 7 | Insight 9 |
| @ID[PNJ-17] | O'Connor | 7 | 7 | 10 | 6 | Leadership 8 | Insight 5 |
| @ID[PNJ-18] | Okafor | 6 | 9 | 7 (Firearms) | 5 | Intimidation 6 | Investigation 9 |
| @ID[PNJ-20] | Jun Takeda | 5 | 4 | 3 | 8 | — | Streetwise 6 |

:::recuadro Editor's Note
Defense recalculated as Dexterity + Athletics from the character sheets: Krell 8 (doc 14 said 7) and Jun 8 (it said 6).
:::

## How to Read Simplified Pools

Following the V5 format for minor NPCs, each one has three **general pools** (Physical, Social, Mental) for any action outside their specialty, and a list of **exceptional pools** for what they're good at. If an action doesn't fit any of them, use the general pool minus 1.

The antagonists in combat form: @ID[PNJ-12|August Krell] and @ID[PNJ-03|Charles Halloway]. The minor NPCs, by group:

- **Halloway's circle:** @ID[PNJ-19|Preston Gale], @ID[MEN-09|Mr. Pell], @ID[MEN-04|Dawson and the security ghouls], @ID[PNJ-10|Julian Ashby] *(only if no one plays Celeste Arden)*.
- **FIRSTLIGHT:** @ID[PNJ-21|analyst S. Hale], @ID[MEN-02|the tactical team], @ID[MEN-11|Cole Ransom].
- **Whitmore's Wolves:** @ID[MEN-03|Montgomery's bounty hunters] (and Dutch Lindqvist), Montgomery's dogs.
- **Salt's:** @ID[MEN-05|Salt's Anarchs] (Bas Okonjo, Tavi Mercer).
- **The street and the port:** @ID[MEN-01|Lonnie Barras], @ID[MEN-13|Sal Medeiros], @ID[MEN-14|Corwin], @ID[MEN-06|Teo Vásquez], @ID[MEN-07|Dr. Marek Kowalski], @ID[MEN-10|Marcos Delgado].
- **Tacoma:** @ID[MEN-08|the Larchmont survivor].

## The FIRSTLIGHT Arsenal

Rules for the gear the Puget Cell uses against Kindred.

| Gear | Effect |
|---|---|
| **Incendiary ammunition** | Firearm damage against Kindred is aggravated instead of superficial. Each hit forces a Terror Frenzy test (Difficulty 2). |
| **High-intensity UV flashlight** | A Kindred caught directly in the beam takes 1 aggravated damage per turn and −2 dice to all actions. Fortitude (Defy Bane) reduces the damage. |
| **Artificial sunlight generator** (in the van) | Lights a 20-meter zone. Inside: 2 aggravated damage per turn and an automatic Terror Frenzy test (Difficulty 3) on entering. Takes two turns to power up. |
| **Thermal goggles** | Negate Obfuscate levels 1 and 2. Kindred show up as cold silhouettes, and that gives them away. |
| **Thermal drone** | Sees the whole area and coordinates the team: +2 dice to their Awareness and ambush rolls. Bringing it down: Strength + Athletics (Difficulty 4) with a thrown object, or a shot with Dexterity + Firearms (Difficulty 4). |
| **Body cameras** | Everything they see goes to Northline in real time. Each visible supernatural act in front of a camera: Thermometer +1 (maximum +2 per scene). |

## ID Registry for Chapters 4 (Part 2) and 8

**Chapter 4, Part 2: The Outsiders.** Not every Kindred in Seattle sits in the Glass Gallery. These four live on the margins: a brother nobody knew about, a baroness with an old debt, a fallen Sheriff, and a courier who doesn't know what she carries. At the end of the chapter there are summary sidebars for David, Helen, and Bear, who already have their own documents.

- **@ID[PNJ-12]** · August Krell: **Vance's childe since 1972**, David's blood brother.
- **@ID[REF-03]** · Ray Dorsey, the Anarch who killed Emily in 1996 (destroyed by David).
- **NPC Touchstones:** Dani Okeke (O'Connor), Joe Barrientos (Rosa), Haruko Takeda (Jun).
- **Item:** Vance's coat, which reached Halloway in the same lot as the journals.
- **Item:** Jun's USB drive, with the partial copy of the File from 2019 to 2022.

**Chapter 8: Stats.**

- **@ID[PNJ-10]** · Julian Ashby, Halloway's childe (stand-in for Celeste if she isn't played)
- **@ID[PNJ-18]** · Dana Okafor: full character sheet
- **@ID[PNJ-21]** · Sasha Hale: full name set
- **MEN-01 to MEN-14** · All simplified pools
- Montgomery's dogs, Dutch Lindqvist, Bas Okonjo, and Tavi Mercer, with their own pools

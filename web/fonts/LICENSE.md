# Písma pro mapu

Předpřipravené glyfy (`.pbf`) pro popisky na mapě. Leží tady schválně:
appka je servíruje z vlastní domény, takže při vykreslování mapy nesahá
nikam ven (`R2`, `R12`).

| | |
|---|---|
| **Písmo** | Noto Sans (Regular, Medium) |
| **Licence** | SIL Open Font License 1.1 — použití i šíření povolené, včetně komerčního |
| **Odkud** | `github.com/protomaps/basemaps-assets`, adresář `fonts/` |
| **Rozsahy** | **všech 256** (`0-255` až `65280-65535`) u obou řezů, staženo 26. 9. 2026. Obsah mají latinka, řečtina, azbuka, arabština, tifinagh, etiopské písmo, dévanágarí a další; CJK a zbytek jsou prázdné soubory po pár bajtech |

🚨 **Chybět nesmí ani jeden rozsah — ani prázdný.** Do 26. 9. 2026 tu byla
jen latinka (`0-255`, `256-511`) a poznámka, že se jiná jména „jen nevykreslí".
**Nebyla to pravda:** když MapLibre na rozsah dostane 404, zahodí **celou
dlaždici** — i s pevninou, vodou a silnicemi. Káhira, střed Sahary a všude,
kde jsou popisky arabsky, azbukou nebo řecky, zůstalo prázdné pozadí.
Web si stahuje jen rozsahy, které zrovna potřebuje; v APK je celá sada (~11 MB).
Hlídá to `test/selftest-map-style.mjs`.

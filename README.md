# MeteoTrace

**Počasí na trase.** Zadáš start a cíl — appka ukáže, jaké počasí tě čeká v jednotlivých
bodech trasy **v čase, kdy tam skutečně dorazíš**. Ne jak prší v Brně teď, ale jak tam
bude pršet, až tam za tři hodiny dojedeš.

Plus meteostanice pro jedno místo: aktuální stav, hodinový graf, sedmidenní předpověď,
srážkový radar, pyl a výstrahy ČHMÚ.

Android + web. Zdarma.

---

## Stav

**Před první řádkou produkčního kódu.** Probíhá ověření architektury — viz níže.

## Dokumentace

Je **mimo tohle repo**, v `..\dokumentace\`:

- `meteotrace-rozhodnuti.md` — záznam rozhodnutí R0–R10 i s důvody
- `meteotrace-architektura.md` — komponenty, hosting, náklady
- `meteotrace-zadani.md` — vstupní brief

## Test plynulosti mapy

Rozhoduje o tom, jestli platí architektura postavená na PWA (rozhodnutí R1), a čím mapu
kreslit. Porovná dva renderery na **stejné naskriptované dráze**, aby byly výsledky
srovnatelné:

- **vektor** — MapLibre GL JS přes WebGL (cíl podle R3, vlastní `.pmtiles` jsou vektorové)
- **rastr** — Leaflet (záložní cesta)

Obojí volitelně s radarovou vrstvou navrch.

```bash
node test/serve.mjs
```

Skript vypíše adresu, kterou zadáš do Chromu **v telefonu** (musí být na stejné wifi).
Měří se `medián FPS`, `nejhorších 5 %`, podíl záseků a nejdelší snímek.

**Rozhoduje sloupec „nejhorších 5 %"**, ne medián — průměr klame, uživatel vnímá právě
ty záseky.

> Nepoužívej na tenhle test emulátor. Běží na grafice počítače a odpoví na jinou otázku.
> Referenční přístroj je **Samsung A53** (střední třída). Z Fold 7 slouží jako kontrola
> a na test rozvržení skládacího displeje.

⚠️ Zdroje dlaždic v testu jsou **dočasné, jen pro vývoj**. V produkci je nahradí vlastní
Protomaps `.pmtiles` (R3).

## Licence

Zatím nestanovena.

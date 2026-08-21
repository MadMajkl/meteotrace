# MeteoTrace

**Počasí na trase.** Zadáš start a cíl — appka ukáže, jaké počasí tě čeká v jednotlivých
bodech trasy **v čase, kdy tam skutečně dorazíš**. Ne jak prší v Brně teď, ale jak tam
bude pršet, až tam za tři hodiny dojedeš.

Plus meteostanice pro jedno místo: aktuální stav, hodinový graf, sedmidenní předpověď,
srážkový radar, pyl a výstrahy.

Android + web. Zdarma.

---

## Stav

| | |
|---|---|
| Architektura (PWA, R1) | ✅ ověřená měřením — 60 FPS na Samsungu A53 |
| **ETA jádro** | ✅ hotové, 36 kontrol zeleně |
| Proxy vrstva · UI · mapa | ⬜ další na řadě |

## Dokumentace

Je **mimo tohle repo**, v `..\dokumentace\` — rozcestník je `README.md`:

- `02-rozhodnuti.md` — **záznam rozhodnutí R0–R10 i s důvody. Čti jako první.**
- `01-architektura.md` — komponenty, hosting, náklady, mapa kódu, samotesty
- `03-vyvoj-progress.md` — deník vývoje
- `04-zadani.md` — vstupní brief

## Samotesty

```bash
npm run selftest          # čistá logika: bez prohlížeče, bez sítě, bez DOM
```

**Nulové závislosti** — jede na vestavěném `node --test`, není co instalovat.

Pravidlo převzaté z mailniña: **test nesmí nikdy sáhnout na síť ani na skutečná data.**
Když bude potřeba odpověď z API, přibalí se jako fixture. A druhé pravidlo: **čistá logika
je nejlevnější test ze všech**, takže co se dá ověřit bez prohlížeče, se tam ověřit má.

## Test plynulosti mapy

Rozhodl o architektuře (R1) i o tom, čím mapu kreslit. Porovná **vektor** (MapLibre GL JS
nad vlastními `.pmtiles`) proti **rastru** (Leaflet) — každý svojí vlastní animací, aby
byly výsledky srovnatelné.

```bash
npm run dev             # vypíše adresu pro telefon (stejná wifi)
```

Měří medián FPS, nejhorších 5 %, podíl záseků a nejdelší snímek. **Rozhoduje sloupec
„nejhorších 5 %"**, ne medián — průměr klame, uživatel vnímá právě záseky.

> ⚠️ **Na tenhle test nepoužívej emulátor.** Běží na grafice počítače a odpoví na jinou
> otázku — na tomhle stroji navíc při vykreslování mapy spolehlivě spadne. Referenční
> přístroj je Samsung A53.
>
> ⚠️ Zdroje dlaždic v testu jsou **dočasné, jen pro vývoj**. V produkci je nahradí vlastní
> Protomaps `.pmtiles` (R3).

## Licence

Zatím nestanovena.

# MeteoTrace — pokyny pro Claude

Appka „počasí na trase": uživatel zadá start a cíl, appka ukáže počasí v bodech trasy
**v čase, kdy tam skutečně dorazí**. Plus meteostanice pro jedno místo.

## ⚠️ Nejdřív si přečti dokumentaci — je MIMO tohle repo

Leží v `..\dokumentace\` (tedy `C:\develop\meteotrace-pracovni\dokumentace\`):

| Soubor | Co v něm je |
|---|---|
| `meteotrace-rozhodnuti.md` | **Záznam rozhodnutí R0–R10 i s důvody. Čti jako první.** |
| `meteotrace-architektura.md` | Komponenty, hosting, náklady, proxy vrstva |
| `meteotrace-zadani.md` | Vstupní brief: co se staví, název, domény, zdroje dat |

**Bez přečtení `meteotrace-rozhodnuti.md` hrozí, že znovu otevřeš rozhodnutí, které už
padlo** — hlavně název (R9), PWA vs nativ (R1), proč ne Mapy.cz (R4) a proč se nestaví
vlastní předpověď (R5).

Nová rozhodnutí přidávej jako další záznam `R<n>`. **Stará nepřepisuj**, jen je označ jako
nahrazená (♻️) i s důvodem — historie úvah je cennější než čistý dokument.

## Řídící princip (R0)

Vždy technologicky špičkové řešení, které **co nejméně zastarává** a je **snadno
rozšiřitelné**. Co nejmenší závislost na třetích stranách — kde to jde, jít vlastní cestou
**i za cenu zvýšených nákladů**. **Nikdy quick win teď, který bude drahý v budoucnu.**

Sáhne-li se kvůli rychlosti startu po cizí službě, musí být **od začátku za abstrakcí
a vyměnitelná konfigurací**, ne přepisem.

## Architektura ve zkratce

- **Jádro = webová PWA**: vanilla JS/HTML/CSS, ES moduly, **žádný framework, žádný build krok**.
- **Android = tenký WebView obal.** Jeden zdroj pravdy jsou webové soubory v rootu repa;
  po každé změně sync do `android/app/src/main/assets/www/`.
  **Nikdy needituj kopie v `assets/www/` ani v `build/`.**
- **Klient nikdy nevolá cizí doménu** — jen vlastní `/api/…` (R2). V appce to obsluhuje
  `WebViewAssetLoader` s vlastním `PathHandler`, na webu Netlify Function.
- Referenční jazyk je **`en`**, první překlad `cs`. Jednotky (°C/°F, km/h) jsou
  **samostatná osa, ne součást jazyka**.

## Pracovní pravidla

- **Editace přes Read/Edit (UTF-8)**, ne přes PowerShell `Get-Content`/`Set-Content` —
  rozbíjí to diakritiku.
- **Git: NIKDY nepushovat bez výslovného svolení.** Commit lokálně ano, push až na „jeď".
  U každé git operace vypiš přesné příkazy, které se pustí.
- **Verzi bumpovat až úplně nakonec**, na všech místech najednou.
- **Paritní test i18n je povinná brána** po každém zásahu do lokalizace.
- **Headless prohlížeč ani emulátor neodhalí chyby specifické pro WebView** ani skutečný
  výkon telefonu — na výkon se testuje na reálném zařízení (Samsung A53 = referenční
  střední třída, Z Fold 7 = vlajková loď a test skládacího displeje).

Vzorem procesu i architektury je Gulpka — `C:\develop\napij_se-pracovni\`, zejména
`napijse-poznamky\DOKUMENTACE-appka_b.md` a `skilly-claude-gulpka.md`.

## Aktuální stav

Projekt je **před první řádkou produkčního kódu**. Běží ověření R1: `test/map-bench.html`
porovná vykreslování vektoru (MapLibre) a rastru (Leaflet) na reálném telefonu.
**Dokud tenhle test neproběhne, nepiš produkční kód** — jeho výsledek rozhoduje o tom,
jestli PWA větev vůbec platí.

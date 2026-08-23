# MeteoTrace — pokyny pro Claude

Appka „počasí na trase": uživatel zadá start a cíl, appka ukáže počasí v bodech trasy
**v čase, kdy tam skutečně dorazí**. Plus meteostanice pro jedno místo.

## ⚠️ Nejdřív si přečti dokumentaci — je MIMO tohle repo

Leží v `..\dokumentace\` (tedy `C:\develop\meteotrace-pracovni\dokumentace\`):

| Soubor | Co v něm je |
|---|---|
| `02-rozhodnuti.md` | **Záznam rozhodnutí R0–R13 i s důvody. Čti jako první.** |
| `01-architektura.md` | Komponenty, hosting, náklady, proxy vrstva |
| `04-zadani.md` | Vstupní brief: co se staví, název, domény, zdroje dat |

**Bez přečtení `02-rozhodnuti.md` hrozí, že znovu otevřeš rozhodnutí, které už
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
- **Klient nevolá cizí doménu pro DATA** — jen vlastní `/api/…` (R2). **Výjimkou jsou
  mapové dlaždice** (radar, podklad), které se stahují napřímo — viz R12. V appce to obsluhuje
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

## Aktuální stav (k 22. 8. 2026)

**Podrobný a průběžně vedený stav je v `..\dokumentace\03-vyvoj-progress.md` — čti ho,
tohle je jen shrnutí.**

| Hotovo | |
|---|---|
| Architektura (R1) | ověřená měřením: 60 FPS na Samsungu A53 |
| ETA jádro | `web/lib/eta.js` |
| Proxy vrstva | `server/proxy.js`, Netlify Function, ověřená naživo |
| i18n, jednotky, kódy počasí | `web/lib/`, referenční jazyk **en** |
| Meteostanice | `web/index.html` + `app.js`, ověřená naživo |
| Mapa se srážkovým radarem | `web/map.js`, ověřená naživo |
| Počasí na trase — **logika** | `web/lib/route-adapter.js` + `route-view.js` |
| Ukládání míst | `web/lib/places.js` + správa v dialogu (přejmenování, mazání), ověřené naživo |
| Hranice ORP pro výstrahy | `web/lib/orp.js` + `web/data/orp-boundaries.js` (generuje `npm run orp`), viz R11 |
| Vlastní mapa (R3) | `web/data/cz.pmtiles` (1,4 GB, mimo git) + `web/lib/map-style.js` + `web/fonts/`, vyrábí `npm run tiles` |
| Výstrahy na meteostanici | `web/lib/warnings-view.js` + výřez podle polohy v proxy, ověřené naživo |
| Obrys výstrahy v mapě | `showWarningArea()` v `map.js`, hranice se posílá jen na `geo=1` |
| Android obal (R1, R13) | `android/`, sestaví `npm run android`; nativní vrstva je jen potrubí na náš server |

**310 kontrol, všechny zelené.** **1 commit NENÍ pushnutý.** Push jen na výslovné svolení.

### ⛔ Co blokuje pokračování

**Chybí klíč k openrouteservice.** Zdarma na `account.heigit.org`, vloží se do proměnné
prostředí `ORS_API_KEY`. Bez něj vrací `/api/route` chybu 500 a **nejde dodělat obrazovku
trasy** — logika je hotová a otestovaná proti přibaleným odpovědím, ale UI psané naslepo,
které nikdy nevidělo skutečnou odpověď, bývá vedle.

### Příkazy

```bash
npm run selftest            # čistá logika: bez prohlížeče, bez sítě, ~1 s
npm run dev                 # appka + testy + proxy na jednom portu (8099)
npm run selftest:layout     # rozvržení na 5 šířkách displeje (server musí běžet)
npm run orp                 # znovu stáhne hranice ORP z ČÚZK (ruční krok, ne za běhu)
npm run tiles               # vyrobí vlastní podklad mapy (1,4 GB, potřebuje tools/bin/pmtiles.exe)
npm run android             # nasype web do obalu a sestaví APK (JDK z Android Studia)
npm run docx                # dokumentace do Wordu
```

### Na co narazit nechceš

Pasti, které už jednou stály čas, jsou popsané v `03-vyvoj-progress.md`. Nejdražší byly:

- **🚨 Správné chování, o kterém se mlčí, se od chyby nedá odlišit.** Testy ověřují,
  co se stane, ne co se o tom uživatel dozví — a přesně tam se schovaly dvě vady
  v uložených místech: slučování podle vzdálenosti udělalo z hvězdičky past (mazala
  místo, jehož jméno nikde nepadlo) a hláška o režimu jen pro čtení byla nedosažitelná
  (vypnuté tlačítko klik nepošle), zato vyskakovala u akce, o kterou nikdo nežádal.
  **U každého ochranného opatření se ptej: co z toho uvidí uživatel, a dělá tlačítko
  přesně to, co říká jeho popisek?**
- **🚨 Geokód `CISORP` ve výstraze NENÍ rozsah, jen zástupce.** Týž kód nese pokaždé
  jinou sadu ORP; skutečný rozsah je jen v českém textu `areaDesc`. Přiřazení podle
  kódu by ukázalo výstrahu pro celý kraj jedinému městu. Viz R11.
- **🚨 Výřez odpovědi podle polohy patří AŽ ZA CACHE.** V cache leží odpověď společná
  všem; kdyby se ukládal výřez, dostal by druhý tazatel data prvního a nepoznal by to.
- **🚨 U dlaždic nestačí stav odpovědi.** RainViewer nad svým stropem (z7) vrací
  `200 image/png` s natištěným nápisem „Zoom Level Not Supported". Pozná se to jen
  velikostí a otiskem souboru. Strop je v `radar.js` jako `MAX_ZOOM` a MUSÍ být
  i v `maxzoom` rastrového zdroje. Pozor: u `tileSize: 256` si MapLibre říká
  o úroveň VYŠŠÍ, než je přiblížení mapy — proto jsou dlaždice 512px.
- **🚨 Vrstva přidaná do mapy navrch přebije všechno pod sebou** — a radar se zakládá
  znovu při KAŽDÉM snímku animace. Cokoli, co má být nad radarem, se mu musí předat
  jako `beforeId`, jinak to po vteřině zmizí samo.
- **⚠️ Podklad mapy je vlastní `.pmtiles` a čte se po kouskách** — server MUSÍ umět
  `Range`. Pozor: `bytes=-500` znamená POSLEDNÍCH 500 bajtů, a rejstřík archivu je
  právě na konci.
- **🚨 `WebViewAssetLoader` ZAHAZUJE dotazovací část adresy.** Z `/api/forecast?latitude=…`
  by zbylo `/api/forecast` — nespadne to, jen přijde předpověď pro jiné místo. Proto se
  `/api/` obsluhuje v `shouldInterceptRequest`, ne přes AssetLoader. Viz R13.
- **Mapu netestuj na emulátoru** — na tomhle stroji spadne při vykreslování (dva pokusy,
  dva segfaulty). Referenční přístroj je **Samsung A53**.
- **Když nástroj tvrdí, že je appka rozbitá, ověř nejdřív, že měří to, co si myslí.**
  Večer ladění mapy byly nakonec čtyři chyby v `tools/browser.mjs`, ne v appce.
- **Layoutový test běží s `?nomap=1`** — pět rámů s vlastním MapLibre by stránku přetížilo.

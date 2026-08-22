# MeteoTrace — pokyny pro Claude

Appka „počasí na trase": uživatel zadá start a cíl, appka ukáže počasí v bodech trasy
**v čase, kdy tam skutečně dorazí**. Plus meteostanice pro jedno místo.

## ⚠️ Nejdřív si přečti dokumentaci — je MIMO tohle repo

Leží v `..\dokumentace\` (tedy `C:\develop\meteotrace-pracovni\dokumentace\`):

| Soubor | Co v něm je |
|---|---|
| `02-rozhodnuti.md` | **Záznam rozhodnutí R0–R10 i s důvody. Čti jako první.** |
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

## Aktuální stav (k 21. 8. 2026)

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

**184 kontrol, všechny zelené.** Devět commitů **není pushnutých** (čeká na svolení).

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
npm run docx                # dokumentace do Wordu
```

### Na co narazit nechceš

Pasti, které už jednou stály čas, jsou popsané v `03-vyvoj-progress.md`. Nejdražší byly:

- **Mapu netestuj na emulátoru** — na tomhle stroji spadne při vykreslování (dva pokusy,
  dva segfaulty). Referenční přístroj je **Samsung A53**.
- **Když nástroj tvrdí, že je appka rozbitá, ověř nejdřív, že měří to, co si myslí.**
  Večer ladění mapy byly nakonec čtyři chyby v `tools/browser.mjs`, ne v appce.
- **Layoutový test běží s `?nomap=1`** — pět rámů s vlastním MapLibre by stránku přetížilo.

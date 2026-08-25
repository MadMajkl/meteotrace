# MeteoTrace — pokyny pro Claude

Appka „počasí na trase": uživatel zadá start a cíl, appka ukáže počasí v bodech trasy
**v čase, kdy tam skutečně dorazí**. Plus meteostanice pro jedno místo.

## ⚠️ Nejdřív si přečti dokumentaci — je MIMO tohle repo

Leží v `..\dokumentace\` (tedy `C:\develop\meteotrace-pracovni\dokumentace\`):

| Soubor | Co v něm je |
|---|---|
| `02-rozhodnuti.md` | **Záznam rozhodnutí R0–R14 i s důvody. Čti jako první.** |
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
- **🕠 Push jen po 16:30 a jen ve všední dny** (Michalovo pravidlo z 24. 8. 2026).
  Nikdy jindy, pokud výslovně neřekne jinak. Commitovat průběžně ano — odesílat ven
  jen v tom okně.
- **Zprávu commitu piš do souboru** (`git commit -F <soubor>`, soubor přes Write) —
  heredoc v shellu žere zpětná lomítka a mrší diakritiku.
- **Verzi bumpovat až úplně nakonec**, na všech místech najednou.
- **Paritní test i18n je povinná brána** po každém zásahu do lokalizace.
- **Headless prohlížeč ani emulátor neodhalí chyby specifické pro WebView** ani skutečný
  výkon telefonu — na výkon se testuje na reálném zařízení (Samsung A53 = referenční
  střední třída, Z Fold 7 = vlajková loď a test skládacího displeje).

Vzorem procesu i architektury je Gulpka — `C:\develop\napij_se-pracovni\`, zejména
`napijse-poznamky\DOKUMENTACE-appka_b.md` a `skilly-claude-gulpka.md`.

## Aktuální stav (k 25. 8. 2026)

**Podrobný a průběžně vedený stav je v `..\dokumentace\03-vyvoj-progress.md` — čti ho,
tohle je jen shrnutí.**

| Hotovo | |
|---|---|
| Architektura (R1) | ověřená měřením: 60 FPS na Samsungu A53 |
| ETA jádro | `web/lib/eta.js` |
| Proxy vrstva | `server/proxy.js`, katalog zdrojů `web/lib/upstreams.js`, ověřená naživo |
| i18n, jednotky, kódy počasí | `web/lib/`, referenční jazyk **en** |
| Meteostanice | `web/index.html` + `app.js`, ověřená naživo |
| Mapa se srážkovým radarem | `web/map.js`, ověřená naživo |
| **Počasí na trase — obrazovka** | `web/app.js` (záložka Trasa), logika v `route-adapter.js` + `route-view.js`; **klíč k ORS je v `.env`**, Praha → Brno vrací 205 km / 129 min |
| Trasa vzdušnou čarou | `web/lib/great-circle.js` — bez routeru, bez kvóty (lety, lodě, záchranná brzda) |
| Nadmořská výška bodů trasy | z odpovědi Open-Meteo, bez volání navíc |
| Hledání míst a **adres** (R14) | Pelias u HeiGIT + Open-Meteo jako záloha; řadí od nejbližšího podle vybraného místa nebo (je-li povolená) polohy ze zařízení |
| Ukládání míst | `web/lib/places.js` + správa v dialogu, ověřené naživo |
| Hranice ORP pro výstrahy | `web/lib/orp.js` + `web/data/orp-boundaries.js` (generuje `npm run orp`), viz R11 |
| Vlastní mapa (R3) | `web/data/cz.pmtiles` (1,4 GB, mimo git) + `map-style.js` + `web/fonts/`, vyrábí `npm run tiles` |
| **Hosting mapy** | Cloudflare R2, bucket `meteotrace-maps`, nahrává `npm run tiles:upload`; adresa je konfigurace (`meta[name=meteotrace:tiles]`) |
| Výstrahy na meteostanici | `web/lib/warnings-view.js` + výřez podle polohy v proxy, ověřené naživo |
| Obrys výstrahy v mapě | `showWarningArea()` v `map.js`, hranice se posílá jen na `geo=1` |
| Výběr místa klepnutím do mapy | `web/lib/map-pick.js`, jméno z vlastních dlaždic |
| Srovnání časů odjezdu (R8) | přepínač Teď / +1 / +2 / +3 h, bez jediného dotazu navíc |
| Trasa v mapě | čára a body podle počasí; táž mapa se mezi obrazovkami PŘESOUVÁ (jedna instance MapLibre) |
| Uložené trasy (R8) | hvězdička u souhrnu, lišta nad formulářem, mazání v dialogu |
| Start a cíl klepnutím do mapy | na trase zadá klepnutí start, další cíl |
| Množné číslo (i18n) | `tp()` nad `Intl.PluralRules`; tvary jsou vlastnost jazyka, hlídá `checkPlurals()` |
| Jazyk a jednotky | odhad podle zařízení + ruční přepnutí (⚙ v hlavičce); jednotky jsou samostatná osa (R10) |
| Android obal (R1, R13) | `android/`, sestaví `npm run android`; nativní vrstva je jen potrubí na náš server |

**394 kontrol, všechny zelené.** Layoutová kontrola prochází na 5 šířkách.

### 🔑 Klíče

`.env` v `meteotrace/` (**mimo git**, ověřeno): `ORS_API_KEY` (routing i hledání),
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`.
**Klíč nikdy nepatří do klienta ani do chatu** — server si ho bere z prostředí
(`needsKey` v katalogu zdrojů).

### Co zbývá do v1

**Rozsah `R8` je hotový.** Zbývají věci kolem vydání:

- 🟡 Podklad jede z vývojové adresy `r2.dev` (rate-limited) a CORS je `*` — před ostrým
  nasazením přepnout na vlastní doménu a zúžit. **Chce Michalovu ruku v Cloudflare.**
- 🟡 Ostrá doména v `BuildConfig.API_BASE` — vydané APK teď míří na vývojový počítač.
- 🟡 Verze je pořád `0.0.1` (`VERZE` v `app.js`, `package.json`, Gradle) — bumpnout
  až úplně nakonec, na všech místech najednou.

### 🟢 Vývojový server — JEN JEDNA INSTANCE

**Pravidlo (Michal, 24. 8. 2026): běží právě jedna instance, spouští ji Claude
a nechává ji běžet.** Michal si do ní vleze, kdy chce.

- **Nikdy nespouštět druhou** na jiném portu.
- **Nikdy ji nevypínat** bez řečí — když se musí restartovat, hned to říct.
- **Když se změní port, oznámit to.** Michal jednou mluvil se starou instancí, která
  neměla klíč k ORS, a chyba vypadala jako vada appky.

Běží na výchozím portu **8099** (`package.json`).

### Příkazy

```bash
npm run selftest            # čistá logika: bez prohlížeče, bez sítě, ~1 s
npm run dev                 # appka + testy + proxy na jednom portu (8099)
npm run selftest:layout     # rozvržení na 5 šířkách displeje (server musí běžet)
npm run orp                 # znovu stáhne hranice ORP z ČÚZK (ruční krok, ne za běhu)
npm run tiles               # vyrobí vlastní podklad mapy (1,4 GB, potřebuje tools/bin/pmtiles.exe)
npm run tiles:upload        # nahraje podklad do Cloudflare R2 (klíče z .env)
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
- **🚨 Headless Chrome po sobě neuklidí sám.** `kill()` na Windows sundá jen rodiče
  a Chrome se rozpadá na desítky procesů — po dni ladění jich běželo 172. Úklid je
  v `zabijStrom()`: `taskkill /T /F` **synchronně** a doklid podle dočasného profilu.
  **Nikdy podle jména procesu** — Michal má v Chromu své věci.
- **Mapu netestuj na emulátoru** — na tomhle stroji spadne při vykreslování (dva pokusy,
  dva segfaulty). Referenční přístroj je **Samsung A53**.
- **Když nástroj tvrdí, že je appka rozbitá, ověř nejdřív, že měří to, co si myslí.**
  Večer ladění mapy byly nakonec čtyři chyby v `tools/browser.mjs`, ne v appce.
- **🚨 Dvakrát zapsaný oddíl v překladu je tichá ztráta.** Objekt v JS bere poslední
  zápis a první zahodí; `warnings` byl v obou jazycích dvakrát, takže půlka byla mrtvá.
  **Paritní test to nemohl chytit** — porovnává až načtené objekty. Hlídá to teď
  kontrola nad zdrojovým textem.
- **🚨 Vrstva nad radarem musí být v `PREKRYVY`.** Radar se zakládá znovu při každém
  snímku a vkládá se pod nejnižší z nich; co v seznamu není, po vteřině zmizí samo.
- **🚨 NULOVÝ OSTROV: `0, 0` není poloha, ale „nevím".** Vrací ho prohlížeč bez
  lokalizační služby, rozbitý přijímač i prázdný formulář — a `Number.isFinite(0)`
  je `true`, takže projde jako platný bod. Hledání se pak řadilo podle vzdálenosti
  od rovníku a nabízelo jižní Čechy komukoli. Kontrola je v `isUsablePoint()`
  a zahazuje i okolí nuly (GPS nevrací přesnou nulu).
- **🚨 Platná výchozí hodnota umí udělat z odhadu mrtvou větev.** `state.lang = 'en'`
  znamenalo, že podmínka `if (!state.lang || !LANG_NAMES[state.lang])` nikdy neplatila
  a appka **nikdy nespustila odhad jazyka** — s hotovým a paritně otestovaným
  překladem v zádech. Výchozí hodnota pro „zatím nevíme" musí být `null`, ne platná
  odpověď. A **oprava sama nestačí**: komu se špatná hodnota stihla uložit, tomu se
  musí zahodit, jinak opravená appka chybuje dál právě u těch, kdo si toho všimli.
- **🚨 Heredoc v Bashi žere zpětná lomítka.** Třikrát za dva dny — naposledy při psaní
  téhle odrážky: `com\.android` se zapsalo jako `com.android` a regulární výraz
  `/^[\s,]+/` jako `/^[s,]+/` — ten by
  z „Statenice" udělal „tatenice". **Soubory s lomítky edituj přes Edit, ne přes heredoc**,
  a po zápisu si to přečti zpátky.
- **🚨 `curl` v tomhle prostředí mrší diakritiku.** Hledání kvůli tomu dvakrát vypadalo
  rozbitě, přestože bylo v pořádku. **Měř z Node**, ne z shellu.
- **Cizí služba si může vynutit typ odpovědi.** ORS vrací na naši hlavičku
  `Accept: application/json` rovnou **406** — a chyba se tváří jako výpadek cizí služby,
  ne jako naše hlavička. Proto je `accept` položkou katalogu zdrojů.
- **Co proxy propustí, to se vrátí jako cizí chyba.** Neplatný profil dopravy prošel ven
  a ORS odpověděl 404 „zdroj neodpověděl" — naše vada vypadala jako jejich výpadek.
  Katalog má proto `subPaths` jako allowlist.
- **`?nomap=1` mapu vypne — a NAPÍŠE to do plochy mapy.** Dřív kartu mlčky
  odstranil, takže vypnutá mapa vypadala jako rozbitá; Michal na to 25. 8. 2026
  naletěl, protože jsem mu ten odkaz sám poslal.
- **Layoutový test běží s `?nomap=1`** — pět rámů s vlastním MapLibre by stránku přetížilo.

# MeteoTrace — pokyny pro Claude

Appka „počasí na trase": uživatel zadá start a cíl, appka ukáže počasí v bodech trasy
**v čase, kdy tam skutečně dorazí**. Plus meteostanice pro jedno místo.

## ⚠️ Nejdřív si přečti dokumentaci — je MIMO tohle repo

Leží v `..\dokumentace\` (tedy `C:\develop\meteotrace-pracovni\dokumentace\`):

| Soubor | Co v něm je |
|---|---|
| `02-rozhodnuti.md` | **Záznam rozhodnutí R0–R17 i s důvody. Čti jako první.** |
| `01-architektura.md` | Komponenty, hosting, náklady, proxy vrstva. **§4.2 = TOKY DAT: co se kam ptá a kdy** |
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
- **🚨 Git: NIKDY NEPUSHOVAT, DOKUD MICHAL VÝSLOVNĚ NEŘEKNE.** Commit lokálně ano,
  průběžně. **Svolení k jednomu pushi neplatí pro další** — o každé odeslání ven
  si musí říct znovu (30. 8. 2026).
  **Proč: každý push spustí build na Netlify a ten žere kredity.** Není to jen
  otázka pracovní doby, je to peněžní strop. Sbírej změny a odešli je jedním
  pushem, až dá pokyn.
  U každé git operace vypiš přesné příkazy, které se pustí.
- **🕠 A i s pokynem platí okno: jen po 16:30 a jen ve všední dny**
  (pravidlo z 24. 8. 2026), pokud výslovně neřekne jinak.
- **Zprávu commitu piš do souboru** (`git commit -F <soubor>`, soubor přes Write) —
  heredoc v shellu žere zpětná lomítka a mrší diakritiku.
- **Verzi bumpovat až úplně nakonec**, na všech místech najednou.
- **Paritní test i18n je povinná brána** po každém zásahu do lokalizace.
- **Tón textů (Michal, 26. 8. 2026): živý, odlehčený, lehounce překvapivý** — ale
  **nikdy u výstrah, chyb a nebezpečí**. Věta musí vždy říct, co dělat; veselost se
  přidává k informaci, ne místo ní. Emoji jen výjimečně (dvě v celé appce).
- **Headless prohlížeč ani emulátor neodhalí chyby specifické pro WebView** ani skutečný
  výkon telefonu — na výkon se testuje na reálném zařízení (Samsung A53 = referenční
  střední třída, Z Fold 7 = vlajková loď a test skládacího displeje).

Vzorem procesu i architektury je Gulpka — `C:\develop\napij_se-pracovni\`, zejména
`napijse-poznamky\DOKUMENTACE-appka_b.md` a `skilly-claude-gulpka.md`.

## Aktuální stav (k 30. 8. 2026)

🌍 **Appka je venku na `https://meteotrace.com`** (Netlify, staví se samo z `main`).
APK pro terén: `npm run android -- --api=https://meteotrace.com`.

**Podrobný a průběžně vedený stav je v `..\dokumentace\03-vyvoj-progress.md` — čti ho,
tohle je jen shrnutí.**

| Hotovo | |
|---|---|
| Architektura (R1) | ověřená měřením: 60 FPS na Samsungu A53 |
| ETA jádro | `web/lib/eta.js` |
| Proxy vrstva | `server/proxy.js`, katalog zdrojů `web/lib/upstreams.js`, ověřená naživo |
| i18n, jednotky, kódy počasí | `web/lib/`, referenční jazyk **en** |
| Hodinová předpověď | 48 h, rolovací, s předělem dne |
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
| „Jeď sem" | na trase klepnutí na uložené místo nastaví cíl + start z polohy a rovnou počítá |
| Uložená místa v trase | pole Odkud/Kam nabízejí Domov, Práci… (bez diakritiky, první v pořadí) |
| Hlášky | `web/lib/quips.js` — na trase i na meteostanici, v duchu Mistra, JEN česky; u nebezpečí žertují, ale jev pojmenují |
| Kde nejblíž prší / kam za sluncem | `web/lib/probes.js` — **u místa i u trasy**, sondy jedním dotazem; jméno místa z vlastních hranic ORP (R15). 🚨 Strop na počet sond ořezává PO PRSTENCÍCH a `reachKm()` říká, kam se opravdu dohlédlo |
| Směr větru | v appce se píše **celým slovem** („severovýchodní"), ne zkratkou — bublina na telefonu neexistuje |
| Patra oblačnosti | 🚨 „zataženo" jen vysoko NENÍ zataženo — `jenZavoj()` ve `weather-code.js`; platí na stanici, na trase i u sond |
| Kdy to bude | `web/lib/when.js` — k času se připíše den, jakmile není dnešní (`zítra 02:16`, `1. 9. 03:17`). 🚨 Bez toho vypadala dvoudenní pěší cesta jako dnes večer. Zkratky dnů česky nejdou: „příjezd po 08:41" se čte jako „po osmé" |
| Fáze Měsíce | `web/lib/moon.js` — **počítá se, nestahuje**; je to astronomie, ne předpověď |
| Počasí po trase | vítr, nárazy a pocitovka u bodů + věta o tom, co je v cíli |
| Rozpis úseků | u trasy se zastávkami: km a čas příjezdu po úsecích + celkem |
| Mezibody trasy | libovolné zastávky mezi startem a cílem; skládá se z úseků, protože proxy je jen GET (R4) |
| Trasa v mapě | čára a body podle počasí; táž mapa se mezi obrazovkami PŘESOUVÁ (jedna instance MapLibre) |
| Pojmenování míst a tras | Domov, Práce, Babička — přepsáním jména v dialogu ⋯; u tras `renameRoute()` |
| Moje trasy / Moje místa | dvě skupiny v hlavičce; vedle nadpisu tolik posledních, kolik se změřeně vejde (`fit-row.js`) |
| Uložené trasy (R8) | hvězdička u souhrnu; v hlavičce ve **společné liště s místy** (šipka ↝), mazání v dialogu |
| Start a cíl klepnutím do mapy | na trase zadá klepnutí start, další cíl |
| Množné číslo (i18n) | `tp()` nad `Intl.PluralRules`; tvary jsou vlastnost jazyka, hlídá `checkPlurals()` |
| Pořadí záložek | vlevo je výchozí **Trasa** (odlišovač, R8) a je to zároveň úvodní obrazovka; jde prohodit v ⚙ |
| Hledání místa | patří METEOSTANICI: na trase se schová (`prepniObrazovku`), aby nad poli Odkud a Kam nestála volba, která se trasy netýká |
| Uvítání při 1. spuštění (R17) | `web/lib/onboarding.js` + `#uvitani` v app.js; 4 kroky, po nich má appka domov, cíl I TRASU. `?onboarding=1` ho vynutí bez mazání dat |
| SEO a sdílení | Open Graph, Twitter card, canonical, `robots.txt`, `sitemap.xml`, ld+json. Náhled vyrábí `npm run og`. 🚨 Appka se kreslí JS, takže MIMO `<head>` je pro robota prázdná |
| Legenda bodů trasy | barvy si bere z `ROUTE_COLORS` v map.js, ne z vlastní kopie — jinak by vysvětlovala barvy, které v mapě nejsou |
| Sbalitelná hlavička | hledání, záložky a uložené věci sedí v `#top-menu` a rozbaluje je klepnutí na značku (`nabidka()`); sbalí se sama, jakmile je co ukazovat. 🚨 Sbalený řádek nese **jméno záložky a k němu to konkrétní** („Místo · Praha"), protože záložky jsou schované |
| Jde to k nám, nebo od nás? | `web/lib/drift.js` — z větru se pozná SMĚR (přichází/odchází/mine), nikdy ČAS: přízemní vítr není rychlost srážkového pásu. 🚨 PŘEDPOVĚĎ PŘEBÍJÍ VÍTR — „přichází" se proti mlčícímu modelu netvrdí. U trasy se vítr bere z bodu nejbližšího nálezu, ne z průměru cesty |
| Kdy přestane pršet | `clearSoon` ve `station.js`, protějšek `rainSoon`. 🚨 `prsiTed` rozlišuje „neprší" od „prší a nekončí to" — bez něj by se „nevíme" tvářilo jako „hned to přejde" |
| Karta výstrah | při klidu se schová celá. 🚨 JEN ve stavu „nic nehrozí" — při výpadku a mimo pokrytí zůstane, jinak by appka mlčky tvrdila klid o něčem, o čem nic neví. Že je klid, říká tichý řádek u „aktualizováno" |
| Výzva šipkou | `.brand-sipka` se každých 10 s dvakrát kývne dolů, aby bylo poznat, že značka je tlačítko. ⚠️ Bez časovače — prodleva je uvnitř animace; jen ve sbaleném stavu a jen do prvního použití (značka `data-nabidka-znama`, neukládá se) |
| Upozornění na výstrahy (R17) | hlídá androidí obal (`Vystrahy.kt`, WorkManager, 15 min), web jen když běží. Rozhodování: server + `lib/severity.js` + `lib/warn-notify.js`; **obal jen porovnává řetězce**. Práh jde serveru jako `minSeverity`. Výchozí VYPNUTO, práh `Moderate` |
| Most do obalu | `MostDoWebu.kt` / `window.MeteoTraceObal`. ⚠️ Zůstane úzký — je to jediné okno z webu do telefonu |
| Potažení dolů = načíst znovu | logika v `web/lib/pull-refresh.js` (čistá, se samotestem), dotyk v `app.js` (`zapojPotazeni`). Obnovuje i osu radaru (`refreshRadar()` v `map.js`) |
| Vzhled | světlý / tmavý / **růžový** / **tmavě růžový** / podle zařízení (⚙); jedna značka `data-theme` na kořeni, seznam je `MOTIVY` v app.js. 🚨 `color-scheme` zná JEN light/dark — jméno motivu se tam poslat nesmí; a mapa pozná tmu podle toho, jestli jméno obsahuje `dark` |
| Dlaždice hlášek | `.quips` u místa i na trase, piktogram `noteShape()`. 🚨 Schová se celá, když není co říct — a rozhoduje se po KAŽDÉ změně (`srovnejDlazdiciHlasek`), protože obě hlášky uvnitř přicházejí v jinou chvíli |
| Semafor dlaždic | `web/lib/tile-tone.js` — prahy pro vítr, UV, tlak a soumrak. 🚨 Barva NIKDY nenese údaj sama; „nevíme" a „je klid" se nebarví obojí stejně, nebarví se vůbec |
| Jazyk a jednotky | odhad podle zařízení + ruční přepnutí (⚙ v hlavičce); jednotky jsou samostatná osa (R10) |
| PWA (R1) | manifest, ikony z jednoho SVG (`npm run icons`), service worker JEN na webu |
| Ochrana proxy (R19) | `web/lib/rate-limit.js` — omezovač na tazatele, strop na instanci, povolené `Origin`. Třída se odvozuje z `needsKey`, ne z ručního seznamu. 🚨 Omezuje se AŽ ZA CACHE a strop na instanci NENÍ globální |
| Dar (R7, R18) | **zlatá mince se srdcem — TÁŽ JAKO V GULPCE**, v hlavičce vedle ⚙ (Michal 30. 8.: „přes to vlak nejede") + řádek v nastavení. Pulz 2,6 s, respektuje `prefers-reduced-motion`. `web/lib/donate.js` (SPD 1.0, kontrola IBANu) + **vlastní QR enkodér** `web/lib/qr.js`; obrazovka je dialog s velkou pulzující mincí, kartou QR a řádky Revolut/PayPal — struktura opsaná z Gulpky. 🚨 Variabilní symbol `X-VS` (102) odliší dar pro MeteoTrace od Gulpky — na týž účet chodí obojí a zprávu smí plátce přepsat. Revolut ani PayPal poznámku předvyplnit NEUMÍ, tak se ukáže ke zkopírování. 🚨 Dar NIC neodemyká a appka to i **napíše** — jinak by z něj byla platba za digitální obsah pod Play Billing |
| Crosslinky (R7) | v ⚙ Nastavení, ne na hlavní obrazovce. Odkaz ven otevře **prohlížeč**, ne WebView |
| Android obal (R1, R13) | `android/`, sestaví `npm run android`; nativní vrstva je jen potrubí na náš server. 🚨 Appka tam běží na `…/assets/www/`, takže **cesty od kořene (`/fonts/…`) minou** — jediná výjimka je `/api/…`, podle které pozná dotazy `ApiPipe`. Hlídá `selftest-obal.mjs`. Poloha chce povolení v manifestu **i** `WebChromeClient` |

**778 kontrol, všechny zelené.** Layoutová kontrola prochází na 5 šířkách × obou obrazovkách a měří i obsah dialogů.

### 🔑 Klíče

`.env` v `meteotrace/` (**mimo git**, ověřeno): `ORS_API_KEY` (routing i hledání),
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`.
**Klíč nikdy nepatří do klienta ani do chatu** — server si ho bere z prostředí
(`needsKey` v katalogu zdrojů).

### Co zbývá do v1

**Rozsah `R8` je hotový.** Zbývají věci kolem vydání:

- 🟡 Podklad jede z vývojové adresy `r2.dev` (rate-limited) a CORS je `*` — před ostrým
  nasazením přepnout na vlastní doménu a zúžit. **Chce Michalovu ruku v Cloudflare.**
- ✅ **Nasazeno: `https://meteotrace.com` (Netlify).** Ověřeno naživo včetně ORS klíče
  a ochrany proti vylezení z cesty. APK pro terén: `npm run android -- --api=https://meteotrace.com`.
  ⚠️ `ORS_API_KEY` je v Netlify označený jako tajný — díky tomu se k němu nedostane
  nasazení z cizího forku (repo je VEŘEJNÉ). Zamčené rozsahy a kontexty jsou záměr, ne vada.
- 🟡 **Ostrá doména v `BuildConfig.API_BASE` — bez ní je APK použitelné jen doma.**
  V terénu appka nastartuje, ukáže podkladovou mapu (ta jde napřímo z R2) a u všeho
  ostatního napíše „Data se nepodařilo načíst" i s tou lokální adresou.
  Sestavení pro terén: `npm run android -- --api=https://…` (ověřeno, že se adresa
  zapéká do `classes3.dex`). **Chce Michalovu ruku:** nasadit `netlify/functions/api.js`
  a nastavit tam `ORS_API_KEY`. Funkce sama je hotová a ověřená lokálním spuštěním.
  🚨 Veřejná proxy je bez ochrany — kdo zná adresu, čerpá kvótu ORS (2 000/den).
- ✅ Verze je **jedna** a v `package.json`; `VERZE` ve webu se s ní mění jedním
  příkazem (`npm run verze -- patch|minor|major|X.Y.Z`), Android si ji čte
  z `android/version.properties` (píše `android-sync`, `versionCode` = počet
  commitů). 🚨 `pre-commit` nepustí změnu ve `web/`, `android/`, `server/` ani
  `netlify/` bez zvednuté verze — obcházet jen `SKIP_VERSION_CHECK=1`.
  Teď **0.14.7**; na `1.0.0` až s vydáním na Play.

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
npm run selftest:layout     # rozvržení na 5 šířkách × obě obrazovky: přetečení i překryv (server musí běžet)
npm run orp                 # znovu stáhne hranice ORP z ČÚZK (ruční krok, ne za běhu)
npm run tiles               # vyrobí vlastní podklad mapy (1,4 GB, potřebuje tools/bin/pmtiles.exe)
npm run tiles:upload        # nahraje podklad do Cloudflare R2 (klíče z .env)
npm run tiles:check <url>   # umí daný hosting sloužit podklad? (Range, CORS, odezva)
npm run android             # nasype web do obalu a sestaví APK (JDK z Android Studia)
npm run android -- --api=https://…   # APK pro TERÉN: bez toho míří na místní síť
npm run dev                 # (v něm i laboratoř ikon: /test/icon-lab.html)
npm run icons               # ikony z web/icons/icon.svg (jednorázově, kreslí Chrome)
npm run og                  # náhled pro sdílení 1200×630 (Open Graph), taky kreslí Chrome
npm run docx                # dokumentace do Wordu
```

### Na co narazit nechceš

Pasti, které už jednou stály čas, jsou popsané v `03-vyvoj-progress.md`. Nejdražší byly:

- **🚨 PRÁZDNÝ FEED VÝSTRAH SE NEDÁ ODLIŠIT OD KLIDU.** MeteoAlarm stál
  od 28. do 31. 8. 2026 (tři dny beze změny) a appka to celou dobu vykreslovala
  jako „nic nehrozí" — kartu výstrah dokonce schovala. **Mrtvý zdroj vypadá
  přesně jako klid**, a to zrovna u bouřky. CAP nese `sent`; stáří feedu se
  musí hlídat a říct. 🟡 Zatím NEOPRAVENO, viz deník 31. 8.
  ⚠️ ČHMÚ má vlastní CAP na `opendata.chmi.cz/meteorology/weather/alerts/cap/` —
  bez prostředníka a čerstvější než MeteoAlarm. Kandidát na `R20`.
- **🚨 KAŽDÁ ANIMACE MUSÍ MÍT CESTU VEN PŘES `prefers-reduced-motion`.**
  Za jediný den jich přibyly tři a zapomenout na jednu je tichá vada — pro
  většinu lidí se nic nezmění. Hlídá to `selftest-obal.mjs` čtením CSS,
  včetně toho, že útlumový blok opravdu něco vypíná.
- **🚨 ZDROJ `image` V MAPLIBRE NEMÁ `attribution` — a odmítnutý zdroj MLČÍ.**
  Snímky ČHMÚ se kvůli jedné vlastnosti navíc **nevykreslovaly vůbec**, zatímco
  minulé (`raster`, bez popisky) jely dál. Data přitom chodila, osa měla
  budoucí část a posuvník do ní jel — jen se v mapě nic neobjevilo. V konzoli
  byla jen poznámka, protože `map.on('error')` chyby radarového zdroje
  **schválně přeskakuje**. Popis zdroje proto skládá čistá `radarSource()`
  v `lib/radar.js` a hlídá ji samotest. Licenční popiska patří do lišty
  radaru (`#radar-zdroj`), ne do zdroje.
- **🚨 `performance.getEntriesByType('resource')` MÁ STROP ~250 ZÁZNAMŮ.**
  Mapa stahuje stovky dlaždic, takže **chybějící záznam neznamená chybějící
  dotaz**. Málem jsem na tom postavil opravu. Na síť se ptej nástrojem, který
  sleduje od začátku, nebo si zavěs `fetch` — a než něco prohlásíš, ověř to
  přímým pokusem.
- **🚨 VZOR Z GULPKY SE OPISUJE, NEVYMÝŠLÍ.** `R7` říká „model přenesený
  z Gulpky jedna k jedné" — a to platí i na VZHLED, ne jen na mechaniku.
  Do donate tlačítka jsem nakreslil červený znak `♥`; Gulpka má zlatou minci
  se srdcem uvnitř a Michal to vrátil. **Sjednocená značka napříč jeho appkami
  je víc než jeden hezký znak.** Než něco kreslíš, jdi se podívat do
  `C:\develop\napij_se-pracovni\napij_se\` — barvy, poloměry i doby animací
  se dají opsat.
- **🚨 VÝMĚNA ZNAKU ZA OBRÁZEK NAFOUKNE ŘÁDEK.** Obrázek 22 px je vyšší než
  textový znak, takže `.brand` narostl z 20 na 27 px a lišta z 30 na 38 —
  přesně ta vada, kterou Michal reklamoval o dvě zprávy dřív. **Layoutová
  kontrola mlčela:** nic nepřeteklo, nic se nepřekrylo, kontext nebyl useknutý.
  **Výška lišty se zatím neměří ničím** — po každém zásahu do hlavičky ji
  změř ručně (`.top` má být ~30 px). Řešení: napevno `height` na tlačítku
  a záporné okraje, aby do řádku přispělo jen tolik co ozubené kolo.
- **🚨 PŘETEČENÍ A PŘEKRYV JSOU JEN DVĚ ZE TŘÍ VAD ROZVRŽENÍ. Třetí je
  USEKNUTÝ TEXT.** Srdíčko přidané do hlavičky ukouslo 52 px a ze sbaleného
  řádku „Místo · Praha" zbylo „Mí…" — z okna přitom nic nepřeteklo a nic se
  nepřekrylo, takže kontrola hlásila ✓. Ve sbalené hlavičce jsou záložky
  schované, takže ten řádek je jediná zpráva o tom, kde člověk je.
  Měří to `useknutyKontext()` v `test/layout.html` — **na obou obrazovkách**,
  protože na trase je kontext krátký („Trasa") a vejde se vždycky. Kontrola,
  která běží na špatné obrazovce, je zelená vždycky.
- **🚨 SYSTÉMOVÉ OKRAJE JSOU V PROHLÍŽEČI NULOVÉ, V APK NE.** `.top` mělo
  `padding-bottom: calc(5px + env(safe-area-inset-bottom))` — výšku gesto-lišty
  nalepenou zespodu na HORNÍ lištu. Na webu 5 px a vypadalo to správně; v appce
  (`enableEdgeToEdge()` + `viewport-fit=cover`) je inset reálný a lišta narostla
  z 30 px na 80. **Layoutová kontrola to najít nemohla** — měří v prohlížeči.
  Nahoru patří `inset-top`, dolů `inset-bottom` (ten je u `main`).
  Hlídá `selftest-obal.mjs` čtením CSS.
- **⚠️ `web/style.css`, `index.html` a `lib/lang/*.js` mají CRLF.** Hledaný
  řetězec s `
` se v nich nenajde a skript mlčky „nic nenahradí" — vypadá to,
  že chyba je jinde. Konce řádků si v nahrazovacím skriptu zjisti.
- **🚨 Trefa do CDN cache jde MIMO ochranu proxy.** Cizí `Origin` dostane na
  `/api/radar` v produkci **200**, protože odpověď leží v edge cache Netlify
  a funkce se vůbec nespustí. Není to vada — co nejde ven, nestojí kvótu nic —
  ale kdo to neví, hledá hodinu vadu, která tam není. Na čerstvé adrese je 403
  spolehlivě. `Vary: Origin` by to spravilo za cenu rozdrobené cache, tedy
  víc cest ven; nedělá se to. Viz `R19`.
- **🚨 Ochrana, která vypadá, že funguje, je horší než žádná.** U omezovače dotazů
  jsou tři místa, kde se dá udělat chyba neviditelná v testu i v prohlížeči:
  počítat i trefy do cache (appka „přestane fungovat po chvíli používání"),
  věřit hlavičce `x-forwarded-for` (kdokoli si ji napíše a obmění), a odmítat
  chybějící `Origin` (vlastní stránka ho neposílá, takže by se vypnula appka
  všem a prošly by jen skripty). Viz `R19`.
- **🚨 Správně spočítaný údaj umí sdělovat nepravdu.** Čas příjezdu se počítal
  na milisekundy přesně a všechny testy ETA byly zelené — jenže se vypisoval jako
  holé `HH:MM`, takže z pěší cesty na 60 hodin bylo „příjezd v 22:31", tedy zdánlivě
  dnes večer. **Ptej se nejen, jestli je číslo správné, ale co si z něj přečte člověk.**
  Viz `lib/when.js`.
- **🚨 Kód, který je sám se sebou v souladu, o své správnosti neříká nic.**
  QR enkodér skládal generující polynom **pozpátku**, takže korekční slova nebyla
  platná. „Ověření" přepočtem korekce přitom sedělo na bajt — enkodér i kontrola
  sdílely tutéž chybu, takže se shodly. Ukázalo to až dosazení kořenů (syndromy),
  tedy **jiná cesta k témuž výsledku**. U každého vlastního kodéru, formátu nebo
  kontrolního součtu si žádej ověření, které nevede přes tentýž kód. Viz `R18`.
- **🚨 `shouldOverrideUrlLoading` vrací `true` = „postaráno", ne „otevřeno".**
  WebView pak odkaz nenačte a nikdo jiný ho neotevře — klepnutí mlčky neudělá nic
  a od rozbitého tlačítka se to nedá odlišit. Cizí adresu musí převzít
  `Intent(ACTION_VIEW)`. Hlídá `selftest-obal.mjs` čtením zdrojáku obalu.
- **🚨 Dialog se v layoutové kontrole neměří sám.** Je užší než okno a
  vycentrovaný, takže obsah, který z něj vyleze, nemusí přetéct ze STRÁNKY —
  a kontrola přetečení ho neuvidí. Měří to `dialogPreteceni()` v `test/layout.html`.
  ⚠️ A když takovou kontrolu zkoušíš rozbít, sabotuj `min-width`, ne `width`:
  flexbox položku zmenší zpátky a bude to vypadat, že kontrola neměří.
- **🚨 Práh, pod kterým se mlčí, je návrhové rozhodnutí — a když je moc vysoko,
  vypadá hotová funkce jako chybějící.** Hlášky o větru začínaly až na 12 km/h,
  takže se většinu dní spadlo na obecnou větu a Michal usoudil, že vítr nikdo
  nekomentuje. **Test to nechytí:** ověřuje, že se při 15 km/h hláška objeví —
  ne že se při 6 km/h objevit měla. U každého prahu se ptej, jak často je pod ním.
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
- **⚠️ Změna v `upstreams.js` (a v čemkoli na serveru) potřebuje RESTART dev serveru.**
  Proxy si katalog drží v paměti od spuštění — jinak měříš starý kód a nechápeš proč.
- **🚨 Dvakrát zapsaný oddíl v překladu je tichá ztráta.** Objekt v JS bere poslední
  zápis a první zahodí; `warnings` byl v obou jazycích dvakrát, takže půlka byla mrtvá.
  **Paritní test to nemohl chytit** — porovnává až načtené objekty. Hlídá to teď
  kontrola nad zdrojovým textem.
- **🚨 Když se něco „napůl" povede, hledej výjimku uprostřed.** `showRoute()` padalo
  na chybějící deklaraci hned po nakreslení čáry: čára byla vidět, přiblížení na trasu
  ne — a výjimku spolkl `catch`, který ji jen zapsal do konzole. Vypadalo to jako vada
  výpočtu výřezu.
- **🚨 Vrstva nad radarem musí být v `PREKRYVY`.** Radar se zakládá znovu při každém
  snímku a vkládá se pod nejnižší z nich; co v seznamu není, po vteřině zmizí samo.
- **🚨 Text notifikace NESMÍ být z `strings.xml`.** Ten se řídí jazykem SYSTÉMU,
  kdežto jazyk appky je volba uživatele (R10) — kdo má appku česky a telefon anglicky,
  dostal by českou appku a anglické upozornění. Nadpis skládá web a posílá ho mostem
  hotový. V `strings.xml` patří jen jméno notifikačního kanálu: to se ukazuje
  v nastavení Androidu, kam jazyk systému patří.
- **🚨 Klíč výstrahy se skládá z JEDNÉ jazykové verze, ne po kouskách.** MeteoAlarm
  dává každé verzi vlastní `area` i časy a neshodují se; klíč pak kolísá podle jazyka
  a při přepnutí by se zazvonilo na všechno, co dávno platí. A nikdy CAP `identifier` —
  mění se při každém vydání i beze změny obsahu.
- **🚨 Prohlížeč má vlastní potažení dolů a to naše přebije.** Chrome na Androidu
  na přetažení nahoře stránku CELOU ZNOVU NAČTE — a s ní zmizí i rozdělaná trasa.
  Vypíná to `overscroll-behavior-y: contain` na `html` **i** `body`; prohlížeče se
  liší v tom, který z nich se ptají.
- **🚨 Cokoli, co vyjíždí zpod hlavičky, musí její výšku MĚŘIT.** Hlavička je
  jednou sbalená (55 px) a jindy rozbalená (163 px), plus „safe area" na telefonu.
  Napevno zapsané číslo sedí vždycky nanejvýš v jednom stavu — pruh potažení se
  kvůli tomu schoval za hlavičku a vykukovalo z něj 7 px. Logika přitom byla
  v pořádku a samotest zelený; vidět z toho nebylo nic.
- **🚨 Přetečení z okna je jen POLOVINA vad rozvržení.** Ta druhá je překryv:
  pruh způsobů dopravy se nezalomil, ale smrskl (`flex: 1` = `1 1 0%` položku
  zmenší místo zalomení), a „Vzdušnou čarou" vylezlo POD tlačítko vedle. Z okna
  nepřeteklo nic, test hlásil ✓ — a volba nešla přečíst ani trefit. `layout.html`
  teď měří obojí, a **na obou obrazovkách**; do 29. 8. 2026 znal jen meteostanici.
  ⚠️ Překryv se hledá mezi OVLÁDACÍMI PRVKY, ne mezi dětmi pruhu: obálka má šířku
  od flexboxu a její obsah leze ven mimo ni, takže se sama s ničím nepřekryje.
- **⚠️ Kdo sbalí hlavičku, musí ji rozbalit v layoutovém testu.** Nejširší obsah
  appky je řádek uložených míst a tras — a ten je teď schovaný. `test/layout.html`
  ho proto před měřením rozbalí (`rozbalNabidku`), jinak by test mlčky přestal
  měřit to, kvůli čemu vznikl.
- **🚨 `display` v pravidle PŘEBÍJÍ atribut `hidden`.** Prvek pak zůstane ve stránce
  a layoutová kontrola hlásí přetečení u něčeho úplně jiného. Ke každému `display`
  u skrývaného prvku patří `[hidden] { display: none; }`.
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

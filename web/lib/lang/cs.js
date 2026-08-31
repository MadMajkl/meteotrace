/**
 * Čeština — první překlad.
 *
 * 🚨 Klíče musí 1:1 odpovídat `en.js`. Hlídá to `selftest:logic`; chybějící klíč
 *    test neprojde. Nové klíče se zakládají v angličtině, tady se jen překládají.
 *
 * ⚠️ Značka „MeteoTrace" se NESKLOŇUJE. Je to jméno produktu a v UI se objevuje
 *    jen v prvním pádě — kdyby bylo potřeba skloňovat, musely by pádové tvary
 *    vzniknout pro každý jazyk zvlášť (poučení z mailniña, kde se české tvary
 *    dosazovaly i do španělštiny).
 */

export default {
  app: {
    name: 'MeteoTrace',
    tagline: 'Počasí na trase',
  },

  nav: {
    station: 'Místo',
    route: 'Trasa',
    sections: 'Části appky',
    settings: 'Nastavení',
    menu: 'Hledání, části appky a uložené věci',
    menuHide: 'Schovat nabídku',
  },

  /* První spuštění. Čtyři kroky, ve kterých si člověk vybere domov
     a oblíbený cíl — a appka mu pak na jeho vlastních datech ukáže, co umí.
     ⚠️ Nejdelší souvislý text v appce; o to víc ho drž zkrátka. Nikdo sem
     nepřišel číst. */
  onboarding: {
    skip: 'Přeskočit',
    next: 'Dál',
    back: 'Zpět',
    done: 'Jdeme na to',
    step: 'Krok {n} ze {total}',

    homeTitle: 'Vítej v MeteoTrace',
    homeText: 'Předpověď počasí nejen jako statická meteostanice pro místo, které určíš, ale i pro trasu — v každém bodě cesty v čase, kdy tam doopravdy dorazíš. Začneme tím, kde bydlíš.',
    homeLabel: 'Najdi svůj domov',
    homeLocate: 'Použít moji polohu',

    goalTitle: 'A kam jezdíš nejčastěji?',
    goalText: 'Práce, babička, kamarádi. Trasu tam ti hned vytvoříme a ukážeme na ní, jak appka funguje.',
    goalLabel: 'Najdi cíl cesty',
    goalSkip: 'Trasy nepotřebuju',

    placeTitle: 'Tohle je tvoje meteostanice',
    placeText: 'Jedno místo a všechno o něm — teď, po hodinách, radar i výstrahy. Takhle vypadá {place}.',

    routeTitle: 'A takhle vypadá trasa',
    routeText: 'Počasí v každém bodě cesty v čase, kdy tam dorazíš — ne v čase, kdy vyjíždíš. {from} → {to}.',

    /* ⚠️ Ukáže se, když se při prvním spuštění nepovede načíst předpověď.
       Bez toho by uvítání vypadalo rozbitě hned na první dojem — a ten
       se neopakuje. */
    offline: 'Zrovna není spojení, tak chybí počasí. Naskočí, jakmile bude signál — appka je nastavená tak jako tak.',
  },

  /* Upozornění na výstrahu.
     ⚠️ Tón je věcný. Hlášky si smějí rýpnout, upozornění na bouřku ne —
     platí pravidlo z 26. 8. 2026: u výstrah a nebezpečí se nežertuje. */
  notify: {
    title: 'Meteo výstraha',
    endedTitle: 'Je po výstrahách',
    endedBody: 'Pro {place} už žádná výstraha neplatí.',
    titleFor: 'Meteo výstraha — {place}',
    setting: 'Upozorňovat na výstrahy',
    off: 'Neupozorňovat',
    level: 'Od závažnosti',
    // ⚠️ Musí být poznat, že hlídané místo je JEDNO a které. Bez toho by
    // člověk čekal upozornění i tam, kam se zrovna chystá.
    watching: 'Hlídá se {place}. Upozornění chodí, i když je appka zavřená.',
    watchingNone: 'Zatím není co hlídat — vyber si místo.',
    denied: 'Android upozornění zakázal. Povolit se dá v nastavení systému.',
    unsupported: 'Tenhle prohlížeč upozornění neumí. V appce z Play fungují.',
    browserOnly: 'V prohlížeči upozorníme, jen když je appka otevřená. Na pozadí to umí appka z Play.',
  },

  /* Potažení dolů nahoře na stránce data natáhne znovu. Každý stav má svoje
     slovo — samotné kolečko neřekne, jestli se vůbec něco stalo. */
  refresh: {
    pull: 'Potáhni dolů a načte se znovu',
    release: 'Pusť a načte se znovu',
    working: 'Načítám…',
    done: 'Máš čerstvá data',
  },

  search: {
    placeholder: 'Najít místo…',
    myLocation: 'Moje poloha',
    noResults: 'Takové místo neznám. Zkus to napsat jinak.',
    searching: 'Hledám…',
    noFocus: 'Neřadí se podle polohy — ⌖ nabídne okolí.',
    // 🚨 Musí říct, CO Z TOHO PLYNE. „Náhradní zdroj" samo o sobě je
    // technická poznámka; člověk potřebuje vědět, že teď nemá cenu psát
    // ulici s číslem popisným, protože záloha adresy neumí.
    zeZalohy: 'Náhradní zdroj — adresu s číslem popisným teď nenajdu.',
    /* 🚨 Polohu NEHLÁSIT jako „data se nepodařilo načíst" (do 31. 8. 2026 se
       tak hlásila). Poloha nejsou data: kdo to čte, hledá chybu v připojení
       nebo v serveru, kdežto skoro vždycky jde o odepřené povolení — a to
       si spraví sám, když se mu to řekne. */
    locationFailed: 'Polohu se nepodařilo zjistit. Zkontroluj, že ji má appka povolenou.',
  },

  places: {
    saved: 'Uložená místa',
    savedAll: 'Uložená místa a trasy',
    mine: 'Moje místa',
    save: 'Uložit tohle místo',
    // ⚠️ Sloveso s předmětem, ne holé „Uložit" — symetricky s trasou.
    // Z pouhého slovesa nepoznáš, co se vlastně uloží.
    saveShort: 'Uložit místo',
    savedShort: 'Místo uloženo',
    remove: 'Odebrat z uložených',
    removeNamed: 'Odebrat „{name}“ z uložených',
    empty: 'Klepni na hvězdičku a místo se ti sem uloží ⭐',
    full: 'Seznam byl plný, tak vypadlo místo, které používáš nejmíň.',
    readOnly: 'Uložená místa pocházejí z novější verze appky, tady se měnit nedají. Po zavření a otevření appky by to mělo být v pořádku.',
    alreadySaved: 'Uložené už jako „{name}“.',
    manage: 'Spravovat uložená místa',
    manageTitle: 'Uložená místa',
    renameHint: 'Vlevo je adresa, vpravo si místo pojmenuj — Domov, Práce, Babička.',
    // ⚠️ Výzva, ne příklad. Pole je prázdné a musí být jasné, že se do něj
    // něco čeká — „Domov, Práce, Babička…" vypadalo jako už vyplněná nabídka.
    namePlaceholder: 'Zadej název',
    addressCol: 'Adresa',
    nameCol: 'Název místa',
    close: 'Zavřít',
    nameLabel: 'Jméno uloženého místa',
    removeOne: 'Odebrat',
    confirmRemove: 'Opravdu odebrat?',
    nameEmpty: 'Jméno nemůže být prázdné, původní zůstalo.',
    renamed: 'Přejmenováno na „{name}“.',
    removed: 'Místo „{name}“ je odebrané.',
    count: 'Využito {count} z {max} míst',
  },

  routes: {
    saved: 'Uložené trasy',
    mine: 'Moje trasy',
    save: 'Uložit tuhle trasu',
    // ⚠️ „Uložit TRASU", ne jen „Uložit". U místa je hvězdička jediné
    // tlačítko na kartě, na trase je vedle ní spousta dalších — a co se
    // vlastně uloží, z holého slovesa nepoznáš.
    saveShort: 'Uložit trasu',
    savedShort: 'Trasa uložena',
    remove: 'Odebrat tuhle trasu',
    empty: 'Zatím žádná trasa. Spočítej ji a hvězdička ji podrží.',
    count: 'Využito {count} z {max} tras.',
    removed: 'Odebráno: {name}.',
    full: 'Seznam tras je plný — vypadla nejméně používaná.',
    manage: 'Spravovat uložené trasy',
    title: 'Trasy',
  },

  route: {
    title: 'Počasí na trase',
    from: 'Odkud',
    to: 'Kam',
    fromPlaceholder: 'Začátek cesty…',
    toPlaceholder: 'Cíl…',
    swap: 'Prohodit start a cíl',
    // ⚠️ Sloveso s předmětem, ne holé „Změnit" — na sbaleném řádku stojí
    //    vedle jména trasy a samo o sobě neřekne, co se vlastně změní.
    edit: 'Změnit trasu',
    collapsed: '{from} → {to} · {mode}',
    via: 'Mezibod',
    viaPlaceholder: 'Zastávka po cestě…',
    addVia: '+ Přidat mezibod',
    removeVia: 'Odebrat mezibod',
    mode: 'Jak jedeš',
    car: 'Autem',
    bike: 'Na kole',
    walk: 'Pěšky',
    straight: 'Vzdušnou čarou',
    speed: 'Rychlost',
    speedHint: 'km/h — kluzák, dron i trajekt se pohybují jinak, tohle za tebe neuhodneme.',
    straightNote: 'Přímá čára po kouli. Nevyhýbá se pevnině — pro let a volnou vodu dobrá, pro plavbu u břehu ne.',
    compute: 'Ukázat počasí',
    summary: 'Souhrn trasy',
    total: 'Celkem',
    // ⚠️ Jen číslo v závorce, žádné „bodů". Čeština by chtěla tři tvary
    // (1 bod / 2–4 body / 5+ bodů) a rozpis má běžně 3–12 položek, takže by
    // špatný tvar byl vidět skoro pokaždé. Závorka je správně u každého počtu
    // a v každém jazyce.
    alongTheWayCount: '({count})',
    alongTheWay: 'Po cestě',
    needBoth: 'Vyber start i cíl — jinak nemáme kam jet.',
    sameSpot: 'Start a cíl jsou totéž místo — vyber jiný cíl 😉',
    needStart: 'Cíl mám. Odkud vyrážíš? Polohu se mi zjistit nepodařilo.',
    viaSet: 'Mezibod {n}: {name}.',
    toSet: 'Cíl: {name}.',
    fromHere: 'Odsud do cíle {to} — počítám počasí po cestě.',
    computing: 'Počítám trasu…',
    failed: 'Trasu se spočítat nepovedlo. Zkusíme to ještě jednou?',
    noWeather: 'Trasu známe, počasí k ní se ale nepodařilo načíst.',
    // ⚠️ Popisek před číslem, ne holé „205 km, příjezd 18:12". Bez něj se
    // údaj dá číst jako cokoli — zbývající kilometry, ujetá vzdálenost, dojezd.
    result: 'Vzdálenost {distance}, příjezd {arrival}',
    arrival: 'Příjezd {time} — {what}.',
    estimated: 'Časy jsou odhadnuté: nemáme informace o překážkách na trati.',
    beyond: 'Konec trasy je mimo rozsah předpovědi.',
    hazards: {
      one: 'Nebezpečné počasí na {count} místě trasy.',
      few: 'Nebezpečné počasí na {count} místech trasy.',
      many: 'Nebezpečné počasí na {count} místa trasy.',
      other: 'Nebezpečné počasí na {count} místech trasy.',
    },
    rain: {
      one: 'Déšť na {count} místě trasy.',
      few: 'Déšť na {count} místech trasy.',
      many: 'Déšť na {count} místa trasy.',
      other: 'Déšť na {count} místech trasy.',
    },
    // ⚠️ Čtvrtý pád, dosazuje se do „vyraž o …": o hodinu, o dvě hodiny, o pět hodin.
    delayHours: {
      one: 'hodinu', few: '{count} hodiny', many: '{count} hodiny', other: '{count} hodin',
    },
    delayMinutes: {
      one: 'minutu', few: '{count} minuty', many: '{count} minuty', other: '{count} minut',
    },
    adviceRain: 'Pokud se chceš vyhnout dešti, vyraž o {delay} později — počasí vychází líp.',
    adviceHazard: 'Pokud se chceš vyhnout tomu nejhoršímu ({what}), vyraž o {delay} později — počasí vychází líp.',
    clear: 'Po cestě neočekáváme déšť.',
    adviceNow: 'Vyrazit teď je stejně dobré jako počkat. Rozhodni se ty.',
    departure: 'Odjezd',
    later: '+{hours} h',
    badgeHazard: '{count}× nebezpečí',
    badgeRain: '{count}× déšť',
    badgeClear: 'beze srážek',
    now: 'Teď',
    // 🚨 TŘI VĚTY, PROTOŽE KLEPNUTÍ DĚLÁ TŘI RŮZNÉ VĚCI. Do 31. 8. 2026 se
    // psala jen ta první — i nad hotovou trasou, kde klepnutí start NEZADÁ,
    // ale PŘEPÍŠE CÍL. Michal: *„je tam nepravda, že klepnutím do mapy
    // přidáváš start a dalším cíl, když koukám na hotovou trasu."*
    pickHint: 'Klepnutím do mapy zadáš start, dalším cíl.',
    pickHintTo: 'Klepnutím do mapy zadáš cíl.',
    pickHintReplace: 'Klepnutím do mapy změníš cíl.',
    mapWaiting: 'Mapa se ukáže, až se spočítá trasa.',
    pickedFrom: 'Start je z mapy. Teď klepni na cíl.',
    pickedTo: 'Cíl je z mapy.',
    start: 'Start',
    finish: 'Cíl',
    // Legenda barev pod mapou. ⚠️ Barva bodu je bez ní hádanka: mapa
    // ukazuje čtyři odstíny a nikde nestojí, co který znamená. Michal
    // 30. 8. 2026 chtěl vysvětlivky u bodů — tohle je ta levnější půlka,
    // která odpovídá na častější otázku („proč je červený?").
    legend: 'Body na trase',
    legendOk: 'beze srážek',
    legendRain: 'déšť',
    legendHazard: 'nebezpečné počasí',
    legendUnknown: 'za obzorem předpovědi',
    // 🚨 Bublina po klepnutí na bod v mapě EXISTOVALA od začátku (čas
    // příjezdu, počasí, teplota) — jen o ní nikdo nevěděl. Michal
    // 30. 8. 2026 si vysvětlivky u bodů vyžádal jako novou funkci,
    // přestože hotová byla; mlčení z ní udělalo neexistující.
    // ⚠️ Na telefonu není kurzor, který by ručičkou napověděl, takže to
    // musí být napsané.
    legendTap: 'Klepni na bod v mapě a uvidíš, kdy tam budeš a co tam bude.',
  },

  now: {
    feelsLike: 'Pocitově',
    wind: 'Vítr',
    gusts: 'V nárazech',
    humidity: 'Vlhkost',
    precipitation: 'Srážky',
    pressure: 'Tlak',
    cloudCover: 'Oblačnost',
    uvIndex: 'UV index',
    // Slovní stupeň pod číslem UV. ⚠️ „zátěž" tam patří: samotné „nízká"
    // by u dlaždice nadepsané „UV index" nebylo poznat, čeho se týká.
    uvNizka: 'nízká zátěž',
    uvStredni: 'střední zátěž',
    uvVysoka: 'vysoká zátěž',
    uvVelmiVysoka: 'velmi vysoká zátěž',
    uvExtremni: 'extrémní zátěž',
    sunrise: 'Východ',
    sunset: 'Západ',
    moon: 'Měsíc',
    pressure: 'Tlak',
    pressureLocal: 'v místě {value}',
    elevation: '{value} n. m.',
    updated: 'Aktualizováno {time}',
  },

  forecast: {
    hourly: 'Dalších 48 h po hodinách',
    daily: '7 dní',
    today: 'Dnes',
    tomorrow: 'Zítra',
    high: 'Nejvýš',
    low: 'Nejníž',
    chanceOfRain: 'Pravděpodobnost deště',
  },

  weather: {
    clear: 'Jasno',
    mostlyClear: 'Skoro jasno',
    partlyCloudy: 'Polojasno',
    overcast: 'Zataženo',
    // 🚨 Zataženo JEN vysoko. Slunce je vidět, jen přes závoj — viz `jenZavoj()`.
    veiledSun: 'Slunce přes vysokou oblačnost',
    fog: 'Mlha',
    drizzle: 'Mrholení',
    freezingRain: 'Mrznoucí déšť',
    rain: 'Déšť',
    heavyRain: 'Vydatný déšť',
    snow: 'Sněžení',
    heavySnow: 'Vydatné sněžení',
    rainShowers: 'Dešťové přeháňky',
    snowShowers: 'Sněhové přeháňky',
    thunderstorm: 'Bouřka',
    hailstorm: 'Bouřka s krupobitím',
    unknown: 'Neznámé',
  },

  // ⚠️ Zkratka je to, co se vejde do řádku. Plný název je v `windDirLong`
  // a ukazuje se jako bublina — viz poznámka v `app.js`.
  windDir: {
    n: 'S', nne: 'SSV', ne: 'SV', ene: 'VSV',
    e: 'V', ese: 'VJV', se: 'JV', sse: 'JJV',
    s: 'J', ssw: 'JJZ', sw: 'JZ', wsw: 'ZJZ',
    w: 'Z', wnw: 'ZSZ', nw: 'SZ', nnw: 'SSZ',
  },

  /**
   * Odkud vítr fouká, celým jménem.
   *
   * Šestnáct směrů: čtyři hlavní (S, V, J, Z), čtyři mezi nimi (SV, JV, JZ,
   * SZ) a osm ještě jemnějších, kde se skládá hlavní směr s vedlejším —
   * „východo-severovýchod" je mezi východem a severovýchodem.
   */
  windDirLong: {
    n: 'severní', nne: 'severo-severovýchodní', ne: 'severovýchodní', ene: 'východo-severovýchodní',
    e: 'východní', ese: 'východo-jihovýchodní', se: 'jihovýchodní', sse: 'jiho-jihovýchodní',
    s: 'jižní', ssw: 'jiho-jihozápadní', sw: 'jihozápadní', wsw: 'západo-jihozápadní',
    w: 'západní', wnw: 'západo-severozápadní', nw: 'severozápadní', nnw: 'severo-severozápadní',
  },


  /**
   * Fáze Měsíce.
   *
   * ⚠️ Jediný údaj v appce, který není předpověď, ale astronomie — počítá
   * se doma, viz `lib/moon.js`.
   */
  moonPhase: {
    new: 'Nov',
    waxingCrescent: 'Dorůstající srpek',
    firstQuarter: 'První čtvrt',
    waxingGibbous: 'Dorůstající měsíc',
    full: 'Úplněk',
    waningGibbous: 'Ubývající měsíc',
    lastQuarter: 'Poslední čtvrt',
    waningCrescent: 'Ubývající srpek',
  },

  pollen: {
    title: 'Pyly',
    alder: 'Olše',
    birch: 'Bříza',
    grass: 'Trávy',
    mugwort: 'Pelyněk',
    olive: 'Oliva',
    ragweed: 'Ambrózie',
    level: {
      none: 'Žádný',
      low: 'Nízká',
      moderate: 'Střední',
      high: 'Vysoká',
      veryHigh: 'Velmi vysoká',
    },
    none: 'Pro tohle místo nejsou data o pylu.',
    allClear: 'Dnes se ve vzduchu nevznáší nic měřitelného. Alergici mohou vydechnout.',
    measured: 'Naměřeno teď, ve vzduchu.',
  },

  radar: {
    title: 'Srážkový radar',
    play: 'Přehrát',
    pause: 'Zastavit',
    observed: 'Naměřeno',
    scrub: 'Čas snímku',
    now: 'teď',
    ago: 'před {min} min',
    in: 'za {min} min',
    nowcast: 'Dopočet',
    nowcastChmi: 'Předpověď ČHMÚ',
    pickHint: 'Klepnutím do mapy vybereš místo.',
    disabled: 'Mapa je vypnutá parametrem ?nomap=1 v adrese.',
    mapFailed: 'Mapu se nepodařilo načíst. Zkontroluj připojení a zkus to znovu.',
    noWebgl: 'Tenhle prohlížeč mapu nevykreslí — nemá zapnuté 3D vykreslování (WebGL).',
  },

  // Hodnotit appku (vzor Gulpka). Ukazuje se JEN v androidím obalu.
  rate: {
    title: 'Hodnocení',
    open: 'Ohodnotit appku',
  },

  settings: {
    title: 'Nastavení',
    language: 'Jazyk',
    languageAuto: 'Podle zařízení',
    primary: 'Domovská obrazovka se zobrazí jako:',
    theme: 'Vzhled',
    themeAuto: 'Podle zařízení',
    themeLight: 'Světlý',
    themeDark: 'Tmavý',
    themePink: 'Růžový',
    themePinkDark: 'Tmavě růžový',
    units: 'Jednotky',
    unitsNote: 'Metrické nebo imperiální.',
    temperature: 'Teplota',
    wind: 'Rychlost větru',
    precipitation: 'Srážky',
    distance: 'Vzdálenost',
    about: 'O aplikaci',
    version: 'MeteoTrace {version}',
    sources: 'Předpověď a pyl: Open-Meteo. Radar: RainViewer, předpověď srážek ČHMÚ (CC BY 4.0). Výstrahy: ČHMÚ přes MeteoAlarm. Mapa: vlastní dlaždice z dat OpenStreetMap (ODbL). Trasy a hledání: openrouteservice / HeiGIT. Hranice území: ČÚZK RÚIAN.',
  },

  /* Dary (R7).
     🚨 Dar nikdy nic neodemyká — a appka to říká nahlas. Nabídka platby
     v jinak bezplatné appce vypadá jako past, dokud se nedopoví, že za ní
     nic není. */
  donate: {
    open: 'Podpořit appku',
    title: 'Podpořit MeteoTrace',
    intro: 'Appka je zdarma, bez reklam a nic v ní není schované za platbu. Jestli tě někdy nechala dojet suchého, můžeš přihodit korunu.',
    nothing: 'Dar nic neodemyká — není co odemykat. Celá appka je zdarma a zůstane.',
    qrTitle: 'QR platba',
    qrNote: 'Naskenuj ji v bankovní appce — účet i částka se vyplní samy.',
    amount: 'Částka',
    customLabel: 'Nebo vlastní částka (Kč)',
    account: 'Účet: {iban}',
    noAmount: 'V kódu není částka — banka se zeptá.',
    withAmount: 'V kódu je {amount} Kč.',
    /* ⚠️ Když se kód nepovede nakreslit, musí zůstat cesta k zaplacení. */
    qrFailed: 'Kód se nepodařilo nakreslit. Číslo účtu nad ním funguje stejně dobře.',
    opensOut: 'Otevře se v prohlížeči',
    /* 🚨 Revolut ani PayPal poznámku předvyplnit neumí — jde do nich jen
       částka. Bez téhle věty by dar přes ně splynul s dary pro ostatní
       appky: chodí na týž účet a nenesou variabilní symbol. */
    noteLabel: 'Do poznámky napiš:',
    noteWhy: 'Revolut ani PayPal poznámku samy nevyplní. Podle ní se pozná, že dar mířil na MeteoTrace.',
    copy: 'Kopírovat',
    copied: 'Zkopírováno',
    copyFailed: 'Označeno — zkopíruj sám',
    thanks: 'Díky i za to, že jsi dočetl až sem.',
  },

  /* Crosslinky na vlastní projekty (R7). Do nastavení, nikdy na hlavní
     obrazovku — nabídka jiných produktů uprostřed předpovědi je reklama. */
  more: {
    title: 'Další od nás',
    note: 'Naše vlastní projekty, ne reklama třetí strany.',
    gulpka: 'Napij se — připomínač pitného režimu',
    vtcleaner: 'Bezpečný čistič Windows',
    itrady: 'Praktické rady a tipy ze světa IT',
    mailnino: 'E-mailový klient, který umí datovky',
  },

  /* Kdy to bude.
     🚨 Den se připisuje, jakmile není dnešní. Praha → Norimberk pěšky je
     60 hodin a bez data z toho bylo „příjezd v 22:31" — vypadalo to jako
     dnes večer. Viz `lib/when.js`. */
  when: {
    tomorrow: 'zítra {time}',
    date: '{date} {time}',
  },

  warnings: {
    title: 'Výstrahy',
    none: 'Aktuálně nemáme žádné meteo výstrahy.',
    noneFor: 'Pro {place} aktuálně nemáme žádné meteo výstrahy.',
    // ⚠️ NE „výstrahy se nevydávají" — pro New York se vydávají, jen my
    // sledujeme evropský systém. Tvrdit uživateli klid, o kterém nic nevíme,
    // je horší než přiznat mezeru.
    outside: 'Výstrahy pro tuhle oblast neumíme — sledujeme evropský systém.',
    unsure: 'Nevím, kterých míst se týkají, tak ukazuju všechny.',
    unavailable: 'Výstrahy se nepodařilo načíst.',
    /* 🚨 MRTVÝ ZDROJ NENÍ KLID. Prázdný seznam výstrah znamená buď „nic
       nehrozí", nebo „zdroj mlčí" — a to jsou dvě úplně jiné zprávy.
       Věta musí říct, co dělat: nespoléhat se na to. */
    stale: 'Výstrahy jsou staré {age} — novější od ČHMÚ nemáme. Na tuhle kartu se teď nespoléhej.',
    ageUnknown: 'neznámo jak',
    ageHours: { one: 'hodinu', few: '{count} hodiny', many: '{count} hodiny', other: '{count} hodin' },
    ageDays: { one: 'den', few: '{count} dny', many: '{count} dne', other: '{count} dnů' },
    unnamed: 'Výstraha',
    // ⚠️ Konec nebezpečí je zpráva, na kterou se čeká. Řekne se JEDNOU
    // a pak karta zmizí — opakovat dobrou zprávu znamená ji znehodnotit.
    ended: 'Výstrahy skončily. Pro {place} teď žádná neplatí.',
    endedNoPlace: 'Výstrahy skončily. Teď už žádná neplatí.',
    appliesTo: 'Platí pro {place}.',
    areaUncertain: 'Nepodařilo se přesně určit, kde platí.',
    from: 'od {time}',
    until: 'do {time}',
    fromUntil: '{from}–{until}',
    severity: {
      extreme: 'Extrémní',
      severe: 'Vysoká',
      moderate: 'Střední',
      minor: 'Nízká',
      unknown: 'Neznámá závažnost',
    },
  },

  time: {
    min: 'min',
    hour: 'h',
  },

  error: {
    offline: 'Jsi bez připojení — tohle jsou naposledy stažená data.',
    stale: 'Nepodařilo se obnovit — tahle data jsou {age} stará.',
    failed: 'Data se nepodařilo načíst.',
    retry: 'Zkusit znovu',
    beyondForecast: 'Tak daleko dopředu předpověď zatím nesahá.',
    /* 🚨 Ochrana, o které se mlčí, se nedá odlišit od poruchy. Obojí chodí
       jako 429 a znamená něco jiného: u prvního se čeká minutu, u druhého
       do zítřka. Věta proto musí říct, CO DĚLAT. */
    tooMany: 'Moc dotazů naráz. Dej tomu minutu a zkus to znovu.',
    quota: 'Denní příděl tras je vyčerpaný, zítra bude zas. Meteostanice a radar jedou dál.',
  },
};

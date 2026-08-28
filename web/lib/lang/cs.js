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
  },

  search: {
    placeholder: 'Najít místo…',
    myLocation: 'Moje poloha',
    noResults: 'Takové místo neznám. Zkus to napsat jinak.',
    searching: 'Hledám…',
    noFocus: 'Neřadí se podle polohy — ⌖ nabídne okolí.',
  },

  places: {
    saved: 'Uložená místa',
    savedAll: 'Uložená místa a trasy',
    mine: 'Moje místa',
    save: 'Uložit tohle místo',
    saveShort: 'Uložit',
    savedShort: 'Uloženo',
    remove: 'Odebrat z uložených',
    removeNamed: 'Odebrat „{name}“ z uložených',
    empty: 'Klepni na hvězdičku a místo se ti sem uloží ⭐',
    full: 'Seznam byl plný, tak vypadlo místo, které používáš nejmíň.',
    readOnly: 'Uložená místa pocházejí z novější verze appky, tady se měnit nedají. Po zavření a otevření appky by to mělo být v pořádku.',
    alreadySaved: 'Uložené už jako „{name}“.',
    manage: 'Spravovat uložená místa',
    manageTitle: 'Uložená místa',
    renameHint: 'Klepni na jméno a přepiš ho — Domov, Práce, Babička.',
    namePlaceholder: 'Domov, Práce, Babička…',
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
    saveShort: 'Uložit',
    savedShort: 'Uloženo',
    remove: 'Odebrat tuhle trasu',
    empty: 'Zatím žádná trasa. Spočítej ji a hvězdička ji podrží.',
    count: 'Využito {count} z {max} tras.',
    removed: 'Odebráno: {name}.',
    full: 'Seznam tras je plný — vypadla nejméně používaná.',
    title: 'Trasy',
  },

  route: {
    title: 'Počasí na trase',
    from: 'Odkud',
    to: 'Kam',
    fromPlaceholder: 'Začátek cesty…',
    toPlaceholder: 'Cíl…',
    swap: 'Prohodit start a cíl',
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
    result: '{distance}, příjezd v {arrival}',
    arrival: 'Příjezd v {time} — {what}.',
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
    pickHint: 'Klepnutím do mapy zadáš start, dalším cíl.',
    mapWaiting: 'Mapa se ukáže, až se spočítá trasa.',
    pickedFrom: 'Start je z mapy. Teď klepni na cíl.',
    pickedTo: 'Cíl je z mapy.',
    start: 'Start',
    finish: 'Cíl',
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
    sunrise: 'Východ',
    sunset: 'Západ',
    moon: 'Měsíc',
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
    waningGibbous: 'Couvající měsíc',
    lastQuarter: 'Poslední čtvrt',
    waningCrescent: 'Couvající srpek',
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

  settings: {
    title: 'Nastavení',
    language: 'Jazyk',
    languageAuto: 'Podle zařízení',
    primary: '🏠 Domovská obrazovka',
    primaryHint: 'Je vlevo v záložkách a otevírá se při startu appky.',
    theme: 'Vzhled',
    themeAuto: 'Podle zařízení',
    themeLight: 'Světlý',
    themeDark: 'Tmavý',
    units: 'Jednotky',
    unitsNote: 'Jednotky si volíš zvlášť — Američan mluvící česky existuje.',
    temperature: 'Teplota',
    wind: 'Rychlost větru',
    precipitation: 'Srážky',
    distance: 'Vzdálenost',
    about: 'O aplikaci',
    version: 'MeteoTrace {version}',
    sources: 'Předpověď a pyl: Open-Meteo. Radar: RainViewer. Výstrahy: ČHMÚ přes MeteoAlarm. Mapa: vlastní dlaždice z dat OpenStreetMap (ODbL). Trasy a hledání: openrouteservice / HeiGIT. Hranice území: ČÚZK RÚIAN.',
  },

  warnings: {
    title: 'Výstrahy',
    none: 'Žádné výstrahy neplatí. Zatím klid.',
    noneFor: 'Pro {place} žádné výstrahy neplatí.',
    // ⚠️ NE „výstrahy se nevydávají" — pro New York se vydávají, jen my
    // sledujeme evropský systém. Tvrdit uživateli klid, o kterém nic nevíme,
    // je horší než přiznat mezeru.
    outside: 'Výstrahy pro tuhle oblast neumíme — sledujeme evropský systém.',
    unsure: 'Nevím, kterých míst se týkají, tak ukazuju všechny.',
    unavailable: 'Výstrahy se nepodařilo načíst.',
    unnamed: 'Výstraha',
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
  },
};

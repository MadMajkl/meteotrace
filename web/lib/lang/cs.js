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
    noResults: 'Žádné místo se nenašlo.',
    searching: 'Hledám…',
    noFocus: 'Neřadí se podle polohy — ⌖ nabídne okolí.',
  },

  places: {
    saved: 'Uložená místa',
    save: 'Uložit tohle místo',
    saveShort: 'Uložit',
    savedShort: 'Uloženo',
    remove: 'Odebrat z uložených',
    removeNamed: 'Odebrat „{name}“ z uložených',
    empty: 'Hvězdičkou si sem místo uložíš.',
    full: 'Seznam byl plný, uvolnilo se nejméně používané místo.',
    readOnly: 'Uložená místa pocházejí z novější verze appky, tady se měnit nedají. Po zavření a otevření appky by to mělo být v pořádku.',
    alreadySaved: 'Uložené už jako „{name}“.',
    manage: 'Spravovat uložená místa',
    manageTitle: 'Uložená místa',
    close: 'Zavřít',
    nameLabel: 'Jméno uloženého místa',
    removeOne: 'Odebrat',
    confirmRemove: 'Opravdu odebrat?',
    nameEmpty: 'Jméno nemůže být prázdné, původní zůstalo.',
    renamed: 'Přejmenováno na „{name}“.',
    removed: 'Místo „{name}“ je odebrané.',
    count: 'Využito {count} z {max} míst',
  },

  route: {
    title: 'Počasí na trase',
    from: 'Odkud',
    to: 'Kam',
    fromPlaceholder: 'Začátek cesty…',
    toPlaceholder: 'Cíl…',
    swap: 'Prohodit start a cíl',
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
    alongTheWay: 'Po cestě',
    needBoth: 'Vyber start i cíl.',
    computing: 'Počítám trasu…',
    failed: 'Trasu se nepodařilo spočítat.',
    noWeather: 'Trasa je hotová, ale počasí k ní se nepodařilo načíst.',
    result: '{distance}, příjezd v {arrival}',
    estimated: 'Časy jsou odhadnuté — router nedal rychlostní profil.',
    beyond: 'Část trasy sahá za obzor předpovědi.',
    hazards: 'Nebezpečné počasí na {count} místech.',
    rain: 'Déšť na {count} místech.',
    clear: 'Po cestě se nikde nečeká déšť.',
    adviceLater: 'Vyjet o {minutes} min později vychází líp: {reason}',
    adviceNow: 'Vyjet teď je stejně dobré jako později.',
    departure: 'Odjezd',
    now: 'Teď',
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
    updated: 'Aktualizováno {time}',
  },

  forecast: {
    hourly: 'Po hodinách',
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

  windDir: {
    n: 'S', nne: 'SSV', ne: 'SV', ene: 'VSV',
    e: 'V', ese: 'VJV', se: 'JV', sse: 'JJV',
    s: 'J', ssw: 'JJZ', sw: 'JZ', wsw: 'ZJZ',
    w: 'Z', wnw: 'ZSZ', nw: 'SZ', nnw: 'SSZ',
  },

  warnings: {
    title: 'Výstrahy',
    none: 'Žádné výstrahy neplatí.',
    severity: {
      Minor: 'Nízká',
      Moderate: 'Střední',
      Severe: 'Vysoká',
      Extreme: 'Extrémní',
      Unknown: 'Neznámá',
    },
    until: 'do {time}',
  },

  pollen: {
    title: 'Pyl',
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
    allClear: 'Dnes nelítá žádný pyl v měřitelném množství.',
    measured: 'Naměřeno teď, ve vzduchu.',
  },

  radar: {
    title: 'Srážkový radar',
    play: 'Přehrát',
    pause: 'Zastavit',
    observed: 'Naměřeno',
    nowcast: 'Dopočet',
    pickHint: 'Klepnutím do mapy vybereš místo.',
  },

  settings: {
    title: 'Nastavení',
    language: 'Jazyk',
    languageAuto: 'Podle zařízení',
    units: 'Jednotky',
    unitsNote: 'Jednotky nesouvisí s jazykem.',
    temperature: 'Teplota',
    wind: 'Rychlost větru',
    precipitation: 'Srážky',
    distance: 'Vzdálenost',
    about: 'O aplikaci',
  },

  warnings: {
    title: 'Výstrahy',
    none: 'Žádné výstrahy neplatí.',
    noneFor: 'Pro {place} žádné výstrahy neplatí.',
    outside: 'Pro tohle místo se výstrahy nevydávají.',
    unsure: 'Nepodařilo se určit, kterých míst se týkají — ukazujeme všechny.',
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
    offline: 'Bez připojení. Ukazuju naposledy stažená data.',
    stale: 'Nepodařilo se obnovit — tahle data jsou {age} stará.',
    failed: 'Data se nepodařilo načíst.',
    retry: 'Zkusit znovu',
    beyondForecast: 'Tak daleko dopředu předpověď zatím nesahá.',
  },
};

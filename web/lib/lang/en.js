/**
 * English — the REFERENCE language.
 *
 * 🚨 This file defines the key set. Every other language is checked against it
 * by `selftest:logic`; a missing key fails the test. Add keys here first.
 *
 * ⚠️ Keys are English, values are the English text. Never reuse a value as a key.
 */

export default {
  app: {
    name: 'MeteoTrace',
    tagline: 'Weather along your route',
  },

  nav: {
    station: 'Place',
    route: 'Route',
    stats: 'Statistics',
    sections: 'Sections',
    settings: 'Settings',
    menu: 'Search, sections and saved items',
    menuHide: 'Hide the menu',
  },

  /* First run. Four steps in which you pick a home and a favourite
     destination — and the app then shows what it can do on your own data.
     ⚠️ The longest continuous text in the app; keep it short anyway.
     Nobody came here to read. */
  onboarding: {
    skip: 'Skip',
    next: 'Next',
    back: 'Back',
    done: 'Start using it',
    step: 'Step {n} of {total}',

    homeTitle: 'Welcome to MeteoTrace',
    homeText: 'Not just a weather station for one place you pick, but for a whole route — at every point of the way, at the time you actually get there. Start with where you live.',
    homeLabel: 'Find your home',
    homeLocate: 'Use my location',

    goalTitle: 'And where do you go often?',
    goalText: 'Work, grandma, friends. We will work out the route right away and show you on it how the app works.',
    goalLabel: 'Find the destination',
    goalSkip: 'I do not need routes',

    placeTitle: 'This is your weather station',
    placeText: 'One place, everything about it — right now, hour by hour, radar and warnings. This is {place}.',

    routeTitle: 'And this is the route',
    routeText: 'Weather at every point of the way at the time you get there, not the time you set off. {from} → {to}.',

    /* ⚠️ Shown when the forecast cannot be loaded during the first run.
       Without it the welcome looks broken on the very first impression. */
    offline: 'No connection right now, so the weather is missing. It will appear as soon as there is a signal — the app is set up either way.',
  },

  /* Warning notifications.
     ⚠️ Plain tone. Quips may be playful; a storm alert may not. */
  notify: {
    title: 'Weather warning',
    endedTitle: 'All clear',
    endedBody: 'The warnings for {place} are over.',
    titleFor: 'Weather warning — {place}',
    setting: 'Warning notifications',
    off: 'Off',
    level: 'From severity',
    watching: 'Watching {place}: ČHMÚ warnings and thunderstorms on radar. Notifications arrive even when the app is closed.',
    watchingNoStorm: 'Watching {place}, but only ČHMÚ warnings. A thunderstorm ČHMÚ issues no warning for will not be notified.',
    watchOpen: 'That is the place you have open right now. Permanent places, like home, are turned on with the bell in saved places.',
    watchSaved: 'Turn places on and off with the bell in saved places.',
    phoneWatches: 'The phone is watching: {places}.',
    phoneWatchesNothing: 'The phone is not watching anything yet, although notifications are on. Close the app and open it again.',
    storm: 'Thunderstorms on radar',
    stormOn: 'Notify',
    stormOff: 'Do not notify',
    statusTitle: 'Background status',
    lastCheck: 'Last check for warnings and storms: {when}.',
    noCheck: 'No check for warnings yet — the first one comes within 15 minutes.',
    lateCheck: 'Last check for warnings and storms: {when}. That is too long ago — Android is holding the app back.',
    briefLastMorning: 'Last morning report: {when}.',
    briefLastEvening: 'Last evening report: {when}.',
    briefNoneYet: 'No morning or evening report has arrived yet.',
    briefNext: 'Next report: {when}.',
    briefFailed: 'The alarm went off {when}, but no report arrived: {why}.',
    briefWhy: {
      zakazano: 'Android blocked notifications',
      prazdne: 'the server had no forecast for that day',
      sit: 'there was no connection',
    },
    briefNotPlanned: 'No next report is scheduled — Android dropped the alarm. Open the app with location allowed and it will be scheduled again.',
    batteryFree: 'Battery optimisation: unrestricted.',
    batteryOptimized: 'Battery optimisation is on — Android may delay notifications and reports. Battery → Unrestricted in the app settings is more reliable.',
    batteryRestricted: 'Android restricts the app in the background — notifications and reports may not arrive at all. In the app settings choose Battery → Unrestricted.',
    channelOff: 'The “{name}” channel is turned off in Android — nothing will arrive from it.',
    openAppSettings: 'App settings on the phone',
    watchingNone: 'Nothing to watch yet — pick a place first.',
    denied: 'Android has blocked notifications. You can allow them in system settings.',
    unsupported: 'This browser cannot show notifications. They work in the app from Play.',
    browserOnly: 'In the browser we can only notify while the app is open. The app from Play does it in the background.',
  },

  /* Thunderstorm from radar (R37). The server composes the sentence for the
     wrapper, in the app language. Factual, and it says what to do. */
  storm: {
    title: 'Thunderstorm — {place}',
    coming: 'A thunderstorm is coming from the {from}, due in about {min} min.',
    soon: 'A thunderstorm is coming from the {from}, due within 10 minutes.',
    here: 'The thunderstorm is here.',
    strong: 'Severe, hail possible.',
    advice: 'Bring pets and loose things inside.',
    source: 'Based on ČHMÚ radar.',
    from: {
      n: 'north', ne: 'northeast', e: 'east', se: 'southeast',
      s: 'south', sw: 'southwest', w: 'west', nw: 'northwest',
    },
  },

  /* Pull down at the top of the page and the data reloads. Each state has
     its own words — a spinner alone never says whether anything happened. */
  refresh: {
    pull: 'Pull down to refresh',
    release: 'Let go to refresh',
    working: 'Refreshing…',
    done: 'Up to date',
  },

  search: {
    placeholder: 'Search for a place…',
    myLocation: 'My location',
    noResults: 'No such place here. Try spelling it differently.',
    searching: 'Searching…',
    locationFailed: 'Could not get your location. Check that the app is allowed to use it.',
    zeZalohy: 'Backup source — street numbers will not be found right now.',
    noFocus: 'Not sorted by location — tap ⌖ to see places near you.',
  },

  places: {
    saved: 'Saved places',
    savedAll: 'Saved places and routes',
    mine: 'My places',
    // ⚠️ „Here", not „My location": the chip is narrow and this is shorter.
    here: 'Here',
    hereHome: 'Here (where I am now)',
    hereAction: 'Weather where I am now',
    // Carousel next to the target — words split by a bar, ALWAYS three.
    hereCarousel: 'What’s|it like|here?',
    save: 'Save this place',
    // ⚠️ Verb with an object, not a bare „Save" — symmetrical with the route.
    saveShort: 'Save place',
    savedShort: 'Place saved',
    remove: 'Remove from saved',
    removeNamed: 'Remove “{name}” from saved',
    empty: 'Tap the star and the place lands here ⭐',
    full: 'The list was full, so the least used place made way.',
    readOnly: 'Saved places come from a newer version of the app, so they cannot be changed here. Reopening the app should sort it out.',
    alreadySaved: 'Already saved as “{name}”.',
    manage: 'Manage saved places',
    manageTitle: 'Saved places',
    renameHint: 'The address is on the left; name the place on the right — Home, Work, Grandma.',
    // ⚠️ A prompt, not an example. The field is empty and it has to be
    // clear that something is expected there.
    namePlaceholder: 'Name it',
    addressCol: 'Address',
    nameCol: 'Name',
    close: 'Close',
    nameLabel: 'Name of the saved place',
    removeOne: 'Remove',
    confirmRemove: 'Really remove?',
    watchCol: 'Watch',
    watchStart: 'Watch {name} — warnings and storms even with the app closed',
    watchStop: 'Stop watching {name}',
    watchStarted: 'Now watching {name}.',
    watchStopped: 'No longer watching {name}.',
    watchFull: 'You can watch at most {max} places. Turn the bell off for another place first.',
    nameEmpty: 'A name cannot be empty, so the original was kept.',
    renamed: 'Renamed to “{name}”.',
    removed: '“{name}” was removed.',
    count: '{count} of {max} places used',
  },

  routes: {
    saved: 'Saved routes',
    mine: 'My routes',
    save: 'Save this route',
    // ⚠️ „Save ROUTE", not a bare „Save": on the route screen there are
    // other buttons around it and the verb alone says nothing about what
    // gets saved.
    saveShort: 'Save route',
    savedShort: 'Route saved',
    remove: 'Remove this route',
    empty: 'No routes yet. Work one out and the star will keep it.',
    count: '{count} of {max} routes used.',
    removed: 'Removed {name}.',
    full: 'Route list is full — the least used one was dropped.',
    manage: 'Manage saved routes',
    title: 'Routes',
  },

  route: {
    title: 'Weather along your route',
    from: 'From',
    to: 'To',
    fromPlaceholder: 'Start…',
    toPlaceholder: 'Destination…',
    swap: 'Swap start and destination',
    edit: 'Change route',
    collapsed: '{from} → {to} · {mode}',
    via: 'Stop on the way',
    viaPlaceholder: 'Somewhere on the way…',
    addVia: '+ Add a stop',
    removeVia: 'Remove this stop',
    mode: 'How you travel',
    car: 'Car',
    bike: 'Bike',
    walk: 'On foot',
    straight: 'As the crow flies',
    speed: 'Speed',
    speedHint: 'km/h — a glider, a drone and a ferry all move differently, so this one is on you.',
    straightNote: 'Straight line over the globe. It does not avoid land — fine for flying and open water, not for sailing near a coast.',
    compute: 'Show the weather',
    summary: 'Route summary',
    total: 'Total',
    alongTheWay: 'Along the way',
    needBoth: 'Pick a start and a destination — otherwise there is nowhere to go.',
    sameSpot: 'Start and destination are the same place — pick another one 😉',
    needStart: 'Destination set. Where are you starting from? I could not get your location.',
    viaSet: 'Stop {n}: {name}.',
    toSet: 'Destination: {name}.',
    fromHere: 'From here to {to} — working out the weather on the way.',
    computing: 'Working out the route…',
    failed: 'The route did not work out. Shall we try again?',
    noWeather: 'We have the route, but its weather could not be loaded.',
    result: 'Distance {distance}, arriving {arrival}',
    arrival: 'Arriving {time} — {what}.',
    estimated: 'Times are estimates: we have no data on hold-ups along the way.',
    beyond: 'The end of the route is beyond the forecast range.',
    hazards: {
      one: 'Hazardous weather at {count} spot along the route.',
      other: 'Hazardous weather at {count} spots along the route.',
    },
    rain: {
      one: 'Rain expected at {count} spot along the route.',
      other: 'Rain expected at {count} spots along the route.',
    },
    delayHours: { one: 'an hour', other: '{count} hours' },
    delayMinutes: { one: 'a minute', other: '{count} minutes' },
    adviceRain: 'To stay out of the rain, leave {delay} later — the weather works out better.',
    adviceHazard: 'To avoid the worst of it ({what}), leave {delay} later — the weather works out better.',
    adviceRainEarlier: 'To stay out of the rain, leave {delay} earlier — the weather works out better.',
    adviceHazardEarlier: 'To avoid the worst of it ({what}), leave {delay} earlier — the weather works out better.',
    clear: 'No rain expected along the way.',
    adviceNow: 'Leaving now is as good as waiting. Your call.',
    departure: 'Departure',
    departurePlan: 'Schedule',
    departureAt: 'Departure date and time',
    resultPlanned: 'Leaving {departure}, distance {distance}, arriving {arrival}',
    collapsedPlanned: '{from} → {to} · {mode} · {departure}',
    departureExpired: 'The planned departure has passed, counting from now.',
    departurePast: 'Departure cannot be in the past — set to the earliest possible time.',
    departureTooFar: 'The forecast only reaches {days} days ahead — set to the latest possible time.',
    later: '+{hours} h',
    badgeHazard: '{count}× hazard',
    badgeRain: '{count}× rain',
    badgeClear: 'clear',
    now: 'Now',
    pickHintTo: 'Tap the map to set the destination.',
    pickHintVia: 'Tap the map to set the waypoint.',
    pickedVia: 'Waypoint set from the map.',
    pickHint: 'Tap the map to set the start, then the destination.',
    mapWaiting: 'The map appears once the route is worked out.',
    pickedFrom: 'Start set from the map. Now pick the destination.',
    pickedTo: 'Destination set from the map.',
    start: 'Start',
    finish: 'Destination',
    legend: 'What the points along the route mean',
    legendOk: 'no rain',
    legendRain: 'rain',
    legendHazard: 'hazardous weather',
    legendUnknown: 'beyond the forecast',
    legendTap: 'Tap a point on the map to see when you get there and what it will be like.',
  },

  now: {
    feelsLike: 'Feels like',
    wind: 'Wind',
    gusts: 'Gusts',
    humidity: 'Humidity',
    precipitation: 'Precipitation',
    pressure: 'Pressure',
    cloudCover: 'Cloud cover',
    uvIndex: 'UV index',
    uvNizka: 'low exposure',
    uvStredni: 'moderate exposure',
    uvVysoka: 'high exposure',
    uvVelmiVysoka: 'very high exposure',
    uvExtremni: 'extreme exposure',
    sunrise: 'Sunrise',
    sunset: 'Sunset',
    moon: 'Moon',
    pressure: 'Pressure',
    pressureLocal: 'here {value}',
    elevation: '{value} a.s.l.',
    updated: 'Updated {time}',
  },

  forecast: {
    hourly: 'Next 48 hours, hour by hour',
    daily: '7 days',
    today: 'Today',
    tomorrow: 'Tomorrow',
    high: 'High',
    low: 'Low',
    chanceOfRain: 'Chance of rain',
  },

  /** Weather conditions — keys come from `weather-code.js` (WEATHER_KEYS). */
  weather: {
    clear: 'Clear',
    mostlyClear: 'Mostly clear',
    partlyCloudy: 'Partly cloudy',
    overcast: 'Overcast',
    veiledSun: 'Sun through high cloud',
    fog: 'Fog',
    drizzle: 'Drizzle',
    freezingRain: 'Freezing rain',
    rain: 'Rain',
    heavyRain: 'Heavy rain',
    snow: 'Snow',
    heavySnow: 'Heavy snow',
    rainShowers: 'Rain showers',
    snowShowers: 'Snow showers',
    thunderstorm: 'Thunderstorm',
    hailstorm: 'Thunderstorm with hail',
    unknown: 'Unknown',
  },

  /** Wind directions — keys come from `windDirKey()`. */
  windDir: {
    n: 'N', nne: 'NNE', ne: 'NE', ene: 'ENE',
    e: 'E', ese: 'ESE', se: 'SE', sse: 'SSE',
    s: 'S', ssw: 'SSW', sw: 'SW', wsw: 'WSW',
    w: 'W', wnw: 'WNW', nw: 'NW', nnw: 'NNW',
  },

  /** Where the wind blows from, spelled out. */
  windDirLong: {
    n: 'northerly', nne: 'north-northeasterly', ne: 'northeasterly', ene: 'east-northeasterly',
    e: 'easterly', ese: 'east-southeasterly', se: 'southeasterly', sse: 'south-southeasterly',
    s: 'southerly', ssw: 'south-southwesterly', sw: 'southwesterly', wsw: 'west-southwesterly',
    w: 'westerly', wnw: 'west-northwesterly', nw: 'northwesterly', nnw: 'north-northwesterly',
  },

  moonPhase: {
    new: 'New moon',
    waxingCrescent: 'Waxing crescent',
    firstQuarter: 'First quarter',
    waxingGibbous: 'Waxing gibbous',
    full: 'Full moon',
    waningGibbous: 'Waning gibbous',
    lastQuarter: 'Last quarter',
    waningCrescent: 'Waning crescent',
  },

  pollen: {
    title: 'Pollen',
    alder: 'Alder',
    birch: 'Birch',
    grass: 'Grass',
    mugwort: 'Mugwort',
    olive: 'Olive',
    ragweed: 'Ragweed',
    level: {
      none: 'None',
      low: 'Low',
      moderate: 'Moderate',
      high: 'High',
      veryHigh: 'Very high',
    },
    none: 'No pollen data for this place.',
    allClear: 'Nothing measurable in the air today. Allergy sufferers may exhale.',
    measured: 'Measured now, in the air.',
  },

  radar: {
    title: 'Rain radar',
    play: 'Play',
    pause: 'Pause',
    observed: 'Measured',
    scrub: 'Frame time',
    now: 'now',
    ago: '{min} min ago',
    in: 'in {min} min',
    nowcast: 'Forecast',
    nowcastChmi: 'ČHMI forecast',
    disabled: 'The map is switched off by ?nomap=1 in the address.',
    mapFailed: 'The map could not be loaded. Check the connection and try again.',
    noWebgl: 'This browser cannot draw the map — 3D graphics (WebGL) are turned off or unavailable.',
  },

  // Rate the app (Gulpka pattern). Android wrapper only.
  rate: {
    title: 'Rating',
    open: 'Rate the app',
  },

  settings: {
    title: 'Settings',
    language: 'Language',
    languageAuto: 'Match my device',
    primary: 'Home screen shows:',
    theme: 'Appearance',
    themeAuto: 'Match my device',
    themeLight: 'Light',
    themeDark: 'Dark',
    themePink: 'Pink',
    themePinkDark: 'Pink, dark',
    themeCamo: 'Expedition CZ',
    units: 'Units',
    unitsNote: 'Metric or imperial.',
    temperature: 'Temperature',
    wind: 'Wind speed',
    precipitation: 'Precipitation',
    distance: 'Distance',
    about: 'About',
    privacy: 'Privacy policy',
    briefs: 'Morning and evening report',
    briefsOff: 'Off',
    briefsOn: 'On',
    briefMorning: 'Morning at',
    briefEvening: 'Evening at',
    briefsWhere: 'Reports are for {place} — the last place where the app got your location.',
    briefsNoPlace: 'Nowhere to report from yet: reports use your last known location and the app does not have one. Tap ⌖ next to search.',
    briefsWeb: 'Reports do not work in a browser — they need the app from Google Play.',
    version: 'MeteoTrace {version}',
    sources: 'Forecast and pollen: Open-Meteo. Radar: RainViewer, precipitation nowcast by ČHMÚ (CC BY 4.0). Warnings: ČHMÚ, MeteoAlarm as backup. Thunderstorms: ČHMÚ radar (CC BY 4.0). Map: own tiles from OpenStreetMap data (ODbL). Routing and search: openrouteservice / HeiGIT. Boundaries: ČÚZK RÚIAN.',
  },

  /* Donations (R7).
     🚨 A donation never unlocks anything — and the app says so out loud.
     An offer to pay inside a free app looks like a trap unless it is
     spelled out that nothing is behind it. */
  donate: {
    open: 'Support the app',
    title: 'Support MeteoTrace',
    intro: 'The app is free, has no ads and nothing hidden behind a payment. If it has ever kept you dry, you can throw in a coin.',
    nothing: 'A donation unlocks nothing — there is nothing to unlock. The whole app is free and stays that way.',
    qrTitle: 'Czech QR payment',
    qrNote: 'Scan it in your banking app — the account and the amount fill themselves in.',
    amount: 'Amount',
    customLabel: 'Or your own amount (CZK)',
    account: 'Account: {iban}',
    noAmount: 'No amount in the code — your bank will ask.',
    withAmount: 'The code carries {amount} CZK.',
    /* ⚠️ Když se kód nepovede nakreslit, musí zůstat cesta k zaplacení. */
    qrFailed: 'The code could not be drawn. The account number above works just as well.',
    opensOut: 'Opens in a browser',
    /* 🚨 Neither Revolut nor PayPal can prefill a note — only an amount
       goes into the link. Without this line a donation through them is
       indistinguishable from one for another app: same account, no
       variable symbol. */
    noteLabel: 'Put this in the note:',
    noteWhy: 'Revolut and PayPal will not fill the note in for you. It is how we can tell the donation was meant for MeteoTrace.',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Selected — copy it yourself',
    thanks: 'Thank you for even reading this far.',
  },

  /* Crosslinks on our own projects (R7). Settings, never the main screen —
     an offer of other products in the middle of a forecast is an ad. */
  more: {
    title: 'More from us',
    note: 'Our own projects, not third-party ads.',
    gulpka: 'Drink up — a water reminder',
    vtcleaner: 'A safe Windows cleaner',
    itrady: 'Practical tips from the world of IT',
    mailnino: 'An e-mail client that speaks to Czech data boxes',
  },

  /* When it will be.
     🚨 The day is spelled out as soon as it is not today. Prague to Nuremberg
     on foot is 60 hours, and without a date it read as tonight.
     See `lib/when.js`. */
  when: {
    tomorrow: 'tomorrow {time}',
    yesterday: 'yesterday {time}',
    date: '{date} {time}',
  },

  brief: {
    today: 'Today',
    tomorrow: 'Tomorrow',
    line: '{day} {min} to {max} · {what}',
    rain: 'chance {p}%',
    wind: 'wind up to {w}',
    titleMorning: 'Morning · {place}',
    titleEvening: 'Evening · {place}',
  },

  // Home-screen widget (R29). Short on purpose — a 4×1 widget has one line.
  widget: {
    feels: 'Feels {temp}',
    hiLo: '↑{hi}  ↓{lo}',
    rainAt: 'Rain from {when}',
    snowAt: 'Snow from {when}',
    dryAt: 'Dry from {when}',
    snowStops: 'Snow eases from {when}',
    keepsRaining: 'Rain for the next 12 hours',
    keepsSnowing: 'Snow for the next 12 hours',
    // Neither rain nor snow — "no rain" would be a half-truth in winter.
    dry: 'Dry for the next 12 hours',
  },

  warnings: {
    title: 'Warnings',
    none: 'No weather warnings right now.',
    noneFor: 'No weather warnings for {place} right now.',
    outside: 'We do not cover warnings for this area — we follow the European system.',
    unsure: 'We could not tell which places these apply to, so all warnings are shown.',
    unavailable: 'Warnings could not be loaded.',
    /* 🚨 How old the message is ALWAYS stands next to the warnings. Anything
       older than 12 hours is not shown at all, so hours are the most we need. */
    issuedJustNow: 'Issued just now ({time})',
    issuedMinutes: { one: 'Issued a minute ago ({time})', other: 'Issued {count} minutes ago ({time})' },
    issuedHours: { one: 'Issued an hour ago ({time})', other: 'Issued {count} hours ago ({time})' },
    unnamed: 'Warning',
    // ⚠️ Konec nebezpečí je zpráva, na kterou se čeká. Řekne se JEDNOU
    // a pak karta zmizí — opakovat dobrou zprávu znamená ji znehodnotit.
    ended: 'The warnings are over. Nothing is in force for {place} now.',
    endedNoPlace: 'The warnings are over. Nothing is in force now.',
    appliesTo: 'Applies to {place}.',
    areaUncertain: 'It was not possible to tell exactly where this applies.',
    from: 'from {time}',
    until: 'until {time}',
    fromUntil: '{from}–{until}',
    severity: {
      extreme: 'Extreme',
      severe: 'Severe',
      moderate: 'Moderate',
      minor: 'Minor',
      unknown: 'Unknown severity',
    },
  },

  /* Statistics (R35): what the weather at a place or along a route REALLY was.
     ⚠️ Status lines (loading, empty, failed) must say WHAT TO DO — an empty
     screen without an explanation cannot be told apart from a broken one. */
  stats: {
    modeAria: 'Statistics for a place or for a route',
    period: 'Period',
    periods: {
      h48: 'Last 48 hours',
      7: '7 days',
      month: 'Last month',
      m3: 'Last 3 months',
      year: 'Last year',
      thisyear: 'This year',
      lastyear: 'Previous year',
      all: 'All time (1940)',
      custom: 'Custom…',
    },
    from: 'From',
    to: 'To',
    rangeYears: 'Years {from}–{to}',
    loading: 'Loading what it was like…',
    empty: 'No data for this period.',
    pickRange: 'Pick both dates — from and to.',
    noPlace: 'Pick a place first: search above or tap a saved one.',
    noRoute: 'Enter a route on the Route tab first. Then you will see what it was like at the start, the stops and the destination.',
    failed: 'Weather history could not be loaded. Try again in a moment.',
    summary: 'What it was like',
    tempMean: 'Average temperature',
    tempMax: 'Warmest',
    tempMin: 'Coldest',
    precip: 'Precipitation',
    rainDays: { one: '{count} rainy day', other: '{count} rainy days' },
    wettest: 'Wettest day',
    dryStreak: 'Longest dry spell',
    wetStreak: 'Longest wet spell',
    days: { one: '{count} day', other: '{count} days' },
    // ⚠️ Cloud cover, not "sunshine": the archive overstates sunshine almost
    // twofold (see `JASNO_DO_PCT` in lib/stats.js).
    cloud: 'Cloud cover',
    clearDays: { one: '{count} clear day', other: '{count} clear days' },
    gust: 'Strongest gust',
    wind: 'Prevailing wind',
    windShare: '{days} of {total} days',
    tropical: 'Hot days',
    tropicalNote: '{temp} or more',
    frost: 'Frost days',
    frostNote: 'below freezing at night',
    snow: 'Days with snowfall',
    /* Last 48 hours by the hour (8 Oct 2026). ⚠️ A different source than days —
       the forecast model, not the archive; `hourlyNote` has to say so. */
    hours: { one: '{count} hour', other: '{count} hours' },
    rainHours: { one: '{count} hour with rain', other: '{count} hours with rain' },
    wettestHour: 'Wettest hour',
    snowHours: 'Snowed',
    windShareHours: '{hours} of {total} hours',
    pressureNow: 'Pressure now',
    pressureChange: '{value} in {hours} h',
    nowValue: 'now {value}',
    hourlyNote: 'By the hour, the app reads a forecast model, not the archive. The data are fresh up to now, but may differ from the daily statistics by a degree or two.',
    chart: 'Over time',
    chartAria: 'Chart: {what} over the chosen period. Arrow keys pick a day.',
    chartAriaHour: 'Chart: {what} over the last 48 hours. Arrow keys pick an hour.',
    chartStep: { hour: 'By hour.', day: 'By day.', week: 'By week.', month: 'By month.' },
    chartYears: 'By year, full years only.',
    chartTap: 'Tap the chart to see values with dates.',
    chartTapHour: 'Tap the chart to see values with date and time.',
    /* Quantity switch (6 Oct 2026): the same data the app shows in the forecast.
       ⚠️ No UV index — the archive has none. */
    quantityAria: 'What the chart shows',
    q: {
      temp: 'Temperature',
      feels: 'Feels like',
      precip: 'Precipitation',
      wind: 'Wind',
      humidity: 'Humidity',
      cloud: 'Cloud cover',
      pressure: 'Pressure',
    },
    // What each quantity means — said once under the chart.
    qNote: {
      temp: 'Highest and lowest air temperature.',
      feels: 'Feels-like temperature includes wind, humidity and sunshine.',
      precip: 'Rain and snow as water.',
      wind: 'Strongest wind and strongest gusts.',
      humidity: 'Average relative humidity.',
      cloud: 'Average cloud cover over the day.',
      pressure: 'Average pressure at sea level, as in the forecast.',
    },
    // The same by the hour — an hour has no "high and low" or "daily average".
    qNoteHour: {
      temp: 'Air temperature in each hour.',
      feels: 'Feels-like temperature includes wind, humidity and sunshine.',
      precip: 'Precipitation in each hour, rain and snow as water.',
      wind: 'Wind and strongest gusts in each hour.',
      humidity: 'Relative humidity in each hour.',
      cloud: 'Cloud cover in each hour.',
      pressure: 'Pressure at sea level, as in the forecast.',
    },
    // Line and bar names in the legend and in the bubble after a tap.
    series: {
      temp: 'Temperature',
      feels: 'Feels like',
      max: 'High',
      min: 'Low',
      precip: 'Precipitation',
      wind: 'Wind',
      gust: 'Gusts',
      dir: 'Direction',
      humidity: 'Humidity',
      cloud: 'Cloud cover',
      pressure: 'Pressure',
      yearMean: 'Year average',
      yearPrecip: 'Year total',
    },
    yearsOnly: 'Over more than two years only temperature and precipitation are read. The rest shows for shorter periods.',
    meanValue: 'average {value}',
    perYear: '{value} a year',
    wettestShort: 'wettest in {year}',
    visited: 'Where I have been',
    visitedHint: 'Places where you tapped “Here”. They stay on this phone only.',
    visitedUnnamed: 'My location',
    routeTitle: 'What it was like along the route',
    routeHint: 'Tap a point to see it in detail.',
    routeStart: 'Start',
    routeVia: 'Stop {n}',
    routeEnd: 'Destination',
    years: 'Years',
    yearsMean: 'Average {from}–{to}',
    change: 'Warming',
    changeNote: '{from}–{to} vs 1961–1990',
    warmestYear: 'Warmest year',
    coldestYear: 'Coldest year',
    wettestYear: 'Wettest year',
    driestYear: 'Driest year',
    warmestShort: 'warmest in {year}',
    partialYear: 'The year {year} is not complete, so it is left out of records and the chart.',
    source: 'Data come from a weather model on a grid of about 10–25 km, not from a single station. In mountains and valleys they may differ. Source: Open-Meteo.',
  },

  /* Location permission in settings (30 Sep 2026). Logic lives in lib/location-access.js.
     ⚠️ Every hint must say WHAT TO DO — "denied" without a way out is a dead end. */
  location: {
    setting: 'Location',
    granted: 'Allowed',
    notYet: 'Not allowed yet',
    denied: 'Denied',
    off: 'Turned off on the phone',
    unsupported: 'This device cannot provide location.',
    allow: 'Allow location',
    turnOn: 'Turn on location',
    askHint: 'Without it, “Here”, the widget and the morning briefing cannot work.',
    grantedHint: 'Last known: {place}.',
    deniedHintApp: 'If Android does not ask, the phone settings open — turn on Location under Permissions there.',
    deniedHintWeb: 'The browser has blocked location for this page. Allow it at the lock icon next to the address and reload the page.',
    offHint: 'The app has permission, but location is turned off on the phone.',
    deniedNotice: 'Location is not allowed. Turn it on in settings (⚙) with one tap.',
    offNotice: 'Location is turned off on the phone. Turn it on from settings (⚙) with one tap.',
  },

  time: {
    min: 'min',
    hour: 'h',
  },

  error: {
    offline: 'No connection. Showing the last data downloaded.',
    stale: 'Could not refresh — this data is {age} old.',
    failed: 'Could not load data.',
    retry: 'Try again',
    beyondForecast: 'No forecast reaches that far ahead yet.',
    /* 🚨 A guard nobody is told about looks exactly like a fault. Both of
       these arrive as 429 and mean different things: wait a minute, or wait
       until tomorrow. The sentence has to say what to do. */
    tooMany: 'Too many requests at once. Give it a minute and try again.',
    quota: 'The daily allowance for routes is used up; it resets tomorrow. The weather station and radar carry on.',
  },
};

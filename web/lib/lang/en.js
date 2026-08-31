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
    watching: 'Watching {place}. Notifications arrive even when the app is closed.',
    watchingNone: 'Nothing to watch yet — pick a place first.',
    denied: 'Android has blocked notifications. You can allow them in system settings.',
    unsupported: 'This browser cannot show notifications. They work in the app from Play.',
    browserOnly: 'In the browser we can only notify while the app is open. The app from Play does it in the background.',
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
    alongTheWayCount: '({count})',
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
    clear: 'No rain expected along the way.',
    adviceNow: 'Leaving now is as good as waiting. Your call.',
    departure: 'Departure',
    later: '+{hours} h',
    badgeHazard: '{count}× hazard',
    badgeRain: '{count}× rain',
    badgeClear: 'clear',
    now: 'Now',
    pickHintTo: 'Tap the map to set the destination.',
    pickHintReplace: 'Tap the map to change the destination.',
    pickHint: 'Tap the map to set the start, then the destination.',
    mapWaiting: 'The map appears once the route is worked out.',
    pickedFrom: 'Start set from the map. Now pick the destination.',
    pickedTo: 'Destination set from the map.',
    start: 'Start',
    finish: 'Destination',
    legend: 'Points along the route',
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
    pickHint: 'Tap the map to pick a place.',
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
    units: 'Units',
    unitsNote: 'Metric or imperial.',
    temperature: 'Temperature',
    wind: 'Wind speed',
    precipitation: 'Precipitation',
    distance: 'Distance',
    about: 'About',
    version: 'MeteoTrace {version}',
    sources: 'Forecast and pollen: Open-Meteo. Radar: RainViewer, precipitation nowcast by ČHMÚ (CC BY 4.0). Warnings: ČHMÚ via MeteoAlarm. Map: own tiles from OpenStreetMap data (ODbL). Routing and search: openrouteservice / HeiGIT. Boundaries: ČÚZK RÚIAN.',
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
    date: '{date} {time}',
  },

  warnings: {
    title: 'Warnings',
    none: 'No weather warnings right now.',
    noneFor: 'No weather warnings for {place} right now.',
    outside: 'We do not cover warnings for this area — we follow the European system.',
    unsure: 'We could not tell which places these apply to, so all warnings are shown.',
    unavailable: 'Warnings could not be loaded.',
    /* 🚨 A dead source is not calm. An empty list means either „nothing is
       coming" or „the source has gone quiet" — two very different messages. */
    stale: 'These warnings are {age} old — we have nothing newer from ČHMÚ. Do not rely on this card right now.',
    ageUnknown: 'we cannot tell how',
    ageHours: { one: 'an hour', other: '{count} hours' },
    ageDays: { one: 'a day', other: '{count} days' },
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

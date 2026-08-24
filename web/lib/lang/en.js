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
    settings: 'Settings',
  },

  search: {
    placeholder: 'Search for a place…',
    myLocation: 'My location',
    noResults: 'No place found.',
    searching: 'Searching…',
  },

  places: {
    saved: 'Saved places',
    save: 'Save this place',
    saveShort: 'Save',
    savedShort: 'Saved',
    remove: 'Remove from saved',
    removeNamed: 'Remove “{name}” from saved',
    empty: 'Tap the star to keep a place here.',
    full: 'The list was full, so the least used place made way.',
    readOnly: 'Saved places come from a newer version of the app, so they cannot be changed here. Reopening the app should sort it out.',
    alreadySaved: 'Already saved as “{name}”.',
    manage: 'Manage saved places',
    manageTitle: 'Saved places',
    close: 'Close',
    nameLabel: 'Name of the saved place',
    removeOne: 'Remove',
    confirmRemove: 'Really remove?',
    nameEmpty: 'A name cannot be empty, so the original was kept.',
    renamed: 'Renamed to “{name}”.',
    removed: '“{name}” was removed.',
    count: '{count} of {max} places used',
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
    sunrise: 'Sunrise',
    sunset: 'Sunset',
    updated: 'Updated {time}',
  },

  forecast: {
    hourly: 'By the hour',
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

  warnings: {
    title: 'Warnings',
    none: 'No warnings in effect.',
    severity: {
      Minor: 'Minor',
      Moderate: 'Moderate',
      Severe: 'Severe',
      Extreme: 'Extreme',
      Unknown: 'Unknown',
    },
    until: 'until {time}',
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
    allClear: 'No pollen in measurable amounts today.',
    measured: 'Measured now, in the air.',
  },

  radar: {
    title: 'Rain radar',
    play: 'Play',
    pause: 'Pause',
    observed: 'Measured',
    nowcast: 'Forecast',
    pickHint: 'Tap the map to pick a place.',
  },

  settings: {
    title: 'Settings',
    language: 'Language',
    languageAuto: 'Match my device',
    units: 'Units',
    unitsNote: 'Units are independent of language.',
    temperature: 'Temperature',
    wind: 'Wind speed',
    precipitation: 'Precipitation',
    distance: 'Distance',
    about: 'About',
  },

  warnings: {
    title: 'Warnings',
    none: 'No warnings in force.',
    noneFor: 'No warnings for {place}.',
    outside: 'Warnings are not issued for this place.',
    unsure: 'We could not tell which places these apply to, so all warnings are shown.',
    unavailable: 'Warnings could not be loaded.',
    unnamed: 'Warning',
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
  },
};

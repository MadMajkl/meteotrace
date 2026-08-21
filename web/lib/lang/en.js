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
    none: 'No pollen data for this place.',
  },

  radar: {
    title: 'Rain radar',
    play: 'Play',
    pause: 'Pause',
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

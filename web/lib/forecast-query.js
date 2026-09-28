/**
 * Dotaz na předpověď meteostanice — JEDINÝ zdroj pro appku i pro předstih
 * při startu (`start.js`).
 *
 * ⚠️ ČISTÝ MODUL BEZ ZÁVISLOSTÍ (kromě `geo-query.js`, který taky nemá
 * žádné). Načítá se jako první věc na stránce, takže nesmí za sebou táhnout
 * nic dalšího — jinak by předstih čekal na tytéž moduly jako appka a nebyl
 * by k ničemu.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ PŘEDSTIH
 *
 * Michal 28. 9. 2026: *„aby to bylo svižnější."* Změřeno na zpomalené síti:
 * appka se stahuje ~2,4 s (přes 30 modulů) a dotaz na počasí vyrážel až
 * PO NICH, dalších ~0,75 s. Přitom místo, pro které se ptá, je známé hned:
 * leží v úložišti. `start.js` proto dotaz pošle souběžně se stahováním appky
 * a `apiGet` si hotovou odpověď jen převezme.
 *
 * 🚨 Převzít jde jen odpověď na PŘESNĚ tutéž adresu. Proto se dotaz skládá
 * tady, na jednom místě — kdyby si ho appka a předstih skládaly každý po
 * svém, stačilo by přidat do jednoho z nich parametr a předstih by tiše
 * přestal fungovat (appka by se ptala znovu a nikdo by si ničeho nevšiml).
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { isUsablePoint } from './geo-query.js';

/** Klíč úložiště appky. Čte ho appka (`app.js`) i předstih (`start.js`). */
export const STORE_KEY = 'meteotrace.v1';

export const FORECAST_PARAMS = {
  current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover_low,cloud_cover_mid,cloud_cover_high,direct_radiation,shortwave_radiation,pressure_msl,surface_pressure',
  hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,uv_index,cloud_cover_low,cloud_cover_mid,cloud_cover_high,direct_radiation,shortwave_radiation',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
  timezone: 'auto',
  forecast_days: '7',
};

/** Parametry dotazu na předpověď pro jedno místo. */
export function forecastQuery(place) {
  return { latitude: place.lat, longitude: place.lon, ...FORECAST_PARAMS };
}

/**
 * Místo z adresy stránky (`?lat=…&lon=…&name=…`), nebo `null`.
 * Nesmysl se nebere — mimo rozsah i nulový ostrov, viz `isUsablePoint()`.
 *
 * @param {string} search  `location.search`
 * @param {string} [bezJmena]  jméno, když adresa žádné nenese
 */
export function placeFromSearch(search, bezJmena) {
  const q = new URLSearchParams(search || '');
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  if (!isUsablePoint({ lat, lon })) return null;
  return { name: q.get('name') || bezJmena || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon };
}

/**
 * Pro jaké místo se appka po startu zeptá na počasí: místo z adresy
 * přebíjí uložené — přesně v tomhle pořadí to dělá `init()` v `app.js`.
 *
 * @param {string} search       `location.search`
 * @param {string|null} ulozeno  obsah úložiště appky (JSON), klidně poškozený
 * @returns {{lat:number, lon:number}|null}
 */
export function startPlace(search, ulozeno) {
  const zAdresy = placeFromSearch(search);
  if (zAdresy) return zAdresy;
  try {
    const misto = JSON.parse(ulozeno || '{}')?.place;
    return isUsablePoint(misto) ? misto : null;
  } catch {
    return null;
  }
}

/**
 * Počasí na trase — složení plánu a předpovědi do zobrazitelného pohledu.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě. Tady je jádro toho, čím se produkt liší
 * od ostatních meteoappek (`R8`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 HODNOCENÍ MUSÍ BÝT VYSVĚTLITELNÉ, NE MAGICKÉ ČÍSLO.
 *
 * Je svůdné spočítat jedno skóre a seřadit podle něj časy odjezdu. Jenže
 * uživatel se pak nedozví PROČ — a appka, která říká „vyjeď v 16:00" bez
 * důvodu, se neužívá, protože se jí nedá věřit. Proto se vedle skóre vrací
 * i jeho složky: kolik bodů má srážky, kolik je nebezpečných a jaký je
 * nejhorší jev. UI z toho postaví větu, ne graf.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { t } from './i18n.js';
import { formatTemp, formatWind, formatPrecip, windDirKey } from './units.js';
import { weatherKey, weatherIcon, isHazard } from './weather-code.js';
import { asLocationList } from './route-adapter.js';

/** Nad kolik procent se déšť považuje za pravděpodobný. */
export const RAIN_PROBABILITY = 40;

/** Vítr, od kterého je řízení nepříjemné (km/h). */
export const STRONG_WIND_KMH = 60;

/**
 * Sloučí naplánované body s předpovědí.
 *
 * @param {object} a
 * @param {ReturnType<import('./eta.js').planRoute>} a.plan
 * @param {object|object[]} a.forecast   odpověď Open-Meteo pro body trasy
 * @param {string} a.lang
 * @param {object} a.units
 * @returns {{points: Array, summary: object}|null}
 */
export function buildRouteView({ plan, forecast, lang, units }) {
  if (!plan?.points?.length) return null;

  const locations = asLocationList(forecast);
  // Předpověď musí sedět na body 1:1. Když nesedí, radši nic než posunutá
  // data — počasí přiřazené špatnému místu je horší než chybějící.
  if (locations.length !== plan.points.length) return null;

  const points = plan.points.map((p, i) => describePoint(p, locations[i], lang, units));

  return { points, summary: summarize(points, lang) };
}

function describePoint(planPoint, location, lang, units) {
  const H = location?.hourly || {};
  const i = planPoint.hourIndex;

  // Bod za obzorem předpovědi není chyba — jen se o něm nic neví (viz eta.js).
  if (i == null) {
    return {
      ...planPoint,
      known: false,
      icon: '❓',
      condition: t('error.beyondForecast', lang),
      hazard: false,
    };
  }

  const code = H.weather_code?.[i];
  const precipProb = H.precipitation_probability?.[i] ?? null;
  const windKmh = H.wind_speed_10m?.[i] ?? null;
  const hazard = isHazard(code) || (windKmh != null && windKmh >= STRONG_WIND_KMH);

  return {
    ...planPoint,
    known: true,
    code,
    key: weatherKey(code),
    icon: weatherIcon(code, true),
    condition: t(`weather.${weatherKey(code)}`, lang),
    temp: formatTemp(H.temperature_2m?.[i], units, lang),
    wind: formatWind(windKmh, units, lang),
    windDir: dirText(H.wind_direction_10m?.[i], lang),
    windKmh,
    precip: formatPrecip(H.precipitation?.[i], units, lang),
    precipProb,
    precipProbText: precipProb == null ? '—' : `${Math.round(precipProb)} %`,
    rain: precipProb != null && precipProb >= RAIN_PROBABILITY,
    hazard,
  };
}

/**
 * Souhrn za celou trasu.
 *
 * Vrací složky, ne jen verdikt — viz poznámka nahoře o vysvětlitelnosti.
 */
function summarize(points, lang) {
  const known = points.filter((p) => p.known);
  const rainy = known.filter((p) => p.rain);
  const hazardous = known.filter((p) => p.hazard);

  // Nejhorší jev se hledá podle závažnosti, ne podle pořadí na trase.
  const RANK = ['hailstorm', 'thunderstorm', 'freezingRain', 'heavySnow', 'snow',
                'snowShowers', 'heavyRain', 'fog', 'rainShowers', 'rain'];
  let worst = null;
  for (const p of hazardous) {
    const r = RANK.indexOf(p.key);
    if (r !== -1 && (worst === null || r < RANK.indexOf(worst.key))) worst = p;
  }

  return {
    total: points.length,
    unknown: points.length - known.length,
    rainCount: rainy.length,
    hazardCount: hazardous.length,
    worst: worst && {
      key: worst.key,
      condition: worst.condition,
      distanceM: worst.distanceM,
      etaMs: worst.etaMs,
    },
    // Skóre je jen na SEŘAZENÍ variant odjezdu, ne k zobrazení.
    // Nebezpečný jev váží víc než déšť; neznámý bod se nepočítá vůbec,
    // aby delší trasa nevycházela hůř jen proto, že sahá za obzor.
    score: rainy.length + hazardous.length * 3,
  };
}

/**
 * Srovnání časů odjezdu — funkce, která je prakticky zadarmo (`R8`).
 *
 * Open-Meteo vrací pro každý bod CELÉ hodinové pole, takže po jednom volání
 * máme počasí ve všech bodech ve všech hodinách. Jiný čas odjezdu = jiný
 * index v už stažených datech, žádný další dotaz.
 *
 * @param {object} a
 * @param {Array} a.options   výstup `departureOptions()` z eta.js
 * @param {object|object[]} a.forecast
 * @param {string} a.lang
 * @param {object} a.units
 * @returns {{options: Array, best: object|null}}
 */
export function compareDepartures({ options, forecast, lang, units }) {
  const scored = options
    .map((o) => {
      const view = buildRouteView({ plan: o.plan, forecast, lang, units });
      return view && { offsetMin: o.offsetMin, departureMs: o.departureMs, ...view };
    })
    .filter(Boolean);

  if (!scored.length) return { options: [], best: null };

  // Nejlepší = nejnižší skóre. Při shodě vyhrává dřívější odjezd —
  // nikdo nechce čekat o dvě hodiny déle kvůli stejnému počasí.
  const best = scored.reduce((a, b) => {
    if (b.summary.score !== a.summary.score) return b.summary.score < a.summary.score ? b : a;
    return Math.abs(b.offsetMin) < Math.abs(a.offsetMin) ? b : a;
  });

  return {
    options: scored,
    best,
    // Má vůbec smysl něco doporučovat? Když je to všude stejné, appka
    // má mlčet, ne vymýšlet radu.
    worthMoving: scored.some((o) => o.summary.score !== best.summary.score),
  };
}

function dirText(degrees, lang) {
  const key = windDirKey(degrees);
  return key ? t(`windDir.${key}`, lang) : '—';
}

/** Parametry pro dotaz na předpověď po trase — jen to, co se opravdu použije. */
export const ROUTE_FORECAST_PARAMS = {
  hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
  timezone: 'auto',
  forecast_days: '3',
};

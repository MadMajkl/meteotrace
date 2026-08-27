/**
 * Meteostanice — převod odpovědi API na to, co se zobrazí.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě. Dostane syrová data, jazyk a jednotky
 * a vrátí hotové texty. UI je pak jen rozmístí — a všechno zajímavé se dá
 * otestovat bez prohlížeče.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 ČAS SE UKAZUJE V MÍSTĚ, KTERÉ SE PROHLÍŽÍ, NE TAM, KDE STOJÍ TELEFON.
 *
 * Open-Meteo s `timezone=auto` vrací časy jako `"2026-08-21T14:00"` — BEZ
 * značky pásma. `Date.parse()` takový řetězec vyloží podle pásma ZAŘÍZENÍ,
 * takže Čech koukající na počasí v New Yorku by viděl časy posunuté o šest
 * hodin. Proto se k času vždy připočítá `utc_offset_seconds` z odpovědi
 * a formátuje se s `timeZone` toho místa.
 *
 * Uvnitř se pracuje s epoch ms (UTC), stejně jako v ETA jádru.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { t, tf } from './i18n.js';
import { formatTemp, formatWind, formatPrecip, windDirKey } from './units.js';
import { weatherKey, weatherIcon, weatherKeyWithClouds, weatherIconWithClouds,
} from './weather-code.js';
import { moonPhase } from './moon.js';

/**
 * Naivní čas z Open-Meteo → epoch ms.
 *
 * @param {string} naive  např. '2026-08-21T14:00'
 * @param {number} utcOffsetSeconds  z pole `utc_offset_seconds` odpovědi
 * @returns {number|null}
 */
export function parseLocalTime(naive, utcOffsetSeconds = 0) {
  if (typeof naive !== 'string') return null;
  // Přidáním 'Z' se řetězec vyloží jako UTC — a odečtením posunu se z něj
  // stane skutečný okamžik. Bez toho by se použilo pásmo zařízení.
  const asUtc = Date.parse(naive.length === 16 ? `${naive}:00Z` : `${naive}Z`);
  if (!Number.isFinite(asUtc)) return null;
  return asUtc - utcOffsetSeconds * 1000;
}

/** Hodina a minuta v pásmu daného místa. */
export function formatClock(ms, timeZone, locale) {
  if (!Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat(locale || 'en', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timeZone || 'UTC',
  }).format(new Date(ms));
}

/** Zkratka dne v týdnu v pásmu daného místa. */
export function formatWeekday(ms, timeZone, locale) {
  if (!Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat(locale || 'en', {
    weekday: 'short', timeZone: timeZone || 'UTC',
  }).format(new Date(ms));
}

/**
 * Je v daném místě den? Podle východu a západu slunce, ne podle hodin —
 * v červnu je v Norsku v jedenáct večer světlo.
 */
export function isDaylight(ms, sunriseMs, sunsetMs) {
  if (!Number.isFinite(sunriseMs) || !Number.isFinite(sunsetMs)) return true;
  return ms >= sunriseMs && ms < sunsetMs;
}

/* ============================================================
   PYL
   ============================================================ */

/**
 * Prahy koncentrace pylu (zrn/m³) pro čtyři stupně.
 * Liší se druh od druhu — bříza obtěžuje při desetkrát nižší koncentraci než trávy.
 */
const POLLEN_THRESHOLDS = {
  alder:   [10, 50, 150],
  birch:   [10, 50, 150],
  grass:   [20, 50, 200],
  mugwort: [10, 30, 100],
  olive:   [20, 80, 200],
  ragweed: [5, 20, 60],
};

export const POLLEN_SPECIES = Object.keys(POLLEN_THRESHOLDS);

/**
 * Koncentrace → klíč stupně, nebo null když data chybí.
 *
 * 🚨 NULA NENÍ „nízká", je to „žádný". Dřív dostaly všechny druhy stupeň
 * „nízká" bez ohledu na hodnotu, takže v srpnu hlásila appka nízkou olši,
 * břízu i olivu — druhy, které tou dobou nekvetou a v Česku (oliva) ani
 * nerostou. Šest řádků se stejným slovem vypadá jako vymyšlená data
 * a alergik z toho nepozná to jediné, co ho zajímá: co dnes lítá.
 */
export function pollenLevel(species, value) {
  if (value == null || !Number.isFinite(value)) return null;
  const th = POLLEN_THRESHOLDS[species];
  if (!th) return null;
  if (value <= 0) return 'none';
  if (value < th[0]) return 'low';
  if (value < th[1]) return 'moderate';
  if (value < th[2]) return 'high';
  return 'veryHigh';
}

/* ============================================================
   SESTAVENÍ POHLEDU
   ============================================================ */

/**
 * @param {object} a
 * @param {object} a.forecast   odpověď /api/forecast
 * @param {object} [a.air]      odpověď /api/air
 * @param {string} a.lang
 * @param {object} a.units
 * @param {number} a.nowMs
 * @param {number} [a.hours=24]
 */
export function buildStationView(a) {
  // 🚨 48 hodin, ne 24. Data na sedm dní se stahují tak jako tak (jedno
  // volání), takže delší pruh nestojí ani dotaz navíc — a pilotovi, který
  // v pátek plánuje sobotní let, je čtyřiadvacet hodin k ničemu.
  // Víc než dva dny už po hodinách nikdo nečte; od toho je sedmidenní výhled.
  const { forecast, air, lang, units, nowMs, hours = 48 } = a;
  if (!forecast || !forecast.hourly) return null;

  const tz = forecast.timezone || 'UTC';
  const off = forecast.utc_offset_seconds || 0;
  const H = forecast.hourly;
  const D = forecast.daily || {};

  const hourMs = (H.time || []).map((s) => parseLocalTime(s, off));
  const sunrise = (D.sunrise || []).map((s) => parseLocalTime(s, off));
  const sunset = (D.sunset || []).map((s) => parseLocalTime(s, off));

  // Aktuální hodina = ta nejbližší, ne první v poli. Odpověď může začínat
  // půlnocí, i když je odpoledne.
  const iNow = nearestIndex(hourMs, nowMs);
  const day = isDaylight(nowMs, sunrise[0], sunset[0]);

  const cur = forecast.current || {};
  const code = pick(cur.weather_code, H.weather_code?.[iNow]);

  // Oblačnost po patrech. Nízká zakrývá, vysoká jen zastírá.
  const patra = {
    code,
    low: pick(cur.cloud_cover_low, H.cloud_cover_low?.[iNow]),
    mid: pick(cur.cloud_cover_mid, H.cloud_cover_mid?.[iNow]),
    high: pick(cur.cloud_cover_high, H.cloud_cover_high?.[iNow]),
  };

  return {
    timeZone: tz,

    current: {
      // 🚨 Patra oblačnosti rozhodují o SLOVĚ, ne o číslech. Zataženo jen
      // vysoko není zataženo — viz `jenZavoj()` a Michalova stížnost
      // z 27. 8. 2026, kdy appka psala „Zataženo" do slunečného večera.
      icon: weatherIconWithClouds(patra, day),
      condition: t(`weather.${weatherKeyWithClouds(patra)}`, lang),
      temp: formatTemp(pick(cur.temperature_2m, H.temperature_2m?.[iNow]), units, lang),
      feelsLike: formatTemp(pick(cur.apparent_temperature, H.apparent_temperature?.[iNow]), units, lang),
      wind: formatWind(pick(cur.wind_speed_10m, H.wind_speed_10m?.[iNow]), units, lang),
      windDir: dirText(pick(cur.wind_direction_10m, H.wind_direction_10m?.[iNow]), lang),
      windDirLong: dirLong(pick(cur.wind_direction_10m, H.wind_direction_10m?.[iNow]), lang),
      gusts: formatWind(pick(cur.wind_gusts_10m, H.wind_gusts_10m?.[iNow]), units, lang),
      humidity: pct(pick(cur.relative_humidity_2m, H.relative_humidity_2m?.[iNow]), lang),
      precip: formatPrecip(pick(cur.precipitation, H.precipitation?.[iNow]), units, lang),
      cloudCover: pct(pick(cur.cloud_cover, H.cloud_cover?.[iNow]), lang),
      uvIndex: numOrDash(H.uv_index?.[iNow], lang),
      updated: tf('now.updated', { time: formatClock(nowMs, tz, lang) }, lang),
      // ⚠️ Čísla, ne texty. Podle nich se rozhoduje (hlášky, prahy);
      // z „12,5 km/h" se počítat nedá.
      windKmh: pick(cur.wind_speed_10m, H.wind_speed_10m?.[iNow]) ?? null,
      windDirKey: windDirKey(pick(cur.wind_direction_10m, H.wind_direction_10m?.[iNow])) || '',
      gustKmh: pick(cur.wind_gusts_10m, H.wind_gusts_10m?.[iNow]) ?? null,
      tempC: pick(cur.temperature_2m, H.temperature_2m?.[iNow]) ?? null,
      cloudPct: pick(cur.cloud_cover, H.cloud_cover?.[iNow]) ?? null,
      precipMm: pick(cur.precipitation, H.precipitation?.[iNow]) ?? null,
      code,
      isDay: day,
    },

    // Fáze Měsíce se POČÍTÁ, nestahuje — je to astronomie, ne předpověď.
    // Nemá výpadky, nemá kvótu a nepotřebuje k tomu nikoho dalšího.
    moon: (() => {
      const f = moonPhase(nowMs);
      if (!f) return null;
      return {
        icon: f.ikona,
        label: t(`moonPhase.${f.klic}`, lang),
        // Osvětlení se zaokrouhluje na celá procenta — desetiny by
        // předstíraly přesnost, kterou střední synodický měsíc nemá.
        lit: pct(Math.round(f.osvetleni * 100), lang),
      };
    })(),

    sun: {
      sunrise: formatClock(sunrise[0], tz, lang),
      sunset: formatClock(sunset[0], tz, lang),
    },

    hourly: hourMs.slice(iNow, iNow + hours).map((ms, k) => {
      const i = iNow + k;
      const c = H.weather_code?.[i];
      // ⚠️ U dvoudenního pruhu musí být poznat, kde končí dnešek. Osmačtyřicet
      // stejných dlaždic s časy 0–23 a znovu 0–23 je bludiště: „v 8:00" se
      // pak dá číst jako dnes i zítra. Proto se první hodina nového dne
      // označí jménem dne.
      const denZacina = k > 0 && !stejnyDen(ms, hourMs[i - 1], off);
      return {
        timeMs: ms,
        time: formatClock(ms, tz, lang),
        // Zítřek se řekne slovem, další dny zkratkou — „Zítra" se čte líp než „Pá".
        dayLabel: denZacina
          ? (jeZitra(ms, hourMs[iNow], off) ? t('forecast.tomorrow', lang) : formatWeekday(ms, tz, lang))
          : '',
        icon: weatherIcon(c, isDaylight(ms, sunrise[0], sunset[0])),
        temp: formatTemp(H.temperature_2m?.[i], units, lang),
        precipProb: pct(H.precipitation_probability?.[i], lang),
        precip: formatPrecip(H.precipitation?.[i], units, lang),
      };
    }),

    daily: (D.time || []).map((s, i) => {
      const ms = parseLocalTime(s, off);
      return {
        timeMs: ms,
        // První dva dny se pojmenují slovem — „Dnes" se čte líp než „Pá".
        day: i === 0 ? t('forecast.today', lang)
           : i === 1 ? t('forecast.tomorrow', lang)
           : formatWeekday(ms, tz, lang),
        icon: weatherIcon(D.weather_code?.[i], true),
        hi: formatTemp(D.temperature_2m_max?.[i], units, lang),
        lo: formatTemp(D.temperature_2m_min?.[i], units, lang),
        precipProb: pct(D.precipitation_probability_max?.[i], lang),
      };
    }),

    pollen: buildPollen(air, lang),
    // Tři různé stavy, které se nesmí splést: něco lítá · nelítá nic ·
    // data nemáme. Bez toho by se karta v posledních dvou případech prostě
    // schovala a uživatel by nepoznal klid od výpadku.
    pollenStatus: pollenStatus(air),
  };
}

/**
 * @returns {'data'|'zadny'|'nedostupne'}
 */
function pollenStatus(air) {
  const cur = air?.current;
  if (!cur) return 'nedostupne';
  const hodnoty = POLLEN_SPECIES
    .map((s) => cur[`${s}_pollen`])
    .filter((v) => Number.isFinite(v));
  if (!hodnoty.length) return 'nedostupne';
  return hodnoty.some((v) => v > 0) ? 'data' : 'zadny';
}

function buildPollen(air, lang) {
  const cur = air?.current || {};
  const out = [];
  for (const species of POLLEN_SPECIES) {
    const value = cur[`${species}_pollen`];
    const level = pollenLevel(species, value);
    if (level === null) continue;                 // druh, který se tu neměří
    out.push({
      species,
      name: t(`pollen.${species}`, lang),
      level,
      levelText: t(`pollen.level.${level}`, lang),
      value,
    });
  }
  // Nejsilnější nahoru — kdo má alergii, chce to vidět hned. Nulové druhy
  // spadnou naspod: patří do výpisu (mlčet o nich by znamenalo, že uživatel
  // neví, jestli se neměří, nebo nelítají), ale nemají co překážet nahoře.
  const order = { veryHigh: 0, high: 1, moderate: 2, low: 3, none: 4 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}

/* ---------- drobné pomůcky ---------- */

/** První hodnota, která není null/undefined. Nula je platná hodnota! */
function pick(...values) {
  return values.find((v) => v != null && Number.isFinite(v)) ?? null;
}

function nearestIndex(list, target) {
  let best = 0, bestDiff = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = Math.abs(list[i] - target);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

function pct(value, lang) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(value)} %`;
}

function numOrDash(value, lang) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(value);
}

/** Plné jméno směru — do bubliny nad zkratkou. */
function dirLong(degrees, lang) {
  const key = windDirKey(degrees);
  return key ? t(`windDirLong.${key}`, lang) : "";
}

function dirText(degrees, lang) {
  const key = windDirKey(degrees);
  return key ? t(`windDir.${key}`, lang) : '—';
}

/** Parametry pro dotaz na předpověď — na jednom místě, ať se nerozejdou. */
/**
 * Jsou dva časy týž den v místním pásmu?
 *
 * ⚠️ Porovnává se v pásmu MÍSTA, ne prohlížeče. Kdo se dívá z Prahy na
 * počasí v Reykjavíku, potřebuje vědět, kdy tam začíná zítřek — ne kdy
 * začíná jemu.
 */
function stejnyDen(a, b, offsetS) {
  const den = (ms) => Math.floor((ms + offsetS * 1000) / 86400000);
  return den(a) === den(b);
}

/** Je ten čas o den dál než začátek pruhu? */
function jeZitra(ms, zacatek, offsetS) {
  const den = (x) => Math.floor((x + offsetS * 1000) / 86400000);
  return den(ms) - den(zacatek) === 1;
}

export const FORECAST_PARAMS = {
  current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover_low,cloud_cover_mid,cloud_cover_high',
  hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,uv_index,cloud_cover_low,cloud_cover_mid,cloud_cover_high',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
  timezone: 'auto',
  forecast_days: '7',
};

/** Parametry pro dotaz na pyl. */
export const AIR_PARAMS = {
  current: POLLEN_SPECIES.map((s) => `${s}_pollen`).join(','),
  timezone: 'auto',
};

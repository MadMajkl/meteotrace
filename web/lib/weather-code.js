/**
 * Kódy počasí WMO → klíč a ikona.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě.
 *
 * Open-Meteo vrací `weather_code` podle číselníku WMO 4677. Je jich přes
 * devadesát, ale pro uživatele jich dává smysl zhruba patnáct — nikoho
 * nezajímá rozdíl mezi „slabým mrholením“ a „mrholením mírné intenzity“,
 * zajímá ho, jestli si má vzít bundu.
 *
 * Vrací se KLÍČ, ne text. Překlad je věc jazyka (`R10`).
 *
 * ⚠️ Neznámý kód se NESMÍ tiše překlopit na „jasno“. Číselník se může
 * rozšířit a appka, která mlčky hlásí slunce, je horší než ta, co přizná,
 * že neví.
 */

'use strict';

/** Skupiny kódů → klíč. První shoda vyhrává. */
const GROUPS = [
  { key: 'clear',        codes: [0] },
  { key: 'mostlyClear',  codes: [1] },
  { key: 'partlyCloudy', codes: [2] },
  { key: 'overcast',     codes: [3] },
  { key: 'fog',          codes: [45, 48] },
  { key: 'drizzle',      codes: [51, 53, 55] },
  { key: 'freezingRain', codes: [56, 57, 66, 67] },
  { key: 'rain',         codes: [61, 63] },
  { key: 'heavyRain',    codes: [65] },
  { key: 'snow',         codes: [71, 73, 77] },
  { key: 'heavySnow',    codes: [75] },
  { key: 'rainShowers',  codes: [80, 81, 82] },
  { key: 'snowShowers',  codes: [85, 86] },
  { key: 'thunderstorm', codes: [95] },
  { key: 'hailstorm',    codes: [96, 99] },
];

/** Emoji pro den a pro noc. U jevů, kde na denní době nezáleží, je obojí stejné. */
const ICONS = {
  clear:        { day: '☀️', night: '🌙' },
  mostlyClear:  { day: '🌤️', night: '🌙' },
  partlyCloudy: { day: '⛅', night: '☁️' },
  overcast:     { day: '☁️', night: '☁️' },
  fog:          { day: '🌫️', night: '🌫️' },
  drizzle:      { day: '🌦️', night: '🌧️' },
  freezingRain: { day: '🌧️', night: '🌧️' },
  rain:         { day: '🌧️', night: '🌧️' },
  heavyRain:    { day: '🌧️', night: '🌧️' },
  snow:         { day: '🌨️', night: '🌨️' },
  heavySnow:    { day: '❄️', night: '❄️' },
  rainShowers:  { day: '🌦️', night: '🌧️' },
  snowShowers:  { day: '🌨️', night: '🌨️' },
  thunderstorm: { day: '⛈️', night: '⛈️' },
  hailstorm:    { day: '⛈️', night: '⛈️' },
  unknown:      { day: '❓', night: '❓' },
};

/**
 * Kód → klíč počasí.
 * @param {number} code
 * @returns {string} klíč, nebo 'unknown'
 */
export function weatherKey(code) {
  if (!Number.isInteger(code)) return 'unknown';
  const g = GROUPS.find((x) => x.codes.includes(code));
  return g ? g.key : 'unknown';
}

/**
 * Kód → emoji.
 * @param {number} code
 * @param {boolean} [isDay=true]
 */
export function weatherIcon(code, isDay = true) {
  const icons = ICONS[weatherKey(code)] || ICONS.unknown;
  return isDay ? icons.day : icons.night;
}

/**
 * Je to jev, na který se vyplatí upozornit na trase?
 *
 * Používá se při vyhodnocení trasy: bod s takovým počasím dostane výstrahu.
 * Mrznoucí déšť je tu schválně i při slabé intenzitě — náledí je nebezpečnější
 * než vydatný déšť, i když ho spadne míň.
 */
export function isHazard(code) {
  return ['freezingRain', 'heavySnow', 'snow', 'snowShowers',
          'thunderstorm', 'hailstorm', 'heavyRain', 'fog'].includes(weatherKey(code));
}

/** Všechny klíče — pro paritní test překladů, ať se na žádný nezapomene. */
export const WEATHER_KEYS = [...GROUPS.map((g) => g.key), 'unknown'];

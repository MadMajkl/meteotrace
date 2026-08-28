/**
 * Jednotky — převod a formátování.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 JEDNOTKY NEJSOU SOUČÁSTÍ JAZYKA (viz R10).
 *
 * Je svůdné navěsit stupně Fahrenheita na angličtinu a hotovo. Jenže:
 *   · Brit mluví anglicky a měří v °C, míle jezdí, ale vítr má v mph.
 *   · Čech na dovolené chce možná °F, aby rozuměl místní předpovědi.
 *   · Kanaďan mluví anglicky i francouzsky a měří metricky.
 * Proto je jazyk jedna osa a soustava jednotek druhá. Podle jazyka se dá
 * jen ODHADNOUT výchozí nastavení; poslední slovo má vždy uživatel.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** Výchozí (metrická) soustava. */
export const METRIC = { temp: 'c', wind: 'kmh', precip: 'mm', distance: 'km' };

/** Imperiální soustava — USA. */
export const IMPERIAL = { temp: 'f', wind: 'mph', precip: 'in', distance: 'mi' };

/** Britská směs: teplota metricky, vzdálenost a vítr imperiálně. */
export const UK_MIX = { temp: 'c', wind: 'mph', precip: 'mm', distance: 'mi' };

/**
 * Odhad výchozí soustavy podle oblasti.
 *
 * Bere se ZEMĚ, ne jazyk — `en-GB` a `en-US` mluví týmž jazykem a měří jinak.
 * Když země není známá, vyhrává metrická soustava: používá ji většina světa.
 *
 * @param {string} [locale]  např. 'en-US', 'cs-CZ', 'en'
 */
export function defaultUnits(locale = '') {
  const region = String(locale).split('-')[1]?.toUpperCase() || '';
  if (region === 'US') return { ...IMPERIAL };
  if (region === 'GB') return { ...UK_MIX };
  // Libérie a Myanmar jsou učebnicová výjimka; ostatní svět je metrický.
  if (region === 'LR' || region === 'MM') return { ...IMPERIAL };
  return { ...METRIC };
}

/* ============================================================
   PŘEVODY — vždy z metrické soustavy, protože v ní přicházejí data
   ============================================================ */

export const convert = {
  /** °C → cílová jednotka */
  temp(c, unit) {
    if (c == null || !Number.isFinite(c)) return null;
    return unit === 'f' ? c * 9 / 5 + 32 : c;
  },

  /** km/h → cílová jednotka */
  wind(kmh, unit) {
    if (kmh == null || !Number.isFinite(kmh)) return null;
    if (unit === 'ms') return kmh / 3.6;
    if (unit === 'mph') return kmh / 1.609344;
    return kmh;
  },

  /** mm → cílová jednotka */
  precip(mm, unit) {
    if (mm == null || !Number.isFinite(mm)) return null;
    return unit === 'in' ? mm / 25.4 : mm;
  },

  /**
   * metry nadmořské výšky → cílová jednotka
   *
   * ⚠️ Výška se NEŘÍDÍ jednotkou vzdálenosti. Kdo měří cestu v mílích,
   * čte výšku ve stopách, ne v mílích — proto vlastní převod.
   */
  elevation(m, unit) {
    if (m == null || !Number.isFinite(m)) return null;
    return unit === 'mi' ? m / 0.3048 : m;
  },

  /**
   * hektopascaly → cílová jednotka
   *
   * ⚠️ hPa a milibar jsou totéž číslo, jen jinak pojmenované. Palce
   * rtuťového sloupce (inHg) používají hlavně v USA — a v letectví,
   * takže na ně narazí i pilot v Evropě.
   */
  pressure(hpa, unit) {
    if (hpa == null || !Number.isFinite(hpa)) return null;
    return unit === 'inhg' ? hpa * 0.0295299830714 : hpa;
  },

  /** metry → cílová jednotka */
  distance(m, unit) {
    if (m == null || !Number.isFinite(m)) return null;
    return unit === 'mi' ? m / 1609.344 : m / 1000;
  },
};

/* ============================================================
   FORMÁTOVÁNÍ
   ============================================================ */

/** Značky jednotek. Nepřekládají se — jsou to mezinárodní symboly. */
export const SYMBOL = {
  c: '°C', f: '°F',
  kmh: 'km/h', ms: 'm/s', mph: 'mph',
  mm: 'mm', in: 'in',
  km: 'km', mi: 'mi',
  m: 'm', ft: 'ft',
  hpa: 'hPa', inhg: 'inHg',
};

/**
 * Číslo podle zvyklostí jazyka (desetinná čárka vs tečka, oddělovač tisíců).
 *
 * ⚠️ Formátování čísla se řídí JAZYKEM, hodnota jednotkou. Čech chce „21,5 °F“
 * s čárkou, ne „21.5 °F“ — proto se sem předává obojí zvlášť.
 */
function num(value, locale, digits) {
  return new Intl.NumberFormat(locale || 'en', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * @param {number|null} celsius
 * @param {object} units
 * @param {string} locale
 * @param {number} [digits=0]
 */
export function formatTemp(celsius, units, locale, digits = 0) {
  const v = convert.temp(celsius, units.temp);
  // Prázdná hodnota se NIKDY nemá tvářit jako nula — ta je v zimě věrohodná
  // a nikdo by si nevšiml, že data chybí.
  if (v == null) return '—';

  // „−0 °C" je matematicky správně, ale vypadá jako chyba v appce.
  // ⚠️ Zaokrouhlit se musí na TOLIK MÍST, KOLIK SE VYPÍŠE. Dřív se tu
  // kontrolovalo jedno desetinné místo napevno, jenže Intl pak zaokrouhlil
  // znovu na `digits` — a −0,2 °C se při nule desetinných míst vypsalo
  // jako „-0 °C". Odhalil to samotest.
  const factor = 10 ** digits;
  let rounded = Math.round(v * factor) / factor;
  if (rounded === 0) rounded = 0;          // −0 === 0, tímhle se znaménko zahodí

  return `${num(rounded, locale, digits)} ${SYMBOL[units.temp]}`;
}

export function formatWind(kmh, units, locale, digits = 0) {
  const v = convert.wind(kmh, units.wind);
  if (v == null) return '—';
  return `${num(v, locale, digits)} ${SYMBOL[units.wind]}`;
}

export function formatPrecip(mm, units, locale) {
  const v = convert.precip(mm, units.precip);
  if (v == null) return '—';
  // Palce potřebují dvě desetinná místa, jinak by slabý déšť vyšel jako 0.
  const digits = units.precip === 'in' ? 2 : 1;
  return `${num(v, locale, digits)} ${SYMBOL[units.precip]}`;
}

export function formatDistance(meters, units, locale) {
  const v = convert.distance(meters, units.distance);
  if (v == null) return '—';
  // Pod deset jednotek dává desetinné místo smysl, výš už je to šum.
  const digits = v < 10 ? 1 : 0;
  return `${num(v, locale, digits)} ${SYMBOL[units.distance]}`;
}

/** Trvání v minutách/hodinách, bez knihovny. */
export function formatDuration(seconds, locale, labels) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${num(m, locale, 0)} ${labels.min}`;
  if (m === 0) return `${num(h, locale, 0)} ${labels.hour}`;
  return `${num(h, locale, 0)} ${labels.hour} ${num(m, locale, 0)} ${labels.min}`;
}

/**
 * Směr větru na světovou stranu (16 dílků).
 * Vrací KLÍČ, ne text — překlad je věc jazyka.
 */
export function windDirKey(degrees) {
  if (degrees == null || !Number.isFinite(degrees)) return null;
  const dirs = ['n', 'nne', 'ne', 'ene', 'e', 'ese', 'se', 'sse',
                's', 'ssw', 'sw', 'wsw', 'w', 'wnw', 'nw', 'nnw'];
  // +11.25° posune hranici do středu dílku, takže 350° je sever, ne severoseverozápad.
  return dirs[Math.floor(((degrees % 360 + 360) % 360 + 11.25) / 22.5) % 16];
}

/**
 * Nadmořská výška.
 *
 * ⚠️ Zaokrouhluje se na celé, protože jemnější to není: výška se bere
 * z výškového modelu v mřížce, ne z měření na místě. Desetiny by
 * slibovaly přesnost, kterou ten údaj nemá.
 */
export function formatElevation(meters, units, locale) {
  const stopy = units.distance === 'mi';
  const v = convert.elevation(meters, stopy ? 'mi' : 'm');
  if (v == null) return '—';
  return `${num(v, locale, 0)} ${stopy ? SYMBOL.ft : SYMBOL.m}`;
}

/**
 * Tlak vzduchu.
 *
 * ⚠️ V hektopascalech celé číslo, v palcích rtuti na dvě desetiny —
 * jinak by inHg ztratilo rozlišení (celý obor počasí se vejde mezi
 * 28 a 31 inHg).
 */
export function formatPressure(hpa, units, locale) {
  const palce = units.temp === 'f';
  const v = convert.pressure(hpa, palce ? 'inhg' : 'hpa');
  if (v == null) return '—';
  return `${num(v, locale, palce ? 2 : 0)} ${palce ? SYMBOL.inhg : SYMBOL.hpa}`;
}
/**
 * Hlídaná cesta: „Domov → Plzeň, ve všední dny v 7:15" — a hodinu před
 * odjezdem upozornění, co čeká po cestě a kdy vyrazit líp (`R41`).
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě, bez `Date.now()`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ
 *
 * Miki 13. 10. 2026 vybral jako první „top pecku" z návrhů: počasí na trase
 * v čase průjezdu je to, čím se appka liší (`R8`) — jenže ho člověk musí
 * sám otevřít. Hlídaná cesta z něj dělá každodenní návyk. `R8` to odkládal
 * jako „notifikační pravidla ve v2 (moje cesta do práce)".
 *
 * ────────────────────────────────────────────────────────────────────────
 * ROZDĚLENÍ PRÁCE (jako ranní zpráva, `R28`)
 *
 *   · **appka** trasu JEDNOU spočítá a uloží z ní navzorkované body s časem
 *     od odjezdu ({@link vzorkyCesty}). Na pozadí se tak na router vůbec
 *     nesahá: kvóta openrouteservice je 2 000 dotazů denně pro všechny
 *     uživatele dohromady a ranní kontrola každé hlídané cesty by ji snědla.
 *   · **obal** hodinu před odjezdem pošle body serveru a zazvoní s hotovou
 *     větou. Nic nepočítá (`R13`).
 *   · **server** stáhne předpověď pro všechny body JEDNÍM dotazem, srovná
 *     odjezdy o půl hodiny dřív i později a složí větu ({@link textCesty}).
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { t, tf } from './i18n.js';
import { sampleRoute, durationToDistance, hourIndexFor } from './eta.js';
import { buildRouteView, compareDepartures, ROUTE_FORECAST_PARAMS } from './route-view.js';
import { asLocationList, hoursToMs } from './route-adapter.js';
import { formatTempRange, formatWind } from './units.js';
import { isUsablePoint } from './geo-query.js';
import { clock } from './when.js';

const MIN = 60000;
const DEN = 86400000;

/** Nejvýš tolik bodů. Víc by natáhlo adresu dotazu a nic by to nepřidalo. */
export const MAX_BODU = 24;

/**
 * Krok vzorkování. ⚠️ Jemnější než na obrazovce trasy (25 km): cesta do
 * práce mívá desítky kilometrů a s krokem 25 km by z ní zbyly tři body —
 * sněžení v půlce cesty by propadlo mezi ně.
 */
export const KROK_M = 10000;

/** O kolik minut před odjezdem se upozorní. Dost na to, aby šlo vyrazit dřív. */
export const PREDSTIH_MIN = 60;

/**
 * Srovnávané odjezdy. Kdo jezdí do práce, posune odjezd o čtvrt nebo půl
 * hodiny — o dvě hodiny ne. Dřív jen do chvíle upozornění: rada „vyraž
 * před deseti minutami" se nedá poslechnout.
 */
export const POSUNY_MIN = [-30, -15, 0, 15, 30];

/** Výchozí dny: pondělí až pátek (ISO: 1 = pondělí … 7 = neděle). */
export const DNY_VYCHOZI = [1, 2, 3, 4, 5];

/** Co se stahuje: tytéž veličiny jako na obrazovce trasy, na dva dny. */
export const CESTA_PARAMS = {
  hourly: ROUTE_FORECAST_PARAMS.hourly,
  timezone: 'auto',
  forecast_days: '2',
};

/* ── appka: z trasy body ──────────────────────────────────────────────── */

/**
 * Trasa (výstup `fromOpenRouteService` / `spojUseky`) → body s časem od
 * odjezdu. Čas se bere z rychlostního profilu trasy, ne úměrou — přesně
 * jako na obrazovce (`eta.js`).
 *
 * ⚠️ Dlouhá trasa by dala víc bodů než {@link MAX_BODU}; krok se pak
 * prodlouží, aby se vešla celá. Uříznout konec by znamenalo hlídat jen
 * půlku cesty a tvrdit, že je klid.
 *
 * @returns {Array<{lat:number, lon:number, s:number, m:number}>}
 */
export function vzorkyCesty(trasa, stepM = KROK_M) {
  if (!Array.isArray(trasa?.points) || trasa.points.length < 2) return [];
  const delka = Number(trasa.totalDistanceM) || 0;
  const krok = Math.max(stepM, Math.ceil(delka / (MAX_BODU - 1)));
  const profil = {
    totalDistanceM: trasa.totalDistanceM,
    totalDurationS: trasa.totalDurationS,
    legs: trasa.legs,
  };
  return sampleRoute(trasa.points, krok).slice(0, MAX_BODU).map((v) => ({
    lat: round4(v.point[0]),
    lon: round4(v.point[1]),
    s: Math.round(durationToDistance(v.distanceM, profil)),
    m: Math.round(v.distanceM),
  }));
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

/** Body do dotazu: `šířka,délka,sekundy,metry;…` */
export function bodyDoDotazu(vzorky) {
  return (vzorky || []).map((v) => `${round4(v.lat)},${round4(v.lon)},${Math.round(v.s)},${Math.round(v.m)}`).join(';');
}

/**
 * Body z dotazu. Vadný seznam → `null` CELÝ.
 *
 * 🚨 Vynechat jeden vadný bod by posunulo časy: bod by dostal počasí
 * v čase, kdy tam člověk nebude. Stejná úvaha jako u hlídaných míst
 * (`mistaZDotazu`).
 */
export function bodyZDotazu(text) {
  if (typeof text !== 'string' || !text) return null;
  const casti = text.split(';');
  if (casti.length < 2 || casti.length > MAX_BODU) return null;
  const out = [];
  for (const c of casti) {
    const [lat, lon, s, m] = c.split(',').map(Number);
    if (!isUsablePoint({ lat, lon })) return null;
    if (!Number.isFinite(s) || s < 0 || !Number.isFinite(m) || m < 0) return null;
    // Čas i vzdálenost po cestě rostou. Kdo jede pozpátku, má vadný seznam.
    const pred = out[out.length - 1];
    if (pred && (s < pred.s || m < pred.m)) return null;
    out.push({ lat, lon, s, m });
  }
  // Cesta delší než dva dny jízdy není cesta do práce, ale vadný seznam.
  if (out[out.length - 1].s > 2 * 86400) return null;
  return out;
}

/* ── server: z bodů a předpovědi věta ─────────────────────────────────── */

/**
 * Plán ve tvaru `planRoute()` z uložených bodů — aby na něj šly použít
 * tytéž funkce jako na obrazovce trasy (`buildRouteView`, `compareDepartures`).
 */
export function planZVzorku(vzorky, departureMs, hourMs) {
  const points = vzorky.map((v) => {
    const etaMs = departureMs + v.s * 1000;
    return {
      point: [v.lat, v.lon],
      distanceM: v.m,
      etaMs,
      hourIndex: hourMs ? hourIndexFor(etaMs, hourMs) : null,
    };
  });
  return {
    points,
    arrivalMs: departureMs + (vzorky[vzorky.length - 1]?.s || 0) * 1000,
    beyondForecast: !!hourMs && points.some((p) => p.hourIndex === null),
    estimated: false,
  };
}

/** Kolik dní předpovědi je potřeba: od dneška po příjezd nejpozdější varianty. */
export function dnyPredpovedi(vzorky, odjezdMs, nowMs) {
  const konec = odjezdMs + Math.max(...POSUNY_MIN) * MIN + (vzorky[vzorky.length - 1]?.s || 0) * 1000;
  return Math.min(16, Math.max(2, Math.ceil(Math.max(0, konec - nowMs) / DEN) + 1));
}

/**
 * Věta do upozornění.
 *
 * Tvar:
 *   · klid:      „Odjezd v 07:15: po celé cestě sucho, 4 až 7 °C."
 *   · déšť:      „Odjezd v 07:15: déšť na 3 z 6 míst po cestě, 4 až 7 °C."
 *   · nebezpečí: „Odjezd v 07:15: kolem 07:35 sněžení (−1 °C)."
 *   · + rada:    „ Vyjeď v 06:45 a mineš to."
 *
 * 🚨 Rada jen tehdy, když jiný odjezd OPRAVDU vychází líp — a dřívější jen
 * od chvíle upozornění dál. Rada, kterou nejde poslechnout, je šum.
 *
 * @param {object} a
 * @param {object|object[]} a.forecast   odpověď Open-Meteo pro body
 * @param {Array} a.vzorky
 * @param {number} a.odjezdMs
 * @param {number} a.nowMs
 * @param {string} a.lang
 * @param {object} a.units
 * @param {boolean} [a.jenHrozba]  `true` = při klidu mlčet
 * @param {number} [a.posunMin]  posun pásma TELEFONU (min od UTC); bez něj pásmo místa
 * @returns {{text: string|null, hrozba: boolean, lepsiMs: number|null, duvod?: string}}
 */
export function textCesty({ forecast, vzorky, odjezdMs, nowMs, lang = 'en', units, jenHrozba = false, posunMin }) {
  const nic = (duvod) => ({ text: null, hrozba: false, lepsiMs: null, duvod });
  const mista = asLocationList(forecast);
  if (!Array.isArray(vzorky) || vzorky.length < 2) return nic('chybí body cesty');
  if (mista.length !== vzorky.length) return nic('předpověď nesedí na body cesty');

  const hourMs = hoursToMs(mista[0]);
  // 🚨 Časy se píšou v pásmu TELEFONU, ne místa. Člověk si odjezd zadal
  // v hodinách svého telefonu — „Odjezd v 23:18" u cesty nastavené na 21:18
  // (telefon v jiném pásmu, emulátor 13. 10. 2026) by vypadalo jako chyba.
  // Bez údaje od obalu se bere pásmo místa (doma je to totéž).
  const posunS = jePosun(posunMin) ? posunMin * 60 : Number(mista[0]?.utc_offset_seconds) || 0;
  const cas = (ms) => clock(ms + posunS * 1000, 'UTC', lang);

  // Dřívější odjezd jen do chvíle „teď" (= upozornění), s rezervou na oblečení.
  const posuny = POSUNY_MIN.filter((o) => o >= 0 || odjezdMs + o * MIN >= nowMs + 5 * MIN);
  const options = posuny.map((offsetMin) => {
    const departureMs = odjezdMs + offsetMin * MIN;
    return { offsetMin, departureMs, plan: planZVzorku(vzorky, departureMs, hourMs) };
  });
  const srovnani = compareDepartures({ options, forecast: mista, lang, units });
  const zaklad = srovnani.options.find((o) => o.offsetMin === 0);
  if (!zaklad) return nic('odjezd je mimo předpověď');

  const znamo = zaklad.points.filter((p) => p.known);
  // 🚨 Bez předpovědi pro body se mlčí. „Po celé cestě sucho" o cestě,
  // o které nic nevíme, by byla lež.
  if (znamo.length < zaklad.points.length) return nic('část cesty je za obzorem předpovědi');

  const s = zaklad.summary;
  const hrozba = s.score > 0;
  if (!hrozba && jenHrozba) return { text: null, hrozba: false, lepsiMs: null, duvod: 'klid' };

  const teploty = znamo.map((p) => p.tempC).filter(Number.isFinite);
  const range = formatTempRange(Math.min(...teploty), Math.max(...teploty), units, lang, tf);
  const kdy = cas(odjezdMs);

  let text;
  if (s.hazardCount > 0 && s.worst) {
    const bod = znamo.find((p) => p.etaMs === s.worst.etaMs) || {};
    text = tf('routeWatch.hazard', {
      time: kdy, at: cas(s.worst.etaMs), what: s.worst.condition.toLowerCase(), temp: bod.temp,
    }, lang);
  } else if (s.hazardCount > 0) {
    // Nebezpečný jen vítr (≥ 60 km/h) — jev v pořadí závažnosti nemá.
    const naraz = Math.max(...znamo.map((p) => Math.max(p.windKmh || 0, p.gustKmh || 0)));
    text = tf('routeWatch.wind', { time: kdy, wind: formatWind(naraz, units, lang) }, lang);
  } else if (s.rainCount > 0) {
    text = tf('routeWatch.rain', { time: kdy, n: s.rainCount, total: s.total, range }, lang);
  } else {
    text = tf('routeWatch.calm', { time: kdy, range }, lang);
  }

  let lepsiMs = null;
  const best = srovnani.best;
  if (hrozba && srovnani.worthMoving && best && best.offsetMin !== 0 && best.summary.score < s.score) {
    lepsiMs = best.departureMs;
    text += tf(best.summary.score === 0 ? 'routeWatch.better' : 'routeWatch.betterPartly',
      { time: cas(best.departureMs) }, lang);
  }

  return { text, hrozba, lepsiMs };
}

/** Platný posun pásma v minutách: −14 h až +14 h. */
export function jePosun(min) {
  return Number.isInteger(min) && min >= -840 && min <= 840;
}

/* ── appka: kdy a jak se hlídá ────────────────────────────────────────── */

/** `"07:15"` → minuty od půlnoci, nebo `null`. */
export function minutyZCasu(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Nastavení hlídané cesty po očištění. Nesmysl → `null`.
 *
 * @returns {{cas: string, dny: number[], jen: boolean, body: string}|null}
 */
export function cistaCesta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (minutyZCasu(raw.cas) == null) return null;
  const dny = [...new Set((Array.isArray(raw.dny) ? raw.dny : []).map(Number))]
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((a, b) => a - b);
  if (!dny.length) return null;
  if (!bodyZDotazu(raw.body)) return null;
  return { cas: raw.cas.trim().padStart(5, '0'), dny, jen: raw.jen === true, body: raw.body };
}

/**
 * Hlídané cesty, které ještě existují. Smazaná trasa vypadne — hlídat
 * cestu, kterou si člověk vymazal, by bylo upozornění odnikud.
 *
 * @param {{routes: Array}} store
 * @param {Object<string, object>} cesty  klíč trasy → nastavení
 */
export function platneCesty(store, cesty) {
  const klice = new Set((store?.routes || []).map((r) => r.key));
  const out = {};
  for (const [klic, raw] of Object.entries(cesty || {})) {
    const c = cistaCesta(raw);
    if (c && klice.has(klic)) out[klic] = c;
  }
  return out;
}

/**
 * Dny jako krátký text: „Po–Pá", „každý den", „So, Ne", „Po, St, Pá".
 *
 * ⚠️ Souvislá řada se píše rozsahem — „Po, Út, St, Čt, Pá" je dlouhé
 * a na první pohled se v tom nevidí, že chybí víkend.
 */
export function dnyText(dny, lang = 'en') {
  const d = [...new Set(dny || [])].sort((a, b) => a - b);
  if (d.length === 7) return t('routeWatch.everyDay', lang);
  const jmeno = (n) => t(`routeWatch.day${n}`, lang);
  const souvisle = d.length >= 3 && d.every((n, i) => i === 0 || n === d[i - 1] + 1);
  if (souvisle) return `${jmeno(d[0])}–${jmeno(d[d.length - 1])}`;
  return d.map(jmeno).join(', ');
}

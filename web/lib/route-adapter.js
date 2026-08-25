/**
 * Převod odpovědi routeru na tvar, kterému rozumí ETA jádro.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TENHLE SOUBOR EXISTUJE
 *
 * ETA jádro (`eta.js`) schválně neví, kdo trasu spočítal — dostane polyline
 * a úseky ve tvaru `{distanceM, durationS}`. Znalost konkrétního routeru
 * je uzavřená sem, takže výměna poskytovatele (openrouteservice → vlastní
 * Valhalla, viz `R4`) je nový adaptér, ne zásah do jádra.
 *
 * 🚨 GEOJSON MÁ SOUŘADNICE V POŘADÍ [DÉLKA, ŠÍŘKA].
 *    Opačně, než je zvykem u map a než používá zbytek appky. Zaměněné
 *    pořadí je zákeřné, protože pro ČR (50 N, 14 E) obě čísla existují
 *    a výsledek vypadá věrohodně — trasa se jen nenápadně přesune do
 *    Indického oceánu. Prohození se dělá TADY a hlídá ho test.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { parseLocalTime } from './station.js';

/**
 * Odpověď openrouteservice (GeoJSON) → vstup pro `planRoute()`.
 *
 * @param {object} geojson
 * @returns {{points: Array<[number,number]>, totalDistanceM: number,
 *            totalDurationS: number, legs: Array<{distanceM:number,durationS:number}>}|null}
 */
export function fromOpenRouteService(geojson) {
  const feature = geojson?.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return null;

  // 🚨 [lon, lat] → [lat, lon]
  const points = coords
    .filter((c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([lon, lat]) => [lat, lon]);
  if (points.length === 0) return null;

  const props = feature.properties || {};
  const summary = props.summary || {};
  const segments = Array.isArray(props.segments) ? props.segments : [];

  // Rychlostní profil: kroky jsou jemnější než úseky, takže se berou přednostně.
  // Bez profilu by se čas počítal úměrou a půlka trasy by vyšla o desítky
  // minut vedle (viz eta.js).
  const legs = [];
  for (const seg of segments) {
    const steps = Array.isArray(seg.steps) ? seg.steps : [];
    if (steps.length) {
      for (const s of steps) legs.push({ distanceM: num(s.distance), durationS: num(s.duration) });
    } else {
      legs.push({ distanceM: num(seg.distance), durationS: num(seg.duration) });
    }
  }

  // Souhrn může chybět (některé varianty odpovědi) — dopočítej ze součtu úseků.
  const totalDistanceM = num(summary.distance) || legs.reduce((a, l) => a + l.distanceM, 0);
  const totalDurationS = num(summary.duration) || legs.reduce((a, l) => a + l.durationS, 0);

  return { points, totalDistanceM, totalDurationS, legs };
}

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * Souřadnice pro dotaz na routing: `lon,lat` — v pořadí, jaké chce ORS.
 * Vlastní funkce proto, aby se pořadí nepletlo na volání.
 */
export function toOrsCoord([lat, lon]) {
  return `${lon},${lat}`;
}

/**
 * Souřadnice bodů pro JEDEN dotaz na Open-Meteo.
 *
 * API bere čárkou oddělené seznamy — celá trasa se tak stáhne najednou
 * místo jednoho dotazu na bod. (Ověřeno naživo 21. 8. 2026.)
 *
 * ⚠️ Souřadnice se zaokrouhlují na čtyři desetinná místa (~11 m). Přesnější
 * čísla nemají pro předpověď smysl — modely mají rozlišení v kilometrech —
 * a zkrácením se z různých dotazů na tutéž trasu stane TÝŽ dotaz, takže
 * zabere cache na proxy.
 */
export function toForecastParams(samples) {
  return {
    latitude: samples.map((s) => round4(s.point[0])).join(','),
    longitude: samples.map((s) => round4(s.point[1])).join(','),
  };
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

/**
 * Open-Meteo vrací pro JEDEN bod objekt, pro VÍC bodů pole.
 * Sjednotí se to na pole, ať volající nemusí větvit.
 *
 * ⚠️ Past: trasa navzorkovaná na jediný bod (start = cíl) dostane objekt,
 * ne pole — a kód, který slepě volá `.map()`, spadne.
 */
/**
 * Časy hodin z předpovědi jako skutečné okamžiky (epoch ms).
 *
 * 🚨 Open-Meteo vrací čas **bez pásma** — `"2026-08-24T13:00"` je místní čas
 * daného bodu, ne UTC. Kdo ho nechá vyložit prohlížeči, dostane pásmo
 * ZAŘÍZENÍ: pro trasu do Španělska by se pak počasí přiřadilo o hodinu vedle
 * a nikde by to nebylo vidět, protože čísla by pořád vypadala rozumně.
 *
 * Posun je v odpovědi jako `utc_offset_seconds`.
 *
 * @param {object} location  jedno místo z odpovědi Open-Meteo
 * @returns {number[]} časy hodin, epoch ms
 */
export function hoursToMs(location) {
  const casy = location?.hourly?.time;
  if (!Array.isArray(casy)) return [];
  const posun = Number.isFinite(location.utc_offset_seconds) ? location.utc_offset_seconds : 0;
  return casy
    .map((t) => parseLocalTime(t, posun))
    .filter((ms) => Number.isFinite(ms));
}

export function asLocationList(forecast) {
  if (Array.isArray(forecast)) return forecast;
  if (forecast && typeof forecast === 'object') return [forecast];
  return [];
}

/**
 * Slepí několik úseků do jedné trasy.
 *
 * ⚠️ ČISTÁ FUNKCE.
 *
 * 🚨 PROČ TO VŮBEC JE. Mezibody („zastav se pro kamaráda") umí ORS jen přes
 * POST s tělem `coordinates: [...]`. Naše proxy ale **propouští jen GET**
 * (`R2`) — a to je bezpečnostní rozhodnutí, ne nedodělek: přes zápis by šlo
 * cizí službě něco měnit. Trasa se proto skládá z úseků: A→B, B→C, C→D.
 *
 * Cena: n+1 dotazů místo jednoho. U tří mezibodů to jsou čtyři volání
 * z 2 000 denních, a shodné úseky navíc padnou do cache proxy — cesta domů
 * přes tutéž benzínku se podruhé neptá.
 *
 * ⚠️ Spoj se NEDUPLIKUJE: konec jednoho úseku a začátek dalšího je týž bod.
 * Kdyby tam zůstal dvakrát, měl by plán o bod navíc a předpověď by se ptala
 * dvakrát na totéž místo.
 *
 * ⚠️ Rychlostní profil (`legs`) se skládá za sebou v pořadí úseků — na něm
 * stojí výpočet času příjezdu (`eta.js`), takže pořadí je podstatné.
 *
 * @param {Array<{points: Array, legs: Array, totalDistanceM: number, totalDurationS: number}>} casti
 * @returns {object|null} trasa téhož tvaru jako z {@link fromOpenRouteService}
 */
export function spojUseky(casti) {
  const platne = (casti || []).filter((c) => c && Array.isArray(c.points) && c.points.length);
  if (!platne.length) return null;
  if (platne.length === 1) return platne[0];

  const points = [];
  const legs = [];
  let totalDistanceM = 0;
  let totalDurationS = 0;

  for (const cast of platne) {
    const body = points.length && jeTotez(points[points.length - 1], cast.points[0])
      ? cast.points.slice(1)
      : cast.points;
    points.push(...body);
    legs.push(...(Array.isArray(cast.legs) ? cast.legs : []));
    totalDistanceM += Number(cast.totalDistanceM) || 0;
    totalDurationS += Number(cast.totalDurationS) || 0;
  }

  return { points, legs, totalDistanceM, totalDurationS };
}

/** Dva body na spoji úseků. Router vrací shodné souřadnice, ale zaokrouhlené jinak. */
function jeTotez(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

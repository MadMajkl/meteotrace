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
export function asLocationList(forecast) {
  if (Array.isArray(forecast)) return forecast;
  if (forecast && typeof forecast === 'object') return [forecast];
  return [];
}

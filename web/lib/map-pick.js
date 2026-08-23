/**
 * Výběr místa klepnutím do mapy.
 *
 * ⚠️ ČISTÝ MODUL. Žádné DOM, žádná mapa, žádná síť — dostane popisky, které
 * mapa vykreslila, a rozhodne, jak se má vybrané místo jmenovat.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ SE JMÉNO BERE Z NAŠICH DAT
 *
 * Klepnutí do mapy dá souřadnice, ne jméno. Nabízelo by se poslat je na
 * cizí službu (obrácené geokódování), jenže:
 *
 *   · byla by to další závislost a další klíč (`R0`),
 *   · byl by to další dotaz ven při každém klepnutí,
 *   · **a jméno už MÁME** — vlastní dlaždice nesou popisky sídel (`R3`),
 *     včetně české podoby.
 *
 * Vezme se tedy nejbližší popisek, který mapa právě kreslí. Když poblíž
 * žádný není (les, pole, cizina), použijí se souřadnice — což je poctivé:
 * appka neví, jak se to místo jmenuje, tak si nic nevymýšlí. Přejmenovat
 * si ho uživatel může ve správě uložených míst.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { distanceM } from './eta.js';

/**
 * Jak daleko od klepnutí se ještě smí vzít jméno sídla.
 *
 * ⚠️ Kdyby to bylo bez omezení, klepnutí doprostřed Šumavy by se pojmenovalo
 * podle města dvacet kilometrů daleko — a uživatel by si uložil „Klatovy",
 * přestože ukázal jinam. Radši souřadnice než nesprávné jméno.
 */
export const MAX_VZDALENOST_M = 4000;

/**
 * Nejbližší popisek k bodu, nebo `null`.
 *
 * @param {Array<{name: string, lat: number, lon: number}>} labels
 * @param {[number, number]} point  `[šířka, délka]`
 * @param {number} [maxM]
 */
export function nearestLabel(labels, point, maxM = MAX_VZDALENOST_M) {
  if (!Array.isArray(labels) || !Array.isArray(point)) return null;
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;

  let nej = null;
  let nejmensi = Infinity;
  for (const l of labels) {
    if (!l || typeof l.name !== 'string' || !l.name.trim()) continue;
    if (!Number.isFinite(l.lat) || !Number.isFinite(l.lon)) continue;
    const d = distanceM(point, [l.lat, l.lon]);
    if (d < nejmensi) {
      nejmensi = d;
      nej = l;
    }
  }
  return nej && nejmensi <= maxM ? { ...nej, distanceM: nejmensi } : null;
}

/**
 * Jméno ze souřadnic, když se žádné jiné nenabízí.
 *
 * Čtyři desetinná místa (~11 m) — stejná přesnost, s jakou se pracuje
 * jinde v appce. Víc by jen předstíralo přesnost, kterou klepnutí prstem
 * do mapy nemá.
 */
export function coordName(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/**
 * Složí místo z klepnutí do mapy.
 *
 * @param {[number, number]} point  `[šířka, délka]`
 * @param {Array<{name: string, lat: number, lon: number}>} [labels]
 * @returns {{name: string, lat: number, lon: number, country: null, fromMap: true}|null}
 */
export function placeFromMap(point, labels = []) {
  if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
  const [lat, lon] = point;
  const blizky = nearestLabel(labels, point);
  return {
    name: blizky ? blizky.name : coordName(lat, lon),
    // Země se z dlaždic nebere: popisek sídla ji nenese a hádat ji nebudeme.
    country: null,
    lat,
    lon,
    fromMap: true,
  };
}

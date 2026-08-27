/**
 * Sondy do okolí — kde nejblíž prší a kde nejblíž svítí.
 *
 * ⚠️ ČISTÝ MODUL. Jen počítá souřadnice a vybírá z hotových odpovědí; sám
 * nikam nesahá.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 PROČ TO VŮBEC JDE LEVNĚ
 *
 * Open-Meteo přijímá v JEDNOM dotazu čárkou oddělený seznam souřadnic.
 * Rozeseje se tedy kolem místa pravidelná síť sond a zeptá se na ně naráz —
 * jeden dotaz, ne čtyřiadvacet. A ptáme se jen na `current`, tedy pár čísel
 * na bod; hodinová pole by byla o dva řády víc dat.
 *
 * 🚨 A PROČ TO NENÍ RADAR
 *
 * Radarové dlaždice jsou obrázky. Číst z nich, kde prší, by znamenalo
 * dekódovat pixely a hádat, co která barva znamená. Model dá totéž číslem,
 * a to i tam, kde radar nedosvítí.
 *
 * ⚠️ Sondy jsou tedy MODEL, ne měření — v hlášce se proto mluví o tom, kde
 * se déšť očekává, ne kde „je".
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { distanceM } from './eta.js';

/** Poloměr Země v metrech (stejná hodnota jako v `eta.js`). */
const R = 6371000;

/** Osm směrů, po kterých se sondy rozesílají. */
const SMERY = [
  { klic: 'n', uhel: 0 },
  { klic: 'ne', uhel: 45 },
  { klic: 'e', uhel: 90 },
  { klic: 'se', uhel: 135 },
  { klic: 's', uhel: 180 },
  { klic: 'sw', uhel: 225 },
  { klic: 'w', uhel: 270 },
  { klic: 'nw', uhel: 315 },
];

/**
 * Vzdálenosti prstenců v kilometrech.
 *
 * ⚠️ Blízký prstenec musí být dost blízko, aby odpověď dávala smysl („dvacet
 * kilometrů" je jiná informace než „sto"), a vzdálený dost daleko, aby se
 * v běžný den vůbec něco našlo. Tři prstence stačí; čtvrtý by přidal osm
 * sond a skoro žádnou novou odpověď.
 */
export const PRSTENCE_KM = [25, 60, 120];

/**
 * Rozeseje sondy kolem místa.
 *
 * @param {[number, number]} stred  [šířka, délka]
 * @param {number[]} [prstence]     vzdálenosti v km
 * @returns {Array<{lat: number, lon: number, dirKey: string, distanceM: number}>}
 */
export function probePoints(stred, prstence = PRSTENCE_KM) {
  const [lat, lon] = stred || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const body = [];
  for (const km of prstence) {
    for (const smer of SMERY) {
      const b = posunuty(lat, lon, km * 1000, smer.uhel);
      body.push({ ...b, dirKey: smer.klic, distanceM: Math.round(km * 1000) });
    }
  }
  return body;
}

/**
 * Bod ve vzdálenosti a směru od zadaného.
 *
 * ⚠️ Počítá se po kouli, ne v rovině: sto kilometrů na východ je v Čechách
 * o půl stupně jinde než sto kilometrů na sever, a plochý výpočet by sondy
 * postupně vychýlil.
 */
function posunuty(lat, lon, metru, uhelStupnu) {
  const d = metru / R;
  const th = (uhelStupnu * Math.PI) / 180;
  const f1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;

  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(th));
  const l2 = l1 + Math.atan2(
    Math.sin(th) * Math.sin(d) * Math.cos(f1),
    Math.cos(d) - Math.sin(f1) * Math.sin(f2),
  );

  return {
    lat: Number(((f2 * 180) / Math.PI).toFixed(4)),
    lon: Number(((((l2 * 180) / Math.PI) + 540) % 360 - 180).toFixed(4)),
  };
}

/** Kódy počasí, které znamenají srážky (WMO). */
const SRAZKY = new Set([
  51, 53, 55, 56, 57, 61, 63, 65, 66, 67,
  71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99,
]);

/** Prší (nebo sněží) na tomhle bodě? */
export function jeSrazka(stav) {
  if (!stav) return false;
  if (SRAZKY.has(Number(stav.weather_code))) return true;
  return Number(stav.precipitation) > 0.1;
}

/** Je tady jasno nebo skoro jasno? */
export function jeJasno(stav) {
  const kod = Number(stav?.weather_code);
  return kod === 0 || kod === 1;
}

/**
 * Nejbližší sonda, která vyhovuje podmínce.
 *
 * ⚠️ Sondy chodí zpátky v TÉMŽE POŘADÍ, v jakém se posílaly — jinak by se
 * odpověď přiřadila cizímu bodu a appka by ukázala déšť na opačné straně.
 * Volající to musí zaručit; tady se jen kontroluje počet.
 *
 * @param {Array} sondy      výstup {@link probePoints}
 * @param {Array} odpovedi   stavy ve stejném pořadí
 * @param {(stav: object) => boolean} vyhovuje
 * @returns {{lat, lon, dirKey, distanceM, stav}|null}
 */
export function nearestProbe(sondy, odpovedi, vyhovuje) {
  if (!Array.isArray(sondy) || !Array.isArray(odpovedi)) return null;
  if (sondy.length !== odpovedi.length) return null;

  let nejlepsi = null;
  sondy.forEach((s, i) => {
    if (!vyhovuje(odpovedi[i])) return;
    if (!nejlepsi || s.distanceM < nejlepsi.distanceM) nejlepsi = { ...s, stav: odpovedi[i] };
  });
  return nejlepsi;
}

/**
 * Vzdálenost mezi místem a sondou podle skutečných souřadnic.
 *
 * Prstenec říká, na jakou vzdálenost byla sonda POSLÁNA; tohle říká, jak
 * daleko doopravdy leží. Liší se to o kousek kvůli zaokrouhlení souřadnic.
 */
export function probeDistanceM(stred, sonda) {
  if (!stred || !sonda) return null;
  return Math.round(distanceM(stred, [sonda.lat, sonda.lon]));
}

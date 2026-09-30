/**
 * Stavitelé historie počasí (`R35`) — jaké počasí na místě DOOPRAVDY bylo.
 *
 * Dvě služby nad archivem Open-Meteo (denní údaje od roku 1940):
 *
 * - `history` — denní údaje za období (nejvýš `MAX_DNI` dní),
 * - `climate` — roční přehled od roku 1940, sečtený TADY.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 PROČ SE ROKY SČÍTAJÍ NA SERVERU
 *
 * Zdroj váží dotaz podle DNÍ × VELIČIN. Všech 86 let po dnech je 31 000 dní
 * a 2,2 MB; jeden takový dotaz se vším vyčerpal minutový limit (změřeno
 * 30. 9. 2026) — a ten limit sdílí i PŘEDPOVĚĎ. Statistika nesmí umět
 * shodit počasí. Proto:
 *
 * 1. `climate` se ptá jen na dvě veličiny (teplota, srážky),
 * 2. po třech kusech, ať žádný není obří a ať to nečeká v řadě,
 * 3. klientovi jde 87 řádků, ne dva megabajty,
 * 4. souřadnice se zaokrouhlují na síť archivu (0,25°) a odpověď platí
 *    týden — celá Praha je jedna položka v mezipaměti.
 *
 * ⚠️ Logika (kontrola dotazu, sčítání) je v čisté `web/lib/stats.js`;
 * tady se jen stahuje.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import {
  checkHistoryQuery, yearlyFromDaily, roundCoord, isoDay, addDays, dayMs,
  HISTORY_DAILY, CLIMATE_DAILY, KROK_ROKY, ARCHIV_OD,
} from '../web/lib/stats.js';
import { isUsablePoint } from '../web/lib/geo-query.js';

/** Jak dlouho čekat na archiv. Roky jsou velké, proto víc než u předpovědi. */
const STROP_MS = 20_000;

const naObjekt = (params) => (params instanceof URLSearchParams
  ? Object.fromEntries(params.entries()) : (params || {}));

/** Jeden dotaz do archivu, se stropem. Stav chyby se nese dál (429 ≠ výpadek). */
async function zArchivu(fetchImpl, base, q) {
  const url = new URL(base);
  url.search = '';
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, String(v));

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), STROP_MS);
  try {
    const res = await fetchImpl(url.toString(), { signal: ac.signal });
    if (!res.ok) {
      const e = new Error(`archiv vrátil HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Denní údaje za období.
 *
 * @returns {Promise<{daily: object, elevation: number|null, from: string, to: string}>}
 */
export async function stavHistorii({ fetchImpl, base, nowMs, params }) {
  const dnes = isoDay(nowMs);
  const q = checkHistoryQuery(naObjekt(params), dnes);
  // Dnešek a zítřek (časová pásma) projdou kontrolou, ale v archivu nejsou.
  const to = dayMs(q.to) > dayMs(dnes) ? dnes : q.to;

  const data = await zArchivu(fetchImpl, base, {
    latitude: q.lat, longitude: q.lon,
    start_date: q.from, end_date: to,
    daily: HISTORY_DAILY.join(','),
    timezone: 'auto',
  });
  if (!data?.daily?.time) throw new Error('archiv nevrátil denní údaje');
  return {
    daily: data.daily,
    elevation: Number.isFinite(data.elevation) ? data.elevation : null,
    from: q.from,
    to,
  };
}

/**
 * Roční přehled od roku 1940.
 *
 * @returns {Promise<{years: Array, from: string, to: string}>}
 */
export async function stavKlima({ fetchImpl, base, nowMs, params }) {
  const p = naObjekt(params);
  const bod = { lat: Number(p.lat), lon: Number(p.lon) };
  if (!isUsablePoint(bod)) throw new Error('Chybí platné souřadnice (lat, lon).');

  const vcera = addDays(isoDay(nowMs), -1);
  // Tři kusy souběžně: žádný dotaz není obří a celé to netrvá třikrát déle.
  const kusy = [
    [ARCHIV_OD, '1969-12-31'],
    ['1970-01-01', '1999-12-31'],
    ['2000-01-01', vcera],
  ];
  const odpovedi = await Promise.all(kusy.map(([from, to]) => zArchivu(fetchImpl, base, {
    latitude: roundCoord(bod.lat, KROK_ROKY),
    longitude: roundCoord(bod.lon, KROK_ROKY),
    start_date: from, end_date: to,
    daily: CLIMATE_DAILY.join(','),
    timezone: 'auto',
  })));

  const spojene = { time: [], temperature_2m_mean: [], precipitation_sum: [] };
  for (const o of odpovedi) {
    if (!o?.daily?.time) throw new Error('archiv nevrátil denní údaje');
    for (const k of Object.keys(spojene)) spojene[k].push(...(o.daily[k] || []));
  }
  return { years: yearlyFromDaily(spojene), from: ARCHIV_OD, to: vcera };
}

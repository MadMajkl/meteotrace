/**
 * Stavitel věty pro hlídanou cestu (`R41`).
 *
 * Dostane navzorkované body cesty s časem od odjezdu (spočítala je appka,
 * když se hlídání zapínalo), stáhne pro ně předpověď JEDNÍM dotazem a vrátí
 * HOTOVOU VĚTU v jazyce appky. Skládá ji čistá `web/lib/route-watch.js`,
 * která má samotest — tady zbývá dotaz ven a převod parametrů.
 *
 * ⚠️ Na router se tu nesahá. Trasa se nepočítá znovu — kvóta
 * openrouteservice je společná všem a ranní kontroly by ji snědly.
 */

'use strict';

import { textCesty, bodyZDotazu, dnyPredpovedi, CESTA_PARAMS } from '../web/lib/route-watch.js';
import { METRIC, IMPERIAL, UK_MIX } from '../web/lib/units.js';

const SADY = { metric: METRIC, imperial: IMPERIAL, uk: UK_MIX };

/** Jak daleko dopředu smí odjezd být. Hlídaná cesta se ptá hodinu předem. */
const MAX_DOPREDU_MS = 2 * 86400000;

/**
 * @param {object} a
 * @param {Function} a.fetchImpl
 * @param {string} a.base        adresa z katalogu (Open-Meteo forecast)
 * @param {number} a.nowMs
 * @param {URLSearchParams|object} a.params   dotaz od obalu
 */
export async function stavCestu({ fetchImpl, base, nowMs, params, log = () => {} }) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});
  const vzorky = bodyZDotazu(p.get('body'));
  const odjezdMs = Number(p.get('odjezd'));
  const lang = p.get('lang') || 'en';
  const units = SADY[p.get('units') || 'metric'] || METRIC;
  const jenHrozba = p.get('jen') === '1';
  // Posun pásma telefonu v minutách — časy ve větě se píšou v něm.
  const posunMin = p.has('posun') ? Number(p.get('posun')) : undefined;

  const prazdno = (duvod) => {
    log('cesta: nemám co říct', { duvod });
    // ⚠️ Prázdná věta NENÍ chyba: obal ji pozná podle `text: null`
    // a nezazvoní. Chyba by znamenala opakování celého pokusu.
    return { text: null, duvod };
  };

  if (!vzorky) return prazdno('chybí nebo vadné body cesty');
  // 🚨 Odjezd v minulosti nebo za týden je vadný dotaz — věta by mluvila
  // o jiné cestě, než na kterou se člověk chystá.
  if (!Number.isFinite(odjezdMs) || odjezdMs < nowMs - 30 * 60000 || odjezdMs > nowMs + MAX_DOPREDU_MS) {
    return prazdno('odjezd mimo rozumný rozsah');
  }

  const url = new URL(base);
  url.search = '';
  url.searchParams.set('latitude', vzorky.map((v) => v.lat).join(','));
  url.searchParams.set('longitude', vzorky.map((v) => v.lon).join(','));
  for (const [k, v] of Object.entries(CESTA_PARAMS)) url.searchParams.set(k, v);
  url.searchParams.set('forecast_days', String(dnyPredpovedi(vzorky, odjezdMs, nowMs)));

  let data;
  try {
    const res = await fetchImpl(url.toString());
    if (!res.ok) return prazdno(`předpověď vrátila HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    return prazdno(`předpověď se nestáhla: ${e.message}`);
  }

  const vysledek = textCesty({ forecast: data, vzorky, odjezdMs, nowMs, lang, units, jenHrozba, posunMin });
  if (!vysledek.text) return prazdno(vysledek.duvod || 'nic k hlášení');
  return { text: vysledek.text, hrozba: vysledek.hrozba, lepsiMs: vysledek.lepsiMs };
}

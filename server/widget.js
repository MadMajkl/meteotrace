/**
 * Stavitel widgetu na ploše (`R29`).
 *
 * Stáhne předpověď pro jeden bod a vrátí HOTOVÝ OBSAH widgetu — řetězce
 * v jazyce appky a barvy oblohy. Skládá ho čistá `web/lib/widget.js` nad
 * `buildStationView()`, takže widget říká totéž co meteostanice.
 *
 * ⚠️ Obal jen kreslí (`R13`, `R17`, `R28`). Jméno místa sem nechodí — to
 * zná obal od webu a server k němu nic nepřidá.
 */

'use strict';

import { widgetModel, WIDGET_PARAMS } from '../web/lib/widget.js';
import { METRIC, IMPERIAL, UK_MIX } from '../web/lib/units.js';
import { isUsablePoint } from '../web/lib/geo-query.js';
import { LANG_NAMES } from '../web/lib/i18n.js';

/** Jednotky chodí jako jméno sady, ne jako rozepsaná trojice (jako u zprávy). */
const SADY = { metric: METRIC, imperial: IMPERIAL, uk: UK_MIX };

/**
 * @param {object} a
 * @param {Function} a.fetchImpl
 * @param {string} a.base        adresa z katalogu (Open-Meteo forecast)
 * @param {number} a.nowMs
 * @param {URLSearchParams|object} a.params   dotaz od obalu
 * @returns {Promise<object>}  obsah widgetu, nebo `{ widget: null, duvod }`
 */
export async function stavWidget({ fetchImpl, base, nowMs, params, log = () => {} }) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});
  const lat = Number(p.get('lat'));
  const lon = Number(p.get('lon'));
  // ⚠️ Neznámý jazyk spadne na referenční angličtinu, ne na prázdné klíče.
  const lang = LANG_NAMES[p.get('lang')] ? p.get('lang') : 'en';
  const units = SADY[p.get('units') || 'metric'] || METRIC;

  const prazdno = (duvod) => {
    log('widget: nemám co ukázat', { duvod });
    // ⚠️ `widget: null` NENÍ chyba: obal nechá poslední platný stav,
    // který nese čas, takže je vidět, jak je starý. Chyba by znamenala
    // opakovat pokus, a ten by dopadl stejně.
    return { widget: null, duvod };
  };

  // 🚨 NULOVÝ OSTROV, počtvrté v tomhle projektu. Bez souřadnic by `Number(null)`
  // dalo 0 a widget by ukazoval počasí z Guinejského zálivu (viz `R28`).
  if (!isUsablePoint({ lat, lon })) return prazdno('chybí nebo nepoužitelné souřadnice');

  const url = new URL(base);
  url.search = '';
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  for (const [k, v] of Object.entries(WIDGET_PARAMS)) url.searchParams.set(k, v);

  let data;
  try {
    const res = await fetchImpl(url.toString());
    if (!res.ok) return prazdno(`předpověď vrátila HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    return prazdno(`předpověď se nestáhla: ${e.message}`);
  }

  const widget = widgetModel({ forecast: data, lang, units, nowMs });
  if (!widget) return prazdno('předpověď nemá teplotu');
  return { widget };
}

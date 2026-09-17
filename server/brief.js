/**
 * Stavitel ranní a večerní zprávy (`R25`).
 *
 * Stáhne dvoudenní předpověď pro jeden bod a vrátí HOTOVOU VĚTU v jazyce
 * appky. Skládá ji čistá `web/lib/brief.js`, která má samotest — tady
 * zbývá jen dotaz ven a převod parametrů.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO SKLÁDÁ SERVER
 *
 * Obal má zůstat potrubím (`R13`). U výstrah se to osvědčilo (`R17`):
 * kdyby si text skládal sám, musel by znát kódy počasí, jednotky i jazyk —
 * tedy tři tabulky, které se při první opravě rozejdou s appkou. A poznalo
 * by se to až tím, že zpráva tvrdí něco jiného než obrazovka.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { briefText, BRIEF_PARAMS, KINDS } from '../web/lib/brief.js';
import { METRIC, IMPERIAL, UK_MIX } from '../web/lib/units.js';
import { isUsablePoint } from '../web/lib/geo-query.js';

/** Jednotky chodí jako jméno sady, ne jako rozepsaná trojice. */
const SADY = { metric: METRIC, imperial: IMPERIAL, uk: UK_MIX };

/**
 * @param {object} a
 * @param {Function} a.fetchImpl
 * @param {string} a.base        adresa z katalogu (Open-Meteo forecast)
 * @param {number} a.nowMs
 * @param {URLSearchParams|object} a.params   dotaz od appky
 */
export async function stavZpravu({ fetchImpl, base, nowMs, params, log = () => {} }) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});
  const lat = Number(p.get('lat'));
  const lon = Number(p.get('lon'));
  const kind = p.get('kind') || 'morning';
  const lang = p.get('lang') || 'en';
  const units = SADY[p.get('units') || 'metric'] || METRIC;

  const prazdno = (duvod) => {
    log('zpráva: nemám co říct', { duvod });
    // ⚠️ Prázdná zpráva NENÍ chyba: obal ji pozná podle `text: null`
    // a prostě nezazvoní. Chyba by znamenala opakování celého pokusu.
    return { text: null, duvod };
  };

  // 🚨 NULOVÝ OSTROV. `Number(null)` je 0 a `Number.isFinite(0)` je `true`,
  // takže dotaz BEZ souřadnic prošel jako platný bod — a appka vracela
  // počasí z Guinejského zálivu („Dnes 24 až 25 °C · Mrholení"). Chyceno
  // živým dotazem 17. 9. 2026, ne testem. `isUsablePoint` je táž kontrola,
  // kterou na to má appka.
  if (!isUsablePoint({ lat, lon })) return prazdno('chybí nebo nepoužitelné souřadnice');
  if (!KINDS.includes(kind)) return prazdno(`neznámý druh zprávy: ${kind}`);

  // ⚠️ Adresa se skládá tady, ne v katalogu: katalog drží ZDROJ (tu doménu),
  // ale sada parametrů pro zprávu je jiná než pro obrazovku.
  const url = new URL(base);
  url.search = '';
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  for (const [k, v] of Object.entries(BRIEF_PARAMS)) url.searchParams.set(k, v);

  let data;
  try {
    const res = await fetchImpl(url.toString());
    if (!res.ok) return prazdno(`předpověď vrátila HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    return prazdno(`předpověď se nestáhla: ${e.message}`);
  }

  const zprava = briefText({ forecast: data, kind, nowMs, lang, units });
  if (!zprava) return prazdno('předpověď na ten den nic neříká');

  return { text: zprava.text, den: zprava.den, kind: zprava.kind };
}

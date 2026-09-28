/**
 * Předstih při startu: počasí pro uložené místo vyrazí HNED se stránkou,
 * souběžně se stahováním appky, ne až po ní.
 *
 * Michal 28. 9. 2026: *„aby to bylo svižnější."* Proč a jak viz
 * `lib/forecast-query.js`; převzetí hotové odpovědi dělá `apiGet`.
 *
 * ⚠️ Načítá se `async` z hlavičky a táhne za sebou jen tři malé moduly bez
 * dalších závislostí. Cokoli těžšího sem nepatří — předstih by pak čekal na
 * tytéž moduly jako appka a nebyl by k ničemu.
 *
 * ⚠️ Když se nepovede (zakázané úložiště, žádné místo, výpadek sítě), nic
 * se neděje: appka se zeptá sama, jako dřív.
 */

import { prefetchApi } from './lib/api.js';
import { forecastQuery, startPlace, STORE_KEY } from './lib/forecast-query.js';

try {
  let ulozeno = null;
  try { ulozeno = localStorage.getItem(STORE_KEY); } catch { /* soukromé okno */ }
  const misto = startPlace(location.search, ulozeno);
  if (misto) prefetchApi('forecast', forecastQuery(misto), { priority: 'high' });
} catch { /* předstih je jen zrychlení, nikdy ne podmínka */ }

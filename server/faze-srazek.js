/**
 * Mrzne u místa? Teplota pro rozhodnutí „sníh, nebo déšť" (`R49`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ
 *
 * 26. 11. 2026 sněžilo v půlce Česka a hlídání srážek z radaru (`R42`)
 * mlčelo: práh je pro déšť a sníh se na radaru odráží mnohem slaběji
 * (`PRAH_SNEHU` v `web/lib/rain-watch.js`). Nižší práh ale nejde dát
 * všem: v dešti by hlásil mrholení. Rozhodnout musí teplota V MÍSTĚ.
 *
 * KDY SE PTÁ
 *
 * Jen u míst, ke kterým se aspoň slabé srážky blíží nebo u nich už padají
 * (`potrebujeFazi`). V suchu se ven nechodí vůbec. Na víc míst jeden
 * dotaz, výsledek se drží `TTL_S` — teplota se za půl hodiny o stupně
 * nemění a hlídání se ptá každých deset minut.
 *
 * 🚨 NEODPOVĚĎ NENÍ „NEMRZNE". Když zdroj selže, vrátí se pro místo
 * `null` a appka zůstane u deště jako dřív. Sníh naslepo netvrdí.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** Jak dlouho platí teplota pro místo. */
export const TTL_S = 30 * 60;

/** Zaokrouhlení polohy pro cache (~5 km): sousední místa sdílejí teplotu. */
const KROK = 0.05;

const zaokrouhli = (x) => (Math.round(x / KROK) * KROK).toFixed(2);

/** Klíč v cache proxy. ⚠️ Předpona, ať se nepotká s klíčem služby. */
export function klicFaze({ lat, lon }) {
  return `faze-srazek:${zaokrouhli(lat)},${zaokrouhli(lon)}`;
}

const cislo = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * @param {object} a
 * @param {Function} a.fetchImpl
 * @param {string} a.base          předpověď Open-Meteo (z katalogu, `forecast`)
 * @param {Array<{lat: number, lon: number}>} a.mista
 * @param {object} [a.cache]       cache proxy (`createCache`)
 * @param {Function} [a.log]
 * @returns {Promise<Array<{t?: number, tw?: number}|null>>}  ve stejném pořadí
 */
export async function fazeProMista({ fetchImpl, base, mista, cache, log = () => {} }) {
  const out = mista.map(() => null);
  const chybi = [];
  mista.forEach((m, i) => {
    const hit = cache?.get(klicFaze(m));
    if (hit && hit.fresh) out[i] = hit.value;
    else chybi.push(i);
  });
  if (!chybi.length) return out;

  const url = new URL(base);
  url.search = '';
  url.searchParams.set('latitude', chybi.map((i) => mista[i].lat.toFixed(4)).join(','));
  url.searchParams.set('longitude', chybi.map((i) => mista[i].lon.toFixed(4)).join(','));
  url.searchParams.set('current', 'temperature_2m,wet_bulb_temperature_2m');
  url.searchParams.set('timezone', 'GMT');

  try {
    const res = await fetchImpl(url.toString());
    if (!res.ok) {
      log('fáze srážek: teplota nepřišla', { status: res.status });
      return out;
    }
    const j = await res.json();
    // ⚠️ Na jedno místo vrací Open-Meteo objekt, na víc pole.
    const pole = Array.isArray(j) ? j : [j];
    chybi.forEach((i, k) => {
      const c = pole[k]?.current;
      const f = { t: cislo(c?.temperature_2m), tw: cislo(c?.wet_bulb_temperature_2m) };
      if (f.t === undefined && f.tw === undefined) return;
      out[i] = f;
      cache?.set(klicFaze(mista[i]), f, TTL_S);
    });
  } catch (e) {
    log('fáze srážek: teplota se nestáhla', { chyba: e.message });
  }
  return out;
}

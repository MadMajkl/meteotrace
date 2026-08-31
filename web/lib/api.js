/**
 * Klientská síťová vrstva.
 *
 * Jediné místo v appce, kde se volá `fetch`. Ne kvůli čistotě, ale proto, že
 * asynchronní dotazy mají tři vlastnosti, které se špatně řeší rozsypané:
 * ruší se, můžou dorazit v opačném pořadí a můžou selhat.
 *
 * ⚠️ Volá se VÝHRADNĚ vlastní `/api/…` (`R2`). Cizí doména se odsud nedá zavolat —
 * jméno služby je jediné, co jde předat.
 */

'use strict';

/**
 * Jeden dotaz na proxy.
 *
 * @param {string} service   jméno služby, např. 'forecast'
 * @param {object} [params]
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.subPath]
 * @returns {Promise<{data: any, stale: boolean, ageS: number}>}
 */
export async function apiGet(service, params = {}, opts = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== ''),
  ).toString();

  const path = `/api/${service}${opts.subPath ? '/' + opts.subPath : ''}`;
  const res = await fetch(qs ? `${path}?${qs}` : path, { signal: opts.signal });

  let data = null;
  try { data = await res.json(); } catch { /* prázdné nebo poškozené tělo */ }

  if (!res.ok) {
    // Chybu z proxy předej dál i s textem — „něco se pokazilo" nikomu nepomůže.
    const msg = data?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    // ⚠️ „Moc dotazů teď" a „vyčerpaný denní příděl" chodí obojí jako 429
    // a znamenají něco jiného: u prvního se čeká minutu, u druhého do zítřka.
    // Bez téhle značky by je obrazovka nedokázala rozeznat.
    err.kvota = data?.kvota === true;
    err.retryAfterS = Number(data?.retryAfterS) || Number(res.headers.get('Retry-After')) || 0;
    throw err;
  }

  return {
    data,
    // Proxy servíruje prošlá data, když cizí služba neodpoví. Musí to jít poznat,
    // jinak by se stará předpověď tvářila jako čerstvá.
    stale: res.headers.get('X-MeteoTrace-Stale') === '1',
    // Odpověď z náhradního zdroje. Ať se to dá říct nahlas — mlčky horší
    // výsledky vypadají jako rozbitá appka.
    zeZalohy: res.headers.get('X-MeteoTrace-Zaloha') === '1',
    ageS: Number(res.headers.get('Age') || 0),
  };
}

/**
 * Správce běžících dotazů.
 *
 * ⚠️ Uživatel, který třikrát přepíše cíl, spustí tři dotazy — a odpovědi můžou
 * dorazit v OPAČNÉM pořadí, takže by na obrazovce skončil výsledek toho
 * nejstaršího. Každý nový dotaz proto ten předchozí se stejným jménem zruší.
 */
export function createRequestGroup() {
  /** @type {Map<string, AbortController>} */
  const running = new Map();

  return {
    /**
     * @param {string} name  co se dotazuje ('station', 'search'…)
     * @param {(signal: AbortSignal) => Promise<any>} work
     */
    async run(name, work) {
      running.get(name)?.abort();
      const ac = new AbortController();
      running.set(name, ac);
      try {
        return await work(ac.signal);
      } finally {
        if (running.get(name) === ac) running.delete(name);
      }
    },

    /** Zrušené volání není chyba, kterou by měl uživatel vidět. */
    isAbort(e) {
      return e?.name === 'AbortError';
    },

    cancelAll() {
      for (const ac of running.values()) ac.abort();
      running.clear();
    },
  };
}

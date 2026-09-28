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

/** Adresa dotazu na proxy. Prázdné parametry se do ní nedostanou. */
function adresa(service, params = {}, opts = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== ''),
  ).toString();
  const path = `/api/${service}${opts.subPath ? '/' + opts.subPath : ''}`;
  return qs ? `${path}?${qs}` : path;
}

/* ── Předstih ────────────────────────────────────────────────────────────
   Dotaz, který odešel dřív, než o něj appka požádala (`start.js` — počasí
   pro uložené místo vyrazí souběžně se stahováním appky). `apiGet` si ho
   převezme, když se ptá na PŘESNĚ tutéž adresu.

   ⚠️ Převzít jde jen JEDNOU: tělo odpovědi se dá přečíst jen jednou, a druhý
   tazatel by dostal prázdno. Po převzetí se záznam maže.
   ⚠️ A jen ČERSTVÝ: kdyby appka o dotaz požádala až po minutě (dlouhé
   uvítání, karta na pozadí), zeptá se znovu — předpověď se nesmí
   podstrčit starší, než by přišla sama. */

/** Jak dlouho smí předem stažená odpověď čekat na převzetí. */
export const PREDSTIH_PLATNOST_MS = 30_000;

/** @type {Map<string, {promise: Promise<Response>, kdy: number}>} */
const predem = new Map();

/**
 * Pošle dotaz dřív, než o něj appka požádá. Chyby se tu nehlásí — když
 * předstih selže, `apiGet` dostane tutéž chybu, jako by se ptal sám.
 *
 * @param {string} service
 * @param {object} [params]
 * @param {{subPath?: string, priority?: string}} [opts]
 * @param {number} [nowMs]  kvůli testu
 */
export function prefetchApi(service, params = {}, opts = {}, nowMs = Date.now()) {
  const url = adresa(service, params, opts);
  if (predem.has(url)) return;
  const promise = fetch(url, opts.priority ? { priority: opts.priority } : {});
  // Nikdo převzatý nemusí být — ať nepřevzaté selhání nekončí v konzoli.
  promise.catch(() => {});
  predem.set(url, { promise, kdy: nowMs });
}

function prevezmi(url, nowMs = Date.now()) {
  const z = predem.get(url);
  if (!z) return null;
  predem.delete(url);
  return nowMs - z.kdy <= PREDSTIH_PLATNOST_MS ? z.promise : null;
}

/**
 * Předem odeslaný dotaz nemá `signal` appky. Když appka dotaz mezitím
 * zruší (přepnutí místa), musí to pro ni skončit `AbortError` stejně jako
 * u vlastního `fetch` — jinak by se dokreslilo předchozí místo.
 */
function sPrerusenim(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Zrušeno', 'AbortError'));
  return new Promise((res, rej) => {
    const zrus = () => rej(new DOMException('Zrušeno', 'AbortError'));
    signal.addEventListener('abort', zrus, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', zrus); res(v); },
      (e) => { signal.removeEventListener('abort', zrus); rej(e); },
    );
  });
}

/**
 * Jeden dotaz na proxy.
 *
 * @param {string} service   jméno služby, např. 'forecast'
 * @param {object} [params]
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.subPath]
 * @param {'high'|'low'|'auto'} [opts.priority]  přednost na síti (Fetch
 *   Priority). Když jde víc dotazů naráz, má dostat linku první to, co je
 *   na obrazovce nahoře. Prohlížeč, který to nezná, volbu tiše přeskočí.
 * @returns {Promise<{data: any, stale: boolean, ageS: number}>}
 */
export async function apiGet(service, params = {}, opts = {}) {
  const url = adresa(service, params, opts);
  const predem = prevezmi(url);
  const res = await (predem
    ? sPrerusenim(predem, opts.signal)
    : fetch(url, {
      signal: opts.signal,
      ...(opts.priority ? { priority: opts.priority } : {}),
    }));

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

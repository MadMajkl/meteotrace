/**
 * Cache s omezenou platností — a se záměrným podržením prošlých odpovědí.
 *
 * ⚠️ ČISTÝ MODUL. Žádné DOM, žádná síť. Hodiny se předávají zvenčí, takže se
 * stárnutí dá v testu prohnat za mikrosekundu místo čekání. Test, který spí,
 * je test, který se přestane pouštět.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ SE PROŠLÉ ZÁZNAMY NEZAHAZUJÍ HNED
 *
 * Když cizí služba zrovna neodpoví (výpadek, limit, špatná síť v autě),
 * je desetiminutová předpověď pořád nesrovnatelně lepší než chybová hláška.
 * Proto má každý záznam dvě hranice:
 *
 *   |── čerstvý ──|── prošlý, ale použitelný ──|── zapomenutý
 *   0            ttl                      ttl+stale
 *
 * V pásmu „prošlý" se záznam nepoužije sám od sebe — jen tehdy, když dotaz
 * ven selže. Volající se to dozví (`fresh: false`) a může to uživateli říct.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** Jak dlouho po vypršení se odpověď ještě drží pro případ výpadku (sekundy). */
export const DEFAULT_STALE_S = 6 * 3600;

/**
 * @param {object} [opts]
 * @param {() => number} [opts.now]        zdroj času v ms (pro testy)
 * @param {number} [opts.maxEntries]       strop počtu záznamů
 * @param {number} [opts.staleS]           jak dlouho držet prošlé
 */
export function createCache(opts = {}) {
  const now = opts.now || (() => Date.now());
  const maxEntries = opts.maxEntries || 300;
  const staleS = opts.staleS ?? DEFAULT_STALE_S;

  /** @type {Map<string, {value: any, storedMs: number, ttlS: number}>} */
  const map = new Map();

  /** Vyhodí, co je za hranicí použitelnosti. */
  function purge() {
    const t = now();
    for (const [key, e] of map) {
      if (t > e.storedMs + (e.ttlS + staleS) * 1000) map.delete(key);
    }
  }

  return {
    /**
     * @returns {{value: any, fresh: boolean, ageS: number}|null}
     */
    get(key) {
      const e = map.get(key);
      if (!e) return null;

      const ageMs = now() - e.storedMs;
      if (ageMs > (e.ttlS + staleS) * 1000) { map.delete(key); return null; }

      // Znovupoužití posune záznam na konec — při přetečení padne ten nejdéle
      // nepoužitý, ne ten nejdéle uložený. Trasa, na kterou se lidé ptají
      // pořád, tak v cache zůstane.
      map.delete(key);
      map.set(key, e);

      return { value: e.value, fresh: ageMs <= e.ttlS * 1000, ageS: Math.floor(ageMs / 1000) };
    },

    set(key, value, ttlS) {
      map.delete(key);
      map.set(key, { value, storedMs: now(), ttlS });
      purge();
      // Strop je pojistka proti růstu do nekonečna: v dlouho běžícím procesu
      // (vývojový server, WebView) by jinak cache rostla, dokud by nedošla paměť.
      while (map.size > maxEntries) map.delete(map.keys().next().value);
    },

    /** Jen pro testy a diagnostiku. */
    get size() { return map.size; },
    clear() { map.clear(); },
  };
}

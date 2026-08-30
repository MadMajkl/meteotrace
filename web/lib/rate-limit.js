/**
 * Omezovač dotazů — kolik toho smí jeden tazatel vytáhnout z cizí kvóty.
 *
 * ⚠️ ČISTÝ MODUL. Bez sítě, bez hodin (čas se předává), bez znalosti platformy.
 * Kdo je tazatel, rozhoduje obal — viz `clientIp` v `server/proxy.js`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO VŮBEC JE
 *
 * `meteotrace.com/api/…` je veřejná adresa a klíč k ORS je náš. Kdo tu adresu
 * zná, čerpá NAŠI kvótu (2 000 tras denně, 40 za minutu — `R4`). Na náhodné
 * `*.netlify.app` se to nikomu nechce hledat; na doméně, kterou má appka
 * napsanou v patičce, se to uhodne za vteřinu.
 * ────────────────────────────────────────────────────────────────────────
 *
 * 🚨 CO TENHLE MODUL NEUMÍ, A JE TŘEBA TO ŘÍCT NAHLAS.
 *
 * Netlify Functions jsou bez sdílené paměti a instance se recyklují, takže
 * počitadlo žije **v jedné instanci**. Deset instancí = deset nezávislých
 * počitadel. **Není to tedy globální strop a nesmí se za něj vydávat.**
 * Chrání to proti jednomu skriptu, který mlátí do adresy — což je ten případ,
 * který nastane — ale ne proti rozprostřenému útoku.
 *
 * Skutečný globální strop potřebuje sdílený stav (vlastní server, Blobs,
 * Redis). Proto je počitadlo **za rozhraním** (`createStore`): až sdílený
 * stav bude, vymění se úložiště a pravidla zůstanou (`R0`).
 *
 * 🚨 A DRUHÁ VĚC: OMEZUJÍ SE JEN DOTAZY, KTERÉ OPRAVDU JDOU VEN.
 * Trefa do cache nestojí kvótu nic, takže se nepočítá. Kdyby se počítala,
 * platil by uživatel za to, že se appka ptá na totéž — a to je přesně to
 * chování, které chceme.
 */

'use strict';

/**
 * Meze podle třídy služby.
 *
 * `zaIP` — kolik smí jeden tazatel. ⚠️ Musí být VELKORYSÉ: na mobilní síti
 * sedí za jednou adresou celá čtvrť (CGNAT), takže přísný strop by odstřihl
 * skutečné uživatele dřív než kohokoli jiného.
 *
 * `celkem` — strop pro celou instanci. Viz varování nahoře: není globální.
 */
export const LIMITY = {
  /**
   * Služby s naším klíčem k ORS: trasy a hledání. Tady se platí.
   *
   * 30 dotazů za minutu je asi desetkrát víc, než udělá člověk, který
   * intenzivně plánuje cestu — a pořád pod minutovým stropem ORS.
   */
  klic: {
    zaIP: { pocet: 30, oknoS: 60 },
    celkem: { pocet: 60, oknoS: 60 },
    denneZaIP: { pocet: 400, oknoS: 24 * 3600 },
  },

  /**
   * Zdroje zdarma (Open-Meteo, RainViewer, MeteoAlarm, ČHMÚ). Kvótu nepálí,
   * ale objem stojí přenos a cizí služby mají svoje férové užití.
   */
  volne: {
    zaIP: { pocet: 120, oknoS: 60 },
    celkem: { pocet: 600, oknoS: 60 },
  },
};

/**
 * Paměť počitadel.
 *
 * ⚠️ Počet klíčů je omezený schválně. Bez stropu by stačilo poslat dotazy
 * z tisíců adres a paměť instance by rostla, dokud by ji Netlify neshodil —
 * z ochrany by se stala nová zranitelnost.
 */
export function createStore({ maxKeys = 5000 } = {}) {
  const data = new Map();
  return {
    get: (k) => data.get(k),
    set(k, v) {
      // Nejstarší zápis vypadne. `Map` drží pořadí vkládání, takže stačí
      // sáhnout na první klíč — a smazané počitadlo znamená jen to, že
      // někdo dostane víc, ne že by se něco pokazilo.
      if (!data.has(k) && data.size >= maxKeys) data.delete(data.keys().next().value);
      data.set(k, v);
    },
    get size() { return data.size; },
    clear: () => data.clear(),
  };
}

/**
 * Klouzavé okno: aktuální okno plus poměrná část předchozího.
 *
 * ⚠️ Pevné okno má známou vadu — kdo pošle plný příděl na konci jedné minuty
 * a hned zase na začátku druhé, projde dvojnásobkem. Poměrný podíl toho
 * předchozího tuhle díru zavře a stojí jen dvě čísla na klíč.
 *
 * @returns {{ok: boolean, pouzito: number, retryAfterS: number}}
 */
function klouzave(store, key, limit, oknoMs, nowMs, zapsat) {
  const okno = Math.floor(nowMs / oknoMs);
  const stav = store.get(key);

  // Starší než dvě okna (a stejně tak zápis „z budoucnosti", když hodiny
  // couvnou) se bere jako prázdno — počítat se dá jen s tím, co navazuje.
  let predchozi = 0;
  let aktualni = 0;
  if (stav?.okno === okno) { predchozi = stav.predchozi; aktualni = stav.aktualni; }
  else if (stav?.okno === okno - 1) { predchozi = stav.aktualni; }

  const podil = (nowMs % oknoMs) / oknoMs;
  const pouzito = predchozi * (1 - podil) + aktualni;

  if (pouzito + 1 > limit) {
    // Za jak dlouho klesne odhad pod strop. Přibližně — a schválně nahoru,
    // aby „zkus to za X" nebylo dřív, než to má smysl.
    const zbyva = Math.ceil((1 - podil) * oknoMs / 1000);
    return { ok: false, pouzito, retryAfterS: Math.max(1, zbyva) };
  }

  if (zapsat) store.set(key, { okno, predchozi, aktualni: aktualni + 1 });
  return { ok: true, pouzito, retryAfterS: 0 };
}

/**
 * Omezovač.
 *
 * @param {object} [opts]
 * @param {ReturnType<createStore>} [opts.store]
 */
export function createLimiter({ store = createStore() } = {}) {
  return {
    store,

    /**
     * Smí tenhle dotaz ven?
     *
     * ⚠️ Všechna pravidla se nejdřív ZKONTROLUJÍ a teprve pak zapíšou. Kdyby
     * se zapisovalo průběžně, odmítnutý dotaz by si část přídělu ukousl —
     * a tazatel by se odmítáním sám hnal hlouběji do zákazu.
     *
     * @param {object} a
     * @param {string} a.trida   klíč do {@link LIMITY}
     * @param {string} a.ip      adresa tazatele; prázdná = neznámá
     * @param {number} a.nowMs
     * @returns {{ok: true} | {ok: false, pravidlo: string, retryAfterS: number}}
     */
    zkus({ trida, ip = '', nowMs }) {
      const pravidla = LIMITY[trida];
      if (!pravidla) return { ok: true };

      const kandidati = [];
      for (const [jmeno, mez] of Object.entries(pravidla)) {
        // ⚠️ Neznámou adresu nelze počítat po tazatelích — všichni by
        // sdíleli jedno počitadlo a stačilo by, aby jeden vyčerpal příděl,
        // a odstřihl by ostatní. Celkový strop platí i tak.
        if (jmeno !== 'celkem' && !ip) continue;
        const key = jmeno === 'celkem' ? `${trida}|*|${jmeno}` : `${trida}|${ip}|${jmeno}`;
        kandidati.push({ jmeno, key, mez });
      }

      for (const { jmeno, key, mez } of kandidati) {
        const v = klouzave(store, key, mez.pocet, mez.oknoS * 1000, nowMs, false);
        if (!v.ok) return { ok: false, pravidlo: jmeno, retryAfterS: v.retryAfterS };
      }

      for (const { key, mez } of kandidati) {
        klouzave(store, key, mez.pocet, mez.oknoS * 1000, nowMs, true);
      }
      return { ok: true };
    },
  };
}

/* ============================================================
   ODKUD DOTAZ PŘIŠEL
   ============================================================ */

/**
 * Adresy, ze kterých smí prohlížeč volat naši proxy.
 *
 * ⚠️ `Origin` posílá prohlížeč jen u dotazu na CIZÍ původ. Naše vlastní
 * stránka ho tedy neposílá vůbec — a chybějící `Origin` proto NENÍ důvod
 * odmítnout. Odmítá se jen ten, který tam je a je cizí: to je přesně případ,
 * kdy si někdo postavil vlastní web nad naší kvótou.
 *
 * 🚨 Proti skriptu mimo prohlížeč je tohle k ničemu — `curl` si hlavičku
 * napíše, jakou chce. Od toho je omezovač výš; tohle zavírá jinou branku.
 */
export function originPovolen(origin, povolene) {
  if (!origin) return true;
  let host;
  try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
  return povolene.some((p) => {
    const cisty = String(p).toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    return host === cisty || host === `www.${cisty}`;
  });
}

/**
 * Do které třídy služba patří.
 *
 * 🚨 Rozhoduje `needsKey`, ne jméno. Kdyby se třídy vypisovaly ručně, nová
 * služba s klíčem by se do seznamu zapomněla přidat — a mlčky by běžela bez
 * ochrany. Takhle je chráněná od chvíle, kdy se do katalogu zapíše.
 */
export function tridaSluzby(spec) {
  return spec?.needsKey ? 'klic' : 'volne';
}

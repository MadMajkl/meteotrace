/**
 * Obsluha proxy — jediné místo, které se opravdu dotýká sítě.
 *
 * Rozhodování dělá `web/lib/proxy-core.js` (čistý modul), tenhle soubor jen
 * provede plán: sáhne do cache, případně ven, uloží a poskládá odpověď.
 * Platformní obaly (Netlify Function, vývojový server, později Android
 * `PathHandler`) tuhle funkci jen volají — `R2`.
 *
 * ⚠️ `fetch` a hodiny se předávají zvenčí. Díky tomu jde celá obsluha
 * otestovat s PODVRŽENÝM upstreamem — bez sítě, bez čekání a i offline.
 * Vzor: mailniño testuje proti falešnému IMAP serveru na localhostu.
 */

'use strict';

import {
  planRequest, transformBody, filterByPlace, responseHeaders, errorBody, API_PREFIX,
} from '../web/lib/proxy-core.js';
import { findArea } from '../web/lib/orp.js';
import { createLimiter, originPovolen, tridaSluzby } from '../web/lib/rate-limit.js';
import { UPSTREAMS } from '../web/lib/upstreams.js';

/**
 * Vypadá odpověď hledání jako „nic jsme nenašli"?
 *
 * Prázdný výsledek není chyba — ale u hledání je k ničemu, takže když má
 * zdroj náhradu, stojí za to zeptat se i jí.
 */
function jeToPrazdneHledani(out) {
  return !!out && Array.isArray(out.results) && out.results.length === 0;
}

/** Kolik sekund se čeká na cizí službu, než to vzdáme. */
export const UPSTREAM_TIMEOUT_S = 12;

/**
 * 🚨 KRÁTKODOBÁ PAMĚŤ SELHÁNÍ.
 *
 * Bez ní jde po vyčerpání kvóty KAŽDÝ další dotaz znovu nejdřív na hlavní
 * zdroj a teprve po jeho odmítnutí na zálohu. Hledání se přitom volá při
 * psaní, takže se to sečte do zbytečné vteřiny na každé slovo — a chová se
 * to jako appka, která se „zadrhává".
 *
 * Když tedy hlavní zdroj selže a má zálohu, přeskočí se na chvíli rovnou.
 * Pět minut je kompromis: krátký výpadek se přejde bez povšimnutí, ale
 * obnovenou kvótu si appka všimne sama a nečeká na půlnoc.
 */
export const PAMET_VYPADKU_S = 5 * 60;

/**
 * 🚨 JAK DLOUHO PLATÍ ODPOVĚĎ ZE ZÁLOHY.
 *
 * Ukládá se pod klíčem HLAVNÍHO zdroje — jinak by se týž dotaz ptal pořád
 * dokola. Jenže platnost hlavního zdroje bývá dlouhá (u hledání 24 hodin,
 * města se nestěhují) a to by znamenalo, že po obnovení kvóty appka **ještě
 * celý den nabízí horší výsledek**, přestože už umí lepší.
 *
 * Odpověď ze zálohy proto platí krátce. Je to náhradní řešení, ne stav.
 */
export const PLATNOST_ZALOHY_S = 10 * 60;

/**
 * Kdy se smí zase zkusit hlavní zdroj. Klíč je jméno služby.
 *
 * ⚠️ Žije to v paměti procesu, takže po restartu (a na Netlify po recyklaci
 * instance) se paměť ztratí. To je v pořádku: nejhorší, co se stane, je jeden
 * zbytečný dotaz navíc — nikdy ne špatná odpověď.
 */
const vypadky = new Map();

/**
 * Omezovač sdílený instancí. Sahá se na něj až ve chvíli, kdy by se šlo ven —
 * viz `web/lib/rate-limit.js`.
 */
const omezovac = createLimiter();

/** Jen pro testy: zapomenout, co se kdy pokazilo. */
export function zapomenVypadky() {
  vypadky.clear();
  omezovac.store.clear();
}

/**
 * Odkud smí prohlížeč volat proxy.
 *
 * ⚠️ Bere se z prostředí, ne z kódu: na náhledovém nasazení Netlify má
 * stránka jinou adresu než na ostré doméně a napevno zapsaný seznam by tam
 * appku umlčel. `SITE_URL` nastavuje Netlify sám.
 */
function povoleneOrigins(env = {}) {
  const seznam = ['meteotrace.com', 'localhost:8099', 'appassets.androidplatform.net'];
  for (const klic of ['SITE_URL', 'URL', 'DEPLOY_PRIME_URL']) {
    if (env[klic]) seznam.push(env[klic]);
  }
  return seznam;
}

/**
 * @param {object} req
 * @param {string} req.pathname
 * @param {Record<string,string>|URLSearchParams} [req.params]
 * @param {string} [req.method]
 * @param {Record<string,string>} [req.env]
 * @param {object} deps
 * @param {object} deps.cache            z `createCache()`
 * @param {Array} [deps.areas]           rozbalené hranice ORP pro výběr výstrah podle polohy
 * @param {() => number} [deps.now]      hodiny (kvůli testu), výchozí `Date.now`
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {(msg: string, detail?: object) => void} [deps.log]
 * @returns {Promise<{status: number, headers: object, body: any}>}
 */
/**
 * Odpověď, kterou proxy skládá sama — bez cizí služby.
 *
 * 🚨 Jméno místa ze souřadnic. Zkusilo se to opačným hledáním u Pelias/ORS
 * a změřilo se, že to nestačí: na venkovský bod vrátí číslo popisné
 * („Jezerce 23") a z územních polí jen kraj. Vlastní hranice ORP dají to,
 * co se hodí do věty — jméno města, pod které bod spadá.
 *
 * ⚠️ Hranice nemusí být po ruce (ořezané nasazení, nezapojený obal). Pak se
 * vrátí `nazev: null`, ne výmluva — volající si s tím poradí a napíše větu
 * bez jména. Zamlčet se to ale nesmí: od toho je `pokryto`.
 */
function mistniOdpoved(service, params, deps) {
  if (service !== 'place') return null;

  const lat = Number(params.lat);
  const lon = Number(params.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { nazev: null, kraj: null, pokryto: false };
  }

  const areas = deps.areas || [];
  if (!areas.length) return { nazev: null, kraj: null, pokryto: false };

  const misto = findArea([lat, lon], areas);
  return {
    nazev: misto ? misto.nazev : null,
    kraj: misto ? misto.kraj : null,
    // Hranice byly k dispozici a bod do žádné nespadl — je to cizina,
    // ne nevědomost. To je jiná odpověď a musí jít poznat.
    pokryto: true,
  };
}

export async function serveProxy(req, deps) {
  const { cache } = deps;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const log = deps.log || (() => {});

  const plan = planRequest(req);
  if (!plan.ok) {
    log('dotaz odmítnut', { pathname: req.pathname, status: plan.status, duvod: plan.error });
    return { status: plan.status, headers: responseHeaders({ ttlS: 0 }), body: errorBody(plan.status, plan.error) };
  }

  // Cizí stránka nad naší kvótou. ⚠️ Chybějící `Origin` se NEODMÍTÁ — naše
  // vlastní stránka ho neposílá (je to týž původ) a appka v obalu taky ne.
  if (!originPovolen(req.origin, povoleneOrigins(req.env))) {
    log('cizí původ odmítnut', { origin: req.origin, service: plan.service });
    return {
      status: 403,
      headers: responseHeaders({ ttlS: 0 }),
      body: errorBody(403, 'Tahle proxy obsluhuje jen MeteoTrace.'),
    };
  }

  // Zahozené parametry nejsou chyba, ale musí být vidět. Tiché zahazování je
  // nejhorší druh chyby: volající dostane odpověď, jen jinou, než čekal.
  if (plan.dropped.length) {
    log('zahozené parametry', { service: plan.service, dropped: plan.dropped });
  }

  const params = normalizeParams(req.params);

  // Výřez podle polohy se dělá až za cache — v cache leží odpověď společná
  // všem. Viz `filterByPlace()`.
  const proMisto = (value) => filterByPlace(plan.service, value, params, { areas: deps.areas, nowMs: (deps.now || Date.now)() });

  // 1) Čerstvé v cache → hotovo, ven se nechodí.
  const hit = cache.get(plan.cacheKey);
  if (hit && hit.fresh) {
    log('cache: čerstvé', { key: plan.cacheKey });
    return { status: 200, headers: responseHeaders({ ttlS: plan.ttlS }), body: proMisto(hit.value) };
  }

  // 1b) Místní služba: odpověď si skládáme sami, ven se nechodí vůbec.
  if (plan.localOnly) {
    const telo = mistniOdpoved(plan.service, params, deps);
    cache.set(plan.cacheKey, telo, plan.ttlS);
    log('místní odpověď', { service: plan.service, key: plan.cacheKey });
    return { status: 200, headers: responseHeaders({ ttlS: plan.ttlS }), body: telo };
  }

  // 1c) 🚨 AŽ TEĎ SE OMEZUJE. Nad tímhle řádkem se ven nechodí (čerstvá cache,
  //     místní odpověď), takže tam dotaz nic nestojí a počítat ho by znamenalo
  //     trestat uživatele za to, že se appka ptá na totéž. Viz `rate-limit.js`.
  const trida = tridaSluzby(UPSTREAMS[plan.service]);
  const mez = omezovac.zkus({ trida, ip: req.clientIp || '', nowMs: (deps.now || Date.now)() });
  if (!mez.ok) {
    log('omezeno', { service: plan.service, trida, pravidlo: mez.pravidlo, ip: req.clientIp });
    // ⚠️ Prošlá odpověď je pořád lepší než odmítnutí. Kdo narazil na strop
    // a máme pro něj něco v cache, dostane to — se značkou, že to není
    // čerstvé. Odmítnutí si necháme na případ, kdy nemáme co nabídnout.
    if (hit) {
      return {
        status: 200,
        headers: responseHeaders({ ttlS: plan.ttlS, fresh: false, ageS: hit.ageS }),
        body: proMisto(hit.value),
      };
    }
    return {
      status: 429,
      headers: { ...responseHeaders({ ttlS: 0 }), 'Retry-After': String(mez.retryAfterS) },
      body: { ...errorBody(429, 'Moc dotazů naráz. Zkus to za chvíli.'), retryAfterS: mez.retryAfterS },
    };
  }

  // 2) Ven.
  try {
    let body;
    let pouzity = plan;
    const ted = (deps.now || Date.now)();

    // Hlavní zdroj se před chvílí pokazil a má zálohu → nezdržuj se s ním.
    // Viz `PAMET_VYPADKU_S`.
    const prescasu = vypadky.get(plan.service) || 0;
    const preskocit = plan.fallback && prescasu > ted;

    if (preskocit) {
      const zaloha = planRequest({ ...req, pathname: API_PREFIX + plan.fallback });
      if (zaloha.ok) {
        log('hlavní zdroj je od nedávna mimo, jdu rovnou na zálohu', {
          service: plan.service, zaloha: plan.fallback, zbyvaS: Math.round((prescasu - ted) / 1000),
        });
        pouzity = zaloha;
        body = await fetchUpstream(fetchImpl, zaloha);
      }
    }

    // Služba se stavitelem si odpověď skládá sama — víc dotazů, archiv,
    // vlastní tvar. Cache, platnost i záloha při výpadku se na ni ale
    // vztahují stejně jako na kohokoli jiného.
    if (plan.builder) {
      const stavitel = deps.builders?.[plan.builder];
      if (!stavitel) throw new Error(`Chybí stavitel ${plan.builder} pro službu ${plan.service}.`);
      body = await stavitel({ fetchImpl, base: plan.url, nowMs: ted, log });
    } else if (pouzity === plan) {
      try {
        body = await fetchUpstream(fetchImpl, plan);
        // Odpověděl → paměť selhání je neplatná. Zapomenout hned, ne čekat,
        // až vyprší: obnovená kvóta má být znát okamžitě.
        vypadky.delete(plan.service);
      } catch (e) {
        // 🚨 Hlavní zdroj selhal — vyčerpaná kvóta, výpadek, chybějící klíč.
        // Když má náhradu, zkusí se. Hledání, které přestane fungovat v půlce
        // měsíce, je horší než hledání s horšími výsledky.
        if (!plan.fallback) throw e;
        log('hlavní zdroj selhal, beru zálohu', {
          service: plan.service, zaloha: plan.fallback, chyba: e.message,
        });
        const zaloha = planRequest({ ...req, pathname: API_PREFIX + plan.fallback });
        if (!zaloha.ok) throw e;
        vypadky.set(plan.service, ted + PAMET_VYPADKU_S * 1000);
        pouzity = zaloha;
        body = await fetchUpstream(fetchImpl, zaloha);
      }
    }

    let out = transformBody(pouzity.service, body, params);
    let zeZalohy = pouzity !== plan;

    // ⚠️ Zkusit zálohu i tehdy, když hlavní zdroj odpověděl, ale nic nenašel.
    // Podmínka `pouzity === plan` je tu proto, aby se to nezacyklilo — ze
    // zálohy se na zálohu nechodí.
    if (pouzity === plan && plan.fallback && jeToPrazdneHledani(out)) {
      const zaloha = planRequest({ ...req, pathname: API_PREFIX + plan.fallback });
      if (zaloha.ok) {
        try {
          const jine = transformBody(zaloha.service, await fetchUpstream(fetchImpl, zaloha), params);
          if (!jeToPrazdneHledani(jine)) {
            log('hlavní zdroj nic nenašel, pomohla záloha', { service: plan.service });
            out = jine;
            zeZalohy = true;
          }
        } catch (e) {
          // Záloha taky nevyšla. Vrací se prázdno z hlavního zdroje — to je
          // pořád lepší než chyba, protože „nic jsme nenašli" je platná odpověď.
          log('záloha taky selhala', { chyba: e.message });
        }
      }
    }
    // ⚠️ Odpověď ze zálohy se ukládá pod klíčem hlavního zdroje (jinak by se
    // týž dotaz ptal pořád dokola), ale na KRATŠÍ dobu — viz `PLATNOST_ZALOHY_S`.
    const platnostS = zeZalohy ? Math.min(plan.ttlS, PLATNOST_ZALOHY_S) : plan.ttlS;

    cache.set(plan.cacheKey, out, platnostS);
    log('staženo', { service: pouzity.service, key: plan.cacheKey, zeZalohy });
    return {
      status: 200,
      headers: responseHeaders({ ttlS: platnostS, zeZalohy }),
      body: proMisto(out),
    };
  } catch (e) {
    // 3) Nepovedlo se. Máme-li prošlou odpověď, je nesrovnatelně lepší než chyba —
    //    desetiminutová předpověď v autě na špatném signálu pořád poslouží.
    //    Klient se o tom dozví z hlavičky, takže to nikoho neoklame.
    if (hit) {
      log('upstream selhal, servíruji prošlé', { service: plan.service, ageS: hit.ageS, chyba: e.message });
      return {
        status: 200,
        headers: responseHeaders({ ttlS: plan.ttlS, fresh: false, ageS: hit.ageS }),
        body: proMisto(hit.value),
      };
    }
    // 🚨 Vyčerpaná kvóta NENÍ výpadek. Cizí služba odpověděla, a to zcela
    // správně — jen jsme na dnešek vybrali svůj příděl (`R4`). Kdyby se to
    // zabalilo do „zdroj neodpověděl", vypadalo by to jako cizí porucha
    // a hledalo by se to na špatné straně. Stav 429 se proto propouští ven.
    if (e.status === 429) {
      log('kvóta u zdroje vyčerpána', { service: plan.service });
      return {
        status: 429,
        headers: responseHeaders({ ttlS: 0 }),
        body: { ...errorBody(429, `Denní příděl u zdroje ${plan.service} je vyčerpaný.`), kvota: true },
      };
    }
    log('upstream selhal a není co nabídnout', { service: plan.service, chyba: e.message });
    return {
      status: 502,
      headers: responseHeaders({ ttlS: 0 }),
      body: errorBody(502, `Zdroj ${plan.service} neodpověděl: ${e.message}`),
    };
  }
}

/** Jedno volání ven, s časovým stropem. */
async function fetchUpstream(fetchImpl, plan) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_S * 1000);
  try {
    const res = await fetchImpl(plan.url, { headers: plan.headers, signal: ac.signal });
    if (!res.ok) {
      // ⚠️ Stav se nese s chybou dál. Bez něj je „vyčerpaná kvóta" k nerozeznání
      // od „služba spadla" — a to jsou dvě různé zprávy pro uživatele: jedna
      // znamená „zkus to zítra", druhá „zkus to za minutu".
      const e = new Error(`HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeParams(params) {
  if (!params) return {};
  if (params instanceof URLSearchParams) return Object.fromEntries(params.entries());
  return params;
}

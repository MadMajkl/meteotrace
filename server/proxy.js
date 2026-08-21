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

import { planRequest, transformBody, responseHeaders, errorBody } from '../web/lib/proxy-core.js';

/** Kolik sekund se čeká na cizí službu, než to vzdáme. */
export const UPSTREAM_TIMEOUT_S = 12;

/**
 * @param {object} req
 * @param {string} req.pathname
 * @param {Record<string,string>|URLSearchParams} [req.params]
 * @param {string} [req.method]
 * @param {Record<string,string>} [req.env]
 * @param {object} deps
 * @param {object} deps.cache            z `createCache()`
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {(msg: string, detail?: object) => void} [deps.log]
 * @returns {Promise<{status: number, headers: object, body: any}>}
 */
export async function serveProxy(req, deps) {
  const { cache } = deps;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const log = deps.log || (() => {});

  const plan = planRequest(req);
  if (!plan.ok) {
    log('dotaz odmítnut', { pathname: req.pathname, status: plan.status, duvod: plan.error });
    return { status: plan.status, headers: responseHeaders({ ttlS: 0 }), body: errorBody(plan.status, plan.error) };
  }

  // Zahozené parametry nejsou chyba, ale musí být vidět. Tiché zahazování je
  // nejhorší druh chyby: volající dostane odpověď, jen jinou, než čekal.
  if (plan.dropped.length) {
    log('zahozené parametry', { service: plan.service, dropped: plan.dropped });
  }

  const params = normalizeParams(req.params);

  // 1) Čerstvé v cache → hotovo, ven se nechodí.
  const hit = cache.get(plan.cacheKey);
  if (hit && hit.fresh) {
    log('cache: čerstvé', { key: plan.cacheKey });
    return { status: 200, headers: responseHeaders({ ttlS: plan.ttlS }), body: hit.value };
  }

  // 2) Ven.
  try {
    const body = await fetchUpstream(fetchImpl, plan);
    const out = transformBody(plan.service, body, params);
    cache.set(plan.cacheKey, out, plan.ttlS);
    log('staženo', { service: plan.service, key: plan.cacheKey });
    return { status: 200, headers: responseHeaders({ ttlS: plan.ttlS }), body: out };
  } catch (e) {
    // 3) Nepovedlo se. Máme-li prošlou odpověď, je nesrovnatelně lepší než chyba —
    //    desetiminutová předpověď v autě na špatném signálu pořád poslouží.
    //    Klient se o tom dozví z hlavičky, takže to nikoho neoklame.
    if (hit) {
      log('upstream selhal, servíruji prošlé', { service: plan.service, ageS: hit.ageS, chyba: e.message });
      return {
        status: 200,
        headers: responseHeaders({ ttlS: plan.ttlS, fresh: false, ageS: hit.ageS }),
        body: hit.value,
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

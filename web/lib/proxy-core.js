/**
 * Rozhodovací část proxy — co se má s dotazem stát.
 *
 * ⚠️ ČISTÝ MODUL. Nic nestahuje, nic neukládá. Dostane popis dotazu a vrátí
 * PLÁN: kam se má sáhnout, s jakými hlavičkami, pod jakým klíčem to uložit
 * a jak odpověď upravit. Vlastní `fetch` dělá až platformní obal — na Netlify
 * jeden, ve WebView druhý (`R2`).
 *
 * Díky tomu se dá celá logika proxy — včetně bezpečnostních pravidel —
 * otestovat bez sítě a bez serveru.
 */

'use strict';

import { isKnownService, buildUrl, upstreamHeaders, cacheKey, ttlFor, trimWarnings } from './upstreams.js';

/** Předpona, pod kterou proxy poslouchá. */
export const API_PREFIX = '/api/';

/**
 * Rozebere cestu `/api/<služba>[/<dovětek>]`.
 *
 * Vrací `null` u čehokoli, co tomu tvaru neodpovídá — včetně hlubších cest.
 * ⚠️ Víc než jeden dovětek se odmítá schválně: každý další segment je další
 * příležitost, jak se pokusit vylézt z domény služby jinam.
 *
 * @param {string} pathname
 * @returns {{service: string, subPath: string}|null}
 */
export function parseApiPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(API_PREFIX)) return null;

  const rest = pathname.slice(API_PREFIX.length);
  if (!rest) return null;

  const parts = rest.split('/').filter((p) => p !== '');
  if (parts.length === 0 || parts.length > 2) return null;

  return { service: parts[0], subPath: parts[1] || '' };
}

/**
 * Sestaví plán dotazu, nebo popíše, proč to nejde.
 *
 * @param {object} req
 * @param {string} req.pathname
 * @param {Record<string,string>|URLSearchParams} [req.params]
 * @param {string} [req.method]
 * @param {Record<string,string>} [req.env]
 * @returns {{ok: true, service: string, url: string, headers: object, cacheKey: string, ttlS: number, dropped: string[]}
 *         | {ok: false, status: number, error: string}}
 */
export function planRequest(req) {
  const { pathname, params = {}, method = 'GET', env = {} } = req;

  // Proxy propouští jen čtení. Zápis by znamenal, že přes nás jde cizí službě
  // něco měnit — nic takového nepotřebujeme a nechceme to mít otevřené.
  if (method !== 'GET' && method !== 'HEAD') {
    return { ok: false, status: 405, error: 'Povolené je jen GET.' };
  }

  const parsed = parseApiPath(pathname);
  if (!parsed) return { ok: false, status: 404, error: 'Neznámá cesta.' };

  const { service, subPath } = parsed;
  if (!isKnownService(service)) {
    return { ok: false, status: 404, error: `Neznámá služba: ${service}` };
  }

  try {
    return {
      ok: true,
      service,
      url: buildUrl(service, params, subPath),
      headers: upstreamHeaders(service, env),
      cacheKey: cacheKey(service, params, subPath),
      ttlS: ttlFor(service),
      dropped: droppedOf(service, params),
    };
  } catch (e) {
    // Chybějící klíč je chyba NAŠEHO nasazení, ne uživatelova dotazu → 500.
    // Nepřípustný dovětek cesty je naopak vadný dotaz → 400.
    const isConfig = /klíč/i.test(e.message);
    return { ok: false, status: isConfig ? 500 : 400, error: e.message };
  }
}

/** Pomocná: co se z dotazu zahodilo (kvůli logu, ne kvůli chybě). */
function droppedOf(service, params) {
  const entries = params instanceof URLSearchParams
    ? [...params.keys()] : Object.keys(params || {});
  const url = buildUrl(service, params, '');
  return entries.filter((k) => !url.includes(`${encodeURIComponent(k)}=`));
}

/**
 * Úprava odpovědi před odesláním klientovi.
 *
 * Zatím jediný případ: výstrahy se ořežou (feed má přes 1 MB, na mobilní data
 * je to moc). Ostatní služby se propouštějí beze změny — proxy má být tenká.
 *
 * @param {string} service
 * @param {any} body  rozparsovaná odpověď
 * @param {Record<string,string>} [params]
 */
export function transformBody(service, body, params = {}) {
  if (service === 'warnings') {
    const lang = (params.lang || params.language || 'cs').slice(0, 2);
    return { warnings: trimWarnings(body, lang) };
  }
  return body;
}

/**
 * Hlavičky odpovědi pro klienta.
 *
 * `s-maxage` míří na CDN Netlify, `max-age` na prohlížeč. `stale-while-revalidate`
 * dovolí ukázat starší odpověď a načíst novou na pozadí — pro appku, která se
 * otevírá v autě na špatném signálu, je to znát.
 *
 * @param {object} a
 * @param {number} a.ttlS
 * @param {boolean} [a.fresh]  false = servíruje se prošlá odpověď z cache
 * @param {number} [a.ageS]
 */
export function responseHeaders({ ttlS, fresh = true, ageS = 0 }) {
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': `public, max-age=${ttlS}, s-maxage=${ttlS}, stale-while-revalidate=${ttlS * 4}`,
  };
  if (!fresh) {
    // Ať je na klientovi i v logu poznat, že tohle není čerstvé — jinak by se
    // stará data tvářila jako nová a nikdo by si výpadku nevšiml.
    h['X-MeteoTrace-Stale'] = '1';
    h['Age'] = String(ageS);
  }
  return h;
}

/** Tělo chybové odpovědi. Vždy JSON, ať klient nemusí hádat podle stavu. */
export function errorBody(status, message) {
  return { error: message, status };
}

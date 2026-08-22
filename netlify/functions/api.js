/**
 * Netlify Function — webová polovina proxy (`R2`).
 *
 * Tenká slupka: rozebere požadavek, předá ho `serveProxy()` a odpověď pošle zpět.
 * Veškerá logika i bezpečnostní pravidla leží ve sdílených modulech, aby byla
 * společná s vývojovým serverem i s budoucím `PathHandler`em ve WebView.
 *
 * ⚠️ `ORS_API_KEY` se nastavuje v prostředí Netlify, NIKDY v repu.
 */

import { serveProxy } from '../../server/proxy.js';
import { createCache } from '../../web/lib/ttl-cache.js';
import { unpackAreas } from '../../web/lib/orp.js';
import { ORP_DATA } from '../../web/data/orp-boundaries.js';

/**
 * Cache přežije jen mezi dotazy, které trefí tutéž instanci funkce.
 * Netlify instance recykluje, takže je to bonus, ne jistota — proto se
 * spoléhá hlavně na `Cache-Control` a CDN. Ale i tak ušetří: nárazová
 * špička obvykle spadne do jedné instance, a právě špička prorazí
 * minutový limit ORS (40/min, viz R4).
 */
const cache = createCache({ maxEntries: 200 });

/**
 * Hranice ORP se rozbalí jednou při studeném startu (~5 ms) a instance si je
 * drží. Kdyby se rozbalovaly při každém dotazu, platilo by se to zbytečně
 * pokaždé — a je to čistý výpočet, který se mezi dotazy nemění.
 */
const areas = unpackAreas(ORP_DATA);

export default async function handler(request) {
  const url = new URL(request.url);

  const { status, headers, body } = await serveProxy({
    // Netlify posílá cestu včetně /api/ díky přesměrování v netlify.toml
    pathname: url.pathname,
    params: url.searchParams,
    method: request.method,
    env: process.env,
  }, {
    cache,
    areas,
    log: (msg, detail) => console.log(`[proxy] ${msg}`, detail ? JSON.stringify(detail) : ''),
  });

  return new Response(JSON.stringify(body), { status, headers });
}

export const config = { path: '/api/*' };

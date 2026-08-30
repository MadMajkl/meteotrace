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
import { stavNowcast } from '../../server/chmi-nowcast.js';
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
    // 🚨 ADRESU BERE JEN Z HLAVIČKY, KTEROU PÍŠE NETLIFY.
    // `x-forwarded-for` si napíše kdokoli — kdyby se omezovač řídil jí,
    // stačilo by ji u každého dotazu obměnit a ochrana by neexistovala.
    // Vypadala by přitom, že funguje, protože v testu i v prohlížeči by
    // se chovala správně. `x-nf-client-connection-ip` doplňuje až Netlify
    // a klient ji přepsat nemůže.
    clientIp: request.headers.get('x-nf-client-connection-ip') || '',
    origin: request.headers.get('origin') || '',
  }, {
    cache,
    areas,
    // Služby, které si odpověď skládají samy (víc dotazů, archiv).
    builders: { chmiNowcast: stavNowcast },
    log: (msg, detail) => console.log(`[proxy] ${msg}`, detail ? JSON.stringify(detail) : ''),
  });

  return new Response(JSON.stringify(body), { status, headers });
}

export const config = { path: '/api/*' };

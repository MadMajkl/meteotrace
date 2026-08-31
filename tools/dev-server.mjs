/**
 * Vývojový server — appka, testy a proxy na jednom portu.
 *
 * Spuštění (z kořene repa):   npm run dev
 * Ukončení:                   Ctrl+C
 *
 *   /            → web/          (samotná appka)
 *   /test/…      → test/         (měřič plynulosti mapy a spol.)
 *   /api/…       → proxy         (tatáž obsluha jako na Netlify, viz R2)
 *
 * Používá jen vestavěné moduly Node — žádné závislosti, nic k instalaci.
 *
 * ⚠️ Tohle NENÍ produkční server. Nemá HTTPS ani omezení počtu dotazů;
 *    je určený pro vývoj a pro měření na telefonu v domácí síti.
 */

import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

import { serveProxy } from '../server/proxy.js';
import { stavNowcast } from '../server/chmi-nowcast.js';
import { stavVystrahy } from '../server/chmi-warnings.js';
import { createCache } from '../web/lib/ttl-cache.js';
import { unpackAreas } from '../web/lib/orp.js';
import { ORP_DATA } from '../web/data/orp-boundaries.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = Number(process.env.PORT) || 8099;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pmtiles': 'application/octet-stream',
};

const cache = createCache({ maxEntries: 300 });
const areas = unpackAreas(ORP_DATA);

/** Vyřeší URL na soubor: /test/… míří do test/, zbytek do web/. */
function resolveFile(pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const base = rel.startsWith('/test/') ? ROOT : join(ROOT, 'web');
  const path = normalize(join(base, rel.startsWith('/test/') ? rel : rel));
  // Normalizovaná cesta musí zůstat uvnitř repa — pojistka proti ../
  return path.startsWith(normalize(ROOT)) ? path : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // ── proxy ──────────────────────────────────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    const { status, headers, body } = await serveProxy({
      pathname: url.pathname,
      params: url.searchParams,
      method: req.method,
      env: process.env,
      // Adresa přímo ze spojení — na vývojovém serveru není žádný předřazený
      // proxy, takže se nemá kde vzít podvržená hlavička. Viz Netlify Function,
      // kde je to naopak to jediné, na co se dá spolehnout.
      clientIp: req.socket?.remoteAddress || '',
      origin: req.headers.origin || '',
    }, {
      cache,
      areas,
      // Služby, které si odpověď skládají samy (víc dotazů, archiv).
      builders: { chmiNowcast: stavNowcast, chmiWarnings: stavVystrahy },
      log: (msg, detail) => console.log(`  [proxy] ${msg}`, detail ? JSON.stringify(detail) : ''),
    });
    res.writeHead(status, headers).end(JSON.stringify(body, null, 2));
    return;
  }

  // ── soubory ────────────────────────────────────────────────────────
  try {
    const path = resolveFile(decodeURIComponent(url.pathname));
    if (!path) { res.writeHead(403).end('Zakázáno'); return; }

    const info = await stat(path);
    if (!info.isFile()) { res.writeHead(404).end('Nenalezeno'); return; }

    const typ = MIME[extname(path).toLowerCase()] || 'application/octet-stream';
    const spolecne = {
      'Content-Type': typ,
      // Bez cache, ať telefon po úpravě souboru nedrží starou verzi.
      'Cache-Control': 'no-store',
      // ⚠️ Bez tohohle si prohlížeč o výřez ani neřekne a .pmtiles nepojede:
      // celý archiv má gigabajty a čte se po kouskách, ne najednou (R3).
      'Accept-Ranges': 'bytes',
    };

    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const [, odText, doText] = range;
      // Tvar "bytes=-500" znamená posledních 500 bajtů, ne "od nuly do 500".
      const od = odText === '' ? Math.max(0, info.size - Number(doText)) : Number(odText);
      const doByte = odText === '' || doText === ''
        ? info.size - 1
        : Math.min(Number(doText), info.size - 1);

      if (od >= info.size || od > doByte) {
        res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
        return;
      }
      res.writeHead(206, {
        ...spolecne,
        'Content-Range': `bytes ${od}-${doByte}/${info.size}`,
        'Content-Length': doByte - od + 1,
      });
      createReadStream(path, { start: od, end: doByte }).pipe(res);
      return;
    }

    // ⚠️ Čte se PROUDEM, ne do paměti. Podkladová mapa má 1,4 GB a načíst si ji
    // celou do paměti kvůli jednomu dotazu by server složilo.
    res.writeHead(200, { ...spolecne, 'Content-Length': info.size });
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404).end('Nenalezeno');
  }
});

// ⚠️ Bez uvedené adresy poslouchá Node na `::` v režimu dual-stack, tedy na
// IPv6 I na IPv4 zároveň. S natvrdo zadaným '0.0.0.0' to byla jen IPv4 —
// a prohlížeč si `localhost` přeloží podle RFC 6724 přednostně na `::1`,
// takže appka na localhostu odmítala spojení, přestože server běžel.
server.listen(PORT, () => {
  const addrs = Object.values(networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);

  console.log('\nMeteoTrace — vývojový server\n');
  console.log(`  appka:  http://localhost:${PORT}/`);
  console.log(`  měřič:  http://localhost:${PORT}/test/map-bench.html`);
  console.log(`  proxy:  http://localhost:${PORT}/api/radar`);
  if (addrs.length) {
    console.log('\n  Z telefonu (stejná wifi):');
    addrs.forEach((a) => console.log(`      http://${a}:${PORT}/test/map-bench.html`));
  }
  if (!process.env.ORS_API_KEY) {
    console.log('\n  ⚠️  ORS_API_KEY není nastaven → /api/route vrátí 500.');
    console.log('      Ostatní služby (předpověď, radar, výstrahy) klíč nepotřebují.');
  }
  console.log('\n  Konec: Ctrl+C\n');
});

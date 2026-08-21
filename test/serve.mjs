/* ============================================================
   MeteoTrace — mini server pro testy na telefonu

   Naservíruje adresář test/ do lokální sítě, ať jde map-bench.html
   otevřít v Chromu na telefonu bez kabelu, bez Netlify a bez npm.

   Spuštění (z kořene repa):   node test/serve.mjs
   Ukončení:                   Ctrl+C

   Používá jen vestavěné moduly Node — žádné závislosti, nic k instalaci.
   ============================================================ */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 8099;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.webp': 'image/webp',
  '.pmtiles': 'application/octet-stream',
};

const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === '/') rel = '/map-bench.html';

    // Ochrana proti ../ — normalizovaná cesta musí zůstat uvnitř ROOT.
    const path = normalize(join(ROOT, rel));
    if (!path.startsWith(normalize(ROOT))) {
      res.writeHead(403).end('Zakázáno');
      return;
    }

    const info = await stat(path);
    if (!info.isFile()) { res.writeHead(404).end('Nenalezeno'); return; }

    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
      // Bez cache, ať telefon po úpravě souboru nedrží starou verzi.
      'Cache-Control': 'no-store',
    }).end(body);
  } catch {
    res.writeHead(404).end('Nenalezeno');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = Object.values(networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);

  console.log('\nMeteoTrace — testovací server běží.\n');
  console.log('  V počítači:  http://localhost:' + PORT + '/map-bench.html');
  if (addrs.length) {
    console.log('\n  V telefonu (musí být na stejné wifi) — zadej do Chromu:');
    addrs.forEach((a) => console.log('      http://' + a + ':' + PORT + '/map-bench.html'));
  } else {
    console.log('\n  ⚠️ Nenašel jsem adresu v síti — je počítač připojený k wifi?');
  }
  console.log('\n  Konec: Ctrl+C\n');
  console.log('  Kdyby telefon adresu neotevřel, pouští to obvykle firewall Windows —');
  console.log('  při prvním spuštění povol Node přístup do soukromé sítě.\n');
});

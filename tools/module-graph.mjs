/**
 * Graf statických importů webu — co všechno se stáhne, než appka naběhne.
 *
 * Slouží `index.html` (seznam `<link rel="modulepreload">`) a samotestu,
 * který hlídá, že ten seznam sedí. Bez build kroku (`R1`) se seznam píše
 * ručně — a ručně psaný seznam by se po prvním novém modulu rozešel
 * s kódem. Tichá vada: appka by jela dál, jen by ten modul přišel až
 * v další vlně a start by se o kousek zpomalil, aniž by si toho kdo všiml.
 *
 *     node tools/module-graph.mjs          # vypíše značky
 *     node tools/module-graph.mjs --write  # přepíše je v index.html
 */

'use strict';

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

/** Statické `import … from './x.js'` a `export … from './x.js'` (dynamický `import()` ne). */
const IMPORT = /^\s*(?:import|export)\s[^;]*?\sfrom\s+['"](\.{1,2}\/[^'"]+)['"]/gm;
const HOLY_IMPORT = /^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm;

/**
 * Všechny moduly, které se staticky stáhnou od vstupních bodů, v pořadí
 * průchodu do šířky (co je blíž vstupu, je dřív). Cesty jsou relativní
 * k `web/` a s dopřednými lomítky, tak jak je chce `href`.
 *
 * @param {string[]} vstupy  např. ['app.js', 'start.js']
 */
export function moduleGraph(vstupy) {
  const videno = new Set();
  const fronta = vstupy.map((v) => resolve(WEB, v));
  const poradi = [];
  while (fronta.length) {
    const soubor = fronta.shift();
    if (videno.has(soubor)) continue;
    videno.add(soubor);
    poradi.push(soubor);
    const kod = readFileSync(soubor, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of [...kod.matchAll(IMPORT), ...kod.matchAll(HOLY_IMPORT)]) {
      fronta.push(resolve(dirname(soubor), m[1]));
    }
  }
  return poradi.map((s) => relative(WEB, s).split(sep).join('/'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const graf = moduleGraph(['start.js', 'app.js']).filter((m) => m !== 'app.js' && m !== 'start.js');
  const znacky = graf.map((m) => `<link rel="modulepreload" href="${m}">`);

  if (process.argv.includes('--write')) {
    // Přepíše blok značek v index.html. Konce řádků se berou ze souboru
    // (má CRLF) — smíchané by git hlásil jako změnu na každém řádku.
    const cesta = join(WEB, 'index.html');
    const html = readFileSync(cesta, 'utf8');
    const nl = html.includes('\r\n') ? '\r\n' : '\n';
    const blok = /(?:<link rel="modulepreload" href="[^"]+">\r?\n)+/;
    if (!blok.test(html)) throw new Error('V index.html není žádná značka modulepreload, není co přepsat.');
    writeFileSync(cesta, html.replace(blok, znacky.join(nl) + nl));
    console.error(`index.html: ${graf.length} modulů`);
  } else {
    for (const z of znacky) console.log(z);
    console.error(`\n${graf.length} modulů`);
  }
}

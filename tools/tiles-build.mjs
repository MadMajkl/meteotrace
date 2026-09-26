/**
 * Vyrobí vlastní podkladové dlaždice (`R3`).
 *
 * ⚠️ NESPOUŠTÍ SE ZA BĚHU. Pouští se ručně, když je potřeba mapu obnovit
 * (OpenStreetMap se mění průběžně, ale pro naše účely stačí pár aktualizací
 * ročně). Výsledek je jeden soubor na oblast (`web/data/cz.pmtiles` a další),
 * který od té chvíle **vlastníme** a hostujeme sami.
 *
 *     npm run tiles                      # Česko s příhraničím, do z14
 *     npm run tiles -- --svet            # celý svět, jen do z8 (R32)
 *     npm run tiles -- --oblast=sahara   # další podrobná oblast (R34)
 *
 * Seznam oblastí je v `tiles-oblasti.mjs`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ SE VYŘEZÁVÁ Z HOTOVÉ PLANETY A NEGENERUJE OD NULY
 *
 * Postavit dlaždice z původních dat OSM umí `planetiler`, jenže ten potřebuje
 * Javu, desítky gigabajtů místa a hodiny výpočtu. Protomaps vydává **denní
 * sestavení celé planety** ve stejném schématu — a `.pmtiles` je stavěné tak,
 * že se z něj dá po částech (HTTP Range) vytáhnout **jen náš výřez**, aniž by
 * se stahovalo 128 GB.
 *
 * Výsledek je bit po bitu tentýž archiv, jaký bychom vyrobili sami, jen za
 * pět minut místo za noc. A pořád platí, co chtělo `R3`: soubor je náš,
 * hostujeme si ho sami, žádný cizí klíč ani limit.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { oblastZArgumentu } from './tiles-oblasti.mjs';

const zde = dirname(fileURLToPath(import.meta.url));
const KOREN = join(zde, '..');

/** Nástroj Protomaps. Není v repu — má 59 MB, každý si ho stáhne sám. */
const NASTROJ = join(KOREN, 'tools', 'bin', process.platform === 'win32' ? 'pmtiles.exe' : 'pmtiles');
const NASTROJ_VERZE = '1.31.2';

/** Která oblast se vyrábí — výřez, přiblížení a jméno souboru viz `tiles-oblasti.mjs`. */
const OBLAST = oblastZArgumentu();
const SVET = OBLAST.vyrez === null;
const CIL = join(KOREN, 'web', 'data', OBLAST.soubor);
const VYREZ = OBLAST.vyrez;
const MAXZOOM = OBLAST.maxzoom;

function den(posun) {
  const d = new Date(Date.now() - posun * 86400_000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Najde nejnovější denní sestavení, které opravdu existuje. */
async function najdiSestaveni() {
  for (let i = 1; i <= 10; i++) {
    const url = `https://build.protomaps.com/${den(i)}.pmtiles`;
    const odpoved = await fetch(url, { method: 'HEAD' });
    if (odpoved.ok) return url;
  }
  throw new Error('Nenašel jsem žádné denní sestavení Protomaps za posledních 10 dní.');
}

function spust(prikaz, args) {
  return new Promise((res, rej) => {
    const p = spawn(prikaz, args, { stdio: 'inherit' });
    p.on('error', rej);
    p.on('close', (kod) => (kod === 0 ? res() : rej(new Error(`${prikaz} skončil s kódem ${kod}`))));
  });
}

async function main() {
  if (!existsSync(NASTROJ)) {
    console.error(`
Chybí nástroj Protomaps: ${NASTROJ}

Stáhni ho (59 MB, do repa nepatří):
  https://github.com/protomaps/go-pmtiles/releases/tag/v${NASTROJ_VERZE}
a rozbal do tools/bin/.
`);
    process.exit(1);
  }

  mkdirSync(join(KOREN, 'web', 'data'), { recursive: true });

  console.log('Hledám nejnovější sestavení planety…');
  const zdroj = await najdiSestaveni();
  console.log(`Zdroj: ${zdroj}`);
  console.log(`Výřez: ${SVET ? 'celý svět' : VYREZ}, přiblížení do z${MAXZOOM}`);
  console.log(`Stahuje se jen tahle oblast, zhruba ${OBLAST.velikost} — pár minut.\n`);

  await spust(NASTROJ, [
    'extract', zdroj, CIL,
    ...(SVET ? [] : [`--bbox=${VYREZ}`]),
    `--maxzoom=${MAXZOOM}`,
    '--download-threads=8',
  ]);

  console.log(`\nHotovo → ${CIL}`);
  console.log('Soubor je v .gitignore: do repa nepatří, hostuje se zvlášť (R3).');
}

main().catch((e) => {
  console.error('CHYBA:', e.message);
  process.exit(1);
});

/**
 * Nasype web do Android obalu.
 *
 *     npm run android:sync
 *     npm run android:sync -- --tiles=https://dlazdice.example/cz.pmtiles
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO DĚLÁ SKRIPT A NE ČLOVĚK
 *
 * `assets/www/` je **kopie**, ne zdroj. Jediný zdroj pravdy je `web/`.
 * Ruční kopírování znamená, že se dřív nebo později vydá appka se starou
 * verzí webu a nikdo si toho nevšimne — proto se cíl vždycky celý smaže
 * a naleje znovu.
 *
 * ⚠️ NIKDY neupravovat soubory v `assets/www/`. Při dalším spuštění zmizí.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const zde = dirname(fileURLToPath(import.meta.url));
const KOREN = join(zde, '..');
const ZDROJ = join(KOREN, 'web');
const CIL = join(KOREN, 'android', 'app', 'src', 'main', 'assets', 'www');

/**
 * 🚨 Co se do balíčku NESMÍ dostat.
 *
 * Podkladová mapa má **1,4 GB**. Do APK se nevejde (a ani by neměla —
 * Play má strop a nikdo nechce stahovat gigabajt při instalaci). V appce
 * se proto načítá po síti z úložiště, stejně jako na webu; adresa se
 * nastavuje přepínačem `--tiles` (viz `R3`).
 */
const NEBRAT = [
  'data/cz.pmtiles',
  // Hranice ORP čte JEN server (proxy z nich určuje, koho se výstraha týká).
  // V balíčku by to bylo 404 kB, na která se nikdy nesáhne.
  'data/orp-boundaries.js',
];

function velikost(dir) {
  let bajtu = 0;
  let souboru = 0;
  for (const polozka of readdirSync(dir, { withFileTypes: true })) {
    const cesta = join(dir, polozka.name);
    if (polozka.isDirectory()) {
      const [b, s] = velikost(cesta);
      bajtu += b;
      souboru += s;
    } else {
      bajtu += statSync(cesta).size;
      souboru += 1;
    }
  }
  return [bajtu, souboru];
}

function main() {
  const argTiles = process.argv.find((a) => a.startsWith('--tiles='));
  const tiles = argTiles ? argTiles.slice('--tiles='.length) : '';

  if (!existsSync(ZDROJ)) throw new Error(`Zdroj neexistuje: ${ZDROJ}`);

  rmSync(CIL, { recursive: true, force: true });
  mkdirSync(CIL, { recursive: true });

  const vynechane = [];
  cpSync(ZDROJ, CIL, {
    recursive: true,
    filter: (src) => {
      const rel = relative(ZDROJ, src).split('\\').join('/');
      if (NEBRAT.includes(rel)) {
        vynechane.push(rel);
        return false;
      }
      return true;
    },
  });

  // Adresa podkladové mapy se do balíčku vpisuje, protože v appce nemůže být
  // relativní — soubor tam prostě není. Tohle je celý důvod, proč je adresa
  // konfigurace, a ne konstanta v kódu (R0, R3).
  const indexCesta = join(CIL, 'index.html');
  const index = readFileSync(indexCesta, 'utf8');
  const znacka = /<meta name="meteotrace:tiles" content="([^"]*)">/;
  const nalez = index.match(znacka);
  if (!nalez) {
    throw new Error('V index.html chybí značka meteotrace:tiles — beze změny by mapa v appce nefungovala.');
  }

  // ⚠️ Bez `--tiles` se adresa NEPŘEPISUJE, jen převezme z webu.
  // Dřív se přepsala na prázdno, takže balíček sestavený „bez parametrů"
  // tiše přišel o mapu — a poznalo se to až v telefonu.
  const pouzita = tiles || nalez[1];
  if (tiles) writeFileSync(indexCesta, index.replace(znacka, `<meta name="meteotrace:tiles" content="${tiles}">`));

  const [bajtu, souboru] = velikost(CIL);
  console.log(`Web nasypán do obalu: ${souboru} souborů, ${(bajtu / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Vynecháno: ${vynechane.length ? vynechane.join(', ') : '(nic)'}`);

  if (pouzita) {
    console.log(`Podkladová mapa: ${pouzita}${tiles ? '' : '  (převzato z webu)'}`);
  } else {
    console.log('\n⚠️  Podkladová mapa NENÍ nastavena (--tiles=…).');
    console.log('    Appka se spustí, ale karta s radarem zůstane bez mapy.');
    console.log('    Pro ladění na místní síti: --tiles=http://192.168.1.150:8099/data/cz.pmtiles');
  }
}

try {
  main();
} catch (e) {
  console.error('CHYBA:', e.message);
  process.exit(1);
}

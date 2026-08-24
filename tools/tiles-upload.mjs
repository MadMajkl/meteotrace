/**
 * Nahraje podkladovou mapu do objektového úložiště (`R3`).
 *
 *     npm run tiles:upload
 *
 * ⚠️ NESPOUŠTÍ SE ZA BĚHU. Ruční krok, stejně jako `npm run tiles` — mapa se
 * obnovuje řádově jednou za pár měsíců.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ NE PŘES WEBOVÝ FORMULÁŘ
 *
 * Cloudflare sám píše, že **soubory nad 300 MB přes rozhraní nahrát nejde**.
 * Náš archiv má 1,4 GB. Nahrává se proto `rclone`em, který soubor pošle po
 * dílech a po výpadku naváže tam, kde skončil — u gigabajtu na domácí lince
 * to není luxus, ale nutnost.
 *
 * ⚠️ PŘÍSTUPOVÉ ÚDAJE leží v `.env` (mimo git) a předávají se `rclone`u
 * proměnnými prostředí, ne v příkazu — parametry příkazu jsou vidět v seznamu
 * procesů komukoli na stroji.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const zde = dirname(fileURLToPath(import.meta.url));
const KOREN = join(zde, '..');
const ARCHIV = join(KOREN, 'web', 'data', 'cz.pmtiles');
const RCLONE = join(KOREN, 'tools', 'bin', process.platform === 'win32' ? 'rclone.exe' : 'rclone');

/** Jméno souboru v úložišti. Drží se jméno místní — hledá se pak líp. */
const CIL = 'cz.pmtiles';

function chybi(co, rada) {
  console.error(`CHYBA: ${co}\n${rada}`);
  process.exit(1);
}

async function main() {
  if (!existsSync(ARCHIV)) chybi(`Archiv ${ARCHIV} neexistuje.`, 'Vyrob ho: npm run tiles');
  if (!existsSync(RCLONE)) {
    chybi(`Chybí rclone: ${RCLONE}`,
      'Stáhni ho z rclone.org/downloads a rozbal do tools/bin/ (do repa nepatří).');
  }

  const nutne = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET'];
  const chybne = nutne.filter((k) => !process.env[k]);
  if (chybne.length) {
    chybi(`V prostředí chybí: ${chybne.join(', ')}`,
      'Doplň je do .env (soubor je v .gitignore) a spusť přes npm, které ho načte.');
  }

  const velikost = (statSync(ARCHIV).size / 1024 / 1024 / 1024).toFixed(2);
  console.log(`Nahrávám ${velikost} GB do ${process.env.R2_BUCKET}/${CIL}`);
  console.log('Po výpadku se dá spustit znovu — naváže, kde skončil.\n');

  const env = {
    ...process.env,
    RCLONE_S3_PROVIDER: 'Cloudflare',
    RCLONE_S3_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    RCLONE_S3_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    RCLONE_S3_ENDPOINT: process.env.R2_ENDPOINT,
    // R2 nedovolí vytvořit bucket přes S3 rozhraní; bez tohohle by se rclone
    // pokusil ověřit jeho existenci a skončil chybou o oprávnění.
    RCLONE_S3_NO_CHECK_BUCKET: 'true',
  };

  await new Promise((res, rej) => {
    const p = spawn(RCLONE, [
      'copyto', ARCHIV, `:s3:${process.env.R2_BUCKET}/${CIL}`,
      '--s3-chunk-size', '64M',
      '--s3-upload-concurrency', '4',
      '--progress',
    ], { stdio: 'inherit', env });
    p.on('error', rej);
    p.on('close', (kod) => (kod === 0 ? res() : rej(new Error(`rclone skončil s kódem ${kod}`))));
  });

  const verejna = `https://<veřejná-adresa-bucketu>/${CIL}`;
  console.log(`\nHotovo. Zbývají dvě věci, bez kterých mapa v prohlížeči NEPOJEDE:`);
  console.log('  1. zapnout veřejné čtení bucketu (R2 → bucket → Settings → Public access)');
  console.log('  2. povolit CORS pro naši doménu (tamtéž, CORS policy)');
  console.log(`\nPak vlož adresu do web/index.html:`);
  console.log(`  <meta name="meteotrace:tiles" content="${verejna}">`);
}

main().catch((e) => {
  console.error('CHYBA:', e.message);
  process.exit(1);
});

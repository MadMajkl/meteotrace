/**
 * Zvedne verzi — na VŠECH místech naráz.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO NENÍ RUČNÍ PRÁCE
 *
 * Verze žila na třech místech (`package.json`, `VERZE` v `app.js`, Gradle)
 * a v komentáři u ní stálo „bumpuje se až úplně nakonec". Nakonec nikdy
 * nenastalo: appka měla po sedmi dnech vývoje pořád `0.1.0`, zatímco přibyly
 * trasa, výstrahy, vlastní mapa, značka i posuvník radaru. Michal 28. 8. 2026:
 * *„ty to zapomínáš zvedat!"*
 *
 * Řešení má tři části a tahle je první:
 *   1. `npm run verze -- 0.2.7` (nebo `patch` / `minor`) — jeden příkaz,
 *      obě místa ve webu naráz,
 *   2. `android/version.properties` píše `android-sync.mjs` z `package.json`,
 *      takže Gradle verzi nedrží, jen čte (`versionCode` roste sám),
 *   3. `tools/version-check.mjs` v `pre-commit` NEDOVOLÍ commit, který mění
 *      appku a verzi nechá na místě.
 *
 * ⚠️ Zdroj pravdy je `package.json`. Kdyby se rozešel s `app.js`, chytne to
 * samotest — ale správně se sem nemá sahat ručně vůbec.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KOREN = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = join(KOREN, 'package.json');
const APP = join(KOREN, 'web', 'app.js');

/** `VERZE = '1.2.3'` v app.js — jediný výskyt, hlídá to samotest. */
const ZNACKA_APP = /(const VERZE = ')([^']+)(')/;
const ZNACKA_PKG = /("version"\s*:\s*")([^"]+)(")/;

/** Rozloží „1.2.3" na čísla. Nic jiného než tři čísla neprojde. */
export function rozloz(verze) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(verze).trim());
  if (!m) throw new Error(`Verze musí být X.Y.Z, přišlo: ${verze}`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

/**
 * Spočítá novou verzi.
 *
 * ⚠️ `minor` nuluje `patch` a `major` nuluje obojí — jinak by vzniklo
 * „0.3.6", což vypadá jako šestá oprava trojky, ale je to její první vydání.
 */
export function dalsi(soucasna, jak) {
  const v = rozloz(soucasna);
  if (jak === 'patch') return `${v.major}.${v.minor}.${v.patch + 1}`;
  if (jak === 'minor') return `${v.major}.${v.minor + 1}.0`;
  if (jak === 'major') return `${v.major + 1}.0.0`;
  const cil = rozloz(jak);
  return `${cil.major}.${cil.minor}.${cil.patch}`;
}

function main() {
  const jak = process.argv[2];
  const pkg = readFileSync(PACKAGE, 'utf8');
  const soucasna = ZNACKA_PKG.exec(pkg)?.[2];
  if (!soucasna) throw new Error('V package.json není "version".');

  if (!jak) {
    console.log(`Verze je ${soucasna}.`);
    console.log('Zvednout:  npm run verze -- patch | minor | major | X.Y.Z');
    return;
  }

  const nova = dalsi(soucasna, jak);
  if (nova === soucasna) throw new Error(`Verze už je ${nova} — nic k udělání.`);

  const app = readFileSync(APP, 'utf8');
  if (!ZNACKA_APP.test(app)) throw new Error('V web/app.js není `const VERZE = ...`.');

  writeFileSync(PACKAGE, pkg.replace(ZNACKA_PKG, `$1${nova}$3`));
  writeFileSync(APP, app.replace(ZNACKA_APP, `$1${nova}$3`));

  console.log(`Verze ${soucasna} → ${nova}`);
  console.log('  package.json ✓');
  console.log('  web/app.js ✓');
  console.log('  android: přepíše se samo při `npm run android` (versionCode roste podle commitů)');
}

if (process.argv[1] && process.argv[1].endsWith('verze.mjs')) {
  try {
    main();
  } catch (e) {
    console.error('CHYBA:', e.message);
    process.exit(1);
  }
}

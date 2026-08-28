/**
 * Pojistka v `pre-commit`: appka se nesmí změnit, aniž by se zvedla verze.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO HLÍDÁ STROJ
 *
 * Pravidlo „nezapomeň zvednout verzi" se sedm dní po sobě zapomínalo, až
 * appka s trasou, výstrahami, vlastní mapou a novou značkou hlásila pořád
 * `0.1.0`. Pravidlo, které si má někdo pamatovat, není pravidlo — je to
 * přání. Tohle je totéž pravidlo, ale vynutitelné.
 *
 * ⚠️ Hlídá se jen to, co uživatel uvidí: `web/`, `android/`, `server/`.
 * Commit do dokumentace nebo do nástrojů verzi zvedat nemusí — jinak by
 * pojistka jen otravovala a první, co by se stalo, je že se vypne.
 *
 * ⚠️ Porovnává se verze VE FRONTĚ (`git show :package.json`) proti verzi
 * v posledním commitu. Pracovní kopie by lhala: soubor může být upravený
 * a nepřidaný, a commit by přesto prošel se starou verzí.
 *
 * Nouzový východ: `SKIP_VERSION_CHECK=1 git commit …` (třeba při rebase).
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { execFileSync } from 'node:child_process';

/** Které cesty znamenají „appka se změnila". */
const HLIDANE = [/^web\//, /^android\//, /^server\//, /^netlify\//];

/** Vrátí verzi z obsahu package.json, nebo null. */
export function verzeZ(obsah) {
  return /"version"\s*:\s*"([^"]+)"/.exec(obsah || '')?.[1] ?? null;
}

/** Mění commit appku, nebo jen papíry okolo? */
export function meniAppku(soubory) {
  return soubory.some((f) => HLIDANE.some((re) => re.test(f)));
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function main() {
  if (process.env.SKIP_VERSION_CHECK) return;

  const soubory = git('diff', '--cached', '--name-only')
    .split('\n').map((s) => s.trim()).filter(Boolean);
  if (!soubory.length || !meniAppku(soubory)) return;

  const nova = verzeZ(git('show', ':package.json'));

  let stara = null;
  try {
    stara = verzeZ(git('show', 'HEAD:package.json'));
  } catch {
    return;   // první commit v repu — není proti čemu porovnávat
  }

  if (!nova || !stara || nova !== stara) return;

  console.error('');
  console.error(`  ⛔ Commit mění appku, ale verze zůstala ${stara}.`);
  console.error('');
  console.error('     Zvedni ji a přidej do commitu:');
  console.error('       npm run verze -- patch     (oprava)');
  console.error('       npm run verze -- minor     (nová funkce)');
  console.error('       git add package.json web/app.js');
  console.error('');
  console.error('     Jen když to opravdu nemá být vydání:');
  console.error('       SKIP_VERSION_CHECK=1 git commit …');
  console.error('');
  process.exit(1);
}

// ⚠️ Spustí se JEN jako hook, ne při importu. Samotest si tenhle soubor
// natahuje kvůli dvěma funkcím — a kdyby se přitom rozjela i kontrola,
// spadl by celý test jen proto, že je zrovna něco ve frontě ke commitu.
if (process.argv[1] && process.argv[1].endsWith('version-check.mjs')) main();

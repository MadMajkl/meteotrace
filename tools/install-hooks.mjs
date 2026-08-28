/**
 * Nasadí gitové pojistky do `.git/hooks/`.
 *
 * ⚠️ Hooky se s repem NEKLONUJÍ — `.git/hooks/` je mimo verzování. Proto je
 * tenhle skript pověšený na `prepare`, tedy na `npm install`: kdo si repo
 * klonuje, dostane pojistku, aniž by o ní musel vědět.
 *
 * ⚠️ Cizí hook se nepřepisuje bez ptaní. Když v `.git/hooks/pre-commit` už
 * něco je a není to náš, jen se to řekne — tiché přepsání cizí práce je
 * přesně ten druh služby, o kterou nikdo nestál.
 */

'use strict';

import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KOREN = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = join(KOREN, '.git', 'hooks');
const CIL = join(HOOKS, 'pre-commit');
const PODPIS = '# meteotrace: kontrola verze';

const OBSAH = `#!/bin/sh
${PODPIS}
exec node tools/version-check.mjs
`;

function main() {
  if (!existsSync(join(KOREN, '.git'))) {
    return;   // není to git repo (třeba stažené jako archiv) — nevadí, mlč
  }
  mkdirSync(HOOKS, { recursive: true });

  if (existsSync(CIL)) {
    const stary = readFileSync(CIL, 'utf8');
    if (stary.includes(PODPIS)) {
      writeFileSync(CIL, OBSAH);
      chmodSync(CIL, 0o755);
      return;
    }
    console.log('⚠️  .git/hooks/pre-commit už existuje a není náš — nechávám ho být.');
    console.log('    Kontrola verze se tím pádem nespustí; doplň si do něj:');
    console.log('      node tools/version-check.mjs');
    return;
  }

  writeFileSync(CIL, OBSAH);
  chmodSync(CIL, 0o755);
  console.log('Nasazen pre-commit hook: hlídá, že se s appkou zvedne i verze.');
}

main();

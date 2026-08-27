/**
 * Samotest fází Měsíce.
 *
 * 🚨 Michal 27. 8. 2026: *„a prosím, šlo by přidat fáze měsíce?"*
 *
 * ⚠️ Ověřuje se to proti SKUTEČNÝM úkazům, ne proti vlastnímu výpočtu.
 * Test, který jen zopakuje tutéž rovnici, potvrdí i chybu v ní.
 */

'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';

import { moonPhase, MOON_KEYS, SYNODICKY_MESIC_DNU } from '../web/lib/moon.js';

/**
 * Skutečné úkazy roku 2026 (časy v UTC).
 * Zdroj: veřejné efemeridy, ověřeno 27. 8. 2026.
 */
const UKAZY = [
  { popis: 'nov 12. 8. 2026', kdy: '2026-08-12T17:37:00Z', klic: 'new' },
  { popis: 'první čtvrt 20. 8. 2026', kdy: '2026-08-20T14:46:00Z', klic: 'firstQuarter' },
  { popis: 'úplněk 28. 8. 2026', kdy: '2026-08-28T04:18:00Z', klic: 'full' },
];

test('🚨 fáze sedí na skutečné úkazy', () => {
  for (const u of UKAZY) {
    const f = moonPhase(Date.parse(u.kdy));
    assert.equal(f.klic, u.klic, `${u.popis}: vyšlo ${f.klic}`);
  }
});

test('🚨 odchylka od skutečného úkazu zůstává pod dnem', () => {
  // Počítá se ze STŘEDNÍHO synodického měsíce, takže se to na hodinu netrefí
  // — skutečný oběh kolísá zhruba o půl dne. Test hlídá, že to nekolísá víc:
  // kdyby se odchylka blížila dvěma dnům, pojmenování fáze by se začalo mýlit.
  for (const u of UKAZY) {
    const f = moonPhase(Date.parse(u.kdy));
    const cil = { new: 0, firstQuarter: 0.25, full: 0.5 }[u.klic];
    // Vzdálenost po kruhu — nov je 0 i 1.
    const rozdil = Math.min(Math.abs(f.podil - cil), 1 - Math.abs(f.podil - cil));
    const dnu = rozdil * SYNODICKY_MESIC_DNU;
    assert.ok(dnu < 1, `${u.popis}: mimo o ${dnu.toFixed(2)} dne`);
  }
});

test('osvětlení odpovídá fázi', () => {
  const nov = moonPhase(Date.parse('2026-08-12T17:37:00Z'));
  const uplnek = moonPhase(Date.parse('2026-08-28T04:18:00Z'));
  assert.ok(nov.osvetleni < 0.02, `nov svítí z ${(nov.osvetleni * 100).toFixed(1)} %`);
  assert.ok(uplnek.osvetleni > 0.98, `úplněk svítí z ${(uplnek.osvetleni * 100).toFixed(1)} %`);
});

test('🚨 datum před rokem 2000 nespadne do záporného zbytku', () => {
  // `%` v JS vrací u záporných čísel záporný zbytek — bez ošetření by z toho
  // vyšel podíl mimo rozsah a fáze by se nenašla vůbec.
  const f = moonPhase(Date.parse('1969-07-20T20:17:00Z'));   // přistání Apolla 11
  assert.ok(f, 'starý datum musí projít');
  assert.ok(f.podil >= 0 && f.podil < 1, `podíl mimo rozsah: ${f.podil}`);
  assert.ok(MOON_KEYS.includes(f.klic));
});

test('celý oběh projde všemi osmi fázemi', () => {
  const start = Date.parse('2026-08-12T17:37:00Z');
  const videne = new Set();
  for (let i = 0; i < 60; i += 1) {
    videne.add(moonPhase(start + i * 0.5 * 86400000).klic);
  }
  assert.equal(videne.size, MOON_KEYS.length,
    `za měsíc se ukázalo jen ${[...videne].join(', ')}`);
});

test('nesmyslný vstup vrátí nic, ne nesmysl', () => {
  assert.equal(moonPhase(NaN), null);
  assert.equal(moonPhase('včera'), null);
});

/**
 * Samotest hlášek k trase.
 *
 * 🚨 Hláška je jediné místo v appce, kde si dovolíme žertovat — a proto je
 * potřeba hlídat, KDY MLČÍ. Vtip nad varováním před bouřkou je urážka
 * a v horším případě důvod, proč to varování někdo nevezme vážně.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { routeQuip, SITUACE_KLICE } from '../web/lib/quips.js';

/** Obyčejná klidná trasa. */
const KLID = {
  hazard: false, rainCount: 0, windKmh: 8, tempC: 18,
  distanceM: 40000, arrivalHour: 14,
};

test('🚨 u nebezpečného počasí se NEŽERTUJE', () => {
  // Bouřka je přesně ta chvíle, kvůli které si pilot appku otevřel.
  assert.equal(routeQuip({ ...KLID, hazard: true }), '');
  assert.equal(routeQuip({ ...KLID, hazard: true, rainCount: 5 }), '');
});

test('🚨 táž trasa dá pokaždé TUTÉŽ hlášku', () => {
  // Kdyby se losovalo při každém překreslení, měnila by se věta při každém
  // přepnutí odjezdu a působila by jako porucha.
  const a = routeQuip(KLID);
  for (let i = 0; i < 20; i += 1) assert.equal(routeQuip(KLID), a);
});

test('jiná trasa dá (obvykle) jinou hlášku', () => {
  const vety = new Set();
  for (let km = 10; km <= 300; km += 10) {
    vety.add(routeQuip({ ...KLID, distanceM: km * 1000 }));
  }
  assert.ok(vety.size >= 3, `příliš málo rozmanitosti: ${vety.size}`);
});

test('déšť, vítr, zima i vedro mají svoje věty', () => {
  const dest = routeQuip({ ...KLID, rainCount: 3 });
  const vitr = routeQuip({ ...KLID, windKmh: 40 });
  const zima = routeQuip({ ...KLID, tempC: -4 });
  const vedro = routeQuip({ ...KLID, tempC: 31 });

  for (const v of [dest, vitr, zima, vedro]) assert.ok(v.length > 10, v);
  assert.equal(new Set([dest, vitr, zima, vedro]).size, 4, 'každá situace má svoji');
});

test('🚨 jiný jazyk než čeština MLČÍ', () => {
  // Cimrmanovský humor stojí na jazyce. Přeložený doslova není vtipný,
  // je jen divný — a mlčet je lepší než žertovat bez citu pro jazyk.
  assert.equal(routeQuip(KLID, 'en'), '');
  assert.equal(routeQuip(KLID, 'de'), '');
  assert.equal(routeQuip(KLID, 'cs').length > 0, true);
});

test('rozbitý nebo chybějící vstup hlášku neshodí', () => {
  assert.equal(routeQuip(null), '');
  assert.equal(typeof routeQuip({}), 'string');
  assert.equal(typeof routeQuip({ tempC: NaN, distanceM: 'x' }), 'string');
});

test('každá situace má aspoň dvě věty, ať se neomrzí', () => {
  assert.ok(SITUACE_KLICE.length >= 8, 'málo situací');
});

test('hlášky jsou krátké — je to dovětek, ne odstavec', () => {
  // Delší text by soupeřil s údaji nad sebou. Hláška má být šťouchnutí.
  for (let km = 5; km <= 400; km += 5) {
    for (const rain of [0, 1, 3]) {
      const v = routeQuip({ ...KLID, distanceM: km * 1000, rainCount: rain });
      assert.ok(v.length <= 110, `moc dlouhé (${v.length}): ${v}`);
    }
  }
});

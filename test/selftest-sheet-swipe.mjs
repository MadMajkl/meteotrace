/**
 * Samotest odpalcování listu zprava doleva (`web/lib/sheet-swipe.js`).
 *
 * Gesto se jinak zkouší jen prstem — tady se ověří rozhodování: kdy se
 * chytí, kdy pustí rolování a kdy se list po puštění zavře.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSwipe, MIN_PX, PODIL, ROZHODNUTI } from '../web/lib/sheet-swipe.js';

const SIRKA = 336;   // list na 360px telefonu

/** Tah po krocích: [x, y, t] od startu. Vrací, jestli se po puštění zavřelo. */
function tahni(kroky, nastaveni = {}) {
  const g = createSwipe();
  g.start(300, 400, 0, { sirka: SIRKA, ...nastaveni });
  for (const [x, y, t] of kroky) g.move(x, y, t);
  return { zavrit: g.end(), g };
}

test('dlouhý tah doleva list zavře', () => {
  const kroky = [];
  for (let i = 1; i <= 10; i++) kroky.push([300 - i * 15, 400, i * 40]);   // 150 px pomalu
  assert.equal(tahni(kroky).zavrit, true);
});

test('krátký pomalý tah list NEzavře — vrátí se', () => {
  const kroky = [[290, 400, 50], [280, 400, 100], [270, 400, 150], [260, 400, 200]];  // 40 px, 0,2 px/ms
  assert.equal(tahni(kroky).zavrit, false);
});

test('švih zavře i na kratší dráze', () => {
  // 50 px za 50 ms = 1 px/ms — rychlé mrsknutí.
  const kroky = [[285, 400, 15], [265, 400, 30], [250, 400, 50]];
  assert.equal(tahni(kroky).zavrit, true);
});

test('🚨 svislý pohyb je rolování — list se ani nehne', () => {
  const g = createSwipe();
  g.start(300, 400, 0, { sirka: SIRKA });
  assert.equal(g.move(295, 380, 20), null, 'svislý pohyb gesto pustí');
  // A ani když pak prst uhne doleva, gesto se nevrátí — rolování už běží.
  assert.equal(g.move(100, 370, 200), null);
  assert.equal(g.tahne, false);
  assert.equal(g.end(), false);
});

test('šikmý palec (víc do strany než dolů) se počítá jako tah doleva', () => {
  const g = createSwipe();
  g.start(300, 400, 0, { sirka: SIRKA });
  assert.ok(g.move(285, 408, 20) < 0, 'mírně šikmý tah doleva má list chytit');
  assert.equal(g.tahne, true);
});

test('tah DOPRAVA nedělá nic', () => {
  const g = createSwipe();
  g.start(100, 400, 0, { sirka: SIRKA });
  assert.equal(g.move(130, 400, 20), null);
  assert.equal(g.end(), false);
});

test('do rozhodnutí může jít o klepnutí — list stojí', () => {
  const g = createSwipe();
  g.start(300, 400, 0, { sirka: SIRKA });
  assert.equal(g.move(300 - (ROZHODNUTI - 1), 402, 30), 0);
  assert.equal(g.tahne, false);
  assert.equal(g.end(), false);
});

test('zpátky doprava list nepřejede přes své místo', () => {
  const g = createSwipe();
  g.start(300, 400, 0, { sirka: SIRKA });
  g.move(250, 400, 50);
  assert.equal(g.move(340, 400, 150), 0, 'posun je nejvýš nula');
  assert.equal(g.end(), false, 'vrácený list se nezavírá');
});

test('práh je třetina šířky, ale aspoň MIN_PX', () => {
  const pomalu = (dx, sirka) => {
    const g = createSwipe();
    g.start(500, 400, 0, { sirka });
    for (let i = 1; i <= 20; i++) g.move(500 - (dx * i) / 20, 400, i * 100);  // pomalu, bez švihu
    return g.end();
  };
  const prah = SIRKA * PODIL;
  assert.equal(pomalu(prah + 2, SIRKA), true);
  assert.equal(pomalu(prah - 6, SIRKA), false);
  // Úzký list: třetina by byla 30 px — platí MIN_PX.
  assert.equal(pomalu(MIN_PX - 6, 90), false);
  assert.equal(pomalu(MIN_PX + 2, 90), true);
});

test('pole, výběry a vodorovně rolované věci si dotyk berou samy', () => {
  const g = createSwipe();
  assert.equal(g.start(300, 400, 0, { sirka: SIRKA, nelze: true }), false);
  assert.equal(g.move(100, 400, 100), null);
  assert.equal(g.end(), false);
});

test('druhý prst = přibližování, ne tažení', () => {
  const g = createSwipe();
  assert.equal(g.start(300, 400, 0, { sirka: SIRKA, prstu: 2 }), false);
  const h = createSwipe();
  h.start(300, 400, 0, { sirka: SIRKA });
  h.move(250, 400, 50);
  assert.equal(h.move(150, 400, 100, { prstu: 2 }), null, 'druhý prst gesto ukončí');
  assert.equal(h.end(), false);
});

test('zrušení systémem list vrátí a nic nezavře; konec bez začátku nic nespustí', () => {
  const g = createSwipe();
  g.start(300, 400, 0, { sirka: SIRKA });
  g.move(100, 400, 100);
  g.zrus();
  assert.equal(g.posun, 0);
  assert.equal(g.end(), false);
  assert.equal(createSwipe().end(), false);
});

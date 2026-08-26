/**
 * Samotest: kolik štítků se vejde do řádku.
 *
 * Měření dělá prohlížeč, ale ROZHODOVÁNÍ je čistá úvaha — a ta se dá ověřit
 * bez něj. Právě tady se dělají chyby o jednu položku, kterých si na širokém
 * monitoru nikdo nevšimne a na telefonu přetečou.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fitCount } from '../web/lib/fit-row.js';

test('vejde se, co se vejde — mezery se počítají', () => {
  // 100 + 8 + 100 = 208 ≤ 220, třetí by přetekl.
  assert.equal(fitCount([100, 100, 100], 220, 8), 2);
  assert.equal(fitCount([100, 100, 100], 320, 8), 3);
});

test('🚨 mezera se nepřičítá k PRVNÍ položce', () => {
  // Klasická chyba o jednu: kdyby se počítala i před první, vešlo by se
  // o štítek míň, než se doopravdy vejde.
  assert.equal(fitCount([100], 100, 8), 1);
  assert.equal(fitCount([100, 100], 208, 8), 2);
});

test('🚨 aspoň jedna položka se ukáže vždycky', () => {
  // Prázdný řádek vedle nadpisu „Moje trasy" vypadá jako vada, i když je to
  // jen úzký displej. Ke zbytku se člověk dostane rozbalením.
  assert.equal(fitCount([300], 40, 8), 1);
  assert.equal(fitCount([300, 300], 40, 8), 1);
});

test('různě široké štítky: „Domov" vedle „Praha → Brno přes Jihlavu"', () => {
  assert.equal(fitCount([60, 240, 80], 150, 8), 1, 'druhý je moc dlouhý');
  assert.equal(fitCount([60, 80, 240], 150, 8), 2, 'krátké se vejdou dva');
});

test('bez naměřené šířky se ukáže minimum, ne nic', () => {
  // Před prvním vykreslením nemá prohlížeč co měřit. Schovat všechno by
  // vypadalo, jako by uživatel nic uloženého neměl.
  assert.equal(fitCount([100, 100], 0, 8), 1);
  assert.equal(fitCount([100, 100], NaN, 8), 1);
});

test('prázdný seznam nevrátí nic a nespadne', () => {
  assert.equal(fitCount([], 300), 0);
  assert.equal(fitCount(null, 300), 0);
  assert.equal(fitCount([0, -5, NaN], 300), 0);
});

test('minimum se dá zvednout — a nikdy nepřekročí počet položek', () => {
  assert.equal(fitCount([300, 300], 40, 8, 2), 2);
  assert.equal(fitCount([300], 40, 8, 3), 1, 'víc než je, se ukázat nedá');
});

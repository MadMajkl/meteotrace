/**
 * Samotest: potažení dolů = načíst znovu.
 *
 * Gesto se jinak zkouší jen prstem na telefonu, a to je ten nejhorší způsob,
 * jak hledat chybu o pár pixelů. Rozhodování je proto čistý modul a ověřuje
 * se tady — v prohlížeči zůstane jen dotyk a posun pruhu.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPull, posunZTazeni, PRAH, MAX_POSUN } from '../web/lib/pull-refresh.js';

/* ── odpor tažení ─────────────────────────────────────────────────────── */

test('pruh se na začátku hýbe s prstem, pak zaostává', () => {
  // Kdyby se pruh na prvních pixelech nehnul, gesto by působilo zaseknuté.
  assert.ok(posunZTazeni(10) > 9, 'prvních 10 px má být skoro 1 : 1');
  // A dál už musí zaostávat, jinak by ujel do půlky obrazovky.
  assert.ok(posunZTazeni(300) < 300 * 0.5);
});

test('🚨 posun nikdy nepřekročí strop — ani při hodně dlouhém tažení', () => {
  // Tvrdé uříznutí vypadá jako záseknutá appka; tohle je gumový doraz.
  for (const dy of [200, 1000, 100000]) {
    assert.ok(posunZTazeni(dy) < MAX_POSUN, `dy=${dy}`);
  }
  assert.ok(posunZTazeni(100000) > MAX_POSUN * 0.99, 'ke stropu se ale dojít má');
});

test('tažení nahoru a nesmysly jsou nula, ne záporný posun', () => {
  // Záporný posun by pruh vytáhl NAD hlavičku a schoval ho pod ni.
  assert.equal(posunZTazeni(0), 0);
  assert.equal(posunZTazeni(-50), 0);
  assert.equal(posunZTazeni(NaN), 0);
  assert.equal(posunZTazeni(undefined), 0);
});

test('práh leží v dosahu stropu, jinak by nešel překročit nikdy', () => {
  assert.ok(PRAH < MAX_POSUN, 'jinak by se gesto nedalo spustit vůbec');
});

/* ── kdy se gesto chytí ───────────────────────────────────────────────── */

test('🚨 chytá se jen na samém vrchu stránky', () => {
  const p = createPull();
  assert.equal(p.start(100, { scrollY: 40 }), false, 'uprostřed rolování ne');
  assert.equal(p.start(100, { scrollY: 0 }), true);
});

test('🚨 mapa a otevřený dialog si dotyk berou samy', () => {
  // Bez toho by potažení v mapě místo posunu mapy načítalo počasí.
  const p = createPull();
  assert.equal(p.start(100, { scrollY: 0, nelze: true }), false);
  assert.equal(p.posun, 0);
});

test('🚨 dva prsty jsou přibližování, ne tažení', () => {
  const p = createPull();
  assert.equal(p.start(100, { scrollY: 0, prstu: 2 }), false);

  // A když druhý prst přibude až během tažení, gesto se zruší.
  const q = createPull();
  q.start(100, { scrollY: 0 });
  q.move(180);
  assert.equal(q.move(200, { prstu: 2 }), null);
  assert.equal(q.end(), false, 'po zrušení se nesmí nic spustit');
});

/* ── průběh gesta ─────────────────────────────────────────────────────── */

test('krátké tažení pruh ukáže, ale po puštění nenačítá', () => {
  const p = createPull();
  p.start(200, { scrollY: 0 });
  const posun = p.move(230);
  assert.ok(posun > 0 && posun < PRAH, 'vidět je, spustit ne');
  assert.equal(p.spusti, false);
  assert.equal(p.end(), false);
});

test('dost dlouhé tažení po puštění načítá', () => {
  const p = createPull();
  p.start(200, { scrollY: 0 });
  p.move(400);
  assert.ok(p.spusti, 'přes práh se to má poznat UŽ BĚHEM tažení');
  assert.equal(p.end(), true);
});

test('🚨 po puštění je pruh zpátky na nule, ať se spustilo cokoli', () => {
  // Jinak by po načtení zůstal viset kus pruhu pod hlavičkou.
  const a = createPull();
  a.start(200, { scrollY: 0 }); a.move(400); a.end();
  assert.equal(a.posun, 0);
  assert.equal(a.drzi, false);

  const b = createPull();
  b.start(200, { scrollY: 0 }); b.move(210); b.end();
  assert.equal(b.posun, 0);
});

test('🚨 tažení nahoru gesto zruší — je to rolování', () => {
  // Bez toho by stačilo šoupnout prstem nahoru a zpátky dolů a pruh
  // by se vyhoupl uprostřed rolování seznamu.
  const p = createPull();
  p.start(200, { scrollY: 0 });
  assert.equal(p.move(150), null);
  assert.equal(p.drzi, false);
  assert.equal(p.move(400), null, 'zrušené gesto se samo neobnoví');
  assert.equal(p.end(), false);
});

test('🚨 mimo gesto se nedá spustit nic', () => {
  // Pořadí volání může rozhodit i systém (přerušený dotyk), ne jen chyba.
  const p = createPull();
  assert.equal(p.move(400), null);
  assert.equal(p.end(), false);
  p.start(200, { scrollY: 0 });
  p.move(400);
  p.zrus();
  assert.equal(p.end(), false);
});

test('nové gesto začíná od nuly, ne od zbytku po předchozím', () => {
  const p = createPull();
  p.start(200, { scrollY: 0 });
  p.move(400);
  p.end();
  p.start(500, { scrollY: 0 });
  assert.equal(p.posun, 0);
  assert.ok(p.move(520) < PRAH, 'měří se od nového začátku, ne od starého');
});

test('práh i strop se dají nastavit — čísla nejsou zabetonovaná', () => {
  const p = createPull({ prah: 10, max: 40 });
  p.start(0, { scrollY: 0 });
  p.move(20);
  assert.ok(p.spusti);
  assert.ok(p.posun < 40);
});

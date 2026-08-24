/**
 * Samotest trasy vzdušnou čarou.
 *
 * Bez sítě a bez prohlížeče — je to čistý zeměpis.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { pointBetween, greatCirclePoints, straightRoute } from '../web/lib/great-circle.js';
import { distanceM } from '../web/lib/eta.js';

const PRAHA = [50.0755, 14.4378];
const BRNO = [49.1951, 16.6068];
const NEW_YORK = [40.7128, -74.0060];

/* ============================================================
   BOD NA ORTODROMĚ
   ============================================================ */

test('krajní body sedí na start a cíl', () => {
  assert.deepEqual(pointBetween(PRAHA, BRNO, 0).map((n) => Math.round(n * 1e4) / 1e4), PRAHA);
  assert.deepEqual(pointBetween(PRAHA, BRNO, 1).map((n) => Math.round(n * 1e4) / 1e4), BRNO);
});

test('polovina cesty je opravdu v polovině', () => {
  const stred = pointBetween(PRAHA, BRNO, 0.5);
  const doStredu = distanceM(PRAHA, stred);
  const zeStredu = distanceM(stred, BRNO);
  assert.ok(Math.abs(doStredu - zeStredu) < 100, `${doStredu} vs ${zeStredu}`);
});

test('🚨 dálková trasa se OHÝBÁ k severu, není to úsečka na mapě', () => {
  // Změřeno: střed Praha → New York vychází na 54,7° s. š., lineární průměr
  // souřadnic na 45,4°. To je přes tisíc kilometrů rozdíl — a jiné počasí.
  const stred = pointBetween(PRAHA, NEW_YORK, 0.5);
  const linearniStred = (PRAHA[0] + NEW_YORK[0]) / 2;
  assert.ok(stred[0] > linearniStred + 8,
    `střed má být výrazně severněji: ${stred[0]} vs lineárně ${linearniStred}`);
  assert.ok(stred[0] > 54 && stred[0] < 56, `severní Atlantik: ${stred[0]}`);
});

test('shodné body nedají NaN', () => {
  // Dělení nulou v úhlu — trasa „odnikud nikam" musí projít.
  assert.deepEqual(pointBetween(PRAHA, PRAHA, 0.5), PRAHA);
});

/* ============================================================
   BODY PODÉL TRASY
   ============================================================ */

test('body pokryjí celou trasu s daným krokem', () => {
  const body = greatCirclePoints(PRAHA, BRNO, 25000);
  assert.ok(body.length >= 8, `bodů: ${body.length}`);
  assert.deepEqual(body[0].map((n) => Math.round(n * 1e4) / 1e4), PRAHA);
  for (let i = 1; i < body.length; i++) {
    assert.ok(distanceM(body[i - 1], body[i]) <= 25001, 'krok se nesmí protáhnout');
  }
});

test('nulová trasa vrátí jeden bod, ne prázdno ani nekonečno', () => {
  assert.deepEqual(greatCirclePoints(PRAHA, PRAHA), [PRAHA]);
});

/* ============================================================
   TRASA PRO ETA JÁDRO
   ============================================================ */

test('vrací přesně tvar, jaký čeká ETA jádro', () => {
  const t = straightRoute(PRAHA, BRNO, 200);
  assert.ok(Array.isArray(t.points) && t.points.length > 2);
  assert.ok(Number.isFinite(t.totalDistanceM) && Number.isFinite(t.totalDurationS));
  assert.equal(t.legs.length, 1);
  assert.equal(t.legs[0].distanceM, t.totalDistanceM);
});

test('vzdušná čára je kratší než po silnici', () => {
  // Praha → Brno je po dálnici ~205 km, vzdušnou čarou ~185.
  const t = straightRoute(PRAHA, BRNO, 200);
  const km = t.totalDistanceM / 1000;
  assert.ok(km > 180 && km < 195, `${km} km`);
});

test('čas vychází z rychlosti, kterou zadá uživatel', () => {
  const rychla = straightRoute(PRAHA, BRNO, 200);
  const pomala = straightRoute(PRAHA, BRNO, 100);
  assert.ok(Math.abs(pomala.totalDurationS - 2 * rychla.totalDurationS) < 1);
  // 185 km při 200 km/h ≈ 55 minut
  assert.ok(rychla.totalDurationS > 3000 && rychla.totalDurationS < 3600);
});

test('🚨 bez rychlosti se nic nevymýšlí', () => {
  // Kluzák, dron a trajekt se pohybují úplně jinak. Kdyby si appka číslo
  // vymyslela, byly by časy příjezdu — a tím celé počasí na trase —
  // nesmysl, který vypadá věrohodně.
  for (const spatna of [0, -50, null, undefined, NaN, 'rychle']) {
    assert.equal(straightRoute(PRAHA, BRNO, spatna), null);
  }
});

test('nesmyslné body vrátí null, ne rozbitou trasu', () => {
  assert.equal(straightRoute(null, BRNO, 100), null);
  assert.equal(straightRoute(PRAHA, 'Brno', 100), null);
});

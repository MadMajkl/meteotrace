/**
 * Samotest času odjezdu — „teď", nebo naplánovaný (`R26`).
 *
 * Spuštění:  npm run selftest:logic
 *
 * ⚠️ Časy se skládají přes `new Date(r, m, d, h, min)`, tedy v MÍSTNÍM čase
 * stroje, na kterém test běží. Modul pracuje v místním čase záměrně (vstup
 * `datetime-local` pásmo nenese), takže test musí taky — jinak by prošel
 * v Praze a spadl na serveru v UTC.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveDeparture, clampPlanned, departureOffsets, forecastDaysFor, defaultPlanned,
  toInputValue, fromInputValue, inputBounds,
  MAX_AHEAD_DAYS, GRACE_MIN, OFFSETS_NOW,
} from '../web/lib/departure.js';

const MIN = 60000;
const HOD = 60 * MIN;
const DEN = 24 * HOD;
const kdy = (r, m, d, h = 0, min = 0) => new Date(r, m - 1, d, h, min).getTime();

const TED = kdy(2026, 9, 17, 17, 44);

/* ── od kdy se počítá ───────────────────────────────────────────────── */

test('bez plánu se počítá od teď a nic se nehlásí', () => {
  assert.deepEqual(resolveDeparture(null, TED), { ms: TED, planned: false, expired: false });
  assert.deepEqual(resolveDeparture(undefined, TED), { ms: TED, planned: false, expired: false });
  assert.deepEqual(resolveDeparture(NaN, TED), { ms: TED, planned: false, expired: false });
});

test('naplánovaný odjezd v budoucnu platí, jak byl zadán', () => {
  const zitra = kdy(2026, 9, 18, 8, 0);
  assert.deepEqual(resolveDeparture(zitra, TED), { ms: zitra, planned: true, expired: false });
});

test('🚨 odjezd, který mezitím minul, se POZNÁ — nepočítá se tiše od teď', () => {
  const vcera = kdy(2026, 9, 16, 8, 0);
  const r = resolveDeparture(vcera, TED);
  assert.equal(r.expired, true, 'volající musí dostat důvod, aby to mohl říct');
  assert.equal(r.planned, false);
  assert.equal(r.ms, TED);
});

test('🚨 plán vyplněný před chvílí nepropadne — tolerance na vyplnění formuláře', () => {
  // Vybráno 17:45 v 17:44, spočítáno v 17:47.
  const r = resolveDeparture(kdy(2026, 9, 17, 17, 45), kdy(2026, 9, 17, 17, 47));
  assert.equal(r.expired, false);
  assert.equal(r.planned, true, 'formulář má plán dál ukazovat');
  assert.equal(r.ms, kdy(2026, 9, 17, 17, 47), 'ale počítá se od teď, ne z minulosti');
});

test('za hranou tolerance už plán propadne', () => {
  const r = resolveDeparture(TED - (GRACE_MIN + 1) * MIN, TED);
  assert.equal(r.expired, true);
});

/* ── meze zadání ────────────────────────────────────────────────────── */

test('čas v rozsahu projde beze změny a bez důvodu', () => {
  const zitra = kdy(2026, 9, 18, 8, 0);
  assert.deepEqual(clampPlanned(zitra, TED), { ms: zitra, reason: null });
});

test('🚨 ručně napsaná minulost se srovná na nejbližší krok A ŘEKNE PROČ', () => {
  const r = clampPlanned(kdy(2026, 9, 10, 8, 0), TED);
  assert.equal(r.reason, 'past');
  assert.equal(r.ms, kdy(2026, 9, 17, 17, 45), '17:44 → 17:45');
});

test('🚨 víc než týden dopředu se srovná na konec rozsahu A ŘEKNE PROČ', () => {
  const r = clampPlanned(kdy(2026, 10, 30, 8, 0), TED);
  assert.equal(r.reason, 'tooFar');
  assert.ok(r.ms <= TED + MAX_AHEAD_DAYS * DEN);
  assert.ok(r.ms > TED + MAX_AHEAD_DAYS * DEN - 15 * MIN);
});

test('vymazaný vstup není chyba, je to návrat k „teď"', () => {
  assert.deepEqual(clampPlanned(null, TED), { ms: null, reason: null });
});

/* ── posuny ─────────────────────────────────────────────────────────── */

test('u „teď" se srovnává jen dopředu, tak jako dosud', () => {
  assert.deepEqual(departureOffsets({ ms: TED, planned: false }, TED), OFFSETS_NOW);
  assert.deepEqual(OFFSETS_NOW, [0, 60, 120, 180]);
});

test('🚨 u plánu se nabízí i hodina DŘÍV — „vyraž v sedm a bouřku minneš"', () => {
  const r = departureOffsets({ ms: kdy(2026, 9, 18, 8, 0), planned: true }, TED);
  assert.deepEqual(r, [-60, 0, 60, 120]);
});

test('🚨 posun do minulosti se nenabízí — ta rada by nešla poslechnout', () => {
  // Plán za dvacet minut: o hodinu dřív by bylo před čtyřiceti minutami.
  const r = departureOffsets({ ms: TED + 20 * MIN, planned: true }, TED);
  assert.deepEqual(r, OFFSETS_NOW);
});

test('variant je pořád čtyři — víc by na telefonu vyjelo z řádku', () => {
  for (const posun of [20 * MIN, 2 * HOD, 3 * DEN]) {
    assert.equal(departureOffsets({ ms: TED + posun, planned: true }, TED).length, 4);
  }
});

/* ── kolik dní předpovědi ───────────────────────────────────────────── */

test('krátká cesta teď zůstává na třech dnech — sdílí cache s dosavadními dotazy', () => {
  assert.equal(forecastDaysFor({ departureMs: TED, durationS: 2 * 3600, offsetsMin: OFFSETS_NOW, nowMs: TED }), 3);
});

test('🚨 odjezd za šest dní si řekne o dost dní, aby body nepadly za konec pole', () => {
  const odjezd = kdy(2026, 9, 23, 8, 0);
  const dny = forecastDaysFor({ departureMs: odjezd, durationS: 3 * 3600, offsetsMin: [-60, 0, 60, 120], nowMs: TED });
  // Dnes je 17. 9.; poslední bod je 23. 9. kolem 13:00 → potřeba pole do 23. 9. včetně.
  assert.ok(dny >= 7, `stačí pole do 23. 9., dostal jsem ${dny} dní`);
  assert.ok(dny <= 8, `nemá se stahovat zbytečně víc: ${dny}`);
});

test('dlouhá pěší cesta připočítá i svou délku', () => {
  const kratka = forecastDaysFor({ departureMs: TED, durationS: 3600, offsetsMin: [0], nowMs: TED });
  const dlouha = forecastDaysFor({ departureMs: TED, durationS: 60 * 3600, offsetsMin: [0], nowMs: TED });
  assert.ok(dlouha > kratka);
});

test('víc než 16 dní Open-Meteo nedá, tak se o ně ani neříká', () => {
  assert.equal(forecastDaysFor({ departureMs: TED + 20 * DEN, durationS: 0, offsetsMin: [0], nowMs: TED }), 16);
});

/* ── výchozí plán ───────────────────────────────────────────────────── */

test('„Naplánovat" nabídne nejbližší celou hodinu aspoň za půl hodiny', () => {
  assert.equal(defaultPlanned(kdy(2026, 9, 17, 17, 44)), kdy(2026, 9, 17, 19, 0));
  assert.equal(defaultPlanned(kdy(2026, 9, 17, 17, 10)), kdy(2026, 9, 17, 18, 0));
  assert.equal(defaultPlanned(kdy(2026, 9, 17, 23, 50)), kdy(2026, 9, 18, 1, 0), 'přes půlnoc');
});

/* ── vstup datetime-local ───────────────────────────────────────────── */

test('hodnota vstupu je v místním čase a vrací se na totéž', () => {
  const ms = kdy(2026, 9, 18, 8, 5);
  assert.equal(toInputValue(ms), '2026-09-18T08:05');
  assert.equal(fromInputValue('2026-09-18T08:05'), ms);
});

test('vstup se sekundami (některé prohlížeče je přidají) se přečte taky', () => {
  assert.equal(fromInputValue('2026-09-18T08:05:00'), kdy(2026, 9, 18, 8, 5));
  assert.equal(fromInputValue('2026-09-18T08:05:00.000'), kdy(2026, 9, 18, 8, 5));
});

test('🚨 datum bez času se NEPŘIJME — Date by ho četl jako UTC, ne místní čas', () => {
  assert.equal(fromInputValue('2026-09-18'), null);
});

test('prázdno, nesmysl a neexistující datum vrací null', () => {
  assert.equal(fromInputValue(''), null);
  assert.equal(fromInputValue(null), null);
  assert.equal(fromInputValue('zítra v osm'), null);
  assert.equal(fromInputValue('2026-02-31T08:00'), null, '31. února Date tiše přesune na březen');
});

test('meze vstupu: od nejbližšího čtvrthodinového kroku do týdne dopředu', () => {
  const { min, max } = inputBounds(TED);
  assert.equal(min, '2026-09-17T17:45');
  assert.equal(max, '2026-09-24T17:30', '17:44 + 7 dní, zaokrouhleno DOLŮ, ať max platí');
});

test('přesně na kroku se nezaokrouhluje nahoru', () => {
  assert.equal(inputBounds(kdy(2026, 9, 17, 18, 0)).min, '2026-09-17T18:00');
});

/**
 * Samotest „je slunce vidět?".
 *
 * 🚨 Michal 27. 8. 2026 v 18:55: *„pokud já vidím slunce, ty mi nemůžeš radit,
 * kam za sluncem, ale naopak kde prší."*
 *
 * ⚠️ Čísla v testu nejsou vymyšlená — jsou to hodnoty NAMĚŘENÉ ten večer
 * v Horšovském Týně. Test proto neověřuje jen kód, ale i to, že práh sedí
 * na skutečný případ, kvůli kterému vznikl.
 */

'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';

import { slunceProsvita, jeSlunecno, weatherKeyWithClouds } from '../web/lib/weather-code.js';

/** Horšovský Týn, 27. 8. 2026 — přímé a celkové záření po čtvrthodinách. */
const VECER = [
  { cas: '17:45', direct: 190, total: 300, slunce: true },
  { cas: '18:15', direct: 145, total: 227, slunce: true },
  { cas: '18:45', direct: 48, total: 135, slunce: true },   // Michal viděl slunce
  { cas: '19:15', direct: 3, total: 63, slunce: false },
  { cas: '19:45', direct: 1, total: 21, slunce: false },
];

test('🚨 práh sedí na skutečně naměřený večer', () => {
  for (const v of VECER) {
    assert.equal(
      slunceProsvita({ direct: v.direct, total: v.total, isDay: true }), v.slunce,
      `${v.cas}: ${v.direct}/${v.total} W/m²`,
    );
  }
});

test('🚨 v noci slunce nesvítí, ať čísla říkají cokoli', () => {
  assert.equal(slunceProsvita({ direct: 900, total: 1000, isDay: false }), false);
});

test('🚨 chybějící záření znamená „nevíme", ne „nesvítí"', () => {
  // Tvrdit tmu jen proto, že nám chybí údaj, je ta horší ze dvou chyb:
  // appka by pak radila, kam za sluncem, člověku stojícímu na slunci.
  assert.equal(slunceProsvita({ isDay: true }), null);
  assert.equal(slunceProsvita({ direct: 100, isDay: true }), null);
});

test('za soumraku se o slunečním svitu nemluví', () => {
  // Obě čísla jsou maličká a jejich podíl začne skákat.
  assert.equal(slunceProsvita({ direct: 4, total: 8, isDay: true }), false);
});

/* ============================================================
   ZÁLOHA BEZ ZÁŘENÍ
   ============================================================ */

test('bez záření rozhodne oblačnost po patrech', () => {
  assert.equal(jeSlunecno({ code: 0 }), true, 'jasno');
  assert.equal(jeSlunecno({ code: 3, low: 0, mid: 16, high: 75 }), true, 'jen vysoký závoj');
  assert.equal(jeSlunecno({ code: 3, low: 90, mid: 20, high: 0 }), false, 'nízká oblačnost');
});

test('🚨 záření přebíjí oblačnost, ne naopak', () => {
  // Sto procent oblačnosti a přesto svítí — přesně případ z 18:45.
  const svitiPresMraky = jeSlunecno({
    code: 3, low: 0, mid: 42, high: 100, direct: 48, total: 135, isDay: true,
  });
  assert.equal(svitiPresMraky, true);

  // A naopak: papírově řídká oblačnost, ale žádné přímé záření.
  const nesviti = jeSlunecno({
    code: 2, low: 10, mid: 0, high: 20, direct: 2, total: 90, isDay: true,
  });
  assert.equal(nesviti, false);
});

/* ============================================================
   JAK SE TOMU ŘÍKÁ NA OBRAZOVCE
   ============================================================ */

test('🚨 „zataženo", kterým prosvítá slunce, se tak nejmenuje', () => {
  assert.equal(weatherKeyWithClouds({ code: 3, direct: 48, total: 135, isDay: true }), 'veiledSun');
  assert.equal(weatherKeyWithClouds({ code: 3, direct: 3, total: 63, isDay: true }), 'overcast');
});

test('🚨 u deště a bouřky se popis nepřepisuje ani při slunci', () => {
  // Přeháňka se sluncem existuje, ale „prší" je ta důležitější polovina.
  assert.equal(weatherKeyWithClouds({ code: 61, direct: 200, total: 300, isDay: true }), 'rain');
  assert.equal(weatherKeyWithClouds({ code: 95, direct: 200, total: 300, isDay: true }), 'thunderstorm');
});

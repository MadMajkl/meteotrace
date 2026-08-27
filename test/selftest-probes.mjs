/**
 * Sondy do okolí — kde nejblíž prší, kam za sluncem.
 *
 * 🚨 Michalův nápad 26. 8. 2026: *„nejbližší déšť k trase je <místo>"* /
 * *„za sluncem bys musel jet až <kam>"*.
 *
 * Testuje se to, na čem věta stojí: že sondy leží tam, kam se poslaly,
 * a hlavně že se ODPOVĚDI PŘIŘADÍ SPRÁVNÝM BODŮM. Kdyby se pořadí rozešlo,
 * appka by poslala člověka za sluncem přesně na opačnou stranu — a nešlo
 * by to poznat, protože věta by vypadala úplně stejně.
 */

'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  probePoints, nearestProbe, jeSrazka, jeJasno, probeDistanceM, PRSTENCE_KM,
} from '../web/lib/probes.js';
import { distanceM } from '../web/lib/eta.js';

/** Horšovský Týn — Michalovo domácí místo, takže se na tom dobře hledají chyby. */
const HT = [49.5311, 12.9436];

/* ============================================================
   ROZESETÍ SOND
   ============================================================ */

test('sond je osm směrů krát počet prstenců', () => {
  assert.equal(probePoints(HT).length, 8 * PRSTENCE_KM.length);
});

test('sonda leží opravdu tak daleko, jak se poslala', () => {
  for (const s of probePoints(HT)) {
    const skutecna = distanceM(HT, [s.lat, s.lon]);
    // Souřadnice se zaokrouhlují na čtyři desetiny (kvůli cache), takže
    // se pár set metrů rozdílu tolerovat musí. Procento je bohatě dost.
    assert.ok(Math.abs(skutecna - s.distanceM) < s.distanceM * 0.01,
      `${s.dirKey} ${s.distanceM} m vs ${Math.round(skutecna)} m`);
  }
});

test('🚨 sever je na severu a východ na východě', () => {
  // Prohozený sinus s kosinem je klasická chyba, kterou nic jiného neodhalí:
  // vzdálenosti by seděly, jen by celý věnec byl otočený.
  const podle = Object.fromEntries(
    probePoints(HT, [50]).map((s) => [s.dirKey, s]),
  );
  assert.ok(podle.n.lat > HT[0], 'sever musí být severněji');
  assert.ok(podle.s.lat < HT[0], 'jih musí být jižněji');
  assert.ok(podle.e.lon > HT[1], 'východ musí být východněji');
  assert.ok(podle.w.lon < HT[1], 'západ musí být západněji');
  // Čistě východní sonda nemá měnit šířku (v rámci zaokrouhlení).
  assert.ok(Math.abs(podle.e.lat - HT[0]) < 0.02, 'východ nemá stoupat na sever');
});

test('bez použitelného středu se nesonduje', () => {
  assert.deepEqual(probePoints(null), []);
  assert.deepEqual(probePoints([NaN, 12]), []);
});

/* ============================================================
   CO SE POČÍTÁ JAKO DÉŠŤ A CO JAKO JASNO
   ============================================================ */

test('srážka se pozná z kódu i z naměřeného množství', () => {
  assert.ok(jeSrazka({ weather_code: 61 }), 'déšť');
  assert.ok(jeSrazka({ weather_code: 75 }), 'sněžení');
  assert.ok(jeSrazka({ weather_code: 95 }), 'bouřka');
  // Kód mlhy, ale prší — věří se číslu.
  assert.ok(jeSrazka({ weather_code: 45, precipitation: 0.5 }));
  assert.ok(!jeSrazka({ weather_code: 3, precipitation: 0 }), 'zataženo není déšť');
  assert.ok(!jeSrazka(null));
});

test('jasno je jen jasno a skoro jasno', () => {
  assert.ok(jeJasno({ weather_code: 0 }));
  assert.ok(jeJasno({ weather_code: 1 }));
  assert.ok(!jeJasno({ weather_code: 2 }), 'polojasno ještě není slunce');
  assert.ok(!jeJasno({ weather_code: 3 }));
});

/* ============================================================
   PŘIŘAZENÍ ODPOVĚDÍ
   ============================================================ */

test('najde se nejbližší vyhovující sonda, ne první v pořadí', () => {
  const sondy = probePoints(HT);
  const stavy = sondy.map(() => ({ weather_code: 0 }));
  // Prší na dalekém severu i na blízkém jihu — vyhrát musí jih.
  stavy[sondy.findIndex((s) => s.dirKey === 'n' && s.distanceM > 100000)] = { weather_code: 61 };
  const blizky = sondy.findIndex((s) => s.dirKey === 's' && s.distanceM < 30000);
  stavy[blizky] = { weather_code: 61 };

  const nalez = nearestProbe(sondy, stavy, jeSrazka);
  assert.equal(nalez.dirKey, 's');
  assert.equal(nalez.distanceM, sondy[blizky].distanceM);
});

test('když nic nevyhovuje, vrátí se nic — a to je taky odpověď', () => {
  const sondy = probePoints(HT);
  const stavy = sondy.map(() => ({ weather_code: 3 }));
  assert.equal(nearestProbe(sondy, stavy, jeSrazka), null);
});

test('🚨 nesouhlasný počet odpovědí se ODMÍTNE, ne přiřadí', () => {
  // Kdyby se odpovědi přiřadily „jak to vyjde", ukázala by appka déšť na
  // opačné straně a tvářila by se úplně stejně sebejistě.
  const sondy = probePoints(HT);
  assert.equal(nearestProbe(sondy, [{ weather_code: 61 }], jeSrazka), null);
  assert.equal(nearestProbe(sondy, null, jeSrazka), null);
});

test('vzdálenost sondy se počítá ze skutečných souřadnic', () => {
  const sonda = probePoints(HT, [60])[0];
  const m = probeDistanceM(HT, sonda);
  assert.ok(Math.abs(m - 60000) < 600, `${m} m`);
  assert.equal(probeDistanceM(null, sonda), null);
});

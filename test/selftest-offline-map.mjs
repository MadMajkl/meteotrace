/**
 * Samotest offline mapy oblasti (`web/lib/offline-map.js`, `R44`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  lonNaX, latNaY, prunik, rozsah, planStazeni, pocet, dlazdice, vyberZoomu,
  klic, rozeberAdresu, velikost, MAX_DLAZDIC, NEJMIN_ZOOM,
} from '../web/lib/offline-map.js';

const CZ = 'https://dlazdice.meteotrace.eu/cz.pmtiles';
const SVET = 'https://dlazdice.meteotrace.eu/svet-z8.pmtiles';
const ARCHIVY = [
  { url: SVET, odZoomu: 0, minzoom: 0, maxzoom: 8 },
  { url: CZ, odZoomu: 9, minzoom: 0, maxzoom: 14, bounds: [11.5, 48.4, 19.2, 51.2] },
];
// Okolí Horšovského Týna, asi 14 × 11 km.
const TYN = [12.85, 49.48, 13.04, 49.58];

test('dlaždice Web Mercatoru: Praha na z14 je 8 849 / 5 551 (ověřeno vzorcem s asinh)', () => {
  assert.equal(lonNaX(14.4378, 14), 8849);
  assert.equal(latNaY(50.0755, 14), 5551);
  assert.equal(lonNaX(-180, 0), 0);
  assert.equal(latNaY(89, 3), 0, 'pól se sevře na okraj');
});

test('řádky rostou na jih — sever oblasti je menší y', () => {
  const r = rozsah(TYN, 12);
  assert.ok(r.y0 <= r.y1 && r.x0 <= r.x1);
});

test('plán: svět jen do z8, Česko od z9 — tak, jak je kreslí styl', () => {
  const plan = planStazeni(TYN, ARCHIVY, 14);
  assert.deepEqual([...new Set(plan.filter((p) => p.url === SVET).map((p) => p.z))], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...new Set(plan.filter((p) => p.url === CZ).map((p) => p.z))], [9, 10, 11, 12, 13, 14]);
});

test('oblast mimo podrobný archiv stahuje jen svět', () => {
  const chorvatsko = [15.9, 43.4, 16.5, 43.7];
  const plan = planStazeni(chorvatsko, ARCHIVY, 14);
  assert.ok(plan.every((p) => p.url === SVET));
  assert.equal(prunik(chorvatsko, ARCHIVY[1].bounds), null);
});

test('počet sedí na výčet dlaždic a klíče jsou jedinečné', () => {
  const plan = planStazeni(TYN, ARCHIVY, 13);
  const vse = [...dlazdice(plan)];
  assert.equal(vse.length, pocet(plan));
  assert.equal(new Set(vse.map((d) => klic(d.url, d.z, d.x, d.y))).size, vse.length);
});

test('🚨 velká oblast: méně podrobná celá, ne podrobná kousek — a příliš velká vůbec', () => {
  const tyn = vyberZoomu(TYN, ARCHIVY);
  assert.equal(tyn.doZoomu, 14, 'malé okolí jde celé v plném detailu');
  assert.ok(tyn.dlazdic < 1000);
  const kraj = [12.3, 49.0, 13.9, 50.2];   // Plzeňský kraj zhruba
  const k = vyberZoomu(kraj, ARCHIVY);
  assert.ok(k && k.doZoomu < 14 && k.dlazdic <= MAX_DLAZDIC, JSON.stringify(k));
  // Celé Česko se vejde na z12 (~4 700 dlaždic) — a střední Evropa už ne ani na z11.
  assert.equal(vyberZoomu([12, 48.6, 18.9, 51], ARCHIVY).doZoomu, 12);
  const evropa = [{ ...ARCHIVY[1], bounds: [5, 45, 25, 55] }];
  assert.equal(vyberZoomu([5, 45, 25, 55], evropa), null, `střední Evropa se nevejde ani na z${NEJMIN_ZOOM}`);
});

test('adresa protokolu: dlaždice, popis archivu, nesmysl', () => {
  assert.deepEqual(rozeberAdresu(`pmtiles://${CZ}/14/8848/5551`), { url: CZ, z: 14, x: 8848, y: 5551 });
  assert.deepEqual(rozeberAdresu(`pmtiles://${CZ}`), { url: CZ, json: true });
  assert.equal(rozeberAdresu('https://jinam'), null);
  assert.equal(rozeberAdresu('pmtiles://'), null);
});

test('velikost lidsky', () => {
  assert.equal(velikost(64 * 1024 * 1024), '64 MB');
  assert.equal(velikost(3.25 * 1024 * 1024), '3,3 MB');
  assert.equal(velikost(850 * 1024, 'en'), '850 kB');
  assert.equal(velikost(10), '1 kB');
});

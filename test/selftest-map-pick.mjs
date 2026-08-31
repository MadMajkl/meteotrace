/**
 * Samotest výběru místa klepnutím do mapy.
 *
 * Bez prohlížeče a bez sítě — modul dostane popisky, které mapa vykreslila,
 * a rozhodne, jak se vybrané místo jmenuje.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { nearestLabel, coordName, placeFromMap, MAX_VZDALENOST_M, klepnutiDoMapy } from '../web/lib/map-pick.js';

const PRAHA = { name: 'Praha', lat: 50.0875, lon: 14.4213 };
const BRNO = { name: 'Brno', lat: 49.1951, lon: 16.6068 };

/* ============================================================
   NEJBLIŽŠÍ POPISEK
   ============================================================ */

test('vybere se nejbližší popisek, ne první v pořadí', () => {
  const bod = [49.20, 16.60];
  assert.equal(nearestLabel([PRAHA, BRNO], bod)?.name, 'Brno');
});

test('🚨 vzdálený popisek se nepoužije — radši souřadnice než cizí jméno', () => {
  // Klepnutí doprostřed lesa nesmí dostat jméno města dvacet kilometrů daleko.
  // Uživatel by si uložil „Klatovy", přestože ukázal jinam.
  const dalekoOdPrahy = [50.5, 14.9];
  assert.equal(nearestLabel([PRAHA], dalekoOdPrahy), null);
});

test('hranice se drží: těsně uvnitř ano, těsně venku ne', () => {
  const stred = [50.0, 15.0];
  const blizko = { name: 'Blízké', lat: 50.0, lon: 15.02 };     // ~1,4 km
  const daleko = { name: 'Daleké', lat: 50.0, lon: 15.10 };     // ~7 km
  assert.equal(nearestLabel([blizko], stred)?.name, 'Blízké');
  assert.equal(nearestLabel([daleko], stred), null);
  assert.ok(MAX_VZDALENOST_M > 1400 && MAX_VZDALENOST_M < 7000, 'strop dává smysl');
});

test('popisek bez jména nebo bez polohy se přeskočí', () => {
  const bod = [50.0875, 14.4213];
  const spatne = [
    { name: '', lat: 50.0875, lon: 14.4213 },
    { name: '   ', lat: 50.0875, lon: 14.4213 },
    { name: 'Bez polohy', lat: null, lon: 14.4 },
    null,
  ];
  assert.equal(nearestLabel(spatne, bod), null);
  assert.equal(nearestLabel([...spatne, PRAHA], bod)?.name, 'Praha');
});

test('nesmyslné vstupy nespadnou', () => {
  assert.equal(nearestLabel(null, [50, 14]), null);
  assert.equal(nearestLabel([PRAHA], null), null);
  assert.equal(nearestLabel([PRAHA], [NaN, 14]), null);
});

/* ============================================================
   JMÉNO ZE SOUŘADNIC
   ============================================================ */

test('souřadnice se zkrátí na čtyři desetinná místa', () => {
  assert.equal(coordName(50.087512345, 14.421298765), '50.0875, 14.4213');
});

test('🚨 nula je platná souřadnice, ne chybějící hodnota', () => {
  // Tentýž chyták jako u uložených míst: Guinejský záliv existuje.
  assert.equal(coordName(0, 0), '0.0000, 0.0000');
  assert.equal(coordName(NaN, 14), '');
});

/* ============================================================
   MÍSTO Z KLEPNUTÍ
   ============================================================ */

test('klepnutí u města dostane jméno města', () => {
  const misto = placeFromMap([50.088, 14.422], [PRAHA]);
  assert.equal(misto.name, 'Praha');
  assert.equal(misto.lat, 50.088, 'poloha zůstává tam, kam se kleplo');
  assert.equal(misto.lon, 14.422);
});

test('🚨 poloha se NEPŘESUNE na město, jehož jméno se použilo', () => {
  // Jméno je jen popisek. Kdyby se vzala i poloha města, počasí by se
  // ukázalo pro střed Prahy, přestože uživatel ukázal na okraj.
  const naOkraji = [50.1000, 14.4400];        // ~2 km od popisku Prahy
  const misto = placeFromMap(naOkraji, [PRAHA]);
  assert.equal(misto.name, 'Praha');
  assert.deepEqual([misto.lat, misto.lon], naOkraji, 'poloha zůstává tam, kam se kleplo');
  assert.notEqual(misto.lat, PRAHA.lat);
});

test('klepnutí do prázdna dostane souřadnice', () => {
  const misto = placeFromMap([49.60, 15.20], []);
  assert.equal(misto.name, '49.6000, 15.2000');
});

test('místo z mapy je poznat — appka podle toho nechá pohled být', () => {
  assert.equal(placeFromMap([50, 14], []).fromMap, true);
});

test('země se nehádá', () => {
  // Popisek sídla ji nenese; vymýšlet si ji by znamenalo tvrdit něco,
  // co nevíme.
  assert.equal(placeFromMap([50, 14], [PRAHA]).country, null);
});

test('nesmyslné klepnutí vrátí null, ne rozbité místo', () => {
  for (const spatny of [null, undefined, [], [NaN, 14], ['50', '14']]) {
    assert.equal(placeFromMap(spatny, [PRAHA]), null);
  }
});

/* ── co udělá klepnutí do mapy ────────────────────────────────────────── */

test('🚨 klepnutí do mapy: nápověda říká, co se OPRAVDU stane', () => {
  // Do 31. 8. 2026 se nad hotovou trasou psalo „zadáš start, dalším cíl" —
  // jenže start byl zadaný, takže klepnutí přepisovalo CÍL. Michal: „je tam
  // nepravda, když koukám na hotovou trasu."
  const bod = { lat: 50, lon: 14 };

  assert.deepEqual(klepnutiDoMapy({}),
    { pole: 'from', klic: 'route.pickHint' }, 'prázdný formulář: první klepnutí je start');

  assert.deepEqual(klepnutiDoMapy({ from: bod }),
    { pole: 'to', klic: 'route.pickHintTo' }, 'start zadaný: další klepnutí je cíl');

  assert.deepEqual(klepnutiDoMapy({ from: bod, to: bod }),
    { pole: 'to', klic: null }, 'hotová trasa: NIC se netvrdí');
});

test('🚨 nad hotovou trasou se o klepnutí MLČÍ', () => {
  // Klepnutí sice přepíše pole „Kam", ale na obrazovce se nezmění nic —
  // mapa dál kreslí starou trasu a přepočítá se až tlačítkem. Věta
  // „Klepnutím do mapy změníš cíl" tedy slibovala změnu, kterou uživatel
  // neuvidí. Michal ji vrátil dvakrát; podruhé: „vyhoď už tu lež."
  const bod = { lat: 50, lon: 14 };
  assert.equal(klepnutiDoMapy({ from: bod, to: bod }).klic, null);
  // ⚠️ Chování se tím NEMĚNÍ — cíl se pořád přepisuje, jen se to neslibuje.
  assert.equal(klepnutiDoMapy({ from: bod, to: bod }).pole, 'to');
});

test('🚨 pole i věta chodí z jednoho výrazu — nemají jak se rozejít', () => {
  // Kdyby si nápověda počítala vlastní podmínku, appka by slibovala jedno
  // a dělala druhé. Tenhle test drží obojí u sebe: ke každému poli patří
  // právě jedna věta.
  const bod = { lat: 50, lon: 14 };
  const pary = [
    [{}, 'from', 'route.pickHint'],
    [{ from: bod }, 'to', 'route.pickHintTo'],
    [{ from: bod, to: bod }, 'to', null],
    [{ to: bod }, 'from', 'route.pickHint'],   // jen cíl: chybí start, tak se plní start
  ];
  for (const [route, pole, klic] of pary) {
    const v = klepnutiDoMapy(route);
    assert.equal(v.pole, pole);
    assert.equal(v.klic, klic);
  }
});

test('věty ke klepnutí existují v obou jazycích', async () => {
  const cs = (await import('../web/lib/lang/cs.js')).default;
  const en = (await import('../web/lib/lang/en.js')).default;
  const bod = { lat: 50, lon: 14 };
  for (const route of [{}, { from: bod }, { from: bod, to: bod }]) {
    const k = klepnutiDoMapy(route).klic;
    if (!k) continue;                      // nad hotovou trasou se nic nepíše
    const [obor, klic] = k.split('.');
    assert.ok(cs[obor]?.[klic], `chybí český text pro ${obor}.${klic}`);
    assert.ok(en[obor]?.[klic], `chybí anglický text pro ${obor}.${klic}`);
  }
});

/* ── mezibody z mapy ──────────────────────────────────────────────────── */

test('🚨 prázdný mezibod má přednost před přepsáním cíle', () => {
  // Kdo klepne na „Přidat mezibod", řekl tím, co chce zadat jako další.
  // Do 31. 8. 2026 mu klepnutí do mapy místo toho přepsalo cíl.
  const b = { lat: 50, lon: 14 };
  assert.deepEqual(klepnutiDoMapy({ from: b, to: b, via: [null] }),
    { pole: 0, klic: 'route.pickHintVia' });
});

test('bere se PRVNÍ prázdný mezibod, ne poslední', () => {
  // Pole jsou v pořadí cesty a člověk je vyplňuje odshora.
  const b = { lat: 50, lon: 14 };
  assert.equal(klepnutiDoMapy({ from: b, to: b, via: [null, null] }).pole, 0);
  assert.equal(klepnutiDoMapy({ from: b, to: b, via: [b, null] }).pole, 1);
});

test('když jsou mezibody vyplněné, klepnutí zase mění cíl a mlčí o tom', () => {
  const b = { lat: 50, lon: 14 };
  assert.deepEqual(klepnutiDoMapy({ from: b, to: b, via: [b] }),
    { pole: 'to', klic: null });
});

test('🚨 start a cíl mají přednost před mezibodem', () => {
  // Prázdný mezibod nesmí přeskočit nevyplněný start ani cíl — jinak by
  // vznikla trasa, která má zastávku, ale neví odkud kam.
  const b = { lat: 50, lon: 14 };
  assert.equal(klepnutiDoMapy({ via: [null] }).pole, 'from');
  assert.equal(klepnutiDoMapy({ from: b, via: [null] }).pole, 'to');
});

test('věta o mezibodu existuje v obou jazycích', async () => {
  const cs = (await import('../web/lib/lang/cs.js')).default;
  const en = (await import('../web/lib/lang/en.js')).default;
  for (const klic of ['pickHintVia', 'pickedVia']) {
    assert.ok(cs.route?.[klic], `chybí český text pro route.${klic}`);
    assert.ok(en.route?.[klic], `chybí anglický text pro route.${klic}`);
  }
});

/**
 * Samotest výběru místa klepnutím do mapy.
 *
 * Bez prohlížeče a bez sítě — modul dostane popisky, které mapa vykreslila,
 * a rozhodne, jak se vybrané místo jmenuje.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { nearestLabel, coordName, placeFromMap, MAX_VZDALENOST_M } from '../web/lib/map-pick.js';

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

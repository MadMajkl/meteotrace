/**
 * Samotest „kdy to bude".
 *
 * 🚨 Vada, kvůli které modul vznikl, byla v tom, co se NENAPSALO: čas
 * příjezdu bez data. Testy proto netvrdí jen „vrátilo se něco", ale hlídají
 * hlavně **hranice, kde se den mění** — půlnoc, změnu času a cizí pásmo.
 * Přesně tam se dá udělat chyba, kterou nikdo nenahlásí: číslo bude o jedna
 * vedle a bude vypadat správně.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { dayShift, clock, dayMonth, momentParts } from '../web/lib/when.js';

const PRAHA = 'Europe/Prague';
const ms = (iso) => Date.parse(iso);

test('týž den je posun nula, i když je mezi tím celý den', () => {
  assert.equal(dayShift(ms('2026-09-12T06:00:00Z'), ms('2026-09-12T21:00:00Z'), PRAHA), 0);
});

test('🚨 pět hodin přes půlnoc je JIŽ ZÍTRA, i když je to jen pět hodin', () => {
  // Tohle je celý smysl modulu: nerozhoduje délka cesty, ale to, jestli se
  // po cestě překlopil kalendář. Na kole se první půlnoc potká po pár hodinách.
  const odjezd = ms('2026-09-12T20:00:00Z');   // 22:00 v Praze
  const prijezd = ms('2026-09-13T01:00:00Z');  // 03:00 v Praze, druhý den
  assert.equal(dayShift(prijezd, odjezd, PRAHA), 1);
});

test('🚨 dvacet tři hodin nemusí být zítra a jedna hodina může být', () => {
  // Kdyby se počítalo dělením 24 hodinami, obojí by vyšlo obráceně.
  const rano = ms('2026-09-12T05:00:00Z');     // 07:00 v Praze
  assert.equal(dayShift(ms('2026-09-13T03:00:00Z'), rano, PRAHA), 1,  // 05:00 druhý den
    '22 hodin, ale už je druhý den');
  const vecer = ms('2026-09-12T21:30:00Z');    // 23:30 v Praze
  assert.equal(dayShift(ms('2026-09-12T22:30:00Z'), vecer, PRAHA), 1, // 00:30
    'hodina, a přesto zítra');
});

test('🚨 den se počítá v pásmu CÍLE, ne prohlížeče', () => {
  // 00:30 v Praze je 23:30 předešlého dne v Lisabonu. Kdo plánuje cestu
  // po půlnoci, nesmí u lisabonského bodu vidět zítřejší datum.
  const okamzik = ms('2026-09-11T22:30:00Z');  // 00:30 Praha / 23:30 Lisabon
  const refer = ms('2026-09-11T10:00:00Z');    // téhož dne dopoledne
  assert.equal(dayShift(okamzik, refer, 'Europe/Prague'), 1);
  assert.equal(dayShift(okamzik, refer, 'Europe/Lisbon'), 0);
});

test('🚨 na jaře má den 23 hodin a posun to musí přežít', () => {
  // Poslední březnová neděle: v 02:00 se v Praze přeskočí na 03:00.
  const pred = ms('2026-03-28T20:00:00Z');     // 21:00 v sobotu
  const po = ms('2026-03-29T02:00:00Z');       // 04:00 v neděli (po skoku)
  assert.equal(dayShift(po, pred, PRAHA), 1);
});

test('🚨 na podzim má den 25 hodin a posun to musí přežít taky', () => {
  const pred = ms('2026-10-24T20:00:00Z');     // 22:00 v sobotu
  const po = ms('2026-10-25T22:00:00Z');       // 23:00 v neděli (po návratu)
  assert.equal(dayShift(po, pred, PRAHA), 1);
});

test('dlouhá cesta má posun podle dnů, ne podle hodin', () => {
  const odjezd = ms('2026-09-12T14:00:00Z');
  const prijezd = odjezd + 60.3 * 3600 * 1000;   // Praha → Norimberk pěšky
  // Odjezd v 16:00, příjezd ve 04:18 — tři překlopené kalendáře, ne dva.
  assert.equal(dayShift(prijezd, odjezd, PRAHA), 3);
});

test('neznámý čas nevrací nulu, ale null', () => {
  // ⚠️ Nula by znamenala „dnes" a den by se nenapsal — tedy přesně ta vada,
  // kvůli které modul vznikl, jen z jiné strany.
  assert.equal(dayShift(NaN, Date.now(), PRAHA), null);
  assert.equal(dayShift(Date.now(), undefined, PRAHA), null);
  assert.equal(clock(NaN, PRAHA, 'cs'), null);
  assert.equal(momentParts(NaN, Date.now(), PRAHA, 'cs'), null);
});

test('hodina se píše v pásmu místa a čtyřiadvacetkrát', () => {
  const o = ms('2026-09-12T20:41:00Z');
  assert.equal(clock(o, PRAHA, 'cs'), '22:41');
  assert.equal(clock(o, 'Europe/Lisbon', 'cs'), '21:41');
  assert.equal(clock(o, 'UTC', 'en'), '20:41', 'nikdy PM — appka jede na 24 hodinách');
});

test('datum se píše po způsobu jazyka', () => {
  const o = ms('2026-09-12T08:41:00Z');
  assert.equal(dayMonth(o, PRAHA, 'cs'), '12. 9.');
  assert.equal(dayMonth(o, PRAHA, 'en'), 'Sep 12');
});

test('rozložený okamžik nese hodinu, posun i datum', () => {
  const odjezd = ms('2026-09-12T10:00:00Z');
  const p = momentParts(odjezd + 50 * 3600 * 1000, odjezd, PRAHA, 'cs');
  assert.deepEqual(p, { time: '14:00', shift: 2, date: '14. 9.' });
});

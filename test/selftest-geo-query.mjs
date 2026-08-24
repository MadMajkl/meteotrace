/**
 * Samotest úpravy dotazu pro hledání míst.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { stripDiacritics, searchQuery } from '../web/lib/geo-query.js';

test('🚨 česká města se posílají bez diakritiky', () => {
  // Změřeno na skutečné službě: „Plzeň" vrátí 0 nálezů, „Plzen" najde Plzeň.
  // Bez tohohle appka „nenajde skoro nic" — přesně jak to Michal popsal.
  assert.equal(searchQuery('Plzeň'), 'Plzen');
  assert.equal(searchQuery('Horšovský Týn'), 'Horsovsky Tyn');
  assert.equal(searchQuery('Špindlerův Mlýn'), 'Spindleruv Mlyn');
  assert.equal(searchQuery('Ústí nad Labem'), 'Usti nad Labem');
});

test('mezery na krajích se ořežou, uvnitř zůstanou', () => {
  assert.equal(searchQuery('  Brno  '), 'Brno');
  assert.equal(searchQuery('Havlíčkův Brod'), 'Havlickuv Brod');
});

test('text bez diakritiky se nemění', () => {
  assert.equal(searchQuery('Berlin'), 'Berlin');
  assert.equal(searchQuery('New York'), 'New York');
});

test('cizí diakritika taky mizí — služba je na tom stejně', () => {
  assert.equal(stripDiacritics('München'), 'Munchen');
  assert.equal(stripDiacritics('Genève'), 'Geneve');
  assert.equal(stripDiacritics('Kraków'), 'Krakow');
});

test('nelatinková písma se nepřepisují do latinky', () => {
  // Sundají se jen kombinující značky. Řecké město zůstane řecky —
  // převádět písmo by znamenalo hádat, a to je horší než nechat být.
  assert.equal(stripDiacritics('Αθήνα'), 'Αθηνα');
  assert.equal(stripDiacritics('Москва'), 'Москва');
});

test('nesmyslný vstup nespadne', () => {
  assert.equal(searchQuery(null), '');
  assert.equal(searchQuery(undefined), '');
  assert.equal(stripDiacritics(42), '');
});

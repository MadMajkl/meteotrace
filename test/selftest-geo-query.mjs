/**
 * Samotest úpravy dotazu pro hledání míst.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { stripDiacritics, searchQuery, placeMeta, placeLabel, placeTitle } from '../web/lib/geo-query.js';

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

/* ============================================================
   KDE TO MÍSTO JE
   ============================================================ */

test('🚨 u adresy se ukáže OBEC, ne kraj', () => {
  // Geokodér vrací u „náměstí Republiky 1" jako kraj „Plzeň", takže nabídka
  // tvrdila, že adresa je v Plzni — přitom je v Horšovském Týně. Obec je
  // jediné, co dvě stejně pojmenované ulice rozliší.
  const r = {
    name: 'náměstí Republiky 1',
    label: 'náměstí Republiky 1, Horšovský Týn, PK, Czechia',
    admin1: 'Plzeň', country: 'Czechia',
  };
  assert.equal(placeMeta(r), 'Horšovský Týn, PK, Czechia');
});

test('bez štítku se použije kraj a země', () => {
  assert.equal(placeMeta({ name: 'Brno', admin1: 'JM', country: 'Czechia' }), 'JM, Czechia');
});

test('štítek, který se rovná jménu, nedá prázdno', () => {
  assert.equal(placeMeta({ name: 'Praha', label: 'Praha', admin1: 'PR', country: 'Czechia' }), 'PR, Czechia');
});

test('nesmyslný vstup nespadne', () => {
  assert.equal(placeMeta(null), '');
  assert.equal(placeMeta({}), '');
});

test('🚨 z popisu se ustřihnou jen mezery a čárky, ne písmena', () => {
  // Ošklivá past: když se ve výrazu ztratí zpětné lomítko, „\s" se změní
  // v písmeno „s" a z popisu „Statenice" se stane „tatenice".
  assert.equal(placeMeta({ name: 'X', label: 'Statenice, Czechia' }), 'Statenice, Czechia');
  assert.equal(placeMeta({ name: 'X', label: 'Sokolov' }), 'Sokolov');
});

/* ============================================================
   CO ZŮSTANE V POLI A CO V NADPISU

   Michal 25. 8. 2026: „když si vybereš ulici, do pole vyhledávání se musí
   dopsat adresa kompletní vč. města, jinak je to matoucí." Ulic téhož
   jména je osm — pole, ve kterém zůstane jen „náměstí Republiky", neříká
   nic o tom, kterou z nich si člověk vybral.
   ============================================================ */

const ADRESA = {
  name: 'náměstí Republiky 1',
  label: 'náměstí Republiky 1, Horšovský Týn, PK, Czechia',
  locality: 'Horšovský Týn',
  admin1: 'PK',
  country: 'Czechia',
};

test('do pole se dopíše úplná adresa i s obcí', () => {
  assert.equal(placeLabel(ADRESA), 'náměstí Republiky 1, Horšovský Týn, PK, Czechia');
});

test('bez úplného popisu se pole poskládá z toho, co je (záloha zná jen sídla)', () => {
  assert.equal(
    placeLabel({ name: 'Horšovský Týn', admin1: 'Plzeňský kraj', country: 'Česko' }),
    'Horšovský Týn, Plzeňský kraj, Česko',
  );
});

test('🚨 do nadpisu jde jméno a OBEC, ne kraj a země', () => {
  // Kraj dvě stejná náměstí nerozliší — v Plzni i v Horšovském Týně je PK.
  assert.equal(placeTitle(ADRESA), 'náměstí Republiky 1, Horšovský Týn');
});

test('u města se obec nepřidává dvakrát', () => {
  assert.equal(placeTitle({ name: 'Plzeň', locality: 'Plzeň' }), 'Plzeň');
  assert.equal(placeTitle({ name: 'Plzeň 3', locality: 'Plzeň' }), 'Plzeň 3');
});

test('když obec chybí, zůstane samotné jméno', () => {
  assert.equal(placeTitle({ name: 'Brno' }), 'Brno');
  assert.equal(placeTitle({}), '');
});

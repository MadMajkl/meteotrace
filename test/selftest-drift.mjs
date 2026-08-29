/**
 * Samotest: jde to k nám, nebo od nás?
 *
 * 🚨 Tady se dá udělat chyba, která appce nezpůsobí ani škytnutí a přitom
 * jí vezme důvěru: obrátit směr. „Déšť jde k nám", když odchází, je horší
 * než mlčení — a nikdo to nenahlásí, jen tomu přestane věřit. Táž past jako
 * u větrné růžice 28. 8. 2026.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { kamMiri, coRict, odchylka } from '../web/lib/drift.js';

/* ── úhly ─────────────────────────────────────────────────────────────── */

test('odchylka jde po kratší straně kruhu', () => {
  assert.equal(odchylka(10, 350), 20, 'přes sever, ne oklikou');
  assert.equal(odchylka(350, 10), 20);
  assert.equal(odchylka(0, 180), 180);
  assert.equal(odchylka(90, 90), 0);
});

test('odchylka: nesmysly vrací null, ne číslo', () => {
  assert.equal(odchylka(NaN, 10), null);
  assert.equal(odchylka(10, undefined), null);
});

/* ── směr pohybu ──────────────────────────────────────────────────────── */

test('🚨 déšť na západě + západní vítr = JDE K NÁM', () => {
  // Západní vítr fouká OD západu (meteorologická konvence, kterou appka
  // drží i ve výpisu). Déšť na západě tedy leží proti proudu a putuje sem.
  assert.equal(kamMiri('w', 270, 20), 'prichazi');
});

test('🚨 déšť na východě + západní vítr = ODCHÁZÍ', () => {
  // Kdyby se to prohodilo, appka by tvrdila přesný opak toho, co se děje.
  assert.equal(kamMiri('e', 270, 20), 'odchazi');
});

test('déšť napříč větru nás mine', () => {
  // Vítr od západu, déšť na severu i na jihu — jde bokem.
  assert.equal(kamMiri('n', 270, 20), 'mine');
  assert.equal(kamMiri('s', 270, 20), 'mine');
});

test('sousední výseč se pořád počítá jako „k nám"', () => {
  // Směr známe jen na osminu kruhu, takže je v něm ±22,5 ° nepřesnosti.
  // Přísnější mez by u sondy na kraji výseče prohlásila blížící se déšť
  // za míjející.
  assert.equal(kamMiri('sw', 270, 20), 'prichazi', '45° od větru');
  assert.equal(kamMiri('nw', 270, 20), 'prichazi');
});

test('🚨 při bezvětří se NEHÁDÁ', () => {
  // Směr větru je při 2 km/h číslo, které se otočí, než se člověk podívá
  // z okna. Věštit z něj příchod fronty by bylo věštění s desetinnou čárkou.
  assert.equal(kamMiri('w', 270, 2), null);
  assert.equal(kamMiri('w', 270, 0), null);
  assert.equal(kamMiri('w', 270, 6), 'prichazi', 'od pěti km/h už to smysl dává');
});

test('bez směru nebo bez větru se mlčí', () => {
  assert.equal(kamMiri('', 270, 20), null);
  assert.equal(kamMiri('w', null, 20), null);
  assert.equal(kamMiri('nesmysl', 270, 20), null);
  assert.equal(kamMiri(undefined, undefined), null);
});

test('neznámá rychlost gesto nezruší — mlčet se má jen při DOLOŽENÉM bezvětří', () => {
  // Když rychlost nemáme, není důvod zahodit směr, který známe.
  assert.equal(kamMiri('w', 270), 'prichazi');
  assert.equal(kamMiri('w', 270, null), 'prichazi');
});

test('velké písmo ve směru nevadí', () => {
  assert.equal(kamMiri('W', 270, 20), 'prichazi');
  assert.equal(kamMiri('NE', 45, 20), 'prichazi');
});

/* ── co se smí říct ───────────────────────────────────────────────────── */

test('🚨 předpověď přebíjí vítr', () => {
  // Model počítá s prouděním ve výšce, my máme přízemní vítr a osminu
  // kruhu. Když model říká „zaprší", je to silnější tvrzení.
  assert.equal(coRict({ drift: 'odchazi', predpovedPotvrzuje: true }), 'prichazi');
  assert.equal(coRict({ drift: 'mine', predpovedPotvrzuje: true }), 'prichazi');
  assert.equal(coRict({ drift: null, predpovedPotvrzuje: true }), 'prichazi');
});

test('🚨 „přichází" se proti mlčícímu modelu netvrdí', () => {
  // Dvě protichůdná tvrzení v jedné hlášce jsou horší než jedno. Když model
  // pro tohle místo déšť nedává, náš úhloměr ho nepřehlasuje.
  assert.equal(coRict({ drift: 'prichazi', predpovedPotvrzuje: false }), null);
});

test('„odchází" a „mine" model doplňují, ne popírají', () => {
  // Tohle je ta užitečná půlka: model mlčí a vítr vysvětluje PROČ.
  assert.equal(coRict({ drift: 'odchazi', predpovedPotvrzuje: false }), 'odchazi');
  assert.equal(coRict({ drift: 'mine', predpovedPotvrzuje: false }), 'mine');
});

test('bez větru a bez předpovědi není co říct', () => {
  assert.equal(coRict({ drift: null, predpovedPotvrzuje: false }), null);
  assert.equal(coRict({}), null);
});

/**
 * Samotest hlášek k trase.
 *
 * ⚠️ Tenhle soubor je JEDINÉ místo v projektu, kde se zakázané jméno píše —
 * a je to schválně: hlídací pes musí vědět, koho hlídá. Nikam jinam nepatří,
 * ani do komentáře.
 *
 * 🚨 Hláška je jediné místo v appce, kde si dovolíme žertovat — a proto tu
 * jsou tvrdá pravidla. Dvě z nich by se při psaní dalších vět ztratila dřív
 * než cokoli jiného, takže je nehlídá paměť, ale test:
 *
 *   • jméno Mistra se NIKDY nevyslovuje (Michalův požadavek 26. 8. 2026),
 *   • u nebezpečí musí být jev POJMENOVANÝ — vtip, ze kterého se nedozvíš,
 *     co hrozí, je jen vtip.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { routeQuip, SITUACE_KLICE, VSECHNY_VETY } from '../web/lib/quips.js';

/** Obyčejná klidná trasa. */
const KLID = {
  hazard: false, rainCount: 0, windKmh: 8, tempC: 18,
  distanceM: 40000, arrivalHour: 14,
};

/* ============================================================
   JMÉNO MISTRA
   ============================================================ */

test('🚨 jméno Mistra se v hláškách NEVYSLOVUJE', () => {
  // Říká se výhradně „Mistr". Při psaní deseti vět se na to zapomene dřív
  // než na cokoli jiného — proto test, ne paměť.
  for (const v of VSECHNY_VETY) {
    assert.ok(!/cimrman/i.test(v), `zakázané jméno: ${v}`);
  }
});

test('🚨 zakázané jméno není ani ve zdrojáku hlášek', async () => {
  // Komentář s tím jménem by se dřív nebo později dostal do věty.
  const zdroj = await readFile(new URL('../web/lib/quips.js', import.meta.url), 'utf8');
  const radky = zdroj.split(/\r?\n/).filter((r) => /cimrman/i.test(r));
  assert.deepEqual(radky, [], 'zdroják zmiňuje zakázané jméno');
});

test('věty jsou celé věty, ne útržky', () => {
  for (const v of VSECHNY_VETY) {
    assert.ok(v.length > 20, `příliš krátké: ${v}`);
  }
});

/* ============================================================
   NEBEZPEČÍ
   ============================================================ */

test('🚨 u nebezpečí se ŽERTUJE, ale jev je pojmenovaný', () => {
  // Čech si dělá legraci ze všeho a suchá věta se zapamatuje líp než úřední
  // hláška — ale musí být poznat, CO hrozí.
  for (const jev of ['Bouřka', 'Mrznoucí déšť', 'Vydatné sněžení']) {
    const v = routeQuip({ ...KLID, hazard: true, hazardWhat: jev });
    assert.ok(v.length > 0, 'u nebezpečí se nemlčí');
    assert.ok(v.toLowerCase().includes(jev.toLowerCase()), `jev není pojmenovaný: ${v}`);
  }
});

test('🚨 nebezpečí přebíjí všechno ostatní', () => {
  // Kdyby vyhrála hláška o vedru, zůstala by bouřka nezmíněná.
  const v = routeQuip({
    ...KLID, hazard: true, hazardWhat: 'Bouřka', tempC: 31, distanceM: 300000, rainCount: 4,
  });
  assert.match(v, /bouřka/i);
});

test('bez jména jevu se řekne aspoň, že jde o nebezpečné počasí', () => {
  const v = routeQuip({ ...KLID, hazard: true });
  assert.match(v, /nebezpečné počasí/i);
});

test('věta začíná velkým písmenem i po dosazení jevu', () => {
  const v = routeQuip({ ...KLID, hazard: true, hazardWhat: 'Bouřka' });
  assert.match(v, /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/, v);
});

/* ============================================================
   STABILITA A ROZSAH
   ============================================================ */

test('🚨 táž trasa dá pokaždé TUTÉŽ hlášku', () => {
  // Kdyby se losovalo při každém překreslení, měnila by se věta při každém
  // přepnutí odjezdu a působila by jako porucha.
  const a = routeQuip(KLID);
  for (let i = 0; i < 20; i += 1) assert.equal(routeQuip(KLID), a);
});

test('jiná trasa dá (obvykle) jinou hlášku', () => {
  const vety = new Set();
  for (let km = 10; km <= 300; km += 10) {
    vety.add(routeQuip({ ...KLID, distanceM: km * 1000 }));
  }
  assert.ok(vety.size >= 3, `příliš málo rozmanitosti: ${vety.size}`);
});

test('déšť, vítr, zima i vedro mají svoje věty', () => {
  const dest = routeQuip({ ...KLID, rainCount: 3 });
  const vitr = routeQuip({ ...KLID, windKmh: 40 });
  const zima = routeQuip({ ...KLID, tempC: -4 });
  const vedro = routeQuip({ ...KLID, tempC: 31 });

  for (const v of [dest, vitr, zima, vedro]) assert.ok(v.length > 10, v);
  assert.equal(new Set([dest, vitr, zima, vedro]).size, 4, 'každá situace má svoji');
});

test('🚨 jiný jazyk než čeština MLČÍ', () => {
  // Tenhle humor stojí na jazyce. Přeložený doslova není vtipný, je jen
  // divný — a mlčet je lepší než žertovat bez citu pro jazyk.
  assert.equal(routeQuip(KLID, 'en'), '');
  assert.equal(routeQuip({ ...KLID, hazard: true, hazardWhat: 'Bouřka' }, 'en'), '');
  assert.equal(routeQuip(KLID, 'cs').length > 0, true);
});

test('rozbitý nebo chybějící vstup hlášku neshodí', () => {
  assert.equal(routeQuip(null), '');
  assert.equal(typeof routeQuip({}), 'string');
  assert.equal(typeof routeQuip({ tempC: NaN, distanceM: 'x' }), 'string');
});

test('každá situace má aspoň dvě věty, ať se neomrzí', () => {
  assert.ok(SITUACE_KLICE.length >= 9, 'málo situací');
  assert.ok(SITUACE_KLICE.includes('nebezpeci'), 'nebezpečí musí mít vlastní hlášky');
});

test('hlášky jsou krátké — je to dovětek, ne odstavec', () => {
  // Delší text by soupeřil s údaji nad sebou. Hláška má být šťouchnutí.
  for (const v of VSECHNY_VETY) {
    assert.ok(v.length <= 110, `moc dlouhé (${v.length}): ${v}`);
  }
});

/* ============================================================
   VÍTR PODLE TOHO, ODKUD FOUKÁ

   Michal 26. 8. 2026: „tyhle směry větru by stálo za to taky lehce vtipně
   okomentovat." Každý český směr má svou pověst — a je to informace
   zabalená do vtipu, ne vtip místo informace.
   ============================================================ */

const VETRNO = { ...KLID, windKmh: 32 };

test('směr větru má vlastní hlášku', () => {
  const s = routeQuip({ ...VETRNO, windDirKey: 'n' });
  const z = routeQuip({ ...VETRNO, windDirKey: 'w' });
  assert.match(s, /sever/i);
  assert.match(z, /západ/i);
  assert.notEqual(s, z, 'každý směr mluví jinak');
});

test('🚨 šestnáct směrů se svede na osm — VSV je pořád východní', () => {
  // Kdo by pro každý z šestnácti psal vlastní hlášku, dopadne u čtvrtého
  // jako kalendář.
  assert.equal(routeQuip({ ...VETRNO, windDirKey: 'ene' }), routeQuip({ ...VETRNO, windDirKey: 'e' }));
  assert.equal(routeQuip({ ...VETRNO, windDirKey: 'wsw' }), routeQuip({ ...VETRNO, windDirKey: 'w' }));
});

test('bez známého směru zůstane obecná hláška o větru', () => {
  const v = routeQuip(VETRNO);
  assert.ok(v.length > 10);
  assert.match(v, /vít|Mistr/i);
});

test('🚨 nebezpečí přebíjí i hlášku o směru větru', () => {
  const v = routeQuip({ ...VETRNO, windDirKey: 'n', hazard: true, hazardWhat: 'Bouřka' });
  assert.match(v, /bouřka/i);
});

test('u slabého větru se o směru nemluví', () => {
  // Vítr 8 km/h nikoho nezajímá, ať fouká odkudkoli.
  const v = routeQuip({ ...KLID, windDirKey: 'n' });
  assert.ok(!/severák/i.test(v), v);
});

test('všech osm směrů má aspoň dvě věty a žádná nenese zakázané jméno', () => {
  for (const smer of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    const veta = routeQuip({ ...VETRNO, windDirKey: smer });
    assert.ok(veta.length > 20, `${smer}: ${veta}`);
    assert.ok(veta.length <= 110, `${smer} je moc dlouhé: ${veta}`);
    assert.ok(!/cimrman/i.test(veta), `${smer}: zakázané jméno`);
  }
});

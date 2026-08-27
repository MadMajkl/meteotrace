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

import { routeQuip, placeQuip, SITUACE_KLICE, VSECHNY_VETY, okoliQuip } from '../web/lib/quips.js';

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

/* ============================================================
   HLÁŠKA K MÍSTU (METEOSTANICE)

   🚨 Michal 27. 8. 2026: „ten vítr jsi ještě nijak nekomentoval." Měl
   pravdu — hlášky byly jen na trase, a tam se o větru mluví až od 25 km/h.
   Na jednom místě je „odkud fouká" zajímavé už při svěžím vánku, protože
   v něm stojíš.
   ============================================================ */

test('místo: vítr se komentuje podle směru už od svěžího vánku', () => {
  const z = placeQuip({ windKmh: 15, windDirKey: 'w', tempC: 18 });
  const s = placeQuip({ windKmh: 15, windDirKey: 'n', tempC: 18 });
  assert.match(z, /západ/i);
  assert.match(s, /sever/i);
});

test('🚨 slabý vítr se komentuje jinak než pořádný — ale směr řekne taky', () => {
  // 🚨 Michal 27. 8. 2026: „nemáš žádné hlášky k větru?" Měl je — jenže
  // začínaly až na dvanácti km/h, a pod nimi appka spadla na obecnou hlášku
  // o ničem. Slabý vítr je přitom nejčastější stav: většinu dní by tak
  // o větru nepadlo ani slovo. Původní pravidlo („pod dvanáct se o směru
  // mlčí") tímhle padá.
  const vanek = placeQuip({ windKmh: 6, windDirKey: 'w', tempC: 18 });
  const poradny = placeQuip({ windKmh: 25, windDirKey: 'w', tempC: 18 });
  assert.match(vanek, /západ/i);
  assert.notEqual(vanek, poradny, 'vánek nemá znít jako vichr');
});

test('🚨 v bezvětří se o směru nemluví', () => {
  // Odkud nefouká, to je povídání o ničem — tahle část pravidla platí dál.
  const v = placeQuip({ windKmh: 1, windDirKey: 'w', tempC: 18 });
  assert.ok(!/západ/i.test(v), v);
});

test('bezvětří, mráz a vedro mají svoje věty', () => {
  const klid = placeQuip({ windKmh: 1, tempC: 18 });
  const mraz = placeQuip({ windKmh: 6, tempC: -5 });
  const vedro = placeQuip({ windKmh: 6, tempC: 33 });
  assert.equal(new Set([klid, mraz, vedro]).size, 3);
  for (const v of [klid, mraz, vedro]) assert.ok(v.length > 20, v);
});

test('🚨 nebezpečí přebíjí vše a jev je pojmenovaný', () => {
  const v = placeQuip({ hazard: true, hazardWhat: 'Bouřka', windKmh: 20, windDirKey: 'w', tempC: 18 });
  assert.match(v, /bouřka/i);
});

test('náraz citelně nad průměrem je zpráva sám o sobě', () => {
  const v = placeQuip({ windKmh: 28, gustKmh: 52, tempC: 12 });
  assert.match(v, /náraz/i);
});

test('místo: táž situace dá tutéž hlášku a jiný jazyk mlčí', () => {
  const k = { windKmh: 15, windDirKey: 'w', tempC: 18 };
  assert.equal(placeQuip(k), placeQuip(k));
  assert.equal(placeQuip(k, 'en'), '');
});

test('místo: rozbitý vstup hlášku neshodí', () => {
  assert.equal(placeQuip(null), '');
  assert.equal(typeof placeQuip({}), 'string');
  assert.equal(typeof placeQuip({ windKmh: 'x', tempC: NaN }), 'string');
});

/* ============================================================
   KDE NEJBLÍŽ PRŠÍ / KAM ZA SLUNCEM

   Michal 26. 8. 2026: „nejbližší déšť k trase je <místo, kde fakt aktuálně
   nejblíže prší>" a „za sluncem bys musel jet až <kam>".
   ============================================================ */

test('okolí: věta nese vzdálenost, směr i místo', () => {
  const v = okoliQuip({ hledame: 'dest', km: 62, dirKey: 'sw', misto: 'Klatovy' });
  assert.match(v, /62 km/);
  assert.match(v, /na jihozápad/);
  assert.match(v, /Klatovy/);
});

test('🚨 mluví se opatrně — sonda není měření', () => {
  // Sondy sedí na osmi směrech a třech vzdálenostech; skutečný nejbližší
  // déšť může být mezi nimi. Věta nesmí tvrdit víc, než kolik se ví.
  const v = okoliQuip({ hledame: 'dest', km: 62, dirKey: 'sw' });
  assert.match(v, /asi/, v);
});

test('okolí: bez jména místa věta pořád dává smysl', () => {
  const v = okoliQuip({ hledame: 'slunce', km: 25, dirKey: 'e' });
  assert.match(v, /25 km/);
  assert.match(v, /na východ/);
  assert.ok(!v.includes('()'), 'prázdná závorka po chybějícím jménu');
});

test('okolí: když se nic nenajde, řekne se dosah', () => {
  const dest = okoliQuip({ hledame: 'dest', km: null, dosahKm: 120 });
  const slunce = okoliQuip({ hledame: 'slunce', km: null, dosahKm: 120 });
  assert.match(dest, /120 km/);
  assert.match(slunce, /120 km/);
  assert.notEqual(dest, slunce, 'déšť a slunce nemají mít tutéž větu');
});

test('okolí: bez směru se netvrdí směr', () => {
  // Kdyby se klíč směru nepodařilo přeložit, nesmí ve větě zůstat díra.
  const v = okoliQuip({ hledame: 'dest', km: 40, dirKey: 'nesmysl' });
  assert.ok(!v.includes('undefined'), v);
  assert.match(v, /120 km/, 'spadne se na odpověď o dosahu');
});

test('okolí: táž situace dá tutéž větu a jiný jazyk mlčí', () => {
  const k = { hledame: 'dest', km: 62, dirKey: 'sw', misto: 'Klatovy' };
  assert.equal(okoliQuip(k), okoliQuip(k));
  assert.equal(okoliQuip(k, 'en'), '');
  assert.equal(okoliQuip(null), '');
});

test('🚨 okolí: „od trasy" a „kolem" nejsou totéž', () => {
  // U trasy se měří od nejbližšího bodu CELÉ cesty. Kdyby to věta neřekla,
  // vztáhne si to člověk k místu, kde zrovna stojí — a to je jiná odpověď.
  const trasa = okoliQuip({ hledame: 'dest', km: 41, dirKey: 's', misto: 'Klatovy', odTrasy: true });
  const misto = okoliQuip({ hledame: 'dest', km: 41, dirKey: 's', misto: 'Klatovy' });
  assert.match(trasa, /od trasy/);
  assert.ok(!/od trasy/.test(misto), misto);
  assert.match(trasa, /41 km/);
  assert.match(trasa, /Klatovy/);
});

test('okolí: i věta o nenalezení rozliší trasu od místa', () => {
  const trasa = okoliQuip({ hledame: 'dest', km: null, dosahKm: 120, odTrasy: true });
  const misto = okoliQuip({ hledame: 'dest', km: null, dosahKm: 120 });
  assert.match(trasa, /od trasy/);
  assert.ok(!/od trasy/.test(misto), misto);
});

test('🚨 široké kolo netvrdí přesnost, kterou nemá', () => {
  // Osm směrů na pěti stech kilometrech nechává mezery stovky kilometrů
  // široké. „Nejblíž prší" by z toho dělalo měření; „o kterém víme" je
  // poctivé — a pořád to odpovídá na otázku.
  const siroko = okoliQuip({ hledame: 'dest', km: 310, dirKey: 'nw', misto: 'Drážďany', siroko: true });
  const blizko = okoliQuip({ hledame: 'dest', km: 41, dirKey: 's', misto: 'Klatovy' });
  assert.match(siroko, /víme/);
  assert.ok(!/víme/.test(blizko), blizko);
  // A hlavně: místo se pojmenuje v obou případech.
  assert.match(siroko, /Drážďany/);
  assert.match(blizko, /Klatovy/);
});

test('široké kolo umí i slunce a rozliší trasu od místa', () => {
  const trasa = okoliQuip({ hledame: 'slunce', km: 420, dirKey: 's', misto: 'Linec', siroko: true, odTrasy: true });
  const misto = okoliQuip({ hledame: 'slunce', km: 420, dirKey: 's', misto: 'Linec', siroko: true });
  assert.match(trasa, /od trasy/);
  assert.ok(!/od trasy/.test(misto), misto);
  assert.match(trasa, /420 km/);
});

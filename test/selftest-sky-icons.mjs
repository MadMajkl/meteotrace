/**
 * Samotest piktogramů oblohy a jednotek, které k nim patří.
 *
 * ⚠️ Tvar se tu netestuje „jak vypadá" — od toho je laboratoř
 * (`test/sky-icon-lab.html`, otevřít v prohlížeči). Tady se hlídá to, co se
 * dá spočítat: že Měsíc svítí na správné straně a že ho svítí správně moc.
 *
 * 🚨 Kontrolováno i naživo v prohlížeči přes `getBBox()` (28. 8. 2026):
 * dorůstající 25 % má obálku x 12→20 (jen pravá půlka), dorůstající 75 %
 * x 8→20 (pravá půlka a kus levé), couvající zrcadlově. Tenhle test tedy
 * hlídá tutéž vlastnost, jen bez prohlížeče.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sunriseShape, sunsetShape, elevationShape, pressureShape, windRoseShape, moonShape,
  uvShape, moonTrendShape,
} from '../web/lib/sky-icons.js';
import { formatElevation, formatPressure, METRIC, IMPERIAL } from '../web/lib/units.js';

/** Vytáhne z cesty Měsíce obě čísla, na kterých tvar stojí. */
function rozeberMesic(d) {
  const oblouky = [...d.matchAll(/A([\d.]+) ([\d.]+) 0 0 (\d)/g)].map((m) => ({
    rx: +m[1], ry: +m[2], sweep: +m[3],
  }));
  return { vnejsi: oblouky[0], vnitrni: oblouky[1] };
}

/* ============================================================
   MĚSÍC
   ============================================================ */

test('🚨 dorůstající Měsíc svítí vpravo, couvající vlevo', () => {
  // Kdyby se to prohodilo, ukazovala by appka pravý opak toho, co je na
  // obloze — a byla by to chyba, kterou nikdo neohlásí, jen jí přestane věřit.
  const dorusta = rozeberMesic(moonShape(0.25, true).svetlo);
  const couva = rozeberMesic(moonShape(0.25, false).svetlo);
  assert.equal(dorusta.vnejsi.sweep, 1, 'vnější oblouk vpravo');
  assert.equal(couva.vnejsi.sweep, 0, 'vnější oblouk vlevo');
});

test('🚨 terminátor se zužuje ke čtvrti a rozšiřuje k úplňku', () => {
  // Vodorovný poloměr půlelipsy je r·|1−2f|: ve čtvrti nula (rovná hrana),
  // k novu i k úplňku roste k okraji kotouče.
  const rx = (f) => rozeberMesic(moonShape(f, true).svetlo).vnitrni.rx;
  assert.equal(rx(0.5), 0, 'čtvrt má rovný terminátor');
  assert.equal(rx(0.25), 4, 'srpek');
  assert.equal(rx(0.75), 4, 'vypouklý');
  assert.ok(rx(0.1) > rx(0.25), 'blíž novu je terminátor širší');
});

test('🚨 srpek je vydutý dovnitř, vypouklý Měsíc ven', () => {
  // Tohle je ten rozdíl, kvůli kterému nestačí jedna elipsa pro obě půlky:
  // do čtvrti se terminátor zakusuje do svítící strany, po čtvrti od ní utíká.
  const srpek = rozeberMesic(moonShape(0.25, true).svetlo);
  const vypoukly = rozeberMesic(moonShape(0.75, true).svetlo);
  assert.notEqual(srpek.vnitrni.sweep, vypoukly.vnitrni.sweep);
});

test('nov nesvítí, úplněk svítí celý', () => {
  assert.equal(moonShape(0, true).svetlo, null);
  assert.equal(moonShape(0.004, true).svetlo, null, 'skoro nov je pořád nov');
  assert.match(moonShape(1, true).svetlo, /a8 8 0 1 1/, 'úplněk je celý kotouč');
});

test('nesmyslná fáze nespadne — jen se ořízne', () => {
  assert.equal(moonShape(-3, true).svetlo, null);
  assert.ok(moonShape(9, true).svetlo);
  assert.ok(moonShape(undefined, true).kotouc);
});

test('kotouč je vždycky, i když nesvítí nic', () => {
  // Obrys musí zůstat: prázdné místo by vypadalo jako chybějící údaj,
  // kdežto prázdný kotouč je odpověď „nov".
  assert.deepEqual(moonShape(0, true).kotouc, [12, 12, 8]);
});

/* ============================================================
   SLUNCE, HORA, TLAK, RŮŽICE
   ============================================================ */

test('🚨 východ a západ se liší šipkou, ne barvou', () => {
  // Emoji 🌅 a 🌇 se v malém liší jen odstínem a v každém systému vypadají
  // jinak. Šipka je poznat i černobíle a v šestnácti pixelech.
  const vychod = sunriseShape();
  const zapad = sunsetShape();
  assert.equal(vychod.plocha, zapad.plocha, 'slunce je totéž');
  assert.notDeepEqual(vychod.cara, zapad.cara, 'liší se šipka');
  assert.ok(vychod.cara.includes('M3 18.5h18'), 'obzor je v obou');
  assert.ok(zapad.cara.includes('M3 18.5h18'), 'obzor je v obou');
});

test('nadmořská výška má horu i hladinu', () => {
  // Bez vlnky by to byla jen hora a údaj by mohl znamenat i převýšení.
  const h = elevationShape();
  assert.match(h.plocha, /^M12 5 /, 'vrchol nahoře');
  assert.equal(h.cara.length, 1, 'jedna vlnka = hladina moře');
});

test('tlakoměr má ciferník, ručičku i střed', () => {
  const t = pressureShape();
  assert.deepEqual(t.kotouc, [12, 12, 7.6]);
  assert.deepEqual(t.tecka, [12, 12, 1.5]);
  assert.ok(t.cara.length >= 2, 'ručička a rysky');
});

test('🚨 růžice má pevný prstenec a otáčivou střelku zvlášť', () => {
  // Kdyby se otáčelo všechno, necestoval by sever nahoře a z růžice by
  // zbyla šipka v kroužku.
  const r = windRoseShape();
  assert.ok(r.kruh, 'prstenec');
  assert.equal(r.cara.length, 4, 'čtyři světové strany');
  assert.ok(r.plocha, 'hrot (kam vítr fouká)');
});

test('🚨 růžice je JEDEN hrot, ne špička s ocasem', () => {
  // Michal 29. 8. 2026: „šipka tvar jen hrot a musí vyplňovat celý kruh."
  // Malá špička proti prázdnému ocasu byly dvě drobné věci, ze kterých
  // v šestnácti pixelech nebylo poznat, která je která.
  const r = windRoseShape();
  assert.equal(r.ocas, undefined, 'ocas se zrušil schválně');
});

test('hrot sahá přes celý kruh, ne jen do jeho čtvrtiny', () => {
  // Souřadnice y v cestě musí pokrýt většinu průměru prstence (r = 8,6,
  // tedy 3,4–20,6). Malý hrot uprostřed by v dlaždici zanikl.
  const cisla = windRoseShape().plocha.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const ys = cisla.filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...ys) < 5, 'sahá skoro k hornímu okraji prstence');
  assert.ok(Math.max(...ys) > 18, 'a skoro ke spodnímu');
});

/**
 * Oddělovač tisíců dává Intl jako ÚZKOU NEZLOMITELNOU mezeru, ne obyčejnou.
 * Test, který srovnává znak po znaku, by na tom padl — a přitom by appka
 * vypisovala správně.
 */
const mezery = (s) => s.replace(/[\s\u00a0\u202f]/g, ' ');

/* ============================================================
   JEDNOTKY
   ============================================================ */

test('🚨 výška se neřídí jednotkou vzdálenosti — stopy, ne míle', () => {
  assert.equal(formatElevation(383, METRIC, 'cs'), '383 m');
  assert.equal(mezery(formatElevation(383, IMPERIAL, 'en')), '1,257 ft');
});

test('tlak: hPa celé, inHg na dvě desetiny', () => {
  // Celý obor počasí se v palcích vejde mezi 28 a 31 — bez desetin by
  // se údaj skoro nehýbal.
  assert.equal(mezery(formatPressure(1014.8, METRIC, 'cs')), '1 015 hPa');
  assert.equal(mezery(formatPressure(1014.8, IMPERIAL, 'en')), '29.97 inHg');
});

test('chybějící hodnota dá pomlčku, ne nulu', () => {
  assert.equal(formatElevation(null, METRIC, 'cs'), '—');
  assert.equal(formatPressure(undefined, METRIC, 'cs'), '—');
  assert.equal(formatElevation(Number.NaN, METRIC, 'cs'), '—');
});

test('nula je platná výška — hladina moře není chybějící údaj', () => {
  assert.equal(formatElevation(0, METRIC, 'cs'), '0 m');
});

/* ============================================================
   UV INDEX A TREND MĚSÍCE (29. 8. 2026)
   ============================================================ */

test('UV: slunce i silueta člověka, ne jen jedno z toho', () => {
  // Michal: „musí mít piktogram slunce a v dlaždici musí být silueta horní
  // poloviny lidského těla (jakože UV ovlivňuje zdraví a je od slunce)."
  const u = uvShape();
  assert.ok(u.kruh, 'kotouček slunce');
  assert.ok(u.cara.length >= 4, 'paprsky');
  assert.ok(u.plocha, 'silueta');
});

test('🚨 slunce a hlava se nepřekrývají', () => {
  // Nad hlavou by se obojí dotýkalo a splynulo v jeden tvar. Takhle je
  // vidět, že to jsou dvě věci a že jedna svítí na druhou.
  const u = uvShape();
  const [sx, sy, sr] = u.kruh;
  // Hlava je první oblouk siluety; její střed vytáhneme z cesty.
  const [hx, hy] = u.plocha.match(/-?\d+(?:\.\d+)?/g).slice(0, 2).map(Number);
  const odstup = Math.hypot(hx - sx, hy - sy);
  assert.ok(odstup > sr + 2, `slunce a hlava mají odstup (${odstup.toFixed(1)})`);
});

test('měsíc: dorůstající má šipku nahoru, couvající dolů', () => {
  const nahoru = moonTrendShape(0.25);
  const dolu = moonTrendShape(0.75);
  assert.ok(nahoru, 'dorůstající má šipku');
  assert.ok(dolu, 'couvající taky');
  assert.notDeepEqual(nahoru.cara, dolu.cara, 'a nesmí to být tatáž šipka');
});

test('🚨 v úplňku ani v novu žádná šipka', () => {
  // V těch dvou bodech Měsíc nedorůstá ani neubývá — je na obrátce.
  // Šipka by ukazovala směr, který v tu chvíli neplatí.
  assert.equal(moonTrendShape(0), null, 'nov');
  assert.equal(moonTrendShape(0.5), null, 'úplněk');
  assert.equal(moonTrendShape(0.99), null, 'konec cyklu je zase nov');
});

test('🚨 meze šipky sedí na fáze z moon.js', () => {
  // Kdyby se rozešly, zmizela by šipka o den dřív, než appka vedle napíše
  // „úplněk" — nebo naopak by u úplňku ještě svítila.
  assert.equal(moonTrendShape(0.019), null, 'ještě nov');
  assert.ok(moonTrendShape(0.03), 'už dorůstá');
  assert.equal(moonTrendShape(0.48), null, 'začátek úplňku');
  assert.equal(moonTrendShape(0.52), null, 'konec úplňku');
  assert.ok(moonTrendShape(0.53), 'už couvá');
});

test('trend: nesmyslný vstup nespadne', () => {
  assert.equal(moonTrendShape(null), null);
  assert.equal(moonTrendShape('nesmysl'), null);
  assert.equal(moonTrendShape(undefined), null);
});

test('🚨 hrot růžice míří NAHORU — otočení dodává app.js', () => {
  // Tvar sám musí být v základní poloze (sever), jinak by se otočení
  // z `windDeg` skládalo s vlastním posunem tvaru a nikdo by nedohledal,
  // proč šipka ukazuje o kus vedle.
  const cisla = windRoseShape().plocha.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const ys = cisla.filter((_, i) => i % 2 === 1);
  const xs = cisla.filter((_, i) => i % 2 === 0);
  // Nejvyšší bod (nejmenší y) je hrot a leží uprostřed vodorovně.
  const iHrot = ys.indexOf(Math.min(...ys));
  assert.equal(xs[iHrot], 12, 'hrot je na svislé ose');
  assert.ok(ys[iHrot] < 6, 'a míří nahoru');
});

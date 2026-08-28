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
  assert.ok(r.plocha, 'plná špička (odkud)');
  assert.ok(r.ocas, 'prázdný ocas (kam)');
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

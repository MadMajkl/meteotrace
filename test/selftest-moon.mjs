/**
 * Samotest fází Měsíce.
 *
 * 🚨 Michal 27. 8. 2026: *„a prosím, šlo by přidat fáze měsíce?"*
 *
 * ⚠️ Ověřuje se to proti SKUTEČNÝM úkazům, ne proti vlastnímu výpočtu.
 * Test, který jen zopakuje tutéž rovnici, potvrdí i chybu v ní.
 */

'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';

import { moonPhase, MOON_KEYS, SYNODICKY_MESIC_DNU } from '../web/lib/moon.js';

/**
 * Skutečné úkazy roku 2026 (časy v UTC).
 * Zdroj: veřejné efemeridy, ověřeno 27. 8. 2026.
 */
const UKAZY = [
  { popis: 'nov 12. 8. 2026', kdy: '2026-08-12T17:37:00Z', klic: 'new' },
  { popis: 'první čtvrť 20. 8. 2026', kdy: '2026-08-20T14:46:00Z', klic: 'firstQuarter' },
  { popis: 'úplněk 28. 8. 2026', kdy: '2026-08-28T04:18:00Z', klic: 'full' },
];

test('🚨 fáze sedí na skutečné úkazy', () => {
  for (const u of UKAZY) {
    const f = moonPhase(Date.parse(u.kdy));
    assert.equal(f.klic, u.klic, `${u.popis}: vyšlo ${f.klic}`);
  }
});

test('🚨 odchylka od skutečného úkazu zůstává pod dnem', () => {
  // Počítá se ze STŘEDNÍHO synodického měsíce, takže se to na hodinu netrefí
  // — skutečný oběh kolísá zhruba o půl dne. Test hlídá, že to nekolísá víc:
  // kdyby se odchylka blížila dvěma dnům, pojmenování fáze by se začalo mýlit.
  for (const u of UKAZY) {
    const f = moonPhase(Date.parse(u.kdy));
    const cil = { new: 0, firstQuarter: 0.25, full: 0.5 }[u.klic];
    // Vzdálenost po kruhu — nov je 0 i 1.
    const rozdil = Math.min(Math.abs(f.podil - cil), 1 - Math.abs(f.podil - cil));
    const dnu = rozdil * SYNODICKY_MESIC_DNU;
    assert.ok(dnu < 1, `${u.popis}: mimo o ${dnu.toFixed(2)} dne`);
  }
});

test('osvětlení odpovídá fázi', () => {
  const nov = moonPhase(Date.parse('2026-08-12T17:37:00Z'));
  const uplnek = moonPhase(Date.parse('2026-08-28T04:18:00Z'));
  assert.ok(nov.osvetleni < 0.02, `nov svítí z ${(nov.osvetleni * 100).toFixed(1)} %`);
  assert.ok(uplnek.osvetleni > 0.98, `úplněk svítí z ${(uplnek.osvetleni * 100).toFixed(1)} %`);
});

test('🚨 datum před rokem 2000 nespadne do záporného zbytku', () => {
  // `%` v JS vrací u záporných čísel záporný zbytek — bez ošetření by z toho
  // vyšel podíl mimo rozsah a fáze by se nenašla vůbec.
  const f = moonPhase(Date.parse('1969-07-20T20:17:00Z'));   // přistání Apolla 11
  assert.ok(f, 'starý datum musí projít');
  assert.ok(f.podil >= 0 && f.podil < 1, `podíl mimo rozsah: ${f.podil}`);
  assert.ok(MOON_KEYS.includes(f.klic));
});

test('celý oběh projde všemi osmi fázemi', () => {
  const start = Date.parse('2026-08-12T17:37:00Z');
  const videne = new Set();
  for (let i = 0; i < 60; i += 1) {
    videne.add(moonPhase(start + i * 0.5 * 86400000).klic);
  }
  assert.equal(videne.size, MOON_KEYS.length,
    `za měsíc se ukázalo jen ${[...videne].join(', ')}`);
});

test('nesmyslný vstup vrátí nic, ne nesmysl', () => {
  assert.equal(moonPhase(NaN), null);
  assert.equal(moonPhase('včera'), null);
});


/* ── přesný okamžik novu a úplňku (Meeus, kap. 49) ─────────────────── */

import { moonEvents, _okamzikFazeJDE } from '../web/lib/moon.js';

test('🚨 Meeus 49.a: nov v únoru 1977 sedí na příklad z knihy', () => {
  // Kniha: k = −283, JDE = 2443192,65118 (18. 2. 1977 03:37:42 TD).
  // Jiná cesta k témuž číslu než náš výpočet — tištěný výsledek.
  const jde = _okamzikFazeJDE(-283);
  assert.ok(Math.abs(jde - 2443192.65118) < 0.00001, `vyšlo ${jde}`);
});

/**
 * VŠECHNY hlavní fáze roku 2026 z katalogu NASA (Espenak, Six Millennium
 * Catalog of Phases of the Moon, eclipse.gsfc.nasa.gov/phase/phases2001.html,
 * staženo 24. 11. 2026, timeanddate.com shodně). Časy v UT na minutu.
 *
 * 🚨 Miki 24. 11. 2026: *„by asi měl hlásit i přesný čtvrt a půlměsíc"*.
 * Čtvrti mají vlastní sadu oprav a oprava W má u první a poslední čtvrti
 * opačné znaménko — prohozené znaménko by tu ujelo o ~4 minuty.
 */
const PRESNE = [
  ['full', '2026-01-03T10:03Z'],
  ['lastQuarter', '2026-01-10T15:48Z'],
  ['new', '2026-01-18T19:52Z'],
  ['firstQuarter', '2026-01-26T04:47Z'],
  ['full', '2026-02-01T22:09Z'],
  ['lastQuarter', '2026-02-09T12:43Z'],
  ['new', '2026-02-17T12:01Z'],
  ['firstQuarter', '2026-02-24T12:28Z'],
  ['full', '2026-03-03T11:38Z'],
  ['lastQuarter', '2026-03-11T09:39Z'],
  ['new', '2026-03-19T01:23Z'],
  ['firstQuarter', '2026-03-25T19:18Z'],
  ['full', '2026-04-02T02:12Z'],
  ['lastQuarter', '2026-04-10T04:52Z'],
  ['new', '2026-04-17T11:52Z'],
  ['firstQuarter', '2026-04-24T02:32Z'],
  ['full', '2026-05-01T17:23Z'],
  ['lastQuarter', '2026-05-09T21:10Z'],
  ['new', '2026-05-16T20:01Z'],
  ['firstQuarter', '2026-05-23T11:11Z'],
  ['full', '2026-05-31T08:45Z'],
  ['lastQuarter', '2026-06-08T10:00Z'],
  ['new', '2026-06-15T02:54Z'],
  ['firstQuarter', '2026-06-21T21:55Z'],
  ['full', '2026-06-29T23:57Z'],
  ['lastQuarter', '2026-07-07T19:29Z'],
  ['new', '2026-07-14T09:43Z'],
  ['firstQuarter', '2026-07-21T11:06Z'],
  ['full', '2026-07-29T14:36Z'],
  ['lastQuarter', '2026-08-06T02:21Z'],
  ['new', '2026-08-12T17:37Z'],
  ['firstQuarter', '2026-08-20T02:46Z'],
  ['full', '2026-08-28T04:18Z'],
  ['lastQuarter', '2026-09-04T07:51Z'],
  ['new', '2026-09-11T03:27Z'],
  ['firstQuarter', '2026-09-18T20:44Z'],
  ['full', '2026-09-26T16:49Z'],
  ['lastQuarter', '2026-10-03T13:25Z'],
  ['new', '2026-10-10T15:50Z'],
  ['firstQuarter', '2026-10-18T16:13Z'],
  ['full', '2026-10-26T04:12Z'],
  ['lastQuarter', '2026-11-01T20:28Z'],
  ['new', '2026-11-09T07:02Z'],
  ['firstQuarter', '2026-11-17T11:48Z'],
  ['full', '2026-11-24T14:53Z'],
  ['lastQuarter', '2026-12-01T06:09Z'],
  ['new', '2026-12-09T00:52Z'],
  ['firstQuarter', '2026-12-17T05:43Z'],
  ['full', '2026-12-24T01:28Z'],
  ['lastQuarter', '2026-12-30T18:59Z'],
];

test('🚨 všech 50 hlavních fází roku 2026 sedí na NASA do 45 s', () => {
  // Tabulka je na minutu (±30 s) a počítá s jiným ΔT; Meeus sám má do ~20 s.
  // Naměřeno 24. 11. 2026: nejvýš 35 s.
  for (const [klic, kdy] of PRESNE) {
    const cil = Date.parse(kdy.replace('Z', ':00Z'));
    const nalez = moonEvents(cil - 86400000, cil + 86400000).filter((u) => u.klic === klic);
    assert.equal(nalez.length, 1, `${klic} ${kdy}: nalezeno ${nalez.length}`);
    const odchylka = Math.abs(nalez[0].ms - cil) / 1000;
    assert.ok(odchylka <= 45, `${klic} ${kdy}: mimo o ${odchylka.toFixed(0)} s`);
  }
  const rok = moonEvents(Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
  assert.equal(rok.length, PRESNE.length, 'za rok 2026 spočteno jiný počet fází než v katalogu');
});

test('fáze jdou v kruhu nov → první čtvrť → úplněk → poslední čtvrť', () => {
  const poradi = ['new', 'firstQuarter', 'full', 'lastQuarter'];
  const rok = moonEvents(Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
  for (let i = 1; i < rok.length; i++) {
    const cekam = poradi[(poradi.indexOf(rok[i - 1].klic) + 1) % 4];
    assert.equal(rok[i].klic, cekam, `po ${rok[i - 1].klic} přišlo ${rok[i].klic}`);
  }
  const ikony = { new: '🌑', firstQuarter: '🌓', full: '🌕', lastQuarter: '🌗' };
  for (const u of rok) assert.equal(u.ikona, ikony[u.klic], u.klic);
});

test('🚨 klíče fází ve zprávě jsou tytéž jako u moonPhase (jeden slovník)', () => {
  for (const klic of ['new', 'firstQuarter', 'full', 'lastQuarter']) assert.ok(MOON_KEYS.includes(klic), klic);
});

test('rozmezí je zleva uzavřené, zprava otevřené; nesmysl vrátí prázdno', () => {
  const u = moonEvents(Date.UTC(2026, 10, 24), Date.UTC(2026, 10, 25))[0];
  assert.equal(moonEvents(u.ms, u.ms + 1).length, 1);
  assert.equal(moonEvents(u.ms - 1, u.ms).length, 0);
  assert.deepEqual(moonEvents(NaN, 5), []);
  assert.deepEqual(moonEvents(10, 5), []);
});

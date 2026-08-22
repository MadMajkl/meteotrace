/**
 * Samotest přiřazení výstrah k místům na trase.
 *
 * Bez prohlížeče a bez sítě. Hranice se berou z přibaleného souboru
 * `web/data/orp-boundaries.js` — to je vygenerovaná statická příloha, ne
 * živá data; síť se při testu nikdy neotvírá.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  unpackAreas, findArea, parseAreaDesc, areaCovers, matchWarningAreas,
} from '../web/lib/orp.js';
import { ORP_DATA } from '../web/data/orp-boundaries.js';

const UZEMI = unpackAreas(ORP_DATA);

/** Zabalí prstenec stejně jako `tools/orp-build.mjs` — pro ručně stavěné případy. */
function zabal(body, meritko = 10000) {
  const out = [];
  let x = 0;
  let y = 0;
  for (const [lon, lat] of body) {
    const nx = Math.round(lon * meritko);
    const ny = Math.round(lat * meritko);
    out.push(nx - x, ny - y);
    x = nx;
    y = ny;
  }
  return out;
}

/** Čtverec 1° × 1° se středem v [50.5, 14.5], volitelně s dírou uprostřed. */
function ctverec({ sDirou = false } = {}) {
  const vnejsi = [[14, 50], [15, 50], [15, 51], [14, 51], [14, 50]];
  const dira = [[14.4, 50.4], [14.6, 50.4], [14.6, 50.6], [14.4, 50.6], [14.4, 50.4]];
  const polygon = sDirou ? [zabal(vnejsi), zabal(dira)] : [zabal(vnejsi)];
  return {
    verze: 1,
    meritko: 10000,
    uzemi: [{
      kod: 1, nazev: 'Zkušebnice', kraj: 'Zkušební kraj',
      obalka: [140000, 500000, 150000, 510000],
      polygony: [polygon],
    }],
  };
}

/* ============================================================
   ROZBALENÍ DAT
   ============================================================ */

test('rozbalení: rozdílové kódování se vrátí na původní souřadnice', () => {
  const [u] = unpackAreas(ctverec());
  const prstenec = u.polygony[0][0];
  // ⚠️ V balíku je [délka, šířka], po rozbalení musí být [šířka, délka].
  assert.deepEqual(prstenec[0], [50, 14]);
  assert.deepEqual(prstenec[1], [50, 15]);
  assert.deepEqual(prstenec[2], [51, 15]);
});

test('rozbalení: obálka se překlopí do [jih, západ, sever, východ]', () => {
  const [u] = unpackAreas(ctverec());
  assert.deepEqual(u.obalka, [50, 14, 51, 15]);
});

test('rozbalení: přibalená data mají všechna území i kraje', () => {
  assert.equal(UZEMI.length, 206);            // 205 ORP + Praha
  assert.equal(ORP_DATA.kraje.length, 14);
  for (const u of UZEMI) {
    assert.ok(u.nazev && u.kraj, `území bez jména nebo kraje: ${JSON.stringify(u.kod)}`);
    assert.ok(ORP_DATA.kraje.includes(u.kraj), `neznámý kraj: ${u.kraj}`);
  }
});

test('🚨 přibalená data: jména ORP musí být jedinečná', () => {
  // Na tomhle stojí celé přiřazování — výstraha se hledá podle JMÉNA ORP.
  // Dvě stejná jména by znamenala výstrahu na nesprávném konci republiky.
  const jmena = UZEMI.map((u) => u.nazev);
  assert.equal(new Set(jmena).size, jmena.length);
});

/* ============================================================
   BOD → ORP
   ============================================================ */

test('bod uvnitř území se najde', () => {
  const areas = unpackAreas(ctverec());
  assert.equal(findArea([50.2, 14.2], areas)?.nazev, 'Zkušebnice');
});

test('🚨 díra v území se počítá jako venku', () => {
  // Není to teorie: Brno leží celé uvnitř ORP Šlapanice.
  const areas = unpackAreas(ctverec({ sDirou: true }));
  assert.equal(findArea([50.5, 14.5], areas), null, 'bod v díře nesmí patřit území');
  assert.equal(findArea([50.2, 14.2], areas)?.nazev, 'Zkušebnice');
});

test('bod daleko od všech území vrátí null', () => {
  const areas = unpackAreas(ctverec());
  assert.equal(findArea([48, 10], areas), null);
});

test('🚨 bod v mezeře u hranice se přiřadí, dál než kilometr už ne', () => {
  // Zjednodušené hranice na sebe přesně nenavazují. Bez rezervy by appka
  // u bodu ve vlásečnicové mezeře MLČELA, přestože výstraha platí.
  const areas = unpackAreas(ctverec());
  const tesneVedle = [50.5, 13.9965];         // ~250 m západně od hranice
  const daleko = [50.5, 13.9];                // ~7 km západně
  assert.equal(findArea(tesneVedle, areas)?.nazev, 'Zkušebnice');
  assert.equal(findArea(daleko, areas), null);
});

test('nesmyslný bod nespadne, jen vrátí null', () => {
  const areas = unpackAreas(ctverec());
  for (const spatny of [null, undefined, [], [NaN, 14], ['50', '14'], [50]]) {
    assert.equal(findArea(spatny, areas), null);
  }
});

test('skutečné hranice: kontrolní body sedí', () => {
  const kde = (p) => findArea(p, UZEMI);
  assert.equal(kde([50.0875, 14.4213])?.nazev, 'Hlavní město Praha');
  assert.equal(kde([50.5344, 14.1316])?.nazev, 'Litoměřice');
  assert.equal(kde([49.8209, 18.2625])?.nazev, 'Ostrava');
  assert.equal(kde([49.9444, 15.2681])?.nazev, 'Kutná Hora');
});

test('🚨 skutečné hranice: Brno není Šlapanice', () => {
  // ORP Šlapanice obklopuje Brno ze všech stran a má v sobě díru. Kdyby se
  // díry ignorovaly, dostal by každý v Brně výstrahy určené Šlapanicím.
  assert.equal(findArea([49.1951, 16.6068], UZEMI)?.nazev, 'Brno');
  assert.equal(findArea([49.1667, 16.7333], UZEMI)?.nazev, 'Šlapanice');
});

test('skutečné hranice: cizina vrátí null', () => {
  // České výstrahy se Vídně ani Drážďan netýkají — a tvrdit opak je horší
  // než mlčet.
  assert.equal(findArea([48.2082, 16.3738], UZEMI), null, 'Vídeň');
  assert.equal(findArea([51.0504, 13.7373], UZEMI), null, 'Drážďany');
  assert.equal(findArea([45, -20], UZEMI), null, 'Atlantik');
});

test('skutečné hranice: kraj u bodu odpovídá kraji ORP', () => {
  assert.equal(findArea([50.5344, 14.1316], UZEMI)?.kraj, 'Ústecký kraj');
  assert.equal(findArea([49.1951, 16.6068], UZEMI)?.kraj, 'Jihomoravský kraj');
  assert.equal(findArea([50.0875, 14.4213], UZEMI)?.kraj, 'Hlavní město Praha');
});

/* ============================================================
   POPIS OBLASTI VE VÝSTRAZE
   ============================================================ */

test('popis: vyjmenovaná ORP se rozeberou', () => {
  const r = parseAreaDesc('Ústecký kraj (Litoměřice, Louny, Lovosice, Roudnice nad Labem)');
  assert.equal(r.ok, true);
  assert.equal(r.kraj, 'Ústecký kraj');
  assert.deepEqual(r.orps, ['Litoměřice', 'Louny', 'Lovosice', 'Roudnice nad Labem']);
});

test('popis: samotný kraj znamená celý kraj, ne prázdný seznam', () => {
  const r = parseAreaDesc('Moravskoslezský kraj');
  assert.equal(r.ok, true);
  assert.equal(r.orps, null, 'null = celý kraj; prázdné pole by znamenalo „nikde"');
});

test('popis: Praha je kraj i ORP zároveň', () => {
  const r = parseAreaDesc('Hlavní město Praha');
  assert.equal(r.kraj, 'Hlavní město Praha');
  assert.equal(r.orps, null);
});

test('popis: jméno s pomlčkou ani s předložkami se nerozpadne', () => {
  const r = parseAreaDesc('Středočeský kraj (Brandýs nad Labem-Stará Boleslav, Mladá Boleslav)');
  assert.deepEqual(r.orps, ['Brandýs nad Labem-Stará Boleslav', 'Mladá Boleslav']);
});

test('popis: prázdný nebo nesmyslný vstup se přizná', () => {
  for (const spatny of ['', '   ', null, undefined, 42]) {
    assert.equal(parseAreaDesc(spatny).ok, false);
  }
});

test('popis: skutečné tvary z feedu se rozeberou všechny', () => {
  // Vzorek ze skutečné odpovědi MeteoAlarmu z 22. 8. 2026.
  const skutecne = [
    'Hlavní město Praha',
    'Středočeský kraj (Čáslav)',
    'Středočeský kraj (Benešov, Čáslav, Kutná Hora, Sedlčany, Vlašim, Votice)',
    'Jihočeský kraj (Milevsko, Tábor)',
    'Plzeňský kraj',
    'Ústecký kraj (Litoměřice, Louny, Lovosice, Roudnice nad Labem)',
    'Liberecký kraj (Frýdlant, Jablonec nad Nisou, Jilemnice, Liberec, Tanvald)',
    'Kraj Vysočina (Havlíčkův Brod, Humpolec, Chotěboř, Pacov, Pelhřimov, Světlá nad Sázavou)',
    'Moravskoslezský kraj (Bruntál, Krnov, Odry, Opava, Rýmařov, Vítkov)',
  ];
  const nazvy = new Set(UZEMI.map((u) => u.nazev));
  for (const popis of skutecne) {
    const r = parseAreaDesc(popis);
    assert.equal(r.ok, true, popis);
    assert.ok(ORP_DATA.kraje.includes(r.kraj), `neznámý kraj v popisu: ${r.kraj}`);
    for (const orp of r.orps || []) {
      assert.ok(nazvy.has(orp), `jméno z feedu není v datech ČÚZK: ${orp}`);
    }
  }
});

/* ============================================================
   TÝKÁ SE VÝSTRAHA MÍSTA?
   ============================================================ */

const LITOMERICE = { nazev: 'Litoměřice', kraj: 'Ústecký kraj' };
const ZATEC = { nazev: 'Žatec', kraj: 'Ústecký kraj' };
const BRNO = { nazev: 'Brno', kraj: 'Jihomoravský kraj' };

test('🚨 výstraha pro celý kraj platí i pro ORP, které v jejím kódu není', () => {
  // Tady je jádro věci. Výstraha „Ústecký kraj" nese ve feedu jediný geokód —
  // ten patří ABECEDNĚ POSLEDNÍMU zasaženému ORP (Žatci). Kdo by přiřazoval
  // podle kódu, ukázal by bouřku jen Žatci a na zbytek kraje by MLČEL.
  assert.equal(areaCovers('Ústecký kraj', LITOMERICE), true);
  assert.equal(areaCovers('Ústecký kraj', ZATEC), true);
  assert.equal(areaCovers('Ústecký kraj', BRNO), false);
});

test('výstraha pro vyjmenovaná ORP platí jen pro ně', () => {
  const popis = 'Ústecký kraj (Litoměřice, Louny)';
  assert.equal(areaCovers(popis, LITOMERICE), true);
  assert.equal(areaCovers(popis, ZATEC), false, 'Žatec ve výčtu není');
});

test('výstraha bez místa se netýká nikoho', () => {
  assert.equal(areaCovers('Ústecký kraj', null), false);
});

test('🚨 nerozebraný popis se raději ukáže, než aby se zamlčel', () => {
  // Rozsah je psaný lidskou češtinou a jeho tvar se může kdykoli změnit.
  // Zamlčená bouřka je horší chyba než výstraha navíc.
  assert.equal(areaCovers('', LITOMERICE), true);
});

/* ============================================================
   VÝBĚR VÝSTRAH PRO TRASU
   ============================================================ */

function vystraha(event, ...popisy) {
  return { event, severity: 'Moderate', areas: popisy.map((name) => ({ name })) };
}

test('výběr: projde jen to, co se týká některého místa na trase', () => {
  const vystrahy = [
    vystraha('Bouřky', 'Ústecký kraj (Litoměřice, Louny)'),
    vystraha('Vichřice', 'Jihomoravský kraj'),
    vystraha('Náledí', 'Zlínský kraj'),
  ];
  const vybrane = matchWarningAreas(vystrahy, [LITOMERICE, BRNO]);
  assert.deepEqual(vybrane.map((v) => v.event), ['Bouřky', 'Vichřice']);
});

test('výběr: u výstrahy je vidět, kterých míst na trase se týká', () => {
  const vystrahy = [vystraha('Bouřky', 'Ústecký kraj')];
  const [v] = matchWarningAreas(vystrahy, [LITOMERICE, ZATEC, BRNO]);
  assert.deepEqual(v.mista, ['Litoměřice', 'Žatec']);
  assert.equal(v.presne, true);
});

test('výběr: totéž ORP se v seznamu neopakuje', () => {
  // Trasa navzorkovaná po pěti kilometrech projde jedním ORP klidně desetkrát.
  const vystrahy = [vystraha('Bouřky', 'Ústecký kraj')];
  const [v] = matchWarningAreas(vystrahy, [LITOMERICE, LITOMERICE, LITOMERICE]);
  assert.deepEqual(v.mista, ['Litoměřice']);
});

test('🚨 výstraha s nerozebraným popisem projde, ale přizná se příznakem', () => {
  // Kdyby se tvářila jako jistá, uživatel by nepoznal odhad od zjištění.
  const [v] = matchWarningAreas([vystraha('Bouřky', '')], [LITOMERICE]);
  assert.equal(v.presne, false);
  assert.deepEqual(v.mista, ['Litoměřice']);
});

test('výběr: prázdné vstupy nespadnou', () => {
  assert.deepEqual(matchWarningAreas(null, null), []);
  assert.deepEqual(matchWarningAreas([], [LITOMERICE]), []);
  assert.deepEqual(matchWarningAreas([vystraha('Bouřky', 'Ústecký kraj')], []), []);
});

test('výběr: výstraha bez oblastí se nikomu nepřiřadí', () => {
  const bezOblasti = { event: 'Bouřky', severity: 'Moderate', areas: [] };
  assert.deepEqual(matchWarningAreas([bezOblasti], [LITOMERICE]), []);
});

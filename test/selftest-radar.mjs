/**
 * Samotest radaru — bez sítě, proti přibalené zmenšenině odpovědi.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  radarFrames, tileTemplate, frameIndexAt, nextFrame, frameLabel, forecastSplit, offsetLabel,
  KROK_ANIMACE_MS, PAUZA_SMYCKY_MS, PAUZA_TED_MS,
  TILE_SIZE, MAX_ZOOM, radarSource, POVOLENE_VLASTNOSTI } from '../web/lib/radar.js';

const ROHY = [[11.267, 52.167], [20.77, 52.167], [20.77, 48.047], [11.267, 48.047]];

/** Zmenšenina skutečné odpovědi RainVieweru (tvar ověřen 21. 8. 2026). */
const FEED = {
  version: '2.0',
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: [
      { time: 1787326200, path: '/v2/radar/1787326200' },
      { time: 1787326800, path: '/v2/radar/1787326800' },
      { time: 1787327400, path: '/v2/radar/1787327400' },
    ],
    nowcast: [
      { time: 1787328000, path: '/v2/radar/nowcast_1787328000' },
      { time: 1787328600, path: '/v2/radar/nowcast_1787328600' },
    ],
  },
};

test('snímky: měření i dopočet jsou v jedné časové ose', () => {
  const f = radarFrames(FEED);
  assert.equal(f.length, 5);
  for (let i = 1; i < f.length; i++) {
    assert.ok(f[i].timeMs > f[i - 1].timeMs, 'časy musí růst');
  }
});

test('🚨 snímky: dopočet je označený, netváří se jako měření', () => {
  // Nowcast je odhad na nejbližší půlhodinu. Kdyby se tvářil jako naměřený
  // stav, uživatel by mu věřil víc, než si zaslouží.
  const f = radarFrames(FEED);
  assert.deepEqual(f.map((x) => x.forecast), [false, false, false, true, true]);
});

test('snímky: čas se převede na milisekundy', () => {
  const [first] = radarFrames(FEED);
  assert.equal(first.timeMs, 1787326200 * 1000);
});

test('snímky: poškozená nebo prázdná odpověď nespadne', () => {
  assert.deepEqual(radarFrames(null), []);
  assert.deepEqual(radarFrames({}), []);
  assert.deepEqual(radarFrames({ host: 'https://x' }), []);
  assert.deepEqual(radarFrames({ host: 'https://x', radar: { past: null } }), []);
});

test('snímky: záznam bez cesty nebo bez času se přeskočí', () => {
  const rozbite = {
    host: 'https://x',
    radar: { past: [{ time: 1 }, { path: '/a' }, { time: 2, path: '/b' }] },
  };
  const f = radarFrames(rozbite);
  assert.equal(f.length, 1);
  assert.equal(f[0].path, 'https://x/b');
});

test('adresa: šablona nechá zástupné texty mapě', () => {
  const [f] = radarFrames(FEED);
  const url = tileTemplate(f);
  assert.ok(url.startsWith('https://tilecache.rainviewer.com/v2/radar/1787326200/512/'));
  assert.ok(url.includes('{z}/{x}/{y}'), 'souřadnice doplní mapová knihovna');
  assert.ok(url.endsWith('/2/1_1.png'));
});

test('adresa: velikost a barvu jde přebít', () => {
  const [f] = radarFrames(FEED);
  assert.ok(tileTemplate(f, { size: 512, color: 4 }).includes('/512/'));
  assert.ok(tileTemplate(f, { size: 512, color: 4 }).endsWith('/4/1_1.png'));
});

test('adresa: chybějící snímek vrátí null, ne rozbitou adresu', () => {
  // Rozbitá adresa by se projevila až tichým 404 na stovkách dlaždic.
  assert.equal(tileTemplate(null), null);
  assert.equal(tileTemplate({}), null);
});

test('🚨 výběr: mapa se otevře na TEĎ, ne na nejstarším snímku', () => {
  const f = radarFrames(FEED);
  assert.equal(frameIndexAt(f, 1787327400 * 1000), 2);
  assert.equal(frameIndexAt(f, 1787327500 * 1000), 2, 'nejbližší, ne následující');
  assert.equal(frameIndexAt(f, 0), 0);
  assert.equal(frameIndexAt([], Date.now()), -1);
});

test('animace: postupuje dopředu a na konci se vrátí', () => {
  const f = radarFrames(FEED);
  assert.equal(nextFrame(f, 0).index, 1);
  assert.equal(nextFrame(f, 3).index, 4);
  assert.equal(nextFrame(f, 4).index, 0, 'z posledního zpět na první');
});

test('🚨 animace: na konci smyčky se čeká déle', () => {
  // Bez pauzy animace „skočí" z konce na začátek a člověk ztratí přehled,
  // kde se právě je.
  const f = radarFrames(FEED);
  const uprostred = nextFrame(f, 1);
  const naKonci = nextFrame(f, 4);
  assert.ok(naKonci.holdMs > uprostred.holdMs * 2, 'pauza musí být znát');
});

test('animace: prázdný seznam nezpůsobí nekonečnou smyčku', () => {
  assert.deepEqual(nextFrame([], 0).index, 0);
});

test('popisek: čas v pásmu místa a příznak dopočtu', () => {
  const f = radarFrames(FEED);
  const mereni = frameLabel(f[0], 'Europe/Prague', 'cs');
  const dopocet = frameLabel(f[4], 'Europe/Prague', 'cs');
  assert.match(mereni.time, /^\d{2}:\d{2}$/);
  assert.equal(mereni.forecast, false);
  assert.equal(dopocet.forecast, true);
});

test('popisek: chybějící snímek dá pomlčku', () => {
  assert.equal(frameLabel(null, 'UTC', 'cs').time, '—');
});

/* ============================================================
   STROP PŘIBLÍŽENÍ

   🚨 Našel to až uživatel na obrazovce, ne test: nad svým stropem RainViewer
   nevrací chybu, ale obrázek se stavem 200 a natištěným nápisem „Zoom Level
   Not Supported". Kontrola stavu odpovědi tuhle vadu NEODHALÍ.
   ============================================================ */

test('🚨 strop přiblížení je pojmenovaná konstanta, ne číslo v mapě', () => {
  // Kdyby ležel jen v map.js, nikdo by ho nenašel a při první úpravě mapy
  // by zmizel. Změřeno 22. 8. 2026: od z8 výš vrací RainViewer cedule.
  assert.equal(typeof MAX_ZOOM, 'number');
  assert.equal(MAX_ZOOM, 7);
});

test('🚨 dlaždice jsou 512px — u 256px si knihovna říká o úroveň navíc', () => {
  // MapLibre má vnitřní dlaždici 512, takže u 256px zdroje žádá z+1. Mapa
  // otevřená na zoomu 7 tak sahala rovnou za strop a ukázala cedule.
  assert.equal(TILE_SIZE, 512);
  const url = tileTemplate({ path: 'https://x/y/123' });
  assert.ok(url.includes('/512/'), url);
});

/* ============================================================
   POSUVNÍK ČASU

   Michal 28. 8. 2026: *„proč nejde vybrat čas přehrávání srážkového
   radaru?"* Animaci šlo jen pustit a zastavit. Tyhle dvě funkce nesou
   všechno, co posuvník potřebuje vědět — a co se dá ověřit bez stránky.
   ============================================================ */

test('dělicí bod osy je podíl, ne pixely ani index', () => {
  const f = [
    { timeMs: 1, forecast: false }, { timeMs: 2, forecast: false },
    { timeMs: 3, forecast: false }, { timeMs: 4, forecast: true },
    { timeMs: 5, forecast: true },
  ];
  // Dopočet začíná čtvrtým z pěti snímků: tři čtvrtiny dráhy jsou měření.
  assert.equal(forecastSplit(f), 0.75);
});

test('🚨 když dopočet chybí, vrací se null — ne nula', () => {
  // Změřeno 28. 8. 2026: RainViewer vrátil `nowcast` prázdný. Nula by
  // obarvila celou osu jako odhad, tedy by lhala o naměřených snímcích.
  const f = [{ timeMs: 1, forecast: false }, { timeMs: 2, forecast: false }];
  assert.equal(forecastSplit(f), null);
  assert.equal(forecastSplit([]), null);
  assert.equal(forecastSplit(null), null);
});

test('osa z jediného snímku nemá kam dělit', () => {
  assert.equal(forecastSplit([{ timeMs: 1, forecast: true }]), null);
});

test('odstup od teď: dozadu, dopředu a okno „teď"', () => {
  const ted = Date.parse('2026-08-28T18:40:00Z');
  assert.deepEqual(offsetLabel({ timeMs: ted - 40 * 60000 }, ted), { key: 'ago', min: 40 });
  assert.deepEqual(offsetLabel({ timeMs: ted + 10 * 60000 }, ted), { key: 'in', min: 10 });
  // Snímky chodí po deseti minutách, takže „teď" musí být okno, ne shoda
  // na sekundu — jinak by slovo „teď" nepadlo skoro nikdy.
  assert.equal(offsetLabel({ timeMs: ted - 2 * 60000 }, ted).key, 'now');
});

test('🚨 odstup se počítá od SKUTEČNÉHO teď, ne od prvního snímku', () => {
  // Kdyby se počítalo od začátku osy, ukazoval by posuvník „před 0 min"
  // u dvě hodiny staré situace — a to je horší než neukázat nic.
  const ted = Date.parse('2026-08-28T18:40:00Z');
  const stare = { timeMs: ted - 120 * 60000 };
  assert.equal(offsetLabel(stare, ted).min, 120);
});

/* ============================================================
   TEMPO ANIMACE

   Michal 28. 8. 2026: *„ty skoky mraků, tu animaci prostě, pomaleji trochu."*
   ============================================================ */

test('krok animace je pojmenovaná konstanta, ne číslo schované v kódu', () => {
  // Tempo je věc na ladění podle oka — musí se dát změnit na jednom místě
  // a musí být vidět v testu, jaké je.
  assert.equal(KROK_ANIMACE_MS, 650);
  assert.ok(PAUZA_SMYCKY_MS > KROK_ANIMACE_MS, 'na konci smyčky se čeká déle');
});

test('🚨 na „teď" se počká — je to předěl měření a předpovědi', () => {
  // Bez zdržení proletí nejdůležitější snímek osy stejně rychle jako ostatní
  // a není poznat, kde končí naměřené a začíná dopočtené.
  const f = [
    { timeMs: 1, forecast: false },
    { timeMs: 2, forecast: false },
    { timeMs: 3, forecast: true },
  ];
  assert.equal(nextFrame(f, 0).holdMs, KROK_ANIMACE_MS, 'uvnitř měření běžné tempo');
  assert.equal(nextFrame(f, 1).holdMs, PAUZA_TED_MS, 'na posledním měření se počká');
  assert.equal(nextFrame(f, 2).holdMs, PAUZA_SMYCKY_MS, 'na konci smyčky taky');
});

test('bez předpovědi se nikde nezdržuje, jen na konci', () => {
  const f = [{ timeMs: 1, forecast: false }, { timeMs: 2, forecast: false }];
  assert.equal(nextFrame(f, 0).holdMs, KROK_ANIMACE_MS);
  assert.equal(nextFrame(f, 1).holdMs, PAUZA_SMYCKY_MS);
});

/* ============================================================
   POPIS ZDROJE PRO MAPU

   🚨 VZNIKLO Z VADY, KTERÁ TIŠE UMLČELA CELOU PŘEDPOVĚĎ (30. 8. 2026).
   Zdroj pro snímky ČHMÚ měl `attribution` — jenže tu zdroj typu `image`
   v MapLibre NEMÁ. Knihovna ho odmítla („unknown property") a vrstva pak
   nenašla svůj zdroj. Minulé snímky jsou `raster` bez popisky, takže se
   kreslily dál; **budoucí se nevykreslily nikdy.**

   Data přitom chodila správně a osa měla i budoucí část — z appky to
   vypadalo, že se od „teď" dopředu prostě nic nechystá. V konzoli byla
   jen tichá poznámka, protože chyby radarového zdroje se přeskakují.
   ============================================================ */

test('🚨 zdroj pro obrázek ČHMÚ NESMÍ mít attribution', () => {
  const zdroj = radarSource({ chmi: true }, { url: 'data:image/png;base64,AAA', rohy: ROHY });
  assert.equal(zdroj.type, 'image');
  assert.ok(!('attribution' in zdroj),
    'MapLibre takový zdroj odmítne a předpověď se nevykreslí vůbec');
});

test('🚨 zdroj obrázku smí mít JEN vlastnosti, které norma zná', () => {
  // Obecněji než jen `attribution`: kdyby se sem přidala jiná neznámá
  // vlastnost, dopadlo by to úplně stejně — a stejně tiše.
  const zdroj = radarSource({ chmi: true }, { url: 'data:image/png;base64,AAA', rohy: ROHY });
  for (const klic of Object.keys(zdroj)) {
    assert.ok(POVOLENE_VLASTNOSTI.image.includes(klic), `neznámá vlastnost „${klic}"`);
  }
});

test('obrázek ČHMÚ nese adresu a rohy výřezu', () => {
  const zdroj = radarSource({ chmi: true }, { url: 'data:image/png;base64,AAA', rohy: ROHY });
  assert.equal(zdroj.url, 'data:image/png;base64,AAA');
  assert.deepEqual(zdroj.coordinates, ROHY);
});

test('dlaždice RainVieweru mají strop přiblížení', () => {
  // ⚠️ Bez `maxzoom` vrací RainViewer nad svým stropem obrázek s nápisem
  // „Zoom Level Not Supported" přes celou mapu — a stavem 200, takže se
  // to nepozná jinak než okem.
  const zdroj = radarSource({ chmi: false }, { url: 'https://x/{z}/{x}/{y}.png' });
  assert.equal(zdroj.type, 'raster');
  assert.equal(zdroj.maxzoom, MAX_ZOOM);
  assert.equal(zdroj.tileSize, TILE_SIZE);
  assert.deepEqual(zdroj.tiles, ['https://x/{z}/{x}/{y}.png']);
});

test('bez adresy se zdroj nesestaví', () => {
  // Prázdná adresa by v MapLibre skončila taky odmítnutím — radši null,
  // o kterém volající ví.
  assert.equal(radarSource({ chmi: true }, { url: '', rohy: ROHY }), null);
  assert.equal(radarSource({ chmi: false }, {}), null);
});

/**
 * Samotest vlastního stylu mapy (`R3`).
 *
 * Bez prohlížeče a bez sítě — styl je jen popis, takže se dá zkontrolovat
 * jako obyčejná data. Že mapa opravdu vypadá dobře, tohle neověří; od toho
 * je pohled na obrazovku. Tady se hlídá to, co se rozbije potichu.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStyle, styleLayerIds } from '../web/lib/map-style.js';
import { tilesSource, tilesUrl, VYCHOZI_DLAZDICE } from '../web/lib/tiles-config.js';

const TILES = 'http://localhost:8099/data/cz.pmtiles';
const styl = (over = {}) => buildStyle({ tilesUrl: TILES, ...over });

/** Vrstvy, které skutečně existují v datech — ověřeno na dlaždici 22. 8. 2026. */
const VRSTVY_DAT = [
  'boundaries', 'buildings', 'earth', 'landcover', 'landuse', 'places', 'pois', 'roads', 'water',
];

/* ============================================================
   NIC NESMÍ VÉST NA CIZÍ DOMÉNU
   ============================================================ */

test('🚨 styl si nikam jinam nesahá — dlaždice ani písma', () => {
  // Styl je jediné místo, kde by se dala do mapy propašovat cizí doména,
  // aniž by si toho někdo všiml (R2, R12). Adresa dlaždic i písem musí
  // mířit na nás.
  const s = styl();
  assert.ok(s.sources.meteotrace.url.startsWith(`pmtiles://${TILES}`), s.sources.meteotrace.url);
  assert.ok(s.glyphs.startsWith('/fonts/'), s.glyphs);
  assert.equal(s.sprite, undefined, 'ikony nemáme, a cizí sadu si tahat nebudeme');
});

test('🚨 v celém stylu není žádná adresa mimo nás', () => {
  const s = styl();
  const text = JSON.stringify(s);
  // Odkaz na licenci OSM v popisce je text pro člověka, ne dotaz na síť.
  const bezPopisky = text.replace(JSON.stringify(s.sources.meteotrace.attribution), '""');
  const cizi = [...bezPopisky.matchAll(/https?:\/\/[^"\\]+/g)]
    .map((m) => m[0])
    .filter((u) => !u.startsWith(TILES));
  assert.deepEqual(cizi, []);
});

/* ============================================================
   STYL ODPOVÍDÁ DATŮM
   ============================================================ */

test('🚨 každá vrstva ukazuje na vrstvu, která v datech existuje', () => {
  // Překlep ve jménu vrstvy se nijak neprojeví — MapLibre mlčky nekreslí nic.
  // Chybějící silnice na mapě se přitom hledá mizerně.
  for (const l of styl().layers) {
    if (l.type === 'background') continue;
    assert.ok(VRSTVY_DAT.includes(l['source-layer']),
      `vrstva „${l.id}" ukazuje na neexistující „${l['source-layer']}"`);
    assert.equal(l.source, 'meteotrace');
  }
});

test('styl kreslí to, bez čeho mapa není mapa', () => {
  const ids = styleLayerIds(styl());
  for (const nutne of ['zeme', 'voda', 'silnice-hlavni', 'mesta']) {
    assert.ok(ids.includes(nutne), `chybí vrstva ${nutne}`);
  }
});

test('🚨 popisky měst jsou úplně nahoře', () => {
  // Radar se vkládá pod ně. Kdyby byly popisky dřív, srážky by je překryly
  // zrovna když se člověk snaží zjistit, nad kterým městem prší.
  const ids = styleLayerIds(styl());
  assert.ok(ids.indexOf('mesta') > ids.indexOf('silnice-hlavni'));
  assert.ok(ids.indexOf('mesta') > ids.indexOf('voda'));
});

/* ============================================================
   MOTIV A JAZYK
   ============================================================ */

test('tmavý a světlý motiv mají tytéž vrstvy, jen jiné barvy', () => {
  const svetly = styl({ dark: false });
  const tmavy = styl({ dark: true });
  assert.deepEqual(styleLayerIds(svetly), styleLayerIds(tmavy));
  assert.notEqual(
    svetly.layers.find((l) => l.id === 'pozadi').paint['background-color'],
    tmavy.layers.find((l) => l.id === 'pozadi').paint['background-color'],
  );
});

test('🚨 popisek se řídí jazykem appky, s návratem na místní jméno', () => {
  // Většina vesnic cizojazyčné jméno nemá. Kdyby se sáhlo jen po `name:cs`,
  // zůstala by na mapě prázdná místa tam, kde jméno existuje.
  const cs = styl({ lang: 'cs' }).layers.find((l) => l.id === 'mesta');
  const en = styl({ lang: 'en' }).layers.find((l) => l.id === 'mesta');
  assert.deepEqual(cs.layout['text-field'], ['coalesce', ['get', 'name:cs'], ['get', 'name']]);
  assert.deepEqual(en.layout['text-field'], ['coalesce', ['get', 'name:en'], ['get', 'name']]);
});

test('popisky používají písma, která máme u sebe', () => {
  const nase = ['Noto Sans Regular', 'Noto Sans Medium'];
  for (const l of styl().layers) {
    for (const font of l.layout?.['text-font'] || []) {
      assert.ok(nase.includes(font), `písmo „${font}" u sebe nemáme`);
    }
  }
});

/* ============================================================
   ODOLNOST
   ============================================================ */

test('styl je platný popis pro MapLibre v základních rysech', () => {
  const s = styl();
  assert.equal(s.version, 8);
  assert.ok(Array.isArray(s.layers) && s.layers.length > 5);
  const ids = styleLayerIds(s);
  assert.equal(new Set(ids).size, ids.length, 'jména vrstev se nesmí opakovat');
  for (const l of s.layers) assert.ok(l.id && l.type, `vrstva bez jména nebo typu: ${JSON.stringify(l)}`);
});

/* ============================================================
   KDE LEŽÍ PODKLAD

   Archiv má 1,4 GB, takže neleží u appky. `R0` chce, aby výměna hostingu
   byla změna konfigurace — ne přepis.
   ============================================================ */

/** Náhrada dokumentu: vrátí značku s danou hodnotou, nebo nic. */
function hlavicka(hodnota) {
  return {
    querySelector: (sel) => (sel.includes('meteotrace:tiles') && hodnota !== null
      ? { getAttribute: () => hodnota }
      : null),
  };
}

test('bez nastavení se jede ze souboru vedle appky', () => {
  assert.equal(tilesSource(hlavicka(null)), VYCHOZI_DLAZDICE);
  assert.equal(tilesSource(hlavicka('')), VYCHOZI_DLAZDICE);
  assert.equal(tilesSource(hlavicka('   ')), VYCHOZI_DLAZDICE, 'samé mezery jsou taky nic');
});

test('🚨 nastavená adresa přebije výchozí — bez zásahu do kódu', () => {
  const cizi = 'https://dlazdice.example/cz.pmtiles';
  assert.equal(tilesSource(hlavicka(cizi)), cizi);
  assert.equal(tilesUrl('http://localhost:8099/', hlavicka(cizi)), cizi,
    'úplná adresa se nesmí přelepit adresou stránky');
});

test('relativní adresa se doplní podle adresy stránky', () => {
  // Knihovna pmtiles potřebuje úplnou adresu; relativní by jí nestačila.
  assert.equal(
    tilesUrl('http://localhost:8099/index.html', hlavicka('/data/cz.pmtiles')),
    'http://localhost:8099/data/cz.pmtiles',
  );
});

test('chybějící dokument nespadne', () => {
  assert.equal(tilesSource(undefined), VYCHOZI_DLAZDICE);
  assert.equal(tilesUrl(undefined, undefined), VYCHOZI_DLAZDICE);
});

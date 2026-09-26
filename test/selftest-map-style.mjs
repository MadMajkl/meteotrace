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
import { existsSync } from 'node:fs';

import { buildStyle, styleLayerIds, labelLayerIds, DETAIL_OD_ZOOMU } from '../web/lib/map-style.js';
import {
  tilesSource, tilesUrl, VYCHOZI_DLAZDICE, worldTilesSource, worldTilesUrl, VYCHOZI_SVET,
  moreTilesSources, moreTilesUrls,
} from '../web/lib/tiles-config.js';

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
  // ⚠️ Cesta k písmům je RELATIVNÍ (`fonts/…`), ne od kořene. V obalu pro
  // Android appka nesedí v kořeni domény a `/fonts/…` by ji minulo — viz
  // selftest-obal.mjs. Pro tenhle test je podstatné, že to není cizí doména.
  assert.ok(s.glyphs.startsWith('fonts/'), s.glyphs);
  assert.equal(s.sprite, undefined, 'ikony nemáme, a cizí sadu si tahat nebudeme');
});

test('🚨 každé písmo ze stylu má VŠECH 256 rozsahů znaků', () => {
  // Chybějící rozsah NENÍ jen chybějící popisek. MapLibre na 404 u glyfů
  // zahodí CELOU dlaždici i s pevninou a silnicemi — Káhira, střed Sahary
  // i půl světa byly do 26. 9. 2026 prázdné, protože jsme měli jen latinku
  // (0–511) a popisky tam jsou arabsky. Prázdné rozsahy jsou platné soubory
  // po pár bajtech; chybět nesmí žádný.
  const pisma = new Set(styl({ svetUrl: 'x' }).layers
    .flatMap((l) => l.layout?.['text-font'] ?? []));
  assert.ok(pisma.size > 0);
  for (const pismo of pisma) {
    const chybi = [];
    for (let od = 0; od < 65536; od += 256) {
      const soubor = new URL(`../web/fonts/${pismo}/${od}-${od + 255}.pbf`, import.meta.url);
      if (!existsSync(soubor)) chybi.push(`${od}-${od + 255}`);
    }
    assert.deepEqual(chybi, [], `${pismo}: chybí rozsahy`);
  }
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

/* ============================================================
   SVĚT POD PODROBNOU MAPOU (R32)
   ============================================================ */

const SVET = 'http://localhost:8099/data/svet-z8.pmtiles';

test('🚨 se světem: dva zdroje, oba na naší adrese, svět DOLE', () => {
  const s = styl({ svetUrl: SVET });
  assert.deepEqual(Object.keys(s.sources), ['svet', 'meteotrace']);
  assert.equal(s.sources.svet.url, `pmtiles://${SVET}`);
  // Pořadí vrstev: pozadí, pak CELÝ svět, pak detail. Kdyby se promíchaly,
  // prosvítaly by v Česku hrubé silnice a popisky světa přes detail.
  const zdroje = s.layers.filter((l) => l.source).map((l) => l.source);
  const prvniDetail = zdroje.indexOf('meteotrace');
  assert.ok(prvniDetail > 0);
  assert.ok(zdroje.slice(0, prvniDetail).every((z) => z === 'svet'));
  assert.ok(zdroje.slice(prvniDetail).every((z) => z === 'meteotrace'));
});

test('🚨 se světem: detail kreslí až od z9, svět od nuly', () => {
  // Do z8 jsou oba archivy táž data — kreslit oba by zdvojilo popisky.
  const s = styl({ svetUrl: SVET });
  for (const l of s.layers.filter((v) => v.source === 'meteotrace')) {
    assert.ok((l.minzoom ?? 0) >= DETAIL_OD_ZOOMU, l.id);
  }
  assert.equal(s.layers.find((l) => l.id === 'svet-zeme').minzoom, undefined);
  // Vlastní spodní hranice vrstvy (budovy od z14) se nesmí srazit dolů.
  assert.equal(s.layers.find((l) => l.id === 'budovy').minzoom, 14);
});

test('🚨 se světem: každá vrstva detailu má dvojče ve světě, a naopak', () => {
  const s = styl({ svetUrl: SVET });
  const detail = s.layers.filter((l) => l.source === 'meteotrace').map((l) => l.id);
  const svet = s.layers.filter((l) => l.source === 'svet').map((l) => l.id);
  assert.deepEqual(svet, detail.map((id) => 'svet-' + id));
});

test('bez světa zůstává styl, jaký byl — jeden zdroj, detail od nuly', () => {
  const s = styl();
  assert.deepEqual(Object.keys(s.sources), ['meteotrace']);
  assert.equal(s.layers.find((l) => l.id === 'zeme').minzoom, undefined);
});

test('🚨 popisky pro klepnutí do mapy: z každého archivu, a nic jiného', () => {
  assert.deepEqual(labelLayerIds(styl({ svetUrl: SVET })),
    ['svet-mesta', 'svet-ctvrti', 'mesta', 'ctvrti']);
  assert.deepEqual(labelLayerIds(styl()), ['mesta', 'ctvrti']);
  // S pevným seznamem by v Sahaře klepnutí na město jméno nenašlo.
  assert.deepEqual(labelLayerIds(styl({ svetUrl: SVET, dalsiUrls: [SAHARA] })),
    ['svet-mesta', 'svet-ctvrti', 'mesta', 'ctvrti', 'sahara-mesta', 'sahara-ctvrti']);
});

/* ============================================================
   DALŠÍ PODROBNÉ OBLASTI (R34)
   ============================================================ */

const SAHARA = 'https://dlazdice.meteotrace.eu/sahara.pmtiles';

test('🚨 další oblast: vlastní zdroj na naší adrese, jméno ze souboru', () => {
  const s = styl({ svetUrl: SVET, dalsiUrls: [SAHARA] });
  assert.deepEqual(Object.keys(s.sources), ['svet', 'meteotrace', 'sahara']);
  assert.equal(s.sources.sahara.url, `pmtiles://${SAHARA}`);
  assert.ok(s.sources.sahara.attribution.includes('OpenStreetMap'));
});

test('🚨 další oblast: svět dole, pak Česko, pak oblast — a každá celá za sebou', () => {
  const s = styl({ svetUrl: SVET, dalsiUrls: [SAHARA] });
  const zdroje = s.layers.filter((l) => l.source).map((l) => l.source);
  const bloky = zdroje.filter((z, i) => z !== zdroje[i - 1]);
  assert.deepEqual(bloky, ['svet', 'meteotrace', 'sahara']);
});

test('🚨 další oblast kreslí až od z9 — i BEZ světa', () => {
  // Vyříznutý archiv má na nízkých přiblíženích dlaždice přes půl
  // kontinentu; od nuly by Sahara zakryla Česko a zdvojila popisky.
  for (const s of [styl({ dalsiUrls: [SAHARA] }), styl({ svetUrl: SVET, dalsiUrls: [SAHARA] })]) {
    for (const l of s.layers.filter((v) => v.source === 'sahara')) {
      assert.ok(l.minzoom >= DETAIL_OD_ZOOMU, l.id);
    }
  }
  // Česko bez světa zůstává od nuly, jako dřív.
  assert.equal(styl({ dalsiUrls: [SAHARA] }).layers.find((l) => l.id === 'zeme').minzoom, undefined);
  assert.equal(styl({ dalsiUrls: [SAHARA] }).layers.find((l) => l.id === 'sahara-budovy').minzoom, 14);
});

test('další oblast: každá vrstva Česka má dvojče v oblasti', () => {
  const s = styl({ svetUrl: SVET, dalsiUrls: [SAHARA] });
  const detail = s.layers.filter((l) => l.source === 'meteotrace').map((l) => l.id);
  const sahara = s.layers.filter((l) => l.source === 'sahara').map((l) => l.id);
  assert.deepEqual(sahara, detail.map((id) => 'sahara-' + id));
});

test('další oblasti: jména se nesrazí, ani s vlastními zdroji', () => {
  const s = styl({
    svetUrl: SVET,
    dalsiUrls: ['https://x/svet.pmtiles', 'https://x/a/andy.pmtiles', 'https://y/andy.pmtiles?v=2', ''],
  });
  assert.deepEqual(Object.keys(s.sources), ['svet', 'meteotrace', 'svet-2', 'andy', 'andy-2']);
  const ids = styleLayerIds(s);
  assert.equal(new Set(ids).size, ids.length, 'id vrstev musí být jedinečná');
});

test('bez dalších oblastí je styl beze změny', () => {
  assert.deepEqual(styl({ svetUrl: SVET, dalsiUrls: [] }), styl({ svetUrl: SVET }));
});

test('adresy dalších oblastí: ze značky, oddělené mezerou; bez značky žádné', () => {
  const hlavicka = (hodnota) => ({
    querySelector: (sel) => (sel.includes('meteotrace:tiles-more') && hodnota !== null
      ? { getAttribute: () => hodnota } : null),
  });
  assert.deepEqual(moreTilesSources(hlavicka(null)), []);
  assert.deepEqual(moreTilesSources(hlavicka('   ')), []);
  assert.deepEqual(moreTilesSources(hlavicka(` ${SAHARA}\n  data/andy.pmtiles `)),
    [SAHARA, 'data/andy.pmtiles']);
  assert.deepEqual(moreTilesUrls('http://localhost:8099/index.html', hlavicka(`${SAHARA} data/andy.pmtiles`)),
    [SAHARA, 'http://localhost:8099/data/andy.pmtiles']);
});

test('adresa světa: ze značky, jinak soubor vedle appky', () => {
  const hlavicka = (hodnota) => ({
    querySelector: (sel) => (sel.includes('meteotrace:tiles-world') && hodnota !== null
      ? { getAttribute: () => hodnota } : null),
  });
  assert.equal(worldTilesSource(hlavicka(null)), VYCHOZI_SVET);
  assert.equal(worldTilesSource(hlavicka('  ')), VYCHOZI_SVET);
  assert.equal(worldTilesUrl('http://localhost:8099/index.html', hlavicka(null)),
    'http://localhost:8099/data/svet-z8.pmtiles');
  const r2 = 'https://dlazdice.meteotrace.eu/svet-z8.pmtiles';
  assert.equal(worldTilesUrl('http://localhost:8099/', hlavicka(r2)), r2);
});

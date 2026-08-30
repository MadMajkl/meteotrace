/**
 * Samotest uložených míst a tras.
 *
 * Bez prohlížeče a bez sítě — sklad je čistý modul, úložiště se nahrazuje
 * obyčejným řetězcem.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  placeKey, routeKey, normalizePlace, cleanName,
  emptyStore, parseStore, serializeStore,
  savePlace, saveRoute, forgetPlace, forgetRoute,
  renamePlace, renameRoute, touchPlace, isSaved, findPlace, findRoute, findNearby, savedAs,
  savedShortcuts, placeAddress, SCHEMA_VERSION, MAX_PLACES, MAX_ROUTES, MAX_NAME,
} from '../web/lib/places.js';

const PRAHA = { name: 'Praha', country: 'Czechia', lat: 50.0755, lon: 14.4378 };
const BRNO = { name: 'Brno', country: 'Czechia', lat: 49.1951, lon: 16.6068 };

/* ============================================================
   IDENTITA MÍSTA
   ============================================================ */

test('klíč: identita je poloha, ne jméno', () => {
  const a = placeKey({ lat: 50.0755, lon: 14.4378 });
  const b = placeKey({ lat: 50.0755, lon: 14.4378 });
  assert.equal(a, b);

  // Dvě různá „Brna" se nesmí slít do jednoho.
  assert.notEqual(placeKey(BRNO), placeKey({ lat: 51.83, lon: 10.15 }));
});

test('🚨 klíč: zaokrouhlení SAMO duplicity nevyřeší — hranice mřížky', () => {
  // Tenhle test spadl při psaní a odhalil chybu v návrhu: dva body METR
  // od sebe, ale každý po jiné straně hranice zaokrouhlení, dostanou různý
  // klíč. Žádná mřížka to nespraví, jen posune hranici jinam — proto se
  // shoda hledá vzdáleností, ne klíčem.
  assert.notEqual(
    placeKey({ lat: 50.07551, lon: 14.4378 }),
    placeKey({ lat: 50.07549, lon: 14.4378 }),
  );
  assert.ok(
    findNearby({ places: [normalizePlace({ name: 'A', lat: 50.07551, lon: 14.4378 })] },
      { lat: 50.07549, lon: 14.4378 }),
    'vzdálenost je na to správný nástroj',
  );
});

test('shoda: sto metrů je totéž místo, kilometr už ne', () => {
  const store = savePlace(emptyStore(), PRAHA, 1000).store;
  assert.ok(findNearby(store, { lat: PRAHA.lat + 0.0009, lon: PRAHA.lon }), '~100 m');
  assert.equal(findNearby(store, { lat: PRAHA.lat + 0.009, lon: PRAHA.lon }), null, '~1 km');
});

test('shoda: vyhraje nejbližší, ne první v pořadí', () => {
  // Kdo si uloží dům a hospodu o dvě ulice dál, musí při uložení třetího
  // trefit to správné.
  // Obě jsou do 150 m od dotazu, ale 190 m od sebe — takže se uloží obě.
  let store = savePlace(emptyStore(), { name: 'Hospoda', lat: 49.9991, lon: 14.0 }, 1000).store;
  store = savePlace(store, { name: 'Dům', lat: 50.0008, lon: 14.0 }, 2000).store;
  assert.equal(store.places.length, 2);
  assert.equal(findNearby(store, { lat: 50.0, lon: 14.0 }).name, 'Dům');
});

test('shoda: blízké místo se neuloží podruhé, jen se přiživí', () => {
  let store = savePlace(emptyStore(), { name: 'Doma', lat: 50.0, lon: 14.0 }, 1000).store;
  const res = savePlace(store, { name: 'Parkoviště', lat: 50.0008, lon: 14.0 }, 2000);
  assert.equal(res.changed, false, '~90 m je pořád totéž místo');
  assert.equal(res.store.places.length, 1);
  assert.equal(res.store.places[0].name, 'Doma');
});

test('🚨 klíč: záporná nula se nesmí stát druhým klíčem téhož místa', () => {
  // (-0.0001).toFixed(3) je '-0.000', (0.0001).toFixed(3) je '0.000' —
  // body jedenáct metrů od sebe by na rovníku dostaly různé klíče.
  assert.equal(placeKey({ lat: -0.0001, lon: 0.0001 }), placeKey({ lat: 0.0001, lon: -0.0001 }));
  assert.equal(placeKey({ lat: 0, lon: 0 }), '0.000,0.000');
  assert.ok(!placeKey({ lat: -0.0001, lon: 0 }).includes('-0.000'));
});

test('🚨 klíč: nula je platná souřadnice, ne chybějící údaj', () => {
  // Guinejský záliv existuje. `if (!place.lat)` by ho zahodilo.
  assert.equal(placeKey({ lat: 0, lon: 0 }), '0.000,0.000');
  assert.ok(normalizePlace({ name: 'Nulový ostrov', lat: 0, lon: 0 }));
});

test('klíč: nesmyslná poloha se neuloží', () => {
  assert.equal(placeKey({ lat: 91, lon: 0 }), null);
  assert.equal(placeKey({ lat: 0, lon: 181 }), null);
  assert.equal(placeKey({ lat: NaN, lon: 0 }), null);
  assert.equal(placeKey({ lat: '50', lon: '14' }), null, 'řetězec není souřadnice');
  assert.equal(placeKey(null), null);
  assert.equal(normalizePlace({ name: 'Nikde', lat: 999, lon: 999 }), null);
});

test('klíč trasy: způsob dopravy je součástí identity', () => {
  const car = routeKey({ from: PRAHA, to: BRNO, profile: 'car' });
  const bike = routeKey({ from: PRAHA, to: BRNO, profile: 'bike' });
  assert.notEqual(car, bike, 'autem a na kole je jiná trasa mezi týmiž body');

  // Opačný směr je taky jiná trasa — jednosměrky, převýšení.
  assert.notEqual(car, routeKey({ from: BRNO, to: PRAHA, profile: 'car' }));
  assert.equal(routeKey({ from: PRAHA, to: { lat: 999, lon: 0 } }), null);
});

/* ============================================================
   OČIŠTĚNÍ JMÉNA
   ============================================================ */

test('jméno: bílé znaky se srovnají', () => {
  assert.equal(cleanName('  Praha  '), 'Praha');
  assert.equal(cleanName('Ústí nad\n  Labem'), 'Ústí nad Labem');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName(42), '');
});

test('jméno: příliš dlouhé se ořízne', () => {
  assert.equal(cleanName('x'.repeat(500)).length, MAX_NAME);
});

test('jméno: bez jména se ukáže poloha, ne prázdno', () => {
  const p = normalizePlace({ lat: 50.0755, lon: 14.4378 });
  assert.equal(p.name, p.key, 'prázdný řádek vypadá jako chyba appky');
});

test('normalizace: souřadnice si nechají plnou přesnost', () => {
  const p = normalizePlace(PRAHA);
  assert.equal(p.lat, 50.0755, 'klíč je jen pro porovnání, ptáme se na skutečný bod');
  assert.equal(p.lon, 14.4378);
});

/* ============================================================
   UKLÁDÁNÍ
   ============================================================ */

test('uložení: místo se přidá a najde', () => {
  const { store, changed } = savePlace(emptyStore(), PRAHA, 1000);
  assert.equal(changed, true);
  assert.equal(store.places.length, 1);
  assert.equal(isSaved(store, PRAHA), true);
  assert.equal(isSaved(store, BRNO), false);
  assert.equal(findPlace(store, placeKey(PRAHA)).name, 'Praha');
});

test('uložení: totéž místo podruhé nezaloží druhou položku', () => {
  let store = savePlace(emptyStore(), PRAHA, 1000).store;
  const second = savePlace(store, { ...PRAHA, lat: 50.07552 }, 2000);
  assert.equal(second.changed, false);
  assert.equal(second.store.places.length, 1);
  assert.equal(second.store.places[0].usedAt, 2000, 'jen se přiživí');
});

test('🚨 uložení: opakované uložení nepřepíše vlastní jméno', () => {
  // Kdo si Prahu přejmenoval na „Domov", nesmí o to jméno přijít tím,
  // že si ji příště najde ve vyhledávání.
  let store = savePlace(emptyStore(), PRAHA, 1000).store;
  store = renamePlace(store, placeKey(PRAHA), 'Domov');
  store = savePlace(store, PRAHA, 2000).store;
  assert.equal(store.places[0].name, 'Domov');
});

test('uložení: chybějící údaj se doplní, vyplněný zůstane', () => {
  let store = savePlace(emptyStore(), { ...PRAHA, country: null }, 1000).store;
  assert.equal(store.places[0].country, null);
  store = savePlace(store, PRAHA, 2000).store;
  assert.equal(store.places[0].country, 'Czechia');
});

test('uložení: nesmyslné místo sklad nezmění', () => {
  const before = savePlace(emptyStore(), PRAHA, 1000).store;
  const after = savePlace(before, { name: 'Nikde', lat: 'x', lon: 'y' }, 2000);
  assert.equal(after.changed, false);
  assert.equal(after.store.places.length, 1);
});

test('řazení: nejnovější nahoře a pořadí se pak už nemění', () => {
  // Seznam, který se přerovnává podle četnosti použití, se nedá naučit
  // nazpaměť — a klepnout vedle je horší než o řádek scrollovat.
  let store = savePlace(emptyStore(), PRAHA, 1000).store;
  store = savePlace(store, BRNO, 2000).store;
  assert.deepEqual(store.places.map((p) => p.name), ['Brno', 'Praha']);

  store = touchPlace(store, placeKey(PRAHA), 9000);
  assert.deepEqual(store.places.map((p) => p.name), ['Brno', 'Praha'], 'použití nepřerovnává');
});

test('smazání: neznámý klíč není chyba', () => {
  let store = savePlace(emptyStore(), PRAHA, 1000).store;
  store = forgetPlace(store, 'nic-takového');
  assert.equal(store.places.length, 1);
  store = forgetPlace(store, placeKey(PRAHA));
  assert.equal(store.places.length, 0);
});

test('🚨 přejmenování: prázdné jméno nechá původní, nedosadí klíč', () => {
  // Změněno 22. 8. 2026 při stavbě správy míst. Dřív se dosadil klíč —
  // jenže to je vnitřní adresa záznamu, ne jméno. Kdo omylem smazal text,
  // uviděl místo „Domova" souřadnice a původní jméno bylo nenávratně pryč.
  let store = savePlace(emptyStore(), PRAHA, 1000).store;
  store = renamePlace(store, placeKey(PRAHA), 'Domov');
  const pred = store;
  store = renamePlace(store, placeKey(PRAHA), '   ');
  assert.equal(store.places[0].name, 'Domov');
  assert.equal(store, pred, 'sklad se nemá měnit vůbec, ať to volající pozná');
});

/* ============================================================
   SLUČOVÁNÍ SE MUSÍ DÁT VYSVĚTLIT
   ============================================================ */

test('🚨 pokrytí jiným jménem se hlásí — jinak je hvězdička past', () => {
  // Kdo si uloží „Prahu" a otevře „Karlín" o 120 m dál, uvidí rozsvícenou
  // hvězdičku u místa, které nikdy neukládal — a klepnutím smaže Prahu.
  const store = savePlace(emptyStore(), PRAHA, 1000).store;
  const karlin = { name: 'Karlín', lat: PRAHA.lat + 0.0011, lon: PRAHA.lon };

  assert.equal(isSaved(store, karlin), true, 'hvězdička svítí');
  assert.equal(savedAs(store, karlin).name, 'Praha', 'a musí se říct proč');
});

test('shodné jméno se nehlásí — není co vysvětlovat', () => {
  const store = savePlace(emptyStore(), PRAHA, 1000).store;
  assert.equal(savedAs(store, { name: 'Praha', lat: PRAHA.lat + 0.0008, lon: PRAHA.lon }), null);
  assert.equal(savedAs(store, { name: 'praha', lat: PRAHA.lat, lon: PRAHA.lon }), null,
    'velikost písmen nerozhoduje');
});

test('vzdálené místo se nehlásí jako pokryté', () => {
  const store = savePlace(emptyStore(), PRAHA, 1000).store;
  assert.equal(savedAs(store, BRNO), null);
  assert.equal(savedAs(store, { name: 'X', lat: 'nesmysl' }), null);
});

/* ============================================================
   STROP A VYHAZOVÁNÍ
   ============================================================ */

test('🚨 strop: vyhazuje se nejdéle NEPOUŽITÉ, ne nejdéle uložené', () => {
  // Místo, na které se uživatel dívá každé ráno pět let, musí zůstat.
  let store = emptyStore();
  for (let i = 0; i < MAX_PLACES; i++) {
    store = savePlace(store, { name: `M${i}`, lat: 40 + i * 0.01, lon: 10 }, 1000 + i).store;
  }
  assert.equal(store.places.length, MAX_PLACES);

  // Nejstarší uložené (M0) se používá pořád, nejnovější (M49) nikdy.
  store = touchPlace(store, placeKey({ lat: 40, lon: 10 }), 500000);

  const res = savePlace(store, { name: 'Nové', lat: 60, lon: 20 }, 600000);
  assert.equal(res.store.places.length, MAX_PLACES);
  assert.equal(res.full, true, 'UI se má dozvědět, že se něco vyhodilo');
  assert.ok(res.store.places.some((p) => p.name === 'M0'), 'často používané zůstává');
  assert.ok(res.store.places.some((p) => p.name === 'Nové'));
  assert.ok(!res.store.places.some((p) => p.name === 'M1'), 'nejdéle nepoužité vypadlo');
});

test('strop tras platí zvlášť od stropu míst', () => {
  let store = emptyStore();
  for (let i = 0; i < MAX_ROUTES + 5; i++) {
    store = saveRoute(store, {
      from: { name: 'A', lat: 50 + i * 0.01, lon: 14 },
      to: BRNO, profile: 'car',
    }, 1000 + i).store;
  }
  assert.equal(store.routes.length, MAX_ROUTES);
  assert.equal(store.places.length, 0);
});

/* ============================================================
   TRASY
   ============================================================ */

test('trasa: uloží se body a způsob dopravy, ne geometrie', () => {
  const { store, route } = saveRoute(emptyStore(), { from: PRAHA, to: BRNO, profile: 'car' }, 1000);
  assert.equal(store.routes.length, 1);
  assert.equal(route.from.name, 'Praha');
  assert.equal(route.to.name, 'Brno');
  assert.equal(route.name, 'Praha → Brno', 'jméno se složí, dokud si ho uživatel nezmění');
  assert.ok(!('points' in route), 'silnice se mění, geometrie se stáhne znovu');
});

test('trasa: vlastní jméno má přednost před složeným', () => {
  const { route } = saveRoute(emptyStore(), {
    from: PRAHA, to: BRNO, profile: 'car', name: 'Do práce',
  }, 1000);
  assert.equal(route.name, 'Do práce');
});

test('trasa: neúplná se neuloží', () => {
  const res = saveRoute(emptyStore(), { from: PRAHA, to: null }, 1000);
  assert.equal(res.changed, false);
  assert.equal(res.store.routes.length, 0);
});

test('trasa: smazání a hledání podle klíče', () => {
  let store = saveRoute(emptyStore(), { from: PRAHA, to: BRNO, profile: 'car' }, 1000).store;
  const key = routeKey({ from: PRAHA, to: BRNO, profile: 'car' });
  assert.ok(findRoute(store, key));
  store = forgetRoute(store, key);
  assert.equal(findRoute(store, key), null);
});

/* ============================================================
   ÚLOŽIŠTĚ: ČTENÍ, ZÁPIS, ODOLNOST
   ============================================================ */

test('kolečko: co se uloží, to se načte', () => {
  let store = savePlace(emptyStore(), PRAHA, 1000).store;
  store = savePlace(store, BRNO, 2000).store;
  store = saveRoute(store, { from: PRAHA, to: BRNO, profile: 'car' }, 3000).store;

  const back = parseStore(serializeStore(store));
  assert.deepEqual(back.places.map((p) => p.name), ['Brno', 'Praha']);
  assert.equal(back.routes.length, 1);
  assert.equal(back.places[0].usedAt, 2000, 'čas použití přežije restart');
});

test('poškozený obsah: začne se načisto, ale zápis zůstane povolený', () => {
  // Read-only sklad bez dat by znamenal, že si uživatel po jednom pokaženém
  // zápisu už nikdy nic neuloží.
  for (const junk of ['{ tohle není json', '[]', 'null', '"text"', '42']) {
    const store = parseStore(junk);
    assert.equal(store.places.length, 0, junk);
    assert.equal(store.readOnly, false, junk);
    assert.ok(serializeStore(store), junk);
  }
  assert.equal(parseStore('').places.length, 0);
  assert.equal(parseStore(undefined).places.length, 0);
});

test('jeden poškozený záznam nezahodí zbytek seznamu', () => {
  const store = parseStore(JSON.stringify({
    version: SCHEMA_VERSION,
    places: [
      PRAHA,
      { name: 'Rozbité', lat: 'x', lon: 'y' },
      null,
      BRNO,
    ],
  }));
  assert.deepEqual(store.places.map((p) => p.name), ['Praha', 'Brno']);
});

test('načtení zahodí duplicity, ať už vznikly jakkoli', () => {
  const store = parseStore(JSON.stringify({
    version: SCHEMA_VERSION,
    places: [PRAHA, { ...PRAHA, name: 'Praha znovu' }],
  }));
  assert.equal(store.places.length, 1);
  assert.equal(store.places[0].name, 'Praha', 'vyhrává první, ne poslední');
});

test('🚨 novější verze schématu se otevře jen pro čtení', () => {
  // V Androidu si WebView může držet starší kopii webových souborů, než
  // jaká data zapsala. Starší kód nesmí novější data přepsat svým tvarem.
  const future = JSON.stringify({
    version: SCHEMA_VERSION + 1,
    places: [PRAHA, BRNO],
    routes: [],
  });
  const store = parseStore(future);

  assert.equal(store.readOnly, true);
  assert.equal(store.places.length, 2, 'číst se dá — uživatel o seznam nepřijde');
  assert.equal(serializeStore(store), null, 'zapsat se nedá — nemá co přepsat');

  // Žádná změna neprojde, ani mazání.
  assert.equal(savePlace(store, { name: 'X', lat: 10, lon: 10 }, 1).changed, false);
  assert.equal(forgetPlace(store, placeKey(PRAHA)).places.length, 2);
  assert.equal(renamePlace(store, placeKey(PRAHA), 'Domov').places[0].name, 'Praha');
  assert.equal(touchPlace(store, placeKey(PRAHA), 9).places[0].usedAt, 0);
  assert.equal(saveRoute(store, { from: PRAHA, to: BRNO }, 1).changed, false);
});

test('starší verze schématu se načte a povýší', () => {
  const store = parseStore(JSON.stringify({ version: 0, places: [PRAHA] }));
  assert.equal(store.readOnly, false);
  assert.equal(store.version, SCHEMA_VERSION);
  assert.equal(store.places.length, 1);
});

test('🚨 povýšení nesmí ztratit ani jedno místo', () => {
  // Až přibude verze 2, musí sem přibýt krok v MIGRATIONS a test k němu.
  // Tenhle test hlídá pravidlo samo: co bylo uložené, to po povýšení zůstává.
  const before = [PRAHA, BRNO, { name: 'Wien', lat: 48.2082, lon: 16.3719 }];
  for (const version of [0, 1, undefined]) {
    const store = parseStore(JSON.stringify({ version, places: before }));
    assert.deepEqual(
      store.places.map((p) => p.name),
      ['Praha', 'Brno', 'Wien'],
      `verze ${version}`,
    );
  }
});

test('chybějící verze se bere jako současná', () => {
  const store = parseStore(JSON.stringify({ places: [PRAHA] }));
  assert.equal(store.readOnly, false);
  assert.equal(store.places.length, 1);
});

test('sklad se mění kopií, ne na místě', () => {
  // Kdyby se sklad měnil na místě, UI by nepoznalo, že se něco stalo,
  // a hlavně by šlo obejít read-only.
  const before = savePlace(emptyStore(), PRAHA, 1000).store;
  const after = savePlace(before, BRNO, 2000).store;
  assert.equal(before.places.length, 1);
  assert.equal(after.places.length, 2);
  assert.notEqual(before.places, after.places);
});

/* ============================================================
   PŘEJMENOVÁNÍ TRASY

   „Praha → Brno" je popis, ne jméno. Lidsky je to „do práce" — a Michal
   25. 8. 2026: „aby si tam někdo mohl dát Domov, Práce… Babička."
   ============================================================ */

test('trasa se dá přejmenovat', () => {
  const store = saveRoute(emptyStore(), { from: PRAHA, to: BRNO, profile: 'driving-car' }, 1000).store;
  const klic = store.routes[0].key;
  const po = renameRoute(store, klic, 'Do práce');
  assert.equal(po.routes[0].name, 'Do práce');
  assert.equal(po.routes[0].key, klic, 'jméno není identita — klíč se nemění');
});

test('🚨 prázdné jméno trasu NEPŘEJMENUJE', () => {
  // Dosadit klíč nebo prázdno by znamenalo, že uživatel přijde o jméno
  // omylem — třeba když pole vyprázdní a klepne vedle.
  const store = saveRoute(emptyStore(), { from: PRAHA, to: BRNO, profile: 'driving-car' }, 1000).store;
  const klic = store.routes[0].key;
  const puvodni = store.routes[0].name;
  for (const nesmysl of ['', '   ', null, undefined]) {
    assert.equal(renameRoute(store, klic, nesmysl).routes[0].name, puvodni);
  }
});

test('v režimu jen pro čtení se trasa nepřejmenuje', () => {
  const store = { ...saveRoute(emptyStore(), { from: PRAHA, to: BRNO, profile: 'driving-car' }, 1000).store, readOnly: true };
  assert.equal(renameRoute(store, store.routes[0].key, 'Do práce'), store, 'sklad se nemění');
});

/* ============================================================
   MEZIBODY V ULOŽENÉ TRASE

   🚨 Plzeň → Klatovy měří 44 km, přes Domažlice 97. Je to jiná cesta, jiný
   čas i jiné počasí — a musí to být jiný záznam.
   ============================================================ */

const DOMAZLICE = { name: 'Domažlice', country: 'Czechia', lat: 49.4407, lon: 12.9294 };

test('🚨 trasa s mezibodem je JINÁ trasa než přímá', () => {
  let store = saveRoute(emptyStore(), { from: PRAHA, to: BRNO, profile: 'driving-car' }, 1000).store;
  store = saveRoute(store, { from: PRAHA, to: BRNO, via: [DOMAZLICE], profile: 'driving-car' }, 2000).store;

  assert.equal(store.routes.length, 2, 'obě se musí uložit zvlášť');
  assert.notEqual(store.routes[0].key, store.routes[1].key);
});

test('tatáž trasa s týmž mezibodem se neuloží dvakrát', () => {
  let store = saveRoute(emptyStore(), { from: PRAHA, to: BRNO, via: [DOMAZLICE], profile: 'driving-car' }, 1000).store;
  const res = saveRoute(store, { from: PRAHA, to: BRNO, via: [DOMAZLICE], profile: 'driving-car' }, 2000);
  assert.equal(res.store.routes.length, 1);
  assert.equal(res.changed, false, 'jen se osvěží čas použití');
});

test('🚨 pořadí mezibodů rozhoduje', () => {
  // Praha → Domažlice → Brno je něco jiného než Praha → Brno → Domažlice.
  const a = { from: PRAHA, to: BRNO, via: [DOMAZLICE, { ...PRAHA, lat: 49.9, lon: 15.2 }], profile: 'driving-car' };
  const b = { from: PRAHA, to: BRNO, via: [{ ...PRAHA, lat: 49.9, lon: 15.2 }, DOMAZLICE], profile: 'driving-car' };
  let store = saveRoute(emptyStore(), a, 1000).store;
  store = saveRoute(store, b, 2000).store;
  assert.equal(store.routes.length, 2);
});

test('rozdělaný mezibod se do uložené trasy nepřenáší', () => {
  // Prázdné pole je „ještě jsem nevybral", ne zastávka.
  const store = saveRoute(emptyStore(), { from: PRAHA, to: BRNO, via: [null, DOMAZLICE, undefined], profile: 'driving-car' }, 1000).store;
  assert.equal(store.routes[0].via.length, 1);
  assert.equal(store.routes[0].via[0].name, 'Domažlice');
});

test('uložená trasa mezibody přežije uložení i načtení', () => {
  const store = saveRoute(emptyStore(), { from: PRAHA, to: BRNO, via: [DOMAZLICE], profile: 'driving-car' }, 1000).store;
  const zpet = parseStore(serializeStore(store));
  assert.equal(zpet.routes[0].via.length, 1);
  assert.equal(zpet.routes[0].via[0].lat, DOMAZLICE.lat);
});

/* ============================================================
   SPOLEČNÝ ŘÁDEK ULOŽENÝCH VĚCÍ

   Z pohledu člověka je „Domov" i „do práce" totéž: věc, na kterou klepnu
   a appka mi ukáže počasí. Dva řádky na dvou místech = dva mechanismy
   k naučení.
   ============================================================ */

test('společný řádek nese místa i trasy a je poznat, co je co', () => {
  let store = savePlace(emptyStore(), PRAHA, 1000).store;
  store = saveRoute(store, { from: PRAHA, to: BRNO, profile: 'driving-car' }, 2000).store;

  const vse = savedShortcuts(store);
  assert.equal(vse.length, 2);
  assert.deepEqual(vse.map((x) => x.kind), ['place', 'route']);
  assert.equal(vse[0].name, 'Praha');
  assert.equal(vse[1].name, 'Praha → Brno');
});

test('🚨 nejdřív místa, pak trasy — nemíchají se podle času uložení', () => {
  // Trasa mezi dvěma místy vypadá jako omyl; skupiny dají řádku strukturu.
  let store = saveRoute(emptyStore(), { from: PRAHA, to: BRNO, profile: 'driving-car' }, 1000).store;
  store = savePlace(store, PRAHA, 2000).store;   // uloženo POZDĚJI než trasa
  store = savePlace(store, BRNO, 3000).store;

  assert.deepEqual(savedShortcuts(store).map((x) => x.kind), ['place', 'place', 'route']);
});

test('🚨 pořadí uvnitř skupiny se nepřerovnává podle použití', () => {
  // Rozhodnuto 22. 8.: seznam, který se sám přerovnává, se nedá naučit
  // nazpaměť — a klepnout vedle je horší než o kousek odrolovat.
  let store = savePlace(emptyStore(), PRAHA, 1000).store;
  store = savePlace(store, BRNO, 2000).store;
  const pred = savedShortcuts(store).map((x) => x.name);

  store = touchPlace(store, store.places[1].key, 9999);   // použiju tu spodní
  assert.deepEqual(savedShortcuts(store).map((x) => x.name), pred, 'pořadí zůstává');
});

test('prázdný sklad vrátí prázdný řádek, ne výjimku', () => {
  assert.deepEqual(savedShortcuts(emptyStore()), []);
  assert.deepEqual(savedShortcuts(null), []);
});

/* ============================================================
   ADRESA VS. JMÉNO (30. 8. 2026)

   🚨 Michal: „je divné přepisovat názvem adresu." Dokud místo neslo jen
   jedno pole, přejmenováním se adresa NENÁVRATNĚ ZTRATILA a v seznamu
   pak stálo pět „Domov, Práce, Babička" bez jediné stopy, kde vlastně jsou.
   ============================================================ */

test('🚨 přejmenování NESMÍ sebrat adresu', () => {
  let s = savePlace(emptyStore(), {
    lat: 49.53, lon: 12.94, name: 'Horšovský Týn', country: 'Česko',
  }, 1).store;
  const klic = s.places[0].key;

  s = renamePlace(s, klic, 'Domov');
  assert.equal(s.places[0].name, 'Domov');
  assert.equal(placeAddress(s.places[0]), 'Horšovský Týn', 'adresa zůstává');
});

test('adresa přežije uložení a načtení', () => {
  let s = savePlace(emptyStore(), { lat: 49.53, lon: 12.94, name: 'Plzeň' }, 1).store;
  s = renamePlace(s, s.places[0].key, 'Babička');
  const znovu = parseStore(serializeStore(s));
  assert.equal(znovu.places[0].name, 'Babička');
  assert.equal(placeAddress(znovu.places[0]), 'Plzeň');
});

test('⚠️ starší záznam bez adresy spadne na jméno, ne na prázdno', () => {
  // Místa uložená před 30. 8. 2026 `address` nemají. U nepřejmenovaných
  // je `name` adresou pořád; prázdná buňka by vypadala jako chyba.
  const stary = parseStore(JSON.stringify({
    version: 1,
    places: [{ key: '50.076,14.438', lat: 50.0755, lon: 14.4378, name: 'Praha', savedAt: 1, usedAt: 1 }],
    routes: [],
  }));
  assert.equal(placeAddress(stary.places[0]), 'Praha');
});

test('placeAddress nespadne na nesmyslech', () => {
  assert.equal(placeAddress(null), '');
  assert.equal(placeAddress({}), '');
  assert.equal(placeAddress(undefined), '');
});

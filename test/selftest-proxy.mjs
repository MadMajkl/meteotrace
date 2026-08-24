/**
 * Samotest katalogu vzdálených zdrojů — bez sítě.
 *
 * Většina těchhle kontrol je BEZPEČNOSTNÍCH. Proxy je jediné místo, kde náš
 * server sahá ven na cizí adresy; když se tady něco pokazí, není to kosmetická
 * vada, ale otevřená proxy. Proto se to hlídá strojem, ne pohledem.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UPSTREAMS,
  isKnownService,
  filterParams,
  buildUrl,
  upstreamHeaders,
  cacheKey,
  ttlFor,
  trimWarnings,
} from '../web/lib/upstreams.js';

/* ============================================================
   SEZNAM SLUŽEB
   ============================================================ */

test('katalog: zná jen vyjmenované služby', () => {
  assert.equal(isKnownService('forecast'), true);
  assert.equal(isKnownService('route'), true);
  assert.equal(isKnownService('neexistuje'), false);
});

test('katalog: jméno služby nejde podstrčit přes dědičnost objektu', () => {
  // Klasická past: `'toString' in obj` je true u každého objektu.
  // Kdyby se kontrolovalo přes `in`, prošly by názvy jako 'constructor'.
  assert.equal(isKnownService('toString'), false);
  assert.equal(isKnownService('constructor'), false);
  assert.equal(isKnownService('__proto__'), false);
});

test('katalog: každá služba má základ, seznam parametrů a platnost', () => {
  for (const [name, spec] of Object.entries(UPSTREAMS)) {
    assert.ok(spec.base.startsWith('https://'), `${name}: základ musí být https`);
    assert.ok(Array.isArray(spec.params), `${name}: chybí seznam parametrů`);
    assert.ok(spec.ttl > 0, `${name}: chybí platnost`);
  }
});

test('katalog: neznámá služba je chyba, ne tichý průchod', () => {
  assert.throws(() => buildUrl('neexistuje', {}));
  assert.throws(() => ttlFor('neexistuje'));
  assert.throws(() => upstreamHeaders('neexistuje'));
});

/* ============================================================
   PROPOUŠTĚNÍ PARAMETRŮ
   ============================================================ */

test('parametry: projde jen to, co je na seznamu', () => {
  const { allowed, dropped } = filterParams('forecast', {
    latitude: '50.1', longitude: '14.4', hourly: 'temperature_2m',
    apikey: 'ukradeno', callback: 'zlo',
  });
  assert.deepEqual(Object.keys(allowed).sort(), ['hourly', 'latitude', 'longitude']);
  assert.deepEqual(dropped.sort(), ['apikey', 'callback']);
});

test('parametry: zahozené se hlásí, nezamlčují', () => {
  // Tiché zahazování je nejhorší druh chyby — volající vidí odpověď,
  // jen jinou, než čekal. Musí to jít vidět v logu.
  const { dropped } = filterParams('radar', { cokoli: '1' });
  assert.deepEqual(dropped, ['cokoli']);
});

test('parametry: zvládne URLSearchParams i obyčejný objekt', () => {
  const fromObj = filterParams('geocodeBasic', { name: 'Brno', count: '5' });
  const fromUsp = filterParams('geocodeBasic', new URLSearchParams('name=Brno&count=5'));
  assert.deepEqual(fromObj.allowed, fromUsp.allowed);
});

test('parametry: prázdný vstup nespadne', () => {
  assert.deepEqual(filterParams('radar', null).allowed, {});
  assert.deepEqual(filterParams('radar', undefined).allowed, {});
});

/* ============================================================
   SESTAVENÍ ADRESY
   ============================================================ */

test('adresa: sestaví se z povolených parametrů', () => {
  const url = buildUrl('geocodeBasic', { name: 'Brno', count: '3' });
  assert.ok(url.startsWith('https://geocoding-api.open-meteo.com/v1/search?'));
  assert.ok(url.includes('name=Brno'));
  assert.ok(url.includes('count=3'));
});

test('adresa: služba bez parametrů nemá otazník', () => {
  assert.equal(buildUrl('radar', {}), UPSTREAMS.radar.base);
});

test('🚨 adresa: klíč se do URL NIKDY nedostane', () => {
  // V URL by klíč skončil v logách serverů, v historii a v refererech.
  // Patří do hlavičky Authorization, a jen tam.
  const url = buildUrl('route', { start: '14.4,50.1', end: '16.6,49.2' }, 'driving-car');
  assert.ok(!/api_?key/i.test(url), 'v URL nesmí být zmínka o klíči');
  assert.ok(!url.includes('Authorization'));
});

test('🚨 adresa: dovětkem cesty nejde vylézt na cizí adresu', () => {
  // Bez kontroly by `../../` nebo celá URL v dovětku znamenaly otevřenou proxy.
  assert.throws(() => buildUrl('route', {}, '../../etc/passwd'));
  assert.throws(() => buildUrl('route', {}, 'https://zly.example.com'));
  assert.throws(() => buildUrl('route', {}, 'a/b'));
  assert.throws(() => buildUrl('route', {}, '..'));
});

test('adresa: běžný dovětek cesty projde', () => {
  const url = buildUrl('route', {}, 'cycling-regular');
  assert.equal(url, 'https://api.heigit.org/openrouteservice/v2/directions/cycling-regular');
});

test('adresa: hodnoty se kódují, ne vkládají syrově', () => {
  const url = buildUrl('geocodeBasic', { name: 'Ústí nad Labem' });
  assert.ok(!url.includes(' '), 'mezera se musí zakódovat');
  assert.ok(url.includes('%C3%9Ast%C3%AD'));
});

/* ============================================================
   HLAVIČKY A KLÍČ
   ============================================================ */

test('hlavičky: služba bez klíče ho nevyžaduje', () => {
  const h = upstreamHeaders('forecast', {});
  assert.equal(h.Authorization, undefined);
});

test('hlavičky: klíč jde do Authorization', () => {
  const h = upstreamHeaders('route', { ORS_API_KEY: 'tajne' });
  assert.equal(h.Authorization, 'tajne');
});

test('🚨 hlavičky: chybějící klíč je hlasitá chyba, ne dotaz bez klíče', () => {
  // Kdyby se dotaz odeslal bez klíče, ORS vrátí 403 a v logu bude záhada.
  // Lepší je spadnout na srozumitelné hlášce hned.
  assert.throws(() => upstreamHeaders('route', {}), /ORS_API_KEY/);
});

/* ============================================================
   KLÍČ DO CACHE
   ============================================================ */

test('cache: na pořadí parametrů nezáleží', () => {
  // Kdyby záleželo, každé jiné pořadí by minulo cache a zbytečně
  // ukusovalo z minutového limitu ORS.
  const a = cacheKey('geocodeBasic', { name: 'Brno', count: '3' });
  const b = cacheKey('geocodeBasic', { count: '3', name: 'Brno' });
  assert.equal(a, b);
});

test('cache: různý dotaz dá různý klíč', () => {
  assert.notEqual(
    cacheKey('geocodeBasic', { name: 'Brno' }),
    cacheKey('geocodeBasic', { name: 'Praha' }),
  );
});

test('cache: nepovolené parametry klíč neovlivní', () => {
  // Jinak by šlo cache obejít přidáním nesmyslného parametru
  // a prorazit tak limit ORS.
  assert.equal(
    cacheKey('geocodeBasic', { name: 'Brno' }),
    cacheKey('geocodeBasic', { name: 'Brno', nesmysl: 'x' }),
  );
});

test('cache: profil dopravy je součástí klíče', () => {
  assert.notEqual(
    cacheKey('route', { start: '1,1', end: '2,2' }, 'driving-car'),
    cacheKey('route', { start: '1,1', end: '2,2' }, 'cycling-regular'),
  );
});

test('platnost: radar je krátká, geokódování dlouhé', () => {
  assert.ok(ttlFor('radar') <= 5 * 60, 'radar se obnovuje po 5 minutách');
  assert.ok(ttlFor('geocode') >= 3600, 'města se nestěhují');
  assert.ok(ttlFor('route') >= 3600, 'silnice se přes den nemění');
});

/* ============================================================
   OŘEZ VÝSTRAH
   ============================================================ */

/** Zmenšenina skutečné odpovědi MeteoAlarmu (tvar ověřen 21. 8. 2026). */
const FEED = {
  warnings: [
    {
      alert: {
        sender: 'chmi@chmi.cz',
        info: [
          {
            language: 'cs', event: 'Vysoké teploty', severity: 'Moderate',
            onset: '2026-08-21T10:00:00+02:00', expires: '2026-08-21T20:00:00+02:00',
            area: [{ areaDesc: 'Hlavní město Praha', geocode: [{ value: '1100', valueName: 'CISORP' }] }],
          },
          { language: 'en-GB', event: 'High temperatures', severity: 'Moderate', area: [] },
        ],
      },
    },
    {
      alert: {
        info: [{
          language: 'cs', event: 'Žádná výstraha před nebezpečím požárů',
          severity: 'Minor', area: [{ areaDesc: 'Jihomoravský kraj', geocode: [] }],
        }],
      },
    },
    {
      alert: {
        info: [{
          language: 'en-GB', event: 'Severe thunderstorms', severity: 'Severe',
          area: [{ areaDesc: 'Vysočina', geocode: [{ value: '6100' }] }],
        }],
      },
    },
  ],
};

test('🚨 výstrahy: „žádná výstraha" se vyhodí', () => {
  // Feed je posílá jako plnohodnotné položky se závažností Minor.
  // Bez odfiltrování by appka hlásila výstrahu na to, že nic nehrozí.
  const out = trimWarnings(FEED, 'cs');
  assert.ok(!out.some((w) => /žádná/i.test(w.event)), 'nevýstraha nesmí projít');
});

test('výstrahy: vybere se žádaný jazyk', () => {
  const cs = trimWarnings(FEED, 'cs');
  assert.ok(cs.some((w) => w.event === 'Vysoké teploty'));
  const en = trimWarnings(FEED, 'en');
  assert.ok(en.some((w) => w.event === 'High temperatures'));
});

test('výstrahy: chybějící jazyk spadne na první dostupný, nezmizí', () => {
  // Třetí záznam má jen anglicky. V české verzi se nesmí ztratit —
  // radši cizí jazyk než zamlčená bouřka.
  const cs = trimWarnings(FEED, 'cs');
  assert.ok(cs.some((w) => w.event === 'Severe thunderstorms'));
});

test('výstrahy: vytáhne se název oblasti i kód ORP', () => {
  const [first] = trimWarnings(FEED, 'cs');
  assert.equal(first.areas[0].name, 'Hlavní město Praha');
  assert.deepEqual(first.areas[0].codes, ['1100']);
});

test('výstrahy: ořez odpověď výrazně zmenší', () => {
  const before = JSON.stringify(FEED).length;
  const after = JSON.stringify(trimWarnings(FEED, 'cs')).length;
  assert.ok(after < before, 'ořez musí ubrat, ne přidat');
});

test('výstrahy: prázdný nebo poškozený feed nespadne', () => {
  assert.deepEqual(trimWarnings(null), []);
  assert.deepEqual(trimWarnings({}), []);
  assert.deepEqual(trimWarnings({ warnings: [] }), []);
  assert.deepEqual(trimWarnings({ warnings: [{ alert: {} }] }), []);
});

/* ============================================================
   MÍSTNÍ PARAMETRY

   Souřadnice u výstrah se ven neposílají — zpracují se u nás. To má dva
   důsledky, které se dají snadno zkazit tichem.
   ============================================================ */

test('🚨 místní parametry: souřadnice nejsou zahozené, jen se neposílají ven', () => {
  // Kdyby se hlásily jako zahozené, log by tvrdil, že se ztratilo něco,
  // co se ve skutečnosti použilo — a hledala by se neexistující chyba.
  const { allowed, dropped } = filterParams('warnings', { lat: '50.5', lon: '14.1' });
  assert.deepEqual(allowed, {}, 'ven nejde nic');
  assert.deepEqual(dropped, [], 'ale zahozené to není');
});

test('🚨 místní parametry: souřadnice NESMÍ být v klíči cache', () => {
  // Pod jedním klíčem leží celý feed společný všem; výřez podle polohy se
  // dělá až za cache. Kdyby souřadnice do klíče vstoupily, měl by každý
  // uživatel vlastní kopii celého feedu a cache by ztratila smysl.
  assert.equal(
    cacheKey('warnings', { lat: '50.5', lon: '14.1' }),
    cacheKey('warnings', {}),
  );
});

test('místní parametry: cizí parametr se pořád hlásí jako zahozený', () => {
  const { dropped } = filterParams('warnings', { lat: '50.5', vymysl: '1' });
  assert.deepEqual(dropped, ['vymysl']);
});

test('místní parametry: jazyk se taky zpracuje u nás, ne ven', () => {
  // Feed nese obě jazykové verze a vybírá se z nich při ořezu. Log tvrdil,
  // že se `lang` zahodil — a hledala by se kvůli tomu neexistující chyba.
  const { allowed, dropped } = filterParams('warnings', { lang: 'cs' });
  assert.deepEqual(allowed, {});
  assert.deepEqual(dropped, []);
});

test('🚨 hlavičky: trasa si říká o GeoJSON, jinak dostane 406', () => {
  // Ověřeno naživo 24. 8. 2026: ORS na `Accept: application/json` odmítne
  // odpovědět (406), přestože je to týž dotaz. Chyba se pak tváří jako
  // výpadek cizí služby, ne jako naše hlavička.
  assert.equal(upstreamHeaders('route', { ORS_API_KEY: 'x' }).Accept, 'application/geo+json');
  assert.equal(upstreamHeaders('forecast').Accept, 'application/json', 'ostatní zůstávají');
});

test('🚨 profil dopravy musí být ze seznamu, jinak to odmítne NAŠE proxy', () => {
  // Když appka omylem poslala `straight` (vzdušnou čáru počítáme sami),
  // vracela cizí služba matoucí chybu a vypadalo to jako její výpadek.
  assert.throws(() => buildUrl('route', {}, 'straight'), /Neznámý profil/);
  assert.throws(() => buildUrl('route', {}, 'teleport'), /Neznámý profil/);
  assert.ok(buildUrl('route', {}, 'driving-car').includes('/driving-car'));
  assert.ok(buildUrl('route', {}, 'cycling-regular').includes('/cycling-regular'));
});

test('služba bez seznamu dovětků propustí běžné slovo dál', () => {
  // Omezení platí jen tam, kde dává smysl — ne plošně.
  assert.ok(buildUrl('forecast', {}, 'cokoli').includes('/cokoli'));
});

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
  fromPelias, mapParams,
} from '../web/lib/upstreams.js';
import { planRequest, filterByPlace, responseHeaders } from '../web/lib/proxy-core.js';

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
    // Místní služba se skládá u nás a žádnou cizí adresu nemá — zato musí
    // být jako místní OZNAČENÁ. Chybějící základ bez té značky je překlep,
    // ne rozhodnutí, a proxy by na něj spadla až za běhu.
    if (spec.localOnly) {
      assert.equal(spec.base, undefined, `${name}: místní služba nemá mít adresu`);
    } else {
      assert.ok(spec.base.startsWith('https://'), `${name}: základ musí být https`);
    }
    assert.ok(Array.isArray(spec.params), `${name}: chybí seznam parametrů`);
    assert.ok(spec.ttl > 0, `${name}: chybí platnost`);
  }
});

test('🚨 místní služba nikam nechodí — a nesmí chtít klíč', () => {
  // Klíč u služby, která se nikam neptá, by znamenal, že se někam ptá.
  for (const [name, spec] of Object.entries(UPSTREAMS)) {
    if (!spec.localOnly) continue;
    assert.ok(!spec.needsKey, `${name}: místní služba nepotřebuje klíč`);
    assert.ok(!spec.fallback, `${name}: místní služba nemá kam couvnout`);
  }
});

test('🚨 jméno místa má v klíči cache SOUŘADNICE', () => {
  // Kdyby se lat/lon do klíče nedostaly, měly by všechny body společný
  // záznam — druhý tazatel by dostal jméno prvního a nepoznal by to.
  const a = planRequest({ pathname: '/api/place', params: { lat: '49.53', lon: '12.94' } });
  const b = planRequest({ pathname: '/api/place', params: { lat: '50.08', lon: '14.44' } });
  assert.ok(a.ok && b.ok);
  assert.ok(a.localOnly, 'place musí být místní služba');
  assert.notEqual(a.cacheKey, b.cacheKey);
  assert.equal(a.url, null, 'místní služba nemá adresu');
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

/* ── totožnost výstrahy (kvůli upozorňování) ───────────────────────────── */

test('🚨 klíč výstrahy se NEMĚNÍ s jazykem appky', () => {
  // Kdyby v klíči byl přeložený název jevu, přepnutí do angličtiny by ze
  // všech platných výstrah naráz udělalo „nové" a telefon by zazvonil na
  // něco, co uživatel dávno zná.
  const cs = trimWarnings(FEED, 'cs');
  const en = trimWarnings(FEED, 'en');
  assert.deepEqual(cs.map((w) => w.id), en.map((w) => w.id));
  assert.notDeepEqual(cs.map((w) => w.event), en.map((w) => w.event),
    'texty se lišit MUSÍ — jinak by test neověřoval nic');
});

test('klíč rozliší jiný jev, jiný čas i jiné území', () => {
  const zaklad = (zmena) => trimWarnings({
    warnings: [{ alert: { info: [{
      language: 'en-GB', event: 'Severe thunderstorms', severity: 'Severe',
      onset: '2026-08-21T10:00:00Z', expires: '2026-08-21T20:00:00Z',
      area: [{ areaDesc: 'Vysočina', geocode: [{ value: '6100' }] }],
      ...zmena,
    }] } }],
  }, 'en')[0].id;

  const puvodni = zaklad({});
  assert.notEqual(zaklad({ event: 'High temperatures' }), puvodni, 'jiný jev');
  assert.notEqual(zaklad({ severity: 'Extreme' }), puvodni, 'jiná závažnost');
  assert.notEqual(zaklad({ onset: '2026-08-22T10:00:00Z' }), puvodni, 'jiný začátek');
  assert.notEqual(zaklad({ expires: '2026-08-22T20:00:00Z' }), puvodni, 'jiný konec');
  assert.notEqual(
    zaklad({ area: [{ areaDesc: 'Vysočina', geocode: [{ value: '6200' }] }] }),
    puvodni, 'jiné území',
  );
});

test('🚨 klíč nekolísá s pořadím kódů území', () => {
  // Feed pořadí nezaručuje. Kdyby na něm klíč závisel, tatáž výstraha by
  // se při každém stažení tvářila jako nová a upozorňovalo by se pořád.
  const sKody = (kody) => trimWarnings({
    warnings: [{ alert: { info: [{
      language: 'en-GB', event: 'Wind', severity: 'Moderate',
      area: [{ areaDesc: 'X', geocode: kody.map((v) => ({ value: v })) }],
    }] } }],
  }, 'en')[0].id;

  assert.equal(sKody(['6100', '1100', '3200']), sKody(['3200', '6100', '1100']));
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

test('🚨 práh závažnosti NESMÍ být v klíči cache', () => {
  // Táž past jako u souřadnic: v cache leží feed společný všem a teprve
  // odpověď se krájí. Kdyby práh vstoupil do klíče, dostal by tazatel
  // s nižším prahem uloženou odpověď toho s vyšším — a přišel by
  // o výstrahy, aniž by to šlo poznat.
  assert.equal(
    cacheKey('warnings', { minSeverity: 'Severe' }),
    cacheKey('warnings', {}),
  );
});

test('🚨 práh závažnosti se ven NEPOSÍLÁ', () => {
  // MeteoAlarm o žádném prahu neví. Kdyby prošel, byl by to cizí parametr
  // v dotazu na cizí službu — přesně to, čemu katalog brání.
  //
  // ⚠️ Chová se přesně jako `lat`/`lon`/`lang`: je to místní parametr,
  // zpracuje se u nás a ven nejde. Ověřeno i v běžícím serveru.
  assert.ok(!buildUrl('warnings', { minSeverity: 'Severe' }, '').includes('minSeverity'));
  for (const p of ['lat', 'lon', 'lang', 'minSeverity']) {
    assert.ok(UPSTREAMS.warnings.local.includes(p), `${p} musí být místní`);
  }
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

test('🚨 hledání: tatáž ulice se nesmí opakovat dvakrát', () => {
  // Služba vrací týž záznam vícekrát (různé zápisy v OSM). Dva shodné řádky
  // v nabídce vypadají jako chyba a nutí přemýšlet, v čem se liší.
  const out = fromPelias({ features: [
    { geometry: { coordinates: [14.4, 50.0] }, properties: { name: 'náměstí Republiky', label: 'náměstí Republiky, Prague, Czechia' } },
    { geometry: { coordinates: [14.5, 50.1] }, properties: { name: 'Náměstí Republiky', label: 'Náměstí Republiky, Prague, Czechia' } },
    { geometry: { coordinates: [16.6, 49.2] }, properties: { name: 'náměstí Republiky', label: 'náměstí Republiky, Brno, JM, Czechia' } },
  ] });
  assert.equal(out.results.length, 2, 'Praha jednou, Brno jednou');
  assert.ok(out.results[1].label.includes('Brno'));
});

test('hledání: poloha se propíše do dotazu, bez ní se nic nevymýšlí', () => {
  // „Odkud se dívám" řadí tutéž ulici od nejbližšího města. Když polohu
  // neznáme, neposílá se — vymyslet střed republiky by bylo tvrzení bez opory.
  const s = mapParams('geocode', { name: 'Sokolovská', count: 8, lat: 50.08, lon: 14.42 });
  assert.equal(s['focus.point.lat'], '50.08');
  assert.equal(s['focus.point.lon'], '14.42');

  const bez = mapParams('geocode', { name: 'Sokolovská', count: 8 });
  assert.equal(bez['focus.point.lat'], undefined);
  assert.equal(bez.size, '8');
});

/* ============================================================
   JAZYK V HLEDÁNÍ MÍST

   🚨 Bez jazyka vrací služba anglické názvy: „Prague, Czechia" místo
   „Praha, Česko". Pro českého uživatele to vypadá, jako by appka mluvila
   o cizím městě — a u „Vienna" vs „Vídeň" je to ještě horší.
   ============================================================ */

test('🚨 hledání posílá jazyk, ať vrací česká jména', () => {
  const url = buildUrl('geocode', mapParams('geocode', { name: 'Praha', count: 5, language: 'cs' }), '');
  assert.match(url, /[?&]lang=cs(&|$)/);
});

test('bez jazyka se nic nevymýšlí', () => {
  const url = buildUrl('geocode', mapParams('geocode', { name: 'Praha', count: 5 }), '');
  assert.ok(!url.includes('lang='), url);
});

test('jazyk se ořízne — do cizí služby nepatří nic dlouhého', () => {
  const p = mapParams('geocode', { name: 'Praha', language: 'cs-CZ-x-nesmysl' });
  assert.equal(p.lang.length <= 5, true);
});

/* ============================================================
   PRÁH ZÁVAŽNOSTI (kvůli upozorňování z obalu)
   ============================================================ */

const VYSTRAHY_RUZNE = {
  warnings: [
    { id: 'a', event: 'Silné bouřky', severity: 'Severe', expires: null, areas: [] },
    { id: 'b', event: 'Vysoké teploty', severity: 'Moderate', expires: null, areas: [] },
    { id: 'c', event: 'Riziko požárů', severity: 'Minor', expires: null, areas: [] },
    { id: 'd', event: 'Cosi', severity: 'Unknown', expires: null, areas: [] },
  ],
};

test('práh ořeže mírné výstrahy, přísnější nechá', () => {
  const out = filterByPlace('warnings', VYSTRAHY_RUZNE, { minSeverity: 'Moderate' });
  assert.deepEqual(out.warnings.map((w) => w.id).sort(), ['a', 'b', 'd']);
});

test('🚨 bez prahu se neořezává nic — obrazovka musí vidět všechno', () => {
  // Karta výstrah ukazuje i drobnosti; práh je JEN pro upozorňování.
  // Kdyby platil vždycky, appka by mlčela o výstraze, která platí.
  const out = filterByPlace('warnings', VYSTRAHY_RUZNE, {});
  assert.equal(out.warnings.length, 4);
});

test('🚨 neznámá závažnost projde i nejpřísnějším prahem', () => {
  // Neznámá závažnost není nízká závažnost. Odfiltrovat ji by znamenalo
  // mlčet právě tam, kde nevíme, oč jde.
  const out = filterByPlace('warnings', VYSTRAHY_RUZNE, { minSeverity: 'Extreme' });
  assert.ok(out.warnings.some((w) => w.id === 'd'), 'Unknown musí projít');
});

/* ── přiznání náhradního zdroje ───────────────────────────────────────── */

test('🚨 odpověď ze zálohy se přizná hlavičkou', () => {
  // Přepnutí na náhradní zdroj je SPRÁVNÉ chování (lepší horší výsledky než
  // žádné), ale do 31. 8. 2026 se o něm jen psalo do logu. Uživatel viděl jen
  // to, že appka najednou nenajde adresu — Michal: „zas blbne vyhledávání."
  // Správné chování, o kterém se mlčí, se od poruchy nedá odlišit.
  const zal = responseHeaders({ ttlS: 60, zeZalohy: true });
  assert.equal(zal['X-MeteoTrace-Zaloha'], '1');

  const hlavni = responseHeaders({ ttlS: 60 });
  assert.equal(hlavni['X-MeteoTrace-Zaloha'], undefined,
    'z hlavního zdroje se hlavička posílat NESMÍ — jinak by hláška svítila pořád');
});

test('příznak zálohy je nezávislý na příznaku prošlých dat', () => {
  // Jsou to dvě různé věci: „ze zálohy" a „staré". Můžou nastat i zvlášť.
  const oboji = responseHeaders({ ttlS: 60, fresh: false, ageS: 120, zeZalohy: true });
  assert.equal(oboji['X-MeteoTrace-Stale'], '1');
  assert.equal(oboji['X-MeteoTrace-Zaloha'], '1');
  assert.equal(oboji['Age'], '120');

  const jenZaloha = responseHeaders({ ttlS: 60, zeZalohy: true });
  assert.equal(jenZaloha['X-MeteoTrace-Stale'], undefined);
});

/**
 * Samotest obsluhy proxy — bez sítě a bez čekání.
 *
 * Upstream i hodiny se podvrhují, takže test běží offline, za milisekundy
 * a pokaždé stejně. Vzor: mailniño testuje proti falešnému IMAP serveru.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCache } from '../web/lib/ttl-cache.js';
import { parseApiPath, planRequest, transformBody, responseHeaders } from '../web/lib/proxy-core.js';
import { serveProxy } from '../server/proxy.js';
import { unpackAreas } from '../web/lib/orp.js';
import { ORP_DATA } from '../web/data/orp-boundaries.js';

const AREAS = unpackAreas(ORP_DATA);

/* ============================================================
   POMŮCKY — falešné hodiny a falešný upstream
   ============================================================ */

/** Hodiny, které jdou jen když jim to řekneme. */
function fakeClock(startMs = 1_700_000_000_000) {
  let t = startMs;
  return { now: () => t, advance: (s) => { t += s * 1000; } };
}

/**
 * Falešný upstream. Počítá volání a umí selhat — obojí je potřeba,
 * protože se ověřuje nejen že se stalo, co mělo, ale i že se NESTALO,
 * co nemělo (typicky že se při zásahu v cache nešlo ven).
 */
function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, headers: init?.headers || {} });
    const r = typeof reply === 'function' ? reply(url, calls.length) : reply;
    if (r instanceof Error) throw r;
    return {
      ok: r.ok !== false,
      status: r.status || 200,
      json: async () => r.body,
    };
  };
  impl.calls = calls;
  return impl;
}

const ENV = { ORS_API_KEY: 'testovaci-klic' };

/* ============================================================
   CACHE
   ============================================================ */

test('cache: čerstvý záznam se vrátí jako čerstvý', () => {
  const clock = fakeClock();
  const c = createCache({ now: clock.now });
  c.set('k', { a: 1 }, 600);
  const hit = c.get('k');
  assert.deepEqual(hit.value, { a: 1 });
  assert.equal(hit.fresh, true);
});

test('cache: po vypršení je záznam prošlý, ale pořád k mání', () => {
  // Přesně kvůli tomuhle se prošlé nezahazují hned: při výpadku cizí služby
  // je desetiminutová předpověď lepší než chybová hláška.
  const clock = fakeClock();
  const c = createCache({ now: clock.now, staleS: 3600 });
  c.set('k', 'data', 600);
  clock.advance(700);
  const hit = c.get('k');
  assert.equal(hit.fresh, false);
  assert.equal(hit.value, 'data');
  assert.ok(hit.ageS >= 700);
});

test('cache: za hranicí použitelnosti záznam zmizí', () => {
  const clock = fakeClock();
  const c = createCache({ now: clock.now, staleS: 100 });
  c.set('k', 'data', 60);
  clock.advance(60 + 100 + 1);
  assert.equal(c.get('k'), null);
});

test('cache: neznámý klíč vrátí null, ne undefined', () => {
  assert.equal(createCache().get('nic'), null);
});

test('cache: strop drží velikost a padá nejdéle nepoužitý', () => {
  // Bez stropu by cache v dlouho běžícím procesu rostla, dokud nedojde paměť.
  const c = createCache({ maxEntries: 3 });
  c.set('a', 1, 600); c.set('b', 2, 600); c.set('c', 3, 600);
  c.get('a');                       // 'a' se použije → nesmí padnout jako první
  c.set('d', 4, 600);
  assert.equal(c.size, 3);
  assert.ok(c.get('a'), 'použitý záznam má zůstat');
  assert.equal(c.get('b'), null, 'nejdéle nepoužitý má padnout');
});

/* ============================================================
   ROZEBRÁNÍ CESTY
   ============================================================ */

test('cesta: rozebere službu i dovětek', () => {
  assert.deepEqual(parseApiPath('/api/forecast'), { service: 'forecast', subPath: '' });
  assert.deepEqual(parseApiPath('/api/route/driving-car'), { service: 'route', subPath: 'driving-car' });
});

test('cesta: cizí nebo prázdná cesta se odmítne', () => {
  assert.equal(parseApiPath('/neco/jineho'), null);
  assert.equal(parseApiPath('/api/'), null);
  assert.equal(parseApiPath('/api'), null);
  assert.equal(parseApiPath(''), null);
  assert.equal(parseApiPath(null), null);
});

test('🚨 cesta: hlubší cesta se odmítne', () => {
  // Každý další segment je další příležitost, jak se pokusit vylézt jinam.
  assert.equal(parseApiPath('/api/route/a/b'), null);
  assert.equal(parseApiPath('/api/route/../../etc'), null);
});

/* ============================================================
   PLÁN DOTAZU
   ============================================================ */

test('🚨 plán: propouští se jen čtení', () => {
  // Zápis by znamenal, že přes nás jde cizí službě něco měnit.
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const p = planRequest({ pathname: '/api/forecast', method });
    assert.equal(p.ok, false);
    assert.equal(p.status, 405);
  }
  assert.equal(planRequest({ pathname: '/api/forecast', method: 'GET' }).ok, true);
});

test('plán: neznámá služba je 404', () => {
  const p = planRequest({ pathname: '/api/vymyslena' });
  assert.equal(p.status, 404);
});

test('🚨 plán: chybějící klíč je 500, ne 400', () => {
  // Je to vada NAŠEHO nasazení, ne uživatelova dotazu. Kdyby to bylo 400,
  // hledala by se chyba u volajícího a nikoho by nenapadlo mrknout do prostředí.
  const p = planRequest({ pathname: '/api/route', env: {} });
  assert.equal(p.ok, false);
  assert.equal(p.status, 500);
  assert.match(p.error, /ORS_API_KEY/);
});

test('plán: vadný dovětek cesty je 400', () => {
  const p = planRequest({ pathname: '/api/route/zly..dovetek', env: ENV });
  assert.equal(p.status, 400);
});

test('plán: hlásí, co se z dotazu zahodilo', () => {
  const p = planRequest({
    pathname: '/api/forecast',
    params: { latitude: '50', nesmysl: 'x', dalsi: 'y' },
  });
  assert.deepEqual(p.dropped.sort(), ['dalsi', 'nesmysl']);
});

/* ============================================================
   HLAVIČKY ODPOVĚDI
   ============================================================ */

test('hlavičky: platnost se propíše do Cache-Control', () => {
  const h = responseHeaders({ ttlS: 600 });
  assert.match(h['Cache-Control'], /max-age=600/);
  assert.match(h['Cache-Control'], /s-maxage=600/);
  assert.match(h['Cache-Control'], /stale-while-revalidate=2400/);
});

test('🚨 hlavičky: prošlá odpověď se označí', () => {
  // Bez toho by se stará data tvářila jako nová a výpadku by si nikdo nevšiml.
  const h = responseHeaders({ ttlS: 600, fresh: false, ageS: 900 });
  assert.equal(h['X-MeteoTrace-Stale'], '1');
  assert.equal(h['Age'], '900');
  assert.equal(responseHeaders({ ttlS: 600 })['X-MeteoTrace-Stale'], undefined);
});

/* ============================================================
   OBSLUHA
   ============================================================ */

test('obsluha: stáhne, uloží a vrátí', async () => {
  const f = fakeFetch({ body: { hourly: { time: [] } } });
  const cache = createCache();
  const res = await serveProxy(
    { pathname: '/api/forecast', params: { latitude: '50', longitude: '14' } },
    { cache, fetchImpl: f },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { hourly: { time: [] } });
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.startsWith('https://api.open-meteo.com/'));
});

test('🚨 obsluha: zásah v cache NEJDE ven', async () => {
  // Tohle je celý smysl cache. Kdyby se šlo ven i tak, minutový limit ORS
  // (40/min) by se prorážel zbytečně.
  const f = fakeFetch({ body: { ok: 1 } });
  const cache = createCache();
  const req = { pathname: '/api/geocode', params: { name: 'Brno' } };
  await serveProxy(req, { cache, fetchImpl: f });
  await serveProxy(req, { cache, fetchImpl: f });
  await serveProxy(req, { cache, fetchImpl: f });
  assert.equal(f.calls.length, 1, 'ven se smělo jen jednou');
});

test('obsluha: jiný dotaz cache mine', async () => {
  const f = fakeFetch({ body: { ok: 1 } });
  const cache = createCache();
  await serveProxy({ pathname: '/api/geocode', params: { name: 'Brno' } }, { cache, fetchImpl: f });
  await serveProxy({ pathname: '/api/geocode', params: { name: 'Praha' } }, { cache, fetchImpl: f });
  assert.equal(f.calls.length, 2);
});

test('🚨 obsluha: klíč jde do hlavičky, ne do URL', async () => {
  const f = fakeFetch({ body: {} });
  await serveProxy(
    { pathname: '/api/route/driving-car', params: { start: '14,50', end: '16,49' }, env: ENV },
    { cache: createCache(), fetchImpl: f },
  );
  const call = f.calls[0];
  assert.equal(call.headers.Authorization, 'testovaci-klic');
  assert.ok(!call.url.includes('testovaci-klic'), 'klíč nesmí být v URL');
});

test('🚨 obsluha: při výpadku se nabídne prošlá odpověď', async () => {
  const clock = fakeClock();
  const cache = createCache({ now: clock.now, staleS: 3600 });

  let selhavej = false;
  const f = fakeFetch(() => (selhavej ? new Error('síť leží') : { body: { teplota: 21 } }));

  const req = { pathname: '/api/forecast', params: { latitude: '50' } };
  await serveProxy(req, { cache, fetchImpl: f });     // naplň cache

  // Předpověď má platnost 600 s a podržení 3 600 s. Posunout se musí ZA platnost,
  // ale uvnitř podržení — jinak by se netestoval výpadek, ale zapomínání.
  // (Na tomhle test poprvé spadl: 10 000 s je za oběma hranicemi.)
  clock.advance(1200);
  selhavej = true;
  const res = await serveProxy(req, { cache, fetchImpl: f });

  assert.equal(res.status, 200, 'stará data jsou lepší než chyba');
  assert.deepEqual(res.body, { teplota: 21 });
  assert.equal(res.headers['X-MeteoTrace-Stale'], '1', 'ale musí být poznat, že jsou stará');
});

test('obsluha: za hranicí podržení už se prošlé nenabízí', async () => {
  // Protějšek předchozího testu. Někde musí být mez — data stará půl dne
  // by uživatele mátla víc, než by mu pomohla.
  const clock = fakeClock();
  const cache = createCache({ now: clock.now, staleS: 3600 });
  let selhavej = false;
  const f = fakeFetch(() => (selhavej ? new Error('síť leží') : { body: { teplota: 21 } }));

  const req = { pathname: '/api/forecast', params: { latitude: '50' } };
  await serveProxy(req, { cache, fetchImpl: f });
  clock.advance(10_000);                                // za platnost i za podržení
  selhavej = true;

  const res = await serveProxy(req, { cache, fetchImpl: f });
  assert.equal(res.status, 502, 'příliš stará data se už nabízet nemají');
});

test('obsluha: výpadek bez cache je 502 se srozumitelnou hláškou', async () => {
  const f = fakeFetch(new Error('síť leží'));
  const res = await serveProxy(
    { pathname: '/api/radar' },
    { cache: createCache(), fetchImpl: f },
  );
  assert.equal(res.status, 502);
  assert.match(res.body.error, /radar/);
  assert.match(res.body.error, /síť leží/);
});

test('obsluha: chybový stav od cizí služby se nevydává za úspěch', async () => {
  const f = fakeFetch({ ok: false, status: 429, body: null });
  const res = await serveProxy(
    { pathname: '/api/radar' },
    { cache: createCache(), fetchImpl: f },
  );
  assert.equal(res.status, 502);
  assert.match(res.body.error, /429/);
});

test('obsluha: výstrahy se ořežou už na serveru', async () => {
  const feed = {
    warnings: [
      { alert: { info: [{ language: 'cs', event: 'Bouřky', severity: 'Severe', area: [] }] } },
      { alert: { info: [{ language: 'cs', event: 'Žádná výstraha před požáry', severity: 'Minor', area: [] }] } },
    ],
  };
  const f = fakeFetch({ body: feed });
  const res = await serveProxy(
    { pathname: '/api/warnings' },
    { cache: createCache(), fetchImpl: f },
  );
  assert.equal(res.body.warnings.length, 1, 'nevýstraha se nesmí dostat ke klientovi');
  assert.equal(res.body.warnings[0].event, 'Bouřky');
});

test('obsluha: do cache se ukládá už ořezané', async () => {
  // Kdyby se ukládal syrový feed, ořezávalo by se při každém zásahu znovu
  // a v paměti by ležel megabajt místo pár kilobajtů.
  const feed = { warnings: [{ alert: { info: [{ language: 'cs', event: 'Vítr', severity: 'Moderate', area: [] }] } }] };
  const f = fakeFetch({ body: feed });
  const cache = createCache();
  await serveProxy({ pathname: '/api/warnings' }, { cache, fetchImpl: f });
  const res = await serveProxy({ pathname: '/api/warnings' }, { cache, fetchImpl: f });
  assert.equal(f.calls.length, 1);
  assert.equal(res.body.warnings[0].event, 'Vítr');
});

test('obsluha: odmítnutý dotaz nejde ven vůbec', async () => {
  const f = fakeFetch({ body: {} });
  const res = await serveProxy({ pathname: '/api/vymyslena' }, { cache: createCache(), fetchImpl: f });
  assert.equal(res.status, 404);
  assert.equal(f.calls.length, 0, 'na neznámou službu se nesmí sáhnout ven');
});

test('obsluha: hlásí zahozené parametry do logu', async () => {
  const zapsano = [];
  const f = fakeFetch({ body: {} });
  await serveProxy(
    { pathname: '/api/forecast', params: { latitude: '50', podvrh: 'x' } },
    { cache: createCache(), fetchImpl: f, log: (m, d) => zapsano.push([m, d]) },
  );
  const radek = zapsano.find(([m]) => m === 'zahozené parametry');
  assert.ok(radek, 'zahození se musí objevit v logu');
  assert.deepEqual(radek[1].dropped, ['podvrh']);
});

/* ============================================================
   VÝSTRAHY PODLE POLOHY

   Feed umí vydat jen celou republiku, takže výběr dělá proxy. Kritické je,
   KDY: až za cache. V cache leží odpověď společná všem.
   ============================================================ */

const FEED = {
  warnings: [
    { alert: { info: [{
      language: 'cs', event: 'Bouřky', severity: 'Moderate',
      area: [{ areaDesc: 'Ústecký kraj', geocode: [{ valueName: 'CISORP', value: '4216' }] }],
    }] } },
    { alert: { info: [{
      language: 'cs', event: 'Vichřice', severity: 'Severe',
      area: [{ areaDesc: 'Jihomoravský kraj (Brno)', geocode: [{ valueName: 'CISORP', value: '6203' }] }],
    }] } },
  ],
};

const LITOMERICE = { lat: '50.5344', lon: '14.1316' };
const BRNO = { lat: '49.1951', lon: '16.6068' };

async function vystrahy(params, deps = {}) {
  const fetchImpl = deps.fetchImpl || fakeFetch({ body: FEED });
  const res = await serveProxy(
    { pathname: '/api/warnings', params, env: ENV },
    { cache: deps.cache || createCache(), fetchImpl, areas: deps.areas ?? AREAS },
  );
  return { res, fetchImpl };
}

test('výstrahy: bez souřadnic se vrátí všechny', async () => {
  const { res } = await vystrahy({});
  assert.equal(res.body.warnings.length, 2);
  assert.equal(res.body.misto, undefined, 'bez souřadnic se místo neřeší');
});

test('výstrahy: se souřadnicemi projde jen to, co se místa týká', async () => {
  const { res } = await vystrahy(LITOMERICE);
  assert.deepEqual(res.body.warnings.map((w) => w.event), ['Bouřky']);
  assert.equal(res.body.misto.nazev, 'Litoměřice');
  assert.equal(res.body.misto.kraj, 'Ústecký kraj');
  assert.equal(res.body.pokryto, true);
});

test('🚨 výstrahy: druhý tazatel NESMÍ dostat výřez prvního', async () => {
  // Jádro věci. Pod klíčem cache leží celý feed, ne výřez — kdyby se ukládal
  // výřez, dostal by Brňák výstrahy Litoměřic a neměl by jak to poznat.
  const cache = createCache();
  const fetchImpl = fakeFetch({ body: FEED });

  const prvni = await vystrahy(LITOMERICE, { cache, fetchImpl });
  const druhy = await vystrahy(BRNO, { cache, fetchImpl });

  assert.deepEqual(prvni.res.body.warnings.map((w) => w.event), ['Bouřky']);
  assert.deepEqual(druhy.res.body.warnings.map((w) => w.event), ['Vichřice']);
  assert.equal(druhy.res.body.misto.nazev, 'Brno');
  assert.equal(fetchImpl.calls.length, 1, 'druhý dotaz se obsloužil z cache, ven se nešlo');
});

test('🚨 výstrahy: místo mimo pokrytí to přizná, nemlčí', async () => {
  // Prázdný seznam sám o sobě vypadá stejně jako „nic nehrozí" — a to je
  // něco úplně jiného než „o tomhle místě nic nevíme".
  const { res } = await vystrahy({ lat: '48.2082', lon: '16.3738' });   // Vídeň
  assert.deepEqual(res.body.warnings, []);
  assert.equal(res.body.pokryto, false);
  assert.equal(res.body.filtrovano, true);
  assert.equal(res.body.misto, null);
});

test('🚨 výstrahy: bez hranic se vrátí všechno, ale je to poznat', async () => {
  // Radši výstraha navíc než zamlčená bouřka — ale odhad se nesmí tvářit
  // jako výběr, jinak by UI lhalo o tom, čeho se výstraha týká.
  const { res } = await vystrahy(LITOMERICE, { areas: [] });
  assert.equal(res.body.warnings.length, 2);
  assert.equal(res.body.filtrovano, false);
  assert.equal(res.body.pokryto, false);
});

test('výstrahy: souřadnice se ven neposílají', async () => {
  const { res, fetchImpl } = await vystrahy(LITOMERICE);
  assert.equal(res.status, 200);
  assert.ok(!fetchImpl.calls[0].url.includes('lat='), 'feed o poloze nic vědět nemá');
  assert.ok(!fetchImpl.calls[0].url.includes('lon='));
});

test('výstrahy: prošlá odpověď se taky ořízne podle polohy', async () => {
  // Když upstream selže, servíruje se prošlé z cache — i to musí projít
  // výřezem, jinak by výpadek najednou ukázal výstrahy celé republiky.
  const cache = createCache();
  await vystrahy(LITOMERICE, { cache });
  cache.get('warnings?');                        // záznam tam je
  const { res } = await vystrahy(BRNO, {
    cache,
    fetchImpl: fakeFetch(new Error('upstream leží')),
  });
  assert.deepEqual(res.body.warnings.map((w) => w.event), ['Vichřice']);
});

test('🚨 výstrahy: prošlé se ven neposílají', async () => {
  // Ve skutečné odpovědi z 22. 8. byla víc než polovina záznamů dávno po
  // platnosti — je to zbytečný objem na mobilních datech.
  const nowMs = Date.parse('2026-08-22T12:00:00+02:00');
  const feed = { warnings: [
    { alert: { info: [{ language: 'cs', event: 'Stará bouřka', severity: 'Moderate',
      expires: '2026-08-17T18:00:00+02:00',
      area: [{ areaDesc: 'Ústecký kraj', geocode: [] }] }] } },
    { alert: { info: [{ language: 'cs', event: 'Platná bouřka', severity: 'Moderate',
      expires: '2026-08-22T20:00:00+02:00',
      area: [{ areaDesc: 'Ústecký kraj', geocode: [] }] }] } },
  ] };
  const res = await serveProxy(
    { pathname: '/api/warnings', params: LITOMERICE, env: ENV },
    { cache: createCache(), fetchImpl: fakeFetch({ body: feed }), areas: AREAS, now: () => nowMs },
  );
  assert.deepEqual(res.body.warnings.map((w) => w.event), ['Platná bouřka']);
});

test('🚨 výstrahy: prošlé se vyhodí i v přehledu bez souřadnic', async () => {
  // Snadno se přehlédne: filtr podle místa se bez souřadnic přeskočí, ale
  // vyhození prošlých se přeskočit nesmí — jinak celostátní přehled ukazuje
  // bouřky z minulého týdne.
  const nowMs = Date.parse('2026-08-22T12:00:00+02:00');
  const feed = { warnings: [
    { alert: { info: [{ language: 'cs', event: 'Stará', severity: 'Minor',
      expires: '2026-08-17T18:00:00+02:00', area: [{ areaDesc: 'Ústecký kraj', geocode: [] }] }] } },
    { alert: { info: [{ language: 'cs', event: 'Platná', severity: 'Minor',
      expires: '2026-08-22T20:00:00+02:00', area: [{ areaDesc: 'Ústecký kraj', geocode: [] }] }] } },
  ] };
  const res = await serveProxy(
    { pathname: '/api/warnings', params: {}, env: ENV },
    { cache: createCache(), fetchImpl: fakeFetch({ body: feed }), areas: AREAS, now: () => nowMs },
  );
  assert.deepEqual(res.body.warnings.map((w) => w.event), ['Platná']);
  assert.equal(res.body.misto, undefined, 'bez souřadnic se místo pořád neřeší');
});

test('výstrahy: hranice území se přiloží jen na vyžádání', async () => {
  const bez = await vystrahy(LITOMERICE);
  const s = await vystrahy({ ...LITOMERICE, geo: '1' });
  assert.equal(bez.res.body.geometrie, undefined, 'bez geo=1 se hranice neposílá');
  const g = s.res.body.geometrie;
  assert.ok(['Polygon', 'MultiPolygon'].includes(g.type), g.type);
  assert.ok(g.coordinates.length, 'hranice není prázdná');
});

test('🚨 výstrahy: hranice se nepřikládá, když není co kreslit', async () => {
  // Kilobajty navíc za obrys, který by na mapě jen svítil bez důvodu.
  // Plzeň v testovacím feedu žádnou výstrahu nemá.
  const { res } = await vystrahy({ lat: '49.7384', lon: '13.3736', geo: '1' });
  assert.deepEqual(res.body.warnings, []);
  assert.equal(res.body.geometrie, undefined, 'žádná výstraha = žádný obrys');
  assert.equal(res.body.misto.nazev, 'Plzeň', 'místo se pozná i bez výstrahy');
});

test('výstrahy: hranice nezvětší klíč cache ani nejde ven', async () => {
  const { res, fetchImpl } = await vystrahy({ ...LITOMERICE, geo: '1' });
  assert.equal(res.status, 200);
  assert.ok(!fetchImpl.calls[0].url.includes('geo='), 'feed o naší mapě nic vědět nemá');
});

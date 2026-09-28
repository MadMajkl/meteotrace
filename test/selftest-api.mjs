/**
 * Samotest klientské síťové vrstvy.
 *
 * 🚨 Doteď byla jako jediná (spolu se `severity.js`) bez testu — našla to
 * revize dokumentace proti zdrojáku 31. 8. 2026.
 *
 * Zajímavé tu nejsou šťastné odpovědi, ale tři věci, které se špatně řeší
 * rozsypané po appce: **rušení zastaralých dotazů**, **rozlišení druhu chyby**
 * a **poznámka, že data jsou prošlá**. Na každé z nich stojí něco, co by
 * jinak mlčky selhalo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { apiGet, createRequestGroup, prefetchApi, PREDSTIH_PLATNOST_MS } from '../web/lib/api.js';
import { forecastQuery, startPlace, FORECAST_PARAMS } from '../web/lib/forecast-query.js';
import { FORECAST_PARAMS as STATION_FORECAST_PARAMS } from '../web/lib/station.js';

/** Podvržený `fetch` — vrátí, co se mu řekne, a zapíše, na co se šlo. */
function fakeFetch(odpoved) {
  const volani = [];
  const impl = async (url, init) => {
    volani.push(url);
    const r = typeof odpoved === 'function' ? odpoved(url, volani.length) : odpoved;
    if (r instanceof Error) throw r;
    return {
      ok: r.ok !== false,
      status: r.status || 200,
      headers: { get: (h) => (r.headers || {})[h] ?? null },
      json: async () => {
        if (r.telo === undefined) throw new Error('prázdné tělo');
        return r.telo;
      },
      signal: init?.signal,
    };
  };
  impl.volani = volani;
  return impl;
}

const sFetchem = async (impl, prace) => {
  const puvodni = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await prace(); } finally { globalThis.fetch = puvodni; }
};

/* ============================================================
   SKLÁDÁNÍ ADRESY
   ============================================================ */

test('volá se VÝHRADNĚ vlastní /api/, cizí doména se předat nedá', () => {
  // ⚠️ `R2`: klient nezná adresy cizích služeb. Předává se jméno služby,
  // nic víc — kdyby šlo podstrčit URL, byla by z proxy otevřená proxy.
  const f = fakeFetch({ telo: {} });
  return sFetchem(f, async () => {
    await apiGet('forecast', { latitude: '50' });
    assert.ok(f.volani[0].startsWith('/api/forecast?'), f.volani[0]);
  });
});

test('prázdné a chybějící parametry se do adresy nedostanou', () => {
  // Prázdný parametr by se choval jako zadaný a mohl by změnit odpověď.
  const f = fakeFetch({ telo: {} });
  return sFetchem(f, async () => {
    await apiGet('geocode', { name: 'Praha', count: null, lang: '', x: undefined });
    assert.match(f.volani[0], /^\/api\/geocode\?name=Praha$/);
  });
});

test('dovětek cesty se přilepí za jméno služby', () => {
  const f = fakeFetch({ telo: {} });
  return sFetchem(f, async () => {
    await apiGet('route', { start: '1,2' }, { subPath: 'driving-car' });
    assert.match(f.volani[0], /^\/api\/route\/driving-car\?/);
  });
});

test('přednost na síti se předá fetchi; bez ní se nepřidá nic', async () => {
  // Pořadí načítání podle toho, co je vidět (Michal 27. 9. 2026): předpověď
  // pro horní dlaždici `high`, pyly až dole `low`.
  const init = [];
  const f = async (url, i) => { init.push(i); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }; };
  await sFetchem(f, async () => {
    await apiGet('forecast', {}, { priority: 'high' });
    await apiGet('air');
  });
  assert.equal(init[0].priority, 'high');
  assert.ok(!('priority' in init[1]), 'bez volby žádný klíč — ať se nepřebíjí výchozí chování prohlížeče');
});

test('bez parametrů se nelepí prázdný otazník', () => {
  const f = fakeFetch({ telo: {} });
  return sFetchem(f, async () => {
    await apiGet('radar');
    assert.equal(f.volani[0], '/api/radar');
  });
});

/* ============================================================
   PŘEDSTIH (start.js) — dotaz poslaný dřív, než o něj appka požádá
   ============================================================ */

test('🚨 předem poslaný dotaz se převezme — na síť se nejde podruhé', async () => {
  const f = fakeFetch({ telo: { t: 21 } });
  await sFetchem(f, async () => {
    prefetchApi('forecast', { latitude: 50, longitude: 14 }, { priority: 'high' });
    const r = await apiGet('forecast', { latitude: 50, longitude: 14 }, { priority: 'high' });
    assert.equal(r.data.t, 21);
  });
  assert.equal(f.volani.length, 1, 'appka se zeptala znovu — předstih nebyl k ničemu');
});

test('převzít jde jen JEDNOU a jen přesně tutéž adresu', async () => {
  const f = fakeFetch({ telo: {} });
  await sFetchem(f, async () => {
    prefetchApi('forecast', { latitude: 50, longitude: 14 });
    await apiGet('forecast', { latitude: 49, longitude: 14 });   // jiné místo → vlastní dotaz
    await apiGet('forecast', { latitude: 50, longitude: 14 });   // převezme
    await apiGet('forecast', { latitude: 50, longitude: 14 });   // tělo už je přečtené → znovu
  });
  assert.equal(f.volani.length, 3);
});

test('🚨 stará předem stažená odpověď se nepodstrčí', async () => {
  // Appka, která o počasí požádá až po minutě (uvítání, karta na pozadí),
  // musí dostat čerstvé — ne to, co se stáhlo při startu.
  const f = fakeFetch({ telo: {} });
  await sFetchem(f, async () => {
    prefetchApi('forecast', { latitude: 51, longitude: 14 }, {}, Date.now() - PREDSTIH_PLATNOST_MS - 1000);
    await apiGet('forecast', { latitude: 51, longitude: 14 });
  });
  assert.equal(f.volani.length, 2);
});

test('🚨 zrušení platí i pro převzatý dotaz — jinak by se dokreslilo staré místo', async () => {
  let pust;
  const f = async () => { await new Promise((r) => { pust = r; }); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }; };
  await sFetchem(f, async () => {
    prefetchApi('forecast', { latitude: 52, longitude: 14 });
    const ac = new AbortController();
    const dotaz = apiGet('forecast', { latitude: 52, longitude: 14 }, { signal: ac.signal });
    ac.abort();
    await assert.rejects(dotaz, (e) => e.name === 'AbortError');
    pust();
  });
});

test('místo pro předstih: z adresy, jinak uložené, nesmysl nikdy', () => {
  const ulozeno = JSON.stringify({ place: { name: 'Praha', lat: 50.08, lon: 14.42 } });
  assert.deepEqual(startPlace('', ulozeno), { name: 'Praha', lat: 50.08, lon: 14.42 });
  // Adresa přebíjí uložené — v tomhle pořadí to dělá i `init()` v app.js.
  assert.equal(startPlace('?lat=22.785&lon=5.5228', ulozeno).lat, 22.785);
  assert.equal(startPlace('', null), null);
  assert.equal(startPlace('', '{rozbité'), null);
  assert.equal(startPlace('', JSON.stringify({ place: { lat: 0, lon: 0 } })), null);
  assert.equal(startPlace('?lat=0&lon=0', null), null);
});

test('dotaz na předpověď se skládá z jednoho zdroje', () => {
  const q = forecastQuery({ lat: 50, lon: 14 });
  assert.equal(q.latitude, 50);
  assert.equal(q.longitude, 14);
  assert.equal(q.forecast_days, FORECAST_PARAMS.forecast_days);
  // `station.js` parametry jen přeposílá — nesmí mít vlastní kopii.
  assert.equal(STATION_FORECAST_PARAMS, FORECAST_PARAMS);
});

/* ============================================================
   DRUH CHYBY

   🚨 „Moc dotazů teď" a „vyčerpaný denní příděl" chodí OBOJÍ jako 429
   a znamenají něco jiného: u prvního se čeká minuta, u druhého do zítřka.
   Bez rozlišení by appka napsala tutéž větu na dvě různé situace.
   ============================================================ */

test('chyba nese stav i text z proxy', () => {
  const f = fakeFetch({ ok: false, status: 502, telo: { error: 'Zdroj neodpověděl' } });
  return sFetchem(f, async () => {
    await assert.rejects(apiGet('forecast'), (e) => {
      assert.equal(e.status, 502);
      assert.equal(e.message, 'Zdroj neodpověděl');
      return true;
    });
  });
});

test('🚨 vyčerpaná kvóta se pozná od chvilkového stropu', () => {
  const f = fakeFetch({ ok: false, status: 429, telo: { error: 'Denní příděl', kvota: true } });
  return sFetchem(f, async () => {
    await assert.rejects(apiGet('route'), (e) => {
      assert.equal(e.status, 429);
      assert.equal(e.kvota, true);
      return true;
    });
  });
});

test('chvilkový strop nese, za jak dlouho to zkusit', () => {
  const f = fakeFetch({
    ok: false, status: 429, telo: { error: 'Moc dotazů', retryAfterS: 33 }, headers: { 'Retry-After': '33' },
  });
  return sFetchem(f, async () => {
    await assert.rejects(apiGet('route'), (e) => {
      assert.equal(e.kvota, false, 'tohle NENÍ vyčerpaná kvóta');
      assert.equal(e.retryAfterS, 33);
      return true;
    });
  });
});

test('poškozené tělo chyby nespadne, zbude aspoň stav', () => {
  // ⚠️ Bez tohohle by se z prázdné chybové odpovědi stala výjimka při
  // rozbalování JSONu a uživatel by neviděl vůbec nic.
  const f = fakeFetch({ ok: false, status: 500 });
  return sFetchem(f, async () => {
    await assert.rejects(apiGet('forecast'), (e) => {
      assert.equal(e.status, 500);
      assert.match(e.message, /500/);
      return true;
    });
  });
});

/* ============================================================
   PROŠLÁ DATA
   ============================================================ */

test('🚨 prošlá odpověď se pozná od čerstvé', () => {
  // Proxy servíruje stará data, když cizí služba neodpoví. Kdyby to nešlo
  // poznat, tvářila by se týdenní předpověď jako právě stažená.
  const f = fakeFetch({ telo: { a: 1 }, headers: { 'X-MeteoTrace-Stale': '1', Age: '900' } });
  return sFetchem(f, async () => {
    const r = await apiGet('forecast');
    assert.equal(r.stale, true);
    assert.equal(r.ageS, 900);
  });
});

test('čerstvá odpověď stará není', () => {
  const f = fakeFetch({ telo: { a: 1 } });
  return sFetchem(f, async () => {
    const r = await apiGet('forecast');
    assert.equal(r.stale, false);
    assert.equal(r.ageS, 0);
  });
});

/* ============================================================
   SPRÁVCE BĚŽÍCÍCH DOTAZŮ

   🚨 Uživatel, který třikrát přepíše cíl, spustí tři dotazy — a odpovědi
   můžou dorazit v OPAČNÉM pořadí. Bez rušení by na obrazovce skončil
   výsledek toho nejstaršího.
   ============================================================ */

test('🚨 nový dotaz téhož jména zruší ten předchozí', async () => {
  const skupina = createRequestGroup();
  let zruseno = false;

  const prvni = skupina.run('hledani', (signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { zruseno = true; reject(signal.reason); });
  }));
  const druhy = skupina.run('hledani', async () => 'druhý');

  assert.equal(await druhy, 'druhý');
  await prvni.catch(() => {});
  assert.equal(zruseno, true, 'starý dotaz musí dostat pokyn ke zrušení');
});

test('dotazy s RŮZNÝM jménem se navzájem neruší', async () => {
  // Hledání nesmí shodit načítání trasy — jsou to různé věci.
  const skupina = createRequestGroup();
  let zruseno = false;
  const trasa = skupina.run('trasa', (signal) => new Promise((res) => {
    signal.addEventListener('abort', () => { zruseno = true; });
    setTimeout(() => res('trasa hotová'), 5);
  }));
  await skupina.run('hledani', async () => 'nalezeno');
  assert.equal(await trasa, 'trasa hotová');
  assert.equal(zruseno, false);
});

test('zrušený dotaz se pozná a není to chyba k ukázání', () => {
  const skupina = createRequestGroup();
  const ac = new AbortController();
  ac.abort();
  assert.equal(skupina.isAbort(ac.signal.reason), true);
  assert.equal(skupina.isAbort(new Error('opravdová chyba')), false);
});

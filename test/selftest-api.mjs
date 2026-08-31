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

import { apiGet, createRequestGroup } from '../web/lib/api.js';

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

test('bez parametrů se nelepí prázdný otazník', () => {
  const f = fakeFetch({ telo: {} });
  return sFetchem(f, async () => {
    await apiGet('radar');
    assert.equal(f.volani[0], '/api/radar');
  });
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

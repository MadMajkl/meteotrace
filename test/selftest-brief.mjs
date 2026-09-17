/**
 * Samotest ranní a večerní zprávy (`R25`).
 *
 * Spuštění:  npm run selftest:logic
 *
 * 🚨 Nejcennější kontroly tu nejsou o textu, ale o TOM, KTERÝ DEN se popisuje.
 * Server běží v UTC, uživatel je v Praze — a večerní zpráva v 21:00 SELČ se
 * v UTC odesílá ještě „dneska", zatímco mluvit má o zítřku.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { briefText, indexDne, BRIEF_PARAMS, RAIN_MENTION, WIND_MENTION } from '../web/lib/brief.js';
import { METRIC, IMPERIAL } from '../web/lib/units.js';

/** Odpověď Open-Meteo, jak ji vrací s `timezone=auto` pro Česko v létě (+2 h). */
function predpoved({ dny = ['2026-09-17', '2026-09-18'], kody = [3, 61], min = [8, 6], max = [19, 17], dest = [10, 70], vitr = [12, 55], posunS = 7200 } = {}) {
  return {
    utc_offset_seconds: posunS,
    timezone: 'Europe/Prague',
    daily: {
      time: dny,
      weather_code: kody,
      temperature_2m_min: min,
      temperature_2m_max: max,
      precipitation_probability_max: dest,
      wind_speed_10m_max: vitr,
    },
  };
}

/** 17. 9. 2026 v 6:30 pražského času = 4:30 UTC. */
const RANO = Date.UTC(2026, 8, 17, 4, 30);
/** 17. 9. 2026 ve 21:00 pražského času = 19:00 UTC. */
const VECER = Date.UTC(2026, 8, 17, 19, 0);

/* ── který den se popisuje ──────────────────────────────────────────── */

test('ranní zpráva mluví o dnešku', () => {
  assert.equal(indexDne({ forecast: predpoved(), kind: 'morning', nowMs: RANO }), 0);
});

test('🚨 večerní zpráva mluví o ZÍTŘKU, ne o dnešku', () => {
  assert.equal(indexDne({ forecast: predpoved(), kind: 'evening', nowMs: VECER }), 1);
});

test('🚨 den se počítá v pásmu MÍSTA, ne serveru', () => {
  // Server (Netlify) běží v UTC. Ve 23:30 pražského času je v UTC teprve
  // 21:30 TÉHOŽ dne — ale o půlnoci pražského času by UTC ukazovalo ještě
  // včerejšek a zpráva by popisovala špatný den.
  const pulnoc = Date.UTC(2026, 8, 17, 22, 30);   // 0:30 pražského času 18. 9.
  const i = indexDne({ forecast: predpoved(), kind: 'morning', nowMs: pulnoc });
  assert.equal(i, 1, 'v Praze je už 18. 9., takže „dnes" je druhý den v poli');
});

test('🚨 když ten den v předpovědi není, vrací −1 a NEZVONÍ se', () => {
  // Zpráva o dni, o kterém nic nevíme, je horší než žádná.
  const jenDnes = predpoved({ dny: ['2026-09-17'], kody: [3], min: [8], max: [19], dest: [10], vitr: [12] });
  assert.equal(indexDne({ forecast: jenDnes, kind: 'evening', nowMs: VECER }), -1);
  assert.equal(briefText({ forecast: jenDnes, kind: 'evening', nowMs: VECER, lang: 'cs', units: METRIC }), null);

  const cizi = predpoved({ dny: ['2026-10-01', '2026-10-02'] });
  assert.equal(indexDne({ forecast: cizi, kind: 'morning', nowMs: RANO }), -1);
});

/* ── text ───────────────────────────────────────────────────────────── */

test('ranní zpráva: teplota, jev a nic navíc, když není co dodat', () => {
  const r = briefText({ forecast: predpoved(), kind: 'morning', nowMs: RANO, lang: 'cs', units: METRIC });
  assert.equal(r.text, 'Dnes 8 až 19 °C · Zataženo');
  assert.equal(r.den, '2026-09-17');
});

test('🚨 jednotka je JEN u druhého čísla — „8 až 19 °C", ne „8 °C až 19 °C"', () => {
  const r = briefText({ forecast: predpoved(), kind: 'morning', nowMs: RANO, lang: 'cs', units: METRIC });
  assert.equal(r.text.match(/°C/g).length, 1, r.text);
});

test('večerní zpráva připíše déšť i vítr, když stojí za řeč', () => {
  const r = briefText({ forecast: predpoved(), kind: 'evening', nowMs: VECER, lang: 'cs', units: METRIC });
  assert.equal(r.text, 'Zítra 6 až 17 °C · Déšť, pravděpodobnost 70 %, vítr až 55 km/h');
});

test('🚨 slabý déšť a slabý vítr se NEPÍŠÍ — věta má nést rozhodnutí, ne šum', () => {
  const klid = predpoved({ dest: [RAIN_MENTION - 1, 0], vitr: [WIND_MENTION - 1, 0] });
  const r = briefText({ forecast: klid, kind: 'morning', nowMs: RANO, lang: 'cs', units: METRIC });
  assert.ok(!r.text.includes('pravděpodobnost'), r.text);
  assert.ok(!r.text.includes('vítr'), r.text);
});

test('práh je hranice včetně — přesně na něm se píše', () => {
  const na = predpoved({ dest: [RAIN_MENTION, 0], vitr: [WIND_MENTION, 0] });
  const r = briefText({ forecast: na, kind: 'morning', nowMs: RANO, lang: 'cs', units: METRIC });
  assert.ok(r.text.includes(`pravděpodobnost ${RAIN_MENTION} %`), r.text);
  assert.ok(r.text.includes('vítr až'), r.text);
});

test('zpráva umí anglicky a v imperiálních jednotkách', () => {
  const r = briefText({ forecast: predpoved(), kind: 'evening', nowMs: VECER, lang: 'en', units: IMPERIAL });
  assert.ok(r.text.startsWith('Tomorrow 43 to 63 °F'), r.text);
  assert.ok(r.text.includes('chance 70%'), r.text);
  assert.ok(r.text.includes('mph'), r.text);
});

/* ── co dělat, když data nejsou ─────────────────────────────────────── */

test('🚨 bez teplot se NEZVONÍ — „Dnes — · Zataženo" není zpráva', () => {
  const bez = predpoved({ min: [null, null], max: [null, null] });
  assert.equal(briefText({ forecast: bez, kind: 'morning', nowMs: RANO, lang: 'cs', units: METRIC }), null);
});

test('prázdná nebo rozbitá odpověď nevyhodí výjimku, jen mlčí', () => {
  for (const f of [null, {}, { daily: {} }, { daily: { time: [] } }]) {
    assert.equal(briefText({ forecast: f, kind: 'morning', nowMs: RANO, lang: 'cs', units: METRIC }), null);
  }
});

test('neznámý druh zprávy se odmítne', () => {
  assert.equal(briefText({ forecast: predpoved(), kind: 'poledne', nowMs: RANO, lang: 'cs', units: METRIC }), null);
});

/* ── dotaz na předpověď ─────────────────────────────────────────────── */

test('🚨 stahují se DVA dny — večerní zpráva potřebuje zítřek', () => {
  assert.equal(BRIEF_PARAMS.forecast_days, '2');
  assert.equal(BRIEF_PARAMS.timezone, 'auto', 'bez pásma místa by se spletl den');
  for (const pole of ['temperature_2m_min', 'temperature_2m_max', 'weather_code']) {
    assert.ok(BRIEF_PARAMS.daily.includes(pole), `chybí ${pole}`);
  }
});

/* ============================================================
   STAVITEL NA SERVERU (`server/brief.js`)

   🚨 Sem patří kontroly toho, co se ptá ven — a hlavně ta o nulovém
   ostrově. Ta vada se v testech nad čistou logikou schovat umí, protože
   `briefText` dostane souřadnice až hotové.
   ============================================================ */

import { stavZpravu } from '../server/brief.js';

/** Předstíraný `fetch`: zapamatuje si adresu a vrátí připravenou odpověď. */
function falesnyFetch(telo, { ok = true, status = 200 } = {}) {
  const volani = [];
  const f = async (url) => {
    volani.push(url);
    return { ok, status, json: async () => telo };
  };
  f.volani = volani;
  return f;
}

test('🚨 NULOVÝ OSTROV: dotaz bez souřadnic nesmí vrátit počasí z Guinejského zálivu', async () => {
  // `Number(null)` je 0 a `Number.isFinite(0)` je true — dokud se hlídala
  // jen konečnost, vracela appka „Dnes 24 až 25 °C · Mrholení" pro bod 0,0.
  const f = falesnyFetch(predpoved());
  const r = await stavZpravu({ fetchImpl: f, base: 'https://api.open-meteo.com/v1/forecast', nowMs: RANO, params: new URLSearchParams({ kind: 'morning', lang: 'cs' }) });
  assert.equal(r.text, null, 'bez souřadnic se nesmí nic vrátit');
  assert.equal(f.volani.length, 0, 'a ven se kvůli tomu nemá vůbec chodit');
});

test('🚨 ani výslovná nula není poloha', async () => {
  const f = falesnyFetch(predpoved());
  const r = await stavZpravu({ fetchImpl: f, base: 'https://api.open-meteo.com/v1/forecast', nowMs: RANO, params: new URLSearchParams({ lat: '0', lon: '0', kind: 'morning', lang: 'cs' }) });
  assert.equal(r.text, null);
  assert.equal(f.volani.length, 0);
});

test('stavitel se zeptá na správné místo a správná pole', async () => {
  const f = falesnyFetch(predpoved());
  const r = await stavZpravu({
    fetchImpl: f, base: 'https://api.open-meteo.com/v1/forecast', nowMs: RANO,
    params: new URLSearchParams({ lat: '49.5307', lon: '12.9436', kind: 'morning', lang: 'cs', units: 'metric' }),
  });
  assert.equal(r.text, 'Dnes 8 až 19 °C · Zataženo');

  const u = new URL(f.volani[0]);
  assert.equal(u.searchParams.get('latitude'), '49.5307');
  assert.equal(u.searchParams.get('longitude'), '12.9436');
  assert.equal(u.searchParams.get('timezone'), 'auto');
  assert.equal(u.searchParams.get('forecast_days'), '2');
  // ⚠️ Parametry zprávy (`kind`, `lang`, `units`) se ven NEPOSÍLAJÍ —
  // Open-Meteo o nich nic neví a je to zbytečné plkání do cizí služby.
  for (const cizi of ['kind', 'lang', 'units', 'lat', 'lon']) {
    assert.equal(u.searchParams.get(cizi), null, `${cizi} nemá co dělat v dotazu na předpověď`);
  }
});

test('výpadek předpovědi zprávu umlčí, ale nespadne', async () => {
  const f = falesnyFetch(null, { ok: false, status: 503 });
  const r = await stavZpravu({
    fetchImpl: f, base: 'https://api.open-meteo.com/v1/forecast', nowMs: RANO,
    params: new URLSearchParams({ lat: '49.5', lon: '13.0', kind: 'morning', lang: 'cs' }),
  });
  assert.equal(r.text, null);
  assert.match(r.duvod, /503/);
});

test('neznámý druh zprávy se ven neptá vůbec', async () => {
  const f = falesnyFetch(predpoved());
  const r = await stavZpravu({
    fetchImpl: f, base: 'https://api.open-meteo.com/v1/forecast', nowMs: RANO,
    params: new URLSearchParams({ lat: '49.5', lon: '13.0', kind: 'poledne', lang: 'cs' }),
  });
  assert.equal(r.text, null);
  assert.equal(f.volani.length, 0);
});

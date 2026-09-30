/**
 * Samotest statistik (`R35`) — období, souhrny, série, roky, deník míst
 * a stavitelé historie na serveru.
 *
 * Bez prohlížeče a bez sítě. Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  periodRange, PERIODS, addDays, daysBetween, dayMs, isoDay, localToday,
  checkHistoryQuery, roundCoord, MAX_DNI, ARCHIV_OD,
  summarizeDaily, chartSeries, yearlyFromDaily, summarizeYears, yearsInRange, dir8,
  recordVisit, cleanVisits, visitsInRange, MAX_NAVSTEV, HISTORY_DAILY, CLIMATE_DAILY,
} from '../web/lib/stats.js';
import { stavHistorii, stavKlima } from '../server/history.js';
import { planRequest } from '../web/lib/proxy-core.js';
import { isKnownService } from '../web/lib/upstreams.js';

const DNES = '2026-09-30';

/* ============================================================
   OBDOBÍ
   ============================================================ */

test('🚨 klouzavá období končí VČEREJŠKEM, ne dneškem', () => {
  // Dnešek v archivu není celý — týden s půlkou dneška by měl podhodnocené
  // srážky i slunce a nikdo by nepoznal proč.
  for (const k of ['7', 'month', 'm3', 'year', 'thisyear', 'all']) {
    assert.equal(periodRange(k, DNES).to, '2026-09-29', k);
  }
});

test('délky období: 7, 30, 90 a 365 dní', () => {
  const dni = (k) => { const r = periodRange(k, DNES); return daysBetween(r.from, r.to); };
  assert.equal(dni('7'), 7);
  assert.equal(dni('month'), 30);
  assert.equal(dni('m3'), 90);
  assert.equal(dni('year'), 365);
  assert.equal(periodRange('7', DNES).from, '2026-09-23');
});

test('aktuální rok od 1. ledna, minulý rok celý', () => {
  assert.deepEqual(periodRange('thisyear', DNES), { from: '2026-01-01', to: '2026-09-29' });
  assert.deepEqual(periodRange('lastyear', DNES), { from: '2025-01-01', to: '2025-12-31' });
  // 1. ledna letošek ještě žádný celý den nemá — prázdno, ne záporný rozsah.
  assert.deepEqual(periodRange('thisyear', '2026-01-01'), { empty: true });
  assert.deepEqual(periodRange('lastyear', '2026-01-01'), { from: '2025-01-01', to: '2025-12-31' });
});

test('„Od začátku" je od roku 1940 a čte se po rocích', () => {
  assert.deepEqual(periodRange('all', DNES), { from: ARCHIV_OD, to: '2026-09-29', years: true });
});

test('vlastní období: prohozené kraje, budoucnost, moc dlouhé', () => {
  assert.deepEqual(periodRange('custom', DNES, { from: '2026-09-10', to: '2026-09-01' }),
    { from: '2026-09-01', to: '2026-09-10' });
  // Budoucnost se ořízne na včerejšek, pravěk na začátek archivu.
  assert.equal(periodRange('custom', DNES, { from: '2026-09-01', to: '2027-01-01' }).to, '2026-09-29');
  assert.equal(periodRange('custom', DNES, { from: '1900-01-01', to: '1941-01-01' }).from, ARCHIV_OD);
  // Celé v budoucnosti, nebo nesmysl → prázdno.
  assert.deepEqual(periodRange('custom', DNES, { from: '2027-01-01', to: '2027-02-01' }), { empty: true });
  assert.deepEqual(periodRange('custom', DNES, { from: '', to: '2026-09-01' }), { empty: true });
  assert.deepEqual(periodRange('custom', DNES, { from: '2026-02-31', to: '2026-09-01' }), { empty: true });
  // 🚨 Delší než MAX_DNI se čte po rocích — po dnech by vyčerpalo zdroj.
  assert.equal(periodRange('custom', DNES, { from: '2020-01-01', to: '2026-09-01' }).years, true);
  assert.equal(periodRange('custom', DNES, { from: '2025-01-01', to: '2026-09-01' }).years, undefined);
});

test('každé období z nabídky dá rozsah nebo prázdno, nic jiného', () => {
  for (const k of PERIODS) {
    const r = periodRange(k, DNES, { from: '2026-08-01', to: '2026-08-31' });
    assert.ok(r.empty || (dayMs(r.from) <= dayMs(r.to)), k);
  }
  assert.deepEqual(periodRange('nesmysl', DNES), { empty: true });
});

test('🚨 dnešek se bere v místním čase, ne v UTC', () => {
  // 30. 9. 2026 01:30 českého času je v UTC ještě 29. 9. 23:30.
  const ms = Date.parse('2026-09-29T23:30:00Z');
  assert.equal(localToday(ms, 120), '2026-09-30');
  assert.equal(localToday(ms, 0), '2026-09-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(isoDay(dayMs('2024-02-29')), '2024-02-29');
});

/* ============================================================
   DOTAZ — hlídá ho server
   ============================================================ */

test('🚨 dotaz na historii: nesmysl, budoucnost a stoletý rozsah neprojdou', () => {
  const ok = { lat: '50.08331', lon: '14.41672', from: '2026-09-23', to: '2026-09-29' };
  assert.deepEqual(checkHistoryQuery(ok, DNES), { lat: 50.08, lon: 14.42, from: '2026-09-23', to: '2026-09-29' });
  const spatne = [
    { ...ok, lat: '0', lon: '0' },                       // nulový ostrov
    { ...ok, lat: 'abc' },
    { ...ok, from: '2026-9-23' },
    { ...ok, from: '2026-09-29', to: '2026-09-23' },     // pozpátku
    { ...ok, from: '1939-12-31', to: '1940-01-05' },
    { ...ok, to: '2026-10-05' },                         // budoucnost
    { ...ok, from: '2020-01-01' },                       // přes MAX_DNI
  ];
  for (const q of spatne) assert.throws(() => checkHistoryQuery(q, DNES), JSON.stringify(q));
  assert.ok(MAX_DNI >= 731, 'minulý rok i poslední rok se musí vejít do jednoho dotazu');
});

test('souřadnice se zaokrouhlují bez plovoucích zbytků', () => {
  assert.equal(roundCoord(50.08331, 0.01), 50.08);
  assert.equal(roundCoord(14.4167, 0.25), 14.5);
  assert.equal(roundCoord(-0.07, 0.01), -0.07);
  assert.equal(String(roundCoord(0.07 + 0.01, 0.01)), '0.08');
});

test('katalog: obě služby existují, ověřují dotaz a sdílejí mezipaměť', () => {
  assert.ok(isKnownService('history') && isKnownService('climate'));
  const p = (pathname, params) => planRequest({ pathname, params });
  const a = p('/api/history', { lat: '50.08331', lon: '14.41672', from: '2026-09-23', to: '2026-09-29' });
  const b = p('/api/history', { lat: '50.08412', lon: '14.41598', from: '2026-09-23', to: '2026-09-29' });
  assert.equal(a.ok, true);
  assert.equal(a.builder, 'meteoHistorie');
  assert.equal(a.cacheKey, b.cacheKey, 'dva lidé ve stejné ulici mají sdílet jednu odpověď');
  // Vadný dotaz je chyba 400 (naše), ne 502 „zdroj neodpověděl".
  assert.equal(p('/api/history', { lat: '50', lon: '14', from: '1990-01-01', to: '2026-01-01' }).status, 400);
  assert.equal(p('/api/history', { lat: '0', lon: '0', from: '2026-09-23', to: '2026-09-29' }).status, 400);
  const k = p('/api/climate', { lat: '50.0833', lon: '14.4167' });
  assert.equal(k.cacheKey, 'climate?lat=50&lon=14.5');
  assert.equal(p('/api/climate', { lat: 'x', lon: '14' }).status, 400);
  // Roky platí dlouho — minulost se nemění a dotaz je těžký.
  assert.ok(k.ttlS >= 24 * 3600);
});

/* ============================================================
   SOUHRN
   ============================================================ */

const TYDEN = {
  time: ['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29'],
  temperature_2m_max: [20, 22, 31, 18, 15, 12, 14],
  temperature_2m_min: [10, 11, 15, 9, 5, -1, 2],
  temperature_2m_mean: [15, 16, 23, 13, 10, 6, 8],
  precipitation_sum: [0, 0, 0.4, 12, 3, 0, 0],
  snowfall_sum: [0, 0, 0, 0, 0, 0.5, 0],
  cloud_cover_mean: [10, 20, 45, 95, 80, 60, 5],
  wind_gusts_10m_max: [20, 25, 30, 72, 40, 35, 22],
  wind_direction_10m_dominant: [270, 260, 280, 300, 350, 10, 275],
};

test('souhrn týdne: teploty, srážky, slunce, vítr, dny', () => {
  const s = summarizeDaily(TYDEN);
  assert.equal(s.days, 7);
  assert.equal(s.tempMean, 13);
  assert.deepEqual(s.tempMax, { value: 31, date: '2026-09-25' });
  assert.deepEqual(s.tempMin, { value: -1, date: '2026-09-28' });
  assert.equal(s.precipSum, 15.4);
  // 0,4 mm NENÍ deštivý den — mez je 1 mm.
  assert.equal(s.rainDays, 2);
  assert.deepEqual(s.wettestDay, { value: 12, date: '2026-09-26' });
  // Jasno do 20 % průměrné oblačnosti, zataženo od 80 % — včetně krajů.
  assert.equal(s.cloudMean, 45);
  assert.equal(s.clearDays, 3);
  assert.equal(s.overcastDays, 2);
  assert.deepEqual(s.gustMax, { value: 72, date: '2026-09-26' });
  assert.deepEqual(s.windDir, { key: 'w', days: 4 });
  assert.equal(s.tropicalDays, 1);
  assert.equal(s.frostDays, 1);
  assert.equal(s.snowDays, 1);
});

test('série: nejdelší období bez deště a s deštěm, i s daty', () => {
  const s = summarizeDaily(TYDEN);
  assert.deepEqual(s.dryStreak, { days: 3, from: '2026-09-23', to: '2026-09-25' });
  assert.deepEqual(s.wetStreak, { days: 2, from: '2026-09-26', to: '2026-09-27' });
});

test('🚨 díra v datech sérii PŘERUŠÍ a nepočítá se jako nula', () => {
  const s = summarizeDaily({
    time: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'],
    temperature_2m_max: [20, 21, null, 22, 23],
    temperature_2m_min: [10, 11, null, 12, 13],
    temperature_2m_mean: [15, 16, null, 17, 18],
    precipitation_sum: [0, 0, null, 0, 0],
  });
  // Pět dní „bez deště" by byla lež — o prostředním nevíme nic.
  assert.equal(s.dryStreak.days, 2);
  assert.equal(s.daysWithData, 4);
  assert.equal(s.tempMean, 16.5);
  // Chybějící veličiny (oblačnost, vítr) nejsou nula, ale „nevíme" → null.
  assert.equal(s.gustMax, null);
  assert.equal(s.cloudMean, null);
  assert.equal(s.windDir, null);
});

test('prázdná nebo chybějící data nedají souhrn', () => {
  assert.equal(summarizeDaily(null), null);
  assert.equal(summarizeDaily({ time: [] }), null);
  assert.equal(summarizeDaily({ time: ['2026-09-01'], temperature_2m_max: [null], precipitation_sum: [null] }), null);
});

test('🚨 osm stran větru má stejně široké výseče', () => {
  // Sloučením 16 dílků by diagonály dostaly trojnásobnou výseč.
  assert.equal(dir8(0), 'n');
  assert.equal(dir8(22), 'n');
  assert.equal(dir8(23), 'ne');
  assert.equal(dir8(67), 'ne');
  assert.equal(dir8(68), 'e');
  assert.equal(dir8(350), 'n');
  assert.equal(dir8(-90), 'w');
  assert.equal(dir8(null), null);
});

/* ============================================================
   GRAF
   ============================================================ */

function dny(n, od = '2026-01-01') {
  const time = Array.from({ length: n }, (_, i) => addDays(od, i));
  return {
    time,
    temperature_2m_max: time.map((_, i) => 10 + (i % 10)),
    temperature_2m_min: time.map((_, i) => (i % 10) - 2),
    precipitation_sum: time.map((_, i) => (i % 3 === 0 ? 2 : 0)),
  };
}

test('graf: po dnech, po týdnech, po měsících podle délky', () => {
  assert.equal(chartSeries(dny(7)).step, 'day');
  assert.equal(chartSeries(dny(30)).points.length, 30);
  const m3 = chartSeries(dny(90));
  assert.equal(m3.step, 'week');
  assert.equal(m3.points.length, 13);
  const rok = chartSeries(dny(365));
  assert.equal(rok.step, 'month');
  assert.equal(rok.points.length, 12);
  // Sloupec drží extrémy a SOUČET srážek, ne průměr.
  const t = m3.points[0];
  assert.equal(t.tMax, 16);
  assert.equal(t.tMin, -2);
  assert.equal(t.precip, 6);
  assert.deepEqual([t.from, t.to], ['2026-01-01', '2026-01-07']);
});

/* ============================================================
   ROKY
   ============================================================ */

test('roky: průměr teploty, součet srážek, počet dní', () => {
  const d = {
    time: ['1999-12-30', '1999-12-31', '2000-01-01', '2000-01-02', '2000-01-03'],
    temperature_2m_mean: [1, 3, 10, null, 20],
    precipitation_sum: [1, 2, 0.5, 0.5, null],
  };
  assert.deepEqual(yearlyFromDaily(d), [
    { year: 1999, tempMean: 2, precipSum: 3, days: 2 },
    { year: 2000, tempMean: 15, precipSum: 1, days: 2 },
  ]);
});

test('🚨 do rekordů se berou jen CELÉ roky — letošek do září by vyhrál všechno', () => {
  const roky = [];
  for (let y = 1961; y <= 2025; y++) roky.push({ year: y, tempMean: 8 + (y - 1961) * 0.03, precipSum: 600 + (y % 7) * 10, days: 365 });
  roky.push({ year: 2026, tempMean: 14.2, precipSum: 310, days: 272 });   // jen do září
  const s = summarizeYears(roky);
  assert.equal(s.warmest.year, 2025);
  assert.equal(s.driest.precipSum, 600);
  assert.notEqual(s.driest.year, 2026);
  assert.equal(s.to, 2025);
  // Oteplení: posledních 10 celých let proti 1961–1990.
  assert.deepEqual(s.changeYears, { from: 2016, to: 2025 });
  assert.ok(Math.abs(s.change - 1.35) < 0.01, String(s.change));
});

test('bez srovnávacího období se oteplení netvrdí', () => {
  const roky = [];
  for (let y = 2000; y <= 2025; y++) roky.push({ year: y, tempMean: 9, precipSum: 600, days: 365 });
  assert.equal(summarizeYears(roky).change, null);
  assert.equal(summarizeYears([]), null);
  assert.equal(yearsInRange(roky, '2010-05-01', '2012-02-01').length, 3);
});

/* ============================================================
   DENÍK NAVŠTÍVENÝCH MÍST
   ============================================================ */

test('deník: jeden záznam na den a místo, nejnovější první', () => {
  const plzen = { lat: 49.7475, lon: 13.3776 };
  const praha = { lat: 50.0833, lon: 14.4167 };
  let d = recordVisit([], plzen, '2026-09-28', 'Plzeň');
  d = recordVisit(d, { lat: 49.7481, lon: 13.3770 }, '2026-09-28');       // totéž místo, týž den
  assert.equal(d.length, 1);
  d = recordVisit(d, praha, '2026-09-28', 'Praha');                        // večer jinde
  d = recordVisit(d, praha, '2026-09-29');
  // V rámci dne je novější záznam první: večer Praha, ráno Plzeň.
  assert.deepEqual(d.map((z) => `${z.d} ${z.n}`), ['2026-09-29 ', '2026-09-28 Praha', '2026-09-28 Plzeň']);
  // Jméno dorazí později než poloha — doplní se, nepřidá se řádek.
  d = recordVisit(d, praha, '2026-09-29', 'Praha');
  assert.equal(d.length, 3);
  assert.equal(d[0].n, 'Praha');
});

test('deník: nesmysl se nezapíše a délka má strop', () => {
  assert.deepEqual(recordVisit([], { lat: 0, lon: 0 }, '2026-09-28'), []);
  assert.deepEqual(recordVisit([], { lat: 50, lon: 14 }, 'včera'), []);
  let d = [];
  for (let i = 0; i < MAX_NAVSTEV + 20; i++) d = recordVisit(d, { lat: 50, lon: 14 }, addDays('2026-01-01', i));
  assert.equal(d.length, MAX_NAVSTEV);
  assert.equal(d[0].d, addDays('2026-01-01', MAX_NAVSTEV + 19), 'nejnovější zůstávají');
});

test('deník z úložiště: poškozený zápis appku neshodí', () => {
  assert.deepEqual(cleanVisits('nesmysl'), []);
  assert.deepEqual(cleanVisits([null, { d: '2026-09-28', lat: 0, lon: 0 }, { d: 'x', lat: 50, lon: 14 }]), []);
  const d = cleanVisits([{ d: '2026-09-28', lat: '50', lon: '14', n: 5 }]);
  assert.deepEqual(d, [{ d: '2026-09-28', lat: 50, lon: 14, n: '' }]);
  const v = [{ d: '2026-09-29', lat: 50, lon: 14 }, { d: '2026-09-20', lat: 49, lon: 13 }];
  assert.equal(visitsInRange(v, '2026-09-23', '2026-09-29').length, 1);
});

/* ============================================================
   STAVITELÉ NA SERVERU
   ============================================================ */

function fakeArchiv(zapis) {
  return async (url) => {
    const u = new URL(url);
    zapis.push(u);
    const od = u.searchParams.get('start_date');
    const po = u.searchParams.get('end_date');
    const n = daysBetween(od, po);
    const time = Array.from({ length: n }, (_, i) => addDays(od, i));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        elevation: 203,
        daily: {
          time,
          temperature_2m_mean: time.map(() => 10),
          temperature_2m_max: time.map(() => 15),
          precipitation_sum: time.map(() => 1),
        },
      }),
    };
  };
}

const NYNI = Date.parse('2026-09-30T08:00:00Z');
const ARCHIV = 'https://archive-api.open-meteo.com/v1/archive';

test('🚨 historie: veličiny určuje SERVER a souřadnice jdou ven zaokrouhlené', async () => {
  const volani = [];
  const out = await stavHistorii({
    fetchImpl: fakeArchiv(volani), base: ARCHIV, nowMs: NYNI,
    params: { lat: '50.08331', lon: '14.41672', from: '2026-09-23', to: '2026-09-29', daily: 'vsechno', hourly: 'x' },
  });
  assert.equal(volani.length, 1);
  const q = volani[0].searchParams;
  assert.equal(q.get('daily'), HISTORY_DAILY.join(','));
  assert.equal(q.get('hourly'), null, 'klient si nesmí říct o nic navíc');
  assert.equal(q.get('latitude'), '50.08');
  assert.equal(out.daily.time.length, 7);
  assert.equal(out.elevation, 203);
});

test('historie: dnešek a zítřek se oříznou, vadný dotaz se ven vůbec nepošle', async () => {
  const volani = [];
  const out = await stavHistorii({
    fetchImpl: fakeArchiv(volani), base: ARCHIV, nowMs: NYNI,
    params: { lat: '50', lon: '14', from: '2026-09-25', to: '2026-10-01' },
  });
  assert.equal(out.to, '2026-09-30');
  await assert.rejects(stavHistorii({
    fetchImpl: fakeArchiv(volani), base: ARCHIV, nowMs: NYNI,
    params: { lat: '50', lon: '14', from: '1990-01-01', to: '2026-09-29' },
  }));
  assert.equal(volani.length, 1);
});

test('🚨 roky: jen dvě veličiny, tři kusy, síť 0,25° a klientovi roky, ne dny', async () => {
  const volani = [];
  const out = await stavKlima({
    fetchImpl: fakeArchiv(volani), base: ARCHIV, nowMs: NYNI, params: { lat: '50.0833', lon: '14.4167' },
  });
  assert.equal(volani.length, 3);
  for (const u of volani) {
    assert.equal(u.searchParams.get('daily'), CLIMATE_DAILY.join(','));
    assert.equal(u.searchParams.get('latitude'), '50');
    assert.equal(u.searchParams.get('longitude'), '14.5');
  }
  assert.equal(volani[0].searchParams.get('start_date'), '1940-01-01');
  assert.equal(volani[2].searchParams.get('end_date'), '2026-09-29');
  assert.equal(out.years.length, 87);
  assert.deepEqual(out.years[0], { year: 1940, tempMean: 10, precipSum: 366, days: 366 });
  assert.equal(out.years[86].year, 2026);
  assert.ok(JSON.stringify(out).length < 8000, 'klientovi jdou řádky po rocích, ne megabajty dní');
});

test('roky: chyba zdroje nese stav dál (429 není výpadek)', async () => {
  const f = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(
    stavKlima({ fetchImpl: f, base: ARCHIV, nowMs: NYNI, params: { lat: '50', lon: '14' } }),
    (e) => e.status === 429,
  );
  await assert.rejects(stavKlima({ fetchImpl: f, base: ARCHIV, nowMs: NYNI, params: { lat: '0', lon: '0' } }));
});

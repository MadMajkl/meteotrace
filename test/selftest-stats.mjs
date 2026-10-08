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
  VELICINY, VELICINY_ROKY, availableQuantities,
  HODIN, RECENT_HOURLY, DESTIVA_HODINA_MM, checkRecentQuery, hourIso, recentHours,
  availableHourQuantities, hourlySeries, summarizeHourly,
} from '../web/lib/stats.js';
import { stavHistorii, stavKlima, stavPoslednich } from '../server/history.js';
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

test('každé období z nabídky dá rozsah, hodiny nebo prázdno, nic jiného', () => {
  for (const k of PERIODS) {
    const r = periodRange(k, DNES, { from: '2026-08-01', to: '2026-08-31' });
    assert.ok(r.empty || r.hours > 0 || (dayMs(r.from) <= dayMs(r.to)), k);
  }
  assert.deepEqual(periodRange('nesmysl', DNES), { empty: true });
});

test('🚨 posledních 48 hodin: první v nabídce a „kdy" neurčuje telefon', () => {
  assert.equal(PERIODS[0], 'h48');
  // Bez data: hodiny se počítají v čase MÍSTA, a ten zná až zdroj.
  assert.deepEqual(periodRange('h48', DNES), { hours: 48 });
  assert.equal(HODIN, 48);
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
  assert.equal(t.days, 7);
});

/** `dny()` se vším, co umí přepínač veličin (6. 10. 2026). */
function dnySeVsim(n) {
  const d = dny(n);
  const po7 = (f) => d.time.map((_, i) => f(i % 7));
  return {
    ...d,
    apparent_temperature_max: po7((j) => 8 + j),
    apparent_temperature_min: po7((j) => j - 5),
    wind_speed_10m_max: po7((j) => 10 + j),
    wind_gusts_10m_max: po7((j) => 20 + 2 * j),
    wind_direction_10m_dominant: po7((j) => (j < 4 ? 270 : 90)),
    relative_humidity_2m_mean: po7((j) => 60 + 5 * j),
    cloud_cover_mean: po7((j) => 10 * j),
    pressure_msl_mean: po7((j) => 1010 + j),
  };
}

test('🚨 graf: týden slučuje každou veličinu podle toho, co znamená', () => {
  // Michal 6. 10. 2026: přepínač mezi „ostatními údaji, které meteotrace
  // ukazuje". Sloupec za týden musí říct pravdu u každého z nich.
  const t = chartSeries(dnySeVsim(90)).points[0];
  // Nejvyšší a nejnižší → extrém (ne průměr — „pocitově až 14 °C").
  assert.equal(t.fMax, 14);
  assert.equal(t.fMin, -5);
  assert.equal(t.wind, 16);
  assert.equal(t.gust, 32);
  // Průměry → průměr (součet vlhkosti za týden by byl nesmysl).
  assert.equal(t.humidity, 75);
  assert.equal(t.cloud, 30);
  assert.equal(t.pressure, 1013);
  // Směr → nejčastější strana: čtyři dny západ, tři východ.
  assert.equal(t.windDir, 'w');
});

test('🚨 graf: den bez údaje je „nevím", ne nula', () => {
  // Nula srážek i nula procent jsou věrohodná čísla — díra by se za ně schovala
  // a bublina po klepnutí by tvrdila „0,0 mm".
  const p = chartSeries({ time: ['2026-01-01'], temperature_2m_max: [5], precipitation_sum: [null] }).points[0];
  assert.equal(p.precip, null);
  assert.equal(p.humidity, null);
  assert.equal(p.pressure, null);
  assert.equal(p.windDir, null);
  assert.equal(p.tMax, 5);
});

test('přepínač nabízí jen veličiny, které v odpovědi opravdu jsou', () => {
  // Odpověď z mezipaměti před 6. 10. 2026 nové veličiny nemá — prázdný graf
  // „Vlhkost" by vypadal jako rozbitý.
  assert.deepEqual(availableQuantities(TYDEN), ['temp', 'precip', 'wind', 'cloud']);
  assert.deepEqual(availableQuantities(dnySeVsim(7)), VELICINY);
  assert.deepEqual(availableQuantities({ time: ['2026-01-01'], relative_humidity_2m_mean: [null] }), []);
  assert.deepEqual(availableQuantities(null), []);
  // „Od začátku" zná jen to, co server sčítá po rocích.
  assert.deepEqual(VELICINY_ROKY, ['temp', 'precip']);
  assert.ok(VELICINY_ROKY.every((v) => VELICINY.includes(v)));
});

test('🚨 každá veličina z přepínače se u archivu opravdu ptá — a víc než 13 jich není', () => {
  // Kdyby veličina v `HISTORY_DAILY` chyběla, tlačítko by se nikdy neukázalo
  // a nikdo by nevěděl proč. A každá navíc zdražuje dotaz (váha po desíti).
  const vse = Object.fromEntries(HISTORY_DAILY.map((k) => [k, [1]]));
  assert.deepEqual(availableQuantities({ time: ['2026-01-01'], ...vse }), VELICINY);
  assert.ok(HISTORY_DAILY.length <= 13, `veličin je ${HISTORY_DAILY.length}`);
  assert.equal(new Set(HISTORY_DAILY).size, HISTORY_DAILY.length);
  // UV index archiv nemá (samé null, ověřeno 6. 10. 2026) — ptát se na něj je vyhozená váha.
  assert.ok(!HISTORY_DAILY.some((k) => k.startsWith('uv_')));
});

test('souhrn pro body trasy: pocitová, vítr, vlhkost a tlak i s daty', () => {
  const s = summarizeDaily(dnySeVsim(7));
  assert.deepEqual(s.feelsMax, { value: 14, date: '2026-01-07' });
  assert.deepEqual(s.feelsMin, { value: -5, date: '2026-01-01' });
  assert.deepEqual(s.windMax, { value: 16, date: '2026-01-07' });
  assert.equal(s.humidityMean, 75);
  assert.deepEqual(s.humidityMin, { value: 60, date: '2026-01-01' });
  assert.equal(s.pressureMean, 1013);
  assert.deepEqual(s.pressureMax, { value: 1016, date: '2026-01-07' });
  // Bez údaje „nevíme", ne nula.
  assert.equal(summarizeDaily(TYDEN).humidityMean, null);
  assert.equal(summarizeDaily(TYDEN).feelsMax, null);
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
  // Průměrný roční úhrn (body trasy na „Srážky") — taky jen z celých let.
  const celeUhrny = roky.filter((r) => r.days >= 360).map((r) => r.precipSum);
  assert.ok(Math.abs(s.precipMean - celeUhrny.reduce((a, v) => a + v, 0) / celeUhrny.length) < 1e-9);
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

/* ============================================================
   POSLEDNÍCH 48 HODIN (služba `recent`)
   ============================================================ */

/** Hodiny jako ze zdroje: `od` (místní čas) a dál po hodině, `n` kusů. */
function hodiny(n, od = '2026-09-28T00:00', vyplnit = () => 1) {
  const start = Date.parse(`${od}:00Z`);
  const time = Array.from({ length: n }, (_, i) => hourIso(start + i * 3_600_000));
  const pole = Object.fromEntries(RECENT_HOURLY.map((k) => [k, time.map((_, i) => vyplnit(k, i))]));
  return { time, ...pole };
}

test('🚨 výřez: posledních 48 hodin AŽ DO TEĎ, budoucí hodiny ne', () => {
  // Zdroj pošle předevčírem až dnes celé: 72 hodin.
  const vse = hodiny(72);
  const h = recentHours(vse, '2026-09-30T10:00');
  assert.equal(h.time.length, 48);
  assert.equal(h.time[47], '2026-09-30T10:00', 'poslední je právě běžící hodina');
  assert.equal(h.time[0], '2026-09-28T11:00');
  // Všechna pole se řežou stejně, ne jen čas.
  for (const k of RECENT_HOURLY) assert.equal(h[k].length, 48, k);
  // V jednu ráno: 48 hodin pořád celých (proto dva dny zpátky).
  assert.equal(recentHours(vse, '2026-09-30T01:00').time.length, 48);
  // Teď je před začátkem dat → nic, ne celé pole.
  assert.equal(recentHours(vse, '2026-09-27T23:00').time.length, 0);
  assert.equal(recentHours(null, '2026-09-30T10:00').time.length, 0);
  assert.equal(hourIso(Date.parse('2026-09-30T10:37:12Z')), '2026-09-30T10:00');
});

test('hodiny: dotaz zná jen místo a zaokrouhlí ho jako dny', () => {
  assert.deepEqual(checkRecentQuery({ lat: '50.08331', lon: '14.41672' }), { lat: 50.08, lon: 14.42 });
  assert.throws(() => checkRecentQuery({ lat: '0', lon: '0' }));
  assert.throws(() => checkRecentQuery({ lat: 'x', lon: '14' }));
  // ⚠️ Zdroj váží po deseti veličinách — víc by dotaz zdražilo.
  assert.ok(RECENT_HOURLY.length <= 10);
});

test('katalog: služba recent ověřuje dotaz, sdílí mezipaměť a platí krátce', () => {
  assert.ok(isKnownService('recent'));
  const p = (params) => planRequest({ pathname: '/api/recent', params });
  const a = p({ lat: '50.08331', lon: '14.41672' });
  const b = p({ lat: '50.08412', lon: '14.41598', hourly: 'vsechno' });
  assert.equal(a.ok, true);
  assert.equal(a.builder, 'meteoPosledni');
  assert.equal(a.cacheKey, b.cacheKey, 'ulice sdílí odpověď a klient si nic navíc neřekne');
  assert.equal(p({ lat: '0', lon: '0' }).status, 400);
  // Každou hodinu přibude jedna — den v mezipaměti by „do teď" zestaral.
  assert.ok(a.ttlS <= 15 * 60);
});

test('každá veličina z přepínače má po hodinách svůj zdroj', () => {
  assert.deepEqual(availableHourQuantities(hodiny(3)), VELICINY);
  const bezTlaku = hodiny(3, undefined, (k) => (k === 'pressure_msl' ? null : 1));
  assert.ok(!availableHourQuantities(bezTlaku).includes('pressure'));
});

test('🚨 graf po hodinách: hodina bez údaje je „nevím", ne nula', () => {
  const h = hodiny(3, undefined, (k, i) => {
    if (i === 1) return null;
    return k === 'wind_direction_10m' ? 350 : 5;
  });
  const body = hourlySeries(h);
  assert.equal(body.length, 3);
  assert.equal(body[0].time, '2026-09-28T00:00');
  assert.equal(body[0].t, 5);
  assert.equal(body[0].windDir, 'n');
  for (const k of ['t', 'f', 'precip', 'wind', 'gust', 'humidity', 'cloud', 'pressure', 'windDir']) {
    assert.equal(body[1][k], null, k);
  }
});

test('souhrn hodin: extrémy s časem, hodiny s deštěm, tlak a kam se hnul', () => {
  const TEPLOTY = [8, 12, 19.4, 15];
  const SRAZKY = [0, 0.05, 1.2, 0.3];
  const h = hodiny(4, '2026-10-07T13:00', (k, i) => ({
    temperature_2m: TEPLOTY[i],
    apparent_temperature: TEPLOTY[i] - 2,
    precipitation: SRAZKY[i],
    snowfall: 0,
    wind_gusts_10m: [20, 38, 25, 10][i],
    wind_direction_10m: [130, 140, 135, 300][i],
    pressure_msl: [1012, 1010, 1008, 1006.2][i],
  }[k] ?? 50));
  const s = summarizeHourly(h);
  assert.equal(s.hours, 4);
  assert.deepEqual(s.tempMax, { value: 19.4, date: '2026-10-07T15:00' });
  assert.deepEqual(s.tempMin, { value: 8, date: '2026-10-07T13:00' });
  assert.equal(s.feelsMin.value, 6);
  assert.ok(Math.abs(s.precipSum - 1.55) < 1e-9);
  // 0,05 mm není měřitelný déšť — hodina s deštěm je od DESTIVA_HODINA_MM.
  assert.equal(DESTIVA_HODINA_MM, 0.1);
  assert.equal(s.rainHours, 2);
  assert.deepEqual(s.wettestHour, { value: 1.2, date: '2026-10-07T15:00' });
  assert.deepEqual(s.gustMax, { value: 38, date: '2026-10-07T14:00' });
  assert.deepEqual(s.windDir, { key: 'se', hours: 3 });
  assert.deepEqual(s.pressureNow, { value: 1006.2, date: '2026-10-07T16:00' });
  assert.ok(Math.abs(s.pressureChange.value + 5.8) < 1e-9);
  assert.equal(s.pressureChange.hours, 3);
  assert.equal(s.snowHours, 0);
});

test('souhrn hodin: bez srážek je úhrn „nevím", prázdno nedá souhrn', () => {
  const s = summarizeHourly(hodiny(2, undefined, (k) => (k === 'precipitation' ? null : 4)));
  assert.equal(s.precipSum, null, 'nula srážek by byla věrohodná lež');
  assert.equal(s.rainHours, 0);
  assert.equal(summarizeHourly({ time: [] }), null);
  assert.equal(summarizeHourly(hodiny(2, undefined, () => null)), null);
});

function fakePredpoved(zapis, posunS) {
  return async (url) => {
    const u = new URL(url);
    zapis.push(u);
    // Předevčírem až dnes, celé dny v místním čase.
    const dnes = isoDay(NYNI + posunS * 1000);
    const vse = hodiny(72, `${addDays(dnes, -2)}T00:00`);
    return { ok: true, status: 200, json: async () => ({ utc_offset_seconds: posunS, elevation: 190, hourly: vse }) };
  };
}

test('🚨 hodiny na serveru: veličiny určuje server, „teď" je v čase MÍSTA', async () => {
  const volani = [];
  const out = await stavPoslednich({
    fetchImpl: fakePredpoved(volani, 7200), base: 'https://api.open-meteo.com/v1/forecast', nowMs: NYNI,
    params: { lat: '50.08331', lon: '14.41672', hourly: 'vsechno', daily: 'x' },
  });
  assert.equal(volani.length, 1);
  const q = volani[0].searchParams;
  assert.equal(q.get('hourly'), RECENT_HOURLY.join(','));
  assert.equal(q.get('daily'), null, 'klient si nesmí říct o nic navíc');
  assert.equal(q.get('past_days'), '2');
  assert.equal(q.get('forecast_days'), '1');
  assert.equal(q.get('latitude'), '50.08');
  // 08:00 UTC = 10:00 v Praze: poslední hodina je desátá, ne osmá.
  assert.equal(out.hourly.time.length, 48);
  assert.equal(out.to, '2026-09-30T10:00');
  assert.equal(out.from, '2026-09-28T11:00');
  assert.equal(out.elevation, 190);

  // New York (UTC−4): tam jsou teprve čtyři ráno.
  const ny = await stavPoslednich({
    fetchImpl: fakePredpoved([], -14400), base: 'https://api.open-meteo.com/v1/forecast', nowMs: NYNI,
    params: { lat: '40.71', lon: '-74.01' },
  });
  assert.equal(ny.to, '2026-09-30T04:00');
  assert.equal(ny.hourly.time.length, 48);
});

test('hodiny na serveru: vadné místo se ven nepošle, chyba zdroje nese stav', async () => {
  const volani = [];
  await assert.rejects(stavPoslednich({
    fetchImpl: fakePredpoved(volani, 0), base: 'https://x', nowMs: NYNI, params: { lat: '0', lon: '0' },
  }));
  assert.equal(volani.length, 0);
  const f = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(
    stavPoslednich({ fetchImpl: f, base: 'https://x', nowMs: NYNI, params: { lat: '50', lon: '14' } }),
    (e) => e.status === 429,
  );
});

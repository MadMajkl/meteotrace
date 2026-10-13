/**
 * Samotest hlídané cesty (`web/lib/route-watch.js`, `R41`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  vzorkyCesty, bodyDoDotazu, bodyZDotazu, planZVzorku, textCesty, dnyPredpovedi,
  minutyZCasu, cistaCesta, platneCesty, dnyText, MAX_BODU, KROK_M,
} from '../web/lib/route-watch.js';
import { planRoute, cumulativeDistances } from '../web/lib/eta.js';
import { METRIC } from '../web/lib/units.js';

const H = 3600000;
// 13. 10. 2026 06:00 UTC = 08:00 v Praze (posun +2 h).
const START = Date.UTC(2026, 9, 13, 0, 0);
const POSUN_S = 7200;

/**
 * Trasa ~50 km po poledníku, hodina jízdy: prvních 20 km městem (půl hodiny),
 * zbytek po silnici (druhá půlhodina). ⚠️ Délka se POČÍTÁ z geometrie —
 * `sampleRoute` měří body po čáře, a vymyšlené číslo by se s ní rozešlo.
 */
const BODY = [[49.5, 13], [49.68, 13], [49.95, 13]];
const DELKA = cumulativeDistances(BODY).at(-1);
const TRASA = {
  points: BODY,
  totalDistanceM: DELKA,
  totalDurationS: 3600,
  legs: [{ distanceM: 20000, durationS: 1800 }, { distanceM: DELKA - 20000, durationS: 1800 }],
};

/** Open-Meteo pro body: 48 hodin od START, hodnoty z funkce (bod, hodina). */
function predpoved(pocet, hodnota) {
  return Array.from({ length: pocet }, (_, b) => {
    const time = [];
    const H2 = { temperature_2m: [], apparent_temperature: [], precipitation_probability: [], precipitation: [],
      weather_code: [], wind_speed_10m: [], wind_gusts_10m: [], wind_direction_10m: [],
      cloud_cover_low: [], cloud_cover_mid: [], cloud_cover_high: [] };
    for (let h = 0; h < 48; h++) {
      // Čas bez pásma, místní (`+2 h`).
      time.push(new Date(START + h * H + POSUN_S * 1000).toISOString().slice(0, 16));
      const v = { teplota: 5, pst: 0, kod: 1, vitr: 10, naraz: 15, ...hodnota(b, h) };
      H2.temperature_2m.push(v.teplota);
      H2.apparent_temperature.push(v.teplota);
      H2.precipitation_probability.push(v.pst);
      H2.precipitation.push(v.pst > 50 ? 2 : 0);
      H2.weather_code.push(v.kod);
      H2.wind_speed_10m.push(v.vitr);
      H2.wind_gusts_10m.push(v.naraz);
      H2.wind_direction_10m.push(270);
      H2.cloud_cover_low.push(50); H2.cloud_cover_mid.push(0); H2.cloud_cover_high.push(0);
    }
    return { utc_offset_seconds: POSUN_S, elevation: 400, hourly: { time, ...H2 } };
  });
}

// Odjezd v 07:15 místního = 05:15 UTC.
const ODJEZD = START + 5 * H + 15 * 60000;
const TED = ODJEZD - 60 * 60000;   // upozornění hodinu předem

test('body cesty: čas od odjezdu podle rychlostního profilu, ne úměrou', () => {
  const v = vzorkyCesty(TRASA);
  assert.equal(v[0].s, 0);
  assert.equal(v[v.length - 1].m, Math.round(DELKA));
  assert.equal(v[v.length - 1].s, 3600);
  // 10 km = půlka prvního úseku (20 km za 30 min) → 15 min, ne 12 min úměrou.
  const deset = v.find((b) => b.m === KROK_M);
  assert.equal(deset.s, 900);
  // Shoduje se s plánem obrazovky trasy.
  const plan = planRoute({ ...TRASA, departureMs: 0, stepM: KROK_M });
  assert.deepEqual(v.map((b) => b.s), plan.points.map((p) => Math.round(p.etaMs / 1000)));
});

test('dlouhá cesta se vejde celá — krok se prodlouží, konec se neuřízne', () => {
  const dlouha = { ...TRASA, totalDistanceM: 600000, totalDurationS: 6 * 3600, legs: [],
    points: [[50, 12], [50, 20.4]] };
  const v = vzorkyCesty(dlouha);
  assert.ok(v.length <= MAX_BODU);
  assert.ok(v[v.length - 1].m > 590000, 'cíl musí být mezi body');
});

test('body tam a zpátky přes dotaz', () => {
  const v = vzorkyCesty(TRASA);
  assert.deepEqual(bodyZDotazu(bodyDoDotazu(v)), v);
});

test('🚨 vadný seznam bodů padne CELÝ', () => {
  const dobre = bodyDoDotazu(vzorkyCesty(TRASA));
  for (const zly of ['', '49.5,12.9,0,0', `${dobre};0,0,9999,99999`, dobre.replace(/^49\.5/, 'x'),
    '49.53,12.94,600,1000;49.6,13.1,300,20000', '49.53,12.94,0,0;49.6,13.1,999999,20000']) {
    assert.equal(bodyZDotazu(zly), null, `prošlo: ${zly}`);
  }
});

test('klid: „po celé cestě sucho" s rozsahem teplot', () => {
  const v = vzorkyCesty(TRASA);
  const r = textCesty({ forecast: predpoved(v.length, () => ({})), vzorky: v, odjezdMs: ODJEZD,
    nowMs: TED, lang: 'cs', units: METRIC });
  assert.equal(r.hrozba, false);
  assert.match(r.text, /^Odjezd v 07:15: po celé cestě sucho, 5 °C\.$/);
  assert.equal(r.lepsiMs, null);
});

test('🚨 časy ve větě jsou v pásmu TELEFONU, když ho obal pošle', () => {
  // Emulátor 13. 10. 2026: telefon v GMT, cesta v Česku. Odjezd zadaný na
  // 05:15 (telefon) se ve větě objevil jako „07:15" — pásmo místa.
  const v = vzorkyCesty(TRASA);
  const fc = predpoved(v.length, () => ({}));
  const r = textCesty({ forecast: fc, vzorky: v, odjezdMs: ODJEZD, nowMs: TED, lang: 'cs', units: METRIC, posunMin: 0 });
  assert.match(r.text, /^Odjezd v 05:15:/);
  // Nesmyslný posun → pásmo místa, ne „Odjezd v NaN".
  const s = textCesty({ forecast: fc, vzorky: v, odjezdMs: ODJEZD, nowMs: TED, lang: 'cs', units: METRIC, posunMin: 5000 });
  assert.match(s.text, /^Odjezd v 07:15:/);
});

test('klid a „jen když něco hrozí" = mlčí', () => {
  const v = vzorkyCesty(TRASA);
  const r = textCesty({ forecast: predpoved(v.length, () => ({})), vzorky: v, odjezdMs: ODJEZD,
    nowMs: TED, lang: 'cs', units: METRIC, jenHrozba: true });
  assert.equal(r.text, null);
});

test('🚨 sněžení v půlce cesty + rada vyrazit dřív, když dřív nesněží', () => {
  const v = vzorkyCesty(TRASA);
  // Sněží od 08:00 místního (06:00 UTC) dál na bodech 20–30 km. Při odjezdu
  // v 07:15 jsou tam kolem 07:45–07:55 (hodina 08:00) = sněží; při odjezdu
  // v 06:45 kolem 07:15–07:25 (hodina 07:00) = ještě ne.
  const fc = predpoved(v.length, (b, h) => (b >= 2 && b <= 3 && h >= 6 ? { kod: 73, teplota: -1, pst: 80 } : {}));
  const r = textCesty({ forecast: fc, vzorky: v, odjezdMs: ODJEZD, nowMs: TED, lang: 'cs', units: METRIC });
  assert.equal(r.hrozba, true);
  assert.match(r.text, /^Odjezd v 07:15: kolem 07:45 sněžení \([−-]1 °C\)\./);
  assert.match(r.text, / Vyjeď v 06:45 a mineš to\.$/);
  assert.equal(r.lepsiMs, ODJEZD - 30 * 60000);
});

test('rada nikdy do minulosti: dřív než upozornění + 5 min se neradí', () => {
  const v = vzorkyCesty(TRASA);
  const fc = predpoved(v.length, (b, h) => (b >= 2 && b <= 3 && h >= 6 ? { kod: 73, teplota: -1, pst: 80 } : {}));
  // Upozornění přišlo pozdě — deset minut před odjezdem.
  const r = textCesty({ forecast: fc, vzorky: v, odjezdMs: ODJEZD, nowMs: ODJEZD - 10 * 60000, lang: 'cs', units: METRIC });
  assert.ok(!/Vyjeď v 06:/.test(r.text), r.text);
});

test('déšť: počet míst po cestě a rozsah teplot', () => {
  const v = vzorkyCesty(TRASA);
  const fc = predpoved(v.length, (b) => (b === 0 ? { pst: 70, kod: 61 } : {}));
  const r = textCesty({ forecast: fc, vzorky: v, odjezdMs: ODJEZD, nowMs: TED, lang: 'cs', units: METRIC });
  assert.match(r.text, new RegExp(`^Odjezd v 07:15: déšť na 1 z ${v.length} míst po cestě, 5 °C\\.`));
});

test('silný vítr bez jevu se hlásí jako vítr', () => {
  const v = vzorkyCesty(TRASA);
  const fc = predpoved(v.length, () => ({ vitr: 65, naraz: 90 }));
  const r = textCesty({ forecast: fc, vzorky: v, odjezdMs: ODJEZD, nowMs: TED, lang: 'en', units: METRIC });
  assert.match(r.text, /^Leaving at 07:15: strong wind on the way, up to 90 km\/h\.$/);
});

test('🚨 předpověď, která nesedí na body, nebo je krátká → mlčí, netvrdí „sucho"', () => {
  const v = vzorkyCesty(TRASA);
  assert.equal(textCesty({ forecast: predpoved(v.length - 1, () => ({})), vzorky: v, odjezdMs: ODJEZD,
    nowMs: TED, lang: 'cs', units: METRIC }).text, null);
  // Odjezd za obzorem předpovědi (48 h od START).
  assert.equal(textCesty({ forecast: predpoved(v.length, () => ({})), vzorky: v, odjezdMs: START + 50 * H,
    nowMs: START + 49 * H, lang: 'cs', units: METRIC }).text, null);
});

test('plán z bodů nese časy příjezdu a index hodiny', () => {
  const v = vzorkyCesty(TRASA);
  const hourMs = Array.from({ length: 48 }, (_, h) => START + h * H);
  const p = planZVzorku(v, ODJEZD, hourMs);
  assert.equal(p.points[0].etaMs, ODJEZD);
  assert.equal(p.arrivalMs, ODJEZD + 3600000);
  assert.equal(p.points[0].hourIndex, 5);
  assert.equal(p.beyondForecast, false);
});

test('dnů předpovědi: aspoň dva, nejvýš šestnáct', () => {
  const v = vzorkyCesty(TRASA);
  assert.equal(dnyPredpovedi(v, ODJEZD, TED), 2);
  assert.equal(dnyPredpovedi(v, ODJEZD + 5 * 86400000, TED), 7);
});

test('čas odjezdu a nastavení cesty se čistí', () => {
  assert.equal(minutyZCasu('07:15'), 435);
  assert.equal(minutyZCasu('7:05'), 425);
  for (const zly of ['24:00', '7:60', 'ráno', '', null]) assert.equal(minutyZCasu(zly), null);

  const body = bodyDoDotazu(vzorkyCesty(TRASA));
  assert.deepEqual(cistaCesta({ cas: '7:15', dny: [5, 1, 1, 9], jen: 1, body }),
    { cas: '07:15', dny: [1, 5], jen: false, body });
  assert.equal(cistaCesta({ cas: '07:15', dny: [], body }), null, 'bez dnů se nehlídá');
  assert.equal(cistaCesta({ cas: '07:15', dny: [1], body: 'x' }), null);
});

test('smazaná trasa se přestane hlídat', () => {
  const body = bodyDoDotazu(vzorkyCesty(TRASA));
  const cesty = { a: { cas: '07:15', dny: [1], body }, b: { cas: '16:00', dny: [5], body } };
  assert.deepEqual(Object.keys(platneCesty({ routes: [{ key: 'a' }] }, cesty)), ['a']);
});

test('dny jako krátký text', () => {
  assert.equal(dnyText([1, 2, 3, 4, 5], 'cs'), 'Po–Pá');
  assert.equal(dnyText([1, 2, 3, 4, 5, 6, 7], 'cs'), 'každý den');
  assert.equal(dnyText([6, 7], 'cs'), 'So, Ne');
  assert.equal(dnyText([1, 3, 5], 'en'), 'Mon, Wed, Fri');
});

/* ============================================================
   SERVER
   ============================================================ */

import { readFileSync } from 'node:fs';
import { stavCestu } from '../server/route-watch.js';
import { planRequest } from '../web/lib/proxy-core.js';
import { UPSTREAMS } from '../web/lib/upstreams.js';

const ZDROJ = 'https://api.open-meteo.com/v1/forecast';

test('stavitel se zeptá na všechny body jedním dotazem a vrátí větu', async () => {
  const v = vzorkyCesty(TRASA);
  const dotazy = [];
  const f = async (url) => {
    dotazy.push(url);
    return { ok: true, json: async () => predpoved(v.length, () => ({})) };
  };
  const r = await stavCestu({ fetchImpl: f, base: ZDROJ, nowMs: TED,
    params: new URLSearchParams({ body: bodyDoDotazu(v), odjezd: String(ODJEZD), lang: 'cs', units: 'metric' }) });
  assert.equal(dotazy.length, 1, 'jeden dotaz na celou cestu');
  const u = new URL(dotazy[0]);
  assert.equal(u.searchParams.get('latitude').split(',').length, v.length);
  assert.match(u.searchParams.get('hourly'), /weather_code/);
  assert.match(r.text, /^Odjezd v 07:15: po celé cestě sucho/);
});

test('stavitel mlčí u vadných bodů a u odjezdu mimo rozsah — a nesahá ven', async () => {
  const v = vzorkyCesty(TRASA);
  let ven = 0;
  const f = async () => { ven++; return { ok: true, json: async () => ({}) }; };
  for (const params of [
    { body: 'x', odjezd: String(ODJEZD) },
    { body: bodyDoDotazu(v), odjezd: String(TED - 3 * H) },
    { body: bodyDoDotazu(v), odjezd: String(TED + 5 * 86400000) },
    { body: bodyDoDotazu(v) },
  ]) {
    const r = await stavCestu({ fetchImpl: f, base: ZDROJ, nowMs: TED, params });
    assert.equal(r.text, null, JSON.stringify(params));
  }
  assert.equal(ven, 0);
});

test('proxy: vadné body cesty jsou 400, ne „zdroj neodpověděl"', () => {
  const zly = planRequest({ pathname: '/api/cesta', params: { body: '0,0,0,0;1,1,1,1', odjezd: '1' } });
  assert.equal(zly.ok, false);
  assert.equal(zly.status, 400);
  const dobry = planRequest({ pathname: '/api/cesta',
    params: { body: bodyDoDotazu(vzorkyCesty(TRASA)), odjezd: String(ODJEZD + 20000), lang: 'cs' } });
  assert.equal(dobry.ok, true);
  assert.equal(dobry.builder, 'meteoCesta');
  // Odjezd zaokrouhlený na minutu je v klíči cache — dva dotazy na tutéž
  // cestu v rámci minuty sdílí záznam.
  const druhy = planRequest({ pathname: '/api/cesta',
    params: { body: bodyDoDotazu(vzorkyCesty(TRASA)), odjezd: String(ODJEZD + 10000), lang: 'cs' } });
  assert.equal(druhy.cacheKey, dobry.cacheKey);
});

test('🚨 každý stavitel z katalogu je zapojený na Netlify i ve vývojovém serveru', () => {
  // Chybějící stavitel se pozná až za běhu („Chybí stavitel …") — a jen na
  // tom ze dvou serverů, kde chybí. Vývojový server by fungoval a ostrý ne.
  const stavitele = [...new Set(Object.values(UPSTREAMS).map((u) => u.builder).filter(Boolean))];
  assert.ok(stavitele.includes('meteoCesta'));
  for (const soubor of ['netlify/functions/api.js', 'tools/dev-server.mjs']) {
    const kod = readFileSync(new URL(`../${soubor}`, import.meta.url), 'utf8');
    const radek = /builders: \{([^}]*)\}/.exec(kod)?.[1] || '';
    for (const s of stavitele) {
      assert.ok(radek.split(',').some((c) => c.trim().startsWith(`${s}:`)), `${soubor}: chybí stavitel ${s}`);
    }
  }
});

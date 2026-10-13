/**
 * Samotest „Kdy ven" (`web/lib/best-window.js`, `R43`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hodinyZPredpovedi, nejlepsiOkno, skoreHodiny, textOkna, kvalita, AKTIVITY,
} from '../web/lib/best-window.js';
import { METRIC } from '../web/lib/units.js';

const H = 3600000;
const POSUN = 7200;                                  // Praha v létě, +2 h
const PULNOC = Date.UTC(2026, 9, 13, 22, 0);         // 14. 10. 00:00 místního
const TZ = 'Europe/Prague';

/** Open-Meteo na tři dny od místní půlnoci; počasí z funkce (hodina od půlnoci). */
function predpoved(pocasi = () => ({})) {
  const time = []; const Hh = {
    temperature_2m: [], apparent_temperature: [], precipitation_probability: [], precipitation: [],
    weather_code: [], wind_speed_10m: [], wind_gusts_10m: [],
  };
  for (let h = 0; h < 72; h++) {
    time.push(new Date(PULNOC + h * H + POSUN * 1000).toISOString().slice(0, 16));
    const v = { teplota: 16, pst: 0, srazky: 0, kod: 1, vitr: 8, naraz: 15, ...pocasi(h) };
    Hh.temperature_2m.push(v.teplota);
    Hh.apparent_temperature.push(v.pocit ?? v.teplota);
    Hh.precipitation_probability.push(v.pst);
    Hh.precipitation.push(v.srazky);
    Hh.weather_code.push(v.kod);
    Hh.wind_speed_10m.push(v.vitr);
    Hh.wind_gusts_10m.push(v.naraz);
  }
  const dny = ['2026-10-14', '2026-10-15', '2026-10-16'];
  return {
    utc_offset_seconds: POSUN, timezone: TZ,
    hourly: { time, ...Hh },
    daily: { time: dny, sunrise: dny.map((d) => `${d}T07:00`), sunset: dny.map((d) => `${d}T18:30`) },
  };
}

const RANO = PULNOC + 6 * H + 10 * 60000;   // 14. 10. 06:10 místního

test('za světla: hodiny před východem a po západu slunce se nepočítají', () => {
  const hodiny = hodinyZPredpovedi(predpoved());
  assert.equal(hodiny[6].den, false, '06:00–07:00 je tma');
  assert.equal(hodiny[7].den, true);
  assert.equal(hodiny[18].den, false, 'polovina hodiny 18–19 je po západu (18:30)');
});

test('za dobrého počasí vyhrává nejbližší okno — kolo 07:00–09:00', () => {
  const o = nejlepsiOkno(hodinyZPredpovedi(predpoved()), 'kolo', RANO);
  assert.equal(o.start, PULNOC + 7 * H);
  assert.equal(o.konec, PULNOC + 9 * H);
  assert.equal(kvalita(o.skore), 'skvele');
});

test('🚨 hodina deště uprostřed okno pokazí celé; vybere se jiné', () => {
  // Prší 8–9 a 13–14; jinak hezky.
  const fc = predpoved((h) => (h === 8 || h === 13 ? { pst: 80, srazky: 1.2, kod: 61 } : {}));
  const o = nejlepsiOkno(hodinyZPredpovedi(fc), 'kolo', RANO);
  assert.equal(o.start, PULNOC + 9 * H, 'první dvouhodinovka bez deště je 9–11');
});

test('chladné ráno, teplejší odpoledne → okno odpoledne, ne hned', () => {
  // Pocitově 2 °C do jedenácti, pak 18 °C.
  const fc = predpoved((h) => ((h % 24) < 11 ? { teplota: 4, pocit: 2 } : {}));
  const o = nejlepsiOkno(hodinyZPredpovedi(fc), 'kolo', RANO);
  assert.equal(o.start, PULNOC + 11 * H);
  // Na běh je 2 °C v mezích — ale 18 °C je mimo ideál (5–17), takže taky
  // nemusí vyhrát ráno. Vyhrává skóre, ne pořadí.
  assert.ok(nejlepsiOkno(hodinyZPredpovedi(fc), 'beh', RANO).start);
});

test('🚨 nic se nenašlo → řekne se PROČ, ne prázdno', () => {
  const zima = nejlepsiOkno(hodinyZPredpovedi(predpoved(() => ({ teplota: -12, pocit: -15 }))), 'kolo', RANO);
  assert.deepEqual(zima, { nic: true, proc: 'zima' });
  const vitr = nejlepsiOkno(hodinyZPredpovedi(predpoved(() => ({ vitr: 50, naraz: 80 }))), 'kolo', RANO);
  assert.equal(vitr.proc, 'vitr');
  const dest = nejlepsiOkno(hodinyZPredpovedi(predpoved(() => ({ pst: 90, srazky: 3, kod: 63 }))), 'prochazka', RANO);
  assert.equal(dest.proc, 'dest');
  assert.equal(nejlepsiOkno([], 'kolo', RANO).proc, 'data');
  assert.match(textOkna(zima, { lang: 'cs', units: METRIC, timeZone: TZ, nowMs: RANO }), /moc zima/);
});

test('okno, které už běží, se nenabízí — od příští celé hodiny', () => {
  const o = nejlepsiOkno(hodinyZPredpovedi(predpoved()), 'beh', PULNOC + 10 * H + 20 * 60000);
  assert.equal(o.start, PULNOC + 11 * H);
});

test('věta: den, čas od–do, sucho / déšť %, pocitová teplota a vítr', () => {
  const o = nejlepsiOkno(hodinyZPredpovedi(predpoved()), 'kolo', RANO);
  assert.equal(textOkna(o, { lang: 'cs', units: METRIC, timeZone: TZ, nowMs: RANO }),
    'Dnes 07:00–09:00 · sucho, pocitově 16 °C, vítr do 8 km/h');
  // Zítra a s mírnou šancí na déšť.
  const fc = predpoved((h) => (h < 24 ? { pst: 90, srazky: 2, kod: 61 } : { pst: 20 }));
  const z = nejlepsiOkno(hodinyZPredpovedi(fc), 'kolo', RANO);
  assert.match(textOkna(z, { lang: 'en', units: METRIC, timeZone: TZ, nowMs: RANO }),
    /^Tomorrow 07:00–09:00 · rain 20%, feels 16 °C, wind up to 8 km\/h$/);
});

test('skóre: ideál 100, vítr a chlad ubírají, za mezí nula', () => {
  const p = AKTIVITY.kolo;
  const ideal = { den: true, kod: 1, pocit: 18, pst: 0, srazky: 0, vitr: 5, naraz: 10 };
  assert.equal(skoreHodiny(ideal, p).skore, 100);
  assert.ok(skoreHodiny({ ...ideal, vitr: 25 }, p).skore < 100);
  assert.ok(skoreHodiny({ ...ideal, pocit: 6 }, p).skore < skoreHodiny({ ...ideal, pocit: 10 }, p).skore);
  assert.deepEqual(skoreHodiny({ ...ideal, den: false }, p), { skore: 0, proc: 'tma' });
  assert.deepEqual(skoreHodiny({ ...ideal, kod: 95 }, p), { skore: 0, proc: 'jev' });
  assert.deepEqual(skoreHodiny({ ...ideal, naraz: 60 }, p), { skore: 0, proc: 'vitr' });
});

test('rozsah teplot: „4 až 7 °C", ale jedno číslo, když se zaokrouhlené shodují', async () => {
  const { formatTempRange, IMPERIAL } = await import('../web/lib/units.js');
  const { tf } = await import('../web/lib/i18n.js');
  assert.equal(formatTempRange(4, 7, METRIC, 'cs', tf), '4 až 7 °C');
  assert.equal(formatTempRange(4.6, 5.2, METRIC, 'cs', tf), '5 °C', 'shoda až po zaokrouhlení');
  assert.equal(formatTempRange(10, 10.2, IMPERIAL, 'en', tf), '50 °F', 'a až po převodu jednotek');
});

/**
 * Vzorky obsahu widgetu pro ladicí náhled v obalu (`R29`).
 *
 *     node tools/widget-vzorky.mjs
 *
 * Vyrobí `android/app/src/debug/assets/widget-vzorky.json` — obsah widgetu
 * pro různé počasí (den, noc, déšť, bouřka, sníh…), a to SKUTEČNOU funkcí
 * `widgetModel()`, kterou volá server. Ladicí obrazovka `NahledWidgetu`
 * je pak vykreslí přes tytéž `RemoteViews` jako widget na ploše.
 *
 * ⚠️ Proto ne ručně psaný JSON: ten by za měsíc ukazoval něco, co server
 * neposílá — a náhled by chválil vzhled, který na ploše nikdy nebude.
 *
 * ⚠️ Jen do LADICÍHO sestavení (`src/debug/`). Do balíčku pro Play nepatří.
 */

'use strict';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { widgetModel } from '../web/lib/widget.js';
import { METRIC } from '../web/lib/units.js';

const zde = dirname(fileURLToPath(import.meta.url));
const CIL = join(zde, '..', 'android', 'app', 'src', 'debug', 'assets', 'widget-vzorky.json');

const POSUN = 7200;                                  // Praha v září
const poledne = Date.UTC(2026, 8, 20, 10, 20);      // 12:20
const noc = Date.UTC(2026, 8, 20, 20, 40);          // 22:40

/** Dva dny po hodinách; `hodina(i)` přepíše hodnoty pro index 0–47. */
function predpoved({ hodina = () => ({}), current = {}, kod = 0, max = 21, min = 9 } = {}) {
  const H = {
    time: [], temperature_2m: [], apparent_temperature: [], relative_humidity_2m: [],
    precipitation_probability: [], precipitation: [], weather_code: [], cloud_cover: [],
    wind_speed_10m: [], wind_direction_10m: [], uv_index: [],
    cloud_cover_low: [], cloud_cover_mid: [], cloud_cover_high: [],
    direct_radiation: [], shortwave_radiation: [],
  };
  for (let i = 0; i < 48; i += 1) {
    const h = i % 24;
    const den = i < 24 ? '2026-09-20' : '2026-09-21';
    const teplo = min + (max - min) * Math.max(0, Math.sin(((h - 6) / 24) * Math.PI * 2));
    const z = {
      temperature_2m: teplo, apparent_temperature: teplo - 1.5, relative_humidity_2m: 70,
      precipitation_probability: 5, precipitation: 0, weather_code: kod, cloud_cover: 10,
      wind_speed_10m: 8, wind_direction_10m: 240, uv_index: 2,
      cloud_cover_low: 0, cloud_cover_mid: 0, cloud_cover_high: 5,
      direct_radiation: h > 7 && h < 18 ? 400 : 0, shortwave_radiation: h > 7 && h < 18 ? 500 : 0,
      ...hodina(i),
    };
    H.time.push(`${den}T${String(h).padStart(2, '0')}:00`);
    for (const k of Object.keys(z)) H[k].push(z[k]);
  }
  return {
    utc_offset_seconds: POSUN, timezone: 'Europe/Prague', elevation: 350,
    current: {
      temperature_2m: 17.4, apparent_temperature: 16.1, weather_code: kod,
      cloud_cover_low: 0, cloud_cover_mid: 0, cloud_cover_high: 5,
      direct_radiation: 420, shortwave_radiation: 520,
      ...current,
    },
    hourly: H,
    daily: {
      time: ['2026-09-20', '2026-09-21'], weather_code: [kod, 3],
      temperature_2m_max: [max, 17], temperature_2m_min: [min, 7],
      precipitation_probability_max: [10, 40],
      sunrise: ['2026-09-20T06:50', '2026-09-21T06:51'],
      sunset: ['2026-09-20T19:10', '2026-09-21T19:08'],
    },
  };
}

const prsi = (od, do_) => (i) => (i >= od && i <= do_ ? { precipitation_probability: 90, precipitation: 1.5, weather_code: 63 } : {});

const SCENARE = [
  ['Jasno, poledne', 'Praha', predpoved(), poledne],
  ['Slunce přes závoj, dlouhý popis', 'Horšovský Týn', predpoved({
    kod: 3, current: { weather_code: 3, cloud_cover_mid: 5, cloud_cover_high: 100, direct_radiation: 300 },
  }), poledne],
  ['Déšť odpoledne', 'Plzeň', predpoved({ kod: 2, hodina: prsi(15, 17), current: { weather_code: 2, cloud_cover_low: 50 } }), poledne],
  ['Prší a nepřestane', 'Brno', predpoved({ kod: 63, max: 12, min: 8, hodina: prsi(0, 47), current: { weather_code: 63, temperature_2m: 10.6, apparent_temperature: 8.2 } }), poledne],
  ['Bouřka', 'České Budějovice', predpoved({ kod: 95, hodina: prsi(12, 14), current: { weather_code: 95, temperature_2m: 24.3, apparent_temperature: 26 } }), poledne],
  ['Jasná noc', 'Moje poloha', predpoved(), noc],
  ['Sníh', 'Špindlerův Mlýn', predpoved({
    kod: 73, max: 1, min: -6,
    hodina: (i) => (i <= 15 ? { precipitation_probability: 85, precipitation: 0.8, weather_code: 73 } : { weather_code: 3 }),
    current: { weather_code: 73, temperature_2m: -3.2, apparent_temperature: -8 },
  }), poledne],
  ['Mlha', 'Ústí nad Labem', predpoved({ kod: 45, current: { weather_code: 45, cloud_cover_low: 100, direct_radiation: 0 } }), poledne],
  // ⚠️ Poslední a anglicky: z něj se dělá obrázek náhledu pro výběr widgetů
  // na Androidu < 12 (`--ez export true`). Obrázek je jeden pro všechny
  // jazyky systému, tak v referenčním jazyce appky.
  ['Preview (EN)', 'Prague', predpoved({
    kod: 2, hodina: prsi(16, 18),
    current: { weather_code: 2, cloud_cover_low: 40, cloud_cover_mid: 30, direct_radiation: 150 },
  }), poledne, 'en'],
];

const vzorky = SCENARE.map(([nazev, misto, forecast, nowMs, lang = 'cs']) => ({
  nazev,
  misto,
  // Obsah se stavěl „v minulosti" (20. 9. 2026); ladicí obrazovka ho posune
  // do teď, aby obal hodiny nezahodil jako uplynulé.
  posunoutDoTed: true,
  data: widgetModel({ forecast, lang, units: METRIC, nowMs }),
}));

mkdirSync(dirname(CIL), { recursive: true });
writeFileSync(CIL, JSON.stringify(vzorky, null, 1), 'utf8');
console.log(`${vzorky.length} vzorků → ${CIL}`);
for (const v of vzorky) console.log(`  ${v.nazev.padEnd(34)} ${v.data.teplota.padEnd(5)} ${v.data.ikona}  ${v.data.popis} · ${v.data.veta}`);

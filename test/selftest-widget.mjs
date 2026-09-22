/**
 * Samotest widgetu na ploše (`R29`).
 *
 * Spuštění:  npm run selftest:logic
 *
 * 🚨 Nejcennější kontrola tu není o vzhledu, ale o tom, že WIDGET ŘÍKÁ TOTÉŽ
 * CO METEOSTANICE. Dvě místa, která popisují totéž počasí, se rozejdou při
 * první opravě jednoho z nich — a uživatel pak vidí „Zataženo" na ploše
 * a „Slunce přes závoj" v appce a nevěří ani jednomu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { widgetModel, skyKey, SKY, WIDGET_PARAMS, WIDGET_HOURS } from '../web/lib/widget.js';
import { buildStationView } from '../web/lib/station.js';
import { METRIC, IMPERIAL, formatTempShort } from '../web/lib/units.js';
import { stavWidget } from '../server/widget.js';
import { UPSTREAMS } from '../web/lib/upstreams.js';

/** Praha v září: +2 h. */
const POSUN = 7200;
/** 20. 9. 2026 ve 12:20 pražského času. */
const TED = Date.UTC(2026, 8, 20, 10, 20);

/**
 * Odpověď Open-Meteo na dva dny po hodinách, v místním čase bez pásma.
 * `hodina(i)` dostane index 0–47 (0 = dnešní půlnoc) a vrátí přepsané hodnoty.
 */
function predpoved({ hodina = () => ({}), current = {}, max = 19, min = 8 } = {}) {
  const H = {
    time: [], temperature_2m: [], apparent_temperature: [], relative_humidity_2m: [],
    precipitation_probability: [], precipitation: [], weather_code: [], cloud_cover: [],
    wind_speed_10m: [], wind_direction_10m: [], uv_index: [],
    cloud_cover_low: [], cloud_cover_mid: [], cloud_cover_high: [],
    direct_radiation: [], shortwave_radiation: [],
  };
  for (let i = 0; i < 48; i += 1) {
    const den = i < 24 ? '2026-09-20' : '2026-09-21';
    const h = String(i % 24).padStart(2, '0');
    const zaklad = {
      temperature_2m: 10 + (i % 24) / 3, apparent_temperature: 9 + (i % 24) / 3,
      relative_humidity_2m: 70, precipitation_probability: 5, precipitation: 0,
      weather_code: 0, cloud_cover: 5, wind_speed_10m: 8, wind_direction_10m: 240, uv_index: 2,
      cloud_cover_low: 0, cloud_cover_mid: 0, cloud_cover_high: 5,
      direct_radiation: 400, shortwave_radiation: 500,
      ...hodina(i),
    };
    H.time.push(`${den}T${h}:00`);
    for (const k of Object.keys(zaklad)) H[k]?.push(zaklad[k]);
  }
  return {
    utc_offset_seconds: POSUN,
    timezone: 'Europe/Prague',
    elevation: 350,
    current: {
      temperature_2m: 14.2, apparent_temperature: 12.6, weather_code: 0,
      cloud_cover_low: 0, cloud_cover_mid: 0, cloud_cover_high: 5,
      direct_radiation: 420, shortwave_radiation: 520,
      ...current,
    },
    hourly: H,
    daily: {
      time: ['2026-09-20', '2026-09-21'],
      weather_code: [0, 3],
      temperature_2m_max: [max, 17],
      temperature_2m_min: [min, 7],
      precipitation_probability_max: [10, 40],
      sunrise: ['2026-09-20T06:50', '2026-09-21T06:51'],
      sunset: ['2026-09-20T19:10', '2026-09-21T19:08'],
    },
  };
}

const model = (f, a = {}) => widgetModel({ forecast: f, lang: 'cs', units: METRIC, nowMs: TED, ...a });

/* ── co se ukazuje ──────────────────────────────────────────────────── */

test('jasné poledne: krátká teplota, max/min, pocitovka a jasné denní nebe', () => {
  const w = model(predpoved());
  assert.equal(w.teplota, '14°');
  assert.equal(w.pocitove, 'Pocitově 13°');
  assert.equal(w.maxMin, '↑19°  ↓8°');
  assert.deepEqual(w.pozadi, SKY.jasnoDen);
  assert.equal(w.v, 1);
  assert.equal(w.vydano, TED);
});

test('hodiny začínají PŘÍŠTÍ hodinou a je jich dvanáct (obal zahodí uplynulé)', () => {
  const w = model(predpoved());
  assert.equal(w.hodiny.length, WIDGET_HOURS);
  assert.equal(w.hodiny[0].cas, '13:00', 'aktuální hodina je velké číslo, do pruhu nepatří');
  assert.equal(w.hodiny[0].ms, Date.UTC(2026, 8, 20, 11, 0));
  // Přes půlnoc to pokračuje dál — dvanáct hodin od 13:00 končí v 00:00.
  assert.equal(w.hodiny.at(-1).cas, '00:00');
  for (const h of w.hodiny) assert.match(h.teplota, /^-?\d+°$/);
});

test('🚨 widget říká totéž co meteostanice — ikona i slovo', () => {
  // Slunce přes závoj: jen vysoká oblačnost, záření prochází. Tady se
  // rozejdou dva nezávislé výběry nejdřív (`jenZavoj()`).
  const f = predpoved({
    current: { weather_code: 3, cloud_cover_low: 0, cloud_cover_mid: 5, cloud_cover_high: 100, direct_radiation: 300, shortwave_radiation: 520 },
  });
  const w = model(f);
  const v = buildStationView({ forecast: f, lang: 'cs', units: METRIC, nowMs: TED });
  assert.equal(w.popis, v.current.condition);
  assert.equal(w.ikona, v.current.icon);
  assert.notEqual(w.popis, 'Zataženo', 'zataženo jen vysoko NENÍ zataženo');
  assert.deepEqual(w.pozadi, SKY.jasnoDen, 'a nebe se řídí týmž slovem');
});

test('bez teploty není co ukázat — žádné velké „—" na ploše', () => {
  const f = predpoved({ hodina: () => ({ temperature_2m: null }), current: { temperature_2m: null } });
  assert.equal(model(f), null);
  assert.equal(model(null), null);
  assert.equal(model({}), null);
});

test('mínus nula se nepíše a °F z nastavení platí i na widgetu', () => {
  assert.equal(formatTempShort(-0.3, METRIC, 'cs'), '0°');
  const w = model(predpoved(), { units: IMPERIAL, lang: 'en' });
  assert.equal(w.teplota, '58°', '14,2 °C = 57,6 °F');
  assert.equal(w.pocitove, 'Feels 55°');
});

/* ── věta o dešti ───────────────────────────────────────────────────── */

test('déšť za tři hodiny: „Od 15:00 déšť"', () => {
  const f = predpoved({ hodina: (i) => (i === 15 ? { precipitation_probability: 70, weather_code: 61 } : {}) });
  assert.equal(model(f).veta, 'Od 15:00 déšť');
  assert.equal(model(f, { lang: 'en' }).veta, 'Rain from 15:00');
});

test('🚨 déšť po půlnoci nese „zítra" — „Od 03:00" ve 22:00 se čte jako dnes', () => {
  const vecer = Date.UTC(2026, 8, 20, 20, 0);          // 22:00 v Praze
  const f = predpoved({ hodina: (i) => (i === 27 ? { precipitation_probability: 80 } : {}) });
  assert.equal(model(f, { nowMs: vecer }).veta, 'Od zítra 03:00 déšť');
});

test('🚨 věta nese, do kdy platí — stará „Od 15:00 déšť" se v šest večer neopakuje', () => {
  const f = predpoved({ hodina: (i) => (i === 15 ? { precipitation_probability: 70 } : {}) });
  const w = model(f);
  assert.equal(w.vetaDo, Date.UTC(2026, 8, 20, 13, 0), 'začátek deště = 15:00 v Praze');
  // Sucho platí dvanáct hodin od vydání, ne navždy.
  assert.equal(model(predpoved()).vetaDo, TED + 12 * 3600 * 1000);
});

test('prší teď a přestane: „Od 14:00 sucho"', () => {
  const f = predpoved({ hodina: (i) => (i >= 11 && i <= 13 ? { precipitation_probability: 90, precipitation: 1.2 } : {}) });
  assert.equal(model(f).veta, 'Od 14:00 sucho');
});

test('prší teď a v dohledu nepřestane — to je odpověď, ne mezera', () => {
  const f = predpoved({ hodina: () => ({ precipitation_probability: 90, precipitation: 2 }) });
  assert.equal(model(f).veta, 'Příštích 12 hodin bude pršet');
});

test('sucho: řekne se to, neschová — a platí i pro sníh', () => {
  // „Bez deště" by v zimě byla polopravda: sníh je taky srážka.
  assert.equal(model(predpoved()).veta, 'Příštích 12 hodin nic nespadne');
  assert.equal(model(predpoved(), { lang: 'en' }).veta, 'Dry for the next 12 hours');
});

test('🚨 sníh se jmenuje sníh — za sněžení widget nesmí psát „bude pršet"', () => {
  // Náhled 22. 9. 2026: `rainSoon` a `clearSoon` znají jen pravděpodobnost
  // a úhrn, ne skupenství. Skupenství se bere z kódu té hodiny.
  const snezi = { precipitation_probability: 90, precipitation: 1.2, weather_code: 73 };
  const f = predpoved({ hodina: () => snezi, current: { weather_code: 73, temperature_2m: -3 } });
  assert.equal(model(f).veta, 'Příštích 12 hodin bude sněžit');

  const prestane = predpoved({ hodina: (i) => (i <= 13 ? snezi : {}), current: { weather_code: 73 } });
  assert.equal(model(prestane).veta, 'Od 14:00 přestane sněžit');

  const zacne = predpoved({ hodina: (i) => (i === 16 ? snezi : {}) });
  assert.equal(model(zacne).veta, 'Od 16:00 sněžení');
  assert.equal(model(zacne, { lang: 'en' }).veta, 'Snow from 16:00');

  // A mrznoucí déšť je pořád déšť — padá jako voda, ne jako vločky.
  const mrzne = predpoved({ hodina: (i) => (i === 16 ? { ...snezi, weather_code: 67 } : {}) });
  assert.equal(model(mrzne).veta, 'Od 16:00 déšť');
});

/* ── obloha ─────────────────────────────────────────────────────────── */

test('noc: jasno a zbytek; déšť, bouřka a sníh si barvu nechávají i v noci', () => {
  assert.equal(skyKey('clear', false), 'jasnoNoc');
  assert.equal(skyKey('partlyCloudy', false), 'jasnoNoc');
  assert.equal(skyKey('overcast', false), 'zatazenoNoc');
  assert.equal(skyKey('rain', false), 'dest');
  assert.equal(skyKey('thunderstorm', true), 'bourka');
  assert.equal(skyKey('snowShowers', false), 'snih');
  assert.equal(skyKey('fog', true), 'mlha');
  assert.equal(skyKey('neco-noveho', true), 'zatazenoDen', 'neznámý klíč nesmí shodit widget');
  // A celá cesta: ve 22:00 je jasno noční.
  const vecer = Date.UTC(2026, 8, 20, 20, 0);
  assert.deepEqual(model(predpoved(), { nowMs: vecer }).pozadi, SKY.jasnoNoc);
});

/** Poměr kontrastu podle WCAG. */
function kontrast(a, b) {
  const jas = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [jas(a), jas(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('🚨 bílý text je čitelný na KAŽDÉM nebi — nahoře i dole', () => {
  // Nahoře je velké číslo (stačí 3:1 pro velký text), dole drobný pruh
  // hodin — tam se chce víc. Jasné denní nebe je nejsvětlejší a nejvíc
  // svádí k „hezké" světlé modré, na které se hodiny nedají přečíst.
  for (const [jmeno, n] of Object.entries(SKY)) {
    assert.ok(kontrast(n.od, '#FFFFFF') >= 4.5, `${jmeno}: horní barva ${n.od} má s bílou jen ${kontrast(n.od, '#FFFFFF').toFixed(2)}:1`);
    assert.ok(kontrast(n.do, '#FFFFFF') >= 3.5, `${jmeno}: spodní barva ${n.do} má s bílou jen ${kontrast(n.do, '#FFFFFF').toFixed(2)}:1`);
  }
});

/* ── server ─────────────────────────────────────────────────────────── */

const falesnyFetch = (telo, status = 200) => {
  const volano = [];
  const fn = async (url) => {
    volano.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => telo };
  };
  fn.volano = volano;
  return fn;
};

test('server: 🚨 bez souřadnic žádné počasí z Guinejského zálivu', async () => {
  const f = falesnyFetch(predpoved());
  const r = await stavWidget({ fetchImpl: f, base: UPSTREAMS.widget.base, nowMs: TED, params: { lang: 'cs' } });
  assert.equal(r.widget, null);
  assert.equal(f.volano.length, 0, 'ven se kvůli tomu nesmí ani chodit');
});

test('server: stáhne tutéž sadu jako meteostanice, na dva dny', async () => {
  const f = falesnyFetch(predpoved());
  const r = await stavWidget({ fetchImpl: f, base: UPSTREAMS.widget.base, nowMs: TED, params: { lat: '49.53', lon: '12.94', lang: 'cs', units: 'metric' } });
  assert.equal(r.widget.teplota, '14°');
  const url = new URL(f.volano[0]);
  assert.equal(url.searchParams.get('forecast_days'), '2');
  assert.equal(url.searchParams.get('hourly'), WIDGET_PARAMS.hourly);
  assert.match(url.searchParams.get('current'), /cloud_cover_high/, 'bez pater není „slunce přes závoj"');
});

test('server: výpadek předpovědi je „nic k ukázání", ne pád', async () => {
  const r = await stavWidget({ fetchImpl: falesnyFetch({}, 502), base: UPSTREAMS.widget.base, nowMs: TED, params: { lat: '50', lon: '14' } });
  assert.equal(r.widget, null);
  assert.match(r.duvod, /502/);
});

test('server: neznámý jazyk spadne na angličtinu, ne na prázdné klíče', async () => {
  const r = await stavWidget({ fetchImpl: falesnyFetch(predpoved()), base: UPSTREAMS.widget.base, nowMs: TED, params: { lat: '50', lon: '14', lang: 'xx' } });
  assert.equal(r.widget.pocitove, 'Feels 13°');
});

test('🚨 katalog: poloha, jazyk i jednotky jsou v klíči cache', () => {
  // Kdyby nebyly, dostal by druhý tazatel widget prvního: cizí místo, cizí jazyk.
  assert.deepEqual([...UPSTREAMS.widget.params].sort(), ['lang', 'lat', 'lon', 'units']);
  assert.equal(UPSTREAMS.widget.builder, 'meteoWidget');
});

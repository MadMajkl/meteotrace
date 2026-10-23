/**
 * Samotest meteostanice — převod odpovědi API na zobrazený pohled.
 *
 * Bez prohlížeče a bez sítě: odpověď se přibalí jako fixture.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLocalTime, formatClock, formatWeekday, formatDateWeekday, isDaylight,
  pollenLevel, POLLEN_SPECIES, buildStationView, FORECAST_PARAMS,
} from '../web/lib/station.js';
import { METRIC, IMPERIAL } from '../web/lib/units.js';
import { pollenIcon, ICON_SPECIES } from '../web/lib/pollen-icons.js';

/* ============================================================
   ČAS — nejzrádnější část
   ============================================================ */

test('🚨 čas: naivní řetězec se vyloží podle MÍSTA, ne podle zařízení', () => {
  // Open-Meteo s timezone=auto vrací '2026-08-21T14:00' bez značky pásma.
  // Date.parse() by to vyložil podle pásma zařízení — Čech koukající na New York
  // by viděl časy posunuté o šest hodin.
  const praha = parseLocalTime('2026-08-21T14:00', 7200);      // SELČ = UTC+2
  assert.equal(new Date(praha).toISOString(), '2026-08-21T12:00:00.000Z');

  const newYork = parseLocalTime('2026-08-21T14:00', -14400);  // EDT = UTC−4
  assert.equal(new Date(newYork).toISOString(), '2026-08-21T18:00:00.000Z');

  assert.notEqual(praha, newYork, 'stejná hodina jinde je jiný okamžik');
});

test('čas: zvládne i sekundy v řetězci', () => {
  assert.equal(
    parseLocalTime('2026-08-21T14:00:00', 7200),
    parseLocalTime('2026-08-21T14:00', 7200),
  );
});

test('čas: poškozený vstup vrátí null, ne NaN datum', () => {
  assert.equal(parseLocalTime(null, 0), null);
  assert.equal(parseLocalTime('nesmysl', 0), null);
  assert.equal(parseLocalTime(123, 0), null);
});

test('🚨 čas: hodiny se vypisují v pásmu prohlíženého místa', () => {
  const ms = Date.parse('2026-08-21T12:00:00Z');
  assert.equal(formatClock(ms, 'Europe/Prague', 'cs'), '14:00');
  assert.equal(formatClock(ms, 'America/New_York', 'cs'), '08:00');
  assert.equal(formatClock(ms, 'UTC', 'cs'), '12:00');
});

test('čas: chybějící hodnota se ukáže jako pomlčka', () => {
  assert.equal(formatClock(null, 'UTC', 'cs'), '—');
  assert.equal(formatWeekday(undefined, 'UTC', 'cs'), '—');
});

test('den/noc: řídí se východem a západem, ne hodinou na hodinkách', () => {
  // V červnu je v Norsku v jedenáct večer světlo — podle hodin by to byla noc.
  const sunrise = Date.parse('2026-06-21T00:30:00Z');
  const sunset = Date.parse('2026-06-21T23:00:00Z');
  assert.equal(isDaylight(Date.parse('2026-06-21T22:00:00Z'), sunrise, sunset), true);
  assert.equal(isDaylight(Date.parse('2026-06-21T23:30:00Z'), sunrise, sunset), false);
});

test('den/noc: bez údajů o slunci se předpokládá den', () => {
  // Ikona s měsícem u polední předpovědi vypadá jako chyba; opačný omyl je mírnější.
  assert.equal(isDaylight(Date.now(), null, null), true);
});

/* ============================================================
   PYL
   ============================================================ */

test('pyl: prahy se liší podle druhu', () => {
  // Bříza obtěžuje při řádově nižší koncentraci než trávy.
  assert.equal(pollenLevel('birch', 30), 'moderate');
  assert.equal(pollenLevel('grass', 30), 'moderate');
  assert.equal(pollenLevel('ragweed', 30), 'high', 'ambrózie je agresivní');
});

test('pyl: chybějící hodnota není nulová koncentrace', () => {
  assert.equal(pollenLevel('birch', null), null);
  assert.equal(pollenLevel('birch', undefined), null);
  assert.equal(pollenLevel('neznamy', 10), null);
});

test('🚨 pyl: nula NENÍ nízká zátěž, je to žádná', () => {
  // Změněno 23. 8. 2026, když se Michal ptal, proč pylové zpravodajství
  // nefunguje. Fungovalo — jenže v srpnu hlásilo „nízkou" olši, břízu
  // i olivu, tedy druhy, které tou dobou nekvetou a v Česku (oliva) ani
  // nerostou. Šest řádků se stejným slovem vypadá jako vymyšlená data.
  assert.equal(pollenLevel('birch', 0), 'none');
  assert.equal(pollenLevel('birch', 0.1), 'low', 'kousek nad nulou už něco je');
  assert.equal(pollenLevel('birch', null), null, 'chybějící údaj není nula');
});

test('pyl: nulové druhy se řadí naspod, ne nahoru', () => {
  const view = buildStationView({
    forecast: FORECAST, air: { current: { birch_pollen: 0, grass_pollen: 25 } },
    lang: 'cs', units: METRIC, nowMs: NOW,
  });
  assert.equal(view.pollen[0].species, 'grass', 'co lítá, patří nahoru');
  assert.equal(view.pollen.at(-1).level, 'none');
});

test('🚨 pyl: tři stavy se nesmí splést — lítá / nelítá / nevíme', () => {
  const stav = (air) => buildStationView({
    forecast: FORECAST, air, lang: 'cs', units: METRIC, nowMs: NOW,
  }).pollenStatus;

  assert.equal(stav({ current: { grass_pollen: 12 } }), 'data');
  assert.equal(stav({ current: { grass_pollen: 0, birch_pollen: 0 } }), 'zadny');
  assert.equal(stav(null), 'nedostupne', 'výpadek se nesmí tvářit jako klid');
  assert.equal(stav({ current: {} }), 'nedostupne');
});

/* ============================================================
   FIXTURE — zmenšenina skutečné odpovědi Open-Meteo
   ============================================================ */

const FORECAST = {
  timezone: 'Europe/Prague',
  utc_offset_seconds: 7200,
  current: {
    temperature_2m: 23.4, apparent_temperature: 24.1, relative_humidity_2m: 55,
    precipitation: 0, weather_code: 2, cloud_cover: 40,
    wind_speed_10m: 12.5, wind_direction_10m: 350, wind_gusts_10m: 28,
  },
  hourly: {
    time: ['2026-08-21T12:00', '2026-08-21T13:00', '2026-08-21T14:00', '2026-08-21T15:00'],
    temperature_2m: [22, 23.4, 24, 24.5],
    apparent_temperature: [22.5, 24.1, 24.8, 25],
    relative_humidity_2m: [58, 55, 52, 50],
    precipitation_probability: [0, 5, 20, 60],
    precipitation: [0, 0, 0.2, 1.8],
    weather_code: [1, 2, 3, 61],
    cloud_cover: [20, 40, 80, 95],
    wind_speed_10m: [10, 12.5, 14, 16],
    wind_direction_10m: [340, 350, 10, 20],
    uv_index: [5.2, 4.8, 3.9, 2.1],
  },
  daily: {
    time: ['2026-08-21', '2026-08-22', '2026-08-23'],
    weather_code: [2, 61, 95],
    temperature_2m_max: [25, 21, 19],
    temperature_2m_min: [14, 13, 12],
    precipitation_probability_max: [60, 80, 90],
    sunrise: ['2026-08-21T05:52', '2026-08-22T05:54', '2026-08-23T05:55'],
    sunset: ['2026-08-21T20:11', '2026-08-22T20:09', '2026-08-23T20:07'],
  },
};

const AIR = {
  current: { birch_pollen: 2, grass_pollen: 65, ragweed_pollen: 25, alder_pollen: null },
};

const NOW = Date.parse('2026-08-21T11:00:00Z');   // 13:00 v Praze

/* ============================================================
   SESTAVENÍ POHLEDU
   ============================================================ */

test('pohled: poškozená odpověď vrátí null, ne půlku obrazovky', () => {
  assert.equal(buildStationView({ forecast: null, lang: 'cs', units: METRIC, nowMs: NOW }), null);
  assert.equal(buildStationView({ forecast: {}, lang: 'cs', units: METRIC, nowMs: NOW }), null);
});

test('pohled: aktuální stav se přeloží a naformátuje', () => {
  const v = buildStationView({ forecast: FORECAST, air: AIR, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.equal(v.current.condition, 'Polojasno');
  assert.match(v.current.temp, /23 °C/);
  assert.match(v.current.wind, /13 km\/h/);
  assert.equal(v.current.windDir, 'S', '350° je sever');
  assert.match(v.current.humidity, /55 %/);
});

test('🚨 pohled: aktuální hodina je NEJBLIŽŠÍ, ne první v poli', () => {
  // Odpověď může začínat půlnocí, i když je odpoledne.
  const v = buildStationView({ forecast: FORECAST, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.equal(v.hourly[0].time, '13:00', 'má začít teď, ne v poledne');
});

test('pohled: hodiny se vypisují v pásmu místa', () => {
  const v = buildStationView({ forecast: FORECAST, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.deepEqual(v.hourly.map((h) => h.time), ['13:00', '14:00', '15:00']);
  assert.equal(v.timeZone, 'Europe/Prague');
});

test('pohled: první dva dny mají jméno, ostatní zkratku', () => {
  const v = buildStationView({ forecast: FORECAST, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.equal(v.daily[0].day, 'Dnes');
  assert.equal(v.daily[1].day, 'Zítra');
  assert.notEqual(v.daily[2].day, 'Zítra');
});

test('pohled: jednotky se propíšou, jazyk zvlášť', () => {
  const cs = buildStationView({ forecast: FORECAST, lang: 'cs', units: METRIC, nowMs: NOW });
  const usa = buildStationView({ forecast: FORECAST, lang: 'cs', units: IMPERIAL, nowMs: NOW });
  assert.match(cs.current.temp, /°C/);
  assert.match(usa.current.temp, /°F/);
  assert.equal(usa.current.condition, 'Polojasno', 'jazyk zůstal český');
});

test('pohled: východ a západ slunce', () => {
  const v = buildStationView({ forecast: FORECAST, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.equal(v.sun.sunrise, '05:52');
  assert.equal(v.sun.sunset, '20:11');
});

test('pohled: pyl je seřazený od nejsilnějšího', () => {
  const v = buildStationView({ forecast: FORECAST, air: AIR, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.equal(v.pollen[0].species, 'grass', 'trávy 65 = vysoká');
  assert.equal(v.pollen[0].level, 'high');
  assert.equal(v.pollen[0].levelText, 'Vysoká');
  assert.ok(v.pollen.every((p) => POLLEN_SPECIES.includes(p.species)));
});

test('pyl: druh bez dat se vynechá, nezobrazí jako nula', () => {
  const v = buildStationView({ forecast: FORECAST, air: AIR, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.ok(!v.pollen.some((p) => p.species === 'alder'), 'olše nemá data → nemá být v seznamu');
});

test('pohled: chybějící pyl nespadne, jen bude prázdno', () => {
  const v = buildStationView({ forecast: FORECAST, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.deepEqual(v.pollen, []);
});

test('🚨 pohled: nula se nesmí ztratit jako chybějící hodnota', () => {
  // `pick()` musí brát nulu jako platnou — srážky 0 mm znamenají sucho,
  // ne chybějící údaj.
  const v = buildStationView({ forecast: FORECAST, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.match(v.current.precip, /0/);
  assert.ok(!v.current.precip.includes('—'));
});

test('pohled: chybějící údaj v aktuálním stavu se doplní z hodinových dat', () => {
  const bez = { ...FORECAST, current: { weather_code: 2 } };
  const v = buildStationView({ forecast: bez, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.match(v.current.temp, /23 °C/, 'teplota se má vzít z hodinového pole');
});

test('pohled: ikona v noci je jiná než ve dne', () => {
  const noc = Date.parse('2026-08-21T22:00:00Z');   // půlnoc v Praze, po západu
  const nocni = buildStationView({ forecast: FORECAST, lang: 'cs', units: METRIC, nowMs: noc });
  const denni = buildStationView({ forecast: FORECAST, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.notEqual(nocni.current.icon, denni.current.icon);
});

/* ============================================================
   PIKTOGRAMY ALERGENŮ
   ============================================================ */

test('🚨 každý měřený druh má svůj tvar', () => {
  // Kdyby některý chyběl, řádek by měl prázdné místo místo lístku — a nikdo
  // by si toho nevšiml, protože jméno i stupeň tam pořád jsou.
  for (const species of POLLEN_SPECIES) {
    assert.ok(pollenIcon(species), `chybí piktogram pro ${species}`);
  }
  assert.deepEqual([...ICON_SPECIES].sort(), [...POLLEN_SPECIES].sort());
});

test('neznámý druh nedostane cizí tvar, ale nic', () => {
  // Přibude-li do zdroje sedmý alergen, appka ho vypíše bez obrázku
  // a čeká, až se tvar dokreslí. Cizí lístek u cizího jména by lhal.
  assert.equal(pollenIcon('kopřiva'), null);
  assert.equal(pollenIcon(''), null);
  assert.equal(pollenIcon(undefined), null);
});

test('tvary jsou kreslitelné — mají čáru nebo plochu', () => {
  for (const species of ICON_SPECIES) {
    const t = pollenIcon(species);
    assert.ok(t.cara || t.plocha, `${species} nemá co kreslit`);
    for (const d of [t.cara, t.plocha].filter(Boolean)) {
      assert.match(d, /^M[\d\s.,-]/, `${species}: cesta nezačíná přesunem`);
    }
  }
});

/* ============================================================
   HODINOVÝ PRUH NA DVA DNY

   🚨 Michal 27. 8. 2026: „ta předpověď po hodinách by měla být
   scrollovatelná… 48 h?" Data na sedm dní se stahují tak jako tak, takže
   delší pruh nestojí ani dotaz navíc. Musí v něm ale být poznat, kde končí
   dnešek — jinak je 0–23 a znovu 0–23 bludiště.
   ============================================================ */

/** Předpověď na 60 hodin od poledne, ať pruh přesáhne přes dva půlnoci. */
function dlouhaPredpoved(pocet = 60) {
  const zacatek = Date.parse('2026-08-21T10:00:00Z');   // 12:00 v Praze
  const casy = Array.from({ length: pocet }, (_, i) =>
    new Date(zacatek + i * 3600000).toISOString().slice(0, 16));
  const pole = (v) => Array.from({ length: pocet }, () => v);

  return {
    timezone: 'Europe/Prague',
    utc_offset_seconds: 7200,
    current: { temperature_2m: 20, weather_code: 1, wind_speed_10m: 10, wind_direction_10m: 350 },
    hourly: {
      // ⚠️ Časy jsou MÍSTNÍ, jak je vrací Open-Meteo — proto se posouvají
      // o offset a nikoli o UTC.
      time: casy.map((s) => new Date(Date.parse(s + ':00Z') + 7200000).toISOString().slice(0, 16)),
      temperature_2m: pole(20),
      apparent_temperature: pole(20),
      relative_humidity_2m: pole(50),
      precipitation_probability: pole(0),
      precipitation: pole(0),
      weather_code: pole(1),
      cloud_cover: pole(10),
      wind_speed_10m: pole(10),
      wind_direction_10m: pole(350),
      uv_index: pole(3),
    },
    daily: {
      time: ['2026-08-21', '2026-08-22', '2026-08-23'],
      weather_code: [1, 2, 3],
      temperature_2m_max: [24, 25, 22],
      temperature_2m_min: [12, 13, 11],
      precipitation_probability_max: [10, 20, 60],
      sunrise: ['2026-08-21T06:00', '2026-08-22T06:01', '2026-08-23T06:03'],
      sunset: ['2026-08-21T20:00', '2026-08-22T19:58', '2026-08-23T19:56'],
    },
  };
}

const POLEDNE = Date.parse('2026-08-21T10:00:00Z');

test('hodinový pruh dává 48 hodin', () => {
  const v = buildStationView({ forecast: dlouhaPredpoved(), lang: 'cs', units: METRIC, nowMs: POLEDNE });
  assert.equal(v.hourly.length, 48);
});

test('🚨 první hodina nového dne je označená jménem dne', () => {
  const v = buildStationView({ forecast: dlouhaPredpoved(), lang: 'cs', units: METRIC, nowMs: POLEDNE });
  const predely = v.hourly.filter((h) => h.dayLabel);

  assert.equal(predely.length, 2, 'pruh od poledne přesáhne přes dvě půlnoci');
  assert.equal(predely[0].dayLabel, 'Zítra', 'druhý den se řekne slovem');
  assert.notEqual(predely[1].dayLabel, 'Zítra', 'třetí den má vlastní jméno, ne zase „Zítra“');
});

test('první hodina pruhu předěl NEMÁ', () => {
  // „Dnes" nad první dlaždicí je šum: uživatel ví, že pruh začíná teď.
  const v = buildStationView({ forecast: dlouhaPredpoved(), lang: 'cs', units: METRIC, nowMs: POLEDNE });
  assert.equal(v.hourly[0].dayLabel, '');
});

test('kratší pruh jde vyžádat', () => {
  const v = buildStationView({ forecast: dlouhaPredpoved(), lang: 'cs', units: METRIC, nowMs: POLEDNE, hours: 6 });
  assert.equal(v.hourly.length, 6);
  assert.equal(v.hourly.every((h) => !h.dayLabel), true, 'šest hodin od poledne se do zítřka nedostane');
});

test('🚨 den se láme podle pásma MÍSTA, ne prohlížeče', () => {
  // Kdo se dívá z Prahy na Reykjavík, potřebuje vědět, kdy začíná zítřek
  // TAM. Posunuté pásmo proto musí posunout i předěl.
  const f = dlouhaPredpoved();
  const v = buildStationView({ forecast: f, lang: 'cs', units: METRIC, nowMs: POLEDNE });
  const prvni = v.hourly.findIndex((h) => h.dayLabel);
  assert.equal(prvni, 12, 'od 12:00 místního je do půlnoci dvanáct hodin');
});

/* ============================================================
   KONEC LETNÍHO ČASU

   🚨 Miki 22. 10. 2026: „na kartě 7 denní předpovědi je 2x neděle!"
   Open-Meteo posouvá celou odpověď jedním `utc_offset_seconds` — tím,
   který platí teď. Týden přes 25. 10. tak přišel celý s posunem +2 h
   a „půlnoc 26. 10." byla v Praze neděle 23:00.
   ============================================================ */

/**
 * Odpověď, jakou Open-Meteo vrátilo 22. 10. 2026 pro Prahu: sedm dní,
 * všechno s posunem platným při dotazu (+2 h). Na jaro totéž s +1 h.
 */
function tydenPresZmenuCasu(prvniDen = '2026-10-22', posunS = 7200) {
  const zacatek = Date.parse(`${prvniDen}T00:00:00Z`) - posunS * 1000;
  const pocet = 7 * 24;
  const pole = (v) => Array.from({ length: pocet }, () => v);
  const dny = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(`${prvniDen}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10));

  return {
    timezone: 'Europe/Prague',
    utc_offset_seconds: posunS,
    current: { temperature_2m: 10, weather_code: 1, wind_speed_10m: 10, wind_direction_10m: 350 },
    hourly: {
      // Souvislá řada bez dvojí 02:00 — posun je pevný, ne podle kalendáře.
      time: Array.from({ length: pocet }, (_, i) =>
        new Date(zacatek + i * 3600000 + posunS * 1000).toISOString().slice(0, 16)),
      temperature_2m: pole(10),
      precipitation_probability: pole(0),
      precipitation: pole(0),
      weather_code: pole(1),
    },
    daily: {
      time: dny,
      weather_code: dny.map(() => 1),
      temperature_2m_max: dny.map(() => 14),
      temperature_2m_min: dny.map(() => 5),
      precipitation_probability_max: dny.map(() => 10),
      sunrise: dny.map((d) => `${d}T07:40`),
      sunset: dny.map((d) => `${d}T17:50`),
    },
  };
}

test('🚨 sedm dní přes konec letního času: každý den právě jednou', () => {
  const ctvrtek = Date.parse('2026-10-22T08:00:00Z');
  const v = buildStationView({ forecast: tydenPresZmenuCasu(), lang: 'cs', units: METRIC, nowMs: ctvrtek });
  assert.deepEqual(v.daily.map((d) => d.day), ['Dnes', 'Zítra', 'so', 'ne', 'po', 'út', 'st']);
});

test('🚨 hodinový pruh přes konec letního času láme den o skutečné půlnoci', () => {
  const sobota = Date.parse('2026-10-24T08:00:00Z');   // 10:00 SELČ
  const v = buildStationView({ forecast: tydenPresZmenuCasu(), lang: 'cs', units: METRIC, nowMs: sobota });
  const predely = v.hourly.filter((h) => h.dayLabel).map((h) => `${h.dayLabel} ${h.time}`);
  assert.deepEqual(predely, ['Zítra 00:00', 'po 00:00'], 'ne „ne 23:00"');
});

test('🚨 začátek letního času (28. 3. 2027): sedm dní i hodinový pruh', () => {
  // Dotaz ve čtvrtek 25. 3. 2027 → celý týden s posunem +1 h.
  const jaro = tydenPresZmenuCasu('2027-03-25', 3600);
  const ctvrtek = Date.parse('2027-03-25T09:00:00Z');
  const v = buildStationView({ forecast: jaro, lang: 'cs', units: METRIC, nowMs: ctvrtek });
  assert.deepEqual(v.daily.map((d) => d.day), ['Dnes', 'Zítra', 'so', 'ne', 'po', 'út', 'st']);

  const sobota = Date.parse('2027-03-27T09:00:00Z');   // 10:00 SEČ
  const s = buildStationView({ forecast: jaro, lang: 'cs', units: METRIC, nowMs: sobota });
  const predely = s.hourly.filter((h) => h.dayLabel).map((h) => `${h.dayLabel} ${h.time}`);
  assert.deepEqual(predely, ['Zítra 00:00', 'po 00:00'], 'ne „po 01:00"');
  // Hodina 02:00 v noci na neděli neexistuje — pruh ji nevymyslí.
  const casy = s.hourly.map((h) => h.time);
  const i = casy.indexOf('01:00');
  assert.equal(casy[i + 1], '03:00');
});

test('den v týdnu z data: poškozený vstup je pomlčka', () => {
  assert.equal(formatDateWeekday('2026-10-26', 'cs'), 'po');
  assert.equal(formatDateWeekday('nesmysl', 'cs'), '—');
  assert.equal(formatDateWeekday(undefined, 'cs'), '—');
});

/* ============================================================
   KDY PŘESTANE PRŠET

   🚨 Protějšek `rainSoon`, a dlouho chyběl. Kdo stojí v dešti,
   nepotřebuje vědět, kde je sucho — potřebuje vědět, jestli to přejde.
   ============================================================ */

/** Fixture s libovolným průběhem srážek. Teď = index 0. */
function sPrsenim(mm) {
  const cas = mm.map((_, i) => `2026-08-21T${String(13 + i).padStart(2, '0')}:00`);
  return {
    ...FORECAST,
    hourly: {
      ...FORECAST.hourly,
      time: cas,
      temperature_2m: mm.map(() => 18),
      apparent_temperature: mm.map(() => 18),
      relative_humidity_2m: mm.map(() => 80),
      // ⚠️ Pravděpodobnost sleduje TÝŽ práh jako množství. Napoprvé jsem
      // dal 90 % ke každé kapce včetně 0,1 mm — a test „mrholení se
      // nepočítá" pak padal na vlastní fixture, ne na kódu: 90 % je přes
      // práh právem, protože to znamená „skoro jistě bude mrholit".
      precipitation_probability: mm.map((v) => (v > 0.2 ? 90 : 5)),
      precipitation: mm,
      weather_code: mm.map((v) => (v > 0 ? 61 : 2)),
      cloud_cover: mm.map(() => 90),
      wind_speed_10m: mm.map(() => 15),
      wind_direction_10m: mm.map(() => 270),
      uv_index: mm.map(() => 1),
    },
  };
}

const konec = (mm) => buildStationView({
  forecast: sPrsenim(mm), lang: 'cs', units: METRIC,
  nowMs: Date.parse('2026-08-21T11:00:00Z'),      // 13:00 v Praze = index 0
}).clearSoon;

test('prší a za dvě hodiny přestane', () => {
  const c = konec([2, 1.5, 0, 0]);
  assert.equal(c.prsiTed, true);
  assert.equal(c.hours, 2);
  assert.ok(c.time, 'čas se musí dát vypsat');
});

test('🚨 „neprší" a „prší a nekončí to" se NESMÍ splést', () => {
  // Obojí by bez `prsiTed` vypadalo stejně — a „nevíme, kdy to skončí"
  // by se tvářilo jako „hned to přejde". Přesně opačná zpráva.
  const sucho = konec([0, 0, 0, 0]);
  assert.equal(sucho.prsiTed, false);
  assert.equal(sucho.hours, null);

  const lije = konec([2, 2, 2, 2]);
  assert.equal(lije.prsiTed, true, 'prší');
  assert.equal(lije.hours, null, 'ale konec v dohledu není');
});

test('krátká předpověď nevymyslí konec, který v datech není', () => {
  // Když pole skončí dřív, než přestane pršet, je odpověď „nevíme kdy",
  // ne „za tři hodiny".
  const c = konec([1, 1]);
  assert.equal(c.prsiTed, true);
  assert.equal(c.hours, null);
});

test('mrholení pod prahem se za déšť nepovažuje', () => {
  // Tentýž práh jako u příchodu deště (0,2 mm), ať si dvě věty o témže
  // počasí neodporují.
  const c = konec([0.1, 0.1, 0.1]);
  assert.equal(c.prsiTed, false);
});

/* ============================================================
   VÍTR V PŘEDPOVĚDI PO HODINÁCH A PO DNECH
   Miki 24. 10. 2026: „v předpovědi na víc dní a hodin není vůbec vítr
   zahrnutý a jeho směr".
   ============================================================ */

/** Týž FORECAST s nárazy po hodinách a větrem po dnech — čísla z živé odpovědi pro Prahu. */
const SVETREM = {
  ...FORECAST,
  hourly: { ...FORECAST.hourly, wind_gusts_10m: [20, 30, 25, 40] },
  daily: {
    ...FORECAST.daily,
    wind_speed_10m_max: [22.4, 15.8, 6.6],
    wind_gusts_10m_max: [45.7, 41, 14],
    wind_direction_10m_dominant: [217, 331, 184],
  },
};

test('🚨 dotaz na předpověď stahuje vítr i po dnech', () => {
  // Bez toho karta 7 dní neměla z čeho vítr ukázat. Po hodinách se stahoval
  // vždycky, jen se nevypisoval.
  for (const p of ['wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant']) {
    assert.ok(FORECAST_PARAMS.daily.split(',').includes(p), `daily chybí ${p}`);
  }
  for (const p of ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m']) {
    assert.ok(FORECAST_PARAMS.hourly.split(',').includes(p), `hourly chybí ${p}`);
  }
});

test('vítr po hodinách: rychlost, směr a náraz, jen když něco přidává', () => {
  const v = buildStationView({ forecast: SVETREM, lang: 'cs', units: METRIC, nowMs: NOW });
  const [h13, h14] = v.hourly;
  assert.equal(h13.wind, '13 km/h');
  assert.equal(h13.windDeg, 350, 'přesný úhel pro střelku');
  assert.equal(h13.windDirLong, 'severní');
  assert.equal(h13.gustsMatter, true, 'náraz 30 je o 17,5 nad průměrem');
  assert.equal(h13.gustsValue, '30', 'do dlaždice jen číslo, jednotku nese rychlost');
  assert.equal(h13.gusts, '30 km/h');
  assert.equal(h14.gustsMatter, false, 'náraz 25 při 14 km/h nic nepřidává');
  assert.equal(h14.windKmh, 14, 'číslo pro barvu střelky');
});

test('vítr po dnech: nejsilnější vítr, náraz a převládající směr', () => {
  const v = buildStationView({ forecast: SVETREM, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.equal(v.daily[0].wind, '22 km/h');
  assert.equal(v.daily[0].gusts, '46 km/h');
  assert.equal(v.daily[0].gustsMatter, true);
  assert.equal(v.daily[0].windDirLong, 'jihozápadní');
  assert.equal(v.daily[0].windDeg, 217, 'střelka dostane přesný úhel, ne zaokrouhlený');
  assert.equal(v.daily[2].gustsMatter, false, 'náraz 14 při 7 km/h se nepíše');
  assert.equal(v.daily[2].windDirLong, 'jižní');
});

test('🚨 vítr po dnech: směr slovem jen v OSMI stranách', () => {
  // „severo-severozápadní, nárazy 25 km/h" se na 320 px nevešlo a nárazy
  // spadly na další řádek. Převládající směr za celý den je odhad; přesný
  // úhel nese střelka, slovo stačí hrubší.
  const v = buildStationView({ forecast: SVETREM, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.equal(v.daily[1].windDirLong, 'severozápadní', '331° je po šestnáctinách severo-severozápadní');
  assert.equal(v.daily[1].windDeg, 331);
  for (const d of v.daily) assert.doesNotMatch(d.windDirLong, /-/, 'žádné složené jméno');
});

test('🚨 starší odpověď bez větru po dnech nic nevymýšlí', () => {
  // Odpověď z mezipaměti před 24. 10. 2026 pole nemá. Prázdný vítr znamená
  // „nevíme" — appka ho nevypíše, místo aby ukázala nulu jako bezvětří.
  const v = buildStationView({ forecast: FORECAST, lang: 'cs', units: METRIC, nowMs: NOW });
  assert.equal(v.daily[0].wind, '');
  assert.equal(v.daily[0].windKmh, null);
  assert.equal(v.daily[0].windDeg, null);
  assert.equal(v.daily[0].windDirLong, '');
  assert.equal(v.daily[0].gustsMatter, false);
  // Po hodinách vítr je, nárazy ne — náraz se pak netvrdí.
  assert.equal(v.hourly[0].wind, '13 km/h');
  assert.equal(v.hourly[0].gusts, '');
  assert.equal(v.hourly[0].gustsMatter, false);
});

test('vítr v předpovědi: jednotky uživatele, jazyk zvlášť', () => {
  const usa = buildStationView({ forecast: SVETREM, lang: 'en', units: IMPERIAL, nowMs: NOW });
  assert.equal(usa.daily[0].wind, '14 mph');
  assert.equal(usa.daily[0].gustsValue, '28');
  assert.equal(usa.daily[0].windDirLong, 'southwesterly');
  assert.equal(usa.hourly[0].wind, '8 mph');
});

/**
 * Samotest meteostanice — převod odpovědi API na zobrazený pohled.
 *
 * Bez prohlížeče a bez sítě: odpověď se přibalí jako fixture.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLocalTime, formatClock, formatWeekday, isDaylight,
  pollenLevel, POLLEN_SPECIES, buildStationView,
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

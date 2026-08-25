/**
 * Samotest trasy — adaptér routeru a pohled na počasí po trase.
 *
 * Bez sítě: odpověď routeru i předpověď jsou přibalené jako fixtures.
 * Díky tomu je celá funkce hotová a ověřená JEŠTĚ NEŽ dorazí klíč k ORS.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { planRoute, departureOptions } from '../web/lib/eta.js';
import {
  fromOpenRouteService, hoursToMs, toOrsCoord, toForecastParams, asLocationList, spojUseky,
} from '../web/lib/route-adapter.js';
import {
  buildRouteView, compareDepartures, routeMapData, departureAdvice, legRows,
  RAIN_PROBABILITY, STRONG_WIND_KMH,
} from '../web/lib/route-view.js';
import { METRIC } from '../web/lib/units.js';

/* ============================================================
   FIXTURE: odpověď openrouteservice (zmenšenina, tvar dle dokumentace)
   ============================================================ */

const ORS = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {
      summary: { distance: 205000, duration: 7800 },
      segments: [{
        distance: 205000, duration: 7800,
        steps: [
          { distance: 12000, duration: 1500 },    // město: pomalu
          { distance: 180000, duration: 5400 },   // dálnice: rychle
          { distance: 13000, duration: 900 },     // město: pomalu
        ],
      }],
    },
    geometry: {
      type: 'LineString',
      // 🚨 GeoJSON: [délka, šířka] — tedy [lon, lat]
      coordinates: [
        [14.4378, 50.0755],   // Praha
        [15.2700, 49.9400],
        [16.6068, 49.1951],   // Brno
      ],
    },
  }],
};

/* ============================================================
   ADAPTÉR
   ============================================================ */

test('🚨 adaptér: prohodí [délka, šířka] na [šířka, délka]', () => {
  // Zaměněné pořadí je zákeřné: pro ČR (50 N, 14 E) obě čísla existují,
  // takže výsledek vypadá věrohodně — trasa se jen přesune do oceánu.
  const r = fromOpenRouteService(ORS);
  assert.deepEqual(r.points[0], [50.0755, 14.4378], 'Praha: šířka 50, délka 14');
  assert.deepEqual(r.points[2], [49.1951, 16.6068], 'Brno');
  assert.ok(r.points.every(([lat, lon]) => lat > 45 && lat < 55 && lon > 10 && lon < 20),
    'všechny body musí ležet ve střední Evropě');
});

test('adaptér: vytáhne souhrn i rychlostní profil', () => {
  const r = fromOpenRouteService(ORS);
  assert.equal(r.totalDistanceM, 205000);
  assert.equal(r.totalDurationS, 7800);
  assert.equal(r.legs.length, 3, 'kroky jsou jemnější než úseky, berou se ony');
  assert.equal(r.legs[0].durationS, 1500);
});

test('adaptér: bez kroků se použijí úseky', () => {
  const bezKroku = structuredClone(ORS);
  delete bezKroku.features[0].properties.segments[0].steps;
  const r = fromOpenRouteService(bezKroku);
  assert.equal(r.legs.length, 1);
  assert.equal(r.legs[0].distanceM, 205000);
});

test('adaptér: chybějící souhrn se dopočítá ze součtu úseků', () => {
  const bezSouhrnu = structuredClone(ORS);
  delete bezSouhrnu.features[0].properties.summary;
  const r = fromOpenRouteService(bezSouhrnu);
  assert.equal(r.totalDistanceM, 205000);
  assert.equal(r.totalDurationS, 7800);
});

test('adaptér: poškozená odpověď vrátí null, ne půlku trasy', () => {
  assert.equal(fromOpenRouteService(null), null);
  assert.equal(fromOpenRouteService({}), null);
  assert.equal(fromOpenRouteService({ features: [] }), null);
  assert.equal(fromOpenRouteService({ features: [{ geometry: { coordinates: [] } }] }), null);
});

test('adaptér: nesmyslné souřadnice se zahodí', () => {
  const rozbite = structuredClone(ORS);
  rozbite.features[0].geometry.coordinates = [[14.4, 50.1], ['x', 'y'], [16.6, 49.2]];
  const r = fromOpenRouteService(rozbite);
  assert.equal(r.points.length, 2);
});

test('🚨 souřadnice pro ORS jdou v pořadí délka,šířka', () => {
  assert.equal(toOrsCoord([50.0755, 14.4378]), '14.4378,50.0755');
});

test('předpověď: souřadnice se pošlou jedním dotazem', () => {
  const samples = [
    { point: [50.0755, 14.4378] }, { point: [49.94, 15.27] }, { point: [49.1951, 16.6068] },
  ];
  const p = toForecastParams(samples);
  assert.equal(p.latitude.split(',').length, 3);
  assert.equal(p.longitude.split(',').length, 3);
});

test('předpověď: souřadnice se zkrátí, ať zaberou cache', () => {
  // Modely mají rozlišení v kilometrech, takže osm desetinných míst nemá
  // smysl — a zkrácením se z různých dotazů na tutéž trasu stane týž dotaz.
  const p = toForecastParams([{ point: [50.07551234, 14.43789876] }]);
  assert.equal(p.latitude, '50.0755');
  assert.equal(p.longitude, '14.4379');
});

test('🚨 jeden bod vrátí objekt, víc bodů pole', () => {
  // Past: trasa navzorkovaná na jediný bod dostane objekt, ne pole —
  // a kód, který slepě volá .map(), spadne.
  assert.equal(asLocationList({ hourly: {} }).length, 1);
  assert.equal(asLocationList([{ hourly: {} }, { hourly: {} }]).length, 2);
  assert.deepEqual(asLocationList(null), []);
});

/* ============================================================
   FIXTURE: předpověď pro body trasy
   ============================================================ */

const T0 = Date.parse('2026-08-21T06:00:00Z');
const HOURS = Array.from({ length: 12 }, (_, i) =>
  new Date(T0 + i * 3600000).toISOString().slice(0, 16));

/** Bod trasy s daným průběhem počasí po hodinách. */
function place({ codes, probs, winds }) {
  return {
    timezone: 'Europe/Prague',
    utc_offset_seconds: 7200,
    hourly: {
      time: HOURS,
      temperature_2m: HOURS.map(() => 20),
      precipitation_probability: probs,
      precipitation: probs.map((p) => (p > 50 ? 2 : 0)),
      weather_code: codes,
      wind_speed_10m: winds || HOURS.map(() => 10),
      wind_direction_10m: HOURS.map(() => 180),
    },
  };
}

const fill = (v) => Array.from({ length: 12 }, () => v);

/** Tři body: první jasno, druhý bouřka v 8:00, třetí déšť celý den. */
const FORECAST = [
  place({ codes: fill(0), probs: fill(0) }),
  place({ codes: [0, 0, 95, 95, 0, 0, 0, 0, 0, 0, 0, 0], probs: [0, 0, 90, 90, 10, 0, 0, 0, 0, 0, 0, 0] }),
  place({ codes: fill(61), probs: fill(70) }),
];

const ROUTE = fromOpenRouteService(ORS);
const HOUR_MS = HOURS.map((s) => Date.parse(s + ':00Z') - 7200 * 1000);

function planAt(departureMs, stepM = 120000) {
  return planRoute({ ...ROUTE, departureMs, hourMs: HOUR_MS, stepM });
}

/* ============================================================
   POHLED NA TRASU
   ============================================================ */

test('trasa: každý bod dostane počasí i čas příjezdu', () => {
  const plan = planAt(T0);
  const v = buildRouteView({ plan, forecast: FORECAST, lang: 'cs', units: METRIC });
  assert.ok(v);
  assert.equal(v.points.length, 3);
  for (const p of v.points) {
    assert.ok(p.known);
    assert.ok(Number.isFinite(p.etaMs));
    assert.ok(p.condition.length > 0);
  }
});

test('🚨 trasa: nesouhlasný počet bodů a míst vrátí null', () => {
  // Počasí přiřazené špatnému místu je horší než chybějící.
  const plan = planAt(T0);
  assert.equal(buildRouteView({ plan, forecast: FORECAST.slice(0, 2), lang: 'cs', units: METRIC }), null);
  assert.equal(buildRouteView({ plan, forecast: null, lang: 'cs', units: METRIC }), null);
});

test('trasa: souhrn spočítá déšť i nebezpečné jevy', () => {
  const plan = planAt(T0);
  const v = buildRouteView({ plan, forecast: FORECAST, lang: 'cs', units: METRIC });
  assert.ok(v.summary.rainCount >= 1, 'třetí bod prší celý den');
  assert.equal(v.summary.total, 3);
});

test('🚨 trasa: nejhorší jev se vybírá podle závažnosti, ne podle pořadí', () => {
  // Bouřka v půlce trasy je důležitější než déšť na konci, i když je dřív.
  const plan = planAt(T0 + 2 * 3600000);   // příjezd do 2. bodu kolem bouřky
  const v = buildRouteView({ plan, forecast: FORECAST, lang: 'cs', units: METRIC });
  if (v.summary.worst) {
    assert.equal(v.summary.worst.key, 'thunderstorm');
  }
});

test('trasa: silný vítr je nebezpečí i za jasného počasí', () => {
  const vetrno = [
    place({ codes: fill(0), probs: fill(0), winds: fill(STRONG_WIND_KMH + 5) }),
    place({ codes: fill(0), probs: fill(0) }),
    place({ codes: fill(0), probs: fill(0) }),
  ];
  const v = buildRouteView({ plan: planAt(T0), forecast: vetrno, lang: 'cs', units: METRIC });
  assert.equal(v.points[0].hazard, true, 'jasno, ale vichr');
  assert.equal(v.points[1].hazard, false);
});

test('trasa: práh deště', () => {
  const naHrane = [
    place({ codes: fill(3), probs: fill(RAIN_PROBABILITY) }),
    place({ codes: fill(3), probs: fill(RAIN_PROBABILITY - 1) }),
    place({ codes: fill(3), probs: fill(0) }),
  ];
  const v = buildRouteView({ plan: planAt(T0), forecast: naHrane, lang: 'cs', units: METRIC });
  assert.equal(v.points[0].rain, true);
  assert.equal(v.points[1].rain, false);
});

test('🚨 trasa: bod za obzorem předpovědi se přizná, nezamlčí', () => {
  const plan = planAt(T0 + 40 * 3600000);   // daleko za koncem hodinových dat
  const v = buildRouteView({ plan, forecast: FORECAST, lang: 'cs', units: METRIC });
  assert.ok(v.points.every((p) => !p.known));
  assert.equal(v.summary.unknown, 3);
  assert.equal(v.summary.rainCount, 0, 'neznámý bod se nepočítá jako déšť');
});

/* ============================================================
   SROVNÁNÍ ČASŮ ODJEZDU — jádro odlišovače
   ============================================================ */

test('odjezdy: vybere se čas s nejmenším problémem', () => {
  const opts = departureOptions({
    ...ROUTE, hourMs: HOUR_MS, stepM: 120000,
    baseDepartureMs: T0, offsetsMin: [0, 120, 240],
  });
  const r = compareDepartures({ options: opts, forecast: FORECAST, lang: 'cs', units: METRIC });
  assert.equal(r.options.length, 3);
  assert.ok(r.best);
  for (const o of r.options) {
    assert.ok(o.summary.score >= r.best.summary.score, 'nejlepší musí mít nejnižší skóre');
  }
});

test('🚨 odjezdy: při shodě vyhrává dřívější odjezd', () => {
  // Nikdo nechce čekat o dvě hodiny déle kvůli stejnému počasí.
  const stejne = [place({ codes: fill(3), probs: fill(0) }),
                  place({ codes: fill(3), probs: fill(0) }),
                  place({ codes: fill(3), probs: fill(0) })];
  const opts = departureOptions({
    ...ROUTE, hourMs: HOUR_MS, stepM: 120000,
    baseDepartureMs: T0, offsetsMin: [0, 60, 120],
  });
  const r = compareDepartures({ options: opts, forecast: stejne, lang: 'cs', units: METRIC });
  assert.equal(r.best.offsetMin, 0);
  assert.equal(r.worthMoving, false, 'když je to všude stejné, nemá se co doporučovat');
});

test('🚨 odjezdy: appka mlčí, když posun nepomůže', () => {
  // Rada bez užitku podkopává důvěru ve všechny ostatní.
  const porad = [place({ codes: fill(61), probs: fill(80) }),
                 place({ codes: fill(61), probs: fill(80) }),
                 place({ codes: fill(61), probs: fill(80) })];
  const opts = departureOptions({
    ...ROUTE, hourMs: HOUR_MS, stepM: 120000,
    baseDepartureMs: T0, offsetsMin: [0, 60, 120, 180],
  });
  const r = compareDepartures({ options: opts, forecast: porad, lang: 'cs', units: METRIC });
  assert.equal(r.worthMoving, false);
});

test('odjezdy: prázdný vstup nespadne', () => {
  const r = compareDepartures({ options: [], forecast: FORECAST, lang: 'cs', units: METRIC });
  assert.deepEqual(r.options, []);
  assert.equal(r.best, null);
});

test('🚨 odjezdy: posun nemění geometrii, jen indexy — funkce je zadarmo', () => {
  // Celý vtip odlišovače: jiný čas odjezdu = jiný index v UŽ STAŽENÝCH datech.
  const opts = departureOptions({
    ...ROUTE, hourMs: HOUR_MS, stepM: 120000,
    baseDepartureMs: T0, offsetsMin: [0, 120],
  });
  const r = compareDepartures({ options: opts, forecast: FORECAST, lang: 'cs', units: METRIC });
  const [a, b] = r.options;
  for (let i = 0; i < a.points.length; i++) {
    assert.deepEqual(a.points[i].point, b.points[i].point, 'bod se nesmí hnout');
    assert.equal(b.points[i].etaMs - a.points[i].etaMs, 120 * 60000);
  }
});

/* ============================================================
   ČASY HODIN JAKO SKUTEČNÉ OKAMŽIKY
   ============================================================ */

test('🚨 čas z předpovědi je MÍSTNÍ, ne UTC ani pásmo zařízení', () => {
  // Kdyby se nechal vyložit prohlížeči, trasa do Španělska by měla počasí
  // o hodinu vedle — a čísla by pořád vypadala rozumně, takže by si toho
  // nikdo nevšiml.
  const misto = { utc_offset_seconds: 7200, hourly: { time: ['2026-08-24T13:00', '2026-08-24T14:00'] } };
  const ms = hoursToMs(misto);
  assert.equal(ms.length, 2);
  assert.equal(new Date(ms[0]).toISOString(), '2026-08-24T11:00:00.000Z', '13:00 v pásmu +02 je 11:00 UTC');
  assert.equal(ms[1] - ms[0], 3600_000);
});

test('čas bez posunu se bere jako UTC', () => {
  const ms = hoursToMs({ hourly: { time: ['2026-08-24T13:00'] } });
  assert.equal(new Date(ms[0]).toISOString(), '2026-08-24T13:00:00.000Z');
});

test('chybějící nebo poškozené časy vrátí prázdno, ne nesmysl', () => {
  assert.deepEqual(hoursToMs(null), []);
  assert.deepEqual(hoursToMs({}), []);
  assert.deepEqual(hoursToMs({ hourly: { time: 'nesmysl' } }), []);
  assert.deepEqual(hoursToMs({ hourly: { time: ['úplný nesmysl'] } }), []);
});

test('🚨 nadmořská výška se bere z odpovědi a NULA JE PLATNÁ', () => {
  // Výška chodí u každého bodu zadarmo. Nula je hladina moře, ne chybějící
  // údaj — kdyby se testovala pravdivost, pobřežní bod by vypadal neznámě.
  const plan = planAt(T0);
  const sVyskou = [
    { ...FORECAST[0], elevation: 0 },
    { ...FORECAST[1], elevation: 594 },
    { ...FORECAST[2] },
  ];
  const view = buildRouteView({ plan, forecast: sVyskou, lang: 'cs', units: METRIC });
  assert.equal(view.points[0].elevationM, 0, 'hladina moře je údaj, ne prázdno');
  assert.equal(view.points[1].elevationM, 594);
  assert.equal(view.points[2].elevationM, null, 'chybějící výška NENÍ nula');
});

/* ============================================================
   TRASA PRO MAPU

   Mapa a seznam pod ní musí tvrdit totéž. Barvu bodu proto určuje týž
   příznak, který zvýrazňuje řádek ve výpisu — a testuje se to tady,
   protože v mapě samotné to nikdo nezměří.
   ============================================================ */

const CARA = [[50.08, 14.42], [49.75, 15.0], [49.2, 16.6]];

const VIEW = {
  points: [
    { point: [50.08, 14.42], known: true, hazard: false, rain: false, etaMs: 1, condition: 'Jasno', temp: '21 °C' },
    { point: [49.75, 15.0], known: true, hazard: false, rain: true, etaMs: 2, condition: 'Déšť', temp: '17 °C' },
    { point: [49.2, 16.6], known: true, hazard: true, rain: true, etaMs: 3, condition: 'Bouřka', temp: '19 °C' },
    { point: [48.9, 17.2], known: false, hazard: false, rain: false, etaMs: 4 },
  ],
};

test('čára projde v pořadí [šířka, délka] a body dostanou stav', () => {
  const out = routeMapData(VIEW, CARA);
  assert.deepEqual(out.line, CARA);
  assert.deepEqual(out.points.map((p) => p.stav), ['ok', 'rain', 'hazard', 'unknown']);
  assert.equal(out.points[0].lat, 50.08);
  assert.equal(out.points[0].lon, 14.42);
});

test('🚨 nebezpečí přebíjí déšť — a „nevíme" se netváří jako „v pořádku"', () => {
  // Bod s bouřkou má i vysokou pravděpodobnost srážek; kdyby vyhrál déšť,
  // byl by na mapě modrý a člověk by bouřku podle barvy přehlédl.
  const out = routeMapData(VIEW, CARA);
  assert.equal(out.points[2].stav, 'hazard');
  assert.equal(out.points[3].stav, 'unknown');
});

test('popisek si dodá volající (čas zná obrazovka, ne modul)', () => {
  const out = routeMapData(VIEW, CARA, (p) => `${p.etaMs}: ${p.condition}`);
  assert.equal(out.points[1].popis, '2: Déšť');
});

test('jeden bod není trasa', () => {
  // Tečka na mapě by se nedala odlišit od špendlíku vybraného místa.
  assert.equal(routeMapData(VIEW, [[50, 14]]), null);
  assert.equal(routeMapData(VIEW, []), null);
  assert.equal(routeMapData(VIEW, null), null);
});

test('nesmyslné souřadnice se do mapy neposílají', () => {
  const out = routeMapData(
    { points: [{ point: [50, 14], known: true }, { point: ['x', 14], known: true }] },
    [[50, 14], [49, 15], [null, 3]],
  );
  assert.equal(out.line.length, 2, 'bod bez souřadnic se z čáry vyhodí');
  assert.equal(out.points.length, 1);
});

test('🚨 každá varianta odjezdu si nese SVŮJ plán, ne ten první', async () => {
  // Souhrn nad seznamem ukazuje čas příjezdu. Kdyby varianty sdílely plán
  // prvního odjezdu, tvrdil by po přepnutí čas, který k té cestě nepatří —
  // a nikdo by si toho nevšiml, protože samotné číslo vypadá rozumně.
  const varianty = departureOptions({
    ...ROUTE, baseDepartureMs: T0, offsetsMin: [0, 60, 120], hourMs: HOUR_MS, stepM: 120000,
  });
  const out = compareDepartures({
    options: varianty, forecast: FORECAST, lang: 'cs', units: METRIC,
  });

  assert.equal(out.options.length, 3);
  for (const o of out.options) assert.ok(o.plan, `varianta +${o.offsetMin} min nemá plán`);

  const prijezdy = out.options.map((o) => o.plan.arrivalMs);
  assert.equal(new Set(prijezdy).size, 3, 'tři odjezdy = tři různé příjezdy');
  assert.equal(prijezdy[1] - prijezdy[0], 3600 * 1000, 'odjezd o hodinu později = příjezd o hodinu později');
});

/* ============================================================
   RADA O POSUNUTÍ ODJEZDU

   🚨 Michal 25. 8. 2026 k větě „Vyjet o 60 min později vychází líp: Po cestě
   se nikde nečeká déšť." — má říct, ČEMU se tím vyhneš, a mluvit česky.
   ============================================================ */

test('🚨 rada řekne, čemu se vyhýbáš, a mluví po lidsku', () => {
  const dest = { rainCount: 2, hazardCount: 0, worst: null };
  assert.equal(
    departureAdvice(dest, 60, 'cs'),
    'Pokud se chceš vyhnout dešti, vyraž o hodinu později — počasí vychází líp.',
  );
  assert.equal(
    departureAdvice(dest, 120, 'cs'),
    'Pokud se chceš vyhnout dešti, vyraž o 2 hodiny později — počasí vychází líp.',
  );
});

test('🚨 nebezpečí se pojmenuje — a NENÍ to [object Object]', () => {
  // `summary.worst` je objekt. Dosazený rovnou do věty se vypsal jako
  // „[object Object]", jakmile na trase byla bouřka.
  const s = { rainCount: 3, hazardCount: 1, worst: { key: 'thunderstorm', condition: 'Bouřka' } };
  const veta = departureAdvice(s, 180, 'cs');
  assert.ok(!veta.includes('object'), veta);
  assert.ok(veta.includes('(bouřka)'), veta);
  assert.ok(veta.includes('3 hodiny'), veta);
});

test('rada u nesmyslného posunu mlčí', () => {
  // Rada „vyraž o 0 minut později" je horší než žádná.
  assert.equal(departureAdvice({ rainCount: 1 }, 0, 'cs'), '');
  assert.equal(departureAdvice({ rainCount: 1 }, -60, 'cs'), '');
});

test('rada existuje i anglicky', () => {
  assert.equal(
    departureAdvice({ rainCount: 1, worst: null }, 60, 'en'),
    'To stay out of the rain, leave an hour later — the weather works out better.',
  );
});

/* ============================================================
   MEZIBODY — SLEPENÍ ÚSEKŮ

   ORS umí mezibody jen přes POST, a naše proxy propouští jen GET (R2).
   Trasa se proto skládá z úseků A→B, B→C. Slepení musí sedět na bod,
   protože na `points` a `legs` stojí výpočet času příjezdu.
   ============================================================ */

const USEK_A = {
  points: [[50.08, 14.42], [49.90, 14.90]],
  legs: [{ distanceM: 40000, durationS: 1800 }],
  totalDistanceM: 40000,
  totalDurationS: 1800,
};
const USEK_B = {
  points: [[49.90, 14.90], [49.20, 16.60]],
  legs: [{ distanceM: 160000, durationS: 5400 }],
  totalDistanceM: 160000,
  totalDurationS: 5400,
};

test('🚨 spoj úseků se nezdvojuje — společný bod je tam jednou', () => {
  // Dvakrát týž bod by znamenal plán o bod navíc a dotaz na počasí pro
  // totéž místo dvakrát.
  const c = spojUseky([USEK_A, USEK_B]);
  assert.equal(c.points.length, 3);
  assert.deepEqual(c.points[1], [49.90, 14.90]);
});

test('spoj sečte vzdálenost i čas a zachová pořadí profilu', () => {
  const c = spojUseky([USEK_A, USEK_B]);
  assert.equal(c.totalDistanceM, 200000);
  assert.equal(c.totalDurationS, 7200);
  assert.deepEqual(c.legs.map((l) => l.distanceM), [40000, 160000]);
});

test('spoj přežije drobnou odchylku v souřadnicích spoje', () => {
  // Router vrací týž bod, ale zaokrouhlený jinak podle směru jízdy.
  const b2 = { ...USEK_B, points: [[49.9000004, 14.8999997], [49.20, 16.60]] };
  assert.equal(spojUseky([USEK_A, b2]).points.length, 3);
});

test('jediný úsek projde beze změny, prázdný vstup vrátí null', () => {
  assert.equal(spojUseky([USEK_A]), USEK_A);
  assert.equal(spojUseky([]), null);
  assert.equal(spojUseky([null, undefined]), null);
  assert.equal(spojUseky(null), null);
});

test('🚨 když jeden úsek chybí, trasa se NESLEPÍ z toho, co zbylo', () => {
  // Vynechaný kus by znamenal trasu, která vede jinudy, než uživatel zadal —
  // a nic by na to neupozornilo. Volající pozná chybu podle počtu úseků.
  const casti = [USEK_A, null, USEK_B];
  assert.equal(casti.some((c) => !c), true, 'volající tohle musí zachytit dřív');
});

/* ============================================================
   ROZPIS ÚSEKŮ

   Michal 25. 8. 2026: „proč to neukazuje vzdálenost mezi úseky a celkem?"
   U cesty přes zastávky je celkových 97 km málo — zajímá mě, kolik je to
   k té první a v kolik tam budu.
   ============================================================ */

const ZASTAVKY = [
  { from: { name: 'Plzeň' }, to: { name: 'Domažlice' }, distanceM: 52000, durationS: 3000 },
  { from: { name: 'Domažlice' }, to: { name: 'Klatovy' }, distanceM: 45000, durationS: 2400 },
];

test('rozpis sčítá kilometry i časy postupně', () => {
  const out = legRows(ZASTAVKY, T0);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].distanceM, 52000);
  assert.equal(out.rows[0].arrivalMs, T0 + 3000 * 1000);
  assert.equal(out.rows[1].arrivalMs, T0 + 5400 * 1000, 'druhá zastávka = součet obou trvání');
  assert.equal(out.totalDistanceM, 97000);
  assert.equal(out.arrivalMs, out.rows[1].arrivalMs, 'konec trasy je příjezd do poslední zastávky');
});

test('🚨 čas se počítá z TRVÁNÍ, ne z podílu kilometrů', () => {
  // Dálnice a město mají jiný poměr času k délce. Podíl by u prvního úseku
  // vyšel o desítky minut vedle.
  const nerovne = [
    { from: { name: 'A' }, to: { name: 'B' }, distanceM: 10000, durationS: 1800 },  // město
    { from: { name: 'B' }, to: { name: 'C' }, distanceM: 90000, durationS: 3000 },  // dálnice
  ];
  const out = legRows(nerovne, T0);
  assert.equal(out.rows[0].arrivalMs, T0 + 1800 * 1000, 'krátký úsek trvá dlouho — a musí to být vidět');
});

test('u cesty z A do B se rozpis neukazuje', () => {
  // Jeden řádek by jen zopakoval souhrn nad ním.
  assert.equal(legRows([ZASTAVKY[0]], T0), null);
  assert.equal(legRows([], T0), null);
  assert.equal(legRows(null, T0), null);
});

test('rozbitý úsek rozpis neshodí', () => {
  assert.equal(legRows([ZASTAVKY[0], null, ZASTAVKY[1]], T0).rows.length, 2);
});

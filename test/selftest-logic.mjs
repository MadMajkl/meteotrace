/**
 * Samotest čisté logiky — bez prohlížeče, bez sítě, bez DOM.
 *
 * Vzor: mailniño `npm run selftest:logic`. Je to nejlevnější test v projektu,
 * proto sem patří KAŽDÁ nová úvaha o čase, vzdálenosti nebo výběru hodiny.
 * Když se dá něco ověřit tady, nemá to co dělat v testu s prohlížečem.
 *
 * Spuštění:  npm run selftest:logic
 *
 * ⚠️ Tenhle test nesmí nikdy sáhnout na síť ani na skutečná data. Když bude
 *    potřeba odpověď z API, přibalí se jako fixture, nestáhne se.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  distanceM,
  cumulativeDistances,
  sampleRoute,
  durationToDistance,
  hourIndexFor,
  planRoute,
  departureOptions,
} from '../web/lib/eta.js';

/* ============================================================
   POMŮCKY
   ============================================================ */

const PRAHA = [50.0755, 14.4378];
const BRNO  = [49.1951, 16.6068];

/** Pole časů hodin jako epoch ms, od zadaného ISO řetězce. */
function hoursFrom(iso, count) {
  const start = Date.parse(iso);
  return Array.from({ length: count }, (_, i) => start + i * 3600000);
}

/** Rovná trasa z bodů, ať se dá počítat na papíře. */
const STRAIGHT = [[50, 14], [50, 15], [50, 16]];

/* ============================================================
   VZDÁLENOST
   ============================================================ */

test('vzdálenost: stejný bod je nula', () => {
  assert.equal(distanceM(PRAHA, PRAHA), 0);
});

test('vzdálenost: jeden stupeň šířky je zhruba 111,2 km', () => {
  const d = distanceM([50, 14], [51, 14]);
  assert.ok(Math.abs(d - 111195) < 300, `čekáno ~111 195 m, vyšlo ${Math.round(d)}`);
});

test('vzdálenost: Praha–Brno vzdušnou čarou je zhruba 185 km', () => {
  const d = distanceM(PRAHA, BRNO);
  assert.ok(d > 183000 && d < 187000, `čekáno 183–187 km, vyšlo ${Math.round(d / 1000)} km`);
});

test('vzdálenost je symetrická', () => {
  assert.equal(distanceM(PRAHA, BRNO), distanceM(BRNO, PRAHA));
});

test('vzdálenost: přes 180. poledník se nepočítá dokola', () => {
  // Klasická past: naivní odečet délek dá 358°, správně jsou 2°.
  const d = distanceM([0, 179], [0, -179]);
  assert.ok(d < 230000, `čekáno ~222 km, vyšlo ${Math.round(d / 1000)} km`);
});

/* ============================================================
   PRŮBĚŽNÉ VZDÁLENOSTI
   ============================================================ */

test('průběžné vzdálenosti: první je vždy nula a řada roste', () => {
  const cum = cumulativeDistances(STRAIGHT);
  assert.equal(cum.length, 3);
  assert.equal(cum[0], 0);
  assert.ok(cum[1] > 0 && cum[2] > cum[1]);
});

test('průběžné vzdálenosti: shodné body za sebou nepřidají nic', () => {
  const cum = cumulativeDistances([[50, 14], [50, 14], [50, 15]]);
  assert.equal(cum[1], 0);
  assert.ok(cum[2] > 0);
});

/* ============================================================
   VZORKOVÁNÍ TRASY
   ============================================================ */

test('vzorkování: prázdná trasa vrátí prázdno, ne pád', () => {
  assert.deepEqual(sampleRoute([]), []);
  assert.deepEqual(sampleRoute(null), []);
});

test('vzorkování: jeden bod vrátí jeden vzorek', () => {
  const s = sampleRoute([PRAHA]);
  assert.equal(s.length, 1);
  assert.equal(s[0].distanceM, 0);
});

test('vzorkování: start i cíl jsou v seznamu vždy', () => {
  const s = sampleRoute(STRAIGHT, 25000);
  assert.deepEqual(s[0].point, STRAIGHT[0]);
  assert.deepEqual(s[s.length - 1].point, STRAIGHT[2]);
});

test('vzorkování: trasa kratší než krok dá právě start a cíl', () => {
  // Past, na kterou se dá naletět: kdyby se vzorkovalo jen v násobcích kroku,
  // desetikilometrová cesta by vrátila jediný bod a funkce by mlčky selhala.
  const s = sampleRoute([[50, 14], [50.05, 14]], 25000);
  assert.equal(s.length, 2);
  assert.equal(s[0].distanceM, 0);
  assert.ok(s[1].distanceM > 5000);
});

test('vzorkování: krok drží rozestup', () => {
  const s = sampleRoute(STRAIGHT, 20000);
  for (let i = 1; i < s.length - 1; i++) {
    assert.equal(s[i].distanceM - s[i - 1].distanceM, 20000);
  }
});

test('vzorkování: cíl se nepřidá dvakrát, když na něj krok trefí přesně', () => {
  const line = [[50, 14], [51, 14]];                 // ~111 195 m
  const total = cumulativeDistances(line)[1];
  const s = sampleRoute(line, total);                 // krok = přesně délka trasy
  const distances = s.map((x) => Math.round(x.distanceM));
  assert.deepEqual(distances, [0, Math.round(total)]);
});

test('vzorkování: nulový krok je chyba, ne nekonečná smyčka', () => {
  assert.throws(() => sampleRoute(STRAIGHT, 0), RangeError);
  assert.throws(() => sampleRoute(STRAIGHT, -1), RangeError);
});

/* ============================================================
   ČAS PODLE VZDÁLENOSTI
   ============================================================ */

const FLAT = { totalDistanceM: 100000, totalDurationS: 3600 };

test('čas: začátek je nula, konec je celá doba', () => {
  assert.equal(durationToDistance(0, FLAT), 0);
  assert.equal(durationToDistance(100000, FLAT), 3600);
  assert.equal(durationToDistance(999999, FLAT), 3600);   // za cílem se nepokračuje
});

test('čas: bez úseků se spadne na úměru', () => {
  assert.equal(durationToDistance(50000, FLAT), 1800);
});

test('čas: rychlostní profil porazí úměru', () => {
  // 10 km městem za 20 minut, pak 90 km po dálnici za 40 minut.
  // V polovině trasy (50 km) je úměra vedle o dvacet minut.
  const profile = {
    totalDistanceM: 100000,
    totalDurationS: 3600,
    legs: [
      { distanceM: 10000, durationS: 1200 },
      { distanceM: 90000, durationS: 2400 },
    ],
  };
  const proportional = 1800;                       // co by dala úměra
  const real = durationToDistance(50000, profile); // 1200 + 2400 * (40/90)
  assert.equal(Math.round(real), 2267);
  assert.ok(Math.abs(real - proportional) > 400, 'profil se musí lišit od úměry');
});

test('čas: konec městského úseku sedí přesně na jeho hranici', () => {
  const profile = {
    totalDistanceM: 100000, totalDurationS: 3600,
    legs: [{ distanceM: 10000, durationS: 1200 }, { distanceM: 90000, durationS: 2400 }],
  };
  assert.equal(durationToDistance(10000, profile), 1200);
});

test('čas: úsek nulové délky nezpůsobí dělení nulou', () => {
  const profile = {
    totalDistanceM: 1000, totalDurationS: 60,
    legs: [{ distanceM: 0, durationS: 5 }, { distanceM: 1000, durationS: 55 }],
  };
  const t = durationToDistance(500, profile);
  assert.ok(Number.isFinite(t), 'čas musí být konečné číslo');
});

test('čas: nulová trasa nevrací NaN', () => {
  const t = durationToDistance(100, { totalDistanceM: 0, totalDurationS: 0 });
  assert.equal(t, 0);
});

/* ============================================================
   VÝBĚR HODINY PŘEDPOVĚDI
   ============================================================ */

const HOURS = hoursFrom('2026-08-21T00:00:00Z', 48);

test('hodina: přesná shoda trefí svůj index', () => {
  assert.equal(hourIndexFor(Date.parse('2026-08-21T05:00:00Z'), HOURS), 5);
});

test('hodina: zaokrouhluje se na NEJBLIŽŠÍ, ne dolů', () => {
  // Kdo dorazí v 15:55, toho zajímá počasí v 16:00, ne v 15:00.
  assert.equal(hourIndexFor(Date.parse('2026-08-21T15:55:00Z'), HOURS), 16);
  assert.equal(hourIndexFor(Date.parse('2026-08-21T15:05:00Z'), HOURS), 15);
});

test('hodina: přesná půlka se přikloní k dřívější', () => {
  assert.equal(hourIndexFor(Date.parse('2026-08-21T15:30:00Z'), HOURS), 15);
});

test('hodina: mimo rozsah vrátí null, ne pád ani nulu', () => {
  // Není to chyba — kdo plánuje cestu na příští měsíc, je za obzorem modelu.
  assert.equal(hourIndexFor(Date.parse('2026-08-20T00:00:00Z'), HOURS), null);
  assert.equal(hourIndexFor(Date.parse('2026-09-01T00:00:00Z'), HOURS), null);
});

test('hodina: prázdné pole vrátí null', () => {
  assert.equal(hourIndexFor(Date.now(), []), null);
  assert.equal(hourIndexFor(Date.now(), null), null);
});

test('hodina: zvládne i tříhodinový rastr', () => {
  // Open-Meteo umí u vzdálenějších modelů vracet řidší krok.
  const start = Date.parse('2026-08-21T00:00:00Z');
  const coarse = Array.from({ length: 10 }, (_, i) => start + i * 3 * 3600000);
  assert.equal(hourIndexFor(start + 3600000 * 4, coarse), 1);   // 04:00 → nejblíž 03:00
  assert.equal(hourIndexFor(start + 3600000 * 5, coarse), 2);   // 05:00 → nejblíž 06:00
});

/* ============================================================
   LETNÍ ČAS — nejdůležitější test v souboru
   ============================================================ */

test('letní čas: podzimní přechod neposune příjezd o hodinu', () => {
  // V ČR se 25. 10. 2026 ve 3:00 SELČ vrací čas na 2:00 SEČ — ten den má
  // 25 hodin. Kdo počítá příjezd přičítáním hodin k MÍSTNÍMU času, minul
  // by o hodinu. My počítáme v epoch ms, kde žádný přechod není.
  const departure = Date.parse('2026-10-24T22:30:00Z');   // 00:30 SELČ
  const fourHours = 4 * 3600000;
  const arrival = departure + fourHours;

  // Ověř, že místní čas OPRAVDU dělá ten skok (jinak by test nic nedokazoval).
  const fmt = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  assert.equal(fmt.format(new Date(departure)), '00:30');
  assert.equal(fmt.format(new Date(arrival)), '03:30');   // ne 04:30 — hodina se opakovala

  // A že výběr hodiny přesto trefí správný absolutní čas.
  const hours = hoursFrom('2026-10-24T22:00:00Z', 12);
  assert.equal(hourIndexFor(arrival, hours), 4);          // 4 hodiny po 22:00 UTC
});

test('letní čas: jarní přechod taky sedí', () => {
  // 29. 3. 2026 ve 2:00 SEČ skáče čas na 3:00 SELČ — den má 23 hodin.
  const departure = Date.parse('2026-03-29T00:30:00Z');   // 01:30 SEČ
  const arrival = departure + 2 * 3600000;
  const fmt = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  assert.equal(fmt.format(new Date(departure)), '01:30');
  assert.equal(fmt.format(new Date(arrival)), '04:30');   // ne 03:30 — hodina zmizela
});

/* ============================================================
   SLOŽENÝ VÝPOČET
   ============================================================ */

const PLAN_ARGS = {
  points: STRAIGHT,
  totalDistanceM: cumulativeDistances(STRAIGHT)[2],
  totalDurationS: 7200,
  departureMs: Date.parse('2026-08-21T06:00:00Z'),
  hourMs: HOURS,
  stepM: 25000,
};

test('plán: každý bod má čas i index hodiny', () => {
  const r = planRoute(PLAN_ARGS);
  assert.ok(r.points.length >= 2);
  for (const p of r.points) {
    assert.ok(Number.isFinite(p.etaMs), 'etaMs musí být číslo');
    assert.ok(p.hourIndex !== null, 'v dosahu předpovědi musí index existovat');
  }
});

test('plán: časy jdou po sobě a nikdy nezpátky', () => {
  const r = planRoute(PLAN_ARGS);
  for (let i = 1; i < r.points.length; i++) {
    assert.ok(r.points[i].etaMs >= r.points[i - 1].etaMs, 'čas se nesmí vracet');
  }
});

test('plán: první bod je čas odjezdu, poslední čas příjezdu', () => {
  const r = planRoute(PLAN_ARGS);
  assert.equal(r.points[0].etaMs, PLAN_ARGS.departureMs);
  assert.equal(r.points[r.points.length - 1].etaMs, r.arrivalMs);
});

test('plán: bez rychlostního profilu se přizná odhad', () => {
  assert.equal(planRoute(PLAN_ARGS).estimated, true);
  const withLegs = planRoute({
    ...PLAN_ARGS,
    legs: [{ distanceM: PLAN_ARGS.totalDistanceM, durationS: 7200 }],
  });
  assert.equal(withLegs.estimated, false);
});

test('plán: cesta za obzor předpovědi se označí, ne zamlčí', () => {
  const r = planRoute({ ...PLAN_ARGS, departureMs: Date.parse('2026-08-25T06:00:00Z') });
  assert.equal(r.beyondForecast, true);
  assert.ok(r.points.some((p) => p.hourIndex === null));
});

/* ============================================================
   SROVNÁNÍ ČASŮ ODJEZDU
   ============================================================ */

test('odjezdy: každý posun dá vlastní čas příjezdu', () => {
  const opts = departureOptions({
    ...PLAN_ARGS,
    baseDepartureMs: PLAN_ARGS.departureMs,
    offsetsMin: [-60, 0, 60, 120],
  });
  assert.equal(opts.length, 4);
  for (let i = 1; i < opts.length; i++) {
    assert.ok(opts[i].plan.arrivalMs > opts[i - 1].plan.arrivalMs);
  }
});

test('odjezdy: posun mění POUZE indexy hodin, ne geometrii', () => {
  // Tohle je celý vtip funkce: body trasy jsou pořád tytéž, mění se jen to,
  // do které hodiny už stažených dat se sáhne. Žádný další dotaz na server.
  const opts = departureOptions({
    ...PLAN_ARGS,
    baseDepartureMs: PLAN_ARGS.departureMs,
    offsetsMin: [0, 120],
  });
  const [a, b] = opts;
  assert.equal(a.plan.points.length, b.plan.points.length);
  for (let i = 0; i < a.plan.points.length; i++) {
    assert.deepEqual(a.plan.points[i].point, b.plan.points[i].point, 'bod se nesmí hnout');
    assert.equal(b.plan.points[i].hourIndex - a.plan.points[i].hourIndex, 2, 'index +2 h');
  }
});

test('odjezdy: nulový posun se rovná prostému plánu', () => {
  const [only] = departureOptions({
    ...PLAN_ARGS, baseDepartureMs: PLAN_ARGS.departureMs, offsetsMin: [0],
  });
  assert.deepEqual(only.plan, planRoute(PLAN_ARGS));
});

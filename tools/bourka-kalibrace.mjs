/**
 * Kalibrace upozornění na bouřku (`R37`) — na SKUTEČNÝCH datech ČHMÚ.
 *
 *   node tools/bourka-kalibrace.mjs 2026-10-08T11:00Z/2026-10-08T22:30Z [další okna…]
 *
 * Pro mřížku bodů po Česku (~1 300, po ~8 km) a každých 5 minut zavolá
 * PRODUKČNÍ kód — `stavBourky` (stažení a čtení radaru) a `bourkaProMisto`
 * (pravidlo) — a porovná upozornění s tím, co pak radar opravdu viděl:
 *
 *   · zásah = souvislé jádro ≥ 48 dBZ do 3 km od bodu (nová událost po 2 h),
 *   · včas = upozornění aspoň 10 min před zásahem (počítá se i zpoždění:
 *     běh vyjde ~5 min po svém čase, telefon se ptá v průměru za 7,5 min),
 *   · planý poplach = do 90 min po upozornění žádné jádro do 20 km.
 *
 * ⚠️ Měří se produkční kód, ne jeho kopie. Kdo změní práh v `storm-watch.js`,
 * pustí tohle a vidí, co změna udělala. ČHMÚ drží data 7 dní zpátky —
 * letní bouřku je potřeba přeměřit do týdne.
 *
 * ⚠️ Stahuje ~7 souborů na krok (~250 kB). Den po pěti minutách = ~70 MB.
 */

import { stavBourky } from '../server/chmi-storm.js';
import { bourkaProMisto, pixelBodu, kmNaPixel } from '../web/lib/storm-watch.js';
import { unpackAreas, findArea } from '../web/lib/orp.js';
import { ORP_DATA } from '../web/data/orp-boundaries.js';

const BASE = 'https://opendata.chmi.cz/meteorology/weather/radar/composite/';
const MIN = 60_000;

const okna = process.argv.slice(2).map((a) => a.split('/').map((s) => Date.parse(s)));
if (!okna.length || okna.some(([a, b]) => !Number.isFinite(a) || !Number.isFinite(b) || b < a)) {
  console.error('Použití: node tools/bourka-kalibrace.mjs <od>/<do> […]   (časy ISO, UTC)');
  process.exit(1);
}

// Mřížka bodů uvnitř Česka (podle vlastních hranic ORP).
const areas = unpackAreas(ORP_DATA);
const body = [];
for (let lat = 48.6; lat <= 51.05; lat += 0.072) {
  for (let lon = 12.1; lon <= 18.85; lon += 0.11) if (findArea([lat, lon], areas)) body.push({ lat, lon });
}

const kroky = [];
for (const [a, b] of okna) for (let t = a; t <= b; t += 5 * MIN) kroky.push(t);
console.log(`bodů ${body.length}, kroků ${kroky.length}`);

/** Vzdálenost nejbližšího jádra od bodu v km. */
function jadroKm(digest, b) {
  const p = pixelBodu(b.lat, b.lon);
  if (!p) return Infinity;
  let d = Infinity;
  for (const [x, y] of digest.jadra) d = Math.min(d, Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y));
  return d * kmNaPixel(b.lat);
}

// Sběr: pro každý krok upozornění a vzdálenost jádra, pro každý bod.
const data = new Map();
let hotovo = 0;
const fronta = [...kroky];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (fronta.length) {
    const t = fronta.shift();
    const nowMs = t + 3 * MIN;   // dotaz pár minut po běhu, jako ze skutečného telefonu
    try {
      const d = await stavBourky({ fetchImpl: fetch, base: BASE, nowMs });
      data.set(t, body.map((b) => [bourkaProMisto(d, { ...b, nowMs }).stav === 'bourka', jadroKm(d, b)]));
    } catch (e) {
      data.set(t, null);
    }
    if (++hotovo % 24 === 0) console.log(`  … ${hotovo}/${kroky.length}`);
  }
}));

// Rozbor.
const ZPOZDENI = 5 * MIN + 7.5 * MIN;
let zasahu = 0; let vcas = 0; let pozde = 0; let minuto = 0; let epizod = 0; let plane = 0;
const predstihy = [];
for (let i = 0; i < body.length; i++) {
  const radky = kroky.filter((t) => data.get(t)).map((t) => [t, ...data.get(t)[i]]);
  const epi = [];
  for (const [t, alarm] of radky) {
    if (!alarm) continue;
    const posledni = epi[epi.length - 1];
    if (posledni && t - posledni[1] <= 60 * MIN) posledni[1] = t; else epi.push([t, t]);
  }
  let posZ = -Infinity;
  for (const [t, , km] of radky) {
    if (km > 3) continue;
    if (t - posZ > 120 * MIN) {
      zasahu++;
      const e = epi.find(([a, b]) => a <= t && t - b < 60 * MIN);
      if (!e) minuto++;
      else if (t - (e[0] + ZPOZDENI) >= 10 * MIN) { vcas++; predstihy.push((t - e[0] - ZPOZDENI) / MIN); } else pozde++;
    }
    posZ = t;
  }
  for (const [a] of epi) {
    epizod++;
    if (!radky.some(([t, , km]) => t >= a && t <= a + 90 * MIN && km <= 20)) plane++;
  }
}
predstihy.sort((a, b) => a - b);
const q = (x) => (predstihy.length ? predstihy[Math.floor(predstihy.length * x)].toFixed(0) : '—');
const chybi = kroky.filter((t) => !data.get(t)).length;
console.log(`
zásahů bouřkou:   ${zasahu}
  včas (≥ 10 min): ${vcas} (${zasahu ? Math.round((100 * vcas) / zasahu) : 0} %)
  pozdě:           ${pozde}
  vůbec:           ${minuto}
předstih:         medián ${q(0.5)} min, čtvrtina pod ${q(0.25)} min
upozornění:       ${epizod}, z toho planých (bez jádra do 20 km) ${plane} (${epizod ? Math.round((100 * plane) / epizod) : 0} %)
kroků bez dat:    ${chybi}`);

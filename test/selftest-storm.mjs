/**
 * Samotest bouřky z radaru (`R37`) — čtení PNG, jádra, předpověď,
 * rozhodnutí pro místo, věta, katalog a stavitel na serveru.
 *
 * Bez prohlížeče a bez sítě. Skutečná bouřka z 8. 10. 2026 je ve výřezu
 * `test/data/bourka-2026-10-08.json`. Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

import { prectiPng } from '../web/lib/png-index.js';
import {
  STUPNICE, tabulkaOdrazivosti, souvislaJadra, stopaPredpovedi, pixelBodu, kmNaPixel,
  bourkaProMisto, textBourky, odpovedProMisto, nazevSnimku, SIRKA, VYSKA, TICHO_MIN,
  NEJSTARSI_POZOROVANI_MS,
} from '../web/lib/storm-watch.js';
import { UPSTREAMS, cacheKey } from '../web/lib/upstreams.js';
import { planRequest, filterByPlace } from '../web/lib/proxy-core.js';
import { stavBourky } from '../server/chmi-storm.js';
import { serveProxy, zapomenVypadky } from '../server/proxy.js';
import { createCache } from '../web/lib/ttl-cache.js';

const inflate = (d) => new Uint8Array(inflateSync(d));

/* ============================================================
   POMOCNÍCI: vlastní zápis PNG a .tar
   ⚠️ Zápis PNG tady je ZÁMĚRNĚ jiná cesta než čtení (`R18`): filtry se
   počítají dopředu a čtečka je musí vrátit. Shoda dvou kopií téhož kódu
   by o správnosti neřekla nic.
   ============================================================ */

function paletaCHMU() {
  const p = new Uint8Array(256 * 3);
  for (const [i, hex] of STUPNICE) {
    p[3 * i] = parseInt(hex.slice(0, 2), 16);
    p[3 * i + 1] = parseInt(hex.slice(2, 4), 16);
    p[3 * i + 2] = parseInt(hex.slice(4, 6), 16);
  }
  // Šedá škála od 240 — s bílou #fcfcfc na začátku, jako u ČHMÚ.
  for (let i = 240; i < 256; i++) p.fill(0xfc - (i - 240) * 14, 3 * i, 3 * i + 3);
  return p;
}

function blok(druh, data) {
  const b = new Uint8Array(12 + data.length);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) b[4 + i] = druh.charCodeAt(i);
  b.set(data, 8);
  return b;   // CRC čtečka nekontroluje; nuly stačí
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Zapíše PNG s paletou; řádky střídají všech pět filtrů. */
function zapisPng(pixely, sirka, vyska, { paleta = paletaCHMU(), barvy = 3, prokladani = 0 } = {}) {
  const syrove = new Uint8Array(vyska * (sirka + 1));
  for (let y = 0; y < vyska; y++) {
    const f = y % 5;
    syrove[y * (sirka + 1)] = f;
    for (let x = 0; x < sirka; x++) {
      const v = pixely[y * sirka + x];
      const a = x > 0 ? pixely[y * sirka + x - 1] : 0;
      const b = y > 0 ? pixely[(y - 1) * sirka + x] : 0;
      const c = x > 0 && y > 0 ? pixely[(y - 1) * sirka + x - 1] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      syrove[y * (sirka + 1) + 1 + x] = (v - pred) & 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, sirka); dv.setUint32(4, vyska);
  ihdr[8] = 8; ihdr[9] = barvy; ihdr[12] = prokladani;
  const casti = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    blok('IHDR', ihdr), blok('PLTE', paleta),
    blok('IDAT', new Uint8Array(deflateSync(syrove))), blok('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(casti.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of casti) { out.set(c, o); o += c.length; }
  return out;
}

function slozTar(soubory) {
  const kusy = [];
  for (const { jmeno, data } of soubory) {
    const h = new Uint8Array(512);
    h.set(new TextEncoder().encode(jmeno), 0);
    h.set(new TextEncoder().encode(data.length.toString(8).padStart(11, '0') + '\0'), 124);
    h[156] = 48;
    kusy.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  kusy.push(new Uint8Array(1024));
  const out = new Uint8Array(kusy.reduce((s, k) => s + k.length, 0));
  let o = 0;
  for (const k of kusy) { out.set(k, o); o += k.length; }
  return out;
}

/** Index palety pro danou odrazivost. */
const IDX = Object.fromEntries(STUPNICE.map(([i, , z]) => [z, i]));

/** Prázdný snímek 680 × 460 s „bouřkou" jako čtverec kolem (x, y). */
function snimek(bourky = []) {
  const px = new Uint8Array(SIRKA * VYSKA);
  for (const { x, y, r = 2, z = 52 } of bourky) {
    for (let j = y - r; j <= y + r; j++) for (let i = x - r; i <= x + r; i++) px[j * SIRKA + i] = IDX[z];
  }
  return px;
}

/* ============================================================
   ČTENÍ PNG
   ============================================================ */

test('PNG: čtečka vrátí přesně ty indexy, které se zapsaly (všech pět filtrů)', () => {
  const sirka = 37; const vyska = 23;
  const px = new Uint8Array(sirka * vyska).map((_, i) => (i * 97 + (i >> 3) * 13) & 255);
  const png = prectiPng(zapisPng(px, sirka, vyska), inflate);
  assert.equal(png.sirka, sirka);
  assert.equal(png.vyska, vyska);
  assert.deepEqual([...png.pixely], [...px]);
  assert.equal(png.paleta.length, 768);
});

test('🚨 PNG v jiném tvaru se odmítne — nesmí se číst „nějak"', () => {
  const px = new Uint8Array(4);
  assert.throws(() => prectiPng(zapisPng(px, 2, 2, { barvy: 6 }), inflate), /paletou/);
  assert.throws(() => prectiPng(zapisPng(px, 2, 2, { prokladani: 1 }), inflate), /prokládání/);
  assert.throws(() => prectiPng(new Uint8Array(40), inflate), /podpis/);
  assert.throws(() => prectiPng(zapisPng(px, 2, 2).subarray(0, 50), inflate), /useknut|kratší|chybí/);
});

/* ============================================================
   STUPNICE A JÁDRA
   ============================================================ */

test('stupnice ČHMÚ: indexy 181–195 jsou 60 až 4 dBZ', () => {
  const dbz = tabulkaOdrazivosti(paletaCHMU());
  assert.equal(dbz[181], 60);
  assert.equal(dbz[184], 48);
  assert.equal(dbz[195], 4);
  assert.equal(dbz[0], 0, 'průhledná = bez ozvěny');
});

test('🚨 bílá ze šedé škály NENÍ 60 dBZ — čte se index, ne barva', () => {
  const dbz = tabulkaOdrazivosti(paletaCHMU());
  assert.equal(dbz[240], 0);
});

test('🚨 přestavěná paleta = chyba, ne tiché čtení nesmyslu', () => {
  const p = paletaCHMU();
  p.copyWithin(3 * 184, 3 * 185, 3 * 186);   // 48 dBZ dostane barvu 44
  assert.throws(() => tabulkaOdrazivosti(p), /Paleta radaru se změnila/);
});

test('🚨 osamělý silný pixel NENÍ bouřka; souvislá plocha ano', () => {
  const dbz = tabulkaOdrazivosti(paletaCHMU());
  const osamely = snimek([{ x: 100, y: 100, r: 0, z: 56 }]);
  assert.deepEqual(souvislaJadra(osamely, dbz), []);
  const plocha = snimek([{ x: 100, y: 100, r: 1, z: 52 }]);   // 3 × 3
  const jadra = souvislaJadra(plocha, dbz);
  assert.ok(jadra.length >= 1);
  assert.ok(jadra.some(([x, y, z]) => x === 100 && y === 100 && z === 52));
});

test('jádro ≥ 48 dBZ v okolí ≥ 44 dBZ se počítá, i když samo okolí jádrem není', () => {
  const dbz = tabulkaOdrazivosti(paletaCHMU());
  const px = snimek([{ x: 50, y: 50, r: 1, z: 44 }]);
  px[50 * SIRKA + 50] = IDX[48];
  assert.deepEqual(souvislaJadra(px, dbz), [[50, 50, 48]]);
});

test('stopa předpovědi: každý pixel s PRVNÍM snímkem, kde má ≥ 40 dBZ', () => {
  const dbz = tabulkaOdrazivosti(paletaCHMU());
  const s20 = snimek([{ x: 10, y: 10, r: 0, z: 40 }]);
  const s10 = snimek([{ x: 12, y: 10, r: 0, z: 44 }, { x: 14, y: 10, r: 0, z: 36 }]);
  const stopa = stopaPredpovedi([{ minut: 20, pixely: s20 }, { minut: 10, pixely: s10 }], dbz);
  assert.deepEqual(stopa.sort(), [[10, 10, 20], [12, 10, 10]].sort(), '36 dBZ se nepočítá');
});

/* ============================================================
   GEOMETRIE
   ============================================================ */

test('Horšovský Týn leží na pixelu (120, 299); bod za okrajem snímku je mimo', () => {
  const b = pixelBodu(49.5296, 12.944);
  assert.ok(Math.abs(b.x - 120.0) < 0.2 && Math.abs(b.y - 299.0) < 0.2, JSON.stringify(b));
  assert.equal(pixelBodu(45.0, 12.0), null);
  assert.equal(pixelBodu(50.0, 25.0), null);
});

test('pixel má v Česku kolem 1 km', () => {
  assert.ok(Math.abs(kmNaPixel(49.5) - 1.01) < 0.01);
  assert.ok(kmNaPixel(51) < kmNaPixel(48.6));
});

test('🚨 jméno snímku je v UTC a po pětiminutách', () => {
  assert.equal(nazevSnimku(Date.parse('2026-10-08T13:28:59Z')), 'pacz2gmaps3.z_max3d.20261008.1325.0.png');
});

/* ============================================================
   ROZHODNUTÍ PRO MÍSTO
   ============================================================ */

const NOW = Date.parse('2026-10-08T13:28:30Z');
const BOD = { lat: 49.5296, lon: 12.944 };
const P = pixelBodu(BOD.lat, BOD.lon);
/** Podklad se dvěma snímky jader a stopou předpovědi. */
function podklad({ jadra = [], predtim = jadra, stopa = [], pozorovanoMs = NOW - 3 * 60e3, behMs = NOW - 8 * 60e3 } = {}) {
  return { sirka: SIRKA, vyska: VYSKA, pozorovanoMs, predtimMs: pozorovanoMs - 5 * 60e3, behMs, jadra, jadraPredtim: predtim, stopa };
}
const zapad = (km, z = 52) => [Math.floor(P.x - km), Math.floor(P.y), z];

test('bouřka 30 km na západě, předpověď ji sem dá za 40 min → upozornit', () => {
  const v = bourkaProMisto(podklad({ jadra: [zapad(30)], predtim: [zapad(34)], stopa: [[Math.floor(P.x) - 2, Math.floor(P.y), 40]] }), { ...BOD, nowMs: NOW });
  assert.equal(v.stav, 'bourka');
  assert.equal(v.smer, 'w');
  assert.equal(v.za, 32, 'běh před 8 min + 40 min');
  assert.ok(v.km >= 29 && v.km <= 31);
});

test('🚨 jádro viděné JEN JEDNOU není bouřka (kalibrace: 22–51 planých v dešti)', () => {
  const v = bourkaProMisto(podklad({ jadra: [zapad(30)], predtim: [], stopa: [[Math.floor(P.x), Math.floor(P.y), 20]] }), { ...BOD, nowMs: NOW });
  assert.equal(v.stav, 'klid');
});

test('jádro dál než 50 km nebo předpověď mimo 6 km → klid', () => {
  const daleko = podklad({ jadra: [zapad(60)], stopa: [[Math.floor(P.x), Math.floor(P.y), 20]] });
  assert.equal(bourkaProMisto(daleko, { ...BOD, nowMs: NOW }).stav, 'klid');
  const vedle = podklad({ jadra: [zapad(30)], stopa: [[Math.floor(P.x), Math.floor(P.y) + 9, 20]] });
  assert.equal(bourkaProMisto(vedle, { ...BOD, nowMs: NOW }).stav, 'klid');
});

test('jádro do 3 km dvakrát po sobě → bouřka je tady, i bez předpovědi', () => {
  const v = bourkaProMisto(podklad({ jadra: [zapad(1, 56)], predtim: [zapad(6)], stopa: null, behMs: NaN }), { ...BOD, nowMs: NOW });
  assert.equal(v.stav, 'bourka');
  assert.equal(v.za, 0);
  assert.equal(v.sila, 56);
});

test('🚨 starý radar, chybějící předpověď nebo místo mimo snímek NEJSOU klid', () => {
  const stary = podklad({ pozorovanoMs: NOW - NEJSTARSI_POZOROVANI_MS - 60e3 });
  assert.equal(bourkaProMisto(stary, { ...BOD, nowMs: NOW }).stav, 'nevim');
  const bezPredpovedi = podklad({ jadra: [zapad(30)], stopa: null });
  assert.equal(bourkaProMisto(bezPredpovedi, { ...BOD, nowMs: NOW }).stav, 'nevim');
  const staraPredpoved = podklad({ jadra: [zapad(30)], behMs: NOW - 31 * 60e3 });
  assert.equal(bourkaProMisto(staraPredpoved, { ...BOD, nowMs: NOW }).stav, 'nevim');
  assert.equal(bourkaProMisto(podklad(), { lat: 45, lon: 3, nowMs: NOW }).stav, 'mimo');
  assert.equal(bourkaProMisto(null, { ...BOD, nowMs: NOW }).stav, 'nevim');
});

test('🚨 nulový ostrov: chybějící souřadnice nejsou bod 0, 0', () => {
  assert.equal(odpovedProMisto(podklad(), { lat: '', lon: '' }, NOW).stav, 'nevim');
  assert.equal(odpovedProMisto(podklad(), {}, NOW).stav, 'nevim');
});

test('síla se bere z celého jádra, ne z jeho nejbližšího (nejslabšího) okraje', () => {
  const jadra = [zapad(20, 48), zapad(24, 60)];
  const v = bourkaProMisto(podklad({ jadra, stopa: [[Math.floor(P.x), Math.floor(P.y), 30]] }), { ...BOD, nowMs: NOW });
  assert.equal(v.sila, 60);
});

/* ============================================================
   VĚTA A ODPOVĚĎ
   ============================================================ */

test('věta: odkud, za kolik minut (po pěti), co dělat a odkud to víme', () => {
  const v = { stav: 'bourka', za: 37, km: 28, smer: 'w', sila: 48 };
  assert.equal(textBourky(v, 'cs'), 'Od západu se blíží bouřka, dorazí asi za 35 min. Zvířata a věci z venku dovnitř. Podle radaru ČHMÚ.');
  assert.match(textBourky(v, 'en'), /^A thunderstorm is coming from the west, due in about 35 min\./);
  assert.match(textBourky({ ...v, za: 8 }, 'cs'), /dorazí do 10 minut/);
  assert.match(textBourky({ ...v, za: 0, km: 1 }, 'cs'), /^Bouřka už je tady\./);
  assert.match(textBourky({ ...v, sila: 56 }, 'cs'), /Silná, možné kroupy\./);
  assert.equal(textBourky({ stav: 'klid' }, 'cs'), '');
});

test('odpověď API: stav, věta jen u bouřky, ticho ze serveru, citace zdroje', () => {
  const o = odpovedProMisto(podklad({ jadra: [zapad(30)], stopa: [[Math.floor(P.x), Math.floor(P.y), 40]] }), { lat: String(BOD.lat), lon: String(BOD.lon), lang: 'cs' }, NOW);
  assert.equal(o.stav, 'bourka');
  assert.match(o.bourka.text, /^Od západu/);
  assert.equal(o.tichoMin, TICHO_MIN);
  assert.equal(o.zdroj, 'ČHMÚ');
  assert.equal(o.licence, 'CC BY 4.0');
  assert.equal(odpovedProMisto(podklad(), { lat: '49.5', lon: '12.9' }, NOW).bourka, null);
});

/* ============================================================
   SKUTEČNÁ BOUŘKA: HORŠOVSKÝ TÝN, 8. 10. 2026
   ============================================================ */

const DATA = JSON.parse(readFileSync(new URL('./data/bourka-2026-10-08.json', import.meta.url), 'utf8'));
const krok = (iso) => bourkaProMisto(DATA.kroky[iso], { ...DATA.bod, nowMs: Date.parse(iso) });

test('🚨 8. 10. 2026: v 15:28 upozornit „od západu, asi za 35 min", v 16:03 „je tady"', () => {
  // Kvůli téhle bouřce to celé vzniklo (`R37`). ČHMÚ výstrahu nevydal.
  assert.equal(krok('2026-10-08T13:08:30Z').stav, 'klid', '15:08 — jádro je daleko');
  assert.equal(krok('2026-10-08T13:23:30Z').stav, 'klid', '15:23 — jádro ještě nepotvrzené dalším snímkem');
  const v = krok('2026-10-08T13:28:30Z');
  assert.equal(v.stav, 'bourka', '15:28');
  assert.equal(v.smer, 'w');
  assert.ok(v.za >= 30 && v.za <= 40, `za ${v.za} min`);
  const ted = krok('2026-10-08T14:03:30Z');
  assert.equal(ted.stav, 'bourka', '16:03');
  assert.equal(ted.za, 0);
  assert.ok(ted.sila >= 52);
});

/* ============================================================
   KATALOG A PROXY
   ============================================================ */

test('🚨 služba storm: místo a jazyk NEJSOU v klíči cache — podklad je společný všem', () => {
  const s = UPSTREAMS.storm;
  assert.equal(s.builder, 'chmiBourka');
  assert.equal(s.normalize, 'storm');
  assert.deepEqual(s.params, []);
  for (const k of ['lat', 'lon', 'lang']) assert.ok(s.local.includes(k), k);
  assert.equal(cacheKey('storm', { lat: '49.5', lon: '12.9', lang: 'cs' }), cacheKey('storm', { lat: '50.1', lon: '14.4', lang: 'en' }));
  assert.ok(s.ttl <= 5 * 60, 'snímky chodí po pěti minutách');
  assert.equal(planRequest({ pathname: '/api/storm', params: { lat: '49.5', lon: '12.9' } }).ok, true);
});

test('výřez pro místo se dělá až za cache (filterByPlace)', () => {
  const p = podklad({ jadra: [zapad(30)], stopa: [[Math.floor(P.x), Math.floor(P.y), 40]] });
  const o = filterByPlace('storm', p, { lat: String(BOD.lat), lon: String(BOD.lon), lang: 'en' }, { nowMs: NOW });
  assert.equal(o.stav, 'bourka');
  assert.match(o.bourka.text, /^A thunderstorm/);
});

/* ============================================================
   STAVITEL NA SERVERU (podvržené ČHMÚ)
   ============================================================ */

const BASE = 'https://chmi/';
const ODPOVED = (b) => ({ ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
const NENI = { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
const HT = { x: Math.floor(P.x), y: Math.floor(P.y) };

function predpovedTar(behIso, bourky) {
  const beh = Date.parse(behIso);
  const dd = (n) => String(n).padStart(2, '0');
  const soubory = [10, 20, 30, 40, 50, 60].map((m) => {
    const d = new Date(beh + m * 60e3);
    const jmeno = `pacz2gmaps3.fct_z_max.${d.getUTCFullYear()}${dd(d.getUTCMonth() + 1)}${dd(d.getUTCDate())}.${dd(d.getUTCHours())}${dd(d.getUTCMinutes())}.${m}.png`;
    return { jmeno, data: zapisPng(snimek(m === 40 ? bourky : []), SIRKA, VYSKA) };
  });
  return slozTar(soubory);
}

function cizinaCHMU({ pozorovani, behy, volane = [] }) {
  return async (url) => {
    volane.push(url.replace(BASE, ''));
    for (const [jmeno, data] of Object.entries(pozorovani)) if (url.endsWith(jmeno)) return ODPOVED(data);
    for (const [jmeno, data] of Object.entries(behy)) if (url.endsWith(jmeno)) return ODPOVED(data);
    return NENI;
  };
}

const ted = () => zapisPng(snimek([{ x: HT.x - 30, y: HT.y, r: 2, z: 52 }]), SIRKA, VYSKA);
const predtim = () => zapisPng(snimek([{ x: HT.x - 34, y: HT.y, r: 2, z: 52 }]), SIRKA, VYSKA);
const beh = () => predpovedTar('2026-10-08T13:20:00Z', [{ x: HT.x, y: HT.y, r: 1, z: 40 }]);

test('stavitel: nejnovější snímek, k němu předchozí a nejnovější běh předpovědi', async () => {
  const volane = [];
  const d = await stavBourky({
    fetchImpl: cizinaCHMU({
      pozorovani: { 'z_max3d.20261008.1325.0.png': ted(), 'z_max3d.20261008.1320.0.png': predtim() },
      behy: { 'fct_z_max.20261008.1320.ft60s10.tar': beh() },
      volane,
    }),
    base: BASE, nowMs: NOW,
  });
  assert.equal(new Date(d.pozorovanoMs).toISOString(), '2026-10-08T13:25:00.000Z');
  assert.equal(new Date(d.predtimMs).toISOString(), '2026-10-08T13:20:00.000Z');
  assert.equal(new Date(d.behMs).toISOString(), '2026-10-08T13:20:00.000Z');
  assert.ok(d.jadra.length && d.jadraPredtim.length && d.stopa.length);
  assert.ok(volane.some((u) => u.startsWith('maxz/png/')) && volane.some((u) => u.startsWith('fct_maxz/png/')));
  // A celé to dá upozornění — přes skutečné PNG a .tar, ne přes ručně složený podklad.
  assert.equal(bourkaProMisto(d, { ...BOD, nowMs: NOW }).stav, 'bourka');
});

test('stavitel: chybí-li snímek před 5 min, vezme se ten před 10 min', async () => {
  const d = await stavBourky({
    fetchImpl: cizinaCHMU({
      pozorovani: { 'z_max3d.20261008.1325.0.png': ted(), 'z_max3d.20261008.1315.0.png': predtim() },
      behy: { 'fct_z_max.20261008.1320.ft60s10.tar': beh() },
    }),
    base: BASE, nowMs: NOW,
  });
  assert.equal(new Date(d.predtimMs).toISOString(), '2026-10-08T13:15:00.000Z');
});

test('🚨 stavitel: bez předchozího snímku, bez předpovědi nebo s cizí paletou — chyba, ne tiché „nic"', async () => {
  const jen = (pozorovani, behy = { 'fct_z_max.20261008.1320.ft60s10.tar': beh() }) =>
    stavBourky({ fetchImpl: cizinaCHMU({ pozorovani, behy }), base: BASE, nowMs: NOW });
  await assert.rejects(jen({ 'z_max3d.20261008.1325.0.png': ted() }), /předchozí snímek/);
  await assert.rejects(jen({ 'z_max3d.20261008.1325.0.png': ted(), 'z_max3d.20261008.1320.0.png': predtim() }, {}), /Předpověď/);
  await assert.rejects(jen({}), /Pozorování/);
  const cizi = paletaCHMU(); cizi[3 * 184] = 0;
  const spatna = zapisPng(snimek(), SIRKA, VYSKA, { paleta: cizi });
  await assert.rejects(jen({ 'z_max3d.20261008.1325.0.png': spatna, 'z_max3d.20261008.1320.0.png': predtim() }), /Paleta/);
  const maly = zapisPng(new Uint8Array(100), 10, 10);
  await assert.rejects(jen({ 'z_max3d.20261008.1325.0.png': maly, 'z_max3d.20261008.1320.0.png': predtim() }), /680×460/);
});

test('🚨 proxy: dvě místa = jedno stažení radaru, každé dostane svou odpověď', async () => {
  zapomenVypadky();
  let stazeni = 0;
  const builders = {
    chmiBourka: async (a) => { stazeni++; return stavBourky({ ...a, fetchImpl: cizinaCHMU({
      pozorovani: { 'z_max3d.20261008.1325.0.png': ted(), 'z_max3d.20261008.1320.0.png': predtim() },
      behy: { 'fct_z_max.20261008.1320.ft60s10.tar': beh() },
    }) }); },
  };
  const cache = createCache({ maxEntries: 10 });
  const dotaz = (lat, lon) => serveProxy({ pathname: '/api/storm', params: new URLSearchParams({ lat, lon, lang: 'cs' }), method: 'GET' }, { cache, builders, now: () => NOW });
  const tyn = await dotaz(String(BOD.lat), String(BOD.lon));
  const praha = await dotaz('50.08', '14.42');
  assert.equal(stazeni, 1);
  assert.equal(tyn.status, 200);
  assert.equal(tyn.body.stav, 'bourka');
  assert.equal(praha.body.stav, 'klid');
});

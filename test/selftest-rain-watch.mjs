/**
 * Samotest začátku deště z radaru (`web/lib/rain-watch.js`, `R42`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mrizkaDeste, zhusti, rozbal, destProMisto, textDeste, odpovedDeste,
  PRSI, NIC, BUNKA, PRAH_DESTE, TICHO_MIN,
} from '../web/lib/rain-watch.js';
import { pixelBodu, SIRKA, VYSKA, NEJSTARSI_POZOROVANI_MS } from '../web/lib/storm-watch.js';
import { NEJSTARSI_BEH_MS } from '../web/lib/nowcast.js';

/** Index → dBZ: 1 = déšť nad prahem, 2 = mrholení pod prahem. */
const DBZ = new Uint8Array(256);
DBZ[1] = PRAH_DESTE + 6;
DBZ[2] = PRAH_DESTE - 8;

test('mřížka: prší teď = 0, předpověď = první minuta, jinde nic', () => {
  const s = 6; const v = 4;
  const ted = new Uint8Array(s * v);
  ted[0] = 1;                       // prší v levém horním rohu
  ted[1 * s + 5] = 2;               // mrholení — pod prahem, nepočítá se
  const za10 = new Uint8Array(s * v); za10[2 * s + 2] = 1;
  const za30 = new Uint8Array(s * v); za30[2 * s + 2] = 1; za30[3 * s + 5] = 1;
  za30[3 * s + 0] = 2;              // mrholení i v předpovědi — taky se nepočítá
  const m = mrizkaDeste(ted, DBZ, [{ minut: 30, pixely: za30 }, { minut: 10, pixely: za10 }], DBZ, s, v);
  assert.equal(m.length, (s / BUNKA) * (v / BUNKA));
  assert.equal(m[0], PRSI);
  assert.equal(m[1 * 3 + 1], 10, 'dřívější snímek vyhraje, i když přišel v poli později');
  assert.equal(m[1 * 3 + 2], 30);
  assert.equal(m[2], NIC, 'mrholení pod prahem není déšť (pozorování)');
  assert.equal(m[1 * 3 + 0], NIC, 'mrholení pod prahem není déšť (předpověď)');
});

test('pozorování přebíjí předpověď: kde prší teď, prší teď', () => {
  const ted = new Uint8Array(4); ted[0] = 1;
  const pred = new Uint8Array(4); pred[0] = 1;
  const m = mrizkaDeste(ted, DBZ, [{ minut: 20, pixely: pred }], DBZ, 2, 2);
  assert.equal(m[0], PRSI);
});

test('zhuštění tam a zpátky; vadné úseky → null, ne posunutá mřížka', () => {
  const m = new Uint8Array(1000).fill(NIC);
  m.fill(30, 100, 180); m[500] = PRSI;
  const u = zhusti(m);
  assert.ok(u.length < 12, `suchá mřížka má mít pár úseků, má ${u.length}`);
  assert.deepEqual([...rozbal(u, m.length)], [...m]);
  assert.equal(rozbal(u, m.length + 1), null);
  assert.equal(rozbal([NIC, 0], 1), null);
  assert.equal(rozbal([NIC], 1), null);
});

/* ── rozhodnutí pro místo ──────────────────────────────────────────── */

const NOW = Date.parse('2026-10-08T13:28:30Z');
const BOD = { lat: 49.5296, lon: 12.944 };   // Horšovský Týn
const P = pixelBodu(BOD.lat, BOD.lon);
const SM = Math.ceil(SIRKA / BUNKA);
const VM = Math.ceil(VYSKA / BUNKA);

/** Podklad s mřížkou: `bunky` = [[dx, dy (buňky od místa), hodnota]]. */
function podklad(bunky = [], { pozorovanoMs = NOW - 3 * 60e3, behMs = NOW - 8 * 60e3 } = {}) {
  const m = new Uint8Array(SM * VM).fill(NIC);
  const bx = Math.floor(P.x / BUNKA);
  const by = Math.floor(P.y / BUNKA);
  for (const [dx, dy, h] of bunky) m[(by + dy) * SM + (bx + dx)] = h;
  return { sirka: SIRKA, vyska: VYSKA, pozorovanoMs, behMs, dest: zhusti(m) };
}

test('déšť do hodiny u místa → „dest" s minutami od teď', () => {
  // Běh 13:20:30, minuta 40 → 14:00:30, teď 13:28:30 → za 32 min.
  const v = destProMisto(podklad([[0, 0, 40]]), { ...BOD, nowMs: NOW });
  assert.deepEqual(v, { stav: 'dest', za: 32 });
});

test('prší už u místa → „prsi" (nezvoní se, déšť je tady)', () => {
  assert.equal(destProMisto(podklad([[0, 1, PRSI], [0, 0, 20]]), { ...BOD, nowMs: NOW }).stav, 'prsi');
});

test('déšť dál než okruh se nepočítá; nic → „sucho"', () => {
  assert.equal(destProMisto(podklad([[6, 0, 20]]), { ...BOD, nowMs: NOW }).stav, 'sucho');
  assert.equal(destProMisto(podklad(), { ...BOD, nowMs: NOW }).stav, 'sucho');
});

test('🚨 starý radar, stará předpověď nebo chybějící mřížka = „nevim", ne „sucho"', () => {
  const p = (o) => destProMisto(o, { ...BOD, nowMs: NOW }).stav;
  assert.equal(p(podklad([], { pozorovanoMs: NOW - NEJSTARSI_POZOROVANI_MS - 60e3 })), 'nevim');
  assert.equal(p(podklad([], { behMs: NOW - NEJSTARSI_BEH_MS - 60e3 })), 'nevim');
  assert.equal(p({ ...podklad(), dest: undefined }), 'nevim');
  assert.equal(p({ ...podklad(), dest: [NIC, 3] }), 'nevim', 'poškozená mřížka');
  assert.equal(destProMisto(podklad(), { lat: 0, lon: 0, nowMs: NOW }).stav, 'nevim');
  assert.equal(destProMisto(podklad(), { lat: 40, lon: 0, nowMs: NOW }).stav, 'mimo');
});

test('věta: do 10 min / asi za N min (po pěti), s radou a zdrojem', () => {
  assert.equal(textDeste({ stav: 'dest', za: 7 }, 'cs'),
    'Do 10 minut tu začne pršet. Prádlo a zvířata pod střechu. Podle radaru ČHMÚ.');
  assert.match(textDeste({ stav: 'dest', za: 32 }, 'cs'), /^Asi za 30 min tu začne pršet\./);
  assert.match(textDeste({ stav: 'dest', za: 33 }, 'en'), /^Rain will start here in about 35 min\./);
  assert.equal(textDeste({ stav: 'prsi' }, 'cs'), '');
});

test('odpověď pro místo nese stav, minuty, větu a ticho', () => {
  const o = odpovedDeste(podklad([[0, 0, 40]]), { lat: String(BOD.lat), lon: String(BOD.lon), lang: 'cs' }, NOW);
  assert.equal(o.stav, 'dest');
  assert.equal(o.za, 32);
  assert.match(o.text, /^Asi za 30 min/);
  assert.equal(o.tichoMin, TICHO_MIN);
  // 🚨 Bez souřadnic žádný Guinejský záliv.
  assert.equal(odpovedDeste(podklad(), { lang: 'cs' }, NOW).stav, 'nevim');
});

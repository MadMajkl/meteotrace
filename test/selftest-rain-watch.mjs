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

/* ============================================================
   SNÍH (R49) — 26. 11. 2026 radar sníh neviděl vůbec
   ============================================================ */

import { readFileSync } from 'node:fs';
import {
  PRAH_SNEHU, MRZNE_TW, jeSnih, potrebujeFazi,
} from '../web/lib/rain-watch.js';
import { serveProxy, zapomenVypadky } from '../server/proxy.js';
import { createCache } from '../web/lib/ttl-cache.js';

/** Index 3 = slabé srážky: pod prahem deště, nad prahem sněhu. */
DBZ[3] = PRAH_SNEHU + 4;

test('mřížka se slabším prahem: sníh vidí, co déšť ne', () => {
  const ted = new Uint8Array(4); ted[0] = 3;
  const pred = new Uint8Array(4); pred[3] = 3;
  const dest = mrizkaDeste(ted, DBZ, [{ minut: 20, pixely: pred }], DBZ, 2, 2);
  const snih = mrizkaDeste(ted, DBZ, [{ minut: 20, pixely: pred }], DBZ, 2, 2, PRAH_SNEHU);
  assert.equal(dest[0], NIC, 'pro déšť je to šum');
  assert.equal(snih[0], PRSI, 'sníh už padá');
  const pozdeji = Uint8Array.from({ length: 16 }, (_, i) => (i === 15 ? 3 : 0));
  const s4 = mrizkaDeste(new Uint8Array(16), DBZ, [{ minut: 20, pixely: pozdeji }], DBZ, 4, 4, PRAH_SNEHU);
  assert.equal(s4[3], 20, 'sníh z předpovědi nese minutu');
});

test('jeSnih: vlhká teplota rozhoduje, obyčejná jen když vlhká chybí, jinak „nevíme"', () => {
  assert.equal(jeSnih({ tw: MRZNE_TW, t: 3 }), true, 'suchý vzduch: sněží i nad nulou');
  assert.equal(jeSnih({ tw: MRZNE_TW + 0.1, t: 0 }), false);
  assert.equal(jeSnih({ t: 0.5 }), true);
  assert.equal(jeSnih({ t: 2 }), false);
  assert.equal(jeSnih(null), null);
  assert.equal(jeSnih({}), null);
});

/** Podklad s mřížkou deště I sněhu. */
function podkladSnih(bunkyDest = [], bunkySnih = []) {
  const p = podklad(bunkyDest);
  const m = new Uint8Array(SM * VM).fill(NIC);
  const bx = Math.floor(P.x / BUNKA);
  const by = Math.floor(P.y / BUNKA);
  for (const [dx, dy, h] of bunkySnih) m[(by + dy) * SM + (bx + dx)] = h;
  return { ...p, snih: zhusti(m) };
}
const MISTO = { lat: String(BOD.lat), lon: String(BOD.lon), lang: 'cs' };
const MRAZ = { t: -1, tw: -2 };

test('🚨 sníh u místa: když mrzne, čte se sněhová mřížka a věta mluví o sněhu', () => {
  const p = podkladSnih([], [[0, 0, 40]]);
  const o = odpovedDeste(p, MISTO, NOW, MRAZ);
  assert.equal(o.stav, 'dest');
  assert.equal(o.druh, 'snih');
  assert.equal(o.za, 32);
  assert.equal(o.text, 'Asi za 30 min tu začne sněžit. Auto pod střechu a na cestu víc času. Podle radaru ČHMÚ.');
  assert.equal(o.tichoMin, TICHO_MIN, 'ticho jako u deště — obal se nemění');
  assert.match(odpovedDeste(p, { ...MISTO, lang: 'en' }, NOW, MRAZ).text, /^Snow will start here in about 30 min\./);
  assert.equal(textDeste({ stav: 'dest', za: 5 }, 'cs', true).split('.')[0], 'Do 10 minut tu začne sněžit');
});

test('🚨 nad nulou, bez teploty nebo se starým podkladem zůstává déšť jako dřív', () => {
  const p = podkladSnih([], [[0, 0, 40]]);
  for (const [popis, faze, podk] of [
    ['nad nulou', { t: 4, tw: 3 }, p],
    ['teplota nepřišla', null, p],
    ['podklad bez sněhové mřížky', MRAZ, { ...p, snih: undefined }],
  ]) {
    const o = odpovedDeste(podk, MISTO, NOW, faze);
    assert.equal(o.stav, 'sucho', popis);
    assert.equal(o.druh, undefined, popis);
  }
});

test('potrebujeFazi: na teplotu se ptá jen místo, ke kterému se blíží srážky', () => {
  assert.equal(potrebujeFazi(podkladSnih([], [[0, 0, 40]]), { ...BOD, nowMs: NOW }), true);
  assert.equal(potrebujeFazi(podkladSnih([], [[0, 0, PRSI]]), { ...BOD, nowMs: NOW }), true);
  assert.equal(potrebujeFazi(podkladSnih(), { ...BOD, nowMs: NOW }), false, 'sucho → ven se nechodí');
  assert.equal(potrebujeFazi(podklad([[0, 0, 40]]), { ...BOD, nowMs: NOW }), false, 'starý podklad bez sněhu');
  assert.equal(potrebujeFazi(podkladSnih([], [[0, 0, 40]]), { lat: 0, lon: 0, nowMs: NOW }), false);
});

/* ── skutečný sníh 26. 11. 2026 ───────────────────────────────────── */

const SNIH = JSON.parse(readFileSync(new URL('./data/snih-2026-11-26.json', import.meta.url), 'utf8'));
const naMiste = (k, faze) => odpovedDeste(SNIH.podklad,
  { lat: String(SNIH.mista[k].lat), lon: String(SNIH.mista[k].lon), lang: 'cs' }, SNIH.nowMs, faze);

test('🚨 26. 11. 2026 11:15: v Brně pod výstrahou „Velmi rizikové sněhové jevy" sněží — a appka to vidí', () => {
  // Bez R49 (jen práh deště) bylo všude „sucho". Miki: „všechny appky
  // hlásí sněžení, už i padá, a meteotrace nereaguje".
  for (const k of ['brno', 'trebic', 'budejovice', 'zlin']) {
    assert.equal(naMiste(k, null).stav, 'sucho', `${k}: s prahem deště je sníh neviditelný`);
    const o = naMiste(k, SNIH.teploty[k]);
    assert.equal(o.stav, 'prsi', `${k}: sněží (tw ${SNIH.teploty[k].tw} °C)`);
    assert.equal(o.druh, 'snih', k);
  }
  // Horšovský Týn a Praha: radar u nich nic nad 12 dBZ — sucho, a na
  // teplotu se proto vůbec neptá.
  for (const k of ['horsovskyTyn', 'praha']) {
    assert.equal(naMiste(k, SNIH.teploty[k]).stav, 'sucho', k);
    assert.equal(potrebujeFazi(SNIH.podklad, { ...SNIH.mista[k], nowMs: SNIH.nowMs }), false, k);
  }
});

/* ── proxy: teplota jen kde je třeba, jedním dotazem, z cache ──────── */

function openMeteo({ selze = false } = {}) {
  const dotazy = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    assert.equal(u.hostname, 'api.open-meteo.com');
    dotazy.push(u);
    if (selze) return { ok: false, status: 500, json: async () => ({}) };
    const lat = u.searchParams.get('latitude').split(',');
    const jedno = () => ({ current: { temperature_2m: 0.1, wet_bulb_temperature_2m: -1.3 } });
    return { ok: true, status: 200, json: async () => (lat.length === 1 ? jedno() : lat.map(jedno)) };
  };
  return { fetchImpl, dotazy };
}
const dotazStorm = (mista, deps) => serveProxy({
  pathname: '/api/storm', params: new URLSearchParams({ mista, lang: 'cs' }), method: 'GET',
}, { builders: { chmiBourka: async () => SNIH.podklad }, now: () => SNIH.nowMs, ...deps });
const ll = (k) => `${SNIH.mista[k].lat},${SNIH.mista[k].lon}`;

test('🚨 proxy: Brno dostane sníh, Týn ne; teplota jedním dotazem jen pro Brno, podruhé z cache', async () => {
  zapomenVypadky();
  const om = openMeteo();
  const cache = createCache({ maxEntries: 20 });
  const r = await dotazStorm(`${ll('brno')};${ll('horsovskyTyn')}`, { cache, fetchImpl: om.fetchImpl });
  assert.equal(r.status, 200);
  const [brno, tyn] = r.body.mista;
  assert.equal(brno.dest.stav, 'prsi');
  assert.equal(brno.dest.druh, 'snih');
  assert.equal(tyn.dest.stav, 'sucho');
  assert.equal(tyn.dest.druh, undefined);
  assert.equal(om.dotazy.length, 1);
  assert.equal(om.dotazy[0].searchParams.get('latitude'), SNIH.mista.brno.lat.toFixed(4), 'jen Brno, Týn je v suchu');
  assert.match(om.dotazy[0].searchParams.get('current'), /wet_bulb_temperature_2m/);
  await dotazStorm(`${ll('brno')};${ll('horsovskyTyn')}`, { cache, fetchImpl: om.fetchImpl });
  assert.equal(om.dotazy.length, 1, 'teplota z cache, ven se nešlo');
});

test('🚨 proxy: v suchu se na teplotu neptá; když teplota nepřijde, zůstává déšť', async () => {
  zapomenVypadky();
  const sucho = openMeteo();
  await dotazStorm(`${ll('horsovskyTyn')};${ll('praha')}`, { cache: createCache({ maxEntries: 20 }), fetchImpl: sucho.fetchImpl });
  assert.equal(sucho.dotazy.length, 0);

  const vypadek = openMeteo({ selze: true });
  const r = await dotazStorm(ll('brno'), { cache: createCache({ maxEntries: 20 }), fetchImpl: vypadek.fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(r.body.mista[0].dest.stav, 'sucho', 'bez teploty se sníh netvrdí');
  assert.equal(vypadek.dotazy.length, 1);
});

/* ============================================================
   „PRÁVĚ ZAČALO" (R50) — sníh vznikl nad Týnem, předpověď ho minula
   ============================================================ */

import { ZACALO_MIN } from '../web/lib/rain-watch.js';

/** Podklad + starší pozorování (`driv`): `bunkyDriv` jako u `podklad`. */
function sDriv(p, bunkyDriv = [], { mrizka = 'dest' } = {}) {
  const m = new Uint8Array(SM * VM).fill(NIC);
  const bx = Math.floor(P.x / BUNKA);
  const by = Math.floor(P.y / BUNKA);
  for (const [dx, dy, h] of bunkyDriv) m[(by + dy) * SM + (bx + dx)] = h;
  const prazdna = zhusti(new Uint8Array(SM * VM).fill(NIC));
  return { ...p, driv: { ms: p.pozorovanoMs - ZACALO_MIN * 60e3, dest: prazdna, snih: prazdna, [mrizka]: zhusti(m) } };
}

test('🚨 prší teď a před 20 min v okruhu nic → „dest" za 0 se „zacalo" (zvoní se)', () => {
  const v = destProMisto(sDriv(podklad([[0, 0, PRSI]])), { ...BOD, nowMs: NOW });
  assert.deepEqual(v, { stav: 'dest', za: 0, zacalo: true });
});

test('prší teď i tehdy → „prsi"; bez staršího snímku → „prsi" jako dřív', () => {
  assert.equal(destProMisto(sDriv(podklad([[0, 0, PRSI]]), [[0, 1, PRSI]]), { ...BOD, nowMs: NOW }).stav, 'prsi');
  assert.equal(destProMisto(podklad([[0, 0, PRSI]]), { ...BOD, nowMs: NOW }).stav, 'prsi');
  // Poškozený starší snímek = nevíme → nic se netvrdí.
  const p = sDriv(podklad([[0, 0, PRSI]]));
  assert.equal(destProMisto({ ...p, driv: { ...p.driv, dest: [NIC, 3] } }, { ...BOD, nowMs: NOW }).stav, 'prsi');
});

test('tehdy pršelo jen mimo okruh → to je začátek; sucho teď zůstává suchem', () => {
  assert.equal(destProMisto(sDriv(podklad([[0, 0, PRSI]]), [[6, 0, PRSI]]), { ...BOD, nowMs: NOW }).zacalo, true);
  assert.equal(destProMisto(sDriv(podklad()), { ...BOD, nowMs: NOW }).stav, 'sucho');
  assert.equal(destProMisto(sDriv(podklad([[0, 0, 30]])), { ...BOD, nowMs: NOW }).zacalo, undefined, 'předpověď se nemění');
});

test('věta „Právě tu začalo…" pro déšť i sníh, česky i anglicky, s radou a zdrojem', () => {
  const v = { stav: 'dest', za: 0, zacalo: true };
  assert.equal(textDeste(v, 'cs'), 'Právě tu začalo pršet. Prádlo a zvířata pod střechu. Podle radaru ČHMÚ.');
  assert.equal(textDeste(v, 'cs', true), 'Právě tu začalo sněžit. Auto pod střechu a na cestu víc času. Podle radaru ČHMÚ.');
  assert.match(textDeste(v, 'en'), /^Rain has just started here\./);
  assert.match(textDeste(v, 'en', true), /^Snow has just started here\./);
  const o = odpovedDeste(sDriv(podklad([[0, 0, PRSI]])), MISTO, NOW);
  assert.equal(o.zacalo, true);
  assert.equal(o.tichoMin, TICHO_MIN, 'opakování hlídá ticho obalu — obal se nemění');
});

test('sníh: čte se starší SNĚHOVÁ mřížka, ne dešťová', () => {
  const p = sDriv(podkladSnih([], [[0, 0, PRSI]]), [[0, 0, PRSI]], { mrizka: 'dest' });
  // Před 20 min tu „pršelo" v dešťové mřížce, ale ve sněhové nic → sníh začal.
  const o = odpovedDeste(p, MISTO, NOW, MRAZ);
  assert.equal(o.druh, 'snih');
  assert.equal(o.zacalo, true);
});

/* ── skutečný sníh nad Týnem 26. 11. 2026 ─────────────────────────── */

const TYN = JSON.parse(readFileSync(new URL('./data/snih-tyn-2026-11-26.json', import.meta.url), 'utf8'));
const vTyne = (k, faze = { t: 0.1, tw: -0.6 }) => odpovedDeste(TYN[k].podklad,
  { lat: String(TYN.misto.lat), lon: String(TYN.misto.lon), lang: 'cs' }, TYN[k].nowMs, faze);

test('🚨 26. 11. 2026 Horšovský Týn: v 11:20 sucho, v 11:30 „Právě tu začalo sněžit", v 12:00 sněží', () => {
  // Miki: „sněží i u nás na jihozápadě… Domažlice, Horšovský Týn". Předpověď
  // ČHMÚ příchod nehlásila při žádném prahu — sníh tu vznikl. Bez R50 by
  // appka skočila ze sucha na „sněží" a mlčela.
  assert.equal(vTyne('pred').stav, 'sucho');
  const o = vTyne('zacalo');
  assert.equal(o.stav, 'dest');
  assert.equal(o.zacalo, true);
  assert.equal(o.druh, 'snih');
  assert.equal(o.text, 'Právě tu začalo sněžit. Auto pod střechu a na cestu víc času. Podle radaru ČHMÚ.');
  // Za půl hodiny sněží už 20+ min → „prsi", nezvoní se znovu.
  assert.equal(vTyne('snezi').stav, 'prsi');
  // Bez teploty: déšť má práh 24 dBZ a ten sníh nepřekročil.
  assert.equal(vTyne('zacalo', null).stav, 'sucho');
});

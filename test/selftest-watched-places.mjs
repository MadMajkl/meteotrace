/**
 * Samotest hlídaných míst (`R38`): co obal hlídá a jak se seznam míst
 * posílá na server.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_HLIDANYCH, vycistiKlice, jeHlidane, prepniHlidani, hlidanaMista,
  mistaDoDotazu, mistaZDotazu,
} from '../web/lib/watched-places.js';
import { emptyStore, savePlace } from '../web/lib/places.js';
import { planRequest, filterByPlace } from '../web/lib/proxy-core.js';
import { cacheKey } from '../web/lib/upstreams.js';
import { unpackAreas, findArea } from '../web/lib/orp.js';
import { ORP_DATA } from '../web/data/orp-boundaries.js';

const TYN = { name: 'Domov', lat: 49.5293, lon: 12.9437 };
const PLZEN = { name: 'Práce', lat: 49.7384, lon: 13.3736 };
const KLATOVY = { name: 'Klatovy', lat: 49.3955, lon: 13.2951 };

/** Sklad s místy v pořadí, v jakém je ukazuje správa (nejnovější nahoře). */
function sklad(...mista) {
  let s = emptyStore();
  mista.forEach((m, i) => { s = savePlace(s, m, i + 1).store; });
  return s;
}
const klic = (s, jmeno) => s.places.find((p) => p.name === jmeno).key;

/* ============================================================
   CO SE HLÍDÁ
   ============================================================ */

test('🚨 Michal v práci v Plzni: domov se zvonkem se hlídá, i když je otevřená Plzeň', () => {
  const s = sklad(TYN, PLZEN);
  const { mista, zOtevreneho } = hlidanaMista(s, [klic(s, 'Domov')], PLZEN);
  assert.equal(zOtevreneho, false);
  assert.deepEqual(mista.map((m) => m.name), ['Domov'], 'otevřená Plzeň hlídání domova nevytlačí');
});

test('bez zvonku se hlídá otevřené místo — jako do 0.28.0, nikdo nepřijde o upozornění', () => {
  const s = sklad(TYN, PLZEN);
  const { mista, zOtevreneho } = hlidanaMista(s, [], PLZEN);
  assert.equal(zOtevreneho, true);
  assert.deepEqual(mista.map((m) => [m.name, m.key]), [['Práce', null]]);
  assert.deepEqual(hlidanaMista(s, [], null).mista, [], 'bez otevřeného místa není co hlídat');
  assert.deepEqual(hlidanaMista(s, [], { lat: 0, lon: 0 }).mista, [], 'nulový bod není místo');
});

test('pořadí hlídaných míst je pořadí ve správě, ne pořadí zapínání', () => {
  const s = sklad(TYN, PLZEN, KLATOVY);
  const { mista } = hlidanaMista(s, [klic(s, 'Domov'), klic(s, 'Klatovy')], null);
  assert.deepEqual(mista.map((m) => m.name), s.places.map((p) => p.name).filter((n) => n !== 'Práce'));
});

test('🚨 smazané místo z hlídání vypadne samo', () => {
  const s = sklad(TYN, PLZEN);
  const klice = [klic(s, 'Domov'), '1.000,1.000', klic(s, 'Domov'), 42, null];
  assert.deepEqual(vycistiKlice(s, klice), [klic(s, 'Domov')], 'neznámý klíč, opakování a nesmysly pryč');
  assert.deepEqual(vycistiKlice(s, 'nesmysl'), []);
  // Když už nezbyde nic platného, hlídá se zase otevřené místo — ne nic.
  assert.equal(hlidanaMista(s, ['1.000,1.000'], PLZEN).zOtevreneho, true);
});

test('zvonek zapíná a vypíná; neznámé místo nic nezmění', () => {
  const s = sklad(TYN, PLZEN);
  const domov = klic(s, 'Domov');
  const zap = prepniHlidani(s, [], domov);
  assert.deepEqual(zap, { klice: [domov], plno: false });
  assert.equal(jeHlidane(zap.klice, domov), true);
  assert.deepEqual(prepniHlidani(s, zap.klice, domov), { klice: [], plno: false });
  assert.deepEqual(prepniHlidani(s, [], '1.000,1.000'), { klice: [], plno: false });
});

test(`🚨 nejvýš ${MAX_HLIDANYCH} míst — šesté se odmítne nahlas, nic se nezmění`, () => {
  const mista = Array.from({ length: MAX_HLIDANYCH + 1 }, (_, i) => ({ name: `M${i}`, lat: 49 + i * 0.1, lon: 14 }));
  const s = sklad(...mista);
  let klice = [];
  for (const p of s.places.slice(0, MAX_HLIDANYCH)) klice = prepniHlidani(s, klice, p.key).klice;
  assert.equal(klice.length, MAX_HLIDANYCH);
  const sesta = prepniHlidani(s, klice, s.places[MAX_HLIDANYCH].key);
  assert.equal(sesta.plno, true);
  assert.deepEqual(sesta.klice, klice);
  // Vypnout jde i při plném seznamu.
  assert.equal(prepniHlidani(s, klice, klice[0]).klice.length, MAX_HLIDANYCH - 1);
  assert.equal(vycistiKlice(s, s.places.map((p) => p.key)).length, MAX_HLIDANYCH);
});

/* ============================================================
   SEZNAM MÍST V DOTAZU
   ============================================================ */

test('seznam míst do dotazu a zpět', () => {
  const text = mistaDoDotazu([TYN, PLZEN]);
  assert.equal(text, '49.5293,12.9437;49.7384,13.3736');
  assert.deepEqual(mistaZDotazu(text), [{ lat: 49.5293, lon: 12.9437 }, { lat: 49.7384, lon: 13.3736 }]);
  assert.deepEqual(mistaZDotazu('-33.9,-70.7'), [{ lat: -33.9, lon: -70.7 }]);
  assert.equal(mistaDoDotazu([TYN, null, { lat: 'x' }]).split(';').length, 1, 'nepoužitelné body se neposílají');
});

test('🚨 vadný seznam míst se odmítne CELÝ — vynechaný bod by posunul páry místo↔odpověď', () => {
  for (const vadny of [
    '', ';', '49.5,12.9;', '49.5;12.9', '49.5,12.9;abc', '49.5, 12.9', '91,12', '49,181',
    '1e2,3', '49.5,12.9,1', Array(MAX_HLIDANYCH + 1).fill('49.5,12.9').join(';'), null, 42,
  ]) {
    assert.equal(mistaZDotazu(vadny), null, `prošlo: ${vadny}`);
  }
  assert.equal(mistaZDotazu(Array(MAX_HLIDANYCH).fill('49.5,12.9').join(';')).length, MAX_HLIDANYCH);
});

/* ============================================================
   SERVER: VÍC MÍST JEDNÍM DOTAZEM
   ============================================================ */

test('🚨 seznam míst NENÍ v klíči cache — výstrahy i radar se čtou jednou pro všechny', () => {
  for (const sluzba of ['warnings', 'storm']) {
    assert.equal(
      cacheKey(sluzba, { mista: '49.5,12.9', lang: 'cs' }),
      cacheKey(sluzba, { mista: '50.1,14.4;49.7,13.4', lang: 'cs' }),
      sluzba,
    );
    const p = planRequest({ pathname: `/api/${sluzba}`, params: new URLSearchParams({ mista: '49.5,12.9;49.7,13.4' }) });
    assert.equal(p.ok, true, sluzba);
  }
});

test('🚨 vadný seznam míst → 400, ne odpověď napůl', () => {
  for (const sluzba of ['warnings', 'storm']) {
    const p = planRequest({ pathname: `/api/${sluzba}`, params: { mista: '49.5,12.9;nesmysl' } });
    assert.equal(p.ok, false);
    assert.equal(p.status, 400);
    const q = planRequest({ pathname: `/api/${sluzba}`, params: new URLSearchParams({ mista: '' }) });
    assert.equal(q.status, 400, 'prázdný seznam');
  }
  // Služba, která `mista` nezná, ho jen zahodí (a zaloguje) — jako každý cizí parametr.
  assert.equal(planRequest({ pathname: '/api/forecast', params: { mista: 'x' } }).ok, true);
});

test('🚨 výstrahy pro víc míst: každé místo dostane SVOJE, ve stejném pořadí', () => {
  const areas = unpackAreas(ORP_DATA);
  const tyn = findArea([TYN.lat, TYN.lon], areas);
  const plzen = findArea([PLZEN.lat, PLZEN.lon], areas);
  assert.ok(tyn && plzen && tyn.nazev !== plzen.nazev, 'ORP pro Týn a Plzeň');
  const body = {
    sent: '2026-10-10T10:00:00Z',
    warnings: [
      { id: 'b1', event: 'Silné bouřky', severity: 'Severe', expires: null, areas: [{ name: `${tyn.kraj} (${tyn.nazev})` }] },
      { id: 'v1', event: 'Silný vítr', severity: 'Moderate', expires: null, areas: [{ name: `${plzen.kraj} (${plzen.nazev})` }] },
    ],
  };
  const nowMs = Date.parse('2026-10-10T11:00:00Z');
  const o = filterByPlace('warnings', body, {
    mista: mistaDoDotazu([PLZEN, TYN]), lang: 'cs', geo: '1',
  }, { areas, nowMs });
  assert.equal(o.mista.length, 2);
  assert.deepEqual(o.mista[0].warnings.map((w) => w.id), ['v1'], 'první je Plzeň');
  assert.deepEqual(o.mista[1].warnings.map((w) => w.id), ['b1'], 'druhý je Týn');
  assert.equal(o.mista[0].misto.nazev, plzen.nazev);
  assert.ok(o.mista.every((m) => !m.geometrie), 'hranice území se v dávce nepřikládají');
  // Každé místo má totéž, co by dostalo samostatným dotazem.
  const sam = filterByPlace('warnings', body, { lat: String(TYN.lat), lon: String(TYN.lon), lang: 'cs' }, { areas, nowMs });
  assert.deepEqual(o.mista[1], sam);
  // Práh závažnosti platí pro všechna místa.
  const prah = filterByPlace('warnings', body, { mista: mistaDoDotazu([PLZEN, TYN]), minSeverity: 'Severe' }, { areas, nowMs });
  assert.deepEqual(prah.mista.map((m) => m.warnings.length), [0, 1]);
});

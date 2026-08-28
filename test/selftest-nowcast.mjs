/**
 * Samotest nowcastu ČHMÚ — bez sítě, proti archivu složenému v testu.
 *
 * 🚨 Tar se tu VYRÁBÍ, ne stahuje. Kdyby test tahal skutečný archiv, byl by
 * rukojmím cizího serveru i denní doby: v noci jsou běhy jiné a při výpadku
 * ČHMÚ by test „selhal" na něčem, co není naše vada. Formát tar se přitom
 * vejde na dvě stránky a nemění se od roku 1979.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  nazevBehu, zaokrouhliBeh, kandidatiBehu, rozbalTar, snimkyZArchivu,
  spojOsu, jeVeVyrezu, rohy, VYREZ, behJePlatny, NEJSTARSI_BEH_MS,
} from '../web/lib/nowcast.js';

/* ============================================================
   POMOCNÉ: SLOŽENÍ ARCHIVU
   ============================================================ */

function tarHlavicka(jmeno, velikost) {
  const blok = new Uint8Array(512);
  const zapis = (text, od) => {
    for (let i = 0; i < text.length; i++) blok[od + i] = text.charCodeAt(i);
  };
  zapis(jmeno, 0);
  zapis(`${velikost.toString(8).padStart(11, '0')} `, 124);
  blok[156] = 48;   // '0' = obyčejný soubor
  return blok;
}

/** @param {Array<{jmeno: string, data: Uint8Array}>} soubory */
function slozTar(soubory) {
  const kusy = [];
  for (const s of soubory) {
    kusy.push(tarHlavicka(s.jmeno, s.data.length));
    const zarovnano = new Uint8Array(Math.ceil(s.data.length / 512) * 512);
    zarovnano.set(s.data);
    kusy.push(zarovnano);
  }
  kusy.push(new Uint8Array(1024));   // dva prázdné bloky = konec archivu
  const out = new Uint8Array(kusy.reduce((n, k) => n + k.length, 0));
  let i = 0;
  for (const k of kusy) { out.set(k, i); i += k.length; }
  return out;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** Archiv v podobě, v jaké ho ČHMÚ opravdu vydává (ověřeno 28. 8. 2026). */
function archivBehu() {
  const platnosti = [
    ['1910', 10], ['1920', 20], ['1930', 30],
    ['1940', 40], ['1950', 50], ['2000', 60],
  ];
  return slozTar(platnosti.map(([hhmm, minut]) => ({
    jmeno: `20260828.1900/pacz2gmaps3.fct_z_max.20260828.${hhmm}.${minut}.png`,
    data: PNG,
  })));
}

/* ============================================================
   JMÉNA BĚHŮ
   ============================================================ */

test('🚨 časy v názvech jsou UTC, ne místní', () => {
  // Ověřeno naživo 28. 8. 2026 ve 21:03 SELČ: nejnovější soubor nesl 1900.
  // Kdo by to spletl, sháněl by v létě běhy staré dvě hodiny — a v zimě
  // hodinu, takže by si toho v zimě nevšiml a v létě to svedl na výpadek.
  assert.equal(
    nazevBehu(Date.parse('2026-08-28T19:03:00Z')),
    'pacz2gmaps3.fct_z_max.20260828.1900.ft60s10.tar',
  );
});

test('běh se zaokrouhluje dolů na pětiminutu', () => {
  const t = (s) => new Date(zaokrouhliBeh(Date.parse(s))).toISOString().slice(11, 16);
  assert.equal(t('2026-08-28T19:09:59Z'), '19:05');
  assert.equal(t('2026-08-28T19:05:00Z'), '19:05');
  assert.equal(t('2026-08-28T19:04:59Z'), '19:00');
});

test('🚨 zkouší se víc běhů zpět, ne jen poslední', () => {
  // Poslední pětiminutovka nemusí být nahraná — výpočet a nahrání chvíli
  // trvá. S jediným pokusem by měla appka pravidelně několik minut prázdno
  // a vypadalo by to jako výpadek zdroje.
  const casy = kandidatiBehu(Date.parse('2026-08-28T19:03:00Z'), 3)
    .map((ms) => new Date(ms).toISOString().slice(11, 16));
  assert.deepEqual(casy, ['19:00', '18:55', '18:50']);
});

/* ============================================================
   ROZBALENÍ ARCHIVU
   ============================================================ */

test('archiv se rozbalí na jednotlivé snímky', () => {
  const polozky = rozbalTar(archivBehu());
  assert.equal(polozky.length, 6);
  assert.deepEqual([...polozky[0].data], [...PNG]);
});

test('🚨 data za hlavičkou jsou zarovnaná na 512 — nesmí se ukousnout', () => {
  // Klasická past: velikost v hlavičce je skutečná, ale v souboru následuje
  // výplň do násobku 512. Kdo ji nepřeskočí, má druhý soubor posunutý —
  // a rozbije se mu to až u druhého snímku, tedy daleko od příčiny.
  const velky = new Uint8Array(700).fill(7);
  const polozky = rozbalTar(slozTar([
    { jmeno: 'a.20260828.1910.10.png', data: velky },
    { jmeno: 'b.20260828.1920.20.png', data: PNG },
  ]));
  assert.equal(polozky.length, 2);
  assert.equal(polozky[0].data.length, 700);
  assert.deepEqual([...polozky[1].data], [...PNG]);
});

test('poškozená hlavička se pozná, nespolkne se', () => {
  const archiv = archivBehu();
  // Velikost je osmičkové číslo; písmena tam nepatří.
  for (let i = 124; i < 130; i++) archiv[i] = 120;   // 'x'
  assert.throws(() => rozbalTar(archiv), /Poškozený archiv/);
});

/* ============================================================
   ČASY SNÍMKŮ
   ============================================================ */

test('🚨 čte se PLATNÝ čas snímku, ne „teď + odstup"', () => {
  // Kdyby se čas dopočítával od stažení, opožděný běh by posunul celou osu
  // a snímky by slibovaly budoucnost, která už je minulostí.
  const snimky = snimkyZArchivu(rozbalTar(archivBehu()));
  assert.equal(snimky.length, 6);
  assert.equal(new Date(snimky[0].timeMs).toISOString(), '2026-08-28T19:10:00.000Z');
  assert.equal(snimky[0].minut, 10);
  assert.equal(new Date(snimky.at(-1).timeMs).toISOString(), '2026-08-28T20:00:00.000Z');
  assert.equal(snimky.at(-1).minut, 60);
});

test('snímky jdou v čase, i kdyby je archiv nesl zpřeházené', () => {
  const casy = snimkyZArchivu(rozbalTar(slozTar([
    { jmeno: 'x.20260828.1930.30.png', data: PNG },
    { jmeno: 'x.20260828.1910.10.png', data: PNG },
    { jmeno: 'x.20260828.1920.20.png', data: PNG },
  ]))).map((s) => s.minut);
  assert.deepEqual(casy, [10, 20, 30]);
});

test('co není snímek, se do osy nedostane', () => {
  const snimky = snimkyZArchivu(rozbalTar(slozTar([
    { jmeno: '20260828.1900/README.txt', data: PNG },
  ])));
  assert.equal(snimky.length, 0);
});

/* ============================================================
   SPOJENÍ OSY
   ============================================================ */

test('🚨 dva různé dopočty se na jedné ose nepotkají', () => {
  // RainViewer taky umí dopočet. Kdyby se naskládaly za sebe, srážky by
  // v místě přechodu poskočily bez důvodu v počasí — a nikdo by nepoznal,
  // že se dívá na dva různé výpočty. Náš je jemnější a sahá dál.
  const radar = [
    { timeMs: 100, forecast: false },
    { timeMs: 200, forecast: false },
    { timeMs: 300, forecast: true },
  ];
  const osa = spojOsu(radar, [{ timeMs: 250 }, { timeMs: 350 }]);
  assert.deepEqual(osa.map((f) => f.timeMs), [100, 200, 250, 350]);
});

test('bez naší předpovědi zůstane cizí dopočet — pořád lepší než nic', () => {
  const radar = [{ timeMs: 100, forecast: false }, { timeMs: 300, forecast: true }];
  assert.deepEqual(spojOsu(radar, []).map((f) => f.timeMs), [100, 300]);
});

test('🚨 předpověď na čas, který už máme naměřený, se zahodí', () => {
  const radar = [{ timeMs: 100, forecast: false }, { timeMs: 200, forecast: false }];
  const osa = spojOsu(radar, [{ timeMs: 150 }, { timeMs: 250 }]);
  assert.deepEqual(osa.map((f) => f.timeMs), [100, 200, 250]);
});

test('spojená předpověď je označená jako předpověď', () => {
  const osa = spojOsu([{ timeMs: 100, forecast: false }], [{ timeMs: 200 }]);
  assert.equal(osa[1].forecast, true);
});

/* ============================================================
   KDE TO PLATÍ
   ============================================================ */

test('výřez pokrývá Česko a kus okolí, ne Evropu', () => {
  assert.equal(jeVeVyrezu(50.08, 14.44), true, 'Praha');
  assert.equal(jeVeVyrezu(49.53, 12.94), true, 'Horšovský Týn');
  assert.equal(jeVeVyrezu(48.21, 16.37), true, 'Vídeň ještě ano');
  assert.equal(jeVeVyrezu(51.51, -0.13), false, 'Londýn');
  assert.equal(jeVeVyrezu(41.90, 12.50), false, 'Řím');
});

test('rohy jdou od levého horního po směru — jak je čeká mapa', () => {
  assert.deepEqual(rohy(), [
    [VYREZ.zapad, VYREZ.sever],
    [VYREZ.vychod, VYREZ.sever],
    [VYREZ.vychod, VYREZ.jih],
    [VYREZ.zapad, VYREZ.jih],
  ]);
});

test('🚨 zastaralý běh se neukáže — mlčky by lhal o příští hodině', () => {
  const ted = Date.parse('2026-08-28T20:00:00Z');
  assert.equal(behJePlatny(ted - 5 * 60_000, ted), true);
  assert.equal(behJePlatny(ted - NEJSTARSI_BEH_MS - 60_000, ted), false);
  // Běh „z budoucnosti" je taky podezřelý — leda o minutu kvůli hodinám.
  assert.equal(behJePlatny(ted + 10 * 60_000, ted), false);
});

/* ============================================================
   STAVITEL NA SERVERU (fingovaná síť)
   ============================================================ */

const { stavNowcast, jePouzitelny } = await import('../server/chmi-nowcast.js');

const ODPOVED = (bajty) => ({ ok: true, arrayBuffer: async () => bajty.buffer.slice(bajty.byteOffset, bajty.byteOffset + bajty.byteLength) });
const NENALEZENO = { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };

test('🚨 když poslední běh ještě není nahraný, vezme se předchozí', () => {
  const volane = [];
  const fetchImpl = async (url) => {
    volane.push(url.slice(-24));
    return url.includes('.1855.') ? ODPOVED(archivBehu()) : NENALEZENO;
  };
  return stavNowcast({
    fetchImpl, base: 'https://x/', nowMs: Date.parse('2026-08-28T19:03:00Z'),
  }).then((o) => {
    assert.equal(o.snimky.length, 6);
    assert.equal(new Date(o.beh).toISOString(), '2026-08-28T18:55:00.000Z');
    assert.equal(volane.length, 2, 'nejdřív 19:00, teprve pak 18:55');
  });
});

test('🚨 obrázky chodí jako data: adresy — z ČHMÚ si je prohlížeč vzít nemůže', async () => {
  // Ověřeno 28. 8. 2026: opendata.chmi.cz neposílá žádnou hlavičku CORS.
  const o = await stavNowcast({
    fetchImpl: async () => ODPOVED(archivBehu()), base: 'https://x/', nowMs: Date.parse('2026-08-28T19:03:00Z'),
  });
  assert.match(o.snimky[0].obrazek, /^data:image\/png;base64,/);
  assert.equal(o.zdroj, 'ČHMÚ');
  assert.equal(o.licence, 'CC BY 4.0');
});

test('🚨 když nechodí nic, vrátí se prázdno s důvodem — ne výjimka', async () => {
  // Nowcast je přídavek. Kdyby jeho výpadek shodil odpověď, přišla by appka
  // i o naměřený radar — kvůli něčemu, co je navíc.
  const o = await stavNowcast({
    fetchImpl: async () => NENALEZENO, base: 'https://x/', nowMs: Date.now(),
  });
  assert.deepEqual(o.snimky, []);
  assert.ok(o.duvod);
  assert.equal(jePouzitelny(o, Date.now()), false);
});

test('výpadek sítě se chová stejně jako chybějící soubor', async () => {
  const o = await stavNowcast({
    fetchImpl: async () => { throw new Error('ECONNRESET'); },
    base: 'https://x/', nowMs: Date.now(),
  });
  assert.deepEqual(o.snimky, []);
});

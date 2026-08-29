/**
 * Samotest: kdy se dlaždice podbarví.
 *
 * 🚨 Prahy jsou návrhová rozhodnutí, ne kosmetika. Barva, která svítí pořád,
 * přestane cokoli znamenat; barva, která se neobjeví nikdy, je hotová funkce
 * vypadající jako chybějící. Poučení z hlášek o větru (26. 8. 2026), kde byl
 * práh tak vysoko, že se hláška skoro nikdy neukázala.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  windTon, uvTon, pressureTon, soumrakPodil, STUPNE, VICHRICE_KMH,
} from '../web/lib/tile-tone.js';

/* ── vítr ─────────────────────────────────────────────────────────────── */

test('vítr: stupně sedí na Beaufortovu stupnici', () => {
  assert.equal(windTon(5).stupen, 'klid');
  assert.equal(windTon(25).stupen, 'mirne');
  assert.equal(windTon(45).stupen, 'pozor');
  assert.equal(windTon(65).stupen, 'zle');
  assert.equal(windTon(90).stupen, 'krize');
});

test('🚨 vítr: rozhoduje VYŠŠÍ z rychlosti a nárazů', () => {
  // Škodu udělá náraz, ne průměr. Vítr 45 s nárazy 95 je nebezpečná
  // situace, kterou by samotný průměr ukázal jako „pozor".
  assert.equal(windTon(45, 95).stupen, 'krize');
  assert.equal(windTon(45, 95).vichrice, true);
  assert.equal(windTon(45).vichrice, false, 'sám o sobě to vichřice není');
});

test('🚨 celá dlaždice zčervená až při vichřici, ne dřív', () => {
  // Nižší práh by dlaždici barvil několikrát do měsíce a přestalo by to
  // být varování — stalo by se to výzdobou.
  assert.equal(VICHRICE_KMH, 75, '9 Beaufortů');
  assert.equal(windTon(74).vichrice, false);
  assert.equal(windTon(75).vichrice, true);
});

test('vítr: podíl roste a nad vichřicí se zastaví', () => {
  assert.ok(windTon(10).podil < windTon(40).podil);
  assert.equal(windTon(75).podil, 1);
  assert.equal(windTon(300).podil, 1, '„červenější než červená" neexistuje');
});

test('vítr: chybějící hodnota není bezvětří', () => {
  // Nula km/h je klid; „nevíme" je něco jiného a nesmí se obarvit zeleně,
  // jako by bylo naměřeno hezky.
  assert.equal(windTon(null).stupen, 'zadny');
  assert.equal(windTon(undefined, undefined).stupen, 'zadny');
  assert.equal(windTon(NaN).stupen, 'zadny');
  assert.equal(windTon(0).stupen, 'klid', 'nula naměřená JE klid');
});

/* ── UV ───────────────────────────────────────────────────────────────── */

test('🚨 UV: hranice jsou podle WHO, ne vymyšlené', () => {
  // UV index je mezinárodní stupnice a její hranice zná i leták u bazénu.
  // Vlastní prahy by znamenaly, že appka radí jinak než všichni ostatní.
  assert.equal(uvTon(1).stupen, 'klid');      // 0–2 nízký
  assert.equal(uvTon(2.9).stupen, 'klid');
  assert.equal(uvTon(3).stupen, 'mirne');     // 3–5 střední
  assert.equal(uvTon(6).stupen, 'pozor');     // 6–7 vysoký
  assert.equal(uvTon(8).stupen, 'zle');       // 8–10 velmi vysoký
  assert.equal(uvTon(11).stupen, 'krize');    // 11+ extrémní
});

test('UV: v noci se nebarví — chybějící údaj není nula', () => {
  assert.equal(uvTon(null).stupen, 'zadny');
  assert.equal(uvTon(undefined).stupen, 'zadny');
  assert.equal(uvTon(0).stupen, 'klid', 'naměřená nula je nízká zátěž');
});

/* ── tlak ─────────────────────────────────────────────────────────────── */

test('tlak: běžné rozmezí se nebarví', () => {
  assert.equal(pressureTon(1013).stupen, 'klid');
  assert.equal(pressureTon(1000).stupen, 'klid');
  assert.equal(pressureTon(1025).stupen, 'klid');
});

test('tlak: nízký i vysoký se pozná, a je poznat KTERÝ', () => {
  assert.equal(pressureTon(995).smer, 'nizky');
  assert.equal(pressureTon(1030).smer, 'vysoky');
  assert.equal(pressureTon(985).stupen, 'zle');
  assert.equal(pressureTon(1040).stupen, 'zle');
});

test('🚨 tlak se bere PŘEPOČTENÝ NA HLADINU MOŘE, ne skutečný v místě', () => {
  // Ve 400 m je skutečný tlak kolem 970 hPa — úplně normální hodnota,
  // ale proti téhle stupnici vypadá jako hluboká níže. Appka by
  // v Jeseníkách hlásila trvalou krizi. Tenhle test to jen připomíná:
  // 970 je tu ZÁMĚRNĚ „zle", protože sem se posílá jen QNH.
  assert.equal(pressureTon(970).stupen, 'zle');
});

test('tlak: chybějící hodnota mlčí', () => {
  assert.equal(pressureTon(null).stupen, 'zadny');
  assert.equal(pressureTon(NaN).smer, null);
});

/* ── soumrak ──────────────────────────────────────────────────────────── */

const V = (h, m = 0) => Date.parse(`2026-08-29T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);

test('soumrak: v okamžiku plná síla, mimo okno nula', () => {
  assert.equal(soumrakPodil(V(6), V(6)), 1);
  assert.equal(soumrakPodil(V(8), V(6)), 0);
  assert.equal(soumrakPodil(V(4), V(6)), 0);
});

test('🚨 okno je ±45 minut, ne okamžik', () => {
  // Východ Slunce není okamžik, ale děj: obloha se barví dávno předtím,
  // než kotouč vyleze. Vteřinové okno by nikdo nikdy neviděl a funkce
  // by vypadala jako rozbitá.
  assert.ok(soumrakPodil(V(5, 30), V(6)) > 0.3, 'půl hodiny předtím už se barví');
  assert.ok(soumrakPodil(V(6, 30), V(6)) > 0.3, 'a půl hodiny potom taky');
  assert.equal(soumrakPodil(V(5, 15), V(6)), 0, 'tři čtvrtě hodiny je konec');
});

test('soumrak: sílí symetricky před i po', () => {
  assert.equal(soumrakPodil(V(5, 40), V(6)), soumrakPodil(V(6, 20), V(6)));
});

test('soumrak: bez času se nic nerozsvítí', () => {
  assert.equal(soumrakPodil(V(6), null), 0);
  assert.equal(soumrakPodil(NaN, V(6)), 0);
  assert.equal(soumrakPodil(V(6), V(6), 0), 0, 'nulové okno nesmí dělit nulou');
});

/* ── společná stupnice ────────────────────────────────────────────────── */

test('🚨 všechny stupně jsou ze společné stupnice', () => {
  // Kdyby si každý údaj vymyslel vlastní jméno, CSS by je muselo znát
  // všechna — a na jedno by se zapomnělo. Pak by dlaždice zůstala bez
  // barvy a vypadalo by to, že se nic neděje.
  const vsechny = [
    windTon(90).stupen, windTon(5).stupen, windTon(null).stupen,
    uvTon(9).stupen, uvTon(1).stupen, uvTon(null).stupen,
    pressureTon(985).stupen, pressureTon(1013).stupen, pressureTon(null).stupen,
  ];
  for (const s of vsechny) assert.ok(STUPNE.includes(s), 'neznámý stupeň: ' + s);
});

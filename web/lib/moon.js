/**
 * Fáze Měsíce.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě — a hlavně **bez další cizí služby**.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ SE TO POČÍTÁ, A NE STAHUJE
 *
 * 🚨 Michal 27. 8. 2026: *„a prosím, šlo by přidat fáze měsíce?"*
 *
 * Fáze Měsíce je jediný údaj v celé appce, který **není předpověď** — je to
 * astronomie. Nebeská mechanika se nemění a nemá výpadky, takže by bylo
 * absurdní vozit ji přes internet, platit za ni kvótou a nechat ji rozbít
 * se, když někomu spadne server. Deset řádků výpočtu je tady jednoznačně
 * lepší než jakákoli závislost (viz zásada „co nejmenší závislost na
 * třetích stranách, i za cenu vlastní práce").
 *
 * ⚠️ PŘESNOST. Počítá se ze **středního synodického měsíce** — tedy z toho,
 * jak dlouho v průměru trvá oběh od novu k novu. Skutečný oběh kolísá zhruba
 * o půl dne (dráha je eliptická a Slunce ji přitahuje různě podle roční
 * doby). Pro POJMENOVÁNÍ fáze to stačí bohatě: „dorůstající srpek" zůstane
 * dorůstajícím srpkem, i když se stáří Měsíce netrefí na hodinu.
 *
 * ⚠️ Na přesný okamžik úplňku na minuty by tohle stačit NEMUSELO. Kdyby
 * appka někdy chtěla psát „úplněk nastane v 04:12", musí se sáhnout po
 * pořádném algoritmu (Meeus), ne po tomhle.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * Střední délka synodického měsíce ve dnech (nov → nov).
 * Hodnota je astronomická konstanta, ne odhad.
 */
export const SYNODICKY_MESIC_DNU = 29.530588853;

/**
 * Známý nov: 6. ledna 2000, 18:14 UTC.
 * Od něj se počítá stáří Měsíce.
 */
const NOV_2000 = Date.UTC(2000, 0, 6, 18, 14, 0);

const DEN_MS = 86400000;

/**
 * Osm fází i s podílem oběhu, ve kterém platí.
 *
 * ⚠️ Hranice nejsou stejně velké schválně. Nov, první čtvrť, úplněk a
 * poslední čtvrť jsou v jednu chvíli **okamžiky**, ne období — ale člověk
 * je vidí jako stav, který pár dní vydrží. Kolem nich je proto úzké pásmo
 * a mezi nimi široké.
 */
const FAZE = [
  { klic: 'new',            do: 0.02,  ikona: '🌑' },
  { klic: 'waxingCrescent', do: 0.23,  ikona: '🌒' },
  { klic: 'firstQuarter',   do: 0.27,  ikona: '🌓' },
  { klic: 'waxingGibbous',  do: 0.48,  ikona: '🌔' },
  { klic: 'full',           do: 0.52,  ikona: '🌕' },
  { klic: 'waningGibbous',  do: 0.73,  ikona: '🌖' },
  { klic: 'lastQuarter',    do: 0.77,  ikona: '🌗' },
  { klic: 'waningCrescent', do: 0.98,  ikona: '🌘' },
  { klic: 'new',            do: 1.01,  ikona: '🌑' },   // konec oběhu = zase nov
];

/**
 * Fáze Měsíce v daném okamžiku.
 *
 * @param {number} [nowMs]  čas v ms (kvůli testu se předává zvenčí)
 * @returns {{klic: string, ikona: string, podil: number, osvetleni: number, stariDnu: number}}
 *   `podil` je 0–1 (0 = nov, 0,5 = úplněk), `osvetleni` je 0–1 (kolik kotouče svítí)
 */
export function moonPhase(nowMs = Date.now()) {
  const cas = Number(nowMs);
  if (!Number.isFinite(cas)) return null;

  const dnuOdNovu = (cas - NOV_2000) / DEN_MS;

  // Zbytek po dělení musí být kladný i pro data PŘED rokem 2000 —
  // `%` v JS vrací u záporných čísel záporný zbytek.
  const podil = (((dnuOdNovu / SYNODICKY_MESIC_DNU) % 1) + 1) % 1;

  // Osvětlená část kotouče. Roste a klesá podle kosinu — proto ne lineárně:
  // mezi srpkem a půlkou je z pohledu oka mnohem větší skok než mezi
  // třičtvrtěměsícem a úplňkem.
  const osvetleni = (1 - Math.cos(2 * Math.PI * podil)) / 2;

  const f = FAZE.find((x) => podil < x.do) || FAZE[0];

  return {
    klic: f.klic,
    ikona: f.ikona,
    podil,
    osvetleni,
    stariDnu: podil * SYNODICKY_MESIC_DNU,
  };
}

/** Všechny klíče fází — pro paritní test překladů. */
export const MOON_KEYS = [...new Set(FAZE.map((f) => f.klic))];

/* ────────────────────────────────────────────────────────────────────────
 * PŘESNÝ OKAMŽIK HLAVNÍCH FÁZÍ (Miki 24. 11. 2026: upozornění na úplněk a nov,
 * týž večer i na první a poslední čtvrť — R47, R48)
 *
 * Střední měsíc výš stačí na POJMENOVÁNÍ fáze, ale „úplněk v 15:53" by
 * minul o hodiny. Tady je Meeus, Astronomical Algorithms, kap. 49: střední
 * fáze + periodické opravy za Slunce, eliptickou dráhu a sklon. Přesnost
 * jsou desítky sekund — bez tabulek, bez sítě, bez cizí služby.
 *
 * ⚠️ Meeus dává čas v TT (rovnoměrný čas), hodiny jdou v UT. Rozdíl ΔT
 * je kolem 2026 asi 69 s a mění se o zlomek sekundy ročně; na minuty
 * v upozornění to stačí na desítky let.
 * ──────────────────────────────────────────────────────────────────────── */

/** ΔT = TT − UT v sekundách (IERS, kolem roku 2026). */
const DELTA_T_S = 69;

const RAD = Math.PI / 180;
const sinD = (stupne) => Math.sin(stupne * RAD);
const cosD = (stupne) => Math.cos(stupne * RAD);

/** Juliánské datum → ms od 1970 (UT). */
const jdNaMs = (jde) => (jde - 2440587.5) * DEN_MS - DELTA_T_S * 1000;

/**
 * Okamžik fáze pro „lunaci" k. Celé k = nov, k + 0,25 = první čtvrť,
 * k + 0,5 = úplněk, k + 0,75 = poslední čtvrť (k = 0 je nov 6. 1. 2000).
 */
function okamzikFaze(k) {
  const T = k / 1236.85;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;

  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3;          // Slunce
  const Mm = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4; // Měsíc
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
  const O = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;

  const zlomek = k - Math.floor(k);
  if (Math.abs(zlomek - 0.25) < 1e-9 || Math.abs(zlomek - 0.75) < 1e-9) {
    jde += opravaCtvrti(Mm, M, F, O, E, zlomek < 0.5);
  } else {
    jde += opravaNovuUplnku(Mm, M, F, O, E, Math.abs(zlomek - 0.5) < 1e-9);
  }

  // Opravy společné všem fázím (planety).
  const A = [
    [299.77 + 0.107408 * k - 0.009173 * T2, 0.000325],
    [251.88 + 0.016321 * k, 0.000165],
    [251.83 + 26.651886 * k, 0.000164],
    [349.42 + 36.412478 * k, 0.000126],
    [84.66 + 18.206239 * k, 0.00011],
    [141.74 + 53.303771 * k, 0.000062],
    [207.14 + 2.453732 * k, 0.00006],
    [154.84 + 7.30686 * k, 0.000056],
    [34.52 + 27.261239 * k, 0.000047],
    [207.19 + 0.121824 * k, 0.000042],
    [291.34 + 1.844379 * k, 0.00004],
    [161.72 + 24.198154 * k, 0.000037],
    [239.56 + 25.513099 * k, 0.000035],
    [331.55 + 3.592518 * k, 0.000023],
  ];
  for (const [uhel, vaha] of A) jde += vaha * sinD(uhel);
  return jde;
}

/** Periodické opravy novu a úplňku (Meeus, tab. 49.A, první dva sloupce). */
function opravaNovuUplnku(Mm, M, F, O, E, uplnek) {
  // Prvních šest koeficientů se u novu a úplňku liší, zbytek je společný.
  const [a, b, c, d, e, f] = uplnek
    ? [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515]
    : [-0.4072, 0.17241, 0.01608, 0.01039, 0.00739, -0.00514];
  const g = uplnek ? 0.00209 : 0.00208;

  return a * sinD(Mm)
    + b * E * sinD(M)
    + c * sinD(2 * Mm)
    + d * sinD(2 * F)
    + e * E * sinD(Mm - M)
    + f * E * sinD(Mm + M)
    + g * E * E * sinD(2 * M)
    - 0.00111 * sinD(Mm - 2 * F)
    - 0.00057 * sinD(Mm + 2 * F)
    + 0.00056 * E * sinD(2 * Mm + M)
    - 0.00042 * sinD(3 * Mm)
    + 0.00042 * E * sinD(M + 2 * F)
    + 0.00038 * E * sinD(M - 2 * F)
    - 0.00024 * E * sinD(2 * Mm - M)
    - 0.00017 * sinD(O)
    - 0.00007 * sinD(Mm + 2 * M)
    + 0.00004 * sinD(2 * Mm - 2 * F)
    + 0.00004 * sinD(3 * M)
    + 0.00003 * sinD(Mm + M - 2 * F)
    + 0.00003 * sinD(2 * Mm + 2 * F)
    - 0.00003 * sinD(Mm + M + 2 * F)
    + 0.00003 * sinD(Mm - M + 2 * F)
    - 0.00002 * sinD(Mm - M - 2 * F)
    - 0.00002 * sinD(3 * Mm + M)
    + 0.00002 * sinD(4 * Mm);
}

/**
 * Periodické opravy první a poslední čtvrti (Meeus, tab. 49.A, třetí
 * sloupec) a k tomu oprava W: k první čtvrti se přičítá, od poslední odečítá.
 *
 * 🚨 Miki 24. 11. 2026: *„by asi měl hlásit i přesný čtvrt a půlměsíc"*.
 * Čtvrť a půlměsíc jsou tentýž úkaz: svítí přesně půlka kotouče.
 */
function opravaCtvrti(Mm, M, F, O, E, prvni) {
  const oprava = -0.62801 * sinD(Mm)
    + 0.17172 * E * sinD(M)
    - 0.01183 * E * sinD(Mm + M)
    + 0.00862 * sinD(2 * Mm)
    + 0.00804 * sinD(2 * F)
    + 0.00454 * E * sinD(Mm - M)
    + 0.00204 * E * E * sinD(2 * M)
    - 0.0018 * sinD(Mm - 2 * F)
    - 0.0007 * sinD(Mm + 2 * F)
    - 0.0004 * sinD(3 * Mm)
    - 0.00034 * E * sinD(2 * Mm - M)
    + 0.00032 * E * sinD(M + 2 * F)
    + 0.00032 * E * sinD(M - 2 * F)
    - 0.00028 * E * E * sinD(Mm + 2 * M)
    + 0.00027 * E * sinD(2 * Mm + M)
    - 0.00017 * sinD(O)
    - 0.00005 * sinD(Mm - M - 2 * F)
    + 0.00004 * sinD(2 * Mm + 2 * F)
    - 0.00004 * sinD(Mm + M + 2 * F)
    + 0.00004 * sinD(Mm - 2 * M)
    + 0.00003 * sinD(Mm + M - 2 * F)
    + 0.00003 * sinD(3 * M)
    + 0.00002 * sinD(2 * Mm - 2 * F)
    + 0.00002 * sinD(Mm - M + 2 * F)
    - 0.00002 * sinD(3 * Mm + M);
  const W = 0.00306
    - 0.00038 * E * cosD(M)
    + 0.00026 * cosD(Mm)
    - 0.00002 * cosD(Mm - M)
    + 0.00002 * cosD(Mm + M)
    + 0.00002 * cosD(2 * F);
  return oprava + (prvni ? W : -W);
}

/** Juliánské datum (TT) — pro samotest proti příkladu z knihy. */
export const _okamzikFazeJDE = okamzikFaze;

/** Čtyři hlavní fáze: posun v lunaci, klíč (týž jako u `moonPhase`), ikona. */
const HLAVNI_FAZE = [
  [0, 'new', '🌑'],
  [0.25, 'firstQuarter', '🌓'],
  [0.5, 'full', '🌕'],
  [0.75, 'lastQuarter', '🌗'],
];

/**
 * Nov, první čtvrť, úplněk a poslední čtvrť v rozmezí `[odMs, doMs)`,
 * seřazené podle času.
 *
 * @returns {{klic: 'new'|'firstQuarter'|'full'|'lastQuarter', ms: number, ikona: string}[]}
 */
export function moonEvents(odMs, doMs) {
  const od = Number(odMs);
  const doo = Number(doMs);
  if (!Number.isFinite(od) || !Number.isFinite(doo) || doo <= od) return [];
  // Hrubé k ze středního měsíce, s rezervou jedné lunace na obě strany.
  const kOd = Math.floor((od - NOV_2000) / DEN_MS / SYNODICKY_MESIC_DNU) - 1;
  const kDo = Math.ceil((doo - NOV_2000) / DEN_MS / SYNODICKY_MESIC_DNU) + 1;
  const vysledek = [];
  for (let k = kOd; k <= kDo; k++) {
    for (const [posun, klic, ikona] of HLAVNI_FAZE) {
      const ms = jdNaMs(okamzikFaze(k + posun));
      if (ms >= od && ms < doo) vysledek.push({ klic, ms: Math.round(ms), ikona });
    }
  }
  return vysledek.sort((x, y) => x.ms - y.ms);
}

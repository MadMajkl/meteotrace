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
 * ⚠️ Hranice nejsou stejně velké schválně. Nov, první čtvrt, úplněk a
 * poslední čtvrt jsou v jednu chvíli **okamžiky**, ne období — ale člověk
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

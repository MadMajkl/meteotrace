/**
 * Piktogramy alergenů.
 *
 * ⚠️ ČISTÝ MODUL. Vrací jen popis tvaru — kreslení do stránky dělá `app.js`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ VLASTNÍ TVARY A NE EMOJI
 *
 * Zbytek appky používá pro počasí emoji a je to správně: mrak jako mrak.
 * U alergenů to ale nestačí — **emoji neumí rozlišit břízu od olše**, a to
 * jsou pro alergika dva úplně různé světy. Proto šest vlastních tvarů,
 * kreslených čárou:
 *
 *   · nesou se v jednom stylu s ostatními odznaky,
 *   · barví se podle stupně (`currentColor`), takže semafor platí i tady,
 *   · nejsou to obrázky — je to pár set bajtů v kódu, nic se nestahuje.
 *
 * ⚠️ Piktogram je vždy JEN DOPLNĚK. Vedle něj stojí jméno druhu i slovní
 * stupeň — kdo tvar nepozná (a poznat olši od pelyňku je fakt sport), nesmí
 * o informaci přijít.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * Tvary v mřížce 24 × 24.
 *
 * `cara` se kreslí obrysem, `plocha` výplní. Držet to na dvou částech stačí
 * na všechno, co tu je, a nenutí to psát vlastní vykreslovač.
 */
const TVARY = {
  // ⚠️ Tvary jsou PLNÉ SILUETY, ne kresba čárou, a liší se OBRYSEM, ne detailem.
  // První pokus měl žilkování a zoubkování — v 22 px se to slilo a bříza
  // vypadala přesně jako olše. Rozeznat se musí tvar, ne výzdoba.

  // Olše — kulatý list. Proti břízě „koule versus špička".
  alder: {
    plocha: 'M12 4.5c4.2 1.6 6.5 4.6 6.5 8 0 3.4-2.9 5.8-6.5 5.8s-6.5-2.4-6.5-5.8c0-3.4 2.3-6.4 6.5-8z',
    cara: 'M12 21v-3',
  },
  // Bříza — trojúhelníkový list se špičkou nahoru.
  birch: {
    plocha: 'M12 3 4.8 16.2c-.5.9.1 1.9 1.1 2.1 3.9.8 8.3.8 12.2 0 1-.2 1.6-1.2 1.1-2.1z',
    cara: 'M12 21v-2.6',
  },
  // Trávy — klas: stéblo a zrna po stranách.
  grass: {
    plocha: 'M12.9 4.6c1.6.2 2.6 1.2 2.9 2.9-1.6-.2-2.6-1.2-2.9-2.9zM11.1 7.2c-1.6.2-2.6 1.2-2.9 2.9 1.6-.2 2.6-1.2 2.9-2.9zM12.9 9.4c1.6.2 2.6 1.2 2.9 2.9-1.6-.2-2.6-1.2-2.9-2.9zM11.1 12c-1.6.2-2.6 1.2-2.9 2.9 1.6-.2 2.6-1.2 2.9-2.9z',
    cara: 'M12 21V3.6',
  },
  // Pelyněk — větvička s protilehlými lístky. Proti klasu je rozložitá do stran.
  mugwort: {
    plocha: 'M11.4 7C9.8 5.6 8 5.1 5.9 5.4c.3 2.1 1.2 3.6 3 4.4.9.4 1.8-.1 2.5-.8zM12.6 9.6c1.6-1.4 3.4-1.9 5.5-1.6-.3 2.1-1.2 3.6-3 4.4-.9.4-1.8-.1-2.5-.8zM11.4 12.6c-1.6-1.4-3.4-1.9-5.5-1.6.3 2.1 1.2 3.6 3 4.4.9.4 1.8-.1 2.5-.8zM12.6 15.2c1.6-1.4 3.4-1.9 5.5-1.6-.3 2.1-1.2 3.6-3 4.4-.9.4-1.8-.1-2.5-.8z',
    cara: 'M12 21V4',
  },
  // Oliva — úzký list a plod. Plod je schválně velký, jinak v malém zmizí.
  olive: {
    plocha: 'M4.8 14.2C7.4 8.9 11.6 5.7 17.2 4.8c-.4 5.8-3.4 9.8-8.6 11.6-1.6.5-3-.4-3.8-2.2z',
    kruh: [17.8, 17.4, 3.4],
  },
  // Ambrózie — trojlaločný list. Nejagresivnější alergen u nás, ať je poznat.
  ragweed: {
    plocha: 'M12 3.4c1.3 2 1.9 4 1.8 6 1.6-1.4 3.5-2.1 5.7-2.2-.6 2.9-2.2 5-4.8 6.2 1.4.5 2.5 1.4 3.3 2.7-2.6.9-4.9.6-6.9-.9v3.6h-.2v-3.6c-2 1.5-4.3 1.8-6.9.9.8-1.3 1.9-2.2 3.3-2.7C4.7 12.2 3.1 10.1 2.5 7.2c2.2.1 4.1.8 5.7 2.2-.1-2 .5-4 1.8-6z',
    cara: 'M12 21v-3',
  },
};

/** Druhy, pro které je tvar. Kontroluje to samotest proti seznamu v `station.js`. */
export const ICON_SPECIES = Object.keys(TVARY);

/**
 * Popis piktogramu, nebo `null` u neznámého druhu.
 *
 * Neznámý druh **nesmí spadnout ani nic nakreslit** — přibude-li do zdroje
 * dat sedmý alergen, appka ho vypíše bez obrázku a čeká, až se tvar dokreslí.
 * To je lepší než cizí tvar u cizího jména.
 *
 * @param {string} species
 * @returns {{plocha?: string, cara?: string, kruh?: number[]}|null}
 */
export function pollenIcon(species) {
  return TVARY[species] || null;
}

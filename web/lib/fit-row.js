/**
 * Kolik položek se vejde do jednoho řádku.
 *
 * ⚠️ ČISTÝ MODUL. Dostane naměřené šířky a vrátí počet — sám nic neměří
 * ani nekreslí. Díky tomu se dá tahle úvaha ověřit bez prohlížeče, přestože
 * slouží výhradně jemu.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 PROČ SE POČÍTÁ A NEHÁDÁ
 *
 * Michal 26. 8. 2026: *„nechat tam vedle X posledních — podle toho, kolik
 * se tam skutečně vejde."* Napevno daný počet (třeba tři) je na širokém
 * displeji plýtvání místem a na úzkém přetečení. A šířka štítku závisí na
 * jméně: „Domov" je třikrát kratší než „Praha → Brno přes Havlíčkův Brod".
 *
 * Měří se proto skutečné šířky a teprve z nich se počítá.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * @param {number[]} sirky      šířky položek v pořadí, jak mají jít za sebou
 * @param {number} kDispozici   kolik místa řádek má
 * @param {number} [mezera]     odstup mezi položkami
 * @param {number} [minPocet]   kolik se ukáže vždy, i kdyby přetekly
 * @returns {number} počet položek, které se mají vykreslit
 */
export function fitCount(sirky, kDispozici, mezera = 8, minPocet = 1) {
  const seznam = (sirky || []).filter((s) => Number.isFinite(s) && s > 0);
  if (!seznam.length) return 0;

  // ⚠️ Nesmyslná šířka (0, záporná, NaN) znamená, že se ještě nekreslilo —
  // pak je poctivější ukázat aspoň minimum než schovat všechno a tvářit se,
  // že nic není.
  if (!Number.isFinite(kDispozici) || kDispozici <= 0) {
    return Math.min(minPocet, seznam.length);
  }

  let zabrano = 0;
  let vejde = 0;

  for (const sirka of seznam) {
    const potreba = vejde === 0 ? sirka : sirka + mezera;
    if (zabrano + potreba > kDispozici) break;
    zabrano += potreba;
    vejde += 1;
  }

  // 🚨 Aspoň jedna položka se ukáže vždycky. Prázdný řádek vedle nadpisu
  // „Moje trasy" vypadá jako vada, i když je to jen úzký displej — a od
  // toho, aby se dalo dostat ke zbytku, je rozbalení.
  return Math.max(Math.min(minPocet, seznam.length), vejde);
}

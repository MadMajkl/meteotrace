/**
 * Úprava dotazu pro hledání míst.
 *
 * ⚠️ ČISTÝ MODUL. Žádná síť, žádné DOM.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 PROČ TO VŮBEC EXISTUJE: DIAKRITIKA ROZBÍJÍ HLEDÁNÍ
 *
 * Změřeno 24. 8. 2026 na geokódování Open-Meteo:
 *
 *   „Plzeň"           → 0 nálezů
 *   „Plzen"           → 2 nálezy, první je **Plzeň**
 *   „Horšovský Týn"   → 0 nálezů
 *   „Horsovsky Tyn"   → 2 nálezy, první je **Horšovský Týn**
 *
 * Služba tedy města zná, jen je neumí najít podle jejich vlastního jména.
 * Pro českého uživatele to znamená, že appka „nenajde skoro nic" — a přesně
 * tak to Michal popsal, když na to narazil.
 *
 * Diakritika se proto před odesláním sundá. **Zobrazuje se pořád správné
 * jméno**, protože to vrací služba sama („Plzen" → „Plzeň").
 *
 * ⚠️ Neřeší to adresy. Open-Meteo zná jen sídla — ulice a čísla popisná
 * v jeho datech nejsou vůbec a žádná úprava dotazu je tam nenajde.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * Sundá diakritiku, zbytek nechá být.
 *
 * Rozloží znaky na základ a spojovací značku (NFD) a značky zahodí.
 * ⚠️ Nelatinková písma (řečtina, cyrilice, arabština) tím projdou beze
 * změny v tom smyslu, že se z nich nestane latinka — zmizí jen kombinující
 * značky, což je u nich správně.
 */
export function stripDiacritics(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC');
}

/**
 * Dotaz připravený pro geokódování.
 *
 * @param {string} text  co uživatel napsal
 * @returns {string}     co se pošle do služby
 */
export function searchQuery(text) {
  return stripDiacritics(String(text ?? '').trim());
}

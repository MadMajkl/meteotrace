/**
 * Závažnost výstrahy — jediná tabulka stupňů v celém projektu.
 *
 * ⚠️ Vlastní modul BEZ ZÁVISLOSTÍ schválně. Potřebuje ho proxy (ořez podle
 * prahu) i appka (kdy upozornit), a proxy nemá mít nic společného s texty —
 * kdyby si to brala z `warn-notify.js`, tahala by si s tím celé překlady.
 *
 * 🚨 A hlavně: tabulka smí být JEN JEDNA. Kdyby ji měl zvlášť server, zvlášť
 * web a zvlášť androidí obal, rozešly by se při první opravě — a rozdíl by
 * se projevil tím, že by se na něco nezazvonilo. Obal proto žádnou nemá:
 * posílá práh serveru jako parametr a jen porovnává, co dostane zpátky.
 */

'use strict';

/** Od nejhorší po nejmírnější. `Unknown` je na konci, ale viz `staciNa()`. */
export const STUPNE = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

/** Výchozí práh pro upozorňování. Viz `staciNa()` — proč zrovna tenhle. */
export const VYCHOZI_PRAH = 'Moderate';

/**
 * Je závažnost aspoň taková, aby se kvůli ní smělo zazvonit?
 *
 * 🚨 VÝCHOZÍ PRÁH JE `Moderate`, NE `Minor` — a je to rozhodnutí, ne lenost.
 * ČHMÚ vydává nízké stupně skoro obden (mráz, náledí, riziko požárů).
 * Upozornění, které otravuje, si člověk vypne — a pak nedostane ani to,
 * kvůli čemu celá věc vznikla. Radši mlčet u drobnosti než být umlčen
 * u bouřky.
 *
 * ⚠️ `Unknown` propadá VŽDYCKY. Neznámá závažnost není nízká závažnost;
 * zahodit ji tiše by znamenalo mlčet právě tam, kde nevíme, oč jde.
 *
 * ⚠️ Nesmyslný práh taky propouští všechno. Pokažená hodnota v nastavení
 * by jinak upozornění vypnula potichu — a to je ten nejhorší způsob, jak
 * přijít o výstrahu.
 */
export function staciNa(severity, prah = VYCHOZI_PRAH) {
  if (!severity || severity === 'Unknown') return true;
  const kde = STUPNE.indexOf(severity);
  const meze = STUPNE.indexOf(prah);
  if (kde === -1 || meze === -1) return true;
  return kde <= meze;
}

/**
 * Kde leží podkladová mapa.
 *
 * ⚠️ ČISTÝ MODUL. Jen čte nastavení a skládá adresu — žádná síť, žádné DOM
 * mimo jednu značku v hlavičce stránky.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO NENÍ NATVRDO V KÓDU
 *
 * `R0` má tvrdou podmínku: **výměna poskytovatele nebo hostingu musí být
 * změna konfigurace, ne přepis appky.** Archiv má 1,4 GB, takže nemůže ležet
 * tam, kde zbytek webu — poletí z objektového úložiště, a jeho adresa se bude
 * lišit podle toho, kam se zrovna nasadí (vývoj u sebe, testovací nasazení,
 * ostrý provoz).
 *
 * Adresa se proto bere ze značky v hlavičce stránky:
 *
 *     <meta name="meteotrace:tiles" content="https://dlazdice.example/cz.pmtiles">
 *
 * Nasazení tedy mění **jeden řádek v HTML**, ne kód. Když značka chybí,
 * použije se soubor vedle appky — tak to jede při vývoji.
 *
 * ⚠️ Adresa musí být na doméně, která umí **částečné stahování** (`Range`)
 * a **CORS**, jinak si prohlížeč z archivu nevezme nic. Úložiště typu R2
 * nebo S3 to umí, běžný statický hosting často ne.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** Když se nic nenastaví, jede se ze souboru vedle appky (vývoj). */
export const VYCHOZI_DLAZDICE = 'data/cz.pmtiles';

/**
 * Přečte adresu podkladu z hlavičky stránky.
 *
 * @param {Document|{querySelector: Function}} [doc]
 * @returns {string} adresa, vždy neprázdná
 */
export function tilesSource(doc = globalThis.document) {
  const znacka = doc?.querySelector?.('meta[name="meteotrace:tiles"]');
  const hodnota = znacka?.getAttribute('content')?.trim();
  return hodnota || VYCHOZI_DLAZDICE;
}

/**
 * Úplná adresa archivu.
 *
 * Relativní zápis se doplní podle adresy stránky — knihovna `pmtiles`
 * potřebuje úplnou adresu, relativní by jí nestačila.
 *
 * @param {string} [base]  adresa stránky (kvůli testu)
 * @param {Document} [doc]
 */
export function tilesUrl(base = globalThis.location?.href, doc) {
  const zdroj = tilesSource(doc);
  if (/^https?:\/\//i.test(zdroj)) return zdroj;
  if (!base) return zdroj;
  return new URL(zdroj, base).href;
}

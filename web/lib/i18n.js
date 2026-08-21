/**
 * Lokalizace — rejstřík a mechanika. Texty leží v `lang/<kód>.js`.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě. (`localStorage` čte až UI, ne tenhle soubor.)
 *
 * Vzor je Gulpka (jeden slovník, paritní test jako povinná brána) a mailniño
 * (texty rozdělené po souborech). Dva rozdíly proti Gulpce:
 *
 *   1. 🚨 REFERENČNÍ JAZYK JE ANGLIČTINA, ne čeština. Klíče i výchozí texty
 *      se zakládají v `en.js`; ostatní jazyky se proti ní porovnávají.
 *   2. Jednotky NEJSOU součástí jazyka — mají vlastní osu v `units.js` (`R10`).
 *
 * PŘIDÁNÍ JAZYKA = TŘI ZÁSAHY:
 *   1. nový soubor v `lang/`, zkopírovaný z `en.js` a přeložený
 *   2. `import` + řádek v `LANGS` níže
 *   3. endonym do `LANG_NAMES`
 * Paritní test si jazyk najde sám podle `LANGS`, takže se na kontrolu
 * zapomenout nedá.
 */

'use strict';

import en from './lang/en.js';
import cs from './lang/cs.js';

/** Rejstřík jazyků. Klíč = kód podle BCP 47 (jen část před pomlčkou). */
export const LANGS = { en, cs };

/** Jména jazyků v nich samotných — nikdy se nepřekládají. */
export const LANG_NAMES = { en: 'English', cs: 'Čeština' };

/** Referenční jazyk: proti němu se měří úplnost ostatních. */
export const REFERENCE = 'en';

/**
 * Odhad jazyka podle zařízení.
 *
 * Bere se jen část PŘED pomlčkou, takže `cs-CZ` i `cs` trefí češtinu stejně.
 * Neznámý jazyk spadne na referenční — prázdné UI je horší než cizí jazyk.
 *
 * @param {string[]} [preferred]  typicky `navigator.languages`
 */
export function detectLang(preferred = []) {
  for (const tag of preferred) {
    const code = String(tag).split('-')[0].toLowerCase();
    if (LANGS[code]) return code;
  }
  return REFERENCE;
}

/**
 * Text podle tečkové cesty, např. `t('now.feelsLike', 'cs')`.
 *
 * ⚠️ Chybějící klíč se NEVRACÍ jako prázdný řetězec. Prázdné místo v UI si
 * nikdo nespojí s chybějícím překladem a vada se nikdy neopraví. Místo toho
 * se zkusí referenční jazyk a teprve pak se vrátí sama cesta — ta je v UI
 * ošklivá tak, že si jí všimne každý.
 *
 * @param {string} path
 * @param {string} [lang]
 */
export function t(path, lang = REFERENCE) {
  return lookup(LANGS[lang], path) ?? lookup(LANGS[REFERENCE], path) ?? path;
}

/**
 * Text s dosazením: `tf('now.updated', {time: '14:20'}, 'cs')`.
 *
 * Zástupný text v hodnotě má tvar `{jméno}`. Nedosazené zástupné texty
 * zůstanou vidět — zase schválně, ať je vada nepřehlédnutelná.
 */
export function tf(path, params = {}, lang = REFERENCE) {
  return String(t(path, lang)).replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole);
}

function lookup(dict, path) {
  if (!dict) return undefined;
  let node = dict;
  for (const part of String(path).split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    // hasOwnProperty, ne `in` — jinak by `toString` nebo `constructor`
    // prošly jako existující klíč a vrátily funkci místo textu.
    if (!Object.prototype.hasOwnProperty.call(node, part)) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/* ============================================================
   PARITA — povinná brána (volá ji selftest:logic)
   ============================================================ */

/** Všechny tečkové cesty ke KONCOVÝM textům. */
export function keyPaths(dict, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(dict || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') out.push(...keyPaths(value, path));
    else out.push(path);
  }
  return out.sort();
}

/**
 * Porovná jazyk s referenčním.
 *
 * Hlásí obojí — co chybí i co přebývá. Přebývající klíč není neškodný:
 * obvykle je to překlep, kvůli kterému někde jinde text chybí.
 *
 * @returns {{lang: string, missing: string[], extra: string[], empty: string[]}}
 */
export function checkLang(lang) {
  const ref = new Set(keyPaths(LANGS[REFERENCE]));
  const own = new Set(keyPaths(LANGS[lang]));

  return {
    lang,
    missing: [...ref].filter((k) => !own.has(k)),
    extra: [...own].filter((k) => !ref.has(k)),
    // Prázdný text projde kontrolou klíčů, ale v UI je stejná díra
    // jako chybějící klíč — proto se hlídá zvlášť.
    empty: [...own].filter((k) => !String(t(k, lang)).trim()),
  };
}

/** Kontrola všech jazyků najednou. */
export function checkAllLangs() {
  return Object.keys(LANGS).filter((l) => l !== REFERENCE).map(checkLang);
}

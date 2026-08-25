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
    // ⚠️ Tvary množného čísla se do cest NEROZBALUJÍ. Kolik jich je, určuje
    // JAZYK: čeština má `one/few/other`, angličtina `one/other`. Kdyby se
    // porovnávaly jako obyčejné klíče, hlásila by parita české tvary jako
    // „klíče navíc" a nutila by psát je i tam, kde nedávají smysl.
    // Že jsou tvary úplné, se hlídá zvlášť — viz `checkPlurals()`.
    if (isPlural(value)) out.push(path);
    else if (value && typeof value === 'object') out.push(...keyPaths(value, path));
    else out.push(path);
  }
  return out.sort();
}

/** Kategorie, které umí `Intl.PluralRules`. Nic jiného tvarem není. */
const KATEGORIE = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** Je tahle hodnota sada tvarů množného čísla? */
export function isPlural(value) {
  if (!value || typeof value !== 'object') return false;
  const klice = Object.keys(value);
  return klice.length > 0
    && klice.every((k) => KATEGORIE.includes(k))
    && Object.values(value).every((v) => typeof v === 'string');
}

/**
 * Má jazyk u každého množného čísla všechny tvary, které jeho gramatika
 * vyžaduje?
 *
 * 🚨 Chybějící tvar se v UI neprojeví jako díra, ale jako ŠPATNÁ ČEŠTINA —
 * spadne se na `other` a vyjde „na 1 místech". Přesně to Michal našel
 * 25. 8. 2026.
 *
 * @returns {{lang: string, path: string, missing: string[]}[]}
 */
export function checkPlurals(lang) {
  const potreba = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  const problemy = [];

  const projdi = (node, prefix) => {
    for (const [key, value] of Object.entries(node || {})) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (isPlural(value)) {
        const chybi = potreba.filter((k) => !Object.prototype.hasOwnProperty.call(value, k));
        if (chybi.length) problemy.push({ lang, path, missing: chybi });
      } else if (value && typeof value === 'object') {
        projdi(value, path);
      }
    }
  };
  projdi(LANGS[lang], '');
  return problemy;
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

/* ============================================================
   MNOŽNÉ ČÍSLO

   🚨 „Déšť na 1 místech" je česky špatně a v appce to bylo vidět (Michal
   25. 8. 2026). Čeština má tři tvary tam, kde angličtina dva:

       1 místo · 2–4 místa · 5 a víc míst

   Dosazovat číslo do jedné věty tedy nestačí. Tvary vybírá `Intl.PluralRules`,
   vestavěné v prohlížeči i v Node — žádná knihovna, žádná vlastní tabulka
   pravidel pro jazyky, které teprve přibudou (`R0`).

   V překladu se takový text zapíše jako objekt tvarů:

       rain: { one: 'Déšť na {count} místě.', few: 'Déšť na {count} místech.',
               other: 'Déšť na {count} místech.' }
   ============================================================ */

/** Cache pravidel — `Intl.PluralRules` není zadarmo a volá se v seznamech. */
const PRAVIDLA = new Map();

function pravidlaPro(lang) {
  if (!PRAVIDLA.has(lang)) {
    try {
      PRAVIDLA.set(lang, new Intl.PluralRules(lang));
    } catch {
      PRAVIDLA.set(lang, new Intl.PluralRules(REFERENCE));
    }
  }
  return PRAVIDLA.get(lang);
}

/**
 * Text s množným číslem.
 *
 * @param {string} path   cesta ke klíči, jehož hodnota je objekt tvarů
 * @param {number} count  počet, podle kterého se tvar vybírá
 * @param {object} [params] další dosazované hodnoty (`{count}` se doplní sám)
 * @param {string} [lang]
 */
export function tp(path, count, params = {}, lang = REFERENCE) {
  const tvary = lookupNode(LANGS[lang], path) ?? lookupNode(LANGS[REFERENCE], path);

  // Nepovinný přepis: když je hodnota obyčejný text, chová se `tp` jako `tf`.
  // Překlad, který množné číslo nepotřebuje, tak nemusí psát tři stejné tvary.
  if (typeof tvary === 'string') return tf(path, { count, ...params }, lang);
  if (!tvary || typeof tvary !== 'object') return path;

  const kategorie = pravidlaPro(lang).select(count);
  // ⚠️ `other` je poslední záchrana — je povinné v každém jazyce, takže se
  // nikdy nestane, že by se nevrátilo nic.
  const text = tvary[kategorie] ?? tvary.other ?? tvary.one ?? path;
  return String(text).replace(/\{(\w+)\}/g, (whole, key) => {
    if (key === 'count') return String(count);
    return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole;
  });
}

/** Jako `lookup`, ale vrací i objekt (tvary množného čísla). */
function lookupNode(dict, path) {
  if (!dict) return undefined;
  let node = dict;
  for (const part of String(path).split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

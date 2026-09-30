/**
 * Povolení polohy — co o něm říct a co s ním jde udělat jedním klepnutím.
 *
 * ⚠️ ČISTÝ MODUL. Nezjišťuje stav ani se na nic neptá — dostane stav
 * a vrátí, jaký text a jaké tlačítko k němu patří. Zjišťování a samotnou
 * žádost dělá `app.js` (prohlížeč) a obal (`MainActivity.kt`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO EXISTUJE
 *
 * Michal 30. 9. 2026: *„potřebujeme do nastavení dát, aby tam bylo na
 * kliknutí povolení polohy!"*
 *
 * Do té doby se appka na polohu ptala JEN při klepnutí na „Tady". Kdo
 * dialog jednou odmítl (na Androidu 11+ stačí dvakrát a systém se už
 * nezeptá vůbec), neměl v appce ŽÁDNOU cestu, jak to napravit: „Tady"
 * jen opakovalo „polohu se nepodařilo zjistit" a povolení bylo schované
 * tři úrovně hluboko v nastavení telefonu. A bez polohy nejede ani widget,
 * ani ranní zpráva — takže mlčely i ty.
 *
 * 🚨 JEDNO TLAČÍTKO, ČTYŘI RŮZNÉ AKCE. Co klepnutí udělá, závisí na stavu:
 *
 * | stav | co to je | tlačítko |
 * |---|---|---|
 * | `prompt` | ještě se nikdo neptal, nebo jde zeptat znovu | zeptat se |
 * | `denied` v obalu | Android se nejspíš už ptát nebude | zkusit dialog; když se neukáže, otevřít nastavení appky |
 * | `denied` na webu | prohlížeč se už ptát nebude | ŽÁDNÉ — web tam nedosáhne, jen návod |
 * | `off` | povolení je, ale poloha v telefonu je vypnutá | otevřít nastavení polohy |
 * | `granted` | hotovo | žádné |
 *
 * Tlačítko, které by ve stavu `denied` dál „žádalo o povolení", by nedělalo
 * nic — a nefunkční tlačítko se od rozbité appky nedá odlišit.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** Stavy, které umíme rozlišit. Cokoli jiného je `unknown`. */
export const STAVY_POLOHY = ['granted', 'prompt', 'denied', 'off', 'unsupported', 'unknown'];

/** Vyčistí stav z obalu nebo z prohlížeče — cizí hodnota je „nevíme". */
export function normalizeAccess(raw) {
  return STAVY_POLOHY.includes(raw) ? raw : 'unknown';
}

/**
 * Co k danému stavu ukázat.
 *
 * @param {string} stav     jeden ze `STAVY_POLOHY`
 * @param {boolean} vObalu  běží appka v androidím obalu (ten umí otevřít nastavení)?
 * @returns {{status: string, button: string|null, action: 'ask'|'settings'|'service'|null, hint: string|null}}
 *   `status`, `button` a `hint` jsou KLÍČE překladu, ne texty
 */
export function locationView(stav, vObalu) {
  switch (normalizeAccess(stav)) {
    case 'granted':
      return { status: 'location.granted', button: null, action: null, hint: 'location.grantedHint' };
    case 'denied':
      return vObalu
        // Tlačítko se jmenuje stejně jako u `prompt`: obal nejdřív zkusí
        // dialog a nastavení telefonu otevře, jen když se dialog neukáže.
        ? { status: 'location.denied', button: 'location.allow', action: 'settings', hint: 'location.deniedHintApp' }
        // ⚠️ Web do nastavení prohlížeče nedosáhne. Tlačítko by tu nedělalo nic.
        : { status: 'location.denied', button: null, action: null, hint: 'location.deniedHintWeb' };
    case 'off':
      return { status: 'location.off', button: 'location.turnOn', action: 'service', hint: 'location.offHint' };
    case 'unsupported':
      return { status: 'location.unsupported', button: null, action: null, hint: null };
    // `prompt` i `unknown`: zeptat se jde vždycky — a prohlížeč, který stav
    // neprozradí (starší Safari), se při žádosti zeptá stejně.
    default:
      return { status: 'location.notYet', button: 'location.allow', action: 'ask', hint: 'location.askHint' };
  }
}

/**
 * Stav v androidím obalu z toho, co ví systém.
 *
 * 🚨 Android neumí říct „zakázáno natrvalo" přímo. `muzeSeZeptat`
 * (`shouldShowRequestPermissionRationale`) je `false` ve DVOU případech:
 * když se ještě nikdo neptal, a když se už ptát nesmí. Rozliší je jen to,
 * jestli jsme se už někdy ptali — a to si musí obal pamatovat sám.
 *
 * (Tahle tabulka je tu kvůli testu; obal ji má opsanou v Kotlinu
 * a `selftest-obal.mjs` hlídá, že se nerozešly.)
 */
export function androidAccess({ povoleno, sluzbaZapnuta, ptaliSe, muzeSeZeptat }) {
  if (povoleno) return sluzbaZapnuta ? 'granted' : 'off';
  return ptaliSe && !muzeSeZeptat ? 'denied' : 'prompt';
}

/** Chyba z `navigator.geolocation`: 1 = zakázáno, 2 = nedostupná, 3 = vypršel čas. */
export function isDeniedError(err) {
  return Number(err?.code) === 1;
}

/**
 * Uvítání při prvním spuštění.
 *
 * Michal 29. 8. 2026: čtyři kroky, ve kterých si člověk vybere domov
 * a oblíbený cíl — a appka mu pak na jeho vlastních datech ukáže, co umí.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO JE MODUL A NE JEN PÁR PODMÍNEK V `app.js`
 *
 * Protože se tu rozhoduje o tom, **komu se appka postaví do cesty**. Uvítání,
 * které vyskočí nesprávnému člověku nebo se nedá opustit, je horší než žádné:
 * z první minuty s appkou udělá překážku. Takové rozhodování patří do testu,
 * ne do hlavy.
 *
 * ⚠️ Čistý modul: žádné DOM, žádná síť. Kreslení a dotazy dělá `app.js`.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * Kroky v pořadí.
 *
 * 🚨 `klic` je jméno pro LOGIKU (česky, jako všude v projektu), `text` je
 * předpona překladu (anglicky, protože i18n klíče jsou anglické — viz
 * `lang/en.js`). Držet obojí v jednom poli by znamenalo porušit jedno
 * z těch dvou pravidel; chytlo se to až v prohlížeči, kde se místo textů
 * ukazovalo „onboarding.domovTitle".
 *
 * `zivaAppka` znamená, že se v tom kroku nekreslí vlastní obrazovka, ale
 * ukazuje se **skutečná appka** s vysvětlujícím proužkem přes ni.
 *
 * 🚨 Schválně ne obrázky. Snímek obrazovky v uvítání se za měsíc rozejde
 * s tím, co appka doopravdy dělá, a **nikdo si toho nevšimne** — je to
 * jediné místo, které nikdo znovu neotevře. Živá appka zastarat nemůže.
 */
export const KROKY = [
  { klic: 'domov', text: 'home', zivaAppka: false, potrebujeVyber: true },
  { klic: 'cil', text: 'goal', zivaAppka: false, potrebujeVyber: true, lzePreskocit: true },
  { klic: 'misto', text: 'place', zivaAppka: true },
  { klic: 'trasa', text: 'route', zivaAppka: true, jenSCilem: true },
];

/**
 * Má se uvítání vůbec spustit?
 *
 * 🚨 ROZHODUJE VLASTNÍ PŘÍZNAK, NE PRÁZDNOTA SEZNAMU MÍST. Kdo si všechna
 * místa smaže, nechce být vítán znovu jako nováček — a kdo uvítáním jednou
 * prošel, tomu se už nikdy stavět do cesty nemá.
 *
 * ⚠️ Prázdný seznam míst je jen druhá podmínka. Uvítání nasazené člověku,
 * který už appku používá (třeba po vyčištění úložiště v novější verzi),
 * by ho připravilo o obrazovku, na kterou byl zvyklý.
 *
 * @param {object} a
 * @param {boolean} a.hotovo      prošel už uvítáním?
 * @param {number} a.pocetMist    kolik má uložených míst
 * @returns {boolean}
 */
export function maSeSpustit({ hotovo, pocetMist = 0 } = {}) {
  if (hotovo) return false;
  return !pocetMist;
}

/**
 * Vytvoří průchod uvítáním.
 *
 * @param {object} [stav]
 * @param {boolean} [stav.maCil]  vybral si oblíbený cíl?
 */
export function createOnboarding({ maCil = false } = {}) {
  let i = 0;
  let cil = !!maCil;

  /** Kroky, které se pro tenhle průchod opravdu ukážou. */
  const viditelne = () => KROKY.filter((k) => !k.jenSCilem || cil);

  return {
    /** Který krok je na řadě. `null` = konec. */
    get krok() { return viditelne()[i] || null; },
    /** Kolikátý z kolika — do teček pod obrazovkou. */
    get poradi() { return { kolikaty: i + 1, celkem: viditelne().length }; },
    get hotovo() { return i >= viditelne().length; },
    get maCil() { return cil; },

    /**
     * Cíl je vybraný (nebo naopak přeskočený).
     *
     * ⚠️ Mění POČET KROKŮ: bez cíle nemá poslední krok co ukazovat. Trasa
     * z domova nikam by byla prázdná obrazovka s vysvětlením, které se
     * nevztahuje k ničemu na ní.
     */
    nastavCil(ano) { cil = !!ano; },

    /** Dál. Vrací nový krok, nebo `null`, když je konec. */
    dalsi() {
      if (i < viditelne().length) i += 1;
      return this.krok;
    },

    /** Zpět. ⚠️ Nikdy pod nulu — první krok je první. */
    zpet() {
      if (i > 0) i -= 1;
      return this.krok;
    },

    /** Přeskočit celé uvítání. */
    ukonci() { i = viditelne().length; },
  };
}

/**
 * Které archivy podkladové mapy vyrábíme a nahráváme (`R3`, `R32`, `R34`).
 *
 * Sdílí je `tiles-build.mjs` i `tiles-upload.mjs`, ať se jméno souboru, výřez
 * a přiblížení nerozjedou mezi výrobou a nahráním.
 *
 *     npm run tiles                     # Česko (výchozí)
 *     npm run tiles -- --oblast=sahara  # jiná oblast z tabulky níž
 *     npm run tiles -- --svet           # zkratka pro --oblast=svet
 *
 * ────────────────────────────────────────────────────────────────────────
 * JAK PŘIDAT DALŠÍ OBLAST
 *
 * 1. řádek do `OBLASTI` (výřez `západ,jih,východ,sever`, přiblížení, soubor),
 * 2. `npm run tiles -- --oblast=<jméno>` a `npm run tiles:upload -- --oblast=<jméno>`,
 * 3. adresu připsat do `<meta name="meteotrace:tiles-more">` v `web/index.html`.
 *
 * Kód appky se nemění — styl mapy si podrobné oblasti skládá ze seznamu.
 * Velikost předem změří `pmtiles extract … --dry-run`.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

export const OBLASTI = {
  /**
   * ČR s příhraničím. Okraj je tam schválně: trasa do Drážďan nebo do Lince
   * nesmí skončit na bílé ploše kus za hranicí.
   *
   * 🚨 Rozšířeno 27. 8. 2026. Michal: *„proč mapa končí geometricky useknutá
   * směrem na západ někde za Hollfeldem a směrem na východ někde u Trstené?"*
   * Přesně tam byl starý okraj (11,6 a 19,4° v. d.) — a rovná svislá hrana
   * uprostřed krajiny vypadá jako vada vykreslování, ne jako naše nastavení.
   *
   * Nově 10,5–20,8° v. d. a 47,4–52,0° s. š.: přibude Norimberk, celý Mnichov,
   * Salcburk, Krakov, Vratislav. Archiv má 2,06 GB.
   *
   * ⚠️ Větší archiv appku NEZPOMALÍ. Čte se po kouskách přes `Range`, takže
   * se stáhnou jen dlaždice, na které se člověk dívá. Platí se za to jen
   * místem v R2 a časem při generování.
   */
  cz: { vyrez: '10.5,47.4,20.8,52.0', maxzoom: 14, soubor: 'cz.pmtiles', velikost: '2,1 GB' },

  /**
   * 🏜️ Sahara v plném detailu (`R34`, 26. 9. 2026). Od Atlantiku po Rudé
   * moře, od Sahelu po Atlas a Středomoří. Michal se ptal, kolik by stálo
   * mít ji do nejbližšího přiblížení — odpověď: nic, vejde se do volného
   * tarifu R2. Změřeno `--dry-run` na sestavení z 25. 9. 2026: 889 MB do z14,
   * 1,8 GB do z15 (z15 v poušti skoro nic nepřidá).
   */
  sahara: { vyrez: '-17.5,14.5,38.5,33.5', maxzoom: 14, soubor: 'sahara.pmtiles', velikost: '889 MB' },

  /**
   * 🌍 Hrubý archiv celé planety do z8 (`R32`, 24. 9. 2026). Leží v mapě POD
   * podrobnými a MapLibre ho nad z8 sám zvětšuje, takže mimo podrobné oblasti
   * je vidět aspoň státy, města a hlavní silnice. Do z14 by měl 68 GB.
   */
  svet: { vyrez: null, maxzoom: 8, soubor: 'svet-z8.pmtiles', velikost: '555 MB' },
};

/**
 * Oblast podle parametrů příkazové řádky. Bez parametru Česko.
 * @param {string[]} [argv]
 */
export function oblastZArgumentu(argv = process.argv) {
  const volba = argv.find((a) => a.startsWith('--oblast='))?.slice('--oblast='.length)
    ?? (argv.includes('--svet') ? 'svet' : 'cz');
  const oblast = OBLASTI[volba];
  if (!oblast) {
    console.error(`Neznámá oblast „${volba}". Známé: ${Object.keys(OBLASTI).join(', ')}.`);
    process.exit(1);
  }
  return { jmeno: volba, ...oblast };
}

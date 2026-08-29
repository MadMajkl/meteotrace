/**
 * Jde to k nám, nebo od nás?
 *
 * Michal 29. 8. 2026: *„v těch hláškách by mělo být vždy alespoň ještě
 * řečeno, na základě větru, jestli třeba déšť jde k nám nebo naopak od nás…
 * to samé o pěkném počasí: pokud prší, jestli už je slunce v dohlednu
 * a jestli jde k nám nebo nás mine a bude dál ošklivě."*
 *
 * Samotná vzdálenost tuhle otázku nezodpoví. „Nejblíž prší 40 km na západ"
 * je úplně jiná zpráva, když to k nám míří, než když to odchází.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 CO TENHLE MODUL SMÍ A CO UŽ NE
 *
 * Smí říct **směr**: přichází / odchází / mine. To je geometrie a ta
 * z větru vyjde.
 *
 * **Nesmí říct KDY.** Přízemní vítr NENÍ rychlost, jakou se pohybuje
 * srážkový pás — ten se řídí prouděním ve výšce, které bývá výrazně
 * silnější a stočené. Odhadnout z přízemního větru čas příchodu by znamenalo
 * tvrdit číslo, které nemáme. Čas se bere z hodinové předpovědi (`rainSoon`,
 * `clearSoon`), tedy od modelu, který proudění ve výšce zná.
 *
 * ⚠️ A když si předpověď a vítr odporují, **má přednost předpověď**. Model
 * ví víc než náš úhloměr; vítr slouží k vysvětlení („proto sem nedojde"),
 * ne k hádání.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** Osm směrů na úhly. Táž stupnice jako `SMERY` v `probes.js`. */
const UHLY = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };

/**
 * Do kolika stupňů se bere „míří to sem".
 *
 * ⚠️ Šedesát, ne pětačtyřicet. Směr k jevu známe jen na osminu kruhu (45°),
 * takže je v něm zabudovaná nepřesnost ±22,5° — přísnější mez by u sondy
 * na kraji výseče prohlásila blížící se déšť za míjející.
 */
const PRICHAZI_DO = 60;

/**
 * Od kolika stupňů se bere „odchází to".
 *
 * Zrcadlově k `PRICHAZI_DO`. Mezi tím je pásmo „mine nás", a to je poctivá
 * odpověď: jev, který jde napříč, ani nepřijde, ani se nevzdaluje.
 */
const ODCHAZI_OD = 120;

/** Rozdíl dvou azimutů po kratší straně kruhu (0–180). */
export function odchylka(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Kam se jev pohybuje vůči nám.
 *
 * 🚨 SMĚR VĚTRU JE „ODKUD FOUKÁ". Meteorologická konvence, kterou appka
 * dodržuje i ve výpisu („severovýchodní vítr" = *od* severovýchodu). Vzduch
 * se tedy pohybuje opačným směrem — a jev, který v tom vzduchu plave, taky.
 *
 * Aby jev doputoval k nám, musí ležet **proti proudu**, tedy zhruba v tom
 * azimutu, odkud fouká. Kdyby se to spletlo, appka by tvrdila přesný opak
 * toho, co se děje — a to je horší než mlčet. (Táž past jako u větrné
 * růžice, 28. 8. 2026.)
 *
 * @param {string} dirKey  kde jev je, z `bearingKey()` — `n`, `ne`, …
 * @param {number} vitrOdkud  směr větru ve stupních, „odkud fouká"
 * @param {number} [rychlostKmh]  když je bezvětří, nic se nikam nežene
 * @returns {'prichazi'|'odchazi'|'mine'|null}  `null` = nedá se říct
 */
export function kamMiri(dirKey, vitrOdkud, rychlostKmh = null) {
  const kdeJe = UHLY[String(dirKey || '').toLowerCase()];
  if (!Number.isFinite(kdeJe) || !Number.isFinite(vitrOdkud)) return null;

  // 🚨 Při bezvětří se NEHÁDÁ. Směr větru je při 2 km/h číslo, které se
  // otočí, než se člověk podívá z okna — tvrdit podle něj, že se fronta
  // blíží, by bylo věštění s desetinnou čárkou.
  if (Number.isFinite(rychlostKmh) && rychlostKmh < 5) return null;

  const d = odchylka(kdeJe, vitrOdkud);
  if (d === null) return null;
  if (d <= PRICHAZI_DO) return 'prichazi';
  if (d >= ODCHAZI_OD) return 'odchazi';
  return 'mine';
}

/**
 * Co se o pohybu smí říct, když k tomu máme i předpověď.
 *
 * 🚨 PŘEDPOVĚĎ PŘEBÍJÍ VÍTR. Když model říká „za tři hodiny zaprší", je to
 * silnější tvrzení než náš úhel: model počítá s prouděním ve výšce, my máme
 * přízemní vítr a osminu kruhu. Dvě protichůdná tvrzení v jedné větě jsou
 * horší než jedno.
 *
 * Vítr se tedy uplatní jen tam, kde **model mlčí** — a pak vysvětluje, proč
 * sem déšť nepřijde: protože jde pryč, nebo bokem.
 *
 * @param {object} a
 * @param {'prichazi'|'odchazi'|'mine'|null} a.drift  co říká vítr
 * @param {boolean} a.predpovedPotvrzuje  má model pro tohle místo změnu?
 * @returns {'prichazi'|'odchazi'|'mine'|null}  o čem se smí mluvit
 */
export function coRict({ drift, predpovedPotvrzuje } = {}) {
  if (predpovedPotvrzuje) return 'prichazi';
  // Model mlčí. „Přichází" bychom tvrdili proti němu, takže se to spolkne;
  // „odchází" a „mine" ho naopak doplňují a vysvětlují.
  //
  // ⚠️ Vrací se `null`, nikdy `undefined`. „Nic" má mít jednu podobu —
  // volající jinak musí hlídat dvě a na jednu z nich zapomene.
  if (drift === 'odchazi' || drift === 'mine') return drift;
  return null;
}

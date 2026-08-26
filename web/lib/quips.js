/**
 * Hlášky k trase — cimrmanovsky.
 *
 * ⚠️ ČISTÝ MODUL. Dostane popis trasy a vrátí jednu větu. Žádné DOM, žádná
 * síť, žádná náhoda (viz níž).
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 TŘI PRAVIDLA, KTERÁ SE NESMÍ PORUŠIT
 *
 * 1. **U NEBEZPEČÍ SE NEŽERTUJE.** Bouřka, náledí, silný náraz větru —
 *    to je přesně ta chvíle, kvůli které si pilot appku otevřel. Vtip nad
 *    varováním je urážka a v horším případě důvod, proč to varování někdo
 *    nevezme vážně. Když je na trase nebezpečí, vrací se prázdno.
 *
 * 2. **HLÁŠKA NENAHRAZUJE ÚDAJE.** Stojí pod nimi jako dovětek. Kdyby
 *    zabrala místo teploty nebo větru, byla by z appky legrace, ne nástroj.
 *
 * 3. **NIC NÁHODNÉHO.** Věta se vybírá podle otisku trasy, ne kostkou.
 *    Kdyby se losovalo při každém překreslení, měnila by se hláška při
 *    každém přepnutí odjezdu a působila by jako porucha. Táž trasa v tentýž
 *    čas = tatáž věta.
 * ────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ JEN ČESKY. Cimrmanovský humor stojí na jazyce — na té zvláštní směsi
 * učeného tónu a hospodské logiky. Přeložený doslova není vtipný, je jen
 * divný. V jiných jazycích se proto **žádná hláška neukáže**; mlčet je lepší
 * než žertovat cizím jazykem bez citu pro něj.
 *
 * ⚠️ Všechny věty jsou původní, psané v tom duchu — ne citace her.
 */

'use strict';

/**
 * Situace, které umíme okomentovat. Pořadí ROZHODUJE: bere se první, která
 * sedí, takže nahoře je to nejvýraznější („na trase prší") a dole obecné.
 */
const SITUACE = [
  {
    klic: 'dest',
    kdy: (k) => k.rainCount >= 2,
    vety: [
      'Cimrman v podobných případech doporučoval deštník. Sám žádný neměl, ale doporučoval.',
      'Mistr tvrdil, že déšť je pouze voda, která si našla cestu dolů. Nám z toho plyne, že zmoknete.',
      'Podle Cimrmana není špatné počasí, jsou jen špatně zvolené kalhoty.',
    ],
  },
  {
    klic: 'kapka',
    kdy: (k) => k.rainCount === 1,
    vety: [
      'Jedno mokré místo po cestě. Mistr by řekl, že to je do počtu.',
      'Krátká přeháňka. Cimrman ji považoval za zkoušku povahy, nikoli za překážku.',
    ],
  },
  {
    klic: 'vitr',
    kdy: (k) => k.windKmh >= 25,
    vety: [
      'Vítr je podle Cimrmana odpor, který nelze obejít, pouze přečkat.',
      'Mistr rozlišoval vítr příznivý a vítr poučný. Tenhle bude poučný.',
    ],
  },
  {
    klic: 'zima',
    kdy: (k) => k.tempC !== null && k.tempC <= 3,
    vety: [
      'Cimrman chodil v zimě bez rukavic, aby si otužil vůli. Rukavice přesto doporučujeme.',
      'Mistr učil, že chlad zbystřuje myšlení. Zbystřete tedy opatrně.',
    ],
  },
  {
    klic: 'vedro',
    kdy: (k) => k.tempC !== null && k.tempC >= 28,
    vety: [
      'Cimrman v takovém vedru zásadně nepracoval. Nazýval to letním rozjímáním.',
      'Mistr doporučoval pít. Vodu, upřesňoval nerad.',
    ],
  },
  {
    klic: 'noc',
    kdy: (k) => k.arrivalHour >= 22 || k.arrivalHour < 5,
    vety: [
      'Příjezd po setmění. Cimrman radil dívat se na hvězdy — ovšem až po zastavení.',
      'Mistr tvrdil, že noc je den, který se stydí. Vy jeďte opatrně.',
    ],
  },
  {
    klic: 'dalka',
    kdy: (k) => k.distanceM >= 200000,
    vety: [
      'Cesta úctyhodná. Jak pravil Mistr: kdo vyjede dřív, dojede dřív.',
      'Cimrman na takové vzdálenosti chodíval pěšky. Měl ovšem víc času než vy.',
    ],
  },
  {
    klic: 'kousek',
    kdy: (k) => k.distanceM > 0 && k.distanceM <= 8000,
    vety: [
      'Vzdálenost, kterou Mistr překonával v myšlenkách dřív než v botách.',
      'Tak krátkou cestu považoval Cimrman spíš za rozcvičku.',
    ],
  },
  {
    klic: 'klid',
    kdy: () => true,
    vety: [
      'Ani kapka. Cimrman by řekl, že příroda dnes nemá námitek.',
      'Počasí bez připomínek. Mistr by na to nenapsal ani jednoaktovku.',
      'Nic nehrozí. Cimrman by v takové chvíli vyrazil bez plánu — my plán máme.',
    ],
  },
];

/**
 * Otisk zadání → číslo. Táž trasa v tentýž čas dá tutéž hlášku.
 *
 * ⚠️ Nejde o bezpečnost, jen o stabilitu, takže stačí nejjednodušší možný
 * součet. Hlavní je, že v tom není `Math.random()`.
 */
function otisk(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Hláška k trase, nebo prázdno.
 *
 * @param {object} k                kontext trasy
 * @param {boolean} k.hazard        je na trase nebezpečné počasí?
 * @param {number} k.rainCount      kolik bodů má pravděpodobný déšť
 * @param {number} k.windKmh        nejsilnější vítr po trase
 * @param {number|null} k.tempC     teplota v cíli
 * @param {number} k.distanceM      délka trasy
 * @param {number} k.arrivalHour    hodina příjezdu (0–23)
 * @param {string} [lang]
 * @returns {string} věta, nebo `''` když se mlčí
 */
export function routeQuip(k, lang = 'cs') {
  if (lang !== 'cs') return '';          // viz poznámka o překladu nahoře
  if (!k || k.hazard) return '';         // 🚨 u nebezpečí se nežertuje

  const kontext = {
    rainCount: Number(k.rainCount) || 0,
    windKmh: Number(k.windKmh) || 0,
    tempC: Number.isFinite(k.tempC) ? k.tempC : null,
    distanceM: Number(k.distanceM) || 0,
    arrivalHour: Number.isFinite(k.arrivalHour) ? k.arrivalHour : 12,
  };

  const situace = SITUACE.find((s) => s.kdy(kontext));
  if (!situace) return '';

  // Otisk zahrnuje i situaci — po přepnutí odjezdu, které změní počasí, se
  // tedy změní i hláška. Táž trasa se stejným počasím ji ale drží.
  const klic = `${situace.klic}|${kontext.distanceM}|${kontext.rainCount}|${kontext.arrivalHour}`;
  return situace.vety[otisk(klic) % situace.vety.length];
}

/** Jen pro test: kolik situací umíme okomentovat. */
export const SITUACE_KLICE = SITUACE.map((s) => s.klic);

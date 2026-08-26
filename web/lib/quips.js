/**
 * Hlášky k trase.
 *
 * ⚠️ ČISTÝ MODUL. Dostane popis trasy a vrátí jednu větu. Žádné DOM, žádná
 * síť, žádná náhoda (viz níž).
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 ČTYŘI PRAVIDLA, KTERÁ SE NESMÍ PORUŠIT
 *
 * 1. **NIKDY SE NEVYSLOVÍ JMÉNO MISTRA.** Říká se výhradně „Mistr".
 *    (Michalův výslovný požadavek, 26. 8. 2026.) Hlídá to test, ne paměť —
 *    při psaní deseti hlášek se na to zapomene dřív než na cokoli jiného.
 *
 * 2. **U NEBEZPEČÍ SE SMÍ ŽERTOVAT, ALE MUSÍ TO BÝT VYPOVÍDAJÍCÍ.**
 *    Čech si dělá legraci ze všeho a suchá věta o bouřce se zapamatuje líp
 *    než úřední hláška — ale **jev musí být pojmenovaný**. Vtip, ze kterého
 *    se nedozvíš, co hrozí, je jen vtip. Hlídá to test: hláška u nebezpečí
 *    musí obsahovat jméno toho jevu.
 *
 * 3. **HLÁŠKA NENAHRAZUJE ÚDAJE.** Stojí pod nimi jako dovětek. Kdyby
 *    zabrala místo teploty nebo větru, byla by z appky legrace, ne nástroj.
 *
 * 4. **NIC NÁHODNÉHO.** Věta se vybírá podle otisku trasy, ne kostkou.
 *    Kdyby se losovalo při každém překreslení, měnila by se hláška při
 *    každém přepnutí odjezdu a působila by jako porucha. Táž trasa v tentýž
 *    čas = tatáž věta.
 * ────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ JEN ČESKY. Tenhle humor stojí na jazyce — na zvláštní směsi učeného
 * tónu a hospodské logiky. Přeložený doslova není vtipný, je jen divný.
 * V jiných jazycích se proto **žádná hláška neukáže**; mlčet je lepší než
 * žertovat cizím jazykem bez citu pro něj.
 *
 * ⚠️ Všechny věty jsou původní, psané v tom duchu — ne citace her.
 */

'use strict';

/**
 * Situace, které umíme okomentovat. Pořadí ROZHODUJE: bere se první, která
 * sedí. Nahoře je proto nebezpečí, dole obecné počasí.
 *
 * `{co}` se nahradí jménem jevu („bouřka", „mrznoucí déšť"). U nebezpečí je
 * ten zástupný text povinný — viz pravidlo 2.
 */
const SITUACE = [
  {
    klic: 'nebezpeci',
    kdy: (k) => k.hazard,
    vety: [
      'Po cestě čeká {co}. Mistr učil, že nebezpečí se nemá obcházet, nýbrž objet.',
      '{co} na trase. Mistr v takových chvílích zásadně nikam nespěchal — a doporučoval totéž.',
      'Pozor, {co}. Mistr tvrdil, že odvaha bez rozhledu je jen rychlejší způsob, jak se mýlit.',
    ],
  },
  {
    klic: 'dest',
    kdy: (k) => k.rainCount >= 2,
    vety: [
      'Mistr v podobných případech doporučoval deštník. Sám žádný neměl, ale doporučoval.',
      'Mistr tvrdil, že déšť je pouze voda, která si našla cestu dolů. Nám z toho plyne, že zmoknete.',
      'Podle Mistra není špatné počasí, jsou jen špatně zvolené kalhoty.',
    ],
  },
  {
    klic: 'kapka',
    kdy: (k) => k.rainCount === 1,
    vety: [
      'Jedno mokré místo po cestě. Mistr by řekl, že to je do počtu.',
      'Krátká přeháňka. Mistr ji považoval za zkoušku povahy, nikoli za překážku.',
    ],
  },
  {
    klic: 'vitr',
    kdy: (k) => k.windKmh >= 25,
    vety: [
      'Vítr je podle Mistra odpor, který nelze obejít, pouze přečkat.',
      'Mistr rozlišoval vítr příznivý a vítr poučný. Tenhle bude poučný.',
    ],
  },
  {
    klic: 'zima',
    kdy: (k) => k.tempC !== null && k.tempC <= 3,
    vety: [
      'Mistr chodil v zimě bez rukavic, aby si otužil vůli. Rukavice přesto doporučujeme.',
      'Mistr učil, že chlad zbystřuje myšlení. Zbystřete tedy opatrně.',
    ],
  },
  {
    klic: 'vedro',
    kdy: (k) => k.tempC !== null && k.tempC >= 28,
    vety: [
      'V takovém vedru Mistr zásadně nepracoval. Nazýval to letním rozjímáním.',
      'Mistr doporučoval pít. Vodu, upřesňoval nerad.',
    ],
  },
  {
    klic: 'noc',
    kdy: (k) => k.arrivalHour >= 22 || k.arrivalHour < 5,
    vety: [
      'Příjezd po setmění. Mistr radil dívat se na hvězdy — ovšem až po zastavení.',
      'Mistr tvrdil, že noc je den, který se stydí. Vy jeďte opatrně.',
    ],
  },
  {
    klic: 'dalka',
    kdy: (k) => k.distanceM >= 200000,
    vety: [
      'Cesta úctyhodná. Jak pravil Mistr: kdo vyjede dřív, dojede dřív.',
      'Na takové vzdálenosti chodíval Mistr pěšky. Měl ovšem víc času než vy.',
    ],
  },
  {
    klic: 'kousek',
    kdy: (k) => k.distanceM > 0 && k.distanceM <= 8000,
    vety: [
      'Vzdálenost, kterou Mistr překonával v myšlenkách dřív než v botách.',
      'Tak krátkou cestu považoval Mistr spíš za rozcvičku.',
    ],
  },
  {
    klic: 'klid',
    kdy: () => true,
    vety: [
      'Ani kapka. Mistr by řekl, že příroda dnes nemá námitek.',
      'Počasí bez připomínek. Mistr by na to nenapsal ani jednoaktovku.',
      'Nic nehrozí. Mistr by v takové chvíli vyrazil bez plánu — my plán máme.',
    ],
  },
];

/**
 * Vítr podle toho, ODKUD fouká.
 *
 * 🚨 Michalův nápad 26. 8. 2026: *„tyhle směry větru by stálo za to taky
 * lehce vtipně okomentovat."* Sedí to: každý český směr má svou pověst —
 * severák studí, západní nese déšť, jižák voní létem. Je to informace
 * zabalená do vtipu, ne vtip místo informace.
 *
 * ⚠️ Šestnáct směrů se svede na osm. „Východo-severovýchodní" je pořád
 * východní vítr; kdo by pro každý z šestnácti psal vlastní hlášku, dopadne
 * u čtvrtého jako kalendář.
 */
const VITR_ODKUD = {
  n: [
    'Severák. Mistr ho měl za poctivý vítr: nelže, prostě studí.',
    'Fouká od severu. Mistr v takovém větru zásadně nefilozofoval, jen si zapnul kabát.',
  ],
  ne: [
    'Vítr od severovýchodu. Mistr tvrdil, že s ním chodí jasno a mrazivé myšlenky.',
    'Severovýchodní. Mistr říkal, že tenhle vítr člověka vystřízliví rychleji než káva.',
  ],
  e: [
    'Vítr od východu. Mistr ho vinil z toho, že suší prádlo i řeči.',
    'Východní. Mistr věřil, že přináší zprávy — obvykle ty, o které nikdo nestál.',
  ],
  se: [
    'Jihovýchodní vítr. Mistr ho nazýval vlažným diplomatem: nikomu neublíží, nikomu nepomůže.',
    'Fouká od jihovýchodu. Mistr by řekl, že příroda dnes není rozhodnutá.',
  ],
  s: [
    'Jižní vítr. Mistr v něm poznával první příslib léta — i v listopadu.',
    'Jižák. Mistr tvrdil, že s ním se lépe cestuje i lépe zapomíná.',
  ],
  sw: [
    'Jihozápadní vítr. Mistr ho podezíral, že za sebou obvykle něco táhne — nejčastěji mraky.',
    'Fouká od jihozápadu. Mistr v takové chvíli radil vzít si něco přes ramena. Pro jistotu.',
  ],
  w: [
    'Západní vítr. Mistr říkal, že s ním chodí déšť jako pes za pánem.',
    'Od západu. Mistr tvrdil, že tenhle vítr je upovídaný a málokdy přijde sám.',
  ],
  nw: [
    'Severozápadní vítr. Mistr ho měl za nespolehlivého společníka: přifouká i odfouká.',
    'Od severozápadu. Mistr by poznamenal, že počasí si to ještě rozmýšlí.',
  ],
};

/** Šestnáct směrů na osm. „VSV" je pořád východní vítr. */
const NA_OSM = {
  n: 'n', nne: 'n', ne: 'ne', ene: 'e', e: 'e', ese: 'e', se: 'se', sse: 's',
  s: 's', ssw: 's', sw: 'sw', wsw: 'w', w: 'w', wnw: 'w', nw: 'nw', nnw: 'n',
};

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

/** Když se jev nepodaří pojmenovat, musí věta pořád dávat smysl. */
const NEBEZPECI_OBECNE = 'nebezpečné počasí';

/**
 * Hláška k trase, nebo prázdno.
 *
 * @param {object} k                kontext trasy
 * @param {boolean} k.hazard        je na trase nebezpečné počasí?
 * @param {string} [k.hazardWhat]   jméno jevu („Bouřka") — u nebezpečí povinné
 * @param {number} k.rainCount      kolik bodů má pravděpodobný déšť
 * @param {number} k.windKmh        nejsilnější vítr po trase
 * @param {string} [k.windDirKey]   odkud fouká (`n`, `ne`, … `nnw`)
 * @param {number|null} k.tempC     teplota v cíli
 * @param {number} k.distanceM      délka trasy
 * @param {number} k.arrivalHour    hodina příjezdu (0–23)
 * @param {string} [lang]
 * @returns {string} věta, nebo `''` když se mlčí
 */
export function routeQuip(k, lang = 'cs') {
  if (lang !== 'cs') return '';          // viz poznámka o překladu nahoře
  if (!k) return '';

  const kontext = {
    hazard: !!k.hazard,
    rainCount: Number(k.rainCount) || 0,
    windKmh: Number(k.windKmh) || 0,
    tempC: Number.isFinite(k.tempC) ? k.tempC : null,
    distanceM: Number(k.distanceM) || 0,
    arrivalHour: Number.isFinite(k.arrivalHour) ? k.arrivalHour : 12,
  };

  const situace = SITUACE.find((s) => s.kdy(kontext));
  if (!situace) return '';

  // U větru se dá říct víc než „fouká": odkud. Když směr známe, vyhrává —
  // je to informace navíc, ne jen jiný vtip.
  const smer = NA_OSM[String(k.windDirKey || '').toLowerCase()];
  if (situace.klic === 'vitr' && smer) {
    const vety = VITR_ODKUD[smer];
    return vety[otisk(`vitr|${smer}|${kontext.distanceM}`) % vety.length];
  }

  // Otisk zahrnuje i situaci — po přepnutí odjezdu, které změní počasí, se
  // tedy změní i hláška. Táž trasa se stejným počasím ji ale drží.
  const klic = `${situace.klic}|${kontext.distanceM}|${kontext.rainCount}|${kontext.arrivalHour}`;
  const veta = situace.vety[otisk(klic) % situace.vety.length];

  // 🚨 Jev se pojmenuje vždycky. Vtip, ze kterého se nedozvíš, co hrozí,
  // je jen vtip — viz pravidlo 2.
  const co = String(k.hazardWhat || '').trim() || NEBEZPECI_OBECNE;
  return veta
    .replace('{co}', co.toLowerCase())
    .replace(/^([a-záčďéěíňóřšťúůýž])/, (z) => z.toUpperCase());
}

/** Jen pro test: kolik situací umíme okomentovat. */
export const SITUACE_KLICE = SITUACE.map((s) => s.klic);

/** Jen pro test: všechny věty, ať se dají prohledat najednou. */
export const VSECHNY_VETY = SITUACE.flatMap((s) => s.vety);

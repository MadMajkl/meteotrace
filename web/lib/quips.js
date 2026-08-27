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

/**
 * Odkud — druhý pád. Pro věty typu „pofukuje od severovýchodu".
 */
export const SMER_ODKUD = {
  n: 'od severu', ne: 'od severovýchodu', e: 'od východu', se: 'od jihovýchodu',
  s: 'od jihu', sw: 'od jihozápadu', w: 'od západu', nw: 'od severozápadu',
};

/**
 * Kam — čtvrtý pád. Pro věty typu „šedesát kilometrů na jihozápad".
 *
 * ⚠️ Jiný pád než {@link SMER_ODKUD}, a proto vlastní tabulka. Skládat to
 * z jednoho tvaru předponou by dřív nebo později vyrobilo „na severu"
 * tam, kde má být „na sever".
 */
export const SMER_KAM = {
  n: 'na sever', ne: 'na severovýchod', e: 'na východ', se: 'na jihovýchod',
  s: 'na jih', sw: 'na jihozápad', w: 'na západ', nw: 'na severozápad',
};

/**
 * Slabý vítr, u kterého se ale pořád vyplatí říct, odkud je.
 *
 * 🚨 Michal 27. 8. 2026: *„nemáš žádné hlášky k větru?"* Měl je — jenže
 * začínaly až na dvanácti kilometrech v hodině, a pod nimi appka mlčky
 * spadla na obecnou hlášku o ničem. Přitom právě slabý vítr je nejčastější
 * stav: většinu dní by tak o větru nepadlo ani slovo.
 */
const VANEK_ODKUD = [
  'Jen tak pofukuje {odkud}. Mistr takový vítr nazýval zdvořilým: ohlásí se a jde po svých.',
  'Vánek {odkud}. Mistr tvrdil, že vítr, který neshodí klobouk, se počítá mezi přátele.',
  'Slabě {odkud}. Mistr by řekl, že příroda dnes jen tak zkouší, jestli dáváme pozor.',
];

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

/**
 * Od jakého větru má smysl mluvit o SMĚRU.
 *
 * ⚠️ Na trase se o větru mluví až od 25 km/h — tam jde o celou cestu.
 * Na jednom místě je to jinak: „odkud fouká" je zajímavé už při svěžím
 * vánku, protože stojíš v něm. Pod dvanáct km/h už je to ale povídání
 * o ničem.
 */
export const SMER_OD_KMH = 12;

/**
 * O kolik musí náraz převýšit průměr, aby to bylo sdělení, a ne šum.
 *
 * ⚠️ Tatáž hodnota jako v `route-view.js`. Kdyby se rozešly, tvrdila by
 * appka na jedné obrazovce něco jiného než na druhé.
 */
const GUST_MARGIN_KMH = 15;

/**
 * Hláška k jednomu místu (meteostanice).
 *
 * 🚨 Michal 27. 8. 2026: *„ten vítr jsi ještě nijak nekomentoval."* Měl
 * pravdu: hlášky byly jen na trase, a tam se o větru mluví až od 25 km/h.
 * Na meteostanici tedy nebylo nic.
 *
 * Platí tatáž pravidla jako u trasy: **u nebezpečí se jev pojmenuje**,
 * hláška nenahrazuje údaje, nic se nelosuje a mluví se jen česky.
 *
 * @param {object} k
 * @param {boolean} [k.hazard]      je právě teď nebezpečné počasí?
 * @param {string} [k.hazardWhat]   jméno jevu
 * @param {number} [k.windKmh]
 * @param {string} [k.windDirKey]   odkud fouká (`n`, `ne`, …)
 * @param {number} [k.gustKmh]
 * @param {number} [k.tempC]
 * @param {boolean} [k.isDay]
 * @param {string} [lang]
 */
export function placeQuip(k, lang = 'cs') {
  if (lang !== 'cs') return '';
  if (!k) return '';

  const vitr = Number(k.windKmh) || 0;
  const naraz = Number(k.gustKmh) || 0;
  const teplota = Number.isFinite(k.tempC) ? k.tempC : null;
  const smer = NA_OSM[String(k.windDirKey || '').toLowerCase()];
  const otiskZ = `${Math.round(vitr)}|${smer || ''}|${Math.round(teplota ?? 0)}`;

  // 🚨 Nebezpečí první a s pojmenovaným jevem.
  if (k.hazard) {
    const co = String(k.hazardWhat || '').trim().toLowerCase() || NEBEZPECI_OBECNE;
    const vety = [
      `Venku ${co}. Mistr učil, že s počasím se nediskutuje, počasí se přečkává.`,
      `Právě teď ${co}. Mistr by v takové chvíli zůstal doma a tvrdil, že pracuje.`,
    ];
    return vety[otisk(otiskZ) % vety.length];
  }

  // Náraz, který se citelně liší od průměru, je zpráva sám o sobě.
  if (naraz - vitr >= GUST_MARGIN_KMH && naraz >= 40) {
    const vety = [
      'Vítr v nárazech. Mistr říkal, že kdo se opře do větru, má aspoň o co se opřít.',
      'Nárazový vítr. Mistr v něm nikdy nenosil klobouk — prý z úcty k větru.',
    ];
    return vety[otisk(otiskZ) % vety.length];
  }

  if (vitr >= SMER_OD_KMH && smer) {
    const vety = VITR_ODKUD[smer];
    return vety[otisk(otiskZ) % vety.length];
  }

  // Slabý vítr: pořád se dá říct, odkud. Je to informace, kterou by
  // obecná hláška zahodila.
  if (vitr >= 4 && smer) {
    const odkud = SMER_ODKUD[smer];
    return VANEK_ODKUD[otisk(otiskZ) % VANEK_ODKUD.length].replace('{odkud}', odkud);
  }

  if (vitr < 4) {
    const vety = [
      'Bezvětří. Mistr tvrdil, že v takovém tichu se nejlíp slyší vlastní výmluvy.',
      'Ani lístek se nehne. Mistr by řekl, že příroda dnes odpočívá — a doporučoval totéž.',
    ];
    return vety[otisk(otiskZ) % vety.length];
  }

  if (teplota !== null && teplota <= 0) {
    const vety = [
      'Mrzne. Mistr v mrazu psal nejlépe — prsty prý myslí rychleji, když spěchají domů.',
      'Pod nulou. Mistr tvrdil, že zima je jen teplo, které se opozdilo.',
    ];
    return vety[otisk(otiskZ) % vety.length];
  }

  if (teplota !== null && teplota >= 30) {
    const vety = [
      'Třicet a výš. Mistr v takovém počasí zásadně nic neslíbil.',
      'Pořádné vedro. Mistr by teď seděl ve stínu a nazýval to terénním výzkumem.',
    ];
    return vety[otisk(otiskZ) % vety.length];
  }

  const vety = [
    'Počasí bez překvapení. Mistr by řekl, že i to je druh zprávy.',
    'Nic zvláštního se neděje. Mistr takové dny míval nejraději — daly se naplánovat.',
  ];
  return vety[otisk(otiskZ) % vety.length];
}

/**
 * Kde nejblíž prší — nebo kam by se muselo za sluncem.
 *
 * 🚨 Michalův nápad 26. 8. 2026: *„nejbližší déšť k trase je <místo, kde fakt
 * aktuálně nejblíže prší>"* a *„za sluncem bys musel jet až <kam>"*. Je to
 * odpověď na otázku, kterou si člověk položí hned po té první: dobře, tady
 * neprší — a kde teda?
 *
 * ⚠️ MLUVÍ SE OPATRNĚ, protože i měření je opatrné. Sondy sedí na osmi
 * směrech a třech vzdálenostech; skutečný nejbližší déšť může být mezi nimi.
 * Proto „nejblíž prší asi šedesát kilometrů", ne „přesně tam a tam". Věta
 * nesmí tvrdit víc, než kolik se ví — u počasí to platí dvojnásob.
 *
 * ⚠️ Jméno místa je nepovinné. Když se ho nepodaří zjistit, věta pořád nese
 * vzdálenost a směr, což je to hlavní.
 *
 * @param {object} k
 * @param {'dest'|'slunce'} k.hledame  co se hledalo
 * @param {number|null} k.km           vzdálenost v km, nebo `null` = nenašlo se
 * @param {string} [k.dirKey]          směr (`n`, `ne`, … `nw`)
 * @param {string} [k.misto]           jméno místa
 * @param {number} [k.dosahKm]         jak daleko se hledalo
 * @param {boolean} [k.odTrasy]        měří se od trasy, ne od jednoho místa
 * @param {string} [lang]
 */
export function okoliQuip(k, lang = 'cs') {
  if (lang !== 'cs') return '';
  if (!k) return '';

  const dosah = Number(k.dosahKm) || 120;
  const km = Number.isFinite(k.km) ? Math.round(k.km) : null;
  const kam = SMER_KAM[String(k.dirKey || '').toLowerCase()];
  const misto = String(k.misto || '').trim();
  // 🚨 „Od trasy" a „kolem" NENÍ totéž a nesmí se to splést. U trasy se
  // vzdálenost měří od nejbližšího bodu CELÉ cesty — věta o tom musí mluvit,
  // jinak si ji člověk vztáhne k místu, kde zrovna stojí.
  const odkud = k.odTrasy ? ' od trasy' : '';
  const otiskZ = [k.hledame, km === null ? 'x' : km, kam || '', odkud].join('|');

  // Nic se nenašlo — taky odpověď, a u deště dokonce dobrá.
  if (km === null || !kam) {
    const okruh = k.odTrasy ? ' od trasy' : ' kolem';
    const vety = k.hledame === 'dest'
      ? [
        'Do ' + dosah + ' km' + okruh + ' neprší ani nikde jinde. Mistr by v tak dobré zprávě ze zvyku hledal háček.',
        'Ani ' + dosah + ' km' + okruh + ' nikde neprší. Mistr takovým dnům říkal podezřele vydařené.',
      ]
      : [
        'Jasno není ani ' + dosah + ' km' + okruh + '. Mistr by doporučil knihu a trpělivost — obojí vydrží déle než mraky.',
        'Slunce se do ' + dosah + ' km' + okruh + ' neschovalo, ono tam prostě není. Mistr by to nazval poctivou oblohou.',
      ];
    return vety[otisk(otiskZ) % vety.length];
  }

  const kde = misto ? ' (' + misto + ')' : '';

  const smerem = kam + odkud;

  const vety = k.hledame === 'dest'
    ? [
      'Nejblíž prší asi ' + km + ' km ' + smerem + kde + '. Mistr tvrdil, že déšť za obzorem je ze všech dešťů nejhezčí.',
      'Do deště je to asi ' + km + ' km ' + smerem + kde + '. Mistr by řekl, že na takovou dálku se dá pršení i obdivovat.',
    ]
    : [
      'Za sluncem by se muselo asi ' + km + ' km ' + smerem + kde + '. Mistr by v tom viděl slušný důvod k výletu.',
      'Slunce začíná asi ' + km + ' km ' + smerem + kde + '. Mistr tvrdil, že za dobrým počasím se cestovat vyplatí.',
    ];
  return vety[otisk(otiskZ) % vety.length];
}

/** Jen pro test: kolik situací umíme okomentovat. */
export const SITUACE_KLICE = SITUACE.map((s) => s.klic);

/** Jen pro test: všechny věty, ať se dají prohledat najednou. */
export const VSECHNY_VETY = SITUACE.flatMap((s) => s.vety);

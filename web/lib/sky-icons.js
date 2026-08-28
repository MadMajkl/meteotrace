/**
 * Piktogramy k obloze: východ a západ Slunce, fáze Měsíce, nadmořská výška.
 *
 * ⚠️ ČISTÝ MODUL. Vrací jen popis tvaru — kreslení do stránky dělá `app.js`,
 * stejně jako u alergenů (`pollen-icons.js`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ VLASTNÍ TVARY A NE EMOJI
 *
 * Michal 28. 8. 2026: *„k Východu a Západu slunce přidej 🌞 a 🌇, aby bylo
 * jisté, že to je západ slunce… ale jako SVG v duchu mapy."*
 *
 * 🚨 A ta jistota je přesně ten důvod, proč emoji nestačí: 🌅 a 🌇 se
 * v malém liší jen odstínem pozadí a v každém systému vypadají jinak —
 * na Androidu, na Windows a na iPhonu jsou to tři různé obrázky. Východ
 * od západu se tu proto pozná **šipkou**, ne barvou. Kdo vidí černobíle
 * nebo má ikonu 16 px vysokou, pozná směr pořád.
 *
 * ⚠️ Piktogram je vždycky JEN DOPLNĚK. Vedle něj stojí popis („Východ
 * Slunce") i hodnota — kdo tvar nepozná, nesmí o informaci přijít.
 *
 * Tvary jsou v mřížce 24 × 24, kreslí se `currentColor` a nesou se v témž
 * tlumeném duchu jako mapa: tenká čára, žádné stíny, žádné přechody.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** Slunce nad obzorem — půlkotouč, který na čáře sedí. Společné oběma. */
const SLUNCE_NAD_OBZOREM = 'M7.4 18.5a4.6 4.6 0 0 1 9.2 0z';

/** Obzor. Táhne se přes celou šířku, aby bylo poznat, že je to čára země. */
const OBZOR = 'M3 18.5h18';

/**
 * Východ Slunce: půlkotouč nad obzorem a šipka vzhůru.
 * @returns {{plocha: string, cara: string[]}}
 */
export function sunriseShape() {
  return {
    plocha: SLUNCE_NAD_OBZOREM,
    cara: [OBZOR, 'M12 10.6V4', 'M9.2 6.8 12 4l2.8 2.8'],
  };
}

/** Západ Slunce: týž půlkotouč, ale šipka dolů. */
export function sunsetShape() {
  return {
    plocha: SLUNCE_NAD_OBZOREM,
    cara: [OBZOR, 'M12 4v6.6', 'M9.2 7.8 12 10.6l2.8-2.8'],
  };
}

/**
 * Nadmořská výška: hora nad hladinou.
 *
 * ⚠️ Vlnka dole není ozdoba — je to **hladina moře**, tedy to, od čeho se
 * ta výška měří. Bez ní je to jen hora a údaj by mohl znamenat i převýšení.
 */
export function elevationShape() {
  return {
    plocha: 'M12 5 19.6 17.2H4.4z',
    cara: ['M3 20.6c1.5-1.1 3-1.1 4.5 0s3 1.1 4.5 0 3-1.1 4.5 0 3 1.1 4.5 0'],
  };
}

/**
 * Měsíc podle skutečné fáze.
 *
 * 🚨 KRESLÍ SE Z DAT, NE ZE SADY OBRÁZKŮ. Fázi appka počítá (`moon.js`),
 * takže by bylo hloupé ji pak zaokrouhlovat na osm hotových ikonek. Tvar
 * vychází ze **stejného čísla, jaké je vypsané pod ním** — když stojí
 * „svítí 63 %", je vidět kotouč ze 63 % osvětlený.
 *
 * Jak: osvětlená část je plocha mezi okrajem kotouče a **terminátorem**,
 * což je při pohledu ze Země půlelipsa. Její vodorovný poloměr je
 * `r · |1 − 2f|`; při čtvrti je nulový (rovná čára), při novu a úplňku
 * splyne s okrajem.
 *
 * ⚠️ Dorůstající Měsíc svítí vpravo, couvající vlevo (na severní polokouli).
 * Kdyby se to prohodilo, ukazovala by appka couvající Měsíc jako dorůstající
 * — tedy pravý opak toho, co je na obloze.
 *
 * @param {number} podil   0 = nov, 0,5 = čtvrt, 1 = úplněk
 * @param {boolean} dorusta
 * @returns {{kotouc: number[], svetlo: string|null}}
 */
export function moonShape(podil, dorusta = true) {
  const f = Math.min(1, Math.max(0, Number(podil) || 0));
  const r = 8;
  const S = 12;   // střed

  const kotouc = [S, S, r];

  // Nov: nesvítí nic. Prázdný kotouč je správná odpověď, ne chybějící tvar.
  if (f <= 0.01) return { kotouc, svetlo: null };

  // Úplněk: celý kotouč. Elipsa s poloměrem r by dala tentýž tvar, ale
  // dvěma oblouky — a v některých vykreslovačích by na švu prosvítala čára.
  if (f >= 0.99) {
    return {
      kotouc,
      svetlo: `M${S} ${S - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}z`,
    };
  }

  const rx = +(r * Math.abs(1 - 2 * f)).toFixed(2);
  // Do půlky je terminátor vydutý dovnitř (srpek), po půlce vypouklý ven
  // (vypouklý Měsíc). Rozhoduje o tom směr oblouku, ne jiný tvar.
  const srpek = f < 0.5;

  const vnejsiSweep = dorusta ? 1 : 0;
  const vnitrniSweep = srpek === dorusta ? 0 : 1;

  return {
    kotouc,
    svetlo: `M${S} ${S - r}`
      + `A${r} ${r} 0 0 ${vnejsiSweep} ${S} ${S + r}`
      + `A${rx} ${r} 0 0 ${vnitrniSweep} ${S} ${S - r}z`,
  };
}

/**
 * Tlak: ciferník tlakoměru s ručičkou.
 *
 * ⚠️ Ručička míří šikmo vzhůru, ne svisle. Svislá by se v malém slila
 * s číslem nad sebou a vypadala by jako oddělovač; šikmá je poznat jako
 * ručička i v šestnácti pixelech.
 */
export function pressureShape() {
  return {
    kotouc: [12, 12, 7.6],
    cara: ['M12 12 16 8.2', 'M12 4.4v1.4', 'M19.6 12h-1.4', 'M12 19.6v-1.4', 'M4.4 12h1.4'],
    tecka: [12, 12, 1.5],
  };
}

/**
 * Větrná růžice.
 *
 * 🚨 UKAZUJE, ODKUD FOUKÁ — jako korouhvička, která se do větru natáčí.
 * Appka vedle toho píše „severovýchodní vítr", což v češtině taky znamená
 * *od* severovýchodu. Kdyby střelka mířila po větru, ukazovala by přesný
 * opak toho, co je vedle ní napsané — a dvě protichůdná tvrzení vedle sebe
 * jsou horší než jedno bez obrázku.
 *
 * Prstenec se **nikdy neotáčí**, otáčí se jen střelka (`app.js` na ni dá
 * `rotate`). Sever je proto pořád nahoře — jinak by růžice nebyla růžice,
 * ale jen šipka v kroužku.
 *
 * @returns {{kruh: number[], cara: string[], plocha: string, ocas: string}}
 */
export function windRoseShape() {
  return {
    // Prstenec a čtyři světové strany — pevná část.
    kruh: [12, 12, 8.6],
    cara: ['M12 1.6v2', 'M22.4 12h-2', 'M12 22.4v-2', 'M1.6 12h2'],
    // Otáčivá část: plná špička (odkud) a prázdný ocas (kam).
    plocha: 'M12 4.2 15 12h-6z',
    ocas: 'M12 19.8 9 12h6z',
  };
}

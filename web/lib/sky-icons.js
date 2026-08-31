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
 * ⚠️ Dorůstající Měsíc svítí vpravo, ubývající vlevo (na severní polokouli).
 * Kdyby se to prohodilo, ukazovala by appka ubývající Měsíc jako dorůstající
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
 * 🚨 HROT UKAZUJE, KAM VÍTR FOUKÁ. Otáčení dodává `app.js` a přičítá k němu
 * 180°, protože `windDeg` je meteorologicky „odkud".
 *
 * ♻️ **Obráceno 30. 8. 2026** a stojí za to vědět proč. Do 29. 8. to byla
 * korouhvička: malá špička proti větru a proti ní prázdný ocas — a hrot
 * mířící PROTI proudění tam dával smysl, protože korouhvička se do větru
 * natáčí. Když se tvar změnil na jeden plný hrot přes celý kruh, změnilo se
 * i to, jak ho lidi čtou: **plná šipka znamená směr pohybu a korouhvičku
 * v ní nikdo nevidí.** Michal na to narazil hned: *„vane od jihozápadu,
 * ale ty ukazuješ šipkou na jihozápad."*
 *
 * Poučení: **tvar si vynutil význam.** Změna kresby nebyla jen kosmetická,
 * i když tak vypadala.
 *
 * Prstenec se **nikdy neotáčí**, otáčí se jen střelka. Sever je proto pořád
 * nahoře — jinak by růžice nebyla růžice, ale jen šipka v kroužku.
 *
 * @returns {{kruh: number[], cara: string[], plocha: string}}
 */
export function windRoseShape() {
  return {
    // Prstenec a čtyři světové strany — pevná část.
    kruh: [12, 12, 8.6],
    cara: ['M12 1.6v2', 'M22.4 12h-2', 'M12 22.4v-2', 'M1.6 12h2'],
    // 🚨 JEDEN HROT PŘES CELÝ KRUH, žádný ocas. Michal 29. 8. 2026:
    // *„šipka tvar jen hrot a musí vyplňovat celý kruh a celá se natáčet."*
    //
    // Původní verze měla malou špičku a proti ní prázdný ocas — dvě drobné
    // věci, ze kterých v šestnácti pixelech nebylo poznat, která je která.
    // Jeden velký plný hrot je čitelný i po očku a jeho směr nejde splést.
    //
    // ⚠️ Prstenec se pořád NEOTÁČÍ. Sever musí zůstat nahoře, jinak by
    // z růžice byla jen šipka v kroužku (viz `app.js`, `otoceni`).
    plocha: 'M12 3.4 17.2 19.4 12 15.6 6.8 19.4z',
  };
}

/**
 * UV index: slunce a pod ním člověk.
 *
 * Michal 29. 8. 2026: *„UV index musí mít piktogram slunce a v dlaždici musí
 * být silueta horní poloviny lidského těla (jakože UV index ovlivňuje zdraví
 * a je od slunce)."*
 *
 * ⚠️ Silueta je ZÁMĚRNĚ bez tváře. Obrys hlavy a ramen se pozná i v šestnácti
 * pixelech; oči a ústa by se slily do skvrny a z piktogramu by byl flek.
 *
 * ⚠️ Slunce je v levém horním rohu, ne nad hlavou. Nad hlavou by se obojí
 * dotýkalo a splynulo v jeden tvar — takhle je vidět, že to jsou dvě věci
 * a že jedna svítí na druhou.
 *
 * @returns {{plocha: string, cara: string[], kruh: number[]}}
 */
export function uvShape() {
  return {
    // Slunce: kotouček s paprsky vlevo nahoře.
    kruh: [6.6, 6.6, 2.6],
    cara: [
      'M6.6 1.2v1.3', 'M6.6 10.7v1.3', 'M1.2 6.6h1.3', 'M10.7 6.6h1.3',
      'M2.8 2.8l.9.9', 'M9.5 9.5l.9.9', 'M10.4 2.8l-.9.9', 'M3.7 9.5l-.9.9',
    ],
    // Hlava a ramena. Ramena jsou oblouk, ne obdélník — hranatá silueta
    // vypadá jako ikona uživatele v nastavení, ne jako člověk na slunci.
    plocha: 'M16 8.4a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8z'
      + 'M16 15.1c3.4 0 6 2.2 6 5.1v1.4H10v-1.4c0-2.9 2.6-5.1 6-5.1z',
  };
}

/**
 * Poznámka: lísteček s ohnutým rohem a řádky.
 *
 * Michal 29. 8. 2026: *„ty chytré hlášky asi dát do extra dlaždice a nějak
 * označit piktogramem poznámky."* Hlášky dosud visely pod mřížkou údajů jako
 * dva kurzívou psané odstavce a splývaly s ní — přitom to není údaj, ale
 * komentář k němu.
 *
 * ⚠️ Ohnutý roh je to, co dělá z obdélníku papír. Bez něj je to jen rámeček
 * s čárami a v šestnácti pixelech to vypadá jako tabulka.
 *
 * ⚠️ Řádky jsou tři a nestejně dlouhé — poslední kratší, jako když text
 * nedojde na konec. Stejně dlouhé by vypadaly jako linkovaný sešit.
 *
 * @returns {{plocha: string, cara: string[]}}
 */
export function noteShape() {
  return {
    // List s uříznutým rohem vpravo nahoře a přehyb toho rohu.
    plocha: '',
    cara: [
      'M5.5 3h8.2L19 8.3V21H5.5z',
      'M13.7 3v5.3H19',
      'M8.4 12.4h7.2',
      'M8.4 15.4h7.2',
      'M8.4 18.4h4.3',
    ],
  };
}

/**
 * Šipka trendu Měsíce: dorůstá, nebo couvá.
 *
 * Michal 29. 8. 2026: *„měsíc doplnit o piktogram šipky nahoru při rostoucím
 * měsíci a při ubývajícím dolů, při úplňku nic a to samé při novu."*
 *
 * 🚨 U ÚPLŇKU A NOVU SE VRACÍ `null`, a je to správně. V těch dvou bodech
 * Měsíc nedorůstá ani neubývá — je na obrátce. Šipka by tam ukazovala směr,
 * který v tu chvíli neplatí, a byla by to nepravda kvůli symetrii.
 *
 * ⚠️ Vlastní tvar vedle kotouče, ne uvnitř něj. Do kotouče se v mřížce
 * 24 × 24 nic dalšího nevejde tak, aby to zůstalo čitelné — a hlavně by to
 * překreslilo osvětlenou část, tedy ten údaj, o který jde.
 *
 * @param {number} podil  poloha v cyklu: 0 = nov, 0,5 = úplněk
 * @returns {{cara: string[]}|null}
 */
export function moonTrendShape(podil) {
  const f = Number(podil);
  if (!Number.isFinite(f)) return null;

  // Meze jsou tytéž jako u fází v `moon.js` (`new` do 0,02, `full` 0,48–0,52),
  // aby šipka nezmizela o den dřív, než appka vedle napíše „úplněk".
  const nov = f < 0.02 || f > 0.98;
  const uplnek = f >= 0.48 && f <= 0.52;
  if (nov || uplnek) return null;

  const dorusta = f < 0.5;
  return {
    cara: dorusta
      ? ['M12 20V5', 'M6.5 10.5 12 5l5.5 5.5']
      : ['M12 4v15', 'M6.5 13.5 12 19l5.5-5.5'],
  };
}

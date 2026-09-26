/**
 * Vlastní styl mapy nad vlastními dlaždicemi (`R3`).
 *
 * ⚠️ ČISTÝ MODUL. Skládá jen popis stylu — žádné DOM, žádná síť. Díky tomu
 * se dá otestovat, že styl odkazuje jen na naše adresy a že se v něm
 * neztratila žádná vrstva.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ JE MAPA TAK NEVÝRAZNÁ — A JE TO ZÁMĚR
 *
 * Tahle mapa není cíl pohledu. Je to **podklad pod srážkový radar**: modrá
 * a zelená pole srážek musí být na první pohled odlišitelná od všeho pod
 * nimi. Barevná mapa by se s radarem prala a člověk by v autě nepoznal,
 * kde prší. Proto:
 *
 *   · povrch, zástavba i lesy drží jeden tlumený tón — světlý motiv zelený,
 *     tmavý modrošedý,
 *   · voda je záměrně TLUMENÁ — jinak by splývala s deštěm,
 *   · silnice jsou vidět kvůli orientaci, ale nekřičí,
 *   · popisky měst jsou to nejkontrastnější, protože podle nich se člověk
 *     na mapě hledá.
 *
 * ⚠️ Sytější zeleň by soupeřila se ZELENÝMI poli silných srážek na radaru.
 * To je důvod, proč je světlý motiv světle zelený, ale ne barevný.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Schéma dat je Protomaps Basemap v4 — ověřeno na skutečné dlaždici
 * (22. 8. 2026): vrstvy `earth`, `landcover`, `landuse`, `water`, `roads`,
 * `buildings`, `boundaries`, `places`, `pois`.
 */

'use strict';

/** Jméno zdroje uvnitř stylu. Na jeho tvaru nezáleží, ale musí sedět všude stejně. */
const ZDROJ = 'meteotrace';

/**
 * Barvy pro světlý a tmavý motiv.
 *
 * ⚠️ Nesahat na ně bez pohledu na radar. Každý z těch odstínů je vybraný tak,
 * aby pod poloprůhledným radarem zůstal čitelný a zároveň se s ním nepletl.
 */
const PALETA = {
  // Světlý motiv drží zadání z 23. 8. 2026: klidná světlá zeleň, doplňky
  // a linky do šedozelena a hnědozelena. Zeleň je tlumená schválně — sytější
  // by soupeřila se zelenými poli silných srážek na radaru.
  light: {
    zeme: '#eef2e8',
    voda: '#d8e3e2',
    les: '#e0e9d6',
    zastavba: '#e9e8e0',
    budova: '#dedcd2',
    silniceHlavni: '#ffffff',
    silniceVedlejsi: '#f7f7f1',
    silniceObrys: '#cbd2c0',
    zeleznice: '#bfc7b6',
    hranice: '#a3ad96',
    popisek: '#3a4436',
    popisekObrys: '#ffffff',
  },
  dark: {
    zeme: '#121821',
    voda: '#16222f',
    les: '#141d1c',
    zastavba: '#171e28',
    budova: '#1b232e',
    silniceHlavni: '#2b3543',
    silniceVedlejsi: '#222b37',
    silniceObrys: '#151c25',
    zeleznice: '#2a323d',
    hranice: '#3c4757',
    popisek: '#c9d4e0',
    popisekObrys: '#0d1219',
  },
};

/**
 * Kde leží písma.
 *
 * 🚨 RELATIVNĚ, ne od kořene. Appka neběží vždycky v kořeni domény: v obalu
 * pro Android sedí na `…/assets/www/`, takže `/fonts/…` by mířilo mimo ni
 * a podklad by se nenačetl. Michal 28. 8. 2026: *„APK nezobrazuje mapu,
 * píše, že se nepodařilo načíst."* Přesně tohle to bylo.
 *
 * ⚠️ Složené závorky se do `new URL()` dávat nesmí — zakóduje je na `%7B`
 * a MapLibre pak `{fontstack}` nenajde. Proto se absolutně počítá jen
 * SLOŽKA a šablona se k ní přilepí (viz `fontsUrlFrom`).
 */
export const PISMA_VYCHOZI = 'fonts/';

/**
 * Adresa složky s písmy odvozená od adresy stránky.
 * @param {string} [base]  `document.baseURI`
 */
export function fontsUrlFrom(base) {
  if (!base) return PISMA_VYCHOZI;
  return new URL(PISMA_VYCHOZI, base).href;
}

/** Písma. Leží u nás (`web/fonts/`), takže mapa nesahá na cizí doménu. */
const PISMO = ['Noto Sans Regular'];
const PISMO_VYRAZNE = ['Noto Sans Medium'];

/**
 * Popisek v jazyce uživatele, s návratem na místní jméno.
 *
 * Dlaždice nesou `name:cs`, `name:en` a další. Když jméno v daném jazyce
 * chybí (většina vesnic ho nemá), použije se `name` — tedy jméno místní.
 * To je správně: cedule u silnice je taky v místním jazyce.
 */
function popisek(lang) {
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name']];
}

/** Zdroj celého světa (`R32`). Id vrstev nad ním mají předponu `svet-`. */
const ZDROJ_SVET = 'svet';

/**
 * Od kterého přiblížení kreslí podrobný (český) archiv, když je vedle něj svět.
 *
 * 🚨 Svět má dlaždice jen do z8 — dál je MapLibre sám zvětšuje (overzoom),
 * takže v Chile mapa při přiblížení nezmizí, jen zhrubne. Do z8 jsou oba
 * archivy táž data z téže planety, a kreslit je dvakrát by jen zdvojilo
 * popisky. Proto svět do z8 všude a od z9 nad ním Česko v plném detailu.
 */
export const DETAIL_OD_ZOOMU = 9;

/** Vrstvy popisků (bez předpony), ze kterých si klepnutí do mapy bere jméno místa. */
const POPISKY = ['mesta', 'ctvrti'];

/**
 * Popisky, ze kterých si klepnutí do mapy bere jméno místa (`map-pick.js`),
 * ve všech archivech daného stylu — v Česku, ve světě i v každé další
 * podrobné oblasti (`R34`). Seznam se proto čte ze stylu, ne z konstanty:
 * s pevným seznamem by v Sahaře klepnutí na město jméno nenašlo.
 *
 * @param {{layers?: {id: string}[]}} style
 * @returns {string[]}
 */
export function labelLayerIds(style) {
  const konec = new RegExp(`(^|-)(${POPISKY.join('|')})$`);
  return styleLayerIds(style).filter((id) => konec.test(id));
}

/**
 * Jméno zdroje (a předpona vrstev) pro další podrobnou oblast, odvozené ze
 * jména souboru: `…/sahara.pmtiles` → `sahara`. Čitelné jméno se hodí při
 * ladění; kdyby se srazilo s obsazeným, dostane pořadové číslo.
 */
function jmenoOblasti(url, obsazena) {
  const soubor = String(url).split(/[?#]/)[0].split('/').pop() || '';
  const zaklad = soubor.replace(/\.pmtiles$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'oblast';
  let jmeno = zaklad;
  for (let i = 2; obsazena.has(jmeno); i++) jmeno = `${zaklad}-${i}`;
  obsazena.add(jmeno);
  return jmeno;
}

/**
 * Sestaví styl mapy.
 *
 * @param {object} a
 * @param {string} a.tilesUrl  adresa archivu `.pmtiles` (naše doména)
 * @param {string[]} [a.dalsiUrls] další podrobné oblasti (`R34`, třeba Sahara);
 *                              kreslí se stejně jako Česko, od `DETAIL_OD_ZOOMU`
 * @param {string} [a.svetUrl] adresa hrubého archivu celého světa (`R32`);
 *                              bez ní mapa končí na okraji `tilesUrl`
 * @param {string} [a.fontsUrl] adresa složky s písmy (viz `PISMA_VYCHOZI`)
 * @param {boolean} [a.dark]
 * @param {string} [a.lang]
 * @returns {object} styl pro MapLibre
 */
export function buildStyle({
  tilesUrl, dalsiUrls = [], svetUrl = '', fontsUrl = PISMA_VYCHOZI, dark = false, lang = 'en',
}) {
  const c = dark ? PALETA.dark : PALETA.light;
  const jmeno = popisek(lang);
  const zdroj = (url) => ({
    type: 'vector',
    url: `pmtiles://${url}`,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });

  // 🚨 Pořadí je podstatné: celý svět DOLŮ, detail NAD něj. Plochy detailu
  // (země, voda) jsou neprůhledné, takže tam, kde detail je, svět zakryjí
  // i s jeho silnicemi a popisky; kde detail není, prosvítá svět.
  //
  // Další podrobné oblasti (`R34`) jdou nad Česko, každá celá za sebou.
  // Vzájemně se nepřekrývají, takže na jejich pořadí nezáleží. 🚨 Kreslí se
  // VŽDY až od `DETAIL_OD_ZOOMU`, i bez světa: vyříznutý archiv má na nízkých
  // přiblíženích dlaždice přes půl kontinentu (dlaždice z0 je celá planeta),
  // takže od nuly by Sahara zakryla Česko a zdvojila popisky.
  const obsazena = new Set([ZDROJ, ZDROJ_SVET]);
  const dalsi = dalsiUrls.filter(Boolean).map((url) => ({ url, jmeno: jmenoOblasti(url, obsazena) }));

  const vrstvy = [
    ...(svetUrl ? vrstvyPodkladu(ZDROJ_SVET, 'svet-', 0, c, jmeno) : []),
    ...vrstvyPodkladu(ZDROJ, '', svetUrl ? DETAIL_OD_ZOOMU : 0, c, jmeno),
    ...dalsi.flatMap((o) => vrstvyPodkladu(o.jmeno, `${o.jmeno}-`, DETAIL_OD_ZOOMU, c, jmeno)),
  ];

  return {
    version: 8,
    name: 'MeteoTrace',
    // ⚠️ Všechny adresy míří na NÁS. Styl je jediné místo, kde by se dala do
    // mapy propašovat cizí doména, takže se to hlídá testem (R2, R12).
    glyphs: `${fontsUrl}{fontstack}/{range}.pbf`,
    sources: {
      ...(svetUrl ? { [ZDROJ_SVET]: zdroj(svetUrl) } : {}),
      [ZDROJ]: zdroj(tilesUrl),
      ...Object.fromEntries(dalsi.map((o) => [o.jmeno, zdroj(o.url)])),
    },
    layers: [
      { id: 'pozadi', type: 'background', paint: { 'background-color': c.zeme } },
      ...vrstvy,
    ],
  };
}

/**
 * Vrstvy nad jedním archivem.
 *
 * @param {string} zdroj    jméno zdroje ve stylu
 * @param {string} predpona předpona id vrstev (`''` pro detail, aby zůstala
 *                          jména, na která se odkazuje zvenku)
 * @param {number} odZoomu  nejnižší přiblížení, od kterého se kreslí
 */
function vrstvyPodkladu(zdroj, predpona, odZoomu, c, jmeno) {
  const ZDROJ = zdroj;
  return [
      { id: 'zeme', type: 'fill', source: ZDROJ, 'source-layer': 'earth',
        paint: { 'fill-color': c.zeme } },

      { id: 'zastavba', type: 'fill', source: ZDROJ, 'source-layer': 'landuse',
        filter: ['match', ['get', 'kind'],
          ['residential', 'commercial', 'industrial', 'pedestrian'], true, false],
        paint: { 'fill-color': c.zastavba } },

      { id: 'zelen', type: 'fill', source: ZDROJ, 'source-layer': 'landuse',
        filter: ['match', ['get', 'kind'],
          ['park', 'forest', 'wood', 'grass', 'farmland', 'scrub', 'allotments', 'cemetery'], true, false],
        paint: { 'fill-color': c.les } },

      { id: 'voda', type: 'fill', source: ZDROJ, 'source-layer': 'water',
        paint: { 'fill-color': c.voda } },

      // Řeky a potoky jsou čáry, ne plochy — bez nich zmizí většina vodstva.
      { id: 'reky', type: 'line', source: ZDROJ, 'source-layer': 'water',
        filter: ['match', ['get', 'kind'], ['river', 'stream', 'canal'], true, false],
        paint: {
          'line-color': c.voda,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 1.6, 15, 3],
        } },

      { id: 'budovy', type: 'fill', source: ZDROJ, 'source-layer': 'buildings',
        minzoom: 14,
        paint: { 'fill-color': c.budova } },

      { id: 'zeleznice', type: 'line', source: ZDROJ, 'source-layer': 'roads',
        filter: ['==', ['get', 'kind'], 'rail'],
        minzoom: 9,
        paint: {
          'line-color': c.zeleznice,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 14, 1.2],
          'line-dasharray': [3, 2],
        } },

      // Obrys pod silnicemi je to, co dělá mapu čitelnou i pod radarem:
      // silnice pak nesplyne s podkladem ani s deštěm.
      { id: 'silnice-obrys', type: 'line', source: ZDROJ, 'source-layer': 'roads',
        filter: ['match', ['get', 'kind'], ['highway', 'major_road'], true, false],
        minzoom: 6,
        paint: {
          'line-color': c.silniceObrys,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.4, 10, 3.6, 15, 9],
        } },

      { id: 'silnice-vedlejsi', type: 'line', source: ZDROJ, 'source-layer': 'roads',
        filter: ['match', ['get', 'kind'], ['minor_road'], true, false],
        minzoom: 11,
        paint: {
          'line-color': c.silniceVedlejsi,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 15, 3],
        } },

      { id: 'silnice-hlavni', type: 'line', source: ZDROJ, 'source-layer': 'roads',
        filter: ['match', ['get', 'kind'], ['highway', 'major_road'], true, false],
        minzoom: 6,
        paint: {
          'line-color': c.silniceHlavni,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 10, 2, 15, 6],
        } },

      { id: 'hranice', type: 'line', source: ZDROJ, 'source-layer': 'boundaries',
        paint: {
          'line-color': c.hranice,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 1.4],
          'line-dasharray': [4, 2],
        } },

      // Popisky až úplně nahoře, ať je radar nepřekryje — jméno města je to,
      // podle čeho se člověk na mapě najde.
      { id: 'mesta', type: 'symbol', source: ZDROJ, 'source-layer': 'places',
        filter: ['==', ['get', 'kind'], 'locality'],
        layout: {
          'text-field': jmeno,
          'text-font': PISMO_VYRAZNE,
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 10, 14, 14, 17],
          'text-max-width': 8,
        },
        paint: {
          'text-color': c.popisek,
          'text-halo-color': c.popisekObrys,
          'text-halo-width': 1.4,
        } },

      { id: 'ctvrti', type: 'symbol', source: ZDROJ, 'source-layer': 'places',
        filter: ['match', ['get', 'kind'], ['neighbourhood', 'macrohood'], true, false],
        minzoom: 12,
        layout: {
          'text-field': jmeno,
          'text-font': PISMO,
          'text-size': 11,
          'text-max-width': 8,
        },
        paint: {
          'text-color': c.popisek,
          'text-halo-color': c.popisekObrys,
          'text-halo-width': 1.2,
        } },
  ].map((v) => {
    const min = Math.max(v.minzoom ?? 0, odZoomu);
    return { ...v, id: predpona + v.id, ...(min ? { minzoom: min } : {}) };
  });
}

/** Jména vrstev stylu — kvůli testu a kvůli vkládání radaru pod popisky. */
export function styleLayerIds(style) {
  return style.layers.map((l) => l.id);
}

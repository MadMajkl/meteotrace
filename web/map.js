/**
 * Mapa se srážkovým radarem.
 *
 * ⚠️ Spolu s `app.js` jeden ze dvou souborů, které sahají na DOM. Všechno,
 * co se dá spočítat bez stránky — které snímky existují, který je na řadě,
 * jak zní adresa dlaždice — leží v `lib/radar.js` a je otestované.
 *
 * ✅ PODKLAD JE VLASTNÍ (`R3`): jeden soubor `.pmtiles` na naší doméně a
 *    vlastní styl v `lib/map-style.js`. Žádný cizí poskytovatel, žádný klíč,
 *    žádný limit — a mapa se dá vzít offline, protože je to jeden soubor.
 *
 * ⚠️ Server musí umět ČÁSTEČNÉ STAHOVÁNÍ (`Range`). Archiv má gigabajty
 *    a prohlížeč si z něj bere jen kousky; bez toho se nenačte nic.
 *
 * ⚠️ `tile.openstreetmap.org` je vyloučený natrvalo — jejich pravidla
 *    zakazují použití v mobilní aplikaci. Není to o technologii,
 *    ale o poskytovateli.
 */

'use strict';

import { t, tf } from './lib/i18n.js';
import {
  radarFrames, tileTemplate, frameIndexAt, nextFrame, frameLabel, forecastSplit, offsetLabel,
  TILE_SIZE, MAX_ZOOM,
} from './lib/radar.js';
import { apiGet } from './lib/api.js';
import { buildStyle, fontsUrlFrom } from './lib/map-style.js';
import { tilesUrl } from './lib/tiles-config.js';
import { placeFromMap } from './lib/map-pick.js';
import { spojOsu, jeVeVyrezu, rohy as vyrezRohy } from './lib/nowcast.js';

/** Jak dlouho se čeká, než se mapa vzdá a řekne to nahlas. */
const MAP_LOAD_TIMEOUT_MS = 12000;

const RADAR_SOURCE = 'radar';
const RADAR_LAYER = 'radar';

const WARN_SOURCE = 'vystraha';
const WARN_FILL = 'vystraha-vypln';
const WARN_LINE = 'vystraha-obrys';

/**
 * Barvy obrysu výstrahy. Odpovídají štítkům závažnosti na kartě nad mapou —
 * kdyby si každá plocha barvila po svém, člověk by mezi kartou a mapou
 * nespojil, že jde o tutéž věc.
 */
const WARN_COLORS = {
  extreme: '#b3261e',
  severe: '#d2691e',
  moderate: '#e6b45c',
  minor: '#b0b8c2',
  unknown: '#6b7a8c',
};

const ROUTE_SOURCE = 'trasa';
const ROUTE_CASING = 'trasa-obrys';
const ROUTE_LINE = 'trasa-cara';
const ROUTE_POINTS = 'trasa-body';

/**
 * 🚨 VYVÁŽENO SCHVÁLNĚ. Legenda pod mapou si barvy bere odsud, ne z vlastní
 * kopie — dvě sady odstínů by se rozešly při první úpravě a legenda by pak
 * vysvětlovala barvy, které v mapě nejsou.
 *
 * Barvy bodů trasy. Odpovídají tomu, jak se body chovají ve výpisu pod mapou:
 * co je tam zvýrazněné jako nebezpečné, musí být zvýrazněné i tady — jinak
 * by mapa a seznam vyprávěly každý něco jiného.
 */
export const ROUTE_COLORS = {
  hazard: '#b3261e',    // bouřka, náledí, silný vítr
  rain: '#1a7fd4',      // pravděpodobný déšť
  ok: '#2f7d4f',
  unknown: '#6b7a8c',   // za obzorem předpovědi
};

/**
 * Pořadí překryvů odspodu nahoru. Radar se vkládá POD ten nejnižší z nich,
 * protože se zakládá znovu při každém snímku animace a jinak by po vteřině
 * přebil všechno, co je nad ním.
 */
const PREKRYVY = [WARN_FILL, WARN_LINE, ROUTE_CASING, ROUTE_LINE, ROUTE_POINTS];

let map = null;
/**
 * Jak blízko se mapa otevře nad jedním místem.
 *
 * 🚨 Michal 27. 8. 2026: *„u místa prosím o větší zoom mapy, když na něj
 * najedeme."* Sedmička ukazovala půl republiky — na otázku „jaké je počasí
 * TADY" odpovídala pohledem, ve kterém se vlastní obec ztrácela mezi dvěma
 * kraji.
 *
 * ⚠️ Výš než devítka se jít nemá. Radarové dlaždice končí na `MAX_ZOOM`
 * (z7) a nad ním se jen roztahují; na desítce už je ze srážkového pole
 * barevná kaše. Devítka je kompromis: obec i s okolím, radar ještě čitelný.
 */
const PRIBLIZENI_MISTA = 9;

let protokolZapsan = false;
/** Poslední vykreslená trasa — po přebarvení mapy se kreslí znovu. */
let trasaData = null;
/**
 * Obsluha bubliny se zapojuje JEDNOU; vrstva bodů se překresluje pořád.
 *
 * 🚨 Tenhle řádek 25. 8. 2026 chyběl a `showRoute()` padalo na
 * `bublinaZapojena is not defined` hned po nakreslení čáry. Čára se objevila,
 * ale přiblížení na trasu už ne — a vypadalo to jako vada výpočtu výřezu,
 * ne jako chybějící deklarace. **Chyba se přitom ztrácela v `catch`**, který
 * ji jen zapsal do konzole.
 */
let bublinaZapojena = false;
/** Špendlík vybraného místa. Vzniká jednou a pak se PŘESOUVÁ, viz níže. */
let znacka = null;
/** Co se má stát, když si uživatel vybere místo klepnutím do mapy. */
let priVyberu = null;
/** Poslední obrys výstrahy — po přebarvení mapy se musí nakreslit znovu. */
let vystrahaGeo = null;
let vystrahaTrida = 'unknown';
/** Doběhl styl mapy? Bez něj se do mapy nesmí sáhnout — vrstvy by házely chybu. */
let styleReady = false;
let frames = [];
/** Bod, pro který jsou snímky stažené — potřebuje ho obnova při potažení dolů. */
let posledniBod = null;
/** Rohy obrázku předpovědi (ČHMÚ dodává hotový výřez, ne dlaždice). */
let nowcastRohy = null;
let nowcastZdroj = '';
let index = 0;
let timer = 0;
let playing = false;
let lang = 'en';
let timeZone = 'UTC';

const $ = (id) => document.getElementById(id);

/** Podklad podle motivu zařízení — vlastní styl, vlastní data (R3). */
/**
 * Je teď tmavý režim?
 *
 * ⚠️ Ruční volba z nastavení přebíjí zařízení. Kdyby se mapa ptala jen
 * systému, zůstala by po přepnutí opačná než appka kolem ní — a vypadalo by
 * to jako chyba vykreslování.
 */
function jeTma() {
  const volba = document.documentElement.dataset.theme;
  // 🚨 Podle toho, jestli je motiv tmavý, ne podle jediného jména `dark`.
  // Od 29. 8. 2026 existuje i `pink-dark`; kdyby se hledala jen shoda
  // s `dark`, spadl by dotaz na systém a v tmavě růžové appce by svítila
  // světlá mapa. A vypadalo by to jako vada vykreslování, ne jako mezera
  // v podmínce.
  if (volba) return volba.includes('dark');
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

const styleFor = () => buildStyle({
  tilesUrl: tilesUrl(),
  // Písma leží vedle appky, ať sedí i v obalu pro Android (`…/assets/www/`).
  fontsUrl: fontsUrlFrom(document.baseURI),
  dark: jeTma(),
  lang,
});

/** Přebarví mapu po ruční změně vzhledu. Volá obrazovka, viz `zmenVzhled()`. */
export function refreshTheme() {
  if (!map || !styleReady) return;
  map.setStyle(styleFor());
  map.once('styledata', () => {
    drawFrame();
    showWarningArea(vystrahaGeo, vystrahaTrida);
    showRoute(trasaData, { fit: false });
  });
}

/**
 * Založí mapu. Volá se až při prvním zobrazení — MapLibre je skoro megabajt
 * a stránka, která radar neotevře, ho nemá proč platit.
 */
export async function showMap({ lat, lon, lang: language, timeZone: tz, onPick, keepView = false }) {
  lang = language;
  timeZone = tz || 'UTC';
  if (onPick) priVyberu = onPick;

  if (!map) {
    // 🚨 PRÁZDNÝ ČERNÝ OBDÉLNÍK JE NEJHORŠÍ MOŽNÁ ODPOVĚĎ. Když se mapa
    // nemá jak vykreslit, uživatel nemá jak poznat, jestli se načítá, jestli
    // je vadná appka, nebo jeho prohlížeč. Musí to být napsané v tom místě,
    // kam se dívá — Michal 25. 8. 2026: „mapa tam není žádná."
    if (typeof maplibregl === 'undefined' || maplibregl.supported?.() === false) {
      zpravaVMape(t('radar.noWebgl', lang));
      return;
    }

    // Protokol `pmtiles://` se musí zaregistrovat DŘÍV, než mapa vznikne —
    // jinak si o dlaždice řekne a nikdo jí neodpoví.
    if (!protokolZapsan) {
      maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);
      protokolZapsan = true;
    }

    map = new maplibregl.Map({
      container: $('map'),
      style: styleFor(),
      center: [lon, lat],
      zoom: PRIBLIZENI_MISTA,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // ⚠️ Na událost `load` se čeká se stropem. Kdyby nedorazila — a viděl jsem
    // to: styl se zasekne bez jediné chyby v konzoli — zůstalo by čekání viset
    // navždy a s ním i všechno za ním: radar by se nikdy nenačetl a uživatel
    // by koukal na černý obdélník bez vysvětlení. Se stropem se aspoň řekne,
    // že se mapa nepovedla.
    map.on('load', () => { styleReady = true; });

    // 🚨 Když se nenačte podklad, MapLibre to řekne JEN sem. Bez tohohle
    // posluchače zůstane po nedostupném archivu prázdná plocha a v konzoli
    // nic — a hledá se to pak hodiny. Chyba jde do konzole i na obrazovku.
    map.on('error', (e) => {
      const duvod = e?.error?.message || 'neznámá chyba';
      console.warn('[MeteoTrace] mapa:', duvod, e?.sourceId ? `(zdroj ${e.sourceId})` : '');
      // Radar smí selhat sám o sobě — bez podkladu ale není co ukázat.
      if (e?.sourceId && e.sourceId !== RADAR_SOURCE) {
        // 🚨 „Nepodařilo se načíst" je konec hledání, ne začátek. Michal
        // 28. 8. 2026 hlásil přesně tuhle větu z telefonu — a nedalo se
        // z ní poznat, jestli je to síť, adresa podkladu, nebo písma.
        // Do konzole se na telefon nikdo nepodívá, tak to musí být vidět.
        zpravaVMape(`${t('radar.mapFailed', lang)}\n${zkratit(duvod)}`, { pruh: true });
      }
    });
    await Promise.race([
      new Promise((res) => map.on('load', res)),
      new Promise((res) => setTimeout(res, MAP_LOAD_TIMEOUT_MS)),
    ]);

    // ⚠️ Instance se NENULUJE, i když se styl nepovedl. Mapa je pořád na
    // obrazovce a další pokus by v témže místě založil druhou — dvě mapy přes
    // sebe, každá s vlastním WebGL. Radar se prostě nekreslí a řekne se to.
    if (!styleReady) {
      $('radar-time').textContent = t('error.failed', lang);
      zpravaVMape(t('radar.mapFailed', lang));
      return;
    }
    zpravaVMape(null);

    znacka = new maplibregl.Marker({ color: '#1a7fd4' }).setLngLat([lon, lat]).addTo(map);
    $('radar-play').addEventListener('click', togglePlay);
    // Sáhnutí na posuvník znamená „chci vidět tenhle snímek", ne „přehrávej
    // odsud". Proto se animace zastaví — jinak by uživateli utekla dřív, než
    // se stihne podívat, a vypadalo by to, že posuvník nedrží.
    $('radar-scrub').addEventListener('input', (e) => {
      pause();
      index = Number(e.target.value);
      drawFrame();
    });

    // Klepnutí do mapy = výběr místa. Jméno se bere z NAŠICH popisků, ne
    // z cizí služby — dlaždice je nesou včetně české podoby (R3).
    map.on('click', (e) => {
      const bod = [e.lngLat.lat, e.lngLat.lng];
      const okoli = 30;   // px — prst není přesný, popisek bývá vedle bodu
      const ramecek = [
        [e.point.x - okoli, e.point.y - okoli],
        [e.point.x + okoli, e.point.y + okoli],
      ];
      let popisky = [];
      try {
        popisky = map.queryRenderedFeatures(ramecek, { layers: ['mesta', 'ctvrti'] })
          .map((f) => ({
            name: typeof f.properties?.name === 'string' ? f.properties.name : '',
            lat: f.geometry?.coordinates?.[1],
            lon: f.geometry?.coordinates?.[0],
          }));
      } catch {
        // Vrstvy nemusí existovat (styl se právě mění) — pak se prostě
        // použijí souřadnice. Není důvod kvůli tomu spadnout.
      }
      const misto = placeFromMap(bod, popisky);
      if (misto && priVyberu) priVyberu(misto);
    });

    // Mapa se zakládá dřív, než má karta konečnou velikost, a MapLibre si
    // rozměr sám nehlídá. Pozorovatel to srovná — a zároveň pokryje otočení
    // telefonu a rozložení skládacího displeje, kde se plocha mění za běhu.
    new ResizeObserver(() => map.resize()).observe($('map'));

    // ⚠️ Přepnutí světlého a tmavého režimu za běhu. Bez tohohle si mapa drží
    // barvy z okamžiku, kdy vznikla — appka kolem ní se přebarví a mapa zůstane
    // opačná, což vypadá jako chyba vykreslování.
    //
    // Přebarvení znamená VÝMĚNU CELÉHO STYLU, takže s ním zmizí i radar a obrys
    // výstrahy: obojí se musí nakreslit znovu, až bude nový styl na světě.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!map || !styleReady) return;
      map.setStyle(styleFor());
      map.once('styledata', () => {
        drawFrame();
        showWarningArea(vystrahaGeo, vystrahaTrida);
        // Trasa musí přežít přebarvení stejně jako výstraha — bez tohohle
        // by po přepnutí na tmavý režim zmizela a vypadalo by to, že se
        // přepočítala do prázdna.
        showRoute(trasaData, { fit: false });
      });
    });

  } else {
    if (!styleReady) {
      $('radar-time').textContent = t('error.failed', lang);
      return;
    }
    // ⚠️ Po výběru klepnutím se s mapou NEHÝBE. Uživatel si ji sám přiblížil
    // a ukázal do ní prstem — přeskočit mu ji zpátky na výchozí přiblížení
    // by znamenalo, že o svůj pohled přijde právě tím, že ho použil.
    if (!keepView) map.easeTo({ center: [lon, lat], zoom: PRIBLIZENI_MISTA });
  }

  // 🚨 Špendlík se PŘESOUVÁ, nezakládá znovu. Dřív vznikal jen při prvním
  // otevření mapy, takže po vyhledání dalšího místa zůstal viset tam, kde
  // byl — mapa ukazovala Brno a špendlík trčel v Praze.
  if (znacka) znacka.setLngLat([lon, lat]);

  await loadFrames(lat, lon);
}

/**
 * Obrys území, pro které platí výstraha.
 *
 * ⚠️ Kreslí se NAD radar, ne pod něj. Pod radarem by ho srážky překryly zrovna
 * v tom případě, kdy je nejvíc potřeba — tedy když nad územím opravdu prší.
 *
 * Výplň je záměrně slabá: mapa má pořád sloužit hlavně radaru. Nese informaci
 * „tady výstraha platí", ne „tady se dívej".
 */
export function showWarningArea(geometrie, trida = 'unknown') {
  vystrahaGeo = geometrie || null;
  vystrahaTrida = trida;
  if (!map || !styleReady) return;

  for (const id of [WARN_FILL, WARN_LINE]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(WARN_SOURCE)) map.removeSource(WARN_SOURCE);
  if (!geometrie) return;

  map.addSource(WARN_SOURCE, {
    type: 'geojson',
    data: { type: 'Feature', geometry: geometrie, properties: {} },
  });
  const barva = WARN_COLORS[trida] || WARN_COLORS.unknown;
  map.addLayer({
    id: WARN_FILL, type: 'fill', source: WARN_SOURCE,
    paint: { 'fill-color': barva, 'fill-opacity': 0.12 },
  });
  map.addLayer({
    id: WARN_LINE, type: 'line', source: WARN_SOURCE,
    paint: { 'line-color': barva, 'line-width': 2, 'line-opacity': 0.9 },
  });
}

/**
 * Trasa v mapě — čára a body, ve kterých se počítá počasí.
 *
 * ⚠️ KRESLÍ SE NAD RADAR. Pod ním by ji srážky překryly zrovna tehdy, kdy je
 * to nejzajímavější — tedy když nad trasou prší. Platí to i pro obrys výstrahy;
 * pořadí drží `PREKRYVY`.
 *
 * 🚨 Čára má dvě vrstvy: světlý „obrys" a nad ním barevnou linku. Bez obrysu
 * trasa mizí přes tmavý les i přes zelené pole silného deště — a mapa má být
 * čitelná právě v tom počasí, kvůli kterému se do ní člověk dívá.
 *
 * @param {{line: Array<[number, number]>, points: Array<object>}|null} data
 *   `line` jsou body trasy jako [šířka, délka]; `points` nesou navíc `stav`
 *   (`hazard` | `rain` | `ok` | `unknown`) a `popis` do bubliny.
 * @param {object} [opts]
 * @param {boolean} [opts.fit]  srovnat pohled na celou trasu (jen u nové trasy —
 *   jinak by se uživateli sebral pohled, který si sám nastavil)
 */
export function showRoute(data, { fit = false } = {}) {
  trasaData = data && data.line?.length >= 2 ? data : null;
  if (!map || !styleReady) return;

  for (const id of [ROUTE_POINTS, ROUTE_LINE, ROUTE_CASING]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(ROUTE_SOURCE)) map.removeSource(ROUTE_SOURCE);
  if (map.getSource(`${ROUTE_SOURCE}-body`)) map.removeSource(`${ROUTE_SOURCE}-body`);
  if (!trasaData) return;

  const cara = trasaData.line.map(([la, lo]) => [lo, la]);   // GeoJSON má [délka, šířka]
  map.addSource(ROUTE_SOURCE, {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: cara }, properties: {} },
  });
  map.addSource(`${ROUTE_SOURCE}-body`, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: (trasaData.points || []).map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { barva: ROUTE_COLORS[p.stav] || ROUTE_COLORS.unknown, popis: p.popis || '' },
      })),
    },
  });

  map.addLayer({
    id: ROUTE_CASING, type: 'line', source: ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.85 },
  });
  map.addLayer({
    id: ROUTE_LINE, type: 'line', source: ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#1a3d6b', 'line-width': 3.5 },
  });
  map.addLayer({
    id: ROUTE_POINTS, type: 'circle', source: `${ROUTE_SOURCE}-body`,
    paint: {
      'circle-radius': 6,
      'circle-color': ['get', 'barva'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });

  // Bublina s časem a počasím. ⚠️ Bez ní jsou barevné tečky hezké, ale němé:
  // „červená někde uprostřed" neřekne v kolik tam budeš ani co tam je.
  if (!bublinaZapojena) {
    map.on('click', ROUTE_POINTS, (e) => {
      const f = e.features?.[0];
      const popis = f?.properties?.popis;
      if (!popis) return;
      new maplibregl.Popup({ closeButton: false, offset: 10 })
        .setLngLat(f.geometry.coordinates)
        .setText(popis)
        .addTo(map);
    });
    // Nad bodem se ukazuje ručička — jinak nic nenapoví, že se dá klepnout.
    map.on('mouseenter', ROUTE_POINTS, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', ROUTE_POINTS, () => { map.getCanvas().style.cursor = ''; });
    bublinaZapojena = true;
  }

  if (fit) srovnejNaTrasu(cara);
}

/**
 * Přiblížení na celou trasu, ať zabere co nejvíc plochy.
 *
 * 🚨 NEJDŘÍV `resize()`. Karta s mapou se mezi obrazovkami PŘESOUVÁ, takže
 * v okamžiku výpočtu má MapLibre ještě rozměry z předchozího místa — a spočítá
 * přiblížení pro jinak velké okno. Na snímku z 25. 8. 2026 z toho byla trasa
 * Plzeň → Klatovy jako proužek uprostřed poloviny Čech. Pozorovatel velikosti
 * to sice srovná, ale až v dalším snímku, tedy po `fitBounds()`.
 *
 * ⚠️ Okraje jsou nesymetrické schválně: dole sedí ovládání radaru a nahoře
 * tlačítka přiblížení. A jsou malé — cílem je trasu maximalizovat, ne ji
 * uctivě orámovat.
 *
 * ⚠️ `maxZoom` je tu proti krátké trase: bez něj by cesta přes dvě ulice
 * skončila na přiblížení, kde není vidět nic než ty dvě ulice.
 */
function srovnejNaTrasu(cara) {
  map.resize();

  const b = cara.reduce((acc, c) => acc.extend(c),
    new maplibregl.LngLatBounds(cara[0], cara[0]));

  map.fitBounds(b, {
    padding: { top: 34, right: 24, bottom: 44, left: 24 },
    maxZoom: 13,
    duration: 600,
  });
}

/** Sdělení místo mapy — smí ho napsat i obrazovka, viz `presunMapu()`. */
export function mapMessage(text) {
  zpravaVMape(text);
}

/**
 * Sdělení místo mapy.
 *
 * ⚠️ Píše se DO plochy mapy, ne do pruhu pod ní. Kdo se dívá na prázdný
 * obdélník, hledá vysvětlení v něm — ne o dva řádky níž.
 */
/**
 * Zkrátí technickou hlášku na to, co se vejde do mapy a co něco říká.
 *
 * ⚠️ Nechává adresu, protože právě ta je poznávací znamení: podle ní se
 * pozná podklad od písem a naše doména od cizí. Uřízne se zprostředka,
 * ať zůstane začátek i konec.
 */
function zkratit(hlaska, strop = 120) {
  const s = String(hlaska).replace(/s+/g, ' ').trim();
  if (s.length <= strop) return s;
  const pul = Math.floor((strop - 1) / 2);
  return `${s.slice(0, pul)}…${s.slice(-pul)}`;
}

/**
 * Napíše zprávu do plochy mapy.
 *
 * 🚨 DVĚ PODOBY, A TEN ROZDÍL JE PODSTATNÝ. Přes celou plochu se píše
 * jen tehdy, když mapa NENÍ — prázdný obdélník musí být vysvětlený.
 * Když mapa je a selhal jen některý zdroj, patří zpráva do pruhu dole:
 * neprůhledná deska přes celou mapu totiž vypadá jako že se nenačetlo
 * vůbec nic. Přesně to hlásil Michal z telefonu 28. 8. 2026 („APK
 * nezobrazuje mapu") — mapa pod tou deskou přitom mohla být v pořádku.
 *
 * @param {string|null} text  `null` zprávu odstraní
 * @param {{pruh?: boolean}} [jak]
 */
function zpravaVMape(text, { pruh = false } = {}) {
  const box = $('map');
  if (!box) return;
  let p = box.querySelector('.map-zprava');
  if (!text) { p?.remove(); return; }
  if (!p) {
    p = document.createElement('p');
    box.append(p);
  }
  p.className = pruh ? 'map-zprava map-zprava--pruh' : 'map-zprava';
  p.textContent = text;
}

/** Pod kterou vrstvu patří radar, aby nic nepřebil. */
function podCimJeRadar() {
  const vrstvy = map.getStyle?.()?.layers || [];
  for (const v of vrstvy) if (PREKRYVY.includes(v.id)) return v.id;
  return undefined;
}

/**
 * Diagnostika: co mapa právě ukazuje.
 *
 * Bez tohohle se přiblížení ladí naslepo — z obrázku se nepozná, jestli je
 * vada ve výpočtu výřezu, nebo v rozměrech plátna.
 */
export function mapState() {
  if (!map) return null;
  const c = map.getCenter();
  return {
    zoom: Number(map.getZoom().toFixed(2)),
    stred: [Number(c.lat.toFixed(4)), Number(c.lng.toFixed(4))],
    sirka: map.getCanvas().clientWidth,
    vyska: map.getCanvas().clientHeight,
    maTrasu: !!map.getLayer(ROUTE_LINE),
    vyrez: (() => { const bb = map.getBounds(); return { jih: +bb.getSouth().toFixed(4), sever: +bb.getNorth().toFixed(4), zapad: +bb.getWest().toFixed(4), vychod: +bb.getEast().toFixed(4) }; })(),
  };
}

/** Po přesunu karty mezi obrazovkami má mapa jinou plochu. */
export function refreshMap() {
  if (map) map.resize();
}

/**
 * Znovu stáhne osu radaru. Volá se při potažení dolů.
 *
 * ⚠️ Radar je nejrychleji stárnoucí věc na obrazovce — nové snímky přibývají
 * po pěti minutách. Kdyby se při „načíst znovu" obnovilo jen počasí, zůstala
 * by mapa u snímků z doby, kdy se appka otevřela, a tvářila by se jako teď.
 *
 * ⚠️ Bez mapy se nic nestane a nic se nehlásí: kdo radar neotevřel, nemá co
 * obnovovat. Vrací `false`, ať volající pozná, jestli se vůbec sáhlo ven.
 */
export function refreshRadar() {
  if (!map || !styleReady || !posledniBod) return false;
  loadFrames(posledniBod.lat, posledniBod.lon);
  return true;
}

/**
 * Stáhne osu: naměřené snímky z radaru a předpověď na hodinu dopředu.
 *
 * ⚠️ Předpověď se tahá ZVLÁŠŤ a její selhání nesmí shodit radar. Je to
 * přídavek — bez něj osa jen končí přítomností, což je stav, ve kterém
 * appka žila do 28. 8. 2026.
 *
 * ⚠️ A ptáme se na ni jen tam, kde platí: nowcast ČHMÚ pokrývá Česko
 * a kus okolí. Pro Berlín nebo Vídeň by to byl dotaz zadarmo pro nikoho.
 */
async function loadFrames(lat, lon) {
  posledniBod = { lat, lon };
  let radarove = [];
  try {
    const { data } = await apiGet('radar');
    radarove = radarFrames(data);
  } catch {
    radarove = [];
  }

  let predpoved = [];
  nowcastRohy = null;
  if (jeVeVyrezu(lat, lon)) {
    try {
      const { data } = await apiGet('nowcast');
      predpoved = (data?.snimky || []).map((s) => ({
        timeMs: s.timeMs, obrazek: s.obrazek, minut: s.minut, chmi: true,
      }));
      if (predpoved.length) {
        nowcastRohy = data.rohy || vyrezRohy();
        nowcastZdroj = `© ${data.zdroj} (${data.licence})`;
      }
    } catch {
      predpoved = [];   // přídavek, ne podmínka
    }
  }

  frames = spojOsu(radarove, predpoved);

  if (!frames.length) {
    $('radar-time').textContent = t('error.failed', lang);
    $('radar-scrub').disabled = true;
    return;
  }

  // Osa se nastaví jednou, podle toho, kolik snímků opravdu přišlo. Napevno
  // zapsaný počet by při výpadku dopočtu ukazoval do prázdna.
  const scrub = $('radar-scrub');
  scrub.disabled = false;
  scrub.max = String(frames.length - 1);
  const split = forecastSplit(frames);
  scrub.style.setProperty('--split', split === null ? '100%' : `${(split * 100).toFixed(1)}%`);

  index = frameIndexAt(frames, Date.now());
  drawFrame();
  play();
}

/**
 * Vykreslí snímek.
 *
 * Zdroj se pokaždé odstraní a založí znovu. MapLibre neumí u rastrového
 * zdroje vyměnit adresu za běhu — a měnit ji „chytře" přes vnitřní pole
 * by se rozbilo při první změně knihovny.
 */
function drawFrame() {
  if (!styleReady) return;
  const frame = frames[index];
  if (!frame) return;

  // Předpověď ČHMÚ chodí jako HOTOVÝ OBRÁZEK s pevnými rohy, ne jako
  // dlaždice: je to jeden výřez 680 × 460 px ve webovém Mercatoru.
  // Zdroj se proto podle druhu snímku zakládá jinak — ale pod týmž
  // jménem, aby zbytek (pořadí vrstev, mizení v přiblížení) platil pro
  // obojí stejně.
  const url = frame.chmi ? frame.obrazek : tileTemplate(frame);
  if (!url) return;

  if (map.getLayer(RADAR_LAYER)) map.removeLayer(RADAR_LAYER);
  if (map.getSource(RADAR_SOURCE)) map.removeSource(RADAR_SOURCE);

  // ⚠️ `maxzoom` tu není kosmetika. Bez něj si knihovna říká o dlaždice nad
  // strop RainVieweru a ten místo chyby vrací obrázek s nápisem „Zoom Level
  // Not Supported" — přes celou mapu. A pozor na velikost: u 256px dlaždic si
  // MapLibre říká o úroveň VYŠŠÍ, než je přiblížení mapy (jeho vnitřní dlaždice
  // má 512), takže mapa otevřená na zoomu 7 sahala rovnou na z8, tedy za strop.
  map.addSource(RADAR_SOURCE, frame.chmi ? {
    // 🚨 Popiska není zdvořilost, ale podmínka licence: data ČHMÚ jsou
    // CC BY 4.0, tedy zdarma, ale s uvedením zdroje.
    type: 'image', url, coordinates: nowcastRohy, attribution: nowcastZdroj,
  } : {
    type: 'raster', tiles: [url], tileSize: TILE_SIZE, maxzoom: MAX_ZOOM,
  });
  // ⚠️ Radar se zakládá znovu při KAŽDÉM snímku animace. Kdyby se přidával
  // navrch, po prvním překreslení by přebil obrys výstrahy — a ten by zmizel
  // sám od sebe po vteřině, což se hledá mizerně. Proto se vkládá POD něj.
  map.addLayer({
    id: RADAR_LAYER, type: 'raster', source: RADAR_SOURCE,
    paint: {
      // 🚨 RADAR MÁ VLASTNÍ ROZLIŠENÍ A KONČÍ NA z7.
      //
      // Nad ním se tatáž dlaždice jen roztahuje, takže z každé srážkové
      // buňky je čím dál větší čtverec. Michal 27. 8. 2026: *„proč jsou
      // tam teď ty čtverce?"* — objevily se přesně tehdy, když se výchozí
      // pohled na místo přiblížil ze sedmičky na devítku. Změřeno: při
      // mapě na z9 si vrstva pořád říká o z7.
      //
      // Zvětšenina se nedá zostřit — data jemnější nejsou. Dá se ale
      // ubrat na síle: v přiblížení, kde už jde o ulice, má radar dělat
      // nádech, ne mozaiku. Podklad zůstává ostrý, ten je vektorový.
      'raster-opacity': [
        'interpolate', ['linear'], ['zoom'],
        MAX_ZOOM, 0.75,
        MAX_ZOOM + 3, 0.4,
      ],
    },
  }, podCimJeRadar());

  const label = frameLabel(frame, timeZone, lang);
  $('radar-time').textContent = label.time;
  // Posuvník musí jít i s animací — jinak by po pár snímcích ukazoval jinam,
  // než co je vidět v mapě.
  $('radar-scrub').value = String(index);
  const off = offsetLabel(frame);
  $('radar-offset').textContent = off.key === 'now'
    ? t('radar.now', lang)
    : tf(`radar.${off.key}`, { min: off.min }, lang);
  // Dopočet musí být poznat — jinak by se odhad tvářil jako naměřený stav.
  // A když je to naše česká předpověď, řekne se rovnou čí: uživatel má
  // právo vědět, že za tím číslem stojí ČHMÚ, ne odhad z obrázků.
  const druh = frame.chmi ? 'radar.nowcastChmi' : (label.forecast ? 'radar.nowcast' : 'radar.observed');
  $('radar-kind').textContent = t(druh, lang);
  $('radar-kind').dataset.forecast = String(label.forecast);
}

function play() {
  playing = true;
  $('radar-play').textContent = '❙❙';
  $('radar-play').setAttribute('aria-label', t('radar.pause', lang));
  step();
}

function step() {
  clearTimeout(timer);
  const { index: next, holdMs } = nextFrame(frames, index);
  timer = setTimeout(() => {
    index = next;
    drawFrame();
    if (playing) step();
  }, holdMs);
}

function pause() {
  playing = false;
  clearTimeout(timer);
  $('radar-play').textContent = '▶';
  $('radar-play').setAttribute('aria-label', t('radar.play', lang));
}

function togglePlay() {
  playing ? pause() : play();
}

/** Zastaví animaci, když je stránka na pozadí — jinak by zbytečně stahovala dlaždice. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(timer);
  else if (playing) step();
});

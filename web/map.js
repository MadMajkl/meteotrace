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

import { t } from './lib/i18n.js';
import {
  radarFrames, tileTemplate, frameIndexAt, nextFrame, frameLabel, TILE_SIZE, MAX_ZOOM,
} from './lib/radar.js';
import { apiGet } from './lib/api.js';
import { buildStyle } from './lib/map-style.js';
import { tilesUrl } from './lib/tiles-config.js';

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

let map = null;
let protokolZapsan = false;
/** Poslední obrys výstrahy — po přebarvení mapy se musí nakreslit znovu. */
let vystrahaGeo = null;
let vystrahaTrida = 'unknown';
/** Doběhl styl mapy? Bez něj se do mapy nesmí sáhnout — vrstvy by házely chybu. */
let styleReady = false;
let frames = [];
let index = 0;
let timer = 0;
let playing = false;
let lang = 'en';
let timeZone = 'UTC';

const $ = (id) => document.getElementById(id);

/** Podklad podle motivu zařízení — vlastní styl, vlastní data (R3). */
const styleFor = () => buildStyle({
  tilesUrl: tilesUrl(),
  dark: matchMedia('(prefers-color-scheme: dark)').matches,
  lang,
});

/**
 * Založí mapu. Volá se až při prvním zobrazení — MapLibre je skoro megabajt
 * a stránka, která radar neotevře, ho nemá proč platit.
 */
export async function showMap({ lat, lon, lang: language, timeZone: tz }) {
  lang = language;
  timeZone = tz || 'UTC';

  if (!map) {
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
      zoom: 7,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // ⚠️ Na událost `load` se čeká se stropem. Kdyby nedorazila — a viděl jsem
    // to: styl se zasekne bez jediné chyby v konzoli — zůstalo by čekání viset
    // navždy a s ním i všechno za ním: radar by se nikdy nenačetl a uživatel
    // by koukal na černý obdélník bez vysvětlení. Se stropem se aspoň řekne,
    // že se mapa nepovedla.
    map.on('load', () => { styleReady = true; });
    await Promise.race([
      new Promise((res) => map.on('load', res)),
      new Promise((res) => setTimeout(res, MAP_LOAD_TIMEOUT_MS)),
    ]);

    // ⚠️ Instance se NENULUJE, i když se styl nepovedl. Mapa je pořád na
    // obrazovce a další pokus by v témže místě založil druhou — dvě mapy přes
    // sebe, každá s vlastním WebGL. Radar se prostě nekreslí a řekne se to.
    if (!styleReady) {
      $('radar-time').textContent = t('error.failed', lang);
      return;
    }

    new maplibregl.Marker({ color: '#1a7fd4' }).setLngLat([lon, lat]).addTo(map);
    $('radar-play').addEventListener('click', togglePlay);

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
      });
    });

  } else {
    if (!styleReady) {
      $('radar-time').textContent = t('error.failed', lang);
      return;
    }
    map.easeTo({ center: [lon, lat], zoom: 7 });
  }

  await loadFrames();
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

async function loadFrames() {
  try {
    const { data } = await apiGet('radar');
    frames = radarFrames(data);
  } catch {
    frames = [];
  }

  if (!frames.length) {
    $('radar-time').textContent = t('error.failed', lang);
    return;
  }

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
  const url = tileTemplate(frame);
  if (!url) return;

  if (map.getLayer(RADAR_LAYER)) map.removeLayer(RADAR_LAYER);
  if (map.getSource(RADAR_SOURCE)) map.removeSource(RADAR_SOURCE);

  // ⚠️ `maxzoom` tu není kosmetika. Bez něj si knihovna říká o dlaždice nad
  // strop RainVieweru a ten místo chyby vrací obrázek s nápisem „Zoom Level
  // Not Supported" — přes celou mapu. A pozor na velikost: u 256px dlaždic si
  // MapLibre říká o úroveň VYŠŠÍ, než je přiblížení mapy (jeho vnitřní dlaždice
  // má 512), takže mapa otevřená na zoomu 7 sahala rovnou na z8, tedy za strop.
  map.addSource(RADAR_SOURCE, {
    type: 'raster', tiles: [url], tileSize: TILE_SIZE, maxzoom: MAX_ZOOM,
  });
  // ⚠️ Radar se zakládá znovu při KAŽDÉM snímku animace. Kdyby se přidával
  // navrch, po prvním překreslení by přebil obrys výstrahy — a ten by zmizel
  // sám od sebe po vteřině, což se hledá mizerně. Proto se vkládá POD něj.
  map.addLayer({
    id: RADAR_LAYER, type: 'raster', source: RADAR_SOURCE,
    paint: { 'raster-opacity': 0.75 },
  }, map.getLayer(WARN_FILL) ? WARN_FILL : undefined);

  const label = frameLabel(frame, timeZone, lang);
  $('radar-time').textContent = label.time;
  // Dopočet musí být poznat — jinak by se odhad tvářil jako naměřený stav.
  $('radar-kind').textContent = label.forecast ? t('radar.nowcast', lang) : t('radar.observed', lang);
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

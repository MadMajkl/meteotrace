/**
 * Mapa se srážkovým radarem.
 *
 * ⚠️ Spolu s `app.js` jeden ze dvou souborů, které sahají na DOM. Všechno,
 * co se dá spočítat bez stránky — které snímky existují, který je na řadě,
 * jak zní adresa dlaždice — leží v `lib/radar.js` a je otestované.
 *
 * ⚠️ PODKLADOVÉ DLAŽDIDCE JSOU DOČASNÉ. OpenFreeMap je tu jen do doby, než
 *    budeme mít vlastní Protomaps `.pmtiles` (`R3`). Adresa se skládá jen
 *    tady, takže je to výměna na jednom místě.
 *
 * ⚠️ `tile.openstreetmap.org` je vyloučený natrvalo — jejich pravidla
 *    zakazují použití v mobilní aplikaci. Není to o technologii,
 *    ale o poskytovateli.
 */

'use strict';

import { t } from './lib/i18n.js';
import { radarFrames, tileTemplate, frameIndexAt, nextFrame, frameLabel } from './lib/radar.js';
import { apiGet } from './lib/api.js';

/** DOČASNÝ podkladový styl — nahradí ho vlastní pmtiles (R3). */
const DEV_STYLE = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

const RADAR_SOURCE = 'radar';
const RADAR_LAYER = 'radar';

let map = null;
let frames = [];
let index = 0;
let timer = 0;
let playing = false;
let lang = 'en';
let timeZone = 'UTC';

const $ = (id) => document.getElementById(id);

/** Podklad podle motivu zařízení. Vlastní styl přijde s R3. */
const styleUrl = () =>
  matchMedia('(prefers-color-scheme: dark)').matches ? DEV_STYLE.dark : DEV_STYLE.light;

/**
 * Založí mapu. Volá se až při prvním zobrazení — MapLibre je skoro megabajt
 * a stránka, která radar neotevře, ho nemá proč platit.
 */
export async function showMap({ lat, lon, lang: language, timeZone: tz }) {
  lang = language;
  timeZone = tz || 'UTC';

  if (!map) {
    map = new maplibregl.Map({
      container: $('map'),
      style: styleUrl(),
      center: [lon, lat],
      zoom: 7,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    await new Promise((res) => map.on('load', res));

    new maplibregl.Marker({ color: '#1a7fd4' }).setLngLat([lon, lat]).addTo(map);
    $('radar-play').addEventListener('click', togglePlay);
  } else {
    map.easeTo({ center: [lon, lat], zoom: 7 });
  }

  await loadFrames();
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
  const frame = frames[index];
  const url = tileTemplate(frame);
  if (!url) return;

  if (map.getLayer(RADAR_LAYER)) map.removeLayer(RADAR_LAYER);
  if (map.getSource(RADAR_SOURCE)) map.removeSource(RADAR_SOURCE);

  map.addSource(RADAR_SOURCE, { type: 'raster', tiles: [url], tileSize: 256 });
  map.addLayer({
    id: RADAR_LAYER, type: 'raster', source: RADAR_SOURCE,
    paint: { 'raster-opacity': 0.75 },
  });

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

/**
 * Obrazovka Statistiky (`R35`) — jaké počasí na místě nebo po trase BYLO.
 *
 * ⚠️ NAČÍTÁ SE LÍNĚ, až když ji člověk poprvé otevře (`import()` v app.js).
 * Do startu appky nepatří — proto taky není v seznamu `modulepreload`.
 *
 * Rozdělení práce jako všude jinde:
 * - čísla počítá čistá `lib/stats.js` (má samotest),
 * - data dodává server (`/api/history`, `/api/climate`),
 * - tady zbývá kreslení, texty a jednotky.
 *
 * 🚨 Statistika se dívá na TOTÉŽ místo a TUTÉŽ trasu jako zbytek appky.
 * Vlastní výběr místa tu schválně není: hledání, uložená místa i „Tady"
 * fungují stejně jako na záložce Místo, jen výsledek je minulost místo
 * předpovědi. Dva různé výběry místa v jedné appce by se rozešly.
 */

import { t, tf, tp } from './lib/i18n.js';
import { apiGet, createRequestGroup } from './lib/api.js';
import { formatTemp, formatPrecip, formatWind, SYMBOL } from './lib/units.js';
import { isUsablePoint, placeLabel } from './lib/geo-query.js';
import {
  PERIODS, periodRange, localToday, daysBetween, dayMs,
  summarizeDaily, chartSeries, summarizeYears, yearsInRange,
  roundCoord, KROK_DNY, KROK_ROKY, CELY_ROK_DNI,
} from './lib/stats.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';

/** Vlastní skupina dotazů: přepnutí období zruší rozdělané stahování. */
const requests = createRequestGroup();

/** Co appka statistice půjčí — viz `initStats()`. */
let deps = null;
let mode = 'place';          // 'place' | 'route'
let period = '7';
const custom = { from: '', to: '' };
/** Poslední vykreslená data — kvůli překreslení grafu po změně šířky. */
let posledniGraf = null;

/**
 * Odpovědi, které už jednou přišly. Přepínání mezi obdobími tam a zpátky
 * tak nechodí na síť (a minulost se nemění).
 * @type {Map<string, any>}
 */
const pamet = new Map();
const PAMET_MAX = 40;

/* ============================================================
   FORMÁTOVÁNÍ
   ============================================================ */

const stav = () => deps.getState();

function el(tag, cls, content) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (Array.isArray(content)) node.append(...content);
  else if (content != null) node.textContent = content;
  return node;
}

/** `2026-09-25` → „25. 9." (nebo s rokem). Datum je den, ne okamžik — proto UTC. */
function den(iso, sRokem = false) {
  if (!Number.isFinite(dayMs(iso))) return '';
  return new Intl.DateTimeFormat(stav().lang, {
    day: 'numeric', month: 'numeric', ...(sRokem ? { year: 'numeric' } : {}), timeZone: 'UTC',
  }).format(new Date(dayMs(iso)));
}

const temp = (c, digits = 1) => formatTemp(c, stav().units, stav().lang, digits);
const srazky = (mm) => formatPrecip(mm, stav().units, stav().lang);
const vitr = (kmh) => formatWind(kmh, stav().units, stav().lang);
const dni = (n) => tp('stats.days', n, {}, stav().lang);

/**
 * ROZDÍL teplot („o 1,9 °C tepleji").
 *
 * 🚨 Rozdíl se na Fahrenheity převádí JEN násobením 1,8 — bez +32.
 * `formatTemp` převádí teplotu, takže z oteplení o 2 °C by udělal 35,6 °F.
 */
function rozdilTeplot(deltaC) {
  const s = stav();
  const v = s.units.temp === 'f' ? deltaC * 1.8 : deltaC;
  const cislo = new Intl.NumberFormat(s.lang, {
    minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero',
  }).format(v);
  return `${cislo} ${SYMBOL[s.units.temp]}`;
}

/* ============================================================
   DATA
   ============================================================ */

async function nacti(klic, sluzba, params, signal) {
  if (pamet.has(klic)) return pamet.get(klic);
  const { data } = await apiGet(sluzba, params, { signal });
  if (pamet.size >= PAMET_MAX) pamet.delete(pamet.keys().next().value);
  pamet.set(klic, data);
  return data;
}

/** Denní údaje pro bod a období. */
function dnyPro(bod, rozsah, signal) {
  const lat = roundCoord(bod.lat, KROK_DNY);
  const lon = roundCoord(bod.lon, KROK_DNY);
  return nacti(`d:${lat},${lon}:${rozsah.from}:${rozsah.to}`, 'history',
    { lat, lon, from: rozsah.from, to: rozsah.to }, signal);
}

/** Roční přehled pro bod (celý, od 1940 — výřez se dělá až tady). */
function rokyPro(bod, signal) {
  const lat = roundCoord(bod.lat, KROK_ROKY);
  const lon = roundCoord(bod.lon, KROK_ROKY);
  return nacti(`r:${lat},${lon}`, 'climate', { lat, lon }, signal);
}

/* ============================================================
   OVLÁDÁNÍ
   ============================================================ */

function naplnObdobi() {
  const sel = $('stats-period');
  sel.replaceChildren(...PERIODS.map((k) => {
    const o = el('option', '', t(`stats.periods.${k}`, stav().lang));
    o.value = k;
    return o;
  }));
  sel.value = period;
}

function vypisStav(text) {
  const s = $('stats-status');
  s.textContent = text || '';
  s.hidden = !text;
}

function schovejVysledky() {
  for (const id of ['stats-summary-card', 'stats-chart-card', 'stats-route-card']) $(id).hidden = true;
}

/** Bunka mřížky: popis, hodnota a pod ní menší doplněk (datum, počet dní). */
function bunka(popis, hodnota, doplnek) {
  const dd = el('dd', '', hodnota);
  if (doplnek) dd.append(el('span', 'dir', doplnek));
  return el('div', '', [el('dt', '', popis), dd]);
}

/* ============================================================
   MÍSTO — souhrn po dnech
   ============================================================ */

function vykresliSouhrn(s) {
  const L = stav().lang;
  const bunky = [
    bunka(t('stats.tempMean', L), temp(s.tempMean)),
    s.tempMax && bunka(t('stats.tempMax', L), temp(s.tempMax.value), den(s.tempMax.date)),
    s.tempMin && bunka(t('stats.tempMin', L), temp(s.tempMin.value), den(s.tempMin.date)),
    bunka(t('stats.precip', L), srazky(s.precipSum), tp('stats.rainDays', s.rainDays, {}, L)),
    s.wettestDay && s.wettestDay.value > 0
      && bunka(t('stats.wettest', L), srazky(s.wettestDay.value), den(s.wettestDay.date)),
    s.dryStreak.days > 0 && bunka(t('stats.dryStreak', L), dni(s.dryStreak.days),
      s.dryStreak.days > 1 ? `${den(s.dryStreak.from)} – ${den(s.dryStreak.to)}` : den(s.dryStreak.from)),
    s.wetStreak.days > 1 && bunka(t('stats.wetStreak', L), dni(s.wetStreak.days),
      `${den(s.wetStreak.from)} – ${den(s.wetStreak.to)}`),
    s.cloudMean !== null && bunka(t('stats.cloud', L),
      `${new Intl.NumberFormat(L, { maximumFractionDigits: 0 }).format(s.cloudMean)} %`,
      tp('stats.clearDays', s.clearDays, {}, L)),
    s.gustMax && bunka(t('stats.gust', L), vitr(s.gustMax.value), den(s.gustMax.date)),
    s.windDir && bunka(t('stats.wind', L), t(`windDirLong.${s.windDir.key}`, L),
      tf('stats.windShare', { days: s.windDir.days, total: s.daysWithData }, L)),
    // ⚠️ Nulové počty se neukazují: v červenci by „mrazové dny: 0" jen zabíralo místo.
    s.tropicalDays > 0 && bunka(t('stats.tropical', L), dni(s.tropicalDays),
      tf('stats.tropicalNote', { temp: temp(30, 0) }, L)),
    s.frostDays > 0 && bunka(t('stats.frost', L), dni(s.frostDays), t('stats.frostNote', L)),
    s.snowDays > 0 && bunka(t('stats.snow', L), dni(s.snowDays)),
  ].filter(Boolean);
  $('stats-cells').replaceChildren(...bunky);
  $('stats-summary-title').textContent = t('stats.summary', L);
  $('stats-summary-card').hidden = false;
}

function vykresliRoky(roky) {
  const L = stav().lang;
  const s = summarizeYears(roky);
  if (!s) return false;
  const rok = (r, co) => (co === 'temp' ? temp(r.tempMean) : srazky(r.precipSum));
  const bunky = [
    bunka(tf('stats.yearsMean', { from: s.from, to: s.to }, L), temp(s.tempMean)),
    s.change !== null && bunka(t('stats.change', L), rozdilTeplot(s.change),
      tf('stats.changeNote', { from: s.changeYears.from, to: s.changeYears.to }, L)),
    bunka(t('stats.warmestYear', L), String(s.warmest.year), rok(s.warmest, 'temp')),
    bunka(t('stats.coldestYear', L), String(s.coldest.year), rok(s.coldest, 'temp')),
    bunka(t('stats.wettestYear', L), String(s.wettest.year), rok(s.wettest, 'precip')),
    bunka(t('stats.driestYear', L), String(s.driest.year), rok(s.driest, 'precip')),
  ].filter(Boolean);
  $('stats-cells').replaceChildren(...bunky);
  $('stats-summary-title').textContent = t('stats.years', L);
  $('stats-summary-card').hidden = false;

  // Necelý rok na kraji (typicky letošek) se do rekordů nepočítá — a řekne se to.
  const necely = roky.find((r) => r.days < CELY_ROK_DNI && r.days > 0);
  const pozn = $('stats-summary-note');
  pozn.textContent = necely ? tf('stats.partialYear', { year: necely.year }, L) : '';
  pozn.hidden = !necely;
  return true;
}

/* ============================================================
   GRAF (SVG v pixelech podle skutečné šířky)
   ============================================================ */

/**
 * @param {{labels: string[], hi: (number|null)[], lo: (number|null)[]|null, bars: number[], note: string}} g
 *   `hi`/`lo` jsou teploty ve °C (převod na jednotky až při popiscích),
 *   `bars` srážky v mm. `lo: null` = jedna čára (roční průměr).
 */
function nakresliGraf(g) {
  posledniGraf = g;
  const box = $('stats-chart');
  const W = Math.max(260, Math.round(box.clientWidth || 320));
  const H = 210;
  const L = 44;                 // místo na popisky teplot vlevo („−11 °C", „102 °F")
  const R = 8;
  const T = 10;
  const Y_TEPLOTY = 128;        // spodní hrana pásu teplot
  const Y_SRAZKY_OD = 146;
  const Y_SRAZKY_DO = 186;      // spodní hrana sloupců srážek
  const n = g.labels.length;

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('stats.chartAria', stav().lang));
  const prvek = (tag, attrs, text) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text != null) e.textContent = text;
    svg.append(e);
    return e;
  };

  const cisla = [...g.hi, ...(g.lo || [])].filter((v) => v != null && Number.isFinite(v));
  if (!cisla.length || !n) { box.replaceChildren(); return; }
  let min = Math.min(...cisla);
  let max = Math.max(...cisla);
  if (max - min < 4) { min -= 2; max += 2; }   // rovná čára by splynula s okrajem
  const sirka = W - L - R;
  const x = (i) => (n === 1 ? L + sirka / 2 : L + (sirka * i) / (n - 1));
  const y = (v) => T + ((max - v) / (max - min)) * (Y_TEPLOTY - T);

  // Vodorovné linky s popisky teplot (v jednotkách uživatele).
  for (const v of [max, (max + min) / 2, min]) {
    prvek('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'stats-mrizka' });
    prvek('text', { x: L - 6, y: y(v) + 4, class: 'stats-popisek', 'text-anchor': 'end' },
      temp(v, 0));
  }

  // Pás mezi nejvyšší a nejnižší teplotou + obě čáry. Díra v datech čáru přeruší.
  const cesta = (hodnoty) => {
    let d = '';
    let pero = false;
    hodnoty.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { pero = false; return; }
      d += `${pero ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pero = true;
    });
    return d;
  };
  if (g.lo) {
    const plne = g.hi.map((v, i) => (v != null && g.lo[i] != null ? i : -1)).filter((i) => i >= 0);
    if (plne.length > 1) {
      const nahore = plne.map((i) => `${x(i).toFixed(1)} ${y(g.hi[i]).toFixed(1)}`);
      const dole = plne.reverse().map((i) => `${x(i).toFixed(1)} ${y(g.lo[i]).toFixed(1)}`);
      prvek('path', { d: `M${nahore.join('L')}L${dole.join('L')}Z`, class: 'stats-pas' });
    }
    prvek('path', { d: cesta(g.lo), class: 'stats-cara stats-cara-min' });
  }
  prvek('path', { d: cesta(g.hi), class: 'stats-cara stats-cara-max' });
  // Jediný bod (nebo bod mezi dvěma dírami) by čára neukázala — tečky ano.
  if (n <= 45) {
    g.hi.forEach((v, i) => { if (v != null) prvek('circle', { cx: x(i), cy: y(v), r: 2.2, class: 'stats-bod stats-bod-max' }); });
    if (g.lo) g.lo.forEach((v, i) => { if (v != null) prvek('circle', { cx: x(i), cy: y(v), r: 2.2, class: 'stats-bod stats-bod-min' }); });
  }

  // Srážky: sloupce ve vlastním pásu dole, měřítko podle nejvyššího.
  const maxSrazky = Math.max(0, ...g.bars.filter((v) => Number.isFinite(v)));
  const sloupec = Math.max(1.5, Math.min(14, (sirka / Math.max(n, 1)) * 0.62));
  prvek('line', { x1: L, x2: W - R, y1: Y_SRAZKY_DO, y2: Y_SRAZKY_DO, class: 'stats-mrizka' });
  if (maxSrazky > 0) {
    g.bars.forEach((v, i) => {
      if (!Number.isFinite(v) || v <= 0) return;
      const h = Math.max(1, (v / maxSrazky) * (Y_SRAZKY_DO - Y_SRAZKY_OD));
      prvek('rect', {
        x: (x(i) - sloupec / 2).toFixed(1), y: (Y_SRAZKY_DO - h).toFixed(1),
        width: sloupec.toFixed(1), height: h.toFixed(1), rx: 1, class: 'stats-srazky',
      });
    });
    // ⚠️ Popisek srážek sedí NAD sloupci uvnitř grafu, ne vlevo na ose:
    // „978,0 mm" je delší než místo na popisky teplot a vlevo se usekl.
    prvek('text', { x: L, y: Y_SRAZKY_OD - 5, class: 'stats-popisek', 'text-anchor': 'start' },
      srazky(maxSrazky));
  }

  // Popisky osy: první, prostřední, poslední — víc by se na telefon nevešlo.
  const kde = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];
  kde.forEach((i, poradi) => {
    const kotva = kde.length === 1 ? 'middle' : poradi === 0 ? 'start' : poradi === kde.length - 1 ? 'end' : 'middle';
    prvek('text', { x: x(i), y: H - 6, class: 'stats-popisek', 'text-anchor': kotva }, g.labels[i]);
  });

  box.replaceChildren(svg);
  $('stats-chart-note').textContent = g.note;
  $('stats-chart-card').hidden = false;
}

function grafZeDnu(daily) {
  const L = stav().lang;
  const { step, points } = chartSeries(daily);
  const roky = new Set(points.map((p) => p.from.slice(0, 4))).size > 1;
  const popisek = (p) => {
    if (step === 'month') {
      return new Intl.DateTimeFormat(L, { month: 'short', ...(roky ? { year: '2-digit' } : {}), timeZone: 'UTC' })
        .format(new Date(dayMs(p.from)));
    }
    return den(p.from);
  };
  nakresliGraf({
    labels: points.map(popisek),
    hi: points.map((p) => p.tMax),
    lo: points.map((p) => p.tMin),
    bars: points.map((p) => p.precip),
    note: `${t('stats.chartLegend', L)} ${t(`stats.chartStep.${step}`, L)}`,
  });
}

function grafZRoku(roky) {
  const L = stav().lang;
  // Necelé roky do grafu nepatří: půlrok má úplně jiný průměr i úhrn.
  const cele = roky.filter((r) => r.days >= CELY_ROK_DNI);
  nakresliGraf({
    labels: cele.map((r) => String(r.year)),
    hi: cele.map((r) => r.tempMean),
    lo: null,
    bars: cele.map((r) => r.precipSum),
    note: t('stats.chartLegendYears', L),
  });
}

/* ============================================================
   KDE JSEM BYL
   ============================================================ */

function vykresliNavstevy() {
  const L = stav().lang;
  const karta = $('stats-visited-card');
  const navstevy = (stav().visits || []).slice(0, 14);
  karta.hidden = mode !== 'place' || !navstevy.length;
  if (karta.hidden) return;
  $('stats-visited').replaceChildren(...navstevy.map((z) => {
    const jmeno = z.n || t('stats.visitedUnnamed', L);
    const b = el('button', 'chip', `${den(z.d)} · ${jmeno}`);
    b.type = 'button';
    const tady = stav().place;
    if (tady && Math.abs(tady.lat - z.lat) < 0.005 && Math.abs(tady.lon - z.lon) < 0.005) {
      b.setAttribute('aria-current', 'true');
    }
    b.addEventListener('click', () => deps.selectPlace({ name: jmeno, lat: z.lat, lon: z.lon }));
    return el('li', '', [b]);
  }));
}

/* ============================================================
   TRASA — start, zastávky, cíl
   ============================================================ */

function bodyTrasy() {
  const L = stav().lang;
  const r = stav().route || {};
  if (!isUsablePoint(r.from) || !isUsablePoint(r.to)) return null;
  const mezi = (r.via || []).filter(isUsablePoint);
  return [
    { role: t('stats.routeStart', L), misto: r.from },
    ...mezi.map((m, i) => ({ role: tf('stats.routeVia', { n: i + 1 }, L), misto: m })),
    { role: t('stats.routeEnd', L), misto: r.to },
  ];
}

function radekTrasy(bod, hodnoty) {
  const L = stav().lang;
  const b = el('button', 'stats-bod-trasy', [
    el('span', 'stats-bod-role', bod.role),
    el('strong', 'stats-bod-jmeno', placeLabel(bod.misto, L)),
    el('span', 'stats-bod-hodnoty', hodnoty.join(' · ')),
  ]);
  b.type = 'button';
  // Klepnutí = podrobnosti pro tenhle bod: přepne na Místo, stejné období.
  b.addEventListener('click', () => { mode = 'place'; deps.selectPlace(bod.misto); });
  return el('li', '', [b]);
}

/* ============================================================
   HLAVNÍ TAH
   ============================================================ */

/** Překreslí obrazovku podle místa/trasy, režimu a období. */
export async function refreshStats() {
  if (!deps) return;
  const L = stav().lang;
  $('stats-mode-place').setAttribute('aria-pressed', String(mode === 'place'));
  $('stats-mode-route').setAttribute('aria-pressed', String(mode === 'route'));
  $('stats-custom').hidden = period !== 'custom';
  $('stats-summary-note').hidden = true;
  vykresliNavstevy();
  // Sbalený řádek hlavičky říká „Statistiky · Praha" nebo „… · Praha → Brno".
  deps.onChange?.();

  // Na co se díváme.
  const misto = stav().place;
  const body = mode === 'route' ? bodyTrasy() : null;
  if (mode === 'place') {
    $('stats-title').textContent = misto?.name || t('nav.stats', L);
    if (!isUsablePoint(misto)) { schovejVysledky(); $('stats-range').textContent = ''; vypisStav(t('stats.noPlace', L)); return; }
  } else {
    const r = stav().route || {};
    $('stats-title').textContent = body
      ? `${placeLabel(r.from, L)} → ${placeLabel(r.to, L)}` : t('nav.route', L);
    if (!body) { schovejVysledky(); $('stats-range').textContent = ''; vypisStav(t('stats.noRoute', L)); return; }
  }

  // Za jaké období.
  const rozsah = periodRange(period, localToday(Date.now()), custom);
  if (rozsah.empty) {
    schovejVysledky();
    $('stats-range').textContent = '';
    vypisStav(t(period === 'custom' ? 'stats.pickRange' : 'stats.empty', L));
    return;
  }
  $('stats-range').textContent = rozsah.years
    ? tf('stats.rangeYears', { from: rozsah.from.slice(0, 4), to: rozsah.to.slice(0, 4) }, L)
    : `${den(rozsah.from, true)} – ${den(rozsah.to, true)} · ${dni(daysBetween(rozsah.from, rozsah.to))}`;

  vypisStav(t('stats.loading', L));
  try {
    await requests.run('stats', async (signal) => {
      if (mode === 'place') {
        if (rozsah.years) {
          const data = await rokyPro(misto, signal);
          if (signal.aborted) return;
          const roky = yearsInRange(data.years, rozsah.from, rozsah.to);
          $('stats-route-card').hidden = true;
          if (!vykresliRoky(roky)) { schovejVysledky(); vypisStav(t('stats.empty', L)); return; }
          grafZRoku(roky);
        } else {
          const data = await dnyPro(misto, rozsah, signal);
          if (signal.aborted) return;
          const s = summarizeDaily(data.daily);
          $('stats-route-card').hidden = true;
          if (!s) { schovejVysledky(); vypisStav(t('stats.empty', L)); return; }
          vykresliSouhrn(s);
          grafZeDnu(data.daily);
        }
      } else {
        // Trasa: každý bod zvlášť, všechny naráz.
        const vysledky = await Promise.all(body.map(async (b) => {
          if (rozsah.years) {
            const data = await rokyPro(b.misto, signal);
            const s = summarizeYears(yearsInRange(data.years, rozsah.from, rozsah.to));
            return s ? [temp(s.tempMean), s.change !== null ? rozdilTeplot(s.change) : '',
              tf('stats.warmestShort', { year: s.warmest.year }, L)].filter(Boolean) : null;
          }
          const data = await dnyPro(b.misto, rozsah, signal);
          const s = summarizeDaily(data.daily);
          return s ? [
            temp(s.tempMean),
            `${temp(s.tempMin?.value, 0)} – ${temp(s.tempMax?.value, 0)}`,
            srazky(s.precipSum),
            tp('stats.rainDays', s.rainDays, {}, L),
          ] : null;
        }));
        if (signal.aborted) return;
        $('stats-summary-card').hidden = true;
        $('stats-chart-card').hidden = true;
        $('stats-route-points').replaceChildren(...body.map((b, i) => radekTrasy(b,
          vysledky[i] || [t('stats.empty', L)])));
        $('stats-route-card').hidden = false;
      }
      vypisStav('');
    });
  } catch (e) {
    if (requests.isAbort(e)) return;
    schovejVysledky();
    // ⚠️ Vyčerpaný příděl u zdroje není „nepodařilo se" — říká, kdy to zkusit.
    vypisStav(t(e?.status === 429 ? 'error.tooMany' : 'stats.failed', L));
  }
}

/** Na co se statistika dívá — kvůli sbalenému řádku hlavičky. */
export function statsMode() {
  return mode;
}

/** Přepne, na co se statistika dívá. */
export function setStatsMode(m) {
  mode = m === 'route' ? 'route' : 'place';
  return refreshStats();
}

/** Po změně jazyka: nabídka období má texty v jazyce appky. */
export function relabelStats() {
  if (!deps) return;
  naplnObdobi();
  return refreshStats();
}

/**
 * Zapojí ovládání. Volá se jednou, při prvním otevření obrazovky.
 *
 * @param {object} d
 * @param {() => {lang: string, units: object, place: object|null, route: object, visits: Array}} d.getState
 * @param {(place: object) => void} d.selectPlace  vybere místo stejnou cestou jako hledání
 * @param {() => void} [d.onChange]  po každém překreslení (hlavička si přepíše kontext)
 */
export function initStats(d) {
  if (deps) return;
  deps = d;
  naplnObdobi();

  $('stats-period').addEventListener('change', (e) => { period = e.target.value; refreshStats(); });
  $('stats-mode-place').addEventListener('click', () => setStatsMode('place'));
  $('stats-mode-route').addEventListener('click', () => setStatsMode('route'));
  for (const [id, klic] of [['stats-from', 'from'], ['stats-to', 'to']]) {
    $(id).addEventListener('change', (e) => { custom[klic] = e.target.value; refreshStats(); });
  }

  // Graf se kreslí v pixelech podle šířky karty — po otočení telefonu znovu.
  let casovac = 0;
  new ResizeObserver(() => {
    clearTimeout(casovac);
    casovac = setTimeout(() => { if (posledniGraf && !$('stats-chart-card').hidden) nakresliGraf(posledniGraf); }, 120);
  }).observe($('stats-chart'));
}


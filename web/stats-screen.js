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
import { formatTemp, formatPrecip, formatWind, formatPressure, SYMBOL } from './lib/units.js';
import { isUsablePoint, placeLabel } from './lib/geo-query.js';
import {
  PERIODS, periodRange, localToday, daysBetween, dayMs, addDays, hourIso,
  summarizeDaily, chartSeries, summarizeYears, yearsInRange, availableQuantities,
  summarizeHourly, hourlySeries, availableHourQuantities,
  roundCoord, KROK_DNY, KROK_ROKY, CELY_ROK_DNI, VELICINY, VELICINY_ROKY,
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
/**
 * Co ukazuje graf a body trasy — jedna z `VELICINY`.
 * ⚠️ Je to PŘÁNÍ, ne nutně to, co se kreslí: „Od začátku" zná jen
 * teplotu a srážky. Vlhkost tam ukázat nejde, ale po návratu na kratší
 * období se má vrátit — proto se volba nepřepisuje, jen obchází.
 */
let velicina = 'temp';
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

/**
 * `2026-10-07T15:00` → „út 15:00"; s `datum: 'den'` „út 7. 10. 15:00",
 * s `datum: 'rok'` „út 7. 10. 2026 15:00".
 *
 * ⚠️ Čas je místní čas MÍSTA, jak ho poslal zdroj (`timezone=auto`) —
 * proto se formátuje v UTC, ne v pásmu telefonu. Kdo se z Prahy dívá
 * na New York, má vidět newyorské hodiny, ne o šest posunuté.
 */
function hodina(iso, datum = '') {
  const ms = Date.parse(`${iso}:00Z`);
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat(stav().lang, {
    weekday: 'short',
    ...(datum ? { day: 'numeric', month: 'numeric' } : {}),
    ...(datum === 'rok' ? { year: 'numeric' } : {}),
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  }).format(new Date(ms));
}

const temp = (c, digits = 1) => formatTemp(c, stav().units, stav().lang, digits);
const srazky = (mm) => formatPrecip(mm, stav().units, stav().lang);
const vitr = (kmh) => formatWind(kmh, stav().units, stav().lang);
const tlak = (hpa) => formatPressure(hpa, stav().units, stav().lang);
const dni = (n) => tp('stats.days', n, {}, stav().lang);

/** Procenta (vlhkost, oblačnost). Prázdno je pomlčka, ne nula. */
function pct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${new Intl.NumberFormat(stav().lang, { maximumFractionDigits: 0 }).format(v)} %`;
}

/**
 * Srážky na ose grafu: od deseti nahoru bez desetin. „978,0 mm" je
 * delší než místo na popisky a desetina u horní linky nic neříká.
 */
function srazkyOsa(mm) {
  const s = stav();
  const palce = s.units.precip === 'in';
  const v = palce ? mm / 25.4 : mm;
  // Palce jsou malá čísla: „0,35 in" by na jedno místo bylo „0,4".
  const digits = v >= 10 ? 0 : palce && v < 1 ? 2 : 1;
  return `${new Intl.NumberFormat(s.lang, { maximumFractionDigits: digits }).format(v)} ${SYMBOL[s.units.precip]}`;
}

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

/**
 * Změna tlaku se znaménkem („+6 hPa", „−0,12 inHg").
 * Převod tlaku je jen násobení, takže rozdíl jde přes `formatPressure`
 * (na rozdíl od teploty, viz `rozdilTeplot`). Zaokrouhlená nula je bez
 * znaménka — „+0 hPa" by tvrdilo směr, který tam není.
 */
function rozdilTlaku(dHpa) {
  const text = tlak(Math.abs(dHpa));
  if (/^0([.,]0+)?\s/.test(text)) return text;
  return `${dHpa > 0 ? '+' : '−'}${text}`;
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

/**
 * Posledních 48 hodin pro bod.
 *
 * ⚠️ Klíč paměti nese právě běžící hodinu: „posledních 48" je za hodinu
 * jiných 48. Minulost se nemění, tohle ano.
 */
function hodinyPro(bod, signal) {
  const lat = roundCoord(bod.lat, KROK_DNY);
  const lon = roundCoord(bod.lon, KROK_DNY);
  return nacti(`h:${lat},${lon}:${hourIso(Date.now())}`, 'recent', { lat, lon }, signal);
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
   PŘEPÍNAČ VELIČIN
   ============================================================ */

/** Co se doopravdy kreslí: přání, když jde, jinak první dostupná veličina. */
const ucinna = (dostupne) => (dostupne.includes(velicina) ? velicina : dostupne[0] || 'temp');

/**
 * Řada tlačítek nad grafem (a nad body trasy).
 *
 * ⚠️ Tlačítka se při přepnutí NEZAKLÁDAJÍ ZNOVU, jen přepnou `aria-pressed`.
 * Řada se dá posunout prstem do strany — nová tlačítka by ji vrátila
 * na začátek a „Tlak" by člověku po klepnutí ujel z prstu.
 */
function vykresliVolbu(id, dostupne) {
  const box = $(id);
  const L = stav().lang;
  const zapnuta = ucinna(dostupne);
  const stejne = box.children.length === dostupne.length
    && [...box.children].every((b, i) => b.dataset.velicina === dostupne[i]);
  if (!stejne) {
    box.replaceChildren(...dostupne.map((v) => {
      const b = el('button', 'dep-mode', t(`stats.q.${v}`, L));
      b.type = 'button';
      b.dataset.velicina = v;
      return b;
    }));
  }
  for (const b of box.children) {
    b.textContent = t(`stats.q.${b.dataset.velicina}`, L);
    b.setAttribute('aria-pressed', String(b.dataset.velicina === zapnuta));
  }
  // Jedna volba není volba.
  box.hidden = dostupne.length < 2;
  srovnejKraj(box);
}

/** Vybledlý pravý kraj řady, dokud je vpravo ještě co posunout. */
function srovnejKraj(box) {
  box.toggleAttribute('data-vic', box.scrollLeft + box.clientWidth < box.scrollWidth - 2);
}

/**
 * Jak se která veličina kreslí.
 *
 * - `cary`: jedna nebo dvě čáry — `[klíč bodu, role, jméno]`; role
 *   `horni`/`dolni` (dvojice, mezi nimi pás) nebo `jedna`,
 * - `sloupce`: místo čar sloupce od nuly — `[klíč bodu, jméno]`,
 * - `osa`: `auto` (podle dat), `nula` (od nuly — rychlost, úhrn),
 *   `procenta` (0–100 napevno, ať 60 % vlhkosti nevypadá jako sucho),
 * - `fmt` hodnota do bubliny, `fmtOsa` popisek osy,
 * - `minRozpeti`: nejmenší výška osy v jednotkách zdroje — rovná čára
 *   by jinak splynula s okrajem a malý výkyv by vypadal jako velký.
 *
 * @param {string} v
 * @param {'dny'|'roky'|'hodiny'} [druh]  po hodinách je teplota (i pocitová)
 *   JEDNA čára — hodina nemá nejvyšší a nejnižší; zbytek je stejný jako u dnů
 */
function popisVeliciny(v, druh = 'dny') {
  const L = stav().lang;
  const jm = (k) => t(`stats.series.${k}`, L);
  const teplota = { fmt: (x) => temp(x), fmtOsa: (x) => temp(x, 0), osa: 'auto', minRozpeti: 4 };
  if (druh === 'roky') {
    return v === 'precip'
      ? { sloupce: ['precip', jm('yearPrecip')], osa: 'nula', fmt: srazky, fmtOsa: srazkyOsa }
      : { ...teplota, cary: [['mean', 'jedna', jm('yearMean')]], minRozpeti: 2 };
  }
  if (druh === 'hodiny' && v === 'temp') return { ...teplota, cary: [['t', 'jedna', jm('temp')]] };
  if (druh === 'hodiny' && v === 'feels') return { ...teplota, cary: [['f', 'jedna', jm('feels')]] };
  switch (v) {
    case 'feels':
      return { ...teplota, cary: [['fMax', 'horni', jm('max')], ['fMin', 'dolni', jm('min')]] };
    case 'precip':
      return { sloupce: ['precip', jm('precip')], osa: 'nula', fmt: srazky, fmtOsa: srazkyOsa };
    case 'wind':
      return {
        cary: [['gust', 'horni', jm('gust')], ['wind', 'dolni', jm('wind')]],
        osa: 'nula', fmt: vitr, fmtOsa: vitr, smer: true,
      };
    case 'humidity':
      return { cary: [['humidity', 'jedna', jm('humidity')]], osa: 'procenta', fmt: pct, fmtOsa: pct };
    case 'cloud':
      return { cary: [['cloud', 'jedna', jm('cloud')]], osa: 'procenta', fmt: pct, fmtOsa: pct };
    case 'pressure':
      return { cary: [['pressure', 'jedna', jm('pressure')]], osa: 'auto', fmt: tlak, fmtOsa: tlak, minRozpeti: 8 };
    default:
      return { ...teplota, cary: [['tMax', 'horni', jm('max')], ['tMin', 'dolni', jm('min')]] };
  }
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
    s.cloudMean !== null && bunka(t('stats.cloud', L), pct(s.cloudMean),
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

/**
 * Souhrn posledních 48 hodin. U extrémů je čas, ne datum, a místo dnů
 * se počítají hodiny. Navíc tlak teď a kam se hnul — za dva dny je to
 * zpráva (u měsíce ne).
 */
function vykresliSouhrnHodin(s) {
  const L = stav().lang;
  const hodin = (n) => tp('stats.hours', n, {}, L);
  const bunky = [
    bunka(t('stats.tempMean', L), temp(s.tempMean)),
    s.tempMax && bunka(t('stats.tempMax', L), temp(s.tempMax.value), hodina(s.tempMax.date)),
    s.tempMin && bunka(t('stats.tempMin', L), temp(s.tempMin.value), hodina(s.tempMin.date)),
    s.precipSum !== null && bunka(t('stats.precip', L), srazky(s.precipSum), tp('stats.rainHours', s.rainHours, {}, L)),
    s.wettestHour && s.wettestHour.value > 0
      && bunka(t('stats.wettestHour', L), srazky(s.wettestHour.value), hodina(s.wettestHour.date)),
    s.snowHours > 0 && bunka(t('stats.snowHours', L), hodin(s.snowHours)),
    s.cloudMean !== null && bunka(t('stats.cloud', L), pct(s.cloudMean)),
    s.gustMax && bunka(t('stats.gust', L), vitr(s.gustMax.value), hodina(s.gustMax.date)),
    s.windDir && bunka(t('stats.wind', L), t(`windDirLong.${s.windDir.key}`, L),
      tf('stats.windShareHours', { hours: s.windDir.hours, total: s.hoursWithData }, L)),
    s.pressureNow && bunka(t('stats.pressureNow', L), tlak(s.pressureNow.value),
      s.pressureChange && tf('stats.pressureChange', {
        value: rozdilTlaku(s.pressureChange.value), hours: s.pressureChange.hours,
      }, L)),
  ].filter(Boolean);
  $('stats-cells').replaceChildren(...bunky);
  $('stats-summary-title').textContent = t('stats.summary', L);
  $('stats-summary-card').hidden = false;
  // 🚨 Jiný zdroj než u dnů — a řekne se to, jinak by rozdíl proti
  // „7 dní" vypadal jako chyba (viz `HODIN` v lib/stats.js).
  const pozn = $('stats-summary-note');
  pozn.textContent = t('stats.hourlyNote', L);
  pozn.hidden = false;
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

const jeCislo = (v) => v != null && Number.isFinite(v);

/** Šířka popisku osy — kvůli místu vlevo (tlak „1 031 hPa" je delší než „−5 °C"). */
let merak = null;
function sirkaPopisku(text) {
  merak ??= document.createElement('canvas').getContext('2d');
  if (!merak) return text.length * 6.5;
  merak.font = `11px ${getComputedStyle(document.body).fontFamily}`;
  return merak.measureText(text).width;
}

/**
 * Geometrie posledního grafu: kam padá který bod. Z ní žije zaměřovač
 * i bublina — graf se kreslí znovu po změně šířky a výběr se musí trefit.
 */
let geo = null;
/** Index vybraného bodu (klepnutí, tažení, šipky), nebo `null`. */
let vybrany = null;

/**
 * @param {object} g
 * @param {string} g.klic     totožnost dat (místo + období): dokud se nezmění,
 *   výběr bodu přežije přepnutí veličiny i překreslení po otočení telefonu
 * @param {Array<object>} g.body   body z `chartSeries` (nebo roky)
 * @param {'day'|'week'|'month'|'year'} g.krok
 * @param {string[]} g.labels  popisky vodorovné osy
 * @param {object} g.popis     z `popisVeliciny()`
 * @param {string} g.nazev     jméno veličiny (do popisu pro čtečku)
 * @param {string} g.note      věta pod grafem
 */
function nakresliGraf(g) {
  const stejnaData = posledniGraf?.klic === g.klic;
  posledniGraf = g;
  if (!stejnaData) vybrany = null;
  const karta = $('stats-chart-card');
  karta.hidden = false;

  const box = $('stats-chart');
  const W = Math.max(260, Math.round(box.clientWidth || 320));
  const H = 196;
  const R = 8;
  const T = 10;
  const B = 166;                // spodní hrana plochy grafu
  const { body, popis } = g;
  const n = body.length;

  const klice = popis.sloupce ? [popis.sloupce[0]] : popis.cary.map((c) => c[0]);
  const cisla = body.flatMap((p) => klice.map((k) => p[k])).filter(jeCislo);
  if (!cisla.length || !n) {
    geo = null;
    box.replaceChildren();
    $('stats-chart-note').replaceChildren(t('stats.empty', stav().lang));
    return;
  }

  // Rozsah osy podle druhu veličiny (viz `popisVeliciny`).
  let min;
  let max;
  if (popis.osa === 'procenta') {
    min = 0; max = 100;
  } else if (popis.osa === 'nula') {
    min = 0;
    max = Math.max(...cisla);
    if (max <= 0) max = 1;     // samé nuly: plochá čára na dně, ne dělení nulou
  } else {
    min = Math.min(...cisla);
    max = Math.max(...cisla);
    const r = popis.minRozpeti || 4;
    if (max - min < r) { const st = (max + min) / 2; min = st - r / 2; max = st + r / 2; }
  }

  const urovne = [max, (max + min) / 2, min];
  const popiskyOsy = urovne.map(popis.fmtOsa);
  const L = Math.ceil(Math.max(...popiskyOsy.map(sirkaPopisku))) + 12;
  const sirka = W - L - R;
  // Sloupce sedí uprostřed svých přihrádek (krajní by jinak vylezl do
  // popisků osy); čáry sahají od kraje ke kraji.
  const x = popis.sloupce
    ? (i) => L + (sirka * (i + 0.5)) / n
    : (i) => (n === 1 ? L + sirka / 2 : L + (sirka * i) / (n - 1));
  const y = (v) => T + ((max - v) / (max - min)) * (B - T);

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('aria-hidden', 'true');
  const prvek = (tag, attrs, text, rodic = svg) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text != null) e.textContent = text;
    rodic.append(e);
    return e;
  };

  // Vodorovné linky s popisky (v jednotkách uživatele).
  urovne.forEach((v, i) => {
    prvek('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'stats-mrizka' });
    prvek('text', { x: L - 6, y: y(v) + 4, class: 'stats-popisek', 'text-anchor': 'end' }, popiskyOsy[i]);
  });

  /** Sloupce podle indexu — kvůli zvýraznění vybraného. */
  const sloupce = [];
  if (popis.sloupce) {
    const [k] = popis.sloupce;
    const sirkaSloupce = Math.max(1.5, Math.min(14, (sirka / n) * 0.62));
    body.forEach((p, i) => {
      const v = p[k];
      if (!jeCislo(v) || v <= 0) return;
      const h = Math.max(1, y(0) - y(v));
      sloupce[i] = prvek('rect', {
        x: (x(i) - sirkaSloupce / 2).toFixed(1), y: (y(0) - h).toFixed(1),
        width: sirkaSloupce.toFixed(1), height: h.toFixed(1), rx: 1, class: 'stats-srazky',
      });
    });
  } else {
    // Čáry; díra v datech čáru přeruší.
    const cesta = (k) => {
      let d = '';
      let pero = false;
      body.forEach((p, i) => {
        const v = p[k];
        if (!jeCislo(v)) { pero = false; return; }
        d += `${pero ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
        pero = true;
      });
      return d;
    };
    if (popis.cary.length === 2) {
      // Pás mezi horní a dolní čárou.
      const [[kh], [kd]] = popis.cary;
      const plne = body.map((p, i) => (jeCislo(p[kh]) && jeCislo(p[kd]) ? i : -1)).filter((i) => i >= 0);
      if (plne.length > 1) {
        const nahore = plne.map((i) => `${x(i).toFixed(1)} ${y(body[i][kh]).toFixed(1)}`);
        const dole = [...plne].reverse().map((i) => `${x(i).toFixed(1)} ${y(body[i][kd]).toFixed(1)}`);
        prvek('path', { d: `M${nahore.join('L')}L${dole.join('L')}Z`, class: 'stats-pas' });
      }
    }
    // Dolní čára první, ať horní (teplá) leží navrch.
    for (const [k, role] of [...popis.cary].reverse()) {
      prvek('path', { d: cesta(k), class: `stats-cara stats-cara-${role}` });
    }
    // Jediný bod (nebo bod mezi dvěma dírami) by čára neukázala — tečky ano.
    if (n <= 45) {
      for (const [k, role] of popis.cary) {
        body.forEach((p, i) => {
          if (jeCislo(p[k])) prvek('circle', { cx: x(i), cy: y(p[k]), r: 2.2, class: `stats-bod stats-bod-${role}` });
        });
      }
    }
  }
  // Popisky osy: první, prostřední, poslední — víc by se na telefon nevešlo.
  const kde = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];
  kde.forEach((i, poradi) => {
    const kotva = kde.length === 1 ? 'middle' : poradi === 0 ? 'start' : poradi === kde.length - 1 ? 'end' : 'middle';
    const xi = popis.sloupce && kde.length > 1 ? (poradi === 0 ? L : poradi === kde.length - 1 ? W - R : x(i)) : x(i);
    prvek('text', { x: xi, y: H - 6, class: 'stats-popisek', 'text-anchor': kotva }, g.labels[i]);
  });

  // Zaměřovač a zvýraznění vybraného bodu — kreslí je `ukazBod()`.
  const zamer = prvek('line', { x1: 0, x2: 0, y1: T, y2: B, class: 'stats-zamer', visibility: 'hidden' });
  const zvyrazneni = prvek('g', {});

  const tip = el('div', 'stats-tip');
  tip.hidden = true;
  tip.setAttribute('role', 'status');
  tip.setAttribute('aria-live', 'polite');

  box.replaceChildren(svg, tip);
  box.setAttribute('aria-label', tf(g.krok === 'hour' ? 'stats.chartAriaHour' : 'stats.chartAria',
    { what: g.nazev }, stav().lang));
  geo = { svg, tip, W, L, T, B, n, x, y, body, popis, krok: g.krok, sloupce, zamer, zvyrazneni };

  vypisPoznamku(g);
  if (vybrany !== null) ukazBod(vybrany);
}

/** Věta pod grafem; u dvou čar před ní legenda (barva sama nikdy nestačí). */
function vypisPoznamku(g) {
  const L = stav().lang;
  const pozn = $('stats-chart-note');
  const legenda = g.popis.cary?.length > 1
    ? [el('span', 'stats-legendy', g.popis.cary.map(([, role, jmeno]) => el('span', 'stats-legenda', [
      el('span', `stats-klic stats-klic-${role}`), document.createTextNode(jmeno),
    ])))]
    : [];
  pozn.replaceChildren(...legenda, document.createTextNode(g.note));
}

/**
 * Kdy bod platí, pro bublinu — s datem, jak chtěl Michal.
 *
 * ⚠️ Měsíc na kraji období je NECELÝ (období začíná 6. 10.) — pak se
 * píše rozsah dnů, ne „říjen 2025", jinak by součet srážek za půl
 * měsíce vypadal jako za celý.
 */
function kdyBod(p, krok) {
  const L = stav().lang;
  if (krok === 'year') return String(p.year);
  // Po hodinách i s časem — o to Michal stál od začátku („s datem a časem").
  if (krok === 'hour') return hodina(p.time, 'rok');
  const rozsah = () => {
    const ruzneRoky = p.from.slice(0, 4) !== p.to.slice(0, 4);
    return `${den(p.from, ruzneRoky)} – ${den(p.to, true)}`;
  };
  if (krok === 'week') return rozsah();
  if (krok === 'month') {
    const cely = p.from.endsWith('-01') && addDays(p.to, 1).endsWith('-01');
    return cely
      ? new Intl.DateTimeFormat(L, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(dayMs(p.from)))
      : rozsah();
  }
  return new Intl.DateTimeFormat(L, {
    weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(dayMs(p.from)));
}

/**
 * Ukáže hodnoty bodu: svislý zaměřovač, zvětšené tečky a bublinu s datem.
 *
 * 🚨 Michal 6. 10. 2026: *„body při klepnutí na ne v telefonu nebo ve
 * webappce nic neukazují!"* Tečka má 4 px — trefit ji prstem nejde,
 * proto se netrefuje: rozhoduje nejbližší bod VODOROVNĚ, kamkoli do grafu.
 */
function ukazBod(i) {
  if (!geo) return;
  const { svg, tip, x, y, body, popis, zamer, zvyrazneni, sloupce } = geo;
  const idx = Math.max(0, Math.min(geo.n - 1, i));
  vybrany = idx;
  const p = body[idx];
  const L = stav().lang;

  zamer.setAttribute('x1', x(idx).toFixed(1));
  zamer.setAttribute('x2', x(idx).toFixed(1));
  zamer.setAttribute('visibility', 'visible');
  for (const s of sloupce) s?.classList.remove('stats-srazky-vybrany');
  zvyrazneni.replaceChildren();

  const radky = [];
  const radek = (role, hodnota, jmeno) => el('div', 'stats-tip-radek', [
    el('span', `stats-klic stats-klic-${role}`), el('b', '', hodnota), el('span', 'stats-tip-jmeno', jmeno),
  ]);
  if (popis.sloupce) {
    const [k, jmeno] = popis.sloupce;
    sloupce[idx]?.classList.add('stats-srazky-vybrany');
    radky.push(radek('sloupec', popis.fmt(p[k]), jmeno));
  } else {
    for (const [k, role, jmeno] of popis.cary) {
      if (jeCislo(p[k])) {
        const c = document.createElementNS(SVG, 'circle');
        c.setAttribute('cx', x(idx).toFixed(1));
        c.setAttribute('cy', y(p[k]).toFixed(1));
        c.setAttribute('r', '4.5');
        c.setAttribute('class', `stats-bod stats-bod-${role} stats-bod-vybrany`);
        zvyrazneni.append(c);
      }
      radky.push(radek(role, popis.fmt(p[k]), jmeno));
    }
  }
  if (popis.smer && p.windDir) {
    radky.push(radek('prazdny', t(`windDirLong.${p.windDir}`, L), t('stats.series.dir', L)));
  }
  tip.replaceChildren(el('div', 'stats-tip-kdy', kdyBod(p, geo.krok)), ...radky);
  tip.hidden = false;

  // Bublina vedle zaměřovače, ne přes něj: vpravo, a když se nevejde, vlevo.
  // ⚠️ Vlevo nejdál po začátek plochy grafu — přes popisky osy jen tehdy,
  // když jinak nejde, jinak by schovala „25 °C" zrovna ve chvíli, kdy
  // člověk hodnotu porovnává.
  const box = $('stats-chart');
  const meritko = (svg.getBoundingClientRect().width / geo.W) || 1;
  const px = x(idx) * meritko;
  const plocha = geo.L * meritko;
  const sirkaBoxu = box.clientWidth;
  const sirkaTipu = tip.offsetWidth;
  let left;
  if (px + 12 + sirkaTipu <= sirkaBoxu) left = px + 12;
  else if (px - 12 - sirkaTipu >= plocha) left = px - 12 - sirkaTipu;
  else if (px - 3 - sirkaTipu >= plocha) left = plocha;
  else left = px - 12 - sirkaTipu;
  left = Math.max(0, Math.min(sirkaBoxu - sirkaTipu, left));
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(geo.T * meritko)}px`;
}

function schovejBod() {
  vybrany = null;
  if (!geo) return;
  geo.zamer.setAttribute('visibility', 'hidden');
  geo.zvyrazneni.replaceChildren();
  for (const s of geo.sloupce) s?.classList.remove('stats-srazky-vybrany');
  geo.tip.hidden = true;
}

/** Nejbližší bod k místu klepnutí — jen vodorovně (viz `ukazBod`). */
function bodPodPrstem(e) {
  if (!geo) return null;
  const r = geo.svg.getBoundingClientRect();
  if (!r.width) return null;
  const px = ((e.clientX - r.left) / r.width) * geo.W;
  let nej = 0;
  let vzdalenost = Infinity;
  for (let i = 0; i < geo.n; i++) {
    const d = Math.abs(geo.x(i) - px);
    if (d < vzdalenost) { vzdalenost = d; nej = i; }
  }
  return nej;
}

function grafZeDnu(daily, klic) {
  const L = stav().lang;
  const dostupne = availableQuantities(daily);
  vykresliVolbu('stats-quantity', dostupne);
  const v = ucinna(dostupne);
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
    klic,
    body: points,
    krok: step,
    labels: points.map(popisek),
    popis: popisVeliciny(v),
    nazev: t(`stats.q.${v}`, L),
    note: `${t(`stats.qNote.${v}`, L)} ${t(`stats.chartStep.${step}`, L)} ${t('stats.chartTap', L)}`,
  });
}

/** Graf posledních 48 hodin: bod = hodina, bublina nese i čas. */
function grafZHodin(hourly, klic) {
  const L = stav().lang;
  const dostupne = availableHourQuantities(hourly);
  vykresliVolbu('stats-quantity', dostupne);
  const v = ucinna(dostupne);
  const body = hourlySeries(hourly);
  nakresliGraf({
    klic,
    body,
    krok: 'hour',
    labels: body.map((p) => hodina(p.time)),
    popis: popisVeliciny(v, 'hodiny'),
    nazev: t(`stats.q.${v}`, L),
    note: `${t(`stats.qNoteHour.${v}`, L)} ${t('stats.chartStep.hour', L)} ${t('stats.chartTapHour', L)}`,
  });
}

function grafZRoku(roky, klic) {
  const L = stav().lang;
  vykresliVolbu('stats-quantity', VELICINY_ROKY);
  const v = ucinna(VELICINY_ROKY);
  // Necelé roky do grafu nepatří: půlrok má úplně jiný průměr i úhrn.
  const cele = roky.filter((r) => r.days >= CELY_ROK_DNI);
  nakresliGraf({
    klic,
    body: cele.map((r) => ({
      year: r.year, from: `${r.year}-01-01`, to: `${r.year}-12-31`, mean: r.tempMean, precip: r.precipSum,
    })),
    krok: 'year',
    labels: cele.map((r) => String(r.year)),
    popis: popisVeliciny(v, 'roky'),
    nazev: t(`stats.q.${v}`, L),
    // ⚠️ Kdo si vybral vlhkost a přepnul na „Od začátku", musí se dozvědět,
    // proč ji tu nevidí — jinak to vypadá, že volba zmizela.
    note: `${t('stats.chartYears', L)} ${t('stats.chartTap', L)} ${t('stats.yearsOnly', L)}`,
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

/**
 * Hodnoty bodu trasy za dny (nebo za posledních 48 hodin) — podle
 * přepínače veličin. Souhrny dnů i hodin mají tatáž pole; liší se jen
 * počty (deštivé dny × hodiny) a tlak, u hodin teď a kam se hnul.
 */
function hodnotyDnu(s, v, hodiny = false) {
  const L = stav().lang;
  const prumer = (x) => tf('stats.meanValue', { value: x }, L);
  const jm = (k) => t(`stats.series.${k}`, L);
  switch (v) {
    case 'feels':
      return [`${temp(s.feelsMin?.value, 0)} – ${temp(s.feelsMax?.value, 0)}`];
    case 'precip':
      return [srazky(s.precipSum), hodiny
        ? tp('stats.rainHours', s.rainHours, {}, L) : tp('stats.rainDays', s.rainDays, {}, L)];
    case 'wind':
      return [`${jm('wind')} ${vitr(s.windMax?.value)}`, `${jm('gust')} ${vitr(s.gustMax?.value)}`,
        s.windDir && t(`windDirLong.${s.windDir.key}`, L)];
    case 'humidity':
      return [prumer(pct(s.humidityMean)), `${pct(s.humidityMin?.value)} – ${pct(s.humidityMax?.value)}`];
    case 'cloud':
      return hodiny ? [prumer(pct(s.cloudMean))]
        : [prumer(pct(s.cloudMean)), tp('stats.clearDays', s.clearDays, {}, L)];
    case 'pressure':
      if (hodiny) {
        return [s.pressureNow && tf('stats.nowValue', { value: tlak(s.pressureNow.value) }, L),
          s.pressureChange && tf('stats.pressureChange', {
            value: rozdilTlaku(s.pressureChange.value), hours: s.pressureChange.hours,
          }, L)];
      }
      return [prumer(tlak(s.pressureMean)), `${tlak(s.pressureMin?.value)} – ${tlak(s.pressureMax?.value)}`];
    default:
      return [prumer(temp(s.tempMean)), `${temp(s.tempMin?.value, 0)} – ${temp(s.tempMax?.value, 0)}`];
  }
}

/** Hodnoty bodu trasy za roky (jen teplota a srážky — víc roční přehled nezná). */
function hodnotyRoku(s, v) {
  const L = stav().lang;
  if (v === 'precip') {
    return [tf('stats.perYear', { value: srazky(s.precipMean) }, L), tf('stats.wettestShort', { year: s.wettest.year }, L)];
  }
  return [temp(s.tempMean), s.change !== null ? rozdilTeplot(s.change) : '',
    tf('stats.warmestShort', { year: s.warmest.year }, L)];
}

function radekTrasy(bod, hodnoty) {
  const L = stav().lang;
  const b = el('button', 'stats-bod-trasy', [
    el('span', 'stats-bod-role', bod.role),
    el('strong', 'stats-bod-jmeno', placeLabel(bod.misto, L)),
    el('span', 'stats-bod-hodnoty', hodnoty.filter(Boolean).join(' · ')),
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
  // U hodin se rozsah dopíše až s daty: kdy přesně, ví zdroj (čas místa).
  $('stats-range').textContent = rozsah.hours ? ''
    : rozsah.years
      ? tf('stats.rangeYears', { from: rozsah.from.slice(0, 4), to: rozsah.to.slice(0, 4) }, L)
      : `${den(rozsah.from, true)} – ${den(rozsah.to, true)} · ${dni(daysBetween(rozsah.from, rozsah.to))}`;
  const rozsahHodin = (data) => {
    $('stats-range').textContent = data?.from
      ? `${hodina(data.from, 'den')} – ${hodina(data.to, 'den')} · ${tp('stats.hours', data.hourly.time.length, {}, L)}`
      : '';
  };

  vypisStav(t('stats.loading', L));
  try {
    await requests.run('stats', async (signal) => {
      if (mode === 'place') {
        const klic = rozsah.hours
          ? `${misto.lat},${misto.lon}:h${rozsah.hours}`
          : `${misto.lat},${misto.lon}:${rozsah.from}:${rozsah.to}`;
        if (rozsah.hours) {
          const data = await hodinyPro(misto, signal);
          if (signal.aborted) return;
          const s = summarizeHourly(data.hourly);
          $('stats-route-card').hidden = true;
          if (!s) { schovejVysledky(); vypisStav(t('stats.empty', L)); return; }
          rozsahHodin(data);
          vykresliSouhrnHodin(s);
          grafZHodin(data.hourly, klic);
        } else if (rozsah.years) {
          const data = await rokyPro(misto, signal);
          if (signal.aborted) return;
          const roky = yearsInRange(data.years, rozsah.from, rozsah.to);
          $('stats-route-card').hidden = true;
          if (!vykresliRoky(roky)) { schovejVysledky(); vypisStav(t('stats.empty', L)); return; }
          grafZRoku(roky, klic);
        } else {
          const data = await dnyPro(misto, rozsah, signal);
          if (signal.aborted) return;
          const s = summarizeDaily(data.daily);
          $('stats-route-card').hidden = true;
          if (!s) { schovejVysledky(); vypisStav(t('stats.empty', L)); return; }
          vykresliSouhrn(s);
          grafZeDnu(data.daily, klic);
        }
      } else {
        // Trasa: každý bod zvlášť, všechny naráz.
        const souhrny = await Promise.all(body.map(async (b) => {
          if (rozsah.hours) {
            const data = await hodinyPro(b.misto, signal);
            return { s: summarizeHourly(data.hourly), dostupne: availableHourQuantities(data.hourly), data };
          }
          if (rozsah.years) {
            const data = await rokyPro(b.misto, signal);
            return { s: summarizeYears(yearsInRange(data.years, rozsah.from, rozsah.to)), dostupne: VELICINY_ROKY };
          }
          const data = await dnyPro(b.misto, rozsah, signal);
          return { s: summarizeDaily(data.daily), dostupne: availableQuantities(data.daily) };
        }));
        if (signal.aborted) return;
        // Rozsah hodin podle startu (na dlouhé trase přes pásma se konec
        // u cíle může o hodinu lišit — bod je ale pořád „do teď").
        if (rozsah.hours) rozsahHodin(souhrny[0].data);
        // Volba nabízí, co má aspoň jeden bod — v pořadí `VELICINY`.
        const dostupne = VELICINY.filter((q) => souhrny.some((x) => x.dostupne.includes(q)));
        vykresliVolbu('stats-route-quantity', dostupne);
        const v = ucinna(dostupne);
        $('stats-summary-card').hidden = true;
        $('stats-chart-card').hidden = true;
        $('stats-route-points').replaceChildren(...body.map((b, i) => {
          const { s } = souhrny[i];
          const hodnoty = !s ? [t('stats.empty', L)]
            : rozsah.years ? hodnotyRoku(s, v) : hodnotyDnu(s, v, !!rozsah.hours);
          return radekTrasy(b, hodnoty);
        }));
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

  // Přepínač veličin: nad grafem i nad body trasy, volba je jedna.
  // Data jsou v paměti, takže překreslení nechodí na síť.
  for (const id of ['stats-quantity', 'stats-route-quantity']) {
    const box = $(id);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-velicina]');
      if (!b || b.getAttribute('aria-pressed') === 'true') return;
      velicina = b.dataset.velicina;
      b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      refreshStats();
    });
    box.addEventListener('scroll', () => srovnejKraj(box), { passive: true });
  }

  // Graf: klepnutí, tažení prstem do stran, myš, šipky.
  const graf = $('stats-chart');
  graf.addEventListener('pointerdown', (e) => {
    const i = bodPodPrstem(e);
    if (i !== null) ukazBod(i);
  });
  graf.addEventListener('pointermove', (e) => {
    // Myš ukazuje už najetím; prst jen když je na displeji (tažení).
    if (e.pointerType !== 'mouse' && !e.buttons) return;
    const i = bodPodPrstem(e);
    if (i !== null && i !== vybrany) ukazBod(i);
  });
  graf.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') schovejBod(); });
  // Prst, který se rozjel nahoru nebo dolů, roluje stránkou — bublina by
  // pak visela nad grafem, na který se už nikdo nedívá.
  graf.addEventListener('pointercancel', schovejBod);
  graf.addEventListener('keydown', (e) => {
    if (!geo) return;
    const posun = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (posun) {
      ukazBod(vybrany === null ? (posun > 0 ? 0 : geo.n - 1) : vybrany + posun);
    } else if (e.key === 'Home') {
      ukazBod(0);
    } else if (e.key === 'End') {
      ukazBod(geo.n - 1);
    } else if (e.key === 'Escape') {
      schovejBod();
    } else {
      return;
    }
    e.preventDefault();
  });
  // Klepnutí jinam bublinu zavře (na telefonu není „odjetí myší").
  document.addEventListener('pointerdown', (e) => {
    if (vybrany !== null && !graf.contains(e.target)) schovejBod();
  });

  // Graf se kreslí v pixelech podle šířky karty — po otočení telefonu znovu.
  // Řady přepínačů se sledují taky: kraj vybledá podle toho, co se vejde.
  let casovac = 0;
  const sledovac = new ResizeObserver(() => {
    clearTimeout(casovac);
    casovac = setTimeout(() => {
      if (posledniGraf && !$('stats-chart-card').hidden) nakresliGraf(posledniGraf);
      for (const id of ['stats-quantity', 'stats-route-quantity']) srovnejKraj($(id));
    }, 120);
  });
  for (const id of ['stats-chart', 'stats-quantity', 'stats-route-quantity']) sledovac.observe($(id));
}

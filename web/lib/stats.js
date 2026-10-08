/**
 * Statistiky — jaké počasí na místě DOOPRAVDY bylo (`R35`).
 *
 * ⚠️ ČISTÝ MODUL. Žádná síť, žádné DOM, žádné texty — jen čísla a data.
 * Texty a jednotky si k tomu přidá obrazovka (`stats-screen.js`), stahování
 * dělá server (`server/history.js`). Díky tomu se dá všechno otestovat
 * bez prohlížeče.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO EXISTUJE
 *
 * Michal 30. 9. 2026: *„daly by se udělat nějaké statistiky jako má
 * Gulpka? … jde o to, abych se mohl podívat třeba na reálné počasí na
 * místech, kde jsem poslední týden byl."*
 *
 * Appka do té doby uměla jen předpověď — co BUDE. Tohle je druhá půlka:
 * co BYLO. Zdroj je archiv Open-Meteo (denní údaje od roku 1940 do včerejška).
 *
 * 🚨 JSOU TO ÚDAJE Z MODELU, NE ZE STANICE. Archiv je zpětná analýza
 * v síti zhruba 10–25 km. V rovině sedí dobře; v horách a údolích se může
 * od skutečnosti lišit o stupně. Obrazovka to musí říct — číslo na jedno
 * desetinné místo jinak slibuje přesnost, kterou nemá.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { isUsablePoint } from './geo-query.js';

/** Odkdy archiv sahá. */
export const ARCHIV_OD = '1940-01-01';

/**
 * Kolik dní smí mít jeden dotaz na denní údaje.
 *
 * ⚠️ Zdroj počítá váhu dotazu podle DNÍ × VELIČIN. Jeden dotaz na všech
 * 86 let se vším vyčerpal minutový limit (změřeno 30. 9. 2026). Delší
 * období se proto neptá po dnech, ale po ROCÍCH (služba `climate`).
 */
export const MAX_DNI = 800;

/**
 * Denní veličiny, na které se ptáme. Jen ty, které se opravdu ukážou —
 * každá navíc zvedá váhu dotazu u zdroje.
 *
 * ⚠️ Zdroj váží dotaz po DESETI veličinách: do deseti je to jeden díl,
 * třináct je 1,3 dílu. Pocitová teplota, vítr, vlhkost a tlak přibyly
 * 6. 10. 2026 kvůli přepínači v grafu (`VELICINY`) — dotaz se tím
 * prodražil o třetinu, ne násobně. Víc už ne bez dobrého důvodu.
 */
export const HISTORY_DAILY = [
  'temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean',
  'apparent_temperature_max', 'apparent_temperature_min',
  'precipitation_sum', 'snowfall_sum', 'cloud_cover_mean',
  'wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant',
  'relative_humidity_2m_mean', 'pressure_msl_mean',
];

/**
 * Veličiny, mezi kterými se v grafu (a v bodech trasy) přepíná — tytéž
 * údaje, které appka ukazuje u předpovědi.
 *
 * Michal 6. 10. 2026: *„ve statistikách mi chybí přepínatelné ostatní
 * údaje, které meteotrace ukazuje, mělo by se na ně dát přepnout."*
 *
 * ⚠️ UV index tu není a nebude: archiv ho nemá (vrací samé `null`,
 * ověřeno 6. 10. 2026). Východ a západ slunce ani Měsíc nejsou počasí,
 * které „bylo" — ty se každý rok opakují.
 */
export const VELICINY = ['temp', 'feels', 'precip', 'wind', 'humidity', 'cloud', 'pressure'];

/** Roční přehled (od roku 1940) zná jen teplotu a srážky — viz `CLIMATE_DAILY`. */
export const VELICINY_ROKY = ['temp', 'precip'];

/** Z kterých polí archivu se která veličina kreslí. */
const ZDROJ_VELICINY = {
  temp: ['temperature_2m_max', 'temperature_2m_min'],
  feels: ['apparent_temperature_max', 'apparent_temperature_min'],
  precip: ['precipitation_sum'],
  wind: ['wind_speed_10m_max', 'wind_gusts_10m_max'],
  humidity: ['relative_humidity_2m_mean'],
  cloud: ['cloud_cover_mean'],
  pressure: ['pressure_msl_mean'],
};

/**
 * Jasný a zatažený den podle PRŮMĚRNÉ DENNÍ OBLAČNOSTI (obvyklé meze:
 * do 20 % jasno, od 80 % zataženo).
 *
 * 🚨 NE podle slunečního svitu a NE podle kódu počasí — obojí archiv má,
 * a obojí lže (změřeno 30. 9. 2026 na Praze):
 * - „sluneční svit" vycházel 11,9 h z 12,1 h dne při 33% oblačnosti
 *   a 3 149 h za rok (skutečnost je kolem 1 700),
 * - denní kód počasí bere NEJHORŠÍ hodinu dne, takže je skoro pořád
 *   „zataženo" — za týden s 18–55 % oblačnosti nevyšel jediný jasný den.
 * Průměrná oblačnost sedí: Praha 2025 má 52 jasných a 118 zatažených dní.
 */
export const JASNO_DO_PCT = 20;
export const ZATAZENO_OD_PCT = 80;

/** Veličiny pro roční přehled od roku 1940 — co nejmíň, je to 31 000 dní. */
export const CLIMATE_DAILY = ['temperature_2m_mean', 'precipitation_sum'];

/** Od kolika milimetrů se den počítá jako deštivý (obvyklá klimatologická mez). */
export const DESTIVY_DEN_MM = 1;

/**
 * Období ve výběru, v pořadí, v jakém se nabízejí (vzor Gulpka + aktuální rok).
 * `h48` = posledních 48 hodin PO HODINÁCH (8. 10. 2026) — viz `HODIN`.
 */
export const PERIODS = ['h48', '7', 'month', 'm3', 'year', 'thisyear', 'lastyear', 'all', 'custom'];

/**
 * Posledních 48 hodin po hodinách, až do teď.
 *
 * Michal 8. 10. 2026: *„potřeboval bych přidat do statistik poslední den
 * a to po hodinách"* — a vzápětí *„nebo radši posledních 48 hodin, to dává
 * větší smysl"*.
 *
 * 🚨 ZDROJ JE JINÝ NEŽ U DNŮ. Archiv dnešek celý nemá (končí včerejškem),
 * takže „do teď" z něj nejde. Bere se model předpovědi s uplynulými dny
 * (`past_days`) — CELÝCH 48 hodin z jednoho zdroje. Slepit včerejšek
 * z archivu s dneškem z předpovědi by na přelomu dne dělalo schod:
 * na stejné hodině se oba zdroje lišily o 0,5–2,5 °C (Praha, 8. 10. 2026).
 * Obrazovka to musí říct (`stats.hourlyNote`).
 */
export const HODIN = 48;

/**
 * Hodinové veličiny pro `HODIN`. Totéž, co přepínač ukazuje u dnů,
 * jen po hodinách.
 *
 * ⚠️ Deset, ne víc: zdroj váží dotaz po deseti veličinách (jako archiv).
 * Tři dny × deset veličin je jeden díl — levnější než týden z archivu.
 */
export const RECENT_HOURLY = [
  'temperature_2m', 'apparent_temperature', 'precipitation', 'snowfall', 'cloud_cover',
  'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'relative_humidity_2m', 'pressure_msl',
];

/** Z kterých hodinových polí se která veličina kreslí. */
const ZDROJ_HODIN = {
  temp: ['temperature_2m'],
  feels: ['apparent_temperature'],
  precip: ['precipitation'],
  wind: ['wind_speed_10m', 'wind_gusts_10m'],
  humidity: ['relative_humidity_2m'],
  cloud: ['cloud_cover'],
  pressure: ['pressure_msl'],
};

/** Od kolika milimetrů za hodinu se hodina počítá jako deštivá (měřitelné srážky). */
export const DESTIVA_HODINA_MM = 0.1;

/* ============================================================
   DATA
   ============================================================ */

const DEN_MS = 86_400_000;

/** `2026-09-30` → milisekundy (půlnoc UTC). Neplatné datum → `NaN`. */
export function dayMs(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return NaN;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  // `2026-02-31` Date.parse posune na březen — takové datum není platné.
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === iso ? ms : NaN;
}

/** Milisekundy → `2026-09-30` (den v UTC). */
export function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Datum o `n` dní dál (záporné = zpět). */
export function addDays(iso, n) {
  return isoDay(dayMs(iso) + n * DEN_MS);
}

/** Kolik dní období má, včetně obou krajů. */
export function daysBetween(from, to) {
  return Math.round((dayMs(to) - dayMs(from)) / DEN_MS) + 1;
}

/**
 * Dnešní den V MÍSTĚ UŽIVATELE jako `RRRR-MM-DD`.
 *
 * ⚠️ Ne v UTC: ve dvě ráno českého času je v UTC ještě včerejšek a „včera"
 * by pak bylo předevčírem.
 *
 * @param {number} nowMs
 * @param {number} [offsetMin]  posun místního času proti UTC v minutách
 *   (`-new Date().getTimezoneOffset()`), kvůli testu se předává
 */
export function localToday(nowMs, offsetMin = -new Date(nowMs).getTimezoneOffset()) {
  return isoDay(nowMs + offsetMin * 60_000);
}

/* ============================================================
   OBDOBÍ
   ============================================================ */

/**
 * Převede volbu období na rozsah dat.
 *
 * 🚨 Klouzavá období končí VČEREJŠKEM, ne dneškem. Dnešní den v archivu
 * není celý (a často vůbec) — „posledních 7 dní" s polovinou dneška by
 * mělo podhodnocené srážky i sluneční svit a nikdo by nepoznal proč.
 *
 * @param {string} key       jedna z `PERIODS`
 * @param {string} today     dnešní den (`localToday()`)
 * @param {{from?: string, to?: string}} [custom]
 * @returns {{from: string, to: string, years?: boolean}|{hours: number}|{empty: true}}
 *   `years: true` = ptát se po rocích (služba `climate`), ne po dnech;
 *   `hours` = posledních tolik hodin až do teď (služba `recent`) — kdy
 *   přesně, ví až zdroj, protože hodiny počítá v čase MÍSTA, ne telefonu
 */
export function periodRange(key, today, custom = {}) {
  const vcera = addDays(today, -1);
  const rok = Number(today.slice(0, 4));

  switch (key) {
    case 'h48': return { hours: HODIN };
    case '7': return { from: addDays(vcera, -6), to: vcera };
    case 'month': return { from: addDays(vcera, -29), to: vcera };
    case 'm3': return { from: addDays(vcera, -89), to: vcera };
    case 'year': return { from: addDays(vcera, -364), to: vcera };
    case 'thisyear': {
      const from = `${rok}-01-01`;
      // 1. ledna ještě letošní rok žádný celý den nemá.
      return dayMs(vcera) < dayMs(from) ? { empty: true } : { from, to: vcera };
    }
    case 'lastyear': return { from: `${rok - 1}-01-01`, to: `${rok - 1}-12-31` };
    case 'all': return { from: ARCHIV_OD, to: vcera, years: true };
    case 'custom': {
      let from = custom.from;
      let to = custom.to;
      if (!Number.isFinite(dayMs(from)) || !Number.isFinite(dayMs(to))) return { empty: true };
      if (dayMs(from) > dayMs(to)) [from, to] = [to, from];
      // Budoucnost v archivu není a před rokem 1940 taky ne.
      if (dayMs(to) > dayMs(vcera)) to = vcera;
      if (dayMs(from) < dayMs(ARCHIV_OD)) from = ARCHIV_OD;
      if (dayMs(from) > dayMs(to)) return { empty: true };
      return daysBetween(from, to) > MAX_DNI ? { from, to, years: true } : { from, to };
    }
    default: return { empty: true };
  }
}

/* ============================================================
   DOTAZ (hlídá ho i server)
   ============================================================ */

/**
 * Souřadnice zaokrouhlená na krok.
 *
 * Archiv má síť v řádu kilometrů, takže desetitisíciny stupně nic nepřidají
 * — jen by každý, kdo stojí o dům vedle, dostal vlastní položku v mezipaměti
 * a zdroj by se ptal zbytečně.
 */
export function roundCoord(value, step) {
  const n = Math.round(Number(value) / step) * step;
  // 0,07 + 0,01 = 0,08000000000000002 — ořez na rozumný počet míst.
  return Number(n.toFixed(4));
}

/** Krok pro denní údaje (~1 km) a pro roční přehled (síť archivu, ~25 km). */
export const KROK_DNY = 0.01;
export const KROK_ROKY = 0.25;

/**
 * Ověří dotaz na denní historii. Vrací hotové hodnoty, nebo vyhodí chybu
 * s větou pro klienta.
 *
 * 🚨 Hlídá to SERVER, ne jen obrazovka: adresu si může poskládat kdokoli
 * a dotaz na sto let po dnech by vyčerpal příděl u zdroje — a s ním
 * i předpověď pro všechny ostatní.
 */
export function checkHistoryQuery({ lat, lon, from, to }, today) {
  const bod = { lat: Number(lat), lon: Number(lon) };
  if (!isUsablePoint(bod)) throw new Error('Chybí platné souřadnice (lat, lon).');
  if (!Number.isFinite(dayMs(from)) || !Number.isFinite(dayMs(to))) {
    throw new Error('Chybí platné období (from, to ve tvaru RRRR-MM-DD).');
  }
  if (dayMs(from) > dayMs(to)) throw new Error('Období končí dřív, než začíná.');
  if (dayMs(from) < dayMs(ARCHIV_OD)) throw new Error(`Archiv začíná ${ARCHIV_OD}.`);
  // Den navíc kvůli časovým pásmům: na východě už může být zítra.
  if (dayMs(to) > dayMs(addDays(today, 1))) throw new Error('Období sahá do budoucnosti.');
  if (daysBetween(from, to) > MAX_DNI) {
    throw new Error(`Období je delší než ${MAX_DNI} dní — delší se čte po rocích.`);
  }
  return {
    lat: roundCoord(bod.lat, KROK_DNY), lon: roundCoord(bod.lon, KROK_DNY), from, to,
  };
}

/**
 * Ověří dotaz na posledních 48 hodin: jen místo — kdy, určuje server
 * (teď). Zaokrouhlení stejné jako u dnů, ať se ulice dělí o odpověď.
 */
export function checkRecentQuery({ lat, lon }) {
  const bod = { lat: Number(lat), lon: Number(lon) };
  if (!isUsablePoint(bod)) throw new Error('Chybí platné souřadnice (lat, lon).');
  return { lat: roundCoord(bod.lat, KROK_DNY), lon: roundCoord(bod.lon, KROK_DNY) };
}

/* ============================================================
   SOUHRN ZA OBDOBÍ
   ============================================================ */

const jeCislo = (v) => v != null && Number.isFinite(v);

/**
 * Směr větru na OSM světových stran (klíče jako `windDirKey`, jen hrubší).
 *
 * ⚠️ Počítá se rovnou ze stupňů, ne sloučením šestnácti dílků: to by
 * mezistrany (SSV, VSV…) přičetlo jen k diagonálám a severovýchod by pak
 * „vyhrával" s třikrát širší výsečí než sever.
 */
const STRANY8 = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
export function dir8(degrees) {
  if (!jeCislo(degrees)) return null;
  return STRANY8[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

/**
 * Převládající směr větru: nejčastější z osmi světových stran.
 *
 * ⚠️ Průměr stupňů nejde — průměr severozápadu (315°) a severovýchodu
 * (45°) vyjde jih.
 *
 * @returns {{key: string, days: number}|null}
 */
function prevladajiciSmer(stupne) {
  const strany = new Map();
  for (const s of stupne) {
    const k8 = dir8(s);
    if (!k8) continue;
    strany.set(k8, (strany.get(k8) || 0) + 1);
  }
  let nej = null;
  for (const [k, n] of strany) if (!nej || n > nej.days) nej = { key: k, days: n };
  return nej;
}

/** Průměr čísel v řadě; žádné číslo → `null` (ne nula). */
function prumer(hodnoty) {
  const cisla = hodnoty.filter(jeCislo);
  return cisla.length ? cisla.reduce((a, v) => a + v, 0) / cisla.length : null;
}

/** Nejvyšší (nebo nejnižší) hodnota řady i s datem. */
function extrem(casy, hodnoty, vetsi) {
  let nej = null;
  for (let i = 0; i < casy.length; i++) {
    const v = hodnoty?.[i];
    if (!jeCislo(v)) continue;
    if (nej === null || (vetsi ? v > nej.value : v < nej.value)) nej = { value: v, date: casy[i] };
  }
  return nej;
}

/** Nejdelší souvislá řada dní, které splní podmínku — délka a kdy skončila. */
function nejdelsiSerie(casy, splni) {
  let nej = { days: 0, from: null, to: null };
  let delka = 0;
  let od = null;
  for (let i = 0; i < casy.length; i++) {
    const s = splni(i);
    if (s === true) {
      if (delka === 0) od = casy[i];
      delka += 1;
      if (delka > nej.days) nej = { days: delka, from: od, to: casy[i] };
    } else {
      // ⚠️ Den BEZ ÚDAJE sérii přeruší taky. Přes díru v datech se počítat
      // nedá — „14 dní bez deště" by mohlo být sedm, mezera a sedm.
      delka = 0;
    }
  }
  return nej;
}

/**
 * Souhrn denních údajů za období.
 *
 * @param {object} daily  pole z archivu: `time`, `temperature_2m_max`, …
 * @returns {object|null} čísla v °C, mm, km/h a hodinách; `null` = žádný den
 */
export function summarizeDaily(daily) {
  const casy = daily?.time || [];
  if (!casy.length) return null;

  const tMax = daily.temperature_2m_max || [];
  const tMin = daily.temperature_2m_min || [];
  const tMean = daily.temperature_2m_mean || [];
  const srazky = daily.precipitation_sum || [];
  const snih = daily.snowfall_sum || [];
  const oblacnost = daily.cloud_cover_mean || [];
  const narazy = daily.wind_gusts_10m_max || [];
  const smer = daily.wind_direction_10m_dominant || [];
  const pocitMax = daily.apparent_temperature_max || [];
  const pocitMin = daily.apparent_temperature_min || [];
  const vitrMax = daily.wind_speed_10m_max || [];
  const vlhkost = daily.relative_humidity_2m_mean || [];
  const tlak = daily.pressure_msl_mean || [];

  const prumery = tMean.filter(jeCislo);
  // Dny, ke kterým vůbec něco máme — podle nich se pozná díra v datech.
  const dniSDaty = casy.filter((_, i) => jeCislo(tMax[i]) || jeCislo(srazky[i])).length;
  if (!dniSDaty) return null;

  const soucet = (a) => a.filter(jeCislo).reduce((s, v) => s + v, 0);
  const pocet = (a, podm) => a.filter((v) => jeCislo(v) && podm(v)).length;

  return {
    days: casy.length,
    daysWithData: dniSDaty,
    from: casy[0],
    to: casy[casy.length - 1],

    tempMean: prumery.length ? soucet(prumery) / prumery.length : null,
    tempMax: extrem(casy, tMax, true),
    tempMin: extrem(casy, tMin, false),

    precipSum: soucet(srazky),
    rainDays: pocet(srazky, (v) => v >= DESTIVY_DEN_MM),
    wettestDay: extrem(casy, srazky, true),
    dryStreak: nejdelsiSerie(casy, (i) => (jeCislo(srazky[i]) ? srazky[i] < DESTIVY_DEN_MM : null)),
    wetStreak: nejdelsiSerie(casy, (i) => (jeCislo(srazky[i]) ? srazky[i] >= DESTIVY_DEN_MM : null)),

    // Oblačnost: průměr a počet jasných a zatažených dní — viz `JASNO_DO_PCT`.
    cloudMean: oblacnost.some(jeCislo) ? soucet(oblacnost) / oblacnost.filter(jeCislo).length : null,
    clearDays: pocet(oblacnost, (v) => v <= JASNO_DO_PCT),
    overcastDays: pocet(oblacnost, (v) => v >= ZATAZENO_OD_PCT),

    gustMax: extrem(casy, narazy, true),
    windDir: prevladajiciSmer(smer),
    windMax: extrem(casy, vitrMax, true),

    // Pro přepínač veličin (body trasy): pocitová teplota, vlhkost, tlak.
    feelsMax: extrem(casy, pocitMax, true),
    feelsMin: extrem(casy, pocitMin, false),
    humidityMean: prumer(vlhkost),
    humidityMax: extrem(casy, vlhkost, true),
    humidityMin: extrem(casy, vlhkost, false),
    pressureMean: prumer(tlak),
    pressureMax: extrem(casy, tlak, true),
    pressureMin: extrem(casy, tlak, false),

    tropicalDays: pocet(tMax, (v) => v >= 30),
    frostDays: pocet(tMin, (v) => v < 0),
    snowDays: pocet(snih, (v) => v > 0),
  };
}

/* ============================================================
   GRAF
   ============================================================ */

/**
 * Které veličiny v denních údajích opravdu jsou (aspoň jedno číslo).
 *
 * ⚠️ Odpověď uložená v mezipaměti před 6. 10. 2026 nové veličiny nemá —
 * přepínač pak nabídne jen to, co se dá nakreslit, místo prázdného grafu.
 */
export function availableQuantities(daily) {
  return VELICINY.filter((v) => ZDROJ_VELICINY[v].some((k) => (daily?.[k] || []).some(jeCislo)));
}

/**
 * Řada pro graf: sloupce po dnech, týdnech nebo měsících podle délky období.
 *
 * ⚠️ 365 sloupců se na telefon nevejde a nedá se v nich nic přečíst.
 * Hranice: do 45 dní po dnech, do 200 po týdnech, dál po měsících.
 *
 * Každý bod nese VŠECHNY veličiny, ať přepnutí v grafu nechodí znovu
 * počítat. Jak se dny slučují, záleží na tom, co číslo znamená:
 * - nejvyšší a nejnižší (teplota, pocitová, vítr, nárazy) → extrém,
 * - srážky → SOUČET,
 * - průměry (vlhkost, oblačnost, tlak) → průměr,
 * - směr větru → nejčastější strana.
 * Bez jediného údaje je hodnota `null`, ne nula — nula srážek nebo
 * nula stupňů je věrohodné číslo a díra by se za něj schovala.
 *
 * @returns {{step: 'day'|'week'|'month', points: Array<{from: string, to: string, days: number,
 *   tMax, tMin, fMax, fMin, precip, wind, gust, windDir, humidity, cloud, pressure}>}}
 */
export function chartSeries(daily) {
  const casy = daily?.time || [];
  const n = casy.length;
  const step = n <= 45 ? 'day' : n <= 200 ? 'week' : 'month';

  const klic = (i) => {
    if (step === 'day') return casy[i];
    if (step === 'month') return casy[i].slice(0, 7);
    // Týden = sedmice od začátku období (ne kalendářní týden — ten by
    // první a poslední sloupec skoro vždycky uřízl na pár dní).
    return String(Math.floor(i / 7));
  };

  /** Dny rozdělené do sloupců: indexy do denních polí. */
  const skupiny = [];
  let curKlic = null;
  for (let i = 0; i < n; i++) {
    const k = klic(i);
    if (k !== curKlic) { skupiny.push([]); curKlic = k; }
    skupiny[skupiny.length - 1].push(i);
  }

  const vyber = (k, idx) => idx.map((i) => daily?.[k]?.[i]);
  const nej = (k, idx, vetsi) => {
    const cisla = vyber(k, idx).filter(jeCislo);
    if (!cisla.length) return null;
    return vetsi ? Math.max(...cisla) : Math.min(...cisla);
  };
  const soucet = (k, idx) => {
    const cisla = vyber(k, idx).filter(jeCislo);
    return cisla.length ? cisla.reduce((a, v) => a + v, 0) : null;
  };

  const points = skupiny.map((idx) => ({
    from: casy[idx[0]],
    to: casy[idx[idx.length - 1]],
    days: idx.length,
    tMax: nej('temperature_2m_max', idx, true),
    tMin: nej('temperature_2m_min', idx, false),
    fMax: nej('apparent_temperature_max', idx, true),
    fMin: nej('apparent_temperature_min', idx, false),
    precip: soucet('precipitation_sum', idx),
    wind: nej('wind_speed_10m_max', idx, true),
    gust: nej('wind_gusts_10m_max', idx, true),
    windDir: prevladajiciSmer(vyber('wind_direction_10m_dominant', idx))?.key ?? null,
    humidity: prumer(vyber('relative_humidity_2m_mean', idx)),
    cloud: prumer(vyber('cloud_cover_mean', idx)),
    pressure: prumer(vyber('pressure_msl_mean', idx)),
  }));
  return { step, points };
}

/* ============================================================
   HODINY — posledních 48 (služba `recent`, viz `HODIN`)
   ============================================================ */

/** Milisekundy → `2026-10-08T14:00` (začátek hodiny, v UTC). */
export function hourIso(ms) {
  return `${new Date(ms).toISOString().slice(0, 13)}:00`;
}

/**
 * Výřez posledních `n` hodin, které už začaly — poslední je ta, ve které
 * právě jsme. Zdroj posílá celé dny, tedy i hodiny, které teprve přijdou;
 * ty do „jak bylo" nepatří.
 *
 * ⚠️ `nowLocal` je čas MÍSTA, ne serveru ani telefonu: hodiny ze zdroje
 * jsou místní (`timezone=auto`). Kdo se z Prahy dívá na New York, má
 * dostat hodiny až do teď v New Yorku.
 *
 * @param {object} hourly    pole ze zdroje: `time` (`RRRR-MM-DDTHH:MM`), …
 * @param {string} nowLocal  právě běžící hodina v čase místa
 * @returns {object} táž pole, jen výřez (nic nesedí → prázdná pole)
 */
export function recentHours(hourly, nowLocal, n = HODIN) {
  const casy = hourly?.time || [];
  let konec = -1;
  // Textové srovnání stačí: `RRRR-MM-DDTHH:MM` se řadí jako čas.
  for (let i = 0; i < casy.length; i++) if (casy[i] <= nowLocal) konec = i;
  const od = Math.max(0, konec - n + 1);
  const out = { time: [] };
  for (const [k, v] of Object.entries(hourly || {})) {
    if (Array.isArray(v)) out[k] = konec < 0 ? [] : v.slice(od, konec + 1);
  }
  return out;
}

/** Které veličiny v hodinových údajích opravdu jsou (jako `availableQuantities`). */
export function availableHourQuantities(hourly) {
  return VELICINY.filter((v) => ZDROJ_HODIN[v].some((k) => (hourly?.[k] || []).some(jeCislo)));
}

/**
 * Body grafu po hodinách. Klíče jako u dnů tam, kde znamenají totéž
 * (srážky, vítr, vlhkost, oblačnost, tlak); teplota a pocitová jsou
 * JEDNA čára (`t`, `f`) — hodina nemá nejvyšší a nejnižší.
 * Chybějící údaj je `null`, ne nula (viz `chartSeries`).
 */
export function hourlySeries(hourly) {
  const casy = hourly?.time || [];
  const h = (k, i) => {
    const v = hourly?.[k]?.[i];
    return jeCislo(v) ? v : null;
  };
  return casy.map((time, i) => ({
    time,
    t: h('temperature_2m', i),
    f: h('apparent_temperature', i),
    precip: h('precipitation', i),
    wind: h('wind_speed_10m', i),
    gust: h('wind_gusts_10m', i),
    windDir: dir8(h('wind_direction_10m', i)),
    humidity: h('relative_humidity_2m', i),
    cloud: h('cloud_cover', i),
    pressure: h('pressure_msl', i),
  }));
}

/**
 * Souhrn posledních hodin. Pole se jmenují jako u `summarizeDaily`, kde
 * znamenají totéž — body trasy pak mluví stejně. Místo dnů se počítají
 * HODINY (`rainHours`, `windDir.hours`) a extrémy nesou místo data čas.
 *
 * Navíc tlak: poslední hodnota a o kolik se změnil od první hodiny.
 * U dnů to smysl nedává, u dvou dnů ano — rychle padající tlak je zpráva.
 *
 * @returns {object|null} čísla v °C, mm, km/h, % a hPa; `null` = žádná hodina
 */
export function summarizeHourly(hourly) {
  const casy = hourly?.time || [];
  if (!casy.length) return null;
  const pole = (k) => hourly[k] || [];
  const t = pole('temperature_2m');
  const pocit = pole('apparent_temperature');
  const srazky = pole('precipitation');
  const vlhkost = pole('relative_humidity_2m');
  const tlak = pole('pressure_msl');

  const hodinSDaty = casy.filter((_, i) => jeCislo(t[i]) || jeCislo(srazky[i])).length;
  if (!hodinSDaty) return null;

  const cislaSrazek = srazky.filter(jeCislo);
  const smer = prevladajiciSmer(pole('wind_direction_10m'));
  const sTlakem = tlak.map((v, i) => (jeCislo(v) ? i : -1)).filter((i) => i >= 0);
  const prvni = sTlakem[0];
  const posledni = sTlakem[sTlakem.length - 1];

  return {
    hours: casy.length,
    hoursWithData: hodinSDaty,
    from: casy[0],
    to: casy[casy.length - 1],

    tempMean: prumer(t),
    tempMax: extrem(casy, t, true),
    tempMin: extrem(casy, t, false),
    feelsMax: extrem(casy, pocit, true),
    feelsMin: extrem(casy, pocit, false),

    // Bez jediného údaje `null`, ne nula — „0 mm" by byla věrohodná lež.
    precipSum: cislaSrazek.length ? cislaSrazek.reduce((a, v) => a + v, 0) : null,
    rainHours: cislaSrazek.filter((v) => v >= DESTIVA_HODINA_MM).length,
    wettestHour: extrem(casy, srazky, true),
    snowHours: pole('snowfall').filter((v) => jeCislo(v) && v > 0).length,

    cloudMean: prumer(pole('cloud_cover')),
    windMax: extrem(casy, pole('wind_speed_10m'), true),
    gustMax: extrem(casy, pole('wind_gusts_10m'), true),
    windDir: smer && { key: smer.key, hours: smer.days },

    humidityMean: prumer(vlhkost),
    humidityMax: extrem(casy, vlhkost, true),
    humidityMin: extrem(casy, vlhkost, false),
    pressureMean: prumer(tlak),
    pressureMax: extrem(casy, tlak, true),
    pressureMin: extrem(casy, tlak, false),
    pressureNow: sTlakem.length ? { value: tlak[posledni], date: casy[posledni] } : null,
    // Hodin mezi první a poslední hodnotou (u celé řady 47, ne 48).
    pressureChange: sTlakem.length > 1
      ? { value: tlak[posledni] - tlak[prvni], since: casy[prvni], hours: posledni - prvni } : null,
  };
}

/* ============================================================
   ROKY (od roku 1940)
   ============================================================ */

/**
 * Sečte denní údaje po rocích. Dělá to SERVER, ať klientovi místo dvou
 * megabajtů dní přijde 87 řádků.
 *
 * @returns {Array<{year: number, tempMean: number|null, precipSum: number, days: number}>}
 */
export function yearlyFromDaily(daily) {
  const casy = daily?.time || [];
  const t = daily?.temperature_2m_mean || [];
  const s = daily?.precipitation_sum || [];
  const roky = new Map();
  for (let i = 0; i < casy.length; i++) {
    const y = Number(casy[i].slice(0, 4));
    let r = roky.get(y);
    if (!r) { r = { year: y, tSoucet: 0, tDni: 0, precipSum: 0, days: 0 }; roky.set(y, r); }
    if (jeCislo(t[i])) { r.tSoucet += t[i]; r.tDni += 1; r.days += 1; }
    if (jeCislo(s[i])) r.precipSum += s[i];
  }
  return [...roky.values()].sort((a, b) => a.year - b.year).map((r) => ({
    year: r.year,
    tempMean: r.tDni ? Math.round((r.tSoucet / r.tDni) * 100) / 100 : null,
    precipSum: Math.round(r.precipSum * 10) / 10,
    days: r.days,
  }));
}

/** Rok je celý, když má aspoň 360 dní s údajem (pár chybějících nevadí). */
export const CELY_ROK_DNI = 360;

/**
 * Souhrn ročního přehledu: rekordy a o kolik se oteplilo.
 *
 * 🚨 Do rekordů se berou JEN CELÉ ROKY. Letošek do září by vyšel jako
 * nejsušší rok v dějinách a (podle měsíce) i jako nejteplejší nebo
 * nejchladnější — a byla by to jen půlka kalendáře.
 *
 * Oteplení = průměr posledních deseti celých let proti průměru 1961–1990
 * (obvyklé srovnávací období). Když jedno z toho chybí, neříká se nic.
 */
export function summarizeYears(years) {
  const cele = (years || []).filter((r) => r.days >= CELY_ROK_DNI && jeCislo(r.tempMean));
  if (!cele.length) return null;

  const nej = (pole, co, vetsi) => pole.reduce((a, r) => (
    a === null || (vetsi ? r[co] > a[co] : r[co] < a[co]) ? r : a), null);
  const prumerTeplot = (pole) => (pole.length ? pole.reduce((s, r) => s + r.tempMean, 0) / pole.length : null);

  const normal = cele.filter((r) => r.year >= 1961 && r.year <= 1990);
  const posledni = cele.slice(-10);
  const zmena = normal.length >= 25 && posledni.length === 10
    ? prumerTeplot(posledni) - prumerTeplot(normal) : null;

  return {
    years: cele.length,
    from: cele[0].year,
    to: cele[cele.length - 1].year,
    warmest: nej(cele, 'tempMean', true),
    coldest: nej(cele, 'tempMean', false),
    wettest: nej(cele, 'precipSum', true),
    driest: nej(cele, 'precipSum', false),
    tempMean: prumerTeplot(cele),
    // Průměrný roční úhrn — pro body trasy, když je přepnuto na srážky.
    precipMean: cele.reduce((a, r) => a + r.precipSum, 0) / cele.length,
    change: zmena,
    changeYears: zmena === null ? null : { from: posledni[0].year, to: posledni[9].year },
  };
}

/** Roky v rozsahu (pro „Vlastní" období delší než `MAX_DNI`). */
export function yearsInRange(years, from, to) {
  const od = Number(String(from).slice(0, 4));
  const po = Number(String(to).slice(0, 4));
  return (years || []).filter((r) => r.year >= od && r.year <= po);
}

/* ============================================================
   KDE JSEM BYL — deník navštívených míst (jen v telefonu)
   ============================================================ */

/** Kolik záznamů se drží. Stačí na čtvrt roku každodenního klepání. */
export const MAX_NAVSTEV = 120;

/** Dvě polohy blíž než tohle jsou pro deník totéž místo (stupně, ~2 km). */
const STEJNE_MISTO_DEG = 0.02;

/**
 * Zapíše, že člověk byl ten den na tom místě.
 *
 * ⚠️ Jeden záznam na DEN A MÍSTO. Kdo desetkrát za den klepne na „Tady"
 * doma, nemá mít v deníku deset řádků — ale kdo ráno byl v Plzni a večer
 * v Praze, má mít oba.
 *
 * 🚨 Deník NEOPOUŠTÍ TELEFON. Na server jdou jen souřadnice místa, na které
 * se zrovna člověk dívá — stejně jako u předpovědi.
 *
 * @param {Array} log     dosavadní deník (nejnovější první)
 * @param {{lat: number, lon: number}} bod
 * @param {string} day    `RRRR-MM-DD`
 * @param {string} [name]
 * @returns {Array} nový deník
 */
export function recordVisit(log, bod, day, name = '') {
  const stary = Array.isArray(log) ? log : [];
  if (!isUsablePoint(bod) || !Number.isFinite(dayMs(day))) return stary;

  const stejne = (z) => z.d === day
    && Math.abs(z.lat - bod.lat) < STEJNE_MISTO_DEG && Math.abs(z.lon - bod.lon) < STEJNE_MISTO_DEG;
  const uz = stary.find(stejne);
  if (uz) {
    // Jméno se doplní, když přišlo později než poloha.
    if (!name || uz.n === name) return stary;
    return stary.map((z) => (z === uz ? { ...z, n: name } : z));
  }
  const zaznam = { d: day, lat: roundCoord(bod.lat, 0.001), lon: roundCoord(bod.lon, 0.001), n: name };
  return [zaznam, ...stary].sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0)).slice(0, MAX_NAVSTEV);
}

/** Vyčistí deník načtený z úložiště — poškozený zápis nesmí shodit appku. */
export function cleanVisits(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((z) => z && isUsablePoint(z) && Number.isFinite(dayMs(z.d)))
    .map((z) => ({ d: z.d, lat: Number(z.lat), lon: Number(z.lon), n: typeof z.n === 'string' ? z.n.slice(0, 60) : '' }))
    .slice(0, MAX_NAVSTEV);
}

/** Návštěvy v období, nejnovější první. */
export function visitsInRange(log, from, to) {
  return (log || []).filter((z) => dayMs(z.d) >= dayMs(from) && dayMs(z.d) <= dayMs(to));
}

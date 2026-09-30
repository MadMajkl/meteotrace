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
 */
export const HISTORY_DAILY = [
  'temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean',
  'precipitation_sum', 'snowfall_sum', 'cloud_cover_mean',
  'wind_gusts_10m_max', 'wind_direction_10m_dominant',
];

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

/** Období ve výběru, v pořadí, v jakém se nabízejí (vzor Gulpka + aktuální rok). */
export const PERIODS = ['7', 'month', 'm3', 'year', 'thisyear', 'lastyear', 'all', 'custom'];

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
 * @returns {{from: string, to: string, years?: boolean}|{empty: true}}
 *   `years: true` = ptát se po rocích (služba `climate`), ne po dnech
 */
export function periodRange(key, today, custom = {}) {
  const vcera = addDays(today, -1);
  const rok = Number(today.slice(0, 4));

  switch (key) {
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

  const prumery = tMean.filter(jeCislo);
  // Dny, ke kterým vůbec něco máme — podle nich se pozná díra v datech.
  const dniSDaty = casy.filter((_, i) => jeCislo(tMax[i]) || jeCislo(srazky[i])).length;
  if (!dniSDaty) return null;

  const soucet = (a) => a.filter(jeCislo).reduce((s, v) => s + v, 0);
  const pocet = (a, podm) => a.filter((v) => jeCislo(v) && podm(v)).length;

  // Převládající směr větru: nejčastější z osmi světových stran. Průměr
  // stupňů nejde — průměr severozápadu (315°) a severovýchodu (45°) je jih.
  const strany = new Map();
  for (const s of smer) {
    const k8 = dir8(s);
    if (!k8) continue;
    strany.set(k8, (strany.get(k8) || 0) + 1);
  }
  let vitr = null;
  for (const [k, n] of strany) if (!vitr || n > vitr.days) vitr = { key: k, days: n };

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
    windDir: vitr,

    tropicalDays: pocet(tMax, (v) => v >= 30),
    frostDays: pocet(tMin, (v) => v < 0),
    snowDays: pocet(snih, (v) => v > 0),
  };
}

/* ============================================================
   GRAF
   ============================================================ */

/**
 * Řada pro graf: sloupce po dnech, týdnech nebo měsících podle délky období.
 *
 * ⚠️ 365 sloupců se na telefon nevejde a nedá se v nich nic přečíst.
 * Hranice: do 45 dní po dnech, do 200 po týdnech, dál po měsících.
 *
 * @returns {{step: 'day'|'week'|'month', points: Array<{from, to, tMax, tMin, precip}>}}
 */
export function chartSeries(daily) {
  const casy = daily?.time || [];
  const n = casy.length;
  const step = n <= 45 ? 'day' : n <= 200 ? 'week' : 'month';
  const tMax = daily?.temperature_2m_max || [];
  const tMin = daily?.temperature_2m_min || [];
  const srazky = daily?.precipitation_sum || [];

  const klic = (i) => {
    if (step === 'day') return casy[i];
    if (step === 'month') return casy[i].slice(0, 7);
    // Týden = sedmice od začátku období (ne kalendářní týden — ten by
    // první a poslední sloupec skoro vždycky uřízl na pár dní).
    return String(Math.floor(i / 7));
  };

  const points = [];
  let cur = null;
  let curKlic = null;
  for (let i = 0; i < n; i++) {
    const k = klic(i);
    if (k !== curKlic) {
      cur = { from: casy[i], to: casy[i], tMax: null, tMin: null, precip: 0 };
      points.push(cur);
      curKlic = k;
    }
    cur.to = casy[i];
    if (jeCislo(tMax[i])) cur.tMax = cur.tMax === null ? tMax[i] : Math.max(cur.tMax, tMax[i]);
    if (jeCislo(tMin[i])) cur.tMin = cur.tMin === null ? tMin[i] : Math.min(cur.tMin, tMin[i]);
    if (jeCislo(srazky[i])) cur.precip += srazky[i];
  }
  return { step, points };
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
  const prumer = (pole) => (pole.length ? pole.reduce((s, r) => s + r.tempMean, 0) / pole.length : null);

  const normal = cele.filter((r) => r.year >= 1961 && r.year <= 1990);
  const posledni = cele.slice(-10);
  const zmena = normal.length >= 25 && posledni.length === 10
    ? prumer(posledni) - prumer(normal) : null;

  return {
    years: cele.length,
    from: cele[0].year,
    to: cele[cele.length - 1].year,
    warmest: nej(cele, 'tempMean', true),
    coldest: nej(cele, 'tempMean', false),
    wettest: nej(cele, 'precipSum', true),
    driest: nej(cele, 'precipSum', false),
    tempMean: prumer(cele),
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

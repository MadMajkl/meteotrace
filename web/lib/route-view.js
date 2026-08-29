/**
 * Počasí na trase — složení plánu a předpovědi do zobrazitelného pohledu.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě. Tady je jádro toho, čím se produkt liší
 * od ostatních meteoappek (`R8`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 HODNOCENÍ MUSÍ BÝT VYSVĚTLITELNÉ, NE MAGICKÉ ČÍSLO.
 *
 * Je svůdné spočítat jedno skóre a seřadit podle něj časy odjezdu. Jenže
 * uživatel se pak nedozví PROČ — a appka, která říká „vyjeď v 16:00" bez
 * důvodu, se neužívá, protože se jí nedá věřit. Proto se vedle skóre vrací
 * i jeho složky: kolik bodů má srážky, kolik je nebezpečných a jaký je
 * nejhorší jev. UI z toho postaví větu, ne graf.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { t, tf, tp } from './i18n.js';
import { formatTemp, formatWind, formatPrecip, windDirKey } from './units.js';
import { weatherKey, weatherIcon, isHazard, weatherKeyWithClouds, weatherIconWithClouds } from './weather-code.js';
import { asLocationList } from './route-adapter.js';

/** Nad kolik procent se déšť považuje za pravděpodobný. */
export const RAIN_PROBABILITY = 40;

/** Vítr, od kterého je řízení nepříjemné (km/h). */
export const STRONG_WIND_KMH = 60;

/**
 * Sloučí naplánované body s předpovědí.
 *
 * @param {object} a
 * @param {ReturnType<import('./eta.js').planRoute>} a.plan
 * @param {object|object[]} a.forecast   odpověď Open-Meteo pro body trasy
 * @param {string} a.lang
 * @param {object} a.units
 * @returns {{points: Array, summary: object}|null}
 */
export function buildRouteView({ plan, forecast, lang, units }) {
  if (!plan?.points?.length) return null;

  const locations = asLocationList(forecast);
  // Předpověď musí sedět na body 1:1. Když nesedí, radši nic než posunutá
  // data — počasí přiřazené špatnému místu je horší než chybějící.
  if (locations.length !== plan.points.length) return null;

  const points = plan.points.map((p, i) => describePoint(p, locations[i], lang, units));

  return { points, summary: summarize(points, lang) };
}

function describePoint(planPoint, location, lang, units) {
  const H = location?.hourly || {};
  const i = planPoint.hourIndex;

  // Nadmořská výška chodí v odpovědi u každého bodu, takže je zadarmo.
  // Není to jen pro letadla: na kole a pěšky je stoupání to, co člověk
  // na trase cítí nejvíc, a u počasí vysvětluje, proč je nahoře chladno.
  // ⚠️ Nula je platná výška (hladina moře), takže se testuje na konečnost,
  // ne na pravdivost.
  const elevationM = Number.isFinite(location?.elevation) ? location.elevation : null;

  // Bod za obzorem předpovědi není chyba — jen se o něm nic neví (viz eta.js).
  if (i == null) {
    return {
      ...planPoint,
      elevationM,
      known: false,
      icon: '❓',
      condition: t('error.beyondForecast', lang),
      hazard: false,
    };
  }

  const code = H.weather_code?.[i];
  const precipProb = H.precipitation_probability?.[i] ?? null;
  const windKmh = H.wind_speed_10m?.[i] ?? null;
  const hazard = isHazard(code) || (windKmh != null && windKmh >= STRONG_WIND_KMH);

  // Oblačnost po patrech. Nízká slunce zakryje, vysoká ho jen zastře —
  // a bod trasy pod cirrem není zataženo.
  const patra = {
    code,
    low: H.cloud_cover_low?.[i],
    mid: H.cloud_cover_mid?.[i],
    high: H.cloud_cover_high?.[i],
  };

  return {
    ...planPoint,
    elevationM,
    known: true,
    code,
    key: weatherKey(code),
    icon: weatherIconWithClouds(patra, true),
    condition: t(`weather.${weatherKeyWithClouds(patra)}`, lang),
    temp: formatTemp(H.temperature_2m?.[i], units, lang),
    // ⚠️ Číslo, ne text: podle něj se rozhoduje (hlášky, prahy). Formátovaná
    // podoba nese jednotku a desetinnou čárku, takže se z ní počítat nedá.
    tempC: Number.isFinite(H.temperature_2m?.[i]) ? H.temperature_2m[i] : null,
    // ⚠️ Pocitovka se ukazuje, JEN když se od teploměru liší — jinak by
    // každý řádek nesl dvakrát totéž číslo a přestalo by se to číst.
    feels: formatTemp(H.apparent_temperature?.[i], units, lang),
    feelsDiffers: liseSe(H.temperature_2m?.[i], H.apparent_temperature?.[i]),
    wind: formatWind(windKmh, units, lang),
    windDir: dirText(H.wind_direction_10m?.[i], lang),
    // ⚠️ Plný název ke zkratce. Kdo neví, co je „VSV", to z appky nemá jak
    // zjistit — a ptát se na význam vlastní obrazovky je vada, ne zvědavost.
    windDirLong: dirLong(H.wind_direction_10m?.[i], lang),
    windDirKey: windDirKey(H.wind_direction_10m?.[i]) || null,
    // ⚠️ Stupně, ne jen klíč směru. Podle nich se počítá, jestli déšť
    // u trasy míří k ní, nebo od ní (`lib/drift.js`) — z osminy kruhu
    // by se ten úhel dal jen odhadnout, a to u směru nestačí.
    windDeg: H.wind_direction_10m?.[i] ?? null,
    windKmh,
    gustKmh: H.wind_gusts_10m?.[i] ?? null,
    gusts: formatWind(H.wind_gusts_10m?.[i], units, lang),
    // 🚨 Náraz se hlásí, až když je citelně nad průměrem. Vítr 20 s nárazy 22
    // je pořád „vítr 20"; 20 s nárazy 55 je něco úplně jiného — a přesně to
    // shodí kluzák nebo drona.
    gustsMatter: jeNarazSilny(windKmh, H.wind_gusts_10m?.[i]),
    precip: formatPrecip(H.precipitation?.[i], units, lang),
    precipProb,
    precipProbText: precipProb == null ? '—' : `${Math.round(precipProb)} %`,
    rain: precipProb != null && precipProb >= RAIN_PROBABILITY,
    hazard,
  };
}

/**
 * Souhrn za celou trasu.
 *
 * Vrací složky, ne jen verdikt — viz poznámka nahoře o vysvětlitelnosti.
 */
function summarize(points, lang) {
  const known = points.filter((p) => p.known);
  const rainy = known.filter((p) => p.rain);
  const hazardous = known.filter((p) => p.hazard);

  // Nejhorší jev se hledá podle závažnosti, ne podle pořadí na trase.
  const RANK = ['hailstorm', 'thunderstorm', 'freezingRain', 'heavySnow', 'snow',
                'snowShowers', 'heavyRain', 'fog', 'rainShowers', 'rain'];
  let worst = null;
  for (const p of hazardous) {
    const r = RANK.indexOf(p.key);
    if (r !== -1 && (worst === null || r < RANK.indexOf(worst.key))) worst = p;
  }

  return {
    total: points.length,
    unknown: points.length - known.length,
    rainCount: rainy.length,
    hazardCount: hazardous.length,
    worst: worst && {
      key: worst.key,
      condition: worst.condition,
      distanceM: worst.distanceM,
      etaMs: worst.etaMs,
    },
    // Skóre je jen na SEŘAZENÍ variant odjezdu, ne k zobrazení.
    // Nebezpečný jev váží víc než déšť; neznámý bod se nepočítá vůbec,
    // aby delší trasa nevycházela hůř jen proto, že sahá za obzor.
    score: rainy.length + hazardous.length * 3,
  };
}

/**
 * Srovnání časů odjezdu — funkce, která je prakticky zadarmo (`R8`).
 *
 * Open-Meteo vrací pro každý bod CELÉ hodinové pole, takže po jednom volání
 * máme počasí ve všech bodech ve všech hodinách. Jiný čas odjezdu = jiný
 * index v už stažených datech, žádný další dotaz.
 *
 * @param {object} a
 * @param {Array} a.options   výstup `departureOptions()` z eta.js
 * @param {object|object[]} a.forecast
 * @param {string} a.lang
 * @param {object} a.units
 * @returns {{options: Array, best: object|null}}
 */
export function compareDepartures({ options, forecast, lang, units }) {
  const scored = options
    .map((o) => {
      const view = buildRouteView({ plan: o.plan, forecast, lang, units });
      // ⚠️ Plán jde s sebou. Každý odjezd má JINÝ čas příjezdu a jinou
      // odpověď na to, jestli část trasy sahá za obzor předpovědi — kdyby
      // se držel jen ten první, ukazoval by souhrn cizí čas.
      return view && { offsetMin: o.offsetMin, departureMs: o.departureMs, plan: o.plan, ...view };
    })
    .filter(Boolean);

  if (!scored.length) return { options: [], best: null };

  // Nejlepší = nejnižší skóre. Při shodě vyhrává dřívější odjezd —
  // nikdo nechce čekat o dvě hodiny déle kvůli stejnému počasí.
  const best = scored.reduce((a, b) => {
    if (b.summary.score !== a.summary.score) return b.summary.score < a.summary.score ? b : a;
    return Math.abs(b.offsetMin) < Math.abs(a.offsetMin) ? b : a;
  });

  return {
    options: scored,
    best,
    // Má vůbec smysl něco doporučovat? Když je to všude stejné, appka
    // má mlčet, ne vymýšlet radu.
    worthMoving: scored.some((o) => o.summary.score !== best.summary.score),
  };
}

/**
 * Liší se pocitová teplota od naměřené natolik, aby stálo za to ji psát?
 *
 * ⚠️ Práh jsou DVA stupně, ne jeden. Při jednom se v appce objevilo
 * „24 °C, pocitově 23 °C" — rozdíl, který nikomu nic neřekne a jen prodlužuje
 * řádek. Pocitovka má smysl, až když mění rozhodnutí: vítr ubere pět stupňů,
 * vlhko v horku jich pár přidá.
 */
function liseSe(teplota, pocitova) {
  if (!Number.isFinite(teplota) || !Number.isFinite(pocitova)) return false;
  return Math.abs(teplota - pocitova) >= 2;
}

/** O kolik musí náraz převýšit průměr, aby to bylo sdělení, a ne šum. */
export const GUST_MARGIN_KMH = 15;

/** Je náraz větru natolik nad průměrem, že se o něm musí říct? */
function jeNarazSilny(vitr, naraz) {
  if (!Number.isFinite(vitr) || !Number.isFinite(naraz)) return false;
  return naraz - vitr >= GUST_MARGIN_KMH;
}

/** Plné jméno směru („východo-severovýchodní"), do bubliny a pro čtečku. */
function dirLong(degrees, lang) {
  const key = windDirKey(degrees);
  return key ? t(`windDirLong.${key}`, lang) : "";
}

function dirText(degrees, lang) {
  const key = windDirKey(degrees);
  return key ? t(`windDir.${key}`, lang) : '—';
}

/** Parametry pro dotaz na předpověď po trase — jen to, co se opravdu použije. */
export const ROUTE_FORECAST_PARAMS = {
  // ⚠️ Pocitová teplota a NÁRAZY větru nejsou navíc, jsou to ty údaje, podle
  // kterých se člověk rozhoduje. Pilotovi řekne náraz víc než průměr, cyklistovi
  // pocitovka víc než teploměr. Stojí to jeden parametr, ne jedno volání navíc.
  hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover_low,cloud_cover_mid,cloud_cover_high',
  timezone: 'auto',
  forecast_days: '3',
};

/**
 * Trasa pro mapu — čára a body i s tím, co se v nich čeká.
 *
 * ⚠️ ČISTÁ FUNKCE. Mapa z ní dostane hotová data; formátování času si dodá
 * volající (`popisek`), protože časové pásmo a jazyk zná obrazovka.
 *
 * 🚨 Barvu bodu určuje TÝŽ příznak, který zvýrazňuje řádek ve výpisu pod
 * mapou. Kdyby si mapa počítala vlastní, mohla by tvrdit něco jiného než
 * seznam kousek pod ní — a uživatel by nevěděl, čemu věřit.
 *
 * @param {{points: Array}} view          výsledek {@link buildRouteView}
 * @param {Array<[number, number]>} line  body trasy jako [šířka, délka]
 * @param {(p: object) => string} popisek text do bubliny nad bodem
 * @returns {{line: Array, points: Array}|null}  `null`, když není co kreslit
 */
export function routeMapData(view, line, popisek = () => '') {
  const cara = Array.isArray(line) ? line.filter(
    (b) => Array.isArray(b) && Number.isFinite(b[0]) && Number.isFinite(b[1]),
  ) : [];
  // Jeden bod není trasa. Kreslit „čáru" o nulové délce by na mapě udělalo
  // tečku, kterou si nikdo nespojí s cestou.
  if (cara.length < 2) return null;

  const points = (view?.points || [])
    .filter((p) => Array.isArray(p.point) && Number.isFinite(p.point[0]))
    .map((p) => ({
      lat: p.point[0],
      lon: p.point[1],
      stav: stavBodu(p),
      popis: popisek(p),
    }));

  return { line: cara, points };
}

/**
 * Jak na tom bod je. Pořadí podmínek je pořadí důležitosti: nebezpečí přebíjí
 * déšť a „nevíme" se nikdy netváří jako „v pořádku".
 */
function stavBodu(p) {
  if (!p.known) return 'unknown';
  if (p.hazard) return 'hazard';
  if (p.rain) return 'rain';
  return 'ok';
}

/**
 * Rada o posunutí odjezdu.
 *
 * 🚨 Musí říct, ČEMU se tím vyhneš. Původní věta zněla „Vyjet o 60 min
 * později vychází líp: Po cestě se nikde nečeká déšť." a byla špatně třikrát:
 * popisovala počasí NOVÉ varianty místo toho, čemu se vyhýbáš; „60 min" nikdo
 * neřekne, když může říct „hodinu"; a `summary.worst` je OBJEKT, takže se do
 * věty dosazovalo „[object Object]", jakmile na trase bylo nebezpečí.
 * (Michalova připomínka 25. 8. 2026.)
 *
 * @param {object} summary   souhrn PRÁVĚ ZOBRAZENÉ varianty — té, které se vyhýbáme
 * @param {number} offsetMin o kolik později se doporučuje vyrazit
 * @param {string} lang
 */
export function departureAdvice(summary, offsetMin, lang) {
  if (!Number.isFinite(offsetMin) || offsetMin <= 0) return '';

  // Celé hodiny se říkají v hodinách. „Vyraž o 120 minut později" je pravda,
  // kterou nikdo nevysloví.
  const delay = offsetMin % 60 === 0
    ? tp('route.delayHours', offsetMin / 60, {}, lang)
    : tp('route.delayMinutes', offsetMin, {}, lang);

  const nejhorsi = summary?.worst?.condition;
  return nejhorsi
    ? tf('route.adviceHazard', { delay, what: nejhorsi.toLowerCase() }, lang)
    : tf('route.adviceRain', { delay }, lang);
}

/**
 * Úseky trasy pro výpis: odkud kam, kolik kilometrů a v kolik tam budeš.
 *
 * ⚠️ ČISTÁ FUNKCE — formátování si dodá volající, protože jednotky a časové
 * pásmo zná obrazovka.
 *
 * 🚨 Když jedu přes zastávky, celkových „97 km" je málo. Zajímá mě, kolik je
 * to k té první a v kolik tam budu — Michal 25. 8. 2026: *„proč to neukazuje
 * vzdálenost mezi úseky a celkem?"*
 *
 * ⚠️ Čas příjezdu do zastávky je součet trvání VŠECH úseků před ní. Počítat
 * ho z podílu celkové vzdálenosti by u dálnice a města vyšlo o desítky minut
 * vedle — proto se sčítají trvání, ne kilometry.
 *
 * @param {Array<{from: object, to: object, distanceM: number, durationS: number}>} useky
 * @param {number} departureMs  čas odjezdu
 * @returns {{rows: Array, totalDistanceM: number, arrivalMs: number}|null}
 */
export function legRows(useky, departureMs) {
  const platne = (useky || []).filter((u) => u && u.from && u.to);
  if (platne.length < 2) return null;   // jeden úsek = obyčejná trasa, rozpis nic nepřidá

  let ujeto = 0;
  let cas = Number(departureMs) || 0;

  const rows = platne.map((u) => {
    ujeto += Number(u.distanceM) || 0;
    cas += (Number(u.durationS) || 0) * 1000;
    return {
      from: u.from.name,
      to: u.to.name,
      distanceM: Number(u.distanceM) || 0,
      arrivalMs: cas,
    };
  });

  return { rows, totalDistanceM: ujeto, arrivalMs: cas };
}

/**
 * Věta o příjezdu: v kolik tam budeš a co tam bude.
 *
 * 🚨 Michal 26. 8. 2026: *„jakože zpráva příjezd v XX:XX v cíli bude tak
 * a tak."* Souhrn dosud říkal jen kilometry a čas — tedy nejmíň zajímavou
 * půlku. Celý smysl appky je to druhé: **co tam zastihneš.**
 *
 * ⚠️ Skládá se z toho, co je v CÍLI, ne z průměru trasy. Průměr by u cesty
 * z mlhy do slunce vyšel jako „oblačno" a nesedělo by ani jedno.
 *
 * ⚠️ Co se neví, se vynechá — věta se nesmí rozpadnout na „, , ." Když
 * nevíme nic (bod za obzorem předpovědi), vrátí se prázdno a UI větu neukáže.
 *
 * @param {object} view   výsledek {@link buildRouteView}
 * @param {string} cas    už naformátovaný čas příjezdu
 * @param {string} lang
 */
export function arrivalSentence(view, cas, lang) {
  const cil = view?.points?.[view.points.length - 1];
  if (!cil || !cil.known) return '';

  const casti = [];
  if (cil.condition) casti.push(cil.condition.toLowerCase());
  if (cil.temp && cil.temp !== '—') casti.push(cil.temp);
  if (cil.feelsDiffers && cil.feels && cil.feels !== '—') {
    casti.push(`${t('now.feelsLike', lang).toLowerCase()} ${cil.feels}`);
  }
  if (cil.wind && cil.wind !== '—') {
    // Celým slovem i tady. Věta o příjezdu je to poslední, co si člověk
    // přečte před vyjetím — zkratka „VJV" v ní nemá co dělat.
    const smerSlovem = cil.windDirLong || (cil.windDir !== '—' ? cil.windDir : '');
    const smer = smerSlovem ? ` ${smerSlovem}` : '';
    casti.push(`${t('now.wind', lang).toLowerCase()} ${cil.wind}${smer}`);
  }
  // Náraz jen když je citelně nad průměrem — viz `jeNarazSilny()`.
  if (cil.gustsMatter && cil.gusts && cil.gusts !== '—') {
    casti.push(`${t('now.gusts', lang).toLowerCase()} ${cil.gusts}`);
  }

  if (!casti.length) return '';
  return tf('route.arrival', { time: cas, what: casti.join(', ') }, lang);
}

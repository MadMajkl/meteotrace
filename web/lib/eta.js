/**
 * ETA jádro — srdce produktu.
 *
 * Odpovídá na otázku: "kdy budu kde a jaká hodina předpovědi pro to místo platí".
 * Nezajímá nás, jak prší v Brně teď, ale jak tam bude pršet, až tam uživatel
 * za tři hodiny dorazí.
 *
 * ⚠️ TENHLE MODUL NESMÍ MÍT ZÁVISLOSTI. Žádné DOM, žádná síť, žádné knihovny.
 * Je to nejlevnější testovatelná vrstva projektu — čistá funkce dovnitř, čistá
 * data ven. Každá nová úvaha o čase, vzdálenosti nebo výběru hodiny patří sem,
 * ne do UI. (Vzor: mailniño `selftest:logic`.)
 *
 * KLÍČOVÉ ROZHODNUTÍ — VŠECHNO UVNITŘ JE EPOCH MILISEKUNDY (UTC).
 * Nikdy se tu nepracuje s místním časem, názvem časové zóny ani s "přičti hodinu".
 * Důvod: poslední březnovou neděli má den 23 hodin a poslední říjnovou 25.
 * Kdo počítá příjezd přičítáním hodin k místnímu času, ten dvakrát ročně minul
 * o hodinu — a právě na podzim a na jaře jsou předpovědi nejzajímavější.
 * Převod na místní čas se dělá až při zobrazení, mimo tenhle modul.
 */

'use strict';

/** Poloměr Země v metrech (střední, WGS-84). */
const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Vzdálenost dvou bodů po povrchu Země v metrech (haversine).
 *
 * Pro naše účely (vzorkování trasy po ~25 km) je haversine víc než dost přesný;
 * chyba proti elipsoidu je řádově desetiny procenta. Přesnější Vincenty by tu
 * byl zbytečný a pomalejší.
 *
 * @param {[number, number]} a  [zeměpisná šířka, délka] ve stupních
 * @param {[number, number]} b  [zeměpisná šířka, délka] ve stupních
 * @returns {number} vzdálenost v metrech
 */
export function distanceM(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Průběžné vzdálenosti od začátku trasy pro každý bod polyline.
 * Vrací pole o stejné délce jako vstup; první prvek je vždy 0.
 *
 * @param {Array<[number, number]>} points
 * @returns {number[]} metry od startu
 */
export function cumulativeDistances(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + distanceM(points[i - 1], points[i]));
  }
  return out;
}

/** Lineární interpolace mezi dvěma body podle podílu t ∈ ⟨0,1⟩. */
function lerpPoint(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Najde bod na trase v dané vzdálenosti od startu.
 * Mezi lomovými body interpoluje lineárně — na úseku kratším než pár kilometrů
 * je rozdíl proti skutečné ortodromě zanedbatelný.
 *
 * @param {Array<[number, number]>} points
 * @param {number[]} cum  výstup z cumulativeDistances
 * @param {number} targetM
 * @returns {[number, number]}
 */
function pointAtDistance(points, cum, targetM) {
  if (targetM <= 0) return points[0];
  const total = cum[cum.length - 1];
  if (targetM >= total) return points[points.length - 1];

  // Binární hledání úseku, do kterého cílová vzdálenost spadá.
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= targetM) lo = mid; else hi = mid;
  }
  const segLen = cum[hi] - cum[lo];
  // Nulový úsek = dva shodné body za sebou (routery je občas vrátí). Nedělit nulou.
  const t = segLen > 0 ? (targetM - cum[lo]) / segLen : 0;
  return lerpPoint(points[lo], points[hi], t);
}

/**
 * Navzorkuje trasu po zadaném kroku.
 *
 * Start a cíl jsou v seznamu VŽDY, i když je trasa kratší než jeden krok —
 * jinak by se u desetikilometrové cesty nevrátilo nic a funkce by mlčky selhala.
 *
 * @param {Array<[number, number]>} points  polyline trasy
 * @param {number} stepM  krok v metrech (výchozí 25 km)
 * @returns {Array<{point: [number, number], distanceM: number}>}
 */
export function sampleRoute(points, stepM = 25000) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (points.length === 1) return [{ point: points[0], distanceM: 0 }];
  if (!(stepM > 0)) throw new RangeError('stepM musí být kladné číslo');

  const cum = cumulativeDistances(points);
  const total = cum[cum.length - 1];
  const out = [];

  for (let d = 0; d < total; d += stepM) {
    out.push({ point: pointAtDistance(points, cum, d), distanceM: d });
  }
  // Cíl přidej vždy — ale ne dvakrát, když na něj krok trefil přesně.
  const last = out[out.length - 1];
  if (!last || total - last.distanceM > 1) {
    out.push({ point: points[points.length - 1], distanceM: total });
  }
  return out;
}

/**
 * Doba jízdy od startu do dané vzdálenosti, v sekundách.
 *
 * PROČ NE PROSTÁ ÚMĚRA: trasa Praha–Brno není stejnoměrná. Prvních deset
 * kilometrů městem trvá stejně jako padesát po dálnici. Kdyby se čas počítal
 * podílem vzdálenosti, vyšel by příjezd do půlky trasy o desítky minut vedle
 * a vybrala by se špatná hodina předpovědi.
 *
 * Proto se staví rychlostní profil z úseků, které vrátil router. Úseky jsou
 * záměrně popsané provider-agnosticky ({distanceM, durationS}) — převod
 * z odpovědi konkrétního routeru patří do jeho adaptéru, ne sem (viz R4:
 * poskytovatel je vyměnitelný).
 *
 * Když úseky nejsou k dispozici, spadne se na úměru — je to lepší než nic,
 * ale volající by měl vědět, že přesnost klesla.
 *
 * @param {number} targetM
 * @param {{totalDistanceM: number, totalDurationS: number, legs?: Array<{distanceM: number, durationS: number}>}} profile
 * @returns {number} sekundy od odjezdu
 */
export function durationToDistance(targetM, profile) {
  const { totalDistanceM, totalDurationS, legs } = profile;
  if (targetM <= 0) return 0;
  if (!(totalDistanceM > 0)) return 0;
  if (targetM >= totalDistanceM) return totalDurationS;

  if (!Array.isArray(legs) || legs.length === 0) {
    return totalDurationS * (targetM / totalDistanceM);   // nouzová úměra
  }

  let dist = 0, time = 0;
  for (const leg of legs) {
    if (dist + leg.distanceM >= targetM) {
      const within = leg.distanceM > 0 ? (targetM - dist) / leg.distanceM : 0;
      return time + leg.durationS * within;
    }
    dist += leg.distanceM;
    time += leg.durationS;
  }
  // Součet úseků nedosáhl cíle (zaokrouhlení u routeru) — dojeď úměrou zbytku.
  const restM = totalDistanceM - dist;
  const restS = totalDurationS - time;
  return restM > 0 ? time + restS * ((targetM - dist) / restM) : time;
}

/**
 * Vybere index hodiny v poli časů z Open-Meteo.
 *
 * ZAOKROUHLUJE SE NA NEJBLIŽŠÍ HODINU, ne dolů. Kdo dorazí v 15:55, toho
 * zajímá počasí v 16:00, ne v 15:00 — hodinová pole nesou stav v celou.
 *
 * Vrací null, když čas leží mimo dosah předpovědi. To NENÍ chyba, ale běžný
 * stav: kdo plánuje cestu na příští týden, je za obzorem modelu. Volající to
 * musí umět zobrazit ("na tuhle dobu ještě předpověď není"), ne spadnout.
 *
 * @param {number} timeMs  epoch ms (UTC)
 * @param {number[]} hourMs  vzestupné pole časů hodin v epoch ms
 * @returns {number|null} index, nebo null když je čas mimo rozsah
 */
export function hourIndexFor(timeMs, hourMs) {
  if (!Array.isArray(hourMs) || hourMs.length === 0) return null;

  const HOUR = 3600000;
  const first = hourMs[0];
  const last = hourMs[hourMs.length - 1];

  // Půl hodiny tolerance na okrajích = zaokrouhlení na nejbližší, ne uříznutí.
  if (timeMs < first - HOUR / 2) return null;
  if (timeMs > last + HOUR / 2) return null;

  // Binární hledání nejbližší hodnoty. Pole z Open-Meteo je vždy vzestupné
  // a rovnoměrné, ale nespoléhat se na krok — API umí i 3hodinový rastr.
  let lo = 0, hi = hourMs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (hourMs[mid] <= timeMs) lo = mid; else hi = mid;
  }
  return Math.abs(hourMs[lo] - timeMs) <= Math.abs(hourMs[hi] - timeMs) ? lo : hi;
}

/**
 * Hlavní funkce: rozloží trasu na body a ke každému přiřadí čas příjezdu
 * a index hodiny v předpovědi.
 *
 * @param {object} args
 * @param {Array<[number, number]>} args.points  polyline trasy
 * @param {number} args.totalDistanceM
 * @param {number} args.totalDurationS
 * @param {Array<{distanceM: number, durationS: number}>} [args.legs]  rychlostní profil
 * @param {number} args.departureMs  epoch ms (UTC)
 * @param {number[]} [args.hourMs]  časy hodin z předpovědi, epoch ms
 * @param {number} [args.stepM=25000]
 * @returns {{
 *   points: Array<{point: [number,number], distanceM: number, etaMs: number, hourIndex: number|null}>,
 *   arrivalMs: number,
 *   beyondForecast: boolean,
 *   estimated: boolean
 * }}
 */
export function planRoute(args) {
  const {
    points, totalDistanceM, totalDurationS, legs,
    departureMs, hourMs, stepM = 25000,
  } = args;

  const samples = sampleRoute(points, stepM);
  const profile = { totalDistanceM, totalDurationS, legs };

  const out = samples.map((s) => {
    const etaMs = departureMs + durationToDistance(s.distanceM, profile) * 1000;
    return {
      point: s.point,
      distanceM: s.distanceM,
      etaMs,
      hourIndex: hourMs ? hourIndexFor(etaMs, hourMs) : null,
    };
  });

  return {
    points: out,
    arrivalMs: departureMs + totalDurationS * 1000,
    // Aspoň jeden bod je za obzorem předpovědi → UI to musí říct nahlas.
    beyondForecast: !!hourMs && out.some((p) => p.hourIndex === null),
    // Počítalo se úměrou místo rychlostního profilu → nižší přesnost.
    estimated: !Array.isArray(legs) || legs.length === 0,
  };
}

/**
 * Srovnání časů odjezdu — funkce, která je prakticky zadarmo.
 *
 * Open-Meteo nevrací pro bod jedno číslo, ale CELÉ HODINOVÉ POLE. Po jednom
 * volání tedy máme v paměti počasí ve všech bodech ve všech hodinách. Otázka
 * "a co když vyjedu o dvě hodiny později" je pak jen čtení jiného indexu
 * v datech, která už jsou stažená — žádný další dotaz, žádné čekání.
 *
 * Vrací jednu variantu na každý nabízený posun. Skóre si počítá volající
 * (my ještě nevíme, co je "špatné počasí" — to je věc vyhodnocení výstrah).
 *
 * @param {object} args  jako planRoute, bez departureMs
 * @param {number} args.baseDepartureMs
 * @param {number[]} args.offsetsMin  posuny v minutách, např. [-60, 0, 60, 120]
 * @returns {Array<{offsetMin: number, departureMs: number, plan: ReturnType<planRoute>}>}
 */
export function departureOptions(args) {
  const { baseDepartureMs, offsetsMin, ...rest } = args;
  return offsetsMin.map((offsetMin) => {
    const departureMs = baseDepartureMs + offsetMin * 60000;
    return { offsetMin, departureMs, plan: planRoute({ ...rest, departureMs }) };
  });
}

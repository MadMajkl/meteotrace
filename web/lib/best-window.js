/**
 * Nejlepší okno na kolo, běh nebo procházku — „Zítra 14–16: sucho,
 * 16 až 19 °C, vítr do 12 km/h" (`R43`).
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě, bez `Date.now()`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ
 *
 * Třetí z „top pecek", které Miki 13. 10. 2026 vybral. Hodinová předpověď
 * se stahuje tak jako tak (meteostanice), takže odpověď na „kdy ven?"
 * nestojí ani jeden dotaz navíc — je to zobecnění srovnání odjezdů (`R8`).
 *
 * 🚨 VYSVĚTLITELNÉ, NE MAGICKÉ ČÍSLO (jako `route-view.js`). Skóre slouží
 * jen k výběru; člověk dostane větu s fakty, podle kterých se rozhodne sám
 * — a podle kterých pozná, když se appka splete.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { t, tf } from './i18n.js';
import { parseLocalTime, isDaylight } from './station.js';
import { formatTempRange, formatWind } from './units.js';
import { isHazard } from './weather-code.js';
import { clock, dayShift } from './when.js';

const H = 3600000;

/**
 * Profily aktivit. Teploty jsou POCITOVÉ (°C) — člověk venku cítí vítr,
 * ne teploměr. `idealni` = bez výhrad, `mez` = ještě se dá; za mezí
 * hodina nepřipadá v úvahu. Vítr a nárazy v km/h, déšť v % pravděpodobnosti.
 *
 * ⚠️ Čísla jsou odhad z běžné zkušenosti, ne z měření — kdo jezdí v zimě,
 * by si je nastavil jinak. Proto se ve větě vždycky ukáže, PROČ okno vyšlo.
 */
export const AKTIVITY = {
  kolo: { hodin: 2, idealni: [12, 24], mez: [3, 32], vitr: 18, vitrMez: 32, naraz: 45, dest: 15 },
  beh: { hodin: 1, idealni: [5, 17], mez: [-6, 27], vitr: 22, vitrMez: 40, naraz: 55, dest: 25 },
  prochazka: { hodin: 2, idealni: [10, 24], mez: [-3, 30], vitr: 22, vitrMez: 45, naraz: 60, dest: 25 },
};

export const VYCHOZI = 'kolo';

/** Kolik hodin dopředu se hledá — stejně jako hodinový pruh na stanici. */
export const DOSAH_HODIN = 48;

/**
 * Skóre jedné hodiny: 100 = ideál, 0 = nejde. A když nejde, PROČ.
 *
 * @returns {{skore: number, proc: null|'tma'|'dest'|'jev'|'zima'|'horko'|'vitr'}}
 */
export function skoreHodiny(h, profil) {
  if (!h.den) return { skore: 0, proc: 'tma' };
  if (isHazard(h.kod) && !(h.kod >= 51 && h.kod <= 67) && !(h.kod >= 80 && h.kod <= 82)) {
    // Bouřka, sněžení, mrznoucí déšť, mlha — jev, ne jen kapky.
    return { skore: 0, proc: 'jev' };
  }
  if ((h.srazky || 0) > 0.1 || (h.pst ?? 0) >= profil.dest * 2) return { skore: 0, proc: 'dest' };
  const [imin, imax] = profil.idealni;
  const [mmin, mmax] = profil.mez;
  if (!Number.isFinite(h.pocit)) return { skore: 0, proc: 'zima' };
  if (h.pocit < mmin) return { skore: 0, proc: 'zima' };
  if (h.pocit > mmax) return { skore: 0, proc: 'horko' };
  if ((h.vitr || 0) > profil.vitrMez || (h.naraz || 0) > profil.naraz) return { skore: 0, proc: 'vitr' };

  let pokuta = 0;
  if (h.pocit < imin) pokuta += 45 * (imin - h.pocit) / (imin - mmin);
  if (h.pocit > imax) pokuta += 45 * (h.pocit - imax) / (mmax - imax);
  if ((h.vitr || 0) > profil.vitr) pokuta += 35 * ((h.vitr - profil.vitr) / (profil.vitrMez - profil.vitr));
  if ((h.pst ?? 0) > 0) pokuta += 25 * Math.min(1, h.pst / (profil.dest * 2));
  return { skore: Math.max(1, Math.round(100 - pokuta)), proc: null };
}

/**
 * Hodiny z odpovědi Open-Meteo pro meteostanici → pole pro hodnocení.
 *
 * ⚠️ Den podle východu a západu SLUNCE v místě, ne podle hodin (`isDaylight`).
 * Hodina se počítá za denní, když je světlo v její půlce.
 */
export function hodinyZPredpovedi(forecast) {
  const Hh = forecast?.hourly;
  if (!Hh?.time) return [];
  const off = forecast.utc_offset_seconds || 0;
  const D = forecast.daily || {};
  const vychody = (D.sunrise || []).map((s) => parseLocalTime(s, off));
  const zapady = (D.sunset || []).map((s) => parseLocalTime(s, off));
  const dny = (D.time || []);
  return Hh.time.map((s, i) => {
    const ms = parseLocalTime(s, off);
    const d = dny.indexOf(String(s).slice(0, 10));
    const den = d >= 0 ? isDaylight(ms + H / 2, vychody[d], zapady[d]) : true;
    return {
      ms,
      den,
      kod: Hh.weather_code?.[i],
      teplota: Hh.temperature_2m?.[i],
      pocit: Number.isFinite(Hh.apparent_temperature?.[i]) ? Hh.apparent_temperature[i] : Hh.temperature_2m?.[i],
      pst: Hh.precipitation_probability?.[i],
      srazky: Hh.precipitation?.[i],
      vitr: Hh.wind_speed_10m?.[i],
      naraz: Hh.wind_gusts_10m?.[i],
    };
  });
}

/**
 * Nejlepší souvislé okno o délce profilu v příštích {@link DOSAH_HODIN} hodinách.
 *
 * Okno hodnotí jeho NEJHORŠÍ hodina — hodina deště uprostřed jízdy ji
 * pokazí celou, i když zbytek je krásný. Při shodě (do 3 bodů) vyhrává
 * dřívější: nikdo nechce čekat do zítřka kvůli o kousek lepšímu.
 *
 * @returns {{start: number, konec: number, skore: number, hodiny: Array}|{nic: true, proc: string}}
 */
export function nejlepsiOkno(hodiny, aktivita, nowMs) {
  const profil = AKTIVITY[aktivita] || AKTIVITY[VYCHOZI];
  // Od příští celé hodiny — okno, které už běží, nejde stihnout celé.
  const od = Math.ceil(nowMs / H) * H;
  const vyber = hodiny.filter((h) => h.ms >= od && h.ms < od + DOSAH_HODIN * H);
  const hodnoceni = vyber.map((h) => ({ ...h, ...skoreHodiny(h, profil) }));

  let nej = null;
  for (let i = 0; i + profil.hodin <= hodnoceni.length; i++) {
    const okno = hodnoceni.slice(i, i + profil.hodin);
    // Souvislé hodiny — díra v datech není „hodina bez deště".
    if (okno.some((h, k) => k && h.ms - okno[k - 1].ms !== H)) continue;
    const min = Math.min(...okno.map((h) => h.skore));
    if (min <= 0) continue;
    const prumer = okno.reduce((s, h) => s + h.skore, 0) / okno.length;
    if (!nej || min > nej.skore + 3 || (Math.abs(min - nej.skore) <= 3 && prumer > nej.prumer + 3)) {
      nej = { start: okno[0].ms, konec: okno[okno.length - 1].ms + H, skore: min, prumer, hodiny: okno };
    }
  }
  if (nej) return nej;

  // Nic se nenašlo — řekne se, co bránilo nejčastěji. „Nic" bez důvodu
  // vypadá jako rozbitá funkce.
  const pocty = {};
  for (const h of hodnoceni) if (h.proc && h.proc !== 'tma') pocty[h.proc] = (pocty[h.proc] || 0) + 1;
  const proc = Object.entries(pocty).sort((a, b) => b[1] - a[1])[0]?.[0] || (hodnoceni.length ? 'tma' : 'data');
  return { nic: true, proc };
}

/** Kvalita okna slovem — podle nejhorší hodiny. */
export function kvalita(skore) {
  if (skore >= 85) return 'skvele';
  if (skore >= 60) return 'dobre';
  return 'snesitelne';
}

/**
 * Věta k oknu: „Zítra 14:00–16:00 · sucho, 16 až 19 °C, vítr do 12 km/h".
 *
 * @param {object} okno  výsledek {@link nejlepsiOkno}
 * @param {object} a     {lang, units, timeZone, nowMs}
 */
export function textOkna(okno, { lang = 'en', units, timeZone = 'UTC', nowMs }) {
  if (!okno || okno.nic) return t(`bestWindow.none.${okno?.proc || 'data'}`, lang);
  const posun = dayShift(okno.start, nowMs, timeZone);
  const den = posun === 0 ? t('bestWindow.today', lang)
    : posun === 1 ? t('bestWindow.tomorrow', lang)
      : t('bestWindow.later', lang);
  const pocity = okno.hodiny.map((h) => h.pocit).filter(Number.isFinite);
  const vitr = Math.max(...okno.hodiny.map((h) => h.vitr || 0));
  const pst = Math.max(...okno.hodiny.map((h) => h.pst || 0));
  const casti = [
    pst >= 15 ? tf('bestWindow.rainChance', { p: Math.round(pst) }, lang) : t('bestWindow.dry', lang),
    tf('bestWindow.feels', {
      range: formatTempRange(Math.min(...pocity), Math.max(...pocity), units, lang, tf),
    }, lang),
    tf('bestWindow.wind', { w: formatWind(vitr, units, lang) }, lang),
  ];
  return tf('bestWindow.line', {
    day: den,
    from: clock(okno.start, timeZone, lang),
    to: clock(okno.konec, timeZone, lang),
    what: casti.join(', '),
  }, lang);
}

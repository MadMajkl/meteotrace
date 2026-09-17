/**
 * Ranní a večerní zpráva o počasí (`R25`).
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě — dostane odpověď Open-Meteo a vrátí
 * hotovou větu. „Teď" dodává volající, ať jde otestovat ráno i večer.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO SKLÁDÁ SERVER, A NE OBAL
 *
 * Androidí obal **nic nerozhoduje** (`R13`) a u výstrah se to už jednou
 * vyplatilo (`R17`): kdyby měl vlastní tabulku, rozešla by se s appkou
 * a poznalo by se to tím, že zpráva mlčí nebo tvrdí něco jiného než
 * obrazovka. Obal proto zavolá, dostane hotový text a zazvoní.
 *
 * ⚠️ Text se skládá v JAZYCE APPKY, ne systému. Jazyk chodí jako parametr,
 * stejně jako práh u výstrah.
 *
 * 🚨 VÝSTRAHY SEM NEPATŘÍ. Chodí vlastní cestou každých 15 minut (`R17`).
 * Kdyby je opakovala i ranní zpráva, zvonilo by se na touž věc dvakrát —
 * a druhé zazvonění vypadá jako nová výstraha.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { t, tf } from './i18n.js';
import { weatherKey } from './weather-code.js';
import { formatTemp, formatWind, convert } from './units.js';

/** Co se stahuje kvůli zprávě. Dva dny stačí: dnešek a zítřek. */
export const BRIEF_PARAMS = {
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
  timezone: 'auto',
  forecast_days: '2',
};

/** Od téhle pravděpodobnosti srážek se o dešti píše. Níž je to šum. */
export const RAIN_MENTION = 40;

/** Od téhle rychlosti (km/h) se zmiňuje vítr — od té doby mění, co si vzít na sebe. */
export const WIND_MENTION = 40;

/** Druhy zprávy. Ranní mluví o dnešku, večerní o zítřku. */
export const KINDS = ['morning', 'evening'];

/**
 * Datum v pásmu místa, ve tvaru, jaký vrací Open-Meteo v `daily.time`.
 *
 * ⚠️ Počítá se z `utc_offset_seconds` z TÉŽE odpovědi, ne z pásma serveru.
 * Netlify běží v UTC, takže „dnes" podle serveru je pro uživatele v Praze
 * po 22:00 už včerejšek — a ranní zpráva by mluvila o špatném dni.
 */
function denVMiste(ms, posunS) {
  return new Date(ms + (Number(posunS) || 0) * 1000).toISOString().slice(0, 10);
}

/**
 * Který den z předpovědi se má popsat.
 *
 * `morning` = dnešek, `evening` = zítřek. Když ten den v odpovědi není
 * (stáhlo se málo dní, jsme za obzorem), vrací `-1` a volající **nesmí
 * zvonit**: zpráva o dni, o kterém nic nevíme, je horší než žádná.
 */
export function indexDne({ forecast, kind, nowMs }) {
  const dny = forecast?.daily?.time;
  if (!Array.isArray(dny) || !dny.length) return -1;
  const dnes = denVMiste(nowMs, forecast.utc_offset_seconds);
  const i = dny.indexOf(dnes);
  if (i < 0) return -1;
  return kind === 'evening' ? (i + 1 < dny.length ? i + 1 : -1) : i;
}

/**
 * Text zprávy — jedna věta, kterou jde přečíst na zamčeném displeji.
 *
 * Tvar: „Dnes 8 až 19 °C · polojasno, déšť 60 %, vítr až 45 km/h"
 *
 * ⚠️ Pořadí je schválně takové: teplota první, protože podle ní se člověk
 * obléká; jev druhý; déšť a vítr jen tehdy, když opravdu něco mění.
 *
 * @returns {{text: string, den: string, kind: string}|null} `null` = nemáme co říct
 */
export function briefText({ forecast, kind, nowMs, lang = 'en', units }) {
  if (!KINDS.includes(kind)) return null;
  const i = indexDne({ forecast, kind, nowMs });
  if (i < 0) return null;

  const d = forecast.daily;
  const min = d.temperature_2m_min?.[i];
  const max = d.temperature_2m_max?.[i];
  // 🚨 Bez teplot zpráva nedává smysl. Radši nic než „Dnes — · polojasno".
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  const den = t(kind === 'evening' ? 'brief.tomorrow' : 'brief.today', lang);
  const jev = t(`weather.${weatherKey(d.weather_code?.[i])}`, lang);

  const casti = [jev];

  const dest = d.precipitation_probability_max?.[i];
  if (Number.isFinite(dest) && dest >= RAIN_MENTION) {
    casti.push(tf('brief.rain', { p: Math.round(dest) }, lang));
  }

  const vitr = d.wind_speed_10m_max?.[i];
  if (Number.isFinite(vitr) && vitr >= WIND_MENTION) {
    casti.push(tf('brief.wind', { w: formatWind(vitr, units, lang) }, lang));
  }

  // ⚠️ Jednotka se píše JEN u druhého čísla: „8 až 19 °C", ne
  // „8 °C až 19 °C". Dvakrát tentýž symbol v jedné větě je šum a na
  // zamčeném displeji zabírá místo, které chybí jevu.
  const text = tf('brief.line', {
    day: den,
    min: Math.round(convert.temp(min, units.temp)),
    max: formatTemp(max, units, lang),
    what: casti.join(', '),
  }, lang);

  return { text, den: d.time[i], kind };
}

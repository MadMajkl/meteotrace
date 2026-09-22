/**
 * Widget na ploše (`R29`) — co ukázat a jakými barvami.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě — dostane odpověď Open-Meteo a vrátí
 * HOTOVÉ ŘETĚZCE a barvy. „Teď" dodává volající, ať jde otestovat den i noc.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 STAVÍ SE NAD `buildStationView()`, NE VEDLE NĚJ
 *
 * Widget a meteostanice musí říkat totéž. Kdyby měl widget vlastní výběr
 * ikony a slova, rozešly by se při první opravě — a jako první by se rozešly
 * zrovna v tom, na čem appce záleží nejvíc: „zataženo" jen vysoko NENÍ
 * zataženo (`jenZavoj()`), a kdy začne pršet se počítá s prahem 40 %
 * (`rainSoon`). Tady se to jen přebírá a zkracuje.
 *
 * PROČ TO SKLÁDÁ SERVER, A NE OBAL (stejně jako `R17` a `R28`)
 *
 * Obal widget jen KRESLÍ. Kdyby si text a barvy skládal sám, musel by znát
 * kódy počasí, jednotky a jazyk — tři tabulky, které se rozejdou s appkou.
 * Proto sem patří i BARVY OBLOHY: podle počasí se rozhoduje, a rozhodování
 * v obalu nemá co dělat.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { t, tf } from './i18n.js';
import { weatherKey, weatherKeyWithClouds } from './weather-code.js';
import { formatTempShort } from './units.js';
import { buildStationView, FORECAST_PARAMS } from './station.js';
import { momentParts } from './when.js';

/**
 * Co se stahuje. Tatáž sada jako pro meteostanici — jinak by widget neměl
 * patra oblačnosti ani záření a „slunce přes závoj" by v něm bylo zataženo.
 * Dva dny stačí: dnešek na max/min a dvanáct hodin dopředu přes půlnoc.
 */
export const WIDGET_PARAMS = { ...FORECAST_PARAMS, forecast_days: '2' };

/**
 * Kolik hodin dopředu se posílá.
 *
 * ⚠️ Víc, než se vejde do widgetu (ten ukáže šest). Obal zahazuje hodiny,
 * které mezitím uplynuly — kdyby se telefon hodinu nedostal k síti,
 * s šesti hodinami v záloze by mu na pruh nezbylo.
 */
export const WIDGET_HOURS = 12;

/**
 * Barvy oblohy: přechod shora dolů a záře (slunce, měsíc, blesk).
 *
 * ⚠️ Na všech je BÍLÝ text, takže spodní barva nesmí být světlá — i sníh
 * je proto šedomodrý, ne bílý. Hlídá to samotest (kontrast vůči bílé).
 * `zare: null` = bez záře; zatažená obloha nemá odkud svítit.
 */
export const SKY = {
  // 🚨 Spodní modrá byla původně #5AA5E8 — hezká, ale s bílým textem jen
  // 2,6:1 a drobné hodiny dole se na ní nedaly přečíst. Chytil to samotest.
  jasnoDen:     { od: '#1B63C6', do: '#358AD4', zare: '#FFD36A' },
  polojasnoDen: { od: '#2E6CB0', do: '#5B89B8', zare: '#FFE39A' },
  zatazenoDen:  { od: '#4E5D70', do: '#7A8898', zare: null },
  mlha:         { od: '#56616E', do: '#7D8793', zare: null },
  dest:         { od: '#2C3E55', do: '#4F6782', zare: '#7FB2FF' },
  bourka:       { od: '#241F42', do: '#463C70', zare: '#B9A4FF' },
  snih:         { od: '#3F5C80', do: '#6787AA', zare: '#E8F1FF' },
  // ⚠️ Bez hvězd. Byly tu — a na náhledu 22. 9. 2026 se tečka vedle „17°"
  // četla jako desetinná čárka a u „01:00" jako interpunkce. Tvar mění
  // význam; do plochy s čísly se tečky nekreslí.
  jasnoNoc:     { od: '#0A1430', do: '#20335E', zare: '#C9D6FF' },
  zatazenoNoc:  { od: '#121925', do: '#2A3547', zare: null },
};

/** Klíč počasí → obloha. Co tu není, spadne na zataženo. */
const OBLOHA = {
  clear: 'jasno', mostlyClear: 'jasno', veiledSun: 'jasno',
  partlyCloudy: 'polojasno',
  overcast: 'zatazeno', unknown: 'zatazeno',
  fog: 'mlha',
  drizzle: 'dest', rain: 'dest', heavyRain: 'dest', rainShowers: 'dest', freezingRain: 'dest',
  snow: 'snih', heavySnow: 'snih', snowShowers: 'snih',
  thunderstorm: 'bourka', hailstorm: 'bourka',
};

/**
 * Které nebe podle počasí a denní doby.
 *
 * ⚠️ V noci se liší jen jasno a zbytek. Déšť, bouřka a sníh si barvu
 * nechávají — jejich obloha je tmavá i ve dne a v noci je to pořád
 * ta nejdůležitější zpráva.
 */
export function skyKey(weatherKey, isDay) {
  const druh = OBLOHA[weatherKey] || 'zatazeno';
  if (druh === 'dest' || druh === 'bourka' || druh === 'snih') return druh;
  if (!isDay) return druh === 'jasno' || druh === 'polojasno' ? 'jasnoNoc' : 'zatazenoNoc';
  if (druh === 'jasno') return 'jasnoDen';
  if (druh === 'polojasno') return 'polojasnoDen';
  if (druh === 'mlha') return 'mlha';
  return 'zatazenoDen';
}

/**
 * „16:00", „zítra 03:00", „20. 9. 03:00" — den se píše, jakmile není dnešní.
 *
 * 🚨 Stejné pravidlo jako u bodů trasy (`when.js`): „Od 03:00 déšť"
 * napsané ve 22:00 se čte jako dnes, a je to zítra.
 */
function kdy(ms, nowMs, timeZone, lang) {
  const p = momentParts(ms, nowMs, timeZone, lang);
  if (!p) return '';
  if (p.shift === 0) return p.time;
  if (p.shift === 1) return tf('when.tomorrow', { time: p.time }, lang);
  return tf('when.date', { date: p.date, time: p.time }, lang);
}

/** Padá sníh? Mrznoucí déšť je pořád déšť — padá jako voda. */
function jeSnih(code) {
  return ['snow', 'heavySnow', 'snowShowers'].includes(weatherKey(code));
}

/**
 * Věta o srážkách na dvanáct hodin dopředu.
 *
 * ⚠️ Čtyři stavy a žádný nesmí vypadat jako jiný: začne · přestane ·
 * padá a nepřestane · nic nespadne. `clearSoon.prsiTed` odliší „nepadá"
 * od „padá a v dohledu to nekončí" — bez něj by se „nevíme" četlo jako
 * „hned to přejde".
 *
 * 🚨 A DÉŠŤ, NEBO SNÍH. `rainSoon` a `clearSoon` se dívají jen na
 * pravděpodobnost a úhrn, ne na skupenství — v náhledu widgetu pak za
 * sněžení stálo „Příštích 12 hodin bude pršet" (22. 9. 2026). Skupenství
 * se proto bere z kódu té hodiny, o které věta mluví.
 */
function vetaOSrazkach(view, nowMs, lang) {
  const tz = view.timeZone;
  const dvanactHodin = nowMs + 12 * 3600 * 1000;
  const cs = view.clearSoon;
  if (cs?.prsiTed) {
    const snih = jeSnih(view.current.code);
    const ms = Number.isInteger(cs.hours) ? view.hourly[cs.hours]?.timeMs : null;
    if (ms) return { text: tf(snih ? 'widget.snowStops' : 'widget.dryAt', { when: kdy(ms, nowMs, tz, lang) }, lang), do: ms };
    return { text: t(snih ? 'widget.keepsSnowing' : 'widget.keepsRaining', lang), do: dvanactHodin };
  }
  const rs = view.rainSoon;
  if (rs && Number.isInteger(rs.hours)) {
    const h = view.hourly[rs.hours];
    if (h?.timeMs) {
      return { text: tf(jeSnih(h.code) ? 'widget.snowAt' : 'widget.rainAt', { when: kdy(h.timeMs, nowMs, tz, lang) }, lang), do: h.timeMs };
    }
  }
  return { text: t('widget.dry', lang), do: dvanactHodin };
}

/**
 * Obsah widgetu.
 *
 * @param {object} a
 * @param {object} a.forecast   odpověď Open-Meteo s `WIDGET_PARAMS`
 * @param {string} a.lang
 * @param {object} a.units
 * @param {number} a.nowMs
 * @returns {object|null}  `null` = nemáme co ukázat (obal nechá poslední stav)
 */
export function widgetModel({ forecast, lang = 'en', units, nowMs }) {
  const view = buildStationView({ forecast, lang, units, nowMs, hours: WIDGET_HOURS + 1 });
  if (!view) return null;

  const c = view.current;
  // 🚨 Bez teploty widget nedává smysl. Radši nic než velké „—" na ploše,
  // které vypadá jako rozbitá appka. Obal pak nechá poslední platný stav
  // a ten nese čas, takže je vidět, jak je starý.
  if (!Number.isFinite(c.tempC)) return null;

  const dnes = forecast.daily || {};
  const klic = weatherKeyWithClouds({
    code: c.code, low: c.cloudLow, mid: c.cloudMid, high: c.cloudHigh,
    direct: c.directW, total: c.totalW, isDay: c.isDay,
  });

  // Hodiny: od PŘÍŠTÍ celé hodiny. Ta aktuální už je velkým číslem nahoře.
  const hodiny = view.hourly.slice(1, WIDGET_HOURS + 1).map((h) => ({
    ms: h.timeMs,
    cas: h.time,
    ikona: h.icon,
    teplota: formatTempShort(h.tempC, units, lang),
  }));

  const max = dnes.temperature_2m_max?.[0];
  const min = dnes.temperature_2m_min?.[0];
  const veta = vetaOSrazkach(view, nowMs, lang);

  return {
    v: 1,
    teplota: formatTempShort(c.tempC, units, lang),
    ikona: c.icon,
    popis: c.condition,
    pocitove: Number.isFinite(c.feelsC)
      ? tf('widget.feels', { temp: formatTempShort(c.feelsC, units, lang) }, lang)
      : '',
    maxMin: Number.isFinite(max) && Number.isFinite(min)
      ? tf('widget.hiLo', { hi: formatTempShort(max, units, lang), lo: formatTempShort(min, units, lang) }, lang)
      : '',
    veta: veta.text,
    // 🚨 Do kdy věta platí (epoch ms). Widget visí na ploše i bez sítě;
    // „Od 15:00 déšť" načtené v deset dopoledne je v šest večer už jen
    // šum — obal větu po tomhle okamžiku schová, místo aby ji opakoval.
    vetaDo: veta.do,
    hodiny,
    pozadi: SKY[skyKey(klic, c.isDay)],
    vydano: nowMs,
  };
}

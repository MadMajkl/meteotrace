/**
 * Kódy počasí WMO → klíč a ikona.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě.
 *
 * Open-Meteo vrací `weather_code` podle číselníku WMO 4677. Je jich přes
 * devadesát, ale pro uživatele jich dává smysl zhruba patnáct — nikoho
 * nezajímá rozdíl mezi „slabým mrholením“ a „mrholením mírné intenzity“,
 * zajímá ho, jestli si má vzít bundu.
 *
 * Vrací se KLÍČ, ne text. Překlad je věc jazyka (`R10`).
 *
 * ⚠️ Neznámý kód se NESMÍ tiše překlopit na „jasno“. Číselník se může
 * rozšířit a appka, která mlčky hlásí slunce, je horší než ta, co přizná,
 * že neví.
 */

'use strict';

/** Skupiny kódů → klíč. První shoda vyhrává. */
const GROUPS = [
  { key: 'clear',        codes: [0] },
  { key: 'mostlyClear',  codes: [1] },
  { key: 'partlyCloudy', codes: [2] },
  { key: 'overcast',     codes: [3] },
  { key: 'fog',          codes: [45, 48] },
  { key: 'drizzle',      codes: [51, 53, 55] },
  { key: 'freezingRain', codes: [56, 57, 66, 67] },
  { key: 'rain',         codes: [61, 63] },
  { key: 'heavyRain',    codes: [65] },
  { key: 'snow',         codes: [71, 73, 77] },
  { key: 'heavySnow',    codes: [75] },
  { key: 'rainShowers',  codes: [80, 81, 82] },
  { key: 'snowShowers',  codes: [85, 86] },
  { key: 'thunderstorm', codes: [95] },
  { key: 'hailstorm',    codes: [96, 99] },
];

/** Emoji pro den a pro noc. U jevů, kde na denní době nezáleží, je obojí stejné. */
const ICONS = {
  clear:        { day: '☀️', night: '🌙' },
  mostlyClear:  { day: '🌤️', night: '🌙' },
  partlyCloudy: { day: '⛅', night: '☁️' },
  overcast:     { day: '☁️', night: '☁️' },
  // Slunce za závojem vysoké oblačnosti — viz `jenZavoj()`.
  veiledSun:    { day: '🌥️', night: '☁️' },
  fog:          { day: '🌫️', night: '🌫️' },
  drizzle:      { day: '🌦️', night: '🌧️' },
  freezingRain: { day: '🌧️', night: '🌧️' },
  rain:         { day: '🌧️', night: '🌧️' },
  heavyRain:    { day: '🌧️', night: '🌧️' },
  snow:         { day: '🌨️', night: '🌨️' },
  heavySnow:    { day: '❄️', night: '❄️' },
  rainShowers:  { day: '🌦️', night: '🌧️' },
  snowShowers:  { day: '🌨️', night: '🌨️' },
  thunderstorm: { day: '⛈️', night: '⛈️' },
  hailstorm:    { day: '⛈️', night: '⛈️' },
  unknown:      { day: '❓', night: '❓' },
};

/**
 * Kód → klíč počasí.
 * @param {number} code
 * @returns {string} klíč, nebo 'unknown'
 */
export function weatherKey(code) {
  if (!Number.isInteger(code)) return 'unknown';
  const g = GROUPS.find((x) => x.codes.includes(code));
  return g ? g.key : 'unknown';
}

/**
 * Kód → emoji.
 * @param {number} code
 * @param {boolean} [isDay=true]
 */
export function weatherIcon(code, isDay = true) {
  const icons = ICONS[weatherKey(code)] || ICONS.unknown;
  return isDay ? icons.day : icons.night;
}

/**
 * Je to jev, na který se vyplatí upozornit na trase?
 *
 * Používá se při vyhodnocení trasy: bod s takovým počasím dostane výstrahu.
 * Mrznoucí déšť je tu schválně i při slabé intenzitě — náledí je nebezpečnější
 * než vydatný déšť, i když ho spadne míň.
 */
export function isHazard(code) {
  return ['freezingRain', 'heavySnow', 'snow', 'snowShowers',
          'thunderstorm', 'hailstorm', 'heavyRain', 'fog'].includes(weatherKey(code));
}

/**
 * Kolik nízké a střední oblačnosti ještě znamená „slunce je vidět".
 *
 * ⚠️ Nízký mrak slunce zakryje, vysoký ho jen zastře. Třicet procent
 * kupovité oblačnosti dole ještě nechá slunce většinu času svítit; víc už
 * ne. Nad tímhle prahem se do popisu nesaháme.
 */
const DOLE_NEJVYS = 30;

/** Od kolika vysoké oblačnosti má smysl mluvit o závoji. */
const VYSOKO_ASPON = 50;

/**
 * Je „zataženo" jen vysokou oblačností?
 *
 * 🚨 TOHLE JE OPRAVA SKUTEČNÉ STÍŽNOSTI. Michal 27. 8. 2026 v 18:55:
 * *„tady v Horšovském Týně svítí slunce a podívej, co mi to píše."*
 * Appka psala „Zataženo". A nelhala — model hlásil 75 % oblačnosti.
 *
 * Jenže: **nízká 0 %, střední 16 %, vysoká 75 %.** Celková oblačnost sečte
 * všechna patra, kód WMO se počítá z ní, a z řídkého cirru čtyři kilometry
 * nad hlavou vyjde „zataženo" — zatímco člověk dole stojí na slunci.
 *
 * Číslo je správně, slovo je špatně. Vysoká oblačnost slunce **zastře, ale
 * nezakryje**; obloha zbělá, stíny změknou, slunce je pořád vidět. Tomu se
 * říká závoj, ne zataženo.
 *
 * ⚠️ Nepřepisuje se tím počasí, jen se pojmenovává poctivěji — a jen tehdy,
 * když dole opravdu nic není. Jakmile se objeví nízká oblačnost, platí
 * původní popis.
 *
 * @param {object} a
 * @param {number} a.code   kód WMO
 * @param {number} [a.low]  nízká oblačnost v %
 * @param {number} [a.mid]  střední oblačnost v %
 * @param {number} [a.high] vysoká oblačnost v %
 * @returns {boolean}
 */
export function jenZavoj({ code, low, mid, high }) {
  // Týká se to jen popisů „polojasno" a „zataženo". U deště, mlhy nebo
  // bouřky by bylo přepisování popisu nebezpečné.
  const klic = weatherKey(code);
  if (klic !== 'overcast' && klic !== 'partlyCloudy') return false;

  const n = Number(low);
  const s = Number(mid);
  const v = Number(high);
  if (!Number.isFinite(n) || !Number.isFinite(v)) return false;

  const dole = n + (Number.isFinite(s) ? s : 0);
  return dole <= DOLE_NEJVYS && v >= VYSOKO_ASPON;
}

/**
 * Klíč počasí s ohledem na patra oblačnosti.
 *
 * Vrací `veiledSun` tam, kde by holý kód řekl „zataženo", ale zatáhlo to jen
 * vysoko. Jinak se chová přesně jako {@link weatherKey}.
 */
export function weatherKeyWithClouds(a) {
  return jenZavoj(a) ? 'veiledSun' : weatherKey(a?.code);
}

/**
 * Ikona s ohledem na patra oblačnosti.
 *
 * ⚠️ V noci se závoj neřeší: slunce, které není vidět, se nedá zastřít.
 */
export function weatherIconWithClouds(a, isDay = true) {
  if (isDay && jenZavoj(a)) return ICONS.veiledSun.day;
  return weatherIcon(a?.code, isDay);
}

/** Všechny klíče — pro paritní test překladů, ať se na žádný nezapomene. */
export const WEATHER_KEYS = [...GROUPS.map((g) => g.key), 'veiledSun', 'unknown'];

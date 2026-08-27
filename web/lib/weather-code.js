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
  // Když víme, kolik přímého záření dopadá, rozhoduje ono — je to měření
  // toho, na co se člověk dívá. Oblačnost je jen zástupný ukazatel.
  const kod = Number(a?.code);
  const zataženoNeboPolojasno = weatherKey(kod) === 'overcast' || weatherKey(kod) === 'partlyCloudy';
  if (zataženoNeboPolojasno && slunceProsvita(a || {}) === true) return 'veiledSun';
  return jenZavoj(a) ? 'veiledSun' : weatherKey(kod);
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

/**
 * Od jakého podílu přímého záření je slunce vidět jako slunce.
 *
 * 🚨 ZMĚŘENO, NE ODHADNUTO. Horšovský Týn, 27. 8. 2026:
 *
 * ```
 * 17:45   přímé 190 W/m²  z 300 celkem  =  63 %   slunce svítí
 * 18:45   přímé  48 W/m²  z 135 celkem  =  36 %   slunce přes závoj (Michal ho viděl)
 * 19:15   přímé   3 W/m²  z  63 celkem  =   5 %   slunce pryč
 * ```
 *
 * Práh je proto mezi pěti a třiceti šesti procenty; čtvrtina je uprostřed
 * s rezervou na obě strany.
 */
const PRIMEHO_ASPON = 0.25;

/**
 * Je slunce vidět? Pozná se to podle záření, ne podle oblačnosti.
 *
 * 🚨 Michal 27. 8. 2026: *„pokud já vidím slunce, ty mi nemůžeš radit, kam
 * za sluncem, ale naopak kde prší."* Appka se do té chvíle ptala oblačnosti —
 * a ta o viditelnosti slunce nerozhoduje. Sto procent řídkého cirru slunce
 * propustí, třicet procent nízké kupovité oblačnosti ho zakryje úplně.
 *
 * **Podíl přímého záření na celkovém měří přesně tu jednu věc, o kterou jde:
 * dopadá sem sluneční svit, nebo jen rozptýlené světlo?** Je to fyzika, ne
 * odhad z procent — a nezávisí to na výšce Slunce nad obzorem, protože se
 * porovnávají dvě čísla, která klesají spolu.
 *
 * ⚠️ V noci je odpověď vždycky NE, i kdyby čísla chyběla.
 * ⚠️ Když záření neznáme, vrací se `null` — volající si pak pomůže patry
 * oblačnosti. Tvrdit „slunce nesvítí" jen proto, že nám chybí údaj, by byla
 * ta horší ze dvou možných chyb.
 *
 * @param {object} a
 * @param {number} [a.direct]  přímé záření (W/m²)
 * @param {number} [a.total]   celkové (globální) záření (W/m²)
 * @param {boolean} [a.isDay]
 * @returns {boolean|null}  `null` = nevíme
 */
export function slunceProsvita({ direct, total, isDay = true }) {
  if (!isDay) return false;

  const p = Number(direct);
  const c = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(c)) return null;

  // Za soumraku jsou obě čísla maličká a jejich podíl začne skákat. Pod
  // dvaceti watty už o slunečním svitu nemá smysl mluvit tak jako tak.
  if (c < 20) return false;

  return p / c >= PRIMEHO_ASPON;
}

/**
 * Vidí člověk slunce? Nejdřív podle záření, teprve pak podle oblačnosti.
 *
 * Sjednocuje obě cesty na jedno místo, aby se meteostanice, trasa a sondy
 * nemohly rozejít v tom, čemu říkají „slunečno".
 */
export function jeSlunecno(a) {
  const podleZareni = slunceProsvita(a || {});
  if (podleZareni !== null) return podleZareni;

  // Záloha bez záření: jasno, skoro jasno, nebo jen vysoký závoj.
  const kod = Number(a?.code);
  if (kod === 0 || kod === 1) return true;
  return jenZavoj(a || {});
}

/** Všechny klíče — pro paritní test překladů, ať se na žádný nezapomene. */
export const WEATHER_KEYS = [...GROUPS.map((g) => g.key), 'veiledSun', 'unknown'];

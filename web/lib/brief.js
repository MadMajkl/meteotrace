/**
 * Ranní a večerní zpráva o počasí (`R25`, tvar `R45`).
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě — dostane odpověď Open-Meteo a vrátí
 * hotový text. „Teď" dodává volající, ať jde otestovat ráno i večer.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CO ZPRÁVA POKRÝVÁ — POSUVNÉ OKNO, NE „JEDEN DEN" (`R45`)
 *
 * Miki 24. 10. 2026: *„večerní zprávy jsou předpověď na noc a druhý den"*
 * a *„ranní zpráva má ukazovat jen ten aktuální den"*.
 *
 *   večer   noc (od teď do rána) + den, který po ní přijde
 *   ráno    dnešek (od teď do večera) — nic víc
 *
 * Ranní tedy zpřesní den, který slíbila večerní (čerstvější data). Den je
 * od 6 do 20 h místního času, noc od 20 do 6 h.
 *
 * ⚠️ Úsek se čte z HODINOVÉ předpovědi, ne z denní: denní minimum je
 * z půlnoci až půlnoci, takže by „Zítra 3 až 15 °C" opakovalo noc, o které
 * už mluví první řádek. A noc přes půlnoc v denních datech vůbec není.
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
import { formatTemp, formatTempRange, formatWind, windDirKey } from './units.js';
import { jeNarazSilny } from './tile-tone.js';

/**
 * Co se stahuje kvůli zprávě. Dva dny stačí: večerní okno končí zítra
 * ve 20 h, ranní dnes ve 20 h — a Open-Meteo počítá dny v pásmu místa.
 */
export const BRIEF_PARAMS = {
  hourly: 'temperature_2m,weather_code,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
  timezone: 'auto',
  forecast_days: '2',
};

/** Od téhle pravděpodobnosti srážek se o dešti píše. Níž je to šum. */
export const RAIN_MENTION = 40;

/** Hodina místního času, kdy začíná den, a kdy noc. */
export const DEN_OD = 6;
export const DEN_DO = 20;

/**
 * Pod touhle stálostí směru je vítr „proměnlivý" (0 = fouká ze všech stran
 * stejně, 1 = celý úsek z jedné). Průměr z větru, který se točí, je číslo
 * bez obsahu — „vítr J" po noci, kdy foukalo ze severu i z jihu, je lež.
 */
export const PROMENLIVY_POD = 0.4;

/** Pod touhle nejvyšší rychlostí (km/h) je v úseku bezvětří, ne „vítr až 1 km/h". */
export const BEZVETRI_POD = 2;

/** Druhy zprávy. Liší se oknem — viz hlavička. */
export const KINDS = ['morning', 'evening'];

/**
 * Teď v pásmu místa jako `YYYY-MM-DDTHH` — tentýž tvar jako začátek
 * hodinových časů Open-Meteo, takže se dá porovnávat jako text.
 *
 * ⚠️ Posun z `utc_offset_seconds` TÉŽE odpovědi, ne z pásma serveru.
 * Netlify běží v UTC, takže „dnes" podle serveru je pro uživatele v Praze
 * po 22:00 už včerejšek — a zpráva by mluvila o špatném dni.
 *
 * ⚠️ Hranice úseků jsou v NAIVNÍM místním čase (6:00, 20:00), takže na
 * přechodu času nic neposouvají: Open-Meteo píše hodiny místa i v den
 * změny, 24 za den.
 */
function hodinaVMiste(ms, posunS) {
  return new Date(ms + (Number(posunS) || 0) * 1000).toISOString().slice(0, 13);
}

function dalsiDen(datum) {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const naHodinu = (datum, h) => `${datum}T${String(h).padStart(2, '0')}`;
const pozdejsi = (a, b) => (a > b ? a : b);

/**
 * Úseky, o kterých zpráva mluví: `[{druh: 'den'|'noc', datum?, od, do}]`,
 * `od` včetně, `do` bez.
 */
export function useky({ forecast, kind, nowMs }) {
  if (!KINDS.includes(kind)) return [];
  const ted = hodinaVMiste(nowMs, forecast?.utc_offset_seconds);
  const dnes = ted.slice(0, 10);

  // Ráno: jen dnešek, bez noci po něm (Miki 24. 10. 2026). Zítřek i noc
  // přinese večerní zpráva.
  if (kind === 'morning') {
    return [{ druh: 'den', datum: dnes, od: pozdejsi(ted, naHodinu(dnes, DEN_OD)), do: naHodinu(dnes, DEN_DO) }]
      .filter((u) => u.od < u.do);
  }
  const zitra = dalsiDen(dnes);

  // Večer: noc, která běží nebo přijde, a den po ní. Po půlnoci (zpráva
  // zdržená sítí) je to noc do dnešního rána a den je dnešek.
  const poPulnoci = Number(ted.slice(11, 13)) < DEN_OD;
  const rano = poPulnoci ? dnes : zitra;
  return [
    { druh: 'noc', od: poPulnoci ? ted : pozdejsi(ted, naHodinu(dnes, DEN_DO)), do: naHodinu(rano, DEN_OD) },
    { druh: 'den', datum: rano, od: naHodinu(rano, DEN_OD), do: naHodinu(rano, DEN_DO) },
  ];
}

/**
 * Souhrn hodin úseku. `null`, když předpověď úsek celý nepokrývá.
 *
 * Jev je NEJHORŠÍ kód úseku — stejné pravidlo, podle kterého Open-Meteo
 * počítá kód dne (ověřeno 24. 10. 2026 na 42 dnech v šesti městech), takže
 * zpráva říká totéž co karta dne v appce. Vítr a nárazy jsou nejvyšší
 * hodnoty, směr je průměr vážený rychlostí.
 */
function shrnUsek(H, { od, do: doH }) {
  const s = { hodin: 0, teploty: [], kod: null, dest: null, vitr: null, naraz: null, x: 0, y: 0, sila: 0 };
  // ⚠️ `null` výslovně: `0 <= null` je v JS `true`, takže by jasno (kód 0)
  // ani bezvětří (0 km/h) nikdy nepřebily „zatím nic".
  const vyssi = (a, b) => (Number.isFinite(b) && (a == null || b > a) ? b : a);

  (H.time || []).forEach((cas, i) => {
    const h = String(cas).slice(0, 13);
    if (h < od || h >= doH) return;
    s.hodin++;
    const tep = H.temperature_2m?.[i];
    if (Number.isFinite(tep)) s.teploty.push(tep);
    const kod = H.weather_code?.[i];
    if (Number.isInteger(kod) && (s.kod == null || kod > s.kod)) s.kod = kod;
    s.dest = vyssi(s.dest, H.precipitation_probability?.[i]);
    s.naraz = vyssi(s.naraz, H.wind_gusts_10m?.[i]);
    const v = H.wind_speed_10m?.[i];
    s.vitr = vyssi(s.vitr, v);
    const smer = H.wind_direction_10m?.[i];
    if (Number.isFinite(v) && Number.isFinite(smer)) {
      const rad = (smer * Math.PI) / 180;
      s.x += v * Math.sin(rad);
      s.y += v * Math.cos(rad);
      s.sila += v;
    }
  });

  // 🚨 Úsek musí být CELÝ. Zkrácená předpověď (jen dnešek) by jinak dala
  // „V noci nejníž 11 °C" ze čtyř večerních hodin — a nejnižší teplota
  // přichází k ránu. Hodiny se počítají v naivním čase, jak je píše
  // Open-Meteo: 24 za den i v den přechodu času.
  const ocekavano = (Date.parse(`${doH}:00:00Z`) - Date.parse(`${od}:00:00Z`)) / 3_600_000;
  if (s.hodin < ocekavano || !s.teploty.length) return null;
  return {
    min: Math.min(...s.teploty),
    max: Math.max(...s.teploty),
    kod: s.kod,
    dest: s.dest,
    vitr: s.vitr,
    naraz: s.naraz,
    smer: smerUseku(s),
  };
}

/** Klíč směru (osm stran), `'variable'`, nebo `null`, když vítr nefouká. */
function smerUseku({ x, y, sila }) {
  if (!(sila > 0)) return null;
  if (Math.hypot(x, y) / sila < PROMENLIVY_POD) return 'variable';
  const deg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  // ⚠️ Osm stran, ne šestnáct: průměr přes noc je odhad a „západo-
  // severozápadní" by slibovalo přesnost, kterou nemá (jako den v 1.5.4).
  return windDirKey((Math.round(deg / 45) * 45) % 360);
}

/** Jeden řádek: „Zítra 6 až 17 °C · Déšť, pravděpodobnost 70 %, vítr Z až 35 km/h". */
function vetaUseku(u, s, dnes, lang, units) {
  const den = u.druh === 'noc' ? t('brief.tonight', lang)
    : t(u.datum === dnes ? 'brief.today' : 'brief.tomorrow', lang);
  // ⚠️ U noci jen minimum: noční teplota nerozhoduje o oblékání, ale
  // o mrazu na skle a záhonech — a o tom rozhoduje to nejnižší číslo.
  const teplota = u.druh === 'noc'
    ? tf('brief.low', { t: formatTemp(s.min, units, lang) }, lang)
    : formatTempRange(s.min, s.max, units, lang, tf);

  const casti = [];
  if (s.kod != null) casti.push(t(`weather.${weatherKey(s.kod)}`, lang));
  if (Number.isFinite(s.dest) && s.dest >= RAIN_MENTION) {
    casti.push(tf('brief.rain', { p: Math.round(s.dest) }, lang));
  }
  // Vítr VŽDYCKY, se směrem (Miki 24. 10. 2026). Náraz jen nad průměr
  // o `GUST_MARGIN_KMH` — týž práh jako předpověď a trasa v appce.
  if (Number.isFinite(s.vitr) && s.vitr < BEZVETRI_POD) {
    casti.push(t('brief.calm', lang));
  } else if (Number.isFinite(s.vitr)) {
    const w = formatWind(s.vitr, units, lang);
    const smer = s.smer === 'variable' ? t('brief.variable', lang)
      : s.smer ? t(`windDir.${s.smer}`, lang) : null;
    casti.push(smer ? tf('brief.wind', { dir: smer, w }, lang) : tf('brief.windNoDir', { w }, lang));
    if (jeNarazSilny(s.vitr, s.naraz)) casti.push(tf('brief.gusts', { g: formatWind(s.naraz, units, lang) }, lang));
  }

  return tf('brief.line', { day: den, temp: teplota, what: casti.join(', ') }, lang);
}

/**
 * Text zprávy — řádek na každý úsek, v pořadí, jak jdou po sobě.
 *
 * ⚠️ Pořadí v řádku je schválně takové: teplota první, protože podle ní se
 * člověk obléká; jev druhý; déšť jen tehdy, když opravdu něco mění.
 *
 * @returns {{text: string, den: string|null, kind: string}|null} `null` = nemáme co říct
 */
export function briefText({ forecast, kind, nowMs, lang = 'en', units }) {
  const H = forecast?.hourly;
  if (!H || !Array.isArray(H.time)) return null;
  const casti = useky({ forecast, kind, nowMs });
  if (!casti.length) return null;

  const souhrny = casti.map((u) => shrnUsek(H, u));
  // 🚨 Chybí-li kterýkoli úsek, NEZVONÍ se vůbec. Půlka zprávy by se tvářila
  // jako celá: „V noci nejníž 4 °C" bez zítřka čte člověk jako „zítra nic".
  if (souhrny.some((s) => !s)) return null;

  const dnes = hodinaVMiste(nowMs, forecast.utc_offset_seconds).slice(0, 10);
  const text = casti.map((u, i) => vetaUseku(u, souhrny[i], dnes, lang, units)).join('\n');
  return { text, den: casti.find((u) => u.druh === 'den')?.datum ?? null, kind };
}

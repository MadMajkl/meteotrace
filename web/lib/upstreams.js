/**
 * Katalog vzdálených zdrojů — jediné místo, kde je napsáno, kam proxy smí sáhnout.
 *
 * ⚠️ ČISTÝ MODUL BEZ ZÁVISLOSTÍ. Žádné DOM, žádná síť, žádné knihovny.
 * Nic tady nestahuje — jen to skládá adresy a hlídá pravidla. Díky tomu se
 * celá bezpečnostní logika proxy dá otestovat bez jediného síťového volání.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ JE TO SEZNAM A NE PARAMETR
 *
 * Proxy, které volající řekne, na kterou adresu má sáhnout, je otevřená
 * proxy — a ta je bezpečnostní díra (SSRF). Kdokoli by přes náš server
 * dosáhl na cokoli, včetně adres v našich vnitřních sítích. Proto klient
 * NIKDY neposílá URL, jen jméno služby z tohohle seznamu. Co tu není,
 * neexistuje.
 *
 * Ze stejného důvodu se propouštějí jen VYJMENOVANÉ parametry. Kdyby se
 * předával celý query string, dal by se cizí službě podstrčit parametr,
 * o kterém nevíme.
 *
 * Viz R2 (všechna data přes vlastní proxy).
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

const MINUTE = 60;
const HOUR = 3600;

/**
 * Seznam povolených služeb.
 *
 * `params`  — jména parametrů, která se propustí dál. Nic jiného neprojde.
 * `ttl`     — jak dlouho se odpověď smí považovat za čerstvou (sekundy).
 * `needsKey`— služba vyžaduje klíč; ten se bere z prostředí serveru a do
 *             klienta se nikdy nedostane (R2).
 */
export const UPSTREAMS = {
  /** Předpověď. Přijímá čárkou oddělený seznam souřadnic — celá trasa na jedno volání. */
  forecast: {
    base: 'https://api.open-meteo.com/v1/forecast',
    params: [
      'latitude', 'longitude', 'hourly', 'daily', 'current',
      'timezone', 'forecast_days', 'past_days', 'models',
      'temperature_unit', 'wind_speed_unit', 'precipitation_unit',
    ],
    ttl: 10 * MINUTE,
  },

  /** Kvalita ovzduší a pyl. */
  air: {
    base: 'https://air-quality-api.open-meteo.com/v1/air-quality',
    params: ['latitude', 'longitude', 'hourly', 'current', 'timezone', 'forecast_days'],
    ttl: 30 * MINUTE,
  },

  /** Hledání místa podle jména. */
  geocode: {
    base: 'https://geocoding-api.open-meteo.com/v1/search',
    params: ['name', 'count', 'language', 'format'],
    ttl: 24 * HOUR,          // města se nestěhují
  },

  /**
   * Trasa. Klíč je na serveru.
   *
   * ⚠️ Cache je tu DŮLEŽITĚJŠÍ než jinde: volný tarif ORS má 2 000 dotazů denně,
   * ale jen 40 ZA MINUTU — a ten minutový strop prorazí nárazová špička dřív než
   * denní. Shodná trasa se proto nesmí ptát dvakrát. (Viz R4.)
   */
  route: {
    base: 'https://api.openrouteservice.org/v2/directions',
    params: ['start', 'end', 'profile'],
    ttl: 6 * HOUR,           // silnice se přes den nemění
    needsKey: true,
  },

  /** Seznam radarových snímků. Krátká platnost — radar se obnovuje po 5 minutách. */
  radar: {
    base: 'https://api.rainviewer.com/public/weather-maps.json',
    params: [],
    ttl: 4 * MINUTE,
  },

  /**
   * Výstrahy (oficiální ČHMÚ přes EUMETNET, viz R6).
   *
   * ⚠️ Odpověď má přes 1 MB. Na mobilní data je to moc, proto se filtruje
   * na serveru — klientovi jde jen to, co se ho týká.
   */
  warnings: {
    base: 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-czechia',
    params: [],
    // Parametry, které se ven NEPOSÍLAJÍ — zpracují se u nás. Feed umí vydat
    // jen celou republiku, takže výběr podle polohy dělá proxy sama.
    //
    // ⚠️ Do klíče cache patřit NESMÍ: pod jedním klíčem se drží celý ořezaný
    // feed a teprve odpověď se z něj krájí podle polohy. Kdyby se cachoval už
    // výřez, dostal by druhý tazatel výstrahy prvního — a nepoznal by to.
    // `lang` vybírá jazykovou verzi z feedu (nese obě), `lat`/`lon` výřez podle místa.
    local: ['lang', 'lat', 'lon'],
    ttl: 5 * MINUTE,
  },
};

/** Je jméno služby v seznamu? */
export function isKnownService(name) {
  return Object.prototype.hasOwnProperty.call(UPSTREAMS, name);
}

/**
 * Propustí jen vyjmenované parametry.
 *
 * Vrací i seznam zahozených — ne proto, aby se na nich zastavilo, ale aby je
 * bylo vidět v logu. Tiché zahazování je nejhorší druh chyby: volající vidí
 * odpověď, jen jinou, než čekal.
 *
 * @param {string} service
 * @param {Record<string, string>|URLSearchParams} input
 * @returns {{allowed: Record<string, string>, dropped: string[]}}
 */
export function filterParams(service, input) {
  const spec = UPSTREAMS[service];
  if (!spec) throw new Error(`Neznámá služba: ${service}`);

  const entries = input instanceof URLSearchParams
    ? [...input.entries()]
    : Object.entries(input || {});

  const local = spec.local || [];
  const allowed = {};
  const dropped = [];
  for (const [key, value] of entries) {
    if (spec.params.includes(key)) allowed[key] = String(value);
    // Místní parametr se ven neposílá, ale zahozený není — zpracuje se u nás.
    // Kdyby se hlásil jako zahozený, log by tvrdil, že se ztratil něco, co se
    // ve skutečnosti použilo.
    else if (!local.includes(key)) dropped.push(key);
  }
  return { allowed, dropped };
}

/**
 * Sestaví cílovou adresu.
 *
 * ⚠️ Klíč se do URL NEPŘIDÁVÁ. ORS ho chce v hlavičce `Authorization` a tam taky
 * patří — v URL by skončil v logách serverů, v historii prohlížeče a v refererech.
 * Hlavičky vrací `upstreamHeaders()`.
 *
 * @param {string} service
 * @param {Record<string, string>|URLSearchParams} params
 * @param {string} [subPath]  volitelný dovětek cesty (u ORS profil dopravy)
 * @returns {string}
 */
export function buildUrl(service, params, subPath = '') {
  const spec = UPSTREAMS[service];
  if (!spec) throw new Error(`Neznámá služba: ${service}`);

  // Dovětek cesty smí být jen jednoduché slovo — jinak by se přes ../ dalo
  // vylézt z domény služby jinam.
  if (subPath && !/^[a-z0-9-]+$/i.test(subPath)) {
    throw new Error(`Nepřípustný dovětek cesty: ${subPath}`);
  }

  const { allowed } = filterParams(service, params);
  const qs = new URLSearchParams(allowed).toString();
  const base = subPath ? `${spec.base}/${subPath}` : spec.base;
  return qs ? `${base}?${qs}` : base;
}

/**
 * Hlavičky pro dotaz na cizí službu.
 * @param {string} service
 * @param {Record<string, string>} env  proměnné prostředí serveru
 */
export function upstreamHeaders(service, env = {}) {
  const spec = UPSTREAMS[service];
  if (!spec) throw new Error(`Neznámá služba: ${service}`);

  const headers = { 'Accept': 'application/json' };
  if (spec.needsKey) {
    const key = env.ORS_API_KEY;
    if (!key) throw new Error(`Službě ${service} chybí klíč (ORS_API_KEY)`);
    headers['Authorization'] = key;
  }
  return headers;
}

/**
 * Klíč do cache. Shodný dotaz musí dát shodný klíč — jinak by cache neplnila
 * svůj účel a minutový limit ORS by se prorážel zbytečně.
 *
 * Parametry se řadí, aby na jejich pořadí nezáleželo: `?a=1&b=2` a `?b=2&a=1`
 * je tentýž dotaz.
 */
export function cacheKey(service, params, subPath = '') {
  const { allowed } = filterParams(service, params);
  const sorted = Object.keys(allowed).sort().map((k) => `${k}=${allowed[k]}`).join('&');
  return subPath ? `${service}/${subPath}?${sorted}` : `${service}?${sorted}`;
}

/** Platnost odpovědi v sekundách. */
export function ttlFor(service) {
  const spec = UPSTREAMS[service];
  if (!spec) throw new Error(`Neznámá služba: ${service}`);
  return spec.ttl;
}

/**
 * Ořeže výstrahy na to podstatné.
 *
 * Feed MeteoAlarm má přes 1 MB, protože nese obě jazykové verze všech záznamů
 * včetně těch, které oznamují, že žádná výstraha neplatí. Klientovi stačí zlomek.
 *
 * ⚠️ Záznamy „Žádná výstraha před…" se MUSÍ vyhodit. Jinak by appka hlásila
 * výstrahu na to, že nic nehrozí — feed je posílá jako plnohodnotné položky
 * se závažností `Minor`.
 *
 * @param {object} feed  rozparsovaná odpověď MeteoAlarmu
 * @param {string} lang  'cs' | 'en' …
 * @returns {Array<{event: string, severity: string, onset: string|null,
 *                  expires: string|null, areas: Array<{name: string, codes: string[]}>}>}
 */
export function trimWarnings(feed, lang = 'cs') {
  const out = [];
  for (const w of (feed && feed.warnings) || []) {
    const infos = (w.alert && w.alert.info) || [];
    // Preferuj žádaný jazyk; když ho feed nemá, vezmi první dostupný.
    const info = infos.find((i) => (i.language || '').startsWith(lang)) || infos[0];
    if (!info) continue;
    if (isNonWarning(info.event)) continue;

    out.push({
      event: info.event,
      severity: info.severity || 'Unknown',
      onset: info.onset || null,
      expires: info.expires || null,
      areas: (info.area || []).map((a) => ({
        name: a.areaDesc,
        codes: (a.geocode || []).map((g) => g.value),
      })),
    });
  }
  return out;
}

/**
 * Pozná záznam typu „žádná výstraha neplatí".
 * Feed je posílá jako běžné položky, takže se poznají jen podle textu události.
 */
function isNonWarning(event) {
  if (!event) return true;
  const t = String(event).toLowerCase();
  return t.startsWith('žádná výstraha') || t.startsWith('zadna vystraha') ||
         t.startsWith('no warning') || t.startsWith('no ');
}

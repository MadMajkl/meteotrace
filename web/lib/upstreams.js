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

import { stripDiacritics } from './geo-query.js';

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
  /**
   * Hledání místa — HLAVNÍ zdroj (Pelias u HeiGIT, tentýž klíč jako routing).
   *
   * ⚠️ Vyměněno 24. 8. 2026. Původní Open-Meteo **neumí adresy** a **rozbíjí se
   * na diakritice** („Plzeň" → 0 nálezů, „Plzen" → Plzeň). Pro českého
   * uživatele to znamenalo appku, která skoro nic nenajde. Ověřeno, že tenhle
   * zdroj najde „náměstí Republiky 1, Horšovský Týn" i „Karlovo náměstí 10".
   *
   * ⚠️ Za to platíme kvótou (3 000/den, 100/min) a tím, že routing i hledání
   * visí na jednom poskytovateli. Proto `fallback` — viz níže.
   */
  geocode: {
    base: 'https://api.openrouteservice.org/geocode/search',
    params: ['text', 'size', 'lang', 'focus.point.lat', 'focus.point.lon'],
    // Klient posílá pořád `name`/`count`; překlad na řeč služby patří sem,
    // ne do appky — jinak by výměna zdroje znamenala zásah do obrazovky.
    //
    // ⚠️ `lat`/`lon` jsou nepovinné a znamenají „odkud se uživatel dívá".
    // Tatáž ulice je v desítce měst; bez tohohle je pořadí náhodné a člověk
    // musí číst všechny řádky. S tím se nejbližší nabídne první.
    mapParams: ({ name, count, lat, lon, language }) => {
      const out = { text: String(name ?? ''), size: String(count || 8) };
      // 🚨 Bez jazyka vrací služba anglické názvy: „Prague, Czechia" místo
      // „Praha, Česko". Pro českého uživatele to vypadá, jako by appka mluvila
      // o cizím městě — a u „Vienna" vs „Vídeň" je to ještě horší.
      // Změřeno 26. 8. 2026: `lang=cs` vrátí „Praha, Česko".
      if (language) out.lang = String(language).slice(0, 5);
      if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
        out['focus.point.lat'] = String(lat);
        out['focus.point.lon'] = String(lon);
      }
      return out;
    },
    normalize: 'pelias',
    ttl: 24 * HOUR,          // města se nestěhují
    needsKey: true,
    // 🚨 Když tenhle zdroj selže NEBO nic nenajde, zkusí se záloha. Hledání,
    // které přestane fungovat v půlce měsíce (vyčerpaná kvóta), je horší
    // než hledání s horšími výsledky.
    fallback: 'geocodeBasic',
  },

  /**
   * Jméno místa ze souřadnic — BEZ CIZÍ SLUŽBY.
   *
   * 🚨 Nejdřív to zkusilo opačné hledání u Pelias/ORS. Změřeno 27. 8. 2026:
   * na venkovský bod vrátí „Jezerce 23" — tedy číslo popisné — a z územních
   * polí jen kraj („Plzeňský"). Ve větě „nejblíž prší asi 62 km na jihozápad"
   * je oboje k ničemu: jedno moc přesné a náhodné, druhé moc hrubé.
   *
   * Vlastní hranice ORP (R11) dají přesně tu správnou hrubost — jméno města,
   * pod které bod spadá. A navíc zadarmo: žádný klíč, žádná kvóta, žádná
   * třetí strana, funguje i při výpadku (R0).
   *
   * ⚠️ `localOnly` znamená, že se NIKAM nechodí. Odpověď skládá proxy sama
   * z dat, která už drží kvůli výstrahám.
   *
   * ⚠️ `lat`/`lon` jsou tu schválně mezi `params`, ne mezi `local`:
   * musí se dostat do klíče cache. Kdyby byly „místní" jako u výstrah, měly
   * by všechny body společný záznam a druhý tazatel by dostal jméno prvního.
   */
  /**
   * Jméno místa ze souřadnic — ZÁLOHA PRO CIZINU (Pelias u HeiGIT).
   *
   * 🚨 Volá se JEN TEHDY, když vlastní hranice ORP jméno neznají — tedy
   * prakticky jen za hranicemi. Kvótu sdílí s hledáním adres (3 000/den),
   * takže se nesmí ptát pro každý bod.
   *
   * ⚠️ Z odpovědi se bere `locality`, NE `name`. Změřeno 27. 8. 2026:
   * `name` je adresa nebo podnik — u Drážďan „Wilsdruffer Straße 17",
   * u Vratislavi jméno hospody. `locality` vrací „Drážďany", „Vratislav",
   * „Linec" — a s `lang=cs` rovnou česky.
   *
   * ⚠️ `layers` se NEPOSÍLÁ. Filtr na `locality` vrací u tohohle
   * poskytovatele prázdno (změřeno), takže by odřízl všechno.
   */
  geocodeReverse: {
    base: 'https://api.openrouteservice.org/geocode/reverse',
    params: ['point.lat', 'point.lon', 'size', 'lang'],
    mapParams: ({ lat, lon, language }) => {
      const out = {
        'point.lat': String(lat ?? ''),
        'point.lon': String(lon ?? ''),
        // 🚨 Pět, ne jeden. Změřeno 27. 8. 2026: PRVNÍ výsledek často nemá
        // obec — je to podnik nebo ulice bez vazby („Tfl kereskedelmi Bt").
        // Teprve druhý či třetí nese „Dabas", „Budapešť", „Sárbogárd".
        // Vybírá se pak ten první, který obec má.
        size: '5',
      };
      if (language) out.lang = String(language).slice(0, 5);
      return out;
    },
    normalize: 'pelias',
    ttl: 24 * HOUR,          // vesnice se nestěhují
    needsKey: true,
  },

  place: {
    localOnly: true,
    params: ['lat', 'lon'],
    ttl: 24 * HOUR,          // města se nestěhují
  },

  /**
   * Hledání místa — ZÁLOHA (Open-Meteo, bez klíče a bez kvóty).
   *
   * Umí jen sídla, ne adresy. Zato se nemá jak vyčerpat.
   */
  geocodeBasic: {
    base: 'https://geocoding-api.open-meteo.com/v1/search',
    params: ['name', 'count', 'language', 'format'],
    // 🚨 Diakritika se sundá až TADY. Hlavní zdroj ji zvládá a sundávat ji
    // předem by mu zhoršilo výsledky; záloha ji naopak nezvládá vůbec.
    mapParams: (p) => ({ ...p, name: stripDiacritics(String(p.name ?? '')) }),
    ttl: 24 * HOUR,
  },

  /**
   * Trasa. Klíč je na serveru.
   *
   * ⚠️ Cache je tu DŮLEŽITĚJŠÍ než jinde: volný tarif ORS má 2 000 dotazů denně,
   * ale jen 40 ZA MINUTU — a ten minutový strop prorazí nárazová špička dřív než
   * denní. Shodná trasa se proto nesmí ptát dvakrát. (Viz R4.)
   */
  route: {
    // ⚠️ Přepnuto 24. 8. 2026: HeiGIT ruší `api.openrouteservice.org` ve prospěch
    // `api.heigit.org`. Stará adresa ještě odpovídá, ale nemá smysl čekat, až
    // přestane. Cesta se změnila taky — ověřeno dotazem, ne z dokumentace:
    // `/openrouteservice/v2/directions`, ne `/ors/v2/…` ani `/v2/…` (obojí 404).
    base: 'https://api.heigit.org/openrouteservice/v2/directions',
    params: ['start', 'end', 'profile'],
    ttl: 6 * HOUR,           // silnice se přes den nemění
    needsKey: true,
    // 🚨 Bez tohohle vrací ORS 406. Trasa chodí jako GeoJSON a služba na
    // `Accept: application/json` odmítne odpovědět — přitom je to týž dotaz,
    // který přes curl bez hlavičky projde. Chyba se pak tváří jako výpadek
    // cizí služby, ne jako naše hlavička.
    accept: 'application/geo+json',
    // 🚨 Dovětek cesty je u trasy PROFIL DOPRAVY a smí být jen z tohohle
    // seznamu. Bez něj propustila proxy cokoli — a když appka omylem poslala
    // `straight` (vzdušná čára, kterou počítáme sami), vrátila cizí služba
    // matoucí 404 „zdroj neodpověděl". Chyba na naší straně se tvářila jako
    // výpadek cizí. Co není na seznamu, neexistuje — stejně jako u služeb.
    subPaths: ['driving-car', 'driving-hgv', 'cycling-regular', 'cycling-road',
      'cycling-mountain', 'cycling-electric', 'foot-walking', 'foot-hiking', 'wheelchair'],
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
    // `geo=1` navíc přiloží hranici území, aby ji mapa uměla vykreslit.
    local: ['lang', 'lat', 'lon', 'geo'],
    ttl: 5 * MINUTE,
  },
};

/**
 * Odpověď Pelias na tvar, jaký appka zná z Open-Meteo.
 *
 * ⚠️ Díky tomu **obrazovka o výměně zdroje vůbec neví**. Kdyby se tvar
 * propsal až do UI, byla by výměna geokodéru přepis appky — přesně to,
 * čemu se `R0` brání.
 *
 * 🚨 GeoJSON má souřadnice v pořadí [délka, šířka] — opačně, než používá
 * zbytek appky. Prohození se dělá tady, na jednom místě.
 */
export function fromPelias(body) {
  const features = Array.isArray(body?.features) ? body.features : [];
  const results = [];
  // 🚨 Služba vrací tutéž ulici i dvakrát (různé záznamy v OSM). Dva shodné
  // řádky v nabídce vypadají jako chyba a nutí člověka přemýšlet, v čem se
  // liší — přitom se neliší v ničem.
  const videne = new Set();
  for (const f of features) {
    const c = f?.geometry?.coordinates;
    const p = f?.properties || {};
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;

    const otisk = (p.label || p.name || '').toLowerCase();
    if (otisk && videne.has(otisk)) continue;
    videne.add(otisk);

    results.push({
      // U adresy je `name` jen „náměstí Republiky 1"; `label` nese i obec,
      // což je to, co uživatel potřebuje k rozlišení dvou stejných ulic.
      name: p.name || p.label || '',
      label: p.label || '',
      country: p.country || null,
      admin1: p.region || p.macroregion || null,
      // Obec. **Ta jediná rozliší dvě stejně pojmenované ulice** — kraj ne,
      // ten je u „náměstí Republiky" v Horšovském Týně stejný jako v Plzni.
      locality: p.locality || p.localadmin || null,
      // Vrstva říká, jestli je to adresa, ulice nebo sídlo — UI podle toho
      // může řadit nebo popisovat.
      layer: p.layer || null,
      latitude: c[1],
      longitude: c[0],
    });
  }
  return { results };
}

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
/**
 * Přeloží parametry klienta do řeči služby.
 *
 * Klient mluví pořád stejně (`name`, `count`) — překlad na to, čemu rozumí
 * konkrétní zdroj, patří do katalogu. Výměna zdroje je pak změna tady,
 * ne v obrazovce (`R0`).
 */
export function mapParams(service, input) {
  const spec = UPSTREAMS[service];
  if (!spec) throw new Error(`Neznámá služba: ${service}`);
  const obj = input instanceof URLSearchParams ? Object.fromEntries(input.entries()) : (input || {});
  return spec.mapParams ? spec.mapParams(obj) : obj;
}

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
  // A když si služba drží seznam povolených dovětků, musí sedět i ten.
  if (subPath && spec.subPaths && !spec.subPaths.includes(subPath)) {
    throw new Error(`Neznámý profil dopravy: ${subPath}`);
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

  const headers = { 'Accept': spec.accept || 'application/json' };
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
/**
 * Skládá si odpověď proxy sama, bez cizí služby?
 *
 * Zatím jediný případ je `place` (jméno místa z vlastních hranic ORP).
 */
export function isLocalService(service) {
  return !!UPSTREAMS[service]?.localOnly;
}

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

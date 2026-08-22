/**
 * Uložená místa a trasy (`R8`, bod 4).
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě, bez `localStorage` — dostane text,
 * vrátí text. Úložiště je špinavá práce a patří do UI (`app.js`), stejně
 * jako u proxy: rozhodování zvlášť, provedení zvlášť.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TENHLE SOUBOR EXISTUJE
 *
 * Bez uložených míst je meteostanice jednorázová hračka: kdo si musí Prahu
 * pokaždé vyhledat, otevře appku dvakrát. Uložená místa jsou to, co z ní
 * dělá návyk — a zároveň předpoklad pro notifikační pravidla ve v2
 * („moje cesta do práce"). Nikdy se nezamykají za platbu.
 *
 * 🚨 TOHLE JSOU JEDINÁ DATA, KTERÁ APPKA NEUMÍ ZNOVU ZÍSKAT.
 *    Předpověď se stáhne znovu, trasa se spočítá znovu — seznam míst,
 *    který uživatel poskládal za rok, ne. Každá funkce níž je proto psaná
 *    tak, aby v nejhorším případě neuložila nic, ale nikdy nesmazala to,
 *    co už je uložené.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { distanceM } from './eta.js';

/** Verze schématu v úložišti. Zvyšuje se, když se změní tvar dat. */
export const SCHEMA_VERSION = 1;

/**
 * Strop počtu záznamů. Není to úspora místa (padesát míst je pár kilobajtů),
 * ale pojistka proti seznamu, který se rozroste tak, že se v něm nedá nic
 * najít — a proti chybě v UI, která by ukládala v cyklu.
 */
export const MAX_PLACES = 50;
export const MAX_ROUTES = 30;

/** Delší jméno se do řádku stejně nevejde a jen by ho rozbilo. */
export const MAX_NAME = 60;

/**
 * Blíž než tohle = totéž místo.
 *
 * Sto padesát metrů je zhruba parkoviště u supermarketu: dvě klepnutí na
 * „moje poloha" z různých konců nemají založit dvě položky. Pro počasí je
 * ten rozdíl neznatelný — modely mají rozlišení v kilometrech.
 */
export const SAME_PLACE_M = 150;

/* ============================================================
   IDENTITA MÍSTA
   ============================================================ */

/**
 * Klíč místa = zaokrouhlené souřadnice, NE jméno.
 *
 * 🚨 Jméno není identita. „Brno" je v Česku i v Německu, „Domov" si
 * uživatel pojmenuje sám a „Moje poloha" se jmenuje pokaždé stejně,
 * i když je pokaždé jinde.
 *
 * 🚨 KLÍČ JE ADRESA ZÁZNAMU, NE PRAVIDLO SHODY. Zaokrouhlení na tři
 *    desetinná místa (~110 m) samo o sobě duplicity NEODSTRANÍ: dva body
 *    metr od sebe, ale každý po jiné straně hranice zaokrouhlení
 *    (50,07549 a 50,07551), dostanou různý klíč. Žádná mřížka to nespraví,
 *    jen posune hranici jinam. Shoda se proto hledá **vzdáleností**
 *    (`findNearby`), klíč slouží k adresování už uloženého záznamu.
 *    Odhaleno samotestem, který na tuhle hranici náhodou trefil.
 *
 * @param {{lat:number, lon:number}} place
 * @returns {string|null}
 */
export function placeKey(place) {
  const lat = coord(place?.lat, 90);
  const lon = coord(place?.lon, 180);
  if (lat === null || lon === null) return null;
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

/**
 * 🚨 Záporná nula se musí srovnat, jinak vzniknou DVA klíče pro totéž místo.
 * `(-0.0001).toFixed(3)` je `"-0.000"`, ale `(0.0001).toFixed(3)` je `"0.000"` —
 * a to jsou body jedenáct metrů od sebe. Na rovníku a na nultém poledníku
 * by se tak jedno místo ukládalo dvakrát.
 */
function coord(value, limit) {
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  const r = Math.round(value * 1e3) / 1e3;
  return r === 0 ? 0 : r;
}

/**
 * Klíč trasy: odkud, kam a jak. Způsob dopravy je součástí identity —
 * autem a na kole je to jiná trasa mezi týmiž body.
 */
export function routeKey(route) {
  const from = placeKey(route?.from);
  const to = placeKey(route?.to);
  if (!from || !to) return null;
  return `${from}>${to}@${route?.profile || 'car'}`;
}

/* ============================================================
   OČIŠTĚNÍ VSTUPU
   ============================================================ */

/**
 * Cokoli, co se tváří jako místo → uložitelný tvar. Nesmysl → `null`.
 *
 * ⚠️ Nula je platná souřadnice (Guinejský záliv), takže se nesmí testovat
 * pravdivostí. `if (!place.lat)` by zahodilo rovník i nultý poledník.
 *
 * @returns {{key:string, name:string, country:string|null, lat:number, lon:number}|null}
 */
export function normalizePlace(raw) {
  const key = placeKey(raw);
  if (!key) return null;

  return {
    key,
    // Souřadnice se ukládají v původní přesnosti — klíč je jen pro porovnání,
    // předpověď se ptá na skutečný bod.
    lat: raw.lat,
    lon: raw.lon,
    name: cleanName(raw.name) || key,
    country: cleanName(raw.country) || null,
  };
}

/**
 * Jméno z vyhledávání i od uživatele projde tudy.
 * Bílé znaky se srovnají — jinak by se „Praha " a „Praha" tvářily jako
 * dvě jména téhož místa a seznam by vypadal rozbitě.
 */
export function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

/* ============================================================
   ÚLOŽIŠTĚ — ČTENÍ A ZÁPIS
   ============================================================ */

/** @returns {{version:number, places:Array, routes:Array, readOnly:boolean}} */
export function emptyStore() {
  return { version: SCHEMA_VERSION, places: [], routes: [], readOnly: false };
}

/**
 * Text z úložiště → sklad. Nikdy nevyhodí výjimku.
 *
 * 🚨 NOVĚJŠÍ VERZE SCHÉMATU SE OTEVŘE JEN PRO ČTENÍ.
 *    Nastat to může snadno: v Androidu si WebView drží starší kopii webových
 *    souborů, než jaká zapsala data. Kdyby starší kód nová data přepsal
 *    svým tvarem, uživatel by o polovinu seznamu přišel a nikdy by se
 *    nedozvěděl proč. Radši appka, která dočasně neumí uložit, než appka,
 *    která tiše maže.
 *
 * ⚠️ Poškozený text je jiný případ — zachraňovat není co, takže se začíná
 *    načisto a zápis zůstává povolený. Read-only sklad bez dat by znamenal,
 *    že si uživatel po jednom pokaženém zápisu už nikdy nic neuloží.
 */
export function parseStore(text) {
  if (!text) return emptyStore();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return emptyStore();
  }
  if (!data || typeof data !== 'object') return emptyStore();

  const version = Number.isFinite(data.version) ? data.version : SCHEMA_VERSION;
  if (version > SCHEMA_VERSION) {
    return {
      version,
      places: readList(data.places, readPlace),
      routes: readList(data.routes, readRoute),
      readOnly: true,
    };
  }

  return {
    version: SCHEMA_VERSION,
    places: readList(data.places, readPlace).slice(0, MAX_PLACES),
    routes: readList(data.routes, readRoute).slice(0, MAX_ROUTES),
    readOnly: false,
  };
}

/**
 * Sklad → text k uložení.
 *
 * Vrací `null`, když se zapisovat nesmí. Volající tím pádem nemá jak
 * omylem přepsat data novější verze — nemá co zapsat.
 */
export function serializeStore(store) {
  if (store?.readOnly) return null;
  return JSON.stringify({
    version: SCHEMA_VERSION,
    places: store?.places || [],
    routes: store?.routes || [],
  });
}

function readList(value, read) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const parsed = read(item);
    // Jeden poškozený záznam nesmí shodit celý seznam — přeskočí se
    // a zbytek se načte.
    if (!parsed || seen.has(parsed.key)) continue;
    seen.add(parsed.key);
    out.push(parsed);
  }
  return out;
}

function readPlace(item) {
  const place = normalizePlace(item);
  if (!place) return null;
  return { ...place, savedAt: time(item?.savedAt), usedAt: time(item?.usedAt) };
}

function readRoute(item) {
  const from = normalizePlace(item?.from);
  const to = normalizePlace(item?.to);
  if (!from || !to) return null;
  const profile = typeof item?.profile === 'string' ? item.profile : 'car';
  const key = routeKey({ from, to, profile });
  return {
    key, from, to, profile,
    name: cleanName(item?.name) || `${from.name} → ${to.name}`,
    savedAt: time(item?.savedAt),
    usedAt: time(item?.usedAt),
  };
}

const time = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

/* ============================================================
   ZMĚNY SKLADU
   ============================================================ */

/**
 * Uloží místo. Už uložené se neuloží podruhé, jen se přiživí.
 *
 * 🚨 OPAKOVANÉ ULOŽENÍ NESMÍ PŘEPSAT VLASTNÍ JMÉNO. Kdo si Prahu přejmenoval
 *    na „Domov", nesmí o to jméno přijít tím, že si Prahu příště najde
 *    ve vyhledávání. Doplní se jen to, co chybí (třeba stát).
 *
 * Řazení: **nejnovější nahoře, pořadí se pak už samo nemění.** Seznam,
 * který se přerovnává podle četnosti použití, se nedá naučit nazpaměť —
 * a klepnout vedle je horší než o řádek scrollovat. `usedAt` slouží
 * výhradně k vyhazování při přeplnění.
 *
 * @returns {{store: object, place: object|null, changed: boolean, full: boolean}}
 */
export function savePlace(store, raw, nowMs = 0) {
  const place = normalizePlace(raw);
  if (!place) return { store, place: null, changed: false, full: false };
  if (store.readOnly) return { store, place: null, changed: false, full: false };

  const existing = findNearby(store, place);
  if (existing) {
    const merged = {
      ...existing,
      country: existing.country || place.country,
      usedAt: nowMs,
    };
    return {
      store: { ...store, places: store.places.map((p) => (p.key === existing.key ? merged : p)) },
      place: merged,
      changed: false,
      full: false,
    };
  }

  const saved = { ...place, savedAt: nowMs, usedAt: nowMs };
  const places = evict([saved, ...store.places], MAX_PLACES);

  return {
    store: { ...store, places },
    place: saved,
    changed: true,
    full: store.places.length >= MAX_PLACES,
  };
}

/** Uložení trasy. Tatáž pravidla jako u míst. */
export function saveRoute(store, raw, nowMs = 0) {
  const parsed = readRoute({ ...raw, savedAt: nowMs, usedAt: nowMs });
  if (!parsed || store.readOnly) return { store, route: null, changed: false, full: false };

  // Tatáž shoda vzdáleností jako u míst — start o dvě ulice jinam je pořád
  // tatáž cesta do práce.
  const near = (a, b) => distanceM([a.lat, a.lon], [b.lat, b.lon]) <= SAME_PLACE_M;
  const existing = store.routes.find((r) =>
    r.profile === parsed.profile && near(r.from, parsed.from) && near(r.to, parsed.to));

  if (existing) {
    const merged = { ...existing, usedAt: nowMs };
    return {
      store: { ...store, routes: store.routes.map((r) => (r.key === existing.key ? merged : r)) },
      route: merged,
      changed: false,
      full: false,
    };
  }

  return {
    store: { ...store, routes: evict([parsed, ...store.routes], MAX_ROUTES) },
    route: parsed,
    changed: true,
    full: store.routes.length >= MAX_ROUTES,
  };
}

/**
 * Při přeplnění vypadne **nejdéle nepoužitý**, ne nejdéle uložený.
 * Místo, na které se uživatel dívá každé ráno pět let, musí v seznamu
 * zůstat. (Tatáž úvaha jako u stropu v `ttl-cache.js`.)
 */
function evict(list, max) {
  if (list.length <= max) return list;
  const victim = list.reduce((worst, item) => (item.usedAt < worst.usedAt ? item : worst));
  return list.filter((item) => item !== victim);
}

/** Smazání. Neznámý klíč nic neudělá — mazat něco, co tam není, není chyba. */
export function forgetPlace(store, key) {
  if (store.readOnly) return store;
  return { ...store, places: store.places.filter((p) => p.key !== key) };
}

export function forgetRoute(store, key) {
  if (store.readOnly) return store;
  return { ...store, routes: store.routes.filter((r) => r.key !== key) };
}

/**
 * Přejmenování.
 *
 * ⚠️ Prázdné jméno se NEULOŽÍ jako prázdné — vrátí se souřadnice. Řádek
 * bez popisku vypadá jako chyba appky a uživatel se z něj nedozví, kam vede.
 */
export function renamePlace(store, key, name) {
  if (store.readOnly) return store;
  const clean = cleanName(name);
  return {
    ...store,
    places: store.places.map((p) => (p.key === key ? { ...p, name: clean || p.key } : p)),
  };
}

/** Zaznamená použití — kvůli vyhazování při přeplnění, ne kvůli řazení. */
export function touchPlace(store, key, nowMs) {
  if (store.readOnly) return store;
  return {
    ...store,
    places: store.places.map((p) => (p.key === key ? { ...p, usedAt: nowMs } : p)),
  };
}

export function touchRoute(store, key, nowMs) {
  if (store.readOnly) return store;
  return {
    ...store,
    routes: store.routes.map((r) => (r.key === key ? { ...r, usedAt: nowMs } : r)),
  };
}

/* ============================================================
   DOTAZY
   ============================================================ */

/**
 * Nejbližší uložené místo do `radiusM`, jinak `null`.
 *
 * ⚠️ Hledá se NEJBLIŽŠÍ, ne první v dosahu. Kdo si uloží dvě místa blízko
 * sebe (dům a hospoda o dvě ulice dál), musí při uložení třetího trefit to
 * správné — jinak by se mu přiživovalo náhodné z nich podle pořadí v poli.
 */
export function findNearby(store, raw, radiusM = SAME_PLACE_M) {
  const place = normalizePlace(raw);
  if (!place) return null;

  let best = null;
  let bestDist = Infinity;
  for (const p of store.places) {
    const d = distanceM([place.lat, place.lon], [p.lat, p.lon]);
    if (d <= radiusM && d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

/**
 * Je tohle místo uložené? Bere místo i hotový klíč.
 *
 * U místa se ptá vzdáleností — hvězdička u „mojí polohy" musí svítit i po
 * pár krocích, jinak by uživatel uložil totéž místo znovu.
 */
export function isSaved(store, placeOrKey) {
  if (typeof placeOrKey === 'string') return store.places.some((p) => p.key === placeOrKey);
  return !!findNearby(store, placeOrKey);
}

export function findPlace(store, key) {
  return store.places.find((p) => p.key === key) || null;
}

export function findRoute(store, key) {
  return store.routes.find((r) => r.key === key) || null;
}

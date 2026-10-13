/**
 * Offline mapa oblasti (`R44`) — počty a seznamy dlaždic, adresy, limity.
 *
 * ⚠️ ČISTÝ MODUL. Žádná síť, žádné úložiště. Stahování a IndexedDB jsou
 * v `web/offline-store.js`; tady je jen počítání, které jde ověřit bez
 * prohlížeče (`selftest-offline-map.mjs`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ
 *
 * Čtvrtá „top pecka" z Mikiho výběru (13. 10. 2026), už v `R7` jako
 * nejsilnější kandidát pro v2: podklad mapy je NÁŠ (`R3`), takže stažení
 * oblasti nás nestojí nic navíc — a cizí poskytovatelé to na volných
 * tarifech zakazují. Na horách bez signálu pak mapa ukáže, kde člověk je.
 *
 * JAK
 *
 * Mapa si o dlaždice říká protokolem `pmtiles://` (`map.js`). Stažená
 * oblast leží v IndexedDB pod klíčem archiv + z/x/y a protokol se do ní
 * podívá DŘÍV, než sáhne na síť. Webový service worker to udělat nemůže:
 * dlaždice chodí po kouscích (`Range`, odpověď 206) a ty se do cache
 * prohlížeče uložit nedají.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * Nejvýš tolik dlaždic v jedné oblasti. Při ~20 kB na dlaždici je to
 * kolem 140 MB — víc nemá smysl na jedno klepnutí stahovat přes mobilní
 * data a hledat pak v telefonu místo.
 */
export const MAX_DLAZDIC = 7000;

/** Nejpodrobnější přiblížení, které archivy mají (`npm run tiles`, z14). */
export const NEJVIC_ZOOM = 14;

/** Pod tímhle přiblížením nemá offline mapa pro cestu v terénu smysl. */
export const NEJMIN_ZOOM = 11;

/**
 * Odhad velikosti dlaždice pro dotaz „asi 12 MB" — skutečnost se pak sečte.
 * Změřeno 13. 10. 2026: okolí Horšovského Týna z0–14, 642 dlaždic, 10,5 MB
 * = 17 kB průměr. 20 kB je mírně nahoru — překvapení „bylo to víc" je horší.
 */
export const ODHAD_BAJTU = 20 * 1024;

const R2D = 180 / Math.PI;

/** Zeměpisná délka → sloupec dlaždice (Web Mercator). */
export function lonNaX(lon, z) {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
}

/** Zeměpisná šířka → řádek dlaždice. ⚠️ Řádky rostou na JIH. */
export function latNaY(lat, z) {
  const n = 2 ** z;
  const f = Math.max(-85.0511, Math.min(85.0511, lat)) / R2D;
  return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(f) + 1 / Math.cos(f)) / Math.PI) / 2) * n)));
}

/**
 * Výřez dvou obdélníků `[západ, jih, východ, sever]`, nebo `null`.
 * Oblast se stahuje jen tam, kde archiv opravdu má data.
 */
export function prunik(a, b) {
  if (!b) return a;
  const v = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return v[0] < v[2] && v[1] < v[3] ? v : null;
}

/** Rozsah dlaždic oblasti na přiblížení `z`. */
export function rozsah(bbox, z) {
  return {
    x0: lonNaX(bbox[0], z), x1: lonNaX(bbox[2], z),
    y0: latNaY(bbox[3], z), y1: latNaY(bbox[1], z),
  };
}

/**
 * Co se má stáhnout: pro každý archiv přiblížení od `odZoomu` (svět 0,
 * podrobné oblasti 9 — tak je kreslí styl) do `min(maxzoom, doZoomu)`.
 *
 * @param {number[]} bbox  `[západ, jih, východ, sever]`
 * @param {Array<{url: string, odZoomu: number, minzoom: number, maxzoom: number, bounds?: number[]}>} archivy
 * @param {number} doZoomu
 * @returns {Array<{url: string, z: number, x0: number, x1: number, y0: number, y1: number}>}
 */
export function planStazeni(bbox, archivy, doZoomu) {
  const out = [];
  for (const a of archivy || []) {
    const vyrez = prunik(bbox, a.bounds);
    if (!vyrez) continue;
    const od = Math.max(a.odZoomu || 0, a.minzoom || 0);
    const po = Math.min(a.maxzoom ?? NEJVIC_ZOOM, doZoomu);
    for (let z = od; z <= po; z++) out.push({ url: a.url, z, ...rozsah(vyrez, z) });
  }
  return out;
}

/** Kolik dlaždic plán obnáší. */
export function pocet(plan) {
  return plan.reduce((s, p) => s + (p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1), 0);
}

/** Plán → jednotlivé dlaždice (generátor — 7 000 objektů najednou netřeba). */
export function* dlazdice(plan) {
  for (const p of plan) {
    for (let x = p.x0; x <= p.x1; x++) {
      for (let y = p.y0; y <= p.y1; y++) yield { url: p.url, z: p.z, x, y };
    }
  }
}

/**
 * Nejpodrobnější přiblížení, při kterém se oblast vejde do limitu.
 * `null` = moc velká i na {@link NEJMIN_ZOOM} — appka řekne „přibliž mapu".
 *
 * ⚠️ Raději méně podrobná mapa celé oblasti než podrobná jen kousku: kdo
 * si stahuje údolí, chce celé údolí.
 */
export function vyberZoomu(bbox, archivy, limit = MAX_DLAZDIC) {
  for (let z = NEJVIC_ZOOM; z >= NEJMIN_ZOOM; z--) {
    const n = pocet(planStazeni(bbox, archivy, z));
    if (n > 0 && n <= limit) return { doZoomu: z, dlazdic: n };
  }
  return null;
}

/** Klíč dlaždice v úložišti. Adresa archivu je součást — svět a Česko mají totéž z/x/y. */
export function klic(url, z, x, y) {
  return `${url}|${z}/${x}/${y}`;
}

/**
 * Adresa, se kterou mapa volá protokol → archiv a dlaždice.
 *
 * `pmtiles://https://host/cz.pmtiles/14/8800/5600` → dlaždice,
 * `pmtiles://https://host/cz.pmtiles` → popis archivu (TileJSON).
 * @returns {{url: string, z: number, x: number, y: number}|{url: string, json: true}|null}
 */
export function rozeberAdresu(adresa) {
  if (typeof adresa !== 'string' || !adresa.startsWith('pmtiles://')) return null;
  const zbytek = adresa.slice('pmtiles://'.length);
  const m = /^(.+)\/(\d+)\/(\d+)\/(\d+)$/.exec(zbytek);
  if (m) return { url: m[1], z: +m[2], x: +m[3], y: +m[4] };
  return zbytek ? { url: zbytek, json: true } : null;
}

/** Velikost lidsky: „64 MB", „850 kB". */
export function velikost(bajtu, lang = 'cs') {
  const fmt = (n, d) => n.toLocaleString(lang === 'cs' ? 'cs-CZ' : 'en-GB', { maximumFractionDigits: d });
  if (bajtu >= 1024 * 1024) return `${fmt(bajtu / (1024 * 1024), bajtu >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${fmt(Math.max(1, Math.round(bajtu / 1024)), 0)} kB`;
}

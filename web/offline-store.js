/**
 * Offline mapa oblasti (`R44`) — úložiště a stahování.
 *
 * Dlaždice leží v IndexedDB pod klíčem archiv + z/x/y (`lib/offline-map.js`),
 * popis archivu (TileJSON) vedle nich. Protokol `pmtiles://` v `map.js` se
 * sem podívá dřív, než sáhne na síť.
 *
 * ⚠️ Načítá se LÍNĚ, až s mapou — kdo mapu neotevře, nemá proč platit.
 * ⚠️ Knihovna PMTiles (`window.pmtiles`) je v tu chvíli načtená — stahuje
 * se tímtéž čtením archivu po kouscích jako mapa.
 */

import { klic, dlazdice, planStazeni } from './lib/offline-map.js';

const DB = 'meteotrace-offline';
const VERZE = 1;

/** Kolik dlaždic se stahuje naráz. Víc by zahltilo pomalý mobil, míň zdržuje. */
const NARAZ = 6;

/** Kolik zápisů jde do jedné transakce — po jednom je to o řád pomalejší. */
const DAVKA = 40;

let dbSlib = null;

/** Je IndexedDB k dispozici (soukromé okno, přísné nastavení)? */
export function umi() {
  return typeof indexedDB !== 'undefined';
}

function db() {
  dbSlib ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERZE);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('dlazdice')) d.createObjectStore('dlazdice');
      if (!d.objectStoreNames.contains('tilejson')) d.createObjectStore('tilejson');
      if (!d.objectStoreNames.contains('oblasti')) d.createObjectStore('oblasti', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbSlib = null; rej(r.error); };
  });
  return dbSlib;
}

/** Jedna transakce; `prace` dostane úložiště a vrátí požadavek nebo nic. */
async function tx(uloziste, rezim, prace) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(uloziste, rezim);
    const pozadavek = prace(t.objectStore(uloziste));
    t.oncomplete = () => res(pozadavek?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transakce zrušena.'));
  });
}

/**
 * Je vůbec nějaká oblast? Protokol mapy se podle toho rozhoduje, jestli se
 * má do úložiště dívat — bez oblastí by to byla zbytečná cesta u každé
 * dlaždice.
 */
export let aktivni = false;

export async function obnovStav() {
  try {
    aktivni = umi() && (await tx('oblasti', 'readonly', (s) => s.count())) > 0;
  } catch {
    aktivni = false;
  }
  return aktivni;
}

export async function najdiDlazdici(url, z, x, y) {
  try {
    return await tx('dlazdice', 'readonly', (s) => s.get(klic(url, z, x, y)));
  } catch {
    return undefined;
  }
}

export async function najdiTileJson(url) {
  try {
    return await tx('tilejson', 'readonly', (s) => s.get(url));
  } catch {
    return undefined;
  }
}

/** Uložené oblasti, nejnovější nahoře. Bez seznamů klíčů — ty jsou velké. */
export async function seznam() {
  if (!umi()) return [];
  const vse = await tx('oblasti', 'readonly', (s) => s.getAll());
  return (vse || [])
    .map(({ klice: _k, ...o }) => o)
    .sort((a, b) => b.kdy - a.kdy);
}

/**
 * Smaže oblast. Dlaždice, které používá i jiná oblast (překryv), zůstanou.
 */
export async function smaz(id) {
  const vse = await tx('oblasti', 'readonly', (s) => s.getAll());
  const ta = vse.find((o) => o.id === id);
  if (!ta) return;
  const jinde = new Set(vse.filter((o) => o.id !== id).flatMap((o) => o.klice || []));
  await uklid((ta.klice || []).filter((k) => !jinde.has(k)));
  await tx('oblasti', 'readwrite', (s) => s.delete(id));
  // Poslední oblast pryč → pryč i popisy archivů; v telefonu nezůstane nic.
  if (vse.length === 1) await tx('tilejson', 'readwrite', (s) => s.clear());
  await obnovStav();
}

async function uklid(klice) {
  for (let i = 0; i < klice.length; i += 200) {
    const kus = klice.slice(i, i + 200);
    await tx('dlazdice', 'readwrite', (s) => { for (const k of kus) s.delete(k); });
  }
}

/**
 * Hlavičky archivů: přiblížení a hranice, kde mají data.
 * @param {Array<{url: string, odZoomu: number}>} archivy
 */
export async function popisArchivu(archivy) {
  return Promise.all(archivy.map(async (a) => {
    const h = await new globalThis.pmtiles.PMTiles(a.url).getHeader();
    return {
      ...a,
      minzoom: h.minZoom,
      maxzoom: h.maxZoom,
      bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
    };
  }));
}

/**
 * Stáhne oblast.
 *
 * 🚨 Napůl stažená oblast se NEULOŽÍ jako hotová. Zrušení nebo výpadek
 * sítě po sobě uklidí, co stihl stáhnout — oblast, která tvrdí „mám to",
 * a v půlce údolí je bílé místo, je horší než žádná.
 *
 * @param {object} a
 * @param {string} a.nazev
 * @param {number[]} a.bbox
 * @param {Array} a.archivy   výstup {@link popisArchivu}
 * @param {number} a.doZoomu
 * @param {(stav: {hotovo: number, celkem: number, bajtu: number}) => void} [a.prubeh]
 * @param {AbortSignal} [a.signal]
 */
export async function stahni({ nazev, bbox, archivy, doZoomu, prubeh = () => {}, signal }) {
  const plan = planStazeni(bbox, archivy, doZoomu);
  const seznamDlazdic = [...dlazdice(plan)];
  const celkem = seznamDlazdic.length;
  const klice = [];
  let bajtu = 0;
  let hotovo = 0;

  // Uložení v úložišti, které prohlížeč při nedostatku místa nesmaže sám.
  try { await globalThis.navigator?.storage?.persist?.(); } catch { /* jen prosba */ }

  const instance = new Map(archivy.map((a) => [a.url, new globalThis.pmtiles.PMTiles(a.url)]));
  const protokol = new globalThis.pmtiles.Protocol();

  try {
    // Popis archivu — týž, jaký si říká mapa. Bez něj by offline mapa
    // nevěděla, že archiv vůbec existuje.
    for (const a of archivy) {
      if (!plan.some((p) => p.url === a.url)) continue;
      const json = await protokol.tilev4({ type: 'json', url: `pmtiles://${a.url}` }, new AbortController());
      await tx('tilejson', 'readwrite', (s) => s.put(json.data, a.url));
    }

    let davka = [];
    const zapis = async () => {
      if (!davka.length) return;
      const kus = davka;
      davka = [];
      await tx('dlazdice', 'readwrite', (s) => { for (const [k, data] of kus) s.put(data, k); });
    };

    let i = 0;
    const pracovnik = async () => {
      while (i < celkem) {
        if (signal?.aborted) throw new DOMException('Zrušeno', 'AbortError');
        const d = seznamDlazdic[i++];
        let r;
        for (let pokus = 0; ; pokus++) {
          try {
            r = await instance.get(d.url).getZxy(d.z, d.x, d.y, signal);
            break;
          } catch (e) {
            if (signal?.aborted || pokus >= 2) throw e;
            await new Promise((ok) => setTimeout(ok, 600 * (pokus + 1)));
          }
        }
        // ⚠️ Chybějící dlaždice (moře, okraj archivu) se uloží PRÁZDNÁ —
        // jako ji vrací protokol. Jinak by se offline mapa ptala sítě
        // a čekala na odpověď, která nepřijde.
        const data = r ? r.data : new ArrayBuffer(0);
        const k = klic(d.url, d.z, d.x, d.y);
        davka.push([k, data]);
        klice.push(k);
        bajtu += data.byteLength;
        hotovo++;
        if (davka.length >= DAVKA) await zapis();
        prubeh({ hotovo, celkem, bajtu });
      }
    };
    await Promise.all(Array.from({ length: Math.min(NARAZ, celkem) }, pracovnik));
    await zapis();

    const oblast = {
      id: Date.now().toString(36),
      nazev,
      bbox,
      doZoomu,
      dlazdic: celkem,
      bajtu,
      kdy: Date.now(),
      klice,
    };
    await tx('oblasti', 'readwrite', (s) => s.put(oblast));
    await obnovStav();
    const { klice: _k, ...bezKlicu } = oblast;
    return bezKlicu;
  } catch (e) {
    // Úklid: jen to, co nepatří jiné oblasti.
    const vse = await tx('oblasti', 'readonly', (s) => s.getAll()).catch(() => []);
    const jinde = new Set(vse.flatMap((o) => o.klice || []));
    await uklid(klice.filter((k) => !jinde.has(k))).catch(() => {});
    throw e;
  }
}

/**
 * „Doma začne pršet asi za 15 minut" — začátek deště z radaru ČHMÚ pro
 * hlídaná místa (`R42`).
 *
 * ⚠️ ČISTÝ MODUL. Server sem pošle přečtené pixely (`png-index.js`),
 * tady se z nich staví mřížka a rozhoduje. Žádná síť, žádné DOM.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ
 *
 * Miki 13. 10. 2026 vybral z návrhů jako druhou „top pecku". Pes na
 * zahradě, prádlo venku: bouřku hlídá `R37`, ale obyčejný déšť, který
 * za čtvrt hodiny zmáčí všechno, nehlídalo nic.
 *
 * STEJNÉ DVA ZDROJE JAKO BOUŘKA (`R37`)
 *
 *   · **pozorování** (`z_max3d`) říká, kde PRŠÍ TEĎ — tam se nezvoní,
 *     déšť už je tady a člověk ho vidí;
 *   · **předpověď ČHMÚ** (`fct_z_max`, +10 až +60 min) říká, KDY tam
 *     začne pršet.
 *
 * MŘÍŽKA, NE SEZNAM BODŮ
 *
 * Podklad je SPOLEČNÝ VŠEM (cache, `filterByPlace`), takže nemůže obsahovat
 * odpověď pro místo — jen to, z čeho se odpověď pro libovolné místo dá
 * přečíst. U bouřky stačí seznam jader (je jich pár). Déšť ale bývá na
 * půlce Česka, takže seznam pixelů by měl statisíce položek. Proto mřížka
 * po 2 × 2 px (~2 km) s jedním bajtem na buňku, zhuštěná po úsecích
 * (`zhusti`): v suchu je to pár čísel, v plošném dešti pár tisíc.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { t, tf } from './i18n.js';
import { isUsablePoint } from './geo-query.js';
import { VYREZ, NEJSTARSI_BEH_MS } from './nowcast.js';
import { pixelBodu, kmNaPixel, SIRKA, VYSKA, NEJSTARSI_POZOROVANI_MS } from './storm-watch.js';

/**
 * Od kolika dBZ je to déšť. 24 dBZ ≈ 1 mm/h — to už zmáčí. Níž jsou
 * mrholení a ozvěny, které na zem nedopadnou, a hlásit je by byl šum.
 */
export const PRAH_DESTE = 24;

/** Kolik pixelů (~km) má strana buňky mřížky. */
export const BUNKA = 2;

/** Okruh kolem místa, ve kterém se déšť hledá. */
export const OKRUH_KM = 3;

/**
 * Jak dlouho po dešti mlčet. Počítá se od POSLEDNÍHO deště viděného
 * u místa (teď nebo v předpovědi), ne od zazvonění: v přeháňkách by se
 * jinak ozvalo každou čtvrthodinu — a takový kanál si člověk vypne.
 * Rozhoduje server, obal jen porovná čas (`R17`).
 */
export const TICHO_MIN = 90;

/** Hodnoty buňky. */
export const PRSI = 0;
export const NIC = 255;

/**
 * Mřížka deště: v buňce 0 = prší teď, 10–60 = minuta předpovědi, kdy tam
 * poprvé zaprší, 255 = do hodiny nic.
 *
 * @param {Uint8Array} pixelyTed   pozorování
 * @param {Uint8Array} dbzTed      index → dBZ pro pozorování
 * @param {Array<{minut: number, pixely: Uint8Array}>} snimky  předpověď
 * @param {Uint8Array} dbz         index → dBZ pro předpověď
 * @returns {Uint8Array} `ceil(sirka/BUNKA) × ceil(vyska/BUNKA)`
 */
export function mrizkaDeste(pixelyTed, dbzTed, snimky, dbz, sirka = SIRKA, vyska = VYSKA) {
  const sm = Math.ceil(sirka / BUNKA);
  const vm = Math.ceil(vyska / BUNKA);
  const m = new Uint8Array(sm * vm).fill(NIC);
  const bunka = (i) => {
    const x = i % sirka;
    const y = (i - x) / sirka;
    return Math.floor(y / BUNKA) * sm + Math.floor(x / BUNKA);
  };
  // Předpověď nejdřív, pozdější snímek přepíše jen to, kde ještě nic není.
  for (const s of [...(snimky || [])].sort((a, b) => a.minut - b.minut)) {
    for (let i = 0; i < s.pixely.length; i++) {
      if (dbz[s.pixely[i]] < PRAH_DESTE) continue;
      const b = bunka(i);
      if (m[b] === NIC) m[b] = Math.min(254, Math.max(1, s.minut));
    }
  }
  // Pozorování přebíjí předpověď: kde prší teď, prší teď.
  for (let i = 0; i < (pixelyTed?.length || 0); i++) {
    if (dbzTed[pixelyTed[i]] >= PRAH_DESTE) m[bunka(i)] = PRSI;
  }
  return m;
}

/**
 * Zhuštění po úsecích: `[hodnota, délka, hodnota, délka, …]`.
 * Mřížka je z velké části `NIC` a v dešti souvislé plochy — úseky ji
 * zmenší o dva až tři řády a vejde se do cache i do JSON.
 */
export function zhusti(mrizka) {
  const out = [];
  let i = 0;
  while (i < mrizka.length) {
    const v = mrizka[i];
    let n = 1;
    while (i + n < mrizka.length && mrizka[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

/** Zpět z úseků. Vadné úseky (jiná délka) → `null`, ne posunutá mřížka. */
export function rozbal(useky, delka) {
  if (!Array.isArray(useky) || useky.length % 2) return null;
  const m = new Uint8Array(delka);
  let i = 0;
  for (let k = 0; k < useky.length; k += 2) {
    const [v, n] = [useky[k], useky[k + 1]];
    if (!Number.isInteger(n) || n < 1 || i + n > delka) return null;
    m.fill(v, i, i + n);
    i += n;
  }
  return i === delka ? m : null;
}

/**
 * Začne u místa pršet?
 *
 * 🚨 `nevim` a `mimo` nejsou `sucho` — starý radar se nesmí tvářit jako
 * „nic nepřijde" (`R20`, `R37`).
 *
 * @param {object} digest  podklad bouřky s polem `dest` (`server/chmi-storm.js`)
 * @returns {{stav: 'dest'|'prsi'|'sucho'|'mimo'|'nevim', za?: number, duvod?: string}}
 */
export function destProMisto(digest, { lat, lon, nowMs }) {
  if (!isUsablePoint({ lat, lon })) return { stav: 'nevim', duvod: 'Chybí místo.' };
  if (!digest || !Array.isArray(digest.dest)) return { stav: 'nevim', duvod: 'Mřížka deště chybí.' };
  if (!(nowMs - digest.pozorovanoMs <= NEJSTARSI_POZOROVANI_MS)) return { stav: 'nevim', duvod: 'Snímek radaru je starý.' };
  if (!(nowMs - digest.behMs <= NEJSTARSI_BEH_MS)) return { stav: 'nevim', duvod: 'Předpověď radaru je stará.' };

  const sirka = digest.sirka || SIRKA;
  const vyska = digest.vyska || VYSKA;
  const vyrez = digest.vyrez || VYREZ;
  const sm = Math.ceil(sirka / BUNKA);
  const vm = Math.ceil(vyska / BUNKA);
  const m = rozbal(digest.dest, sm * vm);
  if (!m) return { stav: 'nevim', duvod: 'Mřížka deště je poškozená.' };

  const bod = pixelBodu(lat, lon, vyrez, sirka, vyska);
  if (!bod) return { stav: 'mimo' };
  const kmBunka = kmNaPixel(lat, vyrez, sirka) * BUNKA;
  const bx = bod.x / BUNKA;
  const by = bod.y / BUNKA;
  const r = Math.ceil(OKRUH_KM / kmBunka);

  let prsi = false;
  let minut = null;
  for (let y = Math.max(0, Math.floor(by) - r); y <= Math.min(vm - 1, Math.floor(by) + r); y++) {
    for (let x = Math.max(0, Math.floor(bx) - r); x <= Math.min(sm - 1, Math.floor(bx) + r); x++) {
      if (Math.hypot(x + 0.5 - bx, y + 0.5 - by) * kmBunka > OKRUH_KM) continue;
      const v = m[y * sm + x];
      if (v === PRSI) prsi = true;
      else if (v !== NIC && (minut === null || v < minut)) minut = v;
    }
  }
  if (prsi) return { stav: 'prsi' };
  if (minut === null) return { stav: 'sucho' };
  return { stav: 'dest', za: Math.max(0, Math.round((digest.behMs + minut * 60_000 - nowMs) / 60_000)) };
}

/**
 * Věta do upozornění. Nadpis s MÍSTEM skládá web (`rain.title`).
 * ⚠️ Déšť není nebezpečí — tón smí být lehčí, ale věta musí říct, co dělat.
 */
export function textDeste(v, lang = 'cs') {
  if (!v || v.stav !== 'dest') return '';
  const kdy = v.za <= 10
    ? t('rain.soon', lang)
    : tf('rain.coming', { min: String(Math.round(v.za / 5) * 5) }, lang);
  return `${kdy} ${t('rain.advice', lang)} ${t('storm.source', lang)}`;
}

/**
 * Část odpovědi `/api/storm` o dešti pro jedno místo — z podkladu, který
 * leží v cache. Skládá ji `filterByPlace` vedle bouřky.
 *
 * ⚠️ `tichoMin` posílá server, aby obal nemusel znát žádné číslo o počasí.
 */
export function odpovedDeste(digest, params = {}, nowMs = 0) {
  const lang = String(params.lang || 'cs').slice(0, 2);
  const lat = params.lat == null || params.lat === '' ? NaN : Number(params.lat);
  const lon = params.lon == null || params.lon === '' ? NaN : Number(params.lon);
  const v = destProMisto(digest, { lat, lon, nowMs });
  return {
    stav: v.stav,
    ...(v.stav === 'dest' ? { za: v.za, text: textDeste(v, lang) } : {}),
    ...(v.duvod ? { duvod: v.duvod } : {}),
    tichoMin: TICHO_MIN,
  };
}

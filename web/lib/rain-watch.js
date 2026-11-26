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
 *     déšť už je tady a člověk ho vidí; VÝJIMKA je déšť, který tam před
 *     `ZACALO_MIN` minutami ještě nebyl (`R50`, „Právě začalo");
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

/**
 * Od kolika dBZ je to SNÍH, když v místě mrzne (`R49`).
 *
 * 🚨 Sníh se na radaru odráží mnohem slaběji než déšť stejné vydatnosti:
 * led vrací asi pětinu toho co voda (|K|² 0,18 proti 0,93, tedy o ~7 dB
 * míň) a vločky padají pomalu. 26. 11. 2026 v 11:10 SEČ sněžilo v Brně
 * pod výstrahou ČHMÚ „Velmi rizikové sněhové jevy" a radar tam měl
 * 12–20 dBZ; nad celým Českem bylo nad 24 dBZ jen 1 186 pixelů z ~87 000
 * se srážkami. S prahem pro déšť appka sníh neviděla VŮBEC — Miki:
 * *„všechny appky hlásí sněžení, už i padá, a meteotrace nereaguje"*.
 * 12 dBZ ≈ 0,2 mm/h vody, tedy sníh, který je vidět a začne bělit.
 * Níž (4–8 dBZ) bývají vločky, které se ve vzduchu vypaří.
 */
export const PRAH_SNEHU = 12;

/**
 * Vlhká teplota (°C), pod kterou srážky padají jako sníh. Vlhká, ne
 * obyčejná: v suchém vzduchu sněží i při +2 °C, protože vločka se
 * odpařováním ochlazuje. Kolem 1 °C je sníh a déšť zhruba půl na půl.
 */
export const MRZNE_TW = 1;

/** Když chybí vlhká teplota, rozhoduje obyčejná (bez vlhkosti opatrněji). */
export const MRZNE_T = 1;

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

/**
 * „Právě začalo" (`R50`): o kolik minut starší snímek pozorování se
 * porovnává. Kde teď prší a tehdy v okruhu nepršelo, srážky vznikly na
 * místě nebo je předpověď minula — a ozve se to, ne mlčí.
 *
 * 🚨 26. 11. 2026 sníh nad Horšovským Týnem NEPŘIŠEL, vznikl tam: radar
 * do 11:20 nic, v 11:30 sněží. Předpověď ČHMÚ jen posouvá, co už na radaru
 * je, takže příchod nehlásila při žádném prahu (12, 8 ani 4 dBZ) a appka
 * skočila ze „sucha" rovnou na „už sněží", kde se mlčelo. Miki: *„to je
 * právě to, jak vznikají i náhlé lokální bouřky, a to se snažíme pořešit"*.
 *
 * 20 minut kryje mezeru mezi kontrolami obalu (budík 10–17,5 min): začátek
 * se nepromešká. Opakování hlídá ticho obalu (`TICHO_MIN` od posledních
 * srážek viděných u místa), takže se ozve jednou.
 */
export const ZACALO_MIN = 20;

/** Hodnoty buňky. */
export const PRSI = 0;
export const NIC = 255;

/**
 * Mřížka deště: v buňce 0 = prší teď, 10–60 = minuta předpovědi, kdy tam
 * poprvé zaprší, 255 = do hodiny nic.
 *
 * Táž mřížka s nižším prahem (`PRAH_SNEHU`) slouží pro sníh — podklad
 * nese obě (`dest`, `snih`), protože jestli v místě mrzne, se pozná až
 * u místa, za cache.
 *
 * @param {Uint8Array} pixelyTed   pozorování
 * @param {Uint8Array} dbzTed      index → dBZ pro pozorování
 * @param {Array<{minut: number, pixely: Uint8Array}>} snimky  předpověď
 * @param {Uint8Array} dbz         index → dBZ pro předpověď
 * @param {number} [sirka]
 * @param {number} [vyska]
 * @param {number} [prah]          od kolika dBZ se buňka počítá
 * @returns {Uint8Array} `ceil(sirka/BUNKA) × ceil(vyska/BUNKA)`
 */
export function mrizkaDeste(pixelyTed, dbzTed, snimky, dbz, sirka = SIRKA, vyska = VYSKA, prah = PRAH_DESTE) {
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
      if (dbz[s.pixely[i]] < prah) continue;
      const b = bunka(i);
      if (m[b] === NIC) m[b] = Math.min(254, Math.max(1, s.minut));
    }
  }
  // Pozorování přebíjí předpověď: kde prší teď, prší teď.
  for (let i = 0; i < (pixelyTed?.length || 0); i++) {
    if (dbzTed[pixelyTed[i]] >= prah) m[bunka(i)] = PRSI;
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
 * @param {{lat: number, lon: number, nowMs: number}} kde
 * @param {'dest'|'snih'} [mrizka]  kterou mřížku číst: déšť, nebo sníh (`R49`)
 * 🚨 „Právě začalo" (`R50`) vrací `stav: 'dest'`, `za: 0`, `zacalo: true`:
 * obal zvoní jen na `dest` a nemění se — rozdíl nese jen věta.
 *
 * @returns {{stav: 'dest'|'prsi'|'sucho'|'mimo'|'nevim', za?: number, zacalo?: true, duvod?: string}}
 */
export function destProMisto(digest, { lat, lon, nowMs }, mrizka = 'dest') {
  if (!isUsablePoint({ lat, lon })) return { stav: 'nevim', duvod: 'Chybí místo.' };
  if (!digest || !Array.isArray(digest[mrizka])) return { stav: 'nevim', duvod: 'Mřížka srážek chybí.' };
  if (!(nowMs - digest.pozorovanoMs <= NEJSTARSI_POZOROVANI_MS)) return { stav: 'nevim', duvod: 'Snímek radaru je starý.' };
  if (!(nowMs - digest.behMs <= NEJSTARSI_BEH_MS)) return { stav: 'nevim', duvod: 'Předpověď radaru je stará.' };

  const sirka = digest.sirka || SIRKA;
  const vyska = digest.vyska || VYSKA;
  const vyrez = digest.vyrez || VYREZ;
  const sm = Math.ceil(sirka / BUNKA);
  const vm = Math.ceil(vyska / BUNKA);
  const m = rozbal(digest[mrizka], sm * vm);
  if (!m) return { stav: 'nevim', duvod: 'Mřížka deště je poškozená.' };

  const bod = pixelBodu(lat, lon, vyrez, sirka, vyska);
  if (!bod) return { stav: 'mimo' };
  const kmBunka = kmNaPixel(lat, vyrez, sirka) * BUNKA;
  const bx = bod.x / BUNKA;
  const by = bod.y / BUNKA;
  const r = Math.ceil(OKRUH_KM / kmBunka);

  /** Buňky v okruhu místa, jedna po druhé. */
  const vOkruhu = (mr, fn) => {
    for (let y = Math.max(0, Math.floor(by) - r); y <= Math.min(vm - 1, Math.floor(by) + r); y++) {
      for (let x = Math.max(0, Math.floor(bx) - r); x <= Math.min(sm - 1, Math.floor(bx) + r); x++) {
        if (Math.hypot(x + 0.5 - bx, y + 0.5 - by) * kmBunka > OKRUH_KM) continue;
        fn(mr[y * sm + x]);
      }
    }
  };

  let prsi = false;
  let minut = null;
  vOkruhu(m, (v) => {
    if (v === PRSI) prsi = true;
    else if (v !== NIC && (minut === null || v < minut)) minut = v;
  });
  if (prsi) {
    // „Právě začalo" (`R50`): před `ZACALO_MIN` minutami tu nepadalo nic.
    // ⚠️ Bez staršího snímku (`driv` chybí, podklad je starý nebo snímek
    // nepřišel) se netvrdí nic: „prší" jako dřív, ne „začalo".
    const driv = digest.driv?.[mrizka];
    const mDriv = Array.isArray(driv) ? rozbal(driv, sm * vm) : null;
    if (mDriv) {
      let tehdy = false;
      vOkruhu(mDriv, (v) => { if (v === PRSI) tehdy = true; });
      if (!tehdy) return { stav: 'dest', za: 0, zacalo: true };
    }
    return { stav: 'prsi' };
  }
  if (minut === null) return { stav: 'sucho' };
  return { stav: 'dest', za: Math.max(0, Math.round((digest.behMs + minut * 60_000 - nowMs) / 60_000)) };
}

/**
 * Věta do upozornění. Nadpis s MÍSTEM skládá web (`rain.title`).
 * ⚠️ Déšť není nebezpečí — tón smí být lehčí, ale věta musí říct, co dělat.
 * Nebezpečný sníh hlásí výstrahy ČHMÚ, tohle je jen „za chvíli to začne".
 *
 * @param {boolean} [snih]  věta o sněhu místo o dešti (`R49`)
 */
export function textDeste(v, lang = 'cs', snih = false) {
  if (!v || v.stav !== 'dest') return '';
  const k = snih
    ? { soon: 'rain.snowSoon', coming: 'rain.snowComing', started: 'rain.snowStarted', advice: 'rain.snowAdvice' }
    : { soon: 'rain.soon', coming: 'rain.coming', started: 'rain.started', advice: 'rain.advice' };
  const kdy = v.zacalo
    ? t(k.started, lang)
    : v.za <= 10
      ? t(k.soon, lang)
      : tf(k.coming, { min: String(Math.round(v.za / 5) * 5) }, lang);
  return `${kdy} ${t(k.advice, lang)} ${t('storm.source', lang)}`;
}

/**
 * Bude to sníh? Z teploty v místě (`server/faze-srazek.js`).
 *
 * @param {{tw?: number, t?: number}|null} faze  vlhká a obyčejná teplota (°C)
 * @returns {boolean|null}  `null` = nevíme (teplota chybí)
 */
export function jeSnih(faze) {
  if (Number.isFinite(faze?.tw)) return faze.tw <= MRZNE_TW;
  if (Number.isFinite(faze?.t)) return faze.t <= MRZNE_T;
  return null;
}

/**
 * Potřebuje místo vědět, jestli mrzne? Jen když se k němu blíží (nebo už
 * u něj padají) aspoň slabé srážky — jinak se na teplotu neptáme vůbec
 * a ven se nechodí (`R49`).
 */
export function potrebujeFazi(digest, { lat, lon, nowMs }) {
  if (!isUsablePoint({ lat, lon }) || !Array.isArray(digest?.snih)) return false;
  const v = destProMisto(digest, { lat, lon, nowMs }, 'snih');
  return v.stav === 'dest' || v.stav === 'prsi';
}

/**
 * Část odpovědi `/api/storm` o dešti pro jedno místo — z podkladu, který
 * leží v cache. Skládá ji `filterByPlace` vedle bouřky.
 *
 * ⚠️ `tichoMin` posílá server, aby obal nemusel znát žádné číslo o počasí.
 *
 * 🚨 SNÍH (`R49`): když v místě mrzne, čte se mřížka se slabším prahem
 * a věta mluví o sněhu. Obal se nemění — dostane tentýž `stav` a hotovou
 * větu, jen navíc `druh: 'snih'`. Bez teploty (`faze` chybí, zdroj
 * neodpověděl) zůstává déšť jako dřív: tvrdit sníh naslepo nejde.
 *
 * @param {{tw?: number, t?: number}|null} [faze]  teplota v místě
 */
export function odpovedDeste(digest, params = {}, nowMs = 0, faze = null) {
  const lang = String(params.lang || 'cs').slice(0, 2);
  const lat = params.lat == null || params.lat === '' ? NaN : Number(params.lat);
  const lon = params.lon == null || params.lon === '' ? NaN : Number(params.lon);
  const snih = jeSnih(faze) === true && Array.isArray(digest?.snih);
  const v = destProMisto(digest, { lat, lon, nowMs }, snih ? 'snih' : 'dest');
  return {
    stav: v.stav,
    ...(snih ? { druh: 'snih' } : {}),
    ...(v.stav === 'dest' ? { za: v.za, text: textDeste(v, lang, snih) } : {}),
    ...(v.zacalo ? { zacalo: true } : {}),
    ...(v.duvod ? { duvod: v.duvod } : {}),
    tichoMin: TICHO_MIN,
  };
}

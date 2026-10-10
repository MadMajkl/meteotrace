/**
 * Hlídaná místa (`R38`): pro která místa obal hlídá výstrahy a bouřky.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě, bez úložiště. Používá ho appka (co
 * poslat obalu) i server (jak přečíst seznam míst v dotazu).
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TENHLE SOUBOR EXISTUJE
 *
 * Do 10. 10. 2026 hlídal obal JEDNO místo — to, které měl člověk zrovna
 * otevřené na meteostanici. Michal: *„to je třeba totiž, třeba právě kvůli
 * tomu psu, ale já jsem třeba v práci v Plzni."* Kdo si v práci otevřel
 * Plzeň, přestal tím hlídat domov — a 8. 10. mu před bouřkou utekl pes.
 *
 * Hlídání proto patří k ULOŽENÉMU MÍSTU, ne k tomu, na co se člověk právě
 * dívá. Uložená místa se zapínají zvonkem ve správě míst.
 *
 * ⚠️ Bez jediného zapnutého místa se hlídá to otevřené, tak jako dřív.
 * Kdo upozornění zapnul ve starší verzi, nesmí o ně po aktualizaci tiše
 * přijít jen proto, že ještě nic neoznačil.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { isUsablePoint } from './geo-query.js';

/**
 * Kolik míst jde hlídat naráz.
 *
 * ⚠️ Strop je i na serveru (`mistaZDotazu`) a v obalu (`Vystrahy.MAX_MIST`).
 * Kontrola jede každých ~10 minut na pozadí každého telefonu — bez stropu
 * by se z jednoho telefonu dal udělat dotaz na celou republiku.
 */
export const MAX_HLIDANYCH = 5;

/* ============================================================
   CO SE HLÍDÁ
   ============================================================ */

/**
 * Seznam klíčů očištěný proti skladu: jen existující místa, bez
 * opakování, nejvýš {@link MAX_HLIDANYCH}.
 *
 * 🚨 Smazané místo se z hlídání vyřadí SAMO. Kdyby jeho klíč zůstal,
 * hlídalo by se místo, které v seznamu už není — a upozornění na něj by
 * nešlo nijak vypnout.
 *
 * @param {{places: Array<{key: string}>}} store
 * @param {unknown} klice
 * @returns {string[]}
 */
export function vycistiKlice(store, klice) {
  if (!Array.isArray(klice)) return [];
  const existuji = new Set((store?.places || []).map((p) => p.key));
  const out = [];
  for (const k of klice) {
    if (typeof k !== 'string' || !existuji.has(k) || out.includes(k)) continue;
    out.push(k);
    if (out.length >= MAX_HLIDANYCH) break;
  }
  return out;
}

/** Hlídá se tohle uložené místo? */
export function jeHlidane(klice, key) {
  return Array.isArray(klice) && klice.includes(key);
}

/**
 * Zapne nebo vypne hlídání jednoho uloženého místa.
 *
 * ⚠️ Plno = nic se nemění a volající to MUSÍ říct nahlas. Zvonek, který po
 * klepnutí jen zůstane zhasnutý, vypadá jako rozbitý.
 *
 * @returns {{klice: string[], plno: boolean}}
 */
export function prepniHlidani(store, klice, key) {
  const ted = vycistiKlice(store, klice);
  if (ted.includes(key)) return { klice: ted.filter((k) => k !== key), plno: false };
  if (!(store?.places || []).some((p) => p.key === key)) return { klice: ted, plno: false };
  if (ted.length >= MAX_HLIDANYCH) return { klice: ted, plno: true };
  return { klice: [...ted, key], plno: false };
}

/**
 * Místa, která má obal hlídat.
 *
 * Pořadí je pořadí ve skladu (jak je člověk vidí ve správě míst), ne pořadí
 * zapínání — seznam v nastavení se pak čte stejně jako seznam míst.
 *
 * @param {{places: Array<{key: string, name: string, lat: number, lon: number}>}} store
 * @param {unknown} klice           klíče zapnutých míst
 * @param {{name?: string, lat: number, lon: number}|null} otevrene  místo na meteostanici
 * @returns {{mista: Array<{key: string|null, name: string, lat: number, lon: number}>, zOtevreneho: boolean}}
 *   `zOtevreneho` = nic zapnutého není a hlídá se otevřené místo
 */
export function hlidanaMista(store, klice, otevrene) {
  const zapnute = new Set(vycistiKlice(store, klice));
  const mista = (store?.places || [])
    .filter((p) => zapnute.has(p.key) && isUsablePoint(p))
    .map((p) => ({ key: p.key, name: p.name, lat: p.lat, lon: p.lon }));
  if (mista.length) return { mista, zOtevreneho: false };

  if (isUsablePoint(otevrene)) {
    return {
      mista: [{ key: null, name: otevrene.name || '', lat: Number(otevrene.lat), lon: Number(otevrene.lon) }],
      zOtevreneho: true,
    };
  }
  return { mista: [], zOtevreneho: false };
}

/* ============================================================
   SEZNAM MÍST V DOTAZU NA SERVER
   ============================================================ */

/**
 * Jeden bod v dotazu. Čtyři desetinná místa jsou ~11 m — přesnost, kterou
 * radar (1 km) ani hranice okresů nepoznají, a kratší adresa.
 */
const BOD = /^-?\d{1,3}(?:\.\d{1,7})?,-?\d{1,3}(?:\.\d{1,7})?$/;

/**
 * Místa → hodnota parametru `mista`: `49.5302,12.9441;49.7384,13.3736`.
 *
 * 🚨 Všechna místa JEDNÍM dotazem. Kontrola jede každých ~10 minut na pozadí
 * každého telefonu; dotaz za každé místo zvlášť by násobil volání serveru
 * počtem míst — a radar i výstrahy se na serveru čtou stejně jednou pro
 * všechny.
 */
export function mistaDoDotazu(mista) {
  return (mista || [])
    .filter(isUsablePoint)
    .slice(0, MAX_HLIDANYCH)
    .map((m) => `${Number(m.lat).toFixed(4)},${Number(m.lon).toFixed(4)}`)
    .join(';');
}

/**
 * Hodnota parametru `mista` → body. Cokoli vadného → `null`, celé.
 *
 * ⚠️ Vadný seznam se NEOPRAVUJE vynecháním vadného bodu. Odpověď se páruje
 * s místy podle pořadí — vynechaný bod by posunul všechna další a výstraha
 * pro Plzeň by se ohlásila jako výstraha pro Horšovský Týn.
 *
 * @param {unknown} text
 * @returns {Array<{lat: number, lon: number}>|null}
 */
export function mistaZDotazu(text) {
  if (typeof text !== 'string' || !text) return null;
  const casti = text.split(';');
  if (casti.length > MAX_HLIDANYCH) return null;
  const out = [];
  for (const c of casti) {
    if (!BOD.test(c)) return null;
    const [lat, lon] = c.split(',').map(Number);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    out.push({ lat, lon });
  }
  return out;
}

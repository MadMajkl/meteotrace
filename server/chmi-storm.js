/**
 * Stavitel podkladu pro bouřku z radaru ČHMÚ (`R37`).
 *
 * Jediné místo, které kvůli tomu sahá na síť. Rozhoduje čistý
 * `web/lib/storm-watch.js`; tady se jen stáhne, rozbalí a přečte.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CO SE VRACÍ — A PROČ NE ROVNOU ODPOVĚĎ PRO MÍSTO
 *
 * Výsledek je SPOLEČNÝ VŠEM: seznam bouřkových jader (teď a před pěti
 * minutami) a stopa předpovědi. Leží v cache pod jedním klíčem a výřez pro
 * místo se z něj krájí až za cache (`filterByPlace`) — stejně jako výstrahy.
 * Každý telefon se ptá po 15 minutách; kdyby se snímky stahovaly a četly
 * pro každé místo zvlášť, platil by to ČHMÚ i my.
 * ────────────────────────────────────────────────────────────────────────
 *
 * 🚨 KDYŽ SE TO NEPOVEDE, VYHODÍ SE CHYBA — žádné tiché „nic tu není".
 * Proxy pak vrátí prošlý podklad z cache (a `bourkaProMisto` ho podle stáří
 * odmítne jako `nevim`), nebo 502, na které obal zkusí znovu.
 */

'use strict';

import { inflateSync } from 'node:zlib';
import { prectiPng } from '../web/lib/png-index.js';
import {
  tabulkaOdrazivosti, souvislaJadra, stopaPredpovedi, nazevSnimku, ZDROJ, LICENCE, SIRKA, VYSKA,
} from '../web/lib/storm-watch.js';
import { kandidatiBehu, nazevBehu, rozbalTar, snimkyZArchivu, VYREZ } from '../web/lib/nowcast.js';

/** Podsložky v adresáři kompozitů ČHMÚ (`base` z katalogu). */
const POZOROVANI = 'maxz/png/';
const PREDPOVED = 'fct_maxz/png/';

/** Kolik pětiminutovek zpátky se zkusí. Poslední ještě nemusí být nahraná. */
const POKUSU = 4;

const inflate = (data) => new Uint8Array(inflateSync(data));

function precti(bajty) {
  const png = prectiPng(bajty, inflate);
  if (png.sirka !== SIRKA || png.vyska !== VYSKA) {
    // 🚨 Jiný rozměr = jiný výřez mapy. Počítat s ním by posunulo bouřky
    // o desítky kilometrů a nikdo by to nepoznal.
    throw new Error(`Snímek radaru má ${png.sirka}×${png.vyska} px, čekalo se ${SIRKA}×${VYSKA}.`);
  }
  return { pixely: png.pixely, dbz: tabulkaOdrazivosti(png.paleta) };
}

async function stahni(fetchImpl, url) {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * @param {object} a
 * @param {Function} a.fetchImpl
 * @param {string} a.base   adresář kompozitů ČHMÚ (z katalogu)
 * @param {number} a.nowMs
 * @param {Function} [a.log]
 */
export async function stavBourky({ fetchImpl, base, nowMs, log = () => {} }) {
  // 1) Pozorování: nejnovější snímek a k němu ten předchozí. Stahují se
  //    naráz — čtyři malé soubory (~40 kB), čekat na ně po jednom by
  //    zbytečně natahovalo odpověď.
  const casy = [];
  for (let i = 0; i < POKUSU + 2; i++) casy.push(Math.floor(nowMs / 300_000) * 300_000 - i * 300_000);
  const soubory = await Promise.all(casy.map((ms) => stahni(fetchImpl, base + POZOROVANI + nazevSnimku(ms))));

  const iTed = soubory.findIndex(Boolean);
  if (iTed < 0 || iTed >= POKUSU) throw new Error('Pozorování radaru ČHMÚ se nepodařilo stáhnout.');
  // ⚠️ Předchozí smí být o 5, nanejvýš o 10 minut starší. Bez něj se nedá
  // potvrdit, že jádro není jednorázový záblesk — a pak se radši neví nic.
  const iPredtim = [iTed + 1, iTed + 2].find((i) => soubory[i]);
  if (iPredtim === undefined) throw new Error('Chybí předchozí snímek radaru, jádra nejde potvrdit.');

  const ted = precti(soubory[iTed]);
  const predtim = precti(soubory[iPredtim]);

  // 2) Předpověď: nejnovější běh, po řadě zpátky (jako `stavNowcast`).
  let beh = null;
  let stopa = null;
  for (const kandidat of kandidatiBehu(nowMs, POKUSU)) {
    const tar = await stahni(fetchImpl, base + PREDPOVED + nazevBehu(kandidat));
    if (!tar) continue;
    let snimky;
    try {
      snimky = snimkyZArchivu(rozbalTar(tar));
    } catch (e) {
      log('bouřka: archiv předpovědi se nerozbalil', { chyba: e.message });
      continue;
    }
    if (!snimky.length) continue;
    const prectene = snimky.map((s) => ({ minut: s.minut, ...precti(s.data) }));
    stopa = stopaPredpovedi(prectene.map(({ minut, pixely }) => ({ minut, pixely })), prectene[0].dbz);
    beh = kandidat;
    break;
  }
  if (!stopa) throw new Error('Předpověď radaru ČHMÚ se nepodařilo stáhnout.');

  const vysledek = {
    zdroj: ZDROJ,
    licence: LICENCE,
    sirka: SIRKA,
    vyska: VYSKA,
    vyrez: VYREZ,
    pozorovanoMs: casy[iTed],
    predtimMs: casy[iPredtim],
    behMs: beh,
    jadra: souvislaJadra(ted.pixely, ted.dbz),
    jadraPredtim: souvislaJadra(predtim.pixely, predtim.dbz),
    stopa,
  };
  log('bouřka: radar přečten', {
    pozorovano: new Date(vysledek.pozorovanoMs).toISOString(),
    beh: new Date(beh).toISOString(),
    jader: vysledek.jadra.length,
    stopa: stopa.length,
  });
  return vysledek;
}

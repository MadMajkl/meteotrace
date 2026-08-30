/**
 * QR kód — vlastní enkodér (režim bajtů, korekce M, verze 1–10).
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě, bez knihovny. Vrací matici bodů;
 * jak se nakreslí (SVG, canvas, papír), rozhoduje UI.
 *
 * 🚨 PROČ VLASTNÍ, KDYŽ EXISTUJE `qrcode.min.js` (a Gulpka ho používá)?
 * Tenhle kód kreslí ČÍSLO ÚČTU. Chybně zakódovaný QR není rozbitá appka —
 * je to platba, která odejde jinam, a nikdo se to nedozví. K takovému místu
 * nechceme minifikovanou cizí kouli, do které není vidět. Navíc je to
 * uzavřená úloha bez závislostí (`R0`), kterou umí ověřit stroj: v testu
 * stojí proti tomuhle enkodéru **samostatně napsaný dekodér**, takže se
 * kontroluje výsledek, ne jen to, že funkce něco vrátila.
 *
 * ⚠️ VERZE JEN DO 10. Delší data vyhodí výjimku místo tichého ořezu —
 * platební řetězec SPD má kolem 100 znaků a verze 10 jich pojme 213.
 * Tabulky pro vyšší verze by šlo dopsat, ale nešly by čím ověřit.
 *
 * Slovníček (QR má vlastní názvosloví):
 *   - **modul** = jeden čtvereček matice; **verze** = velikost (1 = 21×21,
 *     každá další +4 moduly na stranu)
 *   - **kódové slovo** = jeden bajt dat nebo korekce
 *   - **maska** = pravidelný vzor, kterým se plocha překlopí, aby v ní
 *     nevznikly velké jednobarevné plochy; zkouší se všech osm a vybere se
 *     ta s nejmenším penále
 */

'use strict';

/** Úroveň korekce chyb. Používáme M (~15 %) jako většina platebních QR. */
const ECL_M = 0;

/** Počet korekčních slov na blok, verze 1–10, úroveň M. */
const EC_PER_BLOCK = [null, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];

/** Počet bloků, verze 1–10, úroveň M. */
const BLOCKS = [null, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

/** Souřadnice středů zarovnávacích značek podle verze. */
const ALIGN = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/** Nejvyšší podporovaná verze. Nad ní se vyhazuje výjimka, ne ořez. */
export const MAX_VERSION = 10;

/* ============================================================
   GALOISOVO TĚLESO GF(256)

   Korekce chyb (Reed–Solomon) počítá v tělese, kde sčítání je XOR
   a násobení se dělá přes logaritmy. Tabulky se postaví jednou.
   ============================================================ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;   // neredukovatelný polynom QR normy
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function gfMul(a, b) {
  return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
}

/**
 * Generující polynom pro `stupen` korekčních slov: (x−α⁰)(x−α¹)…
 *
 * 🚨 Koeficienty jdou od NEJVYŠŠÍHO stupně (`poly[0]` = 1). Poskládat je
 * obráceně je past, kterou nechytí žádné porovnání se sebou samým:
 * enkodér i „ověření" přepočtem si spolu rozumějí a korekce přesto není
 * platná. Pozná se jedině dosazením kořenů (syndromy v testu).
 */
function generator(stupen) {
  let poly = [1];
  for (let i = 0; i < stupen; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                          // člen s x
      next[j + 1] ^= gfMul(poly[j], EXP[i]);       // člen s α^i
    }
    poly = next;
  }
  return poly;
}

/**
 * Korekční slova pro jeden blok dat.
 *
 * @param {number[]} data
 * @param {number} pocet  kolik korekčních slov vyrobit
 */
export function rsEncode(data, pocet) {
  const gen = generator(pocet);
  const zbytek = new Array(pocet).fill(0);
  for (const bajt of data) {
    const faktor = bajt ^ zbytek[0];
    zbytek.shift();
    zbytek.push(0);
    for (let i = 0; i < pocet; i++) zbytek[i] ^= gfMul(gen[i + 1], faktor);
  }
  return zbytek;
}

/* ============================================================
   KAPACITA
   ============================================================ */

/**
 * Kolik kódových slov (dat + korekce) se vejde do verze.
 *
 * Počítá se, netabuluje: plocha mínus to, co zaberou nefunkční vzory.
 * Ověřeno proti známým hodnotám (v1 = 26, v7 = 196, v10 = 346).
 */
export function totalCodewords(version) {
  let moduly = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    moduly -= (25 * n - 10) * n - 55;
  }
  if (version >= 7) moduly -= 36;   // pole s číslem verze, dvakrát
  return Math.floor(moduly / 8);
}

/** Kolik kódových slov ve verzi zbude na data (zbytek je korekce). */
export function dataCodewords(version) {
  return totalCodewords(version) - EC_PER_BLOCK[version] * BLOCKS[version];
}

/** Kolik bitů zabere údaj o délce dat. Od verze 10 je pole širší. */
function countBits(version) {
  return version < 10 ? 8 : 16;
}

/** Nejmenší verze, do které se `bajtu` bajtů vejde. `null` = nevejde nikam. */
export function fitVersion(bajtu) {
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (dataCodewords(v) * 8 >= 4 + countBits(v) + bajtu * 8) return v;
  }
  return null;
}

/* ============================================================
   DATOVÁ ČÁST
   ============================================================ */

/** Bity → pole kódových slov, i s výplní do plné kapacity. */
function bitsToCodewords(bity, version) {
  const kapacita = dataCodewords(version) * 8;
  if (bity.length > kapacita) throw new RangeError('QR: data přetekla verzi');

  // Ukončovač: až čtyři nuly, ale ne přes okraj.
  for (let i = 0; i < 4 && bity.length < kapacita; i++) bity.push(0);
  // Doplnit do celého bajtu.
  while (bity.length % 8 !== 0) bity.push(0);

  const slova = [];
  for (let i = 0; i < bity.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bity[i + j];
    slova.push(b);
  }
  // Výplňové bajty se střídají — tak to norma předepisuje.
  const vypln = [0xec, 0x11];
  for (let i = 0; slova.length < dataCodewords(version); i++) slova.push(vypln[i % 2]);
  return slova;
}

/**
 * Rozdělení do bloků, korekce a proplétání.
 *
 * ⚠️ Kódová slova se do matice NEUKLÁDAJÍ za sebou, ale prokládaně mezi
 * bloky. Poškrábání pak nesebere celý blok, ale kousek z každého — a to
 * korekce ještě opraví.
 */
function interleave(slova, version) {
  const bloku = BLOCKS[version];
  const ecLen = EC_PER_BLOCK[version];
  const kratkych = bloku - (dataCodewords(version) % bloku);
  const kratkaDelka = Math.floor(dataCodewords(version) / bloku);

  const data = [];
  const ec = [];
  let pozice = 0;
  for (let i = 0; i < bloku; i++) {
    const delka = kratkaDelka + (i < kratkych ? 0 : 1);
    const blok = slova.slice(pozice, pozice + delka);
    pozice += delka;
    data.push(blok);
    ec.push(rsEncode(blok, ecLen));
  }

  const vysledek = [];
  for (let i = 0; i < kratkaDelka + 1; i++) {
    for (const blok of data) if (i < blok.length) vysledek.push(blok[i]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const blok of ec) vysledek.push(blok[i]);
  }
  return vysledek;
}

/* ============================================================
   MATICE
   ============================================================ */

/** Prázdná matice i s mapou míst, kam data nesmí. */
function prazdna(size) {
  return {
    size,
    modules: new Uint8Array(size * size),
    reserved: new Uint8Array(size * size),
  };
}

function set(m, r, c, hodnota, rezervovat = true) {
  if (r < 0 || c < 0 || r >= m.size || c >= m.size) return;
  m.modules[r * m.size + c] = hodnota ? 1 : 0;
  if (rezervovat) m.reserved[r * m.size + c] = 1;
}

function get(m, r, c) {
  return m.modules[r * m.size + c];
}

/** Hledáček i s oddělovačem kolem něj (proto poloměr 4, ne 3). */
function drawFinder(m, cr, cc) {
  for (let dr = -4; dr <= 4; dr++) {
    for (let dc = -4; dc <= 4; dc++) {
      const d = Math.max(Math.abs(dr), Math.abs(dc));
      set(m, cr + dr, cc + dc, d !== 2 && d !== 4);
    }
  }
}

function drawAlign(m, cr, cc) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      set(m, cr + dr, cc + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
}

/** Nefunkční vzory: hledáčky, časování, zarovnání, rezervace polí. */
function drawPatterns(m, version) {
  const n = m.size;

  drawFinder(m, 3, 3);
  drawFinder(m, 3, n - 4);
  drawFinder(m, n - 4, 3);

  // Časovací řady — podle nich čtečka pozná rozteč modulů.
  for (let i = 8; i < n - 8; i++) {
    set(m, 6, i, i % 2 === 0);
    set(m, i, 6, i % 2 === 0);
  }

  // Zarovnávací značky. Tři kombinace kolidují s hledáčky a vynechávají se.
  const stredy = ALIGN[version];
  for (const r of stredy) {
    for (const c of stredy) {
      const rohHledacku = (r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8);
      if (!rohHledacku) drawAlign(m, r, c);
    }
  }

  // Pole pro informaci o formátu (vyplní se až se známou maskou).
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { set(m, 8, i, 0); set(m, i, 8, 0); }
  }
  for (let i = 0; i < 8; i++) {
    set(m, 8, n - 1 - i, 0);
    set(m, n - 1 - i, 8, 0);
  }
  // Tenhle jeden modul je vždycky tmavý. Norma, ne rozmar.
  set(m, n - 8, 8, 1);

  if (version >= 7) drawVersion(m, version);
}

/** Číslo verze se od verze 7 píše do matice, jištěné BCH kódem. */
function drawVersion(m, version) {
  let zbytek = version;
  for (let i = 0; i < 12; i++) {
    zbytek = (zbytek << 1) ^ ((zbytek >>> 11) * 0x1f25);
  }
  const bity = (version << 12) | zbytek;

  for (let i = 0; i < 18; i++) {
    const bit = (bity >>> i) & 1;
    const a = Math.floor(i / 3);
    const b = m.size - 11 + (i % 3);
    set(m, a, b, bit);
    set(m, b, a, bit);
  }
}

/** Informace o formátu = úroveň korekce + maska, jištěné BCH kódem. */
function drawFormat(m, maska) {
  const data = (ECL_M << 3) | maska;
  let zbytek = data;
  for (let i = 0; i < 10; i++) {
    zbytek = (zbytek << 1) ^ ((zbytek >>> 9) * 0x537);
  }
  const bity = ((data << 10) | zbytek) ^ 0x5412;

  // ⚠️ Píše se DVAKRÁT, u levého horního hledáčku a rozdělené u zbylých
  // dvou. Kód se má dát přečíst, i když jeden roh chybí.
  const n = m.size;
  for (let i = 0; i <= 5; i++) set(m, i, 8, (bity >>> i) & 1);
  set(m, 7, 8, (bity >>> 6) & 1);
  set(m, 8, 8, (bity >>> 7) & 1);
  set(m, 8, 7, (bity >>> 8) & 1);
  for (let i = 9; i < 15; i++) set(m, 8, 14 - i, (bity >>> i) & 1);

  for (let i = 0; i < 8; i++) set(m, 8, n - 1 - i, (bity >>> i) & 1);
  for (let i = 8; i < 15; i++) set(m, n - 15 + i, 8, (bity >>> i) & 1);
  set(m, n - 8, 8, 1);   // vždycky tmavý, přepíše se sem znovu
}

/**
 * Data cikcakem od pravého dolního rohu, po dvou sloupcích nahoru a dolů.
 *
 * ⚠️ Sloupec 6 (časovací) se přeskakuje celý — jinak by se všechno za ním
 * posunulo o jeden a kód by byl nečitelný, přestože by vypadal správně.
 */
function placeData(m, slova) {
  const n = m.size;
  let bit = 0;
  const celkem = slova.length * 8;

  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const nahoru = ((right + 1) & 2) === 0;
        const r = nahoru ? n - 1 - vert : vert;
        if (m.reserved[r * n + c]) continue;
        let hodnota = 0;
        if (bit < celkem) {
          hodnota = (slova[bit >>> 3] >>> (7 - (bit & 7))) & 1;
          bit++;
        }
        m.modules[r * n + c] = hodnota;
      }
    }
  }
}

/** Osm masek normy. `i` = řádek, `j` = sloupec. */
export const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i, j) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

function applyMask(m, maska) {
  const f = MASKS[maska];
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.reserved[r * m.size + c]) continue;
      if (f(r, c)) m.modules[r * m.size + c] ^= 1;
    }
  }
}

/**
 * Penále masky. Čím vyšší, tím hůř se kód čte.
 *
 * Čtyři pravidla normy: dlouhé jednobarevné běhy, plné čtverce 2×2, vzory
 * připomínající hledáček (ty by čtečku poslaly hledat roh jinam) a příliš
 * tmavý nebo příliš světlý celek.
 */
export function penalty(m) {
  const n = m.size;
  let skore = 0;

  // 1) běhy pěti a více stejných modulů v řadě i ve sloupci
  for (let smer = 0; smer < 2; smer++) {
    for (let a = 0; a < n; a++) {
      let beh = 1;
      let predchozi = -1;
      for (let b = 0; b < n; b++) {
        const v = smer === 0 ? get(m, a, b) : get(m, b, a);
        if (v === predchozi) {
          beh++;
          if (beh === 5) skore += 3;
          else if (beh > 5) skore += 1;
        } else {
          predchozi = v;
          beh = 1;
        }
      }
    }
  }

  // 2) plné čtverce 2×2
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = get(m, r, c);
      if (v === get(m, r, c + 1) && v === get(m, r + 1, c) && v === get(m, r + 1, c + 1)) {
        skore += 3;
      }
    }
  }

  // 3) vzor 1:1:3:1:1 se světlou mezerou — napodobenina hledáčku
  const vzor = [1, 0, 1, 1, 1, 0, 1];
  for (let smer = 0; smer < 2; smer++) {
    for (let a = 0; a < n; a++) {
      for (let b = 0; b + 7 <= n; b++) {
        let sedi = true;
        for (let k = 0; k < 7; k++) {
          const v = smer === 0 ? get(m, a, b + k) : get(m, b + k, a);
          if (v !== vzor[k]) { sedi = false; break; }
        }
        if (!sedi) continue;
        const predMezera = [-4, -3, -2, -1].every((d) => {
          const idx = b + d;
          if (idx < 0) return true;
          return (smer === 0 ? get(m, a, idx) : get(m, idx, a)) === 0;
        });
        const zaMezera = [7, 8, 9, 10].every((d) => {
          const idx = b + d;
          if (idx >= n) return true;
          return (smer === 0 ? get(m, a, idx) : get(m, idx, a)) === 0;
        });
        if (predMezera || zaMezera) skore += 40;
      }
    }
  }

  // 4) poměr tmavých modulů; ideál je polovina
  let tmavych = 0;
  for (let i = 0; i < n * n; i++) tmavych += m.modules[i];
  const procent = (tmavych * 100) / (n * n);
  skore += Math.floor(Math.abs(procent - 50) / 5) * 10;

  return skore;
}

/* ============================================================
   VEŘEJNÉ ROZHRANÍ
   ============================================================ */

/**
 * Vyrobí QR kód pro text.
 *
 * @param {string} text
 * @param {{version?: number}} [volby]  vynucená verze (jinak nejmenší, co stačí)
 * @returns {{size: number, modules: Uint8Array, version: number, mask: number}}
 */
export function qrEncode(text, volby = {}) {
  const bajty = new TextEncoder().encode(String(text));
  const version = volby.version ?? fitVersion(bajty.length);
  if (!version) {
    throw new RangeError(`QR: ${bajty.length} B se nevejde ani do verze ${MAX_VERSION}`);
  }

  // Hlavička: režim bajtů (0100) + délka.
  const bity = [0, 1, 0, 0];
  const sirka = countBits(version);
  for (let i = sirka - 1; i >= 0; i--) bity.push((bajty.length >>> i) & 1);
  for (const b of bajty) for (let i = 7; i >= 0; i--) bity.push((b >>> i) & 1);

  const slova = interleave(bitsToCodewords(bity, version), version);

  // Všech osm masek se postaví a vyhraje ta s nejmenším penále.
  let nejlepsi = null;
  for (let maska = 0; maska < 8; maska++) {
    const m = prazdna(4 * version + 17);
    drawPatterns(m, version);
    placeData(m, slova);
    applyMask(m, maska);
    drawFormat(m, maska);
    const skore = penalty(m);
    if (!nejlepsi || skore < nejlepsi.skore) nejlepsi = { m, maska, skore };
  }

  return {
    size: nejlepsi.m.size,
    modules: nejlepsi.m.modules,
    version,
    mask: nejlepsi.maska,
  };
}

/**
 * Matice → cesta pro SVG `<path>`. Jeden tvar místo tisíce obdélníků.
 *
 * ⚠️ Klidová zóna (`quiet`) není ozdoba: bez světlého rámu kolem kódu ho
 * čtečka v mnoha případech nenajde. Norma žádá čtyři moduly.
 */
export function qrPath(qr, quiet = 4) {
  const kusy = [];
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r * qr.size + c]) kusy.push(`M${c + quiet} ${r + quiet}h1v1h-1z`);
    }
  }
  return kusy.join('');
}

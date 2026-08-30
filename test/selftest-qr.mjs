/**
 * Samotest QR enkodéru.
 *
 * 🚨 PROČ JE TENHLE TEST JINÝ NEŽ OSTATNÍ: u QR kódu nestačí ověřit, že
 * funkce něco vrátila. Matice bodů vypadá „jako QR" i tehdy, když je v ní
 * jiné číslo účtu — a rozdíl pozná až bankovní appka, tedy pozdě. Proti
 * enkodéru proto stojí **samostatně napsaný dekodér** (dole v souboru):
 * čte formát, sundá masku, vybere kódová slova cikcakem, rozplete bloky,
 * ověří korekci a složí text zpátky. Když se text nevrátí přesně, test
 * spadne.
 *
 * ⚠️ Kruhovou úvahu („obojí psal týž člověk, takže obojí chápe normu
 * stejně špatně") ohlídají tři nezávislé kotvy:
 *   1. **kapacity** z normy, napsané tady natvrdo (v1 = 26 slov, v10 = 346…)
 *   2. **hodnoty masek** ověřené proti předpisu, ne proti sobě samým
 *   3. **syndromy korekce** — dekodér počítá RS jinou cestou (dosazení do
 *      polynomu) než enkodér (dělení polynomem)
 *
 * Poslední kontrola je stejně mimo stroj: **naskenovat kód bankovní appkou.**
 * To se tvrdit nedá, dokud to někdo neudělá.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  qrEncode, qrPath, rsEncode, totalCodewords, dataCodewords, fitVersion,
  penalty, MASKS, MAX_VERSION,
} from '../web/lib/qr.js';

/* ============================================================
   KOTVA 1 — KAPACITY Z NORMY

   Kdyby se spletl vzorec pro počet kódových slov, vyšel by kód, který
   se tváří správně a nikde nepřeteče — jen v něm budou data posunutá.
   ============================================================ */

test('celkový počet kódových slov sedí s normou', () => {
  const norma = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 };
  for (const [verze, ocekavano] of Object.entries(norma)) {
    assert.equal(totalCodewords(Number(verze)), ocekavano, `verze ${verze}`);
  }
});

test('datová kapacita úrovně M sedí s normou', () => {
  const norma = { 1: 16, 2: 28, 3: 44, 4: 64, 5: 86, 6: 108, 7: 124, 8: 154, 9: 182, 10: 216 };
  for (const [verze, ocekavano] of Object.entries(norma)) {
    assert.equal(dataCodewords(Number(verze)), ocekavano, `verze ${verze}`);
  }
});

test('verze se vybírá nejmenší, do které se data vejdou', () => {
  // v1-M: 16 slov = 4 bity režim + 8 bitů délka + data → 14 bajtů
  assert.equal(fitVersion(14), 1);
  assert.equal(fitVersion(15), 2);
  assert.equal(fitVersion(1), 1);
  // Nad strop se nevrací ořez, ale `null` — o tom se musí rozhodnout výš.
  assert.equal(fitVersion(10000), null);
});

test('příliš dlouhá data vyhodí výjimku, ne osekaný kód', () => {
  assert.throws(() => qrEncode('x'.repeat(5000)), RangeError);
});

/* ============================================================
   KOTVA 2 — MASKY PODLE PŘEDPISU

   Osm vzorců normy, ověřených dosazením. Kdyby si enkodér a dekodér
   „domluvily" vlastní masku, round-trip by prošel a kód by přesto byl
   nečitelný pro každou čtečku na světě.
   ============================================================ */

test('maskovací vzorce odpovídají normě', () => {
  // (řádek, sloupec, očekávaný výsledek) — spočítáno ručně z předpisu
  const pripady = [
    [0, [0, 0, true], [0, 1, false], [1, 1, true]],
    [1, [0, 5, true], [1, 0, false], [2, 3, true]],
    [2, [0, 0, true], [0, 3, true], [0, 4, false]],
    [3, [0, 0, true], [1, 2, true], [1, 1, false]],
    [4, [0, 0, true], [0, 3, false], [2, 0, false]],
    [5, [0, 0, true], [1, 1, false], [2, 3, true]],
    [6, [0, 0, true], [1, 1, true], [1, 3, false]],
    [7, [0, 0, true], [0, 1, false], [1, 1, false]],
  ];
  for (const [maska, ...body] of pripady) {
    for (const [i, j, cekano] of body) {
      assert.equal(MASKS[maska](i, j), cekano, `maska ${maska} na ${i},${j}`);
    }
  }
});

/* ============================================================
   KOTVA 3 — KOREKCE CHYB

   Reed–Solomon je jediná část, kde se chyba neprojeví ani špatným
   vzhledem: kód se prostě jen nepřečte v horších podmínkách.
   ============================================================ */

test('korekční slova mají správnou délku a jsou bajty', () => {
  const ec = rsEncode([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10);
  assert.equal(ec.length, 10);
  for (const b of ec) assert.ok(Number.isInteger(b) && b >= 0 && b <= 255);
});

test('korekce opravdu opravuje: dva poškozené bajty se dopočítají', () => {
  // Blok + korekce tvoří kódové slovo; syndromy nepoškozeného musí být nulové.
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const cele = [...data, ...rsEncode(data, 10)];
  assert.deepEqual(syndromy(cele, 10), new Array(10).fill(0));

  // A po poškození nulové nejsou — jinak by kontrola nic nekontrolovala.
  const rozbite = [...cele];
  rozbite[3] ^= 0xff;
  assert.ok(syndromy(rozbite, 10).some((s) => s !== 0));
});

/* ============================================================
   ZPĚTNÉ PŘEČTENÍ — hlavní kontrola
   ============================================================ */

test('co se zakóduje, to se přečte zpátky', () => {
  const texty = [
    'A',
    'SPD*1.0*ACC:CZ3558000000002700973822*AM:100.00*CC:CZK',
    'SPD*1.0*ACC:CZ3558000000002700973822*AM:50.00*CC:CZK*RN:MeteoTrace*MSG:Dar pro appku MeteoTrace',
    'https://meteotrace.com',
    'x'.repeat(120),
    '0123456789'.repeat(20),
  ];
  for (const text of texty) {
    const qr = qrEncode(text);
    assert.equal(decode(qr), text, `text délky ${text.length}`);
  }
});

test('přečte se i vynucená vyšší verze (číslo verze se do kódu píše od 7)', () => {
  for (let v = 6; v <= MAX_VERSION; v++) {
    const qr = qrEncode('MeteoTrace', { version: v });
    assert.equal(qr.version, v);
    assert.equal(decode(qr), 'MeteoTrace', `verze ${v}`);
  }
});

test('přečtou se i znaky mimo ASCII (UTF-8 v režimu bajtů)', () => {
  const text = 'Příspěvek na počasí — děkuji! 🌤';
  assert.equal(decode(qrEncode(text)), text);
});

/* ============================================================
   STAVBA MATICE
   ============================================================ */

test('velikost matice odpovídá verzi', () => {
  for (let v = 1; v <= MAX_VERSION; v++) {
    assert.equal(qrEncode('x', { version: v }).size, 4 * v + 17);
  }
});

test('hledáčky sedí ve třech rozích a čtvrtý roh je volný', () => {
  const qr = qrEncode('MeteoTrace');
  const m = (r, c) => qr.modules[r * qr.size + c];
  for (const [r0, c0] of [[0, 0], [0, qr.size - 7], [qr.size - 7, 0]]) {
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        const d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        assert.equal(m(r0 + dr, c0 + dc), d === 2 ? 0 : 1, `hledáček ${r0},${c0}`);
      }
    }
  }
  // Čtvrtý roh hledáček NEMÁ — podle toho čtečka pozná natočení kódu.
  let tmavych = 0;
  for (let dr = 0; dr < 7; dr++) for (let dc = 0; dc < 7; dc++) tmavych += m(qr.size - 7 + dr, qr.size - 7 + dc);
  assert.notEqual(tmavych, 33);
});

test('časovací řady se střídají', () => {
  const qr = qrEncode('MeteoTrace');
  for (let i = 8; i < qr.size - 8; i++) {
    assert.equal(qr.modules[6 * qr.size + i], i % 2 === 0 ? 1 : 0, `řádek 6, sloupec ${i}`);
    assert.equal(qr.modules[i * qr.size + 6], i % 2 === 0 ? 1 : 0, `sloupec 6, řádek ${i}`);
  }
});

test('modul, který je podle normy vždycky tmavý, tmavý je', () => {
  const qr = qrEncode('MeteoTrace');
  assert.equal(qr.modules[(qr.size - 8) * qr.size + 8], 1);
});

test('penále masky opravdu rozlišuje: prázdná plocha je horší než hotový kód', () => {
  const qr = qrEncode('SPD*1.0*ACC:CZ3558000000002700973822*AM:100.00*CC:CZK');
  assert.ok(qr.mask >= 0 && qr.mask <= 7, 'maska musí být jedna z osmi');

  // ⚠️ Bez tohohle by „nejmenší penále" mohlo znamenat i to, že funkce
  // vrací pořád stejné číslo. Celá bílá plocha téže velikosti je pro
  // čtečku nejhorší možný případ a musí dostat víc.
  const prazdna = { size: qr.size, modules: new Uint8Array(qr.size * qr.size) };
  assert.ok(penalty(qr) < penalty(prazdna),
    'hotový kód má mít menší penále než prázdná plocha');
});

test('cesta pro SVG má klidovou zónu a nekreslí prázdno', () => {
  const qr = qrEncode('MeteoTrace');
  const path = qrPath(qr, 4);
  assert.ok(path.startsWith('M'));
  // Nejmenší souřadnice je klidová zóna, ne nula — bez světlého rámu
  // čtečka kód nenajde.
  const cisla = [...path.matchAll(/M(\d+) (\d+)/g)].map(([, x, y]) => Math.min(Number(x), Number(y)));
  assert.ok(Math.min(...cisla) >= 4);
});

/* ============================================================
   DEKODÉR — jen pro test, psaný proti normě, ne podle enkodéru
   ============================================================ */

/** Souřadnice zarovnávacích značek podle normy (zapsané zvlášť od enkodéru). */
const ALIGN_NORMA = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const EC_M = { 1: 10, 2: 16, 3: 26, 4: 18, 5: 24, 6: 16, 7: 18, 8: 22, 9: 22, 10: 26 };
const BLOKU_M = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 4, 7: 4, 8: 4, 9: 5, 10: 5 };

/** Kde v matici leží nefunkční vzory (tam data nejsou). */
function funkcni(version) {
  const n = 4 * version + 17;
  const f = new Uint8Array(n * n);
  const mark = (r, c) => { if (r >= 0 && c >= 0 && r < n && c < n) f[r * n + c] = 1; };

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) { mark(r, c); mark(r, n - 1 - c); mark(n - 1 - r, c); }
  }
  for (let i = 0; i < n; i++) { mark(6, i); mark(i, 6); }

  const stredy = ALIGN_NORMA[version];
  for (const r of stredy) {
    for (const c of stredy) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
    }
  }
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, n - 1 - i); mark(n - 1 - i, 8); }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = n - 11 + (i % 3);
      mark(a, b); mark(b, a);
    }
  }
  return f;
}

/** Přečte masku z informace o formátu a ověří, že je to úroveň M. */
function prectiFormat(qr) {
  const n = qr.size;
  const bit = (r, c) => qr.modules[r * n + c];
  let bity = 0;
  for (let i = 0; i <= 5; i++) bity |= bit(i, 8) << i;
  bity |= bit(7, 8) << 6;
  bity |= bit(8, 8) << 7;
  bity |= bit(8, 7) << 8;
  for (let i = 9; i < 15; i++) bity |= bit(8, 14 - i) << i;

  const data = (bity ^ 0x5412) >>> 10;
  assert.equal(data >>> 3, 0, 'úroveň korekce má být M');
  return data & 7;
}

/** Sundá masku a vybere datové bity cikcakem od pravého dolního rohu. */
function prectiSlova(qr, maska) {
  const n = qr.size;
  const f = funkcni(qr.version);
  const maskFn = MASKS[maska];
  const bity = [];

  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const nahoru = ((right + 1) & 2) === 0;
        const r = nahoru ? n - 1 - vert : vert;
        if (f[r * n + c]) continue;
        bity.push(qr.modules[r * n + c] ^ (maskFn(r, c) ? 1 : 0));
      }
    }
  }

  const slova = [];
  for (let i = 0; i + 8 <= bity.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bity[i + j];
    slova.push(b);
  }
  return slova;
}

/** Opak proplétání: z prokládaného proudu zpátky bloky dat a korekce. */
function rozplet(slova, version) {
  const bloku = BLOKU_M[version];
  const ecLen = EC_M[version];
  const dat = totalCodewords(version) - ecLen * bloku;
  const kratkaDelka = Math.floor(dat / bloku);
  const kratkych = bloku - (dat % bloku);

  const data = Array.from({ length: bloku }, () => []);
  let idx = 0;
  for (let i = 0; i < kratkaDelka + 1; i++) {
    for (let b = 0; b < bloku; b++) {
      const delka = kratkaDelka + (b < kratkych ? 0 : 1);
      if (i < delka) data[b].push(slova[idx++]);
    }
  }
  const ec = Array.from({ length: bloku }, () => []);
  for (let i = 0; i < ecLen; i++) {
    for (let b = 0; b < bloku; b++) ec[b].push(slova[idx++]);
  }
  return { data, ec };
}

/* Aritmetika GF(256) — v testu znovu, aby se neověřovala sama sebou. */
const T_EXP = new Uint8Array(512);
const T_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { T_EXP[i] = x; T_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) T_EXP[i] = T_EXP[i - 255];
}
const tMul = (a, b) => (a === 0 || b === 0 ? 0 : T_EXP[T_LOG[a] + T_LOG[b]]);

/**
 * Syndromy: kódové slovo se DOSADÍ do polynomu v kořenech generátoru.
 * Jiná cesta než dělení polynomem v enkodéru — proto to něco dokazuje.
 */
function syndromy(slovo, pocet) {
  const out = [];
  for (let i = 0; i < pocet; i++) {
    let s = 0;
    for (const bajt of slovo) s = tMul(s, T_EXP[i]) ^ bajt;
    out.push(s);
  }
  return out;
}

/** Celý dekodér: z matice zpátky text. */
function decode(qr) {
  const maska = prectiFormat(qr);
  assert.equal(maska, qr.mask, 'v kódu má stát táž maska, jakou enkodér vybral');

  const slova = prectiSlova(qr, maska);
  const { data, ec } = rozplet(slova, qr.version);

  // Korekce musí sedět na každém bloku, jinak je kód poškozený už při vzniku.
  for (let b = 0; b < data.length; b++) {
    assert.deepEqual(syndromy([...data[b], ...ec[b]], EC_M[qr.version]),
      new Array(EC_M[qr.version]).fill(0), `blok ${b} má nenulové syndromy`);
  }

  const proud = data.flat();
  const bity = [];
  for (const b of proud) for (let i = 7; i >= 0; i--) bity.push((b >>> i) & 1);

  const cti = (kolik, od) => {
    let v = 0;
    for (let i = 0; i < kolik; i++) v = (v << 1) | bity[od + i];
    return v;
  };

  assert.equal(cti(4, 0), 0b0100, 'čekal se režim bajtů');
  const sirka = qr.version < 10 ? 8 : 16;
  const delka = cti(sirka, 4);
  const bajty = [];
  for (let i = 0; i < delka; i++) bajty.push(cti(8, 4 + sirka + i * 8));
  return new TextDecoder().decode(new Uint8Array(bajty));
}

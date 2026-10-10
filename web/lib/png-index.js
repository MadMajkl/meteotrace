/**
 * Čtečka PNG s paletou — kvůli radaru ČHMÚ (`R37`).
 *
 * ⚠️ ČISTÝ MODUL. Rozbalení dat (zlib) se předává zvenčí: na serveru je to
 * `zlib.inflateSync`, v testu totéž. Prohlížeč to nepotřebuje — snímky
 * radaru kreslí mapa sama, pixely čte jen server.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ VLASTNÍ ČTEČKA, NE KNIHOVNA
 *
 * Stejná úvaha jako u `.tar` v `nowcast.js`: ČHMÚ dává jediný tvar —
 * 8 bitů na pixel, paleta, bez prokládání — a ten je popsaný ve třech
 * odstavcích normy. Knihovna by přinesla závislost, aktualizace a útočnou
 * plochu kvůli čtyřiceti řádkům, které se nezmění, dokud se nezmění formát.
 * A když se formát změní, tahle čtečka to ŘEKNE (vyhodí chybu), místo
 * aby potichu četla nesmysl.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

const PODPIS = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * @param {Uint8Array} bajty  celý soubor PNG
 * @param {(data: Uint8Array) => Uint8Array} inflate  rozbalení zlib
 * @returns {{sirka: number, vyska: number, pixely: Uint8Array, paleta: Uint8Array}}
 *   `pixely` jsou indexy do palety po řádcích, `paleta` trojice RGB.
 */
export function prectiPng(bajty, inflate) {
  if (!(bajty instanceof Uint8Array) || bajty.length < 33) throw new Error('PNG: soubor je prázdný nebo useknutý.');
  for (let i = 0; i < 8; i++) {
    if (bajty[i] !== PODPIS[i]) throw new Error('PNG: chybí podpis, tohle není PNG.');
  }

  const dv = new DataView(bajty.buffer, bajty.byteOffset, bajty.byteLength);
  let sirka = 0;
  let vyska = 0;
  let paleta = null;
  const data = [];
  let delka = 0;

  for (let i = 8; i + 8 <= bajty.length;) {
    const n = dv.getUint32(i);
    const druh = String.fromCharCode(bajty[i + 4], bajty[i + 5], bajty[i + 6], bajty[i + 7]);
    const obsah = bajty.subarray(i + 8, i + 8 + n);
    if (obsah.length !== n) throw new Error(`PNG: blok ${druh} je useknutý.`);

    if (druh === 'IHDR') {
      sirka = dv.getUint32(i + 8);
      vyska = dv.getUint32(i + 12);
      const hloubka = bajty[i + 16];
      const barvy = bajty[i + 17];
      const prokladani = bajty[i + 20];
      // 🚨 Jiný tvar se NEČTE „nějak". Kdyby ČHMÚ přešel na RGBA, četly by
      // se z pixelů nesmyslné indexy a bouřka by se hledala v šumu.
      if (hloubka !== 8 || barvy !== 3 || prokladani !== 0) {
        throw new Error(`PNG: umím jen 8 bitů s paletou bez prokládání, přišlo hloubka ${hloubka}, barvy ${barvy}, prokládání ${prokladani}.`);
      }
    } else if (druh === 'PLTE') {
      paleta = obsah;
    } else if (druh === 'IDAT') {
      data.push(obsah);
      delka += n;
    } else if (druh === 'IEND') {
      break;
    }
    i += 12 + n;
  }

  if (!sirka || !vyska) throw new Error('PNG: chybí hlavička IHDR.');
  if (!paleta) throw new Error('PNG: chybí paleta.');

  const spojene = new Uint8Array(delka);
  let o = 0;
  for (const d of data) { spojene.set(d, o); o += d.length; }

  const syrove = inflate(spojene);
  const radek = sirka + 1;   // bajt filtru + pixely
  if (syrove.length < radek * vyska) throw new Error('PNG: data jsou kratší, než slibuje hlavička.');

  const pixely = new Uint8Array(sirka * vyska);
  for (let y = 0; y < vyska; y++) {
    const filtr = syrove[y * radek];
    const zdroj = y * radek + 1;
    const cil = y * sirka;
    for (let x = 0; x < sirka; x++) {
      const a = x > 0 ? pixely[cil + x - 1] : 0;                 // vlevo
      const b = y > 0 ? pixely[cil - sirka + x] : 0;             // nad
      const c = x > 0 && y > 0 ? pixely[cil - sirka + x - 1] : 0; // vlevo nad
      let v = syrove[zdroj + x];
      switch (filtr) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`PNG: neznámý filtr ${filtr} na řádku ${y}.`);
      }
      pixely[cil + x] = v & 255;
    }
  }

  return { sirka, vyska, pixely, paleta };
}

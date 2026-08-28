/**
 * Stavitel odpovědi pro nowcast ČHMÚ.
 *
 * Jediné místo, které kvůli téhle vrstvě sahá na síť. Čistá logika (jména
 * běhů, rozbalení archivu, časy snímků) leží v `web/lib/nowcast.js` a je
 * otestovaná bez sítě.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ SE OBRÁZKY POSÍLAJÍ V ODPOVĚDI, A NE JAKO ADRESY
 *
 * Prohlížeč si je z ČHMÚ stáhnout nemůže — server nemá CORS. Kdyby si je
 * měl brát přes nás po jednom, znamenalo by to šest dalších dotazů, a hlavně
 * **druhý typ odpovědi** (binární) skrz obě nasazení (vývojový server
 * i funkce na Netlify). Celý běh má ~200 kB; jako `data:` adresy v jednom
 * JSONu je to asi 270 kB — méně, než stojí dlaždice radaru na jeden pohled.
 *
 * ⚠️ Běh se posílá VŽDYCKY CELÝ. Kdyby se skládal po kouscích, mohla by se
 * na ose potkat půlka staré a půlka nové předpovědi — a nikdo by nepoznal,
 * že se dívá na dvě různé situace.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import {
  kandidatiBehu, nazevBehu, rozbalTar, snimkyZArchivu, rohy, VYREZ, behJePlatny,
} from '../web/lib/nowcast.js';

/** Povinná citace zdroje (CC BY 4.0). Jde až do popisky v mapě. */
export const ZDROJ = 'ČHMÚ';
export const LICENCE = 'CC BY 4.0';

/** Kolik běhů zpět se zkusí, než se řekne „teď to nechodí". */
const POKUSU = 4;

function dataUrl(bajty) {
  return `data:image/png;base64,${Buffer.from(bajty).toString('base64')}`;
}

/**
 * @param {object} a
 * @param {Function} a.fetchImpl
 * @param {string} a.base   adresa složky s archivy (z katalogu)
 * @param {number} a.nowMs
 * @param {Function} [a.log]
 */
export async function stavNowcast({ fetchImpl, base, nowMs, log = () => {} }) {
  const zkousene = [];

  for (const beh of kandidatiBehu(nowMs, POKUSU)) {
    const url = base + nazevBehu(beh);
    zkousene.push(new Date(beh).toISOString().slice(11, 16));

    let res;
    try {
      res = await fetchImpl(url);
    } catch (e) {
      log('nowcast: běh se nestáhl', { url, chyba: e.message });
      continue;
    }
    if (!res.ok) continue;

    const bajty = new Uint8Array(await res.arrayBuffer());
    let snimky;
    try {
      snimky = snimkyZArchivu(rozbalTar(bajty));
    } catch (e) {
      // Poškozený archiv není důvod skončit — zkusí se starší běh.
      log('nowcast: archiv se nerozbalil', { url, chyba: e.message });
      continue;
    }
    if (!snimky.length) continue;

    return {
      beh,
      zdroj: ZDROJ,
      licence: LICENCE,
      vyrez: VYREZ,
      rohy: rohy(),
      snimky: snimky.map((s) => ({
        timeMs: s.timeMs,
        minut: s.minut,
        obrazek: dataUrl(s.data),
      })),
    };
  }

  // 🚨 Prázdná odpověď, ne chyba. Nowcast je příjemný přídavek; když
  // nechodí, nesmí kvůli němu spadnout mapa ani radar. Ale MUSÍ být poznat,
  // že tam nic není — jinak by prázdná osa vypadala jako „nic se nechystá".
  log('nowcast: žádný běh se nepovedl', { zkousene });
  return {
    beh: null,
    zdroj: ZDROJ,
    licence: LICENCE,
    vyrez: VYREZ,
    rohy: rohy(),
    snimky: [],
    duvod: 'Předpověď radaru se nepodařilo stáhnout.',
  };
}

/** Odpověď, kterou má smysl ukázat? (běh existuje a není zastaralý) */
export function jePouzitelny(odpoved, nowMs) {
  return !!odpoved?.snimky?.length && behJePlatny(odpoved.beh, nowMs);
}

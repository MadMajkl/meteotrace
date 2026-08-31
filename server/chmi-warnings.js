/**
 * Stavitel odpovědi pro výstrahy ČHMÚ — přímo od zdroje (`R20`).
 *
 * Jediné místo, které kvůli výstrahám sahá na síť. Čtení dokumentu (`cap.js`)
 * je čistá logika a je otestované bez sítě.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO NENÍ PROSTÝ PRŮCHOD, ALE STAVITEL
 *
 * ČHMÚ nemá adresu „poslední výstrahy". Má adresář, kde se soubory jmenují
 * podle dne a času (`alert_cap_50_300811.xml` = „30., 08:11") a **po měsíci
 * se přepíšou**. Nejnovější se pozná jedině podle času úpravy ve výpisu
 * adresáře — tedy dva dotazy a rozbor. To průchodem nejde.
 * ────────────────────────────────────────────────────────────────────────
 *
 * 🚨 KDYŽ SE TO NEPOVEDE, VRACÍ SE PRÁZDNO S DŮVODEM — nikdy tiché „nic
 * nehrozí". Prázdný seznam výstrah a mrtvý zdroj vypadají stejně a je to
 * ten nejhorší okamžik, kdy si je splést. Volající pozná rozdíl podle
 * `sent`: když chybí, nevíme nic.
 */

'use strict';

import { parseCap, nejnovejsiSoubor } from '../web/lib/cap.js';

/** Povinná citace zdroje. */
export const ZDROJ = 'ČHMÚ';

/**
 * @param {object} a
 * @param {Function} a.fetchImpl
 * @param {string} a.base   adresa adresáře s CAP soubory (z katalogu)
 * @param {Function} [a.log]
 */
export async function stavVystrahy({ fetchImpl, base, log = () => {} }) {
  const prazdno = (duvod) => {
    log('výstrahy: nepovedlo se', { duvod });
    return { warnings: [], sent: null, zdroj: ZDROJ, duvod };
  };

  let vypis;
  try {
    const res = await fetchImpl(base);
    if (!res.ok) return prazdno(`výpis adresáře vrátil HTTP ${res.status}`);
    vypis = await res.text();
  } catch (e) {
    return prazdno(`výpis adresáře se nestáhl: ${e.message}`);
  }

  // ⚠️ Rozbor výpisu adresáře je křehký — je to HTML pro lidi, ne rozhraní.
  // Když se změní, radši se přizná nezdar a sáhne se po záloze (MeteoAlarm),
  // než aby se hádalo podle jména souboru: ta se opakují.
  const soubor = nejnovejsiSoubor(vypis);
  if (!soubor) return prazdno('ve výpisu adresáře nešlo najít žádný soubor');

  let xml;
  try {
    const res = await fetchImpl(base + soubor.jmeno);
    if (!res.ok) return prazdno(`${soubor.jmeno} vrátil HTTP ${res.status}`);
    xml = await res.text();
  } catch (e) {
    return prazdno(`${soubor.jmeno} se nestáhl: ${e.message}`);
  }

  const cap = parseCap(xml);
  if (!cap.sent) return prazdno(`${soubor.jmeno} nevypadá jako CAP`);

  log('výstrahy staženy', {
    soubor: soubor.jmeno, sent: cap.sent, vystrah: cap.warnings.length,
  });

  // Tvar je schválně týž jako u MeteoAlarmu — viz `cap.js`.
  return { ...cap, zdroj: ZDROJ, soubor: soubor.jmeno };
}

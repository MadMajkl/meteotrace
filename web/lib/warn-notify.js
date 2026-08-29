/**
 * Kdy o výstraze upozornit — a kdy mlčet.
 *
 * Karta výstrah se od 29. 8. 2026 při klidu schovává celá, takže se výstraha
 * dá přehlédnout. Michal: *„pokud jsou, musí i notifikovat."* Tenhle modul
 * rozhoduje **co je nové**; zvonit umí až obal (Android) nebo prohlížeč.
 *
 * ⚠️ Čistý modul: žádné DOM, žádná síť, žádné notifikace. Rozhodování
 * o tom, kdy vyrušit člověka, je přesně ta věc, která se musí dát ověřit
 * bez telefonu v ruce.
 */

'use strict';

import { t, tf } from './i18n.js';
// 🚨 Tabulka stupňů závažnosti je JEDNA, ve vlastním modulu bez závislostí —
// potřebuje ji i proxy, která s texty nemá mít nic společného.
import { staciNa, VYCHOZI_PRAH } from './severity.js';

export { staciNa, VYCHOZI_PRAH };

/**
 * Které výstrahy jsou nové a stojí za vyrušení.
 *
 * @param {object} a
 * @param {Array<{id?: string, event?: string, severity?: string, expires?: string}>} a.warnings
 * @param {Iterable<string>} [a.jizOznameno]  klíče, o kterých se už zvonilo
 * @param {number} [a.nowMs]
 * @param {string} [a.prah]
 * @returns {{nove: Array<object>, klice: string[]}}
 *   `klice` jsou VŠECHNY platné výstrahy, ne jen nové — viz níže.
 */
export function noveVystrahy({ warnings, jizOznameno = [], nowMs = 0, prah = VYCHOZI_PRAH } = {}) {
  const znam = new Set(jizOznameno);
  const platne = (Array.isArray(warnings) ? warnings : []).filter((w) => {
    if (!w || !w.id) return false;
    if (!w.expires) return true;
    const konec = new Date(w.expires).getTime();
    return Number.isNaN(konec) || konec > nowMs;
  });

  const nove = platne.filter((w) => !znam.has(w.id) && staciNa(w.severity, prah));

  // 🚨 Vrací se klíče VŠECH platných, i těch pod prahem. Kdyby se pamatovaly
  // jen ty, o kterých se zvonilo, znamenalo by zvednutí prahu v nastavení,
  // že se na dávno běžící drobnosti zazvoní se zpožděním jako na novinky.
  //
  // 🚨 A jen PLATNÝCH: prošlé se z paměti pouštějí, jinak by seznam rostl
  // donekonečna. Když by tatáž výstraha byla vydána znovu, má se ozvat —
  // je to nová situace.
  return { nove, klice: platne.map((w) => w.id) };
}

/**
 * Text upozornění.
 *
 * ⚠️ Nadpis nese ZÁVAŽNOST a MÍSTO, ne značku appky. Na zamčeném displeji je
 * vidět jeden řádek a „MeteoTrace" o nebezpečí neřekne nic.
 *
 * ⚠️ Tón je věcný. Hlášky v appce si smějí rýpnout, upozornění na bouřku ne —
 * platí pravidlo z 26. 8. 2026: u výstrah, chyb a nebezpečí se nežertuje.
 */
export function textUpozorneni({ nove, misto = '', lang = 'cs' } = {}) {
  const seznam = Array.isArray(nove) ? nove : [];
  if (!seznam.length) return null;

  const prvni = seznam[0];
  const jev = prvni.event || t('warnings.unnamed', lang);

  const nadpis = misto
    ? tf('notify.titleFor', { place: misto }, lang)
    : t('notify.title', lang);

  // U jedné výstrahy stačí její jméno. U víc se řekne kolik — ale první se
  // pojmenuje pořád: „2 výstrahy" bez jediného jména nutí otevřít appku,
  // aby se člověk dozvěděl, jestli má odklidit trampolínu.
  //
  // ⚠️ Zbytek je „+N", ne věta — a je to schválně. Tutéž notifikaci skládá
  // i androidí obal, který běží, když appka neběží, a věta by tam
  // potřebovala množné číslo v jazyce APPKY, ne telefonu. „+2" rozumí
  // každý, nepotřebuje překlad a obě cesty tak říkají totéž.
  const telo = seznam.length === 1 ? jev : `${jev} +${seznam.length - 1}`;

  return { nadpis, telo };
}

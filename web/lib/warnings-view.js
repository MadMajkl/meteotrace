/**
 * Výstrahy pro obrazovku — z odpovědi proxy udělá to, co se dá vypsat.
 *
 * ⚠️ ČISTÝ MODUL. Žádné DOM, žádná síť, žádné hodiny — čas se předává zvenčí,
 * jinak by se test nedal napsat bez čekání.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TU JSOU ČTYŘI STAVY A NE JEN SEZNAM
 *
 * Prázdný seznam výstrah může znamenat čtyři úplně různé věci:
 *
 *   „nic nehrozí"  ≠  „o tomhle místě nic nevíme"  ≠
 *   „nepodařilo se to načíst"  ≠  „nevíme, koho se týkají"
 *
 * Kdyby se všechny čtyři vypsaly stejně (tedy nijak), uživatel by v klidu jel
 * do bouřky s pocitem, že je čisto. Proto se vrací STAV, ne jen pole.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { t, tf, tp } from './i18n.js';
import { zpravaJeCerstva, stariZpravyS } from './cap.js';

/** Pořadí závažnosti od nejhorší. Neznámou bereme vážně, ne jako nejmenší. */
const ZAVAZNOST = ['Extreme', 'Severe', 'Moderate', 'Minor'];

function poradi(severity) {
  const i = ZAVAZNOST.indexOf(severity);
  // Neznámá závažnost se řadí hned za Severe. Podceňovat to, čemu nerozumíme,
  // je horší chyba než přeceňovat.
  return i === -1 ? 1.5 : i;
}

/** Třída pro CSS. Neznámá závažnost dostane vlastní, ať se nemaskuje za nejmenší. */
function trida(severity) {
  return ZAVAZNOST.includes(severity) ? severity.toLowerCase() : 'unknown';
}

function cas(iso, lang) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(d);
}

/** Kdy výstraha platí, slovy. Chybějící konec i začátek se přejde mlčky. */
function obdobi(w, lang, nowMs) {
  const zacatek = w.onset ? new Date(w.onset).getTime() : null;
  const od = zacatek && zacatek > nowMs ? cas(w.onset, lang) : null;
  const doKdy = w.expires ? cas(w.expires, lang) : null;

  if (od && doKdy) return tf('warnings.fromUntil', { from: od, until: doKdy }, lang);
  if (od) return tf('warnings.from', { time: od }, lang);
  if (doKdy) return tf('warnings.until', { time: doKdy }, lang);
  return '';
}

/**
 * Sloučí výstrahy, které jsou fakticky tatáž věc.
 *
 * 🚨 Zjištěno naživo, ne testem: ČHMÚ vydává tutéž bouřku zvlášť pro každou
 * skupinu okresů, takže jeden bod na trase dostal TŘI řádky „Silné bouřky"
 * se shodným časem — a v jiných případech až sedm. Uživatel by z toho četl,
 * že se dějí tři různé věci, a ta jedna důležitá by se v tom ztratila.
 *
 * Slučuje se podle události, závažnosti a období platnosti; seznamy míst se
 * spojí. Když je aspoň jedna kopie umístěná spolehlivě, výsledek se za
 * nejistý nepovažuje — nejistota jedné kopie nezpochybní jinou, přesnou.
 */
function slucDuplicity(warnings) {
  const podle = new Map();
  for (const w of warnings) {
    const klic = [w.event, w.severity, w.onset, w.expires].join('|');
    const drive = podle.get(klic);
    if (!drive) {
      podle.set(klic, { ...w, mista: [...(w.mista || [])] });
      continue;
    }
    for (const m of (w.mista || [])) if (!drive.mista.includes(m)) drive.mista.push(m);
    if (w.presne !== false) drive.presne = true;
  }
  return [...podle.values()];
}

/**
 * @param {object} a
 * @param {object|null} a.payload  odpověď `/api/warnings` (i s `misto`, `pokryto`, `filtrovano`)
 * @param {string} a.lang
 * @param {number} a.nowMs
 * @returns {{stav: 'vystrahy'|'zadne'|'mimo'|'nejiste'|'nedostupne',
 *            misto: string|null, zprava: string,
 *            polozky: Array<{nadpis: string, obdobi: string, zavaznost: string,
 *                            trida: string, nejiste: boolean, popis: string}>}}
 */
export function buildWarningsView({ payload, lang = 'cs', nowMs = 0 }) {
  if (!payload || !Array.isArray(payload.warnings)) {
    return { stav: 'nedostupne', misto: null, zprava: t('warnings.unavailable', lang), polozky: [] };
  }

  const misto = payload.misto?.nazev || null;
  const ted = nowMs || Date.now();

  /* 🚨 UKAZUJÍ SE JEN AKTUÁLNÍ VÝSTRAHY (Michal 25. 9. 2026).
     Zpráva starší než 12 hodin = žádné výstrahy a CELÁ KARTA PRYČ:
     *„když jsou starší 12 hodin, tak se nesmí ukazovat… vůbec žádné výstrahy
     tam pak nemají být… prostě ukazovat se musí jen aktuální výstrahy."*
     ♻️ Do 25. 9. to bylo obráceně (R20): karta zůstala a psala „výstrahy jsou
     staré 26 hodin, nespoléhej se". Tím se ukazovalo přesně to, co vidět
     nemá. Rozhoduje se tady NA ZAČÁTKU, dřív než se sestaví jediná položka —
     zastaralost přebíjí i výstrahy, které ve zprávě jsou.
     ⚠️ Chybějící čas vydání se bere jako zastaralý: nevíme, jak je stará. */
  if (!zpravaJeCerstva(payload.sent, ted)) {
    return { stav: 'zastaralé', misto, zprava: '', polozky: [] };
  }

  // A jak je zpráva stará, je u výstrah napsané VŽDYCKY.
  const vydano = vydanoSlovy(payload.sent, ted, lang);

  // Prošlé zahazuje i server (kvůli objemu), ale poslední slovo má výpis:
  // odpověď se drží v cache celé minuty a může se servírovat i prošlá při
  // výpadku, takže „už neplatí" se s jistotou pozná až tady.
  const platne = payload.warnings.filter((w) => {
    if (!w.expires) return true;
    const konec = new Date(w.expires).getTime();
    return Number.isNaN(konec) || konec > nowMs;
  });

  const jedinecne = slucDuplicity(platne);

  jedinecne.sort((a, b) => {
    const rozdil = poradi(a.severity) - poradi(b.severity);
    if (rozdil !== 0) return rozdil;
    // Při shodě závažnosti napřed to, co začne dřív.
    return new Date(a.onset || 0).getTime() - new Date(b.onset || 0).getTime();
  });

  const polozky = jedinecne.map((w) => ({
    nadpis: w.event || t('warnings.unnamed', lang),
    obdobi: obdobi(w, lang, nowMs),
    zavaznost: t(`warnings.severity.${trida(w.severity)}`, lang),
    trida: trida(w.severity),
    // Rozsah se čte z lidského textu, takže nemusí vyjít. Když nevyšel, musí
    // to být vidět — jinak se odhad tváří jako zjištění.
    nejiste: w.presne === false,
    popis: w.presne === false
      ? t('warnings.areaUncertain', lang)
      : (w.mista?.length ? tf('warnings.appliesTo', { place: w.mista.join(', ') }, lang) : ''),
    vydano,
  }));

  // Nevíme, koho se týkají — ukazují se všechny a musí se to říct nahlas.
  if (payload.filtrovano === false) {
    return { stav: 'nejiste', misto, zprava: t('warnings.unsure', lang), polozky };
  }

  if (polozky.length) return { stav: 'vystrahy', misto, zprava: '', polozky };

  // Prázdno má TŘI různé příčiny a každá si zaslouží jinou větu.
  if (payload.pokryto === false) {
    return { stav: 'mimo', misto: null, zprava: t('warnings.outside', lang), polozky: [] };
  }

  return {
    stav: 'zadne',
    misto,
    zprava: misto
      ? tf('warnings.noneFor', { place: misto }, lang)
      : t('warnings.none', lang),
    polozky: [],
  };
}

/**
 * Kdy byla zpráva vydaná — „Vydáno před 3 hodinami (10:38)".
 *
 * Volá se jen pro čerstvou zprávu (do 12 hodin), takže čas vydání známe
 * a dny tu nejsou potřeba. Hodiny se zaokrouhlují DOLŮ: „před 3 hodinami"
 * u zprávy staré 3 h 50 min je pravda, „před 4" by nebyla.
 */
export function vydanoSlovy(sent, nowMs, lang) {
  const s = stariZpravyS(sent, nowMs) ?? 0;
  const time = cas(sent, lang) || '';
  const minut = Math.floor(s / 60);
  if (minut < 1) return tf('warnings.issuedJustNow', { time }, lang);
  if (minut < 60) return tp('warnings.issuedMinutes', minut, { time }, lang);
  return tp('warnings.issuedHours', Math.floor(minut / 60), { time }, lang);
}

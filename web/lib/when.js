/**
 * Kdy to bude — hodina, a k ní den, jakmile přestane být „dnes".
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě.
 *
 * 🚨 VZNIKLO Z VADY, KTEROU NAŠEL MICHAL 30. 8. 2026. Trasa ukazovala u bodů
 * jen `HH:MM`. U cesty autem to stačí, ale appka umí i pěší trasu — a tam
 * ORS vrátí na Prahu → Norimberk poctivých **301 km / 60 hodin**. Appka
 * z toho napsala „příjezd v 22:31" a vypadalo to jako dnes večer. Michal:
 * *„to je blbost, ne?"* Byla — jenže ne ve výpočtu. **Rychlost i vzdálenost
 * byly správně; lhal jenom ciferník.** Body trasy šly `16:09, 21:09, 02:09,
 * 07:09, 12:09…` a nedalo se poznat, kolikátý je to den.
 *
 * Proto se den píše, jakmile není dnešní. **Ne až od nějakého prahu** —
 * první půlnoc přijde na kole po pěti hodinách jízdy a na hranici mezi
 * „dnes" a „zítra" není nic, co by šlo prohlédnout.
 *
 * ⚠️ DEN SE POČÍTÁ V PÁSMU CÍLE, ne prohlížeče. Kdo v Praze v 00:30 plánuje
 * cestu do Lisabonu, je tam pořád ještě včera — a hodina u bodu je taky
 * místní, takže by k sobě datum a čas nepatřily.
 *
 * ⚠️ A počítá se přes KALENDÁŘNÍ DNY, ne dělením 24 hodinami. Poslední
 * březnová neděle má 23 hodin a poslední říjnová 25; „za 24 hodin" a „zítra"
 * jsou tedy dvakrát ročně dvě různé věci (viz totéž poučení v `eta.js`).
 */

'use strict';

/**
 * Pořadové číslo kalendářního dne v daném pásmu.
 *
 * Datum se nechá vypsat od `Intl` a teprve z něj se udělá číslo — je to
 * jediná cesta, jak se dostat ke „dni v cizím pásmu" bez vlastní tabulky
 * letních časů.
 */
function cisloDne(ms, timeZone) {
  const casti = new Intl.DateTimeFormat('en', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const kus = (typ) => Number(casti.find((c) => c.type === typ)?.value);
  return Math.round(Date.UTC(kus('year'), kus('month') - 1, kus('day')) / 86400000);
}

/**
 * O kolik kalendářních dnů je `ms` dál než `refMs`.
 *
 * `0` = týž den, `1` = zítra, záporné = dřív. `null`, když se to nedá říct.
 */
export function dayShift(ms, refMs, timeZone) {
  if (!Number.isFinite(ms) || !Number.isFinite(refMs)) return null;
  return cisloDne(ms, timeZone) - cisloDne(refMs, timeZone);
}

/** Hodina a minuta v pásmu místa. */
export function clock(ms, timeZone, locale) {
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat(locale || 'en', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timeZone || 'UTC',
  }).format(new Date(ms));
}

/**
 * Den a měsíc v pásmu místa — `12. 9.` česky, `Sep 12` anglicky.
 *
 * ⚠️ Bez roku schválně. Předpověď nesahá dál než na pár dní a rok navíc
 * by v seznamu bodů jen ubíral místo tomu podstatnému.
 */
export function dayMonth(ms, timeZone, locale) {
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat(locale || 'en', {
    day: 'numeric', month: 'short', timeZone: timeZone || 'UTC',
  }).format(new Date(ms));
}

/**
 * Rozložený okamžik pro výpis: hodina, posun ve dnech a datum.
 *
 * Slovo („zítra") se tady schválně NESKLÁDÁ — to je věc překladu a patří
 * do `lang/`. Modul říká jen, **kolikátý den to je**; jak se to řekne,
 * rozhoduje jazyk.
 *
 * @returns {{time: string, shift: number, date: string}|null}
 */
export function momentParts(ms, refMs, timeZone, locale) {
  const time = clock(ms, timeZone, locale);
  const shift = dayShift(ms, refMs, timeZone);
  if (time === null || shift === null) return null;
  return { time, shift, date: dayMonth(ms, timeZone, locale) };
}

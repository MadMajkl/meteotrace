/**
 * Čas odjezdu — „teď", nebo naplánovaný.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě, bez `Date.now()` — „teď" dodává volající,
 * aby se dalo testovat, co se stane zítra nebo za týden.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ TO VZNIKLO
 *
 * Michal 17. 9. 2026: *„chtělo by tam přidat custom datum a čas vykonání
 * cesty a na to pak po jeho zvolení přizpůsobit předpověď."* Do té doby se
 * trasa počítala VŽDYCKY od teď a srovnání odjezdů sahalo nejvýš o tři hodiny
 * dopředu. Kdo plánoval zítřejší cestu, dostal dnešní počasí.
 *
 * Rozšíření je levné ze stejného důvodu jako srovnání odjezdů (`R8`):
 * předpověď je hodinové pole, takže jiný čas je jen jiný index. Jediné, co
 * přibude, je **delší pole** — viz `forecastDaysFor()`.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

const MIN = 60000;
const DEN = 86400000;

/**
 * Jak daleko dopředu jde odjezd naplánovat.
 *
 * ⚠️ Sedm dní, stejně jako předpověď na meteostanici. Open-Meteo dá hodinová
 * data až na 16 dní, ale za týdnem už je to spíš klimatologie než předpověď
 * — a trasa, která by tvrdila „v 8:40 u Jihlavy déšť" za dva týdny, by lhala
 * s přesností na minutu.
 */
export const MAX_AHEAD_DAYS = 7;

/** Krok voliče času. Přesněji nikdo odjezd neplánuje. */
export const STEP_MIN = 15;

/**
 * Tolerance „teď".
 *
 * 🚨 Bez ní by naplánovaný odjezd propadl hned, jak se nastaví: uživatel
 * vybere 17:45 v 17:44, klepne na výpočet v 17:46 — a appka by napsala, že
 * odjezd už minul. Pět minut je doba, za kterou se formulář vyplní.
 */
export const GRACE_MIN = 5;

/** Posuny pro „teď" (`R8`). Dozadu to nejde — minulost se neplánuje. */
export const OFFSETS_NOW = [0, 60, 120, 180];

/**
 * Od kdy se počítá.
 *
 * @param {number|null} plannedMs  naplánovaný odjezd, `null` = teď
 * @param {number} nowMs
 * @returns {{ms: number, planned: boolean, expired: boolean}}
 *   `expired` = odjezd byl naplánovaný, ale mezitím minul. Volající to MUSÍ
 *   říct nahlas: počítat tiše od teď by vypadalo, že appka plán zapomněla.
 */
export function resolveDeparture(plannedMs, nowMs) {
  if (!Number.isFinite(plannedMs)) return { ms: nowMs, planned: false, expired: false };
  if (plannedMs < nowMs - GRACE_MIN * MIN) return { ms: nowMs, planned: false, expired: true };
  // ⚠️ Plán v toleranci „teď" se počítá od teď, ale zůstává plánem — uživatel
  // si ho vybral a formulář ho má dál ukazovat.
  return { ms: Math.max(plannedMs, nowMs), planned: true, expired: false };
}

/**
 * Srovná zadaný čas do povoleného rozsahu.
 *
 * ⚠️ Vstup `datetime-local` má `min` a `max`, ale **ne každý prohlížeč je
 * vynucuje** — ručně napsané datum projde. Proto se hlídá i tady, a důvod
 * se vrací, ať appka řekne, proč se čas změnil.
 *
 * @returns {{ms: number|null, reason: null|'past'|'tooFar'}}
 */
export function clampPlanned(ms, nowMs) {
  if (!Number.isFinite(ms)) return { ms: null, reason: null };
  if (ms < nowMs - GRACE_MIN * MIN) return { ms: roundUp(nowMs, STEP_MIN), reason: 'past' };
  const max = nowMs + MAX_AHEAD_DAYS * DEN;
  if (ms > max) return { ms: roundDown(max, STEP_MIN), reason: 'tooFar' };
  return { ms, reason: null };
}

/**
 * Posuny odjezdu, které se srovnávají.
 *
 * U „teď" jen dopředu. U naplánovaného odjezdu **i hodinu dřív** — kdo jede
 * zítra v osm, může stejně dobře vyrazit v sedm, a „vyraž o hodinu dřív
 * a bouřku minneš" je přesně ta rada, kvůli které tohle srovnání existuje.
 *
 * ⚠️ Pořád čtyři varianty. Víc by na telefonu vyjelo z řádku a rolovat
 * doprava kvůli srovnání se nikomu nechce.
 *
 * ⚠️ Posun do minulosti se nenabízí: „vyraž o hodinu dřív", když to znamená
 * před deseti minutami, je rada, kterou nejde poslechnout.
 */
export function departureOffsets(departure, nowMs) {
  if (!departure?.planned) return OFFSETS_NOW;
  const hodinuDriv = departure.ms - 60 * MIN >= nowMs - GRACE_MIN * MIN;
  return hodinuDriv ? [-60, 0, 60, 120] : OFFSETS_NOW;
}

/**
 * Kolik dní předpovědi je potřeba stáhnout.
 *
 * 🚨 Do 17. 9. 2026 se stahovaly napevno TŘI dny. S odjezdem za týden by
 * body trasy padly za konec pole a appka by napsala jen „konec trasy je mimo
 * rozsah předpovědi" — přitom by šlo jen o to si o data říct.
 *
 * ⚠️ Počítá se až po trase: délka cesty rozhoduje, kam až se sahá, a trasa
 * je stejně první dotaz (`loadRoute`).
 *
 * ⚠️ `+1` kvůli načatému dni: `forecast_days` počítá od místní půlnoci, takže
 * cesta, která skončí zítra v 1:00, potřebuje dva dny, i když trvá dvě hodiny.
 *
 * ⚠️ Nejmíň tři dny, ať „teď" dál sdílí záznam v cache s dosavadními dotazy.
 * Nejvýš 16 — víc Open-Meteo nedá.
 */
export function forecastDaysFor({ departureMs, durationS, offsetsMin, nowMs }) {
  const posun = Math.max(0, ...(offsetsMin || [0]));
  const konec = departureMs + posun * MIN + (Number(durationS) || 0) * 1000;
  const dny = Math.ceil(Math.max(0, konec - nowMs) / DEN) + 1;
  return Math.min(16, Math.max(3, dny));
}

/**
 * Výchozí čas, když uživatel klepne „Naplánovat".
 *
 * Nejbližší celá hodina, nejmíň za půl hodiny. „Za dvě minuty" není plán,
 * to je „teď" s krokem navíc.
 */
export function defaultPlanned(nowMs) {
  return roundUp(nowMs + 30 * MIN, 60);
}

/* ── vstup `datetime-local` ──────────────────────────────────────────── */

/**
 * Hodnota pro `<input type="datetime-local">`.
 *
 * ⚠️ V ČASE ZAŘÍZENÍ, ne v pásmu startu. Vstup pásmo nenese a člověk, který
 * doma plánuje cestu, myslí „v osm" podle svých hodinek. U cesty, která
 * začíná v jiném pásmu, se to nesplete potichu: souhrn vypíše odjezd
 * v pásmu místa (`kdy()`), takže rozdíl je vidět.
 */
export function toInputValue(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const dv = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dv(d.getMonth() + 1)}-${dv(d.getDate())}T${dv(d.getHours())}:${dv(d.getMinutes())}`;
}

/**
 * Zpátky na čas.
 *
 * 🚨 Tvar se ověřuje dřív, než se předá `Date`. `new Date('2026-09-18')`
 * (bez času) se čte jako UTC, kdežto s časem jako MÍSTNÍ čas — rozdíl dvou
 * hodin, který by se projevil jen u některých vstupů.
 */
export function fromInputValue(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(value || ''));
  if (!m) return null;
  const [, r, mes, den, hod, min] = m.map(Number);
  const d = new Date(r, mes - 1, den, hod, min);
  // Neexistující datum (31. 2.) Date tiše přesune — to se odmítne.
  if (d.getMonth() !== mes - 1 || d.getDate() !== den) return null;
  return d.getTime();
}

/** Meze vstupu: od nejbližšího kroku do týdne dopředu. */
export function inputBounds(nowMs) {
  return {
    min: toInputValue(roundUp(nowMs, STEP_MIN)),
    max: toInputValue(roundDown(nowMs + MAX_AHEAD_DAYS * DEN, STEP_MIN)),
  };
}

/* ── pomocné ─────────────────────────────────────────────────────────── */

/**
 * Zaokrouhlení na krok v MÍSTNÍM čase.
 *
 * ⚠️ Ne `Math.ceil(ms / krok) * krok`: to zaokrouhluje v UTC a v pásmu
 * s posunem o půl hodiny (Indie, Newfoundland) by „celá hodina" vyšla na :30.
 */
function roundUp(ms, krokMin) {
  const d = new Date(ms);
  d.setSeconds(0, 0);
  const zbytek = d.getMinutes() % krokMin;
  if (zbytek || d.getTime() < ms) d.setMinutes(d.getMinutes() - zbytek + krokMin);
  return d.getTime();
}

function roundDown(ms, krokMin) {
  const d = new Date(ms);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - (d.getMinutes() % krokMin));
  return d.getTime();
}

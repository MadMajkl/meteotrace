/**
 * Úprava dotazu pro hledání míst.
 *
 * ⚠️ ČISTÝ MODUL. Žádná síť, žádné DOM.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 PROČ TO VŮBEC EXISTUJE: DIAKRITIKA ROZBÍJÍ HLEDÁNÍ
 *
 * Změřeno 24. 8. 2026 na geokódování Open-Meteo:
 *
 *   „Plzeň"           → 0 nálezů
 *   „Plzen"           → 2 nálezy, první je **Plzeň**
 *   „Horšovský Týn"   → 0 nálezů
 *   „Horsovsky Tyn"   → 2 nálezy, první je **Horšovský Týn**
 *
 * Služba tedy města zná, jen je neumí najít podle jejich vlastního jména.
 * Pro českého uživatele to znamená, že appka „nenajde skoro nic" — a přesně
 * tak to Michal popsal, když na to narazil.
 *
 * Diakritika se proto před odesláním sundá. **Zobrazuje se pořád správné
 * jméno**, protože to vrací služba sama („Plzen" → „Plzeň").
 *
 * ⚠️ Neřeší to adresy. Open-Meteo zná jen sídla — ulice a čísla popisná
 * v jeho datech nejsou vůbec a žádná úprava dotazu je tam nenajde.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * Sundá diakritiku, zbytek nechá být.
 *
 * Rozloží znaky na základ a spojovací značku (NFD) a značky zahodí.
 * ⚠️ Nelatinková písma (řečtina, cyrilice, arabština) tím projdou beze
 * změny v tom smyslu, že se z nich nestane latinka — zmizí jen kombinující
 * značky, což je u nich správně.
 */
export function stripDiacritics(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC');
}

/**
 * Dotaz připravený pro geokódování.
 *
 * @param {string} text  co uživatel napsal
 * @returns {string}     co se pošle do služby
 */
export function searchQuery(text) {
  return stripDiacritics(String(text ?? '').trim());
}

/**
 * Kde to místo je — text pod jménem v nabídce hledání.
 *
 * 🚨 U adres nestačí kraj. Geokodér vrací u „náměstí Republiky 1" jako kraj
 * „Plzeň", takže nabídka tvrdila, že adresa je v Plzni — přitom je
 * v Horšovském Týně. **Obec je to jediné, co dvě stejně pojmenované ulice
 * rozliší**, a ta je jen v úplném popisu (`label`).
 *
 * Ze štítku se proto ustřihne jméno, které už je vidět nad ním, a zbytek
 * se použije. Když štítek chybí (starší zdroj), padá se zpátky na kraj a zemi.
 *
 * @param {{name?: string, label?: string, admin1?: string, country?: string}} r
 */
export function placeMeta(r) {
  const jmeno = (r?.name || '').trim();
  const stitek = (r?.label || '').trim();

  if (stitek) {
    const zbytek = stitek.startsWith(jmeno) ? stitek.slice(jmeno.length) : stitek;
    const cisty = zbytek.replace(/^[\s,]+/, '').trim();
    if (cisty) return cisty;
  }
  return [r?.admin1, r?.country].filter(Boolean).join(', ');
}

/**
 * Dá se tenhle bod použít jako „odkud se dívám"?
 *
 * 🚨 NULOVÝ OSTROV. `0, 0` je bod v Guinejském zálivu a zároveň nejčastější
 * podoba věty „polohu neznám": vrací ho prohlížeč bez lokalizační služby
 * (změřeno 25. 8. 2026 na headless Chromu), rozbitý přijímač i nevyplněný
 * formulář. `Number.isFinite(0)` je přitom `true`, takže se to bez téhle
 * kontroly tváří jako platná poloha.
 *
 * Důsledek nebyl pád, ale **tichý nesmysl**: hledání „Polní" se řadilo podle
 * vzdálenosti od rovníku, takže nabízelo jižní Čechy komukoli. Vypadalo to
 * jako rozmar služby, ne jako vada.
 *
 * ⚠️ Zahazuje se okolí nulového ostrova, ne přesná nula — souřadnice z GPS
 * nikdy nejsou přesně `0.000000`, ale `0.000031` je pořád tentýž nesmysl.
 * Cena omylu je zanedbatelná: skutečné místo v Guinejském zálivu je voda.
 */
export function isUsablePoint(p) {
  const lat = Number(p?.lat);
  const lon = Number(p?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return Math.abs(lat) > 0.01 || Math.abs(lon) > 0.01;
}

/**
 * ÚPLNÁ adresa — to, co se po výběru dopíše do vyhledávacího pole.
 *
 * 🚨 Pole, ve kterém po výběru zůstane jen „náměstí Republiky", **mate**:
 * takových je v republice osm a z pole se nedá poznat, které si člověk
 * vybral. Musí tam být i obec. (Michalova připomínka 25. 8. 2026.)
 *
 * Zdroj adres vrací úplný popis sám; u zálohy, která zná jen sídla, se
 * poskládá z kraje a země.
 */
export function placeLabel(r) {
  const stitek = (r?.label || '').trim();
  if (stitek) return stitek;
  return [r?.name, r?.admin1, r?.country].filter(Boolean).join(', ');
}

/**
 * KRÁTKÉ jméno místa — do nadpisu a mezi uložená místa.
 *
 * ⚠️ Úplná adresa se do nadpisu nevejde („náměstí Republiky 1, Horšovský Týn,
 * PK, Czechia" na displeji širokém 320 px), ale samotné jméno ulice zase
 * neříká, kde to je. Bere se tedy **jméno a obec** — kraj a země jsou
 * v nadpisu šum.
 *
 * ⚠️ Obec se přidává jen tehdy, když v názvu ještě není. U měst je jméno
 * a obec totéž a „Plzeň, Plzeň" by vypadalo jako vada.
 */
export function placeTitle(r) {
  const jmeno = (r?.name || '').trim();
  const obec = (r?.locality || '').trim();
  if (!obec || !jmeno) return jmeno || obec;
  if (jmeno.toLowerCase().includes(obec.toLowerCase())) return jmeno;
  return `${jmeno}, ${obec}`;
}

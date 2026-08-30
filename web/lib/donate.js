/**
 * Dary — platební údaje a české QR platby (SPD 1.0).
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě. Kreslení QR je v `qr.js`, zapojení
 * do obrazovky v `app.js`.
 *
 * 🚨 ŽELEZNÉ PRAVIDLO Z GULPKY (`R7`): **dar nesmí NIKDY nic odemknout.**
 * Jakmile by za dar něco přibylo — motiv, delší předpověď, odstranění
 * čehokoli — přestal by to být dar a stala by se z něj platba za digitální
 * obsah, která pod Google Play musí jít přes Play Billing. Proto v tomhle
 * souboru není a nikdy nesmí být jediná zmínka o stavu appky: neví, co je
 * zaplaceno, protože není co platit. Appka je celá zdarma.
 *
 * Slovníček: **SPD** (Short Payment Descriptor) je český standard „QR platby" —
 * jeden řádek textu, ze kterého bankovní appka vyplní formulář. **IBAN** je
 * mezinárodní tvar čísla účtu; SPD jiný tvar nepřijímá.
 */

'use strict';

/**
 * Kam dar poletí.
 *
 * ⚠️ Jediné místo s platebními údaji v celé appce. `revolut` a `paypal` jsou
 * jen přezdívky, adresa se skládá níž — kdyby některá služba změnila tvar
 * odkazu, mění se to na jednom řádku.
 */
export const DONATE = {
  iban: 'CZ3558000000002700973822',
  recipient: 'MeteoTrace',
  message: 'Dar pro appku MeteoTrace',
  currency: 'CZK',
  revolut: 'michalsx3n',
  paypal: 'madmajkl',

  /**
   * 🚨 VARIABILNÍ SYMBOL — JEDINÉ, PODLE ČEHO SE VE VÝPISU POZNÁ APPKA.
   *
   * Na týž účet chodí dary z Gulpky, z MeteoTrace i z čehokoli dalšího.
   * Jméno příjemce a zpráva se liší, jenže **zprávu smí plátce přepsat**
   * a některé banky ji zkrátí — takže podle ní se počítat nedá. Variabilní
   * symbol je samostatné číselné pole, banka ho ukazuje ve vlastním sloupci
   * a dá se podle něj filtrovat.
   *
   * Číslování: `101` Gulpka, `102` MeteoTrace, další appky dál. Gulpka ho
   * zatím nemá — až se doplní, ať dostane `101`.
   */
  vs: '102',
};

/** Nabízené částky v korunách. Čtvrtá možnost je vlastní číslo. */
export const AMOUNTS = [50, 100, 200];

/** Výchozí předvybraná částka. */
export const DEFAULT_AMOUNT = 100;

/** Nejvyšší přijímaná částka. Nad ní jde skoro jistě o překlep. */
export const MAX_AMOUNT = 100000;

/* ============================================================
   ČÍSLO ÚČTU
   ============================================================ */

/**
 * Sedí kontrolní číslice IBANu? (norma ISO 13616, zbytek po dělení 97)
 *
 * 🚨 Není to obřadnost. Překlep v čísle účtu je jediná chyba téhle
 * obrazovky, kterou nikdo nenahlásí: platba odejde, appka mlčí a peníze
 * skončí u cizího člověka. Kontrola běží i v testu, takže se překlep
 * v `DONATE` nedostane dál než k prvnímu spuštění testů.
 */
export function ibanValid(iban) {
  const s = String(iban).replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9A-Z]{13,32}$/.test(s)) return false;
  const prehozeny = s.slice(4) + s.slice(0, 4);
  let zbytek = 0;
  for (const znak of prehozeny) {
    const hodnota = znak >= 'A' && znak <= 'Z'
      ? String(znak.charCodeAt(0) - 55)   // A = 10, B = 11, …
      : znak;
    for (const cislice of hodnota) zbytek = (zbytek * 10 + Number(cislice)) % 97;
  }
  return zbytek === 1;
}

/** IBAN po čtveřicích, aby se dal přečíst nahlas i opsat. */
export function ibanPretty(iban) {
  return String(iban).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

/* ============================================================
   ČÁSTKA
   ============================================================ */

/**
 * Uklidí, co člověk napsal do pole s vlastní částkou.
 *
 * Vrací `null` pro „bez částky" — a to NENÍ chyba: QR bez `AM` je platný
 * a banka se na částku zeptá sama. Kdo chce poslat pětikorunu nebo tisíc,
 * nemá být odmítnut prázdnou obrazovkou.
 *
 * ⚠️ Přijímá i čárku: na české klávesnici je pod prstem dřív než tečka.
 */
export function normalizeAmount(vstup) {
  if (vstup === null || vstup === undefined) return null;
  const text = String(vstup).trim().replace(',', '.');
  if (text === '') return null;
  const cislo = Number(text);
  if (!Number.isFinite(cislo) || cislo <= 0) return null;
  return Math.min(Math.round(cislo * 100) / 100, MAX_AMOUNT);
}

/* ============================================================
   PLATEBNÍ ŘETĚZEC (SPD 1.0)
   ============================================================ */

/**
 * Očistí text pro SPD.
 *
 * 🚨 Hvězdička odděluje pole — kdyby se dostala do hodnoty, rozpadl by se
 * celý řetězec a banka by načetla nesmysl. Diakritika ve standardu není;
 * banky si s ní poradí různě, takže se převede na holá písmena.
 */
export function spdSafe(text, limit) {
  const bez = String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // ě → e, ř → r
    .replace(/[*\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return limit ? bez.slice(0, limit) : bez;
}

/**
 * Řetězec české QR platby.
 *
 * @param {{iban?: string, amount?: number|null, currency?: string,
 *          recipient?: string, message?: string}} [volby]
 */
export function spdString(volby = {}) {
  const {
    iban = DONATE.iban,
    amount = null,
    currency = DONATE.currency,
    recipient = DONATE.recipient,
    message = DONATE.message,
    vs = DONATE.vs,
  } = volby;

  const castka = normalizeAmount(amount);
  const pole = [`ACC:${String(iban).replace(/\s+/g, '').toUpperCase()}`];
  if (castka !== null) pole.push(`AM:${castka.toFixed(2)}`);
  pole.push(`CC:${currency}`);
  // ⚠️ `X-VS` je rozšiřující pole normy: jen číslice, nejvýš deset.
  // Nesmysl se raději nepošle, než aby banka odmítla celý příkaz.
  const symbol = vsSafe(vs);
  if (symbol) pole.push(`X-VS:${symbol}`);
  if (recipient) pole.push(`RN:${spdSafe(recipient, 35)}`);
  if (message) pole.push(`MSG:${spdSafe(message, 60)}`);

  return `SPD*1.0*${pole.join('*')}`;
}

/** Variabilní symbol pro SPD: jen číslice, nejvýš deset. Jinak `null`. */
export function vsSafe(vs) {
  const cisla = String(vs ?? '').replace(/\D/g, '');
  return cisla && cisla.length <= 10 ? cisla : null;
}

/**
 * Poznámka k platbě pro Revolut a PayPal.
 *
 * 🚨 ANI `revolut.me`, ANI `paypal.me` POZNÁMKU PŘEDVYPLNIT NEUMÍ — do
 * odkazu jde jen částka a měna (ověřeno 30. 8. 2026). Kdyby se do adresy
 * přilepil parametr navíc, mlčky by se zahodil a vypadalo by to, že appka
 * poznámku posílá. Proto se text **ukáže a dá zkopírovat** a člověk si ho
 * vloží sám; je to jediná cesta, která opravdu funguje.
 *
 * Bez ní je dar přes Revolut nerozeznatelný od daru pro kteroukoli jinou
 * appku — chodí na týž účet a nenese žádné pole navíc.
 */
export function paymentNote() {
  return `${DONATE.recipient} — dar`;
}

/* ============================================================
   ODKAZY VEN

   ⚠️ Obojí vede MIMO appku, do prohlížeče nebo do jejich appky. Uvnitř
   WebView by platební tok byl něco jiného, než čím je — odkaz ven.
   ============================================================ */

/** Adresa Revolutu. Částka se dá předvyplnit, měna se řekne s ní. */
export function revolutUrl(amount = null, currency = DONATE.currency) {
  const castka = normalizeAmount(amount);
  const zaklad = `https://revolut.me/${DONATE.revolut}`;
  return castka === null ? zaklad : `${zaklad}/${castka}${currency.toLowerCase()}`;
}

/** Adresa PayPalu. Bez částky vede na holý profil. */
export function paypalUrl(amount = null, currency = DONATE.currency) {
  const castka = normalizeAmount(amount);
  const zaklad = `https://paypal.me/${DONATE.paypal}`;
  return castka === null ? zaklad : `${zaklad}/${castka}${currency}`;
}

/**
 * Samotest darů a platebního řetězce.
 *
 * 🚨 Tohle je jediné místo v appce, kde chyba stojí peníze — a to cizí.
 * Špatná číslice v účtu se nikde neprojeví: appka běží, QR se nakreslí,
 * banka platbu provede a nikdo nic nenahlásí. Kontrolní číslice IBANu se
 * proto počítají i pro **skutečnou konfiguraci**, ne jen pro vymyšlená data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  DONATE, AMOUNTS, DEFAULT_AMOUNT, MAX_AMOUNT,
  ibanValid, ibanPretty, normalizeAmount, spdSafe, spdString,
  revolutUrl, paypalUrl, vsSafe, paymentNote,
} from '../web/lib/donate.js';
import { qrEncode, MAX_VERSION } from '../web/lib/qr.js';

/* ============================================================
   SKUTEČNÁ KONFIGURACE
   ============================================================ */

test('🚨 číslo účtu v konfiguraci má správné kontrolní číslice', () => {
  assert.ok(ibanValid(DONATE.iban), `neplatný IBAN: ${DONATE.iban}`);
  assert.ok(DONATE.iban.startsWith('CZ'), 'český účet, protože QR platba je česká norma');
  assert.equal(DONATE.iban.length, 24, 'český IBAN má 24 znaků');
});

test('kontrola IBANu opravdu chytí překlep', () => {
  // Bez tohohle by `ibanValid` mohla vracet `true` na cokoli a test výš
  // by nic nedokazoval.
  const spatny = DONATE.iban.slice(0, 10) + (DONATE.iban[10] === '9' ? '8' : '9') + DONATE.iban.slice(11);
  assert.notEqual(spatny, DONATE.iban);
  assert.equal(ibanValid(spatny), false);

  assert.equal(ibanValid(''), false);
  assert.equal(ibanValid('CZ00'), false);
  assert.equal(ibanValid('2700973822/5800'), false, 'český tvar účtu není IBAN');
});

test('IBAN se ukazuje po čtveřicích', () => {
  assert.equal(ibanPretty('CZ3558000000002700973822'), 'CZ35 5800 0000 0027 0097 3822');
  assert.equal(ibanPretty('CZ35 5800 0000 0027 0097 3822'), 'CZ35 5800 0000 0027 0097 3822');
});

test('nabízené částky dávají smysl a výchozí je mezi nimi', () => {
  assert.ok(AMOUNTS.every((a) => Number.isInteger(a) && a > 0));
  assert.ok(AMOUNTS.includes(DEFAULT_AMOUNT));
});

/* ============================================================
   ČÁSTKA
   ============================================================ */

test('částka se uklidí a nesmysl se zahodí', () => {
  assert.equal(normalizeAmount('100'), 100);
  assert.equal(normalizeAmount(250), 250);
  assert.equal(normalizeAmount('  75  '), 75);
  assert.equal(normalizeAmount('99.50'), 99.5);
  assert.equal(normalizeAmount('99,50'), 99.5, 'čárka je na české klávesnici první');
  assert.equal(normalizeAmount('12.345'), 12.35, 'haléře se zaokrouhlí');
});

test('prázdná částka je „bez částky", ne chyba', () => {
  // ⚠️ QR bez `AM` je platný a banka se zeptá sama. Kdo chce poslat
  // netypickou částku, nesmí narazit na prázdnou obrazovku.
  assert.equal(normalizeAmount(''), null);
  assert.equal(normalizeAmount('   '), null);
  assert.equal(normalizeAmount(null), null);
  assert.equal(normalizeAmount(undefined), null);
  assert.equal(normalizeAmount('abc'), null);
  assert.equal(normalizeAmount('0'), null);
  assert.equal(normalizeAmount('-50'), null);
  assert.equal(normalizeAmount(Infinity), null);
});

test('nesmyslně vysoká částka se srazí na strop', () => {
  // Překlep na numerické klávesnici je snazší než trefa: 100000 místo 100.
  assert.equal(normalizeAmount('99999999'), MAX_AMOUNT);
});

/* ============================================================
   PLATEBNÍ ŘETĚZEC
   ============================================================ */

test('řetězec SPD má předepsaný tvar', () => {
  const s = spdString({ amount: 100 });
  assert.ok(s.startsWith('SPD*1.0*'), s);
  assert.match(s, /\*ACC:CZ35\d{20}\*/);
  assert.match(s, /\*AM:100\.00\*/, 'částka vždy na dvě desetinná místa');
  assert.match(s, /\*CC:CZK(\*|$)/);
  assert.match(s, /\*RN:MeteoTrace(\*|$)/);
});

test('bez částky se pole AM vůbec nevypíše', () => {
  const s = spdString({ amount: null });
  assert.ok(!s.includes('AM:'), s);
  assert.ok(s.includes('ACC:'), 'účet tam ale zůstane');
});

test('🚨 hvězdička z hodnoty rozpadne celý řetězec, takže se nesmí dostat dovnitř', () => {
  const s = spdString({ amount: 50, recipient: 'Meteo*Trace', message: 'dar*pro*appku' });
  const pole = s.split('*');
  assert.equal(pole[0], 'SPD');
  assert.equal(pole[1], '1.0');
  // Každé další pole musí mít tvar KLÍČ:hodnota — kdyby hvězdička prošla,
  // vznikl by kus bez dvojtečky a banka by načetla nesmysl.
  for (const kus of pole.slice(2)) assert.match(kus, /^[A-Z-]+:/, `rozpadlé pole: ${kus}`);
});

test('diakritika se převede na holá písmena', () => {
  // Norma ji nezná a banky si s ní poradí každá jinak.
  assert.equal(spdSafe('Příspěvek na počasí'), 'Prispevek na pocasi');
  assert.equal(spdSafe('žluťoučký kůň'), 'zlutoucky kun');
});

test('dlouhý text se ořízne na to, co norma dovolí', () => {
  const s = spdString({ message: 'x'.repeat(200), recipient: 'y'.repeat(200) });
  assert.equal(s.match(/\*MSG:(.*)$/)[1].length, 60);
  assert.equal(s.match(/\*RN:([^*]*)/)[1].length, 35);
});

test('konce řádků a nadbytečné mezery se srovnají', () => {
  assert.equal(spdSafe('dar\nna   appku\r\n'), 'dar na appku');
});

/* ============================================================
   QR PRO SKUTEČNOU PLATBU
   ============================================================ */

test('skutečný platební řetězec se vejde do QR kódu', () => {
  for (const castka of [...AMOUNTS, null, MAX_AMOUNT]) {
    const s = spdString({ amount: castka });
    const qr = qrEncode(s);
    assert.ok(qr.version <= MAX_VERSION);
    // ⚠️ Čím vyšší verze, tím jemnější mřížka a tím hůř se kód čte
    // z displeje telefonu. Přes verzi 8 by se to už mělo řešit.
    assert.ok(qr.version <= 8, `verze ${qr.version} je na displej moc jemná`);
  }
});

/* ============================================================
   ODKAZY VEN
   ============================================================ */

test('odkazy na Revolut a PayPal míří ven a nesou částku', () => {
  assert.equal(revolutUrl(100), 'https://revolut.me/michalsx3n/100czk');
  assert.equal(paypalUrl(100), 'https://paypal.me/madmajkl/100CZK');
  assert.equal(revolutUrl(null), 'https://revolut.me/michalsx3n');
  assert.equal(paypalUrl(null), 'https://paypal.me/madmajkl');
  for (const url of [revolutUrl(50), paypalUrl(50)]) {
    assert.ok(url.startsWith('https://'), 'nikdy http, jde o peníze');
  }
});

/* ============================================================
   ŽELEZNÉ PRAVIDLO: DAR NIC NEODEMYKÁ

   ⚠️ Tohle nejde ověřit chováním — ověřuje se tím, co v modulu NENÍ.
   Kdyby dar sáhl na stav appky, přestal by to být dar a stala by se
   z něj platba za digitální obsah pod povinným Play Billing (`R7`).
   ============================================================ */

test('🚨 modul darů nesahá na stav appky ani na úložiště', () => {
  const zdroj = fs.readFileSync(new URL('../web/lib/donate.js', import.meta.url), 'utf8');
  for (const zakazano of ['localStorage', 'sessionStorage', 'import ', 'state.', 'window.']) {
    assert.ok(!zdroj.includes(zakazano),
      `dar se nesmí vázat na stav appky — nalezeno „${zakazano}"`);
  }
});

/* ============================================================
   ODLIŠENÍ OD OSTATNÍCH APPEK

   🚨 Na týž účet chodí dary z Gulpky i z MeteoTrace. Michal 30. 8. 2026:
   *„je tam nějaký symbol, že to je za podporu meteotrace a ne gulpky?"*
   Nebyl. Jméno příjemce a zpráva se sice liší, jenže zprávu smí plátce
   přepsat a některé banky ji zkrátí — podle ní se počítat nedá.
   ============================================================ */

test('🚨 v platbě je variabilní symbol, jinak se appky ve výpisu nerozliší', () => {
  const s = spdString({ amount: 100 });
  assert.match(s, /\*X-VS:\d+\*/, s);
  assert.ok(DONATE.vs, 'variabilní symbol musí být v konfiguraci');
});

test('variabilní symbol splňuje meze normy', () => {
  // Jen číslice a nejvýš deset — delší nebo písmenný by banka odmítla,
  // a to by shodilo celý příkaz, ne jen symbol.
  assert.match(DONATE.vs, /^\d{1,10}$/);
  assert.equal(vsSafe('102'), '102');
  assert.equal(vsSafe(102), '102');
  assert.equal(vsSafe('VS-102'), '102', 'oddělovače se zahodí, číslo zůstane');
  assert.equal(vsSafe('12345678901'), null, 'jedenáct číslic je moc');
  assert.equal(vsSafe('abc'), null);
  assert.equal(vsSafe(''), null);
  assert.equal(vsSafe(null), null);
});

test('bez symbolu se pole vůbec nevypíše, nevznikne prázdné', () => {
  // ⚠️ `X-VS:` bez hodnoty je poškozený řetězec, ne „bez symbolu".
  const s = spdString({ amount: 50, vs: null });
  assert.ok(!s.includes('X-VS'), s);
  assert.ok(s.includes('ACC:'), 'zbytek platby musí zůstat');
});

test('🚨 poznámka k platbě pojmenuje appku', () => {
  // Pro Revolut a PayPal je to JEDINÁ stopa: chodí na týž účet a nenesou
  // ani variabilní symbol.
  const p = paymentNote();
  assert.match(p, /MeteoTrace/);
  assert.ok(p.length <= 40, 'do pole poznámky se musí vejít');
});

test('🚨 odkazy ven poznámku NENESOU — a nesmí to nikdo předstírat', () => {
  // `revolut.me` ani `paypal.me` předvyplnit poznámku neumí (ověřeno
  // 30. 8. 2026). Kdyby se do adresy přilepil parametr navíc, mlčky by se
  // zahodil a vypadalo by to, že appka poznámku posílá.
  for (const url of [revolutUrl(100), paypalUrl(100)]) {
    assert.ok(!/note|message|reference|memo/i.test(url), `v adrese nemá co dělat poznámka: ${url}`);
  }
});

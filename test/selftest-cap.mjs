/**
 * Samotest čtení CAP od ČHMÚ.
 *
 * Zmenšenina skutečného dokumentu (`alert_cap_50_280835.xml`, ověřeno
 * 31. 8. 2026): jedna opravdová výstraha ve dvou jazycích, jedna „žádná
 * výstraha" a jedna oblast bez závorky. Nic víc není potřeba — chyby, které
 * hrozí, jsou v párování jazyků a ve čtení území, ne v objemu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCap, nejnovejsiSoubor, zpravaJeCerstva, stariZpravyS, NEJSTARSI_ZPRAVA_MS,
} from '../web/lib/cap.js';
import { trimWarnings } from '../web/lib/upstreams.js';

const CAP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>2.49.0.0.203.0.CZ.260828083505.XOCZ50_OKPR_000337</identifier>
  <sender>chmi@chmi.cz</sender>
  <sent>2026-08-28T10:35:05+02:00</sent>
  <status>Actual</status>
  <msgType>Update</msgType>
  <info>
    <language>cs</language>
    <event>Silné bouřky</event>
    <severity>Moderate</severity>
    <onset>2026-08-28T17:00:00+02:00</onset>
    <expires>2026-08-29T00:00:00+02:00</expires>
    <description>Očekává se výskyt silných bouřek.</description>
    <area>
      <areaDesc>Středočeský kraj (Beroun, Hořovice &amp; Kladno)</areaDesc>
      <geocode><valueName>CISORP</valueName><value>2102</value></geocode>
      <geocode><valueName>EMMA_ID</valueName><value>CZ02102</value></geocode>
      <geocode><valueName>CISORP</valueName><value>2108</value></geocode>
    </area>
    <area>
      <areaDesc>Karlovarský kraj</areaDesc>
      <geocode><valueName>CISORP</valueName><value>4101</value></geocode>
    </area>
  </info>
  <info>
    <language>en-GB</language>
    <event>Moderate Thunderstorm Warning</event>
    <severity>Moderate</severity>
    <onset>2026-08-28T17:00:00+02:00</onset>
    <expires>2026-08-29T00:00:00+02:00</expires>
    <area>
      <areaDesc>Central Bohemia</areaDesc>
      <geocode><valueName>CISORP</valueName><value>2102</value></geocode>
      <geocode><valueName>CISORP</valueName><value>2108</value></geocode>
    </area>
    <area>
      <areaDesc>Karlovy Vary Region</areaDesc>
      <geocode><valueName>CISORP</valueName><value>4101</value></geocode>
    </area>
  </info>
  <info>
    <language>cs</language>
    <event>Žádná výstraha před bouřkou</event>
    <severity>Minor</severity>
    <onset>2026-08-28T10:26:26+02:00</onset>
    <area>
      <areaDesc>Hlavní město Praha</areaDesc>
      <geocode><valueName>CISORP</valueName><value>1100</value></geocode>
    </area>
  </info>
</alert>`;

/* ============================================================
   ČTENÍ DOKUMENTU
   ============================================================ */

test('z hlavičky se přečte čas vydání, odesílatel a stav', () => {
  const c = parseCap(CAP);
  assert.equal(c.sent, '2026-08-28T10:35:05+02:00');
  assert.equal(c.sender, 'chmi@chmi.cz');
  assert.equal(c.status, 'Actual');
});

test('🚨 čas vydání se bere z HLAVIČKY, ne z výstrahy', () => {
  // Na `sent` stojí hlídání stáří zdroje. Kdyby se bralo z `<info>`, mohl by
  // tři dny starý feed vypadat čerstvě jen proto, že výstraha má dnešní čas.
  const podvrzeny = CAP.replace('<onset>2026-08-28T17:00:00+02:00</onset>',
    '<onset>2026-08-28T17:00:00+02:00</onset><sent>2099-01-01T00:00:00+02:00</sent>');
  assert.equal(parseCap(podvrzeny).sent, '2026-08-28T10:35:05+02:00');
});

test('🚨 jazykové verze téže výstrahy se spojí do jedné', () => {
  const c = parseCap(CAP);
  // Dvě výstrahy: bouřky (cs+en) a „žádná výstraha" (jen cs).
  assert.equal(c.warnings.length, 2);
  const bourky = c.warnings.find((w) => w.alert.info.length === 2);
  assert.ok(bourky, 'česká a anglická verze se nespárovaly');
  const jazyky = bourky.alert.info.map((i) => i.language).sort();
  assert.deepEqual(jazyky, ['cs', 'en-GB']);
});

test('🚨 páruje se podle závažnosti, časů a kódů — NE podle pořadí', () => {
  // Pořadí je vlastnost dnešního vydavatele, ne formátu. Kdyby se páruje
  // podle něj, po prohození by se spojil český text s cizím územím.
  const prohozene = CAP
    .replace(/<info>\s*<language>cs<\/language>\s*<event>Silné bouřky[\s\S]*?<\/info>/, '@@CS@@')
    .replace(/<info>\s*<language>en-GB<\/language>[\s\S]*?<\/info>/, (m) => m + '@@PLACE@@');
  const cs = CAP.match(/<info>\s*<language>cs<\/language>\s*<event>Silné bouřky[\s\S]*?<\/info>/)[0];
  const zpreh = prohozene.replace('@@PLACE@@', cs).replace('@@CS@@', '');

  const c = parseCap(zpreh);
  const bourky = c.warnings.find((w) => w.alert.info.length === 2);
  assert.ok(bourky, 'po prohození pořadí se verze nespárovaly');
  assert.deepEqual(bourky.alert.info.map((i) => i.language).sort(), ['cs', 'en-GB']);
});

test('území se přečte i s kódy CISORP', () => {
  const c = parseCap(CAP);
  const cs = c.warnings.flatMap((w) => w.alert.info).find((i) => i.event === 'Silné bouřky');
  assert.equal(cs.area.length, 2);
  assert.equal(cs.area[0].areaDesc, 'Středočeský kraj (Beroun, Hořovice & Kladno)');
  const cisorp = cs.area[0].geocode.filter((g) => g.valueName === 'CISORP').map((g) => g.value);
  assert.deepEqual(cisorp, ['2102', '2108']);
});

test('znakové entity se rozkódují', () => {
  const c = parseCap(CAP);
  const cs = c.warnings.flatMap((w) => w.alert.info).find((i) => i.event === 'Silné bouřky');
  assert.match(cs.area[0].areaDesc, /Hořovice & Kladno/, '&amp; se mělo rozbalit');
});

test('chybějící `expires` není chyba', () => {
  // Plošné „žádná výstraha" ho nemá — a je to platná zpráva.
  const c = parseCap(CAP);
  const bez = c.warnings.flatMap((w) => w.alert.info).find((i) => i.event.startsWith('Žádná'));
  assert.equal(bez.expires, null);
  assert.equal(bez.onset, '2026-08-28T10:26:26+02:00');
});

test('🚨 z cizího dokumentu se radši nevytáhne nic, než nesmysl', () => {
  for (const nesmysl of ['', '<html><body>Nope</body></html>', '{"json":true}', null, undefined]) {
    const c = parseCap(nesmysl);
    assert.deepEqual(c.warnings, [], String(nesmysl).slice(0, 20));
    assert.equal(c.sent, null);
  }
});

/* ============================================================
   NAVAZUJE NA ZBYTEK APPKY BEZ ZMĚNY

   🚨 Tvar výstupu je schválně týž jako u MeteoAlarmu. Kdyby se rozešel,
   výměna zdroje by byla přepis appky — přesně to, čemu se `R0` brání.
   ============================================================ */

test('🚨 výstup projde `trimWarnings()` beze změny kódu', () => {
  const orezane = trimWarnings(parseCap(CAP), 'cs');
  // „Žádná výstraha" se odfiltruje, zbude jedna skutečná.
  assert.equal(orezane.length, 1);
  const w = orezane[0];
  assert.equal(w.event, 'Silné bouřky');
  assert.equal(w.severity, 'Moderate');
  assert.equal(w.onset, '2026-08-28T17:00:00+02:00');
  assert.equal(w.areas.length, 2);
  assert.match(w.areas[0].name, /^Středočeský kraj \(/);
  assert.ok(w.id, 'musí vzniknout stabilní klíč');
});

test('klíč výstrahy se nemění s jazykem appky', () => {
  const cs = trimWarnings(parseCap(CAP), 'cs')[0];
  const en = trimWarnings(parseCap(CAP), 'en')[0];
  assert.equal(cs.id, en.id, 'jinak by telefon zvonil při každém přepnutí jazyka');
  assert.notEqual(cs.event, en.event, 'texty se ale lišit mají');
});

/* ============================================================
   NEJNOVĚJŠÍ SOUBOR V ADRESÁŘI
   ============================================================ */

const VYPIS = `<html><body><pre>
<a href="alert_cap_50_280835.xml">alert_cap_50_280835.xml</a>   28-Aug-2026 06:35   1500000
<a href="alert_cap_70_311200.xml">alert_cap_70_311200.xml</a>   31-Mar-2026 14:30   900000
<a href="alert_cap_50_300811.xml">alert_cap_50_300811.xml</a>   30-Aug-2026 06:12   1513000
</pre></body></html>`;

test('🚨 nejnovější se pozná podle času úpravy, NE podle jména', () => {
  // Jména se opakují: `alert_cap_70_311200.xml` je „den 31, 12:00" a přepíše
  // se každý měsíc. Řazení podle jména by vybralo soubor z března.
  const n = nejnovejsiSoubor(VYPIS);
  assert.equal(n.jmeno, 'alert_cap_50_300811.xml');
});

test('nesrozumitelný výpis vrátí null, ne dohad', () => {
  assert.equal(nejnovejsiSoubor('<html>nic tu není</html>'), null);
  assert.equal(nejnovejsiSoubor(''), null);
});

/* ============================================================
   STÁŘÍ ZPRÁVY
   ============================================================ */

test('🚨 mrtvý zdroj se pozná podle času vydání', () => {
  const ted = Date.parse('2026-08-31T08:00:00+02:00');
  assert.equal(zpravaJeCerstva('2026-08-31T06:00:00+02:00', ted), true, 'dvě hodiny je v pohodě');
  assert.equal(zpravaJeCerstva('2026-08-28T10:35:05+02:00', ted), false, 'tři dny už ne');
});

test('práh je půl dne — ČHMÚ vydává i „nic nehrozí" častěji', () => {
  const ted = Date.now();
  assert.equal(zpravaJeCerstva(new Date(ted - NEJSTARSI_ZPRAVA_MS + 60_000).toISOString(), ted), true);
  assert.equal(zpravaJeCerstva(new Date(ted - NEJSTARSI_ZPRAVA_MS - 60_000).toISOString(), ted), false);
});

test('chybějící čas vydání NENÍ čerstvý', () => {
  // ⚠️ Když nevíme, kdy zpráva vznikla, nesmíme z jejího mlčení číst klid.
  assert.equal(zpravaJeCerstva(null), false);
  assert.equal(zpravaJeCerstva(''), false);
  assert.equal(zpravaJeCerstva('nesmysl'), false);
  assert.equal(stariZpravyS(null), null);
});

test('zpráva z budoucnosti se nepovažuje za čerstvou', () => {
  // Posunuté hodiny na serveru nesmí udělat z prastarého feedu čerstvý.
  const ted = Date.parse('2026-08-31T08:00:00+02:00');
  assert.equal(zpravaJeCerstva('2026-09-05T08:00:00+02:00', ted), false);
});

test('stáří se počítá v sekundách', () => {
  const ted = Date.parse('2026-08-31T08:00:00+02:00');
  assert.equal(stariZpravyS('2026-08-31T07:00:00+02:00', ted), 3600);
});

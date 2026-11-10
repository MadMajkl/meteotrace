/**
 * Samotest pohledu na výstrahy.
 *
 * Bez prohlížeče a bez sítě. Čas se předává zvenčí, takže test nečeká
 * a nezáleží na tom, kdy se pustí.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWarningsView } from '../web/lib/warnings-view.js';

const TEĎ = Date.parse('2026-08-22T12:00:00+02:00');
const za = (h) => new Date(TEĎ + h * 3600_000).toISOString();

function vystraha(over = {}) {
  return {
    event: 'Bouřky',
    severity: 'Moderate',
    onset: za(-1),
    expires: za(4),
    mista: ['Litoměřice'],
    presne: true,
    ...over,
  };
}

/**
 * ⚠️ Od `R20` platí, že prázdno se z MLČÍCÍHO zdroje nesmí číst jako klid.
 * Testy níž zkoumají podoby prázdna u ZDRAVÉHO zdroje, tak se jim doplní
 * čerstvý čas vydání. Kdo chce zkoušet zastaralý zdroj, uvede si `sent` sám.
 */
const CERSTVE = new Date(TEĎ - 3600_000).toISOString();

const pohled = (payload) => buildWarningsView({
  payload: payload && typeof payload === 'object' && !('sent' in payload)
    ? { ...payload, sent: CERSTVE }
    : payload,
  lang: 'cs',
  nowMs: TEĎ,
});

/* ============================================================
   ČTYŘI PODOBY PRÁZDNA

   Prázdný seznam znamená pokaždé něco jiného. Kdyby se všechny vypsaly
   stejně (tedy nijak), uživatel by jel do bouřky s pocitem, že je čisto.
   ============================================================ */

test('🚨 prázdno: „nic nehrozí" a „nepodařilo se načíst" se nesmí splést', () => {
  const klid = pohled({ warnings: [], misto: { nazev: 'Litoměřice' }, pokryto: true, filtrovano: true });
  const chyba = pohled(null);

  assert.equal(klid.stav, 'zadne');
  assert.equal(chyba.stav, 'nedostupne');
  assert.notEqual(klid.zprava, chyba.zprava);
  for (const v of [klid, chyba]) assert.ok(v.zprava, 'obojí musí něco říct, ne mlčet');
});

test('🚨 prázdno: místo mimo pokrytí není totéž co klid', () => {
  const mimo = pohled({ warnings: [], misto: null, pokryto: false, filtrovano: true });
  assert.equal(mimo.stav, 'mimo');
  // 🚨 A věta nesmí tvrdit, že se výstrahy NEVYDÁVAJÍ — pro New York se
  // vydávají, jen my sledujeme evropský systém. Slibovat klid, o kterém
  // nic nevíme, je nejhorší možná chyba právě u výstrah.
  assert.match(mimo.zprava, /neumíme|evropsk/i, mimo.zprava);
  assert.ok(!/nevydávají/.test(mimo.zprava), mimo.zprava);
});

test('klid u známého místa se zeptá jménem', () => {
  const v = pohled({ warnings: [], misto: { nazev: 'Litoměřice' }, pokryto: true, filtrovano: true });
  assert.ok(v.zprava.includes('Litoměřice'), `chybí jméno místa: ${v.zprava}`);
});

test('klid bez známého místa použije obecnou větu', () => {
  const v = pohled({ warnings: [], misto: null, pokryto: true, filtrovano: true });
  assert.equal(v.stav, 'zadne');
  assert.ok(v.zprava && !v.zprava.includes('{'), 'nesmí zůstat nedosazená značka');
});

/* ============================================================
   NEJISTOTA SE PŘIZNÁVÁ
   ============================================================ */

test('🚨 když se nefiltrovalo, řekne se to a výstrahy se stejně ukážou', () => {
  const v = pohled({ warnings: [vystraha()], filtrovano: false, pokryto: false });
  assert.equal(v.stav, 'nejiste');
  assert.equal(v.polozky.length, 1, 'zamlčet bouřku je horší než ukázat navíc');
  assert.ok(v.zprava, 'ale musí být poznat, že jde o odhad');
});

test('🚨 výstraha s nejistým rozsahem to má napsané u sebe', () => {
  const v = pohled({ warnings: [vystraha({ presne: false })], pokryto: true, filtrovano: true });
  assert.equal(v.polozky[0].nejiste, true);
  assert.ok(v.polozky[0].popis.length, 'nejistota se nesmí jen tiše přeskočit');
});

test('u přesné výstrahy je vidět, kterých míst se týká', () => {
  const v = pohled({ warnings: [vystraha({ mista: ['Litoměřice', 'Louny'] })], pokryto: true, filtrovano: true });
  assert.ok(v.polozky[0].popis.includes('Litoměřice'));
  assert.ok(v.polozky[0].popis.includes('Louny'));
});

/* ============================================================
   POŘADÍ A PLATNOST
   ============================================================ */

test('řadí se od nejzávažnější', () => {
  const v = pohled({
    warnings: [
      vystraha({ event: 'Mírné', severity: 'Minor' }),
      vystraha({ event: 'Extrémní', severity: 'Extreme' }),
      vystraha({ event: 'Vysoké', severity: 'Severe' }),
    ],
    pokryto: true, filtrovano: true,
  });
  assert.deepEqual(v.polozky.map((p) => p.nadpis), ['Extrémní', 'Vysoké', 'Mírné']);
});

test('🚨 neznámá závažnost se neřadí naspod', () => {
  // Podceňovat to, čemu nerozumíme, je horší chyba než přeceňovat.
  const v = pohled({
    warnings: [
      vystraha({ event: 'Mírné', severity: 'Minor' }),
      vystraha({ event: 'Záhadné', severity: 'Kdoví' }),
      vystraha({ event: 'Střední', severity: 'Moderate' }),
    ],
    pokryto: true, filtrovano: true,
  });
  assert.deepEqual(v.polozky.map((p) => p.nadpis), ['Záhadné', 'Střední', 'Mírné']);
  assert.equal(v.polozky[0].trida, 'unknown', 'nesmí se maskovat za nejmenší závažnost');
});

test('při shodné závažnosti jde napřed dřívější', () => {
  const v = pohled({
    warnings: [
      vystraha({ event: 'Pozdější', onset: za(3) }),
      vystraha({ event: 'Dřívější', onset: za(1) }),
    ],
    pokryto: true, filtrovano: true,
  });
  assert.deepEqual(v.polozky.map((p) => p.nadpis), ['Dřívější', 'Pozdější']);
});

test('🚨 prošlá výstraha se nevypisuje', () => {
  // Odpověď je společná všem a drží se v cache celé minuty, takže „už neplatí"
  // se pozná až tady, při výpisu.
  const v = pohled({ warnings: [vystraha({ expires: za(-1) })], pokryto: true, filtrovano: true });
  assert.equal(v.polozky.length, 0);
  assert.equal(v.stav, 'zadne');
});

test('výstraha bez konce platnosti se vypíše, ne zahodí', () => {
  const v = pohled({ warnings: [vystraha({ expires: null })], pokryto: true, filtrovano: true });
  assert.equal(v.polozky.length, 1);
});

test('poškozené datum výstrahu nezahodí ani neshodí', () => {
  const v = pohled({ warnings: [vystraha({ expires: 'nesmysl', onset: 'taky nesmysl' })], pokryto: true, filtrovano: true });
  assert.equal(v.polozky.length, 1);
  assert.equal(v.polozky[0].obdobi, '', 'neznámý čas se přejde mlčky, ale výstraha zůstane');
});

/* ============================================================
   OBDOBÍ PLATNOSTI
   ============================================================ */

test('období: běžící výstraha ukazuje jen konec', () => {
  const v = pohled({ warnings: [vystraha({ onset: za(-2), expires: za(3) })], pokryto: true, filtrovano: true });
  assert.ok(v.polozky[0].obdobi.startsWith('do '), v.polozky[0].obdobi);
});

test('🚨 období: výstraha na zítřek má napsané „zítra" — jednou, ne u konce znovu', () => {
  // 10. 11. 2026 ve 22:00: „Kluzké povrchy 03:00–10:00" se četlo jako dnešek.
  const nowMs = Date.parse('2026-11-10T22:00:00+01:00');
  const w = vystraha({ onset: '2026-11-11T03:00:00+01:00', expires: '2026-11-11T10:00:00+01:00' });
  const payload = { warnings: [w], pokryto: true, filtrovano: true, sent: '2026-11-10T21:00:00+01:00' };
  const cs = buildWarningsView({ payload, lang: 'cs', nowMs }).polozky[0].obdobi;
  assert.match(cs, /^zítra \d{1,2}:\d{2}–\d{1,2}:\d{2}$/, cs);
  const en = buildWarningsView({ payload, lang: 'en', nowMs }).polozky[0].obdobi;
  assert.match(en, /^tomorrow \d{1,2}:\d{2}–\d{1,2}:\d{2}$/, en);
  // Běžící výstraha, která skončí zítra: „do zítra 10:00".
  const bezi = vystraha({ onset: '2026-11-10T20:00:00+01:00', expires: '2026-11-11T10:00:00+01:00' });
  const b = buildWarningsView({ payload: { ...payload, warnings: [bezi] }, lang: 'cs', nowMs }).polozky[0].obdobi;
  assert.match(b, /^do zítra \d{1,2}:\d{2}$/, b);
  // Dnešní zůstává bez dne.
  const dnes = vystraha({ onset: '2026-11-10T23:00:00+01:00', expires: '2026-11-10T23:30:00+01:00' });
  const d = buildWarningsView({ payload: { ...payload, warnings: [dnes] }, lang: 'cs', nowMs }).polozky[0].obdobi;
  assert.match(d, /^\d{1,2}:\d{2}–\d{1,2}:\d{2}$/, d);
});

test('období: budoucí výstraha ukazuje začátek i konec', () => {
  const v = pohled({ warnings: [vystraha({ onset: za(2), expires: za(5) })], pokryto: true, filtrovano: true });
  assert.ok(v.polozky[0].obdobi.includes('–'), v.polozky[0].obdobi);
});

/* ============================================================
   ODOLNOST
   ============================================================ */

test('nesmyslná odpověď nespadne, jen se přizná', () => {
  for (const spatna of [undefined, null, {}, { warnings: null }, 'nesmysl', 42]) {
    const v = buildWarningsView({ payload: spatna, lang: 'cs', nowMs: TEĎ });
    assert.equal(v.stav, 'nedostupne');
    assert.deepEqual(v.polozky, []);
  }
});

test('výstraha bez jména dostane náhradní nadpis', () => {
  const v = pohled({ warnings: [vystraha({ event: null })], pokryto: true, filtrovano: true });
  assert.ok(v.polozky[0].nadpis, 'prázdný nadpis by vypadal jako chyba vykreslení');
});

test('anglický pohled nevrací české texty', () => {
  const payload = { warnings: [], misto: { nazev: 'Litoměřice' }, pokryto: true, filtrovano: true, sent: CERSTVE };
  const en = buildWarningsView({ payload, lang: 'en', nowMs: TEĎ });
  const cs = buildWarningsView({ payload, lang: 'cs', nowMs: TEĎ });

  // ⚠️ Neporovnává se konkrétní věta, ale to, na čem záleží. Test navázaný
  // na formulaci padá při každé úpravě textu, aniž by se cokoli pokazilo —
  // a přesně to se stalo 29. 8. 2026 při přepisu na „aktuálně nemáme".
  assert.notEqual(en.zprava, cs.zprava, 'jazyky se musí lišit');
  assert.ok(/warning/i.test(en.zprava), en.zprava);
  assert.ok(!/výstrah/i.test(en.zprava), en.zprava);
  assert.ok(en.zprava.includes('Litoměřice'), 'jméno místa se nepřekládá');
});

/* ============================================================
   DUPLICITY

   🚨 Zjištěno naživo, ne testem: ČHMÚ vydává tutéž bouřku zvlášť pro každou
   skupinu okresů. Jeden bod tak dostal tři shodné řádky, jinde až sedm.
   ============================================================ */

test('🚨 tatáž výstraha vydaná víckrát se sloučí do jednoho řádku', () => {
  const v = pohled({
    warnings: [
      vystraha({ mista: ['Litoměřice'] }),
      vystraha({ mista: ['Litoměřice'] }),
      vystraha({ mista: ['Louny'] }),
    ],
    pokryto: true, filtrovano: true,
  });
  assert.equal(v.polozky.length, 1, 'tři kopie téhož = jedna položka');
  assert.ok(v.polozky[0].popis.includes('Litoměřice'));
  assert.ok(v.polozky[0].popis.includes('Louny'), 'místa se spojí, ne zahodí');
});

test('slučují se jen opravdu shodné — jiný čas je jiná výstraha', () => {
  const v = pohled({
    warnings: [vystraha({ onset: za(1) }), vystraha({ onset: za(3) })],
    pokryto: true, filtrovano: true,
  });
  assert.equal(v.polozky.length, 2);
});

test('slučují se jen opravdu shodné — jiná závažnost je jiná výstraha', () => {
  const v = pohled({
    warnings: [vystraha({ severity: 'Severe' }), vystraha({ severity: 'Moderate' })],
    pokryto: true, filtrovano: true,
  });
  assert.equal(v.polozky.length, 2);
});

test('🚨 nejistota jedné kopie nezpochybní druhou, přesnou', () => {
  const v = pohled({
    warnings: [vystraha({ presne: false, mista: ['Litoměřice'] }), vystraha({ presne: true })],
    pokryto: true, filtrovano: true,
  });
  assert.equal(v.polozky.length, 1);
  assert.equal(v.polozky[0].nejiste, false, 'jedna spolehlivá kopie stačí');
});

/* ============================================================
   MRTVÝ ZDROJ NENÍ KLID (R20)

   🚨 Michal 31. 8. 2026: nad hlavou bouřka, v appce nic. Výstraha opravdu
   žádná nebyla — ale zároveň se ukázalo, že MeteoAlarm stál TŘI DNY
   a appka to celou dobu vykreslovala jako „nic nehrozí". Prázdný seznam
   a mlčící zdroj vypadají úplně stejně; liší se jen časem vydání.
   ============================================================ */

/* ♻️ 25. 9. 2026 Michal pravidlo obrátil: zastaralá zpráva se NEUKAZUJE
   vůbec — žádné výstrahy, žádná věta, celá karta pryč. *„Prostě ukazovat se
   musí jen aktuální výstrahy."* Mrtvý zdroj se pořád nesmí tvářit jako klid
   (stav není 'zadne'), jen se o něm nemluví. */

test('🚨 zastaralý zdroj se NESMÍ tvářit jako klid — a nic se neukáže', () => {
  const tridny = new Date(TEĎ - 3 * 24 * 3600_000).toISOString();
  const v = pohled({ warnings: [], misto: { nazev: 'Litoměřice' }, pokryto: true, filtrovano: true, sent: tridny });
  assert.equal(v.stav, 'zastaralé');
  assert.notEqual(v.stav, 'zadne', 'tři dny staré ticho není klid');
  assert.equal(v.zprava, '', 'žádná věta — karta se schová celá');
  assert.deepEqual(v.polozky, []);
});

test('🚨 hranice je 12 hodin u výstrahy BEZ KONCE: 11 h se ukáže, 13 h už ne', () => {
  // ♻️ R46: s koncem platí do konce (test níž). Bez konce nevíme, jestli
  // ještě platí, a tam 12 hodin zůstává.
  const w = [vystraha({ event: 'Bouřky', expires: null })];
  const za = (h) => new Date(TEĎ - h * 3600_000).toISOString();
  assert.equal(pohled({ warnings: w, misto: { nazev: 'Litoměřice' }, pokryto: true, filtrovano: true, sent: za(11) }).stav, 'vystrahy');
  assert.equal(pohled({ warnings: w, misto: { nazev: 'Litoměřice' }, pokryto: true, filtrovano: true, sent: za(13) }).stav, 'zastaralé');
});

test('čerstvý zdroj, který mlčí, klid ANO', () => {
  const v = pohled({ warnings: [], misto: { nazev: 'Litoměřice' }, pokryto: true, filtrovano: true });
  assert.equal(v.stav, 'zadne');
});

test('🚨 chybějící čas vydání se bere jako nevíme, ne jako klid', () => {
  // Nula by tvrdila, že zpráva právě přišla — tedy pravý opak pravdy.
  const v = buildWarningsView({ payload: { warnings: [], pokryto: true, filtrovano: true }, lang: 'cs', nowMs: TEĎ });
  assert.equal(v.stav, 'zastaralé');
});

test('zastaralá zpráva: výstraha BEZ konce se neukáže, prošlá taky ne', () => {
  // 25. 9. 2026: zastaralost přebíjí výstrahy. ♻️ R46 to zúžil na ty, u
  // kterých nevíme, jestli ještě platí.
  const tridny = new Date(TEĎ - 3 * 24 * 3600_000).toISOString();
  const v = pohled({ warnings: [vystraha({ event: 'Bouřky', expires: null }), vystraha({ event: 'Vítr', expires: za(-1) })],
    misto: { nazev: 'Litoměřice' }, pokryto: true, filtrovano: true, sent: tridny });
  assert.equal(v.stav, 'zastaralé');
  assert.deepEqual(v.polozky, []);
});

test('🚨 R46: výstraha na zítřek platí do svého konce, i když je zpráva starší 12 h', () => {
  // 10. 11. 2026: ČHMÚ vydal v 10:34 „Velmi kluzké povrchy" na 11. 11. 3:00–10:00
  // a další zprávu do večera nevydal. Ve 22:34 by výstraha zmizela, ještě
  // než začala. Miki: „ty se přece přemažou, až po tom co ta výstrahová
  // událost proběhne".
  const sent = '2026-11-10T10:34:05+01:00';
  const led = vystraha({ event: 'Velmi kluzké povrchy', severity: 'Severe',
    onset: '2026-11-11T03:00:00+01:00', expires: '2026-11-11T10:00:00+01:00' });
  const payload = { warnings: [led], misto: { nazev: 'Domažlice' }, pokryto: true, filtrovano: true, sent };
  for (const kdy of ['2026-11-10T23:30:00+01:00', '2026-11-11T05:00:00+01:00', '2026-11-11T09:59:00+01:00']) {
    const v = buildWarningsView({ payload, lang: 'cs', nowMs: Date.parse(kdy) });
    assert.equal(v.stav, 'vystrahy', kdy);
    assert.equal(v.polozky[0].nadpis, 'Velmi kluzké povrchy', kdy);
    assert.match(v.polozky[0].vydano, /^Vydáno před \d+ hodinami \(\d{1,2}:\d{2}\)$/, kdy);
  }
  // Po skončení události zmizí — a karta jde pryč celá.
  const po = buildWarningsView({ payload, lang: 'cs', nowMs: Date.parse('2026-11-11T10:01:00+01:00') });
  assert.equal(po.stav, 'zastaralé');
  assert.deepEqual(po.polozky, []);
});

test('🚨 u každé výstrahy je VŽDYCKY napsané, jak je stará', () => {
  const pred3h = new Date(TEĎ - (3 * 60 + 50) * 60_000).toISOString();
  const v = pohled({ warnings: [vystraha({ event: 'Bouřky' }), vystraha({ event: 'Vítr', severity: 'Minor' })],
    misto: { nazev: 'Litoměřice' }, pokryto: true, filtrovano: true, sent: pred3h });
  assert.equal(v.polozky.length, 2);
  for (const p of v.polozky) {
    // Zaokrouhluje se DOLŮ: 3 h 50 min je „před 3 hodinami", ne „před 4".
    assert.match(p.vydano, /^Vydáno před 3 hodinami \(\d{1,2}:\d{2}\)$/, p.vydano);
  }
  const pred20min = new Date(TEĎ - 20 * 60_000).toISOString();
  const m = pohled({ warnings: [vystraha({ event: 'Bouřky' })], misto: { nazev: 'Litoměřice' }, pokryto: true, filtrovano: true, sent: pred20min });
  assert.match(m.polozky[0].vydano, /^Vydáno před 20 minutami/, m.polozky[0].vydano);
  const en = buildWarningsView({ payload: { warnings: [vystraha({ event: 'Storm' })], pokryto: true, filtrovano: true, sent: pred3h }, lang: 'en', nowMs: TEĎ });
  assert.match(en.polozky[0].vydano, /^Issued 3 hours ago/, en.polozky[0].vydano);
});

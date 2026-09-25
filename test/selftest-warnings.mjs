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

test('🚨 hranice je 12 hodin: 11 h se ukáže, 13 h už ne', () => {
  const w = [vystraha({ event: 'Bouřky' })];
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

test('🚨 zastaralost PŘEBIJE i výstrahy, které ve zprávě jsou (25. 9. 2026)', () => {
  // ♻️ Do 25. 9. platil opak („zastaralost nepřebije platné výstrahy").
  // Zpráva stará tři dny neříká nic o tom, co platí dnes.
  const tridny = new Date(TEĎ - 3 * 24 * 3600_000).toISOString();
  const v = pohled({ warnings: [vystraha({ event: 'Bouřky' })], misto: { nazev: 'Litoměřice' }, pokryto: true, filtrovano: true, sent: tridny });
  assert.equal(v.stav, 'zastaralé');
  assert.deepEqual(v.polozky, []);
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

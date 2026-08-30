/**
 * Samotest: kdy o výstraze upozornit.
 *
 * Vyrušit člověka je nevratná věc — notifikace se nedá vzít zpátky a ta,
 * která otravuje, skončí vypnutá i pro případ, kdy o něco jde. Rozhodování
 * proto sedí v čistém modulu a ověřuje se tady, ne až v telefonu.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  noveVystrahy, textUpozorneni, staciNa, vystrahySkoncily, VYCHOZI_PRAH,
} from '../web/lib/warn-notify.js';

const TEĎ = Date.parse('2026-08-29T12:00:00Z');
const ZA_HODINU = '2026-08-29T13:00:00Z';
const PŘED_HODINOU = '2026-08-29T11:00:00Z';

const v = (zmeny = {}) => ({
  id: 'bourka|Severe|a|b|6100',
  event: 'Silné bouřky',
  severity: 'Severe',
  expires: ZA_HODINU,
  ...zmeny,
});

/* ── práh závažnosti ──────────────────────────────────────────────────── */

test('výchozí práh pouští Moderate a výš, mlčí u Minor', () => {
  // ČHMÚ vydává nízké stupně skoro obden. Kdo dostane upozornění na riziko
  // požárů třikrát týdně, vypne si je — a nedostane ani tu bouřku.
  assert.equal(VYCHOZI_PRAH, 'Moderate');
  assert.ok(staciNa('Extreme'));
  assert.ok(staciNa('Severe'));
  assert.ok(staciNa('Moderate'));
  assert.ok(!staciNa('Minor'));
});

test('🚨 neznámá závažnost propadne VŽDYCKY', () => {
  // Neznámá závažnost není nízká závažnost. Zahodit ji tiše by znamenalo
  // mlčet právě tam, kde nevíme, oč jde.
  assert.ok(staciNa('Unknown'));
  assert.ok(staciNa(''));
  assert.ok(staciNa(undefined));
  assert.ok(staciNa('Naprosto neznámý stupeň'));
});

test('🚨 nesmyslný práh nesmí umlčet všechno', () => {
  // Pokažená hodnota v nastavení by jinak vypnula upozornění potichu —
  // a to je ten nejhorší způsob, jak přijít o výstrahu.
  assert.ok(staciNa('Severe', 'nesmysl'));
  assert.ok(staciNa('Minor', 'nesmysl'));
});

test('práh se dá zvednout i snížit', () => {
  assert.ok(!staciNa('Moderate', 'Severe'));
  assert.ok(staciNa('Severe', 'Severe'));
  assert.ok(staciNa('Minor', 'Minor'));
});

/* ── co je nové ───────────────────────────────────────────────────────── */

test('nová výstraha se ohlásí, známá mlčí', () => {
  const prvni = noveVystrahy({ warnings: [v()], nowMs: TEĎ });
  assert.equal(prvni.nove.length, 1);

  const druha = noveVystrahy({ warnings: [v()], jizOznameno: prvni.klice, nowMs: TEĎ });
  assert.equal(druha.nove.length, 0, 'podruhé se o téže věci nezvoní');
});

test('🚨 prošlá výstraha se neohlásí ani poprvé', () => {
  const out = noveVystrahy({ warnings: [v({ expires: PŘED_HODINOU })], nowMs: TEĎ });
  assert.equal(out.nove.length, 0);
  assert.equal(out.klice.length, 0, 'a nemá co dělat ani v paměti');
});

test('výstraha bez konce platnosti se ohlásí — nezahazuje se', () => {
  const out = noveVystrahy({ warnings: [v({ expires: null })], nowMs: TEĎ });
  assert.equal(out.nove.length, 1);
});

test('výstraha bez totožnosti se přeskočí, nespadne', () => {
  // Bez klíče by se o ní zvonilo při každé kontrole dokola.
  const out = noveVystrahy({ warnings: [v({ id: undefined }), v()], nowMs: TEĎ });
  assert.equal(out.nove.length, 1);
});

test('🚨 pamatují se i výstrahy POD prahem', () => {
  // Jinak by zvednutí prahu v nastavení zazvonilo na dávno běžící drobnosti
  // jako na novinky.
  const out = noveVystrahy({ warnings: [v({ id: 'x', severity: 'Minor' })], nowMs: TEĎ });
  assert.equal(out.nove.length, 0, 'nezvoní se');
  assert.deepEqual(out.klice, ['x'], 'ale ví se o ní');
});

test('🚨 z paměti se prošlé pouštějí — a znovuvydaná výstraha se ozve', () => {
  // Seznam klíčů jinak roste donekonečna. A když tatáž situace nastane
  // znovu, je to nová situace, ne opakování.
  const bezi = noveVystrahy({ warnings: [v()], nowMs: TEĎ });
  const prosla = noveVystrahy({
    warnings: [v({ expires: PŘED_HODINOU })], jizOznameno: bezi.klice, nowMs: TEĎ,
  });
  assert.deepEqual(prosla.klice, [], 'zapomene se');

  const znovu = noveVystrahy({ warnings: [v()], jizOznameno: prosla.klice, nowMs: TEĎ });
  assert.equal(znovu.nove.length, 1);
});

test('prázdno a nesmysly nespadnou', () => {
  for (const w of [[], null, undefined, [null], [{}]]) {
    const out = noveVystrahy({ warnings: w, nowMs: TEĎ });
    assert.equal(out.nove.length, 0);
  }
});

/* ── text ─────────────────────────────────────────────────────────────── */

test('jedna výstraha: v nadpisu místo, v těle jev', () => {
  const out = textUpozorneni({ nove: [v()], misto: 'Horšovský Týn', lang: 'cs' });
  assert.ok(out.nadpis.includes('Horšovský Týn'), out.nadpis);
  assert.equal(out.telo, 'Silné bouřky');
});

test('🚨 i u víc výstrah se první POJMENUJE', () => {
  // „2 výstrahy" bez jediného jména nutí otevřít appku jen proto, aby se
  // člověk dozvěděl, jestli má odklidit trampolínu.
  const out = textUpozorneni({
    nove: [v(), v({ id: 'b', event: 'Vysoké teploty' })], misto: 'Praha', lang: 'cs',
  });
  assert.ok(out.telo.includes('Silné bouřky'), out.telo);
  assert.ok(/1/.test(out.telo), out.telo);
});

test('🚨 zbytek je „+N", ne věta — a je to schválně', () => {
  // Větu by musel umět složit i androidí obal, který běží, když appka
  // neběží. Množné číslo je ale vlastnost jazyka APPKY, ne telefonu —
  // v obalu by z české appky vyšla anglická notifikace. „+2" rozumí každý.
  const mnoho = (n) => textUpozorneni({
    nove: Array.from({ length: n }, (_, i) => v({ id: `x${i}`, event: 'Bouřky' })),
    misto: 'Praha', lang: 'cs',
  }).telo;
  assert.equal(mnoho(1), 'Bouřky');
  assert.equal(mnoho(3), 'Bouřky +2');

  // A obě cesty musí říkat totéž — jinak by appka a notifikace tvrdily
  // každá něco jiného o téže situaci.
  assert.equal(mnoho(3), textUpozorneni({
    nove: Array.from({ length: 3 }, (_, i) => v({ id: `y${i}`, event: 'Bouřky' })),
    misto: 'Praha', lang: 'en',
  }).telo, 'tělo je jazykově neutrální');
});

test('bez místa se nadpis nezlomí', () => {
  const out = textUpozorneni({ nove: [v()], lang: 'cs' });
  assert.ok(out.nadpis.length > 0);
  assert.ok(!out.nadpis.includes('{'), 'nedosazená šablona by byla vidět');
});

test('🚨 v nadpisu není značka appky', () => {
  // Na zamčeném displeji je vidět jeden řádek. „MeteoTrace" o nebezpečí
  // neřekne nic — tam patří závažnost a místo.
  const out = textUpozorneni({ nove: [v()], misto: 'Brno', lang: 'cs' });
  assert.ok(!/meteotrace/i.test(out.nadpis), out.nadpis);
});

test('výstraha bez jména dostane náhradní nadpis, ne prázdno', () => {
  const out = textUpozorneni({ nove: [v({ event: null })], misto: 'Brno', lang: 'cs' });
  assert.ok(out.telo.length > 0);
});

test('nic nového = žádné upozornění', () => {
  assert.equal(textUpozorneni({ nove: [], misto: 'Brno' }), null);
  assert.equal(textUpozorneni({}), null);
});

test('anglicky to není česky', () => {
  const en = textUpozorneni({ nove: [v(), v({ id: 'b' })], misto: 'Brno', lang: 'en' });
  const cs = textUpozorneni({ nove: [v(), v({ id: 'b' })], misto: 'Brno', lang: 'cs' });
  assert.notEqual(en.nadpis, cs.nadpis);
  assert.ok(!/výstrah/i.test(en.telo), en.telo);
});

/* ── konec výstrah ────────────────────────────────────────────────────── */

test('konec výstrah se pozná: bylo, a teď je doložené ticho', () => {
  assert.equal(vystrahySkoncily({ stav: 'zadne', jizOznameno: ['a'] }), true);
});

test('🚨 „nepodařilo se načíst" NENÍ konec výstrah', () => {
  // Prázdný seznam mají i výpadek a nepokrytá oblast. Oznámit na ně
  // „už je po všem" by byla nepravda v tom nejhorším možném okamžiku:
  // člověk by přestal být ve střehu, protože appka mlčí.
  assert.equal(vystrahySkoncily({ stav: 'nedostupne', jizOznameno: ['a'] }), false);
  assert.equal(vystrahySkoncily({ stav: 'mimo', jizOznameno: ['a'] }), false);
  assert.equal(vystrahySkoncily({ stav: 'nejiste', jizOznameno: ['a'] }), false);
});

test('🚨 kdo výstrahu nezažil, nedostane zprávu o jejím konci', () => {
  // Kdo appku otevře poprvé za hezkého dne, nemá dostat radostnou zprávu
  // o konci něčeho, co nikdy neviděl.
  assert.equal(vystrahySkoncily({ stav: 'zadne', jizOznameno: [] }), false);
  assert.equal(vystrahySkoncily({ stav: 'zadne' }), false);
});

test('výstrahy trvají dál — nic se neoznamuje', () => {
  assert.equal(vystrahySkoncily({ stav: 'vystrahy', jizOznameno: ['a'] }), false);
});

test('nesmyslný vstup nespadne', () => {
  assert.equal(vystrahySkoncily(), false);
  assert.equal(vystrahySkoncily({}), false);
});

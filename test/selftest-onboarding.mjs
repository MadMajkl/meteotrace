/**
 * Samotest: uvítání při prvním spuštění.
 *
 * 🚨 Tady se rozhoduje, komu se appka postaví do cesty. Uvítání, které
 * vyskočí nesprávnému člověku nebo se nedá opustit, je horší než žádné —
 * z první minuty s appkou udělá překážku. A první minuta se neopakuje.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { maSeSpustit, createOnboarding, KROKY } from '../web/lib/onboarding.js';
import { t } from '../web/lib/i18n.js';

/* ── komu se ukáže ────────────────────────────────────────────────────── */

test('nováčkovi se uvítání ukáže', () => {
  assert.equal(maSeSpustit({ hotovo: false, pocetMist: 0 }), true);
  assert.equal(maSeSpustit({}), true, 'chybějící údaje = nováček');
});

test('🚨 kdo uvítáním prošel, toho už nikdy neotravuje', () => {
  // Ani když si mezitím smaže všechna místa. Uvítání je jednorázová
  // událost, ne reakce na prázdný seznam.
  assert.equal(maSeSpustit({ hotovo: true, pocetMist: 0 }), false);
  assert.equal(maSeSpustit({ hotovo: true, pocetMist: 5 }), false);
});

test('🚨 kdo appku už používá, uvítání nedostane', () => {
  // Kdyby se úložiště v novější verzi jednou pročistilo, přišel by
  // uživatel o obrazovku, na kterou je zvyklý — a to kvůli funkci,
  // která má pomáhat nováčkům.
  assert.equal(maSeSpustit({ hotovo: false, pocetMist: 3 }), false);
});

/* ── průchod ──────────────────────────────────────────────────────────── */

test('bez cíle se krok s trasou vynechá', () => {
  // Trasa z domova nikam by byla prázdná obrazovka s vysvětlením,
  // které se nevztahuje k ničemu na ní.
  const o = createOnboarding({ maCil: false });
  const klice = [];
  while (o.krok) { klice.push(o.krok.klic); o.dalsi(); }
  assert.deepEqual(klice, ['domov', 'cil', 'misto']);
});

test('s cílem se projdou všechny čtyři', () => {
  const o = createOnboarding({ maCil: true });
  const klice = [];
  while (o.krok) { klice.push(o.krok.klic); o.dalsi(); }
  assert.deepEqual(klice, ['domov', 'cil', 'misto', 'trasa']);
});

test('🚨 výběr cíle mění počet kroků ZA BĚHU', () => {
  // Cíl se vybírá až ve druhém kroku, takže se na začátku neví, kolik
  // kroků průchod bude mít. Tečky pod obrazovkou to musí unést.
  const o = createOnboarding({ maCil: false });
  assert.equal(o.poradi.celkem, 3);
  o.nastavCil(true);
  assert.equal(o.poradi.celkem, 4);
  o.nastavCil(false);
  assert.equal(o.poradi.celkem, 3, 'a zpátky taky');
});

test('pořadí se počítá od jedné, ne od nuly', () => {
  // Do „krok 1 ze 4" — člověk nepočítá od nuly.
  const o = createOnboarding({ maCil: true });
  assert.deepEqual(o.poradi, { kolikaty: 1, celkem: 4 });
  o.dalsi();
  assert.deepEqual(o.poradi, { kolikaty: 2, celkem: 4 });
});

test('zpět funguje a pod první krok nespadne', () => {
  const o = createOnboarding({ maCil: true });
  o.dalsi(); o.dalsi();
  assert.equal(o.krok.klic, 'misto');
  o.zpet();
  assert.equal(o.krok.klic, 'cil');
  o.zpet(); o.zpet(); o.zpet();
  assert.equal(o.krok.klic, 'domov', 'první krok je první');
});

test('🚨 uvítání jde kdykoli opustit', () => {
  // Někdo si appku otevře v obchodě, někdo ji chce jen omrknout.
  // Uvítání, ze kterého se nedá utéct, je past.
  for (let kde = 0; kde < 3; kde += 1) {
    const o = createOnboarding({ maCil: true });
    for (let i = 0; i < kde; i += 1) o.dalsi();
    o.ukonci();
    assert.equal(o.hotovo, true, `ukončení z kroku ${kde + 1}`);
    assert.equal(o.krok, null);
  }
});

test('projití až na konec skončí, ne přeteče', () => {
  const o = createOnboarding({ maCil: true });
  for (let i = 0; i < 20; i += 1) o.dalsi();
  assert.equal(o.krok, null);
  assert.equal(o.hotovo, true);
});

/* ── vlastnosti kroků ─────────────────────────────────────────────────── */

test('🚨 poslední dva kroky ukazují ŽIVOU APPKU, ne obrázky', () => {
  // Snímek obrazovky v uvítání se za měsíc rozejde s tím, co appka
  // doopravdy dělá — a nikdo si toho nevšimne, protože uvítání nikdo
  // znovu neotevře. Živá appka zastarat nemůže.
  const misto = KROKY.find((k) => k.klic === 'misto');
  const trasa = KROKY.find((k) => k.klic === 'trasa');
  assert.equal(misto.zivaAppka, true);
  assert.equal(trasa.zivaAppka, true);
});

test('krok s cílem jde přeskočit zvlášť', () => {
  // Spousta lidí chce meteostanici pro jedno místo a trasy je nezajímají.
  const cil = KROKY.find((k) => k.klic === 'cil');
  assert.equal(cil.lzePreskocit, true);
  const domov = KROKY.find((k) => k.klic === 'domov');
  assert.ok(!domov.lzePreskocit, 'bez domova by uvítání nemělo co ukázat');
});

test('každý krok má klíč, a klíče se neopakují', () => {
  // Klíč je zároveň jméno překladu — dva stejné by znamenaly, že jeden
  // krok mluví textem druhého.
  const klice = KROKY.map((k) => k.klic);
  assert.equal(new Set(klice).size, klice.length);
  for (const k of klice) assert.ok(k && typeof k === 'string');
});

/* ── napojení na překlady ─────────────────────────────────────────────── */

test('🚨 každý krok má překlady, které opravdu existují', () => {
  // Chytlo se to až v prohlížeči: kroky mají české klíče pro logiku,
  // ale i18n klíče jsou anglické, takže se místo textů ukazovalo
  // „onboarding.domovTitle". Tenhle test to najde bez prohlížeče.
  for (const k of KROKY) {
    assert.ok(k.text, `krok ${k.klic} nemá předponu překladu`);
    assert.ok(/^[a-z]+$/.test(k.text), `předpona ${k.text} má být holé anglické slovo`);
    for (const jazyk of ['cs', 'en']) {
      const nadpis = t(`onboarding.${k.text}Title`, jazyk);
      const text = t(`onboarding.${k.text}Text`, jazyk);
      assert.notEqual(nadpis, `onboarding.${k.text}Title`, `${jazyk}: chybí nadpis ${k.text}`);
      assert.notEqual(text, `onboarding.${k.text}Text`, `${jazyk}: chybí text ${k.text}`);
    }
  }
});

test('kroky s hledáním mají i popisek pole', () => {
  for (const k of KROKY.filter((x) => x.potrebujeVyber)) {
    for (const jazyk of ['cs', 'en']) {
      const p = t(`onboarding.${k.text}Label`, jazyk);
      assert.notEqual(p, `onboarding.${k.text}Label`, `${jazyk}: chybí popisek ${k.text}`);
    }
  }
});

test('🚨 klíč pro logiku a předpona překladu se nepletou', () => {
  // Kdyby se to sloučilo do jednoho pole, buď by logika mluvila anglicky,
  // nebo by i18n klíče byly české — a jedno z pravidel projektu by padlo.
  for (const k of KROKY) assert.notEqual(k.klic, k.text);
});

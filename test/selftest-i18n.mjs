/**
 * Samotest lokalizace, jednotek a kódů počasí — bez prohlížeče a bez sítě.
 *
 * 🚨 PARITA JE POVINNÁ BRÁNA. Po každém zásahu do překladů musí tenhle test
 *    projít. Chybějící klíč znamená díru v UI, na kterou se přijde až u toho,
 *    kdo tím jazykem mluví — tedy nejpozději.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  LANGS, LANG_NAMES, REFERENCE, tp, checkPlurals,
  detectLang, t, tf, keyPaths, checkLang, checkAllLangs,
} from '../web/lib/i18n.js';
import {
  METRIC, IMPERIAL, defaultUnits, convert, windDirKey,
  formatTemp, formatWind, formatPrecip, formatDistance, formatDuration,
} from '../web/lib/units.js';
import { weatherKey, weatherIcon, isHazard, WEATHER_KEYS } from '../web/lib/weather-code.js';

/* ============================================================
   PARITA PŘEKLADŮ
   ============================================================ */

test('🚨 parita: každý jazyk má všechny klíče referenčního', () => {
  for (const r of checkAllLangs()) {
    assert.deepEqual(r.missing, [], `${r.lang}: chybí klíče ${r.missing.join(', ')}`);
  }
});

test('🚨 parita: žádný jazyk nemá klíč navíc', () => {
  // Přebývající klíč není neškodný — obvykle je to překlep, kvůli kterému
  // někde jinde text chybí.
  for (const r of checkAllLangs()) {
    assert.deepEqual(r.extra, [], `${r.lang}: klíče navíc ${r.extra.join(', ')}`);
  }
});

test('🚨 parita: žádný text není prázdný', () => {
  // Prázdný text projde kontrolou klíčů, ale v UI je to stejná díra.
  for (const lang of Object.keys(LANGS)) {
    assert.deepEqual(checkLang(lang).empty, [], `${lang}: prázdné texty`);
  }
});

test('parita: referenční jazyk existuje a je to angličtina', () => {
  assert.equal(REFERENCE, 'en');
  assert.ok(LANGS[REFERENCE], 'referenční jazyk musí být v rejstříku');
});

test('parita: každý jazyk v rejstříku má své jméno', () => {
  for (const lang of Object.keys(LANGS)) {
    assert.ok(LANG_NAMES[lang], `${lang}: chybí endonym v LANG_NAMES`);
  }
  assert.deepEqual(Object.keys(LANGS).sort(), Object.keys(LANG_NAMES).sort());
});

test('🚨 parita: každý kód počasí má překlad ve všech jazycích', () => {
  // Kódy vznikají v `weather-code.js`, texty v jazycích — snadno se rozejdou.
  for (const lang of Object.keys(LANGS)) {
    for (const key of WEATHER_KEYS) {
      const text = t(`weather.${key}`, lang);
      assert.notEqual(text, `weather.${key}`, `${lang}: chybí překlad pro ${key}`);
    }
  }
});

test('🚨 parita: každá světová strana má překlad', () => {
  const dirs = new Set();
  for (let d = 0; d < 360; d += 5) dirs.add(windDirKey(d));
  for (const lang of Object.keys(LANGS)) {
    for (const dir of dirs) {
      assert.notEqual(t(`windDir.${dir}`, lang), `windDir.${dir}`, `${lang}: chybí ${dir}`);
    }
  }
});

test('parita: zástupné texty se v překladu neztratily', () => {
  // Když v angličtině je {time}, musí být i v češtině — jinak by uživatel
  // dostal větu bez údaje a nikdo by nevěděl proč.
  const withParams = keyPaths(LANGS[REFERENCE])
    .filter((p) => /\{\w+\}/.test(t(p, REFERENCE)));
  assert.ok(withParams.length > 0, 'test by měl něco kontrolovat');

  for (const lang of Object.keys(LANGS)) {
    for (const path of withParams) {
      const wanted = (t(path, REFERENCE).match(/\{\w+\}/g) || []).sort();
      const got = (t(path, lang).match(/\{\w+\}/g) || []).sort();
      assert.deepEqual(got, wanted, `${lang} / ${path}: nesedí zástupné texty`);
    }
  }
});

/* ============================================================
   MECHANIKA
   ============================================================ */

test('překlad: najde text podle tečkové cesty', () => {
  assert.equal(t('now.feelsLike', 'cs'), 'Pocitově');
  assert.equal(t('now.feelsLike', 'en'), 'Feels like');
});

test('překlad: neznámý jazyk spadne na referenční', () => {
  // Prázdné UI je horší než cizí jazyk.
  assert.equal(t('now.wind', 'klingonsky'), t('now.wind', 'en'));
});

test('🚨 překlad: chybějící klíč vrátí cestu, ne prázdno', () => {
  // Prázdné místo v UI si nikdo nespojí s chybějícím překladem
  // a vada se nikdy neopraví. Cesta je ošklivá tak, že si jí všimne každý.
  assert.equal(t('neco.co.neexistuje', 'cs'), 'neco.co.neexistuje');
});

test('🚨 překlad: dědičnost objektu se nevydává za klíč', () => {
  // `'toString' in obj` je true u každého objektu — kdyby se hledalo přes `in`,
  // vrátila by se funkce místo textu.
  assert.equal(t('toString', 'cs'), 'toString');
  assert.equal(t('constructor.name', 'cs'), 'constructor.name');
});

test('dosazení: nahradí zástupné texty', () => {
  assert.equal(tf('now.updated', { time: '14:20' }, 'cs'), 'Aktualizováno 14:20');
});

test('dosazení: nedosazený zástupný text zůstane vidět', () => {
  assert.match(tf('now.updated', {}, 'cs'), /\{time\}/);
});

test('odhad jazyka: vezme část před pomlčkou', () => {
  assert.equal(detectLang(['cs-CZ']), 'cs');
  assert.equal(detectLang(['en-US', 'cs']), 'en');
  assert.equal(detectLang(['de-DE', 'cs-CZ']), 'cs', 'přeskočí neznámý a vezme další');
  assert.equal(detectLang([]), 'en');
  assert.equal(detectLang(['klingon']), 'en');
});

/* ============================================================
   JEDNOTKY
   ============================================================ */

test('🚨 jednotky: soustava se řídí ZEMÍ, ne jazykem', () => {
  // en-GB a en-US mluví týmž jazykem a měří jinak.
  assert.equal(defaultUnits('en-US').temp, 'f');
  assert.equal(defaultUnits('en-GB').temp, 'c');
  assert.equal(defaultUnits('en-GB').distance, 'mi', 'Brit jezdí míle');
  assert.equal(defaultUnits('cs-CZ').temp, 'c');
});

test('jednotky: neznámá země je metrická', () => {
  assert.deepEqual(defaultUnits('en'), METRIC);
  assert.deepEqual(defaultUnits(''), METRIC);
  assert.deepEqual(defaultUnits(), METRIC);
});

test('převody: teplota', () => {
  assert.equal(convert.temp(0, 'c'), 0);
  assert.equal(convert.temp(0, 'f'), 32);
  assert.equal(convert.temp(100, 'f'), 212);
  assert.equal(convert.temp(-40, 'f'), -40, 'jediný bod, kde se stupnice potkají');
});

test('převody: vítr', () => {
  assert.equal(convert.wind(36, 'ms'), 10);
  assert.ok(Math.abs(convert.wind(100, 'mph') - 62.14) < 0.01);
  assert.equal(convert.wind(50, 'kmh'), 50);
});

test('převody: srážky a vzdálenost', () => {
  assert.equal(convert.precip(25.4, 'in'), 1);
  assert.equal(convert.distance(1000, 'km'), 1);
  assert.ok(Math.abs(convert.distance(1609.344, 'mi') - 1) < 1e-9);
});

test('🚨 převody: chybějící hodnota nesmí být nula', () => {
  // Nula je v zimě věrohodná teplota — kdyby chybějící data spadla na nulu,
  // nikdo by si nevšiml, že chybí.
  for (const fn of ['temp', 'wind', 'precip', 'distance']) {
    assert.equal(convert[fn](null, 'c'), null);
    assert.equal(convert[fn](undefined, 'c'), null);
    assert.equal(convert[fn](NaN, 'c'), null);
  }
});

test('formát: chybějící hodnota se ukáže jako pomlčka', () => {
  assert.equal(formatTemp(null, METRIC, 'cs'), '—');
  assert.equal(formatWind(null, METRIC, 'cs'), '—');
  assert.equal(formatPrecip(null, METRIC, 'cs'), '—');
  assert.equal(formatDistance(null, METRIC, 'cs'), '—');
});

test('🚨 formát: číslo se řídí jazykem, hodnota jednotkou', () => {
  // Čech chce desetinnou čárku i u Fahrenheita.
  const cs = formatTemp(21.5, { ...IMPERIAL }, 'cs', 1);
  assert.match(cs, /,/, 'čeština má desetinnou čárku');
  assert.match(cs, /°F/);
  assert.match(formatTemp(21.5, { ...IMPERIAL }, 'en', 1), /\./);
});

test('🚨 formát: záporná nula se ukáže jako nula', () => {
  // „−0 °C" je matematicky správně, ale v appce vypadá jako chyba.
  // Zaokrouhlovat se musí na tolik míst, kolik se vypíše — na tomhle
  // test poprvé spadl (kontrolovalo se jedno místo napevno, ale Intl
  // pak zaokrouhlil znovu a −0,2 se vypsalo jako „-0").
  const minus = /^[-−]/;
  for (const locale of ['cs', 'en']) {
    assert.ok(!minus.test(formatTemp(-0.2, METRIC, locale, 0)), `${locale}: -0,2 → nula bez znaménka`);
    assert.ok(!minus.test(formatTemp(-0.04, METRIC, locale, 1)), `${locale}: -0,04 na 1 místo`);
    // Skutečná záporná teplota si znaménko ponechat MUSÍ.
    assert.ok(minus.test(formatTemp(-0.6, METRIC, locale, 0)), `${locale}: -0,6 zůstává záporná`);
    assert.ok(minus.test(formatTemp(-12, METRIC, locale, 0)), `${locale}: -12 zůstává záporná`);
  }
});

test('formát: palce mají dvě desetinná místa', () => {
  // S jedním by slabý déšť vyšel jako 0,0 a vypadal jako sucho.
  assert.match(formatPrecip(1.2, { precip: 'in' }, 'en'), /0\.05/);
  assert.match(formatPrecip(1.2, { precip: 'mm' }, 'en'), /1\.2/);
});

test('formát: trvání', () => {
  const l = { min: 'min', hour: 'h' };
  assert.equal(formatDuration(600, 'cs', l), '10 min');
  assert.equal(formatDuration(3600, 'cs', l), '1 h');
  assert.equal(formatDuration(5400, 'cs', l), '1 h 30 min');
  assert.equal(formatDuration(null, 'cs', l), '—');
});

test('směr větru: 350° je sever, ne severoseverozápad', () => {
  // Bez posunu o půl dílku by hranice padla špatně.
  assert.equal(windDirKey(0), 'n');
  assert.equal(windDirKey(350), 'n');
  assert.equal(windDirKey(11), 'n');
  assert.equal(windDirKey(12), 'nne');
  assert.equal(windDirKey(90), 'e');
  assert.equal(windDirKey(180), 's');
  assert.equal(windDirKey(270), 'w');
});

test('směr větru: zvládne i hodnoty mimo rozsah', () => {
  assert.equal(windDirKey(720), 'n');
  assert.equal(windDirKey(-90), 'w');
  assert.equal(windDirKey(null), null);
});

/* ============================================================
   KÓDY POČASÍ
   ============================================================ */

test('kódy: známé kódy se přeloží na klíč', () => {
  assert.equal(weatherKey(0), 'clear');
  assert.equal(weatherKey(3), 'overcast');
  assert.equal(weatherKey(65), 'heavyRain');
  assert.equal(weatherKey(95), 'thunderstorm');
  assert.equal(weatherKey(99), 'hailstorm');
});

test('🚨 kódy: neznámý kód se netváří jako jasno', () => {
  // Číselník se může rozšířit. Appka, která mlčky hlásí slunce, je horší
  // než ta, co přizná, že neví.
  assert.equal(weatherKey(999), 'unknown');
  assert.equal(weatherKey(-1), 'unknown');
  assert.equal(weatherKey(null), 'unknown');
  assert.equal(weatherKey(1.5), 'unknown');
});

test('kódy: ikona se liší dnem a nocí jen tam, kde to dává smysl', () => {
  assert.notEqual(weatherIcon(0, true), weatherIcon(0, false), 'jasno: slunce vs měsíc');
  assert.equal(weatherIcon(3, true), weatherIcon(3, false), 'zataženo je v noci stejné');
});

test('kódy: nebezpečné jevy se poznají', () => {
  assert.equal(isHazard(95), true, 'bouřka');
  assert.equal(isHazard(66), true, 'mrznoucí déšť');
  assert.equal(isHazard(75), true, 'vydatné sněžení');
  assert.equal(isHazard(0), false, 'jasno');
  assert.equal(isHazard(51), false, 'mrholení nikoho neohrozí');
});

test('🚨 kódy: slabý mrznoucí déšť je taky nebezpečí', () => {
  // Náledí je nebezpečnější než vydatný déšť, i když ho spadne míň.
  assert.equal(isHazard(56), true);
});

test('kódy: seznam klíčů pro paritní test je úplný', () => {
  const fromCodes = new Set();
  for (let c = 0; c <= 99; c++) fromCodes.add(weatherKey(c));
  for (const key of fromCodes) {
    assert.ok(WEATHER_KEYS.includes(key), `${key} chybí ve WEATHER_KEYS`);
  }
});

/* ============================================================
   🚨 DVAKRÁT ZAPSANÝ ODDÍL

   Objekt v JS bere poslední zápis a ten první tiše zahodí. Do 25. 8. 2026
   byl v obou jazycích oddíl `warnings` DVAKRÁT: první nesl klíče závažnosti
   s velkými písmeny („Minor"), druhý s malými — a kód používal ty malé.
   Půlka překladu tedy byla mrtvá a paritní test si toho nemohl všimnout,
   protože po načtení modulu už první zápis neexistuje.

   Kontroluje se proto ZDROJOVÝ TEXT, ne načtený objekt.
   ============================================================ */

const KORENOVY_KLIC = /^ {2}([a-zA-Z][\w$]*): \{/;

for (const kod of Object.keys(LANG_NAMES)) {
  test(`🚨 ${kod}.js nemá žádný oddíl zapsaný dvakrát`, async () => {
    const cesta = new URL(`../web/lib/lang/${kod}.js`, import.meta.url);
    const zdroj = await readFile(cesta, 'utf8');

    const videne = new Map();
    const dvakrat = [];
    for (const [i, radek] of zdroj.split(/\r?\n/).entries()) {
      const m = radek.match(KORENOVY_KLIC);
      if (!m) continue;
      if (videne.has(m[1])) dvakrat.push(`${m[1]} (řádky ${videne.get(m[1])} a ${i + 1})`);
      else videne.set(m[1], i + 1);
    }
    assert.deepEqual(dvakrat, [], `dvakrát zapsané oddíly: ${dvakrat.join(', ')}`);
  });
}

/* ============================================================
   MNOŽNÉ ČÍSLO

   🚨 „Déšť na 1 místech" bylo v appce vidět (Michal, 25. 8. 2026). Čeština
   má tři tvary tam, kde angličtina dva — dosadit číslo do jedné věty nestačí.
   ============================================================ */

test('🚨 množné číslo: čeština má správný tvar pro 1, 2 i 5', () => {
  assert.equal(tp('route.rain', 1, {}, 'cs'), 'Déšť na 1 místě.');
  assert.equal(tp('route.rain', 2, {}, 'cs'), 'Déšť na 2 místech.');
  assert.equal(tp('route.rain', 5, {}, 'cs'), 'Déšť na 5 místech.');
});

test('množné číslo: angličtina má dva tvary', () => {
  assert.equal(tp('route.rain', 1, {}, 'en'), 'Rain expected at 1 spot.');
  assert.equal(tp('route.rain', 3, {}, 'en'), 'Rain expected at 3 spots.');
});

test('🚨 zpoždění se skloňuje: o hodinu, o dvě hodiny, o pět hodin', () => {
  // Do věty se to dosazuje ve čtvrtém pádě („vyraž o …"), takže tvar musí
  // sedět i tam — jinak vyjde „vyraž o 1 hodin".
  assert.equal(tp('route.delayHours', 1, {}, 'cs'), 'hodinu', 'česky se řekne „o hodinu", ne „o 1 hodinu"');
  assert.equal(tp('route.delayHours', 2, {}, 'cs'), '2 hodiny');
  assert.equal(tp('route.delayHours', 5, {}, 'cs'), '5 hodin');
});

test('množné číslo: obyčejný text projde jako dřív', () => {
  // Překlad, který tvary nepotřebuje, je nemusí psát.
  assert.equal(tp('route.clear', 3, {}, 'cs'), 'Po cestě se nikde nečeká déšť.');
});

test('🚨 každý jazyk má všechny tvary, které jeho gramatika vyžaduje', () => {
  // Chybějící tvar není díra v UI, ale ŠPATNÁ ČEŠTINA: spadne se na `other`
  // a vyjde „na 1 místech". Test to musí chytit dřív než uživatel.
  for (const lang of Object.keys(LANG_NAMES)) {
    const problemy = checkPlurals(lang);
    assert.deepEqual(problemy, [],
      problemy.map((p) => `${p.lang}: ${p.path} nemá ${p.missing.join(', ')}`).join(' · '));
  }
});

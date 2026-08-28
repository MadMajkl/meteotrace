/**
 * Samotest verzování.
 *
 * 🚨 Vznikl z konkrétní stížnosti (Michal, 28. 8. 2026): *„ty to zapomínáš
 * zvedat!"* Appka hlásila `0.1.0` ještě týden po tom, co jí přibyla trasa,
 * výstrahy, vlastní mapa i značka. Verze je jediný údaj, podle kterého se
 * pozná, co má člověk v telefonu — a když stojí, je horší než žádná, protože
 * tvrdí, že se nic nezměnilo.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { dalsi, rozloz } from '../tools/verze.mjs';
import { meniAppku, verzeZ } from '../tools/version-check.mjs';

const KOREN = join(dirname(fileURLToPath(import.meta.url)), '..');
const cti = (...c) => readFileSync(join(KOREN, ...c), 'utf8');

test('🚨 verze ve webu a v package.json se nesmí rozejít', () => {
  // Tohle je celý důvod, proč `npm run verze` píše na obě místa naráz.
  // Kdyby se rozešly, appka by v „O aplikaci" tvrdila něco jiného, než
  // co je v balíčku — a hlášení chyb by se přestalo dát přiřadit.
  const pkg = JSON.parse(cti('package.json')).version;
  const app = /const VERZE = '([^']+)'/.exec(cti('web', 'app.js'))?.[1];
  assert.equal(app, pkg, `app.js má ${app}, package.json ${pkg}`);
});

test('🚨 Android verzi nedrží, jen čte', () => {
  // Dokud si ji držel sám, byla to třetí kopie téhož čísla — a právě ta
  // se rozešla první.
  const gradle = cti('android', 'app', 'build.gradle.kts');
  assert.ok(!/versionName\s*=\s*"/.test(gradle), 'v Gradle je verze napevno');
  assert.match(gradle, /versionName = verze\.getProperty/);
  assert.match(gradle, /versionCode = verze\.getProperty/);
});

test('verze je X.Y.Z, nic jiného neprojde', () => {
  assert.deepEqual(rozloz('0.2.6'), { major: 0, minor: 2, patch: 6 });
  assert.throws(() => rozloz('0.2'), /X\.Y\.Z/);
  assert.throws(() => rozloz('v0.2.6'), /X\.Y\.Z/);
  assert.throws(() => rozloz(''), /X\.Y\.Z/);
});

test('🚨 minor nuluje patch, major nuluje obojí', () => {
  // „0.3.6" by vypadalo jako šestá oprava trojky, ale bylo by to její
  // první vydání. Číslo, které se dá takhle přečíst špatně, je horší
  // než číslo o jedna větší.
  assert.equal(dalsi('0.2.6', 'patch'), '0.2.7');
  assert.equal(dalsi('0.2.6', 'minor'), '0.3.0');
  assert.equal(dalsi('0.2.6', 'major'), '1.0.0');
  assert.equal(dalsi('0.2.6', '1.4.2'), '1.4.2');
});

test('pojistka reaguje na appku, ne na papíry okolo', () => {
  assert.equal(meniAppku(['web/app.js']), true);
  assert.equal(meniAppku(['android/app/build.gradle.kts']), true);
  assert.equal(meniAppku(['server/api.js']), true);
  // Dokumentace a nástroje verzi zvedat nemusí — pojistka, která otravuje
  // u každého commitu, skončí vypnutá a pak nehlídá nic.
  assert.equal(meniAppku(['CLAUDE.md', 'tools/docx.mjs']), false);
  assert.equal(meniAppku([]), false);
});

test('verze se čte z obsahu package.json, ne z názvu balíčku', () => {
  assert.equal(verzeZ('{"name":"x","version":"1.2.3"}'), '1.2.3');
  assert.equal(verzeZ('{"name":"x"}'), null);
  assert.equal(verzeZ(''), null);
});

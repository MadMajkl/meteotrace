/**
 * Samotest povolení polohy v nastavení (30. 9. 2026).
 *
 * Bez prohlížeče a bez telefonu: hlídá, že ke každému stavu patří správný
 * text a správná akce — a že obal v Kotlinu má TUTÉŽ tabulku stavů jako web.
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  locationView, normalizeAccess, androidAccess, isDeniedError, STAVY_POLOHY,
} from '../web/lib/location-access.js';
import { t, LANG_NAMES } from '../web/lib/i18n.js';

const KOREN = join(dirname(fileURLToPath(import.meta.url)), '..');
const kotlin = (soubor) => readFileSync(
  join(KOREN, 'android', 'app', 'src', 'main', 'java', 'com', 'meteotrace', soubor), 'utf8');

/* ============================================================
   CO SE KE KTERÉMU STAVU UKÁŽE
   ============================================================ */

test('🚨 tlačítko dělá podle stavu jinou věc — a nikdy nic naprázdno', () => {
  // Ještě se neptalo / jde se zeptat znovu → zeptat se.
  assert.equal(locationView('prompt', true).action, 'ask');
  assert.equal(locationView('prompt', false).action, 'ask');
  // Android se už ptát nebude → tlačítko MUSÍ otevřít nastavení, ne „žádat".
  assert.equal(locationView('denied', true).action, 'settings');
  // Poloha vypnutá v telefonu → nastavení polohy.
  assert.equal(locationView('off', true).action, 'service');
  // Povoleno → není co mačkat.
  assert.equal(locationView('granted', true).button, null);
});

test('🚨 na webu se zakázaná poloha řeší NÁVODEM, ne mrtvým tlačítkem', () => {
  // Web do nastavení prohlížeče nedosáhne. Tlačítko „Povolit" by v tom
  // stavu nedělalo nic — a to se od rozbité appky nedá odlišit.
  const v = locationView('denied', false);
  assert.equal(v.button, null);
  assert.equal(v.action, null);
  assert.equal(v.hint, 'location.deniedHintWeb');
});

test('„nevíme" a nesmysl se chovají jako „zeptej se"', () => {
  // Starší prohlížeč stav neprozradí — žádost o polohu se ale zeptá sama.
  assert.equal(normalizeAccess(undefined), 'unknown');
  assert.equal(normalizeAccess('cokoli'), 'unknown');
  assert.equal(locationView('cokoli', false).action, 'ask');
  assert.equal(locationView(null, true).action, 'ask');
});

test('každý stav má text a každý odkazovaný klíč existuje v obou jazycích', () => {
  for (const vObalu of [true, false]) {
    for (const stav of STAVY_POLOHY) {
      const v = locationView(stav, vObalu);
      for (const klic of [v.status, v.button, v.hint].filter(Boolean)) {
        for (const lang of Object.keys(LANG_NAMES)) {
          assert.notEqual(t(klic, lang), klic, `${lang}: chybí ${klic}`);
        }
      }
      // Tlačítko a akce jdou vždycky spolu.
      assert.equal(!!v.button, !!v.action, `${stav}/${vObalu}: tlačítko bez akce nebo naopak`);
    }
  }
  assert.notEqual(t('location.deniedNotice', 'cs'), 'location.deniedNotice');
});

/* ============================================================
   STAV V ANDROIDU
   ============================================================ */

test('🚨 „zakázáno natrvalo" se pozná jen podle toho, že jsme se už ptali', () => {
  // `muzeSeZeptat` (shouldShowRequestPermissionRationale) je false ve DVOU
  // případech: nikdo se ještě neptal, a už se ptát nesmí.
  assert.equal(androidAccess({ povoleno: false, ptaliSe: false, muzeSeZeptat: false }), 'prompt');
  assert.equal(androidAccess({ povoleno: false, ptaliSe: true, muzeSeZeptat: false }), 'denied');
  // Jedno odmítnutí: Android se zeptá znovu.
  assert.equal(androidAccess({ povoleno: false, ptaliSe: true, muzeSeZeptat: true }), 'prompt');
  assert.equal(androidAccess({ povoleno: true, sluzbaZapnuta: true }), 'granted');
  // Povolení je, ale poloha v telefonu vypnutá — appka by jinak tvrdila „povolená".
  assert.equal(androidAccess({ povoleno: true, sluzbaZapnuta: false }), 'off');
});

test('🚨 obal má TUTÉŽ tabulku stavů jako web', () => {
  const a = kotlin('MainActivity.kt');
  // Dvě řádky, na kterých tabulka stojí — musí odpovídat `androidAccess()`.
  assert.match(a, /if \(maPolohu\(\)\) return if \(sluzbaPolohyZapnuta\(\)\) "granted" else "off"/);
  assert.match(a, /return if \(ptaliSe && !muzeSeZeptat\) "denied" else "prompt"/);
  // Každý stav, který obal umí vrátit, web zná.
  for (const [, stav] of a.matchAll(/"(granted|off|denied|prompt)"/g)) {
    assert.ok(STAVY_POLOHY.includes(stav), stav);
  }
  // A každá akce má v obalu svou větev.
  assert.match(a, /"prompt" -> zeptejSeNaPolohu\(\)/);
  // „denied" je odhad → nejdřív dialog, nastavení telefonu až když se neukáže.
  assert.match(a, /"denied" -> \{\s*priOdmitnutiOtevritNastaveni = true\s*zeptejSeNaPolohu\(\)/);
  // 🚨 Podle toho, jestli se Android ještě zeptá — NE podle času. První verze
  // měřila „odpověď přišla okamžitě" (< 450 ms); na emulátoru trvala tichá
  // odpověď 808 ms, hranice ji minula a tlačítko nedělalo nic.
  assert.match(a, /val uzSeNezepta = POLOHA\.none \{ ActivityCompat\.shouldShowRequestPermissionRationale\(this, it\) \}/);
  assert.match(a, /if \(!povoleno && uzSeNezepta && priOdmitnutiOtevritNastaveni\) otevriNastaveniAppky\(\)/);
  assert.doesNotMatch(a, /OKAMZITE_MS/);
  assert.match(a, /Intent\(Settings\.ACTION_APPLICATION_DETAILS_SETTINGS, Uri\.fromParts\("package", packageName, null\)\)/);
  assert.match(a, /"off" -> otevriNastaveni\(Intent\(Settings\.ACTION_LOCATION_SOURCE_SETTINGS\)\)/);
});

test('🚨 obal si pamatuje, že se ptal — na OBOU cestách k dialogu', () => {
  // Dialog jde vyvolat z „Tady" (WebView) i z nastavení. Kdyby si to jedna
  // cesta nezapsala, trvalý zákaz by se hlásil jako „zeptej se" a tlačítko
  // by mačkalo dialog, který se už nikdy neukáže.
  const a = kotlin('MainActivity.kt');
  const primo = [...a.matchAll(/zadostOPolohu\.launch\(POLOHA\)/g)].length;
  assert.equal(primo, 1, 'dialog se smí spouštět jen z `zeptejSeNaPolohu()`');
  assert.match(a, /private fun zeptejSeNaPolohu\(\) \{\s*pametPolohy\(\)\.edit\(\)\.putBoolean\(KLIC_PTALI_SE, true\)\.apply\(\)\s*zadostOd = SystemClock\.elapsedRealtime\(\)\s*zadostOPolohu\.launch\(POLOHA\)/);
  assert.ok([...a.matchAll(/zeptejSeNaPolohu\(\)/g)].length >= 4, 'definice + WebView + nastavení (prompt i denied)');
});

test('most umí polohu a po návratu do appky dá webu vědět', () => {
  const m = kotlin('MostDoWebu.kt');
  for (const metoda of ['umiPolohu', 'stavPolohy', 'povolPolohu']) {
    assert.match(m, new RegExp(`@JavascriptInterface\\s+fun ${metoda}\\(`), metoda);
  }
  const a = kotlin('MainActivity.kt');
  // Žádost se spouští na UI vlákně — most volá WebView z vlastního.
  assert.match(a, /povolPolohuVActivite = \{ runOnUiThread \{ povolPolohu\(\) \} \}/);
  // Návrat z nastavení telefonu: bez tohohle by appka dál tvrdila „zakázáno".
  assert.match(a, /override fun onResume\(\) \{\s*super\.onResume\(\)\s*oznamPolohuWebu\(\)/);
  assert.match(a, /dispatchEvent\(new Event\('meteotrace:poloha'\)\)/);
});

test('web: řádek v nastavení, tlačítko a posluchač události z obalu', () => {
  const html = readFileSync(join(KOREN, 'web', 'index.html'), 'utf8');
  assert.match(html, /<button id="btn-location"[^>]*hidden>/);
  assert.match(html, /id="location-status"/);
  assert.match(html, /id="location-note"/);
  const app = readFileSync(join(KOREN, 'web', 'app.js'), 'utf8');
  assert.match(app, /addEventListener\('meteotrace:poloha', poZmenePovoleniPolohy\)/);
  assert.match(app, /\$\('btn-location'\)\.addEventListener\('click', povolPolohuZNastaveni\)/);
  // Nastavení při otevření ukáže AKTUÁLNÍ stav.
  assert.match(app, /vypisStavPolohy\(\);\s*\n\s*\$\('about-version'\)/);
});

test('zakázaná poloha se pozná od „nepodařilo se"', () => {
  assert.equal(isDeniedError({ code: 1 }), true);
  assert.equal(isDeniedError({ code: 2 }), false);   // poloha nedostupná
  assert.equal(isDeniedError({ code: 3 }), false);   // vypršel čas
  assert.equal(isDeniedError(null), false);
});

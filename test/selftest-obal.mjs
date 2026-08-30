/**
 * Samotest obalu: appka nesmí spoléhat na to, že sedí v kořeni domény.
 *
 * 🚨 VZNIKLO Z VADY, KTEROU NAŠEL AŽ TELEFON. Michal 28. 8. 2026:
 * *„APK nezobrazuje mapu, píše, že se nepodařilo načíst."*
 *
 * Ve webu appka běží na `http://localhost:8099/`, takže `/fonts/…` je správně.
 * V obalu pro Android ale sedí na `https://appassets.androidplatform.net/
 * assets/www/index.html` — a tam `/fonts/…` míří MIMO ni, protože nativní
 * obsluha zná jen `/assets/`. Prohlížeč o tom nic neřekne, jen se nenačte
 * podklad a appka napíše, že se mapu nepodařilo načíst.
 *
 * ⚠️ Výjimka je jediná: `/api/…` musí zůstat od kořene. Nativní vrstva
 * poznává dotazy na data právě podle téhle cesty (`ApiPipe`), takže kdyby
 * byla relativní, přestala by appka v obalu vidět data.
 *
 * Spuštění:  npm run selftest:logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

import { buildStyle, fontsUrlFrom, PISMA_VYCHOZI } from '../web/lib/map-style.js';
import { tilesUrl, VYCHOZI_DLAZDICE } from '../web/lib/tiles-config.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

/** Složky, které nejsou náš kód (cizí knihovny, data, obrázky). */
const NEPROCHAZET = ['vendor', 'fonts', 'icons', 'data'];

/**
 * Najde absolutní cesty v řetězcích zdrojáku — a jen v nich.
 *
 * ⚠️ Prostý `grep` tu nestačí: v komentářích se cesty zmiňují („`/fonts/…`")
 * a v adresách je `//` jako v `https://`. Proto se prochází znak po znaku
 * a hlídá se, jestli jsme v řetězci, nebo v komentáři.
 */
export function absolutniCesty(zdroj) {
  const nalezy = [];
  let i = 0;
  let radek = 1;
  const je = (s) => zdroj.startsWith(s, i);

  while (i < zdroj.length) {
    const z = zdroj[i];
    if (z === '\n') { radek++; i++; continue; }

    if (je('//')) { while (i < zdroj.length && zdroj[i] !== '\n') i++; continue; }
    if (je('/*')) {
      i += 2;
      while (i < zdroj.length && !je('*/')) { if (zdroj[i] === '\n') radek++; i++; }
      i += 2;
      continue;
    }

    if (z === '"' || z === "'" || z === '`') {
      const konec = z;
      const zacatek = i + 1;
      const zacatekRadku = radek;
      i++;
      while (i < zdroj.length && zdroj[i] !== konec) {
        if (zdroj[i] === '\\') i++;
        else if (zdroj[i] === '\n') radek++;
        i++;
      }
      const obsah = zdroj.slice(zacatek, i);
      i++;
      if (/^\/[a-zA-Z]/.test(obsah)) nalezy.push({ cesta: obsah, radek: zacatekRadku });
      continue;
    }

    i++;
  }
  return nalezy;
}

function zdrojaky(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!NEPROCHAZET.includes(e.name)) zdrojaky(join(dir, e.name), out);
    } else if (e.name.endsWith('.js')) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

test('🚨 ve webu nesmí být absolutní cesta jinam než na /api/', () => {
  const hrichy = [];
  for (const soubor of zdrojaky(WEB)) {
    const kratce = relative(WEB, soubor).split(sep).join('/');
    for (const n of absolutniCesty(readFileSync(soubor, 'utf8'))) {
      if (n.cesta.startsWith('/api/')) continue;
      hrichy.push(`${kratce}:${n.radek}  ${n.cesta}`);
    }
  }
  assert.deepEqual(hrichy, [], `Cesty od kořene by v obalu (…/assets/www/) minuly appku:\n${hrichy.join('\n')}`);
});

test('🚨 písma se hledají vedle appky, ne v kořeni', () => {
  const styl = buildStyle({ tilesUrl: 'https://x/cz.pmtiles' });
  assert.ok(!styl.glyphs.startsWith('/'), `glyphs: ${styl.glyphs}`);
  assert.match(styl.glyphs, /\{fontstack\}\/\{range\}\.pbf$/);
});

test('🚨 složené závorky se nesmí zakódovat', () => {
  // `new URL()` by z `{fontstack}` udělalo `%7Bfontstack%7D` a MapLibre by
  // v šabloně neměl co nahradit — mapa by zůstala bez popisků a bez chyby.
  const base = 'https://appassets.androidplatform.net/assets/www/index.html';
  const styl = buildStyle({ tilesUrl: 'https://x/cz.pmtiles', fontsUrl: fontsUrlFrom(base) });
  assert.ok(!styl.glyphs.includes('%7B'), styl.glyphs);
  assert.equal(
    styl.glyphs,
    'https://appassets.androidplatform.net/assets/www/fonts/{fontstack}/{range}.pbf',
  );
});

test('bez adresy stránky zůstane cesta relativní', () => {
  assert.equal(fontsUrlFrom(undefined), PISMA_VYCHOZI);
  assert.equal(PISMA_VYCHOZI.startsWith('/'), false);
});

test('🚨 výchozí adresa podkladu je taky relativní', () => {
  assert.equal(VYCHOZI_DLAZDICE.startsWith('/'), false);
  // A v prohlížeči se stejně dopočítá na úplnou — knihovna relativní nebere.
  assert.equal(
    tilesUrl('https://appassets.androidplatform.net/assets/www/index.html', { querySelector: () => null }),
    'https://appassets.androidplatform.net/assets/www/data/cz.pmtiles',
  );
});

test('hledač cest si nesplete komentář ani https://', () => {
  assert.deepEqual(absolutniCesty('// viz /fonts/x\nconst a = 1;'), []);
  assert.deepEqual(absolutniCesty('/* /fonts/x */ const a = 1;'), []);
  assert.deepEqual(absolutniCesty("const u = 'https://x/y';"), []);
  assert.deepEqual(
    absolutniCesty("const u = '/fonts/a.pbf';").map((n) => n.cesta),
    ['/fonts/a.pbf'],
  );
});

/* ============================================================
   ODKAZY VEN

   🚨 Dar a crosslinky jsou první cizí adresy v appce vůbec. Do 30. 8. 2026
   obal na cizí odkaz vracel jen `true` („postaráno") a NIC neotevřel —
   klepnutí by mlčky nic neudělalo. Test hlídá, že se o adresu opravdu
   někdo postará; kód obalu se jinak nespouští, tak se čte jako text.
   ============================================================ */

const OBAL = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src',
  'main', 'java', 'com', 'meteotrace', 'MainActivity.kt');

test('🚨 cizí odkaz obal předá systému, nespolkne ho', () => {
  const kt = readFileSync(OBAL, 'utf8');
  const telo = kt.slice(kt.indexOf('shouldOverrideUrlLoading'));
  assert.ok(telo.includes('Intent.ACTION_VIEW'),
    'cizí odkaz se musí otevřít v prohlížeči, ne jen vrátit true');
  assert.ok(telo.includes('ActivityNotFoundException'),
    'telefon bez prohlížeče nesmí shodit appku');
});

test('vlastní obsah zůstává uvnitř obalu', () => {
  const kt = readFileSync(OBAL, 'utf8');
  const telo = kt.slice(kt.indexOf('shouldOverrideUrlLoading'));
  assert.match(telo, /host == HOSTITEL\) return false/,
    'na vlastní adresu se WebView nesmí obcházet');
});

test('🚨 každý odkaz ven ve stránce má rel="noopener"', () => {
  // Bez něj dostane cizí stránka odkaz na naše okno (`window.opener`)
  // a může nás přesměrovat, kam chce. V appce zdarma to nikoho nenapadne
  // hledat — proto to hlídá stroj.
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const odkazy = [...html.matchAll(/<a\b[^>]*href="https?:[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.ok(odkazy.length > 0, 'žádný odkaz ven — test by nic nekontroloval');
  for (const a of odkazy) {
    assert.match(a, /rel="[^"]*noopener/, a);
    assert.match(a, /target="_blank"/, a);
  }
});

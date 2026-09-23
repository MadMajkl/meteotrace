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

/* ============================================================
   SYSTÉMOVÉ OKRAJE (safe area)

   🚨 VZNIKLO Z VADY, KTEROU PROHLÍŽEČ UKÁZAT NEMOHL. Michal 30. 8. 2026:
   *„v APK je stále horní lišta moc vysoká, hlavní panel by měl lícovat
   těsně pod kolečkem nastavení."*

   `.top` mělo `padding-bottom: calc(5px + env(safe-area-inset-bottom))` —
   výšku gesto-lišty nalepenou ZESPODU na HORNÍ lištu. Na webu je ten okraj
   nulový, takže tam bylo 5 px a všechno vypadalo správně. V appce běží
   `enableEdgeToEdge()` a `viewport-fit=cover`, takže je reálný: lišta
   narostla z 30 px na skoro 80 a mezi kolečkem a panelem zůstal pruh
   prázdna. **Layoutová kontrola to nemohla najít** — měří v prohlížeči,
   kde jsou všechny okraje nulové.
   ============================================================ */

/** Rozseká CSS na bloky `selektor { deklarace }`. Komentáře se vyhodí. */
export function cssBloky(zdroj) {
  const bez = zdroj.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...bez.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selektor: m[1].trim(), telo: m[2] }));
}

test('🚨 horní lišta nesmí používat SPODNÍ systémový okraj', () => {
  const css = readFileSync(join(WEB, 'style.css'), 'utf8');

  for (const { selektor, telo } of cssBloky(css)) {
    if (!telo.includes('safe-area-inset-bottom')) continue;
    // Prvek přilepený nahoře poznáš podle `top: 0` u sticky/fixed. Spodní
    // okraj tam nemá co dělat: přidá prázdno přesně tam, kde má být obsah.
    const nahore = /position:\s*(sticky|fixed)/.test(telo) && /(^|[;{\s])top:\s*0/.test(telo);
    assert.ok(!nahore,
      `„${selektor}" je přilepený nahoře a bere spodní systémový okraj — v prohlížeči to nepoznáš`);
  }
});

test('🚨 obsah musí spodní systémový okraj naopak respektovat', () => {
  // Opačná polovina téže vady: appka kreslí POD systémové lišty, takže bez
  // toho by poslední karta skončila pod gesto-lištou a nešla by přečíst.
  const css = readFileSync(join(WEB, 'style.css'), 'utf8');
  const main = cssBloky(css).find((b) => b.selektor === 'main');
  assert.ok(main, 'blok `main` ve stylu chybí');
  assert.match(main.telo, /safe-area-inset-bottom/,
    'spodní odsazení obsahu musí počítat s gesto-lištou');
});

test('🚨 horní lišta naopak HORNÍ systémový okraj respektovat musí', () => {
  // Bez něj by značka a ozubené kolo skončily pod stavovým řádkem telefonu.
  const css = readFileSync(join(WEB, 'style.css'), 'utf8');
  const top = cssBloky(css).find((b) => b.selektor === '.top');
  assert.ok(top, 'blok `.top` ve stylu chybí');
  assert.match(top.telo, /padding-top:\s*calc\([^)]*safe-area-inset-top/);
});

test('hledač bloků si nesplete komentář s pravidlem', () => {
  // Kdyby se komentáře nevyhazovaly, našel by se `safe-area-inset-bottom`
  // v poznámce nad pravidlem — a test by hlásil vadu tam, kde není.
  const bloky = cssBloky('/* .top { safe-area-inset-bottom } */\n.a { color: red; }');
  assert.equal(bloky.length, 1);
  assert.equal(bloky[0].selektor, '.a');
});

/* ============================================================
   ANIMACE A VYPNUTÝ POHYB

   ⚠️ Kdo si v systému vypne animace, má k tomu důvod — nevolnost z pohybu,
   epilepsie, nebo prostě klid na práci. `prefers-reduced-motion` je jediné,
   čím nám to řekne. Animací přibylo za jediný den 31. 8. 2026 hned několik
   (mince v hlavičce, mince na daru, výzva šipkou) a zapomenout na jednu
   z nich je tichá vada: pro většinu lidí se nic nezmění.
   ============================================================ */

test('🚨 každá animace má cestu ven přes prefers-reduced-motion', () => {
  const css = readFileSync(join(WEB, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  // Jména animací, které se někde opravdu používají.
  const pouzita = new Set(
    [...css.matchAll(/animation:\s*([A-Za-z][\w-]*)/g)].map((m) => m[1])
      .filter((n) => n !== 'none'),
  );
  assert.ok(pouzita.size > 0, 'žádná animace — test by nic nekontroloval');

  // Bloky uvnitř `@media (prefers-reduced-motion: reduce)`.
  const utlum = [...css.matchAll(/@media[^{]*prefers-reduced-motion[^{]*\{([\s\S]*?)\n\}/g)]
    .map((m) => m[1]).join('\n');
  assert.ok(utlum.length, 'chybí blok pro vypnuté animace');

  // ⚠️ Nestačí, že blok existuje — musí v něm být `animation: none`, jinak
  // by se tvářil, že pohyb tlumí, a přitom nedělal nic.
  assert.match(utlum, /animation:\s*none/, 'blok pro vypnuté animace nic nevypíná');

  // ⚠️ Bloky se hledají rozborem, ne jedním velkým regulárním výrazem:
  //    `@keyframes` má uvnitř další závorky a výraz se na nich zakousne.
  for (const jmeno of pouzita) {
    const zapina = cssBloky(css)
      .find((b) => new RegExp('animation:\\s*' + jmeno + '\\b').test(b.telo));
    assert.ok(zapina, `animace „${jmeno}" se nikde nezapíná`);
    // Poslední kus selektoru je ten prvek, který se hýbe — a právě ten
    // musí být zmíněný v útlumu.
    const selektor = zapina.selektor.trim().split(/\s+/).pop().replace(/^[.#]/, '');
    assert.ok(utlum.includes(selektor),
      `animace „${jmeno}" (${selektor}) nemá cestu ven přes prefers-reduced-motion`);
  }
});

/* ============================================================
   DONATE-COMEBACK (R27) — dar se v obalu schovává do schválení na Play

   🚨 Je to DOČASNÉ opatření a přesně proto potřebuje hlídače: až se dar
   vrátí, musí se smazat na všech místech najednou. A dokud platí, nesmí
   se tiše rozbít — schovaný dar se totiž pozná jen tím, že tam něco NENÍ.
   ============================================================ */

test('🚨 dar se v obalu schovává podle MOSTU, ne podle CSS ani userAgent', () => {
  const app = readFileSync(join(WEB, 'app.js'), 'utf8');
  const fn = /function schovejDarVObalu\(\)\s*\{[\s\S]*?\n\}/.exec(app);
  assert.ok(fn, 'funkce schovejDarVObalu() zmizela — dar by se v Androidu ukázal');

  assert.match(fn[0], /window\.MeteoTraceObal/,
    'obal se poznává mostem; `userAgent` se dá přepsat a v prohlížeči na Androidu lže');
  for (const id of ['btn-donate-top', 'donate-section']) {
    assert.ok(fn[0].includes(id), `schovat se musí i ${id}`);
  }

  assert.match(app, /schovejDarVObalu\(\);/, 'funkce se nikde nevolá');

  // Na webu dar zůstat MUSÍ — kdyby se schoval v šabloně nebo v CSS,
  // zmizel by všem, i návštěvníkům meteotrace.com.
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  assert.match(html, /<div id="donate-section">/, 'oddíl daru musí mít obálku, jinak není co schovat');
  assert.doesNotMatch(html, /id="donate-section"[^>]*\shidden/, 'dar nesmí být schovaný rovnou v šabloně');
  const css = readFileSync(join(WEB, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#donate-section\s*\{[^}]*display:\s*none/, 'dar nesmí schovávat CSS — platilo by i na webu');
});

test('DONATE-COMEBACK je značka, která se najde ve všech dotčených souborech', () => {
  // Až přijde čas dar vrátit, hledá se jedno slovo — ne tři různé formulace.
  for (const [jmeno, cesta] of [
    ['app.js', join(WEB, 'app.js')],
    ['index.html', join(WEB, 'index.html')],
  ]) {
    assert.match(readFileSync(cesta, 'utf8'), /DONATE-COMEBACK/, `${jmeno} nenese značku DONATE-COMEBACK`);
  }
});

/* ============================================================
   RANNÍ A VEČERNÍ ZPRÁVA V OBALU (`R25`)

   🚨 Tyhle vady se poznají jen tím, že zpráva NEPŘIJDE — a chybějící
   upozornění nevypadá jako chyba. Proto se hlídají čtením zdrojáku.
   ============================================================ */

const ZPRAVY = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src',
  'main', 'java', 'com', 'meteotrace', 'Zpravy.kt');
const MANIFEST = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src',
  'main', 'AndroidManifest.xml');

test('🚨 obal o počasí NIC nerozhoduje — text zprávy skládá server', () => {
  const kt = readFileSync(ZPRAVY, 'utf8');
  // Kdyby si obal skládal větu sám, musel by znát kódy počasí, jednotky
  // i jazyk. Tři tabulky, které se při první opravě rozejdou s appkou —
  // a poznalo by se to tím, že zpráva tvrdí něco jiného než obrazovka.
  for (const zakazane of ['weather_code', 'temperature_2m', '°C', 'Zataženo', 'Overcast']) {
    assert.ok(!kt.includes(zakazane), `obal si skládá počasí sám: ${zakazane}`);
  }
  assert.match(kt, /api\/brief/, 'obal se musí ptát serveru');
  assert.match(kt, /optString\("text"\)/, 'a brát hotový text');
});

test('🚨 prázdná zpráva se NEZVONÍ', () => {
  const kt = readFileSync(ZPRAVY, 'utf8');
  // Server vrací `text: null`, když na ten den nic neví. Notifikace
  // s prázdným textem vypadá jako vada appky.
  assert.match(kt, /takeIf \{ it\.isNotEmpty\(\) && it != "null" \}/,
    'chybí kontrola prázdného textu (a řetězce "null", který JSONObject vrací)');
});

test('🚨 ráno a večer mají RŮZNÁ id — jinak jedno přepíše druhé', () => {
  const kt = readFileSync(ZPRAVY, 'utf8');
  const rano = /ID_RANO\s*=\s*(\d+)/.exec(kt)?.[1];
  const vecer = /ID_VECER\s*=\s*(\d+)/.exec(kt)?.[1];
  assert.ok(rano && vecer, 'id upozornění nejsou pojmenovaná');
  assert.notEqual(rano, vecer);
  assert.notEqual(rano, '1', 'id 1 patří výstrahám (Vystrahy.notify)');
  assert.notEqual(vecer, '1', 'id 1 patří výstrahám (Vystrahy.notify)');
});

test('🚨 po zazvonění se hned plánuje další den', () => {
  const kt = readFileSync(ZPRAVY, 'utf8');
  const prijemce = /class BudikZprav[\s\S]*?\n\}/.exec(kt)?.[0] || '';
  assert.match(prijemce, /vyzvedni\(/, 'příjemce budíku má spustit stažení');
  assert.match(prijemce, /naplanuj\(/,
    'bez přeplánování by zpráva přišla jednou a pak už nikdy — a nikdo by si toho nevšiml');
});

test('🚨 vlastní čas zprávy PŘEŽIJE start appky', () => {
  // 23. 9. 2026: v `load()` stálo `/^d{1,2}:d{2}$/` — bez zpětných lomítek.
  // Takový tvar hledá PÍSMENO „d", takže neprošel žádný čas a nastavení se
  // při každém spuštění tiše vrátilo na 6:30 a 20:00. Ověřeno na emulátoru:
  // zadáno 7:24, Android dostal budík na 6:30.
  //
  // ⚠️ Test tvar NEHLEDÁ, ale SPOUŠTÍ. Porovnání textu (`includes('\\d')`)
  // by prošlo i u jiné vady, tohle projde jen tehdy, když to vážně funguje.
  const app = readFileSync(join(WEB, 'app.js'), 'utf8');
  const radky = app.split('\n').filter((r) => /saved\.zpravy\.(rano|vecer)/.test(r));
  assert.equal(radky.length, 2, 'načítání časů zpráv se přestěhovalo — uprav test');

  for (const radek of radky) {
    const zapis = /\/\^(.+?)\$\//.exec(radek);
    assert.ok(zapis, `čas se při načtení nekontroluje: ${radek.trim()}`);
    const tvar = new RegExp(`^${zapis[1]}$`);
    for (const cas of ['06:30', '7:05', '20:00', '23:59']) {
      assert.ok(tvar.test(cas), `platný čas ${cas} by se zahodil a vrátil na výchozí`);
    }
    for (const nesmysl of ['', 'ráno', '6:3', 'dd:dd']) {
      assert.ok(!tvar.test(nesmysl), `neplatný čas „${nesmysl}" projde jako platný`);
    }
  }
});

/**
 * Zdroják bez komentářů.
 *
 * 🚨 Bez tohohle test hlásil vadu kvůli VLASTNÍ poznámce: v komentáři
 * u budíku stojí „setAndAllowWhileIdle, ne setExactAndAllowWhileIdle" —
 * a hledání v holém textu tam ten zakázaný tvar našlo. Táž past jako
 * u CSS o kus výš.
 */
function bezKomentaru(kod) {
  return kod.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('🚨 budík nesmí chtít oprávnění na PŘESNÝ čas', () => {
  const kt = bezKomentaru(readFileSync(ZPRAVY, 'utf8'));
  // `setExactAndAllowWhileIdle` chce od Androidu 12 zvlášť oprávnění, které
  // Google dává jen budíkům a kalendářům. U ranní předpovědi je pár minut jedno.
  assert.ok(!kt.includes('setExactAndAllowWhileIdle'), 'přesný budík by chtěl SCHEDULE_EXACT_ALARM');
  assert.match(kt, /setAndAllowWhileIdle/, 'obyčejný `set` by v hlubokém spánku neprošel');
  const manifest = readFileSync(MANIFEST, 'utf8');
  assert.ok(!manifest.includes('SCHEDULE_EXACT_ALARM'), 'oprávnění na přesný budík se nežádá');
  assert.ok(!manifest.includes('ACCESS_BACKGROUND_LOCATION'),
    'poloha na pozadí se nežádá (R25) — je zvlášť posuzovaná a zdržela by vydání');
});

test('🚨 zprávy mají vlastní kanál, aby šly vypnout bez výstrah', () => {
  const kt = readFileSync(ZPRAVY, 'utf8');
  assert.match(kt, /KANAL = "zpravy"/);
  assert.match(kt, /IMPORTANCE_DEFAULT/, 'předpověď není výstraha a nemá právo vyrušit jako bouřka');
  const vystrahy = readFileSync(join(dirname(ZPRAVY), 'Vystrahy.kt'), 'utf8');
  assert.match(vystrahy, /KANAL = "vystrahy"/, 'výstrahy si musí nechat svůj kanál');
});

test('🚨 budíky se obnoví po restartu telefonu', () => {
  const kt = readFileSync(ZPRAVY, 'utf8');
  assert.match(kt, /class PoRestartu[\s\S]*ACTION_BOOT_COMPLETED[\s\S]*naplanuj/,
    'po restartu Android budíky zahodí — bez obnovy by zprávy tiše přestaly chodit');
  const manifest = readFileSync(MANIFEST, 'utf8');
  assert.match(manifest, /<receiver android:name="\.PoRestartu"[\s\S]*?BOOT_COMPLETED/,
    'příjemce restartu chybí v manifestu');
  assert.match(manifest, /<receiver android:name="\.BudikZprav" android:exported="false"/,
    'budík musí být neveřejný — otevřený by šel spustit cizí appkou');
});

/* ============================================================
   WIDGET NA PLOŠE (R29)
   ============================================================ */

const WIDGET_KT = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src',
  'main', 'java', 'com', 'meteotrace', 'PocasiWidget.kt');
const RES = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src', 'main', 'res');

test('🚨 widget o počasí NIC nerozhoduje — obsah i barvy skládá server', () => {
  const kt = bezKomentaru(readFileSync(WIDGET_KT, 'utf8'));
  for (const zakazane of ['weather_code', 'temperature_2m', '°C', 'Zataženo', 'Overcast', 'thunderstorm']) {
    assert.ok(!kt.includes(zakazane), `obal si skládá počasí sám: ${zakazane}`);
  }
  assert.match(kt, /api\/widget/, 'obal se musí ptát serveru');
  assert.match(kt, /optJSONObject\("pozadi"\)/, 'i barvy oblohy chodí ze serveru');
});

test('🚨 každý prvek, na který widget sahá, v rozvržení OPRAVDU JE', () => {
  // Nastavení textu na prvek, který v rozvržení chybí, shodí CELÝ widget —
  // launcher místo něj ukáže „Widget nelze načíst". A pozná se to až na
  // telefonu, protože kompilátor ani samotest webu to nevidí.
  const kt = readFileSync(WIDGET_KT, 'utf8');
  const varianty = [...kt.matchAll(/Varianta\(\s*R\.layout\.(\w+),[^,]+,[^,]+,\s*setOf\(([^)]*)\)/g)];
  assert.ok(varianty.length >= 4, `našel jsem jen ${varianty.length} variant rozvržení`);
  for (const [, layout, ids] of varianty) {
    const xml = readFileSync(join(RES, 'layout', `${layout}.xml`), 'utf8');
    // Bez těchhle dvou widget nejde vůbec: pozadí se nastavuje vždycky
    // a klepnutí visí na kořeni.
    for (const id of ['w_pozadi']) {
      assert.ok(xml.includes(`"@+id/${id}"`), `${layout}: chybí ${id}`);
    }
    assert.match(xml, /android:id="@android:id\/background"/, `${layout}: kořen nemá @android:id/background`);
    for (const id of ids.match(/R\.id\.(\w+)/g).map((s) => s.slice(5))) {
      // ⚠️ `includes`, ne RegExp: `@\+id` v šabloně je snadné zkazit (heredoc
      // to 22. 9. 2026 udělal) a z „+" se pak stane „jeden nebo víc zavináčů".
      assert.ok(xml.includes(`"@+id/${id}"`), `${layout}: kód sahá na ${id}, v rozvržení není`);
    }
  }
});

test('🚨 staré číslo se nevydává za čerstvé — čas načtení je vidět a po 3 h varuje', () => {
  const kt = readFileSync(WIDGET_KT, 'utf8');
  assert.match(kt, /STARE_MS = 3 \* 60 \* 60 \* 1000L/);
  assert.match(kt, /"⚠ \$cas"/, 'stará data musí mít výstrahu u času');
  assert.match(kt, /h\.optLong\("ms"\) <= ted\) continue/, 'uplynulé hodiny se nesmí ukazovat');
  assert.match(kt, /optLong\("vetaDo"/, 'věta o srážkách se po své platnosti nesmí opakovat');
});

test('🚨 bez widgetu na ploše se nic nestahuje', () => {
  const kt = readFileSync(WIDGET_KT, 'utf8');
  const prace = /class ObnovaWidgetu[\s\S]*?override suspend fun doWork\(\): Result \{([\s\S]*?)\n        \}/.exec(kt)?.[1] || '';
  assert.match(prace.split('\n').slice(0, 4).join('\n'), /if \(!maWidgety\(ctx\)\) return Result\.success\(\)/,
    'kdo widget nemá, nesmí kvůli němu platit baterií ani daty');
  assert.match(kt, /override fun onDisabled[^\n]*Widget\.zrus/, 'po odebrání posledního widgetu se obnova ruší');
});

test('widget je v manifestu, neveřejný, a po restartu ho obnoví WorkManager', () => {
  const manifest = readFileSync(MANIFEST, 'utf8');
  assert.match(manifest, /<receiver android:name="\.PocasiWidget" android:exported="false">[\s\S]*?APPWIDGET_UPDATE[\s\S]*?@xml\/widget_pocasi_info/);
  const info = readFileSync(join(RES, 'xml', 'widget_pocasi_info.xml'), 'utf8');
  // Stohování se systémovým počasím (Samsung) chce tutéž mřížku: 4 × 2.
  assert.match(info, /targetCellWidth="4"/);
  assert.match(info, /targetCellHeight="2"/);
  assert.match(info, /resizeMode="horizontal\|vertical"/, 'bez změny velikosti nejde na 4 × 1');
  assert.match(info, /updatePeriodMillis="0"/, 'obnovu řídí WorkManager, ne systém');
});

test('🚨 anglické texty obalu drží krok s českými', () => {
  const jmena = (cesta) => [...readFileSync(cesta, 'utf8').matchAll(/<string name="(\w+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(jmena(join(RES, 'values-en', 'strings.xml')), jmena(join(RES, 'values', 'strings.xml')));
});

test('🚨 web posílá widgetu POSLEDNÍ POLOHU i se jménem (R25)', () => {
  const app = readFileSync(join(WEB, 'app.js'), 'utf8');
  const fn = /function zapisWidget\(\) \{([\s\S]*?)\n\}/.exec(app)?.[1] || '';
  assert.match(fn, /isUsablePoint\(state\.fix\)\s*\?/, 'poloha telefonu má přednost před místem z meteostanice');
  assert.match(fn, /nastavWidget\(bod\.lat, bod\.lon, bod\.name/, 'bez jména by widget nepoznal, pro jaké místo je');
});

test('🚨 značka DONATE-COMEBACK visí jen na daru, ne na zprávách', () => {
  // Do 22. 9. 2026 byla omylem u `zapisZpravy()`: podle ní by se po návratu
  // daru smazal řádek, bez kterého ranní zprávy po reinstalaci přestanou chodit.
  const app = readFileSync(join(WEB, 'app.js'), 'utf8');
  const kodove = app.split('\n').filter((r) => r.includes('DONATE-COMEBACK') && !/^\s*(\*|\/\/)/.test(r));
  assert.ok(kodove.length > 0, 'značka z kódu zmizela úplně');
  for (const r of kodove) assert.match(r, /schovejDarVObalu/, `značka na cizím řádku: ${r.trim()}`);
});

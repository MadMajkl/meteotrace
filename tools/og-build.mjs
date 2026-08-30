/**
 * Vyrobí náhledový obrázek pro sdílení (Open Graph, 1200 × 630).
 *
 *     npm run og
 *
 * 🚨 PROČ VŮBEC. Bez něj je odkaz poslaný do Messengeru nebo na LinkedIn
 * holý řádek textu — a odkaz bez náhledu nikdo neotevře. Favicon na tohle
 * nestačí: je to čtvereček 32 px, sdílený náhled chce 1200 × 630.
 *
 * ⚠️ Kreslí to Chrome ze stránky, ne knihovna. Týž most jako u ikon
 * (`icons-build.mjs`) a u screenshotů — jedna závislost míň a výsledek
 * vypadá přesně tak, jak by to vypadalo v prohlížeči.
 *
 * ⚠️ Obrázek je STATICKÝ soubor v repu, ne něco, co se generuje za běhu.
 * Facebook si ho tahá vlastním robotem, který JavaScript nespouští.
 */

'use strict';

import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

import { withPage } from './browser.mjs';

const zde = dirname(fileURLToPath(import.meta.url));
const KOREN = join(zde, '..');
const CIL = join(KOREN, 'web', 'icons');

const SIRKA = 1200;
const VYSKA = 630;

/**
 * Stránka, ze které se snímek pořizuje.
 *
 * ⚠️ Barvy a značka se drží appky: tentýž modrý akcent, tentýž kosočtverec.
 * Náhled, který vypadá jako z jiné aplikace, je horší než žádný — člověk
 * si ho s ní nespojí.
 *
 * ⚠️ Písmo je systémové, ne stažené. Robot obrázek nevidí, vidí ho člověk
 * v náhledu — a čekat na webfont kvůli jedné kresbě by znamenalo riskovat,
 * že se vykreslí něčím jiným, než čekáme.
 */
function stranka(znackaSvg) {
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${SIRKA}px; height: ${VYSKA}px;
    display: flex; flex-direction: column; justify-content: center;
    /* ⚠️ Relativní pozice kvůli patičce: bez ní se absolutně umístěná
       adresa váže k oknu a položí se přes podtitulek. Chyceno na prvním
       vygenerovaném snímku.
       ⚠️ A žádné zpětné apostrofy v tomhle komentáři — celá stránka je
       template literal a ukončily by ho. */
    position: relative;
    padding: 0 90px;
    font: 16px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #e8eef5;
    background:
      radial-gradient(120% 90% at 12% 0%, rgba(85, 176, 245, .30), transparent 58%),
      radial-gradient(80% 70% at 100% 100%, rgba(85, 176, 245, .16), transparent 55%),
      #0f151c;
  }
  .znacka { display: flex; align-items: center; gap: 18px; margin-bottom: 34px; }
  .znacka svg { width: 76px; height: 76px; }
  .jmeno { font-size: 54px; font-weight: 700; letter-spacing: -.02em; }
  h1 { font-size: 62px; line-height: 1.12; font-weight: 700; letter-spacing: -.02em; max-width: 940px; }
  p { margin-top: 22px; font-size: 28px; line-height: 1.4; color: #93a2b2; max-width: 900px; }
  .pata { position: absolute; left: 90px; bottom: 48px; font-size: 24px; color: #55b0f5; font-weight: 600; }
</style></head><body>
  <div class="znacka">${znackaSvg}<span class="jmeno">MeteoTrace</span></div>
  <h1>Počasí v každém bodě cesty</h1>
  <p>V čase, kdy tam doopravdy dorazíš. A meteostanice pro tvoje místo.</p>
  <span class="pata">meteotrace.com</span>
</body></html>`;
}

async function main() {
  const svg = readFileSync(join(CIL, 'icon.svg'), 'utf8');

  const docasny = join(tmpdir(), `mt-og-${Date.now()}`);
  mkdirSync(docasny, { recursive: true });
  const html = join(docasny, 'og.html');
  writeFileSync(html, stranka(svg), 'utf8');

  try {
    const data = await withPage(pathToFileURL(html).href, async (s) => {
      const out = await s.send('Page.captureScreenshot', {
        format: 'png',
        // ⚠️ Přesný výřez, ne „celá stránka": rozměr 1200 × 630 je to,
        // co sdílecí služby čekají, a jiný poměr ořežou po svém.
        clip: { x: 0, y: 0, width: SIRKA, height: VYSKA, scale: 1 },
        captureBeyondViewport: true,
      });
      return out.data;
    }, { width: SIRKA, height: VYSKA, webgl: false });

    if (!data) throw new Error('Prohlížeč snímek nevrátil.');
    const bajty = Buffer.from(data, 'base64');
    writeFileSync(join(CIL, 'og.png'), bajty);
    console.log(`Hotovo → web/icons/og.png (${SIRKA} × ${VYSKA}, ${Math.round(bajty.length / 1024)} kB)`);
  } finally {
    try { rmSync(docasny, { recursive: true, force: true }); } catch { /* uklidí se příště */ }
  }
}

main().catch((e) => {
  console.error('CHYBA:', e.message);
  process.exit(1);
});

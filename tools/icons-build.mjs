/**
 * Vyrobí ikony appky z jedné vektorové předlohy.
 *
 * ⚠️ JEDNORÁZOVÝ KROK, ne součást běhu: `npm run icons`. Výsledné PNG se
 * commitují, protože prohlížeč je potřebuje hned při instalaci na plochu
 * a Safari na iPhonu **SVG jako ikonu nepřijme**.
 *
 * ⚠️ Žádná knihovna na obrázky (`R0`). Kreslí se Chromem, který v systému
 * stejně je — týž most jako u screenshotů a měření mapy.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 MASKOVATELNÁ IKONA NENÍ TÁŽ IKONA JEN VĚTŠÍ.
 *
 * Android si ikonu ořízne do tvaru, který si uživatel zvolil (kruh, čtverec
 * se zaoblením, kapka). Bezpečná je jen vnitřní kružnice o průměru 80 %
 * plochy — co je za ní, může zmizet. Kresba se proto u `maskable` zmenší,
 * aby se do bezpečné zóny vešla celá.
 *
 * Kdyby se použila táž ikona, přišla by kapka na kruhové masce o špičku
 * a nikdo by nevěděl proč.
 * ────────────────────────────────────────────────────────────────────────
 */

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { withPage } from './browser.mjs';

const KOREN = resolve(import.meta.dirname, '..');
const PREDLOHA = join(KOREN, 'web', 'icons', 'icon.svg');
const CIL = join(KOREN, 'web', 'icons');

/**
 * Co se vyrábí.
 *
 * `zmenseni` je podíl plochy, který kresba zabere — u maskovatelné ikony
 * se nechává okraj, viz poznámka nahoře.
 */
const IKONY = [
  { soubor: 'icon-192.png', px: 192, zmenseni: 1 },
  { soubor: 'icon-512.png', px: 512, zmenseni: 1 },
  { soubor: 'icon-maskable-512.png', px: 512, zmenseni: 0.68 },
  // iPhone: Safari chce PNG a nemá rád průhlednost — pozadí je plné.
  { soubor: 'apple-touch-icon.png', px: 180, zmenseni: 0.86 },
];

/** Stránka, ze které se fotí: jedna ikona přes celé okno, nic víc. */
function stranka(svg, px, zmenseni) {
  const okraj = Math.round((px * (1 - zmenseni)) / 2);
  return `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: #1A7FD4; }
  .ram { width: ${px}px; height: ${px}px; display: grid; place-items: center; }
  svg { width: ${px - 2 * okraj}px; height: ${px - 2 * okraj}px; display: block; }
</style>
<div class="ram">${svg}</div>`;
}

async function main() {
  const svg = readFileSync(PREDLOHA, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
  mkdirSync(CIL, { recursive: true });
  const docasny = mkdtempSync(join(tmpdir(), 'mt-icons-'));

  for (const ikona of IKONY) {
    const html = join(docasny, `${ikona.soubor}.html`);
    writeFileSync(html, stranka(svg, ikona.px, ikona.zmenseni), 'utf8');

    const data = await withPage(pathToFileURL(html).href, async (s) => {
      await s.send('Page.enable');
      // ⚠️ `captureBeyondViewport: false` — jinak Chrome přifoukne obrázek
      // podle výšky dokumentu a ikona vyjde obdélníková.
      const { data: base64 } = await s.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: ikona.px, height: ikona.px, scale: 1 },
        captureBeyondViewport: false,
      });
      return base64;
    }, { width: ikona.px, height: ikona.px, webgl: false, timeoutMs: 30000 });

    if (!data) throw new Error(`Prohlížeč nevrátil ${ikona.soubor}`);
    const bajty = Buffer.from(data, 'base64');
    writeFileSync(join(CIL, ikona.soubor), bajty);
    console.log(`  ✓ ${ikona.soubor.padEnd(24)} ${ikona.px}×${ikona.px} px, ${(bajty.length / 1024).toFixed(1)} kB`);
  }

  rmSync(docasny, { recursive: true, force: true });
  console.log('\nHotovo — ikony jsou ve web/icons/.');
}

main().catch((e) => {
  console.error('Ikony se nepovedly:', e.message);
  process.exitCode = 1;
});

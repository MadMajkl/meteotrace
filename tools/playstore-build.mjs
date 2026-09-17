/**
 * Podklady do Google Play: snímky obrazovky a grafika záznamu.
 *
 *     npm run playstore            (vývojový server musí běžet)
 *
 * ⚠️ Kreslí to Chrome ze SKUTEČNÉ APPKY, ne z návrhu. Ručně poskládaný
 * obrázek by za měsíc ukazoval něco, co v appce není — a to je podle
 * pravidel Play důvod k zamítnutí („zavádějící snímky").
 *
 * 🚨 ŠÍŘKU OKNA POD ~500 px HEADLESS CHROME NEVEZME. Zjištěno 17. 9. 2026:
 * `withPage(..., { width: 320 })` vrátí okno 500 px a měření mlčky lže.
 * Telefonní rozměr se proto nastavuje přes `Emulation.setDeviceMetricsOverride`
 * — ten dá výřez 360 × 640 bodů a při `deviceScaleFactor: 3` rovnou
 * 1080 × 1920 pixelů ve snímku.
 *
 * ⚠️ Snímky potřebují SÍŤ: trasa i předpověď se doopravdy stahují. Když
 * appka data nedostane, skript to řekne a NEULOŽÍ poloprázdný obrázek.
 */

'use strict';

import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

import { withPage } from './browser.mjs';

const zde = dirname(fileURLToPath(import.meta.url));
const KOREN = join(zde, '..');
const CIL = join(KOREN, 'android', 'playstore');
const PORT = process.env.PORT || 8099;
const APPKA = `http://127.0.0.1:${PORT}/`;

/** Telefon: 360 × 640 bodů při trojnásobné hustotě = 1080 × 1920 pixelů. */
const SIRKA = 360;
const VYSKA = 640;
const HUSTOTA = 3;

/* ── ukázková data ───────────────────────────────────────────────────── */

const PLZEN = { name: 'Plzeň', country: 'Česko', lat: 49.7475, lon: 13.3776 };
const PRAHA = { name: 'Praha', country: 'Česko', lat: 50.0880, lon: 14.4208 };
const HORSOVSKY_TYN = { name: 'Horšovský Týn', country: 'Česko', lat: 49.5307, lon: 12.9436 };

/** Zítřek v osm — ať je na snímku vidět, že jde naplánovat odjezd (R26). */
function zitraOsm() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

function ulozeno(extra) {
  return JSON.stringify({
    onboardingHotovo: true, langManual: 'cs', lang: 'cs', theme: 'dark',
    ...extra,
  });
}

/* ── pomocné ─────────────────────────────────────────────────────────── */

const cekej = (vyraz, ms = 90000) => `new Promise((res)=>{const t0=Date.now();const t=()=>{
  let v; try { v = (${vyraz}); } catch (e) {}
  if (v) return res(v);
  if (Date.now()-t0>${ms}) return res(null);
  setTimeout(t, 300);};t();})`;

const pockej = (ms) => `new Promise((r)=>setTimeout(r, ${ms}))`;

/**
 * Vyfotí VIDITELNOU část obrazovky a ověří, že je na ní to, co má.
 *
 * 🚨 ŽÁDNÝ `clip` ANI `captureBeyondViewport`. Napoprvé tam byly — a fotily
 * od začátku DOKUMENTU, takže „snímek mapy" i „snímek bodů po cestě" byly
 * ve skutečnosti třikrát tentýž vršek stránky. Nástroj přitom hlásil úspěch
 * a soubory měly správný rozměr. Bez `clip`u se fotí výřez okna, tedy to,
 * co je opravdu vidět, a `deviceScaleFactor` udělá 1080 × 1920 sám.
 *
 * ⚠️ `musiBytVidet` není zdvořilost: snímek do obchodu, na kterém chybí to
 * hlavní, je podle pravidel Play zavádějící — a poznalo by se to až tam.
 */
async function snimek(s, jmeno, musiBytVidet) {
  if (musiBytVidet) {
    const stav = await s.eval(`(()=>{
      const e = document.querySelector(${JSON.stringify(musiBytVidet)});
      if (!e) return { proc: 'prvek na stránce není' };
      const r = e.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return { proc: 'prvek má nulovou velikost' };
      const videt = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
      return videt ? { ok: 1 } : { proc: 'prvek je mimo obrazovku (' + Math.round(r.top) + ' px)' };
    })()`);
    if (!stav?.ok) throw new Error(`${jmeno}: ${musiBytVidet} — ${stav?.proc || 'nešlo změřit'}`);
  }

  const out = await s.send('Page.captureScreenshot', { format: 'png' });
  if (!out?.data) throw new Error(`snímek ${jmeno} se nepořídil`);
  const bajty = Buffer.from(out.data, 'base64');
  writeFileSync(join(CIL, jmeno), bajty);
  console.log(`  ${jmeno}  (${SIRKA * HUSTOTA} × ${VYSKA * HUSTOTA}, ${Math.round(bajty.length / 1024)} kB)`);
}

/** Doroluje k prvku a počká, až se rolování zastaví. */
async function doroluj(s, selektor, odsazeni = 0) {
  await s.eval(`(()=>{
    const e = document.querySelector(${JSON.stringify(selektor)});
    if (!e) return 0;
    const r = e.getBoundingClientRect();
    window.scrollBy({ top: r.top - ${odsazeni}, behavior: 'instant' });
    return 1;
  })()`);
  await s.eval(pockej(900));
}

/**
 * Předstírá androidí obal.
 *
 * 🚨 Snímky do obchodu musí ukazovat to, co uvidí TESTER V APPCE — a ta se
 * od webu liší: dar je v ní do schválení schovaný (`R27`). Snímek se zlatou
 * mincí, která v appce není, je podle pravidel Play zavádějící.
 *
 * ⚠️ Most musí být ve stránce dřív, než se appka spustí, proto
 * `addScriptToEvaluateOnNewDocument` a ne `eval` po načtení.
 */
async function predstirejObal(s) {
  await s.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.MeteoTraceObal = {
      umiUpozorneni: () => true, majiPovoleni: () => false,
      zadejOPovoleni() {}, hlidejVystrahy() {}, nehlidejVystrahy() {},
    };`,
  });
}

/** Nastaví úložiště a načte appku znovu, aby se stav projevil. */
async function nastav(s, stav) {
  await s.eval(`(()=>{ localStorage.setItem('meteotrace.v1', ${JSON.stringify(stav)}); location.reload(); return 1; })()`);
  const hotovo = await s.eval(cekej(`document.getElementById('btn-settings') && !document.getElementById('app')?.hidden !== undefined`));
  if (!hotovo) throw new Error('appka se nenačetla');
  await s.eval(pockej(1200));
}

/* ── snímky ──────────────────────────────────────────────────────────── */

async function snimkyTrasy() {
  await withPage(APPKA, async (s) => {
    await s.send('Emulation.setDeviceMetricsOverride', {
      width: SIRKA, height: VYSKA, deviceScaleFactor: HUSTOTA, mobile: true,
    });
    await predstirejObal(s);

    await nastav(s, ulozeno({
      primary: 'route',
      route: { from: PLZEN, to: PRAHA, via: [], profil: 'driving-car', odjezdMs: zitraOsm() },
    }));

    await s.eval(`(()=>{ document.getElementById('route-go').click(); return 1; })()`);
    const hotovo = await s.eval(cekej(`!document.getElementById('route-summary-card').hidden && document.getElementById('route-summary').textContent`));
    if (!hotovo) throw new Error('trasa se nespočítala — běží vývojový server a je síť?');
    await s.eval(pockej(2500));

    await s.eval(`(()=>{ window.scrollTo(0, 0); return 1; })()`);
    await snimek(s, '01-trasa.png', '#route-summary');

    // Mapa s trasou: doroluje se k ní a počká se, až MapLibre dokreslí.
    await s.eval(cekej(`document.querySelector('#map canvas')`, 30000));
    await doroluj(s, '#map', 120);
    await s.eval(pockej(4000));
    await snimek(s, '03-mapa.png', '#map canvas');

    // Body po cestě.
    await doroluj(s, '#route-points-card', 60);
    await snimek(s, '02-body.png', '#route-points .route-point');
  }, { timeoutMs: 240000, width: 520, height: 900 });
}

async function snimkyStanice() {
  await withPage(APPKA, async (s) => {
    await s.send('Emulation.setDeviceMetricsOverride', {
      width: SIRKA, height: VYSKA, deviceScaleFactor: HUSTOTA, mobile: true,
    });
    await predstirejObal(s);

    await nastav(s, ulozeno({ primary: 'station', place: HORSOVSKY_TYN }));

    const mameData = await s.eval(cekej(`document.querySelector('#now-temp')?.textContent?.trim()`));
    if (!mameData) throw new Error('meteostanice nenačetla data');
    await s.eval(pockej(2500));

    await s.eval(`(()=>{ window.scrollTo(0, 0); return 1; })()`);
    await snimek(s, '04-stanice.png', '#now-temp');

    await s.eval(cekej(`document.querySelector('#map canvas')`, 30000));
    await doroluj(s, '#map', 120);
    await s.eval(pockej(4500));
    await snimek(s, '05-radar.png', '#map canvas');
  }, { timeoutMs: 240000, width: 520, height: 900 });
}

/* ── grafika záznamu ─────────────────────────────────────────────────── */

const G_SIRKA = 1024;
const G_VYSKA = 500;

/**
 * Hlavičková grafika obchodu.
 *
 * ⚠️ Text je krátký schválně: Play ji zmenšuje do dlaždice a delší věta
 * se v ní nedá přečíst. Barvy a značka jsou tytéž jako u náhledu sdílení
 * (`og-build.mjs`) — jedna appka, jeden vzhled.
 */
function grafikaHtml(znackaSvg) {
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${G_SIRKA}px; height: ${G_VYSKA}px;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 72px;
    font: 16px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #e8eef5;
    background:
      radial-gradient(120% 90% at 10% 0%, rgba(85, 176, 245, .32), transparent 58%),
      radial-gradient(80% 70% at 100% 100%, rgba(246, 197, 68, .18), transparent 55%),
      #0f151c;
  }
  .znacka { display: flex; align-items: center; gap: 16px; margin-bottom: 26px; }
  .znacka svg { width: 64px; height: 64px; }
  .jmeno { font-size: 46px; font-weight: 700; letter-spacing: -.02em; }
  h1 { font-size: 48px; line-height: 1.14; font-weight: 700; letter-spacing: -.02em; max-width: 820px; }
  p { margin-top: 16px; font-size: 24px; color: #93a2b2; }
</style></head><body>
  <div class="znacka">${znackaSvg}<span class="jmeno">MeteoTrace</span></div>
  <h1>Počasí v každém bodě cesty</h1>
  <p>V čase, kdy tam doopravdy dorazíš.</p>
</body></html>`;
}

async function grafika() {
  const svg = readFileSync(join(KOREN, 'web', 'icons', 'icon.svg'), 'utf8');
  const docasny = join(tmpdir(), `mt-play-${Date.now()}`);
  mkdirSync(docasny, { recursive: true });
  const html = join(docasny, 'feature.html');
  writeFileSync(html, grafikaHtml(svg), 'utf8');
  try {
    await withPage(pathToFileURL(html).href, async (s) => {
      const out = await s.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: G_SIRKA, height: G_VYSKA, scale: 1 },
        captureBeyondViewport: true,
      });
      if (!out?.data) throw new Error('grafika se nepořídila');
      const bajty = Buffer.from(out.data, 'base64');
      writeFileSync(join(CIL, 'feature-1024x500.png'), bajty);
      console.log(`  feature-1024x500.png  (${G_SIRKA} × ${G_VYSKA}, ${Math.round(bajty.length / 1024)} kB)`);
    }, { width: G_SIRKA, height: G_VYSKA, webgl: false, timeoutMs: 60000 });
  } finally {
    try { rmSync(docasny, { recursive: true, force: true }); } catch { /* uklidí se příště */ }
  }
}

async function main() {
  mkdirSync(CIL, { recursive: true });
  console.log(`Podklady do Play → android/playstore/`);
  await snimkyTrasy();
  await snimkyStanice();
  await grafika();
  console.log('\nHotovo. Ikona do obchodu je web/icons/icon-512.png.');
}

main().catch((e) => {
  console.error('CHYBA:', e.message);
  console.error('Běží vývojový server? (npm run dev)');
  process.exit(1);
});

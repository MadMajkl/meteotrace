/**
 * Samotest ikony: vejde se kresba do bezpečné zóny adaptivní ikony?
 *
 * Spuštění:  npm run selftest:logic
 *
 * 🚨 PROČ TENHLE TEST VZNIKL (23. 9. 2026)
 *
 * Adaptivní ikonu Androidu ořezává maska, kterou si volí výrobce telefonu —
 * kruh, čtverec se zaoblením, kapka. Zaručeně vidět je jen vnitřní kruh
 * o průměru 66 ze 108. Kresba se do 23. 9. 2026 do zóny jen ZMENŠOVALA
 * měřítkem 0,78, jenže to nestačilo: konec trasy ležel na poloměru ~41
 * a špička horního paprsku na ~49. Michal: *„ta ikona v Androidu je nějaká
 * usekaná."* A poznat to šlo jen na telefonu — kompilátor mlčí, oko na
 * čtvercovém náhledu taky.
 *
 * ⚠️ Test si souřadnice NEOPISUJE, ale ČTE je z obou souborů a dopočítává
 * i poloviny tahů a kulatá zakončení, která přesahují za koncový bod.
 * Opsaná tabulka čísel by se s kresbou rozešla při první úpravě.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOREN = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = join(KOREN, 'web', 'icons', 'icon.svg');
const VEKTOR = join(KOREN, 'android', 'app', 'src', 'main', 'res', 'drawable', 'ic_launcher_foreground.xml');

/** Střed plátna a poloměr, do kterého se musí vejít všechno. */
const STRED = 54;
const ZONA = 33;

/* ── čtení tvarů ──────────────────────────────────────────────────────── */

/**
 * Body na kubice. Vzorkuje se, protože oblouk může vyjet dál než jeho
 * koncové body — a právě tam se kresba o masku ořeže.
 */
function kubika(x0, y0, x1, y1, x2, y2, x3, y3) {
  const body = [];
  for (let i = 0; i <= 50; i += 1) {
    const t = i / 50;
    const u = 1 - t;
    body.push([
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    ]);
  }
  return body;
}

/**
 * Body tvaru z `pathData` / `d`. Umí jen to, co naše ikony používají:
 * `M`, `L`, `C`, `A` (kruh dvěma oblouky) a `Z`, všechno v absolutních
 * souřadnicích. 🚨 Kdyby někdo do kresby napsal relativní příkaz (`m`, `c`),
 * test to musí poznat, ne tiše spočítat nesmysl — proto ta poslední kontrola.
 */
function bodyCesty(d) {
  assert.ok(!/[mlcazsqth]/.test(d.replace(/[A-Z]/g, '')),
    `cesta používá relativní příkaz, tomu tenhle test nerozumí: ${d}`);
  const cisla = (s) => s.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const kusy = d.match(/[MLCAZ][^MLCAZ]*/g) || [];
  const body = [];
  let x = 0; let y = 0;
  for (const kus of kusy) {
    const prikaz = kus[0];
    const n = cisla(kus.slice(1));
    if (prikaz === 'M' || prikaz === 'L') {
      [x, y] = n;
      body.push([x, y]);
    } else if (prikaz === 'C') {
      body.push(...kubika(x, y, n[0], n[1], n[2], n[3], n[4], n[5]));
      [x, y] = [n[4], n[5]];
    } else if (prikaz === 'A') {
      // Náš kruh: `A r,r 0 1,1 x,y` — druhý oblouk se vrací zpátky.
      const r = n[0];
      const [kx, ky] = [n[5], n[6]];
      const [sx, sy] = [(x + kx) / 2, (y + ky) / 2];
      body.push([sx - r, sy], [sx + r, sy], [sx, sy - r], [sx, sy + r]);
      [x, y] = [kx, ky];
    }
  }
  return body;
}

/** Nejdál položený inkoust od středu — i s polovinou tahu (kulaté konce). */
function dosah(tvary) {
  let max = 0;
  for (const { body, tah } of tvary) {
    for (const [x, y] of body) {
      max = Math.max(max, Math.hypot(x - STRED, y - STRED) + tah / 2);
    }
  }
  return max;
}

/** Tvary z androidího vektoru. */
function zVektoru() {
  const xml = readFileSync(VEKTOR, 'utf8');
  return [...xml.matchAll(/<path\b[\s\S]*?\/>/g)].map((m) => {
    const kus = m[0];
    const d = /android:pathData="([^"]+)"/.exec(kus)?.[1];
    assert.ok(d, 'cesta bez pathData');
    const tah = Number(/android:strokeWidth="([\d.]+)"/.exec(kus)?.[1] || 0);
    return { body: bodyCesty(d), tah };
  });
}

/** Tvary z webového SVG (kolečko slunce je `<circle>`, zbytek `<path>`). */
function zeSvg() {
  const svg = readFileSync(SVG, 'utf8');
  const tvary = [];

  for (const m of svg.matchAll(/<circle[^>]*\/>/g)) {
    const cx = Number(/cx="([\d.]+)"/.exec(m[0])[1]);
    const cy = Number(/cy="([\d.]+)"/.exec(m[0])[1]);
    const r = Number(/r="([\d.]+)"/.exec(m[0])[1]);
    tvary.push({ body: [[cx - r, cy], [cx + r, cy], [cx, cy - r], [cx, cy + r]], tah: 0 });
  }

  // ⚠️ Tah může být na skupině (paprsky) i na samotné cestě (trasa).
  for (const skupina of svg.matchAll(/<g[^>]*stroke-width="([\d.]+)"[^>]*>([\s\S]*?)<\/g>/g)) {
    const tah = Number(skupina[1]);
    for (const p of skupina[2].matchAll(/<path[^>]*d="([^"]+)"/g)) {
      tvary.push({ body: bodyCesty(p[1]), tah });
    }
  }
  for (const p of svg.matchAll(/<path(?![^>]*\/defs)[^>]*d="([^"]+)"[^>]*stroke-width="([\d.]+)"/g)) {
    tvary.push({ body: bodyCesty(p[1]), tah: Number(p[2]) });
  }

  return tvary;
}

/* ── kontroly ─────────────────────────────────────────────────────────── */

test('🚨 kresba ikony se vejde do bezpečné zóny (kruh r=33)', () => {
  const vektor = dosah(zVektoru());
  assert.ok(vektor <= ZONA,
    `androidí kresba sahá do ${vektor.toFixed(1)} ze 108 — maska ji ořízne (zóna je ${ZONA})`);

  const svg = dosah(zeSvg());
  assert.ok(svg <= ZONA, `web má kresbu do ${svg.toFixed(1)}, zóna je ${ZONA}`);
});

test('🚨 ikona není zbytečně malá — zóna se má využít', () => {
  // Druhá strana téže mince: kdyby se kresba při opravě „usekávání" jen
  // zmenšila, ikona by na ploše zmizela mezi ostatními. Materiál doporučuje
  // klíčový tvar kolem 66 ze 108, tak ať jsme aspoň na třech čtvrtinách zóny.
  const vektor = dosah(zVektoru());
  assert.ok(vektor >= ZONA * 0.75,
    `kresba sahá jen do ${vektor.toFixed(1)} — ikona bude na ploše drobná`);
});

test('🚨 web a Android kreslí TOTÉŽ', () => {
  // Jinak má appka jinou ikonu na ploše telefonu než v prohlížeči — a nikdo
  // si toho nevšimne, dokud je neuvidí vedle sebe.
  assert.equal(dosah(zeSvg()).toFixed(2), dosah(zVektoru()).toFixed(2), 'kresby se rozešly');

  const svg = readFileSync(SVG, 'utf8');
  const xml = readFileSync(VEKTOR, 'utf8');
  for (const cesta of ['M54,27.5 L54,24.5', 'M34,70.5 C45.5,70.5 47,63 54,63 C61,63 62.5,70.5 74,70.5']) {
    assert.ok(svg.includes(cesta), `SVG nemá cestu ${cesta}`);
    assert.ok(xml.includes(cesta), `vektor nemá cestu ${cesta}`);
  }
  assert.ok(svg.includes('#FFC83D') && xml.includes('#FFC83D'), 'slunce má být zlaté v obou');
});

test('🚨 obloha: světlá patří DOLŮ a barvy sedí s webem', () => {
  const pozadi = readFileSync(join(KOREN, 'android', 'app', 'src', 'main', 'res',
    'drawable', 'ic_launcher_pozadi.xml'), 'utf8');
  const svg = readFileSync(SVG, 'utf8');

  const barvy = [...pozadi.matchAll(/android:color="(#[0-9A-F]{6})"/g)].map((m) => m[1]);
  assert.deepEqual(barvy, ['#0C4A83', '#125C97', '#3888D0'], 'barvy oblohy se změnily');
  for (const b of barvy) assert.ok(svg.includes(b), `web nemá barvu oblohy ${b}`);

  // Jas poslední barvy musí být vyšší než první: obráceně by to bylo
  // zatažené nebe nad světlou zemí, ne obloha.
  const jas = (hex) => {
    const kanal = (i) => {
      const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * kanal(0) + 0.7152 * kanal(1) + 0.0722 * kanal(2);
  };
  assert.ok(jas(barvy[2]) > jas(barvy[0]) * 2, 'dole má obloha svítit, jinak to není nebe');

  // 🚨 A kontrast zlatého slunce na HORNÍ barvě musí vydržet — kvůli němu
  // bylo pozadí 27. 8. 2026 ztmaveno (na 16 px byla ze slunce jinak skvrna).
  const pomer = (a, b) => (Math.max(jas(a), jas(b)) + 0.05) / (Math.min(jas(a), jas(b)) + 0.05);
  assert.ok(pomer('#FFC83D', barvy[0]) >= 4.5,
    `zlaté slunce má na horní modré jen ${pomer('#FFC83D', barvy[0]).toFixed(2)} : 1`);
  assert.ok(pomer('#FFFFFF', barvy[2]) >= 3.5,
    `bílá trasa má na spodní modré jen ${pomer('#FFFFFF', barvy[2]).toFixed(2)} : 1`);
});

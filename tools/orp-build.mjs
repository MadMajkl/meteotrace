/**
 * Stáhne hranice ORP a přeloží je do podoby, kterou appka umí číst.
 *
 * ⚠️ TENHLE NÁSTROJ SE NESPOUŠTÍ ZA BĚHU. Pouští se ručně, když je potřeba
 * data obnovit (hranice ORP se mění řádově jednou za rok). Výstupem je
 * `web/data/orp-boundaries.js` — soubor, který od té chvíle **vlastníme**,
 * takže appka za běhu na ČÚZK nesahá a nezávisí na jeho dostupnosti (R0).
 *
 *     node tools/orp-build.mjs
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ ORP A PROČ ZROVAN Z ČÚZK
 *
 * Výstrahy z MeteoAlarmu neobsahují geometrii — rozsah výstrahy je napsaný
 * jen slovy, jako „Ústecký kraj (Litoměřice, Louny)". Aby appka uměla říct
 * „ve 120. kilometru trasy platí výstraha před bouřkou", musí umět z bodu
 * na trase určit ORP a kraj. K tomu jsou potřeba hranice.
 *
 * Zdrojem je RÚIAN (ČÚZK) — státní registr, který je pro hranice ORP
 * **definiční**, ne odvozený. OpenStreetMap má sice `admin_level=7`, jenže
 * to jsou **SO POÚ, ne ORP** (jiné a jemnější dělení), a oficiální kódy
 * u nich nejsou. Viz R11.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RUIAN = 'https://ags.cuzk.cz/arcgis/rest/services/RUIAN/MapServer';

/**
 * Zjednodušení hranic v úhlových stupních. 0.001° je zhruba 100 m.
 *
 * Proč tolik: předpověď i výstraha platí pro celé ORP, takže sto metrů
 * u hranice nemá na výsledek vliv — zato to zmenší data na třetinu. Přesnější
 * hranice by předstírala přesnost, kterou vstupní data nemají.
 */
const ZJEDNODUSENI = 0.001;

/** Souřadnice se ukládají jako celá čísla v desetitisícinách stupně (~11 m). */
const MERITKO = 10000;

const zde = dirname(fileURLToPath(import.meta.url));
const CIL = join(zde, '..', 'web', 'data', 'orp-boundaries.js');

async function dotaz(vrstva, params) {
  const qs = new URLSearchParams({ where: '1=1', f: 'json', ...params });
  const url = `${RUIAN}/${vrstva}/query?${qs}`;
  const odpoved = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!odpoved.ok) throw new Error(`ČÚZK vrstva ${vrstva}: HTTP ${odpoved.status}`);
  const data = await odpoved.json();
  if (data.error) throw new Error(`ČÚZK vrstva ${vrstva}: ${data.error.message}`);
  return data;
}

/**
 * Zabalí prstenec do plochého pole celých čísel s rozdílovým kódováním.
 *
 * Sousední body hranice jsou blízko sebe, takže rozdíly jsou malá čísla —
 * a malá čísla zaberou v JSONu podstatně míň místa než plné souřadnice.
 * Rozbalovač je v `web/lib/orp.js`; obě strany hlídá samotest.
 */
function zabalPrstenec(body) {
  const out = [];
  let x = 0;
  let y = 0;
  for (const [lon, lat] of body) {
    const nx = Math.round(lon * MERITKO);
    const ny = Math.round(lat * MERITKO);
    out.push(nx - x, ny - y);
    x = nx;
    y = ny;
  }
  return out;
}

function obalka(polygony) {
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const polygon of polygony) {
    for (const prstenec of polygon) {
      for (const [lon, lat] of prstenec) {
        if (lon < w) w = lon;
        if (lon > e) e = lon;
        if (lat < s) s = lat;
        if (lat > n) n = lat;
      }
    }
  }
  return [w, s, e, n].map((v) => Math.round(v * MERITKO));
}

async function main() {
  console.log('Stahuji okresy (kvůli přiřazení kraje)…');
  const okresy = await dotaz(15, { outFields: 'kod,nazev,vusc', returnGeometry: 'false' });

  console.log('Stahuji kraje…');
  const kraje = await dotaz(17, { outFields: 'kod,nazev', returnGeometry: 'false' });
  const krajPodleKodu = new Map(kraje.features.map((f) => [f.attributes.kod, f.attributes.nazev]));

  const krajPodleOkresu = new Map();
  for (const f of okresy.features) {
    const kraj = krajPodleKodu.get(f.attributes.vusc);
    if (!kraj) throw new Error(`Okres ${f.attributes.nazev} nemá kraj — data z ČÚZK nesedí.`);
    krajPodleOkresu.set(f.attributes.kod, kraj);
  }

  console.log('Stahuji hranice ORP…');
  const orp = await dotaz(14, {
    outFields: 'kod,nazev,okres,vusc',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: String(ZJEDNODUSENI),
    f: 'geojson',
  });

  const uzemi = [];
  for (const f of orp.features) {
    const g = f.geometry;
    if (!g) throw new Error(`ORP ${f.properties.nazev} nemá geometrii.`);
    const polygony = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    // ⚠️ Praha je výjimka: jako jediné ORP nemá okres (`okres: null`), zato má
    // kraj vyplněný přímo (`vusc`). U ostatních je to naopak. Kdyby se šlo jen
    // přes okres, vypadlo by z dat hlavní město — tedy ORP s největším provozem.
    const kraj = krajPodleKodu.get(f.properties.vusc) || krajPodleOkresu.get(f.properties.okres);
    if (!kraj) throw new Error(`ORP ${f.properties.nazev} nemá kraj — data z ČÚZK nesedí.`);

    uzemi.push({
      kod: f.properties.kod,
      nazev: f.properties.nazev,
      kraj,
      obalka: obalka(polygony),
      // Pořadí prstenců zůstává: první je vnější, další jsou díry.
      polygony: polygony.map((p) => p.map(zabalPrstenec)),
    });
  }

  uzemi.sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs'));

  // Kontrola, bez které by se chyba poznala až v provozu: jména ORP musí být
  // jedinečná. Výstrahy se přiřazují podle jména, takže dvě stejná jména by
  // znamenala výstrahu na nesprávném konci republiky.
  const jmena = new Set();
  for (const u of uzemi) {
    if (jmena.has(u.nazev)) throw new Error(`Dvě ORP se jménem „${u.nazev}" — přiřazení podle jména by nefungovalo.`);
    jmena.add(u.nazev);
  }

  const balik = {
    verze: 1,
    meritko: MERITKO,
    zjednoduseni: ZJEDNODUSENI,
    zdroj: 'RÚIAN / ČÚZK, vrstvy ObecSRozsirenouPusobnosti + Okres + VyssiUzemneSamospravnyCelek',
    staženo: new Date().toISOString().slice(0, 10),
    kraje: [...krajPodleKodu.values()].sort((a, b) => a.localeCompare(b, 'cs')),
    uzemi,
  };

  const json = JSON.stringify(balik);
  const soubor = `/**
 * Hranice ORP — VYGENEROVANÝ SOUBOR, NEEDITOVAT RUČNĚ.
 * Vyrábí ho \`node tools/orp-build.mjs\` z RÚIAN (ČÚZK). Viz R11.
 *
 * Data jsou uložená jako JSON v řetězci schválně: \`JSON.parse\` je řádově
 * rychlejší než vyhodnocení stejně velkého objektového literálu, a tenhle
 * soubor se načítá při každém studeném startu serverové funkce.
 */

export const ORP_DATA = JSON.parse(${JSON.stringify(json)});
`;

  writeFileSync(CIL, soubor, 'utf8');
  const kb = Math.round(Buffer.byteLength(soubor) / 1024);
  console.log(`Hotovo: ${uzemi.length} ORP, ${balik.kraje.length} krajů, ${kb} kB → ${CIL}`);
}

main().catch((e) => {
  console.error('CHYBA:', e.message);
  process.exit(1);
});

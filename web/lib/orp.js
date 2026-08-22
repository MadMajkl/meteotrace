/**
 * Přiřazení výstrahy k místu na trase.
 *
 * ⚠️ ČISTÝ MODUL BEZ ZÁVISLOSTÍ na DOM a na síti. Data (hranice) si volající
 * podá sám — modul si nic nestahuje. Díky tomu se dá celé přiřazování otestovat
 * bez jediného síťového volání.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ JE TENHLE MODUL VŮBEC POTŘEBA
 *
 * Výstrahy z MeteoAlarmu (R6) **neobsahují geometrii**. Nesou geokód `CISORP`,
 * takže se nabízí přiřazovat výstrahu k bodu podle kódu. **To je past.**
 * Ověřeno na skutečném feedu (22. 8. 2026, 318 výstrah):
 *
 *   - Každá výstraha má **jedinou** oblast s jediným kódem.
 *   - Týž kód `8122` nesl postupně „Moravskoslezský kraj" (celý kraj),
 *     „…(Bruntál, Krnov, Odry, Opava, Rýmařov, Vítkov)" (6 ORP) a další
 *     sadu o 19 ORP. Kód je tedy jen **zástupce** (abecedně poslední
 *     zasažené ORP), ne rozsah.
 *
 * Kdo by přiřazoval podle kódu, ukázal by výstrahu pro celý Ústecký kraj jen
 * lidem v Žatci a **na zbytek kraje by mlčel**. Skutečný rozsah je napsaný
 * jen slovy v `areaDesc` — proto se parsuje text a porovnává se jmény ORP.
 * Viz R11.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { distanceM } from './eta.js';

/**
 * Jak daleko od hranice se bod ještě přiřadí k nejbližšímu ORP.
 *
 * Hranice jsou zjednodušené (~100 m), takže sousední ORP na sebe po
 * zjednodušení přesně nenavazují — mezi nimi vznikají vlásečnicové mezery,
 * do kterých může bod na trase spadnout. Bez téhle rezervy by appka u takového
 * bodu **mlčela**, přestože výstraha platí.
 *
 * Vedlejší účinek je záměrný: bod kousek za státní hranicí dostane výstrahu
 * příhraničního ORP. Bouřka se na hranici nezastaví, takže je to spíš správně —
 * a je to lepší než tvrdit, že se nic neděje.
 */
const REZERVA_M = 1000;

/** Rozbalí prstenec z rozdílově kódovaných celých čísel na body `[lat, lon]`. */
function rozbalPrstenec(ploche, meritko) {
  const body = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < ploche.length; i += 2) {
    x += ploche[i];
    y += ploche[i + 1];
    // ⚠️ V balíku je pořadí [délka, šířka] (tak to dává GeoJSON), zbytek appky
    // používá [šířka, délka]. Prohození se dělá TADY, na jednom místě.
    body.push([y / meritko, x / meritko]);
  }
  return body;
}

/**
 * Rozbalí vygenerovaná data do podoby, se kterou se dá počítat.
 * Volá se jednou; výsledek si volající podrží.
 *
 * @param {object} data  obsah `web/data/orp-boundaries.js`
 * @returns {Array<{kod: number, nazev: string, kraj: string,
 *                  obalka: [number, number, number, number],
 *                  polygony: Array<Array<Array<[number, number]>>>}>}
 */
export function unpackAreas(data) {
  const meritko = data.meritko;
  return data.uzemi.map((u) => ({
    kod: u.kod,
    nazev: u.nazev,
    kraj: u.kraj,
    // Obálka taky do [jih, západ, sever, východ], ať se to nemusí přehazovat
    // při každém dotazu.
    obalka: [
      u.obalka[1] / meritko, u.obalka[0] / meritko,
      u.obalka[3] / meritko, u.obalka[2] / meritko,
    ],
    polygony: u.polygony.map((p) => p.map((r) => rozbalPrstenec(r, meritko))),
  }));
}

/** Leží bod v obálce, případně s rezervou ve stupních? */
function vObalce(point, obalka, rezervaStupne = 0) {
  const [lat, lon] = point;
  return lat >= obalka[0] - rezervaStupne && lat <= obalka[2] + rezervaStupne &&
         lon >= obalka[1] - rezervaStupne && lon <= obalka[3] + rezervaStupne;
}

/**
 * Leží bod uvnitř polygonu (vnější prstenec minus díry)?
 *
 * Paprskový test se sudo-lichým pravidlem: díra obrátí výsledek zpět ven, takže
 * se vnější prstenec i díry počítají jedním průchodem. Díry v ORP existují —
 * například Brno leží celé uvnitř ORP Šlapanice.
 */
function vPolygonu(point, polygon) {
  const [lat, lon] = point;
  let uvnitr = false;
  for (const prstenec of polygon) {
    for (let i = 0, j = prstenec.length - 1; i < prstenec.length; j = i++) {
      const [latI, lonI] = prstenec[i];
      const [latJ, lonJ] = prstenec[j];
      if ((latI > lat) !== (latJ > lat) &&
          lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI) {
        uvnitr = !uvnitr;
      }
    }
  }
  return uvnitr;
}

/** Vzdálenost bodu od úsečky v metrech. Na krátkých úsecích stačí rovinné přiblížení. */
function vzdalenostOdUsecky(point, a, b) {
  const dLat = b[0] - a[0];
  const dLon = b[1] - a[1];
  if (dLat === 0 && dLon === 0) return distanceM(point, a);
  // Podíl délky úsečky, kde leží nejbližší bod. Zeměpisná délka se u nás krátí
  // kosinem šířky, jinak by šikmé úseky vycházely delší, než jsou.
  const cos = Math.cos((point[0] * Math.PI) / 180);
  const px = (point[1] - a[1]) * cos;
  const py = point[0] - a[0];
  const ux = dLon * cos;
  const uy = dLat;
  const t = Math.max(0, Math.min(1, (px * ux + py * uy) / (ux * ux + uy * uy)));
  return distanceM(point, [a[0] + dLat * t, a[1] + dLon * t]);
}

/** Nejmenší vzdálenost bodu od hranice území, v metrech. */
function vzdalenostOdHranice(point, uzemi) {
  let nej = Infinity;
  for (const polygon of uzemi.polygony) {
    for (const prstenec of polygon) {
      for (let i = 1; i < prstenec.length; i++) {
        const d = vzdalenostOdUsecky(point, prstenec[i - 1], prstenec[i]);
        if (d < nej) nej = d;
      }
    }
  }
  return nej;
}

/**
 * Ke kterému ORP patří bod `[lat, lon]`?
 *
 * Vrací `null` pro bod mimo republiku (a dál než {@link REZERVA_M} od hranice) —
 * což je správně: české výstrahy se ho netýkají.
 *
 * @param {[number, number]} point
 * @param {ReturnType<typeof unpackAreas>} areas
 * @returns {{kod: number, nazev: string, kraj: string}|null}
 */
export function findArea(point, areas) {
  if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;

  for (const uzemi of areas) {
    if (!vObalce(point, uzemi.obalka)) continue;
    for (const polygon of uzemi.polygony) {
      if (vPolygonu(point, polygon)) {
        return { kod: uzemi.kod, nazev: uzemi.nazev, kraj: uzemi.kraj };
      }
    }
  }

  // Nespadl dovnitř ničeho — buď je v mezeře po zjednodušení, nebo je v cizině.
  // Rozliší se to vzdáleností od nejbližší hranice.
  const rezervaStupne = REZERVA_M / 111000;
  let nejblizsi = null;
  let nejmensi = Infinity;
  for (const uzemi of areas) {
    if (!vObalce(point, uzemi.obalka, rezervaStupne)) continue;
    const d = vzdalenostOdHranice(point, uzemi);
    if (d < nejmensi) {
      nejmensi = d;
      nejblizsi = uzemi;
    }
  }
  if (nejblizsi && nejmensi <= REZERVA_M) {
    return { kod: nejblizsi.kod, nazev: nejblizsi.nazev, kraj: nejblizsi.kraj };
  }
  return null;
}

/**
 * Rozebere popis oblasti z výstrahy.
 *
 * Tvary, které feed používá (ověřeno na 84 různých popisech):
 *   „Ústecký kraj (Litoměřice, Louny)"  → vyjmenovaná ORP
 *   „Ústecký kraj"                      → celý kraj
 *   „Hlavní město Praha"                → kraj i ORP zároveň
 *
 * @param {string} desc
 * @returns {{kraj: string|null, orps: string[]|null, ok: boolean}}
 *          `orps === null` znamená celý kraj, ne „žádné ORP".
 */
export function parseAreaDesc(desc) {
  const text = typeof desc === 'string' ? desc.trim() : '';
  if (!text) return { kraj: null, orps: null, ok: false };

  const zavorka = text.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (!zavorka) return { kraj: text, orps: null, ok: true };

  const orps = zavorka[2].split(',').map((s) => s.trim()).filter(Boolean);
  if (!orps.length) return { kraj: zavorka[1].trim(), orps: null, ok: true };
  return { kraj: zavorka[1].trim(), orps, ok: true };
}

/**
 * Týká se výstraha daného místa?
 *
 * ⚠️ Nerozebraný popis se považuje za zasahující (`true`). Feed píše rozsah
 * lidskou češtinou, takže se jeho tvar může kdykoli změnit — a ze dvou možných
 * chyb je **ukázat výstrahu navíc** nesrovnatelně menší zlo než zamlčet
 * bouřku. Že jde o odhad, hlásí {@link matchWarningAreas} příznakem `presne`.
 *
 * @param {string} desc      popis oblasti z výstrahy
 * @param {{nazev: string, kraj: string}} area  ORP určené z bodu
 */
export function areaCovers(desc, area) {
  if (!area) return false;
  const { kraj, orps, ok } = parseAreaDesc(desc);
  if (!ok) return true;
  if (orps === null) return kraj === area.kraj;
  // Jména ORP jsou v celé republice jedinečná (hlídá to generátor dat), takže
  // shoda jména stačí a kraj se kontrolovat nemusí.
  return orps.includes(area.nazev);
}

/**
 * Vybere z výstrah ty, které se týkají alespoň jednoho z míst.
 *
 * @param {Array<{areas: Array<{name: string}>}>} warnings  výstupy `trimWarnings`
 * @param {Array<{nazev: string, kraj: string}>} places     ORP určená z bodů trasy
 * @returns {Array<object & {presne: boolean, mista: string[]}>}
 *          `presne: false` znamená, že se popis oblasti nepodařilo rozebrat
 *          a výstraha je přiložená pro jistotu.
 */
export function matchWarningAreas(warnings, places) {
  const out = [];
  const unikatni = [];
  const videna = new Set();
  for (const p of places || []) {
    if (p && !videna.has(p.nazev)) {
      videna.add(p.nazev);
      unikatni.push(p);
    }
  }

  for (const w of warnings || []) {
    const zasazena = [];
    let presne = true;
    for (const oblast of (w.areas || [])) {
      const rozbor = parseAreaDesc(oblast.name);
      for (const misto of unikatni) {
        if (areaCovers(oblast.name, misto)) {
          if (!zasazena.includes(misto.nazev)) zasazena.push(misto.nazev);
          if (!rozbor.ok) presne = false;
        }
      }
    }
    if (zasazena.length) out.push({ ...w, presne, mista: zasazena });
  }
  return out;
}

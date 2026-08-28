/**
 * Srážkový radar — snímky RainVieweru.
 *
 * ⚠️ ČISTÝ MODUL. Bez DOM, bez sítě. Jen skládá adresy a počítá, který snímek
 * je na řadě.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ⚠️ VÝJIMKA Z R2: RADAROVÉ DLAŽDICE SE STAHUJÍ PŘÍMO, NE PŘES PROXY.
 *
 * Seznam snímků (`/api/radar`) přes proxy jde — je to jeden dotaz a klient
 * z něj nesmí vyčíst cizí doménu. Ale samotné OBRÁZKY dlaždic se načítají
 * napřímo z `tilecache.rainviewer.com`, protože:
 *
 *   · je jich při jednom pohledu na mapu desítky a při animaci stovky —
 *     hnát je přes funkci na Netlify by bylo pomalé a spálilo by to
 *     měsíční příděl volání,
 *   · nenesou žádný klíč — důvod, proč R2 vzniklo, tady odpadá
 *     (⚠️ ale IP adresa a User-Agent uživatele se k RainVieweru dostanou;
 *     to je cena té výjimky a patří to do zásad soukromí, viz R12),
 *   · obrázky nepodléhají CORS, takže důvod, kvůli kterému R2 vzniklo,
 *     tady vůbec nenastává.
 *
 * Vyměnitelnost zůstává zachovaná: adresa se skládá JEN tady, takže výměna
 * poskytovatele je změna v jednom souboru.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** Barevné schéma RainVieweru. 2 = univerzální modrá, čitelná na světlé i tmavé mapě. */
export const COLOR_SCHEME = 2;

/** Velikost dlaždice. 256 je lehčí na data, 512 ostřejší na displeji s vysokou hustotou. */
export const TILE_SIZE = 512;

/**
 * 🚨 Nejvyšší přiblížení, které RainViewer pro radar vydává.
 *
 * Nad ním NEVRACÍ chybu — vrátí obrázek se stavem 200, typem `image/png`
 * a natištěným nápisem **„Zoom Level Not Supported"**. Kdo kontroluje jen
 * stav odpovědi, prohlásí to za v pořádku a uživatel má přes mapu nalepené
 * cedule. Změřeno 22. 8. 2026 nad Prahou: od `z8` výš je to pokaždé týž
 * obrázek (shodný otisk), a to u velikosti 256 i 512 px.
 *
 * Musí se propsat do `maxzoom` rastrového zdroje, aby mapová knihovna nad
 * tuhle hranici vůbec nesahala a poslední dobrou dlaždici si zvětšila sama.
 */
export const MAX_ZOOM = 7;

/**
 * Snímky ze seznamu → jednotný seznam se skutečnými časy.
 *
 * RainViewer dělí snímky na `past` (naměřené) a `nowcast` (dopočítaná
 * předpověď na nejbližší půlhodinu). Pro uživatele je to jedna časová osa,
 * ale **musí být poznat, kde končí měření a začíná odhad** — jinak by se
 * dopočet tvářil jako fakt.
 *
 * @param {object} feed  odpověď /api/radar
 * @returns {Array<{timeMs: number, path: string, forecast: boolean}>}
 */
export function radarFrames(feed) {
  const host = feed?.host;
  if (!host) return [];

  const take = (list, forecast) => (list || [])
    .filter((f) => f && typeof f.path === 'string' && Number.isFinite(f.time))
    .map((f) => ({ timeMs: f.time * 1000, path: host + f.path, forecast }));

  return [
    ...take(feed.radar?.past, false),
    ...take(feed.radar?.nowcast, true),
  ].sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Šablona adresy dlaždic pro jeden snímek.
 * Zástupné texty `{z}/{x}/{y}` si doplní mapová knihovna.
 */
export function tileTemplate(frame, opts = {}) {
  if (!frame?.path) return null;
  const size = opts.size || TILE_SIZE;
  const color = opts.color ?? COLOR_SCHEME;
  // Poslední dvojice je `smooth_snow`: 1_1 = vyhlazené a se sněhem odlišeným.
  return `${frame.path}/${size}/{z}/{x}/{y}/${color}/1_1.png`;
}

/**
 * Index snímku nejbližšího danému času.
 * Používá se při otevření mapy — má se ukázat teď, ne nejstarší snímek.
 */
export function frameIndexAt(frames, timeMs) {
  if (!frames.length) return -1;
  let best = 0, bestDiff = Infinity;
  for (let i = 0; i < frames.length; i++) {
    const d = Math.abs(frames[i].timeMs - timeMs);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

/**
 * Další snímek v animaci (dokola).
 *
 * ⚠️ Na konci smyčky se čeká déle. Bez pauzy animace „skočí" z konce na
 * začátek a člověk ztratí přehled, kde se právě je.
 *
 * @returns {{index: number, holdMs: number}}
 */
export function nextFrame(frames, index, opts = {}) {
  const stepMs = opts.stepMs || 420;
  const loopPauseMs = opts.loopPauseMs || 1400;
  if (!frames.length) return { index: 0, holdMs: stepMs };

  const last = frames.length - 1;
  const next = index >= last ? 0 : index + 1;
  return { index: next, holdMs: index >= last ? loopPauseMs : stepMs };
}

/**
 * Popisek snímku: čas a jestli jde o měření, nebo o dopočet.
 * Vrací KLÍČ pro překlad, ne hotovou větu.
 */
export function frameLabel(frame, timeZone, locale) {
  if (!frame) return { time: '—', forecast: false };
  return {
    time: new Intl.DateTimeFormat(locale || 'en', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timeZone || 'UTC',
    }).format(new Date(frame.timeMs)),
    forecast: frame.forecast,
  };
}

/**
 * Kde na časové ose začíná dopočet.
 *
 * ⚠️ Vrací **podíl 0–1**, ne pixely — kdo to kreslí, ví o své šířce sám.
 * Osa se totiž nedělí časem, ale POŘADÍM snímků: rozestupy jsou stejné
 * (deset minut), takže index a čas jdou ruku v ruce, a kdyby jednou
 * nešly, je poctivější mít dílky stejně široké než osu, kde je půlka
 * hodiny jednou dvakrát delší.
 *
 * ⚠️ Když dopočet chybí, vrací `null`, ne nulu nebo jedničku. Nula by
 * kreslila celou osu jako odhad, jednička by odhad tvrdila na konci —
 * a „nevíme" se nesmí splést s „ne". RainViewer dopočet občas nevydá
 * (změřeno 28. 8. 2026: `nowcast` prázdný), takže to není teorie.
 *
 * @param {Array<{forecast: boolean}>} frames
 * @returns {number|null} podíl 0–1, nebo null když se nedopočítává
 */
export function forecastSplit(frames) {
  if (!Array.isArray(frames) || frames.length < 2) return null;
  const prvni = frames.findIndex((f) => f?.forecast);
  if (prvni <= 0) return null;
  return prvni / (frames.length - 1);
}

/**
 * O kolik je snímek daleko od teď — „před 40 min", „za 10 min", „teď".
 *
 * Absolutní čas na posuvníku nestačí: v 18:42 je „18:30" pro člověka
 * nesrozumitelné, dokud si to sám neodečte. Vrací se **klíč a číslo**,
 * větu složí až vrstva, která umí jazyk.
 *
 * ⚠️ Zaokrouhluje se na nejbližší minutu a rozestup snímků je deset,
 * takže „teď" je okno ±5 minut, ne shoda na sekundu.
 *
 * @returns {{key: 'now'|'ago'|'in', min: number}}
 */
export function offsetLabel(frame, nowMs = Date.now()) {
  const rozdil = Math.round(((frame?.timeMs ?? nowMs) - nowMs) / 60000);
  if (Math.abs(rozdil) < 5) return { key: 'now', min: 0 };
  return rozdil < 0 ? { key: 'ago', min: -rozdil } : { key: 'in', min: rozdil };
}

/**
 * Nowcast ČHMÚ — radarová předpověď na nejbližší hodinu.
 *
 * ⚠️ ČISTÝ MODUL. Žádná síť, žádné DOM. Jen skládá jména souborů, rozbaluje
 * archiv a počítá časy — takže se celý dá otestovat bez jediného stažení.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROČ ZROVNA TENHLE ZDROJ
 *
 * Michal 28. 8. 2026: *„nemá tu budoucnost nějaký meteoradar český dostupný
 * zdarma? … vymyslet nějak na základě předchozích pohybů?"* Přesně tohle
 * ČHMÚ počítá a vydává na `opendata.chmi.cz` pod **CC BY 4.0**:
 *
 *   · předpověď **+10 až +60 minut** po deseti minutách (`ft60s10`),
 *   · **nový běh každých 5 minut**,
 *   · PNG 680 × 460 px, 1 km na pixel, ve webovém Mercatoru (`gmaps`),
 *   · jeden běh = jeden `.tar` s šesti snímky, dohromady ~200 kB.
 *
 * Dělat vlastní extrapolaci vedle téhle by byla marnivost: je to tentýž
 * postup, jen oni ho počítají z celé sítě radarů a my bychom ho odhadovali
 * z obrázků, které už jednou prošly zjednodušením do palety.
 *
 * ⚠️ **Bez proxy to nejde.** Ověřeno 28. 8. 2026: `opendata.chmi.cz` nevrací
 * žádnou hlavičku CORS, takže z prohlížeče se ten soubor stáhnout NEDÁ.
 * Proto ho tahá náš server (`R2`), rozbalí jednou pro všechny a rozešle.
 *
 * ⚠️ **Je to jen Česko a okolí.** Za hranicemi výřezu vrstva prostě není —
 * a to se musí říct, ne mlčky ukázat prázdno.
 * ────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** Předpona jmen souborů v tomhle produktu. */
const PREDPONA = 'pacz2gmaps3.fct_z_max';

/** Přípona: předpověď do 60 minut po kroku 10. */
const DOSAH = 'ft60s10';

/** Nový běh každých 5 minut. */
export const KROK_BEHU_MIN = 5;

/** Snímky uvnitř běhu jdou po deseti minutách. */
export const KROK_SNIMKU_MIN = 10;

/**
 * Zeměpisný rozsah obrázku (WGS84).
 *
 * ⚠️ Tohle NENÍ odhad. Sedí na rozměr: 680 × 460 px při 1 km/px odpovídá
 * poměru stran 1,478, a Mercator na těchhle šířkách dává 1,46 — kdežto
 * prostá pravoúhlá projekce 2,31. Proto se obrázek smí položit do mapy
 * jako čtyři rohy a nemusí se překreslovat.
 */
export const VYREZ = { zapad: 11.267, jih: 48.047, vychod: 20.770, sever: 52.167 };

/**
 * Rohy pro mapovou knihovnu — po směru od levého horního.
 * @returns {Array<[number, number]>}
 */
export function rohy(v = VYREZ) {
  return [
    [v.zapad, v.sever],
    [v.vychod, v.sever],
    [v.vychod, v.jih],
    [v.zapad, v.jih],
  ];
}

/** Dvojčíslí s nulou napřed. */
const dd = (n) => String(n).padStart(2, '0');

/**
 * Jméno archivu pro daný běh.
 *
 * 🚨 Časy v názvech jsou UTC, ne místní. Ověřeno 28. 8. 2026 ve 21:03 SELČ:
 * nejnovější soubor nesl `1900`. Kdo by to spletl, sháněl by v létě běhy
 * staré dvě hodiny — a v zimě hodinu, takže by si toho v zimě ani nevšiml.
 */
export function nazevBehu(ms) {
  const d = new Date(zaokrouhliBeh(ms));
  const den = `${d.getUTCFullYear()}${dd(d.getUTCMonth() + 1)}${dd(d.getUTCDate())}`;
  return `${PREDPONA}.${den}.${dd(d.getUTCHours())}${dd(d.getUTCMinutes())}.${DOSAH}.tar`;
}

/** Čas běhu zaokrouhlený dolů na pětiminutu. */
export function zaokrouhliBeh(ms) {
  const krok = KROK_BEHU_MIN * 60_000;
  return Math.floor(ms / krok) * krok;
}

/**
 * Které běhy zkusit, od nejnovějšího.
 *
 * ⚠️ Poslední pětiminutovka ještě nemusí být nahraná — výpočet a nahrání
 * chvíli trvá. Kdyby se zkoušel jen jeden běh, měla by appka **pravidelně
 * několik minut v každé čtvrthodině prázdno** a vypadalo by to jako výpadek.
 * Proto se jde po řadě zpátky.
 *
 * @param {number} nowMs
 * @param {number} [kolik] kolik běhů zpět zkusit
 * @returns {number[]} časy běhů, od nejnovějšího
 */
export function kandidatiBehu(nowMs, kolik = 4) {
  const posledni = zaokrouhliBeh(nowMs);
  const out = [];
  for (let i = 0; i < Math.max(1, kolik); i++) {
    out.push(posledni - i * KROK_BEHU_MIN * 60_000);
  }
  return out;
}

/**
 * Rozbalí `.tar`.
 *
 * ⚠️ Vlastní čtečka, ne knihovna. Formát je 512bajtové hlavičky a data
 * zarovnaná na 512 — tohle je celý popis. Přidávat kvůli tomu závislost
 * (a s ní její aktualizace, licenci a útočnou plochu) by bylo dražší než
 * čtyřicet řádků, které se nikdy nezmění, protože se nemění ani formát.
 *
 * @param {Uint8Array} bajty
 * @returns {Array<{jmeno: string, data: Uint8Array}>}
 */
export function rozbalTar(bajty) {
  const out = [];
  const dekoder = new TextDecoder('utf-8');
  let i = 0;

  while (i + 512 <= bajty.length) {
    const hlavicka = bajty.subarray(i, i + 512);

    // Dva prázdné bloky znamenají konec. Stačí poznat jeden.
    if (hlavicka.every((b) => b === 0)) break;

    const jmeno = dekoder.decode(hlavicka.subarray(0, 100)).replace(/\0.*$/, '').trim();
    const velikostText = dekoder.decode(hlavicka.subarray(124, 136)).replace(/[\0 ]/g, '');
    const velikost = parseInt(velikostText, 8);
    const druh = String.fromCharCode(hlavicka[156] || 48);

    if (!Number.isFinite(velikost) || velikost < 0) {
      throw new Error(`Poškozený archiv: nečitelná velikost u „${jmeno}".`);
    }

    const zacatek = i + 512;
    // Soubor (`0`) i starý zápis bez druhu (`\0`) jsou data; `5` je složka.
    if (druh === '0' || druh === '\0') {
      out.push({ jmeno, data: bajty.subarray(zacatek, zacatek + velikost) });
    }

    i = zacatek + Math.ceil(velikost / 512) * 512;
  }

  return out;
}

/**
 * Z položek archivu udělá snímky s časy.
 *
 * Jméno nese obojí: platný čas i odstup od běhu —
 * `…/pacz2gmaps3.fct_z_max.20260828.1910.10.png` je *„platí v 19:10,
 * což je 10 minut od běhu"*.
 *
 * ⚠️ Čte se **platný čas**, ne „teď + odstup". Kdyby se běh opozdil,
 * posunula by se s ním celá osa a snímky by tvrdily budoucnost, která
 * už je minulostí.
 *
 * @returns {Array<{timeMs: number, minut: number, jmeno: string, data: Uint8Array}>}
 */
export function snimkyZArchivu(polozky) {
  const re = /\.(\d{8})\.(\d{4})\.(\d{1,3})\.png$/;
  const out = [];

  for (const p of polozky || []) {
    const m = re.exec(p.jmeno || '');
    if (!m) continue;
    const [, den, hhmm, minut] = m;
    const timeMs = Date.UTC(
      +den.slice(0, 4), +den.slice(4, 6) - 1, +den.slice(6, 8),
      +hhmm.slice(0, 2), +hhmm.slice(2, 4),
    );
    out.push({ timeMs, minut: +minut, jmeno: p.jmeno, data: p.data });
  }

  return out.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Jak starý smí být běh, aby se ještě směl ukázat.
 *
 * 🚨 Zastaralá předpověď je horší než žádná: tvrdí o příští hodině něco,
 * co se počítalo z dávno neplatné situace. Když nowcast nechodí, appka to
 * má říct, ne ukazovat obrázek staršího světa.
 */
export const NEJSTARSI_BEH_MS = 30 * 60_000;

/** Je běh ještě k něčemu? */
export function behJePlatny(runMs, nowMs) {
  return nowMs - runMs <= NEJSTARSI_BEH_MS && runMs <= nowMs + 60_000;
}

/**
 * Spojí naměřené snímky radaru s předpovědí do JEDNÉ osy.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🚨 DVĚ PŘEDPOVĚDI NA JEDNÉ OSE BY BYLA PAST
 *
 * RainViewer taky umí dopočet (jen ho ten den nevydával). Kdyby se obojí
 * naskládalo za sebe, posuvník by přecházel mezi dvěma různými výpočty —
 * a v místě přechodu by srážky poskočily, aniž by pro to byl důvod
 * v počasí. Když je k dispozici nowcast ČHMÚ, cizí dopočet se **zahodí**:
 * je hrubší a končí dřív.
 *
 * ⚠️ Zahodí se i snímky předpovědi, které jsou starší než poslední měření.
 * Předpověď na čas, který už nastal a máme ho naměřený, je krok zpět.
 * ────────────────────────────────────────────────────────────────────────
 *
 * @param {Array<{timeMs:number, forecast?:boolean}>} radarove  z RainVieweru
 * @param {Array<{timeMs:number}>} predpoved  z ČHMÚ (může být prázdné)
 * @returns {Array<object>} osa od nejstaršího po nejnovější
 */
export function spojOsu(radarove = [], predpoved = []) {
  const mereni = (radarove || []).filter((f) => f && !f.forecast);
  const cizi = (radarove || []).filter((f) => f && f.forecast);

  if (!predpoved?.length) return [...mereni, ...cizi].sort((a, b) => a.timeMs - b.timeMs);

  const posledniMereni = mereni.length ? mereni[mereni.length - 1].timeMs : -Infinity;
  const nase = predpoved
    .filter((f) => f && f.timeMs > posledniMereni)
    .map((f) => ({ ...f, forecast: true }));

  return [...mereni, ...nase].sort((a, b) => a.timeMs - b.timeMs);
}

/** Leží místo ve výřezu, na který nowcast vůbec platí? */
export function jeVeVyrezu(lat, lon, v = VYREZ) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= v.jih && lat <= v.sever && lon >= v.zapad && lon <= v.vychod;
}
